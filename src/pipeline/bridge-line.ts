/**
 * Extracts the trailing BRIDGE_LINE: from raw prospect-narrative output.
 * The bridge line is the Scout-authored seam between a prospect's report data
 * and the Forge Growth positioning on the public share page. Non-fatal: an
 * absent or empty line yields bridgeLine null and the untouched narrative
 * (the share page falls back to generic seam copy).
 */
export function extractBridgeLine(raw: string): { narrative: string; bridgeLine: string | null } {
  const match = raw.match(/^BRIDGE_LINE:\s*(.+)\s*$/m);
  if (!match || !match[1].trim()) {
    return { narrative: raw.trim(), bridgeLine: null };
  }
  const narrative = raw.replace(match[0], '').trim();
  return { narrative, bridgeLine: match[1].trim() };
}
