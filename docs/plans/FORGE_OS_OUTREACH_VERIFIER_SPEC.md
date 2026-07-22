# Forge OS — Outreach Claim Verifier Spec

> **Scope**: A pre-send verification layer for cold-outreach drafts. Confirms every falsifiable claim in a draft against real evidence before it reaches Matt's review queue, so review collapses to judgment instead of error-catching.
> **Owner**: Matt Edens / Forge Growth
> **Version**: v1.2 — 2026-07-22 (v1.1 + PRESENT-verdict soften-not-rewrite fix, grounded extraction, placement, coherence gate; §5 kill-signal confound framing)
> **Consumers**: outreach generator (`generate-outreach-email.ts`), a new verification stage, the Daily Prospector digest, the outreach fitness function.
> **Companion doc**: `FORGE_OS_OUTREACH_TRACKING_SPEC.md` (the measurement side).

---

## 0. The boundary (read first — it bounds everything below)

The verifier automates **verification**, never the **send**. Draft-only outreach is a permanent brand principle ("one accountable expert," human-in-the-loop where reputation is at stake), not a stopgap. No send call exists in the codebase and none is added here.

Manual review currently does two jobs at once:

- **Verification** — is every falsifiable claim true and non-refutable against real evidence? *Commodity. Automatable. High upside.*
- **Judgment** — right business, right angle, right voice, worth Matt's name in a small footprint? *Irreducible. The actual product.*

The verifier strips the first off Matt's plate so his remaining attention is pure judgment. Same human gate, a fraction of the load, every draft pre-vetted. "Automated territory" means automated verification and prep, human decision — full stop.

---

## 1. Principles

1. **Claims split by evidence source, not by topic.** Every falsifiable statement in a draft resolves against one of three sources (§2). Each needs a different primitive and carries a different failure mode. The verifier is really three passes, not one "look at the site" agent.
2. **Absence claims are inferred, not observed — that's the core risk.** Scout is DataForSEO-only and never crawls the prospect's site. It infers page-absence from *ranking*-absence, which is an invalid inference: a site can have a page and simply not rank it. This is the single largest refutation vector and the highest-value thing to verify.
3. **Reach for the cheapest primitive that answers the claim.** Most site-structure checks are fetch+parse (sitemap, titles, H1s, nav). Escalate to a headless render only when nav/content is JS-built and invisible to a plain fetch. Playwright is a fallback inside one bucket, not the front door.
4. **Fail loud → flag, never drop.** A claim the verifier can't resolve (unreachable site, bot-blocked, ambiguous) is marked and escalated to Matt's manual queue. It is never silently passed and never silently kills the prospect. Mirrors the system's fail-loud pattern.
5. **The verdict log is the real asset.** Every claim→verdict pair is labeled data on which claims fail against reality. Fed back, it hardens the generator so it stops emitting refutable claims. Build the checker as a discrete post-hoc stage first to earn that corpus, then move verification left into generation. (Disk-first, then earn the upstream change.)

---

## 2. The claim taxonomy (verifier input contract)

Derived from the live draft corpus (15 drafts, `courtesy_note` and `pitch` variants), 2026-07-22.

### Bucket A — SERP / data-derived claims
Rank positions ("position 21 for electrician butte mt," "40th," "page 8"), search volumes ("480/mo," "140," "60," "320"), CPC ("$37 CPC"), modeled revenue ("$3,136/mo"), branded-search position ("your business name isn't showing until page two"), competitor-capture ("140 people search [competitor] by name").

- **Evidence source**: fresh DataForSEO re-query. *Not* site-checkable; Playwright irrelevant.
- **Failure mode**: **staleness** — the rank moved between the Scout run and the send. Not fabrication (keyword-identity hygiene already guards that).
- **Verifier**: re-pull SERP/volume, compare to the asserted value within a tolerance band; downgrade/soften or cut if it drifted past tolerance.

### Bucket B — Site-structure claims  ← BUILD FIRST
"No visible presence for residential electrical," "no dedicated page for commercial refrigeration," "no page targeting plumber coeur d'alene," "nothing there," "no real search presence behind them," "zero presence in Spokane," and title/H1-mismatch implications ("a title and header that match that phrase exactly").

- **Evidence source**: the prospect's live site — sitemap, page titles, H1s, nav.
- **Failure mode**: **invalid inference** (Principle 2). Systematic false positives: page exists but doesn't rank, so "you have no page for X" is refutable in ten seconds by the owner. This is the dominant recommendation hook in the courtesy-note variant, so the risk is load-bearing.
- **Verifier**: fetch+parse; escalate to render only for JS-built nav. This is Verify-Dwight scoped to the draft's absence-claims. **Detailed contract in §3.**

### Bucket C — Off-site business-fact claims
"Claim and fill out your Google Business Profile," "NAP consistent across listings," "a handful of genuine Google reviews," service-area truth ("*if* you serve Sandpoint," "despite serving both markets").

- **Evidence source**: GBP / DataForSEO Business Data / the Phase 6d directory-scan primitive. Not the site, not Playwright.
- **Failure mode**: asserting GBP state (unclaimed/incomplete) or a service area that's wrong; the "*if* you serve X" hedge is the generator flagging an unconfirmed fact.
- **Verifier**: reuse existing 6d GBP + citation-scan primitives; resolve service-area conditionals and drop the hedge when confirmed.

---

## 3. Bucket B verifier — build-first contract

**Trigger**: runs on the 3/day that become drafts, not the candidate pool — cost stays bounded to the qualified subset (Scout is already ~$2/run; a fetch pass is near-free).

**Placement**: inside `generate-outreach-email.ts`, **before** the Gmail step — verify the generated body, then create the draft from the vetted text. Never create-then-edit: an unvetted draft must not exist in Gmail even transiently (the morning digest could surface it before verification runs), and vet-first avoids a draft-update round trip.

**Input**: the draft + its structured claim list, filtered to absence/site-structure claims, each normalized to `{claim_id, type: 'page_absent'|'title_mismatch', service, city, asserted_text, target_phrase?}` (`target_phrase` required for `title_mismatch` — the match check needs to know which phrase the title is supposed to contain).

**Extraction grounding**: claims are prose-only today, so extraction is itself an LLM step — and its recall gaps become false-clean dispositions, which manufacture false confidence. Constrain it: ground on the run's `scope.json` (`services` / `locales` / `service_coverage`) and ask "which of these known services/locales does the draft assert absence for?" rather than open-ended NER. In-run the file is on the volume; if verification ever runs out-of-band (e.g. re-verify at Mark-Sent), fall back to `prospects.scout_scope_json` — cron-scouted prospect configs are ephemeral (digest-only), same DB-fallback pattern Pam and `/scout-report` already use.

**Procedure per claim**:
1. Resolve the prospect site's page inventory: fetch `robots.txt` → `sitemap.xml`, plus a fetch of the homepage to read nav links; collect `{url, title, h1, nav_label}` per page.
2. Match `{service, city}` against the inventory (canonical/stemmed match — reuse `canonicalKeywordKey()` so "commercial refrigeration" ≈ "commercial refrigeration services," and city variants collapse).
3. If a plausible page exists → verdict `PRESENT`. Disposition depends on claim phrasing:
   - **Pure page-absence claims** ("no dedicated page for X," "no page targeting Y") are falsified outright by an existing page → **cut**.
   - **Ambiguous presence phrasings** ("no real search presence," "zero presence in {city}," "nothing there") can still be *true* when the page exists but doesn't rank. But the truthful correction is a *ranking* statement — Bucket A evidence the Bucket B verifier does not hold. Auto-upgrading would either re-query the SERP (Bucket A, deferred) or reassert the stored Scout position unchecked (the exact staleness risk Bucket A exists to catch) — reintroducing LLM-generated factual claims into the stage whose purpose is removing them. Bucket-B-legal actions only: **soften to remove the absolute** ("limited presence") or **flag to manual review**. Ranking rewrites wait for Bucket A. This keeps v1 provably site-evidence-only.
4. If no page and the fetch was clean → verdict `ABSENT` (claim survives).
5. If the site is unreachable, bot-blocked, JS-only nav with an empty fetch, or the match is ambiguous → **escalate to render** (headless) once; if still unresolved → verdict `UNRESOLVABLE` → **flag for manual review**, never auto-pass.

**Output**: per-claim `{claim_id, verdict, evidence_url, matched_page?, occurred_at}` + a draft-level disposition: `clean` (all claims PRESENT-cut or ABSENT-confirmed), `needs_review` (any UNRESOLVABLE), `weakened` (claims cut, remaining draft still coherent) or `killed` (core hook was false — route back, don't send an empty pitch). `weakened` carries an explicit **coherence gate**: coherence is checked, not assumed — if cutting a claim leaves a stub (a gutted courtesy note, a pitch with no hook), route to `needs_review` instead of shipping it.

**Verdict is advisory-to-remove**: the verifier removes/softens refuted claims and flags what it can't clear. It never fabricates replacement claims and never rewrites Matt's voice — it subtracts and flags only.

---

## 4. Sequencing & the kill criterion

The prospecting motion is under a 4-week kill criterion from 2026-07-08 (~2 weeks remaining). Do **not** build a full automated-outreach methodology before the motion clears its own gate — that's premature investment in something that may be shut off.

Bucket B is the exception that survives this logic: it improves the **quality of sends during the trial itself** (non-refutable claims → higher reply rate → cleaner kill-decision signal). It pays for itself against the kill review. So: ship Bucket B now; hold Buckets A and C and the move-left-into-generation work until the motion has cleared and the verdict corpus (§1.5) shows where the generator actually fails.

---

## 5. Corpus notes (flags surfaced during taxonomy work)

- **Over-confident absence phrasing.** "Right now there is nothing there," "no real search presence behind them," "you have zero presence" state Bucket B's exact failure vector at maximum exposure. These are the first lines the verifier should gate.
- **Deferred surface: the prospect narrative / share page — a limitation, not a solve.** The email's one link renders `prospect-narrative.md` on the share page — the more detailed, higher-exposure surface, generated by the same ungated process from the same absence-inference-prone data. v1 scopes verification to the **email draft body only**, which means it mainly protects the prospects who *don't* click; clickers still hit the refutable claim in the report. That clicker population is exactly the signal §4 hands to the kill decision, so unverified share-page claims are a **confound in the kill-gate data**: a click-no-book could mean the offer failed or that the narrative got refuted on the page, and the two are indistinguishable. v1 stays email-only regardless — it's bounded, earns the verdict corpus, and protects non-clickers — but email verification makes the *email* defensible, not the *send*. The narrative-phase move-left work (§1.5) is where the exposure and the signal contamination actually concentrate; the v1 verdict corpus is what de-risks it. Sequencing holds; the framing must not overclaim.
- **Variant granularity gap** (separate thread, don't lose). The fitness join currently rides `utm_content` as `courtesy_note` / `pitch` — two archetypes, not specific variant IDs. Tracking-spec §3 wants `utm_content = variant_id`. Until that lands, the fitness function can't distinguish variants within an archetype. Not a verifier concern, but the same measurability gap.

---

## 6. Anti-patterns (do not do)

- Automating the send, ever (permanent brand principle).
- Defaulting to Playwright for Bucket B (fetch+parse first; render only on JS-nav/blocked fetch).
- Treating ranking-absence as page-absence (the invalid inference — the whole reason Bucket B exists).
- Silently passing or silently killing a prospect on an unresolvable claim (flag → manual queue).
- Letting the verifier write new claims or restyle Matt's voice (subtract-and-flag only).
- Auto-upgrading an ambiguous-presence claim into a ranking statement (asserting Bucket A facts from Bucket B evidence — soften or flag instead; ranking rewrites wait for Bucket A).
- Building Buckets A/C or move-left generation before the motion clears its kill gate.
