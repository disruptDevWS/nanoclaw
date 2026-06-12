# Data Contract: Forge OS Pipeline ↔ Forge OS Dashboard

> **Purpose**: Authoritative map of every Supabase table, who writes it (pipeline), who reads it (dashboard), and which columns matter. Use this before adding columns, changing sync logic, or building new UI components.
>
> **Last updated**: 2026-06-10

---

## Table of Contents

1. [Core Tables](#core-tables)
2. [Agent Output Tables](#agent-output-tables)
3. [Performance Tables](#performance-tables)
4. [LLM Visibility Tables](#llm-visibility-tables)
5. [Ad-Hoc Research Tables](#ad-hoc-research-tables)
6. [Content Factory Tables](#content-factory-tables)
7. [Local Presence Tables](#local-presence-tables)
8. [Reference Tables](#reference-tables)
9. [Views](#views)
10. [Edge Functions](#edge-functions)
11. [RPC Functions](#rpc-functions)
12. [Disk Artifacts](#disk-artifacts)

---

## Core Tables

### `audits`

| Column | Writer | Reader | Notes |
|--------|--------|--------|-------|
| `id` | Dashboard (INSERT) | Both | PK, UUID |
| `user_id` | Dashboard | Dashboard | Auth context |
| `domain` | Dashboard | Both | |
| `business_name` | Dashboard | Dashboard | |
| `mode` | Dashboard | Pipeline | `full` / `sales` / `prospect` |
| `service_key` | Dashboard / Pipeline | Both | Pipeline auto-detects if 'other' |
| `market_city`, `market_state` | Dashboard | Pipeline | Geo targeting |
| `country_code`, `language_code` | Dashboard | Pipeline | |
| `geo_mode` | Dashboard | Pipeline | `city` / `metro` / `state` / `national` |
| `market_geos` | Dashboard | Pipeline | JSON array of {city, state} |
| `status` | Both | Dashboard | TEXT: `draft`, `running`, `completed`, `failed`, `awaiting_review` |
| `error_message` | Pipeline | Dashboard | |
| `client_context` | Dashboard | Pipeline | JSONB: `{core_services, differentiators, service_area, notes}`. `core_services` read by Phase 3c classification extraction (Haiku prompt enrichment) + `loadClientContextAsync()` (Phase 1b, 2, 6). |
| `canonicalize_mode` | Dashboard / Pipeline | Pipeline | TEXT: `legacy` (default), `hybrid`, `shadow_hybrid`. Controls Phase 3c clustering algorithm. Read by `handleTrigger` and `handleRecanonicalize` to pass `--canonicalize-mode` flag to downstream scripts. |
| `review_gate_enabled` | Dashboard | Pipeline | Boolean, default false |
| `performance_tracking_enabled` | Dashboard | Pipeline (cron) | Boolean, default false. Opt-in for monthly cron ranking tracking. |
| `research_snapshot_at` | Pipeline (syncJim) | Dashboard | Staleness timestamp |
| `audit_snapshot_at` | Pipeline (syncDwight) | Dashboard | Staleness timestamp |
| `strategy_snapshot_at` | Pipeline (syncMichael) | Dashboard | Staleness timestamp |
| `created_at`, `completed_at` | Auto / Pipeline | Dashboard | |

**Pipeline writes**: `status`, `error_message`, `service_key` (auto-detect), `*_snapshot_at` timestamps
**Dashboard writes**: All creation fields, `client_context`, `review_gate_enabled`, `performance_tracking_enabled`, `status` (draft→running)
**Dashboard reads**: Full row + relations (`audit_rollups`, `audit_assumptions`, `audit_clusters`, `audit_keywords`)

---

### `audit_keywords`

| Column | Writer | Reader | Notes |
|--------|--------|--------|-------|
| `id` | Auto | Dashboard | PK |
| `audit_id` | Pipeline | Both | FK |
| `keyword` | Pipeline | Dashboard | |
| `rank_pos` | Pipeline | Dashboard | 100 = synthetic (no ranking) |
| `search_volume` | Pipeline | Dashboard | Geo-qualified (sum across service-area states) when `geo_mode != 'national'`; national volume when `geo_mode = 'national'` or geo lookup suppressed |
| `cpc` | Pipeline | Dashboard | |
| `ranking_url` | Pipeline | Dashboard | |
| `intent` | **DEPRECATED** — no pipeline writers | Dashboard (legacy readers) | Use `intent_type` instead. Pipeline stopped writing this column 2026-05-29. Column drop pending dashboard reader audit. |
| `topic` | Pipeline | Dashboard | |
| `cluster` | Pipeline | Dashboard | = canonical_topic after Phase 3c (canonical_topic-exclusive post-Session-B) |
| `silo` | Pipeline (Phase 6b) | Dashboard | syncMichael silo backfill. NULL until syncMichael matches keyword to a silo. Added migration 019. |
| `canonical_key` | Pipeline (Phase 3c) | Dashboard | Geo-agnostic slug |
| `canonical_topic` | Pipeline (Phase 3c) | Dashboard | Display name |
| `is_near_miss` | Pipeline | Dashboard | |
| `is_top_10` | Pipeline | Dashboard | |
| `is_striking_distance` | Pipeline | Dashboard | |
| `is_brand` | Pipeline (Phase 3c) | Dashboard | |
| `is_near_me` | Pipeline (Phase 2) | Dashboard | |
| `intent_type` | Pipeline (Phase 3c) | Dashboard | |
| `primary_entity_type` | Pipeline (Phase 3c) | Dashboard | `Service`, `Course`, `Product`, `LocalBusiness`, `FAQPage`, `Article` — default `Service` |
| `classification_method` | Pipeline (Phase 3c hybrid) | — | `vector_auto_assign`, `sonnet_arbitration_assigned`, `sonnet_arbitration_new_topic`, `sonnet_arbitration_merged`, `prior_assignment_locked`. NULL for legacy. |
| `similarity_score` | Pipeline (Phase 3c hybrid) | — | Cosine similarity to assigned topic centroid. NULL for legacy or lock. |
| `arbitration_reason` | Pipeline (Phase 3c hybrid) | — | Sonnet's reasoning for arbitrated assignments. NULL for auto-assigned or legacy. |
| `canonicalize_mode` | Pipeline (Phase 3c) | — | `legacy`, `hybrid`, or `shadow_hybrid` |
| `shadow_canonical_key` | Pipeline (Phase 3c shadow) | — | Hybrid's clustering in shadow mode. NULL for non-shadow. |
| `shadow_canonical_topic` | Pipeline (Phase 3c shadow) | — | Hybrid's topic name in shadow mode. NULL for non-shadow. |
| `shadow_classification_method` | Pipeline (Phase 3c shadow) | — | Hybrid's method in shadow mode. |
| `shadow_similarity_score` | Pipeline (Phase 3c shadow) | — | Hybrid's similarity in shadow mode. |
| `shadow_arbitration_reason` | Pipeline (Phase 3c shadow) | — | Hybrid's reasoning in shadow mode. |
| `source` | Pipeline | Dashboard | `ranked` or `keyword_research` |
| `keyword_difficulty` | Pipeline (Phase 3b syncJim) | Analysis scripts (proven ceiling A3, re-eval candidates A1) | DataForSEO KD 0–100 from `keyword_properties.keyword_difficulty`. NULL for synthetic keywords, keyword_research seeds, and audits without raw artifacts. Migration 036; backfilled 2026-06-12 via `scripts/backfill-keyword-difficulty.ts`. |
| `current_ctr` | Pipeline | Dashboard | |
| `current_traffic` | Pipeline | Dashboard | |
| `target_ctr` | Pipeline | Dashboard | |
| `target_traffic` | Pipeline | Dashboard | |
| `delta_traffic` | Pipeline | Dashboard | |
| `delta_leads_low/high` | Pipeline | Dashboard | |
| `delta_revenue_low/mid/high` | Pipeline | Dashboard | |

**Pipeline writes**: Phase 2 (source=keyword_research), Phase 3/3b (source=ranked, incl. keyword_difficulty), Phase 3c (canonical_key, canonical_topic, classification metadata in hybrid/shadow modes), Phase 3c classification extraction (is_brand, intent_type, primary_entity_type, intent, canonicalize_mode — via Haiku+rules in hybrid mode, via legacy Sonnet in legacy mode), Phase 6b syncMichael (silo)
**Dashboard reads**: `useAllKeywords()`, `useAssumptionsPreview()`, `useAudit()` relation
**Dashboard writes**: `useDeleteKeywords()` (DELETE by id)

---

### `audit_clusters`

| Column | Writer | Reader | Notes |
|--------|--------|--------|-------|
| `id` | Auto | Dashboard | PK |
| `audit_id` | Pipeline | Both | FK |
| `canonical_key` | Pipeline | Dashboard | Contractual join to `execution_pages` |
| `canonical_topic` | Pipeline | Dashboard | Display name |
| `topic` | Pipeline | Dashboard | Legacy (= canonical_topic) |
| `near_miss_positions` | Pipeline | Dashboard | |
| `total_volume` | Pipeline | Dashboard | SUM of keyword search_volume in cluster (fixed from MAX in 2026-03-23) |
| `keyword_count` | Pipeline | Dashboard | Number of keywords in cluster |
| `est_new_leads_low/high` | Pipeline | Dashboard | Near-miss leads |
| `est_revenue_low/mid/high` | Pipeline | Dashboard | Near-miss revenue (secondary) |
| `tar_revenue_low/mid/high` | Pipeline | Dashboard | Total Addressable Revenue at target visibility (primary) |
| `sample_keywords` | Pipeline | Dashboard | JSON array |
| `status` | Edge fn / Dashboard | Dashboard | TEXT: `inactive` / `active` / `complete` / `hidden` |
| `hidden_reason` | Dashboard | Dashboard | Free-text explanation when status = `hidden` |
| `activated_at` | Edge fn | Dashboard | |
| `activated_by` | Edge fn | Dashboard | |
| `target_publish_date` | Edge fn | Dashboard | |
| `notes` | Edge fn | Dashboard | |
| `primary_entity_type` | Pipeline (Phase 3c/3d) | Dashboard | `Service`, `Course`, `Product`, `LocalBusiness`, `FAQPage`, `Article` — default `Service` |
| `authority_score` | Pipeline (track-rankings) | Dashboard | 0-100, position-weighted |
| `authority_score_updated_at` | Pipeline | Dashboard | |

**Pipeline writes**: Phase 3b (initial), Phase 3d (rebuild with canonical keys, preserves status/activation/hidden/entity_type)
**Dashboard reads**: `useAuditClusters()`, `useAudit()` relation, ClustersPage, StrategyPage, OverviewPage
**Dashboard writes**: Via `cluster-action` edge function (status, activation fields), direct update (hidden status/reason)

---

### `audit_rollups`

| Column | Writer | Reader | Notes |
|--------|--------|--------|-------|
| `audit_id` | Pipeline | Dashboard | FK |
| `total_volume_analyzed` | Pipeline | Dashboard | |
| `near_miss_keyword_count` | Pipeline | Dashboard | |
| `opportunity_topics_count` | Pipeline | Dashboard | |
| `monthly_revenue_low/mid/high` | Pipeline | Dashboard | Near-miss revenue (secondary) |
| `tar_revenue_low/mid/high` | Pipeline | Dashboard | Total Addressable Revenue at target visibility (primary) |
| `total_keyword_count` | Pipeline | Dashboard | SUM of keyword_count across clusters |

**Pipeline writes**: Phase 3b (initial), Phase 3d (rebuild)
**Dashboard reads**: `useAudits()` relation, `useAudit()` relation, ResearchPage, OverviewPage

---

### `audit_assumptions`

| Column | Writer | Reader | Notes |
|--------|--------|--------|-------|
| `audit_id` | Dashboard/Pipeline | Both | FK |
| `benchmark_id` | Dashboard | Pipeline | FK → benchmarks |
| `ctr_model_id` | Dashboard | Pipeline | FK → ctr_models |
| `cr_used_min/mid/max` | Dashboard | Pipeline | Conversion rates |
| `acv_used_min/mid/max` | Dashboard | Pipeline | Average contract values |
| `target_ctr` | Dashboard | Pipeline | |
| `near_miss_min_pos/max_pos` | Dashboard | Pipeline | Position range |
| `min_volume` | Dashboard | Pipeline | Minimum search volume |
| `tar_position` | Dashboard | Pipeline | Target visibility position for TAR CTR (default 5) |

**Pipeline writes**: `ensureAssumptions()` auto-creates from benchmarks if missing at sync time
**Dashboard writes**: `useUpdateAssumptions()` on Settings page (includes `tar_position`)
**Dashboard reads**: `useAuditAssumptions()`, `useAudit()` relation, revenue recalculation, TAR preview

---

## Agent Output Tables

### `audit_snapshots`

| agent_name | Writer Phase | Key JSONB Columns | Dashboard Consumer |
|------------|-------------|-------------------|-------------------|
| `dwight` | Phase 6c (syncDwight) | `executive_summary`, `prioritized_fixes[]`, `agentic_readiness[]`, `structured_data_issues[]`, `heading_issues[]`, `security_issues[]`, `platform_notes`, `site_metadata` | `useAuditSiteFindings()` → AuditPage |
| `jim` | Phase 3 (syncJim) | `research_summary_markdown`, `keyword_overview{}`, `position_distribution[]`, `branded_split{}`, `intent_breakdown[]`, `top_ranking_urls[]`, `competitor_analysis[]`, `competitor_summary{}`, `striking_distance[]`, `content_gap_observations[]`, `key_takeaways[]`. **Numeric columns now sourced from `research_data.json` (deterministic) when available; falls back to regex-parsed `research_summary.md` for backward compat.** | `useResearchSiteFindings()` → ResearchPage |
| `gap` | Phase 5 | `keyword_overview` (JSONB with `authority_gaps[]`, `format_gaps[]`, `gap_summary`, `ai_citation_gaps[]`) | `useAuditSnapshots()`, `useAiCitationGaps()` |

**Gap `keyword_overview` sub-key changes (Session 3):**
- `authority_gaps[].coverage_note` (NEW) — one sentence describing what the competitor covers that the client does not
- `authority_gaps[].revenue_opportunity` (FORMAT CHANGE) — was mixed-format string, now `{ value: number|null, basis: string }` object. ALL consumers must use `formatRevenueOpportunity()` from `src/agents/gap/format-revenue.ts` (handles both formats, pipe-escapes, truncates) — raw interpolation renders `[object Object]`. Consumers: `buildGapAnalysisMd()`, Pam's `buildContentGapSection()` (generate-brief.ts), cluster strategy gap section (generate-cluster-strategy.ts).
- `priority_recommendations[].target_topic` (NEW, replaces `target_keyword`) — entity/topic at service-category level, Title Case
- `priority_recommendations[].representative_keywords` (NEW) — array of 2-4 keywords as evidence. `target_keyword` still supported as fallback in `buildGapAnalysisMd()`.

**`content_gap_observations` column contract (Session 6, 2026-06-11):** string[] for ALL agents. Jim writes narrative strings (json:insights); Gap now writes formatted strings derived from authority_gaps ("Topic: client absent — top competitor X. coverage_note") — it previously wrote raw objects, which legacy gap snapshots still contain. Dashboard's ResearchPage filters non-strings defensively. Full gap objects remain in `keyword_overview.authority_gaps`.

**Shared columns**: `id`, `audit_id`, `agent_name`, `snapshot_version`, `agent_run_id`, `row_count`, `created_at`

**`prioritized_fixes[]` item schema** (Dwight snapshots):

| Field | Type | Notes |
|-------|------|-------|
| `number` | integer | Fix sequence number within tier |
| `issue` | string | Issue title from AUDIT_REPORT.md |
| `affected_pages` | string | Page count or URL list |
| `fix` | string | Remediation recommendation |
| `priority_tier` | integer | 1=Critical, 2=High, 3=Medium, etc. |
| `priority_label` | string | "Critical", "High", "Medium" |
| `status` | string | `flagged` (default), `false_positive`, `verified`, `resolved` |
| `original_severity` | string | Baseline `priority_label` at parse time (never changes) |
| `verified_at` | string? | ISO timestamp of verification check |
| `verification_source` | string? | `direct_http`, `manual`, `re-verification` |
| `verification_note` | string? | Human-readable explanation of the verification finding |

Phase 1a (`verify-dwight.ts`) writes `verification_results.json` to disk. syncDwight loads it and merges corrections into fix objects before writing to `audit_snapshots`. False positive fixes display as struck-through in the dashboard.

---

### `agent_technical_pages`

Written by syncDwight (Phase 6c). One row per crawled URL.

| Column | Notes |
|--------|-------|
| `url` | Full URL |
| `status_code` | HTTP status |
| `word_count` | |
| `title`, `h1`, `meta_description` | Page metadata |
| `depth` | Crawl depth |
| `indexability` | |
| `inlinks_count`, `outlinks_count` | |
| `semantic_closest_url`, `semantic_similarity_score`, `semantic_flag` | Near-duplicate detection |
| `crawl_data` | JSONB overflow (extra columns from crawl) |

**Dashboard reads**: `useAgentTechnicalPages()` → AuditPage

---

### `agent_architecture_pages`

Written by syncMichael (Phase 6b). One row per recommended page.

| Column | Notes |
|--------|-------|
| `url_slug` | Recommended URL |
| `page_status` | `new` / `exists` |
| `silo_name` | Content silo assignment |
| `role` | Page role in silo (pillar/cluster/support) — structural position |
| `coverage_role` | Entity-authority intent purpose: commercial, informational, geographic, comparison, faq, credential, outcome. Written by syncMichael, read by dashboard. Orthogonal to `role` — `role` = structural position in silo, `coverage_role` = content purpose in entity authority strategy. |
| `primary_keyword` | Target keyword |
| `primary_keyword_volume` | |
| `action_required` | What to do |

**Dashboard reads**: `useAgentArchitecturePages()` → StrategyPage

---

### `agent_architecture_blueprint`

Written by syncMichael (Phase 6b). One row per audit.

| Column | Notes |
|--------|-------|
| `blueprint_markdown` | Full architecture blueprint |
| `executive_summary` | Summary extract |
| `snapshot_version` | |

**Dashboard reads**: `useAgentBlueprint()` → StrategyPage

---

### `agent_runs`

Written by syncDwight + syncMichael. Tracks agent execution history.

| Column | Notes |
|--------|-------|
| `agent_name` | `dwight` / `michael` |
| `run_date` | |
| `status` | `completed` |
| `source_path` | Disk artifact path |
| `metadata` | JSONB: `{page_count}` etc. |

**Dashboard reads**: Implicit via relations

---

### `audit_qa_results`

Written by `runQA()` in `pipeline-generate.ts` — one row per QA gate evaluation (including retries).

| Column | Notes |
|--------|-------|
| `audit_id` | FK to audits |
| `phase` | `dwight` / `strategy-brief` / `keyword-research` / `jim` / `gap` / `michael` / `local-presence` |
| `verdict` | `pass` / `enhance` / `fail` |
| `checks` | JSONB array: `{name, passed, feedback}` per check |
| `feedback` | Aggregated failure feedback (also written to `audits/{domain}/qa_feedback/{phase}.md` on FAIL for retry injection) |
| `attempt_number` | 1-based |

`keyword-research` and `local-presence` are deterministic-only (no LLM evaluation). **Dashboard reads**: none yet.

---

### `pipeline_runs` (migration 033)

Per-phase progress tracking for full/sales pipeline runs (prospect mode excluded). **Writers**: shell via `scripts/pipeline-progress.ts` (start/phase-start/phase-done/phase-skip/pause/complete/fail) + pipeline server (watchdog `timed_out` flip, reconciliation `failed` flip). **Readers**: dashboard `usePipelineRun` / `usePipelineRuns`.

| Column | Notes |
|--------|-------|
| `audit_id` | FK → `audits` (CASCADE delete) |
| `domain`, `mode` | Run identity; `mode` = `full`/`sales` |
| `start_from`, `stop_after` | Phase range flags passed to the run (null = full run) |
| `status` | `running` / `completed` / `failed` / `timed_out` / `awaiting_review` |
| `current_phase` | Phase ID currently executing (null when idle/done) |
| `phases` | JSONB: `{"1":{"status":"completed","started_at":...,"completed_at":...},"4":{"status":"skipped"},"3b":{"status":"failed","error":...}}` |
| `error_message` | Set on fail/timeout/reconcile |
| `started_at`, `completed_at` | Run timestamps |

RLS: service_role ALL; authenticated SELECT via audit ownership (`audits.user_id = auth.uid()`). Index on `(audit_id, started_at DESC)`. Single writer per domain guaranteed by server `inFlight` 409 → JSONB read-modify-write is race-free.

**Dashboard reads**: AuditRunning 16-phase checklist (latest run, 2s poll while running); AuditSettings Run History table (last 20).

---

### `audit_coverage_validation` — **DEPRECATED**

**Status:** Inactive. Phase 6.5 (Validator) was removed — its coverage check was superseded by Gap analysis. Table preserved for historical data; no pipeline code reads or writes to it.

---

## Performance Tables

### `baseline_snapshots`

Written by syncJim (first sync only, if near_miss > 0).

| Column | Notes |
|--------|-------|
| `keyword` | |
| `baseline_rank` | Initial position |
| `baseline_volume` | |

**Dashboard reads**: `useBaselineSnapshots()` → PerformancePage (Near-Miss Baseline section)

---

### `ranking_snapshots`

Written by `track-rankings.ts` (monthly cron or on-demand).

| Column | Notes |
|--------|-------|
| `keyword` | |
| `position` | Current SERP position |
| `search_volume` | |
| `snapshot_date` | |
| `canonical_key` | For cluster aggregation |
| `canonical_topic` | Human-readable cluster name (renamed from `cluster` in migration 025) |

**Dashboard reads**: Via `ranking_deltas` view

---

### `cluster_performance_snapshots`

Written by `track-rankings.ts` during `aggregateClusterPerformance()`.

| Column | Notes |
|--------|-------|
| `canonical_key`, `canonical_topic` | Cluster identity |
| `snapshot_date` | |
| `keyword_count` | |
| `avg_position` | Excludes unranked |
| `keywords_p1_3/p4_10/p11_30/p31_100` | Position buckets |
| `total_volume` | |
| `estimated_traffic` | |
| `revenue_low/mid/high` | |
| `authority_score` | 0-100, position-weighted |
| `authority_score_delta` | Change from prior snapshot |

**Dashboard reads**: `useClusterPerformance()` → PerformancePage, `useClusterAuthorityTrend()` → ClustersPage authority chart

---

### `page_performance`

Written by `track-rankings.ts` for published execution pages.

| Column | Notes |
|--------|-------|
| `execution_page_id` | FK |
| `url_slug` | |
| `silo` | |
| `snapshot_date` | |
| `published_at` | |
| `pre_publish_avg_position` | |
| `current_avg_position` | |
| `keywords_gained_p1_10` | |
| `keywords_total` | |

New GA4 behavioral columns (written by `track-rankings.ts` step 9):

| Column | Notes |
|--------|-------|
| `organic_sessions` | GA4 organic sessions |
| `organic_engagement_rate` | GA4 organic engagement rate |
| `organic_cr` | GA4 organic conversion rate |
| `organic_conversions` | GA4 organic key events/conversions |
| `ga4_snapshot_date` | Date of GA4 data fetch |

**Dashboard reads**: `usePagePerformance()` → PerformancePage (Published Page Performance)

---

### `analytics_connections`

Stores GSC/GA4 property IDs per audit. Service account handles auth centrally.

| Column | Writer | Notes |
|--------|--------|-------|
| `audit_id` | Manual insert | FK audits, UNIQUE |
| `gsc_property_url` | Manual insert | e.g. `https://www.example.com/` |
| `ga4_property_id` | Manual insert | e.g. `513955424` |
| `last_gsc_sync_at` | Pipeline | Updated by fetch-gsc-data.ts |
| `last_ga4_sync_at` | Pipeline | Updated by fetch-ga4-data.ts |
| `status` | Manual | `active`, `disabled`, or `error` |

**RLS**: service_role ALL + super_admin SELECT

---

### `gsc_page_snapshots`

Written by `fetch-gsc-data.ts` (Phase 1c + track-gsc.ts weekly).

| Column | Notes |
|--------|-------|
| `page_url` | Normalized path (e.g. `/services/hvac`) |
| `snapshot_date` | |
| `clicks`, `impressions`, `ctr`, `avg_position` | GSC metrics |
| `top_queries` | JSONB array of top 5 queries per page |

**Dashboard reads**: Deferred (Phase 4 dashboard UI)

---

### `ga4_page_snapshots`

Written by `track-rankings.ts` step 9 (GA4 fetch).

| Column | Notes |
|--------|-------|
| `page_url` | Normalized path |
| `snapshot_date` | |
| `total_sessions`, `total_conversions`, `total_revenue` | All-channel metrics |
| `organic_sessions`, `organic_engaged_sessions` | Organic Search channel |
| `organic_engagement_rate`, `organic_cr` | Derived rates |
| `organic_conversions`, `organic_avg_session_dur` | Organic behavioral |

**Dashboard reads**: `useReportGa4` hook in `useReportData.ts`

---

### `ga4_event_snapshots`

Written by `track-rankings.ts` step 9b (GA4 event-level conversion fetch). Site-wide, not per-page.

| Column | Notes |
|--------|-------|
| `event_name` | One of: `registration_complete`, `contact_form_submit`, `click_phone`, `purchase` |
| `channel_group` | `sessionDefaultChannelGroup` from GA4 (Organic Search, Direct, Paid Search, etc.) |
| `snapshot_date` | Date of the tracking run |
| `event_count` | Number of events for this event+channel combination |
| `event_revenue` | Revenue attributed to this event+channel combination |

**Unique constraint**: `(audit_id, snapshot_date, event_name, channel_group)`

**Dashboard reads**: `useReportGa4Events` hook → `ConversionSummarySection` component

---

### `audit_assumptions` (new columns)

New observed CR columns (written by `track-rankings.ts` step 9):

| Column | Writer | Notes |
|--------|--------|-------|
| `observed_cr` | Pipeline | Computed from GA4 pages with 30+ organic sessions |
| `observed_cr_source` | Pipeline | Always `'ga4'` |
| `observed_cr_updated_at` | Pipeline | Timestamp |
| `use_observed_cr` | Dashboard/manual | Boolean, defaults FALSE, never auto-enabled |

When `use_observed_cr = true`, `sync-to-dashboard.ts` uses `observed_cr` as `cr_used_mid` in TAR calculation.

---

## LLM Visibility Tables

### `llm_visibility_snapshots`

Written by syncJim (Phase 3b) and `track-llm-mentions.ts` (monthly cron or on-demand). One row per keyword × platform × domain.

| Column | Writer | Reader | Notes |
|--------|--------|--------|-------|
| `id` | Auto | Dashboard | PK, UUID |
| `audit_id` | Pipeline | Both | FK → audits |
| `domain` | Pipeline | Dashboard | Client domain or competitor domain |
| `snapshot_date` | Pipeline | Dashboard | DATE |
| `keyword` | Pipeline | Dashboard | |
| `platform` | Pipeline | Dashboard | `google`, `chat_gpt` |
| `mention_count` | Pipeline | Dashboard | |
| `ai_search_volume` | Pipeline | Dashboard | Nullable |
| `top_citation_domains` | Pipeline | Dashboard | JSONB array of domain strings |
| `is_estimated` | Pipeline | Dashboard | Boolean, default false. True for competitor rows (aggregate API data, not per-keyword measured) |
| `cluster_canonical_key` | Pipeline | Dashboard | TEXT, nullable. Links snapshot to the cluster strategy that generated the query. NULL for legacy fallback-mode snapshots. Added migration 027. |
| `created_at` | Auto | Dashboard | |

**UNIQUE constraint:** `(audit_id, snapshot_date, keyword, platform, domain)` — allows client and competitor data to coexist.

**Index:** `idx_llm_vis_cluster` on `(audit_id, cluster_canonical_key)` WHERE `cluster_canonical_key IS NOT NULL` — for dashboard cluster SOV queries.

**Pipeline writes**: syncJim (client + competitor mentions from `llm_mentions.json`), `track-llm-mentions.ts` (client + competitor mentions, monthly — cluster-aware or fallback mode)
**Dashboard reads**: `useLlmVisibilitySnapshots()` → AiVisibilityPage, PerformancePage (via `useAiVisibilityTrend`), ClustersPage (via `useClusterAiSov`)

---

### `llm_mention_details`

Written by syncJim (Phase 3b) and `track-llm-mentions.ts`. Qualitative mention records.

| Column | Writer | Reader | Notes |
|--------|--------|--------|-------|
| `id` | Auto | Dashboard | PK, UUID |
| `audit_id` | Pipeline | Both | FK → audits |
| `keyword` | Pipeline | Dashboard | |
| `platform` | Pipeline | Dashboard | `google`, `chat_gpt` |
| `mention_text` | Pipeline | Dashboard | Nullable |
| `citation_urls` | Pipeline | Dashboard | JSONB array |
| `source_domains` | Pipeline | Dashboard | JSONB array |
| `captured_at` | Auto | Dashboard | |

**Pipeline writes**: syncJim, `track-llm-mentions.ts`, `ai-visibility-analysis.ts`
**Dashboard reads**: `useLlmMentionDetails()` → AiVisibilityPage

**Note**: `ai-visibility-analysis.ts` writes `mention_text: null` and `citation_urls: []` — LLM Mentions API returns domains, not full URLs or snippet text. `source_domains` is populated.

---

## Ad-Hoc Research Tables

### `keyword_lookups`

Ad-hoc keyword volume lookups via DataForSEO. Each row = one keyword result; `batch_id` groups results from a single lookup session. Super-admin only.

| Column | Type | Writer | Description |
|--------|------|--------|-------------|
| `id` | uuid PK | pipeline | Auto-generated |
| `audit_id` | uuid FK→audits | pipeline | Audit this lookup belongs to |
| `batch_id` | uuid | pipeline | Groups all keywords from one lookup invocation |
| `keyword` | text | pipeline | The looked-up keyword |
| `volume` | integer | pipeline | Monthly search volume (0 if not found) |
| `cpc` | numeric(10,2) | pipeline | Cost per click |
| `competition` | numeric(5,4) | pipeline | Competition score (0-1) |
| `competition_level` | text | pipeline | LOW / MEDIUM / HIGH |
| `looked_up_by` | uuid FK→auth.users | pipeline | User who ran the lookup |
| `looked_up_at` | timestamptz | pipeline | When the lookup was performed |
| `estimated_cost` | numeric(10,4) | pipeline | DataForSEO API cost for the batch |

**Unique**: `(audit_id, batch_id, keyword)`
**RLS**: super_admin only (`has_role` check)
**Dashboard reads**: `useKeywordLookupHistory()` → KeywordLookupPage (history accordion, last 90 days)

---

## Content Factory Tables

### `execution_pages`

Written by syncMichael (Phase 6b) and Cluster Strategy (on-demand), updated by Pam + Oscar.

| Column | Writer | Notes |
|--------|--------|-------|
| `url_slug` | syncMichael / Cluster Strategy | |
| `silo` | syncMichael / Cluster Strategy | |
| `priority` | syncMichael / Cluster Strategy | 1=create, 2=optimize, 3=differentiate, 4=maintain |
| `source` | syncMichael / Cluster Strategy / Dashboard | `michael` (syncMichael), `cluster_strategy` (activation), `manual` (dashboard useAddRecommendedPages) |
| `buyer_stage` | Cluster Strategy | `awareness`, `consideration`, `decision`, `retention` — null for architecture pages |
| `strategy_rationale` | Cluster Strategy | Why this page was recommended — null for architecture pages |
| `status` | Pipeline + Dashboard | `not_started` → `brief_ready` → `in_progress` → `review` → `published`. Also `deprecated` — set by: (1) syncMichael on strategic re-run for stale uncommitted pages, (2) Michael's deprecation recommendations, (3) dashboard user "Remove from queue" action (`useDeprecateExecutionPage`). Oscar writes `in_progress` (dashboard shows "Draft Ready"). `review` = manual user action ("In Review"). |
| `page_brief` | syncMichael | JSONB — shape: `{silo, role, coverage_role, primary_keyword, volume, action, page_status}`. `coverage_role` added for entity-authority intent purpose (commercial, informational, geographic, comparison, faq, credential, outcome). Read by Pam for Page Identity context. |
| `canonical_key` | syncMichael | Join to `audit_clusters` |
| `cluster_active` | Pipeline (rebuild) | Boolean, gates content production |
| `metadata_markdown` | Pam | |
| `content_outline_markdown` | Pam | |
| `schema_json` | Pam | JSON-LD |
| `content_html` | Oscar | Production HTML (65K token budget, streaming) |
| `related_pages` | Pam (generate-brief.ts) | JSONB — embedding-derived verified internal link candidates. Shape: `{computed_at, model, source, candidates: [{target, kind: 'live'\|'planned', title, similarity, status?, silo?}], cannibalization_risks: [{target, similarity}]}`. Lives OUTSIDE `page_brief` because syncMichael wholesale-overwrites `page_brief` on re-runs — survives strategic re-runs. Only set when computed (never nulled). Read by dashboard brief drawer (ExecutionPage.tsx "Related Pages" block). Migration 032. |
| `published_at` | Dashboard | Set when status → published |
| `snapshot_version` | syncMichael | |

**Dual taxonomy — `silo` vs `canonical_topic`**: `silo` is Michael's architectural grouping (human-readable name from blueprint silo headers). `canonical_topic` on `audit_clusters` is Phase 3c's semantic grouping. They overlap but are NOT identical — Michael may group pages differently than Phase 3c groups keywords. `canonical_key` is the contractual join between `execution_pages` and `audit_clusters`. `silo` is a display label with no foreign key relationship. The silo-match fallback in cluster activation (step 12b) bridges the gap for pages where `canonical_key` is NULL by matching `silo = canonical_topic`.

**Dashboard reads**: `useExecutionPages()` → ContentPage, ImplementationPage, ClustersPage. Query filters `.neq('status','deprecated')` — deprecated rows are invisible to the dashboard.
**Dashboard writes**: `useUpdateExecutionPageStatus()` (status), `useAddRecommendedPages()` (INSERT), `useDeprecateExecutionPage()` (sets status=deprecated, soft-delete)

---

### `pam_requests`

| Column | Writer | Reader |
|--------|--------|--------|
| `audit_id`, `page_url`, `silo_name`, `page_role` | Dashboard (INSERT) | Pipeline |
| `target_keywords` | Dashboard | Pipeline |
| `operator_notes` (migration 034) | Dashboard (operator dialog) | Pipeline — injected into Pam's prompt as OPERATOR DIRECTIVES; NULL for audit-derived requests |
| `domain` | Dashboard | Pipeline |
| `status` | Pipeline | Dashboard | `pending` → `processing` → `completed` / `failed` |
| `error_message` | Pipeline | Dashboard |

**Dashboard polls**: 3s interval while pending/processing

**`execution_pages.source` values** (TEXT, no CHECK): `michael` (architecture blueprint), `cluster_strategy` (buyer-journey expansion), `manual` (dashboard cluster add), `operator` (operator-directed dialog, Session 7-8). syncMichael's strategic-rerun deprecation only touches `source='michael'` rows. **`execution_pages.status` CHECK** (migration 034): `not_started | brief_ready | in_progress | draft_ready | review | in_review | published | deprecated` — `draft_ready`/`in_review` added because the dashboard status dropdown writes them (previously rejected by the CHECK). Migration 035 normalized legacy data (`in_progress`→`draft_ready`, `review`→`in_review`) and Oscar now writes `draft_ready`; legacy values remain CHECK-valid for safety.

**Session 9 columns (migration 035):**
- `execution_pages.published_url` (TEXT) — live URL captured by the dashboard's PublishUrlDialog (or auto-derived `https://domain/slug` on bulk publish). Joins the page to GSC performance: the drawer's Search Performance block matches the URL's **pathname** against `gsc_page_snapshots.page_url` (which stores paths like `/emt-seattle`, NOT full URLs).
- `execution_pages.content_edited_at` (TIMESTAMPTZ) — stamped when a human replaces `content_html` via the dashboard's Replace Draft HTML editor (content-back-in). NULL = unedited agent draft.

---

### `oscar_requests`

Same pattern as `pam_requests`.

| Column | Writer | Reader |
|--------|--------|--------|
| `audit_id`, `page_url`, `domain` | Dashboard (INSERT) | Pipeline |
| `status` | Pipeline | Dashboard | `pending` → `processing` → `completed` / `failed` |
| `error_message` | Pipeline | Dashboard |

**Dashboard polls**: 3s interval while pending/processing

---

### `cluster_strategy`

Written by `generate-cluster-strategy.ts` (on-demand, per-cluster via `/activate-cluster`).

| Column | Notes |
|--------|-------|
| `canonical_key` | Cluster identity |
| `strategy_markdown` | Full Opus strategy document |
| `recommended_pages` | JSON |
| `buyer_stages` | JSON |
| `format_gaps` | JSON |
| `entity_map` | JSONB — entity type mapping from Section 0 |
| `ai_optimization_notes` | Section 5 prose fallback |
| `ai_optimization_targets` | JSONB — structured AI/search targets from Section 5: `[{query, target_type, structural_pattern, applies_to_page, condition, rationale}]` |
| `search_intent` | TEXT — cluster dominant intent: `commercial`, `informational`, `transactional`, `navigational`, `mixed`. From entity map Section 0. Consumed by Pam for content-type guidance. Migration 022. |
| `visibility_queries` | JSONB — AI visibility measurement queries from Section 7: `[{query, query_type, target_cluster, platforms}]`. Migration 026. |
| `status` | TEXT: `active` (default), `deprecated`. Deprecated by `rebuildClustersAndRollups()` when canonical_key no longer exists in rebuilt clusters (rebuild skips entirely when 0 canonicalized keywords — empty-rebuild guard, 2026-06-11). Reactivated by the `generate-cluster-strategy.ts` upsert (`status='active'`, `deprecated_at=NULL`) — regeneration always un-deprecates. Migration 014. |
| `deprecated_at` | TIMESTAMPTZ, set when status → `deprecated`. NULL for active strategies. |
| `model_used` | |

**Dashboard reads**: `useClusterStrategy()`, `useClusterStrategyPoll()` → StrategyPage. Both filter `.eq('status', 'active')` — deprecated strategies are invisible to the dashboard.

---

## Embedding Infrastructure Tables

### `embeddings`

Polymorphic vector store for OpenAI text-embedding-3-small (1536 dimensions). Migration 015. Internal pipeline infrastructure — no dashboard access.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Auto-generated |
| `content_type` | TEXT NOT NULL | `keyword`, `page_section`, `page_meta`, `cluster_seed`, `client_context`, `exec_page` (Session 3 — planned execution pages; contentId namespace `exec_page:{audit_id}:{slug}`) |
| `content_id` | TEXT NOT NULL | Opaque identifier (e.g., `{audit_id}:{keyword_id}`) |
| `content_hash` | TEXT NOT NULL | SHA-256 of `text_input`, enables cache-hit path before calling OpenAI |
| `text_input` | TEXT NOT NULL | Original text that was embedded |
| `embedding` | VECTOR(1536) NOT NULL | pgvector column, cosine similarity via `<=>` operator |
| `model_version` | TEXT NOT NULL | e.g., `openai/text-embedding-3-small@2024-01` |
| `created_at` | TIMESTAMPTZ | Auto |

**Unique**: `(content_type, content_id, model_version)`
**Indexes**: `content_hash + model_version` (cache lookup), HNSW cosine on active model version (partial), `content_type + model_version` (filtered queries)
**RPC**: `find_similar_embeddings(query_embedding, match_content_type, match_model_version, match_threshold, match_limit, exclude_content_id)` — cosine similarity search filtered by type and model version.

**Pipeline writes**: `src/embeddings/service.ts` — `embedSingle()`, `embedBatch()`. Called by: (1) `scripts/embed-keywords.ts` at Phase 2 and Phase 3b (embed-at-ingestion cache pre-warm), (2) hybrid canonicalize Phase 3c `pre-cluster.ts` (gets cache hits from Phase 2/3b), (3) Phase 4c density/cannibalization (`page_meta:{normalizedUrl}` ids), (4) `src/agents/linking/related-pages.ts` at brief time (`exec_page:{audit_id}:{slug}` + cache hits on Phase 4c `page_meta` ids).
**Pipeline reads**: `getEmbedding()`, `getEmbeddingsBatch()`, `findSimilar()`, `computePairwiseSimilarity()`. Used by hybrid pre-clustering for centroid computation and similarity scoring.
**Dashboard**: No access (service_role only RLS).

---

## Local Presence Tables

### `gbp_snapshots`

Written by Phase 6d (LocalPresence).

| Column | Notes |
|--------|-------|
| `listing_found` | Boolean (missing GBP = high-value signal) |
| `business_name`, `phone`, `address`, `website` | Listing data |
| `claimed_status` | `claimed` / `unclaimed` / `unknown` |
| `canonical_nap` | Name/Address/Phone tuple (source of truth) |
| `data_source` | `gbp` |

**Dashboard reads**: `useGbpSnapshot()` → LocalPresencePage
**Dashboard column names differ**: `gbp_missing` (= !listing_found), `matched_name`, `category`, `is_claimed`, `rating`, `review_count`, `photo_count`, `canonical_name/address/phone`

---

### `citation_snapshots`

Written by Phase 6d (LocalPresence). One row per directory.

| Column | Notes |
|--------|-------|
| `directory_name` | Google, Yelp, Angi, BBB, etc. (11 directories) |
| `listing_found` | Boolean |
| `nap_match_name/address/phone` | Boolean, compared to GBP canonical NAP |
| `listing_url` | |
| `data_source` | `gbp` (Google) or `serp` (others) |

**Dashboard reads**: `useCitationSnapshots()` → LocalPresencePage

---

## Reference Tables

### `prospects`

| Column | Writer | Reader |
|--------|--------|--------|
| `name`, `domain`, `geo_type`, `target_geos` | Dashboard | Pipeline |
| `status` | Both | Both | `discovery` → `running` → `qualified` / `converted` |
| `scout_run_at`, `scout_output_path` | Pipeline | Dashboard |
| `converted_to_audit_id` | Dashboard | Dashboard |
| `share_token` | Edge fn (generate_share_token) | Edge fn (get_share_report) | UUID, unique partial index |
| `share_token_created_at` | Edge fn | Dashboard | |
| `brand_favicon_url` | Pipeline (Scout) | Edge fn (get_share_report) | Google favicon URL |
| `scout_markdown` | Pipeline (Scout) | Edge fn (get_share_report) | Full scout report markdown |
| `scout_scope_json` | Pipeline (Scout) | Edge fn (get_share_report) | scope.json JSONB. Additive fields: `gap_summary.top_opportunities[].cpc_inferred` (boolean), `max_topic_cpc` (Record<string, number>) |
| `prospect_narrative` | Pipeline (Scout) | Edge fn (get_share_report) | Plain-language outreach doc |

**Dashboard reads**: `useProspects()`, `useProspect()`, `useProspectStatus()` (2s poll while running)
**Pipeline writes**: Scout updates status, scout_run_at, scout_output_path, brand_favicon_url, scout_markdown, scout_scope_json, prospect_narrative

---

### `benchmarks`

Read-only reference data. Pipeline reads at sync time, Dashboard reads for audit creation.

| Key Columns | Notes |
|-------------|-------|
| `service_key` | HVAC, Plumbing, Electrical, etc. |
| `cr_min/max`, `acv_min/max` | Industry conversion/revenue benchmarks |

---

### `ctr_models`

Read-only reference data. Dashboard reads default model for audit creation.

| Key Columns | Notes |
|-------------|-------|
| `model_key` | |
| `buckets` | JSON CTR curve |
| `is_default` | |

---

### `client_profiles`

| Column | Writer | Reader |
|--------|--------|--------|
| All fields | Dashboard | Pipeline (Oscar) |

**Dashboard reads/writes**: `useClientProfile()`, `useUpsertClientProfile()` — Settings page
**Pipeline reads**: Oscar reads for brand voice injection

---

## Views

### `v_opportunity_breakdown`

Server-side view joining `audit_clusters` + `audit_assumptions` with eligibility calculation.

**Key columns**: `canonical_key`, `canonical_topic`, `eligibility_status`, `best_rank`, `total_volume`, `est_revenue_*`, `ctr_gain_used`
**Dashboard reads**: `useOpportunityBreakdown()` → ResearchPage

### `ranking_deltas`

Server-side view computing position changes from `ranking_snapshots`.

**Key columns**: `keyword`, `canonical_key`, `current_position`, `baseline_position`, `position_delta`, `search_volume`
**Dashboard reads**: `useRankingDeltas()` → PerformancePage

### `audit_topic_dominance`

**Key columns**: `canonical_key`, `canonical_topic`, `leader_domain`, `leader_share`, `client_share`
**Dashboard reads**: `useCompetitorDominance()` → ResearchPage (3s poll for 90s if empty)

### `audit_topic_competitors`

**Key columns**: `canonical_key`, `competitor_domain`, `appearance_count`, `share`, `is_client`, `representative_url`
**Dashboard reads**: `useTopicCompetitors()` → ResearchPage
**Note**: `representative_url` added by Phase 4 (migration 020) — first SERP URL per competitor domain per topic. Consumed by Phase 4b.

### `competitor_sections`

**Writer**: Phase 4b (`fetch-competitor-sections.ts`)
**Key columns**: `audit_id`, `domain`, `canonical_key`, `url`, `heading_level` (h2/h3), `heading_text`, `heading_position`, `is_client`
**Dashboard reads**: None (consumed by Phase 4b coverage computation)
**Re-run**: DELETE all rows for audit_id before insert

### `cluster_section_coverage`

**Writer**: Phase 4b (`fetch-competitor-sections.ts`)
**Key columns**: `audit_id`, `canonical_key`, `coverage_score`, `coverage_status` (scored/no_client_pages/insufficient_competitors), `competitor_count`, `core_gaps` (JSONB), `borderline_matches` (JSONB), `snapshot_date`
**Dashboard reads**: `useClusterCoverageTrend()` → PerformancePage
**Consumer**: `runGap()` reads this table to inject Section Coverage Matrix into prompt
**Unique constraint**: `(audit_id, canonical_key, snapshot_date)` — historical snapshots by date

### `audit_clusters` (coverage columns, migration 021)

**Additional columns**: `coverage_score`, `coverage_competitor_count`, `coverage_score_updated_at`
**Writer**: Phase 4b (denormalized copy from cluster_section_coverage)
**Dashboard reads**: `useAuditClusters()` → ClustersPage (Coverage column + badge)
**Preservation**: `rebuildClustersAndRollups()` preserves coverage_score through DELETE+INSERT cycle

### `audit_clusters` (density columns, migration 031)

**Additional columns**: `density_score` FLOAT, `competitor_density_score` FLOAT, `density_updated_at` TIMESTAMPTZ
**Writer**: Phase 4c (`compute-density.ts`) — % of cluster keywords semantically covered by client page content (≥0.80 cosine vs site-wide client corpus); competitor score uses per-cluster competitor sections (null if none). Distinct from `coverage_score` (4b: competitor-heading coverage).
**Dashboard reads**: `useAuditClusters()` → ClustersPage (Density column, `DensityScoreBadge`)
**Consumer**: `runGap()` injects density block into prompt
**Preservation**: `rebuildClustersAndRollups()` preserves density columns through DELETE+INSERT cycle (SELECT + scoreMap + restore block)

### `cannibalization_warnings` (migration 031)

**Writer**: Phase 4c (`compute-density.ts`)
**Key columns**: `id` UUID PK, `audit_id` UUID FK→audits (CASCADE), `canonical_key`, `page_a_url`, `page_b_url`, `similarity` FLOAT, `created_at`
**Semantics**: Client page pairs within the same cluster whose `{title} | {h1} | {meta description}` embeddings exceed 0.90 cosine similarity (strict `>`). Current state only — no snapshots.
**Dashboard reads**: `useCannibalizationWarnings()` → ClustersPage (warning banner + per-row tooltip)
**Consumer**: `runGap()` injects top-20 pairs into prompt
**Re-run**: DELETE all rows for audit_id before insert
**RLS**: service_role ALL; authenticated SELECT via audit ownership; GRANTs per post-Oct-2026 pattern
**Indexes**: `(audit_id)`, `(audit_id, canonical_key)`

---

## Edge Functions

| Function | Action | Pipeline Server Endpoint | Request Shape | Response Shape |
|----------|--------|-------------------------|---------------|----------------|
| `run-audit` | (default) | `/trigger-pipeline` | `{audit_id, start_from?, stop_after?}` | `{ok, status}` |
| `scout-config` | `write_config` | `/scout-config` | `{domain, config}` | `{ok}` |
| `scout-config` | `trigger_scout` | `/trigger-pipeline` | `{domain}` | `{ok}` or `{status:'pipeline_already_running'}` |
| `scout-config` | `read_report` | `/scout-report` | `{domain}` | `{markdown, scope, date, narrative}` |
| `scout-config` | `generate_share_token` | (Supabase-only) | `{prospect_id}` | `{token, share_url, domain, name}` |
| `scout-config` | `get_share_report` | (Supabase-only, **no auth**) | `{token}` | `{prospect, markdown, scope, narrative}` |
| `pipeline-controls` | `recanonicalize` | `/recanonicalize` | `{domain, email}` | `{ok}` |
| `pipeline-controls` | `track_rankings` | `/track-rankings` | `{domain, email, force: true}` | `{ok}` |
| `pipeline-controls` | `track_gsc` | `/track-gsc` | `{domain, email}` | `{ok}` |
| `pipeline-controls` | `track_llm_mentions` | `/track-llm-mentions` | `{domain, email}` | `{ok}` |
| `pipeline-controls` | `lookup_keywords` | `/lookup-keywords` | `{keywords[], location_codes?, audit_id?}` | `{results[], total, found, estimated_cost}` |
| `pipeline-controls` | `ai_visibility_analysis` | `/ai-visibility-analysis` | `{domain, email, audit_id, keywords?, competitor_domains?}` | Full analysis result JSON |
| `pipeline-controls` | `rerun_pipeline` | `/trigger-pipeline` | `{domain, email}` | `{ok}` |
| `pipeline-controls` | `resume_pipeline` | `/trigger-pipeline` | `{domain, email, annotations?, audit_id}` | `{success, start_from:'1b'}` |
| `pipeline-controls` | `read_strategy_brief` | `/strategy-brief` | `{domain}` | `{content, date}` or 404 |
| `pipeline-controls` | `generate_prospect_brief` | `/generate-prospect-brief` | `{domain}` | `{ok}` |
| `pipeline-controls` | `generate_client_brief` | `/generate-client-brief` | `{domain, email}` | `{ok}` |
| `pipeline-controls` | `read_client_brief` | `/artifact` | `{domain, file:'reports/client_brief.html'}` | `{content}` or 404 |
| `pipeline-controls` | `generate_brief` | `/generate-brief` | `{domain, email}` | `{status:'brief_generation_started'}` |
| `pipeline-controls` | `generate_content` | `/generate-content` | `{domain, email}` | `{status:'content_generation_started'}` |
| `cluster-action` | `activate` | `/activate-cluster` | `{audit_id, canonical_key, target_publish_date?, notes?}` | cluster status |
| `cluster-action` | `deactivate` | `/deactivate-cluster` | `{audit_id, canonical_key}` | cluster status |
| `share-audit` | `status/create/revoke/verify` | (Supabase-only) | varies | varies |
| `manage-users` | `list` | (Supabase-only) | `{action:'list'}` | `{users[]}` |
| `export-audit` | (default) | `/export-audit` | `{domain}` | Binary ZIP stream |
| `run-competitor-dominance` | (default) | (Supabase-only) | `{audit_id}` | rebuilt view |

**Auth patterns**:
- `validateSuperAdmin`: JWT → `has_role('super_admin')` — used by `pipeline-controls`, `scout-config` (except `get_share_report`), `manage-users`
- `resolveAuthContext`: JWT → user lookup + audit ownership check — used by `cluster-action`, `share-audit`

**Retry**: `run-audit` and `pipeline-controls` call the pipeline server via `_shared/retry.ts` `fetchWithRetry` — retries on network throw or 5xx with backoff delays [1s, 4s, 16s]; never retries `< 500` (409 passes through). After exhausting retries, the last 5xx Response is returned (not thrown) so callers keep status-based handling.

---

## RPC Functions

| Function | Parameters | Returns | Used By |
|----------|-----------|---------|---------|
| `has_role` | `{_user_id, _role}` | `boolean` | AuthContext (role check loop), edge function auth |
| `find_similar_embeddings` | `{query_embedding, match_content_type, match_model_version, match_threshold, match_limit, exclude_content_id?}` | `TABLE(content_id, similarity, text_input)` | Hybrid canonicalize centroid matching (Migration 015) |

---

## Disk Artifacts (Pipeline Only)

These files live on the pipeline server disk and are NOT in Supabase. They feed downstream phases and are served via the `/artifact` and `/scout-report` endpoints.

| Path | Phase | Contents |
|------|-------|----------|
| `audits/{domain}/scout/{date}/scope.json` | Scout | Topics, locales, services, gap_summary (with cpc_inferred on opportunities), max_topic_cpc |
| `audits/{domain}/scout/{date}/prospect-narrative.md` | Scout | Plain-language outreach document |
| `audits/{domain}/auditor/{date}/AUDIT_REPORT.md` | Dwight | Full technical audit |
| `audits/{domain}/auditor/{date}/internal_all.csv` | Dwight | Crawl data (all internal URLs) |
| `audits/{domain}/auditor/{date}/*.csv` | Dwight | Supplementary crawl exports |
| `audits/{domain}/research/{date}/gsc_data.json` | Phase 1c | GSC page data + zero-click queries + date range |
| `audits/{domain}/research/{date}/gsc_summary.md` | Phase 1c | GSC performance summary (markdown, injected into Strategy Brief) |
| `audits/{domain}/research/{date}/strategy_brief.md` | Phase 1b | Strategic framing (4 sections) |
| `audits/{domain}/research/{date}/keyword_research_matrix.json` | Phase 2 | Service × city × intent matrix |
| `audits/{domain}/research/{date}/ranked_keywords.json` | Jim | DataForSEO ranked keywords (geo-qualified volumes when `geo_mode != 'national'`) |
| `audits/{domain}/research/{date}/ranked_keywords.national.json` | Jim | Original national volumes backup (only created when geo-qualifying Mode A) |
| `audits/{domain}/research/{date}/llm_mentions.json` | Jim | AI platform mention data (domain + competitor mentions) |
| `audits/{domain}/research/{date}/ai_visibility_data.json` | AI Visibility | Full structured analysis result (per-keyword mentions, competitor summary, costs) |
| `audits/{domain}/research/{date}/ai_visibility_report.md` | AI Visibility | SOW 2.5 deliverable: executive summary, citation tables, structural gaps, recommendations |
| `audits/{domain}/research/{date}/research_summary.md` | Jim | 10-11 section research narrative (Section 11 conditional: AI Visibility) |
| `audits/{domain}/research/{date}/content_gap_analysis.md` | Gap | Authority + format gaps |
| `audits/{domain}/research/{date}/coverage_validation.md` | Validator | Gap vs blueprint cross-check |
| `audits/{domain}/architecture/{date}/architecture_blueprint.md` | Michael | Silo structure + page plan |
| `audits/{domain}/content/{date}/{slug}/metadata.md` | Pam | Page metadata |
| `audits/{domain}/content/{date}/{slug}/outline.md` | Pam | Content outline |
| `audits/{domain}/content/{date}/{slug}/schema.json` | Pam | JSON-LD schema |
| `audits/{domain}/content/{date}/{slug}/page.html` | Oscar | Production HTML |

---

## Column Name Mismatches (Pipeline vs Dashboard)

Known cases where pipeline writes and dashboard reads use different column names or shapes:

| Table | Pipeline Writes | Dashboard Reads | Resolution |
|-------|----------------|-----------------|------------|
| `gbp_snapshots` | `listing_found` | `gbp_missing` | Dashboard inverts boolean |
| `gbp_snapshots` | `claimed_status` | `is_claimed` | Dashboard maps string→boolean |
| `gbp_snapshots` | `canonical_nap` (object) | `canonical_name/address/phone` (separate cols) | Dashboard destructures |
| `audit_keywords` | `delta_revenue_mid` | (computed client-side) | Dashboard recalculates in `useAssumptionsPreview` |

---

## Polling Contracts

| Hook | Table/Edge Fn | Interval | Condition |
|------|--------------|----------|-----------|
| `useAuditStatus` | `audits` | 2s | While `status = 'running'` |
| `usePipelineRun` | `pipeline_runs` | 2s | While `status = 'running'` |
| `useProspectStatus` | `prospects` | 2s | While `status = 'running'` |
| `usePamRequests` | `pam_requests` | 3s | While `status = 'pending'/'processing'` |
| `useOscarRequests` | `oscar_requests` | 3s | While `status = 'pending'/'processing'` |
| `useClusterStrategyPoll` | `cluster_strategy` | 5s | For 90s while generating |
| `useCompetitorDominance` | `audit_topic_dominance` | 3s | For 90s while empty |

---

## Startup Reconciliation

The pipeline server runs `reconcileOrphanedJobs()` on startup (60s delay, then every 5 minutes) to reset records left in transient states by interrupted processes (e.g., Railway deploys killing containers).

| Table | Condition | Reset to | Guard |
|-------|-----------|----------|-------|
| `audits` | `status = 'running'` | `status = 'failed'`, `error_message` set | Skip if `inFlight.has(domain)` |
| `pipeline_runs` | `status = 'running'` | `status = 'failed'`, `error_message` = "Pipeline interrupted (server restart ...)", `completed_at` set | Skip if `inFlight.has(domain)` |
| `prospects` | `status = 'running'` | `status = 'failed'` | Skip if `inFlight.has(domain)` |
| `pam_requests` | `status = 'processing'` AND `requested_at < now() - 10min` | `status = 'failed'`, `error_message` set | Time threshold only |
| `oscar_requests` | `status = 'processing'` AND `requested_at < now() - 10min` | `status = 'failed'`, `error_message` set | Time threshold only |

**Not reconciled**: `execution_pages` — Oscar writes status + content as a single update after generation completes. If killed mid-generation, execution_pages stays at its prior status. The orphaned record is `oscar_requests`.

**SIGTERM handling**: Server registers handlers for SIGTERM/SIGINT. On signal: stops accepting connections, clears reconciliation interval, exits with code 0 (or force-exits after 30s safety timeout). Does NOT attempt to signal or wait for detached child processes — Railway SIGKILLs the container after the drain period.

**Shell trap**: `run-pipeline.sh` traps ERR/TERM/INT to call `pipeline_fail` (= `update_status failed` + `pipeline-progress.ts fail`) before exiting, so pipelines that fail or receive a signal during the drain window mark both `audits` and `pipeline_runs` as failed in Supabase. Requires `set -o errtrace` (set in the script) for the ERR trap to fire inside functions.

**Watchdogs**: every server spawn site arms a watchdog (`PIPELINE_RUN_TIMEOUT_MS` 3h for `/trigger-pipeline`, `PIPELINE_JOB_TIMEOUT_MS` 30 min for other jobs) that SIGTERMs the child's process group on expiry. The `/trigger-pipeline` watchdog additionally flips the latest `pipeline_runs` row `running`→`timed_out` and the audit →`failed` if the shell trap didn't get there first.
