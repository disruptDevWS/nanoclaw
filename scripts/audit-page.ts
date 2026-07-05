#!/usr/bin/env npx tsx
/**
 * audit-page.ts — Single-page optimization deep-dive (Feature: page auditor).
 *
 * Triggered by the /audit-page Railway endpoint (page-audit edge function creates
 * a 'pending' page_audit_runs row and passes its id). Flow:
 *   1. claim the run (status → running)
 *   2. fetch + parse the page (src/agents/page-audit/fetch-page.ts — cheerio, raw HTML)
 *   3. mechanical scoring (score-page.ts) + code-verified AI readiness (agent-readiness.ts)
 *   4. embedding-grounded internal-link candidates (src/agents/linking/related-pages.ts)
 *   5. one Claude call (configs/agents/dwight/page-audit-prompt.md) → structured findings
 *   6. write findings + page_snapshot to page_audit_runs (status → complete)
 *
 * Usage:
 *   npx tsx scripts/audit-page.ts --domain <domain> --url <page-url> --user-email <email> --run-id <uuid>
 *
 * Environment variables (from .env or process.env):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY (or ANTHROPIC_KEY)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { callClaude, initAnthropicClient } from './anthropic-client.js';
import { fetchPage, type FetchedPage } from '../src/agents/page-audit/fetch-page.js';
import { assessAgentReadiness } from '../src/agents/page-audit/agent-readiness.js';
import { scoreFetchedPage } from '../src/agents/page-audit/score-page.js';
import { diffJsonLd } from '../src/agents/page-audit/schema-diff.js';
import { computeRelatedPages, formatRelatedPagesSection } from '../src/agents/linking/related-pages.js';

// ============================================================
// CLI argument parsing (same pattern as generate-cluster-strategy.ts)
// ============================================================

interface CliArgs {
  domain: string;
  url: string;
  userEmail: string;
  runId: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    }
  }

  if (!flags.domain || !flags.url || !flags['user-email'] || !flags['run-id']) {
    console.error('Usage: npx tsx scripts/audit-page.ts --domain <domain> --url <url> --user-email <email> --run-id <uuid>');
    process.exit(1);
  }

  return { domain: flags.domain, url: flags.url, userEmail: flags['user-email'], runId: flags['run-id'] };
}

// ============================================================
// .env loader (same pattern as track-rankings.ts)
// ============================================================

function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
    return env;
  }
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val !== undefined) env[key] = val;
  }
  return env;
}

// ============================================================
// Prompt assembly
// ============================================================

function buildSnapshotSection(page: FetchedPage): string {
  const lines = [
    `- Final URL: ${page.finalUrl}${page.redirected ? ` (redirected from ${page.url})` : ''}`,
    `- Status: ${page.statusCode} | ${page.contentType ?? 'unknown content type'} | ${Math.round(page.htmlBytes / 1024)}KB HTML`,
    `- Title: ${page.title ? `"${page.title}" (${page.title.length} chars)` : 'MISSING'}`,
    `- Meta description: ${page.metaDescription ? `"${page.metaDescription}" (${page.metaDescription.length} chars)` : 'MISSING'}`,
    `- Meta robots: ${page.metaRobots ?? 'none'} | Canonical: ${page.canonical ?? 'none'} | lang: ${page.lang ?? 'none'}`,
    `- Visible words in raw HTML: ${page.wordCount}`,
    `- Internal links on page: ${page.internalLinks.length} | External: ${page.externalLinkCount}`,
    '',
    `### Heading Outline (${page.headings.length})`,
    ...page.headings.slice(0, 60).map((h) => `${'  '.repeat(h.level - 1)}H${h.level}: ${h.text}`),
  ];

  const missingAlt = page.images.filter((i) => i.alt === null);
  lines.push('', `### Images (${page.images.length} total, ${missingAlt.length} missing alt)`);
  for (const img of missingAlt.slice(0, 20)) {
    lines.push(`- MISSING ALT: ${img.src}`);
  }
  for (const img of page.images.filter((i) => i.alt !== null).slice(0, 10)) {
    lines.push(`- alt="${img.alt}": ${img.src}`);
  }

  lines.push('', `### Internal links present on the page (first 40)`);
  for (const l of page.internalLinks.slice(0, 40)) {
    lines.push(`- ${l.href} — "${l.anchor}"`);
  }

  return lines.join('\n');
}

function extractJsonBlock(response: string): any {
  const fenced = response.match(/```json\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : response;
  return JSON.parse(raw.trim());
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = parseArgs();
  const env = loadEnv();

  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = env.ANTHROPIC_API_KEY || env.ANTHROPIC_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY missing');

  initAnthropicClient(anthropicKey);
  const sb: SupabaseClient = createClient(supabaseUrl, supabaseKey);

  // Claim the run (created 'pending' by the edge function)
  const { data: run, error: runErr } = await (sb as any)
    .from('page_audit_runs')
    .update({ status: 'running' })
    .eq('id', args.runId)
    .select('id, audit_id, page_url')
    .single();
  if (runErr || !run) throw new Error(`page_audit_runs row not found for ${args.runId}: ${runErr?.message ?? 'no row'}`);
  const auditId = run.audit_id as string;

  try {
    // 1. Fetch + parse the page
    console.log(`[audit-page] Fetching ${args.url}`);
    const page = await fetchPage(args.url);
    console.log(`[audit-page] ${page.statusCode} — ${page.wordCount} words, ${page.headings.length} headings, ${page.images.length} images, ${page.jsonLd.length} JSON-LD blocks`);

    // 2. Mechanical scoring + code-verified AI readiness
    const profile = scoreFetchedPage(page);
    const readiness = await assessAgentReadiness(page);
    console.log(`[audit-page] Mechanical score: ${profile.score}/100; readiness: ${readiness.checks.filter((c) => c.status === 'pass').length}/${readiness.checks.length} pass`);

    // 3. Internal-link candidates (embedding-grounded; non-fatal if unavailable)
    let relatedSection = '';
    try {
      const pagePath = new URL(page.finalUrl).pathname;
      const related = await computeRelatedPages(sb, { auditId, domain: args.domain, slug: pagePath });
      relatedSection = formatRelatedPagesSection(related);
      console.log(`[audit-page] Internal-link candidates: ${related?.candidates.length ?? 0}`);
    } catch (err: any) {
      console.warn(`[audit-page] related-pages unavailable (non-fatal): ${err.message}`);
    }

    // 4. Topic-cluster context for the page (entity-first framing)
    let clusterContext = 'No cluster assignment found for this page.';
    try {
      const pagePath = new URL(page.finalUrl).pathname.replace(/^\/+|\/+$/g, '');
      const { data: execPage } = await (sb as any)
        .from('execution_pages')
        .select('canonical_key, silo')
        .eq('audit_id', auditId)
        .or(`url_slug.eq.${pagePath},url_slug.eq./${pagePath}`)
        .maybeSingle();
      if (execPage?.canonical_key) {
        const { data: cluster } = await (sb as any)
          .from('audit_clusters')
          .select('canonical_topic, primary_entity_type, sample_keywords, total_volume')
          .eq('audit_id', auditId)
          .eq('canonical_key', execPage.canonical_key)
          .maybeSingle();
        if (cluster) {
          clusterContext = `Topic: ${cluster.canonical_topic} | Entity type: ${cluster.primary_entity_type ?? 'Service'} | Monthly volume: ${cluster.total_volume ?? '?'} | Sample queries: ${(cluster.sample_keywords ?? []).join(', ')}`;
        }
      } else if (execPage?.silo) {
        clusterContext = `Silo: ${execPage.silo} (no canonical topic key)`;
      }
    } catch {
      /* non-fatal */
    }

    // 5. GSC performance context (last 3 monthly snapshots + top queries) —
    // ground-truth query fan-out evidence for the recommendations. API-first by
    // design: gsc_page_snapshots is the live feed; the cornerstone CSV's GSC
    // columns are only a fallback for unconnected sites. Non-fatal when absent.
    let gscSection = '';
    try {
      const pagePath = new URL(page.finalUrl).pathname;
      const variants = [...new Set([
        pagePath,
        pagePath.replace(/\/+$/, '') || '/',
        pagePath.endsWith('/') ? pagePath : `${pagePath}/`,
      ])];
      const { data: gscRows } = await (sb as any)
        .from('gsc_page_snapshots')
        .select('snapshot_date, page_url, clicks, impressions, ctr, avg_position, top_queries')
        .eq('audit_id', auditId)
        .in('page_url', variants)
        .order('snapshot_date', { ascending: false })
        .limit(3);
      if (gscRows && gscRows.length > 0) {
        const hist = gscRows
          .map((r: any) => `${r.snapshot_date} | ${r.clicks ?? 0} | ${r.impressions ?? 0} | ${((r.ctr ?? 0) * 100).toFixed(1)}% | ${r.avg_position != null ? Number(r.avg_position).toFixed(1) : '—'}`)
          .join('\n');
        gscSection = `## GSC Performance for This Page (last ${gscRows.length} monthly snapshot(s) — ground truth)\nMonth | Clicks | Impressions | CTR | Avg Position\n${hist}\n`;
        const tq = gscRows[0].top_queries;
        if (Array.isArray(tq) && tq.length > 0) {
          const qLines = tq.slice(0, 20).map((q: any) => {
            if (typeof q === 'string') return `- ${q}`;
            const label = q.query ?? q.keyword ?? JSON.stringify(q);
            const stats: string[] = [];
            if (q.clicks != null) stats.push(`${q.clicks} clicks`);
            if (q.impressions != null) stats.push(`${q.impressions} impr`);
            if (q.position != null) stats.push(`pos ${Number(q.position).toFixed(1)}`);
            return `- ${label}${stats.length ? ` (${stats.join(', ')})` : ''}`;
          }).join('\n');
          gscSection += `\n### Queries this page already earns impressions for (latest month)\n${qLines}\n\nUse these as EVIDENCE, not decoration: a query with impressions but weak clicks/position that the page content does not directly answer is an extractability/coverage gap — address it in your header and content recommendations. Queries the page wins should be PROTECTED (do not recommend changes that sacrifice them).`;
        }
        console.log(`[audit-page] GSC context: ${gscRows.length} snapshot(s), ${Array.isArray(gscRows[0].top_queries) ? gscRows[0].top_queries.length : 0} top queries`);
      } else {
        console.log('[audit-page] No GSC snapshots for this page (analytics not connected or page unmatched)');
      }
    } catch (err: any) {
      console.warn(`[audit-page] GSC context unavailable (non-fatal): ${err.message}`);
    }

    // 6. Assemble prompt + call Claude
    const template = fs.readFileSync(
      path.resolve(process.cwd(), 'configs/agents/dwight/page-audit-prompt.md'),
      'utf-8',
    );
    const fmtChecks = (rows: Array<{ status: string; check: string; detail?: string; characteristic?: string; category?: string }>) =>
      rows
        .map((c) => `- [${c.status.toUpperCase()}] ${(c as any).characteristic ?? (c as any).category}: ${c.check}${c.detail ? ` — ${c.detail}` : ''}`)
        .join('\n');

    const prompt = template
      .replaceAll('{{PAGE_URL}}', page.finalUrl)
      .replaceAll('{{DOMAIN}}', args.domain)
      .replace('{{CLUSTER_CONTEXT}}', clusterContext)
      .replace('{{GSC_SECTION}}', gscSection || '## GSC Performance for This Page\nNo GSC data available for this page — do not invent performance claims.')
      .replace('{{PAGE_SNAPSHOT}}', buildSnapshotSection(page))
      .replace('{{MECHANICAL_CHECKS}}', fmtChecks(profile.checks as any))
      .replace('{{READINESS_CHECKS}}', fmtChecks(readiness.checks as any))
      .replace('{{CURRENT_JSONLD}}', page.jsonLd.length > 0 ? '```json\n' + JSON.stringify(page.jsonLd, null, 2).slice(0, 8000) + '\n```' : 'None.')
      .replace('{{RELATED_PAGES_SECTION}}', relatedSection || '## Verified Internal Link Candidates\nNone available — do not recommend specific internal link targets.')
      .replace('{{TEXT_SAMPLE}}', page.textSample || '(no visible text)');

    console.log(`[audit-page] Calling Claude (prompt ${prompt.length} chars)...`);
    const response = await callClaude(prompt, { model: 'sonnet', phase: 'dwight' });

    let findings: any;
    try {
      findings = extractJsonBlock(response);
    } catch {
      // one retry on malformed JSON
      console.warn('[audit-page] Malformed JSON — retrying once');
      const retry = await callClaude(prompt, { model: 'sonnet', phase: 'dwight' });
      findings = extractJsonBlock(retry);
    }

    // Attach code-computed layers so the dashboard renders one object
    findings.mechanical = profile;
    findings.readiness = { checks: readiness.checks };

    // Mechanical @graph preservation verification (DECISIONS.md 2026-07-05):
    // the proposed replacement must be a verified superset of the live schema.
    // Removals are computed in code, never trusted from the prompt, and render
    // as sign-off warnings in the dashboard before anyone pastes the proposal.
    if (findings.graph_schema?.proposed_jsonld && page.jsonLd.length > 0) {
      const schemaDiff = diffJsonLd(page.jsonLd, findings.graph_schema.proposed_jsonld);
      findings.graph_schema.diff = schemaDiff;
      console.log(
        `[audit-page] Schema diff: ${schemaDiff.preserved.length} preserved, ${schemaDiff.added.length} added, ` +
        `${schemaDiff.modified.length} modified, ${schemaDiff.removed.length} REMOVED` +
        (schemaDiff.removed.length > 0 ? ' — removals require human sign-off' : ''),
      );
    }

    // 7. Persist
    const pageSnapshot = {
      final_url: page.finalUrl,
      status_code: page.statusCode,
      title: page.title,
      meta_description: page.metaDescription,
      meta_robots: page.metaRobots,
      canonical: page.canonical,
      word_count: page.wordCount,
      headings: page.headings,
      images_total: page.images.length,
      images_missing_alt: page.images.filter((i) => i.alt === null).length,
      internal_link_count: page.internalLinks.length,
      external_link_count: page.externalLinkCount,
      jsonld_block_count: page.jsonLd.length,
      // Raw parsed JSON-LD — the diff baseline for this and future re-runs
      jsonld: page.jsonLd,
      has_llms_txt: readiness.llmsTxt != null,
      has_mcp_manifest: readiness.mcpManifest != null,
      fetched_at: new Date().toISOString(),
    };

    const { error: doneErr } = await (sb as any)
      .from('page_audit_runs')
      .update({
        status: 'complete',
        findings,
        page_snapshot: pageSnapshot,
        completed_at: new Date().toISOString(),
      })
      .eq('id', args.runId);
    if (doneErr) throw new Error(`Failed to persist findings: ${doneErr.message}`);

    console.log(`[audit-page] Complete: ${args.url} (run ${args.runId})`);
  } catch (err: any) {
    console.error(`[audit-page] FAILED: ${err.message}`);
    await (sb as any)
      .from('page_audit_runs')
      .update({ status: 'failed', error_message: String(err.message ?? err).slice(0, 2000), completed_at: new Date().toISOString() })
      .eq('id', args.runId);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[audit-page] FATAL: ${err.message}`);
  process.exit(1);
});
