# Forge OS Implementation Plan — Entity-Authority Transition + AI Visibility Integration

**Date:** 2026-05-29
**Source:** SYSTEM_REVIEW.md + architectural review feedback + AI visibility framework scoping
**Approach:** Six sessions, dependency-ordered. Each session is a self-contained unit with pre-reads, deliverables, and verification. Sessions are designed for the Matt → Claude (chat) review → Claude Code execution workflow.

**Design principle:** The entity-authority reframe and AI visibility measurement are the same strategic shift expressed at different layers. The reframe changes how agents reason about content strategy. AI visibility measurement changes how we evaluate whether that strategy is working. Building them together means each agent change accounts for the measurement surface from the start, rather than retrofitting measurement after the reasoning layer has already been rebuilt.

---

## Session 1: Foundation Cleanup

**Goal:** Reduce complexity, remove dead weight, improve structural maintainability. Zero behavioral change to pipeline outputs.

**Estimated effort:** 3-4 hours

### 1a. Extract agent prompts from pipeline-generate.ts

Create `configs/agents/` directory. Extract the prompt template strings for Dwight, Jim, Michael, Gap, Validator, KeywordResearch (extract + synth), Scout (topic + report), Competitors, and QA into individual `.md` files. Update `pipeline-generate.ts` to `fs.readFileSync()` these files and inject context variables via string replacement.

**Why first:** This is the #3 fragility risk. Every subsequent session that modifies agent prompts benefits from prompts living in dedicated files rather than buried in a 307KB orchestrator. Do this before any prompt changes.

**Verification:** Run a full pipeline on forgegrowth.ai (smallest keyword set). Diff the output artifacts against the previous run. Outputs must be identical — this is a refactor, not a change.

### 1b. Remove Validator (Phase 6.5)

Remove the `runValidator()` call from the pipeline orchestrator. The Validator's output (`coverage_validation.md`, `audit_coverage_validation` table) has no downstream consumer — no agent reads it, no dashboard page displays it. Coverage cross-checking is already implicit in Michael's cannibalization self-check and buyer journey coverage assessment.

Leave the `audit_coverage_validation` table in place (no destructive migration). Remove the code path only.

### 1c. Remove legacy canonicalize mode

Remove `build-legacy-payload.ts`. Remove mode-switching logic in `pipeline-generate.ts` and `run-canonicalize.ts`. Make hybrid the only code path. Fix the `/recanonicalize` endpoint wiring gap — remove the `--canonicalize-mode` parameter entirely since there's only one mode. Shadow mode can remain as a debug tool (it's useful for validation) but should be documented as debug-only.

### 1d. Remove FAQ rich result framing

Update `configs/oscar/seo-playbook.md` Section 2 — remove FAQ schema as a SERP opportunity. Retain FAQ as a content structure pattern for user experience and AI citation signal, but note that FAQPage schema no longer produces Google rich results.

Update Pam's prompt (now in `configs/agents/pam.md` after 1a) — same adjustment in the SCHEMA section. FAQ entities in JSON-LD should be framed as AI-citation-facilitating structure, not SERP feature targeting.

### 1e. Column cleanup

Replace all `audit_keywords.intent` references with `intent_type` across both repos. Grep for `.intent` in pipeline scripts and dashboard hooks. Update `generate-brief.ts` keyword table column.

Rename `ranking_snapshots.cluster` to `ranking_snapshots.canonical_topic` via migration + update `track-rankings.ts` writer.

### 1f. Add README to .claude/agents/

Clarify that these are Claude Code interactive agent definitions, not production pipeline prompts. Production prompts are in `configs/agents/` (after 1a) and `configs/oscar/`.

### Pre-reads for Claude Code:
```
CLAUDE.md
docs/PIPELINE.md
scripts/pipeline-generate.ts (full read — understand orchestration before extraction)
scripts/generate-brief.ts (intent column references)
configs/oscar/seo-playbook.md
src/agents/canonicalize/ (legacy vs hybrid paths)
```

---

## Session 2: Jim Structural Improvement + AI Visibility Query Foundation

**Goal:** Fix the #1 fragility point (Jim's regex parser) and lay the data foundation for AI visibility measurement by generating cluster-level query sets.

**Estimated effort:** 4-6 hours

**Depends on:** Session 1 (prompts extracted to files)

### 2a. Jim dual output — structured JSON alongside markdown narrative

Modify Jim's prompt (now in `configs/agents/jim.md`) to produce both `research_summary.md` (human-readable, unchanged format) and `research_data.json` (machine-parseable structured data).

The JSON should contain:
```typescript
{
  keyword_overview: { total_keywords, avg_position, branded_pct, ... },
  position_distribution: { "1-3": n, "4-10": n, "11-20": n, ... },
  intent_breakdown: { commercial: n, transactional: n, informational: n, navigational: n },
  top_ranking_urls: [{ url, keywords, avg_position, total_volume }],
  competitor_summary: [{ domain, shared_keywords, avg_position, etv }],
  striking_distance: [{ keyword, position, volume, url }],
  content_gap_observations: [{ observation, evidence }],
  key_takeaways: [{ category, takeaway }],
  ai_visibility: { // when data exists
    client_mentions: [{ keyword, platform, mention_count, cited: boolean }],
    competitor_totals: [{ domain, platform, total_mentions }],
    top_citation_domains: string[]
  }
}
```

Update `sync-to-dashboard.ts` to parse `research_data.json` when available, falling back to regex parsing of `research_summary.md` if the JSON is absent. This provides a safe migration path — existing pipeline runs with markdown-only output continue to work.

**Verification:** Run pipeline on IMA. Verify that `research_data.json` is written alongside `research_summary.md`. Verify that dashboard Research page displays identical data whether parsed from JSON or markdown. Diff the Supabase writes.

### 2b. AI visibility query set generation at cluster activation

When Cluster Strategy (Opus) runs during cluster activation, extend Section 5 output to include a `visibility_queries` array:

```typescript
{
  ai_optimization_targets: [...], // existing
  visibility_queries: [
    {
      query: "best EMT training programs in Idaho",
      query_type: "discovery" | "consideration" | "comparison" | "brand",
      target_cluster: "emt_training",
      platforms: ["google", "chat_gpt", "perplexity"]
    }
  ]
}
```

These are the queries that will be used to measure AI share of voice for this cluster over time. Opus generates them from the cluster's entity map, keyword data, and buyer journey — it has the context to produce queries that represent how actual users ask AI platforms about this topic.

Store `visibility_queries` in the `cluster_strategy` table (new JSONB column, migration required).

**Why here:** This is the natural integration point. Cluster activation is when strategic decisions about a topic are made. The queries generated here become the measurement instrument for whether those decisions produced results. Bolting query generation onto a separate tracking script would disconnect measurement from strategy.

**Verification:** Activate a cluster on IMA. Verify that `visibility_queries` are generated and stored. Review the queries for quality — they should be natural-language questions a student would ask an AI assistant, not keyword-shaped queries.

### Pre-reads for Claude Code:
```
configs/agents/jim.md (after Session 1 extraction)
scripts/sync-to-dashboard.ts (parseResearchSummary function — understand what it extracts)
scripts/generate-cluster-strategy.ts (Section 5 output format, extractJsonBySection parsing)
docs/DATA_CONTRACT.md (cluster_strategy table schema)
```

---

## Session 3: Entity-Authority Reframe

**Goal:** Shift the pipeline's conceptual spine from keyword research → keyword clustering → keyword-to-page mapping toward entity authority → topic coverage → AI surface visibility. This is the core strategic change.

**Estimated effort:** 5-7 hours

**Depends on:** Session 2 (Jim JSON output enables prompt changes without parser risk)

### 3a. Strategy Brief: Keyword Research Directive → Entity Authority Directive

Rewrite Section 2 of the Strategy Brief prompt (`configs/agents/strategy-brief.md`).

Current Section 2 ("Keyword Research Directive") tells Jim which keyword categories to prioritize, what not to optimize around, and whether the ranking footprint is a valid signal.

New Section 2 ("Entity Authority Directive") tells downstream agents:
- What topical domains this business should be the authoritative source for
- What entities (services, credentials, locations, outcomes) the site should be known for
- Where information gain opportunities exist vs competitors (proprietary knowledge, first-hand experience, outcome data)
- What the AI visibility posture should be — is this a business where AI platform citation is a primary channel (national vocational training) or supplementary (local plumber)?

Keywords remain as measurement evidence referenced within this directive — "keyword data shows commercial demand of X for this entity" — but the directive is framed around authority and coverage, not keyword volume and intent buckets.

**Downstream impact:** Jim receives this directive and frames his research around it. The Strategy Brief has no downstream parser, so this is a prompt-only change with no parsing risk. But Jim's consumption of the directive must be tested — verify that Jim's output reflects the entity-authority framing rather than defaulting to keyword-centric analysis.

### 3b. Gap agent structural fixes + entity-authority alignment

Fix the three documented structural issues:
1. **Mixed-format `revenue_opportunity` field** — standardize to numeric (estimated monthly revenue from closing the gap)
2. **Redundant `unaddressed_gaps`/`authority_gaps` arrays** — consolidate. When Michael hasn't run, all gaps are "unaddressed" by definition. When Michael has run, gaps are classified by whether the blueprint addresses them.
3. **`format_gaps` lacking client content inventory context** — inject the client's existing content formats (from Dwight's crawl data) so the Gap agent can identify format gaps relative to what exists, not just what competitors do.

Additionally, align Gap's output with the entity-authority reframe:
- `target_keyword` in `priority_recommendations` becomes `target_topic` with representative keywords as evidence
- `authority_gaps` reason about topic/entity coverage gaps, not just keyword position gaps
- Add `information_gain_gaps`: identify where competitors have proprietary content (case studies, original data, calculators, outcome statistics) that the client lacks

### 3c. Oscar content freshness and information gain signals

Update Oscar's SEO playbook (`configs/oscar/seo-playbook.md`):
- Add content dating guidance: `datePublished`/`dateModified` in JSON-LD schema, visible "Last updated" for time-sensitive content. Pam's `[TIME-SENSITIVE]` classification should trigger this.
- Add information gain self-assessment: Oscar flags in production notes whether the content contains original insights, proprietary data, or first-hand experience. If the content is purely commodity information, flag it — this surfaces the gap between what the pipeline can produce and what the client needs to contribute.

### Pre-reads for Claude Code:
```
configs/agents/strategy-brief.md (after Session 1 extraction)
configs/agents/gap.md (after Session 1 extraction)
configs/agents/jim.md (to understand how Jim consumes the Strategy Brief)
configs/oscar/seo-playbook.md
scripts/pipeline-generate.ts (Gap agent input assembly — what data it actually receives)
docs/FOLLOWUPS.md (Gap agent structural issues documentation)
```

---

## Session 4: AI Visibility Measurement Layer

**Goal:** Evolve AI visibility from a one-time deliverable into a recurring measurement system with share-of-voice computation, content production feedback loops, and dashboard integration.

**Estimated effort:** 6-8 hours

**Depends on:** Session 2 (visibility_queries stored per cluster), Session 3 (entity-authority framing in place)

### 4a. Evolve track-llm-mentions into cluster-aware AI visibility tracking

Replace the current approach (top 5 keywords by volume) with a cluster-derived query set:

1. For each activated cluster with a `cluster_strategy` containing `visibility_queries`, use those queries instead of top-5-by-volume keywords.
2. For clusters without visibility_queries (pre-Session-2 activations), fall back to the current top-5 approach.
3. Fetch mention data for the client domain AND the top 3 competitors per cluster (from `audit_topic_competitors`).
4. Compute share of voice per cluster per platform: `client_mentions / total_mentions_across_all_tracked_domains`.

Store results in an extended `llm_visibility_snapshots` schema or a new `ai_share_of_voice` table:
```
audit_id, cluster_canonical_key, snapshot_date, platform, 
client_mention_rate, competitor_mentions (JSONB), 
total_queries_checked, queries_where_client_cited, 
top_citation_domains
```

**Cadence:** Keep monthly as default. Add an on-demand trigger for post-content-publication measurement (see 4b).

### 4b. Content production → AI visibility feedback loop

When Oscar publishes content for a page within an activated cluster:
1. Record the publication event: cluster, page slug, publication date
2. Schedule an AI visibility re-check for that cluster's visibility_queries 3-4 weeks post-publication (indexing lag)
3. Compare the post-publication snapshot to the pre-publication baseline
4. Store the delta: did AI share of voice for this cluster improve, decline, or hold?

This can be implemented as a lightweight scheduler (Railway cron or a queue) or as an operator-triggered action from the dashboard ("Check AI impact for this cluster").

Start with operator-triggered. Automation can come later once the measurement proves useful.

### 4c. DataForSEO API scope verification

Before building the tracking infrastructure, verify:
1. Does the LLM Mentions API support Perplexity as a platform? If yes, add it. If no, note the gap and proceed with Google + ChatGPT.
2. What is the per-query cost for the expanded query set? For IMA with ~10 activated clusters × 5-8 queries each = 50-80 queries. At DataForSEO's pricing, estimate monthly cost.
3. Does the AI Keyword Data API provide AI search volume per query? If yes, weight the share-of-voice metric by AI search volume (visibility on high-volume AI queries matters more than low-volume ones).

### 4d. Dashboard integration — AI Share of Voice

Add AI share of voice to the Clusters page:
- Per-cluster metric: "AI Visibility: X% share of voice across Y queries" alongside the existing topical authority score
- Color-coded threshold: green (>20% SOV), amber (5-20%), red (<5%), gray (not measured)
- Trend indicator when multiple snapshots exist: improving / declining / stable

Add a dedicated view (tab or expandable section) showing:
- Per-query breakdown: which queries cite the client, which don't, who is cited instead
- Platform comparison: Google AI vs ChatGPT citation rates for the same queries
- Competitor comparison: client SOV vs top 3 competitors per cluster

### Pre-reads for Claude Code:
```
scripts/track-llm-mentions.ts (current implementation)
scripts/ai-visibility-analysis.ts (query generation and synthesis logic)
scripts/generate-cluster-strategy.ts (visibility_queries from Session 2)
docs/DATA_CONTRACT.md (llm_visibility_snapshots, llm_mention_details schemas)
lovable-repo/src/pages/audit-detail/AiVisibilityPage.tsx
lovable-repo/src/pages/audit-detail/ClustersPage.tsx (where SOV metric will be added)
```

---

## Session 5: Architecture Agent Evolution

**Goal:** Evolve Michael and Pam to reason from entity coverage rather than keyword assignment. These are the agents where the entity-authority reframe has the most direct output impact.

**Estimated effort:** 4-6 hours

**Depends on:** Session 3 (Strategy Brief and Gap reframe landed)

### 5a. Michael: entity coverage architecture

Update Michael's prompt (`configs/agents/michael.md`):

- Reframe the silo construction directive: "Build architecture that establishes topical authority for these service entities" rather than "Build pages that target these high-volume keywords"
- Add a `Coverage Role` concept to silo tables: each page's role in completing the topic's entity coverage (pillar, commercial, informational, geographic, comparison, FAQ, credential, outcome). `Primary Keyword` and `Volume` remain as data attributes but aren't the construction driver.
- Add entity relationship awareness: Michael should note relationships between silos (e.g., "EMT Training" → "NREMT Certification" → "EMT Career Outcomes" form an entity chain that internal linking should reinforce)
- Incorporate AI visibility context: when `visibility_queries` exist for activated clusters, Michael should note which pages serve which AI visibility queries

**Parser impact:** `syncMichael()` in `sync-to-dashboard.ts` parses silo tables. Adding a `Coverage Role` column requires parser update. Test with existing client data to verify backward compatibility.

### 5b. Pam: entity-first brief structure

Update Pam's prompt (`configs/agents/pam.md`):

Reorder the input sections to lead with entity/topic context:
1. Entity context (from cluster strategy's entity_map) — what entity is this page about?
2. Topic authority context (silo position, sibling pages, coverage gaps) — where does it sit?
3. Buyer journey stage — what decision does it support?
4. AI visibility targets (from cluster strategy's ai_optimization_targets + visibility_queries) — what AI queries should this page be citable for?
5. Target keywords — optimize for these terms (demoted from position 1 to position 5)

Add information gain directive: Pam should evaluate `client_profiles` for proprietary knowledge areas relevant to this page's topic and explicitly direct Oscar to foreground that knowledge. If no proprietary knowledge is identified, flag it in the brief as "commodity content risk — client input needed."

### Pre-reads for Claude Code:
```
configs/agents/michael.md (after Session 1 extraction)
configs/agents/pam.md (after Session 1 extraction)
scripts/sync-to-dashboard.ts (syncMichael parser — silo table regex)
scripts/generate-brief.ts (context assembly order, entity_map injection)
scripts/generate-cluster-strategy.ts (entity_map schema, visibility_queries)
```

---

## Session 6: Dashboard Operational Improvements

**Goal:** Make the dashboard a decision-support tool rather than a data display layer.

**Estimated effort:** 4-6 hours

**Depends on:** Sessions 4 and 5 (AI SOV data and entity coverage data available)

### 6a. Next Actions panel on Overview page

Add a "Recommended Next Actions" component that reads pipeline state and generates ordered recommendations:

Logic (deterministic, no LLM call):
1. If `agent_runs` shows completed pipeline but no clusters activated → "Review clusters and activate highest-revenue topic"
2. If activated clusters exist with `execution_pages` in `not_started` → "Generate briefs for N pages in [cluster name]"
3. If `execution_pages` have `brief_ready` status → "Review and approve N briefs for content production"
4. If `execution_pages` have `draft_ready` status → "Review N drafts ready for publication"
5. If published pages exist with no recent AI visibility check → "Measure AI impact for [cluster name] (last checked N days ago)"
6. If `ranking_snapshots` older than 7 days → "Refresh ranking data"
7. If technical fixes in Dwight audit are unresolved → "Address N Priority-1 technical issues"

Display as an ordered list on the Overview page with direct links to the relevant dashboard pages.

### 6b. Entity relationship visualization on Clusters page

When a cluster has an activated `cluster_strategy` with an `entity_map`, render a simple entity relationship diagram:
- Center node: primary entity (e.g., "EMT Training" — Course)
- Connected nodes: related entities with `warrants_own_page` flag
- Edge labels: relationship type (e.g., "leads to," "requires," "competes with")
- Node color: green if a page exists for this entity, gray if not

This can be a simple force-directed graph (D3) or a structured tree view. Start simple — the value is in making the entity strategy visible, not in the visualization being sophisticated.

### 6c. Research page entity framing

The Research page is the most keyword-centric dashboard surface (67KB component). As Jim's output evolves to be topic-structured (Session 2), the Research page should reflect that:
- Lead with topic authority assessment rather than keyword position distribution
- Group keywords under their canonical topics in the keyword table
- Show AI visibility data per topic alongside organic ranking data

This is primarily a display reframe — the underlying data (audit_keywords, audit_clusters) already supports topic-level grouping. The change is in presentation priority.

### Pre-reads for Claude Code:
```
lovable-repo/src/pages/audit-detail/OverviewPage.tsx
lovable-repo/src/pages/audit-detail/ClustersPage.tsx
lovable-repo/src/pages/audit-detail/ResearchPage.tsx
lovable-repo/src/hooks/ (relevant hooks for agent_runs, execution_pages, audit_clusters)
```

---

## Cross-Session Dependencies

```
Session 1 ─── Session 2 ─── Session 3 ─── Session 5
   │              │              │
   │              └──── Session 4 ───── Session 6
   │                                        │
   └────────────────────────────────────────┘
```

Sessions 1 → 2 → 3 are strictly sequential (each builds on the prior).
Session 4 depends on Session 2 (visibility_queries) and Session 3 (entity framing).
Session 5 depends on Session 3 (Strategy Brief and Gap reframe).
Session 6 depends on Sessions 4 and 5 (data to display).

Sessions 4 and 5 can run in parallel if needed.

---

## Verification Protocol

After each session, before proceeding to the next:

1. **Pipeline run test.** Run the full pipeline on forgegrowth.ai (25 keywords, fastest execution). Verify no regressions in output artifacts.
2. **Dashboard smoke test.** Load each dashboard page for the test audit. Verify no blank sections, broken queries, or console errors.
3. **Diff check.** For Sessions 1 and 2, diff pipeline outputs against the previous run. Sessions 3-5 will produce intentionally different outputs — review those outputs for quality against the evaluation standard.
4. **Document.** Update DECISIONS.md with any non-obvious choices made during the session. Update PIPELINE.md if phase contracts changed. Update DATA_CONTRACT.md if table schemas changed.

---

## Client Impact Timeline

**After Session 1:** No client-visible change. Internal improvement only.

**After Session 2:** Jim produces richer structured data. Dashboard Research page can surface topic-level analysis. Cluster activation generates AI visibility query sets.

**After Session 3:** Strategy Brief, Gap analysis, and Oscar content frame the engagement around entity authority rather than keyword rankings. This changes the narrative in client deliverables.

**After Session 4:** AI share of voice is measurable per cluster. Content production impact on AI visibility is trackable. The dashboard shows whether the strategy is working on AI surfaces, not just organic rankings.

**After Session 5:** Architecture blueprints and content briefs are entity-first. Content produced for Justin/IMA/SMA reflects 2026 best practices in entity optimization and information gain.

**After Session 6:** The dashboard recommends next actions, visualizes entity relationships, and presents research through a topic authority lens. The operator experience shifts from "interpret data, decide what to do" to "review recommendations, approve and execute."

---

## What This Plan Does Not Cover (Deferred)

- **Revenue model CTR adjustment for AI Overviews.** Deferred until empirical GSC data shows measurable CTR degradation for client query types. Implementing a speculative discount without client-specific evidence would introduce a different kind of inaccuracy.
- **Perplexity tracking.** Deferred pending DataForSEO API verification. Included in Session 4c as a verification step — if supported, add it; if not, document the gap.
- **GBP services field granularity audit.** Important for local service clients but independent of the entity-authority reframe. Can be implemented as a standalone Dwight enhancement in a future session.
- **Operator-directed content production surface.** The second production surface for content outside audit-derived architecture (location pages, campaign content). Separate architectural session needed.
- **Jim output restructuring around topic clusters.** The system review recommended reframing Jim's 10-section narrative around topic clusters. This plan takes a lighter approach: Jim outputs structured JSON (Session 2) and receives entity-authority directives (Session 3), but the narrative format stays stable to avoid parser risk and dashboard disruption. The narrative evolves naturally as the upstream directive changes what Jim emphasizes. Full restructuring can happen in a future session if the lighter approach proves insufficient.
