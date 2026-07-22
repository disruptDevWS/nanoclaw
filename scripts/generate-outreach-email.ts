/**
 * generate-outreach-email.ts — Generate a cold-outreach email draft for a
 * scouted prospect and materialize it as a Gmail draft for human review.
 *
 * Input:  prospects row + Scout artifacts (scope.json, prospect-narrative.md;
 *         DB fallback via prospects.scout_scope_json / prospect_narrative)
 * Output: prospects.outreach_* columns + a draft in the sender's Gmail Drafts
 *
 * This script NEVER sends email. The Gmail draft is a materialization of the
 * DB copy; Matt reviews and sends manually. Recipient-facing copy draws only
 * from scope.json + prospect-narrative.md — never scout_markdown (internal
 * playbook, see DECISIONS.md 2026-07-05).
 *
 * Variants (warn, never block):
 *   pitch          — addressable_revenue_monthly >= $2,500/mo (or unknown)
 *   courtesy_note  — below threshold: honest "probably not worth an agency"
 *
 * Pre-send claim verification (Bucket B — FORGE_OS_OUTREACH_VERIFIER_SPEC §3):
 * every draft's site-structure absence claims are verified against the live
 * site BEFORE the Gmail step. clean/weakened → vetted body drafted;
 * needs_review/killed → NO Gmail draft, prospect flagged to the digest.
 * Verdict log: audits/{domain}/outreach/{date}/verification.json + jsonb
 * mirror in prospects.outreach_verification_json.
 *
 * Usage:
 *   npx tsx scripts/generate-outreach-email.ts --domain example.com [--force] [--approve-flagged]
 *
 * --force regenerates copy and updates the existing Gmail draft in place
 * (gmail_draft_id); without it, a prospect that already has a draft is skipped.
 * --approve-flagged materializes a needs_review/killed draft's stored copy to
 * Gmail as-is — Matt's explicit override, the only flagged→drafted path.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { callClaude, PHASE_MAX_TOKENS } from './anthropic-client.js';
import { loadEnv, createSb, parseFlags, AUDITS_BASE } from './analysis-shared.js';
import { getDelegatedUserAccessToken } from './google-auth.js';
import {
  createDraft,
  updateDraft,
  GmailApiError,
  GMAIL_COMPOSE_SCOPE,
} from './gmail-drafts.js';
import { verifyDraft } from '../src/agents/outreach-verify/index.js';

// Register the phase max tokens
PHASE_MAX_TOKENS['outreach_email'] = 2048;
PHASE_MAX_TOKENS['outreach_claim_extract'] = 2048;

// Mirrors the dashboard fit threshold (prospectFit.ts / DECISIONS.md 2026-07-06).
const FIT_THRESHOLD_MONTHLY = 2500;

const DEFAULT_SENDER = 'matt@forgegrowth.ai';

// Share links live on the dashboard origin (public token route).
const DEFAULT_DASHBOARD_URL = 'https://app.forgegrowth.ai';
const SHARE_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// ── Outreach attribution (FORGE_OS_OUTREACH_TRACKING_SPEC §3) ─────────────
//
// The share URL is the single measurable join between an email variant and
// Scout engagement (spec Principle 2). The token stays in the path for
// server attribution; UTM params carry campaign + variant so GA4 and the
// server dual-write can both key off them.
//
//   utm_content = variant_id  — REQUIRED. Today this is the coarse
//     outreach_variant ('pitch' | 'courtesy_note') as a PLACEHOLDER; when a
//     genome/breeding population lands, pass its id here and nothing else
//     changes ("plumb for later", Matt-confirmed 2026-07-21).
//   utm_campaign = scout_{vertical} — from prospects.vertical (migration 049;
//     cron-prospector stamps it, dashboard form sets it, backfilled from
//     candidates). Falls back to base `scout` when the column is null.
//   utm_term = {market} — derived from target_geos[0] when present.

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** First metro + state → `bend_or`; null when no usable geo. */
function marketSlug(targetGeos: ProspectRow['target_geos']): string | null {
  const geo = targetGeos?.[0];
  const metro = geo?.metros?.[0];
  const state = geo?.state;
  if (!metro || !state) return null;
  return `${slugify(metro)}_${slugify(state)}`;
}

function buildShareUrl(
  baseUrl: string,
  opts: { variantId: string; vertical?: string | null; market?: string | null },
): string {
  const params = new URLSearchParams({
    utm_source: 'outreach',
    utm_medium: 'email',
    utm_campaign: opts.vertical ? `scout_${slugify(opts.vertical)}` : 'scout',
    utm_content: opts.variantId, // variant_id — the fitness-function join key
  });
  if (opts.market) params.set('utm_term', opts.market);
  return `${baseUrl}?${params.toString()}`;
}

// ── Types ────────────────────────────────────────────────────

interface OutreachScope {
  business_type: string;
  domain: string;
  services: string[];
  locales: string[];
  gap_summary: {
    total: number;
    defending: number;
    weak: number;
    gaps: number;
    addressable_revenue_monthly?: number | null;
    top_opportunities: Array<{ keyword: string; topic: string; volume: number; cpc: number }>;
  };
  revenue_assumptions?: {
    acv_used: number;
    cr_used: number;
    value_label: string;
    basis?: string;
  } | null;
  service_coverage?: Record<string, unknown> | null;
}

interface ProspectRow {
  id: string;
  name: string;
  domain: string;
  status: string;
  contact_email: string | null;
  contact_name: string | null;
  prospect_narrative: string | null;
  scout_scope_json: OutreachScope | null;
  outreach_subject: string | null;
  outreach_body: string | null;
  outreach_status: string;
  gmail_draft_id: string | null;
  share_token: string | null;
  share_expires_at: string | null;
  target_geos: Array<{ state: string; metros: string[] }> | null;
  vertical: string | null;
}

// ── Data loading (disk first, DB fallback) ───────────────────

function findLatestDatedDir(base: string): string | null {
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base)
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e))
    .sort();
  return dirs.length > 0 ? path.join(base, dirs[dirs.length - 1]) : null;
}

function loadScoutData(
  domain: string,
  prospect: ProspectRow,
): { scope: OutreachScope; narrative: string; scopeSource: 'disk' | 'db' } {
  let scope: OutreachScope | null = null;
  let narrative = '';
  let scopeSource: 'disk' | 'db' = 'disk';

  const scoutDir = findLatestDatedDir(path.join(AUDITS_BASE, domain, 'scout'));
  if (scoutDir) {
    const scopePath = path.join(scoutDir, 'scope.json');
    if (fs.existsSync(scopePath)) {
      scope = JSON.parse(fs.readFileSync(scopePath, 'utf-8'));
    }
    const narrativePath = path.join(scoutDir, 'prospect-narrative.md');
    if (fs.existsSync(narrativePath)) {
      narrative = fs.readFileSync(narrativePath, 'utf-8');
    }
  }

  // DB fallback (Railway container may not have local scout artifacts)
  if (!scope && prospect.scout_scope_json) {
    console.log('  scope.json not on disk — using prospects.scout_scope_json');
    scope = prospect.scout_scope_json;
    scopeSource = 'db';
  }
  if (!narrative && prospect.prospect_narrative) {
    narrative = prospect.prospect_narrative;
  }

  if (!scope) {
    throw new Error(
      `No scout scope found for ${domain} (checked audits/${domain}/scout/ and prospects.scout_scope_json). Run a scout first.`,
    );
  }
  if (!narrative) {
    throw new Error(
      `No prospect narrative found for ${domain}. The narrative is the grounding source for outreach copy — re-run scout to generate it.`,
    );
  }

  return { scope, narrative, scopeSource };
}

// ── Prompt + generation ──────────────────────────────────────

type Variant = 'pitch' | 'courtesy_note';

function pickVariant(scope: OutreachScope): { variant: Variant; addressable: number | null } {
  const addressable = scope.gap_summary.addressable_revenue_monthly ?? null;
  if (addressable !== null && addressable < FIT_THRESHOLD_MONTHLY) {
    return { variant: 'courtesy_note', addressable };
  }
  // Unknown/suppressed revenue → pitch, but no revenue numbers reach the prompt.
  return { variant: 'pitch', addressable };
}

function buildPrompt(
  scope: OutreachScope,
  narrative: string,
  variant: Variant,
  addressable: number | null,
  contactName: string | null,
  shareUrl: string,
): string {
  const businessName = scope.business_type || scope.domain;
  const gs = scope.gap_summary;
  const topOpps = (gs.top_opportunities || []).slice(0, 3);
  const ra = scope.revenue_assumptions;

  const revenueLines =
    variant === 'pitch' && addressable !== null && ra
      ? `- Modeled addressable revenue if these gaps were closed: ~$${addressable.toLocaleString()}/month (conservative floor)
- Basis: ${ra.value_label}${ra.basis ? ` — ${ra.basis}` : ''}`
      : '';

  const linkRule = `- Include this exact URL once, on its own sentence, as plain text (no markdown, no link text wrapping, no shorteners): ${shareUrl}
  Frame it as their prepared report, e.g. "I put together a short scouting report on your search presence: <url>". The report is the deliverable the email promises — the email's only job is to earn that click.
- Exactly one URL in the entire email. No other links.`;

  const variantInstructions =
    variant === 'pitch'
      ? `Write a PITCH email: 100-140 words.
- The first two sentences must contain one concrete, quantified hook pulled from the data (e.g. a specific search gap or the searches-per-month they are missing).
- One line of credibility framing (Matt runs search-growth analysis for local service businesses; do not invent client names or results).
${linkRule}
- Close with a soft CTA: worth a 15-minute call? (The report page has a booking link — do not put a second URL in the email.)`
      : `Write a COURTESY NOTE email: 80-120 words.
- Be honest: we ran the numbers and their search gap is modest — probably not worth paying an agency.
- Point out the one or two highest-value things from the data they could do themselves.
${linkRule}
- No sales pitch, no CTA beyond "happy to point you in the right direction if useful."`;

  return `You are writing a short cold outreach email from Matt, founder of Forge Growth (a search-growth consultancy for local service businesses), to ${contactName || 'the owner'} of ${businessName}. The recipient is skeptical and will give this email a 30-second read at most.

YOUR ENTIRE RESPONSE IS THE OUTPUT. No preamble.

## Data (the ONLY permitted source of facts)

### Analysis narrative
${narrative}

### Search position summary
- Keywords defending (page 1): ${gs.defending}
- Keywords at risk (page 2-3): ${gs.weak}
- Keywords not ranking at all: ${gs.gaps}
${topOpps.length > 0 ? `\n### Top gap opportunities\n${topOpps.map((o) => `- "${o.keyword}" — ${o.volume.toLocaleString()} searches/mo, $${(o.cpc ?? 0).toFixed(2)} CPC`).join('\n')}` : ''}
${revenueLines}

## Grounding rule
Cite ONLY facts present in the data above. Never invent statistics, client names, results, or claims about their website. If a number is not provided, do not estimate one.

## Task
${variantInstructions}

## Style rules
- Avoid em dashes (—). Use periods, commas, or restructure sentences instead. One em dash maximum in the whole email.
- Write short, direct sentences. Vary sentence length naturally.
- No filler phrases like "it's worth noting" or "the reality is."
- Subject line: 60 characters or fewer, sentence case, no clickbait, no exclamation marks.
- Plain text only. No markdown, no bullet points in the body.
- No placeholders like [Name]. ${contactName ? `Greet as "Hi ${contactName},"` : 'No name is available — open with "Hi,"'}
- Sign off exactly:
Matt
Forge Growth

## Output format — exactly these two sections with these markers:

---SUBJECT---
[subject line]

---BODY---
[email body including greeting and sign-off]

REMINDER: Output the two sections with the exact markers. No other text.`;
}

async function generateEmail(
  scope: OutreachScope,
  narrative: string,
  variant: Variant,
  addressable: number | null,
  contactName: string | null,
  shareUrl: string,
): Promise<{ subject: string; body: string }> {
  const prompt = buildPrompt(scope, narrative, variant, addressable, contactName, shareUrl);
  const output = await callClaude(prompt, { model: 'sonnet', phase: 'outreach_email' });

  const subjectMatch = output.match(/---SUBJECT---([\s\S]*?)---BODY---/);
  const bodyMatch = output.match(/---BODY---([\s\S]*?)$/);
  const subject = subjectMatch?.[1]?.trim();
  const body = bodyMatch?.[1]?.trim();

  if (!subject || !body) {
    throw new Error('Model output missing ---SUBJECT--- / ---BODY--- markers; nothing written.');
  }
  return { subject, body };
}

// ── Gmail materialization (shared by the normal path and --approve-flagged) ──

async function materializeGmailDraft(
  sb: ReturnType<typeof createSb>,
  row: ProspectRow,
  sender: string,
  subject: string,
  body: string,
): Promise<void> {
  const token = await getDelegatedUserAccessToken(sender, [GMAIL_COMPOSE_SCOPE]);
  const content = {
    to: row.contact_email ?? undefined,
    from: sender,
    subject,
    body,
  };
  if (!row.contact_email) {
    console.log('  No contact_email on prospect — draft will have an empty To: field.');
  }

  let draftId: string;
  if (row.gmail_draft_id) {
    try {
      draftId = await updateDraft(token, row.gmail_draft_id, content);
      console.log(`  Updated existing Gmail draft ${draftId}`);
    } catch (err) {
      if (err instanceof GmailApiError && err.status === 404) {
        draftId = await createDraft(token, content);
        console.log(`  Previous draft was deleted in Gmail — created new draft ${draftId}`);
      } else {
        throw err;
      }
    }
  } else {
    draftId = await createDraft(token, content);
    console.log(`  Created Gmail draft ${draftId}`);
  }

  const { error: draftUpdateError } = await sb
    .from('prospects')
    .update({ gmail_draft_id: draftId, outreach_status: 'drafted', updated_at: new Date().toISOString() })
    .eq('id', row.id);
  if (draftUpdateError) {
    console.warn(`  ⚠ Draft created (${draftId}) but DB status update failed: ${draftUpdateError.message}`);
  } else {
    console.log(`  Done — outreach_status=drafted. Review it in ${sender}'s Drafts folder.`);
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const domain = flags.domain;
  const force = flags.force === 'true';
  const approveFlagged = flags['approve-flagged'] === 'true';
  if (!domain) {
    console.error(
      'Usage: npx tsx scripts/generate-outreach-email.ts --domain <domain> [--force] [--approve-flagged]',
    );
    process.exit(1);
  }

  const env = loadEnv();
  // Set env vars for anthropic-client.ts / google-auth.ts
  if (env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  if (env.ANTHROPIC_KEY) process.env.ANTHROPIC_KEY = env.ANTHROPIC_KEY;
  if (env.GOOGLE_ADC_JSON) process.env.GOOGLE_ADC_JSON = env.GOOGLE_ADC_JSON;
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  const sender = env.OUTREACH_SENDER || process.env.OUTREACH_SENDER || DEFAULT_SENDER;

  const sb = createSb(env);

  // 1. Resolve prospect
  const { data: prospect, error } = await sb
    .from('prospects')
    .select(
      'id, name, domain, status, contact_email, contact_name, prospect_narrative, scout_scope_json, outreach_subject, outreach_body, outreach_status, gmail_draft_id, share_token, share_expires_at, target_geos, vertical',
    )
    .eq('domain', domain)
    .maybeSingle();

  if (error) throw new Error(`prospects lookup failed: ${error.message}`);
  if (!prospect) throw new Error(`No prospect found for domain ${domain}`);
  const row = prospect as ProspectRow;

  if (row.status !== 'scouted' && row.status !== 'converted') {
    throw new Error(
      `Prospect ${domain} has status '${row.status}' — outreach requires a completed scout (scouted/converted).`,
    );
  }

  // Human override for a verifier-flagged draft: materialize the stored copy
  // as-is. This is Matt's explicit judgment call (spec §0) — the only path
  // from needs_review/killed to a Gmail draft, and it is never automatic.
  if (approveFlagged) {
    if (row.outreach_status !== 'needs_review' && row.outreach_status !== 'killed') {
      throw new Error(
        `--approve-flagged requires outreach_status needs_review or killed (found '${row.outreach_status}').`,
      );
    }
    if (!row.outreach_subject || !row.outreach_body) {
      throw new Error(`--approve-flagged: no stored outreach copy for ${domain}.`);
    }
    console.log(
      `  --approve-flagged: creating Gmail draft from the stored copy (human override of '${row.outreach_status}').`,
    );
    await materializeGmailDraft(sb, row, sender, row.outreach_subject, row.outreach_body);
    return;
  }

  // 2. Idempotency gate
  if (row.gmail_draft_id && !force) {
    console.log(
      `Prospect ${domain} already has Gmail draft ${row.gmail_draft_id}. Use --force to regenerate (updates the draft in place).`,
    );
    return;
  }

  // 3. Load scout data
  const { scope, narrative, scopeSource } = loadScoutData(domain, row);

  // 4. Fit check (warn, never block)
  const { variant, addressable } = pickVariant(scope);
  if (variant === 'courtesy_note') {
    console.warn(
      `  ⚠ Addressable revenue $${addressable?.toLocaleString()}/mo is below the $${FIT_THRESHOLD_MONTHLY.toLocaleString()}/mo fit threshold — generating a courtesy note, not a pitch.`,
    );
  } else if (addressable === null) {
    console.log('  Revenue estimate suppressed/absent — pitch will carry no revenue numbers.');
  }

  // 5. Ensure a live share link — the email's one URL. A missing token gets
  //    minted here; an expired one gets a fresh token so the drafted link
  //    can't be dead on arrival. (Expiry restarts again at Mark-sent.)
  let shareToken = row.share_token;
  const tokenExpired =
    !!row.share_expires_at && new Date(row.share_expires_at).getTime() < Date.now();
  if (!shareToken || tokenExpired) {
    shareToken = randomUUID();
    const mintedAt = new Date();
    const { error: tokenError } = await sb
      .from('prospects')
      .update({
        share_token: shareToken,
        share_token_created_at: mintedAt.toISOString(),
        share_expires_at: new Date(mintedAt.getTime() + SHARE_LINK_TTL_MS).toISOString(),
        updated_at: mintedAt.toISOString(),
      })
      .eq('id', row.id);
    if (tokenError) throw new Error(`Failed to mint share token: ${tokenError.message}`);
    console.log(`  ${tokenExpired ? 'Expired share token replaced' : 'Share token minted'} (expires in 14 days)`);
  }
  const dashboardUrl = (env.DASHBOARD_URL || process.env.DASHBOARD_URL || DEFAULT_DASHBOARD_URL).replace(/\/+$/, '');
  // variant_id is the fitness-function join key. Placeholder = outreach_variant
  // until a genome population exists (see buildShareUrl notes). It is picked in
  // step 4 below, so build the URL after the variant is known.
  const shareUrl = buildShareUrl(`${dashboardUrl}/share/scout/${shareToken}`, {
    variantId: variant,
    vertical: row.vertical, // scout_{vertical} when set (migration 049), else base `scout`
    market: marketSlug(row.target_geos),
  });

  // 6. Generate copy
  console.log(`  Generating ${variant} email for ${row.name || domain}...`);
  const { subject, body } = await generateEmail(
    scope,
    narrative,
    variant,
    addressable,
    row.contact_name,
    shareUrl,
  );

  // 6a. Pre-send claim verification (Bucket B — FORGE_OS_OUTREACH_VERIFIER_SPEC §3).
  //     Runs BEFORE anything persists or reaches Gmail: the Gmail draft is
  //     created from the vetted body only, never create-then-edit.
  console.log('  Verifying draft claims against the live site...');
  const verification = await verifyDraft({
    domain,
    prospectId: row.id,
    subject,
    body,
    variant,
    services: scope.services ?? [],
    locales: scope.locales ?? [],
    coverageTopics: Object.keys(scope.service_coverage ?? {}),
    scopeSource,
    callModel: (p) => callClaude(p, { model: 'sonnet', phase: 'outreach_claim_extract' }),
    log: (m) => console.log(`    ${m}`),
  });
  console.log(`  Verification disposition: ${verification.disposition}`);

  // Verdict log: disk-first artifact + jsonb mirror (Railway disk is
  // ephemeral in the cron path — same durability pattern as scout_scope_json).
  const verifyDir = path.join(AUDITS_BASE, domain, 'outreach', new Date().toISOString().slice(0, 10));
  fs.mkdirSync(verifyDir, { recursive: true });
  const artifactPath = path.join(verifyDir, 'verification.json');
  fs.writeFileSync(artifactPath, JSON.stringify(verification, null, 2));
  console.log(`  Verdict log: ${artifactPath}`);

  // killed keeps the original body in the DB so Matt can see what was
  // generated and why it died; clean/weakened persist the vetted body.
  const vettedBody = verification.body_after ?? body;
  const statusForDisposition =
    verification.disposition === 'needs_review'
      ? 'needs_review'
      : verification.disposition === 'killed'
        ? 'killed'
        : 'generated';

  // 6b. Persist copy — the DB row is the durable output; Gmail is a
  //     materialization that can fail and be retried with --force.
  const nowIso = new Date().toISOString();
  const { error: updateError } = await sb
    .from('prospects')
    .update({
      outreach_subject: subject,
      outreach_body: vettedBody,
      outreach_variant: variant,
      outreach_status: statusForDisposition,
      outreach_generated_at: nowIso,
      outreach_verification_json: verification,
      updated_at: nowIso,
    })
    .eq('id', row.id);
  if (updateError) throw new Error(`Failed to persist outreach copy: ${updateError.message}`);
  console.log(`  Copy persisted (variant=${variant}, status=${statusForDisposition}, subject="${subject}")`);

  // 7. Gmail step (non-fatal) — gated: a flagged or killed draft must not
  //    exist in Gmail. --approve-flagged is the only override, and it's human.
  if (verification.disposition !== 'clean' && verification.disposition !== 'weakened') {
    console.log(
      `  No Gmail draft created (disposition=${verification.disposition}). ` +
        `Review the verdict log, then re-run with --force after fixes or --approve-flagged to draft as-is.`,
    );
    return;
  }
  try {
    await materializeGmailDraft(sb, row, sender, subject, vettedBody);
  } catch (err: any) {
    console.warn(`  ⚠ Gmail draft step failed (copy is saved, outreach_status=${statusForDisposition}):`);
    console.warn(`    ${err.message}`);
    console.warn(`  Re-run with --force to retry the Gmail step after fixing the cause.`);
  }
}

main().catch((err) => {
  console.error(`generate-outreach-email failed: ${err.message}`);
  process.exit(1);
});
