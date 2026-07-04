# Phase 2: Optimize-Mode Content Path

> **Status:** PLANNED — not started. Foundation shipped 2026-07-04 (page auditor, topic-first cluster editability, cornerstone ingest — see DECISIONS.md 2026-07-04). This document is the follow-on plan.

## The gap this closes

The pipeline is **creation-biased**. Michael classifies pages `create` / `optimize` / `differentiate` (`blueprint-parse.ts`, priority mapping in `sync-to-dashboard.ts`), but the content factory has exactly one behavior: write from scratch (`full` or `starter` mode — both creation). `action_required='optimize'` rows dead-end. For established sites — the ones where topical-authority and AI-visibility fortification matter most — the system produces a queue it can't process.

## What Phase 1 already provides (inputs to this phase)

| Foundation | Provides |
|---|---|
| `agent_technical_pages.optimization_profile/score` (migration 037) | Site-wide mechanical worklist — which existing pages need work, and what kind |
| `page_audit_runs.findings` (migration 037) | Per-page deep-dive: exact metadata/header/alt/internal-link/@graph/agent-readiness recommendations, incl. complete proposed JSON-LD |
| `src/agents/page-audit/fetch-page.ts` | Live-page content extraction (the "current state" input an optimizer needs) |
| `cornerstone_pages` (migration 039) | Human ground truth on what exists and matters |
| `assignment_locked` / `is_manual` / `edited_*` (migration 038) | Human steering that survives re-runs |

## The build

**1. Optimize-mode brief (Pam).** New brief path for `action_required='optimize'` pages: input = current page content (via `fetch-page.ts`) + `page_audit_runs.findings` (run one automatically if absent) + cluster/entity context. Output = a REVISION brief: keep/change/add sections, entity enrichment for the @graph, fan-out coverage gaps within the page's topic (`cluster_section_coverage` is the scoring hook), header restructuring. Not a from-scratch outline.

**2. Optimize-mode content (Oscar).** Given the revision brief + current HTML, produce revised content that preserves what works (URLs, ranking sections, brand voice) and changes what the brief directs. Output shape TBD: full replacement HTML vs. sectioned diff — decide with Matt (client CMS workflows matter here).

**3. Queue wiring.** `execution_pages` rows with `action_required='optimize'` get an "Optimize" action in the Content Factory instead of dead-ending; status flow reuses the existing brief_ready → draft_ready path. `page_mode` gains a third value or a parallel `content_mode: 'revise'` marker (decide: page_brief field, no migration — same reasoning as page_mode, DECISIONS 2026-06-12).

**4. Fan-out coverage input.** `cluster_strategy.visibility_queries` + `ai_optimization_targets` already exist per topic. The optimize brief should check the page against its topic's query fan-out and list unanswered queries as sections to add. This is the "query fan-out coverage" lever Matt named.

## Open questions for Matt before building

1. Revision output format: full replacement HTML, or a change-list the operator applies manually in the CMS?
2. Should optimize-mode auto-run a `page_audit_runs` deep dive per page (≈1 Sonnet call each), or require one to exist?
3. Batch ergonomics: "optimize all pages in this topic" vs one at a time?

## Explicitly out of scope (deeper rabbit holes, deliberately deferred)

- First-class entity graph store (entities as rows, relations as edges) — layers onto `canonical_key` + `entity_map` later without rework
- Generated per-topic query fan-out sets beyond what cluster_strategy already emits
- Cross-platform entity consistency scoring (Aleyda "Consistent" beyond NAP)
