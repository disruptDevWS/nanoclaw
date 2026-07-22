/**
 * extract-claims.ts — Grounded claim extraction for the outreach verifier.
 *
 * Claims are prose-only in the draft, so extraction is itself an LLM step —
 * and its recall gaps become false-clean dispositions (spec §3 "Extraction
 * grounding"). Two containment measures:
 *
 *   1. The prompt is grounded on the scout's known services/locales
 *      ("which of these does the draft assert absence for?"), not open NER.
 *   2. Every claim must return asserted_text as an exact verbatim substring
 *      of the draft; anything else is counted invalid and routes the draft
 *      to needs_review — a hallucinated span must fail loud, not verify.
 *
 * A second sweep question catches absence-shaped assertions outside the
 * known vocabulary; sweep hits can only flag (→ needs_review), never resolve.
 */

import type { ExtractedClaim, SweepFlag } from './types.js';

export interface ExtractionResult {
  claims: ExtractedClaim[];
  sweep: SweepFlag[];
  /** Model-emitted claims dropped by substring validation (fail-loud count). */
  invalidCount: number;
}

export function buildExtractionPrompt(
  subject: string,
  body: string,
  services: string[],
  locales: string[],
  coverageTopics: string[],
): string {
  const vocab = [...new Set([...services, ...coverageTopics])];
  return `You are auditing a cold-outreach email draft for factual exposure before human review. The draft may assert that the recipient's WEBSITE lacks pages or content for specific services or cities. Your job is to list those assertions — nothing else.

## Known services (from the scout data)
${vocab.map((s) => `- ${s}`).join('\n')}

## Known cities/markets
${locales.map((l) => `- ${l}`).join('\n')}

## Draft
SUBJECT: ${subject}
BODY:
${body}

## What counts as a claim
- Site-content absence: "no dedicated page for X", "no page targeting X in Y", "no visible presence for X on your site".
- Absolute presence statements: "zero presence in {city}", "nothing there", "no real search presence" — mark these phrasing="ambiguous_presence".
- Title/header mismatch implications: "a title and header that match that phrase exactly" — type="title_mismatch", with target_phrase set to the phrase the title supposedly lacks.

## What does NOT count (exclude entirely)
- Ranking/position statements ("not on page 1", "position 21", "your competitors appear above you") — these are SERP claims verified elsewhere.
- Search volumes, CPC, revenue figures.
- Statements about Google Business Profile, reviews, or directories.

## Rules
- asserted_text MUST be an exact verbatim substring copied character-for-character from the SUBJECT or BODY above — the minimal clause containing the assertion. Do not paraphrase, do not fix typos, do not merge sentences.
- service/city must come from the known lists when the claim maps to them; use the draft's own words if it names a service/city not in the lists, and ALSO add that claim to "sweep".
- phrasing: "pure_absence" when the draft says a page/content does not exist; "ambiguous_presence" for absolute presence language that is not literally about a page existing.
- If the draft contains no such claims, return empty arrays.

## Output — JSON only, no prose, no code fences
{"claims": [{"type": "page_absent" | "title_mismatch", "service": string, "city": string | null, "target_phrase": string | null, "asserted_text": string, "phrasing": "pure_absence" | "ambiguous_presence"}], "sweep": [{"asserted_text": string, "note": string}]}`;
}

function parseJson<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in extractor output');
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

interface RawClaim {
  type?: string;
  service?: string;
  city?: string | null;
  target_phrase?: string | null;
  asserted_text?: string;
  phrasing?: string;
}

/**
 * Validate model-emitted claims against the actual draft text. Pure — unit
 * tested. Non-substring asserted_text, empty fields, or a title_mismatch
 * without target_phrase are dropped and counted (the count trips
 * needs_review upstream — never silently verified, never silently ignored).
 */
export function validateClaims(
  raw: RawClaim[],
  subject: string,
  body: string,
): { claims: ExtractedClaim[]; invalidCount: number } {
  const claims: ExtractedClaim[] = [];
  let invalidCount = 0;
  raw.forEach((c, i) => {
    const asserted = (c.asserted_text ?? '').trim();
    const type = c.type === 'title_mismatch' ? 'title_mismatch' : c.type === 'page_absent' ? 'page_absent' : null;
    const phrasing = c.phrasing === 'ambiguous_presence' ? 'ambiguous_presence' : c.phrasing === 'pure_absence' ? 'pure_absence' : null;
    const inBody = asserted.length > 0 && body.includes(asserted);
    const inSubject = asserted.length > 0 && !inBody && subject.includes(asserted);
    if (!type || !phrasing || !c.service || (!inBody && !inSubject) || (type === 'title_mismatch' && !c.target_phrase)) {
      invalidCount++;
      return;
    }
    claims.push({
      claim_id: `c${i + 1}`,
      type,
      service: c.service,
      city: c.city || null,
      target_phrase: c.target_phrase || null,
      asserted_text: asserted,
      phrasing,
      in_subject: inSubject || undefined,
    });
  });
  return { claims, invalidCount };
}

export async function extractClaims(
  subject: string,
  body: string,
  services: string[],
  locales: string[],
  coverageTopics: string[],
  callModel: (prompt: string) => Promise<string>,
): Promise<ExtractionResult> {
  const output = await callModel(buildExtractionPrompt(subject, body, services, locales, coverageTopics));
  const parsed = parseJson<{ claims?: RawClaim[]; sweep?: Array<{ asserted_text?: string; note?: string }> }>(output);
  const { claims, invalidCount } = validateClaims(parsed.claims ?? [], subject, body);
  const sweep: SweepFlag[] = (parsed.sweep ?? [])
    .filter((s) => s.asserted_text)
    .map((s) => ({ asserted_text: s.asserted_text!, note: s.note ?? '' }));
  return { claims, sweep, invalidCount };
}
