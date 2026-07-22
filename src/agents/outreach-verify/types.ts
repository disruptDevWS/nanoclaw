/**
 * types.ts — Outreach claim verifier (Bucket B) contract types.
 *
 * Mirrors FORGE_OS_OUTREACH_VERIFIER_SPEC.md §3. The VerificationArtifact is
 * the verdict-log corpus entry — the first-class deliverable that later
 * hardens the generator.
 */

export type ClaimType = 'page_absent' | 'title_mismatch';

/**
 * pure_absence: asserts a page/content does not exist ("no dedicated page
 *   for X") — falsified outright by an existing page → cut.
 * ambiguous_presence: absolute presence statements ("zero presence in
 *   Spokane") that can be true even when a page exists but doesn't rank —
 *   PRESENT → soften the absolute or flag; never a ranking rewrite (spec §6).
 */
export type ClaimPhrasing = 'pure_absence' | 'ambiguous_presence';

export type Verdict = 'PRESENT' | 'ABSENT' | 'UNRESOLVABLE';
export type ClaimAction = 'kept' | 'cut' | 'softened' | 'flagged';
export type Disposition = 'clean' | 'needs_review' | 'weakened' | 'killed';

export interface ExtractedClaim {
  claim_id: string;
  type: ClaimType;
  service: string;
  city: string | null;
  /** Required for title_mismatch: the phrase the title/H1 is said to lack. */
  target_phrase: string | null;
  /** Exact verbatim substring of the draft (validated in code, fail loud). */
  asserted_text: string;
  phrasing: ClaimPhrasing;
  /** True when the substring was found in the subject line, not the body —
   *  not subtractable, always flagged. */
  in_subject?: boolean;
}

export interface SweepFlag {
  asserted_text: string;
  note: string;
}

export interface VerifiedClaim extends ExtractedClaim {
  verdict: Verdict;
  matched_page: string | null;
  evidence_url: string | null;
  /** Why UNRESOLVABLE / why an action fell back to flagged. */
  reason: string | null;
  action: ClaimAction;
  occurred_at: string;
}

export type InventorySource = 'sitemap' | 'nav';
export type InventoryQuality = 'complete' | 'nav_only' | 'thin';

export interface InventoryPage {
  /** Path + search, origin-relative (matches fetch-page internalLinks). */
  url: string;
  title: string | null;
  h1: string | null;
  nav_label: string | null;
  source: InventorySource;
}

export interface SiteInventory {
  origin: string;
  quality: InventoryQuality;
  sources_tried: string[];
  page_count: number;
  pages: InventoryPage[];
  /** 403/429/challenge — every claim goes UNRESOLVABLE. */
  blocked: boolean;
  errors: string[];
}

export interface VerificationArtifact {
  verifier_version: '1';
  domain: string;
  prospect_id: string;
  variant: 'pitch' | 'courtesy_note';
  verified_at: string;
  scope_source: 'disk' | 'db';
  inventory: {
    quality: InventoryQuality;
    sources_tried: string[];
    page_count: number;
    pages_inspected: InventoryPage[];
    errors: string[];
  } | null; // null when zero claims extracted (no fetches made)
  claims: VerifiedClaim[];
  extractor: { grounded_claims: number; sweep_flags: number; invalid_claims: number };
  sweep: SweepFlag[];
  coherence_gate: { applied: boolean; reason: string | null };
  disposition: Disposition;
  body_before: string;
  /** What ships to DB/Gmail. null when disposition=killed. */
  body_after: string | null;
}

export interface VerifyDraftInput {
  domain: string;
  prospectId: string;
  subject: string;
  body: string;
  variant: 'pitch' | 'courtesy_note';
  /** From scope.json (disk) or prospects.scout_scope_json (db fallback). */
  services: string[];
  locales: string[];
  /** service_coverage topic keys, when present — extra grounding vocabulary. */
  coverageTopics: string[];
  scopeSource: 'disk' | 'db';
  /** LLM caller, injected by the script layer (src must not import scripts). */
  callModel: (prompt: string) => Promise<string>;
  log?: (msg: string) => void;
}
