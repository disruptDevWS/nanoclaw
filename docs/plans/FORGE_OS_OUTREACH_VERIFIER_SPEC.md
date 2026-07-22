# Forge OS — Outreach Claim Verifier Spec

> **Scope**: A pre-send verification layer for cold-outreach drafts. Confirms every falsifiable claim in a draft against real evidence before it reaches Matt's review queue, so review collapses to judgment instead of error-catching.
> **Owner**: Matt Edens / Forge Growth
> **Version**: v1 — 2026-07-22
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

**Input**: the draft + its structured claim list, filtered to absence/site-structure claims, each normalized to `{claim_id, type: 'page_absent'|'title_mismatch', service, city, asserted_text}`.

**Procedure per claim**:
1. Resolve the prospect site's page inventory: fetch `robots.txt` → `sitemap.xml`, plus a fetch of the homepage to read nav links; collect `{url, title, h1, nav_label}` per page.
2. Match `{service, city}` against the inventory (canonical/stemmed match — reuse `canonicalKeywordKey()` so "commercial refrigeration" ≈ "commercial refrigeration services," and city variants collapse).
3. If a plausible page exists → verdict `PRESENT` (claim is false → **cut or rewrite** the absence line).
4. If no page and the fetch was clean → verdict `ABSENT` (claim survives).
5. If the site is unreachable, bot-blocked, JS-only nav with an empty fetch, or the match is ambiguous → **escalate to render** (headless) once; if still unresolved → verdict `UNRESOLVABLE` → **flag for manual review**, never auto-pass.

**Output**: per-claim `{claim_id, verdict, evidence_url, matched_page?, occurred_at}` + a draft-level disposition: `clean` (all claims PRESENT-cut or ABSENT-confirmed), `needs_review` (any UNRESOLVABLE), `weakened` (claims cut, remaining draft still coherent) or `killed` (core hook was false — route back, don't send an empty pitch).

**Verdict is advisory-to-remove**: the verifier removes/softens refuted claims and flags what it can't clear. It never fabricates replacement claims and never rewrites Matt's voice — it subtracts and flags only.

---

## 4. Sequencing & the kill criterion

The prospecting motion is under a 4-week kill criterion from 2026-07-08 (~2 weeks remaining). Do **not** build a full automated-outreach methodology before the motion clears its own gate — that's premature investment in something that may be shut off.

Bucket B is the exception that survives this logic: it improves the **quality of sends during the trial itself** (non-refutable claims → higher reply rate → cleaner kill-decision signal). It pays for itself against the kill review. So: ship Bucket B now; hold Buckets A and C and the move-left-into-generation work until the motion has cleared and the verdict corpus (§1.5) shows where the generator actually fails.

---

## 5. Corpus notes (flags surfaced during taxonomy work)

- **Over-confident absence phrasing.** "Right now there is nothing there," "no real search presence behind them," "you have zero presence" state Bucket B's exact failure vector at maximum exposure. These are the first lines the verifier should gate.
- **Variant granularity gap** (separate thread, don't lose). The fitness join currently rides `utm_content` as `courtesy_note` / `pitch` — two archetypes, not specific variant IDs. Tracking-spec §3 wants `utm_content = variant_id`. Until that lands, the fitness function can't distinguish variants within an archetype. Not a verifier concern, but the same measurability gap.

---

## 6. Anti-patterns (do not do)

- Automating the send, ever (permanent brand principle).
- Defaulting to Playwright for Bucket B (fetch+parse first; render only on JS-nav/blocked fetch).
- Treating ranking-absence as page-absence (the invalid inference — the whole reason Bucket B exists).
- Silently passing or silently killing a prospect on an unresolvable claim (flag → manual queue).
- Letting the verifier write new claims or restyle Matt's voice (subtract-and-flag only).
- Building Buckets A/C or move-left generation before the motion clears its kill gate.
