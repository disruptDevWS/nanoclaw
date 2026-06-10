/**
 * cannibalization.ts — Detect cannibalizing client page pairs within a cluster.
 *
 * Two client pages ranking for keywords in the same cluster whose content
 * embeddings (title + h1 + meta description) exceed CANNIBALIZATION_THRESHOLD
 * similarity are flagged as a potential cannibalization conflict.
 *
 * Zero API cost beyond embeddings: page content comes from Dwight crawl data
 * (disk CSV or agent_technical_pages fallback) — no page fetches.
 */

import { embedBatch, cosineSimilarity } from '../../embeddings/index.js';
import type { PageMeta } from './crawl-meta.js';

// Strict > — matches syncDwight NEAR_DUP_THRESHOLD semantics.
export const CANNIBALIZATION_THRESHOLD = 0.90;

export interface CannibalizationPair {
  canonical_key: string;
  page_a_url: string;
  page_b_url: string;
  similarity: number;
}

/**
 * Normalize a URL for cross-source matching (DataForSEO ranking_url vs
 * Screaming Frog crawl Address): lowercase host, strip www/query/fragment/
 * trailing slash. Returns `host/path` without protocol.
 */
export function normalizeUrl(u: string): string {
  const raw = u.trim();
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${host}${pathname}`;
  } catch {
    return raw
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split(/[?#]/)[0]
      .replace(/\/+$/, '');
  }
}

/** Build the embeddable content string for a page. */
function pageText(meta: PageMeta): string {
  return [meta.title, meta.h1, meta.metaDescription]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' | ');
}

/**
 * Detect cannibalizing page pairs per cluster.
 *
 * @param clusterUrls  canonical_key → normalized client URLs ranking in that cluster
 * @param pageMeta     normalized URL → crawl metadata (title/h1/meta)
 * @param threshold    similarity above which (strict >) a pair is flagged
 */
export async function detectCannibalization(
  clusterUrls: Map<string, string[]>,
  pageMeta: Map<string, PageMeta>,
  threshold: number = CANNIBALIZATION_THRESHOLD,
): Promise<CannibalizationPair[]> {
  // 1. Collect unique URLs across clusters with 2+ distinct URLs and crawl meta
  const candidateUrls = new Set<string>();
  const eligibleClusters: Array<{ key: string; urls: string[] }> = [];

  for (const [key, urls] of clusterUrls) {
    const distinct = [...new Set(urls)].filter((u) => {
      const meta = pageMeta.get(u);
      return meta != null && pageText(meta).length > 0;
    });
    if (distinct.length < 2) continue;
    eligibleClusters.push({ key, urls: distinct });
    for (const u of distinct) candidateUrls.add(u);
  }

  if (eligibleClusters.length === 0) return [];

  // 2. Embed each unique URL's content once
  const urlList = [...candidateUrls];
  const items = urlList.map((u) => ({
    text: pageText(pageMeta.get(u)!),
    contentType: 'page_meta' as const,
    contentId: `page_meta:${u}`,
  }));
  const embeddings = await embedBatch(items);

  const embByUrl = new Map<string, number[]>();
  for (let i = 0; i < urlList.length; i++) {
    const emb = embeddings[i]?.embedding;
    if (emb) embByUrl.set(urlList[i], emb);
  }

  // 3. Pairwise comparison (i < j) within each cluster
  const pairs: CannibalizationPair[] = [];
  for (const { key, urls } of eligibleClusters) {
    for (let i = 0; i < urls.length; i++) {
      const embA = embByUrl.get(urls[i]);
      if (!embA) continue;
      for (let j = i + 1; j < urls.length; j++) {
        const embB = embByUrl.get(urls[j]);
        if (!embB) continue;
        const sim = cosineSimilarity(embA, embB);
        if (sim > threshold) {
          pairs.push({
            canonical_key: key,
            page_a_url: pageMeta.get(urls[i])?.url ?? urls[i],
            page_b_url: pageMeta.get(urls[j])?.url ?? urls[j],
            similarity: Math.round(sim * 1000) / 1000,
          });
        }
      }
    }
  }

  return pairs.sort((a, b) => b.similarity - a.similarity);
}
