#!/usr/bin/env npx tsx
/**
 * compute-proven-ceiling.ts — A3: empirical KD ranking ceiling from top-7 rankings.
 *
 * Read-only analysis. Computes the site-wide and per-cluster proven ceilings
 * from audit_keywords (rank_pos + keyword_difficulty, migration 036) and writes
 * audits/{domain}/analysis/proven_ceiling.{json,md}.
 *
 * Usage:
 *   npx tsx scripts/compute-proven-ceiling.ts --domain idahomedicalacademy.com
 *
 * Environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import {
  computeProvenCeiling,
  CeilingKeyword,
  COLD_START_MIN_OWNED,
} from '../src/analysis/proven-ceiling.js';
import {
  loadEnv,
  createSb,
  parseFlags,
  resolveAuditByDomain,
  fetchAll,
  writeAnalysisArtifact,
  todayStr,
} from './analysis-shared.js';

function buildMarkdown(domain: string, result: ReturnType<typeof computeProvenCeiling>): string {
  let md = `# Proven Ranking Ceiling — ${domain}\n\n`;
  md += `Generated: ${todayStr()}\n\n`;
  md += `| Metric | Value |\n|---|---|\n`;
  md += `| Owned keywords (pos 1–7, non-brand) | ${result.owned_count} |\n`;
  md += `| Owned with KD | ${result.owned_with_kd_count} |\n`;
  md += `| Cold start (<${COLD_START_MIN_OWNED} owned) | ${result.cold_start ? 'YES' : 'no'} |\n`;
  md += `| **Site ceiling** | ${result.site_ceiling !== null ? `**KD ${result.site_ceiling}**` : 'n/a'} |\n\n`;

  if (result.cold_start) {
    md += `Site is cold-start: too few proven rankings to derive an empirical ceiling. Use the DR prior instead.\n\n`;
  } else if (result.site_ceiling !== null && result.site_ceiling_example) {
    md += `Proven ceiling: KD ${result.site_ceiling} — already ranks top-7 for "${result.site_ceiling_example.keyword}" (KD ${result.site_ceiling_example.kd}).\n\n`;
  }

  if (result.cluster_ceilings.length > 0) {
    md += `## Cluster Ceilings\n\n`;
    md += `| Cluster | Ceiling | Owned w/ KD | Example keyword |\n|---|---|---|---|\n`;
    for (const c of result.cluster_ceilings) {
      const ceiling = c.ceiling !== null ? `KD ${c.ceiling}` : `— (fallback: site)`;
      md += `| ${c.canonical_topic ?? c.canonical_key} | ${ceiling} | ${c.owned_with_kd} | ${c.example_keyword ?? ''} |\n`;
    }
    md += `\nClusters with <2 owned KD'd keywords fall back to the site ceiling.\n`;
  }
  return md;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const domain = flags.domain;
  if (!domain) {
    console.error('Usage: npx tsx scripts/compute-proven-ceiling.ts --domain <domain>');
    process.exit(1);
  }

  const env = loadEnv();
  const sb = createSb(env);
  const audit = await resolveAuditByDomain(sb, domain);
  console.log(`\n=== Proven ceiling: ${domain} (audit ${audit.id}) ===\n`);

  const keywords = await fetchAll<CeilingKeyword>(
    sb,
    'audit_keywords',
    'keyword, rank_pos, keyword_difficulty, canonical_key, canonical_topic, is_brand',
    (q) => q.eq('audit_id', audit.id),
  );
  console.log(`  ${keywords.length} keywords fetched`);

  const result = computeProvenCeiling(keywords);

  console.log(`  Owned (pos 1-7, non-brand): ${result.owned_count} (${result.owned_with_kd_count} with KD)`);
  if (result.cold_start) {
    console.log(`  COLD START — fewer than ${COLD_START_MIN_OWNED} owned keywords; no empirical ceiling (use DR prior).`);
  } else if (result.site_ceiling !== null) {
    console.log(`  Site ceiling: KD ${result.site_ceiling} (example: "${result.site_ceiling_example?.keyword}")`);
  } else {
    console.log(`  Site ceiling: n/a (fewer than 2 owned keywords with KD)`);
  }
  for (const c of result.cluster_ceilings) {
    const label = c.ceiling !== null ? `KD ${c.ceiling}` : 'fallback→site';
    console.log(`    ${c.canonical_key}: ${label} (${c.owned_with_kd} owned w/ KD)`);
  }

  const artifact = { domain, audit_id: audit.id, generated_at: todayStr(), ...result };
  const jsonPath = writeAnalysisArtifact(domain, 'proven_ceiling', artifact, buildMarkdown(domain, result));
  console.log(`\n  Written: ${jsonPath} (+ .md)\n`);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}\n`);
  process.exit(1);
});
