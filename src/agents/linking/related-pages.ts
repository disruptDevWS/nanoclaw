/**
 * related-pages.ts — Embedding-derived verified internal link candidates.
 *
 * At brief time, embeds the source page against a pool of live crawled pages
 * (Dwight crawl meta) + planned execution_pages, producing a grounded candidate
 * list Pam is constrained to pick link targets from. Cannibalization pairs
 * (similarity > 0.90) are excluded from candidates and surfaced as
 * do-not-link risks. Result persists to execution_pages.related_pages JSONB
 * (NOT page_brief — syncMichael wholesale-overwrites page_brief on re-runs).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { embedBatch, cosineSimilarity, ACTIVE_EMBEDDING_MODEL } from '../../embeddings/index.js';
import { loadPageMeta, type PageMeta } from '../density/crawl-meta.js';
import { normalizeUrl, CANNIBALIZATION_THRESHOLD } from '../density/cannibalization.js';

// Similarity floor for candidates. Tunable guess for short title-ish texts —
// computeRelatedPages logs the similarity distribution as the tuning mechanism.
export const RELATED_FLOOR = 0.5;
export const RELATED_LIMIT = 8;

// ── Types ─────────────────────────────────────────────────────

export interface RelatedCandidate {
  /** `/slug` for planned pages, full URL for live crawled pages. */
  target: string;
  kind: 'live' | 'planned';
  title: string;
  similarity: number;
  status?: string | null;
  silo?: string | null;
}

export interface RelatedPagesResult {
  computed_at: string;
  model: string;
  source: 'disk' | 'supabase' | 'none';
  candidates: RelatedCandidate[];
  cannibalization_risks: Array<{ target: string; similarity: number }>;
}

export interface ExecPageRow {
  url_slug: string;
  silo: string | null;
  status: string | null;
  meta_title: string | null;
  h1_recommendation: string | null;
  meta_description: string | null;
  page_brief: any;
}

/** Pool entry for ranking — embedding may be null (skipped). */
export interface PoolEntry {
  /** Normalized path used for self-exclusion + live/planned dedupe. */
  path: string;
  target: string;
  kind: 'live' | 'planned';
  title: string;
  embedding: number[] | null;
  status?: string | null;
  silo?: string | null;
}

// ── Pure helpers ──────────────────────────────────────────────

function humanizeSlug(slug: string): string {
  return slug.replace(/[-/]+/g, ' ').trim();
}

/** Embeddable text for a planned execution page. Brief meta fields preferred;
 *  fallback to primary keyword + role + humanized slug for not-started pages. */
export function buildExecPageText(p: ExecPageRow): string {
  const metaParts = [p.meta_title, p.h1_recommendation, p.meta_description]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  if (metaParts.length > 0) return metaParts.join(' | ');

  const brief = (p.page_brief ?? {}) as Record<string, any>;
  const fallbackParts = [brief.primary_keyword, brief.role, humanizeSlug(p.url_slug ?? '')]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean);
  return fallbackParts.join(' | ');
}

/** Embeddable text for a live crawled page (same shape as cannibalization's pageText). */
export function buildLivePageText(m: PageMeta): string {
  return [m.title, m.h1, m.metaDescription]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' | ');
}

export function execPageContentId(auditId: string, slug: string): string {
  return `exec_page:${auditId}:${slug.replace(/^\/+/, '')}`;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Rank a candidate pool against the source page embedding.
 * - dedupes live/planned by normalized path (live wins)
 * - excludes the source page itself
 * - skips entries with null embeddings
 * - similarity > cannibalization threshold (strict >) → risk, not candidate
 * - similarity >= floor → candidate; sorted desc, capped at limit
 */
export function rankRelatedPages(
  sourceEmbedding: number[],
  pool: PoolEntry[],
  opts: {
    selfPath: string;
    floor?: number;
    limit?: number;
    cannibalizationThreshold?: number;
  },
): { candidates: RelatedCandidate[]; cannibalization_risks: Array<{ target: string; similarity: number }> } {
  const floor = opts.floor ?? RELATED_FLOOR;
  const limit = opts.limit ?? RELATED_LIMIT;
  const threshold = opts.cannibalizationThreshold ?? CANNIBALIZATION_THRESHOLD;

  // Dedupe by path — live wins over planned
  const byPath = new Map<string, PoolEntry>();
  for (const entry of pool) {
    const existing = byPath.get(entry.path);
    if (!existing || (existing.kind === 'planned' && entry.kind === 'live')) {
      byPath.set(entry.path, entry);
    }
  }

  const candidates: RelatedCandidate[] = [];
  const risks: Array<{ target: string; similarity: number }> = [];

  for (const entry of byPath.values()) {
    if (entry.path === opts.selfPath) continue;
    if (!entry.embedding) continue;
    const sim = cosineSimilarity(sourceEmbedding, entry.embedding);
    if (sim > threshold) {
      risks.push({ target: entry.target, similarity: round3(sim) });
      continue;
    }
    if (sim < floor) continue;
    candidates.push({
      target: entry.target,
      kind: entry.kind,
      title: entry.title,
      similarity: round3(sim),
      status: entry.status ?? null,
      silo: entry.silo ?? null,
    });
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  risks.sort((a, b) => b.similarity - a.similarity);
  return { candidates: candidates.slice(0, limit), cannibalization_risks: risks };
}

// ── IO orchestrator ───────────────────────────────────────────

/**
 * Compute verified internal link candidates for a page.
 * Never throws — warns and returns null on any failure (brief generation
 * must proceed without candidates).
 */
export async function computeRelatedPages(
  sb: SupabaseClient,
  opts: { auditId: string; domain: string; slug: string },
): Promise<RelatedPagesResult | null> {
  try {
    const normalizedSlug = opts.slug.replace(/^\/+/, '');
    const selfPath = normalizeUrl(`${opts.domain}/${normalizedSlug}`);

    // 1. Live pages (disk CSV primary, agent_technical_pages fallback)
    const { pages: liveMeta, source } = await loadPageMeta(sb, opts.auditId, opts.domain);

    // 2. Planned pages (cross-silo by design; deprecated excluded)
    const { data: execRows } = await sb
      .from('execution_pages')
      .select('url_slug, silo, status, meta_title, h1_recommendation, meta_description, page_brief')
      .eq('audit_id', opts.auditId)
      .neq('status', 'deprecated');
    const execPages = (execRows ?? []) as ExecPageRow[];

    // 3. Source page text — prefer its own execution_pages row, else live crawl meta
    const execPath = (p: ExecPageRow) =>
      normalizeUrl(`${opts.domain}/${(p.url_slug ?? '').replace(/^\/+/, '')}`);
    const selfRow = execPages.find((p) => execPath(p) === selfPath) ?? null;
    const selfLive = liveMeta.get(selfPath) ?? null;
    const sourceText = selfRow
      ? buildExecPageText(selfRow)
      : selfLive
        ? buildLivePageText(selfLive)
        : humanizeSlug(normalizedSlug);
    if (!sourceText) {
      console.warn(`  [related-pages] No embeddable text for /${normalizedSlug} — skipping`);
      return null;
    }

    // 4. Build embed items: source + live pool + planned pool (one batch)
    // Self excluded here (not just at rank time) so the source contentId never
    // appears twice in one embedBatch upsert (ON CONFLICT cannot affect row twice).
    const liveEntries: Array<{ path: string; meta: PageMeta; text: string }> = [];
    for (const [pathKey, meta] of liveMeta) {
      if (pathKey === selfPath) continue;
      const text = buildLivePageText(meta);
      if (!text) continue;
      liveEntries.push({ path: pathKey, meta, text });
    }
    const plannedEntries: Array<{ path: string; row: ExecPageRow; text: string }> = [];
    for (const row of execPages) {
      if (!row.url_slug || execPath(row) === selfPath) continue;
      const text = buildExecPageText(row);
      if (!text) continue;
      plannedEntries.push({ path: execPath(row), row, text });
    }

    const items = [
      {
        text: sourceText,
        contentType: 'exec_page' as const,
        contentId: execPageContentId(opts.auditId, normalizedSlug),
      },
      // page_meta:{normalizedUrl} matches Phase 4c cannibalization ids → cache hits
      ...liveEntries.map((e) => ({
        text: e.text,
        contentType: 'page_meta' as const,
        contentId: `page_meta:${e.path}`,
      })),
      ...plannedEntries.map((e) => ({
        text: e.text,
        contentType: 'exec_page' as const,
        contentId: execPageContentId(opts.auditId, e.row.url_slug),
      })),
    ];
    const embeddings = await embedBatch(items);

    const sourceEmbedding = embeddings[0]?.embedding ?? null;
    if (!sourceEmbedding) {
      console.warn(`  [related-pages] Source embedding failed for /${normalizedSlug} — skipping`);
      return null;
    }

    // 5. Assemble pool
    const pool: PoolEntry[] = [];
    for (let i = 0; i < liveEntries.length; i++) {
      const e = liveEntries[i];
      pool.push({
        path: e.path,
        target: e.meta.url,
        kind: 'live',
        title: e.meta.title ?? e.meta.h1 ?? '',
        embedding: embeddings[1 + i]?.embedding ?? null,
      });
    }
    const plannedOffset = 1 + liveEntries.length;
    for (let i = 0; i < plannedEntries.length; i++) {
      const e = plannedEntries[i];
      const slugClean = e.row.url_slug.replace(/^\/+/, '');
      pool.push({
        path: e.path,
        target: `/${slugClean}`,
        kind: e.row.status === 'published' ? 'live' : 'planned',
        title:
          e.row.meta_title ??
          e.row.h1_recommendation ??
          (e.row.page_brief as any)?.primary_keyword ??
          humanizeSlug(slugClean),
        embedding: embeddings[plannedOffset + i]?.embedding ?? null,
        status: e.row.status,
        silo: e.row.silo,
      });
    }

    const { candidates, cannibalization_risks } = rankRelatedPages(sourceEmbedding, pool, {
      selfPath,
    });

    // 6. Distribution logging (floor tuning mechanism)
    const sims = pool
      .filter((p) => p.embedding && p.path !== selfPath)
      .map((p) => cosineSimilarity(sourceEmbedding, p.embedding!))
      .sort((a, b) => a - b);
    if (sims.length > 0) {
      const median = sims[Math.floor(sims.length / 2)];
      console.log(
        `  [related-pages] /${normalizedSlug}: ${candidates.length} candidates, ${cannibalization_risks.length} risks ` +
          `(pool ${sims.length}, sim min ${round3(sims[0])} / median ${round3(median)} / max ${round3(sims[sims.length - 1])}, source: ${source})`,
      );
    } else {
      console.log(`  [related-pages] /${normalizedSlug}: empty pool (source: ${source})`);
    }

    return {
      computed_at: new Date().toISOString(),
      model: ACTIVE_EMBEDDING_MODEL,
      source,
      candidates,
      cannibalization_risks,
    };
  } catch (err: any) {
    console.warn(`  [related-pages] Failed: ${err?.message ?? err} — continuing without candidates`);
    return null;
  }
}

// ── Prompt section formatter ──────────────────────────────────

/** Lookup key for GSC position maps: lowercase pathname, no trailing slash. */
export function gscPathKey(target: string): string {
  let p = target;
  try {
    p = new URL(target).pathname;
  } catch {
    // already a path
  }
  p = p.toLowerCase().replace(/\/+$/, '');
  if (!p.startsWith('/')) p = `/${p}`;
  return p || '/';
}

/** Markdown section injected into Pam's prompt. '' when nothing to show.
 * When `positionsByPath` (latest GSC avg position per pathname) is provided,
 * a Position column is added so Pam can apply position-band link routing (C2). */
export function formatRelatedPagesSection(
  result: RelatedPagesResult | null,
  positionsByPath?: Map<string, number>,
): string {
  if (!result) return '';
  if (result.candidates.length === 0 && result.cannibalization_risks.length === 0) return '';

  const withPositions = positionsByPath !== undefined;
  const lines: string[] = [
    '## Verified Internal Link Candidates (semantic similarity)',
    'These pages were verified to exist (live on the site or planned in the architecture).',
    '[LIVE] pages exist today; [PLANNED] pages are in the architecture but not yet published.',
  ];
  if (withPositions) {
    lines.push('Position = latest GSC average position for the target page ("—" = no ranking data, typical for planned/new pages).');
  }
  lines.push('');

  if (result.candidates.length > 0) {
    if (withPositions) {
      lines.push('| Target | Type | Title | Similarity | Position |');
      lines.push('|--------|------|-------|------------|----------|');
    } else {
      lines.push('| Target | Type | Title | Similarity |');
      lines.push('|--------|------|-------|------------|');
    }
    for (const c of result.candidates) {
      const marker = c.kind === 'live' ? '[LIVE]' : '[PLANNED]';
      const title = c.title.replace(/\|/g, '\\|');
      if (withPositions) {
        const pos = positionsByPath!.get(gscPathKey(c.target));
        lines.push(`| ${c.target} | ${marker} | ${title} | ${c.similarity.toFixed(2)} | ${pos !== undefined ? pos.toFixed(1) : '—'} |`);
      } else {
        lines.push(`| ${c.target} | ${marker} | ${title} | ${c.similarity.toFixed(2)} |`);
      }
    }
  }

  if (result.cannibalization_risks.length > 0) {
    const risks = result.cannibalization_risks
      .map((r) => `${r.target} (${r.similarity.toFixed(2)})`)
      .join(', ');
    lines.push('');
    lines.push(`DO NOT LINK (near-duplicate of this page — cross-linking would reinforce cannibalization): ${risks}`);
  }

  return lines.join('\n');
}
