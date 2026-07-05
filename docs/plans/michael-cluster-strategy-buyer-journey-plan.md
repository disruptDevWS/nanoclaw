# Plan: Michael + Cluster Strategy — Buyer Journey Architecture

## Summary

Two-layer change to make the architecture pipeline buyer-journey-aware: (1) Michael's prompt gets coverage assessment framing so he identifies and fills buyer stage gaps during architecture generation, and (2) the Cluster Strategy's `recommended_pages` JSON writes into `execution_pages` as new rows, making buyer-journey additions executable through the existing Content Factory (Pam → Oscar).

---

## 1. Current State Analysis

### Michael's Prompt (pipeline-generate.ts:1865–1924)

Michael produces 3–7 silos with page tables (URL Slug | Status | Silo | Role | Primary Keyword | Volume | Action). Output ends with `## Cannibalization Warnings` and `## Internal Linking Strategy`.

**14 rules** govern the output (lines 1899–1922). Rules cover: slug format, status values, role vocabulary (locked: pillar/cluster/support), silo count, keyword sourcing, volume accuracy, actions, and priority based on Visibility Posture.

**What's missing:** No buyer stage reasoning. Michael fills keyword slots — if a keyword exists, a page exists. If no keyword maps to "how much does X cost" or "X vs Y comparison", those pages don't get created. The architecture is topically complete but commercially incomplete.

**Model/tokens:** Sonnet, 16384 max_tokens. Adding a coverage assessment table per silo adds ~100–200 tokens per silo (3–7 silos = 300–1400 extra tokens). Well within budget — Jim already uses the same max_tokens for 10+ sections.

### sync-michael (sync-to-dashboard.ts:1928–1969)

Parses Michael's markdown table rows into `execution_pages` records. Each page gets:
- `url_slug`, `silo`, `priority` (1=create, 2=optimize, 3=differentiate, 4=other)
- `page_brief` JSONB: `{ silo_name, role, primary_keyword, primary_keyword_volume, action_required, page_status }`
- `status: 'not_started'`
- `canonical_key` backfilled via primary_keyword → audit_keywords fuzzy match

**No `source`, `buyer_stage`, or `strategy_rationale` columns exist.**

### Cluster Strategy (generate-cluster-strategy.ts)

Single Opus call producing 6 sections:
1. **Buyer Journey Map** (JSON) — `{ stages: [{ stage, keywords, has_page, gap_severity }] }`
2. **Page Coverage Analysis** (prose)
3. **Recommended New Pages** (JSON) — `{ pages: [{ url_slug, primary_keyword, volume, buyer_stage, content_type, priority, rationale }] }`
4. **Format Gaps** (JSON)
5. **AI & Search Optimization Notes** (prose)
6. **Production Sequence** (prose)

Parsed JSON stored in `cluster_strategy` table: `recommended_pages`, `buyer_stages`, `format_gaps`.

**The gap:** Section 3 `recommended_pages` is stored in `cluster_strategy.recommended_pages` (JSONB) but never written to `execution_pages`. These pages exist in the strategy document but are invisible to Pam and Oscar. The ClustersPage shows them in a strategy sheet, but there's no "Add to Queue" action that actually creates `execution_pages` rows.

### Pam's Page Context (generate-brief.ts:655–684)

Pam receives:
```
## Page Identity
- Domain: ${domain}
- URL: /${slug}
- Silo: ${siloName}
- Role: ${pageRole}
- Service category: ${service_key}
- Market: ${market_city}, ${market_state}
```

No `buyer_stage` or `strategy_rationale` fields. Pam doesn't know which buyer journey stage a page targets — she infers it from keywords and role, which works for standard pages but not for buyer-journey additions (cost guides, comparison pages, etc.) where the strategic rationale matters.

### Content Queue (ExecutionPage.tsx)

Displays pages with category badges (NEW, REVISION, META, SCHEMA) based on `page_brief.action_required`. No visual distinction between Michael's architecture pages and any hypothetical cluster strategy additions. No `source` field exists on the table.

### ClustersPage.tsx — Strategy Sheet

When "View Strategy" is clicked for an activated cluster, a sheet displays the strategy markdown. The `recommended_pages` JSON is shown but there's no button to write those pages into `execution_pages`.

---

## 2. Proposed Changes by File

### File 1: `scripts/pipeline-generate.ts` — Michael's Prompt (Part A1)

#### Change 1A: Add Buyer Journey Coverage Assessment requirement

**After line 1897** (the Internal Linking Strategy section), before the `## Rules` heading (line 1899), insert a new section:

```
## Buyer Journey Coverage Requirement (applies to ALL silos)

For each silo, after the page table, include a coverage assessment block:

### Silo N Coverage Assessment
| Buyer Stage | Coverage | Pages Addressing | Gap |
|-------------|----------|-----------------|-----|
| Awareness (problem recognition, research queries) | Covered / Partial / Missing | [page slugs] | [what's missing] |
| Consideration (comparison, evaluation, "how does X work") | Covered / Partial / Missing | [page slugs] | [what's missing] |
| Decision (pricing, booking, contact, "best X near me") | Covered / Partial / Missing | [page slugs] | [what's missing] |
| Retention (recertification, renewal, ongoing needs) | Present / Not applicable | [page slugs] | [if applicable] |

Rules for coverage assessment:
- "Covered" = at least one page in this silo directly addresses queries at this stage
- "Partial" = stage is touched but not fully addressed (e.g., commercial page exists but no cost/comparison content)
- "Missing" = no page addresses this stage — gap must be noted
- If Consideration or Decision is "Missing", add at least one page to the silo table to address it before flagging it as a gap
- Retention is optional — mark "Not applicable" for non-recurring services
- Do not add pages for gap stages without keyword volume evidence; note the gap but mark as "low priority" if no volume data supports it
```

#### Change 1B: Add Rules 15 and 16

After Rule 14 (line 1922), add:

```
15. Every silo must have at least one page covering Consideration stage and one covering Decision stage.
    If keyword data doesn't support a dedicated page, combine stages on the pillar and note the constraint in the Coverage Assessment.
16. GEO PAGES ARE ROLES WITHIN A SILO, NOT SEPARATE SILOS. For multi-market clients serving multiple cities/states:
    - One silo per topic. "EMT Training" is one silo regardless of targeting Idaho, Washington, and Oregon.
    - Geo hub pages (state-level) and geo-service pages (city-level) are page roles WITHIN the silo.
    - Valid page roles for geo targeting: "cluster" for geo hub pages (e.g., /emt-training/washington), "support" for city-specific pages (e.g., /emt-training/boise-id)
    - The pillar page is geography-agnostic (e.g., /emt-training) — it covers the topic nationally with schema and entity authority.
    - Supporting content (cost guides, requirements, FAQs) informs all geos and belongs in the silo once, not duplicated per market.
    - Topic authority accumulates to the silo's canonical entity across all geo variants. Splitting into "Idaho EMT Training" and "Washington EMT Training" as separate silos fragments this authority.
    - Internal linking: geo pages link up to the pillar (reinforcing entity signal), pillar links down to geo hubs, geo hubs link down to city pages.
    - Do NOT create separate silos for each market when the underlying service/topic is the same.
```

**Impact on sync-michael parsing:** The coverage assessment table uses a different heading pattern (`### Silo N Coverage Assessment`) than the page tables (`### Silo N: [Name]`). The existing sync-michael parser (sync-to-dashboard.ts:1770–1776) searches for `### Silo \d+:` — the coverage table won't match because it uses "Coverage Assessment" not a colon-delimited name. The table parser (line 1808) only extracts tables within detected silo sections. **No parser changes needed** — the coverage tables will be in the markdown but not parsed into structured data. They exist for Jim-like agents and humans reading the blueprint.

**Impact on sync-michael for geo page roles:** Rule 16 instructs Michael to use "cluster" and "support" as roles for geo hub and city pages. These are already valid role values per Rule 3 (locked vocabulary: pillar/cluster/support). No parser or sync changes needed. The role column stores whatever string Michael produces in the Role cell — if Michael outputs "cluster" for a geo hub page, it syncs correctly. If a future change warrants distinct `geo_hub`/`geo_service` role values, Rule 3 and sync-michael parsing would need updating, but the current plan keeps geo pages within the existing vocabulary to avoid downstream breakage.

**Token impact:** ~100–200 tokens per silo (4-row table + assessment) + ~200 tokens for Rule 16. 3–7 silos = 300–1400 tokens for coverage tables + 200 flat for the rule. Michael's max_tokens is 16384; current average output is ~8000–12000 tokens. Comfortable margin.

### File 2: `scripts/generate-cluster-strategy.ts` — Wire recommended_pages to execution_pages (Part A2)

#### Change 2A: Add Step 9b — insert recommended pages

After the cluster activation step (Step 12, line 409) and before the page flagging step (Step 12, line 411), insert a new step that writes recommended pages into `execution_pages`:

```typescript
// 11b. Write recommended pages from cluster strategy into execution_pages
const recPages = recommendedPages?.pages ?? [];
if (recPages.length > 0) {
  // Load existing slugs to prevent duplicates
  const { data: existingPages } = await sb
    .from('execution_pages')
    .select('url_slug')
    .eq('audit_id', auditId);

  const existingSlugs = new Set((existingPages ?? []).map((p: any) =>
    (p.url_slug as string).replace(/^\/+/, '').toLowerCase()
  ));

  const candidates = recPages
    .filter((p: any) => !existingSlugs.has((p.url_slug ?? '').replace(/^\/+/, '').toLowerCase()));

  // Insert one-by-one to handle race conditions gracefully.
  // No unique constraint exists on (audit_id, url_slug), so concurrent
  // cluster activations could produce duplicates with a bulk insert.
  // Per-row insert with a pre-check is the same pattern sync-michael uses (line 1948-1968).
  let inserted = 0;
  for (const p of candidates) {
    const slug = (p.url_slug ?? '').replace(/^\/+/, '');
    // Re-check at insert time (handles concurrent activations)
    const { data: exists } = await sb
      .from('execution_pages')
      .select('id')
      .eq('audit_id', auditId)
      .or(`url_slug.eq.${slug},url_slug.eq./${slug}`)
      .maybeSingle();
    if (exists) continue;

    const { error } = await sb.from('execution_pages').insert({
      audit_id: auditId,
      url_slug: slug,
      silo: cluster.canonical_topic ?? null,
      canonical_key: args.canonicalKey,
      priority: p.priority === 1 ? 1 : p.priority === 2 ? 2 : 3,
      status: 'not_started',
      page_brief: {
        silo_name: cluster.canonical_topic ?? null,
        role: mapContentTypeToRole(p.content_type ?? ''),
        primary_keyword: p.primary_keyword ?? null,
        primary_keyword_volume: p.volume ?? null,
        action_required: 'create',
        page_status: 'new',
      },
      cluster_active: true, // cluster is being activated in the same operation
      source: 'cluster_strategy',
      buyer_stage: p.buyer_stage ?? null,
      strategy_rationale: p.rationale ?? null,
    });
    if (error) {
      console.warn(`  [cluster-strategy] Warning: Failed to insert page ${slug}: ${error.message}`);
    } else {
      inserted++;
    }
  }
  if (inserted > 0) {
    console.log(`  [cluster-strategy] Added ${inserted} buyer-journey pages to execution_pages`);
  } else if (candidates.length > 0) {
    console.log(`  [cluster-strategy] No new pages to add (all ${recPages.length} recommended pages already exist)`);
  }
}
```

**Race condition handling:** `execution_pages` has no unique constraint on `(audit_id, url_slug)`. If two cluster activations run concurrently (unlikely but possible), a bulk insert after a single point-in-time slug check could produce duplicates. The plan uses per-row SELECT-then-INSERT — the same pattern sync-michael uses (line 1948-1968). Each row re-checks slug existence immediately before insert, narrowing the race window to near-zero. A true unique constraint would be cleaner but would require migrating existing data (legacy leading-slash variants mean some audits may have both `/slug` and `slug` rows). The per-row check is pragmatic and consistent with the codebase.

#### Change 2B: Add `mapContentTypeToRole` helper function

Add before `main()`:

```typescript
function mapContentTypeToRole(contentType: string): string {
  const map: Record<string, string> = {
    pillar_page: 'pillar',
    service_page: 'cluster',
    comparison: 'support',
    comparison_page: 'support',
    cost_guide: 'support',
    faq: 'support',
    faq_hub: 'support',
    guide: 'support',
    process_guide: 'support',
    calculator: 'support',
    informational: 'support',
    location_page: 'cluster',
  };
  return map[contentType] ?? 'support';
}
```

**Why `support` as default:** Buyer-journey additions (cost guides, comparisons, calculators) are typically support pages — they don't compete with the pillar or cluster pages for the primary head terms. `sync-michael` parses role values as exactly `pillar | cluster | support` (line 1902–1906). Using these exact strings ensures downstream processing works.

#### Change 2C: Strengthen Section 1 and Section 3 prompt instructions

In the prompt construction (line 300–321), update:

**Section 1 instruction** — append after "Identify which stages have coverage and which are gaps.":
```
For each stage, identify the SPECIFIC QUESTIONS a buyer in this vertical asks at that stage —
not generic stage descriptions. For a medical training cluster, Consideration stage questions
might be "How long does EMT certification take?", "What's the difference between EMT-Basic and AEMT?",
"Is this program accredited?" These specific questions are the content targets for pages at that stage.
```

**Section 3 instruction** — append after the JSON format example:
```
Recommended pages must go BEYOND what the current page manifest already covers.
Do not recommend pages that duplicate existing page slugs.
For each recommended page, the rationale must name the specific buyer stage question it answers
and why that question is not currently addressed by existing pages.
Priority 1 = addresses a missing Consideration or Decision stage gap with keyword volume evidence.
Priority 2 = addresses a missing Awareness or Retention stage with volume evidence.
Priority 3 = format gap (comparison, calculator, cost guide) without strong keyword volume but with competitive evidence.
```

### File 3: `scripts/generate-brief.ts` — Pass buyer context to Pam (Part B2)

#### Change 3A: Include `buyer_stage` and `strategy_rationale` in page data select

In the page data loading section (around line 175–184), the query is:
```typescript
.select('page_brief, url_slug, silo')
```

Update to:
```typescript
.select('page_brief, url_slug, silo, source, buyer_stage, strategy_rationale')
```

**Note:** These columns don't exist yet (migration needed — see Section 3). After migration, these will be nullable columns. Before migration, Supabase will ignore the unknown column names in the select (returns null for them) — no runtime error, just null values. **Wait, that's wrong** — Supabase will return an error for selecting columns that don't exist on the table. The migration must be applied before this code deploys. Alternatively, use `select('*')` which always works but returns more data than needed. Since `execution_pages` already has ~20 columns and we're selecting a single row, `select('*')` is fine performance-wise. **Use `select('*')` to be migration-order-safe.**

#### Change 3B: Inject buyer stage context into Pam's prompt

In `buildPrompt()` (line 655+), after the `## Page Identity` section (lines 661–667), add:

```typescript
${pageData?.buyer_stage ? `
## Buyer Journey Context
- Buyer Stage Target: ${pageData.buyer_stage}
- Source: Cluster strategy recommendation (not original architecture)
${pageData.strategy_rationale ? `- Strategic Rationale: ${pageData.strategy_rationale}` : ''}
IMPORTANT: This page was added to address a gap in the ${pageData.buyer_stage} stage of the buyer journey.
The content brief must directly address the questions buyers have at this stage, not just target
the primary keyword. The page should guide the reader toward the next stage in their journey.` : ''}
```

**Conditional injection:** Only present when `buyer_stage` is non-null (cluster strategy pages). Michael's architecture pages have `buyer_stage: null` and get no injection — Pam operates exactly as before for them.

**`undefined` safety (explicit):** With `select('*')`, if the migration hasn't run, the `buyer_stage` property won't exist on the returned object — `pageData?.buyer_stage` returns `undefined`. If the migration has run but the value is `null` (Michael's architecture pages), `pageData?.buyer_stage` returns `null`. Both `undefined` and `null` are falsy, so `${pageData?.buyer_stage ? '...' : ''}` evaluates to `''` — the entire `## Buyer Journey Context` block is omitted. No "undefined" string can leak into Pam's prompt. The inner `strategy_rationale` check uses the same truthiness pattern. Implementation must use this exact `? ... : ''` ternary — never string interpolation without the guard (e.g., never `${pageData.buyer_stage}` directly).

### File 4: `scripts/migrations/006-execution-pages-cluster-strategy-fields.sql` — New columns (Part A)

```sql
-- Add cluster strategy origin tracking to execution_pages
ALTER TABLE public.execution_pages
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'michael',
  ADD COLUMN IF NOT EXISTS buyer_stage TEXT,
  ADD COLUMN IF NOT EXISTS strategy_rationale TEXT;

COMMENT ON COLUMN public.execution_pages.source IS
  'Origin of this page recommendation: michael = architecture blueprint, cluster_strategy = buyer journey addition from cluster activation';
COMMENT ON COLUMN public.execution_pages.buyer_stage IS
  'Buyer journey stage this page targets: awareness | consideration | decision | retention. Null for standard architecture pages.';
COMMENT ON COLUMN public.execution_pages.strategy_rationale IS
  'Rationale from cluster strategy for why this page was recommended. Null for standard architecture pages.';
```

**No CHECK constraint on `source`:** The prompt suggests `CHECK (source IN ('michael', 'cluster_strategy'))`. This is fragile — if we add a third source later, the constraint requires another migration. Since this is an informational field (not a foreign key or enum used in logic), a comment documenting valid values is sufficient. Dashboard code checks `source === 'cluster_strategy'` for badge display, which works regardless.

**No CHECK constraint on `buyer_stage`:** Same reasoning. Valid values are `awareness | consideration | decision | retention`, documented in the column comment. The value comes from Opus output — constraining it with a CHECK risks insert failures if Opus produces a variant.

### File 5: `src/types/database.ts` — Update ExecutionPage type (Part B)

Add the new fields to `ExecutionPage` interface:

```typescript
// In the ExecutionPage type (wherever it's defined or used)
source?: string;           // 'michael' | 'cluster_strategy'
buyer_stage?: string;      // 'awareness' | 'consideration' | 'decision' | 'retention'
strategy_rationale?: string;
```

### File 6: `src/pages/audit/ExecutionPage.tsx` — Buyer Journey badge (Part B1)

#### Change 6A: Add badge for cluster strategy pages

In the page card rendering (where category badges are displayed), add a conditional badge after the existing category badge:

```tsx
{page.source === 'cluster_strategy' && (
  <Badge
    variant="outline"
    className="text-[10px] border-purple-500/30 text-purple-500"
    title={`Buyer journey ${page.buyer_stage ?? 'gap'} addition${page.strategy_rationale ? `: ${page.strategy_rationale}` : ''}`}
  >
    Journey Addition
  </Badge>
)}
```

Purple is used because it's distinct from the existing category badge colors (green=NEW, blue=REVISION, amber=META, orange=SCHEMA) and from status colors (green=success, red=destructive).

The `title` attribute provides native tooltip with buyer stage + rationale.

**Note on `(supabase as any)` pattern:** The `useExecutionPages` hook in `useAgentData.ts` likely uses `supabase.from('execution_pages').select('*')`. Since we're adding nullable columns with defaults, the query will return them. But the TypeScript type won't include them until we update `database.ts`. The `(supabase as any)` pattern is already used elsewhere — or we update the type definition directly.

### File 7: `src/pages/audit/ClustersPage.tsx` — Buyer journey coverage display (Part B3)

#### Change 7A: Add coverage indicator for activated clusters

For clusters with a strategy document that includes `buyer_stages` JSON, display a compact coverage row under the cluster card in the strategy sheet.

Parse `buyer_stages` from `cluster_strategy` table (already queried when strategy sheet is opened).

```tsx
{strategy?.buyer_stages?.stages && (
  <div className="mt-3">
    <p className="text-xs text-muted-foreground mb-1.5">Buyer Journey Coverage</p>
    <div className="flex flex-wrap gap-1.5">
      {strategy.buyer_stages.stages.map((stage: any) => {
        const icon = stage.gap_severity === 'none' ? '✓' : stage.gap_severity === 'low' ? '⚠' : '✗';
        const color = stage.gap_severity === 'none'
          ? 'border-success/30 text-success'
          : stage.gap_severity === 'low'
          ? 'border-warning/30 text-warning'
          : 'border-destructive/30 text-destructive';
        return (
          <Badge key={stage.stage} variant="outline" className={`text-xs ${color}`}
            title={`${stage.keywords?.length ?? 0} keywords mapped. ${stage.has_page ? 'Has page coverage.' : 'No page coverage.'}`}
          >
            {icon} {stage.stage}
          </Badge>
        );
      })}
    </div>
  </div>
)}
```

**Read-only display.** The gap items are a cue to review the Content Queue for buyer journey addition pages. No expand-on-click — the strategy sheet already has the full document.

---

## 3. Migration/Schema Changes

### Migration: `006-execution-pages-cluster-strategy-fields.sql`

Three nullable columns on `execution_pages`:
- `source TEXT DEFAULT 'michael'` — all existing rows get 'michael' (correct — they're all from Michael)
- `buyer_stage TEXT` — null for existing rows (correct — only cluster strategy pages have this)
- `strategy_rationale TEXT` — null for existing rows

**Deployment order:** Migration must be applied before the pipeline code that writes `source`, `buyer_stage`, `strategy_rationale` deploys. The dashboard code reads these columns but handles null gracefully (conditional rendering). Safe to deploy dashboard before or after migration.

**Recommended sequence:**
1. Apply migration to Supabase
2. Deploy pipeline (Part A) — Michael prompt + cluster strategy writer
3. Deploy dashboard (Part B) — badges + coverage display

---

## 4. Testing Approach

### 4.1 Static Verification

- `npx tsc --noEmit` in both repos after changes
- Verify `mapContentTypeToRole` covers all `content_type` values from the prompt JSON schema

### 4.2 Michael Prompt Test (Part A1)

Run a pipeline on a test domain:
```bash
./scripts/run-pipeline.sh idahomedicalacademy.com matt@forgegrowth.ai --start-from 6 --stop-after 6c
```

Inspect `architecture_blueprint.md`:
- Each silo has a "Coverage Assessment" table after the page table
- Coverage assessment identifies gaps (especially Consideration/Decision)
- If Consideration or Decision was "Missing", Michael added a page to the silo table
- Rule 15 compliance: every silo has at least one Consideration and one Decision page
- Rule 16 compliance (for multi-market domains like IMA): geo hub and city pages are within the topic silo, not in separate per-market silos. Verify no silos named "Idaho EMT Training" / "Washington EMT Training" — should be one "EMT Training" silo with geo pages inside

### 4.3 Cluster Strategy → execution_pages Test (Part A2)

After applying migration, activate a cluster on IMA:
1. Click "Activate" on a cluster in the Clusters page
2. Wait for Opus strategy to generate
3. Check Supabase: `SELECT * FROM execution_pages WHERE audit_id = '...' AND source = 'cluster_strategy'`
4. Verify: `buyer_stage` and `strategy_rationale` populated, `cluster_active = true`, slug doesn't duplicate existing pages

### 4.4 Pam Context Test (Part B2)

Generate a brief for a cluster strategy page:
1. In Content Queue, find a page with "Journey Addition" badge
2. Click "Generate Brief"
3. Add temporary `console.log(prompt)` in generate-brief.ts
4. Verify the `## Buyer Journey Context` section appears in Pam's prompt

### 4.5 Dashboard Visual Test (Part B)

- Content Queue: "Journey Addition" badge appears on cluster strategy pages, tooltip shows buyer stage + rationale
- Clusters page: Coverage indicator badges render for activated clusters with strategy
- Coverage indicator colors match gap severity (green=none, orange=low, red=high)

### 4.6 Regression

- Pages from Michael (no cluster strategy) show no "Journey Addition" badge
- Clusters without strategy show no coverage indicator
- Re-running a pipeline (sync-michael) doesn't overwrite `source='cluster_strategy'` pages (sync-michael matches by slug — if the slug already exists, it updates `page_brief` but doesn't overwrite other columns)

**Actually, this is a risk.** sync-michael's upsert logic (line 1958–1965) updates `page_brief, silo, priority, snapshot_version` for matching slugs. If a cluster strategy page's slug matches a new Michael architecture page (unlikely but possible), the `page_brief` gets overwritten but `source`, `buyer_stage`, `strategy_rationale` survive (those columns aren't in the update set). This is acceptable — if Michael independently produces the same page, the architecture brief takes precedence over the strategy rationale.

---

## 5. Known Risks

### 5.1 Michael's Coverage Assessment Quality

**Risk:** Michael may produce generic coverage tables ("Awareness: Covered", "Decision: Covered") without meaningful gap identification. The assessment becomes noise rather than signal.

**Mitigation:** Rule 15 creates a hard constraint: if Consideration or Decision is "Missing", Michael must add a page. This makes the assessment consequential, not just documentation. The coverage table format also requires specific page slugs and gap descriptions — harder to hand-wave than prose.

**Secondary mitigation:** The coverage assessment tables are visible in the architecture blueprint artifact on disk and in `agent_architecture_blueprint.blueprint_markdown` in Supabase. QA rubrics could be extended to validate them, but that's a follow-up.

### 5.2 Opus Recommended Pages JSON Format

**Risk:** The `recommended_pages` JSON may have unexpected field names or structures (e.g., `slug` instead of `url_slug`, `keyword` instead of `primary_keyword`). The parsing code uses `p.url_slug`, `p.primary_keyword`, etc.

**Mitigation:** The prompt explicitly specifies the JSON schema (lines 319–321). Opus reliably follows JSON format instructions, especially with the existing `FORMATTING RULES` block. Defensive access with `?? null` / `?? ''` prevents crashes on missing fields. If a field is missing, the page still gets created — it just has null for that field.

### 5.3 Slug Collision Between Michael and Cluster Strategy

**Risk:** Cluster strategy recommends a page with a slug that Michael later generates in a re-run. sync-michael's upsert updates `page_brief` on the existing row but leaves `source`, `buyer_stage`, `strategy_rationale` intact. The page now has hybrid provenance.

**Mitigation:** This is actually fine. If Michael independently identifies the same page, the architecture brief (keyword-based) augments the strategy rationale (buyer-stage-based). Pam gets both signals. The "Journey Addition" badge persists, which is slightly misleading but not harmful. If this becomes an issue, sync-michael could be extended to clear `source='cluster_strategy'` when it overwrites a page brief — but this adds complexity for an unlikely edge case.

### 5.4 Execution Order: Migration Before Deploy

**Risk:** If pipeline code deploys before the migration, `INSERT INTO execution_pages` with unknown columns (`source`, `buyer_stage`, `strategy_rationale`) will fail.

**Mitigation:** Apply migration first. The insert is wrapped in a non-fatal `console.warn` — if it fails, cluster activation still succeeds. But this is a degraded state. Deploy sequence: migration → pipeline → dashboard.

### 5.5 Michael Prompt Length Increase

**Risk:** Adding the Coverage Assessment section + Rules 15-16 increases prompt length by ~800–1000 chars (Rule 16 is ~400 chars by itself). Combined with Michael's already-large prompt (keywords, crawl data, gaps, strategy brief, client context), this is a marginal increase.

**Mitigation:** Michael's prompt is well within the 200K context window. The output increase (~300–1400 tokens for coverage tables) is within the 16384 max_tokens budget. No action needed.

### 5.6 Re-activation Duplicates

**Risk:** If a cluster is deactivated then re-activated (new strategy), the recommended pages from the first activation already exist in `execution_pages`. The second activation's slug dedup check catches these — no duplicates. But the `strategy_rationale` from the first strategy persists. If the second strategy has different rationale, the old one stays.

**Mitigation:** Acceptable. The rationale is informational, not operational. If we wanted to update it, the insert step could be changed to upsert by `(audit_id, url_slug)` — but this adds complexity. The common case is single activation per cluster.

---

## 6. Corrections to Prompt Assumptions

1. **`page_role` mapping function location.** The prompt places `mapContentTypeToRole` inside the recommended pages insertion block. It should be a standalone function (before `main()`) since it's a pure utility. Also, the content_type values in the prompt (`service_page`, `faq`, `guide`, `comparison`, `location_page`) don't exactly match the mapping table in the prompt (`pillar_page`, `comparison_page`, `faq_hub`, `process_guide`, `calculator`, `informational`). The mapping should cover both sets — the Opus prompt uses the first set, but Opus may produce either. Plan includes both.

2. **Pam's page data select.** The prompt says to include `buyer_stage` and `strategy_rationale` in the select. But if the migration hasn't been applied, selecting named columns that don't exist will cause a Supabase error. Plan uses `select('*')` for migration-order safety. Only affects the single-page lookup query (1 row), so performance is identical.

3. **CHECK constraint on `source`.** The prompt specifies `CHECK (source IN ('michael', 'cluster_strategy'))`. This is fragile — a future third source would require another migration. Removed in favor of a column comment documenting valid values. The dashboard checks `source === 'cluster_strategy'` programmatically.

4. **Coverage display on ClustersPage.** The prompt describes clickable stage chips that expand to show pages. This adds significant UI complexity for marginal value — the strategy sheet already has the full document. Plan simplifies to read-only Badge chips with tooltip, consistent with the existing authority score pattern.

5. **Recommended pages insertion step placement.** The prompt says "after Step 9 (strategy parsed)". But the parsed `recommendedPages` is available at line 373, while cluster activation is at line 397 and page flagging at line 411. The insertion should happen between activation and page flagging — pages need `cluster_active: true`, which requires the cluster to be active first. Plan places it at Step 11b (after cluster activation, before page flagging).

   **Wait — the page flagging step only sets `cluster_active=true` on EXISTING pages** (those with matching `canonical_key`). The new pages we insert already have `cluster_active: true` set in the insert. So the order is: activate cluster → insert new pages (with `cluster_active: true`) → flag existing pages (also `cluster_active: true`). All pages end up active. Correct.

6. **`pam_requests` integration.** The prompt mentions B2 (Pam context) but doesn't address how `pam_requests` passes data. Looking at `generate-brief.ts`, Pam loads the `execution_pages` row directly (`select('*').eq('audit_id', ...).or('url_slug...')` at line 175). So the buyer_stage/strategy_rationale flow is: `execution_pages` row has the fields → Pam's page data load picks them up → `buildPrompt()` conditionally injects the `## Buyer Journey Context` block. No `pam_requests` schema change needed.

---

## 7. Files Modified

| File | Repo | Change |
|------|------|--------|
| `scripts/pipeline-generate.ts` | pipeline | Add Coverage Assessment section + Rule 15 to Michael's prompt |
| `scripts/generate-cluster-strategy.ts` | pipeline | Insert recommended_pages into execution_pages + strengthen Section 1/3 instructions |
| `scripts/generate-brief.ts` | pipeline | Inject buyer_stage/strategy_rationale into Pam's prompt |
| `scripts/migrations/006-execution-pages-cluster-strategy-fields.sql` | pipeline | Add source, buyer_stage, strategy_rationale columns |
| `src/types/database.ts` | dashboard | Add source, buyer_stage, strategy_rationale to ExecutionPage type |
| `src/pages/audit/ExecutionPage.tsx` | dashboard | "Journey Addition" badge on cluster_strategy pages |
| `src/pages/audit/ClustersPage.tsx` | dashboard | Buyer journey coverage badges for activated clusters |

---

## 8. Definition of Done Checklist

**Part A (pipeline):**
- [ ] Michael's prompt includes Buyer Journey Coverage Assessment table for every silo
- [ ] Rule 15 enforces Consideration + Decision stage coverage
- [ ] Rule 16 enforces geo pages as roles within silos, not separate silos
- [ ] Migration `006-execution-pages-cluster-strategy-fields.sql` created with `source`, `buyer_stage`, `strategy_rationale`
- [ ] Cluster strategy's `recommended_pages` writes to `execution_pages` with `source='cluster_strategy'`
- [ ] Duplicate slug guard prevents overwriting existing pages
- [ ] `mapContentTypeToRole()` maps content_type to valid role strings
- [ ] Non-fatal error handling on recommended pages insert
- [ ] Section 1 instructions require specific buyer questions, not generic stage descriptions
- [ ] Section 3 instructions require rationale naming specific buyer stage question and existing page gap
- [ ] `npx tsc --noEmit` passes in pipeline repo

**Part B (dashboard):**
- [ ] Content Queue shows "Journey Addition" badge on `source='cluster_strategy'` pages
- [ ] Badge tooltip includes buyer stage and rationale
- [ ] Pam's prompt includes `## Buyer Journey Context` block when `buyer_stage` is present
- [ ] Cluster Focus page shows coverage indicator badges for activated clusters with strategy
- [ ] Empty state (no strategy) shows no coverage indicator
- [ ] TypeScript types updated for new `execution_pages` fields
- [ ] `npx tsc --noEmit` passes in dashboard repo
