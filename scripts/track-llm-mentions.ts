#!/usr/bin/env npx tsx
/**
 * track-llm-mentions.ts — Standalone LLM visibility tracker.
 * Fetches current AI platform mention data for a domain and writes to Supabase.
 *
 * Two modes:
 *   1. Cluster-aware (preferred): Uses visibility_queries from activated cluster strategies.
 *      Fetches client + competitor mentions per cluster. Writes cluster_canonical_key.
 *   2. Fallback: Uses top-5-by-volume keywords from audit_keywords (legacy behavior).
 *      Writes cluster_canonical_key = null.
 *
 * Usage:
 *   npx tsx scripts/track-llm-mentions.ts --domain <domain> --user-email <email>
 *   npx tsx scripts/track-llm-mentions.ts --domain <domain> --user-email <email> --force
 *
 * Environment variables (from .env or process.env):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fetchDomainMentions, fetchCompetitorMentions } from './dataforseo-llm-mentions.js';

// Budget defaults — cluster mode uses higher budgets due to more queries
const CLUSTER_DOMAIN_BUDGET = 5.0;
const CLUSTER_COMPETITOR_BUDGET = 3.0;
const MAX_CLUSTER_QUERIES = 40;

// ============================================================
// CLI argument parsing
// ============================================================

interface CliArgs {
  domain: string;
  userEmail: string;
  force: boolean;
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
    console.error('Usage: npx tsx scripts/track-llm-mentions.ts --domain <domain> --user-email <email> [--force]');
    process.exit(1);
  }

  return {
    domain: flags.domain,
    userEmail: flags['user-email'],
    force: flags.force === 'true',
  };
}

// ============================================================
// .env loader
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
// Helpers
// ============================================================

function todayStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function daysSince(dateStr: string): number {
  const then = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}

function nextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function resolveAudit(sb: SupabaseClient, domain: string, userEmail: string) {
  const { data: userData } = await sb.auth.admin.listUsers();
  const user = userData?.users?.find((u: any) => u.email === userEmail);
  if (!user) throw new Error(`User not found: ${userEmail}`);

  const { data: audit } = await sb
    .from('audits')
    .select('*')
    .eq('domain', domain)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!audit) throw new Error(`No audit found for ${domain} / ${userEmail}`);
  return { audit, userId: user.id };
}

// ============================================================
// Cluster query selection
// ============================================================

interface ClusterQuery {
  keyword: string;
  cluster_canonical_key: string;
}

interface ClusterQueryResult {
  queries: ClusterQuery[];
  competitorsByCluster: Map<string, string[]>;
}

async function getClusterQueries(
  sb: SupabaseClient,
  auditId: string,
): Promise<ClusterQueryResult | null> {
  // Fetch active cluster strategies with visibility_queries
  const { data: strategies, error } = await (sb as any)
    .from('cluster_strategy')
    .select('canonical_key, visibility_queries')
    .eq('audit_id', auditId)
    .eq('status', 'active')
    .not('visibility_queries', 'is', null);

  if (error) {
    console.warn(`  Warning: cluster_strategy query failed: ${error.message}`);
    return null;
  }
  if (!strategies || strategies.length === 0) return null;

  // Extract queries from visibility_queries JSONB
  const allQueries: ClusterQuery[] = [];
  const clusterKeys: string[] = [];

  for (const strat of strategies) {
    const vq = strat.visibility_queries;
    if (!vq || !Array.isArray(vq)) continue;
    clusterKeys.push(strat.canonical_key);
    for (const item of vq) {
      const q = typeof item === 'string' ? item : item?.query;
      if (q && typeof q === 'string') {
        allQueries.push({
          keyword: q,
          cluster_canonical_key: strat.canonical_key,
        });
      }
    }
  }

  if (allQueries.length === 0) return null;

  // Cap at MAX_CLUSTER_QUERIES via round-robin across clusters
  let capped = allQueries;
  if (allQueries.length > MAX_CLUSTER_QUERIES) {
    const byCluster = new Map<string, ClusterQuery[]>();
    for (const q of allQueries) {
      if (!byCluster.has(q.cluster_canonical_key)) byCluster.set(q.cluster_canonical_key, []);
      byCluster.get(q.cluster_canonical_key)!.push(q);
    }
    capped = [];
    const iterators = Array.from(byCluster.values()).map((qs) => ({ qs, idx: 0 }));
    while (capped.length < MAX_CLUSTER_QUERIES) {
      let added = false;
      for (const iter of iterators) {
        if (capped.length >= MAX_CLUSTER_QUERIES) break;
        if (iter.idx < iter.qs.length) {
          capped.push(iter.qs[iter.idx++]);
          added = true;
        }
      }
      if (!added) break;
    }
  }

  // Fetch top 3 non-client competitors per cluster
  const competitorsByCluster = new Map<string, string[]>();
  if (clusterKeys.length > 0) {
    const { data: compRows } = await (sb as any)
      .from('audit_topic_competitors')
      .select('canonical_key, competitor_domain, share, is_client')
      .eq('audit_id', auditId)
      .in('canonical_key', clusterKeys)
      .order('share', { ascending: false });

    for (const row of compRows ?? []) {
      if (row.is_client) continue;
      if (!competitorsByCluster.has(row.canonical_key)) {
        competitorsByCluster.set(row.canonical_key, []);
      }
      const list = competitorsByCluster.get(row.canonical_key)!;
      if (list.length < 3) {
        list.push(row.competitor_domain);
      }
    }
  }

  return { queries: capped, competitorsByCluster };
}

// ============================================================
// Main tracking logic
// ============================================================

export interface TrackResult {
  mode: 'cluster' | 'fallback';
  keywordCount: number;
  mentionCount: number;
  competitorCount: number;
  cost: number;
}

export async function trackLlmMentions(cliArgs: CliArgs): Promise<TrackResult | null> {
  const env = loadEnv();
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');

  const sb = createClient(supabaseUrl, supabaseKey);
  const snapshotDate = todayStr();

  console.log(`\n=== LLM Visibility Tracker: ${cliArgs.domain} (${snapshotDate}) ===\n`);

  // 1. Resolve audit
  const { audit } = await resolveAudit(sb, cliArgs.domain, cliArgs.userEmail);
  console.log(`  Audit: ${audit.id} (status: ${audit.status})`);

  if (audit.status !== 'completed') {
    console.log(`  Skipping — audit status is '${audit.status}', not 'completed'`);
    return null;
  }

  // 2. Recency check (25-day threshold for monthly tracking)
  const { data: latestSnapshot } = await (sb as any)
    .from('llm_visibility_snapshots')
    .select('snapshot_date')
    .eq('audit_id', audit.id)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestSnapshot && !cliArgs.force) {
    const days = daysSince(latestSnapshot.snapshot_date);
    if (days < 25) {
      console.log(`  Skipping — snapshot taken ${days} days ago (< 25 day threshold). Use --force to override.`);
      return null;
    }
  }

  // 3. Try cluster-aware query selection first
  const clusterResult = await getClusterQueries(sb, audit.id);

  if (clusterResult) {
    return await trackClusterMode(env, sb, audit, cliArgs.domain, snapshotDate, clusterResult);
  } else {
    return await trackFallbackMode(env, sb, audit, cliArgs.domain, snapshotDate);
  }
}

// ============================================================
// Cluster-aware mode
// ============================================================

async function trackClusterMode(
  env: Record<string, string>,
  sb: SupabaseClient,
  audit: any,
  domain: string,
  snapshotDate: string,
  clusterResult: ClusterQueryResult,
): Promise<TrackResult> {
  const { queries, competitorsByCluster } = clusterResult;
  const keywords = queries.map((q) => q.keyword);
  const keywordToCluster = new Map(queries.map((q) => [q.keyword, q.cluster_canonical_key]));

  console.log(`  Mode: CLUSTER-AWARE (${queries.length} queries across ${new Set(queries.map(q => q.cluster_canonical_key)).size} clusters)`);
  for (const [ck, comps] of competitorsByCluster) {
    console.log(`    ${ck}: ${comps.join(', ')}`);
  }

  // Set higher budgets for cluster mode
  const clusterEnv = { ...env, LLM_DOMAIN_BUDGET: String(CLUSTER_DOMAIN_BUDGET) };

  // 4a. Fetch client domain mentions
  const { mentions: clientMentions, cost: clientCost } = await fetchDomainMentions(clusterEnv, domain, keywords);
  console.log(`  Client mentions: ${clientMentions.length} records ($${clientCost.toFixed(4)})`);

  // 4b. Fetch competitor mentions per cluster (dedupe competitors across clusters)
  const allCompetitors = new Set<string>();
  for (const comps of competitorsByCluster.values()) {
    for (const c of comps) allCompetitors.add(c);
  }
  const competitorEnv = { ...env, LLM_COMPETITOR_BUDGET: String(CLUSTER_COMPETITOR_BUDGET) };
  let competitorMentions: any[] = [];
  let competitorCost = 0;

  if (allCompetitors.size > 0) {
    const result = await fetchCompetitorMentions(competitorEnv, [...allCompetitors], keywords);
    competitorMentions = result.mentions;
    competitorCost = result.cost;
    console.log(`  Competitor mentions: ${competitorMentions.length} records ($${competitorCost.toFixed(4)})`);
  }

  const totalCost = clientCost + competitorCost;

  // 5. Write to Supabase — clear existing rows for this audit + date
  await (sb as any).from('llm_visibility_snapshots')
    .delete()
    .eq('audit_id', audit.id)
    .eq('snapshot_date', snapshotDate)
    .eq('domain', domain);

  // Also clear competitor rows for this date
  for (const compDomain of allCompetitors) {
    await (sb as any).from('llm_visibility_snapshots')
      .delete()
      .eq('audit_id', audit.id)
      .eq('snapshot_date', snapshotDate)
      .eq('domain', compDomain);
  }

  await (sb as any).from('llm_mention_details')
    .delete()
    .eq('audit_id', audit.id)
    .gte('captured_at', `${snapshotDate}T00:00:00Z`)
    .lt('captured_at', `${nextDay(snapshotDate)}T00:00:00Z`);

  // Insert client visibility snapshots with cluster_canonical_key
  const visRecords = clientMentions.map((m) => ({
    audit_id: audit.id,
    domain,
    snapshot_date: snapshotDate,
    keyword: m.keyword,
    platform: m.platform,
    mention_count: m.mention_count,
    ai_search_volume: m.ai_search_volume || null,
    top_citation_domains: m.citation_sources,
    is_estimated: false,
    cluster_canonical_key: keywordToCluster.get(m.keyword) ?? null,
  }));

  // Insert competitor visibility snapshots with cluster association
  const compVisRecords = competitorMentions.map((m: any) => ({
    audit_id: audit.id,
    domain: m.domain,
    snapshot_date: snapshotDate,
    keyword: m.keyword,
    platform: m.platform,
    mention_count: m.mention_count,
    ai_search_volume: null,
    top_citation_domains: [],
    is_estimated: m.is_estimated,
    cluster_canonical_key: keywordToCluster.get(m.keyword) ?? null,
  }));

  const allVisRecords = [...visRecords, ...compVisRecords];
  if (allVisRecords.length > 0) {
    const { error } = await (sb as any).from('llm_visibility_snapshots').upsert(allVisRecords, {
      onConflict: 'audit_id,snapshot_date,keyword,platform,domain',
    });
    if (error) throw new Error(`llm_visibility_snapshots upsert failed: ${error.message}`);
  }

  // Insert mention details (client only — competitor aggregated endpoint doesn't return texts)
  const detailRecords: any[] = [];
  for (const m of clientMentions) {
    for (const text of m.mention_texts) {
      detailRecords.push({
        audit_id: audit.id,
        keyword: m.keyword,
        platform: m.platform,
        mention_text: text,
        citation_urls: [],
        source_domains: m.citation_sources,
      });
    }
  }

  if (detailRecords.length > 0) {
    const { error } = await (sb as any).from('llm_mention_details').insert(detailRecords);
    if (error) console.warn(`  llm_mention_details insert warning: ${error.message}`);
  }

  console.log(`  Written ${allVisRecords.length} snapshot records (${visRecords.length} client, ${compVisRecords.length} competitor), ${detailRecords.length} detail records`);

  // Log per-cluster SOV summary
  const clusterKeys = [...new Set(queries.map((q) => q.cluster_canonical_key))];
  for (const ck of clusterKeys) {
    const ckKeywords = queries.filter((q) => q.cluster_canonical_key === ck).map((q) => q.keyword);
    const clientTotal = clientMentions
      .filter((m) => ckKeywords.includes(m.keyword))
      .reduce((s, m) => s + m.mention_count, 0);
    const compTotal = competitorMentions
      .filter((m: any) => ckKeywords.includes(m.keyword))
      .reduce((s: number, m: any) => s + m.mention_count, 0);
    const sov = clientTotal + compTotal > 0
      ? Math.round((clientTotal / (clientTotal + compTotal)) * 100)
      : 0;
    console.log(`    ${ck}: SOV ${sov}% (client ${clientTotal}, competitors ${compTotal})`);
  }

  // 6. Log agent_runs
  const totalMentions = clientMentions.reduce((s, m) => s + m.mention_count, 0);
  await sb.from('agent_runs').insert({
    audit_id: audit.id,
    agent_name: 'llm_visibility_tracker',
    run_date: snapshotDate,
    status: 'completed',
    metadata: {
      mode: 'cluster',
      keyword_count: keywords.length,
      cluster_count: clusterKeys.length,
      competitor_count: allCompetitors.size,
      mention_count: totalMentions,
      cost: totalCost,
      snapshot_date: snapshotDate,
    },
  });

  console.log(`\n  Done. Cluster-aware LLM visibility snapshot ${snapshotDate} for ${domain} complete. ($${totalCost.toFixed(4)})\n`);

  return {
    mode: 'cluster',
    keywordCount: keywords.length,
    mentionCount: totalMentions,
    competitorCount: allCompetitors.size,
    cost: totalCost,
  };
}

// ============================================================
// Fallback mode (legacy top-5-by-volume)
// ============================================================

async function trackFallbackMode(
  env: Record<string, string>,
  sb: SupabaseClient,
  audit: any,
  domain: string,
  snapshotDate: string,
): Promise<TrackResult> {
  console.log('  Mode: FALLBACK (top-5-by-volume keywords, no cluster queries)');

  // Select keywords from audit_keywords (top 5 by volume)
  const { data: auditKeywords, error: kwErr } = await sb
    .from('audit_keywords')
    .select('keyword, search_volume, rank_pos, is_brand, is_near_me')
    .eq('audit_id', audit.id)
    .order('search_volume', { ascending: false });

  if (kwErr) throw new Error(`Failed to load audit_keywords: ${kwErr.message}`);

  const keywords = (auditKeywords ?? [])
    .filter((kw: any) => !kw.is_brand && !kw.is_near_me && (kw.rank_pos ?? 100) <= 30)
    .slice(0, 5)
    .map((kw: any) => kw.keyword);

  if (keywords.length === 0) {
    console.log('  No qualifying keywords found — skipping');
    return { mode: 'fallback', keywordCount: 0, mentionCount: 0, competitorCount: 0, cost: 0 };
  }

  console.log(`  Selected ${keywords.length} keywords: ${keywords.join(', ')}`);

  // Fetch domain mentions
  const { mentions, cost } = await fetchDomainMentions(env, domain, keywords);
  console.log(`  Fetched ${mentions.length} mention records ($${cost.toFixed(4)})`);

  // Write to Supabase — clear existing rows for this audit + date
  await (sb as any).from('llm_visibility_snapshots')
    .delete()
    .eq('audit_id', audit.id)
    .eq('snapshot_date', snapshotDate)
    .eq('domain', domain);

  await (sb as any).from('llm_mention_details')
    .delete()
    .eq('audit_id', audit.id)
    .gte('captured_at', `${snapshotDate}T00:00:00Z`)
    .lt('captured_at', `${nextDay(snapshotDate)}T00:00:00Z`);

  // Insert visibility snapshots (cluster_canonical_key = null for fallback)
  const visRecords = mentions.map((m) => ({
    audit_id: audit.id,
    domain,
    snapshot_date: snapshotDate,
    keyword: m.keyword,
    platform: m.platform,
    mention_count: m.mention_count,
    ai_search_volume: m.ai_search_volume || null,
    top_citation_domains: m.citation_sources,
    is_estimated: false,
    cluster_canonical_key: null,
  }));

  if (visRecords.length > 0) {
    const { error } = await (sb as any).from('llm_visibility_snapshots').upsert(visRecords, {
      onConflict: 'audit_id,snapshot_date,keyword,platform,domain',
    });
    if (error) throw new Error(`llm_visibility_snapshots upsert failed: ${error.message}`);
  }

  // Insert mention details
  const detailRecords: any[] = [];
  for (const m of mentions) {
    for (const text of m.mention_texts) {
      detailRecords.push({
        audit_id: audit.id,
        keyword: m.keyword,
        platform: m.platform,
        mention_text: text,
        citation_urls: [],
        source_domains: m.citation_sources,
      });
    }
  }

  if (detailRecords.length > 0) {
    const { error } = await (sb as any).from('llm_mention_details').insert(detailRecords);
    if (error) console.warn(`  llm_mention_details insert warning: ${error.message}`);
  }

  console.log(`  Written ${visRecords.length} snapshot records, ${detailRecords.length} detail records`);

  // Log agent_runs
  const totalMentions = mentions.reduce((s, m) => s + m.mention_count, 0);
  await sb.from('agent_runs').insert({
    audit_id: audit.id,
    agent_name: 'llm_visibility_tracker',
    run_date: snapshotDate,
    status: 'completed',
    metadata: {
      mode: 'fallback',
      keyword_count: keywords.length,
      mention_count: totalMentions,
      cost,
      snapshot_date: snapshotDate,
    },
  });

  console.log(`\n  Done. Fallback LLM visibility snapshot ${snapshotDate} for ${domain} complete.\n`);

  return {
    mode: 'fallback',
    keywordCount: keywords.length,
    mentionCount: totalMentions,
    competitorCount: 0,
    cost,
  };
}

// ============================================================
// Entry point
// ============================================================

const args = parseArgs();
trackLlmMentions(args).catch((err) => {
  console.error(`\nFATAL: ${err.message}\n`);
  process.exit(1);
});
