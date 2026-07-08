# Michael Feedback Loop + Architecture Resilience — Integrated Cross-Repo Plan

**Status:** 📋 PLANNED — awaiting approval. Nothing implemented.
**Date:** 2026-07-08. All schema facts below verified against the live DB via Management API on this date; all code anchors verified against working trees.
**Origin:** Weiser Towing incident (see `weiser-architecture-revert-and-iscommitted-bug.md`) — county pages invisible in production queue, deprecation permanent, no way to give Michael durable strategic feedback.

## Goals (Matt's requirements, verbatim intent)

1. Pages not assigned a cluster must be accessible in the content production queue, OR every recommendation must be assigned to a cluster. (Both — belt and suspenders.)
2. Michael must receive feedback: content recommendations can be rejected/deferred with a reason, hidden but not deleted, and Michael must not keep re-proposing them.
3. Re-runs must take updated info in, adjust IF needed, and protect previous architecture decisions — not a brand-new run each time.

## Four mechanisms

| # | Mechanism | Summary |
|---|---|---|
| 1 | Operator strategy constraints | `audit_strategy_constraints` table → `OPERATOR STRATEGY DIRECTIVES` block in Michael's prompt (every run) + settings-page editor UI |
| 2 | Recommendation dispositions | `operator_disposition`/`disposition_reason`/`disposition_at` on `execution_pages`; sync treats disposed pages as immovable; rejected reasons → `REJECTED RECOMMENDATIONS` prompt block; dashboard hidden lane |
| 3 | No orphan pages | Blueprint declares a Cluster Key per page; Michael-declared structural clusters upserted (`is_structural=true`) and rebuild-proof; dashboard Unassigned bucket on /execution |
| 4 | Diff-mode re-runs | Previous architecture injected as baseline with preserve-unless-justified instruction; `isCommitted` fixed so deprecated pages revive when re-added |

---

## Contract mismatches found during integration (resolved in this plan)

1. **Structural-cluster wipe (pipeline↔pipeline):** structural clusters are inserted by syncMichael (Phase 6b) but the destructive rebuild lives in syncJim's `rebuildClustersAndRollups` — deletes `.eq('is_manual', false)` at `sync-to-dashboard.ts:835` and `:1174`. → Both deletes gain `.eq('is_structural', false)`; preserve-maps already key off surviving rows.
2. **share-audit leak (edge↔schema):** `share-audit/index.ts:217` selects `execution_pages` with no status/disposition filter → rejected pages would appear in public share payloads. → Add disposition filter.
3. **Content-generation gating (edge↔pipeline):** `pipeline-controls` `generate_content` sends only `{domain}`; disposed-page exclusion is only enforceable in the pipeline's page-selection query. → Pipeline-side guard (exact query located during implementation; verification item V6).
4. **Diff-mode payload (edge↔pipeline):** `cluster-action` refresh body is hardcoded `{domain, email}`. → Diff-mode is the **default** strategic_rerun behavior, not a flag. **No edge change needed.**
5. **Michael 16K output ceiling (prompt size):** full previous-blueprint injection risks output truncation (pre-flight retry at `pipeline-generate.ts:3055-3081` exists because of this). → Slim baseline (page table from `agent_architecture_pages` + executive summary, not full markdown) + bump michael `PHASE_MAX_TOKENS` 16384→32768 (`anthropic-client.ts:28`).
6. **Dashboard status filter (dashboard↔schema):** `useExecutionPages` filters only `.neq('status','deprecated')` — disposition is orthogonal, so disposed rows keep flowing to the client. → Intentional: hidden lane partitions client-side (matches cluster `status='hidden'` lane pattern, not the `page_dismissals` overlay-table pattern).
7. **`clusterOnly` invisibility (dashboard):** `/execution` defaults `clusterOnly=true` keeping only `cluster_active || source==='operator'` (`ExecutionPage.tsx:165,197`) — this, plus NULL `canonical_key`, is what hid the county pages. → Unassigned bucket rendered regardless of the toggle.
8. **DECISIONS.md contradiction:** entry at ~263-265 claims syncMichael status protection is "already comprehensive" — the isCommitted fix supersedes it. → Superseding decision entry required.
9. **Types:** no codegen; dashboard types hand-maintained in `src/types/database.ts` (execution_pages Row at 758-828). Pipeline uses `(sb as any)` casts throughout — no pipeline type changes needed.

---

## Schema (Migration 044) — verified against live DB 2026-07-08

Facts: `audit_strategy_constraints` does not exist (only `cluster_strategy` matches `%strateg%`); `execution_pages` has no disposition columns; `status` is TEXT + CHECK (8 values incl. `deprecated`), `source` is TEXT with **no** constraint (live values: michael 526, cluster_strategy 68, operator 1); `audit_clusters` has `is_manual` but no structural marker; its only NOT-NULL-without-default columns are `audit_id`, `topic`; `audits.id` is uuid.

**File:** `scripts/migrations/044-strategy-constraints-dispositions-structural.sql` + `-rollback.sql`

```sql
-- (1) audit_strategy_constraints
CREATE TABLE IF NOT EXISTS public.audit_strategy_constraints (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id     UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  directive    TEXT NOT NULL,
  reason       TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_strategy_constraints_audit
  ON public.audit_strategy_constraints (audit_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_strategy_constraints TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_strategy_constraints TO service_role;
ALTER TABLE public.audit_strategy_constraints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_audit_strategy_constraints"
  ON public.audit_strategy_constraints FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Granted users can view audit_strategy_constraints"
  ON public.audit_strategy_constraints FOR SELECT TO authenticated
  USING (public.can_view_audit(audit_id));
CREATE POLICY "audit_owner_write_audit_strategy_constraints"
  ON public.audit_strategy_constraints FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.audits WHERE audits.id = audit_strategy_constraints.audit_id AND audits.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.audits WHERE audits.id = audit_strategy_constraints.audit_id AND audits.user_id = auth.uid()));

-- (2) execution_pages dispositions (CHECK passes on NULL = "no disposition")
ALTER TABLE public.execution_pages
  ADD COLUMN IF NOT EXISTS operator_disposition TEXT CHECK (operator_disposition IN ('rejected','deferred')),
  ADD COLUMN IF NOT EXISTS disposition_reason TEXT,
  ADD COLUMN IF NOT EXISTS disposition_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_execution_pages_disposition
  ON public.execution_pages (audit_id, operator_disposition) WHERE operator_disposition IS NOT NULL;

-- (3) audit_clusters structural marker (Michael-declared; distinct from is_manual = human-created)
ALTER TABLE public.audit_clusters
  ADD COLUMN IF NOT EXISTS is_structural BOOLEAN NOT NULL DEFAULT false;
```

Rollback: drop index, drop 3 columns, drop `is_structural`, drop table (policies cascade).

**Semantics decision:** `is_manual` keeps meaning "human created via dashboard"; `is_structural` means "Michael-declared, no keyword backing." Both survive Phase 3d rebuilds. Not mutually exclusive in the schema; in practice a cluster is one or the other.

---

## Pipeline changes (`forge-os-pipeline`)

### P1. `scripts/rerun-utils.ts:13-21` — isCommitted fix (Option 2, predicate)
```ts
(page.status !== 'not_started' && page.status !== 'deprecated') ||
page.source === 'cluster_strategy' || page.source === 'manual' ||
page.published_at != null;
```
All four call sites verified safe: `sync-to-dashboard.ts:2366` (the bug — deprecated pages now fall through to the revive branch), `:2409` (stale loop — deprecated stale page now falls to the else… **guard needed**: the else writes `status='deprecated'`, a no-op on already-deprecated rows, but keep it a no-op by leaving as-is), `:2435` (deprecation-candidates — already-deprecated candidate now skipped: fine), `pipeline-generate.ts:2795` (COMMITTED ARCHITECTURE table stops telling Michael to preserve dead pages: improvement).

### P2. `scripts/sync-to-dashboard.ts` — disposition immovability + structural clusters + declared keys
- **`:2337` select:** add `operator_disposition, disposition_reason, disposition_at, canonical_key` to the strategic_rerun existing-pages read.
- **Page loop (~2358):** new **first** guard (before `assignment_locked`): `if (existing?.operator_disposition) → update snapshot_version only, count dispositionSkipped`. Disposed pages are never revived, re-homed, or brief-updated.
- **Stale loop (~2402):** disposed → preserve (never stale-deprecate); insert guard before the `isCommitted` check.
- **Deprecation-candidates loop (~2429):** skip disposed (alongside the operator-source skip at 2431).
- **first_run/failure_resume path (`:2455-2477`):** mirror the disposition guard (select at 2457 gains the column).
- **canonical_key backfill (`:2482-2506`):** WHERE gains `operator_disposition IS NULL` (alongside `assignment_locked=false`).
- **Declared cluster key:** page upsert branches set `canonical_key` + `cluster_active` from `ArchPage.cluster_key` when present (backfill remains fallback for pages without a declared key).
- **Structural-cluster upsert (new, in syncMichael):** collect declared keys absent from `audit_clusters` → insert `{audit_id, topic, canonical_key, canonical_topic, status:'inactive', is_structural:true, primary_entity_type}` (only `audit_id`+`topic` are NOT-NULL-no-default; rest defaults).
- **Rebuild survivability:** `:835` and `:1174` deletes gain `.eq('is_structural', false)`.

### P3. `src/pipeline/blueprint-parse.ts` — Cluster Key column
- `ArchPage` (11-23): add `cluster_key?: string`.
- Column detection (134-147): new detector for header `cluster key|topic key|canonical key` — **ordering caveat:** current `silo/cluster` detector would swallow a "Cluster Key" header; the new detector must run before it (same pattern as the existing `coverage`-before-`role` fix).
- Row build (175-185): emit normalized snake_case key. Backward compatible: column absent → field undefined → old behavior.

### P4. `scripts/pipeline-generate.ts` — three new prompt blocks
- **OPERATOR STRATEGY DIRECTIVES** (mechanism 1): read `audit_strategy_constraints` where `active=true`; build block; push into `contextBlockParts` next to the strategyBrief block (~2991). **Unconditional** — applies on first runs too. Framed as binding constraints: "These override data-driven preferences. Do not propose architecture that violates them."
- **REJECTED RECOMMENDATIONS** (mechanism 2): inside `rerunBlock` (2789-2910); read from the `:2793` select (add `operator_disposition, disposition_reason, disposition_at` to it); table `url_slug | silo | reason | rejected_at`; instruction: do not re-propose these pages or near-equivalents.
- **PREVIOUS ARCHITECTURE BASELINE** (mechanism 4): inside `rerunBlock`. Slim: silo→pages table from `agent_architecture_pages` + `executive_summary` from `agent_architecture_blueprint` (both still hold the prior run's rows at generate time — sync deletes them only in Phase 6b, which runs after Phase 6; ordering verified in `refresh-architecture.ts:62-66`). Instruction: "This is your previous architecture. Preserve it unless current data justifies a change. Every removal or silo re-home must be listed in a `## Changes From Previous` section with a reason."
- **max_tokens:** `PHASE_MAX_TOKENS` michael 16384 → 32768 (`scripts/anthropic-client.ts:28`).

### P5. `configs/agents/michael/system-prompt.md`
- Add Cluster Key column to the required silo-table format: every page row must declare a key — either an existing keyword-cluster `canonical_key` (list provided in context) or a declared structural key (e.g. `service_area`) for silos with no keyword backing.
- Add `## Changes From Previous` section requirement (re-runs).
- Placeholders for the new blocks if the template needs explicit tokens (they ride `{{CONTEXT_BLOCKS}}`/`{{RERUN_SECTION}}` otherwise).

### P6. Content-generation gating (verification item V6)
Locate the page-selection query behind `/generate-content` and add `operator_disposition IS NULL` (rejected AND deferred pages are excluded from production).

---

## Edge function changes (`lovable-repo/supabase/functions/`)

Only one: **`share-audit/index.ts:217`** — filter `execution_pages` select with `.is('operator_disposition', null)` (or `.neq('operator_disposition','rejected')` if deferred pages should still appear in shares — default: exclude both). No other edge changes; dispositions and constraints are direct-RLS table access per the established `page_dismissals` precedent.

---

## Dashboard changes (`lovable-repo/src/`)

| File | Change |
|---|---|
| `types/database.ts` (758-828, 1091-1101) | Add disposition fields to `execution_pages` Row/Insert/Update; new `StrategyConstraint` interface; add `is_structural` to `audit_clusters` block |
| `hooks/useAgentData.ts` (107-226) | `useSetPageDisposition` / `useClearPageDisposition` mutations (alongside `useDeprecateExecutionPage`); `useExecutionPages` keeps returning disposed rows (client-side partition) |
| `hooks/useStrategyConstraints.ts` (new) | CRUD: list / create / toggle-active / update / delete against `audit_strategy_constraints` (model: `usePageAudit.ts:82-136`) |
| `components/audit/StrategyConstraintsEditor.tsx` (new) | Directive list: text + reason + active toggle + delete. Card section |
| `components/audit/DispositionMenu.tsx` (new) | Reject/Defer dropdown + reason input (model: PageAudit dismiss dropdown `PageAuditPage.tsx:247-301`) |
| `pages/audit/ExecutionPage.tsx` (165, 191-217) | (a) partition rows: disposed → collapsed hidden lane, off-by-default toggle (model: cluster hidden lane `ClustersPage.tsx:524-541`); (b) **Unassigned bucket**: pages with `canonical_key IS NULL` render in their own group **regardless of `clusterOnly`**, with per-page "assign to cluster" affordance (reuse `useAssignPageToCluster`); (c) DispositionMenu on each row |
| `pages/audit/AuditSettings.tsx` (41-94 pattern) | Mount `StrategyConstraintsSection` card (pattern: `ClientContextSection`) |
| `pages/audit/ClustersPage.tsx` | Optional: unassigned-count indicator linking to /execution bucket (grouping UI there is net-new; kept minimal) |

Gating: disposition actions + constraints editor behind `canManage` (same as `ClusterMembershipEditor`).

---

## Rollout order (atomic)

1. **Migration 044** — apply via Management API; verify columns/table/policies with confirmation query. (Manual step — no migration runner exists.)
2. **Pipeline code** (P1-P6) — `npx tsc --noEmit`, commit, push → Railway auto-deploy.
3. **Edge function** — share-audit filter; deploy via `supabase functions deploy share-audit`.
4. **Dashboard** — types, hooks, components; `tsc` + build; push → Vercel auto-deploy.
5. **Weiser recovery** (proves the loop end-to-end):
   a. Seed constraint via SQL: *"Geo strategy: service-area pages are COUNTY-level (Payette/Washington/Adams/Valley ID, Malheur/Baker OR). Do not propose city-level service-area hub pages."* reason: *"Weiser/Ontario city terms have near-zero volume; county-level matches how rural customers search. Operator decision 2026-07-07."*
   b. Trigger "Refresh Architecture" — expected: Michael honors directive (county service-area pages return), fixed `isCommitted` revives the 10 towing/roadside pages, declared keys create the structural `service_area` cluster, 6 county pages get `canonical_key='service_area'`.
   c. Manually deprecate `service-area/weiser-id` + `ontario-or` if the stale loop preserves them (weiser-id is brief_ready → stale-preserved by design). Keep `fruitland-id` (operator page).
   d. Verify /clusters + /execution render everything; **fallback** if Michael's output disappoints: manual recovery SQL from the Weiser plan Appendix A (minus the `assignment_locked` locks — no longer needed).
6. **Sweep other clients** (Weiser plan §11): after the fix, any deprecated michael page whose slug is in the current blueprint revives on that client's next refresh — no bulk SQL needed unless requested. IMA/SMA first.
7. **Docs, same commit(s):** DATA_CONTRACT.md (new table; execution_pages disposition columns; audit_clusters.is_structural; §605 dual-taxonomy update — declared keys close the gap), PIPELINE.md (Phase 6 prompt blocks; Phase 6b disposition/structural semantics; Phase 3d structural survivability), DECISIONS.md (supersede "protection already comprehensive" entry ~263; new entries: dispositions-as-column vs overlay table; is_structural vs is_manual; diff-mode-as-default; Option 2 predicate fix).

## Verification protocol

- **V1:** Migration confirmation query (table, columns, CHECK, policies, index) — output shown before proceeding.
- **V2:** `npx tsc --noEmit` both repos + dashboard build.
- **V3:** Sync-loop test (scratch script pattern): deprecated+re-added page → revived; deprecated+rejected+re-added → stays put, snapshot bumped; draft_ready page → untouched; stale disposed page → not re-deprecated.
- **V4:** Parser unit check: blueprint table with/without Cluster Key column parses; "Cluster Key" header not swallowed by the `silo/cluster` detector.
- **V5:** Prompt-block spot check: dry-run michael generate for weiser, inspect assembled prompt for the three new blocks.
- **V6:** Locate + guard the generate-content page selection (open item — exact file:line TBD during implementation).
- **V7:** Weiser end-to-end (rollout step 5) — the real acceptance test.

## Open decisions (defaults chosen — override if you disagree)

1. **isCommitted Option 2** (predicate fix) over Option 1 — all 4 call sites verified; cleaner semantics. 
2. **Fruitland-id: keep** (operator page, real city you added).
3. **Constraints editor placement: AuditSettings card** (next to Client Context; same mental model of "how the pipeline should think").
4. **Deferred pages also excluded from shares + content generation** (only NULL-disposition pages are producible).
5. **Recovery via self-healing refresh** (step 5b) with manual-SQL fallback, rather than manual-SQL-first.
6. **Michael max_tokens 16384 → 32768.**

## Assumptions & unknowns

- **A1 (verified):** live schema clear for all additions; `can_view_audit` helper exists; status/source are TEXT.
- **A2 (verified):** prior `agent_architecture_pages`/`_blueprint` rows survive until Phase 6b — generate (Phase 6) can read them as baseline.
- **A3 (unknown, V6):** exact location of the content-generation page-selection query.
- **A4 (risk):** Michael honoring the Cluster Key column format — parser is backward-compatible, and the pre-flight validation/retry (3055-3081) catches malformed output; worst case pages fall back to keyword backfill (current behavior).
- **A5 (risk):** prompt growth from 3 new blocks — baseline is slim by design; if weiser dry-run shows bloat, trim the baseline to slugs-only.
- **A6:** migration applied manually by this session via Management API (established pattern; Matt's token must be fresh).
