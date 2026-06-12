# ForgeOS Pipeline Enhancement: Knowledge Base Extraction Implementation

## Context for Fable

An external SEO knowledge base (27 sections, grounded in the May 2024 Google Content Warehouse API leak, DOJ trial testimony, and practitioner frameworks) was analyzed against the current ForgeOS pipeline state. A full extraction map was produced identifying novel methodology and decision logic not already captured in agent prompts, system files, or pipeline logic.

**Corrections applied 2026-06-12:** every data-source claim below was verified against the live repo and DATA_CONTRACT.md. Sections marked "(verified)" reflect actual schema/code state — trust them over your own assumptions, but re-verify live schema before any migration per CLAUDE.md.

This prompt covers implementation of all items with defensible value. The extraction map is provided inline below. The source knowledge base repo is locally available at `/home/forgegrowth/claude-code-seo/` — reference `/home/forgegrowth/claude-code-seo/knowledge-base/seo-knowledge-base.md` for exact methodology details and `/home/forgegrowth/claude-code-seo/commands/` for the command implementations (particularly `seo-analyze.md` for proven ceiling methodology and `seo-re-eval.md` for re-evaluation detection logic).

**Note:** Jim's prompt is still inline in `scripts/pipeline-generate.ts` (~30 interpolations, not yet extracted to `configs/agents/`). For Jim-related changes (A3 proven ceiling injection), Fable should work directly in `pipeline-generate.ts`.

**Governing constraints (from DECISIONS.md 2026-04-09 — these are hard boundaries):**
- Do NOT inject T*/Q*/P* signal weights or interpretive leak material into any agent prompt. "Agent prompts can't hold the 'confirmed field / uncertain weight' distinction."
- The leak signal material remains parked at `docs/research/google-signals-leak.md` as human consultation material. (The original proposal called it `scoring-signals.md` — that filename does not exist; grep for `google-signals-leak`.)
- `siteRadius`/`siteFocusScore` injection into Michael remains deferred — the over-pruning risk is unresolved.
- Content effort spec is already integrated in `seo-playbook.md` §5. Do not duplicate.

**Load these context files at session start (paths relative to `/home/forgegrowth/forge-os-pipeline/`):**
- Do NOT bulk-read `PIPELINE.md`, `DATA_CONTRACT.md`, or `DECISIONS.md` (~80k tokens combined — CLAUDE.md mandates grep-as-needed). Grep them for the specific phase/table/decision you're touching. `docs/FOLLOWUPS.md` is small and fine to read.
- `configs/oscar/seo-playbook.md`
- `configs/agents/pam/system-prompt.md`
- `configs/agents/gap/system-prompt.md`
- `configs/agents/strategy-brief/system-prompt.md`
- `configs/agents/michael/system-prompt.md`
- `/home/forgegrowth/claude-code-seo/knowledge-base/seo-knowledge-base.md` (source reference)
- `/home/forgegrowth/claude-code-seo/commands/seo-analyze.md` (proven ceiling methodology)
- `/home/forgegrowth/claude-code-seo/commands/seo-re-eval.md` (re-evaluation detection logic)

---

## Workstream A: Performance Analytics Layer (no prompt changes, pure data)

These additions run against existing data tables during monthly cron or on-demand analysis. Zero agent prompt risk. Verify independently before touching anything downstream.

### A1: NavBoost Re-Evaluation Candidate Detection

**What:** Automatically flag pages that were evaluated by Google when their topic cluster was small but have since gained significant topical authority — candidates for republish under a new URL with 301 redirect to trigger re-evaluation against current authority.

**Mechanism (confirmed — Pandu Nayak sworn DOJ testimony):** NavBoost uses a rolling 13-month window of aggregated click data. Pages published when a cluster had 3 pages still carry that stale authority score even if the cluster now has 25 pages. Republishing under a new URL hits a fresh 13-month window.

**Detection criteria:**
1. Page ranks position 8–25 (visible but not top — the "almost there" zone)
2. Target keyword KD < 30 (should be rankable given cluster authority)
3. Cluster has grown significantly since page publish: `cluster_keyword_count_now / cluster_keyword_count_at_publish > 2.0` (or use cluster page count as proxy)
4. Page is > 6 months old (needs time for cluster growth to be meaningful)

**Data sources (verified 2026-06-12):**
- Per-page position: `ranking_snapshots` is keyword-level with NO page URL column — it cannot give position-per-page directly. Use `gsc_page_snapshots` (avg position per path; `page_url` stores PATHS like `/emt-seattle`, not full URLs — match on pathname) or join `audit_keywords.rank_pos` + `ranking_url`.
- KD: `audit_keywords` has NO keyword_difficulty column. A1 depends on A3's KD-persistence prerequisite — do A3 first (already the planned sequence).
- Current cluster size: `audit_clusters` keyword count.
- Historical cluster size: `cluster_performance_snapshots.keyword_count` per `snapshot_date` — real history exists (back to ~Jan 2026 tracking start/backfill). Use this; do NOT estimate from `agent_runs` timestamps.
- Page age: prefer `execution_pages.published_at` (populated by the Session 7+ publish flow going forward); `created_at` is brief-creation time, not publish time — acceptable fallback for legacy pages only.

**Implementation approach:**
- Add a function in `scripts/` (alongside `track-rankings.ts`) or as a new analysis pass within the existing ranking tracking cron
- For each page with ranking data in the 8–25 band:
  - Look up its cluster's current keyword count
  - Look up cluster size at page publish time from `cluster_performance_snapshots` (nearest `snapshot_date` to the page's `published_at`/`created_at`; if the page predates tracking history, use the earliest snapshot and note the growth factor is a lower bound)
  - Compute growth factor
  - If growth factor > 2.0 AND KD < 30 AND age > 6 months → flag as re-evaluation candidate
- Output: store candidates in a new lightweight table or JSONB field on an existing table. Include: page URL, current position, target keyword, KD, cluster growth factor, estimated lift (position-curve based, e.g. pos 15 → pos 5 ≈ 5–8x traffic)
- Surface in monthly performance report and/or dashboard

**Verification:** Run against IMA and SMA data. Check whether flagged candidates are intuitively correct — are they pages in clusters that have genuinely grown? Are the position/KD thresholds producing a useful signal-to-noise ratio?

### A2: GSC Zero-Click Fan-Out Detection (LLM Citation Signature)

**What:** Mine GSC query-level data for a specific pattern that indicates LLM fan-out citations: queries where the client ranks in the top 10 with significant impressions but zero clicks. These are queries where LLMs retrieved the page for answer synthesis but users never clicked through from the SERP.

**The pattern:**
- Position ≤ 10
- Clicks = 0
- Impressions ≥ 50 (over the query window — adjustable threshold)
- Query length > 5 words (fan-out queries tend to be long, comparative, or evaluative)
- Optional: query contains evaluative language ("evaluate", "compare", "best", "vs", "which is better")

**Why this matters:** DataForSEO's LLM Mentions API is the current AI visibility signal. This GSC-derived signal is complementary — it measures actual fan-out retrieval from the client's own search console data rather than depending on a third-party API's coverage. Together they triangulate AI visibility more accurately.

**Data source (verified 2026-06-12):** `fetch-gsc-data.ts` ALREADY fetches query×page data on every run (`dimensions: ['query', 'page']`, rowLimit 1000) — it's used transiently for top-query assignment and then discarded; only page-level aggregates persist to `gsc_page_snapshots`. No new auth/plumbing is needed, but:

**CRITICAL gotcha — do NOT reuse the existing 1000 rows.** The GSC API returns rows sorted by clicks DESCENDING and the sort is not configurable. Zero-click queries sort to the BOTTOM, so a top-1000-by-clicks window can systematically exclude exactly the zero-click/high-impression rows this analysis hunts. Add a dedicated analysis pull with a much higher rowLimit (e.g. 25000, or paginate via startRow) and filter `clicks = 0 AND impressions >= threshold` client-side.

Persist only the flagged queries (option (b) from the original design), not the full query-level dataset.

**Output:**
- Store flagged queries as "probable LLM citation queries" — a new table or JSONB on existing snapshots
- Include: query text, page URL, position, impressions, cluster association (if mappable)
- Surface in the AI Visibility section of the dashboard alongside DataForSEO LLM mention data

**Verification:** Manually check a sample of flagged queries. Do they look like LLM fan-out queries? Cross-reference against known DataForSEO LLM mention data — is there overlap?

### A3: Proven Ceiling Methodology (GSC-Derived KD Ceiling)

**What:** Compute the client's empirical ranking ceiling from actual GSC performance — the highest keyword difficulty at which they demonstrably rank in the top 7 — rather than relying on DR/DA as a proxy for rankability.

**The methodology (from the repo's `/seo-analyze` command):**
1. Take all keywords where the client currently ranks position ≤ 7 (from `ranking_snapshots` or `audit_keywords.rank_pos`)
2. Look up their keyword difficulty — see the KD prerequisite below; there is no local KD column today
3. `site_ceiling = max(KD) where count(position ≤ 7 at that KD level) ≥ 2`
   - The ≥ 2 threshold guards against flukes — a single top-7 ranking at KD 45 could be an outlier
4. Compute per-cluster ceilings where sufficient data exists: `cluster_ceiling = max(KD) where count(position ≤ 7 in that cluster) ≥ 2`
   - Cluster ceilings can exceed the site ceiling — comparison/alternative clusters often punch above site average

**KD prerequisite (verified 2026-06-12 — blocks A3 and A1; this is the first implementation step of the whole plan):** `audit_keywords` has NO difficulty column. `keyword_difficulty` appears in the codebase exactly once, as a null stub in `buildSyntheticRankedKeywords()` (`scripts/pipeline-generate.ts:894`). KD arrives in the raw DataForSEO `ranked_keywords` response (`keyword_data.keyword_properties.keyword_difficulty`) but is never persisted. Implement both:
- (a) Add `audit_keywords.keyword_difficulty` via migration (verify live schema first per CLAUDE.md SQL protocol) and persist it in the sync path going forward
- (b) Backfill existing audits by parsing KD out of the raw DataForSEO research JSON artifacts on disk (`research/{date}/` per audit), where artifacts exist

**Why this matters:** Jim's research and Gap's opportunity assessment currently use raw KD from DataForSEO. A DR-20 site that has 3 top-7 rankings at KD 35 in its core cluster has empirically proven it can rank at KD 35 in that topic — but a DR-based filter would reject KD 35 opportunities. The proven ceiling replaces the DR proxy with measured performance.

**Integration points:**
1. Compute during `sync-jim` (Phase 3b) when ranked keyword data + KD are both available. Store `proven_ceiling` and per-cluster ceilings in `research_data.json` and/or `audit_snapshots`
2. Inject the ceiling into the Strategy Brief (Phase 1b) prompt as a quantified authority assessment: "This site has a proven ranking ceiling of KD {N}, with cluster-specific ceilings: {cluster}: KD {M}, ..."
3. Make available to Michael and Cluster Strategy as a constraint: "Recommended pages targeting keywords above the proven ceiling for their cluster should be flagged as stretch targets requiring additional authority building"

**Verification:** Compute for IMA and SMA. Does the proven ceiling match intuition? Are the cluster-specific ceilings meaningfully different from the site ceiling? Does the ceiling explain any existing Gap recommendations that seem over-ambitious or under-ambitious?

---

## Workstream B: Scoring & Opportunity Assessment (Gap agent + Jim enhancements)

These items affect how difficulty and opportunity are assessed. They complement the already-planned Gap prompt revision session.

### B1: SERP Composition Adjustment to Effective Difficulty

**What:** Adjust keyword difficulty assessment based on who actually holds the top-10 positions, not just the raw KD number. A KD-35 keyword where 4 of the top 10 are Reddit threads and thin listicles is materially easier than a KD-35 keyword where all 10 are authoritative niche sites.

**The heuristic:**
- For high-priority gap/opportunity keywords, classify each top-10 result as:
  - **Authority site** (niche authority, major brand, established publication)
  - **Weak slot** (Reddit, forums, UGC, thin listicles, aggregators like Yelp/Angi, generic directories)
  - **Direct competitor** (competing local/regional business in the same vertical)
- Apply effective difficulty modifier:
  - 4+ weak slots in top-10 → effective KD = KD × 0.7 (one tier easier)
  - 2–3 weak slots → no adjustment
  - 0–1 weak slots (wall-to-wall authorities) → effective KD = KD × 1.3 (one tier harder)

**Data source (verified 2026-06-12 — the answer is NO existing SERP data):** Phase 4b is Section Extraction (`scripts/fetch-competitor-sections.ts`, competitor heading coverage) — there is no `competitor-analysis.ts`. The ONLY DataForSEO SERP endpoint call in the repo is in `scripts/dataforseo-business.ts` (`/serp/google/organic/live/regular`, citation verification). No per-keyword SERP composition data exists anywhere at Gap execution time.

The targeted-lookup path is therefore the design, not a fallback: add DataForSEO SERP organic lookups for the top 10–15 gap keywords by estimated revenue opportunity. Budget this — SERP lookups are more expensive than bulk keyword calls. The `live/regular` endpoint suffices for composition classification (domains are enough); use `live/advanced` only if implementing C3's video-carousel detection in the same pass — share the calls (see C3).

**Integration into Gap prompt:** Add a `## SERP Composition` section to Gap's prompt context that includes the effective difficulty adjustment for each assessed keyword. Gap can then use effective KD rather than raw KD when evaluating opportunity realism.

**Note on Gap's known issues:** This complements the planned Gap revision session. The existing known issues (mixed-format `revenue_opportunity`, redundant arrays, `format_gaps` lacking content inventory, `competitor_type` filter) should be addressed in the same session. SERP composition is an additive enhancement, not a prerequisite.

**Verification:** For 5 high-value gap keywords across IMA and SMA, manually check the top-10 SERP. Does the composition classification match reality? Does the effective KD adjustment produce more intuitively correct difficulty assessments?

### B2: BoF Content-Length Heuristic for Pam

**What:** The knowledge base documents a specific content-length framework for bottom-of-funnel pages:
- Pure "Why [brand]" pages: 400–500 words
- Comparison/versus pages with tables: 500–800 words
- Automated default: 0.8 × competitor median, floored at 400, capped at 800
- The 800-word ceiling is deliberately the MoF floor — clean funnel transition with no gap

ForgeOS currently lets Pam determine content length per page based on the brief's research. There's no explicit BoF length ceiling or floor. This matters because Oscar tends toward longer content when given latitude, and BoF pages that run to 1,500+ words dilute their conversion focus.

**Integration point:** Add a conditional length recommendation to Pam's prompt. When the page's `coverage_role` is `commercial` or `comparison` and its `buyer_stage` is Decision:
- Recommend target length: 400–800 words
- Include in the brief's metadata: `target_word_count: 600` (or computed from competitor median if Phase 4b data is available)
- Oscar receives this as a directive, not just a suggestion

This is a conditional directive — informational pages, hub pages, and consideration-stage content are exempt.

**Verification:** Check existing Oscar outputs for IMA/SMA BoF pages. Are any of them significantly over 800 words? Would the ceiling have improved their conversion focus?

---

## Workstream C: Production Layer Enhancements (Pam + Oscar prompt refinements)

Lower priority than A and B, but high-value refinements to the content production layer.

### C1: Multi-Variant Title Tags (150–250 Characters)

**What:** The knowledge base advocates for title tags significantly longer than the conventional 60-character limit — 150–250 characters with 2–3 intent variants separated by hyphens. Google selects the segment that best matches the search query, effectively giving one page multiple title-match opportunities across different query variants.

**Example:**
- Short: "EMT Training in Boise - Idaho Medical Academy"
- Long: "EMT Training in Boise - NREMT Certification Course for Aspiring Paramedics - Idaho Medical Academy Emergency Medical Technician Program"

**Mechanism:** The `titlematchScore` field from the Content Warehouse leak confirms Google evaluates title-query match. Longer titles with variant coverage increase the match surface for query fan-out and long-tail queries.

**Integration point:** This is a Pam directive, not Oscar. Pam generates the title recommendation in the brief. Add a conditional instruction to Pam's prompt:

When the page targets a topic with multiple intent variants (comparison, how-to, pricing, certification, geographic all present in the cluster), generate an extended title tag (150–200 characters) that includes 2–3 intent-variant segments separated by hyphens. Each segment should target a distinct query pattern the page could rank for. The first segment is the primary keyword match; subsequent segments cover secondary query patterns from the keyword data.

**Constraints:**
- Only apply when the page genuinely serves multiple intent variants (not every page)
- Each segment must be a natural phrase, not keyword-stuffed
- The first segment must be the strongest title-query match for the primary keyword
- Cap at 200 characters (the knowledge base says 250 but that's aggressive for a first deployment)

**Verification:** Generate extended titles for 3 existing IMA/SMA pages. Do they read naturally? Do the variant segments map to real queries in the keyword data?

### C2: Position-Band Internal Link Targeting

**What:** When Oscar places internal links (from Pam's linking map), apply position-aware routing:
- **Prefer linking TO pages in the position 4–20 range** — these are the "almost there" pages that benefit most from authority transfer
- **Avoid linking TO pages at position 1–3** — they don't need authority help; linking to them wastes the authority budget
- **Avoid linking TO pages at position 95+ or unranked** — they aren't ready for authority transfer; the authority evaporates
- **Max 20–30 internal links per page** — beyond that, authority dilution per link makes individual links negligible

**This requires two things:**
1. **Pam must surface ranking position context for link targets.** When Pam builds the internal linking map in the brief, include the current ranking position of each target page. **Position source (verified):** `ranking_snapshots` is keyword-level with no page URL — it cannot provide per-page positions. Use the latest `gsc_page_snapshots` row per target (match on pathname — `page_url` stores paths, not full URLs) or join `audit_keywords.rank_pos` + `ranking_url`. Pam already has access to cluster and page context.
2. **Oscar must respect position-band routing.** Add a directive to `seo-playbook.md` §6:
   - When the brief includes ranking positions for link targets, prioritize links to pages in the position 4–20 range
   - If a link target is at position 1–3, include only if the link serves user navigation (not for authority transfer)
   - If a link target has no ranking data or is at position 50+, include only if it's a new page that needs discovery
   - Keep total internal links per page ≤ 25

**Verification:** Check Pam's current linking maps for IMA/SMA briefs. Are there link targets at position 1–3 that don't need authority help? Are there position 8–15 pages that aren't getting linked to? Does the position-band filter change the linking recommendations in useful ways?

### C3: Video SERP Detection Signal (Gap in Playbook — Already Identified)

**What:** Video was already identified as a gap in the seo-playbook during the Google AI Optimization Guide analysis. The knowledge base provides the specific methodology:
1. During SERP analysis (Phase 4b or Gap), check whether Google shows a video carousel for the target keyword
2. If video carousel present: flag the keyword/page as a video opportunity
3. Recommend VideoObject schema on pages where video is embedded
4. Note in the brief: "This keyword has a video carousel — embedded video content significantly increases SERP real estate"

**Integration points:**
- **(Verified 2026-06-12)** No SERP responses are fetched for keywords today (see B1) — this data is NOT already available. SERP feature detection (video carousel, PAA, featured snippet) requires the `live/advanced` organic endpoint, which costs more than `regular`. Implement by piggybacking on B1's targeted SERP lookups: if B1 uses `live/advanced`, video-carousel detection is free marginal data on the same 10–15 calls. Do NOT add standalone SERP calls just for this — C3 ships with B1 or not at all.
- Pam includes the flag in the brief when present
- Oscar adds VideoObject schema stub when the brief indicates video opportunity

**Verification:** Check DataForSEO SERP responses for IMA/SMA keywords. Which keywords have video carousels? Are they the "how-to" and "what is" queries you'd expect?

---

## Workstream D: Architecture Patterns for Future Clients (lower priority, design only)

These items don't apply to the current IMA/SMA client roster but should be designed now for future client onboarding. Implementation can be deferred.

### D1: Thin Starter Page Mode for Low-Authority Clients

**What:** A pipeline mode where Michael recommends thin starter pages (200–400 words) for untested keywords instead of full content pages. The workflow:
1. Michael marks certain pages as `page_mode: 'starter'` (low-authority client + untested keyword + KD uncertain)
2. Pam generates abbreviated briefs for starter pages (target 200–400 words, direct answer, one internal link)
3. Oscar produces minimal pages
4. After 2–4 weeks, GSC data reveals which pages got impressions
5. Pages with traction get expanded; pages without get deprioritized

**Design considerations:**
- This is a `coverage_role` extension or a new field on `execution_pages` (`page_mode: 'full' | 'starter'`)
- The expansion trigger could be automated: monthly cron checks GSC for starter pages, flags those with impressions > threshold for expansion
- Michael needs a low-authority detection signal — the proven ceiling (A3) provides this: if `site_ceiling < 15` and the keyword's KD is uncertain, recommend starter mode

**Don't build this yet.** Design the schema addition and the Michael/Pam conditional logic. Implement when a new client with near-zero authority comes in.

### D2: Individual FAQ Page Architecture (PAA Expansion)

**What:** For low-authority clients, individual dedicated pages per PAA question (rather than FAQ accordion) maximize title-query match with minimal authority. Each page: exact PAA question as H1 and title, 120-word direct answer, internal link to parent article.

**This is a Michael architecture pattern**, not a content production pattern. Michael would recommend individual `/faq/{question-slug}/` pages linked to a parent pillar page, rather than embedding FAQs as accordion sections on the pillar.

**Design considerations:**
- Add to Michael's prompt as a conditional pattern: when the client's proven ceiling is low AND the cluster has PAA opportunities, recommend individual FAQ pages rather than on-page FAQ sections
- This interacts with D1 (thin starter pages) — individual FAQ pages ARE thin starter pages with a specific structure

**Don't build this yet.** Design alongside D1.

---

## Implementation Sequence

**Phase 0 — KD persistence (prerequisite):** Add and backfill `audit_keywords.keyword_difficulty` per the A3 prerequisite block. Nothing in A1/A3/B1 works without it.

**Phase 1 — Analytics layer (Workstream A):** A3 (proven ceiling) first — it's a prerequisite for A1 (re-evaluation candidates use the ceiling for KD filtering) and feeds into B1 (SERP composition uses the ceiling as a baseline). Then A1 and A2 in parallel. Verify all three against IMA and SMA data before proceeding.

**Phase 2 — Scoring layer (Workstream B):** B1 (SERP composition) fits into the planned Gap revision session. B2 (BoF length heuristic) is a standalone Pam change.

**Phase 3 — Production layer (Workstream C):** C2 (position-band linking) requires the most plumbing (Pam needs ranking data in the brief). C1 (multi-variant titles) is a light prompt change. C3 (video SERP) is coupled to B1's SERP calls — implement them together in Phase 2 or drop C3.

**Phase 4 — Design only (Workstream D):** D1 and D2 are schema + prompt design exercises. No implementation until a new client triggers the need.

---

## Verification Protocol

For every implementation:
1. **Pre-change state capture:** Document current output for the affected pipeline stage on IMA and/or SMA
2. **Isolated test:** Run the affected stage in isolation (not full pipeline) on one client
3. **Output comparison:** Compare pre/post output — does the change produce the expected improvement?
4. **No regression check:** Verify existing functionality isn't degraded
5. **Document in DECISIONS.md:** Record the change rationale, verification results, and any threshold values that may need tuning

---

## Documentation Updates Required

After implementation, update:
- `PIPELINE.md` — any new phases, modified phase contracts, new data flows
- `DATA_CONTRACT.md` — any new tables, columns, or JSONB structures
- `DECISIONS.md` — rationale for each implementation decision
- `FOLLOWUPS.md` — any items deferred or identified during implementation
- `FORGE_OS_REFERENCE.md` — NOTE (verified): this exists only as untracked copies (`forge-os-pipeline/tmp/FORGE_OS_REFERENCE.md`); skip unless it gets promoted to a tracked doc
- The source knowledge base repo is at `/home/forgegrowth/claude-code-seo/` for reference lineage. Copy the extraction map to `docs/research/kb-extraction-map.md` in the pipeline repo for permanent documentation.
