#!/usr/bin/env npx tsx
/**
 * detect-llm-citation-queries.ts — A2: GSC zero-click fan-out detection.
 *
 * Read-only analysis. Pulls a DEDICATED high-row-limit query×page dataset from
 * GSC (the regular fetch-gsc-data pull is top-1000 by clicks — GSC sorts by
 * clicks descending and zero-click rows sort to the bottom, so they are
 * systematically excluded there). Flags queries with the LLM citation
 * signature: top-10 position, ≥50 impressions, ZERO clicks, long/evaluative
 * phrasing. Writes audits/{domain}/analysis/llm_citation_queries.{json,md}.
 *
 * Usage:
 *   npx tsx scripts/detect-llm-citation-queries.ts --domain idahomedicalacademy.com
 *   Flags: --days 90 --min-impressions 50 --max-position 10 --min-words 5
 *
 * Environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_ADC_JSON
 */

import {
  detectLlmCitationQueries,
  QueryPageRow,
  DEFAULT_LLM_CITATION_OPTIONS,
  LlmCitationFlag,
} from '../src/analysis/llm-citation.js';
import { normalizePath } from '../src/analysis/reeval-candidates.js';
import { getServiceAccountAccessToken, getAnalyticsConnection } from './google-auth.js';
import {
  loadEnv,
  createSb,
  parseFlags,
  resolveAuditByDomain,
  fetchAll,
  writeAnalysisArtifact,
  todayStr,
} from './analysis-shared.js';

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const GSC_PAGE_SIZE = 25000; // GSC API max rowLimit per request

async function fetchAllQueryPageRows(
  propertyUrl: string,
  startDate: string,
  endDate: string,
  token: string,
): Promise<QueryPageRow[]> {
  const apiBase = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(propertyUrl)}/searchAnalytics/query`;
  const rows: QueryPageRow[] = [];
  for (let startRow = 0; ; startRow += GSC_PAGE_SIZE) {
    const resp = await fetch(apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['query', 'page'],
        rowLimit: GSC_PAGE_SIZE,
        startRow,
        dataState: 'final',
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`GSC query×page query failed (${resp.status}): ${errText}`);
    }
    const data = await resp.json();
    const batch: QueryPageRow[] = (data.rows ?? []).map((r: any) => ({
      query: r.keys[0],
      page: r.keys[1],
      clicks: r.clicks,
      impressions: r.impressions,
      position: r.position,
    }));
    rows.push(...batch);
    console.log(`  GSC query×page: +${batch.length} rows (total ${rows.length})`);
    if (batch.length < GSC_PAGE_SIZE) break;
  }
  return rows;
}

function buildMarkdown(
  domain: string,
  flagsOut: Array<LlmCitationFlag & { canonical_key: string | null }>,
  meta: { totalRows: number; dateRange: { start: string; end: string }; optionsUsed: object },
): string {
  let md = `# Probable LLM Citation Queries (GSC Zero-Click Fan-Out) — ${domain}\n\n`;
  md += `Generated: ${todayStr()} | Window: ${meta.dateRange.start} → ${meta.dateRange.end} | `;
  md += `${meta.totalRows} query×page rows scanned\n`;
  md += `Thresholds: \`${JSON.stringify(meta.optionsUsed)}\`\n\n`;
  md += `Top-10 rankings with impressions but ZERO clicks — pages likely retrieved by `;
  md += `LLM fan-out for answer synthesis without SERP click-through. Complementary to DataForSEO LLM Mentions.\n\n`;
  if (flagsOut.length === 0) {
    md += `No queries matched the signature.\n`;
    return md;
  }
  md += `| Query | Page | Pos | Impressions | Cluster | Signals |\n|---|---|---|---|---|---|\n`;
  for (const f of flagsOut) {
    md += `| ${f.query} | ${normalizePath(f.page)} | ${f.position} | ${f.impressions} | ${f.canonical_key ?? ''} | ${f.reasons.join(', ')} |\n`;
  }
  return md;
}

async function main() {
  const cliFlags = parseFlags(process.argv.slice(2));
  const domain = cliFlags.domain;
  if (!domain) {
    console.error('Usage: npx tsx scripts/detect-llm-citation-queries.ts --domain <domain>');
    process.exit(1);
  }

  const days = Number(cliFlags.days ?? 90);
  const options = {
    maxPosition: Number(cliFlags['max-position'] ?? DEFAULT_LLM_CITATION_OPTIONS.maxPosition),
    minImpressions: Number(cliFlags['min-impressions'] ?? DEFAULT_LLM_CITATION_OPTIONS.minImpressions),
    minWordsExclusive: Number(cliFlags['min-words'] ?? DEFAULT_LLM_CITATION_OPTIONS.minWordsExclusive),
  };

  const env = loadEnv();
  if (env.GOOGLE_ADC_JSON) process.env.GOOGLE_ADC_JSON = env.GOOGLE_ADC_JSON;
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  const sb = createSb(env);
  const audit = await resolveAuditByDomain(sb, domain);
  console.log(`\n=== LLM citation queries: ${domain} (audit ${audit.id}) ===\n`);

  const connection = await getAnalyticsConnection(sb, audit.id);
  if (!connection || !connection.gsc_property_url) {
    console.log('  No active GSC connection — nothing to analyze.\n');
    return;
  }

  // Window: `days` ending 3 days ago (GSC finalization delay)
  const end = new Date();
  end.setDate(end.getDate() - 3);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  const dateRange = { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  console.log(`  Property: ${connection.gsc_property_url} | window ${dateRange.start} → ${dateRange.end}`);

  const token = await getServiceAccountAccessToken([GSC_SCOPE]);
  const rows = await fetchAllQueryPageRows(connection.gsc_property_url, dateRange.start, dateRange.end, token);

  const flagged = detectLlmCitationQueries(rows, options);

  // Best-effort cluster association via execution_pages slug → canonical_key
  const pages = await fetchAll<{ url_slug: string | null; canonical_key: string | null }>(
    sb,
    'execution_pages',
    'url_slug, canonical_key',
    (q) => q.eq('audit_id', audit.id),
  );
  const clusterBySlug = new Map<string, string>();
  for (const p of pages) {
    if (p.url_slug && p.canonical_key) clusterBySlug.set(normalizePath(p.url_slug), p.canonical_key);
  }
  const flagsOut = flagged.map((f) => ({
    ...f,
    canonical_key: clusterBySlug.get(normalizePath(f.page)) ?? null,
  }));

  console.log(`\n  ${flagsOut.length} probable LLM citation queries (of ${rows.length} rows):`);
  for (const f of flagsOut.slice(0, 20)) {
    console.log(`    "${f.query}" — ${normalizePath(f.page)} pos ${f.position}, ${f.impressions} impressions [${f.reasons.join(', ')}]`);
  }
  if (flagsOut.length > 20) console.log(`    ... and ${flagsOut.length - 20} more (see artifact)`);

  const artifact = {
    domain,
    audit_id: audit.id,
    generated_at: todayStr(),
    date_range: dateRange,
    options,
    total_rows_scanned: rows.length,
    flagged: flagsOut,
  };
  const jsonPath = writeAnalysisArtifact(
    domain,
    'llm_citation_queries',
    artifact,
    buildMarkdown(domain, flagsOut, { totalRows: rows.length, dateRange, optionsUsed: options }),
  );
  console.log(`\n  Written: ${jsonPath} (+ .md)\n`);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}\n`);
  process.exit(1);
});
