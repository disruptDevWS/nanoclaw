# Weiser Towing — Architecture Revert + `isCommitted` Deprecation Bug

**Status:** 🔎 Diagnosis complete — **NO changes made** (DB and code untouched). Recovery SQL and code fix below are **staged for your review**. Do not run anything until you've read §8–§12.

**Audit:** `weisertowingandautorepair.com` — `audit_id = cdee76ae-7540-42b8-8851-f6a0fb5dea71`
**Incident:** Clicking "Refresh architecture" on `/strategy` reverted the county-level service-area architecture to city-level "old junk"; the Service Area content was already invisible on `/clusters` and `/execution` before that.
**Diagnosed:** 2026-07-07 (evening). All findings verified against the live DB via the Management API.

---

## 1. TL;DR

Three separate things combined to produce what you saw:

1. **The refresh button did exactly what it's built to do** — it re-ran Michael + the sync at **23:47 UTC** (4 min after your 23:43 screenshot), producing a brand-new **53-page** blueprint (previous blueprints were 31 pages). Expected behavior, not a bug.
2. **A real code bug (`isCommitted`) is why the county pages vanished and won't come back on their own.** `isCommitted()` treats `status = 'deprecated'` as "committed/protected." So the 10 county pages under `towing-services/*` and `roadside-assistance/*` — which the **new blueprint explicitly re-adds** — were left stuck in `deprecated` instead of being revived. A page that gets deprecated once can never be resurrected by a later blueprint. **This is the core defect and it affects every client.**
3. **The Service Area hub silo genuinely flipped county → city** because the new blueprint chose city hub pages (`weiser-id`, `ontario-or`) for that silo. That's Michael making a different strategic call this run, not a bug.

Plus the reason you couldn't see it on `/clusters`/`/execution` at all: a **dual-taxonomy gap** — those pages have no cluster to render under.

**Good news:** all 16 county pages are **soft-deprecated and fully intact** in `execution_pages` — nothing was hard-deleted. They are recoverable.

**Your decisions (from the diagnosis session):**
- Geo strategy → **county-level everywhere** (revive all 16 county pages; Service Area silo goes back to county hubs).
- Code fix → **document it, review in the morning, fix carefully** (this file).

---

## 2. Timeline (verified from `agent_runs` + `execution_pages`)

| When (UTC) | Event | Michael pages | Notes |
|---|---|---|---|
| 2026-06-04 00:13 | Michael run #1 (first_run) | 41 (13 slugs rejected) | County pages under `towing-services/*` and `roadside-assistance/*` **created** here, active. |
| 2026-06-11 00:42 | Michael run #2 | 31 | `service-area/*-county` pages **created** here. The 31-page blueprint **dropped** the towing/roadside county pages → they were **deprecated** around this time (stale-loop). |
| 2026-06-11 17:14 | Michael run (failed) | — | — |
| 2026-06-11 17:27 | Michael run #3 | 31 | This is the "v3" state — the county service-area architecture that was live continuously until today. |
| 2026-07-07 23:43 | **Your screenshot** (`/strategy` PDF) | — | County-level architecture still displayed. |
| 2026-07-07 23:47:15 | **Michael run #4 (today's refresh)** | **53 (0 rejected)** | New blueprint. City hubs in Service Area silo; **re-adds** all towing/roadside county pages. |
| 2026-07-07 23:47:17–26 | Sync writes | — | 6 `service-area/*-county` pages deprecated (stale-loop); 10 towing/roadside county pages left deprecated by the `isCommitted` bug. |

**Note on why Michael's output changed (31→53 pages, 13→0 rejected slugs):** almost certainly a Michael prompt / blueprint-parser change landed between June 11 and July 7. Not root-caused here — not required for recovery — but worth a glance if you want to understand the city-hub choice. The new 53-page blueprint markdown is saved at `scratchpad/v4_blueprint.md` for this session; it's also in `agent_architecture_blueprint.blueprint_markdown` live.

---

## 3. The three root causes

### Cause A — Refresh mechanism (expected)
`/strategy` "Refresh architecture" → `cluster-action` edge fn (`action: refresh_architecture`) → `/refresh-architecture` → `scripts/refresh-architecture.ts` → `pipeline-generate.ts michael` + `sync-to-dashboard.ts --agents michael` as a **`strategic_rerun`**. Michael regenerates the blueprint from **live underlying data** (keywords, clusters, GSC), not from what's currently on screen. This is by design.

### Cause B — The `isCommitted` bug (the real defect) → see §4.

### Cause C — Service Area silo county → city (Michael's new call)
The new blueprint's "Service Area & Trust" silo proposes **city** hub pages. The 6 `service-area/*-county` pages were active until today; being absent from the new blueprint, the stale-page loop deprecated them (`sync-to-dashboard.ts:2412`). Not a bug — a strategy change. You've chosen to override it back to county.

---

## 4. The `isCommitted` bug — detailed

### The defect
`scripts/rerun-utils.ts:13`
```ts
export const isCommitted = (page: {
  status: string;
  source?: string | null;
  published_at?: string | null;
}): boolean =>
  page.status !== 'not_started' ||        // ← 'deprecated' !== 'not_started' → TRUE
  page.source === 'cluster_strategy' ||
  page.source === 'manual' ||
  page.published_at != null;
```
`status = 'deprecated'` satisfies `status !== 'not_started'`, so **a deprecated page is treated as "committed."**

### How it bites (the strategic_rerun page loop in `sync-to-dashboard.ts`)
```
2359  if (existing && existing.assignment_locked)        → skip (locked)
2366  else if (existing && isCommitted(existing))        → "committed": update brief, DO NOT touch status  ← BUG
2376  else if (existing)                                 → "not committed": reset status='not_started'   ← where revival SHOULD happen
2388  else                                               → insert new
```
For the 10 towing/roadside county pages: they exist, they're in the new blueprint (`newSlugs`), `assignment_locked=false`, `source='michael'`, but `status='deprecated'`. They fall into the **2366 branch** → brief + `snapshot_version` updated to 4, **status stays `deprecated`.** They should have hit 2376 and been revived.

**Proof this is the path:** these rows are `snapshot_version=4` (touched today) **and** `deprecated`. The only code path that produces "touched today but still deprecated" for a slug present in the blueprint is the `isCommitted` branch. No duplicate rows exist; the county slugs are **not** in the blueprint's `## Deprecation Candidates` JSON (which lists only `towing-services/towing-cost-guide` and `auto-repair/auto-repair-faq`).

### All three `isCommitted` call sites (review each before changing the function itself)
1. **`:2366`** — page **in** new blueprint. **This is the buggy one.** A reappearing deprecated page should be revived.
2. **`:2409`** — stale loop, page **not** in new blueprint. Deprecated-treated-as-committed here just means "leave it deprecated" (→ `stalePreserved`). Harmless.
3. **`:2435`** — deprecation-candidates, `isCommitted(ep) && status !== 'published'` → deprecate. Excluding deprecated from `isCommitted` makes an already-deprecated candidate a no-op. Harmless.

### Fix options (do NOT rush — pick after review)

**Option 1 (surgical, lowest blast radius — recommended starting point):** revive at the call site, leave `isCommitted` untouched.
```ts
// :2366
} else if (existing && isCommitted(existing) && existing.status !== 'deprecated') {
  // committed & live: preserve status
  ...
} else if (existing) {
  // not committed, OR previously deprecated but re-added by this blueprint → revive to not_started
  ...
}
```
Routes deprecated-but-reappearing pages into the revive branch (2376). Only touches the one buggy site.

**Option 2 (fix the predicate):** add `&& page.status !== 'deprecated'` inside `isCommitted`. Cleaner semantically ("a dead page isn't committed work"), but changes all 3 call sites — verify §4 sites 2 and 3 stay correct (analysis above says harmless, but confirm) and check for **other importers**: `isCommitted` is imported in `sync-to-dashboard.ts` and defined in `rerun-utils.ts`; grep for all uses before committing.

**Risk to avoid (the "fix one thing, break another" concern):** `isCommitted` legitimately protects **real** work — `in_progress`, `draft_ready`, `published`, briefs, Pam/Oscar output. Any fix must keep protecting those and only change behavior for `deprecated`. Option 1 is safest because it can't affect the protection of live committed pages.

**Test to add:** a `strategic_rerun` unit/integration case where an existing `status='deprecated'`, `source='michael'` page whose slug **is** in the new blueprint ends up `status='not_started'` (revived), while a `status='draft_ready'` page stays `draft_ready`.

---

## 5. Why `/strategy` didn't match `/clusters` + `/execution` (the missing Service Area cluster)

Dual taxonomy (documented in `DATA_CONTRACT.md` §605):
- **`/strategy`** reads `agent_architecture_pages`, grouped by Michael's **silo label** ("Service Area & Trust"). Pages show here.
- **`/clusters` + `/execution`** read `audit_clusters` + `execution_pages` joined on **`canonical_key`**.

There is **no "Service Area" cluster** in `audit_clusters` — Phase 3c only formed `auto_repair`, `roadside_assistance`, `towing_services`, `off_road_recovery` (county/geo terms carry ~zero keyword volume, so no semantic cluster ever crystallized). Every service-area page has `canonical_key = NULL`, so there's nothing to render them under → invisible on `/clusters`/`/execution`.

The county **service** pages (`towing-services/*-county`, `roadside-assistance/*-county`) *do* belong to real clusters (`towing_services`, `roadside_assistance`) — but they're deprecated by Cause B, so also invisible there.

**Implication for recovery:** reviving `status` alone is **not enough** for the pages to appear on `/clusters`/`/execution`. They also need `canonical_key` set (and for the Service Area hub pages, a cluster to point at). See §9.

---

## 6. Current DB state — the 16 recoverable county pages

All `status='deprecated'`, `source='michael'`, `assignment_locked=false`, briefs intact. `canonical_key=NULL` on all.

| Slug | snapshot_version | In new blueprint? | Target cluster |
|---|---|---|---|
| `towing-services/payette-county-id` | 4 | ✅ yes | `towing_services` |
| `towing-services/washington-county-id` | 4 | ✅ yes | `towing_services` |
| `towing-services/adams-county-id` | 4 | ✅ yes | `towing_services` |
| `towing-services/valley-county-id` | 4 | ✅ yes | `towing_services` |
| `towing-services/malheur-county-or` | 4 | ✅ yes | `towing_services` |
| `towing-services/baker-county-or` | 4 | ✅ yes | `towing_services` |
| `roadside-assistance/payette-county-id` | 4 | ✅ yes | `roadside_assistance` |
| `roadside-assistance/washington-county-id` | 4 | ✅ yes | `roadside_assistance` |
| `roadside-assistance/malheur-county-or` | 4 | ✅ yes | `roadside_assistance` |
| `roadside-assistance/baker-county-or` | 4 | ✅ yes | `roadside_assistance` |
| `service-area/adams-county-id` | 3 | ❌ no (city chosen) | `service_area` (new manual cluster) |
| `service-area/payette-county-id` | 3 | ❌ no | `service_area` |
| `service-area/valley-county-id` | 3 | ❌ no | `service_area` |
| `service-area/washington-county-id` | 3 | ❌ no | `service_area` |
| `service-area/baker-county-or` | 3 | ❌ no | `service_area` |
| `service-area/malheur-county-or` | 3 | ❌ no | `service_area` |

**City-hub pages currently active in the Service Area silo** (relevant to "county everywhere"):

| Slug | status | source | Action under "county everywhere" |
|---|---|---|---|
| `service-area/weiser-id` | brief_ready | michael | Deprecate — **⚠️ FLAG: has a brief**, deprecation is soft but loses that work from the roster |
| `service-area/ontario-or` | not_started | michael | Deprecate |
| `service-area/payette-id` | deprecated | michael | already deprecated |
| `service-area/fruitland-id` | brief_ready | **operator** | **⚠️ DO NOT auto-deprecate** — operator = human-requested. Fruitland is a real city you explicitly added. Decide explicitly. |

**Do NOT touch** (new blueprint wants **both** county and city for the service silos): `towing-services/weiser-id`, `towing-services/ontario-or`, `towing-services/baker-city-or` (all `cluster_strategy`). Leaving these means towing has county **and** city pages, which is what the 53-page blueprint intends.

---

## 7. Recoverability summary

| Layer | State | Recoverable? |
|---|---|---|
| `execution_pages` (content roster) | 16 county pages soft-deprecated, intact | ✅ Yes — un-deprecate + set `canonical_key` |
| `agent_architecture_pages` (`/strategy` flat list) | Hard-deleted + re-inserted every sync (`sync-to-dashboard.ts:2255`) — no history | ⚠️ Reconstruct only |
| `agent_architecture_blueprint` (narrative markdown) | Hard-deleted + replaced at 23:47 | ⚠️ Reconstruct only |

**Reconstruction sources for the two `/strategy` layers:** (a) your PDF; (b) local file `audits/weisertowingandautorepair.com/architecture/2026-06-11/architecture_blueprint.md` (still contains county-level service-area slugs); (c) the intact deprecated `execution_pages` rows (each carries its full `page_brief`). Note: reviving the `execution_pages` rows fixes `/clusters`/`/execution` and content production; the `/strategy` blueprint view will only re-match county after either a code-fixed refresh or a manual blueprint edit.

---

## 8. Recovery plan — DATA (county-level everywhere)

**Sequence matters. Review each step. Nothing here has been run.**

1. **Create a manual `Service Area` cluster** so the 6 `service-area/*-county` pages have somewhere to render (they map to no keyword cluster). Manual clusters (`is_manual=true`) survive future Michael syncs (the delete is `.eq('is_manual', false)`).
   - **Safer alternative than raw SQL:** use the dashboard's **"Create manual topic"** UI (`useCreateCluster`) — it fills every `NOT NULL` column correctly. `audit_clusters` has many `NOT NULL` columns (`topic`, `total_volume`, `est_*`, etc.); hand-written INSERT must set them all. SQL version in Appendix A is provided but the UI is lower-risk.
2. **Revive + assign the 10 towing/roadside county pages** → `status='not_started'`, `canonical_key` = `towing_services` / `roadside_assistance`, `cluster_active=true`, `assignment_locked=true`.
3. **Revive + assign the 6 service-area county pages** → `status='not_started'`, `canonical_key='service_area'`, `cluster_active=true`, `assignment_locked=true`.
4. **Deprecate the Service Area city hubs** `service-area/weiser-id` and `service-area/ontario-or` (per "county everywhere"). **Hold on `fruitland-id`** (operator) until you confirm.
5. **Verify** on `/clusters` and `/execution` that the Service Area cluster now shows the 6 county pages and the towing/roadside county pages appear under their clusters.

**Why `assignment_locked=true` on the revived pages:** locked pages are skipped by `syncMichael` (only `snapshot_version` is bumped) and skipped by the `canonical_key` backfill (`:2501`). This makes the county recovery **durable** — the next "Refresh architecture" won't re-deprecate or re-home them, and it side-steps the `isCommitted` bug for these rows entirely. Tradeoff: Michael can no longer update these pages' briefs until you unlock them (`useUnlockPageAssignment`). Acceptable for pinned county pages.

---

## 9. Visibility plan — Service Area cluster

The manual `Service Area` cluster (step 1) + `canonical_key='service_area'` on the 6 service-area county pages (step 3) is what makes them appear on `/clusters` and `/execution`. Without it they stay `/strategy`-only (the exact gap you hit). The towing/roadside county pages need only their existing-cluster `canonical_key` (`towing_services` / `roadside_assistance`) + `cluster_active=true`.

---

## 10. Durability against future refreshes

Even after recovery, a future "Refresh architecture" would otherwise:
- re-deprecate the 6 service-area county pages (new blueprint still prefers city hubs), and
- re-trigger the `isCommitted` bug on any that were deprecated.

`assignment_locked=true` (§8) neutralizes both for the recovered rows. The **proper** long-term fix is the code change in §4 so deprecation stops being permanent — do that after review, then locking becomes optional.

---

## 11. Blast radius — other clients affected by the `isCommitted` bug

Deprecated `source='michael'` `execution_pages` today (upper bound on potential victims — a row is only an *actual* victim if its slug reappears in a later blueprint):

| Domain | Deprecated michael pages |
|---|---|
| idahomedicalacademy.com | 94 |
| summitmedicalacademy.com | 49 |
| weisertowingandautorepair.com | 40 |
| forgegrowth.ai | 26 |
| boiseheatingair.com | 8 |

After landing the code fix, consider a one-off sweep: for each audit, any `status='deprecated'` michael page whose slug is present in the current `agent_architecture_blueprint` should be revived to `not_started`. (IMA/SMA are live client work — check those first.)

---

## 12. Morning checklist

- [ ] Read §4; decide **Option 1 vs Option 2** for the code fix. Grep all `isCommitted` importers first.
- [ ] Confirm the fruitland-id (operator) decision in §6 — keep or deprecate.
- [ ] Confirm you want `assignment_locked=true` on the recovered county pages (durability vs. future Michael edits).
- [ ] Decide: manual Service Area cluster via **dashboard UI** (recommended) or SQL (Appendix A).
- [ ] Run recovery SQL (Appendix A) in order; verify with the check query.
- [ ] Verify `/clusters` and `/execution` render the Service Area cluster + county pages.
- [ ] (Optional) Reconstruct the `/strategy` county blueprint, or accept that a future code-fixed refresh will re-home it.
- [ ] Implement + test the code fix; update `PIPELINE.md`/`DECISIONS.md`; then sweep other clients (§11).

---

## Appendix A — Recovery SQL (STAGED — review before running)

Run via the Management API (`POST …/database/query`). `audit_id = cdee76ae-7540-42b8-8851-f6a0fb5dea71`.

```sql
-- STEP 1: manual Service Area cluster (raw-SQL version; dashboard UI is safer).
-- Verify no service_area cluster exists first:
--   select * from audit_clusters where audit_id='cdee76ae-7540-42b8-8851-f6a0fb5dea71' and canonical_key='service_area';
INSERT INTO public.audit_clusters
  (audit_id, topic, canonical_key, canonical_topic, is_manual, status, primary_entity_type)
VALUES
  ('cdee76ae-7540-42b8-8851-f6a0fb5dea71', 'Service Area', 'service_area', 'Service Area',
   true, 'active', 'Place');

-- STEP 2: revive + assign the 10 towing/roadside county pages
UPDATE public.execution_pages
SET status='not_started', cluster_active=true, assignment_locked=true,
    canonical_key = CASE
      WHEN url_slug LIKE 'towing-services/%'      THEN 'towing_services'
      WHEN url_slug LIKE 'roadside-assistance/%'  THEN 'roadside_assistance'
    END
WHERE audit_id='cdee76ae-7540-42b8-8851-f6a0fb5dea71'
  AND status='deprecated' AND source='michael'
  AND url_slug ~ 'county'
  AND (url_slug LIKE 'towing-services/%' OR url_slug LIKE 'roadside-assistance/%');

-- STEP 3: revive + assign the 6 service-area county pages
UPDATE public.execution_pages
SET status='not_started', cluster_active=true, assignment_locked=true,
    canonical_key='service_area'
WHERE audit_id='cdee76ae-7540-42b8-8851-f6a0fb5dea71'
  AND status='deprecated' AND source='michael'
  AND url_slug LIKE 'service-area/%county%';

-- STEP 4: deprecate the Service Area city hubs (county-everywhere).
--   NOTE: excludes fruitland-id (operator) — decide separately. weiser-id has a brief.
UPDATE public.execution_pages
SET status='deprecated'
WHERE audit_id='cdee76ae-7540-42b8-8851-f6a0fb5dea71'
  AND source='michael'
  AND url_slug IN ('service-area/weiser-id','service-area/ontario-or');

-- VERIFY
SELECT url_slug, status, source, canonical_key, cluster_active, assignment_locked
FROM public.execution_pages
WHERE audit_id='cdee76ae-7540-42b8-8851-f6a0fb5dea71'
  AND silo ILIKE '%service%area%' OR url_slug ~ 'county'
ORDER BY url_slug;
```

**Rollback:** every step is reversible. Re-deprecate revived pages (`status='deprecated'`, `assignment_locked=false`, `canonical_key=NULL`), un-deprecate the city hubs, and `DELETE` the manual cluster by `id`. Capture a `SELECT` snapshot of the affected rows before running so you have exact pre-values.

---

## Appendix B — Proposed code fix (Option 1, for review)

`scripts/sync-to-dashboard.ts` ~line 2366, inside the `strategic_rerun` loop:

```ts
} else if (existing && isCommitted(existing) && existing.status !== 'deprecated') {
  // Committed & LIVE: update metadata only, do not touch status/source/Pam/Oscar fields
  await (sb as any).from('execution_pages').update({
    url_slug: slug, page_brief: rec.page_brief, silo: rec.silo,
    priority: rec.priority, snapshot_version: rec.snapshot_version,
  }).eq('id', existing.id);
  preserved++;
} else if (existing) {
  // Not committed, OR previously deprecated but re-added by this blueprint → revive to not_started
  await (sb as any).from('execution_pages').update({
    url_slug: slug, page_brief: rec.page_brief, silo: rec.silo,
    priority: rec.priority, status: 'not_started', source: 'michael',
    snapshot_version: rec.snapshot_version,
  }).eq('id', existing.id);
  updated++;
}
```

Confirm `isCommitted` call sites §4.2 and §4.3 remain correct (they do under this option, since the function itself is unchanged). Add the §4 test. Then decide whether to also sweep §11.
