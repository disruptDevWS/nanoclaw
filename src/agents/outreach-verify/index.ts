/**
 * index.ts — verifyDraft(): the Bucket B outreach claim verifier.
 *
 * Spec: docs/plans/FORGE_OS_OUTREACH_VERIFIER_SPEC.md §3.
 * Plan: docs/plans/outreach-claim-verifier-bucket-b-plan.md.
 *
 * extract (grounded LLM) → site inventory (fetch+parse) → match → verdict →
 * deterministic subtraction → coherence gate → disposition + artifact.
 *
 * Subtract-and-flag only: PRESENT pure-absence claims are cut, PRESENT
 * ambiguous-presence claims are softened from a whitelist, everything
 * unresolvable is flagged. Nothing here writes new claims or calls a model
 * with the body as editable input. The returned artifact is the verdict-log
 * corpus entry — the caller persists it (disk + jsonb mirror).
 */

import { extractClaims } from './extract-claims.js';
import { resolveSiteInventory, inspectPage } from './site-inventory.js';
import { matchClaim, deriveVerdict, titleMismatchVerdict } from './match.js';
import { cutSentence, softenClaim, coherenceGate, deriveDisposition } from './subtract.js';
import type {
  InventoryPage,
  VerificationArtifact,
  VerifiedClaim,
  VerifyDraftInput,
} from './types.js';

/** Evidence fetches are bounded per draft — a handful of claims, not a crawl. */
const MAX_INSPECTIONS = 6;

export async function verifyDraft(input: VerifyDraftInput): Promise<VerificationArtifact> {
  const log = input.log ?? (() => {});
  const now = () => new Date().toISOString();

  // 1. Grounded extraction
  const extraction = await extractClaims(
    input.subject,
    input.body,
    input.services,
    input.locales,
    input.coverageTopics,
    input.callModel,
  );
  log(
    `claims extracted: ${extraction.claims.length} grounded, ${extraction.sweep.length} sweep, ${extraction.invalidCount} invalid`,
  );

  // 2. Zero claims and a quiet sweep → clean, no fetches needed.
  if (extraction.claims.length === 0 && extraction.sweep.length === 0 && extraction.invalidCount === 0) {
    return {
      verifier_version: '1',
      domain: input.domain,
      prospect_id: input.prospectId,
      variant: input.variant,
      verified_at: now(),
      scope_source: input.scopeSource,
      inventory: null,
      claims: [],
      extractor: { grounded_claims: 0, sweep_flags: 0, invalid_claims: 0 },
      sweep: [],
      coherence_gate: { applied: false, reason: null },
      disposition: 'clean',
      body_before: input.body,
      body_after: input.body,
    };
  }

  // 3. Site inventory (only when there are claims to resolve)
  const inventory = await resolveSiteInventory(input.domain);
  log(
    `inventory: ${inventory.page_count} pages (${inventory.quality})${inventory.blocked ? ' — BLOCKED' : ''}${
      inventory.errors.length ? `, ${inventory.errors.length} fetch errors` : ''
    }`,
  );

  // 4. Match + verdict per claim, inspecting evidence pages (bounded).
  const verified: VerifiedClaim[] = [];
  const inspected: InventoryPage[] = [];
  let inspections = 0;

  for (const claim of extraction.claims) {
    const match = matchClaim(claim, inventory.pages);
    let { verdict, reason } = deriveVerdict(match.status, inventory.quality, inventory.blocked);
    let page = match.page;

    // Confirm a slug/nav match against the live page when budget allows —
    // a sitemap can be stale, and title/H1 are evidence for the log.
    if (verdict === 'PRESENT' && page && page.title === null && inspections < MAX_INSPECTIONS) {
      inspections++;
      try {
        const seen = await inspectPage(inventory.origin, page.url);
        if (seen.statusCode >= 400) {
          verdict = 'UNRESOLVABLE';
          reason = `matched page returned HTTP ${seen.statusCode} — stale inventory entry`;
        } else {
          page = { ...page, title: seen.title, h1: seen.h1 };
          inspected.push(page);
        }
      } catch (err: any) {
        verdict = 'UNRESOLVABLE';
        reason = `evidence fetch failed: ${err.message}`;
      }
    }

    // title_mismatch has inverted polarity and needs title/H1 evidence.
    if (claim.type === 'title_mismatch' && verdict === 'PRESENT' && page) {
      const tm = titleMismatchVerdict(claim, page);
      verdict = tm.verdict;
      reason = tm.reason;
    }

    // 5. Action: subtract-and-flag only.
    let action: VerifiedClaim['action'];
    let bodyEdit: string | null = null;
    if (claim.in_subject) {
      action = 'flagged';
      reason = reason ?? 'claim sits in the subject line — not subtractable';
    } else if (verdict === 'PRESENT') {
      action = 'flagged'; // resolved to cut/softened below if surgery succeeds
    } else if (verdict === 'ABSENT') {
      action = 'kept';
    } else {
      action = 'flagged';
    }

    verified.push({
      ...claim,
      verdict,
      matched_page: page?.url ?? null,
      evidence_url: page ? new URL(page.url, inventory.origin).toString() : null,
      reason,
      action,
      occurred_at: now(),
    });
    log(`  ${claim.claim_id} [${claim.type}] "${claim.asserted_text.slice(0, 60)}" → ${verdict}`);
  }

  // 6. Apply subtractions sequentially against the evolving body.
  let body = input.body;
  for (const claim of verified) {
    if (claim.verdict !== 'PRESENT' || claim.in_subject) continue;
    if (claim.phrasing === 'pure_absence') {
      const cut = cutSentence(body, claim.asserted_text);
      if (cut !== null) {
        body = cut;
        claim.action = 'cut';
      } else {
        claim.action = 'flagged';
        claim.reason = 'sentence cut failed — asserted text not cleanly removable';
      }
    } else {
      const softened = softenClaim(body, claim.asserted_text);
      if (softened !== null) {
        body = softened;
        claim.action = 'softened';
      } else {
        claim.action = 'flagged';
        claim.reason = 'no whitelist soften applies — needs manual review';
      }
    }
  }

  // 7. Coherence gate + disposition.
  const anyCuts = verified.some((c) => c.action === 'cut');
  const coherence = coherenceGate(body, input.variant, anyCuts);
  const disposition = deriveDisposition(
    verified,
    input.variant,
    input.body,
    coherence,
    extraction.invalidCount,
    extraction.sweep.length,
  );

  return {
    verifier_version: '1',
    domain: input.domain,
    prospect_id: input.prospectId,
    variant: input.variant,
    verified_at: now(),
    scope_source: input.scopeSource,
    inventory: {
      quality: inventory.quality,
      sources_tried: inventory.sources_tried,
      page_count: inventory.page_count,
      pages_inspected: inspected,
      errors: inventory.errors,
    },
    claims: verified,
    extractor: {
      grounded_claims: extraction.claims.length,
      sweep_flags: extraction.sweep.length,
      invalid_claims: extraction.invalidCount,
    },
    sweep: extraction.sweep,
    coherence_gate: coherence,
    disposition,
    body_before: input.body,
    body_after: disposition === 'killed' ? null : body,
  };
}

export type { VerificationArtifact, VerifyDraftInput, Disposition } from './types.js';
