# Implementation Plan — Outreach Claim Verifier, Bucket B

> **Status**: PROPOSED — awaiting independent architectural review before any execution.
> **Contract**: `docs/plans/FORGE_OS_OUTREACH_VERIFIER_SPEC.md` v1.2 (§3 build-first contract).
> **Scope**: Bucket B only (site-structure claims). Buckets A/C and move-left generation are deferred behind the motion's kill gate (spec §4). Email draft body only; the narrative/share-page surface is a documented limitation, not a target (spec §5).
> **Date**: 2026-07-22

---

## 1. Claim-source finding (verified against the code)

**Prose-only. No structured claim list exists anywhere in the pipeline.**

- `scripts/generate-outreach-email.ts:281-300` — one Claude call returns free text, parsed only into `subject`/`body` via `---SUBJECT---`/`---BODY---` markers. Nothing per-assertion is captured.
- The DB persists only `outreach_subject`, `outreach_body`, `outreach_variant` (`prospects`, migration 043).
- The absence claims originate **upstream of the email script**: the prospect-narrative prompt in `scripts/pipeline-generate.ts` (~line 6168) mandates phrasing like *"When someone in {city} searches for {service}, your competitors appear. You don't."* The email generator receives that finished narrative plus raw keyword strings from `top_opportunities` — it never holds `{service, city}` pairs itself.
- The structured data behind the claims lives in `scope.json`: `services`, `locales`, `service_coverage` (per-topic defending/weak/gaps). Available on disk in-run (`audits/{domain}/scout/{date}/scope.json`) with the established DB fallback `prospects.scout_scope_json` (`loadScoutData()`, generate-outreach-email.ts:146-186).

**Consequence**: v1 needs a claim-extraction step (§3 below), grounded on `scope.json` per spec §3 "Extraction grounding." Structuring claims at generation time is a change to the narrative phase in `pipeline-generate.ts` — move-left work explicitly deferred behind the kill gate; noted as future direction only.

---

## 2. Pipeline placement + flow

Per spec §3 "Placement": **inside `generate-outreach-email.ts`, between copy generation and persistence — strictly before the Gmail step.** The Gmail draft is created from the vetted body only; never create-then-edit.

### New flow (replaces steps 6–7 of the current script)

```
6.  generateEmail()                        (unchanged)
6a. verifyDraft(body, scope, prospect):    NEW — src/agents/outreach-verify/
      extract claims (grounded on scope.json)
      resolve site inventory (robots → sitemap → homepage nav)
      match {service, city} per claim → verdict
      apply subtractions (deterministic cut/soften) + coherence gate
      → { bodyAfter, disposition, claims[], artifact }
      write audits/{domain}/outreach/{date}/verification.json
7.  persist to prospects:                  MODIFIED
      outreach_body = bodyAfter (source of truth stays the vetted text)
      outreach_status = 'generated'        (clean | weakened)
                      | 'needs_review'     (any UNRESOLVABLE, or coherence-gate trip)
                      | 'killed'           (core hook falsified)
      outreach_verification_json = artifact mirror (see §4)
8.  Gmail step:                            MODIFIED — gated
      runs ONLY for disposition clean|weakened → outreach_status='drafted'
      needs_review/killed → NO Gmail draft exists; digest is the manual queue
```

**Prospect-mode interaction**: `cron-prospector.ts` step 6 spawns this script (awaited, 5-min timeout — a handful of extra fetches fits comfortably). Because the verifier runs in-process before the Gmail step, the morning digest can never surface an unvetted draft: a flagged prospect reaches the digest as *flagged*, with no Gmail draft behind it. `--force` re-runs generation **and** verification.

**Manual-queue resolution (v1)**: `needs_review`/`killed` prospects appear in the digest with their claim verdicts. Matt resolves by either re-running with `--force` (after the site/claim reality is understood) or a new `--approve-flagged` flag that creates the Gmail draft from the current DB body as-is — the explicit human judgment call the spec's boundary (§0) reserves for him. No silent path from flagged to drafted.

### Verifier internals (all NEW, `src/agents/outreach-verify/`)

| Module | Responsibility |
|---|---|
| `extract-claims.ts` | One Haiku/Sonnet call (`phase: 'outreach_claim_extract'`, registered in `PHASE_MAX_TOKENS`). Prompt is **grounded**: given `scope.json`'s `services`/`locales`/`service_coverage` and the draft body, "which of these known services/locales does the draft assert absence for?" — not open NER. Each claim must return `asserted_text` as an **exact verbatim substring** of the body (validated in code; a non-substring claim → `needs_review`, fail loud). `target_phrase` required for `title_mismatch`. A second sweep question — "any other absence-shaped assertions not in the known list?" — can only *flag* (→ `needs_review`), never resolve; this bounds extraction-recall risk (spec: false-clean is worse than no verifier). |
| `site-inventory.ts` | `robots.txt` (Sitemap: directives) → `sitemap.xml`/`sitemap_index.xml` → homepage fetch for nav links. Reuses `fetchPage()`/`fetchSiteFile()` from `src/agents/page-audit/fetch-page.ts` (cheerio, one request per page) and the robots/sitemap patterns proven in `verify-dwight.ts`. Fetches title/H1 for candidate pages only (matched-or-near URLs), not the whole sitemap — bounded requests. Produces `{url, title?, h1?, nav_label?, source}` plus an **inventory-quality signal**: `complete` (sitemap parsed) \| `nav_only` (no sitemap; nav links ≥ threshold) \| `thin` (neither). |
| `match.ts` | `canonicalKeywordKey()`-based matching of `{service, city}` against inventory URL slugs, titles, H1s, nav labels. Pure functions, fixture-tested. |
| `subtract.ts` | **Deterministic string surgery, no LLM.** `cut`: remove the sentence containing `asserted_text`. `soften`: phrase-level substitution removing the absolute (per spec §3 — "zero presence" → "limited presence"); if no clean substitution applies, → flag. Never generates new content, never touches ranking language (spec §6 anti-pattern). Coherence gate: after cuts, if the remaining body falls below the variant's word floor (pitch 100 / courtesy 80) or the cut removed the opening hook (first two sentences of a pitch), disposition → `needs_review` — never ship a stub. |
| `index.ts` | `verifyDraft()` orchestrator: verdict assignment per spec §3 steps 1–5, artifact assembly, disposition. |

**Verdict logic** (spec §3): match found → `PRESENT` (pure page-absence → cut; ambiguous phrasing → soften or flag — never a ranking rewrite). No match **and** inventory-quality `complete` → `ABSENT`. No match with `nav_only`/`thin` inventory, unreachable site, bot-block (403/429/challenge), or ambiguous match → `UNRESOLVABLE` → flag. *An incomplete inventory must not mint `ABSENT` — that would re-commit the invalid inference with the verifier's own signature on it.*

### File touch-list

| File | Change |
|---|---|
| `src/agents/outreach-verify/{extract-claims,site-inventory,match,subtract,index}.ts` | NEW — verifier |
| `src/agents/outreach-verify/*.test.ts` | NEW — vitest unit tests (match/subtract/coherence/verdicts on fixtures; no network) |
| `src/lib/keyword-canonical.ts` | NEW — `canonicalKeywordKey`, `stemKeywordToken`, `ALL_STATE_TOKENS` extracted from `pipeline-generate.ts` (currently private at ~line 1067) |
| `scripts/pipeline-generate.ts` | MOD — import from `src/lib/keyword-canonical.ts`, delete local copies (behavior-identical move) |
| `scripts/generate-outreach-email.ts` | MOD — insert verify stage, disposition-gated Gmail step, artifact write + jsonb mirror, `--approve-flagged` |
| `scripts/cron-prospector.ts` | MOD — digest entries show disposition + flagged-claim summary |
| `scripts/migrations/050-outreach-verification.sql` | NEW — `prospects.outreach_verification_json jsonb` (nullable); `outreach_status` is text, new values need no schema change |
| `docs/PIPELINE.md`, `docs/DATA_CONTRACT.md`, `docs/DECISIONS.md` | MOD — see §5 |

---

## 3. Verdict-log schema (artifact shape — the first-class deliverable)

**Path**: `audits/{domain}/outreach/{date}/verification.json` (new `outreach/` sibling of `scout/` under the domain dir; dated like every other artifact). Disk-first per convention; no DB *table* — thresholds must be earned first (spec §1.5).

```jsonc
{
  "verifier_version": "1",              // schema version for the future corpus reader
  "domain": "example.com",
  "prospect_id": "uuid",
  "variant": "pitch",                   // pitch | courtesy_note
  "verified_at": "2026-07-22T14:00:00Z",
  "scope_source": "disk",               // disk | db  (scout_scope_json fallback used?)
  "inventory": {
    "quality": "complete",              // complete | nav_only | thin
    "sources_tried": ["robots", "sitemap", "homepage_nav"],
    "page_count": 42,
    "pages_inspected": [                // only candidates fetched for title/h1
      { "url": "/services/commercial-refrigeration", "title": "...", "h1": "...", "nav_label": "...", "source": "sitemap" }
    ],
    "errors": []                        // fetch failures, verbatim — fail loud
  },
  "claims": [
    {
      "claim_id": "c1",
      "type": "page_absent",            // page_absent | title_mismatch
      "service": "commercial refrigeration",
      "city": "spokane",
      "target_phrase": null,            // required when type=title_mismatch
      "asserted_text": "no dedicated page for commercial refrigeration",
      "phrasing": "pure_absence",       // pure_absence | ambiguous_presence  (drives PRESENT disposition)
      "verdict": "PRESENT",             // PRESENT | ABSENT | UNRESOLVABLE
      "matched_page": "/services/commercial-refrigeration",
      "evidence_url": "https://example.com/services/commercial-refrigeration",
      "action": "cut",                  // kept | cut | softened | flagged
      "occurred_at": "2026-07-22T14:00:02Z"
    }
  ],
  "extractor": { "grounded_claims": 3, "sweep_flags": 0 },   // recall accounting
  "coherence_gate": { "applied": false, "reason": null },
  "disposition": "weakened",            // clean | needs_review | weakened | killed
  "body_before": "…",                   // full pre-verification body
  "body_after": "…"                     // what shipped to DB/Gmail (null when killed)
}
```

**Durability caveat** (open risk, mitigated): Railway container disk is ephemeral — the exact reason `scout_scope_json` exists. A disk-only corpus generated by the cron path would silently evaporate. Mitigation: mirror the artifact verbatim into `prospects.outreach_verification_json` (jsonb, latest-run-wins — same disk-first/DB-mirror pattern as `scout_scope_json`, not a new table). The corpus reader of the future reads disk locally, DB for cron-era rows.

---

## 4. Open risks & spec-to-code mismatches

1. **Render escalation (spec §3 step 5): Playwright is not a dependency of this repo.** Only cheerio is. Adding a headless-browser dep + browser binary to the Railway image for a fallback path — inside a motion two weeks from its kill review — is premature weight. **Proposal (spec deviation, needs sign-off)**: v1 routes JS-only-nav/empty-fetch cases to `UNRESOLVABLE` → manual queue, and the artifact records how often that branch fires. Never-auto-pass is preserved exactly; what's lost is only auto-*resolution* of that subset. If the corpus shows the branch fires often, the Playwright escalation is a contained fast-follow (`site-inventory.ts` only). DECISIONS.md entry required.
2. **Extraction recall is the load-bearing risk** (false-clean → manufactured confidence). Mitigations baked into §2: grounded prompt over known services/locales, verbatim-substring validation, and the flag-only second sweep. Residual risk stated honestly: a claim phrased entirely outside scope.json vocabulary can still slip past — the corpus is the instrument that measures this.
3. **Incomplete inventory → false `ABSENT`.** Sites without sitemaps get nav-only inventories; a page absent from nav is not absent from the site. Handled by the inventory-quality signal: only `complete` inventories can mint `ABSENT` (see §2 verdict logic). Expect more `UNRESOLVABLE` on small/old sites — correct per fail-loud, but it raises Matt's queue volume; the digest summary keeps that visible.
4. **Kill-signal confound stands** (spec §5): this build makes the *email* defensible, not the send. Clickers still hit the unverified narrative on the share page; click-no-book stays ambiguous in the kill-gate data. Documented limitation — no v1 action, and the plan deliberately does not touch the narrative phase.
5. **Softening is language surgery on LLM prose.** Deterministic substitution can produce grammatical seams. Bounded by: soften only on a small whitelist of absolute-phrasing patterns; anything outside it → flag rather than mangle. Voice risk is zero (no generation), seam risk routes to Matt.
6. **`courtesy_note` drafts lean hardest on absence claims** (their dominant hook, spec §2-B), so `killed`/`needs_review` will concentrate there. Expected and correct — but worth watching in the digest so the queue doesn't quietly fill with courtesy notes.
7. **Minor**: spec §3's `title_mismatch` claims are recommendation-shaped ("a title that matches that phrase exactly"); verification checks the title does *not* already match `target_phrase` — inverse polarity from `page_absent`. Handled in `match.ts`; noted so the verdict semantics don't surprise the reviewer.

---

## 5. Doc updates (same change, not follow-ups)

- **PIPELINE.md** — Outreach section: new step between generation and persistence (verify → disposition-gated Gmail step); status values `needs_review`/`killed`; `--approve-flagged`; artifact path; digest disposition line in the Daily Prospector section.
- **DATA_CONTRACT.md** — `prospects` table: `outreach_status` value set extended (`none|generated|needs_review|killed|drafted|sent`), new `outreach_verification_json` column (writer: generate-outreach-email.ts; readers: digest, future corpus reader). Artifact table: `audits/{domain}/outreach/{date}/verification.json` row. Migration 050 noted.
- **DECISIONS.md** — three entries: (a) render escalation deferred to fast-follow, with the §4.1 rationale and the corpus-frequency trigger for revisiting; (b) verdict corpus disk-first with jsonb mirror (Railway ephemerality; `scout_scope_json` precedent); (c) deterministic subtraction over LLM rewrite (voice-preservation guarantee, seams route to manual).
