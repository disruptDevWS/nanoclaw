/**
 * crawl-meta.ts — Load client page metadata (title/h1/meta description) from
 * Dwight crawl data for density + cannibalization analysis.
 *
 * Source priority:
 *   1. Disk CSV: audits/{domain}/auditor/{latest-date}/internal_all.csv
 *      (same guarantee Phase 6c relies on)
 *   2. agent_technical_pages fallback (paginated) — for standalone re-runs
 *      where disk artifacts don't exist (e.g. pipeline ran on Railway).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as csvParse } from 'csv-parse/sync';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeUrl } from './cannibalization.js';

export interface PageMeta {
  url: string;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
}

export interface PageMetaLoadResult {
  pages: Map<string, PageMeta>; // keyed by normalized URL
  source: 'disk' | 'supabase' | 'none';
}

/**
 * Parse internal_all.csv into page metadata.
 * Replicates syncDwight column mapping: BOM strip, text/html content type
 * filter, status 200 filter, columns Address / Title 1 / H1-1 /
 * Meta Description 1.
 */
export function parseInternalAllCsv(csv: string): PageMeta[] {
  let content = csv;
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }
  const rows: Record<string, string>[] = csvParse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  return rows
    .filter((r) => {
      const ct = r['Content Type'] ?? '';
      if (!(ct.includes('text/html') || ct === '')) return false;
      const status = parseInt(r['Status Code'] || '0', 10);
      return status === 200;
    })
    .map((r) => ({
      url: r['Address'] ?? '',
      title: r['Title 1'] || null,
      h1: r['H1-1'] || null,
      metaDescription: r['Meta Description 1'] || null,
    }))
    .filter((p) => p.url.length > 0);
}

function latestDateDir(base: string): string | null {
  if (!fs.existsSync(base)) return null;
  const entries = fs.readdirSync(base).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)).sort();
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

/**
 * Load page metadata: disk CSV primary, agent_technical_pages fallback.
 * Returns map keyed by normalized URL + source label.
 */
export async function loadPageMeta(
  sb: SupabaseClient,
  auditId: string,
  domain: string,
  date?: string,
): Promise<PageMetaLoadResult> {
  // 1. Disk primary
  const auditorBase = path.resolve(process.cwd(), 'audits', domain, 'auditor');
  const dateStr = date ?? latestDateDir(auditorBase);
  if (dateStr) {
    const csvFile = path.join(auditorBase, dateStr, 'internal_all.csv');
    if (fs.existsSync(csvFile)) {
      const metas = parseInternalAllCsv(fs.readFileSync(csvFile, 'utf-8'));
      const pages = new Map<string, PageMeta>();
      for (const m of metas) {
        const key = normalizeUrl(m.url);
        if (!pages.has(key)) pages.set(key, m);
      }
      if (pages.size > 0) return { pages, source: 'disk' };
    }
  }

  // 2. Supabase fallback (paginated — PostgREST max-rows=1000)
  const pages = new Map<string, PageMeta>();
  const PAGE_SIZE = 1000;
  let offset = 0;
  while (true) {
    const { data: page } = await sb
      .from('agent_technical_pages')
      .select('url, title, h1, meta_description, status_code')
      .eq('audit_id', auditId)
      .eq('status_code', 200)
      .range(offset, offset + PAGE_SIZE - 1);
    if (!page || page.length === 0) break;
    for (const row of page as any[]) {
      if (!row.url) continue;
      const key = normalizeUrl(row.url);
      if (!pages.has(key)) {
        pages.set(key, {
          url: row.url,
          title: row.title ?? null,
          h1: row.h1 ?? null,
          metaDescription: row.meta_description ?? null,
        });
      }
    }
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { pages, source: pages.size > 0 ? 'supabase' : 'none' };
}
