/**
 * site-inventory.ts — Resolve a prospect site's page inventory for Bucket B.
 *
 * robots.txt (Sitemap: directives) → sitemap.xml / sitemap_index.xml →
 * homepage nav links. Reuses the page-audit fetch primitives (cheerio,
 * pre-JS HTML — spec: fetch+parse first, render is not the front door).
 *
 * The quality signal gates verdicts upstream: only a sitemap-backed
 * ('complete') inventory may mint ABSENT — a nav-only inventory that misses
 * a page and then "confirms" an absence claim would re-commit the invalid
 * inference the verifier exists to catch (approved decision, 2026-07-22).
 * Render escalation is deferred (no Playwright dep); JS-only-nav sites land
 * in nav_only/thin and their claims flag to manual review.
 */

import * as cheerio from 'cheerio';
import { fetchPage, fetchSiteFile } from '../page-audit/fetch-page.js';
import type { InventoryPage, SiteInventory } from './types.js';

const MAX_CHILD_SITEMAPS = 5;
const MAX_SITEMAP_URLS = 2000;
/** Below this many nav links a nav-only inventory is too thin to mean anything. */
const NAV_MIN_LINKS = 5;

const NON_PAGE_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|mp4|webm|zip|docx?|xlsx?|xml|txt|css|js)(\?|$)/i;

function toPath(u: string, origin: string): string | null {
  try {
    const url = new URL(u, origin);
    const originHost = new URL(origin).hostname.replace(/^www\./, '');
    if (url.hostname.replace(/^www\./, '') !== originHost) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

function parseSitemapXml(xml: string): { locs: string[]; isIndex: boolean } {
  const $ = cheerio.load(xml, { xmlMode: true });
  const isIndex = $('sitemapindex').length > 0;
  const locs: string[] = [];
  $(isIndex ? 'sitemap > loc' : 'url > loc').each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) locs.push(loc);
  });
  return { locs, isIndex };
}

function sitemapUrlsFromRobots(robots: string): string[] {
  return robots
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^sitemap:/i.test(l))
    .map((l) => l.slice(l.indexOf(':') + 1).trim())
    .filter(Boolean);
}

export async function resolveSiteInventory(domain: string): Promise<SiteInventory> {
  const origin = `https://${domain}`;
  const sourcesTried: string[] = [];
  const errors: string[] = [];
  const byPath = new Map<string, InventoryPage>();
  let sitemapParsed = false;
  let blocked = false;

  // 1. robots.txt → declared sitemap URLs
  sourcesTried.push('robots');
  const robots = await fetchSiteFile(origin, '/robots.txt');
  const sitemapCandidates = [
    ...(robots ? sitemapUrlsFromRobots(robots) : []),
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
  ];

  // 2. First parseable sitemap wins; index files expand into children.
  sourcesTried.push('sitemap');
  for (const smUrl of [...new Set(sitemapCandidates)]) {
    let xml: string | null = null;
    try {
      const res = await fetch(smUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ForgeOS-OutreachVerify/1.0; +https://forgegrowth.ai)' },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 403 || res.status === 429) blocked = true;
      if (!res.ok) continue;
      xml = await res.text();
    } catch (err: any) {
      errors.push(`sitemap ${smUrl}: ${err.message}`);
      continue;
    }
    let parsed;
    try {
      parsed = parseSitemapXml(xml);
    } catch (err: any) {
      errors.push(`sitemap parse ${smUrl}: ${err.message}`);
      continue;
    }
    let locs = parsed.locs;
    if (parsed.isIndex) {
      const children = locs.slice(0, MAX_CHILD_SITEMAPS);
      if (locs.length > MAX_CHILD_SITEMAPS) {
        errors.push(`sitemap index has ${locs.length} children; only first ${MAX_CHILD_SITEMAPS} read`);
      }
      locs = [];
      for (const child of children) {
        const childXml = await fetchSiteFile(origin, child).catch(() => null);
        if (!childXml) {
          errors.push(`child sitemap unreadable: ${child}`);
          continue;
        }
        try {
          locs.push(...parseSitemapXml(childXml).locs);
        } catch (err: any) {
          errors.push(`child sitemap parse ${child}: ${err.message}`);
        }
      }
    }
    if (locs.length === 0) continue;
    sitemapParsed = true;
    for (const loc of locs.slice(0, MAX_SITEMAP_URLS)) {
      const p = toPath(loc, origin);
      if (!p || NON_PAGE_EXT.test(p)) continue;
      if (!byPath.has(p)) byPath.set(p, { url: p, title: null, h1: null, nav_label: null, source: 'sitemap' });
    }
    if (locs.length > MAX_SITEMAP_URLS) errors.push(`sitemap truncated at ${MAX_SITEMAP_URLS} URLs`);
    break;
  }

  // 3. Homepage nav — labels are match signal even when the sitemap exists.
  sourcesTried.push('homepage_nav');
  try {
    const home = await fetchPage(origin);
    if (home.statusCode === 403 || home.statusCode === 429) blocked = true;
    if (home.statusCode >= 400) {
      errors.push(`homepage HTTP ${home.statusCode}`);
    } else {
      for (const link of home.internalLinks) {
        if (NON_PAGE_EXT.test(link.href)) continue;
        const existing = byPath.get(link.href);
        if (existing) {
          if (!existing.nav_label && link.anchor) existing.nav_label = link.anchor;
        } else {
          byPath.set(link.href, { url: link.href, title: null, h1: null, nav_label: link.anchor || null, source: 'nav' });
        }
      }
    }
  } catch (err: any) {
    errors.push(`homepage fetch: ${err.message}`);
  }

  const navCount = [...byPath.values()].filter((p) => p.source === 'nav' || p.nav_label).length;
  const quality = sitemapParsed ? 'complete' : navCount >= NAV_MIN_LINKS ? 'nav_only' : 'thin';

  return {
    origin,
    quality,
    sources_tried: sourcesTried,
    page_count: byPath.size,
    pages: [...byPath.values()],
    blocked,
    errors,
  };
}

/** Fetch one candidate page's title/H1 for evidence. Throws on network error. */
export async function inspectPage(
  origin: string,
  pagePath: string,
): Promise<{ statusCode: number; title: string | null; h1: string | null }> {
  const page = await fetchPage(new URL(pagePath, origin).toString());
  const h1 = page.headings.find((h) => h.level === 1)?.text ?? null;
  return { statusCode: page.statusCode, title: page.title, h1 };
}
