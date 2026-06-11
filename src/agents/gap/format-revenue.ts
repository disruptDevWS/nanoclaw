/**
 * Formatter for the Gap agent's `revenue_opportunity` field.
 *
 * The field has two formats in the wild:
 * - Legacy (snapshots before 2026-06): free-text string, e.g. "$1285–$34272/mo across Boise"
 * - Current ({ value, basis } object per the Gap prompt): value = monthly dollars or null,
 *   basis = one-sentence derivation
 *
 * Consumers render into markdown tables, so output is pipe-escaped and the
 * basis is truncated to keep table rows readable.
 */

const MAX_BASIS_CHARS = 120;

function clean(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max = MAX_BASIS_CHARS): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function formatRevenueOpportunity(rev: unknown): string {
  if (rev == null) return '—';
  if (typeof rev === 'object') {
    const { value, basis } = rev as { value?: unknown; basis?: unknown };
    const basisText = typeof basis === 'string' && basis.trim() ? truncate(clean(basis)) : '';
    if (typeof value === 'number' && Number.isFinite(value)) {
      return basisText
        ? `$${Math.round(value).toLocaleString()}/mo (${basisText})`
        : `$${Math.round(value).toLocaleString()}/mo`;
    }
    return basisText || '—';
  }
  if (typeof rev === 'number' && Number.isFinite(rev)) return `$${Math.round(rev).toLocaleString()}/mo`;
  return truncate(clean(String(rev)));
}
