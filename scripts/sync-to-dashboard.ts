#!/usr/bin/env npx tsx
/**
 * sync-to-dashboard.ts — Sync NanoClaw agent outputs to the Market Position Dashboard (Supabase).
 *
 * Usage:
 *   npx tsx scripts/sync-to-dashboard.ts --domain veteransplumbingcorp.com --user-email you@example.com
 *   npx tsx scripts/sync-to-dashboard.ts --domain veteransplumbingcorp.com --user-email you@example.com --skip-keywords
 *   npx tsx scripts/sync-to-dashboard.ts --domain veteransplumbingcorp.com --user-email you@example.com --agents jim,dwight
 *
 * Environment variables (from .env):
 *   SUPABASE_URL            — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Service role key (bypasses RLS)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { parse as csvParse } from 'csv-parse/sync';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================================
// CLI argument parsing
// ============================================================

interface CliArgs {
  domain: string;
  userEmail: string;
  skipKeywords: boolean;
  agents: string[]; // empty = all available
  date?: string; // YYYY-MM-DD override, else latest
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

  if (!flags.domain || !flags['user-email']) {
    console.error('Usage: npx tsx scripts/sync-to-dashboard.ts --domain <domain> --user-email <email> [--skip-keywords] [--agents jim,dwight,michael,pam] [--date YYYY-MM-DD]');
    process.exit(1);
  }

  return {
    domain: flags.domain,
    userEmail: flags['user-email'],
    skipKeywords: flags['skip-keywords'] === 'true',
    agents: flags.agents ? flags.agents.split(',').map((a) => a.trim()) : [],
    date: flags.date,
  };
}

// ============================================================
// .env loader (reuse nanoclaw pattern — never touch process.env)
// ============================================================

function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return {};
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

// ============================================================
// Directory helpers
// ============================================================

const AUDITS_BASE = path.resolve(process.cwd(), 'audits');

function getLatestDateDir(agentDir: string): string | null {
  if (!fs.existsSync(agentDir)) return null;
  const entries = fs.readdirSync(agentDir).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)).sort();
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

function agentDir(domain: string, agentRole: string, date?: string): string | null {
  const base = path.join(AUDITS_BASE, domain, agentRole);
  const dateStr = date ?? getLatestDateDir(base);
  if (!dateStr) return null;
  const full = path.join(base, dateStr);
  return fs.existsSync(full) ? full : null;
}

// ============================================================
// Snapshot versioning helpers
// ============================================================

async function getNextSnapshotVersion(sb: SupabaseClient, auditId: string, agentName: string): Promise<number> {
  const { data } = await sb
    .from('audit_snapshots')
    .select('snapshot_version')
    .eq('audit_id', auditId)
    .eq('agent_name', agentName)
    .order('snapshot_version', { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data as any)?.snapshot_version ?? 0) + 1;
}

async function recordSnapshot(
  sb: SupabaseClient,
  auditId: string,
  agentName: string,
  snapshotVersion: number,
  agentRunId: string | null,
  rowCount: number
): Promise<void> {
  await sb.from('audit_snapshots').insert({
    audit_id: auditId,
    agent_name: agentName,
    snapshot_version: snapshotVersion,
    agent_run_id: agentRunId,
    row_count: rowCount,
  });
}

async function updateStalenessTimestamp(sb: SupabaseClient, auditId: string, agentName: string): Promise<void> {
  const columnMap: Record<string, string> = {
    jim: 'research_snapshot_at',
    dwight: 'audit_snapshot_at',
    michael: 'strategy_snapshot_at',
    pam: 'execution_snapshot_at',
  };
  const col = columnMap[agentName];
  if (!col) return;
  await sb.from('audits').update({ [col]: new Date().toISOString() }).eq('id', auditId);
}

// ============================================================
// CTR + Revenue formula (ported from run-audit/index.ts)
// ============================================================

interface CtrBuckets {
  [key: string]: number;
}

function getBucketKey(position: number): string {
  if (position === 1) return '1';
  if (position === 2) return '2';
  if (position === 3) return '3';
  if (position >= 4 && position <= 5) return '4-5';
  if (position >= 6 && position <= 10) return '6-10';
  if (position >= 11 && position <= 20) return '11-20';
  if (position >= 21 && position <= 30) return '21-30';
  return '>30';
}

function getCtrForPosition(position: number, buckets: CtrBuckets, floorCtr: number): number {
  const key = getBucketKey(position);
  return buckets[key] ?? floorCtr;
}

function calculateKeywordOpportunity(
  keyword: { rank_pos: number; search_volume: number },
  targetCtr: number,
  ctrBuckets: CtrBuckets,
  floorCtr: number,
  crMin: number,
  crMax: number,
  acvMin: number,
  acvMax: number
) {
  const currentCtr = getCtrForPosition(keyword.rank_pos, ctrBuckets, floorCtr);
  const currentTraffic = keyword.search_volume * currentCtr;
  const targetTraffic = keyword.search_volume * targetCtr;
  const deltaTraffic = Math.max(0, targetTraffic - currentTraffic);

  return {
    current_ctr: currentCtr,
    current_traffic: currentTraffic,
    target_ctr: targetCtr,
    target_traffic: targetTraffic,
    delta_traffic: deltaTraffic,
    delta_leads_low: deltaTraffic * crMin,
    delta_leads_high: deltaTraffic * crMax,
    delta_revenue_low: deltaTraffic * crMin * acvMin,
    delta_revenue_high: deltaTraffic * crMax * acvMax,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============================================================
// Jim research_summary.md parser
// ============================================================

interface ParsedResearchSummary {
  keywordOverview: {
    total_keywords: number;
    total_volume: number;
    avg_position: number;
    etv: number;
    paid_traffic_equivalent: number;
    top_10_count: number;
    near_miss_count: number;
    api_cost: number;
  };
  positionDistribution: Array<{ range: string; count: number; pct: number }>;
  brandedSplit: {
    branded: { count: number; volume: number; avg_position: number };
    non_branded: { count: number; volume: number; avg_position: number };
  };
  intentBreakdown: Array<{ intent: string; count: number; volume: number; pct_volume: number }>;
  topRankingUrls: Array<{ url: string; keywords: number; volume: number }>;
  competitorAnalysis: Array<{
    rank: number;
    domain: string;
    overlap_pct: number;
    shared_keywords: number;
    total_keywords: number;
    avg_position: number;
    etv: number;
  }>;
  competitorSummary: {
    veterans_keywords: number;
    veterans_avg_position: number;
    veterans_etv: number;
    competitor_avg_keywords: number;
    competitor_avg_position: number;
    competitor_avg_etv: number;
  };
  strikingDistance: Array<{
    keyword: string;
    volume: number;
    position: number;
    cpc: number | null;
    intent: string;
  }>;
  contentGapObservations: string[];
  keyTakeaways: Array<{ section: string; takeaway: string }>;
}

function parseResearchSummary(filePath: string): ParsedResearchSummary {
  const md = fs.readFileSync(filePath, 'utf-8');

  const result: ParsedResearchSummary = {
    keywordOverview: {
      total_keywords: 0, total_volume: 0, avg_position: 0,
      etv: 0, paid_traffic_equivalent: 0, top_10_count: 0,
      near_miss_count: 0, api_cost: 0,
    },
    positionDistribution: [],
    brandedSplit: {
      branded: { count: 0, volume: 0, avg_position: 0 },
      non_branded: { count: 0, volume: 0, avg_position: 0 },
    },
    intentBreakdown: [],
    topRankingUrls: [],
    competitorAnalysis: [],
    competitorSummary: {
      veterans_keywords: 0, veterans_avg_position: 0, veterans_etv: 0,
      competitor_avg_keywords: 0, competitor_avg_position: 0, competitor_avg_etv: 0,
    },
    strikingDistance: [],
    contentGapObservations: [],
    keyTakeaways: [],
  };

  // --- Keyword Overview ---
  const overviewTable = md.match(
    /##\s*1\.\s*Keyword\s+Overview[\s\S]*?\n(\|.+\|[\s\S]*?)(?=\n###|\n##\s|$)/i
  );
  if (overviewTable) {
    const rows = overviewTable[1];
    const extract = (label: string): number => {
      const m = rows.match(new RegExp(`\\|\\s*${label}\\s*\\|\\s*([\\d,./$]+)`, 'i'));
      if (!m) return 0;
      return parseFloat(m[1].replace(/[$,/mo]/g, '')) || 0;
    };
    result.keywordOverview.total_keywords = extract('Total ranked keywords');
    result.keywordOverview.total_volume = extract('Total search volume');
    result.keywordOverview.avg_position = extract('Average position');
    result.keywordOverview.etv = extract('Estimated traffic value');
    result.keywordOverview.paid_traffic_equivalent = extract('Estimated paid traffic');
  }

  const costMatch = md.match(/\*\*API Cost:\*\*\s*\$([\d.]+)/i);
  if (costMatch) result.keywordOverview.api_cost = parseFloat(costMatch[1]);

  // --- Position Distribution ---
  const posDist = md.match(
    /###\s*Position\s+Distribution[\s\S]*?\n(\|.+\|[\s\S]*?)(?=\n\*\*|\n###|\n##\s|$)/i
  );
  if (posDist) {
    const rows = posDist[1].matchAll(
      /\|\s*([\d\-+]+)\s*\|\s*(\d+)\s*\|\s*([\d.]+)%\s*\|/g
    );
    for (const row of rows) {
      result.positionDistribution.push({
        range: row[1].trim(),
        count: parseInt(row[2], 10),
        pct: parseFloat(row[3]),
      });
    }
  }

  // --- Branded vs Non-Branded ---
  const brandedTable = md.match(
    /###\s*Branded\s+vs\s+Non-Branded[\s\S]*?\n(\|.+\|[\s\S]*?)(?=\n\*\*|\n###|\n##\s|$)/i
  );
  if (brandedTable) {
    const bMatch = brandedTable[1].match(
      /\|\s*Branded[^|]*\|\s*(\d+)\s*\|\s*([\d,]+)\/mo\s*\|\s*([\d.]+)\s*\|/i
    );
    if (bMatch) {
      result.brandedSplit.branded = {
        count: parseInt(bMatch[1], 10),
        volume: parseInt(bMatch[2].replace(/,/g, ''), 10),
        avg_position: parseFloat(bMatch[3]),
      };
    }
    const nbMatch = brandedTable[1].match(
      /\|\s*Non-branded\s*\|\s*(\d+)\s*\|\s*([\d,]+)\/mo\s*\|\s*([\d.]+)\s*\|/i
    );
    if (nbMatch) {
      result.brandedSplit.non_branded = {
        count: parseInt(nbMatch[1], 10),
        volume: parseInt(nbMatch[2].replace(/,/g, ''), 10),
        avg_position: parseFloat(nbMatch[3]),
      };
    }
  }

  // --- Intent Breakdown ---
  const intentTable = md.match(
    /##\s*3\.\s*Intent\s+Breakdown[\s\S]*?\n(\|.+\|[\s\S]*?)(?=\n\*\*|\n###|\n##\s|$)/i
  );
  if (intentTable) {
    const rows = intentTable[1].matchAll(
      /\|\s*(Navigational|Commercial|Transactional|Informational)\s*\|\s*(\d+)\s*\|\s*([\d,]+)\s*\|\s*([\d.]+)%\s*\|/gi
    );
    for (const row of rows) {
      result.intentBreakdown.push({
        intent: row[1],
        count: parseInt(row[2], 10),
        volume: parseInt(row[3].replace(/,/g, ''), 10),
        pct_volume: parseFloat(row[4]),
      });
    }
  }

  // --- Top Ranking URLs ---
  const urlTable = md.match(
    /##\s*4\.\s*Top\s+Ranking\s+URLs[\s\S]*?\n(\|.+\|[\s\S]*?)(?=\n\*\*|\n###|\n##\s|$)/i
  );
  if (urlTable) {
    const rows = urlTable[1].matchAll(
      /\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*([\d,]+)\s*\|/g
    );
    for (const row of rows) {
      const url = row[1].trim();
      if (url.startsWith('URL') || url.includes('---')) continue;
      result.topRankingUrls.push({
        url,
        keywords: parseInt(row[2], 10),
        volume: parseInt(row[3].replace(/,/g, ''), 10),
      });
    }
  }

  // --- Competitor Analysis ---
  const compTable = md.match(
    /###\s*Direct\s+Local[\s\S]*?\n(\|.+\|[\s\S]*?)(?=\n###|\n##\s|$)/i
  );
  if (compTable) {
    const rows = compTable[1].matchAll(
      /\|\s*(\d+)\s*\|\s*(\S+)\s*\|\s*([\d.]+)%\s*\|\s*(\d+)\s*\|\s*([\d,]+)\s*\|\s*([\d.]+)\s*\|\s*\$([\d,]+)\s*\|/g
    );
    for (const row of rows) {
      result.competitorAnalysis.push({
        rank: parseInt(row[1], 10),
        domain: row[2].trim(),
        overlap_pct: parseFloat(row[3]),
        shared_keywords: parseInt(row[4], 10),
        total_keywords: parseInt(row[5].replace(/,/g, ''), 10),
        avg_position: parseFloat(row[6]),
        etv: parseInt(row[7].replace(/,/g, ''), 10),
      });
    }
  }

  // Competitor summary table
  const summaryTable = md.match(
    /###\s*Veterans\s+Plumbing\s+Position[\s\S]*?\n(\|.+\|[\s\S]*?)(?=\n###|\n##\s|\nThe site|$)/i
  );
  if (summaryTable) {
    const vetMatch = summaryTable[1].match(
      /\|\s*Veterans\s+Plumbing\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*\$([\d,]+)\s*\|/i
    );
    if (vetMatch) {
      result.competitorSummary.veterans_keywords = parseInt(vetMatch[1], 10);
      result.competitorSummary.veterans_avg_position = parseFloat(vetMatch[2]);
      result.competitorSummary.veterans_etv = parseInt(vetMatch[3].replace(/,/g, ''), 10);
    }
    const compAvg = summaryTable[1].match(
      /\|\s*Competitor\s+Avg[^|]*\|\s*~?([\d,]+)\s*\|\s*~?([\d.]+)\s*\|\s*~?\$([\d,]+)\s*\|/i
    );
    if (compAvg) {
      result.competitorSummary.competitor_avg_keywords = parseInt(compAvg[1].replace(/,/g, ''), 10);
      result.competitorSummary.competitor_avg_position = parseFloat(compAvg[2]);
      result.competitorSummary.competitor_avg_etv = parseInt(compAvg[3].replace(/,/g, ''), 10);
    }
  }

  // --- Striking Distance ---
  const sdTable = md.match(
    /##\s*6\.\s*Striking\s+Distance[\s\S]*?\n(\|.+\|[\s\S]*?)(?=\n\*\*|\n###|\n##\s|$)/i
  );
  if (sdTable) {
    const rows = sdTable[1].matchAll(
      /\|\s*(.+?)\s*\|\s*([\d,]+)\s*\|\s*(\d+)\s*\|\s*\$?([\d.]+|N\/A)\s*\|\s*(\w+)\s*\|/g
    );
    for (const row of rows) {
      const kw = row[1].trim();
      if (kw.startsWith('Keyword') || kw.includes('---')) continue;
      result.strikingDistance.push({
        keyword: kw,
        volume: parseInt(row[2].replace(/,/g, ''), 10),
        position: parseInt(row[3], 10),
        cpc: row[4] === 'N/A' ? null : parseFloat(row[4]),
        intent: row[5].trim(),
      });
    }
  }

  // --- Content Gap Observations ---
  const gapSection = md.match(
    /##\s*8\.\s*Content\s+Gap\s+Observations[\s\S]*?(?=\n##\s|$)/i
  );
  if (gapSection) {
    const observations = gapSection[0].matchAll(
      /\d+\.\s*\*\*(.+?)\*\*\s*(.+?)(?=\n\d+\.|$)/gs
    );
    for (const obs of observations) {
      const title = obs[1].replace(/[:.]$/, '').trim();
      const body = obs[2].trim().split('\n')[0].trim();
      result.contentGapObservations.push(`${title}: ${body}`);
    }
  }

  // --- Key Takeaways ---
  const takeaways = md.matchAll(
    /(?:###?\s*[\d.]*\s*)?(.+?)(?:\n[\s\S]*?)??\*\*Key\s+takeaway:\*\*\s*(.+?)(?=\n\n|\n##|\n\*\*|$)/gi
  );
  for (const t of takeaways) {
    const sectionMatch = t[0].match(/###?\s*([\d.]*\s*.+?)(?:\n|$)/);
    const section = sectionMatch ? sectionMatch[1].replace(/^[\d.]+\s*/, '').trim() : 'General';
    result.keyTakeaways.push({
      section: section.substring(0, 50),
      takeaway: t[2].trim(),
    });
  }

  // Count top-10 keywords
  const top10Section = md.match(
    /###\s*Keywords\s+Currently\s+in\s+the\s+Top\s+10\s*\(only\s+(\d+)\)/i
  );
  if (top10Section) {
    result.keywordOverview.top_10_count = parseInt(top10Section[1], 10);
  }

  return result;
}

// ============================================================
// Jim sync — ranked_keywords.json → audit_keywords + clusters + rollups
// ============================================================

interface RankedKeywordItem {
  keyword_data: {
    keyword: string;
    keyword_info: { search_volume: number; cpc: number | null; competition: number | null };
    search_intent_info?: { main_intent?: string };
  };
  ranked_serp_element: {
    serp_item: { rank_group: number; rank_absolute: number; url: string };
  };
}

function parseRankedKeywords(filePath: string) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const items: RankedKeywordItem[] = raw?.tasks?.[0]?.result?.[0]?.items ?? [];
  return items.map((item) => ({
    keyword: item.keyword_data?.keyword ?? '',
    rank_pos: item.ranked_serp_element?.serp_item?.rank_group ?? 0,
    search_volume: item.keyword_data?.keyword_info?.search_volume ?? 0,
    cpc: item.keyword_data?.keyword_info?.cpc ?? null,
    ranking_url: item.ranked_serp_element?.serp_item?.url ?? null,
    intent: item.keyword_data?.search_intent_info?.main_intent ?? null,
  }));
}

function extractTopic(keyword: string): string {
  const words = keyword.toLowerCase().split(/\s+/);
  const stop = ['near', 'me', 'in', 'the', 'a', 'an', 'best', 'top', 'local', 'cheap', 'affordable'];
  const meaningful = words.filter((w) => w.length > 2 && !stop.includes(w) && !/^\d+$/.test(w));
  return meaningful.slice(0, 3).join(' ') || 'general';
}

async function syncJim(
  sb: SupabaseClient,
  auditId: string,
  domain: string,
  date: string | undefined
) {
  const dir = agentDir(domain, 'research', date);
  if (!dir) {
    console.log('  [jim] No research directory found, skipping');
    return null;
  }

  const kwFile = path.join(dir, 'ranked_keywords.json');
  if (!fs.existsSync(kwFile)) {
    console.log('  [jim] No ranked_keywords.json found, skipping');
    return null;
  }

  console.log(`  [jim] Parsing ${kwFile}`);
  const keywords = parseRankedKeywords(kwFile);
  console.log(`  [jim] Found ${keywords.length} total keywords`);

  // Load assumptions for this audit
  const { data: assumptions } = await sb
    .from('audit_assumptions')
    .select('*')
    .eq('audit_id', auditId)
    .maybeSingle();

  if (!assumptions) {
    console.log('  [jim] No audit_assumptions found — cannot calculate revenue. Skipping keyword sync.');
    return null;
  }

  // Load CTR model
  const { data: ctrModel } = await sb
    .from('ctr_models')
    .select('*')
    .eq('id', assumptions.ctr_model_id)
    .maybeSingle();

  if (!ctrModel) {
    console.log('  [jim] No CTR model found, skipping');
    return null;
  }

  const ctrBuckets = ctrModel.buckets as CtrBuckets;

  // Near-miss filter
  const nearMiss = keywords.filter(
    (kw) =>
      kw.rank_pos >= assumptions.near_miss_min_pos &&
      kw.rank_pos <= assumptions.near_miss_max_pos &&
      kw.search_volume >= assumptions.min_volume
  );

  console.log(`  [jim] ${nearMiss.length} near-miss keywords (pos ${assumptions.near_miss_min_pos}-${assumptions.near_miss_max_pos}, vol >= ${assumptions.min_volume})`);

  // Idempotency: clear prior keyword/cluster/rollup data
  await sb.from('audit_keywords').delete().eq('audit_id', auditId);
  await sb.from('audit_clusters').delete().eq('audit_id', auditId);
  await sb.from('audit_rollups').delete().eq('audit_id', auditId);

  // Insert ALL keyword records with segment flags
  const allKeywordRecords = keywords.map((kw) => {
    const isNearMiss =
      kw.rank_pos >= assumptions.near_miss_min_pos &&
      kw.rank_pos <= assumptions.near_miss_max_pos &&
      kw.search_volume >= assumptions.min_volume;
    const isTop10 = kw.rank_pos >= 1 && kw.rank_pos <= 10;
    const isStrikingDistance = kw.rank_pos >= 11 && kw.rank_pos <= 20;

    // Only calculate revenue opportunity for near-miss keywords
    const opp = isNearMiss
      ? calculateKeywordOpportunity(
          kw,
          assumptions.target_ctr,
          ctrBuckets,
          assumptions.floor_ctr_over30,
          assumptions.cr_used_min,
          assumptions.cr_used_max,
          assumptions.acv_used_min,
          assumptions.acv_used_max
        )
      : {
          current_ctr: getCtrForPosition(kw.rank_pos, ctrBuckets, assumptions.floor_ctr_over30),
          current_traffic: kw.search_volume * getCtrForPosition(kw.rank_pos, ctrBuckets, assumptions.floor_ctr_over30),
          target_ctr: assumptions.target_ctr,
          target_traffic: 0,
          delta_traffic: 0,
          delta_leads_low: 0,
          delta_leads_high: 0,
          delta_revenue_low: 0,
          delta_revenue_high: 0,
        };

    return {
      audit_id: auditId,
      keyword: kw.keyword,
      rank_pos: kw.rank_pos,
      search_volume: kw.search_volume,
      cpc: kw.cpc,
      ranking_url: kw.ranking_url,
      intent: kw.intent,
      topic: extractTopic(kw.keyword),
      is_near_miss: isNearMiss,
      is_top_10: isTop10,
      is_striking_distance: isStrikingDistance,
      ...opp,
    };
  });

  if (allKeywordRecords.length > 0) {
    // Batch insert (Supabase limit is ~1000 per call)
    for (let i = 0; i < allKeywordRecords.length; i += 500) {
      const batch = allKeywordRecords.slice(i, i + 500);
      const { error } = await sb.from('audit_keywords').insert(batch);
      if (error) throw new Error(`keyword insert failed: ${error.message}`);
    }
    console.log(`  [jim] Inserted ${allKeywordRecords.length} keywords (${nearMiss.length} near-miss)`);
  }

  // Canonicalize keywords (uses DB function)
  const { error: canonErr } = await sb.rpc('fn_canonicalize_audit_keywords', { p_audit_id: auditId });
  if (canonErr) {
    console.log(`  [jim] Canonicalization RPC failed: ${canonErr.message} — using legacy topics`);
  }

  // Pull back keywords for clustering (only near-miss for revenue calculations)
  const { data: kwRows } = await sb
    .from('audit_keywords')
    .select('keyword, rank_pos, search_volume, cpc, delta_traffic, delta_revenue_low, delta_revenue_high, delta_leads_low, delta_leads_high, canonical_key, canonical_topic, intent_type, intent, is_brand, is_near_miss, topic')
    .eq('audit_id', auditId)
    .eq('is_near_miss', true);

  // Cluster by canonical_key (or fall back to legacy topic)
  const CONSERVATIVE_CR = 0.15;
  const CONSERVATIVE_ACV = 500;

  type ClusterAgg = {
    topic: string;
    positions: number[];
    keywords: string[];
    revLow: number;
    revHigh: number;
    leadsLow: number;
    leadsHigh: number;
    conservativeRev: number;
    volMax: number;
    kwTotal: number;
    kwEligible: number;
  };

  const clusterMap = new Map<string, ClusterAgg>();

  for (const r of (kwRows ?? []) as any[]) {
    const key = r.canonical_key ?? r.topic ?? 'general';
    const topic = r.canonical_topic ?? r.topic ?? key;
    const vol = Number(r.search_volume ?? 0);
    const pos = Number(r.rank_pos ?? 0);
    const intent = String(r.intent_type ?? r.intent ?? r.topic ?? '').toLowerCase();
    const isBrand = r.is_brand === true;
    const eligible = !isBrand && (intent === 'commercial' || intent === 'transactional');
    const deltaTraffic = Number(r.delta_traffic ?? 0);

    const existing = clusterMap.get(key);
    if (existing) {
      existing.positions.push(pos);
      existing.keywords.push(r.keyword);
      if (eligible) {
        existing.revLow += Number(r.delta_revenue_low ?? 0);
        existing.revHigh += Number(r.delta_revenue_high ?? 0);
        existing.leadsLow += Number(r.delta_leads_low ?? 0);
        existing.leadsHigh += Number(r.delta_leads_high ?? 0);
        existing.conservativeRev += deltaTraffic * CONSERVATIVE_CR * CONSERVATIVE_ACV;
        existing.kwEligible++;
      }
      existing.volMax = Math.max(existing.volMax, vol);
      existing.kwTotal++;
    } else {
      clusterMap.set(key, {
        topic,
        positions: [pos],
        keywords: [r.keyword],
        revLow: eligible ? Number(r.delta_revenue_low ?? 0) : 0,
        revHigh: eligible ? Number(r.delta_revenue_high ?? 0) : 0,
        leadsLow: eligible ? Number(r.delta_leads_low ?? 0) : 0,
        leadsHigh: eligible ? Number(r.delta_leads_high ?? 0) : 0,
        conservativeRev: eligible ? deltaTraffic * CONSERVATIVE_CR * CONSERVATIVE_ACV : 0,
        volMax: vol,
        kwTotal: 1,
        kwEligible: eligible ? 1 : 0,
      });
    }
  }

  const clusterRecords = Array.from(clusterMap.entries())
    .sort((a, b) => b[1].revHigh - a[1].revHigh)
    .map(([, c]) => {
      const minPos = Math.min(...c.positions);
      const maxPos = Math.max(...c.positions);
      return {
        audit_id: auditId,
        topic: c.topic,
        near_miss_positions: minPos === maxPos ? `${minPos}` : `${minPos}-${maxPos}`,
        total_volume: c.volMax,
        est_new_leads_low: round2(c.leadsLow),
        est_new_leads_high: round2(c.leadsHigh),
        est_revenue_low: round2(c.revLow),
        est_revenue_high: round2(c.revHigh),
        sample_keywords: c.keywords.slice(0, 5),
      };
    });

  if (clusterRecords.length > 0) {
    const { error } = await sb.from('audit_clusters').insert(clusterRecords);
    if (error) throw new Error(`cluster insert failed: ${error.message}`);
    console.log(`  [jim] Inserted ${clusterRecords.length} clusters`);
  }

  // Rollup
  const totalVol = clusterRecords.reduce((s, c) => s + c.total_volume, 0);
  const totalRevLow = clusterRecords.reduce((s, c) => s + c.est_revenue_low, 0);
  const totalRevHigh = clusterRecords.reduce((s, c) => s + c.est_revenue_high, 0);
  const totalConservative = Array.from(clusterMap.values()).reduce((s, c) => s + c.conservativeRev, 0);

  const { error: rollupErr } = await sb.from('audit_rollups').insert({
    audit_id: auditId,
    total_volume_analyzed: totalVol,
    near_miss_keyword_count: nearMiss.length,
    opportunity_topics_count: clusterRecords.length,
    monthly_revenue_low: round2(totalRevLow),
    monthly_revenue_high: round2(totalRevHigh),
    monthly_revenue_conservative: round2(totalConservative),
  });
  if (rollupErr) throw new Error(`rollup insert failed: ${rollupErr.message}`);

  console.log(`  [jim] Revenue range: $${round2(totalRevLow)} – $${round2(totalRevHigh)}/mo`);

  // Parse research_summary.md for site-level findings
  const summaryFile = path.join(dir, 'research_summary.md');
  let parsedSummary: ParsedResearchSummary | null = null;
  if (fs.existsSync(summaryFile)) {
    console.log(`  [jim] Parsing ${summaryFile} for site-level findings`);
    parsedSummary = parseResearchSummary(summaryFile);
    console.log(`  [jim] Extracted: ${parsedSummary.keywordOverview.total_keywords} total keywords, ${parsedSummary.competitorAnalysis.length} competitors, ${parsedSummary.strikingDistance.length} striking distance, ${parsedSummary.contentGapObservations.length} content gaps`);
  } else {
    console.log(`  [jim] No research_summary.md found — site-level findings will be empty`);
  }

  // Snapshot versioning
  const snapshotVersion = await getNextSnapshotVersion(sb, auditId, 'jim');

  // Create agent_runs record
  const runDate = date ?? getLatestDateDir(path.join(AUDITS_BASE, domain, 'research')) ?? new Date().toISOString().slice(0, 10);
  const { data: run } = await sb.from('agent_runs').insert({
    audit_id: auditId,
    agent_name: 'jim',
    run_date: runDate,
    status: 'completed',
    source_path: path.relative(AUDITS_BASE, dir),
    snapshot_version: snapshotVersion,
    metadata: { keyword_count: keywords.length, near_miss_count: nearMiss.length },
  }).select('id').single();

  const agentRunId = run?.id ?? null;

  // Record snapshot with site-level findings (direct insert, same pattern as Dwight)
  await sb.from('audit_snapshots').insert({
    audit_id: auditId,
    agent_name: 'jim',
    snapshot_version: snapshotVersion,
    agent_run_id: agentRunId,
    row_count: allKeywordRecords.length,
    // Site-level findings from research_summary.md
    research_summary_markdown: parsedSummary ? fs.readFileSync(summaryFile, 'utf-8') : null,
    keyword_overview: parsedSummary?.keywordOverview ?? {},
    position_distribution: parsedSummary?.positionDistribution ?? [],
    branded_split: parsedSummary?.brandedSplit ?? {},
    intent_breakdown: parsedSummary?.intentBreakdown ?? [],
    top_ranking_urls: parsedSummary?.topRankingUrls ?? [],
    competitor_analysis: parsedSummary?.competitorAnalysis ?? [],
    competitor_summary: parsedSummary?.competitorSummary ?? {},
    striking_distance: parsedSummary?.strikingDistance ?? [],
    content_gap_observations: parsedSummary?.contentGapObservations ?? [],
    key_takeaways: parsedSummary?.keyTakeaways ?? [],
  });

  // Update staleness timestamp
  await updateStalenessTimestamp(sb, auditId, 'jim');

  // Baseline snapshot capture (first sync only)
  const { count: baselineCount } = await sb
    .from('baseline_snapshots')
    .select('id', { count: 'exact', head: true })
    .eq('audit_id', auditId);

  if ((baselineCount ?? 0) === 0 && nearMiss.length > 0) {
    const baselineRecords = nearMiss.map((kw) => ({
      audit_id: auditId,
      keyword: kw.keyword,
      baseline_rank: kw.rank_pos,
      baseline_volume: kw.search_volume,
    }));
    for (let i = 0; i < baselineRecords.length; i += 500) {
      const batch = baselineRecords.slice(i, i + 500);
      await sb.from('baseline_snapshots').upsert(batch, { onConflict: 'audit_id,keyword' });
    }
    console.log(`  [jim] Captured ${baselineRecords.length} baseline snapshots`);
  }

  return agentRunId;
}

// ============================================================
// Dwight AUDIT_REPORT.md parser
// ============================================================

interface ParsedAuditReport {
  executiveSummary: string;
  prioritizedFixes: Array<{
    number: number;
    issue: string;
    affected_pages: string;
    fix: string;
    priority_tier: number;
    priority_label: string;
  }>;
  agenticReadiness: Array<{
    signal: string;
    status: string;
    weight: string;
  }>;
  structuredDataIssues: Array<{
    issue: string;
    description: string;
    severity: string;
  }>;
  headingIssues: Array<{
    url: string;
    issue_type: string;
    details: string;
  }>;
  securityIssues: Array<{
    issue: string;
    affected_pages: string;
    fix: string;
  }>;
  platformNotes: string;
  siteMetadata: Record<string, string>;
}

function parseAuditReport(filePath: string): ParsedAuditReport {
  const md = fs.readFileSync(filePath, 'utf-8');

  const result: ParsedAuditReport = {
    executiveSummary: '',
    prioritizedFixes: [],
    agenticReadiness: [],
    structuredDataIssues: [],
    headingIssues: [],
    securityIssues: [],
    platformNotes: '',
    siteMetadata: {},
  };

  // --- Executive Summary ---
  const execMatch = md.match(/##\s*Executive\s+Summary\s*\n([\s\S]*?)(?=\n---|\n##\s)/i);
  if (execMatch) {
    result.executiveSummary = execMatch[1].trim();
  }

  // --- Prioritized Fix List ---
  const prioritySections = md.matchAll(
    /###\s*Priority\s*(\d+)\s*[—–-]\s*(.+?)(?:\n|\r\n)([\s\S]*?)(?=###\s*Priority|\n##\s|$)/gi
  );
  for (const section of prioritySections) {
    const tier = parseInt(section[1], 10);
    const label = section[2].trim().replace(/\(.+\)/, '').trim();
    const body = section[3];

    const tableRows = body.matchAll(
      /\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/g
    );
    for (const row of tableRows) {
      const num = parseInt(row[1], 10);
      if (isNaN(num)) continue;
      result.prioritizedFixes.push({
        number: num,
        issue: row[2].trim(),
        affected_pages: row[3].trim(),
        fix: row[4].trim(),
        priority_tier: tier,
        priority_label: label,
      });
    }
  }

  // --- Agentic Readiness Scorecard ---
  const agenticMatch = md.match(
    /###\s*10\.4\s*Agentic\s+Readiness\s+Score[\s\S]*?\n(\|.+\|[\s\S]*?)(?=\n\*\*|\n---|\n##\s|$)/i
  );
  if (agenticMatch) {
    const tableBlock = agenticMatch[1];
    const rows = tableBlock.matchAll(
      /\|\s*(.+?)\s*\|\s*(PASS|FAIL)\s*\|\s*(.+?)\s*\|/gi
    );
    for (const row of rows) {
      result.agenticReadiness.push({
        signal: row[1].trim(),
        status: row[2].trim().toUpperCase(),
        weight: row[3].trim(),
      });
    }
  }

  // --- Structured Data Issues ---
  const schemaSection = md.match(
    /##\s*Section\s*6:\s*Structured\s+Data[\s\S]*?(?=\n##\s)/i
  );
  if (schemaSection) {
    const issueBlocks = schemaSection[0].matchAll(
      /\*\*Issue\s*(\d+):\s*(.+?)\*\*\s*\n([\s\S]*?)(?=\*\*Issue|\n---|\n##|$)/gi
    );
    for (const block of issueBlocks) {
      const desc = block[3].trim().split('\n')[0].trim();
      result.structuredDataIssues.push({
        issue: block[2].trim(),
        description: desc,
        severity: 'critical',
      });
    }
  }

  // --- Heading Issues ---
  const missingH1Match = md.match(
    /###\s*5\.1\s*Missing\s+H1[\s\S]*?\n(\|.+\|[\s\S]*?)(?=\n###|\n##\s|$)/i
  );
  if (missingH1Match) {
    const rows = missingH1Match[1].matchAll(/\|\s*(\/.+?)\s*\|\s*(.+?)\s*\|/g);
    for (const row of rows) {
      if (row[1].includes('---')) continue;
      result.headingIssues.push({
        url: row[1].trim(),
        issue_type: 'missing_h1',
        details: row[2].trim(),
      });
    }
  }

  const multiH1Match = md.match(
    /###\s*5\.2\s*Multiple\s+H1[\s\S]*?\n(\|.+\|[\s\S]*?)(?=\n###|\n##\s|$)/i
  );
  if (multiH1Match) {
    const rows = multiH1Match[1].matchAll(
      /\|\s*(\/.+?)\s*\|\s*"?(.+?)"?\s*\|\s*"?(.+?)"?\s*\|/g
    );
    for (const row of rows) {
      if (row[1].includes('---')) continue;
      result.headingIssues.push({
        url: row[1].trim(),
        issue_type: 'multiple_h1',
        details: `H1-1: ${row[2].trim()}, H1-2: ${row[3].trim()}`,
      });
    }
  }

  // --- Security Issues ---
  const secSection = md.match(
    /##\s*Section\s*9:\s*Security[\s\S]*?(?=\n##\s)/i
  );
  if (secSection) {
    const crossOrigin = secSection[0].match(
      /###\s*9\.1[\s\S]*?\*\*Fix:\*\*\s*(.+?)(?:\n|$)/i
    );
    if (crossOrigin) {
      result.securityIssues.push({
        issue: 'Unsafe cross-origin HTTP link without rel="noopener"',
        affected_pages: 'Sitewide (all pages)',
        fix: crossOrigin[1].trim(),
      });
    }

    const refPolicy = secSection[0].match(
      /###\s*9\.2[\s\S]*?Recommendation:\s*(.+?)(?:\n|$)/i
    );
    if (refPolicy) {
      result.securityIssues.push({
        issue: 'Missing Referrer-Policy header',
        affected_pages: 'Sitewide (all pages)',
        fix: refPolicy[1].trim(),
      });
    }

    const ext4xx = secSection[0].match(/###\s*9\.3[\s\S]*?(?=\n###|\n##|$)/i);
    if (ext4xx && ext4xx[0].includes('406')) {
      result.securityIssues.push({
        issue: 'Broken external link (406 Not Acceptable)',
        affected_pages: '/privacy-policy',
        fix: 'Update or remove the link to support.mozilla.org',
      });
    }
  }

  // --- Platform Notes ---
  const platformMatch = md.match(
    /##\s*Section\s*11:\s*Platform[\s\S]*?(?=\n##\s|\n---\s*\n##|$)/i
  );
  if (platformMatch) {
    result.platformNotes = platformMatch[0]
      .replace(/##\s*Section\s*11:\s*Platform\s*Observations\s*\n*/i, '')
      .trim();
  }

  // --- Site Metadata ---
  const toolMatch = md.match(/\*\*Tool:\*\*\s*(.+)/i);
  const dateMatch = md.match(/\*\*Audit Date:\*\*\s*(.+)/i);
  const scopeMatch = md.match(/\*\*Crawl Scope:\*\*\s*(.+)/i);

  result.siteMetadata = {
    crawl_tool: toolMatch?.[1]?.trim() ?? '',
    crawl_date: dateMatch?.[1]?.trim() ?? '',
    crawl_scope: scopeMatch?.[1]?.trim() ?? '',
    platform_detected: result.platformNotes.includes('DudaSite') ? 'DudaSite' : '',
  };

  const passing = result.agenticReadiness.filter((a) => a.status === 'PASS').length;
  const total = result.agenticReadiness.length;
  if (total > 0) {
    const WEIGHT_POINTS: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
    let earned = 0, maxPts = 0;
    for (const a of result.agenticReadiness) {
      const pts = WEIGHT_POINTS[a.weight] ?? 1;
      maxPts += pts;
      if (a.status === 'PASS') earned += pts;
    }
    const pct = maxPts > 0 ? Math.round((earned / maxPts) * 100) : 0;
    result.siteMetadata.agentic_readiness_score = `${pct}%`;
    result.siteMetadata.agentic_readiness_raw = `${passing}/${total}`;
    result.siteMetadata.agentic_readiness_points = `${earned}/${maxPts}`;
  }

  return result;
}

// ============================================================
// Dwight sync — internal_all.csv → agent_technical_pages
// ============================================================

const NEAR_DUP_THRESHOLD = 0.90;

async function syncDwight(
  sb: SupabaseClient,
  auditId: string,
  domain: string,
  date: string | undefined
) {
  const dir = agentDir(domain, 'auditor', date);
  if (!dir) {
    console.log('  [dwight] No auditor directory found, skipping');
    return null;
  }

  const csvFile = path.join(dir, 'internal_all.csv');
  if (!fs.existsSync(csvFile)) {
    console.log('  [dwight] No internal_all.csv found, skipping');
    return null;
  }

  console.log(`  [dwight] Parsing ${csvFile}`);
  let csvContent = fs.readFileSync(csvFile, 'utf-8');
  // Strip UTF-8 BOM if present (Screaming Frog exports include it)
  if (csvContent.charCodeAt(0) === 0xfeff) {
    csvContent = csvContent.slice(1);
  }
  const rows: Record<string, string>[] = csvParse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  // Clear prior technical pages for this audit
  await sb.from('agent_technical_pages').delete().eq('audit_id', auditId);

  const runDate = date ?? getLatestDateDir(path.join(AUDITS_BASE, domain, 'auditor')) ?? new Date().toISOString().slice(0, 10);

  // Create agent run record
  const { data: run } = await sb.from('agent_runs').insert({
    audit_id: auditId,
    agent_name: 'dwight',
    run_date: runDate,
    status: 'completed',
    source_path: path.relative(AUDITS_BASE, dir),
    metadata: { page_count: rows.length },
  }).select('id').single();

  const agentRunId = run?.id ?? null;

  // Load semantically_similar_report.csv if it exists (supplements internal_all.csv)
  const semReportFile = path.join(dir, 'semantically_similar_report.csv');
  const semMap = new Map<string, { closestUrl: string; score: number }>();
  if (fs.existsSync(semReportFile)) {
    let semCsv = fs.readFileSync(semReportFile, 'utf-8');
    if (semCsv.charCodeAt(0) === 0xfeff) semCsv = semCsv.slice(1);
    const semRows: Record<string, string>[] = csvParse(semCsv, { columns: true, skip_empty_lines: true, relax_column_count: true });
    for (const sr of semRows) {
      const addr = sr['Address'] || '';
      const closest = sr['Closest Semantically Similar Address'] || '';
      const score = parseFloat(sr['Semantic Similarity Score'] || '0') || 0;
      if (addr && score > 0) {
        semMap.set(addr, { closestUrl: closest, score });
      }
    }
    if (semMap.size > 0) console.log(`  [dwight] Loaded ${semMap.size} semantic pairs from report`);
  }

  // Filter to HTML pages only
  const htmlRows = rows.filter((r) => {
    const ct = r['Content Type'] ?? '';
    return ct.includes('text/html') || ct === '';
  });

  const pageRecords = htmlRows.map((r) => {
    const url = r['Address'] ?? '';
    // Try inline columns first, fall back to semantic report
    let semScore = parseFloat(r['Semantic Similarity Score'] || '0') || null;
    let semUrl = r['Closest Semantically Similar Address'] || null;
    if (!semScore && semMap.has(url)) {
      const entry = semMap.get(url)!;
      semScore = entry.score;
      semUrl = entry.closestUrl;
    }
    let semanticFlag: string | null = null;
    if (semScore && semScore >= NEAR_DUP_THRESHOLD) {
      semanticFlag = 'NEAR-DUP';
    }

    // Build crawl_data with remaining useful columns
    const crawlData: Record<string, string | number | null> = {};
    const knownCols = new Set([
      'Address', 'Content Type', 'Status Code', 'Status', 'Indexability',
      'Title 1', 'H1-1', 'Meta Description 1', 'Word Count', 'Crawl Depth',
      'Inlinks', 'Outlinks', 'Closest Semantically Similar Address',
      'Semantic Similarity Score',
    ]);
    for (const [key, val] of Object.entries(r)) {
      if (!knownCols.has(key) && val) crawlData[key] = val;
    }

    return {
      audit_id: auditId,
      agent_run_id: agentRunId,
      url: r['Address'] ?? '',
      status_code: parseInt(r['Status Code'] || '0', 10) || null,
      word_count: parseInt(r['Word Count'] || '0', 10) || null,
      title: r['Title 1'] || null,
      h1: r['H1-1'] || null,
      meta_description: r['Meta Description 1'] || null,
      depth: parseInt(r['Crawl Depth'] || '0', 10) || null,
      indexability: r['Indexability'] || null,
      inlinks_count: parseInt(r['Inlinks'] || '0', 10) || null,
      outlinks_count: parseInt(r['Outlinks'] || '0', 10) || null,
      semantic_closest_url: semUrl,
      semantic_similarity_score: semScore,
      semantic_flag: semanticFlag,
      crawl_data: crawlData,
    };
  });

  if (pageRecords.length > 0) {
    for (let i = 0; i < pageRecords.length; i += 500) {
      const batch = pageRecords.slice(i, i + 500);
      const { error } = await sb.from('agent_technical_pages').insert(batch);
      if (error) throw new Error(`technical pages insert failed: ${error.message}`);
    }
    console.log(`  [dwight] Inserted ${pageRecords.length} technical pages`);
  }

  const flagged = pageRecords.filter((p) => p.semantic_flag);
  console.log(`  [dwight] ${flagged.length} pages with semantic flags`);

  // Parse AUDIT_REPORT.md for site-level findings
  const reportFile = path.join(dir, 'AUDIT_REPORT.md');
  let parsedReport: ParsedAuditReport | null = null;
  if (fs.existsSync(reportFile)) {
    console.log(`  [dwight] Parsing ${reportFile} for site-level findings`);
    parsedReport = parseAuditReport(reportFile);
    console.log(`  [dwight] Extracted: ${parsedReport.prioritizedFixes.length} fixes, ${parsedReport.agenticReadiness.length} agentic signals, ${parsedReport.structuredDataIssues.length} schema issues, ${parsedReport.headingIssues.length} heading issues, ${parsedReport.securityIssues.length} security issues`);
  } else {
    console.log(`  [dwight] No AUDIT_REPORT.md found — site-level findings will be empty`);
  }

  // Record snapshot with site-level findings and update staleness
  const snapshotVersion = await getNextSnapshotVersion(sb, auditId, 'dwight');
  await sb.from('agent_runs').update({ snapshot_version: snapshotVersion }).eq('id', agentRunId);

  await sb.from('audit_snapshots').insert({
    audit_id: auditId,
    agent_name: 'dwight',
    snapshot_version: snapshotVersion,
    agent_run_id: agentRunId,
    row_count: pageRecords.length,
    executive_summary: parsedReport?.executiveSummary ?? null,
    prioritized_fixes: parsedReport?.prioritizedFixes ?? [],
    agentic_readiness: parsedReport?.agenticReadiness ?? [],
    structured_data_issues: parsedReport?.structuredDataIssues ?? [],
    heading_issues: parsedReport?.headingIssues ?? [],
    security_issues: parsedReport?.securityIssues ?? [],
    platform_notes: parsedReport?.platformNotes ?? null,
    site_metadata: parsedReport?.siteMetadata ?? {},
  });

  await updateStalenessTimestamp(sb, auditId, 'dwight');

  return agentRunId;
}

// ============================================================
// Michael sync — architecture_blueprint.md → agent_architecture_pages + blueprint
// ============================================================

interface ArchPage {
  url_slug: string;
  page_status: string;
  silo_name: string;
  role: string;
  primary_keyword: string;
  primary_keyword_volume: number;
  action_required: string;
}

function parseArchitectureBlueprint(filePath: string): { pages: ArchPage[]; markdown: string; summary: string } {
  const markdown = fs.readFileSync(filePath, 'utf-8');

  // Extract executive summary (first section content after the title)
  let summary = '';
  const summaryMatch = markdown.match(/##\s*Executive\s+Summary\s*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i);
  if (summaryMatch) {
    summary = summaryMatch[1].trim();
  }

  // Parse markdown tables for page assignments
  // Look for tables with columns like: Slug/URL, Status, Silo, Role, Keyword, Volume, Action
  const pages: ArchPage[] = [];
  const tableRegex = /\|(.+)\|\n\|[-\s|:]+\|\n((?:\|.+\|\n?)*)/g;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(markdown)) !== null) {
    const headerLine = match[1];
    const headers = headerLine.split('|').map((h) => h.trim().toLowerCase());

    // Check if this table has page-related columns
    const slugIdx = headers.findIndex((h) => h.includes('slug') || h.includes('url') || h.includes('page') || h.includes('path'));
    const siloIdx = headers.findIndex((h) => h.includes('silo') || h.includes('cluster') || h.includes('topic'));
    if (slugIdx < 0) continue;

    const statusIdx = headers.findIndex((h) => h.includes('status') || h.includes('exists') || h.includes('new'));
    const roleIdx = headers.findIndex((h) => h.includes('role') || h.includes('type'));
    const kwIdx = headers.findIndex((h) => h.includes('keyword') || h.includes('target'));
    const volIdx = headers.findIndex((h) => h.includes('volume') || h.includes('vol'));
    const actionIdx = headers.findIndex((h) => h.includes('action') || h.includes('required') || h.includes('recommendation'));

    const rowLines = match[2].trim().split('\n');
    for (const rowLine of rowLines) {
      const cells = rowLine.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length < 2) continue;

      const slug = cells[slugIdx] ?? '';
      if (!slug || slug.startsWith('-')) continue;

      pages.push({
        url_slug: slug.replace(/^\//, '').replace(/`/g, ''),
        page_status: statusIdx >= 0 ? (cells[statusIdx] ?? '').toLowerCase().replace(/[*`]/g, '') : 'unknown',
        silo_name: siloIdx >= 0 ? (cells[siloIdx] ?? '').replace(/[*`]/g, '') : '',
        role: roleIdx >= 0 ? (cells[roleIdx] ?? '').replace(/[*`]/g, '') : '',
        primary_keyword: kwIdx >= 0 ? (cells[kwIdx] ?? '').replace(/[*`]/g, '') : '',
        primary_keyword_volume: volIdx >= 0 ? parseInt(cells[volIdx] ?? '0', 10) || 0 : 0,
        action_required: actionIdx >= 0 ? (cells[actionIdx] ?? '').toLowerCase().replace(/[*`]/g, '') : '',
      });
    }
  }

  return { pages, markdown, summary };
}

async function syncMichael(
  sb: SupabaseClient,
  auditId: string,
  domain: string,
  date: string | undefined
) {
  const dir = agentDir(domain, 'architecture', date);
  if (!dir) {
    console.log('  [michael] No architecture directory found, skipping');
    return null;
  }

  const blueprintFile = path.join(dir, 'architecture_blueprint.md');
  if (!fs.existsSync(blueprintFile)) {
    console.log('  [michael] No architecture_blueprint.md found, skipping');
    return null;
  }

  console.log(`  [michael] Parsing ${blueprintFile}`);
  const { pages, markdown, summary } = parseArchitectureBlueprint(blueprintFile);
  console.log(`  [michael] Extracted ${pages.length} architecture pages from tables`);

  // Clear prior data
  await sb.from('agent_architecture_pages').delete().eq('audit_id', auditId);
  await sb.from('agent_architecture_blueprint').delete().eq('audit_id', auditId);

  const runDate = date ?? getLatestDateDir(path.join(AUDITS_BASE, domain, 'architecture')) ?? new Date().toISOString().slice(0, 10);

  const { data: run } = await sb.from('agent_runs').insert({
    audit_id: auditId,
    agent_name: 'michael',
    run_date: runDate,
    status: 'completed',
    source_path: path.relative(AUDITS_BASE, dir),
    metadata: { page_count: pages.length, blueprint_size: markdown.length },
  }).select('id').single();

  const agentRunId = run?.id ?? null;

  // Insert pages
  if (pages.length > 0) {
    const pageRecords = pages.map((p) => ({
      audit_id: auditId,
      agent_run_id: agentRunId,
      url_slug: p.url_slug,
      page_status: p.page_status.includes('new') ? 'new' : p.page_status.includes('exist') ? 'exists' : p.page_status,
      silo_name: p.silo_name,
      role: p.role,
      primary_keyword: p.primary_keyword,
      primary_keyword_volume: p.primary_keyword_volume,
      action_required: p.action_required,
    }));
    const { error } = await sb.from('agent_architecture_pages').insert(pageRecords);
    if (error) throw new Error(`architecture pages insert failed: ${error.message}`);
    console.log(`  [michael] Inserted ${pageRecords.length} architecture pages`);
  }

  // Insert blueprint
  const snapshotVersion = await getNextSnapshotVersion(sb, auditId, 'michael');
  const { error: bpErr } = await sb.from('agent_architecture_blueprint').insert({
    audit_id: auditId,
    agent_run_id: agentRunId,
    blueprint_markdown: markdown,
    executive_summary: summary || null,
    snapshot_version: snapshotVersion,
  });
  if (bpErr) throw new Error(`blueprint insert failed: ${bpErr.message}`);
  console.log(`  [michael] Inserted blueprint (${Math.round(markdown.length / 1024)}KB)`);

  // Seed execution_pages with page_brief from architecture pages
  if (pages.length > 0) {
    const execRecords = pages.map((p) => ({
      audit_id: auditId,
      url_slug: p.url_slug,
      silo: p.silo_name || null,
      priority: p.action_required === 'create' ? 1 : p.action_required === 'optimize' ? 2 : p.action_required === 'differentiate' ? 3 : 4,
      status: 'brief_ready',
      page_brief: {
        silo_name: p.silo_name,
        role: p.role,
        primary_keyword: p.primary_keyword,
        primary_keyword_volume: p.primary_keyword_volume,
        action_required: p.action_required,
        page_status: p.page_status,
      },
      snapshot_version: snapshotVersion,
    }));

    // Upsert: if page exists, update page_brief but preserve status and Pam fields
    for (const rec of execRecords) {
      const { data: existing } = await sb
        .from('execution_pages')
        .select('id')
        .eq('audit_id', auditId)
        .eq('url_slug', rec.url_slug)
        .maybeSingle();

      if (existing) {
        await sb.from('execution_pages').update({
          page_brief: rec.page_brief,
          silo: rec.silo,
          priority: rec.priority,
          snapshot_version: rec.snapshot_version,
        }).eq('id', (existing as any).id);
      } else {
        await sb.from('execution_pages').insert(rec);
      }
    }
    console.log(`  [michael] Seeded ${execRecords.length} execution page briefs`);
  }

  // Record snapshot and update staleness
  await sb.from('agent_runs').update({ snapshot_version: snapshotVersion }).eq('id', agentRunId);
  await recordSnapshot(sb, auditId, 'michael', snapshotVersion, agentRunId, pages.length);
  await updateStalenessTimestamp(sb, auditId, 'michael');

  return agentRunId;
}

// ============================================================
// Pam sync — content/{date}/{slug}/metadata.md + schema.json + content_outline.md
// ============================================================

function extractMetadataField(md: string, field: string): string | null {
  // Match patterns like "## Meta Title\n\n**Content**" or "## Meta Title\n\nContent"
  const regex = new RegExp(`##\\s*${field}[\\s\\S]*?\\n\\n([^#]+?)(?=\\n##|\\n#|$)`, 'i');
  const match = md.match(regex);
  if (!match) return null;
  // Clean up: remove markdown formatting, take first meaningful line
  const lines = match[1].trim().split('\n').filter((l) => l.trim());
  for (const line of lines) {
    const cleaned = line.replace(/\*\*/g, '').replace(/`/g, '').trim();
    if (cleaned && !cleaned.startsWith('(') && !cleaned.startsWith('Char') && !cleaned.startsWith('Rationale')) {
      return cleaned;
    }
  }
  return null;
}

function extractWordCountTarget(md: string): number | null {
  // Look for "Estimated Total Word Count" or similar
  const match = md.match(/(?:estimated|target|total)\s+(?:total\s+)?word\s+count[:\s]*(\d[\d,]*)/i);
  if (match) return parseInt(match[1].replace(/,/g, ''), 10);
  // Fallback: sum section word counts from table
  const tableMatch = md.match(/word\s*count.*?\n\|[-\s|]+\n((?:\|.+\n?)*)/i);
  if (tableMatch) {
    const rows = tableMatch[1].trim().split('\n');
    let total = 0;
    for (const row of rows) {
      const nums = row.match(/(\d[\d,]*)/g);
      if (nums) {
        total += parseInt(nums[nums.length - 1].replace(/,/g, ''), 10) || 0;
      }
    }
    if (total > 0) return total;
  }
  return null;
}

async function syncPam(
  sb: SupabaseClient,
  auditId: string,
  domain: string,
  date: string | undefined
) {
  const base = path.join(AUDITS_BASE, domain, 'content');
  const dateStr = date ?? getLatestDateDir(base);
  if (!dateStr) {
    console.log('  [pam] No content directory found, skipping');
    return null;
  }

  const contentDir = path.join(base, dateStr);
  if (!fs.existsSync(contentDir)) {
    console.log('  [pam] Content directory does not exist, skipping');
    return null;
  }

  // Each subdirectory under content/{date}/ is a page slug
  const slugDirs = fs.readdirSync(contentDir).filter((e) => {
    const full = path.join(contentDir, e);
    return fs.statSync(full).isDirectory();
  });

  if (slugDirs.length === 0) {
    console.log('  [pam] No page slug directories found, skipping');
    return null;
  }

  console.log(`  [pam] Found ${slugDirs.length} page slugs: ${slugDirs.join(', ')}`);

  const snapshotVersion = await getNextSnapshotVersion(sb, auditId, 'pam');

  // Also write to legacy table for backward compat
  await sb.from('agent_implementation_pages').delete().eq('audit_id', auditId);

  const runDate = dateStr;
  const { data: run } = await sb.from('agent_runs').insert({
    audit_id: auditId,
    agent_name: 'pam',
    run_date: runDate,
    status: 'completed',
    source_path: path.relative(AUDITS_BASE, contentDir),
    snapshot_version: snapshotVersion,
    metadata: { page_count: slugDirs.length },
  }).select('id').single();

  const agentRunId = run?.id ?? null;

  const pageRecords = [];
  for (const slug of slugDirs) {
    const slugPath = path.join(contentDir, slug);
    const metadataFile = path.join(slugPath, 'metadata.md');
    const schemaFile = path.join(slugPath, 'schema.json');
    const outlineFile = path.join(slugPath, 'content_outline.md');

    const metadataMd = fs.existsSync(metadataFile) ? fs.readFileSync(metadataFile, 'utf-8') : null;
    const schemaMd = fs.existsSync(schemaFile) ? fs.readFileSync(schemaFile, 'utf-8') : null;
    const outlineMd = fs.existsSync(outlineFile) ? fs.readFileSync(outlineFile, 'utf-8') : null;

    let schemaJson = null;
    if (schemaMd) {
      try {
        schemaJson = JSON.parse(schemaMd);
      } catch {
        console.log(`  [pam] Warning: invalid JSON in ${schemaFile}`);
      }
    }

    const metaTitle = metadataMd ? extractMetadataField(metadataMd, 'Meta Title') : null;
    const metaDesc = metadataMd ? extractMetadataField(metadataMd, 'Meta Description') : null;
    const h1 = metadataMd ? extractMetadataField(metadataMd, 'H1 Tag') : null;
    const intent = metadataMd ? extractMetadataField(metadataMd, 'Intent Classification') : null;
    const wordCount = outlineMd ? extractWordCountTarget(outlineMd) : null;

    pageRecords.push({
      audit_id: auditId,
      agent_run_id: agentRunId,
      url_slug: slug,
      meta_title: metaTitle,
      meta_description: metaDesc,
      h1_recommendation: h1,
      intent_classification: intent?.toLowerCase() ?? null,
      metadata_markdown: metadataMd,
      schema_json: schemaJson,
      content_outline_markdown: outlineMd,
      target_word_count: wordCount,
    });
  }

  // Write to legacy agent_implementation_pages (backward compat)
  if (pageRecords.length > 0) {
    const { error } = await sb.from('agent_implementation_pages').insert(pageRecords);
    if (error) throw new Error(`implementation pages insert failed: ${error.message}`);
    console.log(`  [pam] Inserted ${pageRecords.length} legacy implementation pages`);
  }

  // Upsert into execution_pages: update Pam fields, preserve page_brief and status
  for (const rec of pageRecords) {
    const { data: existing } = await sb
      .from('execution_pages')
      .select('id, status')
      .eq('audit_id', auditId)
      .eq('url_slug', rec.url_slug)
      .maybeSingle();

    const pamFields = {
      meta_title: rec.meta_title,
      meta_description: rec.meta_description,
      h1_recommendation: rec.h1_recommendation,
      intent_classification: rec.intent_classification,
      metadata_markdown: rec.metadata_markdown,
      schema_json: rec.schema_json,
      content_outline_markdown: rec.content_outline_markdown,
      target_word_count: rec.target_word_count,
      agent_run_id: agentRunId,
      snapshot_version: snapshotVersion,
    };

    if (existing) {
      // Preserve existing status and page_brief
      await sb.from('execution_pages').update(pamFields).eq('id', (existing as any).id);
    } else {
      // New page — insert with brief_ready status
      await sb.from('execution_pages').insert({
        audit_id: auditId,
        url_slug: rec.url_slug,
        status: 'brief_ready',
        ...pamFields,
      });
    }
  }
  console.log(`  [pam] Upserted ${pageRecords.length} execution pages`);

  // Record snapshot and update staleness
  await recordSnapshot(sb, auditId, 'pam', snapshotVersion, agentRunId, pageRecords.length);
  await updateStalenessTimestamp(sb, auditId, 'pam');

  return agentRunId;
}

// ============================================================
// Main orchestrator
// ============================================================

const AGENT_ORDER = ['jim', 'dwight', 'michael', 'pam'] as const;
const PIPELINE_STATUS: Record<string, string> = {
  jim: 'research',
  dwight: 'audit',
  michael: 'architecture',
  pam: 'complete',
};

async function main() {
  const args = parseArgs();
  const env = loadEnv();

  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  const sb = createClient(supabaseUrl, serviceRoleKey);

  console.log(`\nSync Bridge — ${args.domain}`);
  console.log('='.repeat(50));

  // Resolve user ID from email
  const { data: userData } = await sb.auth.admin.listUsers();
  const user = userData?.users?.find((u: any) => u.email === args.userEmail);
  if (!user) {
    console.error(`User not found: ${args.userEmail}`);
    process.exit(1);
  }
  console.log(`User: ${args.userEmail} (${user.id})`);

  // Find or create audit record for this domain
  let { data: audit } = await sb
    .from('audits')
    .select('*')
    .eq('domain', args.domain)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!audit) {
    console.log('No existing audit found — creating one');
    const { data: newAudit, error } = await sb.from('audits').insert({
      user_id: user.id,
      domain: args.domain,
      service_key: 'plumbing',
      market_city: 'Boise',
      market_state: 'ID',
      status: 'draft',
      agent_pipeline_domain: args.domain,
    }).select().single();
    if (error) throw new Error(`Failed to create audit: ${error.message}`);
    audit = newAudit;
  }

  console.log(`Audit ID: ${audit!.id}`);

  // Determine which agents to sync
  const agentsToSync = args.agents.length > 0
    ? AGENT_ORDER.filter((a) => args.agents.includes(a))
    : AGENT_ORDER.filter(() => true); // all

  let lastCompletedAgent: string | null = null;

  for (const agent of agentsToSync) {
    // Skip Jim keywords if --skip-keywords
    if (agent === 'jim' && args.skipKeywords) {
      console.log(`\n[jim] Skipped (--skip-keywords)`);
      continue;
    }

    console.log(`\n--- ${agent.toUpperCase()} ---`);

    try {
      let runId: string | null = null;

      switch (agent) {
        case 'jim':
          runId = await syncJim(sb, audit!.id, args.domain, args.date);
          break;
        case 'dwight':
          runId = await syncDwight(sb, audit!.id, args.domain, args.date);
          break;
        case 'michael':
          runId = await syncMichael(sb, audit!.id, args.domain, args.date);
          break;
        case 'pam':
          runId = await syncPam(sb, audit!.id, args.domain, args.date);
          break;
      }

      if (runId) {
        lastCompletedAgent = agent;
      }
    } catch (err) {
      console.error(`  [${agent}] ERROR:`, err instanceof Error ? err.message : err);
      // Record failed run
      await sb.from('agent_runs').insert({
        audit_id: audit!.id,
        agent_name: agent,
        run_date: args.date ?? new Date().toISOString().slice(0, 10),
        status: 'failed',
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // Update pipeline status
  if (lastCompletedAgent) {
    const pipelineStatus = PIPELINE_STATUS[lastCompletedAgent] ?? lastCompletedAgent;
    await sb.from('audits').update({
      agent_pipeline_status: pipelineStatus,
      agent_pipeline_domain: args.domain,
    }).eq('id', audit!.id);
    console.log(`\nPipeline status: ${pipelineStatus}`);
  }

  // Set audit to completed if it has keywords
  if (agentsToSync.includes('jim') && !args.skipKeywords) {
    const { count } = await sb.from('audit_keywords').select('id', { count: 'exact', head: true }).eq('audit_id', audit!.id);
    if ((count ?? 0) > 0) {
      await sb.from('audits').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', audit!.id);
    }
  }

  console.log('\nSync complete.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
