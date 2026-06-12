/**
 * blueprint-parse.ts — Michael blueprint markdown → structured page rows.
 *
 * Extracted from sync-to-dashboard.ts (2026-06-12) so the parser is unit-tested
 * and properly type-checked. sync-to-dashboard re-exports for compatibility.
 *
 * See DECISIONS.md 2026-04-09: "Michael's blueprint parser is prompt-hardened
 * first, validator-hardened second".
 */

export interface ArchPage {
  url_slug: string;
  page_status: string;
  silo_name: string;
  role: string;
  coverage_role: string;
  primary_keyword: string;
  primary_keyword_volume: number;
  action_required: string;
  /** 'starter' = thin test page (low-authority mode, D1); 'full' otherwise.
   * From the optional Mode column — absent on non-low-authority blueprints. */
  page_mode: 'full' | 'starter';
}

export interface BlueprintParseWarning {
  row_excerpt: string;
  rejected_slug: string;
  reason: string;
}

export interface BlueprintParseResult {
  pages: ArchPage[];
  markdown: string;
  summary: string;
  parseWarnings: BlueprintParseWarning[];
  validSlugCount: number;
  rejectedSlugCount: number;
}

/**
 * Rejects slugs that would corrupt execution_pages downstream. Valid slugs are
 * lowercase alphanumeric, hyphens, and forward slashes (for nested paths like
 * "online-emt-course/arizona"). Anything else — commas, parentheticals, em
 * dashes, spaces, prose annotations — is a parser corruption signal.
 *
 * See DECISIONS.md 2026-04-09: "Michael's blueprint parser is prompt-hardened
 * first, validator-hardened second".
 */
function validateBlueprintSlug(raw: string): { ok: true; clean: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'empty_slug' };
  if (trimmed === '—' || trimmed === '–' || trimmed === '-') return { ok: false, reason: 'dash_placeholder' };
  if (/[,()&]/.test(trimmed)) return { ok: false, reason: 'forbidden_punctuation' };
  if (/[—–]/.test(trimmed)) return { ok: false, reason: 'em_or_en_dash_in_slug' };
  if (/\s/.test(trimmed)) return { ok: false, reason: 'whitespace_in_slug' };
  const lowered = trimmed.toLowerCase();
  if (!/^[a-z0-9][a-z0-9\-\/]*$/.test(lowered)) return { ok: false, reason: 'non_slug_characters' };
  return { ok: true, clean: lowered };
}

export function parseBlueprintMarkdown(markdown: string): BlueprintParseResult {
  const parseWarnings: BlueprintParseWarning[] = [];
  let validSlugCount = 0;
  let rejectedSlugCount = 0;

  // Extract executive summary (first section content after the title)
  let summary = '';
  const summaryMatch = markdown.match(/##\s*Executive\s+Summary\s*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i);
  if (summaryMatch) {
    summary = summaryMatch[1].trim();
  }

  // Parse silo page assignments from markdown tables under "### Silo" headings.
  // Tables outside silo sections (cannibalization, metadata, schema, etc.) are skipped.
  const pages: ArchPage[] = [];
  const seenSlugs = new Set<string>();

  // Build a map of character offsets → silo names from "### Silo N: Name" headings
  const siloHeadings: Array<{ offset: number; name: string }> = [];
  const siloHeadingRegex = /^###\s+Silo\s+\d+:\s*(.+)$/gm;
  let siloMatch: RegExpExecArray | null;
  while ((siloMatch = siloHeadingRegex.exec(markdown)) !== null) {
    siloHeadings.push({ offset: siloMatch.index, name: siloMatch[1].trim() });
  }

  // Find the next heading after each silo to bound its range
  const allHeadingOffsets: number[] = [];
  const headingBoundaryRegex = /^#{2,3}\s/gm;
  let hm: RegExpExecArray | null;
  while ((hm = headingBoundaryRegex.exec(markdown)) !== null) {
    allHeadingOffsets.push(hm.index);
  }

  // Build offsets for ## headings (Part boundaries) to limit silo scope
  const partHeadingOffsets: number[] = [];
  const partHeadingRegex = /^##\s/gm;
  let pm: RegExpExecArray | null;
  while ((pm = partHeadingRegex.exec(markdown)) !== null) {
    partHeadingOffsets.push(pm.index);
  }

  function getSiloForOffset(offset: number): string | null {
    for (let i = siloHeadings.length - 1; i >= 0; i--) {
      if (offset >= siloHeadings[i].offset) {
        // Bound at: next silo heading, or next ## heading after this silo, whichever is first
        const nextSiloOffset = i + 1 < siloHeadings.length ? siloHeadings[i + 1].offset : Infinity;
        const nextPartOffset = partHeadingOffsets.find((o) => o > siloHeadings[i].offset) ?? Infinity;
        const bound = Math.min(nextSiloOffset, nextPartOffset);
        if (offset < bound) return siloHeadings[i].name;
        return null;
      }
    }
    return null;
  }

  const tableRegex = /\|(.+)\|\n\|[-\s|:]+\|\n((?:\|.+\|\n?)*)/g;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(markdown)) !== null) {
    // Only process tables inside silo sections
    const siloName = getSiloForOffset(match.index);
    if (!siloName) continue;

    const headerLine = match[1];
    const headers = headerLine.split('|').map((h) => h.trim().toLowerCase());

    // Buyer Journey Coverage tables (| Buyer Stage | Coverage | Pages | Notes |)
    // are not page tables — their "Pages" column holds comma-separated lists, and
    // counting those rows as corrupted slugs produced a constant ~38% false
    // rejection rate (one wasted retry per Michael run). Skip any table with a
    // stage column, and never treat a plural "pages" list column as the slug column.
    if (headers.some((h) => h.includes('stage'))) continue;

    // Check if this table has page-related columns — prefer url/slug/path over generic 'page'
    let slugIdx = headers.findIndex((h) => h.includes('slug') || h.includes('url') || h.includes('path'));
    if (slugIdx < 0) slugIdx = headers.findIndex((h) => h.includes('page') && !/\bpages\b/.test(h));
    if (slugIdx < 0) continue;

    const statusIdx = headers.findIndex((h) => h.includes('status') || h.includes('exists') || h.includes('new'));
    const siloColIdx = headers.findIndex((h) => h.includes('silo') || h.includes('cluster'));
    // coverage_role detection MUST come before role — both contain "role"
    const coverageRoleIdx = headers.findIndex((h) => h.includes('coverage'));
    const roleIdx = headers.findIndex((h) => h === 'role' || (h.includes('role') && !h.includes('coverage')));
    const kwIdx = headers.findIndex((h) => h.includes('keyword') || h.includes('target'));
    const volIdx = headers.findIndex((h) => h.includes('volume') || h.includes('vol'));
    const actionIdx = headers.findIndex((h) => h.includes('action') || h.includes('required') || h.includes('recommendation'));
    const modeIdx = headers.findIndex((h) => h.includes('mode'));

    const rowLines = match[2].trim().split('\n');
    for (const rowLine of rowLines) {
      const cells = rowLine.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length < 2) continue;

      const slug = cells[slugIdx] ?? '';
      if (!slug || slug.startsWith('-')) continue;

      const stripped = slug.replace(/^\//, '').replace(/`/g, '').replace(/[*]/g, '');
      const validation = validateBlueprintSlug(stripped);
      if (!validation.ok) {
        rejectedSlugCount++;
        parseWarnings.push({
          row_excerpt: rowLine.slice(0, 200),
          rejected_slug: stripped.slice(0, 200),
          reason: validation.reason,
        });
        continue;
      }
      const cleanSlug = validation.clean;

      // Deduplicate: first silo assignment wins
      if (seenSlugs.has(cleanSlug)) continue;
      seenSlugs.add(cleanSlug);
      validSlugCount++;

      pages.push({
        url_slug: cleanSlug,
        page_status: statusIdx >= 0 ? (cells[statusIdx] ?? '').toLowerCase().replace(/[*`]/g, '') : 'unknown',
        silo_name: siloColIdx >= 0 ? (cells[siloColIdx] ?? '').replace(/[*`]/g, '') : siloName,
        role: roleIdx >= 0 ? (cells[roleIdx] ?? '').replace(/[*`]/g, '') : '',
        coverage_role: coverageRoleIdx >= 0 ? (cells[coverageRoleIdx] ?? '').replace(/[*`]/g, '').toLowerCase() : '',
        primary_keyword: kwIdx >= 0 ? (cells[kwIdx] ?? '').replace(/[*`]/g, '') : '',
        primary_keyword_volume: volIdx >= 0 ? parseInt(cells[volIdx] ?? '0', 10) || 0 : 0,
        action_required: actionIdx >= 0 ? (cells[actionIdx] ?? '').toLowerCase().replace(/[*`]/g, '') : '',
        page_mode: modeIdx >= 0 && (cells[modeIdx] ?? '').toLowerCase().includes('starter') ? 'starter' : 'full',
      });
    }
  }

  return { pages, markdown, summary, parseWarnings, validSlugCount, rejectedSlugCount };
}
