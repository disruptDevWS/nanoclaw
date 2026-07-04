/**
 * agent-readiness.ts — Code-verified AI-search/agent readiness checks for one page.
 *
 * Built on Aleyda Solis's 3-layer framework (docs/ai-readiness-framework-reference.md).
 * This module covers the page-assessable slice of Layer 2 (Readiness Assessment) —
 * Accessible, Extractable, Recognizable, Fresh, Credible — plus agent-action
 * checks (WebMCP .well-known/mcp.json, schema potentialAction).
 *
 * Every check here is VERIFIED BY CODE (real fetches, real parsing) — unlike the
 * retired Dwight §10.4 scorecard, which had the LLM guess PASS/FAIL. Layer 1
 * (Presence) and Layer 3 (Business Impact) are site/brand-level and covered by
 * track-llm-mentions / ai-visibility-analysis / GA4 — not here.
 */

import type { FetchedPage } from './fetch-page.js';
import { fetchSiteFile } from './fetch-page.js';

export type ReadinessStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface ReadinessCheck {
  characteristic:
    | 'accessible'
    | 'extractable'
    | 'recognizable'
    | 'fresh'
    | 'credible'
    | 'agent_actions';
  check: string;
  status: ReadinessStatus;
  detail: string;
}

export interface AgentReadinessResult {
  checks: ReadinessCheck[];
  /** raw site-file evidence for the LLM prompt */
  robotsTxt: string | null;
  llmsTxt: string | null;
  mcpManifest: string | null;
}

// AI crawlers whose robots.txt treatment determines AI-search accessibility
const AI_BOTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'PerplexityBot',
  'Google-Extended',
  'CCBot',
  'Bytespider',
];

export async function assessAgentReadiness(page: FetchedPage): Promise<AgentReadinessResult> {
  const checks: ReadinessCheck[] = [];
  const origin = new URL(page.finalUrl).origin;

  // ── Site-level evidence (real fetches) ────────────────────────────────────
  // Soft-404 guard: many sites (esp. SPAs) return 200 + the HTML app shell for
  // any path. An HTML body at robots.txt/llms.txt/mcp.json means "absent".
  const looksLikeHtml = (t: string | null): boolean =>
    t != null && /^\s*(<!doctype|<html|<head|<script|<)/i.test(t.slice(0, 200));
  const [robotsRaw, llmsRaw, mcpRaw] = await Promise.all([
    fetchSiteFile(origin, '/robots.txt'),
    fetchSiteFile(origin, '/llms.txt'),
    fetchSiteFile(origin, '/.well-known/mcp.json'),
  ]);
  const robotsTxt = looksLikeHtml(robotsRaw) ? null : robotsRaw;
  const llmsTxt = looksLikeHtml(llmsRaw) ? null : llmsRaw;
  const mcpManifest = looksLikeHtml(mcpRaw) ? null : mcpRaw;

  // ── Accessible ────────────────────────────────────────────────────────────
  checks.push({
    characteristic: 'accessible',
    check: 'HTTP status',
    status: page.statusCode === 200 ? 'pass' : 'fail',
    detail: `Returned ${page.statusCode}${page.redirected ? ` (redirected to ${page.finalUrl})` : ''}`,
  });

  const robots = (page.metaRobots ?? '').toLowerCase();
  checks.push({
    characteristic: 'accessible',
    check: 'Meta robots',
    status: robots.includes('noindex') ? 'fail' : 'pass',
    detail: page.metaRobots ? `meta robots: "${page.metaRobots}"` : 'No meta robots tag (indexable by default)',
  });

  if (robotsTxt == null) {
    checks.push({
      characteristic: 'accessible',
      check: 'robots.txt AI-bot access',
      status: 'warn',
      detail: 'robots.txt not found — all crawlers implicitly allowed, but absence is unusual',
    });
  } else {
    const blocked = AI_BOTS.filter((bot) => botIsBlocked(robotsTxt, bot));
    checks.push({
      characteristic: 'accessible',
      check: 'robots.txt AI-bot access',
      status: blocked.length === 0 ? 'pass' : blocked.length >= AI_BOTS.length / 2 ? 'fail' : 'warn',
      detail:
        blocked.length === 0
          ? `No AI crawler among ${AI_BOTS.length} checked is blocked`
          : `Blocked AI crawlers: ${blocked.join(', ')}`,
    });
  }

  checks.push({
    characteristic: 'accessible',
    check: 'llms.txt',
    status: llmsTxt ? 'pass' : 'info',
    detail: llmsTxt
      ? `llms.txt present (${llmsTxt.length} bytes)`
      : 'No llms.txt — optional but an easy AI-discoverability win',
  });

  checks.push({
    characteristic: 'accessible',
    check: 'Server-rendered content',
    status: page.wordCount >= 100 ? 'pass' : page.wordCount >= 20 ? 'warn' : 'fail',
    detail: `${page.wordCount} words visible in raw HTML (what a non-rendering AI crawler sees)`,
  });

  if (page.canonical) {
    const canonicalMatches = normalizeForCompare(page.canonical) === normalizeForCompare(page.finalUrl);
    checks.push({
      characteristic: 'accessible',
      check: 'Canonical consistency',
      status: canonicalMatches ? 'pass' : 'warn',
      detail: canonicalMatches
        ? 'Canonical is self-referencing'
        : `Canonical points elsewhere: ${page.canonical}`,
    });
  } else {
    checks.push({
      characteristic: 'accessible',
      check: 'Canonical consistency',
      status: 'warn',
      detail: 'No canonical link element',
    });
  }

  // ── Extractable ───────────────────────────────────────────────────────────
  const h1s = page.headings.filter((h) => h.level === 1);
  checks.push({
    characteristic: 'extractable',
    check: 'H1',
    status: h1s.length === 1 ? 'pass' : h1s.length === 0 ? 'fail' : 'warn',
    detail: h1s.length === 1 ? `Single H1: "${h1s[0].text}"` : `${h1s.length} H1 elements`,
  });

  const skips = headingLevelSkips(page.headings);
  checks.push({
    characteristic: 'extractable',
    check: 'Heading hierarchy',
    status: skips === 0 ? 'pass' : 'warn',
    detail: skips === 0 ? 'No heading-level skips' : `${skips} heading-level skip(s) (e.g. H2→H4)`,
  });

  const h2Plus = page.headings.filter((h) => h.level >= 2).length;
  const wordsPerSection = h2Plus > 0 ? Math.round(page.wordCount / h2Plus) : page.wordCount;
  checks.push({
    characteristic: 'extractable',
    check: 'Section granularity',
    status:
      page.wordCount < 200 ? 'info' : h2Plus === 0 ? 'fail' : wordsPerSection <= 400 ? 'pass' : 'warn',
    detail:
      h2Plus === 0
        ? 'No subheadings — content is one undivided block, hard for AI to isolate and quote'
        : `${h2Plus} subheading(s), ~${wordsPerSection} words/section (AI extraction favors self-contained sections)`,
  });

  // ── Recognizable (entity clarity) ─────────────────────────────────────────
  const schemaText = JSON.stringify(page.jsonLd);
  const hasJsonLd = page.jsonLd.length > 0;
  checks.push({
    characteristic: 'recognizable',
    check: 'JSON-LD present',
    status: hasJsonLd ? 'pass' : 'fail',
    detail: hasJsonLd
      ? `${page.jsonLd.length} JSON-LD block(s)${page.jsonLdParseErrors ? `, ${page.jsonLdParseErrors} unparseable` : ''}`
      : `No JSON-LD structured data${page.jsonLdParseErrors ? ` (${page.jsonLdParseErrors} block(s) present but unparseable)` : ''}`,
  });

  if (hasJsonLd) {
    const hasGraph = /"@graph"/.test(schemaText);
    checks.push({
      characteristic: 'recognizable',
      check: '@graph entity graph',
      status: hasGraph ? 'pass' : 'warn',
      detail: hasGraph
        ? '@graph structure present (connected entity graph)'
        : 'JSON-LD blocks are disconnected — no @graph linking entities',
    });

    const idCount = (schemaText.match(/"@id"/g) ?? []).length;
    checks.push({
      characteristic: 'recognizable',
      check: '@id entity IRIs',
      status: idCount > 0 ? 'pass' : 'warn',
      detail: idCount > 0 ? `${idCount} @id IRI(s) — entities are referenceable` : 'No @id IRIs — entities cannot be cross-referenced',
    });

    const hasOrgEntity = /"@type"\s*:\s*"(Organization|LocalBusiness|[A-Za-z]*Business|MedicalOrganization|EducationalOrganization)/.test(schemaText);
    checks.push({
      characteristic: 'recognizable',
      check: 'Organization entity',
      status: hasOrgEntity ? 'pass' : 'warn',
      detail: hasOrgEntity ? 'Organization/LocalBusiness entity declared' : 'No Organization-family entity in page schema',
    });

    const hasSameAs = /"sameAs"/.test(schemaText);
    checks.push({
      characteristic: 'recognizable',
      check: 'sameAs corroboration links',
      status: hasSameAs ? 'pass' : 'warn',
      detail: hasSameAs ? 'sameAs profile links present' : 'No sameAs links tying the entity to external profiles',
    });
  }

  // ── Fresh ─────────────────────────────────────────────────────────────────
  const hasSchemaDate = /"date(Published|Modified)"/.test(schemaText);
  checks.push({
    characteristic: 'fresh',
    check: 'Machine-readable dates',
    status: hasSchemaDate || page.hasVisibleDate ? 'pass' : page.lastModifiedHeader ? 'warn' : 'fail',
    detail: hasSchemaDate
      ? 'datePublished/dateModified in schema'
      : page.hasVisibleDate
        ? 'Visible <time> element (no schema dates)'
        : page.lastModifiedHeader
          ? `Only HTTP Last-Modified header (${page.lastModifiedHeader})`
          : 'No publication/modification dates anywhere — AI cannot assess freshness',
  });

  // ── Credible ──────────────────────────────────────────────────────────────
  const hasAuthor = /"author"/.test(schemaText);
  checks.push({
    characteristic: 'credible',
    check: 'Authorship markup',
    status: hasAuthor ? 'pass' : 'info',
    detail: hasAuthor ? 'author declared in schema' : 'No author markup (matters most for editorial/blog content)',
  });

  // ── Agent actions (WebMCP + schema actions) ───────────────────────────────
  let mcpValid = false;
  if (mcpManifest) {
    try {
      JSON.parse(mcpManifest);
      mcpValid = true;
    } catch {
      mcpValid = false;
    }
  }
  checks.push({
    characteristic: 'agent_actions',
    check: 'WebMCP manifest (.well-known/mcp.json)',
    status: mcpValid ? 'pass' : mcpManifest ? 'warn' : 'info',
    detail: mcpValid
      ? 'Valid mcp.json manifest — site declares agent-callable tools'
      : mcpManifest
        ? 'mcp.json exists but is not valid JSON'
        : 'No WebMCP manifest — site is not yet agent-callable (emerging standard, early-mover advantage)',
  });

  const hasPotentialAction = /"potentialAction"/.test(schemaText);
  checks.push({
    characteristic: 'agent_actions',
    check: 'Schema potentialAction',
    status: hasPotentialAction ? 'pass' : 'warn',
    detail: hasPotentialAction
      ? 'potentialAction declared — transactional intent is machine-readable'
      : 'No potentialAction — booking/contact/purchase affordances are invisible to agents',
  });

  return { checks, robotsTxt, llmsTxt, mcpManifest };
}

/** Minimal robots.txt evaluation: is `bot` disallowed from "/" (or everything)? */
function botIsBlocked(robotsTxt: string, bot: string): boolean {
  const lines = robotsTxt.split('\n').map((l) => l.trim());
  let applies = false;
  let blocked = false;
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':');
    if (!rest.length) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      applies = value === '*' ? applies : value.toLowerCase() === bot.toLowerCase();
      if (value.toLowerCase() === bot.toLowerCase()) blocked = false; // reset for specific group
    } else if (key === 'disallow' && applies) {
      if (value === '/' || value === '/*') blocked = true;
    } else if (key === 'allow' && applies) {
      if (value === '/') blocked = false;
    }
  }
  return blocked;
}

function headingLevelSkips(headings: Array<{ level: number }>): number {
  let skips = 0;
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level > headings[i - 1].level + 1) skips++;
  }
  return skips;
}

function normalizeForCompare(u: string): string {
  try {
    const parsed = new URL(u);
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}
