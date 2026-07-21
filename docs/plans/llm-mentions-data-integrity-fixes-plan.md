# Plan: LLM Mentions Data Integrity Fixes

## Summary

Three data integrity issues in the LLM visibility pipeline: (1) shared budget guard lets domain calls starve competitor calls, (2) `llm_mention_details` delete wipes all historical records instead of scoping by date, (3) competitor mention counts carry false per-keyword precision with no metadata flag. This plan fixes all three plus ensures the `is_estimated` flag flows through all write paths.

---

## 1. Current State Analysis

### Issue 1: Shared Budget Guard

**Both** `fetchDomainMentions()` and `fetchCompetitorMentions()` call `getBudget(env)` (dataforseo-llm-mentions.ts:179, 266), which returns a single value from `LLM_MENTIONS_BUDGET` (default `$1.00`). Each function tracks its own `totalCost` against this shared limit independently — so each gets $1.00.

However, `fetchAllLlmMentions()` (line 348-353) calls domain first, then competitor. If domain calls consume significant budget, there's no cross-function accumulation — each function has its own counter. **Correction to the prompt's assumption:** The budget is NOT actually shared across the two calls. Each function independently reads `LLM_MENTIONS_BUDGET` and applies it to its own calls. Domain calls can't starve competitor calls through budget exhaustion.

**The real risk is different:** The budget ceiling applies *within* `fetchCompetitorMentions` across all competitors × platforms. With 3 competitors × 2 platforms = 6 API calls, and each call costing ~$0.05-0.10, the $1.00 budget is usually sufficient. But the budget *within* `fetchDomainMentions` does create a risk: 5 keywords × 2 platforms = 10 calls, at ~$0.05 each = ~$0.50. If API costs spike, later keywords/platforms could be skipped.

**Still worth splitting:** Separate env vars give operators fine-grained control. The backward-compat fallback (`LLM_MENTIONS_BUDGET → LLM_DOMAIN_BUDGET`) ensures existing deployments work without changes.

### Issue 2: `llm_mention_details` Delete Scope

**Two write paths exist — both have the same bug:**

1. **`track-llm-mentions.ts` (standalone tracker)** — line 194-196:
   ```typescript
   await (sb as any).from('llm_mention_details')
     .delete()
     .eq('audit_id', audit.id);
   ```
   Deletes ALL detail records for the audit. No date scoping.

2. **`sync-to-dashboard.ts` (Jim sync)** — line 1109-1111:
   ```typescript
   await (sb as any).from('llm_mention_details')
     .delete()
     .eq('audit_id', auditId);
   ```
   Same bug — deletes all historical details.

The `llm_visibility_snapshots` table is safe — it uses upsert on `(audit_id, snapshot_date, keyword, platform, domain)` unique constraint (004-llm-visibility.sql:21). Old snapshots survive.

The `llm_mention_details` table has **no unique constraint** and **no `snapshot_date` column** — only `captured_at TIMESTAMPTZ DEFAULT now()`. Scoping the delete by date requires a range query on `captured_at`.

### Issue 3: Fabricated Competitor Per-Keyword Distribution

`fetchCompetitorMentions()` line 304-311: the `/aggregated_metrics/live` endpoint returns one total per domain × platform. The code distributes evenly across keywords via `Math.round(mentionCount / keywords.length)`. No metadata flag distinguishes measured from estimated data.

**Write paths for `is_estimated`:**

1. **`sync-to-dashboard.ts`** (Jim sync, line 1128-1140): Reads `llm_mentions.json` and writes competitor rows to `llm_visibility_snapshots`. Currently doesn't set any `is_estimated` field. The `llm_mentions.json` file stores `competitor_mentions` which include per-keyword rows from `fetchCompetitorMentions()`.

2. **`track-llm-mentions.ts`** (standalone tracker, line 199-208): Only writes domain mentions (no competitor re-check — line 182-183 calls `fetchDomainMentions` only). Domain mentions are always `is_estimated: false`. However, the `visRecords` construction should still include the field for schema consistency.

**Dashboard type:** `LlmVisibilitySnapshot` interface (lovable-repo/src/types/database.ts:13-24) doesn't include `is_estimated`. The `select('*')` query in `useLlmVisibilitySnapshots` will return the column but TypeScript won't expose it. The dashboard doesn't currently filter or display estimation status, so this is a forward-compatible addition — the type can be updated later when the UI surfaces this.

### Schema: `llm_visibility_snapshots` Columns (from 004-llm-visibility.sql)

```
id UUID PK
audit_id UUID FK → audits(id)
domain TEXT
snapshot_date DATE
keyword TEXT
platform TEXT
mention_count INTEGER DEFAULT 0
ai_search_volume INTEGER
top_citation_domains JSONB DEFAULT '[]'
created_at TIMESTAMPTZ DEFAULT now()
UNIQUE (audit_id, snapshot_date, keyword, platform, domain)
```

No `is_estimated` column exists. Migration needed.

### Schema: `llm_mention_details` Columns

```
id UUID PK
audit_id UUID FK → audits(id)
keyword TEXT
platform TEXT
mention_text TEXT
citation_urls JSONB DEFAULT '[]'
source_domains JSONB DEFAULT '[]'
captured_at TIMESTAMPTZ DEFAULT now()
```

No `snapshot_date` column. No unique constraint. Delete must use `captured_at` range.

---

## 2. Proposed Changes by File

### File 1: `scripts/dataforseo-llm-mentions.ts`

#### Change 1A: Split budget into separate env vars

Replace `getBudget()` with two functions:

```typescript
const DEFAULT_DOMAIN_BUDGET = 1.0;
const DEFAULT_COMPETITOR_BUDGET = 0.50;

function getDomainBudget(env: Record<string, string>): number {
  const val = env.LLM_DOMAIN_BUDGET ?? env.LLM_MENTIONS_BUDGET;
  if (val) { const parsed = parseFloat(val); if (!isNaN(parsed)) return parsed; }
  return DEFAULT_DOMAIN_BUDGET;
}

function getCompetitorBudget(env: Record<string, string>): number {
  const val = env.LLM_COMPETITOR_BUDGET;
  if (val) { const parsed = parseFloat(val); if (!isNaN(parsed)) return parsed; }
  return DEFAULT_COMPETITOR_BUDGET;
}
```

Update `fetchDomainMentions()` line 179: `getBudget(env)` → `getDomainBudget(env)`.
Update `fetchCompetitorMentions()` line 266: `getBudget(env)` → `getCompetitorBudget(env)`.

Remove the old `getBudget()` function and the `DEFAULT_BUDGET` constant.

Add documentation comment block above the budget functions:

```typescript
// Budget env vars:
//   LLM_DOMAIN_BUDGET     — max spend on domain mention calls (default $1.00)
//   LLM_COMPETITOR_BUDGET — max spend on competitor mention calls (default $0.50)
//   LLM_MENTIONS_BUDGET   — legacy fallback for LLM_DOMAIN_BUDGET (still honored)
```

#### Change 1B: Add `is_estimated` to `CompetitorMention` interface

```typescript
export interface CompetitorMention {
  domain: string;
  keyword: string;
  platform: string;
  mention_count: number;
  is_estimated: boolean;
}
```

In `fetchCompetitorMentions()`, set `is_estimated: true` on all pushed records (both success path at line 306 and error fallback at line 316).

#### Change 1C: Add `competitor_budget_skipped` to `LlmMentionsResult`

```typescript
export interface LlmMentionsResult {
  domain_mentions: LlmMention[];
  competitor_mentions: CompetitorMention[];
  queried_keywords: string[];
  queried_competitors: string[];
  total_cost: number;
  timestamp: string;
  competitor_budget_skipped: boolean;
}
```

In `fetchAllLlmMentions()`, detect budget skip. `fetchCompetitorMentions()` currently returns `{ mentions, cost }`. After the call, check if all competitor mention counts are zero AND `competitorResult.cost` is zero AND `competitorDomains.length > 0` — this indicates budget was exhausted before any competitor call completed (cost=0 means no calls were made). Set `competitor_budget_skipped` accordingly.

**But wait — there's a subtlety.** `fetchCompetitorMentions` has its own budget guard. If budget is hit mid-way, some competitors get data and some get the error-fallback zeros. The flag should be `true` when the competitor call couldn't complete all requested domains. Cleanest approach: have `fetchCompetitorMentions` return a third field:

```typescript
return { mentions, cost: totalCost, budget_exhausted: totalCost >= budget && competitorDomains.length > 0 };
```

Wait — this still doesn't catch the case where budget was already 0 at start (instant break). Let me trace: if `totalCost >= budget` at the first iteration, the outer `for` loop breaks immediately (line 271), `mentions` stays empty, `totalCost` stays 0. So `totalCost >= budget` would be `0 >= budget` which is false. The mentions array would be empty.

Better detection: compare expected iterations vs actual. Expected: `competitorDomains.length * PLATFORMS.length` calls. If `mentions.length < expected * keywords.length`, budget was hit. But this is brittle.

**Simplest reliable approach:** Add a `completed_all: boolean` return field to `fetchCompetitorMentions()`:

```typescript
// Track if we completed all domain × platform combinations
let callsCompleted = 0;
const callsExpected = competitorDomains.length * PLATFORMS.length;
// ... inside loop after each successful/failed call: callsCompleted++
return { mentions, cost: totalCost, completed_all: callsCompleted === callsExpected };
```

Then in `fetchAllLlmMentions()`:

```typescript
const competitorBudgetSkipped = competitorDomains.length > 0 && !competitorResult.completed_all;
```

This accurately detects partial data regardless of cost values.

### File 2: `scripts/track-llm-mentions.ts`

#### Change 2A: Scope `llm_mention_details` delete by date

Replace line 194-196:

```typescript
// CURRENT
await (sb as any).from('llm_mention_details')
  .delete()
  .eq('audit_id', audit.id);
```

With:

```typescript
// FIXED — scope by date to preserve historical records
await (sb as any).from('llm_mention_details')
  .delete()
  .eq('audit_id', audit.id)
  .gte('captured_at', `${snapshotDate}T00:00:00Z`)
  .lt('captured_at', `${nextDay(snapshotDate)}T00:00:00Z`);
```

Where `nextDay()` is a small helper that adds one day to a `YYYY-MM-DD` string:

```typescript
function nextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
```

**Note on the prompt's suggested `.lt('captured_at', '${snapshotDate}T23:59:59Z')`:** This misses records at exactly `23:59:59.001Z` through `23:59:59.999Z`. The correct approach is `.lt('captured_at', nextDayT00:00:00Z')` — a half-open interval `[dayStart, nextDayStart)`.

#### Change 2B: Add `is_estimated` to `visRecords` construction

Line 199-208 — add `is_estimated: false` (standalone tracker only writes domain mentions, never estimated):

```typescript
const visRecords = mentions.map((m) => ({
  audit_id: audit.id,
  domain: cliArgs.domain,
  snapshot_date: snapshotDate,
  keyword: m.keyword,
  platform: m.platform,
  mention_count: m.mention_count,
  ai_search_volume: m.ai_search_volume || null,
  top_citation_domains: m.citation_sources,
  is_estimated: false,
}));
```

### File 3: `scripts/sync-to-dashboard.ts`

#### Change 3A: Scope `llm_mention_details` delete by date

Replace line 1109-1111:

```typescript
// CURRENT
await (sb as any).from('llm_mention_details')
  .delete()
  .eq('audit_id', auditId);
```

With the same date-scoped pattern as Change 2A (using `snapshotDate` which is already computed at line 1102).

#### Change 3B: Add `is_estimated` to competitor visibility records

Line 1128-1140 — add `is_estimated` field. Domain mentions get `false`, competitor mentions get the value from `llm_mentions.json`:

Domain mentions loop (line 1115-1126 — iterates `llmData.domain_mentions`):
```typescript
visRecords.push({
  // ... existing fields ...
  is_estimated: false, // always false — domain data comes from /search/live (per-keyword exact)
});
```

**No fallback on domain rows.** Domain mention data from `/search/live` is per-keyword exact measurement. Hardcode `false` — never read `is_estimated` from the JSON for domain rows, even if the field somehow appeared. This prevents old or malformed JSON from flagging accurate data as estimated.

Competitor mentions loop (line 1129-1140 — iterates `llmData.competitor_mentions`):
```typescript
visRecords.push({
  // ... existing fields ...
  is_estimated: cm.is_estimated ?? true, // fallback for pre-change llm_mentions.json files
});
```

The `?? true` fallback is safe here because it **only applies to the competitor loop**. The two loops are structurally separate — domain mentions iterate `llmData.domain_mentions` and competitor mentions iterate `llmData.competitor_mentions`. The fallback cannot fire on domain rows. All historical competitor data IS estimated (from the aggregated endpoint), so `true` is the correct default for old JSON files missing the field.

#### Change 3C: Add `competitor_budget_skipped` logging

After the LLM sync block, log if budget was skipped:

```typescript
if (llmData.competitor_budget_skipped) {
  console.log(`  [jim] Note: Competitor LLM mentions budget was exhausted — competitor data is partial`);
}
```

### File 4: `scripts/migrations/005-llm-visibility-estimated-flag.sql` (NEW)

```sql
-- 005-llm-visibility-estimated-flag.sql
-- Add is_estimated flag to distinguish measured vs. aggregated-derived mention counts

ALTER TABLE public.llm_visibility_snapshots
ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.llm_visibility_snapshots.is_estimated IS
  'True when mention_count is derived from aggregate distribution across keywords, not a direct per-keyword measurement. Applies to competitor domain rows from the aggregated_metrics endpoint.';
```

**Verification:** `public.llm_visibility_snapshots` exists (created in 004-llm-visibility.sql, confirmed applied per MEMORY.md). The `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` is idempotent. `DEFAULT false` means all existing rows (which include competitor rows) will get `false` — this is slightly misleading for historical competitor data, but there's no way to retroactively determine which rows are estimated without re-querying. The next pipeline run will write correct values.

---

## 3. Migration/Schema Changes

### Migration: `scripts/migrations/005-llm-visibility-estimated-flag.sql`

Single column addition as described above. No index needed — the column is metadata, not a query filter.

**Objects verified to exist:**
- `public.llm_visibility_snapshots` — created in 004, confirmed applied
- No new tables, no new RLS policies, no new functions

**Dashboard type update (future, not in this PR):** `LlmVisibilitySnapshot` in `lovable-repo/src/types/database.ts` should eventually add `is_estimated: boolean`. Currently the dashboard doesn't filter on this field, and `select('*')` will include it silently. Can be added when the AI Visibility page surfaces the flag.

---

## 4. Testing Approach

### 4.1 Static Verification

- `npx tsc --noEmit` in pipeline repo — confirms interface changes are consistent across all consumers
- Verify `CompetitorMention` interface change doesn't break any imports (used in: `pipeline-generate.ts` line 38, `track-llm-mentions.ts` doesn't import it, `sync-to-dashboard.ts` reads from JSON so no type dependency)

### 4.2 Unit: Budget Split

Manually verify with a test `.env`:
- Set `LLM_DOMAIN_BUDGET=0.50` — confirm `fetchDomainMentions` uses 0.50
- Set only `LLM_MENTIONS_BUDGET=2.00` (no `LLM_DOMAIN_BUDGET`) — confirm domain calls use 2.00 (backward compat)
- Set `LLM_COMPETITOR_BUDGET=0.25` — confirm competitor calls use 0.25
- Set neither — confirm defaults ($1.00 domain, $0.50 competitor)

### 4.3 Delete Scope Verification

1. Run standalone tracker twice on the same day with `--force`:
   - First run writes detail records
   - Second run should delete only today's records, then re-insert
   - Query `llm_mention_details` to confirm only one day's records exist

2. Run standalone tracker on a different day (or mock `snapshotDate`):
   - Should NOT delete the previous day's detail records
   - Query `llm_mention_details` to confirm both days' records exist

### 4.4 `is_estimated` Flag

1. Run a full pipeline with LLM mentions enabled
2. Query `llm_visibility_snapshots`:
   - Domain rows (`domain = client_domain`) should have `is_estimated = false`
   - Competitor rows (`domain != client_domain`) should have `is_estimated = true`

### 4.5 `competitor_budget_skipped` Flag

1. Set `LLM_COMPETITOR_BUDGET=0.001` (below minimum call cost)
2. Run Jim phase — confirm `llm_mentions.json` has `competitor_budget_skipped: true`
3. Confirm sync-to-dashboard logs the budget warning

### 4.6 Regression

- Run a domain with no qualifying LLM keywords (`selectLlmKeywords` returns empty) — confirm no errors, no empty writes
- Run standalone tracker on a non-completed audit — confirm graceful skip

---

## 5. Known Risks

### 5.1 Historical `is_estimated` Inaccuracy

**Risk:** The migration sets `DEFAULT false` on existing rows. Historical competitor rows will show `is_estimated = false` even though they ARE estimated.

**Mitigation:** Acceptable tradeoff. There's no programmatic way to retroactively distinguish client vs competitor rows by domain name (would need to know which domain was the client). The next pipeline run writes correct values. If this matters, a one-time backfill script could update rows where `domain != (select domain from audits where id = audit_id)`.

### 5.2 `captured_at` Timezone Edge Case

**Risk:** The delete scope uses `captured_at >= '2026-03-26T00:00:00Z'` (UTC). If the pipeline runs near midnight UTC, the `snapshotDate` (computed as local date) might not match the `captured_at` (stored as UTC). Records inserted at 23:50 UTC on March 25 with `snapshotDate = '2026-03-25'` (local = March 25 US time) would be correctly scoped. But if the server is in UTC (Railway is), `snapshotDate` = `todayStr()` which uses local time = UTC, so this aligns.

**Mitigation:** Both `snapshotDate` and `captured_at` use the same time reference (server clock). The `todayStr()` function in `track-llm-mentions.ts` uses `new Date()` which in Railway (UTC) matches the `DEFAULT now()` on `captured_at`. The half-open interval `[dayStart, nextDayStart)` handles the boundary correctly.

### 5.3 `llm_mentions.json` Backward Compatibility

**Risk:** Adding `is_estimated` to `CompetitorMention` interface and `competitor_budget_skipped` to `LlmMentionsResult` changes the JSON artifact format. `sync-to-dashboard.ts` reads from the JSON file, not from typed imports. Existing `llm_mentions.json` files (from previous pipeline runs) won't have these fields.

**Mitigation:** `sync-to-dashboard.ts` reads with `cm.is_estimated ?? true` fallback (all old competitor data IS estimated). `llmData.competitor_budget_skipped` will be `undefined` for old files, which is falsy — correct behavior (don't log a warning for old data). No breaking change.

### 5.4 `fetchCompetitorMentions` Return Type Change

**Risk:** Adding `completed_all: boolean` to the return type of `fetchCompetitorMentions()` is a breaking interface change. Any callers that destructure the return must handle it.

**Mitigation:** Only one caller: `fetchAllLlmMentions()` (line 352). The existing destructuring `competitorResult = await fetchCompetitorMentions(...)` assigns to a `let` variable typed as `{ mentions: CompetitorMention[], cost: number }`. This needs to be updated to include `completed_all`. Since `track-llm-mentions.ts` calls `fetchDomainMentions` directly (not `fetchCompetitorMentions`), it's unaffected.

---

## 6. Files Modified

| File | Change |
|------|--------|
| `scripts/dataforseo-llm-mentions.ts` | Split budget, add `is_estimated` to `CompetitorMention`, add `completed_all` to competitor return, add `competitor_budget_skipped` to `LlmMentionsResult` |
| `scripts/track-llm-mentions.ts` | Scope detail delete by date, add `is_estimated: false` to visRecords, add `nextDay()` helper |
| `scripts/sync-to-dashboard.ts` | Scope detail delete by date, add `is_estimated` to vis records, log budget skip |
| `scripts/migrations/005-llm-visibility-estimated-flag.sql` | NEW — `ALTER TABLE` add `is_estimated BOOLEAN DEFAULT false` |

No dashboard changes. No edge function changes. No other pipeline files.

---

## 7. Definition of Done Checklist

- [ ] `LLM_DOMAIN_BUDGET` and `LLM_COMPETITOR_BUDGET` are separate, independent guards
- [ ] `LLM_MENTIONS_BUDGET` still works as fallback for domain budget (backward compatible)
- [ ] `fetchCompetitorMentions()` returns `completed_all` flag
- [ ] `fetchAllLlmMentions()` returns `competitor_budget_skipped: boolean`
- [ ] `llm_mention_details` delete scoped to snapshot date in BOTH `track-llm-mentions.ts` and `sync-to-dashboard.ts`
- [ ] Date scoping uses half-open interval `[dayStart, nextDayStart)`, not `<= 23:59:59`
- [ ] `is_estimated: boolean` on `CompetitorMention` interface, set to `true` on all competitor records
- [ ] Migration file `005-llm-visibility-estimated-flag.sql` created with `public.` schema qualifier
- [ ] `visRecords` in both `track-llm-mentions.ts` and `sync-to-dashboard.ts` include `is_estimated`
- [ ] `sync-to-dashboard.ts` uses `?? true` fallback for old `llm_mentions.json` without `is_estimated`
- [ ] `npx tsc --noEmit` passes in pipeline repo
