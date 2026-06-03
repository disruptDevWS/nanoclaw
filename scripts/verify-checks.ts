/**
 * verify-checks.ts — Reusable HTTP verification checks for Dwight's findings.
 *
 * Extracted from verify-dwight.ts (Phase 1a) so they can run inline
 * during Phase 1 (runDwight) before the Claude call, producing accurate
 * executive summaries from the start.
 *
 *   Check A — Sitemap existence (HEAD /sitemap.xml, /sitemap_index.xml)
 *   Check B — Schema/structured data presence (GET homepage, parse ld+json)
 *   Check C — Redirect chain integrity (follow 3xx URLs with missing destinations)
 *   Check D — Robots.txt verification (GET /robots.txt, parse Disallow rules)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================================
// Types
// ============================================================

export interface VerificationCheck {
  check_id: string;
  check_name: string;
  passed: boolean;
  details: string;
  verified_at: string;
  verification_source: string;
}

export interface FixCorrection {
  issue_pattern: string;
  finding: string;
  status: 'false_positive' | 'verified' | 'flagged';
  verified_at: string;
  verification_source: string;
  original_priority_tier?: number;
}

export interface RedirectResult {
  source_url: string;
  status_code: number;
  terminal_url: string;
  terminal_status: number;
  hops: number;
  chain_clean: boolean;
  error?: string;
}

export interface VerificationResults {
  domain: string;
  verified_at: string;
  checks: VerificationCheck[];
  corrections: FixCorrection[];
  redirect_audit: RedirectResult[];
}

// ============================================================
// Check A — Sitemap Existence
// ============================================================

export async function checkSitemap(domain: string): Promise<VerificationCheck> {
  const now = new Date().toISOString();
  const candidates = [
    `https://${domain}/sitemap.xml`,
    `https://${domain}/sitemap_index.xml`,
    `https://www.${domain}/sitemap.xml`,
    `https://www.${domain}/sitemap_index.xml`,
  ];

  const found: string[] = [];

  for (const url of candidates) {
    try {
      const resp = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) {
        found.push(url);
      }
    } catch {
      // timeout or network error — skip
    }
  }

  return {
    check_id: 'sitemap_existence',
    check_name: 'Sitemap Existence',
    passed: found.length > 0,
    details: found.length > 0
      ? `Sitemap confirmed at: ${found.join(', ')}`
      : `No sitemap found at any candidate path (${candidates.join(', ')})`,
    verified_at: now,
    verification_source: 'direct_http',
  };
}

// ============================================================
// Check B — Schema / Structured Data Presence
// ============================================================

export async function checkSchema(domain: string): Promise<VerificationCheck> {
  const now = new Date().toISOString();

  const urls = [`https://${domain}/`, `https://www.${domain}/`];
  let html = '';
  let fetchedUrl = '';

  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; ForgeOS/1.0; +https://forgegrowth.ai)',
        },
      });
      if (resp.ok) {
        html = await resp.text();
        fetchedUrl = url;
        break;
      }
    } catch {
      // try next
    }
  }

  if (!html) {
    return {
      check_id: 'schema_presence',
      check_name: 'Schema / Structured Data Presence',
      passed: false,
      details: 'Could not fetch homepage HTML — schema check inconclusive',
      verified_at: now,
      verification_source: 'direct_http',
    };
  }

  const ldJsonBlocks: string[] = [];
  const ldJsonRegex =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = ldJsonRegex.exec(html)) !== null) {
    ldJsonBlocks.push(match[1].trim());
  }

  const hasYoastGraph = html.includes('yoast-schema-graph') || html.includes('schema-graph');

  const types = new Set<string>();
  for (const block of ldJsonBlocks) {
    try {
      const parsed = JSON.parse(block);
      extractTypes(parsed, types);
    } catch {
      // malformed JSON-LD — still counts as "present"
    }
  }

  const hasSchema = ldJsonBlocks.length > 0;

  return {
    check_id: 'schema_presence',
    check_name: 'Schema / Structured Data Presence',
    passed: hasSchema,
    details: hasSchema
      ? `${ldJsonBlocks.length} JSON-LD block(s) found on ${fetchedUrl}. ` +
        `Types: ${types.size > 0 ? Array.from(types).join(', ') : 'unparseable'}. ` +
        `Yoast graph: ${hasYoastGraph ? 'yes' : 'no'}`
      : `No JSON-LD or Yoast schema found on ${fetchedUrl}`,
    verified_at: now,
    verification_source: 'direct_http',
  };
}

function extractTypes(obj: any, types: Set<string>): void {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) extractTypes(item, types);
    return;
  }
  if (obj['@type']) {
    const t = obj['@type'];
    if (Array.isArray(t)) t.forEach((v: string) => types.add(v));
    else types.add(t);
  }
  if (obj['@graph'] && Array.isArray(obj['@graph'])) {
    for (const node of obj['@graph']) extractTypes(node, types);
  }
}

// ============================================================
// Check D — Robots.txt Verification
// ============================================================

const ROBOTS_AGENTS_OF_INTEREST = [
  '*',
  'googlebot',
  'gptbot',
  'claudebot',
  'bytespider',
  'chatgpt-user',
  'google-extended',
  'ccbot',
  'anthropic-ai',
];

interface RobotsDirective {
  user_agent: string;
  disallow: string[];
  allow: string[];
}

function parseRobotsTxt(raw: string): RobotsDirective[] {
  const directives: RobotsDirective[] = [];
  let current: RobotsDirective | null = null;

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;

    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === 'user-agent') {
      current = { user_agent: value, disallow: [], allow: [] };
      directives.push(current);
    } else if (field === 'disallow' && current) {
      if (value) current.disallow.push(value);
    } else if (field === 'allow' && current) {
      if (value) current.allow.push(value);
    }
  }

  return directives;
}

function hasBroadBlock(d: RobotsDirective): boolean {
  return d.disallow.some((rule) => rule === '/');
}

export async function checkRobotsTxt(domain: string): Promise<VerificationCheck & { robotsContent?: string; parsedDirectives?: RobotsDirective[] }> {
  const now = new Date().toISOString();
  const candidates = [
    `https://${domain}/robots.txt`,
    `https://www.${domain}/robots.txt`,
  ];

  let robotsTxt = '';
  let fetchedUrl = '';

  for (const url of candidates) {
    try {
      const resp = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ForgeOS/1.0; +https://forgegrowth.ai)',
        },
      });
      if (resp.ok) {
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('text/plain') || contentType.includes('text/html')) {
          const body = await resp.text();
          if (body.toLowerCase().includes('user-agent') || body.toLowerCase().includes('disallow')) {
            robotsTxt = body;
            fetchedUrl = url;
            break;
          }
        }
      }
    } catch {
      // timeout or network error — try next
    }
  }

  if (!robotsTxt) {
    return {
      check_id: 'robots_txt',
      check_name: 'Robots.txt Verification',
      passed: true,
      details: `No valid robots.txt found at ${candidates.join(' or ')} — no crawl restrictions in place`,
      verified_at: now,
      verification_source: 'direct_http',
    };
  }

  const directives = parseRobotsTxt(robotsTxt);

  const relevant = directives.filter((d) =>
    ROBOTS_AGENTS_OF_INTEREST.includes(d.user_agent.toLowerCase()),
  );

  const blockedAgents: string[] = [];
  const restrictedAgents: { agent: string; rules: string[] }[] = [];

  for (const d of relevant) {
    if (hasBroadBlock(d)) {
      blockedAgents.push(d.user_agent);
    } else if (d.disallow.length > 0) {
      restrictedAgents.push({ agent: d.user_agent, rules: d.disallow });
    }
  }

  const hasBlocking = blockedAgents.length > 0 || restrictedAgents.length > 0;

  let details = `Fetched ${fetchedUrl}. ${directives.length} user-agent directive(s) found. `;
  if (blockedAgents.length > 0) {
    details += `Broad blocking (Disallow: /) for: ${blockedAgents.join(', ')}. `;
  }
  if (restrictedAgents.length > 0) {
    details += `Partial restrictions for: ${restrictedAgents.map((r) => `${r.agent} (${r.rules.join(', ')})`).join('; ')}. `;
  }
  if (!hasBlocking) {
    details += 'No broad Disallow rules found for search engines or AI crawlers.';
  }

  return {
    check_id: 'robots_txt',
    check_name: 'Robots.txt Verification',
    passed: !hasBlocking,
    details,
    verified_at: now,
    verification_source: 'direct_http',
    robotsContent: robotsTxt,
    parsedDirectives: directives,
  };
}

// ============================================================
// Check C — Redirect Chain Integrity
// ============================================================

export async function checkRedirects(
  auditorDir: string,
): Promise<{ check: VerificationCheck; redirectResults: RedirectResult[] }> {
  const now = new Date().toISOString();
  const redirectResults: RedirectResult[] = [];

  const csvPath = path.join(auditorDir, 'internal_all.csv');
  if (!fs.existsSync(csvPath)) {
    return {
      check: {
        check_id: 'redirect_integrity',
        check_name: 'Redirect Chain Integrity',
        passed: true,
        details: 'No internal_all.csv found — redirect check skipped',
        verified_at: now,
        verification_source: 'direct_http',
      },
      redirectResults: [],
    };
  }

  let csvContent = fs.readFileSync(csvPath, 'utf-8');
  if (csvContent.charCodeAt(0) === 0xfeff) csvContent = csvContent.slice(1);

  const lines = csvContent.split('\n');
  if (lines.length < 2) {
    return {
      check: {
        check_id: 'redirect_integrity',
        check_name: 'Redirect Chain Integrity',
        passed: true,
        details: 'No data rows in internal_all.csv — redirect check skipped',
        verified_at: now,
        verification_source: 'direct_http',
      },
      redirectResults: [],
    };
  }

  const header = parseCsvLine(lines[0]);
  const addrIdx = header.findIndex((h) => h.toLowerCase() === 'address');
  const statusIdx = header.findIndex((h) => h.toLowerCase() === 'status code');
  const redirectUrlIdx = header.findIndex((h) => h.toLowerCase() === 'redirect url');

  if (addrIdx < 0 || statusIdx < 0) {
    return {
      check: {
        check_id: 'redirect_integrity',
        check_name: 'Redirect Chain Integrity',
        passed: true,
        details: 'Could not find Address/Status Code columns — redirect check skipped',
        verified_at: now,
        verification_source: 'direct_http',
      },
      redirectResults: [],
    };
  }

  const redirectUrls: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCsvLine(lines[i]);
    const statusCode = parseInt(cols[statusIdx] || '0', 10);
    const redirectUrl = redirectUrlIdx >= 0 ? (cols[redirectUrlIdx] || '').trim() : '';

    if (statusCode >= 300 && statusCode < 400) {
      if (!redirectUrl) {
        redirectUrls.push(cols[addrIdx] || '');
      }
    }
  }

  const redirectCsvCandidates = [
    path.join(auditorDir, 'response_codes_redirection_3xx.csv'),
    path.join(auditorDir, 'redirection_3xx.csv'),
  ];
  for (const csvFile of redirectCsvCandidates) {
    if (!fs.existsSync(csvFile)) continue;
    let content = fs.readFileSync(csvFile, 'utf-8');
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
    const rLines = content.split('\n');
    if (rLines.length < 2) continue;
    const rHeader = parseCsvLine(rLines[0]);
    const rAddrIdx = rHeader.findIndex((h) => h.toLowerCase() === 'address');
    const rRedirectIdx = rHeader.findIndex((h) => h.toLowerCase() === 'redirect url');
    if (rAddrIdx < 0) continue;
    for (let i = 1; i < rLines.length; i++) {
      if (!rLines[i].trim()) continue;
      const cols = parseCsvLine(rLines[i]);
      const addr = (cols[rAddrIdx] || '').trim();
      const dest = rRedirectIdx >= 0 ? (cols[rRedirectIdx] || '').trim() : '';
      if (addr && !dest && !redirectUrls.includes(addr)) {
        redirectUrls.push(addr);
      }
    }
  }

  if (redirectUrls.length === 0) {
    return {
      check: {
        check_id: 'redirect_integrity',
        check_name: 'Redirect Chain Integrity',
        passed: true,
        details: 'All 3xx redirects have captured destinations — no verification needed',
        verified_at: now,
        verification_source: 'direct_http',
      },
      redirectResults: [],
    };
  }

  console.log(
    `  [verify] Following ${redirectUrls.length} redirect(s) with missing destinations...`,
  );

  const urlsToCheck = redirectUrls.slice(0, 50);
  for (const sourceUrl of urlsToCheck) {
    const result = await followRedirectChain(sourceUrl);
    redirectResults.push(result);
  }

  const broken = redirectResults.filter((r) => !r.chain_clean);

  return {
    check: {
      check_id: 'redirect_integrity',
      check_name: 'Redirect Chain Integrity',
      passed: broken.length === 0,
      details:
        `Verified ${redirectResults.length} redirect chain(s). ` +
        (broken.length > 0
          ? `${broken.length} broken chain(s): ${broken.map((b) => b.source_url).join(', ')}`
          : 'All chains resolve cleanly.'),
      verified_at: now,
      verification_source: 'direct_http',
    },
    redirectResults,
  };
}

async function followRedirectChain(url: string): Promise<RedirectResult> {
  let currentUrl = url;
  let hops = 0;
  const maxHops = 10;
  let lastStatus = 0;

  while (hops < maxHops) {
    try {
      const resp = await fetch(currentUrl, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });

      lastStatus = resp.status;

      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get('location');
        if (!location) {
          return {
            source_url: url,
            status_code: resp.status,
            terminal_url: currentUrl,
            terminal_status: resp.status,
            hops,
            chain_clean: false,
            error: `3xx response at ${currentUrl} with no Location header`,
          };
        }
        currentUrl = new URL(location, currentUrl).href;
        hops++;
        continue;
      }

      return {
        source_url: url,
        status_code: lastStatus,
        terminal_url: currentUrl,
        terminal_status: resp.status,
        hops,
        chain_clean: resp.status >= 200 && resp.status < 400,
      };
    } catch (err: any) {
      return {
        source_url: url,
        status_code: 0,
        terminal_url: currentUrl,
        terminal_status: 0,
        hops,
        chain_clean: false,
        error: err.message || 'Network error following redirect',
      };
    }
  }

  return {
    source_url: url,
    status_code: lastStatus,
    terminal_url: currentUrl,
    terminal_status: 0,
    hops,
    chain_clean: false,
    error: `Redirect loop — exceeded ${maxHops} hops`,
  };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ============================================================
// Run all checks + write verification_results.json
// ============================================================

export async function runAllVerificationChecks(
  domain: string,
  auditorDir: string,
): Promise<VerificationResults> {
  console.log('  [verify] Running HTTP verification checks (sitemap, schema, redirects, robots.txt)...');

  const [sitemapCheck, schemaCheck, redirectCheck, robotsCheck] = await Promise.all([
    checkSitemap(domain),
    checkSchema(domain),
    checkRedirects(auditorDir),
    checkRobotsTxt(domain),
  ]);

  const checks = [sitemapCheck, schemaCheck, redirectCheck.check, robotsCheck];

  for (const check of checks) {
    const icon = check.passed ? 'PASS' : 'FAIL';
    console.log(`  [verify] ${check.check_name}: [${icon}] ${check.details}`);
  }

  const results: VerificationResults = {
    domain,
    verified_at: new Date().toISOString(),
    checks,
    corrections: [],
    redirect_audit: redirectCheck.redirectResults,
  };

  // Write verification_results.json for audit trail
  const resultsPath = path.join(auditorDir, 'verification_results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`  [verify] Wrote ${resultsPath}`);

  return results;
}

/**
 * Build a concise prompt section summarizing verified facts for Dwight.
 * Injected into the Claude prompt so the executive summary is accurate.
 */
export function buildVerificationPromptSection(results: VerificationResults): string {
  const lines: string[] = [
    '## Independent HTTP Verification Results',
    'The following checks were performed via direct HTTP requests against the live site AFTER the crawl.',
    'These results are authoritative and OVERRIDE any contradictory signals from the crawl data.',
    'Do NOT flag verified items as issues in the executive summary or prioritized fix list.',
    '',
  ];

  for (const check of results.checks) {
    const icon = check.passed ? 'PASS' : 'FAIL';
    lines.push(`### ${check.check_name}: [${icon}]`);
    lines.push(check.details);
    lines.push('');
  }

  return lines.join('\n');
}
