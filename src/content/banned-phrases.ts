/**
 * Banned-phrase loader — parses Oscar's config files so the slop scanner
 * stays in sync with the playbook instead of duplicating the list.
 *
 * Sources:
 * - configs/oscar/system-prompt.md — the "AI-isms" line (quoted phrases)
 * - configs/oscar/seo-playbook.md — Anti-Patterns section, "Writing:" line (quoted phrases)
 */

import fs from 'node:fs';
import path from 'node:path';

export interface BannedPhrase {
  pattern: RegExp;
  label: string;
  source: 'system-prompt' | 'seo-playbook';
}

/** Extract all double-quoted phrases from a line of prose. */
export function extractQuotedPhrases(line: string): string[] {
  const matches = line.match(/"([^"]+)"/g) ?? [];
  return matches.map((m) => m.slice(1, -1));
}

/**
 * Convert a prose phrase into a matching regex.
 * - trailing "..." is stripped ("When it comes to..." → "when it comes to")
 * - standalone X / Y tokens become wildcards ("whether you need X or Y")
 * - apostrophes match straight or curly
 * - word boundaries added where the phrase starts/ends with a word character
 */
export function phraseToPattern(phrase: string): RegExp {
  const cleaned = phrase.replace(/\.{3,}$/, '').trim();

  let body = cleaned
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/['’]/g, "['’]");

  // Template placeholders: standalone capital X / Y are wildcards
  body = body.replace(/\bX\b/g, '.{1,40}').replace(/\bY\b/g, '.{1,40}');

  if (/^\w/.test(cleaned)) body = `\\b${body}`;
  if (/\w$/.test(cleaned)) body = `${body}\\b`;

  return new RegExp(body, 'gi');
}

/**
 * Fallback list — used only if config parsing yields nothing
 * (e.g. config files moved or the source lines were reworded).
 */
export const DEFAULT_BANNED_PHRASES: BannedPhrase[] = [
  { pattern: /\bnavigating\b/gi, label: 'navigating', source: 'system-prompt' },
  { pattern: /\blandscape\b/gi, label: 'landscape', source: 'system-prompt' },
  { pattern: /\bleverage\b/gi, label: 'leverage', source: 'system-prompt' },
  { pattern: /\bdelve\b/gi, label: 'delve', source: 'system-prompt' },
  { pattern: /it['’]s worth noting/gi, label: "it's worth noting", source: 'system-prompt' },
  { pattern: /in today['’]s world/gi, label: "in today's world", source: 'system-prompt' },
  { pattern: /when it comes to/gi, label: 'when it comes to', source: 'seo-playbook' },
  { pattern: /whether you need .{1,40} or /gi, label: 'whether you need X or Y', source: 'seo-playbook' },
  { pattern: /\bin fact,/gi, label: 'In fact,', source: 'seo-playbook' },
  { pattern: /don['’]t hesitate to/gi, label: "don't hesitate to", source: 'seo-playbook' },
  { pattern: /we understand that/gi, label: 'we understand that', source: 'seo-playbook' },
  { pattern: /contact us today/gi, label: 'contact us today', source: 'seo-playbook' },
];

/** Parse banned phrases out of the two Oscar config documents (contents passed in). */
export function parseBannedPhrases(
  systemPromptMd: string,
  playbookMd: string,
): BannedPhrase[] {
  const phrases: BannedPhrase[] = [];

  const aiIsmLine = systemPromptMd.split('\n').find((l) => /AI-isms/i.test(l));
  if (aiIsmLine) {
    for (const p of extractQuotedPhrases(aiIsmLine)) {
      phrases.push({ pattern: phraseToPattern(p), label: p.replace(/\.{3,}$/, ''), source: 'system-prompt' });
    }
  }

  // Anti-Patterns section: every quoted phrase on the "Writing:" line,
  // including the trailing `ending sections with "contact us today"`.
  const antiPatternsIdx = playbookMd.indexOf('Anti-Patterns');
  if (antiPatternsIdx !== -1) {
    const sectionTail = playbookMd.slice(antiPatternsIdx);
    const writingLine = sectionTail.split('\n').find((l) => /^Writing:/i.test(l.trim()));
    if (writingLine) {
      for (const p of extractQuotedPhrases(writingLine)) {
        phrases.push({ pattern: phraseToPattern(p), label: p.replace(/\.{3,}$/, ''), source: 'seo-playbook' });
      }
    }
  }

  return phrases;
}

/**
 * Load banned phrases from the Oscar config files on disk.
 * Falls back to DEFAULT_BANNED_PHRASES if files are missing or parsing yields nothing.
 */
export function loadBannedPhrases(configDir?: string): BannedPhrase[] {
  try {
    const dir = configDir ?? path.resolve(process.cwd(), 'configs/oscar');
    const systemPromptMd = fs.readFileSync(path.join(dir, 'system-prompt.md'), 'utf-8');
    const playbookMd = fs.readFileSync(path.join(dir, 'seo-playbook.md'), 'utf-8');
    const parsed = parseBannedPhrases(systemPromptMd, playbookMd);
    if (parsed.length > 0) return parsed;
    console.warn('  [slop-scanner] Config parsing yielded 0 banned phrases — using built-in fallback list');
    return DEFAULT_BANNED_PHRASES;
  } catch (err: any) {
    console.warn(`  [slop-scanner] Failed to load banned phrases from configs (${err.message}) — using built-in fallback list`);
    return DEFAULT_BANNED_PHRASES;
  }
}
