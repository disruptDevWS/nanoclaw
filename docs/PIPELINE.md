# Audit Pipeline — Complete Reference

> **This is a contract.** Every phase declares what it reads, what it writes, and what must exist before it runs. When a phase's responsibility changes, update this file in the same commit. See also: `docs/DECISIONS.md` for the "why" behind non-obvious choices.

Orchestrator: `./scripts/run-pipeline.sh <domain> <email> [seed_matrix.json] [competitor_urls] [--mode sales|full|prospect] [--prospect-config <path>]`

Trigger paths:
- **New audit:** Dashboard `useCreateAudit` → `run-audit` Edge Function → HTTP POST to Forge OS pipeline server → `run-pipeline.sh`
- **Prospect conversion:** Dashboard `useConvertProspect` → creates audit + assumptions → `run-audit` Edge Function → same pipeline path
- **Scout:** Dashboard Scout UI → `scout-config` Edge Function → Forge OS pipeline server (`/scout-config` + `/trigger-pipeline` with `--mode prospect`)
- **Re-canonicalize:** Settings page → `pipeline-controls` Edge Function → `/recanonicalize` → `run-canonicalize.ts` (Phase 3c+3d only)
- **Refresh rankings:** Settings page → `pipeline-controls` Edge Function → `/track-rankings` → `track-rankings.ts`
- **Refresh GSC data:** Settings page → `pipeline-controls` Edge Function → `/track-gsc` → `track-gsc.ts`
- **Track AI visibility:** Settings page → `pipeline-controls` Edge Function → `/track-llm-mentions` → `track-llm-mentions.ts`
- **AI visibility analysis:** Settings page → `pipeline-controls` Edge Function → `/ai-visibility-analysis` → `ai-visibility-analysis.ts`
- **Keyword lookup:** Keyword Lookup page → `pipeline-controls` Edge Function → `/lookup-keywords` → `lookupKeywordVolumes()` → `keyword_lookups` table
- **Re-run pipeline:** Settings page → `run-audit` Edge Function → `/trigger-pipeline` → `run-pipeline.sh`
- **Cluster activation:** Clusters page → `cluster-action` Edge Function → `/activate-cluster` → `generate-cluster-strategy.ts`
- **Export audit:** Settings page → `export-audit` Edge Function → `/export-audit` → ZIP stream of all `audits/{domain}/` artifacts
- **Prospect brief:** Auto after Scout (prospect mode) or on-demand → `pipeline-controls` Edge Function → `/generate-prospect-brief` → `generate-prospect-brief.ts`
- **Client brief:** Auto after Phase 6d (full/sales pipeline) or on-demand → `pipeline-controls` Edge Function → `/generate-client-brief` → `generate-client-brief.ts`

Edge Functions (deployed from [Lovable repo](https://github.com/disruptDevWS/market-position-audit-lovable)):
- `run-audit` — validates audit, marks `running`, POSTs to `/trigger-pipeline`
- `scout-config` — writes prospect config to disk, triggers scout, reads reports via `/scout-report` (auth: `validateSuperAdmin` + `has_role`)
- `cluster-action` — proxies `/activate-cluster` and `/deactivate-cluster` (auth: `resolveAuthContext` + ownership check)
- `pipeline-controls` — proxies `/recanonicalize`, `/track-rankings`, `/track-gsc`, `/track-llm-mentions`, `/ai-visibility-analysis`, `/lookup-keywords`, `/generate-prospect-brief`, and `/generate-client-brief` (auth: `validateSuperAdmin` + `has_role`)
- `export-audit` — streams ZIP of all pipeline artifacts for a domain (auth: `validateSuperAdmin` + `has_role`)

Core scripts:
- `scripts/pipeline-generate.ts` — agent generation logic
- `scripts/sync-to-dashboard.ts` — Supabase sync logic
- `scripts/foundational_scout.sh` — DataForSEO CLI wrapper

## Canonicalize Infrastructure

Canonicalize uses hybrid mode (vector pre-clustering + Sonnet arbitration) for all audits. Legacy Sonnet-only mode was removed in Session 1 cleanup (2026-05-29).

**Key components:**
- Embedding service: `src/embeddings/` — OpenAI `text-embedding-3-small` (1536 dims) with Supabase caching via pgvector
- Hybrid module: `src/agents/canonicalize/hybrid/` — pre-cluster + arbitrate + persist
- Migrations 016-018: pgvector RPC enhancement, classification metadata, shadow columns

**Historical documentation:**
- `docs/canonicalize-hybrid-rollout.md` — original rollout checklist (Phases 2.1-2.4)
- `docs/phase-2.3b-sma-promotion-2026-04-20.md` — SMA promotion report
- `docs/phase-2.3c-lock-determinism-fix-2026-04-20.md` — contamination bug fix
- `docs/phase-2.4-ima-promotion-2026-04-20.md` — IMA promotion report
- `docs/architectural-review-post-phase-2-2026-04-21.md` — system-wide architectural audit

## Prerequisites (must exist before pipeline starts)

| Table | Created By | Required Fields |
|-------|-----------|----------------|
| `audits` | Dashboard `useCreateAudit` or `useConvertProspect` | domain, service_key, market_city, market_state, geo_mode, market_geos, user_id |
| `audit_assumptions` | Dashboard `useCreateAudit` or `useConvertProspect` (primary), `sync-to-dashboard.ts ensureAssumptions()` (fallback) | benchmark_id, ctr_model_id, cr_used_min/max/mid, acv_used_min/max/mid, target_ctr, near_miss_min/max_pos, min_volume |
| `benchmarks` | Seeded (one row per service vertical + 'other' fallback) | cr_min, cr_max, acv_min, acv_max |
| `ctr_models` | Seeded (one row with is_default=true) | buckets JSON |

The `run-audit` Edge Function writes **nothing** to keyword/cluster/rollup tables. It only marks the audit as `running` and fires the pipeline. All DataForSEO, keyword seeding, clustering, and revenue modeling happens inside the pipeline phases below.

---

## Data Flow Overview

```
Phase 0 (Scout) ← prospect mode only, exits after completion
  READS:     prospect-config.json (local file)
  PRODUCES:  scout-{domain}-{date}.md, scope.json, prospect-narrative.md
             Supabase → prospects (upsert)
      │
      ▼
Prospect Brief (auto after Scout, non-fatal)
  READS:     scope.json, prospect-narrative.md, ranked_keywords.json
  PRODUCES:  reports/prospect_brief.html (Sonnet narrative + data tables)
  SERVED:    /artifact endpoint (file=reports/prospect_brief.html)
      │
      ▼ (exits — full pipeline runs separately after conversion)

--- Prospect Conversion (Dashboard) ---
  useConvertProspect: prospect → audit INSERT (with geo_mode, market_geos)
                      + audit_assumptions INSERT + prospect status='converted'
                      → run-audit Edge Function → /trigger-pipeline
  scope.json persists on disk for Phase 2 (KeywordResearch reads it as optional priors)

Phase 1 (Dwight)
  PRODUCES:  internal_all.csv, AUDIT_REPORT.md, ~20 CSVs
             Copies internal_all.csv → architecture/
  NOTE:      Priority tables use POP framework (Group A/B/C/D → P1-3) with 5-column format
             including Severity Rationale. CWV is conditionally Group B (with ranking evidence)
             or Group C (without). Parser has backward-compat fallback for 4-column format.
      │
      ▼
Phase 1a (Verify Dwight)
  READS:     AUDIT_REPORT.md, internal_all.csv (for 3xx redirect list)
  CHECKS:    Sitemap existence (HEAD), Schema presence (GET+parse), Redirect chain integrity (follow 3xx)
  PRODUCES:  verification_results.json (structured corrections map)
             Annotates AUDIT_REPORT.md with verification section
      │
      ▼
Phase 1c (GSC Data Fetch)
  READS:     Supabase ← analytics_connections (gsc_property_id)
  EXTERNAL:  Google Search Console Search Analytics API (ADC + SA impersonation)
  PRODUCES:  Supabase → gsc_page_snapshots (per-URL clicks, impressions, CTR, position)
             Disk → research/{date}/gsc_summary.json (top pages + aggregate stats)
      │
      ▼
Phase 1b (Strategy Brief)
  READS:     AUDIT_REPORT.md (Dwight), scope.json + scout-report.md (Scout, optional),
             prospect-config.json → client_context (optional),
             Supabase ← client_profiles (optional), audits metadata
  PRODUCES:  strategy_brief.md (disk — research/{date}/)
             Supabase → agent_runs (agent_name='strategy_brief')
      │
      ▼ (review gate: if audits.review_gate_enabled=true AND mode=full,
         pipeline pauses with status='awaiting_review'. Resume via
         pipeline-controls edge function → start_from='2')
      │
      ▼
Phase 2 (KeywordResearch)
  READS:     AUDIT_REPORT.md (Dwight), internal_all.csv (Dwight, for service expansion),
             strategy_brief.md (Phase 1b, optional — keyword directive injected into synthesis),
             Supabase ← audits metadata,
             scope.json (Scout, optional — pre-seeds matrix with gap keywords),
             prospect-config.json → client_context.services (full mode, optional)
  PRODUCES:  keyword_research_summary.md, keyword_research_raw.json
             Supabase → audit_keywords (source='keyword_research', is_near_me)
             Supabase → audits.service_key (updated if auto-detected from 'other')
      │
      ▼
Phase 3 (Jim)
  READS:     internal_all.csv (Dwight), keyword_research_summary.md (KeywordResearch)
  PRODUCES:  ranked_keywords.json, competitors.json, research_summary.md
      │
      ▼
Phase 3b (sync jim)
  READS:     ranked_keywords.json, research_summary.md
  REQUIRES:  audit_assumptions (auto-created from benchmarks if missing)
  PRODUCES:  Supabase → audit_keywords (source='ranked', revenue fields populated)
             Supabase → audit_clusters, audit_rollups (preliminary — rebuilt in 3d)
      │
      ▼
Phase 3c (Canonicalize) — supports legacy and hybrid modes
  READS:     Supabase ← audit_keywords, audits (canonicalize_mode)
  PRODUCES:  Supabase → audit_keywords (canonical_key, canonical_topic, cluster,
             intent_type, is_brand, is_near_me, classification_method,
             similarity_score, canonicalize_mode)
  EXTERNAL:  OpenAI text-embedding-3-small
  POST-STEP: Clears is_near_miss for branded/navigational keywords
      │
      ▼
Phase 3d (Rebuild Clusters)
  READS:     Supabase ← audit_keywords (with canonical_key from 3c),
             audit_clusters (activation status preservation),
             cluster_strategy (deprecation of orphaned strategies)
  PRODUCES:  Supabase → audit_clusters (DELETE+INSERT with status preservation),
             audit_rollups (DELETE+INSERT),
             cluster_strategy (deprecated orphaned rows),
             execution_pages (cluster_active preserved/deactivated)
  WHY:       3b builds clusters before canonical_key exists; 3d rebuilds using
             canonical groupings so "ac repair boise" + "ac repair boise id" merge
      │
      ▼
Phase 4 (Competitors)                    ← skipped in sales mode
  READS:     Supabase ← audit_keywords (canonical_key, intent_type, is_brand)
  PRODUCES:  Supabase → audit_topic_competitors (+ representative_url), audit_topic_dominance
      │
      ▼
Phase 4b (Section Extraction)            ← skipped in sales mode
  READS:     Supabase ← audit_topic_competitors (representative_url),
             agent_technical_pages, execution_pages, audit_keywords (ranking_url)
  EXTERNAL:  DataForSEO /on_page/instant_pages (~$0.005/URL)
  PRODUCES:  Supabase → competitor_sections, cluster_section_coverage,
             audit_clusters (coverage_score, coverage_competitor_count)
      │
      ▼
Phase 4c (Coverage Density + Cannibalization) ← skipped in sales mode
  READS:     Supabase ← audit_clusters, audit_keywords (canonical_key, ranking_url),
             competitor_sections (from 4b); disk internal_all.csv (primary)
             or agent_technical_pages (fallback)
  EXTERNAL:  OpenAI embeddings (cached in embeddings table — near-zero cost)
  PRODUCES:  Supabase → audit_clusters (density_score, competitor_density_score,
             density_updated_at), cannibalization_warnings (DELETE+INSERT)
      │
      ▼
Phase 5 (Gap)                            ← skipped in sales mode
  READS:     Supabase ← audit_topic_competitors, audit_topic_dominance,
             audit_keywords, audit_clusters, agent_architecture_pages,
             cluster_section_coverage (from Phase 4b),
             audit_clusters density columns + cannibalization_warnings (from 4c)
  PRODUCES:  content_gap_analysis.md + Supabase → audit_snapshots
      │
      ▼
Phase 6 (Michael)
  READS:     research_summary.md (Jim), ranked_keywords.json (Jim),
             content_gap_analysis.md (Gap), internal_all.csv (Dwight),
             AUDIT_REPORT.md (Dwight, platform section),
             Supabase ← audit_clusters, audit_assumptions, audit_rollups,
             prospect-config.json → client_context (full mode, optional)
  PRODUCES:  architecture_blueprint.md (+ ## Revenue Opportunity in sales mode)
      │
      ▼
Phase 6b (sync michael)
  READS:     architecture_blueprint.md
  PRODUCES:  Supabase → agent_architecture_pages, agent_architecture_blueprint,
             execution_pages, audit_keywords (cluster backfill)
      │
      ▼
Phase 6c (sync dwight)
  READS:     internal_all.csv, AUDIT_REPORT.md
  PRODUCES:  Supabase → agent_technical_pages, audit_snapshots
      │
      ▼
Phase 6d (Local Presence)
  READS:     Supabase ← audits (business_name, market_city, market_state),
             client_profiles (canonical NAP fallback)
  PRODUCES:  Supabase → gbp_snapshots, citation_snapshots (11 directories)
  EXTERNAL:  DataForSEO Business Data (GBP lookup), DataForSEO SERP (citation scan)
      │
      ▼
Client Brief (auto after Phase 6d, non-fatal)
  READS:     AUDIT_REPORT.md, research_summary.md, architecture_blueprint.md,
             strategy_brief.md (disk) + Supabase ← audit_rollups, audit_clusters,
             gbp_snapshots, citation_snapshots
  PRODUCES:  reports/client_brief.html (Sonnet narrative + data tables)
  SERVED:    /artifact endpoint (file=reports/client_brief.html)
```

---

## Phase Details

### Phase 0: Scout — Prospect Discovery (prospect mode only)

**Function:** `runScout()` | **Models:** Claude Haiku (topic extraction) + Claude Sonnet (report generation)

**Invocation:** `npx tsx scripts/pipeline-generate.ts scout --domain <domain> --prospect-config <path>` or via `run-pipeline.sh --mode prospect --prospect-config <path>`

**Prerequisites:** `prospect-config.json` file with `name`, `domain`, `target_geos`, `topic_patterns`, `state`. No audit record required — uses `prospects` table instead.

**Steps:**
1. **Topic extraction** — Haiku extracts 5–15 canonical topics from ranked keywords + topic patterns. No crawl — Dwight handles comprehensive crawling in Phase 1 if the prospect converts.
2. **Current rankings** — DataForSEO `ranked_keywords/live` for the domain. Falls back to `buildSyntheticRankedKeywords()` if <50 results. For multi-state prospects, ranked keyword volumes are geo-qualified via per-state `search_volume/live` calls (volumes summed across target states). Low-presence domains (<50 rankings) get expanded synthetic candidates with intent modifiers (`best`, `cost`, `services`, `near me`) and raised cap (500 vs 200).
3. **Opportunity map** — DataForSEO bulk volume for `topic × geo` candidates. Uses geo-qualified location codes when target_geos contains state data. Low-presence domains get expanded cross-product with intent modifiers and `topic_patterns × metros` injection.
4. **Deduplication** — Near-variant keywords collapsed via `buildCanonicalKey()` (suffix-only state stripping, alphabetical sort). Applied to ranked keywords and opportunity map before gap matrix assembly.
5. **Gap matrix** — Cross-references rankings vs opportunity: defending (1–10), weak (11–30), gap (not ranking). CPC backfill: $0 CPC entries filled from same-topic max, marked `cpc_inferred: true`. Inferred values shown with tilde prefix (`~$X`) in report tables.
6. **Report + scope.json** — Sonnet generates scout report (7 sections); scope.json is Jim-compatible seed data with `cpc_inferred` on opportunities and `max_topic_cpc` at root.
7. **Prospect narrative** — Sonnet generates 3-section outreach document. Prompt includes `topicMaxCpc` revenue context, CPC revenue translation instruction, and competitive framing instruction.

**External APIs:**

| API | Endpoint | Purpose |
|-----|----------|---------|
| DataForSEO Ranked Keywords | `/v3/dataforseo_labs/google/ranked_keywords/live` | Current organic rankings |
| DataForSEO Bulk Volume | `/v3/keywords_data/google_ads/search_volume/live` | Opportunity map volume |
| Anthropic API (haiku) | `callClaude()` | Topic extraction |
| Anthropic API (sonnet) | `callClaude()` | Scout report generation |

**Budget:** `SCOUT_SESSION_BUDGET` env var (default $2.00). Each API call checks remaining budget before proceeding.

**Output files** (relative to `audits/{domain}/`):
- `scout/{date}/scout-{domain}-{date}.md` — Full scout report (7 sections)
- `scout/{date}/scope.json` — Jim-compatible seed matrix
- `scout/{date}/prospect-narrative.md` — Plain-language outreach document (3 sections: Where You're Winning, Where Demand Is Escaping You, What a Full Analysis Would Reveal). Generated via Sonnet after the scout report. Non-fatal — Scout succeeds even if narrative generation fails.

**Supabase writes:** `prospects` (INSERT or UPDATE status/scout_run_at/scout_output_path)

**Important:** Scout exits after completion. The full pipeline (Phases 1–6c) runs separately after the prospect converts to a client.

### Prospect Intelligence Brief (auto after Scout)

**Script:** `scripts/generate-prospect-brief.ts` | **Model:** Claude Sonnet (narrative sections)

**Invocation:** Runs automatically after Scout completes in prospect mode (non-fatal). Also available on-demand via `/generate-prospect-brief` endpoint or `pipeline-controls` edge function action `generate_prospect_brief`.

**Reads:**
- `scout/{date}/scope.json` — gap summary, topics, locales, opportunity volume
- `scout/{date}/prospect-narrative.md` — existing narrative (optional, for tone reference)
- `research/{date}/ranked_keywords.json` — current rankings (optional)

**Produces:**
- `reports/prospect_brief.html` — Self-contained HTML intelligence brief matching Forge Growth design system

**Approach:** Structured sections (score cards, keyword tables, gap grids, topic coverage) are data-injected directly from scope.json. Three narrative sections (executive summary, opportunity analysis, next steps) generated via a single Sonnet call (~$0.06). Template uses the same CSS design system as the SMA/IMA static briefs (Oswald/Inter/JetBrains Mono, --bone/--charcoal/--orange vars).

**Serving:** Via existing `/artifact` endpoint: `POST /artifact { domain, file: "reports/prospect_brief.html" }`. Accessible through the dashboard's existing artifact serving mechanism.

### Client Intelligence Brief (auto after Phase 6d)

**Script:** `scripts/generate-client-brief.ts` | **Model:** Claude Sonnet (narrative sections)

**Invocation:** Runs automatically after Phase 6d completes in full/sales pipeline mode (non-fatal). Also available on-demand via `/generate-client-brief` endpoint or `pipeline-controls` edge function action `generate_client_brief`.

**Reads (disk):**
- `auditor/{date}/AUDIT_REPORT.md` — technical crawl findings
- `research/{date}/research_summary.md` — keyword research narrative
- `architecture/{date}/architecture_blueprint.md` — site architecture plan
- `research/{date}/strategy_brief.md` — strategic framing

**Reads (Supabase):**
- `audit_rollups` — revenue model (total volume, weighted revenue, keyword count)
- `audit_clusters` — top 15 clusters by weighted revenue (canonical_key, keyword_count, total_volume, weighted_revenue)
- `gbp_snapshots` — GBP listing data (claimed status, rating, reviews, canonical NAP)
- `citation_snapshots` — per-directory presence and NAP match status

**Produces:**
- `reports/client_brief.html` — Self-contained HTML intelligence brief (7 sections)

**Approach:** Seven HTML sections: Executive Summary (score cards + Sonnet prose), Technical Health (Sonnet prose), Revenue Opportunity (3-tier revenue cards + cluster table + Sonnet prose), Topic Cluster Breakdown (data-injected table), Architecture Recommendations (Sonnet prose), Local Presence (GBP cards + citation grid + Sonnet prose), Next Steps (Sonnet prose). Single Sonnet call (~$0.06-0.10) for 6 narrative sections using sentinel-delimited output. Same CSS design system as prospect brief.

**Serving:** Via existing `/artifact` endpoint: `POST /artifact { domain, file: "reports/client_brief.html" }`.

---

### Phase 1: Dwight — Technical Crawl + Audit Report

**Function:** `runDwight()` | **Model:** Anthropic API Sonnet

**External APIs:**

| Tool | Details |
|------|---------|
| DataForSEO OnPage API | `scripts/dataforseo-onpage.ts`: createOnPageTask → pollTaskReady → getPages/getSummary/getMicrodata/getResources. JS rendering enabled. |
| Anthropic API (sonnet) | Generates AUDIT_REPORT.md from crawl CSVs. `internal_all.csv` filtered to 32 key columns before prompting. |

**QA Gate:** After Dwight completes, `runQA(phase='dwight')` evaluates AUDIT_REPORT.md. On ENHANCE, re-runs Dwight. On persistent FAIL, pipeline halts.

**Output files** (relative to `audits/{domain}/`):
- `auditor/{date}/internal_all.csv` + supplementary CSVs (from `onpage-to-csv.ts`)
- `auditor/{date}/AUDIT_REPORT.md` (11 sections + prioritized fix list)
- **Copies to `architecture/{date}/`:** `internal_all.csv`

**Key detail:** `internal_all.csv` is filtered from ~75 columns to 32 SEO-relevant columns (`INTERNAL_ALL_KEEP_COLUMNS`) before being included in the prompt. This reduces the file from ~1.3MB to ~20KB and prevents "Prompt too long" errors.

**Prompt framing:** Uses "YOUR ENTIRE RESPONSE IS THE REPORT" top/bottom framing to prevent narration. `validateArtifact()` enforces ≥5000 byte minimum and checks for conversational patterns.

**Supabase writes:** `agent_runs`, `audit_snapshots` (agent='dwight')

---

### Phase 1a: Verify Dwight — HTTP Checks

**Script:** `scripts/verify-dwight.ts` | **Model:** None (pure HTTP)

**Purpose:** DataForSEO's OnPage API has documented gaps that cause Dwight to report false negatives on sitemap detection, schema/structured data detection, and redirect chain resolution. This phase independently verifies those findings with direct HTTP checks before downstream phases consume AUDIT_REPORT.md.

**Checks:**
- **Check A — Sitemap existence:** HEAD requests to `/sitemap.xml` and `/sitemap_index.xml` (both `www` and non-`www`). If sitemap found but Dwight flagged as missing → correction.
- **Check B — Schema presence:** GET homepage, parse for `<script type="application/ld+json">` and Yoast schema graph. Extracts `@type` values from JSON-LD blocks. If schema found but Dwight flagged as absent → correction.
- **Check C — Redirect chain integrity:** Reads `internal_all.csv` for 3xx entries with empty `Redirect URL` column. Follows each redirect chain (manual redirect mode, max 10 hops, max 50 URLs) and records terminal URL, status, and chain health.
- **Check D — Robots.txt verification:** GET `/robots.txt` (both `www` and non-`www`). Parses `User-agent` / `Disallow` directives. Checks for broad blocking (`Disallow: /`) against `*`, `Googlebot`, `GPTBot`, `ClaudeBot`, `Bytespider`, `ChatGPT-User`, `Google-Extended`, `CCBot`, `Anthropic-AI`. If Dwight flagged robots.txt blocking but no broad Disallow rules confirmed → false_positive with fetched content as evidence. If confirmed, keeps the issue and reports which user-agents are affected.

**Outputs:**
- `verification_results.json` — structured corrections map (keyed by issue pattern match). Consumed by `syncDwight()` at Phase 6c for merging into `prioritized_fixes[]` objects.
- Appends a `## Post-Dwight Verification (Phase 1a)` section to `AUDIT_REPORT.md` (cosmetic annotation for disk artifact accuracy — not machine-parsed).

**Correction flow:** Corrections are NOT applied by modifying `parseAuditReport()`. Instead, `syncDwight()` loads `verification_results.json` after parsing and merges corrections into fix objects before writing to `audit_snapshots`. Each fix object gets `status` ('flagged' | 'false_positive'), `original_severity` (baseline for re-verification), `verified_at`, `verification_source`, and `verification_note`.

**Idempotency:** Skips if `AUDIT_REPORT.md` already contains the verification section header.

**Cost:** $0 (HTTP only, no LLM calls). Runtime: ~2-5 seconds.

---

### Phase 1c: GSC Data Fetch

**Script:** `scripts/fetch-gsc-data.ts` | **Model:** None (pure HTTP)

**Purpose:** Fetches Google Search Console Search Analytics data for the audit domain. Provides real click/impression/CTR/position data per URL to enrich Strategy Brief (Phase 1b), Jim (Phase 3), and Pam (OPTIMIZE briefs).

**Prerequisites:** `analytics_connections` row with `gsc_property_id` for the audit. If no connection exists, phase skips silently (non-fatal).

**Steps:**
1. Look up `analytics_connections` for the audit's `gsc_property_id`
2. Authenticate via ADC + impersonation of `fg-analytics@` service account (custom OAuth client → IAM generateAccessToken)
3. Fetch Search Analytics data (last 90 days, per-URL aggregation)
4. Write `gsc_page_snapshots` to Supabase (per-URL clicks, impressions, CTR, avg position)
5. Write `gsc_summary.json` to disk for downstream phases

**Downstream consumption:**
- **Phase 1b (Strategy Brief):** GSC summary injected as real performance data
- **Phase 3 (Jim):** GSC context block enriches research narrative
- **Pam (OPTIMIZE):** Per-URL GSC data injected into brief for pages being optimized

**Cost:** $0 (Google API, no per-call charges). Runtime: ~2-5 seconds.

**Graceful degradation:** No `analytics_connections` row or no `gsc_property_id` → skip. API error → log warning, continue pipeline.

---

### Phase 1b: Strategy Brief

**Script:** `scripts/strategy-brief.ts` | **Model:** Claude Sonnet

**Steps:**
1. **Gather** — Loads AUDIT_REPORT.md (cross-date fallback), scope.json + scout markdown (optional), client_context from prospect-config.json (optional), client_profiles from Supabase (optional), audit metadata (geo_mode, market_geos, service_key)
2. **Synthesize** — Single Sonnet call produces `strategy_brief.md` with four sections: Visibility Posture, Entity Authority Directive, Architecture Directive, Risk Flags
3. **Write** — Brief saved to `audits/{domain}/research/{date}/strategy_brief.md`

**Downstream consumption:**
- **Phase 2 (KeywordResearch):** Entity Authority Directive section injected into the Sonnet synthesis prompt (not the Haiku extraction prompt)
- **Phase 6 (Michael):** Architecture Directive + Risk Flags + Entity Authority Directive sections injected (Visibility Posture dropped — framing, not actionable for architecture)
- **Pam (content briefs):** Visibility Posture + Architecture Directive sections injected alongside market context

**Cost:** ~$0.06 (Sonnet, ~14K tokens)

**Graceful degradation:** Runs with whatever inputs exist. No AUDIT_REPORT.md + no scope.json = skip. Missing Scout = posture based on Dwight crawl only. Missing client_context = technical-only framing.

**Supabase writes:** `agent_runs` (agent_name='strategy_brief')

#### Review Gate (opt-in)

**Trigger condition:** `audits.review_gate_enabled = true` AND `mode = full`. Checked by `run-pipeline.sh` after Phase 1b via `update-pipeline-status.ts check-review-gate`.

**What happens when it fires:**
1. Pipeline sets `audits.status = 'awaiting_review'` and **exits** (`exit 0` in `run-pipeline.sh:240`). The shell process terminates — this is not a pause/sleep, it is a full stop. Phases 2–6d do not run.
2. The pipeline server's in-flight tracker clears the domain (the child process exited cleanly).
3. The audit sits in `awaiting_review` status indefinitely until manually resumed.

**How to resume:**
- **Dashboard UI:** The Settings page shows a "Review & Resume" panel when `status = 'awaiting_review'`. User can read `strategy_brief.md`, add annotations, and click Resume.
- **Edge function:** `pipeline-controls` with `action: 'resume_pipeline'`, `domain`, `email`, and optional `annotations`. The edge function appends annotations to `client_context.out_of_scope`, then POSTs to `/trigger-pipeline` with `start_from: '2'`.
- **Direct API:** POST `/trigger-pipeline` with `{"domain": "...", "email": "...", "start_from": "2"}`. Must use `start_from: '2'` (not `'1b'`) — resuming from `'1b'` causes an infinite loop because Phase 1b re-runs, hits the gate again, and exits.

**Operational implications for programmatic re-runs:**
- A full pipeline trigger (`/trigger-pipeline` without `start_from`) on a review-gate-enabled audit will **always pause** after Phase 1b. Phases 2–6d will not execute until a separate resume call is made.
- `/recanonicalize` is unaffected (runs only Phase 3c+3d, never touches Phase 1b).
- A re-run with `start_from: '2'` bypasses the gate entirely (Phase 1b is skipped).
- The gate only fires in `full` mode. Sales mode (`--mode sales`) skips the gate check.

**Currently enabled audits (2026-04-22):**

| Domain | Audit ID | Intentional? |
|--------|----------|-------------|
| forgegrowth.ai | `d1a9b155-...` | Yes — operator's own site, wants strategy review before full run |
| ecohvacboise.com | `b905e208-...` | Yes — demo client, manual review preferred |

**To disable:** `UPDATE audits SET review_gate_enabled = false WHERE id = '<audit_id>'` or toggle via Settings page.

---

### Phase 2: KeywordResearch — Service × City × Intent Matrix

**Function:** `runKeywordResearch()` | **Model:** Claude Haiku (extraction, async) + Claude Sonnet (synthesis, async)

**Steps:**
1. **Extract** — Haiku reads Dwight's AUDIT_REPORT.md, extracts services, locations, and platform. Prompt asks for sub-services from navigation, titles, URL paths (not just top-level categories). If Scout's `scope.json` exists, scout priors are injected into the extraction prompt for validation against crawl data.
2. **Service expansion** — If `service_key` is 'other' (auto-created sales audits), `detectServiceKey()` auto-detects the vertical (Tier 1: seed matching, Tier 2: Haiku fallback) and updates the audit row. Then `expandServicesFromCrawl()` cross-references `SERVICE_KEYWORD_SEEDS[serviceKey]` against report content and CSV URLs to add sub-services with evidence in the crawl data.
3. **Client context** — If `prospect-config.json` has `client_context.services`, those are merged into the services list (full mode only).
4. **Matrix build** — Generates `service × city × intent` keyword candidates, capped at `MAX_KEYWORD_MATRIX_SIZE = 200`. If `scope.json` has gap keywords, they are pre-seeded at priority 0 (survive truncation).
5. **Volume validation** — DataForSEO bulk volume API filters zero-volume/zero-CPC keywords
6. **Synthesis** — Sonnet produces `keyword_research_summary.md` from validated matrix
7. **Seed Supabase** — Inserts validated keywords into `audit_keywords` with `source: 'keyword_research'` and `is_near_me` flags

**External APIs:**

| API | Endpoint | Purpose |
|-----|----------|---------|
| DataForSEO Bulk Volume | `/v3/keywords_data/google_ads/search_volume/live` | Volume/CPC for keyword matrix |
| Anthropic API (haiku) | `callClaude()` | Extract services + locations from AUDIT_REPORT.md |
| Anthropic API (sonnet) | `callClaude()` | Synthesize keyword_research_summary.md |

**Output files:**
- `research/{date}/keyword_research_raw.json`
- `research/{date}/keyword_research_summary.md`
- `research/{date}/keyword_research_meta.json` — services/locations/platform + `covered_services` + counts, consumed by the Phase 2 QA gate's service-coverage check

**Supabase writes:** `audit_keywords` (INSERT, source='keyword_research'), `agent_runs`, `embeddings` (UPSERT, cache pre-warm)

**QA Gate (deterministic):** After Phase 2, `runQA(phase='keyword-research')` checks (a) ≥1 keyword seeded into `audit_keywords` — catches the silent path where synthesis returns 0 opportunities even though validation succeeded, and (b) ≥25% of extracted services have a validated keyword. On FAIL, Phase 2 re-runs with `--qa-feedback`; a second FAIL halts the pipeline (upstream-critical — everything downstream depends on the keyword seed).

**Embed-at-ingestion:** After keyword seeding, calls `embedAuditKeywords()` from `scripts/embed-keywords.ts` to pre-warm the `embeddings` table cache. Non-fatal — failures are logged as warnings. Pre-warms Phase 3c canonicalize (cache hits instead of fresh OpenAI calls).

**Near-me detection:** Deterministic `keyword.toLowerCase().includes(' near me')` — not LLM-based.

---

### Phase 3: Jim — DataForSEO Research + Narrative

**Function:** `runJim()` | **Model:** Claude Sonnet (async)

**Upstream context from Dwight + KeywordResearch:**
- Reads `internal_all.csv` from Dwight's crawl — extracts service pages (URLs matching `/service|residential|commercial|what-we-do/`), location signals, and platform info
- Reads `keyword_research_summary.md` from KeywordResearch — injects as `## Keyword Opportunities` section
- Uses `resolveArtifactPath()` for cross-date resilience (if Dwight ran yesterday, Jim still finds the files)

**External APIs:**

| API | Endpoint | Purpose |
|-----|----------|---------|
| DataForSEO Ranked Keywords | `/v3/dataforseo_labs/google/ranked_keywords/live` | Current organic rankings for domain |
| DataForSEO Competitors | `/v3/dataforseo_labs/google/competitors_domain/live` | Competitor domain landscape |
| DataForSEO Bulk Volume | `/v3/keywords_data/google_ads/search_volume/live` | Volume for seed/supplementary keywords |
| DataForSEO LLM Mentions | `/v3/ai_optimization/llm_mentions/search/live` | Domain mentions in AI platforms (ChatGPT, Google AI) |
| DataForSEO LLM Mentions | `/v3/ai_optimization/llm_mentions/aggregated_metrics/live` | Competitor AI mention counts |
| Anthropic API (sonnet) | `callClaude()` | Generate research_summary.md narrative |

**LLM Mentions (conditional):** After ranked keywords and competitors are collected, `fetchAllLlmMentions()` queries DataForSEO for AI platform mentions. Top 5 keywords (by volume, rank ≤ 30, excluding brand/near-me) and top 3 non-aggregator competitors are selected. Results written to `research/{date}/llm_mentions.json`. An `## AI Visibility Data` block is injected into the narrative prompt with: per-keyword breakdown table (Google/ChatGPT mentions, AI search volume, top citation source per keyword), re-aggregated competitor totals (domain-level, not synthetic per-keyword), and data quality notes section (precision caveats, budget skip detection). Budget guard via `LLM_DOMAIN_BUDGET` / `LLM_COMPETITOR_BUDGET` env vars (legacy fallback: `LLM_MENTIONS_BUDGET`, default $1.00/$0.50) — non-fatal if exceeded. A conditional Section 11 (AI Visibility, 5 subsections: Mention Summary, Citation Source Analysis, Competitor Comparison, Structural Gap Analysis, Recommendations) is added to the research narrative output when data exists. Section 11.4 includes explicit cross-reference pointers directing Sonnet to compare citation sources against Site Inventory and ranked URLs for evidence-based structural gap reasoning.

**Aggregator filtering:** Before building the prompt, competitors are pre-filtered using `isAggregatorDomain()` (Yelp, HomeAdvisor, Angi, BBB, Thumbtack, social media, Wikipedia, Reddit, etc.). This prevents aggregator domains with massive ETV from dominating the competitor table and misleading analysis.

**Client context:** If `prospect-config.json` has `client_context`, a `## Client Business Context` block is injected into the prompt (full mode only). Includes business model, target audience, core services, and out-of-scope reasoning constraints.

**Modes:**
- **Mode A (default):** Calls ranked-keywords + competitors for the domain. If <50 keywords returned, auto-supplements from `SERVICE_KEYWORD_SEEDS[service_key] × market_city locales` via bulk volume API. For geo-qualified audits (`geo_mode != 'national'`), after all ranked keywords are collected, a separate geo-qualified `search_volume/live` call replaces national volumes with state-level sums. Original national data is backed up to `ranked_keywords.national.json`.
- **Mode B (seed matrix):** Generates keyword candidates from `services[] × locales[]` cross-product, fetches bulk volume (geo-qualified if applicable), builds synthetic ranked_keywords.json with rank_group=100.

**Geo-qualified volume:** When `geo_mode` is `state`, `city`, or `metro`, `bulkKeywordVolume()` calls `search_volume/live` per service-area state and sums volumes. Rankings remain national (`ranked_keywords/live` uses `location_code: 2840`). City/metro modes use the parent state code (city-level codes return suppressed data). Unmatched keywords keep their national volume. Cost: +$0.075/state/task.

**Output files** (relative to `audits/{domain}/`):
- `research/{date}/ranked_keywords.json` (geo-qualified volumes when applicable)
- `research/{date}/ranked_keywords.national.json` (backup, Mode A only, geo-qualified audits only)
- `research/{date}/competitors.json`
- `research/{date}/llm_mentions.json` (AI platform mention data: domain_mentions, competitor_mentions, queried_keywords, total_cost)
- `research/{date}/research_summary.md` (10-11 sections: executive summary, keyword overview, position distribution, branded analysis, intent breakdown, top URLs, competitor deep dive, striking distance, content gaps, key takeaways, + conditional Section 11: AI Visibility. Includes a `json:insights` fenced block with content_gap_observations and key_takeaways as structured JSON.)
- `research/{date}/research_data.json` (deterministic numeric fields computed from raw DataForSEO JSON — keyword_overview, position_distribution, branded_split, intent_breakdown, top_ranking_urls, competitor_analysis, competitor_summary, striking_distance. Also contains ai_visibility data when LLM mentions are available, and content_gap_observations/key_takeaways backfilled from the `json:insights` block after Jim's LLM call completes.)

**Prompt framing:** Uses "YOUR ENTIRE RESPONSE IS THE REPORT" top/bottom framing. `validateArtifact()` enforces ≥3000 byte minimum. Prompt includes a `STRUCTURED INSIGHTS OUTPUT` section requiring Jim to emit a `json:insights` block.

**Supabase writes:** `agent_runs`, `audit_snapshots` (agent='jim'), `audits` (research_snapshot_at)

---

### Phase 3b: sync jim — Keywords to Supabase

**Function:** `syncJim()` in sync-to-dashboard.ts | **No external APIs**

**Reads:** `ranked_keywords.json`, `research_data.json` (preferred, deterministic), `research_summary.md` (fallback, regex-parsed)

**Data source priority:** Three-tier: (1) `research_data.json` for numeric fields → (1b) `json:insights` block from `research_summary.md` for narrative fields → (1c) regex fallback for narrative fields → (2) full regex parse of `research_summary.md` (backward compat for pre-`research_data.json` runs)

**Supabase reads:** `audit_assumptions` (CR/ACV rates), `ctr_models` (CTR by position)

**Precondition:** `audit_assumptions` must exist. `ensureAssumptions()` runs at the start of every sync and auto-creates from `benchmarks` defaults if missing.

**Supabase writes:**

| Table | Operation | Notes |
|-------|-----------|-------|
| `audit_keywords` | DELETE (where source ≠ 'keyword_research') + INSERT | Preserves KeywordResearch-seeded rows. New rows tagged `source: 'ranked'` |
| `audit_clusters` | DELETE + INSERT | Preliminary clusters from `extractTopic()` — rebuilt in Phase 3d |
| `audit_rollups` | DELETE + INSERT | Preliminary — rebuilt in Phase 3d |
| `audit_snapshots` | INSERT | 1 (parsed research sections) |
| `baseline_snapshots` | UPSERT | 1 (first sync only) |
| `llm_visibility_snapshots` | DELETE + INSERT | Client + competitor AI mention data (from `llm_mentions.json`, optional) |
| `llm_mention_details` | DELETE + INSERT | Qualitative mention texts and citation URLs (from `llm_mentions.json`, optional) |
| `audits` | UPDATE | status='completed', completed_at |

Each `audit_keywords` row includes revenue estimates: `delta_revenue_low/mid/high` computed from `delta_traffic × CR × ACV` at three tiers. Near-miss filter: `is_brand=false AND intent≠navigational AND pos in [min,max] AND vol≥min_volume`.

**Embed-at-ingestion:** After keyword INSERT, calls `embedAuditKeywords()` from `scripts/embed-keywords.ts` with `source=null` (all keywords — both `ranked` and `keyword_research`). This is the authoritative embedding pass; Phase 2's earlier pass pre-warmed `keyword_research` rows, and any cache hits from Phase 2 are reused here (zero duplicate OpenAI cost). Non-fatal — failures are logged as warnings.

**Important:** Clusters built here use raw `extractTopic()` (5-word truncation) because `canonical_key` doesn't exist yet. Phase 3d rebuilds clusters after canonicalize provides clean keys.

---

### Phase 3c: Canonicalize — Semantic Topic Grouping

**Function:** `runCanonicalize()` in `pipeline-generate.ts` | **Hybrid module:** `src/agents/canonicalize/hybrid/`

**Mode:** Hybrid only (legacy and shadow modes removed 2026-05-29). Three-stage pipeline: Stage 1 (classification extraction via Haiku + deterministic rules) + Stage 2 (vector pre-clustering via OpenAI embeddings) + Stage 3 (Sonnet arbitration for edge cases). Classification fields (`is_brand`, `intent_type`, `primary_entity_type`, `is_near_me`) handled by the classification extraction step; canonical grouping (`canonical_key`, `canonical_topic`, `cluster`) written exclusively by hybrid persist.

#### Hybrid canonicalize pipeline (`src/agents/canonicalize/hybrid/`)

**Stage 1 — Vector Pre-Clustering** (`hybrid/pre-cluster.ts`):
1. Collapse keyword variants by content hash (SHA-256 of normalized text)
2. Embed unique hashes via OpenAI `text-embedding-3-small` (1536 dimensions, cached in Supabase `embeddings` table)
3. Compute in-memory centroids for existing canonical topics
4. Classify each hash against centroids:

| Classification | Condition | Action |
|---------------|-----------|--------|
| `prior_assignment_locked` | Prior hybrid assignment exists + topic still active | Keep prior assignment (re-run stability) |
| `vector_auto_assign` | Single centroid match ≥ 0.82 AND cluster has ≥ 3 members | Auto-assign to cluster |
| `sonnet_arbitration_size_gated` | Single match ≥ 0.82 BUT cluster < 3 members | Route to Sonnet (62.7% redirect rate observed) |
| Ambiguous | Multiple matches ≥ 0.82 OR matches in 0.75–0.82 band | Route to Sonnet |
| `new_topic_candidate` | No matches ≥ 0.75 | Route to Sonnet for new topic creation |

**Constants:** `AUTO_ASSIGN_THRESHOLD = 0.82` (lowered from 0.85 on 2026-04-20, Phase 2.1). `AMBIGUITY_LOWER_BOUND = 0.75`. `MIN_CLUSTER_SIZE_FOR_AUTO_ASSIGN = 3` (Phase 2.2 size gate).

**Stage 2 — Sonnet Arbitration** (`hybrid/arbitrator.ts`):
- Batches of up to 40 unresolved cases per Sonnet call
- Prompt includes existing topic list + unresolved cases with vector match scores
- Decisions: `assign_existing`, `create_new`, `merge_candidate`
- New topics from earlier batches become context for later batches

**Persist** (`hybrid/persist.ts`):
- Writes `canonical_key`, `canonical_topic`, `cluster`, `classification_method`, `similarity_score`, `canonicalize_mode` to primary columns
- Batches of 50

#### Classification extraction (Session B — hybrid mode only)

**Module:** `src/agents/canonicalize/classify-keywords.ts`

Classification fields are extracted by a dedicated lightweight path **before** the hybrid pre-cluster/arbitrate pipeline runs.

**Three-step extraction:**
1. **Deterministic `is_near_me`:** `keyword.toLowerCase().includes(' near me')`
2. **Deterministic `is_brand` (partial):** String match against domain name, `clientBusinessName`, and `competitorNames` from client context
3. **Haiku batch:** All keywords sent to Haiku in batches of 100 for `intent_type`, `primary_entity_type`, and unresolved `is_brand`

**`core_services` prompt enrichment (2026-04-22):** When `audits.client_context.core_services` is populated (comma-separated string), the Haiku prompt receives two additional lines: (1) guidance to prefer Service/Course over Article for keywords matching listed services, (2) the actual service list. No prompt change when `core_services` is absent. Fixes entity_type misclassification for vocational verticals (e.g., "NREMT Test Prep" → Course instead of Article).

**Writes per keyword:** `is_brand`, `intent_type`, `is_near_me`, `primary_entity_type`, `canonicalize_mode`

**Cost:** ~$0.02-0.03 per 1,000 keywords.

**Injection:** `_setClassifyCallClaude(callClaude)` — same dependency injection pattern as `hybrid/arbitrator.ts`.

#### Classification fields

All classification fields extracted by `classify-keywords.ts` (Haiku + deterministic rules). See "Classification extraction" section above.

| Field | Method |
|-------|--------|
| `is_brand` | Deterministic (string match) + Haiku fallback |
| `intent_type` | Haiku |
| `primary_entity_type` | Haiku |
| `is_near_me` | Deterministic (`' near me'` check) |

**Near-me flagging:** Supplements flags already set by KeywordResearch on seeded keywords.

**Post-canonicalize cleanup:** Clears `is_near_miss` (and zeroes revenue fields) for any keywords where canonicalize set `is_brand=true` or `intent_type=navigational`.

**Entity type classification:** Each keyword group receives a `primary_entity_type` (Service, Course, Product, LocalBusiness, FAQPage, Article). Flows downstream to Phase 3d (`audit_clusters`), Cluster Strategy (Entity Map), and Pam (Page Identity).

#### External APIs

| API | Endpoint | Purpose | Used In |
|-----|----------|---------|---------|
| OpenAI Embeddings | `text-embedding-3-small` via `openai` SDK | Vector embeddings for pre-clustering | hybrid |
| Anthropic API (sonnet) | `callClaude()` | Arbitration for edge cases | hybrid |
| Anthropic API (haiku) | `callClaude()` | Classification extraction (intent_type, primary_entity_type, is_brand) | hybrid |

**Embedding cost:** $0.02/1M tokens. 1,100 keywords ≈ 11K tokens ≈ $0.0002. Negligible.

#### Supabase writes

`audit_keywords` UPDATE:
- Via classify-keywords.ts: `is_brand`, `intent_type`, `is_near_me`, `primary_entity_type`, `canonicalize_mode`
- Via hybrid persist: `canonical_key`, `canonical_topic`, `cluster`, `classification_method`, `similarity_score`

**PostgREST pagination:** Supabase PostgREST enforces `max-rows=1000` server-side. All keyword fetches in Phase 3c (and 3d, sync-michael, hybrid/index.ts) use `.range(offset, offset + PAGE_SIZE - 1)` pagination in a while loop. This was a pre-existing bug that silently capped IMA (1,100 keywords) at 1,000 — fixed in commit `36eb9c0`.

**Why before Competitors:** Clean canonical keys eliminate duplicate SERP calls.

**Does NOT rebuild clusters.** Phase 3d handles that.

---

### Phase 3d: Rebuild Clusters — Post-Canonicalize Re-aggregation

**Function:** `rebuildClustersAndRollups()` in sync-to-dashboard.ts | **No external APIs**

**Invocation:** `npx tsx scripts/sync-to-dashboard.ts --domain <d> --user-email <e> --rebuild-clusters`

**Why this exists:** Phase 3b builds clusters before canonical_key is set, producing one cluster per keyword variation (e.g., "air conditioner repair boise idaho" and "air conditioner repair boise" as separate clusters). After canonicalize assigns canonical_key, this phase re-aggregates using the clean keys so all AC repair variants merge into one "AC Repair" cluster.

**Clustering key priority:** `canonical_key > cluster > topic > 'general'`

**Supabase writes:**
- `audit_clusters` — DELETE + INSERT (using canonical groupings), with activation status preservation
- `audit_rollups` — DELETE + INSERT (recalculated totals)
- `cluster_strategy` — UPDATE `status='deprecated'`, `deprecated_at` for orphaned strategies (canonical_key no longer exists in rebuilt clusters)
- `execution_pages` — UPDATE `cluster_active` (preserved for surviving active clusters, set false for lost clusters)
- `agent_runs` — INSERT warning metadata for orphaned activations and deprecated strategies

**Cluster status preservation** (`sync-to-dashboard.ts:725-878`): Before DELETE, saves activation state (`status`, `activated_at`, `activated_by`, `target_publish_date`, `notes`, `hidden_reason`) for all non-inactive clusters. After INSERT, restores state for clusters that survived the rebuild. Logs orphaned active clusters (canonical_key removed by re-canonicalization) to `agent_runs` with `warning: 'orphaned_cluster_activations'`. See DECISIONS.md entry "cluster_strategy orphaning by canonicalization is deprecation, not remap" (2026-04-09).

**Strategy deprecation** (`sync-to-dashboard.ts:880-922`): Any `cluster_strategy` row whose `canonical_key` is no longer present in the rebuilt `audit_clusters` set is marked `status='deprecated'` with `deprecated_at` timestamp. Strategy documents are preserved — deprecation is a soft flag, not a delete. Regenerating a strategy (Phase 5 / dashboard Generate Strategy) reactivates it: the `generate-cluster-strategy.ts` upsert sets `status='active'`, `deprecated_at=NULL`.

**Empty-rebuild guard** (2026-06-11): If the keyword fetch returns 0 rows with `canonical_key`, the rebuild bails out BEFORE deleting anything — no cluster delete, no rollup reset, no activation orphaning, no strategy deprecation. An empty set means keywords aren't canonicalized yet (the jim sync calls this rebuild before Phase 3c canonicalize on every re-run), not that every cluster ceased to exist. Logs `warning: 'skipped_empty_cluster_rebuild'` to `agent_runs` when prior clusters existed. Before this guard, every full re-run over an audit with active strategies transiently wiped clusters and permanently deprecated the strategies (bit Weiser 2026-06-11).

**Entity type aggregation:** Each cluster's `primary_entity_type` is set from its constituent keywords, preferring non-Service types (e.g., if any keyword in the cluster is `Course`, the cluster gets `Course`).

**Filters:** Excludes `is_brand=true`, `intent_type=informational`, `intent_type=navigational` from clusters.

**Known concern:** The DELETE+INSERT pattern creates a brief window (~200-500ms) where `audit_clusters` has zero rows for the audit. A concurrent dashboard read during this window would see an empty Clusters page. No production incidents reported. See `docs/architectural-review-post-phase-2-2026-04-21.md` Area 2.3.

---

### Phase 4: Competitors — SERP Analysis

**Function:** `runCompetitors()` | **Model:** Claude Haiku (sync, small batches — domain classification)

**External APIs:**

| API | Endpoint | Purpose |
|-----|----------|---------|
| DataForSEO SERP Organic | `/v3/serp/google/organic/live/regular` | Top 10 organic results per keyword |
| Anthropic API (haiku) | Domain classification: industry_competitor, aggregator, brand_confusion, unrelated |

**Logic:** Selects top ~20 canonical topics by volume, fetches SERP for top 5 keywords per topic (up to 100 SERP calls). Aggregates which competitor domains appear most frequently per topic.

**Supabase writes:**
- `audit_topic_competitors` — per-topic competitor records with appearance_count, share, representative_url
- `audit_topic_dominance` — per-topic leader/client comparison

---

### Phase 4b: Section Extraction — Competitor Content Coverage

**Script:** `scripts/fetch-competitor-sections.ts` | **No LLM** (DataForSEO + embeddings)

Fetches competitor and client page HTML via DataForSEO `/on_page/instant_pages`, extracts H2/H3 headings, computes frequency-weighted semantic coverage scores per canonical topic.

**External APIs:**

| API | Endpoint | Purpose |
|-----|----------|---------|
| DataForSEO OnPage | `/v3/on_page/instant_pages` | Structured page data with `meta.htags` (~$0.005/URL) |
| OpenAI Embeddings | `text-embedding-3-small` | Heading embedding for semantic matching |

**Logic:**
1. Load competitor URLs from `audit_topic_competitors.representative_url` (set by Phase 4)
2. Load client URLs from `execution_pages`, `audit_keywords.ranking_url`, or `agent_technical_pages`
3. Fetch each URL via instant_pages, extract H2/H3 headings
4. Embed all headings via `embedBatch()` (content_type: `page_section`)
5. Compute frequency-weighted coverage: `Σ(freq × covered) / Σ(freq)` where freq = competitor count per subtopic
6. Core gaps: uncovered subtopics with `competitor_frequency ≥ 2` (table stakes, not fringe)
7. Borderline matches (0.78-0.88 similarity) logged for threshold tuning

**Coverage status:**
- `scored` — both competitor and client sections available
- `no_client_pages` — no client URL found for topic (unmeasurable, not zero)
- `insufficient_competitors` — fewer than 2 competitor pages found

**Re-run safety:** `DELETE FROM competitor_sections WHERE audit_id = $1` at the top of Phase 4b.

**Supabase writes:**
- `competitor_sections` — H2/H3 headings per competitor/client page
- `cluster_section_coverage` — coverage score, status, core_gaps, borderline_matches per topic
- `audit_clusters` — denormalized coverage_score, coverage_competitor_count

**Budget:** 3-5 competitors × 5-10 topics = 15-50 URLs + client URLs. ~$0.13-0.40/audit.

---

### Phase 4c: Coverage Density + Cannibalization Detection

**Script:** `scripts/compute-density.ts` | **No LLM** (embeddings only, cache-heavy)

Two embedding-powered scores per cluster, computed after Phase 4b so Gap can consume them:

1. **Coverage Density** — % of the cluster's *keywords* (not competitor headings) semantically covered by the client's existing page content (0–100), plus a per-cluster competitor comparison score. Distinct from `coverage_score` (4b), which measures competitor-heading coverage.
2. **Cannibalization Detection** — client page pairs within the same cluster whose content embeddings (`{title} | {h1} | {meta description}`) exceed 0.90 similarity (strict `>`).

**CLI:** `npx tsx scripts/compute-density.ts --domain <d> --user-email <e> [--threshold 0.80] [--skip-cannibalization]`

**Inputs:**
- `audit_clusters` (canonical_key), `audit_keywords` (id, keyword, canonical_key, ranking_url — paginated), `competitor_sections` (from 4b)
- Page metadata: **disk primary** (`audits/{domain}/auditor/{latest-date}/internal_all.csv`, same guarantee Phase 6c relies on), **`agent_technical_pages` fallback** (paginated, status 200) for standalone re-runs where disk artifacts don't exist (e.g. pipeline ran on Railway). Source is logged (`disk`/`supabase`).

**Logic:**
1. Client corpus is **site-wide**: all `competitor_sections` rows with `is_client=true` (any canonical_key) + one `"{title} | {h1}"` text per crawled page. Competitor corpus is per-cluster (`is_client=false`, canonical_key match).
2. Embed keywords (content_type `keyword`, contentId = audit_keywords.id — cache hits from 3c) and corpus texts (`page_section` reusing 4b contentIds; page texts as `page_meta`).
3. Per keyword: max cosine similarity vs client corpus, covered if ≥ 0.80 (`DENSITY_THRESHOLD`). `density_score = round(100 × covered/total)`. Same vs competitor corpus → `competitor_density_score` (null if no competitor sections).
4. Borderline matches (0.72–0.83) logged for threshold tuning.
5. Cannibalization: group client-host `ranking_url`s by canonical_key (URLs normalized: lowercase host, strip www/query/fragment/trailing slash), clusters with 2+ distinct URLs → pairwise similarity of page-meta embeddings (content_type `page_meta`, contentId `page_meta:{normalizedUrl}`), pairs with sim > 0.90 flagged.

**Density status (per cluster):** `scored` | `no_client_content` | `no_keywords` — non-scored clusters are skipped, never written.

**Re-run safety:** density columns UPDATEd in place; `DELETE FROM cannibalization_warnings WHERE audit_id = $1` then batch INSERT (500 rows).

**Supabase writes:**
- `audit_clusters` — `density_score`, `competitor_density_score`, `density_updated_at` (preserved across 3d rebuilds via the score-restore block in `rebuildClustersAndRollups()`)
- `cannibalization_warnings` — audit_id, canonical_key, page_a_url, page_b_url, similarity

**Budget:** ~$0 (embeddings cached from 3c/4b; new page_meta embeddings ~fractions of a cent).

---

### Phase 5: Gap — Content Gap Analysis

**Function:** `runGap()` | **Model:** Claude Sonnet (async)

Synthesizes all competitive intelligence + keyword data into a structured gap analysis.

**Supabase reads:** `audit_topic_competitors`, `audit_topic_dominance`, `audit_keywords`, `audit_clusters`, `agent_architecture_pages`

**Phase 4c injection:** density columns from `audit_clusters` (`density_score IS NOT NULL`) and top-20 `cannibalization_warnings` rows are appended as `## Keyword Coverage Density` and `## Cannibalization Conflicts` prompt blocks (try/catch — absence never breaks Gap).

**Output JSON keys:** `authority_gaps` (with `data_source` provenance), `format_gaps`, `unaddressed_gaps`, `priority_recommendations`, `summary`, `ai_citation_gaps` (conditional, from `llm_mentions.json` — topic, client/competitor mention counts, gap_severity, recommended_action)

**Client context:** If `prospect-config.json` has `client_context`, out-of-scope items are injected as reasoning constraints ("do not surface gaps related to these topics or delivery models").

**Quality rules:**
- Near-me keywords excluded from `revenue_opportunity` estimates
- Authority gaps include `data_source` ("SERP dominance" | "keyword overlap") for provenance
- Topics must be complete service phrases, not truncated fragments
- `revenue_opportunity` is a structured `{ value, basis }` object (legacy snapshots before 2026-06 hold free-text strings) — all consumers format via `formatRevenueOpportunity()` in `src/agents/gap/format-revenue.ts`, which handles both formats, pipe-escapes for markdown tables, and truncates long basis text
- `unaddressed_gaps` is forced to `[]` when Michael's architecture has <3 pages (always true on a fresh pipeline run, where Gap runs before Michael) — prevents meaningless duplication of authority_gaps
- Crawled page inventory is capped at 100 URLs; when truncated, the prompt notes the inventory is partial so format gaps aren't inferred from absence in the list

**Prompt framing:** JSON-only output with "YOUR ENTIRE RESPONSE IS RAW JSON" top/bottom framing.

**Output:** `research/{date}/content_gap_analysis.md` + `audit_snapshots`. The snapshot's `content_gap_observations` column gets formatted strings ("Topic: client absent — top competitor X. coverage_note") matching the string[] contract shared with Jim's snapshot; the full structured gap objects live in `keyword_overview.authority_gaps`.

---

### Phase 6: Michael — Architecture Blueprint

**Function:** `runMichael()` | **Model:** Claude Sonnet (async)

**Prompt:** Extracted to `configs/agents/michael/system-prompt.md` (8 placeholders: `{{RERUN_SECTION}}`, `{{SALES_MODE_SECTION}}`, `{{GEO_ARCH_BLOCK}}`, etc.). Loaded via `fs.readFileSync()` + `.replaceAll()` chain. Re-run/sales/geo blocks are pre-computed in runtime code and injected as placeholder values.

**Persona framing:** Entity-authority strategist and information architect. Michael frames architecture decisions through entity-authority: pages exist to establish the client as the authoritative entity for a topic cluster, not just to rank for keywords.

Reads ALL prior artifacts to produce a silo-based site architecture.

**Input summary (entity-first ordering):**
- Supabase: `cluster_strategy` (entity_map, visibility_queries, search_intent) — entity context injected BEFORE keyword data
- Jim: `research_summary.md` + top 200 keywords from `ranked_keywords.json`
- Gap: `content_gap_analysis.md`
- Dwight: `internal_all.csv` (filtered, 100 rows), Platform Observations from `AUDIT_REPORT.md`
- Supabase: `audit_clusters` (revenue estimates), `audit_assumptions` + `audit_rollups` (sales mode revenue)
- Client context: `prospect-config.json` → `client_context` (full mode only)

All cross-phase reads use `resolveArtifactPath()` with date fallback for operational resilience.

**Revenue headline (sales mode):** `buildRevenueTable()` pre-computes a deterministic `## Revenue Opportunity` section from `audit_assumptions` (CR/ACV) and `audit_rollups` (total volume). Passed verbatim to Michael's prompt — no LLM interpretation of revenue numbers.

**Client context (full mode):** `## Client Business Context` block injected with business model, target audience, pricing, services, and out-of-scope reasoning constraints.

**Strategy Brief authority (two-tier):** Strategy Brief sections are classified as binding constraints (prohibitions/exclusions: "do not," "avoid," "exclude") vs strategic framing (everything else). When structured data suggests building a page that conflicts with a binding constraint, the constraint wins and the opportunity is reported in a `## Deferred Targets` section.

**Output:** `architecture/{date}/architecture_blueprint.md` — Executive Summary + Platform Constraints (conditional) + Deferred Targets (conditional, when brief constraints deferred opportunities) + 3-7 Silos (each with page table: URL slug, status, role, coverage role, primary keyword, volume, action + Buyer Journey Coverage Assessment) + Cannibalization Warnings + Internal Linking Strategy + Entity Relationship Map + AI visibility query mapping in Action column. In sales mode, additionally includes `## Revenue Opportunity` section.

**Silo table columns:** URL slug, Status, Role, Coverage Role, Primary Keyword, Volume, Action. The Coverage Role column uses the vocabulary: commercial, informational, geographic, comparison, faq, credential, outcome. Action column now includes AI visibility query mapping where applicable.

**Structural validation:** Blueprint must contain `## Executive Summary` and at least one `### Silo N:` heading. If missing, Michael auto-retries once. Slug corruption ratio > 10% also triggers a retry (coverage assessment rows cause false positives — see known limitation).

**Key rules (revised 2026-04-22):**
- **Rule 4b — Cluster coherence over page count.** Each silo must be topically complete (pillar + distinct commercial intents + buyer journey support). Do not inflate page counts by splitting adjacent intents. Total site page count is a downstream cluster activation decision.
- **Rule 14 — Near-me slug prohibition.** No URL slugs containing "near-me." Near-me query volume captured through location-modified primary keywords on properly-structured geographic pages.
- **Rule 15 — Buyer Journey Coverage.** Every silo must have Consideration + Decision stage coverage. Coverage Assessment table required per silo.
- **Cannibalization pre-finalization self-check.** Before finalizing silo tables, Michael reviews for internal cannibalization (competing primary keywords, near-duplicate intent, parent/child overlap) and consolidates. Cannibalization Warnings section reports resolved risks, not self-created ones.
- **Rule 10 — Entity coverage prioritization.** Pages are prioritized by their contribution to entity authority coverage (same underlying logic, reframed through entity-authority lens). Each page must demonstrate how it strengthens the client's position as the authoritative entity for its topic cluster.
- Platform Constraints section required when Dwight detects CMS-specific limitations
- Every authority gap from Gap analysis must map to at least one architecture page

**New blueprint sections:**
- **Entity Relationship Map** — appears after Internal Linking Strategy. Maps entity relationships across silos to ensure comprehensive entity authority coverage.
- **AI visibility query mapping** — integrated into silo table Action column, linking pages to `visibility_queries` from `cluster_strategy`.

**Geographic architecture (conditional by `geo_mode`):** Geographic rules are injected conditionally via `getGeographicArchitectureBlock()`. National mode = no geographic rules (topical architecture only). City/metro mode = service-primary container with city/metro geographic pages. State mode = service-primary container with state/city geographic pages driven by keyword data. All modes follow the principle: service is the primary topical container, location is the qualifier. See `docs/prompts/michael-architecture-blueprint.md` for full block text.

**Prompt framing:** Uses "YOUR ENTIRE RESPONSE IS THE BLUEPRINT" top/bottom framing.

**Known limitation:** Slug corruption detection counts Buyer Journey Coverage Assessment table rows (e.g., "Awareness (problem recognition...)") as rejected slugs, causing false positive corruption ratios of ~30%. The parser correctly produces only valid page rows. Non-blocking.

---

### Phase 6b: sync michael — Architecture to Supabase

**Function:** `syncMichael()` | Parses `architecture_blueprint.md` silo tables

**Re-run awareness:** Detects scenario via `detectRerunScenario()` using `agent_runs`. Accepts `--start-from` from shell orchestrator.

| Scenario | Behavior |
|----------|----------|
| `first_run` | Standard INSERT/upsert, writes `source: 'michael'` |
| `strategic_rerun` | Committed pages get metadata-only update (page_brief, silo, priority). Stale uncommitted pages set to `deprecated`. Parses `## Deprecation Candidates` JSON from blueprint for explicit deprecation. |
| `failure_resume` | Full replace (re-syncing same artifacts, no protection needed) |

**Supabase writes:**

| Table | Purpose |
|-------|---------|
| `agent_architecture_pages` | Parsed page records (slug, silo, role, coverage_role, keyword, volume, action) — always DELETE+INSERT |
| `agent_architecture_blueprint` | Full markdown + executive summary — always DELETE+INSERT |
| `execution_pages` | Conditional UPSERT — committed pages preserved on strategic re-run. Writes `source: 'michael'` on INSERT. |
| `audit_keywords` | UPDATE `cluster` field from silo assignments (3-tier matching: exact primary_keyword → substring match → URL slug match). Achieves ~50-60% backfill rate. Known limitation: editorial/informational slugs often don't match keyword text. |

**Silo backfill detail** (`sync-to-dashboard.ts:2371-2425`): Maps keywords to Michael's silos via:
1. Exact `primary_keyword` match
2. Bidirectional substring match on `primary_keyword`
3. `ranking_url` slug match against page slugs

**Session B fix (migration 019):** syncMichael now writes to the dedicated `silo` column instead of overwriting `cluster`. The `cluster` column is preserved as `canonical_topic`-exclusive. The `silo` column stores Michael's architecture taxonomy assignment for the keyword. Both columns coexist independently — `canonical_key`/`canonical_topic` for keyword grouping, `silo` for architecture taxonomy.

---

### Phase 6c: sync dwight — Technical Audit to Supabase

**Function:** `syncDwight()` | Parses `internal_all.csv` + `AUDIT_REPORT.md`

**Supabase writes:**

| Table | Purpose |
|-------|---------|
| `agent_technical_pages` | Per-page technical data (status_code, word_count, title, h1, meta_desc, depth, indexability, inlinks) |
| `audit_snapshots` | Parsed AUDIT_REPORT.md sections (executive_summary, prioritized_fixes, agentic_readiness, structured_data_issues, heading_issues, security_issues) |

---

### Phase 6d: Local Presence Diagnostic (GBP + Citations)

**Script:** `scripts/local-presence.ts` | **No LLM** — pure DataForSEO API calls

**Invocation:** `npx tsx scripts/local-presence.ts --domain <domain> --user-email <email> [--force]`

**Runs in:** Both sales and full mode (always with `--force` when inline pipeline).

**Steps:**
1. **Resolve business identity** — Fallback chain: `audit.business_name` → `client_profiles.canonical_name` → domain-derived name
2. **GBP lookup** — DataForSEO `/v3/business_data/google/my_business_info/live` → match confidence, category, rating, reviews, claimed status, canonical NAP
3. **Upsert `gbp_snapshots`** — Always, even if `listing_found: false` (unclaimed/missing GBP is a high-value sales signal)
4. **Synthesize Google citation** — Derive `citation_snapshots` row from GBP data (`data_source: 'gbp'`)
5. **SERP citation scan** — For each of 10 directories: DataForSEO SERP API with `site:` filter → presence detection + NAP extraction from snippets
6. **NAP comparison** — Fuzzy name match, digits-only phone match, contains-based address match
7. **Batch upsert `citation_snapshots`** — 11 rows (Google + 10 directories)

**External APIs:**

| API | Endpoint | Purpose | Cost |
|-----|----------|---------|------|
| DataForSEO Business Data | `/v3/business_data/google/my_business_info/live` | GBP listing lookup | ~$0.005 |
| DataForSEO SERP | `/v3/serp/google/organic/live` | Citation scan per directory (×10) | ~$0.002 each |

**Total cost:** ~$0.026/audit

**Citation directories** (11 total): Google (from GBP), Apple Maps, Bing Places, Facebook, Yelp, BBB, Angi, Thumbtack, Foursquare, Yellow Pages, Manta

**Supabase writes:**

| Table | Purpose |
|-------|---------|
| `gbp_snapshots` | GBP listing data, canonical NAP, claimed status, rating/reviews |
| `citation_snapshots` | Per-directory presence, listing URL, NAP match booleans |
| `agent_runs` | agent_name='local_presence' |

**Recency:** 6-day check (same as track-rankings). `--force` overrides.

**QA Gate (deterministic, non-fatal):** After Phase 6d, `runQA(phase='local-presence')` checks (a) citation_snapshots rows exist for the latest snapshot date, and (b) every `listing_found` row's `listing_url` is on its `directory_domain` (wrong-business false positives; `manual_override` rows skipped). On FAIL, the citation scan re-runs once; a second FAIL logs a WARNING but does not fail the pipeline — the FAIL row in `audit_qa_results` flags the data for review.

---

## Post-Pipeline: On-Demand Content Agents

These agents run **outside** `run-pipeline.sh` — they are triggered per-page via Supabase request tables, not as pipeline phases. They operate on pages created by sync-michael in `execution_pages`.

```
sync-michael → execution_pages (page_brief, status='not_started')
       │
       ▼
Pam (generate-brief.ts) — polls pam_requests
  READS:  execution_pages (page_brief w/ coverage_role), audit_keywords,
          audit_snapshots (gap), architecture_blueprint.md, research_summary.md,
          client_profiles, cluster_strategy (entity_map, visibility_queries),
          DataForSEO SERP Advanced
  WRITES: content/{date}/{slug}/metadata.md, schema.json, content_outline.md
          execution_pages → status='brief_ready'
       │
       ▼
Oscar (generate-content.ts) — polls oscar_requests
  READS:  execution_pages (metadata, outline, schema — DB only),
          client_profiles, audit_topic_competitors, configs/oscar/
  WRITES: content/{date}/{slug}/page.html
          execution_pages → status='review', content_html
```

### Pam — Content Brief Generation

**Script:** `scripts/generate-brief.ts` | **Model:** Claude Sonnet (async)

**Prompt:** Extracted to `configs/agents/pam/system-prompt.md` (30+ placeholders). Loaded via `fs.readFileSync()` + `.replace()` chain. Many interpolations are replaced with pre-built section strings assembled in runtime code.

**Trigger:** `pam_requests` table (status='pending'). Polled by running `npx tsx scripts/generate-brief.ts [--domain <d>]`.

**What it does:** For each `execution_pages` row created by sync-michael, generates a complete content brief: metadata (meta title, description, H1, intent), JSON-LD schema, and a detailed content outline with per-section word counts, keyword targets, and internal linking maps.

**Operator-directed pages (Session 7-8):** The dashboard's "New Custom Page" dialog (ExecutionPage) creates pages OUTSIDE the audit-derived architecture — location pages, specific topic pursuits, campaign content. The dialog inserts an `execution_pages` row (`source='operator'`, synthetic `page_brief`) plus a `pam_requests` row carrying the operator's full keyword list and `operator_notes`, then triggers `pipeline-controls` `generate_brief` — no new endpoint or edge function; the page flows through the normal brief → draft → publish lifecycle. When `target_keywords` or `operator_notes` are present, `buildPrompt()` injects an **OPERATOR DIRECTIVES** section at the top of Pam's prompt (via `{{OPERATOR_DIRECTIVES}}`) declaring the keywords and notes authoritative over audit-derived inference. Missing audit context (no blueprint silo, no canonical_key keywords) degrades gracefully with warnings — verified live on weiser `/service-area/fruitland-id`. Operator pages are protected from Michael: syncMichael's strategic-rerun deprecation loop skips any row with `source != 'michael'`, and Michael's explicit Deprecation Candidates recommendations are ignored for `source='operator'` rows.

**Context gathered per page (entity-first ordering):**
1. **Entity Map** — `audit_clusters` → `cluster_strategy` (filtered `status='active'`) — entity_map (JSONB) for entity-aware content framing
2. **Search Intent** — search intent context from cluster strategy
3. **Page Identity** — `execution_pages` — page_brief (including `coverage_role`), silo, url_slug, buyer_stage, strategy_rationale (from sync-michael or cluster strategy)
4. **Visibility Queries** — `cluster_strategy.visibility_queries` (JSONB) — AI visibility measurement queries for the page's cluster
5. **Information Gain Directive** — evaluates `client_profiles` for proprietary knowledge; outputs one of: `PROPRIETARY KNOWLEDGE AVAILABLE` / `LIMITED PROPRIETARY KNOWLEDGE` / `COMMODITY CONTENT RISK`
6. `architecture_blueprint.md` — silo excerpt from disk
7. `research_summary.md` — striking distance + key takeaways from Jim
8. `audit_snapshots` (agent='gap') — authority gaps and format gaps
9. **Keywords** — `audit_keywords` sharing the page's `canonical_key` (Session B: join via `canonical_key`, with volume-based fallback if empty). Includes `primary_entity_type`. (Demoted from position #2 to #9 — entity context takes priority over raw keyword data.)
10. `client_profiles` — brand voice, USPs, differentiators (optional)
11. DataForSEO SERP Advanced — PAA questions, People Also Search, top organic competitors (optional, per primary keyword)
12. **Verified Internal Link Candidates** (Session 3) — `computeRelatedPages()` in `src/agents/linking/related-pages.ts` embeds the source page against live crawled pages (`loadPageMeta`: disk CSV → `agent_technical_pages` fallback) + non-deprecated `execution_pages` (cross-silo), ranks by cosine similarity (floor 0.50, cap 8), excludes near-duplicates (>0.90 → DO NOT LINK risks). Injected via `{{RELATED_PAGES_SECTION}}`. Pam is hard-constrained to pick Link To targets ONLY from these candidates + the sibling pages table. Requires `OPENAI_API_KEY` (embeddings) — skipped with a warning if absent; brief generation proceeds without candidates and Pam falls back to siblings-only linking.

**Entity + buyer journey context:** If the page has a `primary_entity_type` (from audit_clusters), it's injected into the Page Identity block. If `entity_map` exists on the cluster's strategy, the full entity definition is injected. If `buyer_stage` is set (cluster strategy pages), a Buyer Journey Context block is added.

**Information Gain Directive:** Evaluates the client profile (services, certifications, proprietary processes, case studies) to determine the level of proprietary knowledge available. This gates Pam's content strategy: pages with `PROPRIETARY KNOWLEDGE AVAILABLE` emphasize unique data and client expertise; `COMMODITY CONTENT RISK` pages require explicit information gain strategies to differentiate from generic competitors.

**Coverage role in Page Identity:** The `coverage_role` field from `execution_pages.page_brief` (written by sync-michael) is included in the Page Identity section. This tells Pam the entity-authority intent purpose of the page (commercial, informational, geographic, comparison, faq, credential, outcome) and shapes the brief accordingly.

**Output (3 files per page):**
- `content/{date}/{slug}/metadata.md` — meta title, description, H1, intent, keyword-element mapping
- `content/{date}/{slug}/schema.json` — JSON-LD @graph (Organization, WebSite, WebPage, Service, FAQPage)
- `content/{date}/{slug}/content_outline.md` — section-by-section outline, word counts, keyword placement, internal linking map

**Supabase writes:** `execution_pages` UPDATE (metadata_markdown, schema_json, content_outline_markdown, meta_title, meta_description, h1_recommendation, intent_classification, target_word_count, status → 'brief_ready', and `related_pages` JSONB when computed — never nulled out if computation was skipped/failed)

**Prompt structure:** Uses sentinel markers (`---METADATA_START---`/`---METADATA_END---`, `---SCHEMA_START---`/`---SCHEMA_END---`, `---OUTLINE_START---`/`---OUTLINE_END---`) to parse three output sections from a single Claude call.

---

### Oscar — Content Production (HTML Generation)

**Script:** `scripts/generate-content.ts` | **Model:** Claude Sonnet (async)

**Trigger:** `oscar_requests` table (status='pending') or direct CLI: `npx tsx scripts/generate-content.ts --domain <d> --slug <s>`.

**What it does:** Takes Pam's completed brief (metadata + outline + schema) and produces production-ready semantic HTML (`<article>` structure).

**Context gathered per page:**
1. `execution_pages` — metadata_markdown, content_outline_markdown, schema_json (Supabase only, warns on null fields)
2. `client_profiles` — brand voice, business details
3. `audit_topic_competitors` + `audit_topic_dominance` — competitive context fallback if Pam's outline lacks it
4. `configs/oscar/system-prompt.md` + `configs/oscar/seo-playbook.md` — Oscar's persona and SEO rules

**Output:**
- `content/{date}/{slug}/page.html` — production-ready semantic HTML
- `content/_debug/{slug}-oscar-raw.html` — raw Claude output (debug)

**Supabase writes:** `execution_pages` UPDATE (content_html, status → 'draft_ready'). (Wrote legacy 'in_progress' before migration 035; the dashboard still maps legacy values for display.)

**Token budget:** Uses `PHASE_MAX_TOKENS.content` = 65536 tokens. Must be called with `callClaudeAsync(prompt, { model: 'sonnet', phase: 'content' })` — passing `'sonnet'` as a string only sets the model and falls through to default 8192 tokens. Streaming is automatically enabled for requests >16K tokens (Anthropic API requirement for long-running operations).

**HTML extraction:** `extractHtmlContent()` strips Claude preamble/postamble — looks for first `<!--` through last `-->`, falls back to code fence stripping.

**Slop scan QA gate:** After HTML extraction, `scanForSlop()` from `scripts/slop-scanner.ts` checks for banned phrases parsed live from `configs/oscar/system-prompt.md` (AI-isms line) + `configs/oscar/seo-playbook.md` (Anti-Patterns "Writing:" line) by `src/content/banned-phrases.ts` — editing those config lines updates the scanner automatically; a built-in fallback list is used if parsing yields nothing. If violations found: builds sentence-level rewrite prompt (JSON format, ~500 tokens), calls Sonnet via `content-qa` phase (4096 max tokens), applies replacements via string substitution. Cap at one retry — if violations remain after rewrite, uses rewritten version and logs warnings. Non-fatal: rewrite failure falls through to original HTML.

---

### sync-pam — Batch Re-sync (Disk → Supabase)

**Function:** `syncPam()` in `scripts/sync-to-dashboard.ts` | **No external APIs**

**Purpose:** Batch re-sync of Pam's disk output back to Supabase. This is a recovery/re-sync mechanism — `generate-brief.ts` already writes to `execution_pages` directly. Use this to re-populate Supabase from disk if data is lost or to sync briefs generated outside the normal flow.

**Invocation:** `npx tsx scripts/sync-to-dashboard.ts --domain <d> --user-email <e> --agents pam`

**Reads:** `content/{date}/{slug}/metadata.md`, `schema.json`, `content_outline.md` from disk

**Supabase writes:**
- `agent_implementation_pages` — legacy table (backward compat, DELETE+INSERT)
- `execution_pages` — UPSERT (matches by slug, preserves page_brief/status from Michael, promotes `not_started` → `brief_ready`)
- `agent_runs`, `audit_snapshots` (agent='pam')

---

### Page Status Lifecycle

```
not_started  → sync-michael creates execution_pages row with page_brief
               (or operator dialog / cluster-strategy add)
brief_ready  → Pam generates metadata + schema + outline
draft_ready  → Oscar generates content_html (was legacy 'in_progress' — data
               normalized by migration 035)
in_review    → manual, via dashboard (was legacy 'review')
published    → manual, via dashboard — PublishUrlDialog captures published_url
               + published_at; bulk publish auto-derives the URL from the slug
```

Content-back-in: a human can replace Oscar's `content_html` from the dashboard drawer (Replace Draft HTML) — `content_edited_at` is stamped so edited drafts are distinguishable from raw agent output. The original draft remains in the pipeline's disk artifacts. Published pages show live GSC metrics in the drawer (matched on the `published_url` pathname against `gsc_page_snapshots.page_url`, which stores PATHS, not full URLs).

---

## Performance Tracking (Post-Pipeline, Scheduled)

Ranking performance tracking runs independently of the audit pipeline — weekly via cron, or on-demand via the `/track-rankings` endpoint.

### track-rankings.ts — Per-Domain Tracker

**Script:** `scripts/track-rankings.ts` | **No LLM calls**

**Invocation:** `npx tsx scripts/track-rankings.ts --domain <d> --user-email <e> [--force]`

**Steps:**
1. Resolve audit from Supabase (domain + email)
2. Recency check: skip if latest `ranking_snapshots` < 6 days old (bypass with `--force`)
3. Load `audit_keywords` from Supabase (keyword → metadata map: canonical_key, cluster, intent_type, volume)
4. Fetch DataForSEO `ranked_keywords/live` (max 1000 keywords, ~$0.05/call)
5. Build + upsert `ranking_snapshots` (500-record batches). Keywords not in DataForSEO results get `rank_position=null`
6. Aggregate `cluster_performance_snapshots` — groups by `canonical_key`, computes `avg_position` (mean of ranked keywords only; unranked `rank_position=null` excluded), position bucket counts (`keywords_p1_3/p4_10/p11_30/p31_100` — ranked only), `keyword_count` (all keywords including unranked), `authority_score` (position-weighted 0-100, see DECISIONS.md), `authority_score_delta` (vs previous snapshot)
7. Update `audit_clusters.authority_score` with the latest score from step 6
8. Track published pages in `page_performance` — matches ranking URLs against published `execution_pages`, computes `current_avg_position` (ranked keywords only, same exclusion as clusters)
9. GA4 behavioral data (non-fatal) — fetches page-level GA4 data for published slugs, upserts to `ga4_page_snapshots`, updates `page_performance` behavioral columns, computes `observed_cr` in `audit_assumptions`
9b. GA4 event-level conversions (non-fatal) — fetches site-wide event data from GA4 (dimensions: `eventName` + `sessionDefaultChannelGroup`, metrics: `eventCount` + `eventRevenue`, filtered to 4 conversion events), upserts to `ga4_event_snapshots`
10. Log to `agent_runs` (agent_name='performance_tracker', metadata includes `ga4_page_count` + `ga4_event_count`)

**External APIs:**

| API | Endpoint | Purpose |
|-----|----------|---------|
| DataForSEO Ranked Keywords | `/v3/dataforseo_labs/google/ranked_keywords/live` | Current organic rankings |

### cron-track-all.ts — Batch Runner

**Script:** `scripts/cron-track-all.ts`

**Invocation:** `npx tsx scripts/cron-track-all.ts [--force]`

**Logic:** Queries all audits where `status='completed'`, resolves user emails, runs `track-rankings.ts` sequentially with 30-second delays between domains (DataForSEO rate limits). The 6-day recency check in `track-rankings.ts` prevents double-runs.

**Scheduling:** Railway cron job or external scheduler, weekly.

### Pipeline Server Endpoint

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/track-rankings` | On-demand ranking tracking for a single domain |

**Body:** `{ domain, email, force? }` — same auth as other endpoints.

### Supabase Tables

| Table | Purpose |
|-------|---------|
| `ranking_snapshots` | Per-keyword per-date position data (UNIQUE: audit_id, snapshot_date, keyword) |
| `cluster_performance_snapshots` | Pre-aggregated cluster metrics per snapshot date |
| `page_performance` | Post-publication page tracking (avg position, keyword gains) |
| `ranking_deltas` (VIEW) | SQL-computed baseline vs latest position deltas per keyword |

**Migration:** `scripts/performance-migration.sql` + `scripts/authority-score-migration.sql`

**Backfill:** `npx tsx scripts/backfill-authority-scores.ts [--domain <d>]` — computes authority scores for existing `cluster_performance_snapshots` and updates `audit_clusters`. Uses `audit_keywords` as denominator (not snapshot data) since older snapshots may be incomplete. Processes snapshot dates chronologically so deltas are correct.

**RLS:** All tables: SELECT for audit owners (`audits.user_id = auth.uid()`). INSERT/UPDATE/DELETE restricted to service_role.

---

## LLM Visibility Tracking (Post-Pipeline, Scheduled)

AI platform mention tracking runs independently of the audit pipeline — monthly via cron, or on-demand via the `/track-llm-mentions` endpoint.

### track-llm-mentions.ts — Per-Domain Tracker

**Script:** `scripts/track-llm-mentions.ts` | **No LLM calls**

**Invocation:** `npx tsx scripts/track-llm-mentions.ts --domain <d> --user-email <e> [--force]`

**Two modes** (auto-selected per audit):

**Cluster-aware mode** (preferred — when activated clusters have `visibility_queries`):
1. Resolve audit from Supabase (domain + email)
2. Recency check: skip if latest `llm_visibility_snapshots` < 25 days old (bypass with `--force`)
3. Load visibility queries from `cluster_strategy` WHERE `status='active' AND visibility_queries IS NOT NULL`
4. Cap at 40 queries total (round-robin across clusters if over limit)
5. Load top 3 non-client competitors per cluster from `audit_topic_competitors` (by `share` DESC)
6. Fetch DataForSEO domain mentions for client (budget: $5.00)
7. Fetch DataForSEO competitor aggregated metrics, deduped across clusters (budget: $3.00)
8. DELETE + UPSERT to `llm_visibility_snapshots` with `cluster_canonical_key` set
9. INSERT to `llm_mention_details` (client mentions only — competitor API returns aggregates)
10. Log per-cluster SOV summary to console

**Fallback mode** (when no cluster queries exist):
1. Resolve audit from Supabase (domain + email)
2. Recency check: skip if latest `llm_visibility_snapshots` < 25 days old (bypass with `--force`)
3. Load top 5 keywords from `audit_keywords` (by volume, rank ≤ 30, excluding brand/near-me)
4. Fetch DataForSEO LLM Mentions `/search/live` for domain mentions (~$0.10-0.30)
5. DELETE + UPSERT to `llm_visibility_snapshots` with `cluster_canonical_key = null`
6. INSERT to `llm_mention_details`

**Cost projection (cluster mode):** 10 activated clusters × 6 queries avg × 2 platforms = 120 API calls × $0.10 = ~$12/month per domain. With 3 competitors per cluster: 10 × 3 × 2 = 60 × $0.101 = ~$6/month. Total: ~$18/domain/month. Budget guards prevent runaway costs.

**External APIs:**

| API | Endpoint | Purpose |
|-----|----------|---------|
| DataForSEO LLM Mentions | `/v3/ai_optimization/llm_mentions/search/live` | AI platform mention data (Google AI Overview, ChatGPT) |
| DataForSEO LLM Mentions | `/v3/ai_optimization/llm_mentions/aggregated_metrics/live` | Competitor mention aggregates |

**Note:** Perplexity is NOT supported by the LLM Mentions API. Only `google` and `chat_gpt` platforms are available.

### cron-llm-mentions-all.ts — Batch Runner

**Script:** `scripts/cron-llm-mentions-all.ts`

**Invocation:** `npx tsx scripts/cron-llm-mentions-all.ts [--force]`

**Logic:** Queries all audits where `status='completed'`, resolves user emails, runs `track-llm-mentions.ts` sequentially with 45-second delays between domains. Logs whether each audit used cluster-aware or fallback mode. The 25-day recency check prevents double-runs.

**Scheduling:** Railway cron job or external scheduler, monthly.

### Pipeline Server Endpoint

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/track-llm-mentions` | On-demand LLM visibility tracking for a single domain |

**Body:** `{ domain, email, force? }` — same auth as other endpoints.

### Supabase Tables

| Table | Purpose |
|-------|---------|
| `llm_visibility_snapshots` | Per-keyword per-platform per-domain mention counts (UNIQUE: audit_id, snapshot_date, keyword, platform, domain) |
| `llm_mention_details` | Qualitative mention texts with citation URLs |

**Migration:** `scripts/migrations/004-llm-visibility.sql`

**RLS:** Both tables: SELECT for audit owners (`audits.user_id = auth.uid()`). INSERT/UPDATE/DELETE restricted to service_role.

### AI Visibility Analysis / Jim Section 11 Overlap

Jim (Phase 3) writes `llm_visibility_snapshots` during the pipeline run via `syncJim()`. The standalone AI Visibility Analysis (`/ai-visibility-analysis` → `ai-visibility-analysis.ts`) also writes to the same table.

**Dedup behavior:** When AI Visibility Analysis runs, it checks `llm_visibility_snapshots` for entries matching this audit + today's date. If Jim data already exists (same-day pipeline run), it reuses that data instead of making redundant DataForSEO calls. The Sonnet synthesis (structural gaps + recommendations) still runs since that's the standalone-specific output Jim does not produce. The `agent_runs` metadata includes `jim_data_reused: true` when dedup applies.

**Cost implication:** Running AI Visibility Analysis after a full pipeline costs only the Sonnet synthesis (~$0.03) instead of the full DataForSEO + synthesis cost (~$0.30-0.50).

---

## Re-Canonicalize (On-Demand)

Re-canonicalize runs Phase 3c + 3d without the full pipeline. Used from the Settings page when operators want to refresh keyword groupings or cluster structure.

### run-canonicalize.ts

**Script:** `scripts/run-canonicalize.ts` | **Model:** Claude Haiku (classification) + Claude Sonnet (arbitration)

**Invocation:** `npx tsx scripts/run-canonicalize.ts --domain <d> --user-email <e>`

**Steps:**
1. Resolve audit from Supabase (domain + email)
2. Run Phase 3c (`runCanonicalize()`) — hybrid classification + clustering
3. Run Phase 3d (`rebuildClustersAndRollups()`) — delete + insert clusters with status preservation + strategy deprecation
4. Re-backfill `execution_pages.canonical_key` from updated `audit_keywords`
5. Log `agent_runs` entry

**Status preservation:** `rebuildClustersAndRollups()` saves cluster activation status (status, activated_at, activated_by, target_publish_date, notes) before DELETE and restores it after INSERT for clusters that survive the rebuild. Also preserves `execution_pages.cluster_active` for surviving active clusters and deactivates pages for lost clusters. See Phase 3d section for details.

### Pipeline Server Endpoint

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/recanonicalize` | Start re-canonicalize (async, 202) |

**Body:** `{ domain, email }` — same auth as other endpoints.

---

## Keyword Lookup (On-Demand)

Ad-hoc keyword volume lookup via DataForSEO Keyword Data API. Super-admin only. Results are persisted to the `keyword_lookups` table so paid-for research is retained across sessions.

### Pipeline Server Handler

**Handler:** `handleLookupKeywords()` in `src/pipeline-server-standalone.ts`

**Body:** `{ keywords[], location_codes?, audit_id?, user_id? }`

**Steps:**
1. Validate keywords (required, max 500)
2. Call `lookupKeywordVolumes()` from `src/dataforseo-keywords.ts`
3. If `audit_id` provided, best-effort insert results into `keyword_lookups` via `getSb()`:
   - Generate `crypto.randomUUID()` for `batch_id`
   - Upsert with `onConflict: 'audit_id,batch_id,keyword'` (prevents duplicates)
   - Log errors but don't fail the HTTP response
4. Return `{ results[], total, found, estimated_cost }` (cost formatted as `$X.XXX`)

### Pipeline Server Endpoint

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/lookup-keywords` | Synchronous keyword volume lookup + persist |

### Supabase Tables

| Table | Purpose |
|-------|---------|
| `keyword_lookups` | One row per keyword result, `batch_id` groups a single lookup session |

**Unique:** `(audit_id, batch_id, keyword)`
**Index:** `(audit_id, looked_up_at DESC)` for history listing
**RLS:** super_admin only (`has_role` check)
**Migration:** `scripts/migrations/008-keyword-lookups.sql`

### Dashboard

- **Hook:** `useKeywordLookup(auditId)` — mutation passes `audit_id` to edge function, invalidates history on success
- **Hook:** `useKeywordLookupHistory(auditId)` — reads `keyword_lookups` for last 90 days
- **Page:** `KeywordLookupPage.tsx` — "Previous Lookups" card with collapsible batches

---

## Cluster Activation (On-Demand)

Cluster activation is an on-demand step that generates a strategy document for a specific topic cluster, marks it active, and flags its execution_pages. It runs outside the main pipeline, triggered via HTTP endpoint or CLI.

### generate-cluster-strategy.ts — Cluster Strategy Generator

**Script:** `scripts/generate-cluster-strategy.ts` | **Model:** Claude Opus (single call)

**Invocation:** `npx tsx scripts/generate-cluster-strategy.ts --domain <d> --canonical-key <key> --user-email <e>`

**Prerequisites:** Phases 3c+3d must have run (canonical_key populated on audit_keywords and audit_clusters).

**Steps:**
1. Resolve audit from Supabase (domain + email)
2. Load cluster (with `primary_entity_type`), keywords, execution_pages, gap analysis, competitors, client context
3. Build prompt → `callClaude()` with Opus (strategic judgment tier). Prompt includes entity type context and Section 0 (Entity Map) requirement.
4. Parse via `extractJsonBySection()` (header-based, not positional): entity_map (Section 0, includes `search_intent` + `intent_rationale`), buyer_stages (Section 1), recommended_pages (Section 3), format_gaps (Section 4), AI optimization notes (Section 5), visibility_queries (Section 7)
5. Upsert `cluster_strategy` table (includes `entity_map` JSONB, `search_intent` TEXT, `visibility_queries` JSONB)
6. SET `audit_clusters.status = 'active'`, `activated_at = now()`
7. SET `execution_pages.cluster_active = true` WHERE `canonical_key = key`
8. **Insert recommended_pages into `execution_pages`** with `source: 'cluster_strategy'`, `buyer_stage`, `strategy_rationale` (slug dedup check prevents duplicates on re-activation)
9. Log `agent_runs` entry

**Strategy sections:** 0. Entity Map (JSON), 1. Buyer Journey Map (JSON), 2. Content Strategy (markdown), 3. Recommended New Pages (JSON), 4. Format Gaps (JSON), 5. AI Optimization Priorities, 6. Production Sequence (markdown), 7. AI Visibility Measurement Queries (JSON — natural-language queries for tracking AI platform visibility)

**Cost:** ~$0.15-0.50 per cluster (single Opus call).

### Pipeline Server Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/activate-cluster` | Spawn cluster strategy generation (202 async) |
| POST | `/deactivate-cluster` | Instant deactivation (200 sync, 2 DB updates) |

**Body (both):** `{ domain, canonical_key, email }` — same auth as other endpoints.

**Deactivation** is handled directly in the server process (no script spawn) for near-instant response. It sets `audit_clusters.status = 'inactive'` and `execution_pages.cluster_active = false`.

### Supabase Tables

| Table | Purpose |
|-------|---------|
| `cluster_strategy` | Per-cluster strategy document (UNIQUE: audit_id, canonical_key). Columns include `status` (TEXT: 'active', 'deprecated'), `deprecated_at` (TIMESTAMPTZ), `entity_map` (JSONB). Migration 014. |
| `audit_clusters.status` | `inactive` → `active` → `complete` lifecycle |
| `audit_clusters.canonical_key` | Join key to `execution_pages.canonical_key` |
| `execution_pages.cluster_active` | Boolean flag for content queue filtering |

**Migration:** `scripts/cluster-focus-migration.sql`

---

## Operational Resilience

**Date fallback:** Pipeline phases may span midnight. `resolveArtifactPath()` tries today's date first, then falls back to the most recent dated directory containing the requested file. This means a failed Phase 5 re-run at 12:01 AM still finds Phase 3's artifacts from 11:58 PM.

**Narration detection:** `validateArtifact()` strips leading backticks/whitespace, then checks against conversational patterns (`/^I'll /i`, `/^Let me /i`, `/^Here's /i`, etc.). Rejects outputs that narrate about the file instead of producing it.

**Prompt framing:** All agent calls use a consistent pattern:
- **Top of prompt:** "YOUR ENTIRE RESPONSE IS THE [REPORT/BLUEPRINT/RAW JSON]..."
- **Bottom of prompt:** "REMINDER: Your response IS the [content] — start with [expected heading]. No preamble, no narration."
- **JSON agents** add: "No markdown code fences. Just the bare JSON object starting with {"

**Retry:** Michael includes structural validation (Executive Summary + Silo headings present) with one automatic retry if the output is incomplete.

**Source preservation:** sync jim's DELETE preserves `source='keyword_research'` rows so KeywordResearch-seeded keywords survive re-syncs.

### QA Gates & Feedback Loop

Seven phases are QA-gated: 1 (Dwight), 1b (Strategy Brief), 2 (Keyword Research), 3 (Jim), 5 (Gap), 6 (Michael), 6d (Local Presence). Each gate runs `pipeline-generate.ts qa --phase <phase>` after the phase completes.

**Gate types:**
- **Rubric phases** (dwight, strategy-brief, jim, gap, michael): deterministic pre-flight checks first, then Haiku evaluates the artifact against the phase's `QA_RUBRICS` entry.
- **Deterministic-only phases** (`keyword-research`, `local-presence` — in `DETERMINISTIC_ONLY_PHASES`): no artifact rubric or LLM call; pass/fail comes entirely from `runDeterministicChecks()`.

**Deterministic checks per phase:**
- `strategy-brief` — section headers present, 50+ words per section, no conversational preamble
- `keyword-research` — ≥1 keyword seeded into `audit_keywords` (source='keyword_research'); service coverage ≥25% of extracted services have a validated keyword (reads `keyword_research_meta.json`)
- `jim` — keyword seed count (defense-in-depth re-check of the Phase 2 gate)
- `michael` — cluster count ≥50% of canonical topic count
- `local-presence` — citation_snapshots rows exist for the latest snapshot; every found listing's URL is on its directory's domain (wrong-business false-positive detection; `manual_override` rows skipped)

**Feedback loop (Session 5):** On QA FAIL, `runQA()` writes the failed checks + feedback to `audits/{domain}/qa_feedback/{phase}.md`. The shell retry invocation passes `--qa-feedback <path>` (via the `qa_feedback_arg` helper — flag only added when the file exists), and the regenerating agent prepends a "PREVIOUS ATTEMPT FEEDBACK (QA REVIEW)" block to its prompt (`withQaFeedback()` in pipeline-generate.ts; inline equivalent in strategy-brief.ts). The feedback file is deleted on the next PASS so stale feedback never leaks into later runs.

**Failure severity:** All gates retry once with feedback. After a failed retry, gates 1/1b/2/3/5/6 halt the pipeline (`pipeline_fail`); the 6d gate is **non-fatal** — it logs a WARNING and the FAIL row in `audit_qa_results` flags the citation data for review, but a bad citation scan does not fail an otherwise-complete audit.

---

## Run Progress Tracking (pipeline_runs)

Every full/sales pipeline run records per-phase progress in the `pipeline_runs` Supabase table (migration 033). Prospect mode is excluded (it exits before the tracking block). The dashboard's AuditRunning page renders a live 16-phase checklist from this table; Audit Settings shows run history.

**Lifecycle** (all writes via `scripts/pipeline-progress.ts`, invoked by `scripts/run-pipeline.sh`):

1. `start <domain> <email> <mode> [start_from] [stop_after]` — resolves user + latest audit by domain, INSERTs a row (`status='running'`), prints **only** the run UUID to stdout (captured by the shell into `RUN_ID`). All informational logs go to stderr.
2. `phase-start <run_id> <phase>` — merges `{status:'running', started_at}` into the `phases` JSONB, sets `current_phase`.
3. `phase-done <run_id> <phase>` / `phase-skip <run_id> <phase>` — marks completed (preserving `started_at`, setting `completed_at`) or skipped.
4. `pause <run_id>` — review gate: `status='awaiting_review'`.
5. `complete <run_id>` — `status='completed'`, `current_phase=null`, `completed_at`.
6. `fail <run_id> [phase] [message]` — `status='failed'`, `error_message`, failed phase entry. Called from the shell's `pipeline_fail` helper (ERR/TERM/INT traps + explicit QA-gate failures).

**Non-fatal guarantee:** every progress call in run-pipeline.sh is wrapped with `|| true` and `2>/dev/null` — progress tracking failures never fail the pipeline. If `start` fails, `RUN_ID` is empty and all subsequent calls no-op.

**Merge semantics** (`src/pipeline/progress-merge.ts`, pure + unit-tested): `running` sets `started_at` (preserved on re-entry); `completed`/`failed` preserve `started_at` and set `completed_at`; `skipped` has no timestamps; errors attach to the phase entry.

**Race safety:** the server's `inFlight` Set guarantees one run per domain (409 on concurrent trigger), so the read-modify-write of the `phases` JSONB is race-free.

**CRITICAL shell gotcha:** `run-pipeline.sh` sets `set -o errtrace` immediately after `set -euo pipefail`. Without it, the ERR trap does NOT fire for failures inside shell functions (e.g. `run_step`) — the script exits silently and the run row sticks at `running`. Do not remove it.

### Per-Step Timeouts

`run_step()` wraps all ~33 phase-step `npx tsx` invocations with coreutils `timeout --kill-after=30 "$PHASE_STEP_TIMEOUT"` (guarded by `command -v timeout`; falls back to direct execution). Default 900s, overridden to **1800s on Railway** via the `PHASE_STEP_TIMEOUT` env var. Timeout exit code 124 propagates like an ordinary failure → ERR trap → `pipeline_fail` with `CURRENT_PHASE` set. NOT wrapped: `update_status`, `progress` calls, the review-gate check, and prospect mode.

### Server Watchdogs

`armWatchdog(child, label, ms, onTimeout?)` in `src/pipeline-server-standalone.ts` backstops every spawn site:

- `/trigger-pipeline`: `PIPELINE_RUN_TIMEOUT_MS` (default 3h). On expiry: SIGTERM to the child's process group (all spawns are `detached: true` → pgroup leaders), SIGKILL 30s later, then after 60s (giving the shell's TERM trap first claim) flips the domain's latest `pipeline_runs` row `running`→`timed_out` and the audit →`failed`.
- All other endpoints (track-rankings, recanonicalize, activate-cluster, llm-mentions, prospect/client briefs, gsc, pam, oscar, ai-visibility): `PIPELINE_JOB_TIMEOUT_MS` (default 30 min), no onTimeout.
- `disarm()` is called first in every close/error handler. The watchdog never touches `inFlight` — the kill triggers the close handler, which runs existing cleanup.

**Reconciliation backstop:** the startup/periodic reconciliation loop marks `pipeline_runs` rows `running` whose domain is not in `inFlight` as `failed` ("Pipeline interrupted (server restart ...)"). Covers server restarts/SIGKILL where no trap could fire.

### Resume From Phase

Failures no longer force a Phase-1 restart. The dashboard's AuditRunning failure panel offers **"Resume from Phase X"** (first failed phase from `phases` JSONB, else `current_phase`) → `run-audit` edge function with `start_from` → server `/trigger-pipeline` `start_from` → shell `--start-from`. "Restart from beginning" remains available. The `pipeline-controls` `resume_pipeline` action (strategy review gate) still hardcodes `start_from: '2'` by design.

---

## Pipeline Server Infrastructure

The pipeline server (`src/pipeline-server-standalone.ts`) is an HTTP server that Supabase Edge Functions call to trigger pipeline runs, write scout configs, and read scout reports.

**Endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check (uptime, in-flight domains, env var presence) |
| POST | `/trigger-pipeline` | Start a full/sales/prospect pipeline run |
| POST | `/scout-config` | Write prospect-config.json to disk |
| POST | `/scout-report` | Read scout markdown + scope.json |
| POST | `/artifact` | Download pipeline output files |
| POST | `/track-rankings` | On-demand ranking tracking for a single domain |
| POST | `/recanonicalize` | Re-run Phase 3c+3d with status preservation (async, 202) |
| POST | `/activate-cluster` | Start cluster strategy generation (async, 202) |
| POST | `/deactivate-cluster` | Deactivate a cluster (sync, 200) |
| POST | `/lookup-keywords` | Ad-hoc DataForSEO keyword volume lookup, persists to `keyword_lookups` |
| POST | `/export-audit` | Stream ZIP of all artifacts for a domain |

**Auth:** All endpoints (except `/health`) require `Authorization: Bearer <PIPELINE_TRIGGER_SECRET>`.

**Startup:** `npm run dev` (local) or `npm start` (production on Railway).

### Supabase Secrets

| Secret | Value | Purpose |
|--------|-------|---------|
| `PIPELINE_BASE_URL` | `https://nanoclaw-production-e8b7.up.railway.app` | Pipeline server base URL (edge functions append endpoint paths) |
| `PIPELINE_TRIGGER_SECRET` | Bearer token | Shared secret between edge functions and pipeline server |
| `DEFAULT_PIPELINE_EMAIL` | `matt@forgegrowth.ai` | Fallback email for pipeline trigger when no user JWT |

Edge functions read `PIPELINE_BASE_URL` with fallback to `PIPELINE_TRIGGER_URL` (deprecated).

### Network Access (SEC-2 — Resolved)

> **Status (2026-03-30):** SEC-2 is resolved. The pipeline server runs on Railway (cloud-hosted), which provides HTTPS natively via `https://nanoclaw-production-e8b7.up.railway.app`. There is no local port exposure. Auth is handled by `PIPELINE_TRIGGER_SECRET` bearer token.

The pipeline server runs on Railway's managed infrastructure. Supabase Edge Functions reach it via Railway's public HTTPS URL. No local ports are exposed, no residential ISP connection is involved, and no tunneling is required.

**History:** The server originally ran on a local machine with port 3847 forwarded through an EERO router. A Cloudflare Tunnel (`pipeline.forgegrowth.ai`) was implemented as an intermediate fix (SEC-2 remediation). Now that the server runs on Railway, the tunnel is unnecessary and has been retired. Railway provides HTTPS + stable hostname natively.

---

## External API Reference

| API | Endpoint | Called By | Auth |
|-----|----------|-----------|------|
| DataForSEO Ranked Keywords | `https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live` | Jim | Basic auth |
| DataForSEO Competitors | `https://api.dataforseo.com/v3/dataforseo_labs/google/competitors_domain/live` | Jim | Basic auth |
| DataForSEO Bulk Volume | `https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live` | Jim, KeywordResearch | Basic auth |
| DataForSEO SERP Organic | `https://api.dataforseo.com/v3/serp/google/organic/live/regular` | Competitors | Basic auth |
| DataForSEO SERP Advanced | `https://api.dataforseo.com/v3/serp/google/organic/live/advanced` | Pam | Basic auth |
| DataForSEO Credits | `https://api.dataforseo.com/v3/appendix/user_data` | foundational_scout.sh | Basic auth |
| Anthropic API | `@anthropic-ai/sdk` via `scripts/anthropic-client.ts` | All generation phases | ANTHROPIC_API_KEY |
| OpenAI Embeddings | `openai` SDK via `src/embeddings/service.ts` | Phase 3c hybrid/shadow canonicalize | OPENAI_API_KEY |
| DataForSEO OnPage | `scripts/dataforseo-onpage.ts` | Dwight (Phase 1 only) | DATAFORSEO_LOGIN/PASSWORD |

## Claude Model Usage

| Phase | Agent | Model | Method | Purpose |
|-------|-------|-------|--------|---------|
| 0 | Scout | **haiku** + **sonnet** | `callClaude()` | Topic extraction (haiku) + scout report (sonnet) |
| 1 | Dwight | **sonnet** | `callClaude()` | AUDIT_REPORT.md [QA gated] |
| 2 | KeywordResearch | **haiku** + **sonnet** | `callClaude()` | Service extraction (haiku) + synthesis (sonnet) |
| 3 | Jim | **sonnet** | `callClaude()` | research_summary.md [QA gated] |
| 3c | Canonicalize (hybrid) | **haiku** + **sonnet** + OpenAI embeddings | `callClaude()` + `openai` SDK | Haiku classification + vector pre-clustering + Sonnet arbitration (batches of 40) |
| 4 | Competitors | **haiku** | `callClaude()` | Domain classification (small batches) |
| 5 | Gap | **sonnet** | `callClaude()` | Gap analysis JSON [QA gated] |
| 6 | Michael | **sonnet** | `callClaude()` | architecture_blueprint.md [QA gated] |
| QA | QA Agent | **haiku** | `callClaude()` | Phase evaluation against rubrics |
| — | Pam | **sonnet** | `callClaude()` | Content brief (metadata + schema + outline) |
| — | Oscar | **sonnet** | `callClaude()` | Production HTML from brief (65K tokens, streaming) |
| — | Cluster Strategy | **opus** | `callClaude()` | Strategic cluster analysis (on-demand, per-cluster) |

**SDK migration:** All phases use `@anthropic-ai/sdk` via `scripts/anthropic-client.ts`. Per-phase `max_tokens` configured in `PHASE_MAX_TOKENS` (e.g., sonnet phases: 16384, haiku phases: 4096, content: 65536, pam: 32768). Every `phase:` string passed to `callClaude()`/`callClaudeAsync()` must have an entry — missing phases silently fall through to the 8192 default and risk truncation. Requests with `max_tokens > 16384` automatically use streaming (`client.messages.stream().finalMessage()`). No more Claude CLI binary, env var stripping, or `stripClaudePreamble()`.

## Supabase Tables

| Table | Read By | Written By |
|-------|---------|------------|
| `audits` | All agents, all syncs | Jim, sync-jim, sync-michael, sync-dwight |
| `audits.client_context` (JSONB) | Settings page (dashboard reads/writes) | Settings page `useUpdateClientContext`. Pipeline reads from disk (`prospect-config.json`), not this column |
| `audits.canonicalize_mode` | — | All audits set to 'hybrid' (default). Column preserved but no longer read by pipeline code. |
| `audit_keywords` | Canonicalize, Competitors, Gap, sync-jim, sync-michael | KeywordResearch (INSERT, source='keyword_research'), sync-jim (DELETE+INSERT, source='ranked'), Canonicalize classify-keywords.ts (UPDATE classification fields), Canonicalize hybrid persist (UPDATE canonical fields + metadata), sync-michael (UPDATE silo) |
| `audit_clusters` | Gap, Michael, Clusters page (status + authority_score), Performance page (authority_score) | sync-jim (preliminary), rebuild-clusters Phase 3d (canonical, authoritative, preserves status/activation), generate-cluster-strategy.ts (status UPDATE → 'active'), deactivate-cluster (status UPDATE → 'inactive'), track-rankings.ts (authority_score UPDATE) |
| `audit_rollups` | — | sync-jim (preliminary), rebuild-clusters Phase 3d (canonical, authoritative) |
| `audit_assumptions` | sync-jim, rebuild-clusters, Settings page | Dashboard `useCreateAudit` (primary), `ensureAssumptions()` in sync (fallback from benchmarks), Settings page `useUpdateAssumptions` |
| `ctr_models` | sync-jim, rebuild-clusters | — (seeded) |
| `benchmarks` | `ensureAssumptions()`, Dashboard `useCreateAudit` | — (seeded) |
| `audit_snapshots` | Jim, Gap, sync-jim, sync-dwight, sync-michael | Jim, Dwight, Gap, sync-jim, sync-dwight, sync-michael |
| `agent_runs` | — | All generation agents |
| `audit_topic_competitors` | Competitors, Gap | Competitors (DELETE+INSERT) |
| `audit_topic_dominance` | Gap | Competitors (DELETE+INSERT) |
| `directory_domains` | Competitors | — |
| `agent_technical_pages` | — | sync-dwight (DELETE+INSERT) |
| `agent_architecture_pages` | Gap | sync-michael (DELETE+INSERT) |
| `agent_architecture_blueprint` | — | sync-michael (DELETE+INSERT) |
| `execution_pages` | sync-michael, Pam, Oscar | sync-michael (UPSERT), Pam (UPDATE → brief_ready), Oscar (UPDATE → review), sync-pam (UPSERT) |
| `baseline_snapshots` | sync-jim | sync-jim (UPSERT, first run only) |
| `audit_coverage_validation` | — | **DEPRECATED** — Validator (Phase 6.5) removed. Table preserved for historical data. |
| `prospects` | Scout | Scout (INSERT/UPDATE) |
| `pam_requests` | Pam | Dashboard (INSERT, status='pending') |
| `oscar_requests` | Oscar | Dashboard (INSERT, status='pending') |
| `client_profiles` | Pam, Oscar | Dashboard (manual) |
| `agent_implementation_pages` | — | sync-pam (DELETE+INSERT, legacy compat) |
| `cluster_strategy` | Cluster activation dashboard, Michael (entity_map, visibility_queries, search_intent), Pam (entity_map, visibility_queries) | generate-cluster-strategy.ts (UPSERT), rebuildClustersAndRollups (UPDATE status='deprecated', deprecated_at) |
| `embeddings` | Hybrid canonicalize (embedding cache) | `src/embeddings/service.ts` (UPSERT on content_type + content_id) |
| `ranking_snapshots` | Performance tab, ranking_deltas view | track-rankings.ts (UPSERT) |
| `cluster_performance_snapshots` | Performance page (authority trend chart), Clusters page (authority delta) | track-rankings.ts (UPSERT) |
| `page_performance` | Performance tab | track-rankings.ts (UPSERT) |

## Disk Artifact Reference

All paths relative to `audits/{domain}/`. Cross-phase reads use `resolveArtifactPath()` for date fallback.

| Path | Producer | Consumers |
|------|----------|-----------|
| `auditor/{date}/internal_all.csv` | Dwight | Jim (service pages), sync-dwight |
| `auditor/{date}/AUDIT_REPORT.md` | Dwight | KeywordResearch, Michael (platform section), sync-dwight |
| `auditor/{date}/*.csv` (~20 files) | Dwight | Dwight (prompt context) |
| `architecture/{date}/internal_all.csv` | Dwight (copy) | Michael |
| `research/{date}/keyword_research_raw.json` | KeywordResearch | — (debug) |
| `research/{date}/keyword_research_summary.md` | KeywordResearch | Jim |
| `research/{date}/ranked_keywords.json` | Jim | sync-jim, Michael |
| `research/{date}/competitors.json` | Jim | sync-jim |
| `research/{date}/research_summary.md` | Jim | sync-jim, Michael |
| `research/{date}/content_gap_analysis.md` | Gap | Michael |
| `architecture/{date}/architecture_blueprint.md` | Michael | sync-michael |
| `scout/{date}/scout-{domain}-{date}.md` | Scout | — (review) |
| `scout/{date}/scope.json` | Scout | KeywordResearch (optional priors) |
| `content/{date}/{slug}/metadata.md` | Pam | Oscar, sync-pam |
| `content/{date}/{slug}/schema.json` | Pam | Oscar, sync-pam |
| `content/{date}/{slug}/content_outline.md` | Pam | Oscar, sync-pam |
| `content/{date}/{slug}/page.html` | Oscar | — (review/publish) |
| `content/_debug/{slug}-oscar-raw.html` | Oscar | — (debug) |
| `configs/oscar/system-prompt.md` | Manual | Oscar |
| `configs/oscar/seo-playbook.md` | Manual | Oscar |

**Key source files (Phase 2 embedding infrastructure):**

| Path | Purpose |
|------|---------|
| `src/agents/canonicalize/hybrid/index.ts` | Hybrid canonicalize orchestrator (Stage 1 + Stage 2) |
| `src/agents/canonicalize/hybrid/pre-cluster.ts` | Stage 1: vector pre-clustering (thresholds, size gate, lock) |
| `src/agents/canonicalize/hybrid/arbitrator.ts` | Stage 2: Sonnet arbitration for ambiguous/new-topic/size-gated cases |
| `src/agents/canonicalize/hybrid/persist.ts` | Write hybrid results to audit_keywords (hybrid or shadow columns) |
| `src/agents/canonicalize/hybrid/types.ts` | TypeScript types: ClassificationMethod, VariantInput, PreClusterDecision, etc. |
| `src/agents/canonicalize/build-legacy-payload.ts` | Classification-only payload builder (canonical fields handled by hybrid persist) |
| `scripts/embed-keywords.ts` | Embed-at-ingestion: pre-warm embedding cache for audit keywords (Phase 2 + 3b) |
| `src/embeddings/service.ts` | Embedding service: OpenAI embed + Supabase cache + pgvector similarity |
| `src/embeddings/config.ts` | Embedding constants: model, dimensions, thresholds |
| `src/embeddings/hash.ts` | Content hash (SHA-256) for embedding deduplication |

**Migrations (Phase 2):**

| Migration | Purpose |
|-----------|---------|
| `scripts/migrations/016-findsimilar-hash-exclusion.sql` | Add `exclude_content_hash` param to `find_similar_embeddings()` RPC |
| `scripts/migrations/017-canonicalize-classification-metadata.sql` | Add `classification_method`, `similarity_score`, `arbitration_reason`, `canonicalize_mode` to `audit_keywords` |
| `scripts/migrations/018-shadow-canonicalize-columns.sql` | Add `shadow_canonical_key`, `shadow_canonical_topic`, `shadow_classification_method`, `shadow_similarity_score`, `shadow_arbitration_reason` to `audit_keywords` |

---

## Adding a New Pipeline Phase

1. Add a `runNewPhase()` function in `scripts/pipeline-generate.ts` following the existing pattern:
   - Gather context (disk files via `resolveArtifactPath()`, Supabase queries)
   - Build prompt string with "YOUR ENTIRE RESPONSE IS THE [X]" framing
   - Call `callClaude()` or `callClaudeAsync()` with appropriate model/max_tokens
   - Validate output with `validateArtifact()`
   - Write to disk in `audits/{domain}/{subdir}/{date}/`
2. Add the phase to `scripts/run-pipeline.sh` in the correct position
3. If the phase writes to Supabase, add a sync function in `scripts/sync-to-dashboard.ts`
4. If QA-gated, add a rubric in the `QA_RUBRICS` object (or, for checks that need no LLM judgment, add the phase to `DETERMINISTIC_ONLY_PHASES` + a block in `runDeterministicChecks()`) and a QA gate block in run-pipeline.sh with a `$(qa_feedback_arg <phase>)` retry
5. Update this file (PIPELINE.md) in the same commit — this is a contract, not optional documentation
