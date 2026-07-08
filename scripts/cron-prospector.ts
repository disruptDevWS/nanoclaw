#!/usr/bin/env npx tsx
/**
 * cron-prospector.ts — Daily autonomous prospecting: discover → qualify →
 * scout → contact-find → outreach draft → morning digest.
 *
 * Flow (all caps/config in config/prospector-seeds.json):
 *   1. Rotate ~12 seed queries (vertical × metro × template, day-of-year based)
 *   2. DataForSEO SERP organic live/regular, keep ranks 11-50 (real businesses
 *      losing search — the pitch target)
 *   3. Filter: blocklist, TLDs, Treasure Valley guard, existing prospects/
 *      audits/candidates
 *   4. Qualify: homepage fetch + tech signals + Haiku ICP score (0-100)
 *   5. Top 3 above threshold: Sonnet writes prospect-config.json → spawn
 *      run-pipeline.sh --mode prospect (awaited, sequential)
 *   6. Contact discovery (contact/about pages → email + name) → prospects row
 *   7. Spawn generate-outreach-email.ts (drafts only — NEVER sends)
 *   8. Digest: Gmail draft addressed to the sender + full dump to stdout
 *
 * Usage:
 *   npx tsx scripts/cron-prospector.ts [--dry-run] [--max-scouts N]
 *
 * --dry-run: discovery + qualification only (candidates are persisted);
 *            skips config/scout/outreach/digest-draft. Use for validation.
 *
 * Scheduling: daily via Railway cron service (see docs/PIPELINE.md).
 * Kill criterion (DECISIONS.md 2026-07-08): re-evaluate after 4 weeks —
 * if drafts aren't being sent or replies are ~0, pause and rethink.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { callClaude, PHASE_MAX_TOKENS } from './anthropic-client.js';
import { loadEnv, createSb, parseFlags, AUDITS_BASE } from './analysis-shared.js';
import { getCredentials } from './dataforseo-business.js';
import { getDelegatedUserAccessToken } from './google-auth.js';
import { createDraft, GMAIL_COMPOSE_SCOPE } from './gmail-drafts.js';
import type { SupabaseClient } from '@supabase/supabase-js';

PHASE_MAX_TOKENS['prospector_qualify'] = 1024;
PHASE_MAX_TOKENS['prospector_config'] = 2048;
PHASE_MAX_TOKENS['prospector_contact'] = 512;

const DATAFORSEO_API = 'https://api.dataforseo.com/v3';
const SEEDS_PATH = path.resolve(process.cwd(), 'config/prospector-seeds.json');
const COST_LOG = path.join(AUDITS_BASE, '.dataforseo_cost.log');
const DEFAULT_SENDER = 'matt@forgegrowth.ai';
const SCOUT_TIMEOUT_MS = 25 * 60 * 1000;
const OUTREACH_TIMEOUT_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

// ── Types ────────────────────────────────────────────────────

interface SeedsConfig {
  daily_query_cap: number;
  daily_qualify_cap: number;
  daily_scout_cap: number;
  min_qualify_score: number;
  serp_rank_min: number;
  serp_rank_max: number;
  exclusions: { domains: string[]; domain_substrings: string[]; tlds: string[] };
  verticals: Array<{
    key: string;
    label: string;
    topic_patterns: string[];
    query_templates: string[];
  }>;
  geos: Array<{ state: string; state_code: string; metros: string[] }>;
}

interface SeedQuery {
  query: string;
  vertical: SeedsConfig['verticals'][number];
  geo: { state: string; state_code: string; metro: string };
}

interface Candidate {
  domain: string;
  url: string;
  serpTitle: string;
  serpRank: number;
  seed: SeedQuery;
  fromBacklog?: boolean; // existing 'discovered' row — update, don't insert
  signals?: Record<string, unknown>;
  homepageText?: string;
  homepageHtml?: string;
  qualify?: QualifyResult;
}

interface QualifyResult {
  business_name: string;
  score: number;
  vertical_fit: number;
  multi_location: boolean;
  franchise_or_national: boolean;
  serves_treasure_valley: boolean;
  site_quality_issues: string[];
  reason: string;
}

interface DigestEntry {
  domain: string;
  name: string;
  score: number;
  rank: number;
  query: string;
  outcome: string; // rejected reason | scouted | drafted | error detail
  configJson?: string;
  subject?: string;
  variant?: string;
  addressable?: number | null;
  contactEmail?: string | null;
}

// ── Small utils ──────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86_400_000);
}

function normalizeDomain(input: string): string {
  let d = input.toLowerCase().trim();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '');
  d = d.split('/')[0].split(':')[0];
  return d;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract the first JSON object from a model response (tolerates fences/prose). */
function extractJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model output');
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

function logDataForSeoCost(endpoint: string, cost: number): void {
  const line = `${new Date().toISOString()} | prospector | ${endpoint} | $${cost.toFixed(4)}\n`;
  try {
    fs.mkdirSync(path.dirname(COST_LOG), { recursive: true });
    fs.appendFileSync(COST_LOG, line);
  } catch {
    // Non-fatal
  }
}

// ── Seed rotation ────────────────────────────────────────────

function buildTodaysQueries(seeds: SeedsConfig): SeedQuery[] {
  const combos: SeedQuery[] = [];
  for (const vertical of seeds.verticals) {
    for (const geo of seeds.geos) {
      for (const metro of geo.metros) {
        for (const template of vertical.query_templates) {
          combos.push({
            query: template.replace('{metro}', metro).toLowerCase(),
            vertical,
            geo: { state: geo.state, state_code: geo.state_code, metro },
          });
        }
      }
    }
  }
  if (combos.length === 0) return [];
  const cap = seeds.daily_query_cap;
  const start = (dayOfYear(new Date()) * cap) % combos.length;
  const todays: SeedQuery[] = [];
  for (let i = 0; i < Math.min(cap, combos.length); i++) {
    todays.push(combos[(start + i) % combos.length]);
  }
  return todays;
}

// ── DataForSEO SERP ──────────────────────────────────────────

async function fetchSerp(
  creds: { login: string; password: string },
  keyword: string,
  depth: number,
): Promise<{ items: Array<{ rank: number; domain: string; url: string; title: string }>; cost: number }> {
  const auth = `Basic ${Buffer.from(`${creds.login}:${creds.password}`).toString('base64')}`;
  const resp = await fetch(`${DATAFORSEO_API}/serp/google/organic/live/regular`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { keyword, location_name: 'United States', language_code: 'en', depth },
    ]),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`SERP HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  if (data.status_code !== 20000) {
    throw new Error(`SERP API error ${data.status_code}: ${data.status_message}`);
  }
  const task = data.tasks?.[0];
  const cost = task?.cost ?? 0;
  const items: Array<{ rank: number; domain: string; url: string; title: string }> = [];
  for (const item of task?.result?.[0]?.items ?? []) {
    if (item.type !== 'organic' || !item.url) continue;
    items.push({
      rank: item.rank_group ?? item.rank_absolute ?? 0,
      domain: normalizeDomain(item.domain || item.url),
      url: item.url,
      title: item.title || '',
    });
  }
  logDataForSeoCost(`serp/regular/${keyword}`, cost);
  return { items, cost };
}

// ── Candidate filtering ──────────────────────────────────────

function isExcluded(domain: string, seeds: SeedsConfig): string | null {
  for (const tld of seeds.exclusions.tlds) {
    if (domain.endsWith(tld)) return `tld ${tld}`;
  }
  for (const blocked of seeds.exclusions.domains) {
    if (domain === blocked || domain.endsWith(`.${blocked}`)) return 'blocklist';
  }
  for (const sub of seeds.exclusions.domain_substrings) {
    if (domain.includes(sub)) return `treasure-valley guard (${sub})`;
  }
  return null;
}

// ── Page fetching + signals ──────────────────────────────────

async function fetchPage(url: string): Promise<{ ok: boolean; html: string; finalUrl: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const resp = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return { ok: false, html: '', finalUrl: resp.url || url };
    const html = (await resp.text()).slice(0, 200_000);
    return { ok: true, html, finalUrl: resp.url || url };
  } catch {
    return { ok: false, html: '', finalUrl: url };
  }
}

function extractSignals(html: string, finalUrl: string): Record<string, unknown> {
  const text = stripHtml(html);
  const titleMatch = html.match(/<title[^>]*>([^<]*)/i);
  const generatorMatch = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i);
  const copyrightYears = [...html.matchAll(/(?:©|&copy;|copyright)[^0-9]{0,20}(20\d{2}|19\d{2})/gi)]
    .map((m) => parseInt(m[1], 10))
    .filter((y) => y >= 1990 && y <= 2100);
  const builders: string[] = [];
  if (/static\.wixstatic|wix\.com|X-Wix/i.test(html)) builders.push('wix');
  if (/squarespace/i.test(html)) builders.push('squarespace');
  if (/godaddy|websitebuilder/i.test(html)) builders.push('godaddy');
  if (/weebly/i.test(html)) builders.push('weebly');
  if (/cdn\.durable|duda(?:mobile)?/i.test(html)) builders.push('duda');
  if (/\/wp-content\//i.test(html)) builders.push('wordpress');

  return {
    https: finalUrl.startsWith('https://'),
    title: titleMatch?.[1]?.trim().slice(0, 200) ?? null,
    has_meta_description: /<meta[^>]+name=["']description["']/i.test(html),
    has_schema_jsonld: /application\/ld\+json/i.test(html),
    has_viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    generator: generatorMatch?.[1]?.trim() ?? null,
    builders,
    copyright_year: copyrightYears.length > 0 ? Math.max(...copyrightYears) : null,
    text_length: text.length,
    has_locations_page: /href=["'][^"']*(locations?|service-areas?|areas-we-serve)[^"']*["']/i.test(html),
    tel_link_count: (html.match(/href=["']tel:/gi) || []).length,
  };
}

// ── Qualification (Haiku) ────────────────────────────────────

async function qualifyCandidate(c: Candidate): Promise<QualifyResult> {
  const prompt = `You are qualifying a cold-outreach prospect for Forge Growth, a search-growth consultancy for local service businesses and vocational academies.

## Candidate
- Domain: ${c.domain}
- Found at organic rank ${c.serpRank} for query "${c.seed.query}" (metro: ${c.seed.geo.metro}, ${c.seed.geo.state})
- Target vertical: ${c.seed.vertical.label}
- SERP title: ${c.serpTitle}

## Technical signals (from homepage fetch)
${JSON.stringify(c.signals, null, 2)}

## Homepage text (excerpt)
${(c.homepageText || '(fetch failed — no homepage text)').slice(0, 3000)}

## Scoring rubric (0-100)
- ICP fit (0-40): a real, independent, revenue-generating local service business or private vocational academy in the target vertical. NOT a directory, blog, marketplace, franchise location, or national chain.
- Visibility struggle (0-30): ranking 11-50 for a money keyword means real demand they're missing. Closer to page 1 (rank 11-20) = more established = better prospect.
- Site quality opportunity (0-20): missing schema, no meta description, stale copyright, template-builder site, thin content — each issue is agency opportunity.
- Multi-location bonus (0-10): evidence of 2+ physical locations or a broad multi-metro service area.

## Hard zeros (score = 0)
- Franchise or national chain (independent multi-location is GOOD; franchise is a zero)
- Directory/aggregator/marketplace/media site rather than an actual business
- Business is based in or primarily serves Boise / Meridian / Nampa / Caldwell / Treasure Valley, Idaho

Respond with ONLY a JSON object:
{"business_name": string, "score": number, "vertical_fit": number, "multi_location": boolean, "franchise_or_national": boolean, "serves_treasure_valley": boolean, "site_quality_issues": string[], "reason": "one sentence"}`;

  const output = await callClaude(prompt, { model: 'haiku', phase: 'prospector_qualify' });
  const parsed = extractJson<QualifyResult>(output);
  if (typeof parsed.score !== 'number' || !parsed.business_name) {
    throw new Error('qualify output missing score/business_name');
  }
  if (parsed.franchise_or_national || parsed.serves_treasure_valley) parsed.score = 0;
  return parsed;
}

// ── Prospect config authoring (Sonnet) ───────────────────────

interface ProspectConfigOut {
  name: string;
  domain: string;
  geo_type: string;
  target_geos: Array<{ state: string; metros: string[] }>;
  topic_patterns: string[];
  state: string;
}

async function writeProspectConfig(c: Candidate): Promise<{ configPath: string; configJson: string }> {
  const q = c.qualify!;
  const prompt = `Write a Scout prospect-config JSON for this business. The config drives an automated SEO market scan — geo and topic accuracy directly determine scan quality.

## Business
- Name: ${q.business_name}
- Domain: ${c.domain}
- Vertical: ${c.seed.vertical.label}
- Discovered ranking #${c.serpRank} for "${c.seed.query}" in ${c.seed.geo.metro}, ${c.seed.geo.state}
- Multi-location evidence: ${q.multi_location}

## Default topic patterns for this vertical (starting point — refine, don't blindly copy)
${JSON.stringify(c.seed.vertical.topic_patterns)}

## Homepage text (evidence for services offered and areas served)
${(c.homepageText || '').slice(0, 4000)}

## Rules
- topic_patterns: 3-8 short service phrases the business ACTUALLY offers per the homepage evidence. Start from the vertical defaults, drop anything unsupported, add clearly-offered services that are missing. Lowercase, no geo terms inside the patterns.
- target_geos: the discovery metro (${c.seed.geo.metro}) always included. Add other metros ONLY with homepage evidence (locations page, "serving X and Y"). Never include Boise/Meridian/Nampa/Caldwell, Idaho.
- geo_type: "city" for a single metro, "state_metro" if evidence supports 2+ metros.
- state: two-letter code ${c.seed.geo.state_code} (or the business's actual home state if the homepage clearly shows otherwise).

Respond with ONLY the JSON object:
{"name": string, "domain": "${c.domain}", "geo_type": "city"|"state_metro", "target_geos": [{"state": string, "metros": [string]}], "topic_patterns": [string], "state": string}`;

  const output = await callClaude(prompt, { model: 'sonnet', phase: 'prospector_config' });
  const config = extractJson<ProspectConfigOut>(output);

  // Validate before letting it anywhere near a Scout run.
  if (!config.name || config.domain !== c.domain) throw new Error('config: bad name/domain');
  if (!['city', 'state_metro', 'national'].includes(config.geo_type)) {
    throw new Error(`config: invalid geo_type ${config.geo_type}`);
  }
  if (
    !Array.isArray(config.target_geos) ||
    config.target_geos.length === 0 ||
    config.target_geos.some((g) => !g.state || !Array.isArray(g.metros) || g.metros.length === 0)
  ) {
    throw new Error('config: invalid target_geos');
  }
  if (!Array.isArray(config.topic_patterns) || config.topic_patterns.length < 3) {
    throw new Error('config: fewer than 3 topic_patterns');
  }
  const tvGuard = /boise|meridian|nampa|caldwell/i;
  if (config.target_geos.some((g) => g.metros.some((m) => tvGuard.test(m)))) {
    throw new Error('config: Treasure Valley metro leaked into target_geos');
  }

  const dir = path.join(AUDITS_BASE, c.domain);
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'prospect-config.json');
  const configJson = JSON.stringify(config, null, 2);
  fs.writeFileSync(configPath, configJson);
  return { configPath, configJson };
}

// ── Child process runners (awaited, cron-track-all pattern) ──

function runChild(
  command: string,
  args: string[],
  label: string,
  timeoutMs: number,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    let output = '';
    let settled = false;
    const timer = setTimeout(() => {
      console.warn(`  ⚠ ${label} timed out after ${Math.round(timeoutMs / 60000)}min — killing`);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000);
    }, timeoutMs);
    child.stdout?.on('data', (d) => { output += d.toString(); });
    child.stderr?.on('data', (d) => { output += d.toString(); });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, output });
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: 1, output: `spawn error: ${err.message}` });
    });
  });
}

// ── Contact discovery ────────────────────────────────────────

async function discoverContact(
  c: Candidate,
): Promise<{ email: string | null; name: string | null }> {
  const pages: string[] = [c.homepageHtml || ''];
  const linkMatches = [
    ...(c.homepageHtml || '').matchAll(/href=["']([^"']*(?:contact|about)[^"']*)["']/gi),
  ]
    .map((m) => m[1])
    .filter((href) => !href.startsWith('#') && !href.startsWith('mailto:'))
    .slice(0, 2);
  for (const href of linkMatches) {
    const url = href.startsWith('http') ? href : `https://${c.domain}${href.startsWith('/') ? '' : '/'}${href}`;
    if (normalizeDomain(url) !== c.domain) continue;
    const page = await fetchPage(url);
    if (page.ok) pages.push(page.html);
  }

  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const junk = /(wixpress|sentry|example\.|godaddy|\.png|\.jpg|\.gif|\.webp|\.svg|noreply|no-reply|@2x)/i;
  const emails = new Set<string>();
  for (const html of pages) {
    for (const m of html.matchAll(emailRegex)) {
      const e = m[0].toLowerCase();
      if (!junk.test(e)) emails.add(e);
    }
  }
  if (emails.size === 0) return { email: null, name: null };

  const combinedText = pages.map((h) => stripHtml(h)).join('\n').slice(0, 4000);
  try {
    const output = await callClaude(
      `From this business website text, pick the best cold-outreach contact.

Candidate emails found on the site: ${[...emails].join(', ')}
Business domain: ${c.domain}

Text:
${combinedText}

Rules: prefer an owner/manager's personal email over generic (info@/office@); prefer emails at the business's own domain; contact_name is the PERSON the email belongs to (null if the email is generic or no person is named — never guess).

Respond with ONLY: {"contact_email": string|null, "contact_name": string|null}`,
      { model: 'haiku', phase: 'prospector_contact' },
    );
    const parsed = extractJson<{ contact_email: string | null; contact_name: string | null }>(output);
    const email = parsed.contact_email && emails.has(parsed.contact_email.toLowerCase())
      ? parsed.contact_email.toLowerCase()
      : [...emails][0];
    return { email, name: parsed.contact_name || null };
  } catch {
    return { email: [...emails][0], name: null };
  }
}

// ── Digest ───────────────────────────────────────────────────

function renderDigest(
  date: string,
  entries: DigestEntry[],
  stats: { queries: number; found: number; qualified: number; dfsSpend: number },
): { subject: string; body: string } {
  const scouted = entries.filter((e) => e.outcome === 'drafted' || e.outcome === 'scouted');
  const drafted = entries.filter((e) => e.outcome === 'drafted');
  const lines: string[] = [];
  lines.push(`Prospector digest — ${date}`);
  lines.push('');
  lines.push(
    `${stats.queries} queries → ${stats.found} new candidates → ${stats.qualified} qualified → ${scouted.length} scouted → ${drafted.length} drafts in Gmail. DataForSEO spend: $${stats.dfsSpend.toFixed(2)}.`,
  );
  lines.push('');

  if (drafted.length > 0) {
    lines.push('=== DRAFTS READY TO REVIEW AND SEND ===');
    for (const e of drafted) {
      lines.push('');
      lines.push(`• ${e.name} (${e.domain}) — score ${e.score}, rank #${e.rank} for "${e.query}"`);
      if (e.subject) lines.push(`  Subject: ${e.subject}`);
      lines.push(
        `  Variant: ${e.variant ?? '?'}${e.addressable != null ? ` — addressable ~$${e.addressable.toLocaleString()}/mo` : ''}`,
      );
      lines.push(`  To: ${e.contactEmail || '(no email found — fill in manually)'}`);
    }
    lines.push('');
  }

  const withConfigs = entries.filter((e) => e.configJson);
  if (withConfigs.length > 0) {
    lines.push('=== GENERATED SCOUT CONFIGS (spot-check these) ===');
    for (const e of withConfigs) {
      lines.push('');
      lines.push(`• ${e.domain}:`);
      lines.push(e.configJson!);
    }
    lines.push('');
  }

  const other = entries.filter((e) => e.outcome !== 'drafted' && e.outcome !== 'scouted');
  if (other.length > 0) {
    lines.push('=== OTHER CANDIDATES (not scouted today) ===');
    for (const e of other.sort((a, b) => b.score - a.score)) {
      lines.push(`• ${e.name || e.domain} (${e.domain}) — score ${e.score}: ${e.outcome}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('Drafts never auto-send. Review in Gmail Drafts, fix anything off, hit send.');
  lines.push('Reply-rate check-in: if drafts are piling up unsent, this system is not working — say so.');

  const subject = `Prospector — ${date}: ${drafted.length} draft${drafted.length === 1 ? '' : 's'} ready, ${scouted.length} scouted`;
  return { subject, body: lines.join('\n') };
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const dryRun = flags['dry-run'] === 'true';
  const env = loadEnv();
  // Hoist env for anthropic-client / google-auth (same pattern as generate-outreach-email.ts)
  if (env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  if (env.ANTHROPIC_KEY) process.env.ANTHROPIC_KEY = env.ANTHROPIC_KEY;
  if (env.GOOGLE_ADC_JSON) process.env.GOOGLE_ADC_JSON = env.GOOGLE_ADC_JSON;
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = env.GOOGLE_APPLICATION_CREDENTIALS;
  }

  const seeds: SeedsConfig = JSON.parse(fs.readFileSync(SEEDS_PATH, 'utf-8'));
  const creds = getCredentials(env);
  const sb = createSb(env);
  const sender = env.OUTREACH_SENDER || process.env.OUTREACH_SENDER || DEFAULT_SENDER;
  const pipelineEmail = env.PROSPECTOR_EMAIL || DEFAULT_SENDER;
  const dfsBudget = parseFloat(env.PROSPECTOR_DFS_BUDGET || '1.50');
  const maxScouts = flags['max-scouts'] ? parseInt(flags['max-scouts'], 10) : seeds.daily_scout_cap;
  const date = todayIso();

  console.log(`\n=== Prospector ${date}${dryRun ? ' (DRY RUN)' : ''} ===\n`);

  // ── Known-domain sets (skip existing prospects, clients, candidates) ──
  const knownDomains = new Set<string>();
  {
    const { data: prospects, error } = await sb.from('prospects').select('domain');
    if (error) throw new Error(`prospects query failed: ${error.message}`);
    for (const p of prospects ?? []) knownDomains.add(normalizeDomain(p.domain));
    const { data: audits, error: aErr } = await sb.from('audits').select('domain');
    if (aErr) throw new Error(`audits query failed: ${aErr.message}`);
    for (const a of audits ?? []) knownDomains.add(normalizeDomain(a.domain));
    const { data: cands, error: cErr } = await sb.from('prospect_candidates').select('domain');
    if (cErr) throw new Error(`prospect_candidates query failed: ${cErr.message} (has migration 045 run?)`);
    for (const c of cands ?? []) knownDomains.add(normalizeDomain(c.domain));
  }
  console.log(`Known domains (prospects + audits + prior candidates): ${knownDomains.size}`);

  // ── 1-2. Discovery ──
  const queries = buildTodaysQueries(seeds);
  let dfsSpend = 0;
  const candidates = new Map<string, Candidate>();
  const excludedCounts: Record<string, number> = {};

  for (const seed of queries) {
    if (dfsSpend >= dfsBudget) {
      console.warn(`DataForSEO budget $${dfsBudget} reached — stopping discovery early.`);
      break;
    }
    try {
      const { items, cost } = await fetchSerp(creds, seed.query, seeds.serp_rank_max);
      dfsSpend += cost;
      let kept = 0;
      for (const item of items) {
        if (item.rank < seeds.serp_rank_min || item.rank > seeds.serp_rank_max) continue;
        const domain = item.domain;
        if (knownDomains.has(domain) || candidates.has(domain)) continue;
        const excluded = isExcluded(domain, seeds);
        if (excluded) {
          excludedCounts[excluded] = (excludedCounts[excluded] ?? 0) + 1;
          continue;
        }
        candidates.set(domain, {
          domain,
          url: item.url,
          serpTitle: item.title,
          serpRank: item.rank,
          seed,
        });
        kept++;
      }
      console.log(`  "${seed.query}" → ${items.length} organic, ${kept} new candidates`);
    } catch (err: any) {
      console.warn(`  ⚠ SERP failed for "${seed.query}": ${err.message}`);
    }
  }
  console.log(
    `\nDiscovery: ${candidates.size} new candidates (excluded: ${JSON.stringify(excludedCounts)}), DFS spend $${dfsSpend.toFixed(2)}\n`,
  );

  // ── Backlog: prior 'discovered' rows compete with today's finds for the
  // qualify slots, so overflow candidates surface on later days instead of
  // being buried forever by the dedup.
  const backlog: Candidate[] = [];
  {
    const { data: rows } = await sb
      .from('prospect_candidates')
      .select('domain, seed_query, vertical, geo, serp_rank')
      .eq('status', 'discovered')
      .order('serp_rank', { ascending: true })
      .limit(seeds.daily_qualify_cap);
    for (const row of rows ?? []) {
      const vertical = seeds.verticals.find((v) => v.key === row.vertical);
      if (!vertical || !row.geo) continue; // vertical removed from seeds — leave buried
      backlog.push({
        domain: row.domain,
        url: `https://${row.domain}/`,
        serpTitle: '',
        serpRank: row.serp_rank ?? 99,
        seed: { query: row.seed_query ?? '', vertical, geo: row.geo },
        fromBacklog: true,
      });
    }
    if (backlog.length > 0) console.log(`Backlog: ${backlog.length} prior discovered candidates competing for qualify slots`);
  }

  // ── 3-4. Qualify (best-ranked first — closer to page 1 = more established) ──
  const toQualify = [...candidates.values(), ...backlog]
    .sort((a, b) => a.serpRank - b.serpRank)
    .slice(0, seeds.daily_qualify_cap);
  const entries: DigestEntry[] = [];

  for (const c of toQualify) {
    const page = await fetchPage(`https://${c.domain}/`);
    c.homepageHtml = page.html;
    c.homepageText = page.ok ? stripHtml(page.html) : '';
    c.signals = page.ok
      ? extractSignals(page.html, page.finalUrl)
      : { fetch_failed: true, https: false };

    try {
      c.qualify = await qualifyCandidate(c);
    } catch (err: any) {
      c.qualify = {
        business_name: c.domain,
        score: 0,
        vertical_fit: 0,
        multi_location: false,
        franchise_or_national: false,
        serves_treasure_valley: false,
        site_quality_issues: [],
        reason: `qualify error: ${err.message}`,
      };
    }
    const q = c.qualify;
    const qualified = q.score >= seeds.min_qualify_score;
    console.log(
      `  ${qualified ? '✓' : '✗'} ${c.domain} — score ${q.score} (${q.reason.slice(0, 100)})`,
    );

    const record = {
      business_name: q.business_name,
      signals: c.signals,
      qualify: q,
      score: q.score,
      status: qualified ? 'qualified' : 'rejected',
      rejection_reason: qualified ? null : q.reason,
    };
    const { error } = c.fromBacklog
      ? await sb.from('prospect_candidates')
          .update({ ...record, updated_at: new Date().toISOString() })
          .eq('domain', c.domain)
      : await sb.from('prospect_candidates').insert({
          ...record,
          domain: c.domain,
          seed_query: c.seed.query,
          vertical: c.seed.vertical.key,
          geo: c.seed.geo,
          serp_rank: c.serpRank,
        });
    if (error) console.warn(`  ⚠ candidate write failed for ${c.domain}: ${error.message}`);
  }

  // Persist the un-qualified overflow as 'discovered' — the backlog pull
  // above resurfaces them on later days.
  for (const c of [...candidates.values()].filter((x) => !toQualify.includes(x))) {
    await sb.from('prospect_candidates').insert({
      domain: c.domain,
      seed_query: c.seed.query,
      vertical: c.seed.vertical.key,
      geo: c.seed.geo,
      serp_rank: c.serpRank,
      status: 'discovered',
    });
  }

  // Previously-qualified candidates (over-cap on earlier days) compete for
  // today's scout slots alongside today's qualifiers.
  const todaysDomains = new Set(toQualify.map((c) => c.domain));
  const priorQualified: Candidate[] = [];
  {
    const { data: rows } = await sb
      .from('prospect_candidates')
      .select('domain, seed_query, vertical, geo, serp_rank, qualify, score')
      .eq('status', 'qualified')
      .order('score', { ascending: false })
      .limit(maxScouts * 2);
    for (const row of rows ?? []) {
      if (todaysDomains.has(row.domain)) continue;
      const vertical = seeds.verticals.find((v) => v.key === row.vertical);
      if (!vertical || !row.geo || !row.qualify) continue;
      priorQualified.push({
        domain: row.domain,
        url: `https://${row.domain}/`,
        serpTitle: '',
        serpRank: row.serp_rank ?? 99,
        seed: { query: row.seed_query ?? '', vertical, geo: row.geo },
        fromBacklog: true,
        qualify: row.qualify as QualifyResult,
      });
    }
  }

  const qualified = [
    ...toQualify.filter((c) => (c.qualify?.score ?? 0) >= seeds.min_qualify_score),
    ...priorQualified,
  ].sort((a, b) => (b.qualify?.score ?? 0) - (a.qualify?.score ?? 0));

  // ── 5-7. Scout → contact → outreach for the top N ──
  const scoutTargets = dryRun ? [] : qualified.slice(0, maxScouts);
  if (dryRun && qualified.length > 0) {
    console.log(`\nDRY RUN — would scout: ${qualified.slice(0, maxScouts).map((c) => c.domain).join(', ')}`);
  }

  for (const c of scoutTargets) {
    const q = c.qualify!;
    const entry: DigestEntry = {
      domain: c.domain,
      name: q.business_name,
      score: q.score,
      rank: c.serpRank,
      query: c.seed.query,
      outcome: 'error',
    };
    entries.push(entry);

    try {
      console.log(`\n── Scouting ${c.domain} (score ${q.score}) ──`);
      // Prior-day qualifiers arrive without a homepage in memory — refetch
      // (config authoring and contact discovery both need it).
      if (!c.homepageHtml) {
        const page = await fetchPage(`https://${c.domain}/`);
        c.homepageHtml = page.html;
        c.homepageText = page.ok ? stripHtml(page.html) : '';
      }
      const { configPath, configJson } = await writeProspectConfig(c);
      entry.configJson = configJson;

      const scriptPath = path.resolve(process.cwd(), 'scripts/run-pipeline.sh');
      const scout = await runChild(
        'bash',
        [scriptPath, c.domain, pipelineEmail, '--mode', 'prospect', '--prospect-config', configPath],
        `scout:${c.domain}`,
        SCOUT_TIMEOUT_MS,
      );
      if (scout.exitCode !== 0) {
        entry.outcome = `scout failed (exit ${scout.exitCode}): ${scout.output.slice(-300)}`;
        await sb.from('prospect_candidates')
          .update({ status: 'error', rejection_reason: entry.outcome.slice(0, 500), updated_at: new Date().toISOString() })
          .eq('domain', c.domain);
        continue;
      }

      // Confirm the scout actually landed (status flips to 'scouted').
      const { data: prospect } = await sb
        .from('prospects')
        .select('id, status, contact_email, contact_name, scout_scope_json')
        .eq('domain', c.domain)
        .maybeSingle();
      if (!prospect || prospect.status !== 'scouted') {
        entry.outcome = `scout exited 0 but prospect status is '${prospect?.status ?? 'missing'}'`;
        continue;
      }
      entry.outcome = 'scouted';
      entry.addressable = prospect.scout_scope_json?.gap_summary?.addressable_revenue_monthly ?? null;

      // Contact discovery — never overwrite manually-entered contacts.
      if (!prospect.contact_email) {
        const contact = await discoverContact(c);
        entry.contactEmail = contact.email;
        if (contact.email) {
          await sb.from('prospects')
            .update({
              contact_email: contact.email,
              contact_name: prospect.contact_name ?? contact.name,
              updated_at: new Date().toISOString(),
            })
            .eq('id', prospect.id);
          console.log(`  Contact: ${contact.email}${contact.name ? ` (${contact.name})` : ''}`);
        } else {
          console.log('  No contact email found — draft will have empty To:');
        }
      } else {
        entry.contactEmail = prospect.contact_email;
      }

      // Outreach draft (script handles variant, idempotency, Gmail).
      const outreach = await runChild(
        'npx',
        ['tsx', 'scripts/generate-outreach-email.ts', '--domain', c.domain],
        `outreach:${c.domain}`,
        OUTREACH_TIMEOUT_MS,
      );
      if (outreach.exitCode === 0) {
        const { data: after } = await sb
          .from('prospects')
          .select('outreach_subject, outreach_variant, outreach_status')
          .eq('id', prospect.id)
          .maybeSingle();
        entry.subject = after?.outreach_subject ?? undefined;
        entry.variant = after?.outreach_variant ?? undefined;
        entry.outcome = after?.outreach_status === 'drafted' ? 'drafted' : 'scouted';
      } else {
        console.warn(`  ⚠ outreach failed: ${outreach.output.slice(-300)}`);
      }

      await sb.from('prospect_candidates')
        .update({
          status: entry.outcome === 'drafted' ? 'drafted' : 'scouted',
          prospect_id: prospect.id,
          updated_at: new Date().toISOString(),
        })
        .eq('domain', c.domain);
    } catch (err: any) {
      entry.outcome = `error: ${err.message}`;
      await sb.from('prospect_candidates')
        .update({ status: 'error', rejection_reason: err.message.slice(0, 500), updated_at: new Date().toISOString() })
        .eq('domain', c.domain);
    }
  }

  // Digest entries for qualified-but-not-scouted and notable rejections.
  for (const c of toQualify) {
    if (scoutTargets.includes(c)) continue;
    const q = c.qualify!;
    entries.push({
      domain: c.domain,
      name: q.business_name,
      score: q.score,
      rank: c.serpRank,
      query: c.seed.query,
      outcome:
        q.score >= seeds.min_qualify_score
          ? `qualified, over daily scout cap${dryRun ? ' (dry run)' : ''}`
          : `rejected: ${q.reason}`,
    });
  }

  // ── 8. Digest ──
  const stats = {
    queries: queries.length,
    found: candidates.size,
    qualified: qualified.length,
    dfsSpend,
  };
  const digest = renderDigest(date, entries, stats);
  console.log(`\n${'='.repeat(60)}\n${digest.subject}\n${'='.repeat(60)}\n${digest.body}\n`);

  if (!dryRun) {
    try {
      const token = await getDelegatedUserAccessToken(sender, [GMAIL_COMPOSE_SCOPE]);
      const draftId = await createDraft(token, {
        to: sender,
        from: sender,
        subject: digest.subject,
        body: digest.body,
      });
      console.log(`Digest draft created: ${draftId}`);
    } catch (err: any) {
      console.warn(`⚠ Digest Gmail draft failed (digest is in logs above): ${err.message}`);
    }
  }

  const drafted = entries.filter((e) => e.outcome === 'drafted').length;
  console.log(
    `\n=== Prospector done: ${stats.found} found, ${stats.qualified} qualified, ${scoutTargets.length} scouted, ${drafted} drafted ===\n`,
  );
}

main().catch((err) => {
  console.error(`cron-prospector failed: ${err.message}`);
  process.exit(1);
});
