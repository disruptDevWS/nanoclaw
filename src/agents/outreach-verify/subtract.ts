/**
 * subtract.ts — Deterministic subtraction: cut/soften refuted claims.
 *
 * No LLM touches the body here — the never-fabricate / never-rewrite-voice
 * guarantee (spec §0, §6) is structural, not prompted. Cutting removes the
 * sentence containing the asserted text; softening substitutes from a small
 * whitelist that removes the absolute. Anything the whitelist can't handle
 * cleanly returns null and the claim falls back to flagged → needs_review —
 * seams route to Matt, never into a sent email.
 */

import type { Disposition, VerifiedClaim } from './types.js';

/** Absolute-presence phrasings we can soften without generating new claims.
 *  Applied only inside the claim's own asserted_text span. */
const SOFTEN_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  { re: /\bzero presence\b/i, replacement: 'limited presence' },
  { re: /\bno real search presence\b/i, replacement: 'a limited search presence' },
  { re: /\bno search presence\b/i, replacement: 'a limited search presence' },
  { re: /\bno visible presence\b/i, replacement: 'limited visibility' },
  { re: /\bnothing there\b/i, replacement: 'not much there' },
  { re: /\bno presence at all\b/i, replacement: 'limited presence' },
];

/**
 * Remove the sentence containing assertedText. Returns null when the text
 * isn't found within a single sentence (spans sentences, already removed by
 * an earlier cut, or whitespace drift) — fail loud, caller flags.
 */
export function cutSentence(body: string, assertedText: string): string | null {
  const idx = body.indexOf(assertedText);
  if (idx === -1) return null;
  if (assertedText.includes('\n')) return null; // spans lines — not one sentence

  // Sentence start: scan back to the previous terminator-plus-space or newline.
  let start = 0;
  for (let i = idx - 1; i >= 0; i--) {
    const ch = body[i];
    if (ch === '\n') {
      start = i + 1;
      break;
    }
    if ((ch === '.' || ch === '!' || ch === '?') && /\s/.test(body[i + 1] ?? '')) {
      start = i + 1;
      break;
    }
  }
  while (/\s/.test(body[start] ?? '')) start++;

  // Sentence end: scan forward to the next terminator or newline.
  const afterIdx = idx + assertedText.length;
  let end = body.length;
  for (let i = afterIdx - 1; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\n') {
      end = i;
      break;
    }
    if ((ch === '.' || ch === '!' || ch === '?') && /\s|$/.test(body[i + 1] ?? '')) {
      end = i + 1;
      break;
    }
  }

  const cut = (body.slice(0, start) + body.slice(end))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  return cut.length > 0 && cut !== body.trim() ? cut : null;
}

/**
 * Soften the absolute inside assertedText via the whitelist. Returns null
 * when no pattern applies — caller flags rather than mangles.
 */
export function softenClaim(body: string, assertedText: string): string | null {
  if (!body.includes(assertedText)) return null;
  for (const { re, replacement } of SOFTEN_PATTERNS) {
    const m = assertedText.match(re);
    if (!m) continue;
    const softened = assertedText.replace(re, replacement);
    return body.replace(assertedText, softened);
  }
  return null;
}

const WORD_FLOORS: Record<'pitch' | 'courtesy_note', number> = {
  pitch: 100, // generator target is 100-140 words
  courtesy_note: 80, // generator target is 80-120 words
};

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Character offset where the pitch hook ends: after the greeting line plus
 *  the first two sentences (the generator's mandated hook zone). */
export function hookEndIndex(body: string): number {
  const greetingMatch = body.match(/^Hi[^\n]*\n+/);
  const offset = greetingMatch ? greetingMatch[0].length : 0;
  const rest = body.slice(offset);
  let seen = 0;
  const re = /[.!?](\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    seen++;
    if (seen === 2) return offset + m.index + 1;
  }
  return body.length;
}

export interface CoherenceCheck {
  applied: boolean;
  reason: string | null;
}

/**
 * Coherence gate (spec §3): checked, not assumed. Trips when cuts drop the
 * body below the variant's word floor — a gutted draft routes to Matt, it
 * doesn't ship.
 */
export function coherenceGate(
  bodyAfter: string,
  variant: 'pitch' | 'courtesy_note',
  anyCuts: boolean,
): CoherenceCheck {
  if (!anyCuts) return { applied: false, reason: null };
  const words = wordCount(bodyAfter);
  const floor = WORD_FLOORS[variant];
  if (words < floor) {
    return { applied: true, reason: `body fell to ${words} words after cuts (floor ${floor} for ${variant})` };
  }
  return { applied: false, reason: null };
}

/**
 * Draft-level disposition (spec §3), priority killed > needs_review >
 * weakened > clean:
 *   killed       — a PRESENT claim sat in a pitch's hook zone: the core hook
 *                  was false. Route back; don't send an empty pitch.
 *   needs_review — any flagged claim (UNRESOLVABLE / failed subtraction /
 *                  subject-line claim), invalid extractor output, sweep
 *                  hits, or a coherence-gate trip.
 *   weakened     — claims were cut/softened, remainder coherent.
 *   clean        — every claim ABSENT-confirmed (or none found).
 */
export function deriveDisposition(
  claims: VerifiedClaim[],
  variant: 'pitch' | 'courtesy_note',
  bodyBefore: string,
  coherence: CoherenceCheck,
  invalidCount: number,
  sweepCount: number,
): Disposition {
  if (variant === 'pitch') {
    const hookEnd = hookEndIndex(bodyBefore);
    const hookFalse = claims.some(
      (c) => c.verdict === 'PRESENT' && !c.in_subject && bodyBefore.indexOf(c.asserted_text) !== -1 && bodyBefore.indexOf(c.asserted_text) < hookEnd,
    );
    if (hookFalse) return 'killed';
  }
  if (claims.some((c) => c.action === 'flagged') || invalidCount > 0 || sweepCount > 0 || coherence.applied) {
    return 'needs_review';
  }
  if (claims.some((c) => c.action === 'cut' || c.action === 'softened')) return 'weakened';
  return 'clean';
}
