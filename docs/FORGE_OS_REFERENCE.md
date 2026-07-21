# Forge OS — System Reference

> **Purpose**: Context document for Claude projects that interact with Forge OS. Load this into any project where the assistant needs to understand what Forge OS is, how it works, and what architectural decisions govern it.
>
> **Owner**: Matt Edens, Forge Growth (forgegrowth.ai)
>
> **Last updated**: 2026-07-21 (replaces the 2026-06-03 System Reference)

---

## What Forge OS Is

Forge OS is an AI-powered SEO audit, content intelligence, and execution platform for local service businesses. It is the core product and delivery engine for Forge Growth, a search marketing agency. The system automates the reasoning layer of SEO — keyword research, gap analysis, site architecture, content production — plus the top of the sales funnel (autonomous prospect discovery, market intelligence reports, outreach drafting), so Matt's time goes to genuine marketing differentiation and closing, not commodity analysis.

Forge OS is not a SaaS product with self-serve users. It is an operator-directed platform: Matt runs audits and manages client delivery through the dashboard; clients receive the outputs (strategy briefs, architecture blueprints, content, reports) rather than operating the system directly. Prospects receive a public tokenized Scout report and a booking link — never dashboard access.

The pipeline is a sequenced chain of AI agents, each with a defined persona, input contract, and output contract. Agents read prior agents' artifacts and write their own. The system is deterministic where possible (revenue calculations, cluster aggregation, data joins, schema diffs, keyword identity) and uses LLMs only where semantic judgment is required (synthesis, classification, architecture decisions, content generation).

Since the June 2026 reference, three major capability areas shipped: (1) a full **prospecting motion** — Daily Prospector cron, Scout share lifecycle with expiry/attribution, Gmail outreach draft queue; (2) an **optimize path for established sites** — Page Optimizer worklist, single-page deep audits with code-verified schema diffs, cluster editability, cornerstone ingest; (3) a **hardened content factory** — QA feedback loops, embedding-grounded internal linking, coverage/density scoring, operator-directed content, KB analytics (proven ceiling, re-eval candidates, zero-click citation detection).

---

## SEO Philosophy

**Entity authority over keyword targeting.** The unit of optimization is the entity (business, service, program), not the keyword. Keywords are directional inputs within entity/topic maps. Clusters are geo-agnostic topical containers; geographic context lives in keyword-level data and schema markup, not cluster identity.

**Topical authority through cluster architecture.** Content is organized into silos (topic clusters) with commercial, transactional, and informational pages. Cluster activation (an explicit operator decision backed by an Opus-generated strategy document) gates content production, preventing undirected page creation.

**Schema as entity graph infrastructure.** Structured data is not a per-page compliance checkbox. Goals: `sameAs` linkage, `potentialAction` for agentic engagement, property saturation, cross-page entity consistency via `@id` references. Schema entity names must match page content entity names exactly.

**Agentic search readiness.** Pages are built for LLM extractability: self-contained sections, direct-answer openings (conditionally applied, not uniformly), attributive statements, entity clarity in the first 150 words. Page audits code-verify agent-readiness signals (robots.txt AI-bot rules, llms.txt, mcp.json, schema @graph).

**Empirical rankability over vendor difficulty scores.** The "proven ceiling" analysis computes the site's demonstrated KD ranking ceiling from keywords it already ranks 1–7 for, and that empirical bar — not domain rating — governs what Strategy Brief, Gap, and Michael treat as reachable. SERP composition analysis produces effective-KD verdicts (WITHIN_REACH / STRETCH).

**Revenue and business outcomes over search volume.** The pipeline computes revenue opportunity from keyword volume, CTR models, conversion rates, and contract values — and the math is deliberately honest. Grounded numbers double as prospect qualification: a market that models to $280/mo of addressable revenue is a poor-fit signal, not a pitch to inflate. Traffic metrics are never the terminal objective.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend (pipeline) | Node.js / TypeScript (ESM) on Railway (`forge-os-pipeline`, Railpack builder, Dockerfile.railway, port 3847) |
| Frontend (dashboard) | React 18 / Vite / TypeScript on Vercel (`forge-os-lovable` repo, local dir `lovable-repo/`) at app.forgegrowth.ai |
| Database | Supabase (PostgreSQL, RLS, Edge Functions, pgvector) — project ref `hohuimkcpihdufunrzvg` |
| Dashboard stack | React Router v6, TanStack Query v5, shadcn/ui + Tailwind, Recharts, react-hook-form + zod, Vitest |
| Embeddings | OpenAI `text-embedding-3-small` (1536-dim), cached in Supabase `embeddings` (pgvector, HNSW) |
| Keyword/SERP data | DataForSEO (OnPage crawl, ranked keywords, competitors, bulk volume, SERP, LLM Mentions, Business Data, instant_pages) |
| LLM inference | Anthropic API via `@anthropic-ai/sdk` (Haiku / Sonnet / Opus tiers; `callClaudeAsync` with per-phase max_tokens; streaming above 16K) |
| Google APIs | GSC + GA4 via service-account impersonation of `fg-analytics@` (no OAuth refresh tokens); Gmail via domain-wide delegation, `gmail.compose` scope only (drafts, never send) |
| Implementation agent | Claude Code (operates from `/home/forgegrowth` parent directory) |
| Architecture review | Claude chat (this context) |

**Deployment:** Both repos auto-deploy on push to `main` — Railway (pipeline) and Vercel (dashboard SPA, all routes rewrite to `/`). They are independent deployments. Supabase Edge Functions call the pipeline server via its public Railway URL with bearer-token auth (`PIPELINE_TRIGGER_SECRET`). Artifacts persist on a Railway volume at `/app/audits`; cron services have **no volume**, so DB fallbacks exist for everything they need (see Infrastructure Patterns).

---

## System Architecture

```
Dashboard (Vercel SPA)
  → Supabase Edge Functions (run-audit, pipeline-controls, scout-config, cluster-action,
     page-audit, share-audit, export-audit, manage-users, run-competitor-dominance)
    → Railway HTTP server (pipeline-server-standalone.ts, bearer auth)
      → shell orchestrator (run-pipeline.sh <domain> <email> --mode sales|full|prospect)
        → TypeScript phase generators (pipeline-generate.ts + standalone scripts)
          → artifacts on Railway volume (audits/{domain}/{area}/{date}/)
            → Supabase sync (sync-to-dashboard.ts) → dashboard reads tables
```

**Run tracking:** `pipeline_runs` powers a live 16-phase dashboard checklist. One run per domain enforced via an `inFlight` set (409 on concurrent triggers). Watchdogs kill pipeline runs at 3h and other jobs at 30 min; a reconciliation loop (startup + every 5 min) resets orphaned `running` rows across all job tables. The shell's ERR/TERM/INT trap marks failures in Supabase — `set -o errtrace` is load-bearing and must never be removed.

**Modes:** `full` (everything, optional Strategy Brief review gate), `sales` (skips Phases 4/4b/4c/5, adds a Revenue Opportunity section to the blueprint), `prospect` (Scout only, exits; converts to a full audit later). Failure resume via `--start-from`; review-gate resume must use `start_from='2'`.

---

## Pipeline Phases

| Phase | Agent / Name | Model | Purpose |
|-------|-------------|-------|---------|
| 0 | **Scout** (prospect mode only) | Haiku+Sonnet | DataForSEO market intelligence, no crawl: rankings-vs-opportunity gap matrix, honest revenue estimates, recipient-facing narrative + bridge line. Writes `prospects`, `scope.json` seeds Phase 2 after conversion. ~$2/run. |
| 1 | **Dwight** — Technical Audit | Sonnet | DataForSEO OnPage crawl → ~20 CSVs + 11-section `AUDIT_REPORT.md` with prioritized fixes. QA-gated. |
| 1a | Verify Dwight | none | Pure HTTP checks on Dwight's known blind spots (sitemap, schema presence, redirects, robots.txt AI-bot rules). Corrections merged at 6c. |
| 1c | GSC Data Fetch | none | 90-day Search Console per-URL pull → `gsc_page_snapshots`. Non-blocking if unconnected. |
| 1b | Strategy Brief | Sonnet | Visibility posture, entity-authority directive, architecture directive, risk flags. Consumed by Phase 2, Michael, Pam. Proven ceiling injected. Optional review gate pauses here (`awaiting_review`). |
| 2 | **KeywordResearch** | Haiku+Sonnet | Service × city × intent keyword matrix, volume-validated, evidence-based service expansion. Seeds `audit_keywords` (source='keyword_research'). Deterministic QA gate. |
| 3 | **Jim** — Research Analysis | Sonnet | DataForSEO rankings/competitors/volume/LLM mentions → research summary, ranked keywords, striking distance. Numeric dashboard fields computed deterministically from raw JSON (`research_data.json`), never parsed from LLM prose. QA-gated. |
| 3b | Sync Jim | — | Keywords → Supabase with revenue modeling; preliminary clusters/rollups; LLM visibility + baseline snapshots; authoritative embedding pass. |
| 3c | Canonicalize (hybrid) | Haiku+Sonnet | Haiku classifies (intent_type, entity type, brand, near-me); OpenAI embeddings pre-cluster at 0.82 similarity with N=3 gate and prior-assignment locking; Sonnet arbitrates ambiguous cases. Canonical keys are geo-agnostic. Hybrid is the only mode. |
| 3d | Rebuild Clusters | — | DELETE+INSERT on clusters/rollups from canonical data. Preserves activation status, manual/edited/structural clusters; empty-rebuild guard; deprecates strategies for dissolved clusters. |
| 4 | **Competitors** | Haiku | SERP dominance per topic → `audit_topic_competitors` / `audit_topic_dominance`. Aggregators pre-filtered. Skipped in sales mode. |
| 4b | Section Extraction | none | Competitor H2/H3 coverage per topic via embeddings → cluster `coverage_score`. Skipped in sales mode. |
| 4c | Density + Cannibalization | none | Keyword-coverage `density_score` per cluster; client page pairs >0.90 cosine flagged as cannibalization warnings. Skipped in sales mode. |
| 5 | **Gap** — Competitive Gap Analysis | Sonnet | Authority/format/unaddressed gaps, AI citation gaps, SERP-composition effective-KD verdicts. QA-gated. Skipped in sales mode. |
| 6 | **Michael** — Architecture Blueprint | Sonnet | Entity-authority silo architecture (3–7 silos, page tables, cluster keys, internal linking, entity map). Binding operator directives from `audit_strategy_constraints`; cornerstone anchors; prior-architecture diff mode on re-runs. Geo granularity is city/county/state per market. QA-gated. |
| 6b | Sync Michael | — | Blueprint → `agent_architecture_pages`, blueprint table, `execution_pages` (UPSERT protecting committed/locked/disposed rows). Re-run-aware (first_run / strategic_rerun / failure_resume). |
| 6c | Sync Dwight | — | Crawl + report → Supabase with 1a corrections merged; mechanical per-page `optimization_score` for the Page Optimizer worklist. |
| 6d | Local Presence | none | GBP lookup + 11-directory citation scan with NAP comparison (~$0.026/audit). `manual_override` preserves user edits. Non-fatal QA gate. |
| — | Client / Prospect Briefs | Sonnet | Auto-generated self-contained HTML intelligence briefs matching the Forge Growth design system. |

**QA system:** 7 gated phases (1, 1b, 2, 3, 5, 6, 6d). Haiku evaluates rubric phases against `QA_RUBRICS`; KeywordResearch and Local Presence gates are deterministic-only. FAIL → one retry with structured `--qa-feedback` injected; second FAIL halts the pipeline (6d is warning-only). ~$0.005/eval.

---

## Content Factory (on-demand, request-table driven)

- **Cluster Strategy** (Opus — the only Opus call in the system, ~$0.15–0.50/cluster): triggered by operator cluster activation. Entity map, buyer journey, visibility queries, search intent, recommended pages → `cluster_strategy`; pages inserted into `execution_pages`.
- **Pam — Content Brief** (Sonnet, polls `pam_requests`): metadata + JSON-LD schema + outline with entity-first context ordering, information-gain directive, embedding-verified internal-link candidates, GSC position-band link routing, BoF length directive. Drain-loops until the queue is empty (queuing N pages in a burst is safe). Falls back to DB context (`audit_snapshots`, `agent_architecture_blueprint`) when disk artifacts are absent.
- **Oscar — Content Production** (Sonnet, 65K tokens streaming, polls `oscar_requests`): production semantic HTML from Pam's brief. Governed by a **dual-file contract** — `configs/oscar/system-prompt.md` AND `seo-playbook.md` must be checked together for contradictions on any prompt change. Conditional AI-optimization patterns, slop-scan rewrite pass, deliberately tool-free.
- **Operator-directed content:** dashboard dialog writes `execution_pages` (`source='operator'`) + `pam_requests` with `operator_notes` injected as OPERATOR DIRECTIVES — same lifecycle as pipeline pages, no separate orchestration.
- **Page lifecycle:** `not_started → brief_ready → draft_ready → in_review → published` (+ `deprecated`). Dashboard maps Oscar's `in_progress` write to "Draft Ready". Publishing is manual; `published_url` capture feeds performance tracking.
- **Page Audit deep dive** (`audit-page.ts`): single-URL fetch + parse, mechanical scoring, code-verified agent-readiness checks, GSC context, one Sonnet call. Schema proposals ship with a **code-computed entity-by-entity diff** against the live JSON-LD (preserved/added/modified/removed) so removals surface as sign-off warnings — preservation is enforced in code, not prompt-asserted.

**Agent prompts** live in `configs/agents/{agent}/system-prompt.md`, loaded via `readFileSync` + `.replaceAll()` interpolation. Tier 2/3 agents (Jim, Competitors) remain inline.

---

## Prospecting Motion (Scout → Share → Outreach)

- **Daily Prospector** (`cron-prospector.ts`, separate Railway cron service, no volume, ~$1–3/day): rotating DataForSEO SERP discovery over seeded verticals × Matt's target footprint (Idaho incl. Nampa/Caldwell, eastern OR/WA, western MT/WY, northern UT; Boise/Meridian and SLC excluded as agency-saturated) → Haiku qualification (0–100; hard zeros for franchises/aggregators) → top 3/day get a Sonnet-authored prospect config, full Scout run, contact discovery, and an outreach draft → morning Gmail digest to Matt. Full-auto to drafts by design — the digest is the safety net, not a pre-approval gate. Lifecycle in `prospect_candidates` (permanent dedup).
- **Keyword identity hygiene** (2026-07-20): one canonical key function (`canonicalKeywordKey()` — state-strip anywhere, stemming, token sort) plus a cross-set embedding join (0.93 cosine) governs ranked-vs-opportunity matching, so word-order/morphology variants can never be reported as "gaps" the prospect can refute. Direction of error is deliberately conservative: over-merging understates the pitch.
- **Revenue grounding:** owner-provided value → web-search-grounded market estimate (cached in `market_value_estimates`, 180-day freshness) → vertical benchmark → suppressed. `addressable_revenue_monthly` doubles as the qualification fit signal ($2,500/mo gate → full pitch vs courtesy note).
- **Share lifecycle** (shipped 2026-07-13): `share_token` → public route `/share/scout/:token` (design-system template, positioning layer, bridge line), 14-day expiry (410 after; "Mark Sent" restarts the clock), view + booking-intent logging (timestamps are source of truth — no status enum), `/book/scout/:token` → Matt's calendar. noindex/no-referrer headers on share/book routes. The internal 7-section Scout markdown is super-admin-only and never leaks to recipients.
- **Outreach is draft-only, permanently:** `generate-outreach-email.ts` creates Gmail drafts in Matt's account (one-link rule: share URL exactly once). **No send call exists anywhere in the codebase.** Human review is the product — Matt sends manually. Conversion: dashboard converts prospect → audit → normal full pipeline.

---

## Tracking & Analytics Subsystems

- **Performance tracking:** weekly cron (`cron-track-all.ts`) runs rankings + GSC for all tracking-enabled audits (6-day recency guard); monthly LLM-mention cron (25-day guard); monthly GSC snapshot cron (3rd, 6am UTC — GSC finalization window). Tables: `ranking_snapshots`, `cluster_performance_snapshots` (authority score + delta), `page_performance` (rank + GA4 behavior), `gsc/ga4_page_snapshots`, `ga4_event_snapshots`.
- **Tracking health:** `analytics_connections.status` is the on/off gate ONLY; transient failures write a source-prefixed `error_message` and leave status `active` so the next cron self-heals. A zero-metric health check catches silent tracking death.
- **LLM visibility:** cluster-aware mode queries up to 40 `visibility_queries` from active cluster strategies (~$18/domain/month) with a top-keyword fallback → `llm_visibility_snapshots` + qualitative `llm_mention_details`.
- **KB Analytics Layer** (on-demand, read-only, artifact-only output to `audits/{domain}/analysis/` — deliberately no DB tables until thresholds are validated): `compute-proven-ceiling.ts` (empirical KD ceiling), `detect-reeval-candidates.ts` (NavBoost re-evaluation → republish under new URL + 301), `detect-llm-citation-queries.ts` (GSC zero-click fan-out signature for LLM citation detection).

---

## Model Allocation Policy

| Tier | Model | Use cases |
|------|-------|-----------|
| Haiku | Classification, batching, validation | Canonicalize classification, Competitors, QA gates, prospect qualification, service/keyword extraction, contact discovery |
| Sonnet | Synthesis and generation with large context | Dwight, Jim, KeywordResearch, Gap, Michael, Pam, Oscar, Scout, Strategy Brief, briefs, outreach, page audit, canonicalize arbitration |
| Opus | Strategic judgment with high downstream cost | Cluster Strategy only — misdirected strategy cascades into weeks of wasted content production |

Always pass `phase` to `callClaudeAsync(prompt, { model, phase })` so per-phase max_tokens applies (content = 65,536; streaming auto-engages above 16K).

---

## Key Infrastructure Patterns

- **Artifact resolution:** `resolveArtifactPath()` tries today's date, then falls back to the most recent dated directory.
- **DB fallbacks for volume-less services:** cron services and local runs don't share the main service's volume. Pam falls back to `audit_snapshots` (strategy brief markdown, Jim data) and `agent_architecture_blueprint`; `/scout-report` falls back to `prospects` columns. Any new consumer of disk artifacts must consider this.
- **Prompt framing:** all agent calls use "YOUR ENTIRE RESPONSE IS THE [CONTENT]" framing; `validateArtifact()` strips preamble and rejects narration patterns (`/^I'll /`, `/^Let me /`, …).
- **Overlay-input pattern** for user data that must survive delete+reinsert syncs: `cornerstone_pages`, `assignment_locked`, `page_dismissals` (dismiss-don't-delete — crawl truth is never destroyed), `citation_snapshots.manual_override`, cluster `is_manual`/`edited_at`/`is_structural`.
- **Source preservation:** sync-jim's DELETE preserves `source='keyword_research'` rows; syncMichael protects committed/locked/disposed `execution_pages`.
- **PostgREST max-rows=1000:** silent truncation risk on every large fetch — use `.range()` pagination.
- **RLS silent failure:** PostgREST returns 200 with 0 affected rows when RLS blocks a write. Verify policies (via `pg_policies`) before adding any dashboard mutation.
- **Fail loud:** errors surface immediately; watchdogs + reconciler + shell traps guarantee no run stays `running` forever.
- **Disk-first analytics:** new analytics ship artifact-only until thresholds are validated, then earn DB tables.

---

## Database Architecture (Supabase)

Three writer identities: **pipeline** (service_role from Railway), **dashboard** (authenticated user under RLS), **edge functions** (service_role, mostly super-admin-validated; two `scout-config` actions are deliberately unauthenticated token-gated share endpoints). Direction rule: dashboard reads directly; pipeline writes. Sanctioned dashboard writes only: audit creation, client context, assumptions, execution page status/assignment/disposition, cluster edits, cornerstone pages, dismissals, strategy constraints.

Core tables (see DATA_CONTRACT.md for the full schema):

| Table | Purpose |
|-------|---------|
| `audits` | One row per audit: status, mode, geo config, client_context JSONB, snapshot staleness timestamps. |
| `audit_keywords` | All keywords: rank, volume, KD, canonical_key/topic, classification, revenue deltas. (`intent` column deprecated → `intent_type`.) |
| `audit_clusters` / `audit_rollups` | Topic clusters + aggregates: revenue (TAR primary), activation, coverage/density scores. Rebuilt in 3d with preservation flags. |
| `audit_assumptions` | CR/ACV/CTR/tar_position assumptions + GA4-observed CR (opt-in). |
| `pipeline_runs` | Per-phase run progress; powers the live checklist. |
| `audit_snapshots` | Polymorphic agent-output JSONB (dwight, jim, gap, strategy-brief) — also the DB fallback source. |
| `execution_pages` | Content queue: Pam/Oscar outputs, lifecycle status, dispositions, `published_url`. `canonical_key` is the contractual join to clusters. |
| `pam_requests` / `oscar_requests` / `page_audit_runs` | Job queues: dashboard inserts pending, pipeline completes, dashboard polls 3s. |
| `cluster_strategy` | Opus strategy per activated cluster (entity map, buyer journey, visibility queries). |
| `agent_technical_pages` / `agent_architecture_pages` / `agent_architecture_blueprint` | Dwight worklist rows / Michael page rows / blueprint markdown. |
| `embeddings` | pgvector cache (content-hash keyed, HNSW, `find_similar_embeddings` RPC). Service-role only. |
| Snapshot tables | `ranking_`, `baseline_`, `cluster_performance_`, `gsc_page_` (stores **paths**, not URLs), `ga4_page_`, `ga4_event_`, `llm_visibility_`, `gbp_`, `citation_snapshots`. |
| `prospects` / `prospect_candidates` / `market_value_estimates` | Prospect lifecycle + share lifecycle; Prospector discovery/dedup queue; grounded ACV cache. |
| `analytics_connections` | GSC/GA4 connection per audit; status gate + error_message health signal. |
| `benchmarks` / `ctr_models` / `client_profiles` | Read-only reference data + brand voice. |

**Migrations:** sequential `scripts/migrations/NNN-name.sql` with matching rollback files, executed via the Supabase **Management API** (the installed CLI has no `db query`). Latest: **047** (share lifecycle). Live schema has known drift from migration files — always verify live state before writing SQL, and new tables need explicit GRANTs + RLS enable.

---

## Dashboard (forge-os-lovable)

React SPA at app.forgegrowth.ai. Auth via Supabase (roles: super_admin, admin, user, temp).

| Surface | What it does |
|---------|-------------|
| `/audits`, `/audits/new`, `/audits/:id/running` | Audit list, creation, live 16-phase run progress. |
| Audit detail: `overview`, `research`, `audit`, `page-audit`, `local-presence`, `strategy`, `clusters`, `execution`, `performance`, `ai-visibility`, `report`, `settings` | Phase outputs: technical worklist (Page Optimizer + dismissals), strategy brief + constraints + cornerstone upload, cluster activation/editing, content execution board (draft HTML editor, review banner, publish dialog, operator page dialog), GSC/GA4 performance reporting, LLM visibility, client report. |
| `/scout`, `/scout/new`, `/scout/:id` | Prospect dashboard, new scout, internal report viewer (admin+). |
| `/share/scout/:token`, `/book/scout/:token`, `/share/:token` | Public tokenized prospect report, booking redirect, shared audit report — no auth. |
| `/reports`, `/reports/performance/:auditId`, `/reports/:slug` | Reports hub, standalone performance report, registry-driven bespoke client reports (access-gated per user). |
| `/admin/users`, `keyword-lookup` | User management, ad-hoc paid keyword lookups (super_admin). |

Edge functions called: `pipeline-controls` (most controls), `scout-config`, `share-audit`, `cluster-action`, `run-audit`, `run-competitor-dominance`, `page-audit`, `manage-users`, `export-audit`.

---

## Operational Patterns

- **Claude Code workflow:** Claude Code plans are shared to Claude chat for independent architectural validation before execution. Corrections are directional and architectural, not tactical.
- **Documentation-first:** PIPELINE.md (phase contract), DATA_CONTRACT.md (table ownership), DECISIONS.md (why non-obvious choices were made), FOLLOWUPS.md (sized backlog), CLAUDE.md, and MEMORY.md are maintained every session. Docs update in the same commit as the change they describe.
- **Debugging:** confirm the root-cause hypothesis with Matt before implementing a fix; when he redirects, fully abandon the prior hypothesis.
- **Migrations:** verify live schema first (Management API), show the verification output, run the migration, confirm with a follow-up query.
- **Pre-change snapshots:** classification-affecting changes require before/after snapshots — metric shifts may be error-profile improvements, not regressions.
- **Client data accuracy:** never fabricate client-specific data (services, certifications, service areas). Ask or read a verified source.

---

## Design Principles

- **Structural coherence over tactical completeness.** Good architectural framing over micromanaged prompts.
- **Conditional application over universal mandates.** AI-optimization patterns, geographic rules, and content-effort dimensions are conditionally injected, never uniform — prevents "everything becomes a template."
- **Preservation in code, not prompts.** Anything that must survive (user edits, live schema data, activation state) is enforced by deterministic code (overlay tables, diff guards, preservation flags), never by asking an LLM to be careful.
- **Strategy brief authority is two-tier.** Binding constraints ("do not / avoid / must not") override structured data; strategic framing is advisory.
- **Geographic architecture:** service is the primary container, location the qualifier (`/services/{service}/{city}`); geo tier (city/county/state) is chosen per market; near-me slugs prohibited universally. Operator decisions override pipeline defaults (e.g., Weiser uses county pages).
- **Human-in-the-loop where reputation is at stake.** Outreach never sends autonomously; content publishing is manual; schema removals require sign-off.
- **Honest math is a feature.** Conservative revenue estimates build credibility and qualify prospects simultaneously.

---

## What Forge OS Cannot Do

- **Execute changes on client sites.** It produces recommendations, blueprints, briefs, and content HTML. Publishing, DNS, and CMS work are manual or via separate tooling (e.g., Claude Code site builds).
- **Send email.** Outreach exists only as Gmail drafts — by design, permanently.
- **Self-serve for clients.** No client login; clients and prospects receive outputs and tokenized share pages.
- **Real-time monitoring.** Rankings/GSC are weekly, LLM mentions monthly. No continuous SERP alerting.
- **Paid search management.** Google Ads is managed separately.
- **Multi-tenant scale.** RLS provides row security, but the system is designed for a single operator with a small roster.
- **Informational keyword pipeline.** Jim stays commercial/transactional to keep the revenue model clean; informational expansion remains an identified gap.

---

## Current Clients & Engagements

- **Active client:** Justin — IMA / SMA (Idaho Medical Academy, Summit Medical Academy), multi-state vocational training; flat monthly fee including Google Ads.
- **Pro-bono / case study:** Weiser Towing & Auto Repair (Mike) — Next.js rebuild driven by Forge OS outputs; doubles as a toolchain stress test.
- **Top of funnel:** Daily Prospector runs autonomously across Matt's target footprint; drafted outreach awaits manual send. (4-week kill criterion in effect from 2026-07-08.)

---

## Known Open Items

- **Hardening plan** (`forge-os-pipeline/tmp/forge-hardening-plan.md`): H1 conversion-rate anomaly (GA4 keyEvents inflation — CRITICAL), H2 recovery fire drill (CRITICAL), H3 QA visibility/alerting (no dashboard reader for `audit_qa_results`), H4 `intent` → `intent_type` migration + types regen, H5 dashboard tests/durability.
- **Optimize-mode Phase 2** (`docs/plans/optimize-mode-phase2.md`): `action_required='optimize'` pages currently dead-end — Page Optimizer shipped the foundation, not the content path.
- FOLLOWUPS.md backlog: coverage-assessment false positive (S), dashboard reader audit for `intent` drop (M), Pam dual-parent pages (M).
- Never exercised live: failure-resume on a real failure, LLM-rubric QA retry.
- Prospector configs for cron-scouted prospects live only in digest emails (ephemeral disk) — worth persisting to a `prospects` column.
