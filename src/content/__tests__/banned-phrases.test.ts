import { describe, it, expect } from 'vitest';
import {
  extractQuotedPhrases,
  phraseToPattern,
  parseBannedPhrases,
  loadBannedPhrases,
  DEFAULT_BANNED_PHRASES,
} from '../banned-phrases.js';

describe('extractQuotedPhrases', () => {
  it('extracts all double-quoted phrases from a prose line', () => {
    const line = `Writing: "When it comes to...", "In fact,", ending sections with "contact us today"`;
    expect(extractQuotedPhrases(line)).toEqual(['When it comes to...', 'In fact,', 'contact us today']);
  });

  it('returns empty array when no quotes present', () => {
    expect(extractQuotedPhrases('no quotes here')).toEqual([]);
  });
});

describe('phraseToPattern', () => {
  it('adds word boundaries to single words', () => {
    const p = phraseToPattern('delve');
    expect(p.test('Let us delve into this')).toBe(true);
    p.lastIndex = 0;
    expect(p.test('delivered')).toBe(false);
  });

  it('strips trailing ellipsis', () => {
    const p = phraseToPattern('When it comes to...');
    expect(p.test('when it comes to plumbing')).toBe(true);
  });

  it('matches straight and curly apostrophes', () => {
    const p = phraseToPattern("don't hesitate to...");
    expect(p.test("don't hesitate to call")).toBe(true);
    p.lastIndex = 0;
    expect(p.test('don’t hesitate to call')).toBe(true);
  });

  it('treats standalone X and Y as wildcards', () => {
    const p = phraseToPattern('whether you need X or Y');
    expect(p.test('whether you need a jump start or a tow')).toBe(true);
    p.lastIndex = 0;
    expect(p.test('whether you need help')).toBe(false);
  });

  it('preserves trailing punctuation without a boundary', () => {
    const p = phraseToPattern('In fact,');
    expect(p.test('In fact, the opposite is true')).toBe(true);
    p.lastIndex = 0;
    expect(p.test('in fact the opposite')).toBe(false);
  });
});

describe('parseBannedPhrases', () => {
  const systemPromptMd = `# Oscar
- No filler, no padding, no AI-isms: "navigating", "landscape", "leverage", "delve", "it's worth noting", "in today's world", em dashes as crutches
`;
  const playbookMd = `## 7. Anti-Patterns — Never Do These
Writing: "When it comes to...", "whether you need X or Y", "In fact,", "Don't hesitate to...", "we understand that...", rhetorical questions as section openers, ending sections with "contact us today"

SEO: keyword bolded everywhere
`;

  it('parses phrases from both sources with correct attribution', () => {
    const phrases = parseBannedPhrases(systemPromptMd, playbookMd);
    const bySource = (s: string) => phrases.filter((p) => p.source === s).map((p) => p.label);
    expect(bySource('system-prompt')).toEqual([
      'navigating', 'landscape', 'leverage', 'delve', "it's worth noting", "in today's world",
    ]);
    expect(bySource('seo-playbook')).toEqual([
      'When it comes to', 'whether you need X or Y', 'In fact,', "Don't hesitate to", 'we understand that', 'contact us today',
    ]);
  });

  it('does not pick up quoted phrases from non-Writing playbook lines', () => {
    const phrases = parseBannedPhrases(systemPromptMd, playbookMd + '\nStructural: "some other quote"\n');
    expect(phrases.map((p) => p.label)).not.toContain('some other quote');
  });

  it('returns empty array when source lines are missing', () => {
    expect(parseBannedPhrases('no markers here', 'none here either')).toEqual([]);
  });
});

describe('loadBannedPhrases (live configs)', () => {
  it('parses the real Oscar configs and covers every default phrase', () => {
    const live = loadBannedPhrases();
    // Every pattern in the old hardcoded list must still be detected via config parsing —
    // guards against the playbook and scanner drifting apart again.
    const samples: Record<string, string> = {
      navigating: 'Navigating the permit process is hard.',
      landscape: 'The competitive landscape shifted.',
      leverage: 'Leverage your existing tools.',
      delve: 'We delve into the details.',
      "it's worth noting": "It's worth noting that prices vary.",
      "in today's world": "In today’s world, speed matters.",
      'when it comes to': 'When it comes to plumbing, call us.',
      'whether you need X or Y': 'whether you need a repair or a replacement',
      'In fact,': 'In fact, most homes qualify.',
      "don't hesitate to": "Don't hesitate to reach out.",
      'we understand that': 'We understand that timing matters.',
      'contact us today': 'Contact us today for a quote.',
    };
    for (const def of DEFAULT_BANNED_PHRASES) {
      const sample = samples[def.label];
      const hit = live.some((p) => { p.pattern.lastIndex = 0; return p.pattern.test(sample); });
      expect(hit, `live config phrases should match sample for "${def.label}"`).toBe(true);
    }
  });

  it('falls back to defaults when config dir is missing', () => {
    const phrases = loadBannedPhrases('/nonexistent/path');
    expect(phrases).toEqual(DEFAULT_BANNED_PHRASES);
  });
});
