/**
 * score-page.ts — Mechanical (code-computed, no LLM) per-page optimization scoring.
 *
 * Two entry points sharing one check vocabulary:
 *  - scoreCrawlRow():  from a Screaming-Frog-compatible crawl row (internal_all.csv)
 *    — run for EVERY page during syncDwight, populating
 *    agent_technical_pages.optimization_profile / optimization_score. This is the
 *    site-wide optimization worklist for established sites: cheap, deterministic,
 *    zero LLM spend.
 *  - scoreFetchedPage(): from a live single-URL fetch (scripts/audit-page.ts)
 *    — richer signal set (images, headings, schema actually parsed).
 *
 * Score: starts at 100, penalties subtract, floor 0. Checks a context cannot
 * observe are skipped, never penalized.
 */

import type { FetchedPage } from './fetch-page.js';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface OptimizationCheck {
  category: 'metadata' | 'headers' | 'images' | 'links' | 'schema' | 'content' | 'indexability';
  check: string;
  status: CheckStatus;
  detail?: string;
  penalty: number;
}

export interface OptimizationProfile {
  score: number; // 0-100
  checks: OptimizationCheck[];
  computed_from: 'crawl' | 'fetch';
}

const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESC_MIN = 70;
const DESC_MAX = 155;

function finalize(checks: OptimizationCheck[], from: 'crawl' | 'fetch'): OptimizationProfile {
  const score = Math.max(0, 100 - checks.reduce((s, c) => s + c.penalty, 0));
  return { score: Math.round(score), checks, computed_from: from };
}

function check(
  category: OptimizationCheck['category'],
  name: string,
  ok: boolean | 'warn',
  failPenalty: number,
  detail?: string,
): OptimizationCheck {
  const status: CheckStatus = ok === true ? 'pass' : ok === 'warn' ? 'warn' : 'fail';
  return {
    category,
    check: name,
    status,
    detail,
    penalty: status === 'pass' ? 0 : status === 'warn' ? Math.ceil(failPenalty / 2) : failPenalty,
  };
}

// ── Shared core over a normalized shape ──────────────────────────────────────

interface CoreFacts {
  statusCode: number | null;
  indexability: string | null;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  wordCount: number | null;
  inlinksCount: number | null;
  outlinksCount: number | null;
  canonical: string | null;
}

function coreChecks(f: CoreFacts): OptimizationCheck[] {
  const checks: OptimizationCheck[] = [];

  if (f.statusCode != null) {
    checks.push(check('indexability', 'HTTP 200', f.statusCode === 200, 20, `status ${f.statusCode}`));
  }
  if (f.indexability != null) {
    const indexable = /indexable/i.test(f.indexability) && !/non-?indexable/i.test(f.indexability);
    checks.push(check('indexability', 'Indexable', indexable, 15, f.indexability));
  }

  const titleLen = (f.title ?? '').length;
  checks.push(check('metadata', 'Title present', titleLen > 0, 10, f.title ?? 'missing'));
  if (titleLen > 0) {
    checks.push(
      check(
        'metadata',
        'Title length',
        titleLen >= TITLE_MIN && titleLen <= TITLE_MAX ? true : 'warn',
        6,
        `${titleLen} chars (target ${TITLE_MIN}-${TITLE_MAX})`,
      ),
    );
  }

  const descLen = (f.metaDescription ?? '').length;
  checks.push(check('metadata', 'Meta description present', descLen > 0, 8, descLen ? undefined : 'missing'));
  if (descLen > 0) {
    checks.push(
      check(
        'metadata',
        'Meta description length',
        descLen >= DESC_MIN && descLen <= DESC_MAX ? true : 'warn',
        6,
        `${descLen} chars (target ${DESC_MIN}-${DESC_MAX})`,
      ),
    );
  }

  checks.push(check('headers', 'H1 present', !!(f.h1 && f.h1.trim()), 8, f.h1 ?? 'missing'));
  if (f.title && f.h1 && f.title.trim().toLowerCase() === f.h1.trim().toLowerCase()) {
    checks.push(check('headers', 'Title/H1 differentiation', 'warn', 4, 'Title and H1 are identical — wasted keyword surface'));
  }

  if (f.wordCount != null) {
    checks.push(
      check(
        'content',
        'Content depth',
        f.wordCount >= 300 ? true : f.wordCount >= 120 ? 'warn' : false,
        10,
        `${f.wordCount} words`,
      ),
    );
  }

  if (f.inlinksCount != null) {
    checks.push(
      check(
        'links',
        'Internal inlinks',
        f.inlinksCount >= 3 ? true : f.inlinksCount >= 1 ? 'warn' : false,
        10,
        `${f.inlinksCount} inlinks${f.inlinksCount === 0 ? ' — orphan page' : ''}`,
      ),
    );
  }
  if (f.outlinksCount != null) {
    checks.push(check('links', 'Outgoing links', f.outlinksCount >= 1 ? true : 'warn', 4, `${f.outlinksCount} outlinks`));
  }

  checks.push(check('metadata', 'Canonical present', !!f.canonical, 4));

  return checks;
}

// ── Crawl-row entry point (syncDwight batch) ─────────────────────────────────

/**
 * Row shape: raw CSV columns from onpage-to-csv.ts internal_all.csv
 * (Screaming Frog-compatible headers).
 */
export function scoreCrawlRow(r: Record<string, string>): OptimizationProfile {
  const checks = coreChecks({
    statusCode: parseInt(r['Status Code'] || '0', 10) || null,
    indexability: r['Indexability'] || null,
    title: r['Title 1'] || null,
    metaDescription: r['Meta Description 1'] || null,
    h1: r['H1-1'] || null,
    wordCount: parseInt(r['Word Count'] || '0', 10) || null,
    inlinksCount: r['Inlinks'] !== undefined && r['Inlinks'] !== '' ? parseInt(r['Inlinks'] || '0', 10) : null,
    outlinksCount: r['Outlinks'] !== undefined && r['Outlinks'] !== '' ? parseInt(r['Outlinks'] || '0', 10) : null,
    canonical: r['Canonical Link Element 1'] || null,
  });

  // Schema visibility from crawl columns when present (onpage-to-csv Schema CSV
  // columns may be merged into crawl_data; internal_all itself may lack them)
  const schemaTypes = r['Schema Type 1'] || r['Schema.org Type 1'] || '';
  if (schemaTypes) {
    checks.push(check('schema', 'Structured data present', true, 8, schemaTypes));
  }

  return finalize(checks, 'crawl');
}

// ── Fetched-page entry point (deep dive) ─────────────────────────────────────

export function scoreFetchedPage(p: FetchedPage): OptimizationProfile {
  const h1 = p.headings.find((h) => h.level === 1)?.text ?? null;
  const checks = coreChecks({
    statusCode: p.statusCode,
    indexability: p.metaRobots && /noindex/i.test(p.metaRobots) ? 'Non-Indexable (meta robots)' : 'Indexable',
    title: p.title,
    metaDescription: p.metaDescription,
    h1,
    wordCount: p.wordCount,
    inlinksCount: null, // inbound links unknowable from a single fetch
    outlinksCount: p.internalLinks.length,
    canonical: p.canonical,
  });

  // Images: alt-text coverage
  if (p.images.length > 0) {
    const missing = p.images.filter((i) => i.alt === null).length;
    checks.push(
      check(
        'images',
        'Image alt text',
        missing === 0 ? true : missing <= Math.ceil(p.images.length * 0.2) ? 'warn' : false,
        8,
        `${missing}/${p.images.length} images missing alt attribute`,
      ),
    );
  }

  // Multiple H1s
  const h1Count = p.headings.filter((h) => h.level === 1).length;
  if (h1Count > 1) {
    checks.push(check('headers', 'Single H1', 'warn', 4, `${h1Count} H1 elements`));
  }

  // Schema
  checks.push(check('schema', 'JSON-LD present', p.jsonLd.length > 0, 8, `${p.jsonLd.length} block(s)`));
  if (p.jsonLd.length > 0) {
    const schemaText = JSON.stringify(p.jsonLd);
    checks.push(check('schema', '@graph structure', /"@graph"/.test(schemaText) ? true : 'warn', 6));
    checks.push(check('schema', '@id entity IRIs', /"@id"/.test(schemaText) ? true : 'warn', 4));
  }
  if (p.jsonLdParseErrors > 0) {
    checks.push(check('schema', 'JSON-LD validity', false, 8, `${p.jsonLdParseErrors} unparseable block(s)`));
  }

  return finalize(checks, 'fetch');
}
