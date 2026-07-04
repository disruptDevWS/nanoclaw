/**
 * fetch-page.ts — Single-URL fetch + structured extraction for the page auditor.
 *
 * Fetches one page with native fetch() and parses the raw (pre-JS) HTML with
 * cheerio. What we see here is what a non-rendering AI crawler sees — that gap
 * is itself a signal (Aleyda "Accessible": content hidden behind client-side JS).
 *
 * No crawling — exactly one HTTP request for the page. Site-level files
 * (robots.txt, llms.txt, .well-known/mcp.json) are fetched separately by
 * agent-readiness.ts.
 */

import * as cheerio from 'cheerio';

export interface HeadingEntry {
  level: number;
  text: string;
}

export interface ImageEntry {
  src: string;
  alt: string | null; // null = attribute absent; '' = empty alt (decorative)
}

export interface LinkEntry {
  href: string;
  anchor: string;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  redirected: boolean;
  statusCode: number;
  contentType: string | null;
  lastModifiedHeader: string | null;
  htmlBytes: number;
  lang: string | null;
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  canonical: string | null;
  headings: HeadingEntry[];
  images: ImageEntry[];
  internalLinks: LinkEntry[];
  externalLinkCount: number;
  jsonLd: unknown[];        // parsed JSON-LD blocks (invalid blocks skipped)
  jsonLdParseErrors: number;
  wordCount: number;        // visible text words in raw HTML
  textSample: string;       // first ~4000 chars of visible text (for the LLM)
  hasVisibleDate: boolean;  // <time> element or datePublished/dateModified in schema
}

const PAGE_AUDIT_UA =
  'Mozilla/5.0 (compatible; ForgeOS-PageAudit/1.0; +https://forgegrowth.ai)';

export async function fetchPage(url: string, timeoutMs = 30_000): Promise<FetchedPage> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': PAGE_AUDIT_UA, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(timeoutMs),
  });

  const html = await res.text();
  const $ = cheerio.load(html);
  const pageHost = safeHostname(res.url || url);

  // Strip non-content elements before text extraction
  const $body = $('body').clone();
  $body.find('script, style, noscript, svg, template').remove();
  const visibleText = $body.text().replace(/\s+/g, ' ').trim();

  // JSON-LD blocks
  const jsonLd: unknown[] = [];
  let jsonLdParseErrors = 0;
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      jsonLd.push(JSON.parse(raw));
    } catch {
      jsonLdParseErrors++;
    }
  });

  // Headings in document order
  const headings: HeadingEntry[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    headings.push({
      level: Number(el.tagName[1]),
      text: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 200),
    });
  });

  // Images
  const images: ImageEntry[] = [];
  $('img').each((_, el) => {
    const src = $(el).attr('src') ?? $(el).attr('data-src') ?? '';
    if (!src || src.startsWith('data:')) return;
    const alt = $(el).attr('alt');
    images.push({ src: src.slice(0, 500), alt: alt === undefined ? null : alt });
  });

  // Links, split internal/external by host
  const internalLinks: LinkEntry[] = [];
  let externalLinkCount = 0;
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return;
    let resolved: URL;
    try {
      resolved = new URL(href, res.url || url);
    } catch {
      return;
    }
    if (!/^https?:$/.test(resolved.protocol)) return;
    const host = resolved.hostname.toLowerCase();
    if (host === pageHost || host.endsWith(`.${stripWww(pageHost)}`) || stripWww(host) === stripWww(pageHost)) {
      internalLinks.push({
        href: resolved.pathname + resolved.search,
        anchor: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 120),
      });
    } else {
      externalLinkCount++;
    }
  });

  const schemaText = JSON.stringify(jsonLd);
  const hasVisibleDate =
    $('time').length > 0 || /"date(Published|Modified)"/.test(schemaText);

  return {
    url,
    finalUrl: res.url || url,
    redirected: (res.url || url) !== url,
    statusCode: res.status,
    contentType: res.headers.get('content-type'),
    lastModifiedHeader: res.headers.get('last-modified'),
    htmlBytes: Buffer.byteLength(html, 'utf-8'),
    lang: $('html').attr('lang') ?? null,
    title: $('head title').first().text().trim() || null,
    metaDescription: $('meta[name="description"]').attr('content')?.trim() || null,
    metaRobots: $('meta[name="robots"]').attr('content')?.trim() || null,
    canonical: $('link[rel="canonical"]').attr('href')?.trim() || null,
    headings,
    images,
    internalLinks,
    externalLinkCount,
    jsonLd,
    jsonLdParseErrors,
    wordCount: visibleText ? visibleText.split(' ').length : 0,
    textSample: visibleText.slice(0, 4000),
    hasVisibleDate,
  };
}

/** Fetch a site-level text file (robots.txt, llms.txt). Returns null on non-200. */
export async function fetchSiteFile(
  origin: string,
  filePath: string,
  timeoutMs = 10_000,
): Promise<string | null> {
  try {
    const res = await fetch(new URL(filePath, origin).toString(), {
      headers: { 'User-Agent': PAGE_AUDIT_UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function safeHostname(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function stripWww(host: string): string {
  return host.replace(/^www\./, '');
}
