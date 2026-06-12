# FOLLOWUPS.md — Deferred Items

Items captured during implementation sessions that are out of scope but shouldn't be forgotten.
Each entry is self-contained: picking it up 3 months later should not require rediscovery.

---

### [Pipeline] Content publication → AI visibility re-check feedback loop

- **Status:** Deferred. No clients have published enough Oscar content to measure AI visibility impact yet.
- **Action:** When content volume warrants it, add a trigger: Oscar marks page `published` → schedule per-cluster re-check of `visibility_queries` for that cluster. Could use a post-publish webhook or a separate cron that checks for recently published pages. The re-check would run `track-llm-mentions.ts` in cluster-targeted mode (single cluster, bypass 25-day recency for that cluster only).
- **Scope estimate:** M — new trigger path + targeted re-check mode
- **Captured:** Session 4, 2026-06-02

---

### [Pipeline] Perplexity AI visibility tracking

- **Status:** Blocked by DataForSEO. LLM Mentions API only supports `google` and `chat_gpt` platforms.
- **Action:** Monitor DataForSEO roadmap for Perplexity support. When available, add `perplexity` to the `PLATFORMS` array in `dataforseo-llm-mentions.ts` and update budget calculations.
- **Scope estimate:** S — add platform string + budget adjustment
- **Captured:** Session 4, 2026-06-02

---

### ~~[Pipeline/Dashboard] Gap `content_gap_observations` type mismatch~~ RESOLVED (Session 6, 2026-06-11)

- **Resolution:** `runGap()` now writes formatted strings into `content_gap_observations` (objects stay in `keyword_overview.authority_gaps`); ResearchPage filters non-strings defensively for legacy gap snapshots. Also fixed in the same session: `revenue_opportunity` `{value, basis}` objects rendered as `[object Object]` in Pam's brief gap table and cluster-strategy prompts — all consumers now use `formatRevenueOpportunity()` (`src/agents/gap/format-revenue.ts`); cluster-strategy gap lines referenced nonexistent `gap_description`/`notes` fields, now use `coverage_note`.
- **Captured:** Session 3, 2026-06-02 · **Resolved:** Session 6, 2026-06-11

---

### [Pipeline] `information_gain_gaps` as separate Gap output key

- **Status:** Deferred. The data currently available to the Gap agent (URL + title from crawl) is insufficient for reliable information gain inference. Instead, `coverage_note` was added to `authority_gaps` entries and Oscar's playbook got information gain self-assessment labels (`[ORIGINAL INSIGHT]`, `[CLIENT INPUT NEEDED]`, `[COMMODITY CONTENT]`).
- **Action:** When Section Coverage Matrix data is richer (e.g., includes section-level content hashes or topic depth scores), add `information_gain_gaps` as a first-class Gap output key with per-topic analysis of where the client can demonstrate original expertise vs where content is commodity.
- **Scope estimate:** M — Gap prompt update + sync + dashboard display
- **Captured:** Session 3, 2026-06-02

---

### ~~[Dashboard] Clusters page `cluster_strategy` status filter~~ RESOLVED

- **Resolved:** Session 2026-04-22 (Session C). Added `.eq('status', 'active')` to both `useClusterStrategy` and `useClusterStrategyPoll` queries in `lovable-repo/src/hooks/useClusterFocus.ts`. Deprecated strategies no longer shown.
- **Captured:** Session A, 2026-04-20

---

### ~~[Pipeline] `ranking_snapshots.cluster` column rename~~ — RESOLVED

- **Resolved:** 2026-05-29, Session 1. Migration 025 renamed `cluster` → `canonical_topic`. `track-rankings.ts` updated. No dashboard readers used the column directly.

---

### [Dashboard] Drop `intent` column on `audit_keywords`

- **Status:** Pipeline writers updated (2026-05-29) — no pipeline code writes to `intent` anymore. `generate-brief.ts` now reads `intent_type`.
- **Remaining:** Audit all `intent` column readers in lovable-repo (dashboard). Update them to use `intent_type`. Then drop `intent` column via migration.
- **Scope estimate:** S — dashboard reader audit + column drop migration.
- **Captured:** Session B addendum correction #4, 2026-04-21. Pipeline-side cleanup: Session 1, 2026-05-29

---

### ~~[Pipeline] Inject `core_services` into Haiku classification prompt for vocational verticals~~ RESOLVED

- **Resolved:** Session 2026-04-22. `coreServices?: string[]` added to `ClassifyOptions` in `classify-keywords.ts`. Haiku prompt conditionally injects service-preference guidance + business service list when `core_services` is populated. `pipeline-generate.ts` extracts from `audits.client_context` JSONB (comma-separated string → array). No prompt change when `core_services` is absent.
- **Captured:** Classification validation investigation, 2026-04-21

---

### ~~[Pipeline] IMA classification NULL backfill (self-healing)~~ RESOLVED

- **Resolved:** Session B re-canonicalize run (2026-04-21) populated all 1,100 IMA keywords. is_brand NULLs 198→0, intent_type NULLs 198→0, entity_type NULLs 410→0.
- **Captured:** Session B Check 1, 2026-04-21

---

### [Pipeline] IMA/SMA state page production gap — pending operator-directed content surface

- **Issue:** IMA (`geo_mode: state`, single state Idaho) has 17 state-level and 6 city-level geo pages in architecture. SMA (`geo_mode: state`, 6 states) has 28 state-level and 1 city-level. Both are `not_started`/`deprecated`. The new `STATE_GEO_BLOCK` provides principled guidance (delivery-intent → city, regulatory → state, follow the data), but existing architectures pre-date these principles.
- **Why it matters:** Re-running Michael on IMA/SMA with the new prompt will produce more principled geographic page structures. But this is an operator decision — the existing architectures have committed pages and cluster activations.
- **Prerequisites:** Operator decides whether to re-run Michael on IMA/SMA. If yes, review committed page preservation behavior on strategic re-run.
- **Scope estimate:** S per client — one Michael re-run + review deprecation candidates.
- **Captured:** Michael prompt revision session, 2026-04-22

---

### [Pipeline] Strategy brief prompt quality review — directive precision now load-bearing

- **Issue:** The Michael prompt now treats Strategy Brief binding constraints as hard constraints that suppress page creation. This means imprecise or overly broad Strategy Brief language can silently prevent legitimate pages from being built. The Strategy Brief prompt (`scripts/strategy-brief.ts`) was written when brief content was advisory, not binding.
- **Why it matters:** An overly broad prohibition like "avoid competitor terms" could suppress pages targeting legitimate keywords. Strategy Brief quality is now on the critical path for architecture accuracy.
- **Prerequisites:** Review `strategy-brief.ts` prompt for directive precision. Ensure the four sections (Visibility Posture, Keyword Research Directive, Architecture Directive, Risk Flags) use specific, falsifiable language rather than vague guidance.
- **Scope estimate:** M — prompt review + potential revision of strategy brief generation prompt.
- **Captured:** Michael prompt revision session, 2026-04-22

---

### [Schema] `geo_mode` semantic cleanup — city/metro conflate geographic unit with market count

- **Issue:** `geo_mode` values `city` and `metro` conflate the geographic unit (city) with the market type (single vs multi-market). A single-city client and a 5-city client both use `city` mode but may need different geographic architecture guidance. Similarly, `state` covers single-state (IMA) and multi-state (SMA) with different patterns.
- **Why it matters:** The `getGeographicArchitectureBlock()` function returns the same block for both single-city and multi-city clients. The geographic architecture principles are the same, but the scale implications differ.
- **Prerequisites:** Evaluate whether the current city/metro/state/national taxonomy is sufficient or whether market-count should be a separate dimension.
- **Scope estimate:** L — schema change across pipeline + dashboard + edge functions.
- **Captured:** Michael prompt revision session, 2026-04-22

---

### [Pipeline] Pam brief handling for dual-parent service+location pages

- **Issue:** The geographic architecture blocks describe a dual-parent relationship for service+location pages (service pillar = topical parent, geographic hub = geographic parent). Pam's content brief generation (`scripts/generate-brief.ts`) currently treats each page as belonging to a single silo. Dual-parent pages need both parents referenced in the brief.
- **Why it matters:** Content briefs for geographic service pages should reference both the service pillar's positioning and the geographic hub's market context. Without this, briefs may miss geographic specificity or service depth.
- **Prerequisites:** Review Pam's brief generation prompt for silo/parent context injection. Determine how dual-parent relationship should surface in the brief.
- **Scope estimate:** M — Pam prompt update + brief schema addition for secondary parent.
- **Captured:** Michael prompt revision session, 2026-04-22

---

### [Pipeline] Coverage assessment rows cause false positive slug corruption in Michael validation

- **Issue:** `runMichael()` pre-flight slug corruption check counts Buyer Journey Coverage Assessment table rows (e.g., "Awareness (problem recognition, research queries)") as rejected slugs. This produces false positive corruption ratios of ~30%, triggering unnecessary retries.
- **Why it matters:** Each retry costs one additional Sonnet call (~$0.10-0.15). The parser (`parseBlueprintMarkdown`) correctly filters these rows — the corruption check is less sophisticated.
- **Prerequisites:** The `checkBlueprint()` function in `runMichael()` uses `parseBlueprintMarkdown()` which has its own silo table regex. The regex should be tightened to only match actual silo page tables, not coverage assessment tables.
- **Scope estimate:** S — tighten the silo table regex in `parseBlueprintMarkdown()` to exclude `### Silo N Coverage Assessment` sections.
- **Captured:** Michael prompt revision validation, 2026-04-22

---

### [Pipeline] VALIDATION.md — Pipeline output validation framework

- **Issue:** No formal validation framework exists to verify pipeline outputs against expected contracts (schema shapes, field completeness, artifact presence). Validation is ad-hoc: manual spot checks after runs. Session C Part 2 was planned to create `docs/VALIDATION.md` documenting per-phase expected outputs, validation queries, and a runbook for post-pipeline verification.
- **Why it matters:** As the pipeline grows (13+ phases), regressions in one phase silently propagate downstream. A VALIDATION.md would codify what "correct output" looks like for each phase, enabling systematic verification after changes.
- **Prerequisites:** Review each phase's expected outputs (disk artifacts, Supabase writes, status transitions). Document validation queries that can be run against a live audit to confirm correctness.
- **Scope estimate:** M — documentation + optional validation script.
- **Captured:** Session C planning, 2026-04-22

### [Pipeline] KB analytics: persist + surface Workstream A outputs

- **Status:** Deferred until thresholds are validated over a couple of monthly cycles. The three analysis scripts (`compute-proven-ceiling.ts`, `detect-reeval-candidates.ts`, `detect-llm-citation-queries.ts`) currently write disk artifacts only (`audits/{domain}/analysis/`).
- **Action:** Once signal quality holds: (a) persist proven ceiling into `research_data.json`/`audit_snapshots` during syncJim; (b) lightweight tables (or JSONB) for re-eval candidates and LLM citation queries; (c) surface LLM citation queries in the dashboard AI Visibility section alongside DataForSEO mentions; (d) consider wiring all three into the monthly cron after `track-rankings`/`fetch-gsc-data`.
- **Tuning notes from 2026-06-12 verification:** A2 flags pasted quiz questions ("select one answer…") — consider an optional exclusion regex or a separate `quiz_paste` reason tag. A1 IMA candidates are all lower-bound growth (pages predate tracking) — revisit once execution_pages publish dates accumulate. SMA is cold-start (1 owned keyword) — ceiling unusable there until rankings improve.
- **Scope estimate:** M — sync hook + 1–2 tables + dashboard section
- **Captured:** KB extraction Session 1, 2026-06-12

---

### [Pipeline] Proven ceiling injection into Strategy Brief / Michael / Cluster Strategy

- **Status:** Deferred (prompt change — Workstream A was data-only). Ceiling artifact exists per domain at `audits/{domain}/analysis/proven_ceiling.json`.
- **Action:** Inject "proven ranking ceiling KD {N} + cluster ceilings" into Strategy Brief (Phase 1b) as a quantified authority assessment, and into Michael/Cluster Strategy as a stretch-target flag ("keywords above the cluster ceiling require additional authority building"). Compute during syncJim so it's fresh per run. Belongs with the planned Gap revision session (B1 SERP composition uses the ceiling as its baseline).
- **Scope estimate:** M — compute-in-sync + 2–3 prompt injections, verify on Weiser full-pipeline first per protect-real-clients rule
- **Captured:** KB extraction Session 1, 2026-06-12

---
