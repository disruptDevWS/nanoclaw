# Plan: Performance Page — AI Visibility Trend Chart

## Summary

Add an AI Visibility section to the Performance page (`PerformancePage.tsx`) showing mention count trends by platform over time, stat cards with baseline/delta, citation source chips, and an optional competitor comparison table. Uses existing `llm_visibility_snapshots` data already fetched by `useLlmVisibility.ts`.

---

## 1. Current State Analysis

### PerformancePage.tsx (src/pages/audit/PerformancePage.tsx)

Three `<Card>` sections:
1. **Near-Miss Baseline** — keywords positions 11–30 at audit time
2. **Ranking Trend** — summary cards + cluster table + authority chart + top movers
3. **Published Page Performance** — published content ranking impact

**Data pattern:** Gets `id` from `useParams`, passes to 4 hooks from `useAgentData.ts` + 1 from `useClusterFocus.ts`. Does NOT currently fetch the audit record (no `useAudit` call) — the domain is not available.

**Chart pattern:** Uses `ChartContainer` + `LineChart` from Recharts via shadcn chart wrapper (`@/components/ui/chart`). Colors defined via `ChartConfig` objects with HSL strings. CSS variables (`var(--color-${key})`) power line strokes.

**Empty state pattern:** Simple `<p className="text-sm text-muted-foreground text-center py-6">` with actionable copy explaining how to populate data.

### useLlmVisibility.ts (src/hooks/useLlmVisibility.ts)

Already exists with:
- `useLlmVisibilitySnapshots(auditId)` — fetches ALL rows from `llm_visibility_snapshots` ordered by `snapshot_date` ASC. Returns both client and competitor rows (mixed).
- `usePlatformBreakdown(snapshots, clientDomain)` — client-side aggregation: splits by domain, aggregates by platform (client) and by domain (competitors). But this is a **total** aggregation — not per-snapshot-date.
- `useLlmMentionDetails(auditId)` — qualitative mention texts
- `useAiCitationGaps(auditId)` — from Gap phase output
- `useTrackLlmMentions()` — mutation to trigger tracking

**Key observation:** `useLlmVisibilitySnapshots` already returns all the raw data needed. The Performance page just needs client-side aggregation into a different shape (per-date series). No new Supabase query is needed.

### LlmVisibilitySnapshot interface (src/types/database.ts:13–24)

```typescript
{
  id: string;
  audit_id: string;
  domain: string;           // client or competitor
  snapshot_date: string;     // YYYY-MM-DD
  keyword: string;
  platform: string;          // 'google' | 'chat_gpt'
  mention_count: number;
  ai_search_volume: number | null;
  top_citation_domains: string[];  // JSONB array
  created_at: string;
}
```

One row per `(audit_id, snapshot_date, keyword, platform, domain)`. Both client and competitor rows live in the same table, distinguished by `domain`.

**Note:** The prompt's table shape includes `is_estimated` — this column does not exist yet. It's proposed in Plan 2 (data integrity fixes). This plan should not depend on it.

### useAudit hook (src/hooks/useAudits.ts:42)

`useAudit(id: string)` fetches the full audit record including `domain: string`. Currently not imported by PerformancePage.

---

## 2. Proposed Changes by File

### File 1: `src/hooks/useLlmVisibility.ts` — Add derived aggregation hook

**No new file needed.** The prompt suggests creating `src/hooks/useAiVisibility.ts`, but `useLlmVisibilitySnapshots` already fetches the exact data required. Creating a separate hook would either duplicate the Supabase query or need to consume the existing one. Better to add a derived aggregation function to the existing file.

Add `useAiVisibilityTrend(auditId, clientDomain)` — a **derived hook** that:
1. Calls `useLlmVisibilitySnapshots(auditId)` internally
2. Filters client rows (`domain === clientDomain`)
3. Aggregates by `snapshot_date + platform` → `{ date: string, google: number, chat_gpt: number }[]`
4. Extracts latest snapshot data (counts, keywords, citation domains)
5. Filters competitor rows for the latest snapshot date
6. Returns a typed result object

```typescript
export interface AiVisibilityTrendPoint {
  date: string;       // YYYY-MM-DD
  google: number;     // sum of mention_count for google platform
  chat_gpt: number;   // sum of mention_count for chat_gpt platform
}

export interface AiVisibilityTrendResult {
  /** Time-series data points aggregated by date + platform */
  snapshots: AiVisibilityTrendPoint[];
  /** Most recent data point (null if no data) */
  latestSnapshot: AiVisibilityTrendPoint | null;
  /** Keywords tracked in the most recent snapshot */
  keywords: string[];
  /** Deduplicated citation domains from most recent snapshot */
  topCitationDomains: { domain: string; keywordCount: number; totalKeywords: number }[];
  /** Competitor data from latest snapshot (domain-level aggregates) */
  competitors: { domain: string; google: number; chat_gpt: number }[];
  /** Whether any client snapshot data exists */
  hasData: boolean;
  isLoading: boolean;
  error: Error | null;
}
```

**Aggregation logic** (all client-side, no additional Supabase query):

```typescript
export function useAiVisibilityTrend(
  auditId: string | undefined,
  clientDomain: string | undefined,
): AiVisibilityTrendResult {
  const { data: rawSnapshots = [], isLoading, error } = useLlmVisibilitySnapshots(auditId);

  return useMemo(() => {
    if (!clientDomain || rawSnapshots.length === 0) {
      return { snapshots: [], latestSnapshot: null, keywords: [], topCitationDomains: [], competitors: [], hasData: false, isLoading, error: error ?? null };
    }

    // Split client vs competitor
    const clientRows = rawSnapshots.filter(s => s.domain === clientDomain);
    const compRows = rawSnapshots.filter(s => s.domain !== clientDomain);

    if (clientRows.length === 0) {
      return { snapshots: [], latestSnapshot: null, keywords: [], topCitationDomains: [], competitors: [], hasData: false, isLoading, error: error ?? null };
    }

    // Aggregate client rows by date + platform
    const dateMap = new Map<string, { google: number; chat_gpt: number }>();
    for (const row of clientRows) {
      if (!dateMap.has(row.snapshot_date)) dateMap.set(row.snapshot_date, { google: 0, chat_gpt: 0 });
      const entry = dateMap.get(row.snapshot_date)!;
      if (row.platform === 'google') entry.google += row.mention_count;
      else if (row.platform === 'chat_gpt') entry.chat_gpt += row.mention_count;
    }

    const snapshots: AiVisibilityTrendPoint[] = Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));

    const latestSnapshot = snapshots[snapshots.length - 1] ?? null;
    const latestDate = latestSnapshot?.date;

    // Keywords from latest snapshot
    const keywords = latestDate
      ? [...new Set(clientRows.filter(r => r.snapshot_date === latestDate).map(r => r.keyword))]
      : [];

    // Citation domains from latest snapshot (count how many keyword responses each domain appears in)
    const citationMap = new Map<string, number>();
    const latestClientRows = latestDate ? clientRows.filter(r => r.snapshot_date === latestDate) : [];
    for (const row of latestClientRows) {
      for (const d of (row.top_citation_domains ?? [])) {
        citationMap.set(d, (citationMap.get(d) ?? 0) + 1);
      }
    }
    const topCitationDomains = Array.from(citationMap.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([domain, count]) => ({ domain, keywordCount: count, totalKeywords: latestClientRows.length }));

    // Competitor aggregates for latest snapshot date
    const latestCompRows = latestDate ? compRows.filter(r => r.snapshot_date === latestDate) : [];
    const compAgg = new Map<string, { google: number; chat_gpt: number }>();
    for (const row of latestCompRows) {
      if (!compAgg.has(row.domain)) compAgg.set(row.domain, { google: 0, chat_gpt: 0 });
      const entry = compAgg.get(row.domain)!;
      if (row.platform === 'google') entry.google += row.mention_count;
      else if (row.platform === 'chat_gpt') entry.chat_gpt += row.mention_count;
    }
    const competitors = Array.from(compAgg.entries()).map(([domain, counts]) => ({ domain, ...counts }));

    return {
      snapshots,
      latestSnapshot,
      keywords,
      topCitationDomains,
      competitors,
      hasData: true,
      isLoading,
      error: error ?? null,
    };
  }, [rawSnapshots, clientDomain, isLoading, error]);
}
```

**Why this approach over a new file:**
- Reuses the existing `useLlmVisibilitySnapshots` query — no duplicate Supabase call
- If the AI Visibility page and Performance page are both mounted (unlikely but possible), they share the same React Query cache key (`['llm-visibility-snapshots', auditId]`)
- Keeps all LLM visibility data logic in one file

### File 2: `src/pages/audit/PerformancePage.tsx` — Add AI Visibility section

#### Change 2A: Add imports

```typescript
import { useAudit } from '@/hooks/useAudits';
import { useAiVisibilityTrend } from '@/hooks/useLlmVisibility';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { Eye } from 'lucide-react';  // for section icon
```

#### Change 2B: Add hook calls in component body

After the existing `useParams` and hook calls (line 74-78), add:

```typescript
const { data: audit } = useAudit(id!);
const domain = audit?.domain ?? '';
const aiTrend = useAiVisibilityTrend(id, domain || undefined);
```

**Note:** Pass `domain || undefined` to avoid triggering aggregation with empty string before audit loads.

#### Change 2C: Add `AiVisibilitySection` component

Create a local component (same file, above `PerformancePage`) that handles the three display states:

**State 1: No data** (`!aiTrend.hasData && !aiTrend.isLoading`)
```
[Eye icon]
AI Visibility Baseline Not Yet Established
Run "Track AI Visibility" from Settings to establish your baseline.
Once tracking begins, mention trends will appear here.
[Go to Settings button]
```

**State 2: Single snapshot** (`aiTrend.snapshots.length === 1`)
- Banner: "Baseline established {date}. Trend tracking begins after next monthly snapshot."
- Stat cards row: Google Mentions | ChatGPT Mentions | Keywords Tracked
- Each shows count + "Baseline" label
- Citation domains as Badge chips below

**State 3: Two or more snapshots** (`aiTrend.snapshots.length >= 2`)
- Stat cards with latest values + delta from first snapshot (e.g., "12 mentions ↑ from 2 baseline")
- Line chart: X = snapshot dates (MMM YYYY), Y = mention count, two series (Google, ChatGPT)
- Zero-mention series rendered as flat line at zero (not hidden) — achieved by always including both series in the chart config regardless of values
- Citation domain chips below chart

**Competitor table** (conditional, only when `aiTrend.competitors.length > 0`):
```
Competitor AI Visibility (latest snapshot)
Domain | Google Mentions | ChatGPT Mentions
[data rows]
Footnote: "Competitor counts are aggregate estimates, not per-keyword measurements."
```

#### Change 2D: Place the section

Insert the AI Visibility `<Card>` between Section 2 (Ranking Trend) and Section 3 (Published Page Performance) — making it Section 2.5 visually. This positions it naturally: traditional rankings → AI visibility → content impact.

#### Chart configuration

```typescript
const aiChartConfig: ChartConfig = {
  google: { label: 'Google AI Overview', color: 'hsl(221, 83%, 53%)' },   // Blue
  chat_gpt: { label: 'ChatGPT', color: 'hsl(262, 83%, 58%)' },           // Purple
};
```

Two distinct colors — blue for Google (consistent with existing blue usage for primary metrics) and purple for ChatGPT (distinct, no collision with existing green/red/orange semantics).

```tsx
<ChartContainer config={aiChartConfig} className="h-[250px] w-full">
  <LineChart data={aiTrend.snapshots}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis
      dataKey="date"
      tick={{ fontSize: 11 }}
      tickFormatter={(v) => new Date(v + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
    />
    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
    <ChartTooltip content={<ChartTooltipContent />} />
    <Line type="monotone" dataKey="google" stroke="var(--color-google)" strokeWidth={2} dot />
    <Line type="monotone" dataKey="chat_gpt" stroke="var(--color-chat_gpt)" strokeWidth={2} dot />
  </LineChart>
</ChartContainer>
```

**Zero-series handling:** Both `<Line>` components are always rendered. Recharts draws a flat line at y=0 for all-zero series — this is the desired behavior per the prompt. No conditional hiding.

**X-axis date formatting:** `MMM YYYY` (e.g., "Mar 2026") — appropriate for monthly snapshots. The `+ 'T00:00:00'` avoids timezone-shifted date parsing from YYYY-MM-DD strings.

#### Stat cards with delta

```tsx
function AiStatCard({ label, current, baseline, isBaseline }: {
  label: string; current: number; baseline: number; isBaseline: boolean;
}) {
  const delta = current - baseline;
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold text-foreground font-display">{current}</p>
      {isBaseline ? (
        <p className="text-xs text-muted-foreground">Baseline</p>
      ) : (
        <p className="text-xs">
          {delta > 0 && <span className="text-success">↑ from {baseline} baseline</span>}
          {delta < 0 && <span className="text-destructive">↓ from {baseline} baseline</span>}
          {delta === 0 && <span className="text-muted-foreground">No change from baseline</span>}
        </p>
      )}
    </div>
  );
}
```

#### Citation domain chips

```tsx
<div className="mt-4">
  <p className="text-xs text-muted-foreground mb-2">Domains AI Platforms Cite for Your Keywords</p>
  <div className="flex flex-wrap gap-1.5">
    {aiTrend.topCitationDomains.slice(0, 8).map(({ domain, keywordCount, totalKeywords }) => (
      <Badge key={domain} variant="outline" className="text-xs" title={`Appears in ${keywordCount} of ${totalKeywords} keyword responses`}>
        {domain}
      </Badge>
    ))}
  </div>
</div>
```

The `title` attribute provides the tooltip ("Appears in X of Y keyword responses") on hover — native browser tooltip, consistent with the existing minimal approach (no custom tooltip component needed).

#### Competitor table

```tsx
{aiTrend.competitors.length > 0 && (
  <div className="mt-6">
    <h3 className="text-sm font-semibold text-foreground mb-2">Competitor AI Visibility (latest snapshot)</h3>
    <Table>
      <TableHeader>
        <TableRow className="border-border hover:bg-secondary/50">
          <TableHead className="text-muted-foreground">Domain</TableHead>
          <TableHead className="text-muted-foreground text-right">Google Mentions</TableHead>
          <TableHead className="text-muted-foreground text-right">ChatGPT Mentions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {aiTrend.competitors.map((c) => (
          <TableRow key={c.domain} className="border-border hover:bg-secondary/50">
            <TableCell className="text-foreground text-sm font-mono">{c.domain}</TableCell>
            <TableCell className="text-right text-foreground font-mono">{c.google}</TableCell>
            <TableCell className="text-right text-foreground font-mono">{c.chat_gpt}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    <p className="text-xs text-muted-foreground mt-2 italic">
      Competitor counts are aggregate estimates, not per-keyword measurements.
    </p>
  </div>
)}
```

### No other files modified

All changes are in two existing files. No new components, no new pages, no route changes.

---

## 3. Migration/Schema Changes

**None.** This is a read-only dashboard feature consuming existing `llm_visibility_snapshots` data. No new tables, columns, or edge functions.

**Note on `is_estimated`:** The prompt's table shape mentions this column. It does not exist yet — it's proposed in Plan 2 (data integrity fixes). If Plan 2 is implemented first, the competitor table could show an "Estimated" badge per-row. If not, the blanket footnote ("Competitor counts are aggregate estimates") serves the same purpose. The plan does not depend on `is_estimated` existing.

---

## 4. Testing Approach

### 4.1 Static Verification

- `npx tsc --noEmit` — confirms no TypeScript errors
- Verify `useAiVisibilityTrend` compiles with correct return type

### 4.2 Visual: Empty State

Load a Performance page for an audit with no LLM visibility data:
- Verify the empty state card renders with Eye icon, copy, and "Go to Settings" button
- Verify the button links to `/audits/:id/settings`
- Verify Sections 1, 2, and 3 (Near-Miss, Ranking, Published Pages) are unaffected

### 4.3 Visual: Baseline State (single snapshot)

For an audit with one tracking run (e.g., IMA after a single "Track AI Visibility"):
- Verify banner text: "Baseline established [date]..."
- Verify stat cards show counts with "Baseline" label
- Verify NO chart is rendered (only one data point)
- Verify citation domain chips appear with correct tooltip text

### 4.4 Visual: Trend State (2+ snapshots)

Requires running "Track AI Visibility" twice on different dates. If not practical, verify with dev tools by mocking the query response.
- Verify line chart renders with two series (Google blue, ChatGPT purple)
- Verify X-axis shows "MMM YYYY" format
- Verify stat cards show delta from baseline
- Verify zero-mention platform still shows as flat line at zero

### 4.5 Visual: Competitor Table

If competitor data exists in `llm_visibility_snapshots` for the audit:
- Verify table renders below the chart
- Verify footnote is present
- If no competitor data exists, verify the section is completely absent (no empty table, no header)

### 4.6 Regression

- Verify all 3 existing Performance sections render correctly
- Verify page doesn't crash if `useAudit` returns null/loading
- Verify AI Visibility section shows loading state (or nothing) while audit record is being fetched

---

## 5. Known Risks

### 5.1 Multiple Snapshots Requirement for Trend Chart

**Risk:** Most audits will have 0 or 1 snapshots for a long time (monthly tracking cadence). The trend chart only renders with 2+ data points, so the most common state is the baseline view.

**Mitigation:** The baseline state is designed to be informative and set expectations ("Trend tracking begins after next monthly snapshot"). The stat cards provide immediate value even without a trend line.

### 5.2 Domain Loading Race Condition

**Risk:** `useAudit(id!)` is async. Until the audit loads, `domain` is `''`. The `useAiVisibilityTrend` hook needs the domain to filter client vs competitor rows. If called with empty domain, it would incorrectly return `hasData: false`.

**Mitigation:** Pass `domain || undefined` — the hook's guard (`!clientDomain`) returns the empty state. When audit loads and domain becomes available, React re-renders and the hook recomputes with correct data. No flash of incorrect content because both states show the same loading/empty UI.

### 5.3 Shared Query Cache

**Risk:** The AI Visibility page (`AiVisibilityPage.tsx`) and Performance page both use `useLlmVisibilitySnapshots` with the same cache key. If both are mounted simultaneously (e.g., rapid tab switching), they share cached data.

**Mitigation:** This is actually desirable — no duplicate network requests. Both pages read from the same cache. The aggregation is pure client-side and produces different shapes for each page's needs.

### 5.4 Large Snapshot Datasets

**Risk:** With many keywords × 2 platforms × many competitors × many snapshot dates, the `llm_visibility_snapshots` table could return hundreds or thousands of rows.

**Mitigation:** The `useMemo` aggregation is O(n) and runs client-side. Even 1000 rows aggregates in <1ms. No pagination needed. If this ever becomes a concern (years of monthly data × 50 keywords × 10 competitors = ~12K rows/year), the Supabase query could be limited to the last 12 months — but this is not a near-term risk.

### 5.5 `top_citation_domains` may be null/empty

**Risk:** Some snapshot rows may have `top_citation_domains: []` or `null` (keywords with no citations). The citation chip section should handle this gracefully.

**Mitigation:** The `citationMap` loop uses `row.top_citation_domains ?? []` — null-safe. If all citation arrays are empty, `topCitationDomains` will be `[]` and the chip section simply won't render any chips (the label "Domains AI Platforms Cite for Your Keywords" would still show — should be conditional on `topCitationDomains.length > 0`).

---

## 6. Files Modified

| File | Change |
|------|--------|
| `src/hooks/useLlmVisibility.ts` | Add `useAiVisibilityTrend()` derived hook + interfaces (`AiVisibilityTrendPoint`, `AiVisibilityTrendResult`) |
| `src/pages/audit/PerformancePage.tsx` | Add `useAudit` + `useAiVisibilityTrend` hook calls, `AiStatCard` helper, `AiVisibilitySection` component, competitor table — inserted between Ranking Trend and Published Pages |

No new files. No migrations. No edge function changes.

---

## 7. Corrections to Prompt Assumptions

1. **New hook file not needed.** The prompt suggests creating `src/hooks/useAiVisibility.ts`. Since `useLlmVisibilitySnapshots` already exists in `useLlmVisibility.ts` and fetches exactly the right data, adding a derived hook to the same file avoids a duplicate Supabase query and keeps LLM data logic consolidated.

2. **Supabase GROUP BY not available.** The prompt's query pattern uses `SELECT ... GROUP BY snapshot_date, platform`. Supabase JS client doesn't support `GROUP BY`. The existing codebase pattern (confirmed in `usePlatformBreakdown`) is: fetch all rows → aggregate client-side with `Map`. The plan follows this pattern. **Verified:** `useLlmVisibilitySnapshots` has no `.limit()`, no date filter, no `.single()` — it returns the full history (`SELECT * ... ORDER BY snapshot_date ASC`). The derived hook safely reuses it without truncation risk.

3. **`is_estimated` column does not exist yet.** The prompt includes it in the table shape. This column is proposed in Plan 2 (data integrity fixes) and hasn't been implemented. The plan uses a blanket footnote for competitor data instead. **Sequencing note:** Ideally this session runs after Plan 2 is deployed and the migration is applied, at which point the blanket footnote can be replaced with per-row `is_estimated` precision (show "Estimated" badge only on rows where `is_estimated === true`). If sessions run out of order, the footnote is the correct fallback — all historical competitor data from the aggregated endpoint is estimated regardless.

4. **PerformancePage doesn't have the audit domain.** The prompt asks to "filter `domain = clientDomain`" but doesn't address how to get the domain. PerformancePage currently only uses `useParams` for `id` — it needs `useAudit(id!)` added to access `audit.domain`.

5. **Citation tooltip**: The prompt specifies tooltip text "Appears in X of Y keyword responses". The plan implements this via native `title` attribute on Badge, consistent with the codebase's minimal approach (no custom tooltip overlay component). The data for X (keywordCount) and Y (totalKeywords) is computed during aggregation by counting how many keyword rows contain each citation domain.

---

## 8. Definition of Done Checklist

- [ ] `useAiVisibilityTrend` hook returns correct aggregated data, filtering client domain from competitor rows
- [ ] Empty state renders with Eye icon, actionable copy, and link to Settings
- [ ] Single-snapshot state renders stat cards with "Baseline" label, no chart
- [ ] Multi-snapshot state renders line chart with both platform series (Google blue, ChatGPT purple)
- [ ] Zero-mention series shown as flat zero line, not hidden
- [ ] Top citation domains render as Badge chips with tooltip showing keyword response count
- [ ] Competitor comparison table appears only when competitor data exists, with estimation footnote
- [ ] Delta display on stat cards shows change from earliest snapshot to latest
- [ ] No polling — static fetch on mount (React Query default)
- [ ] TypeScript types for all hook return values
- [ ] No hardcoded colors — HSL strings in ChartConfig, design system tokens for text/borders
- [ ] Existing 3 Performance sections unaffected
- [ ] `npx tsc --noEmit` passes
