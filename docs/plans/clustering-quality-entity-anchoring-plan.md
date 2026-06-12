# Plan: Clustering Quality — Phase 3c Prompt Improvements + Entity Anchoring

## Summary

Improve Phase 3c canonicalize prompt quality and add entity type classification that flows through Cluster Strategy and Pam. The original task assumed Phase 3c uses Haiku — **it already uses Sonnet** (line 2129 of `pipeline-generate.ts`). The model upgrade is done; what remains is prompt enrichment, entity type plumbing, and downstream integration.

---

## 1. Critical Corrections to the Original Prompt

### Correction 1: Phase 3c already uses Sonnet

The prompt states: "Problem 1 — Haiku is the wrong model for Phase 3c" and proposes upgrading to Sonnet.

**Actual code** (`pipeline-generate.ts:2129`):
```typescript
const result = await callClaude(prompt, { model: 'sonnet', phase: 'canonicalize' });
```

Phase 3c already uses Sonnet. The CLAUDE.md documentation ("Semantic topic grouping (Haiku)") is stale and should be corrected. **Change 1A (model upgrade) is already done — skip entirely.**

### Correction 2: Batch size is 250, not 150

The prompt references "batches of 150 keywords" and "cost per batch."

**Actual code** (`pipeline-generate.ts:2033`):
```typescript
const MAX_BATCH = 250;
```

Cost estimates in the prompt are based on 150-keyword batches — actual batches are 250. This doesn't change the approach, just the economics (fewer batches per audit).

### Correction 3: Current prompt is already substantial

The prompt says the current prompt is "functional but underspecified." The actual prompt (lines 2083-2124) already includes:
- Geo-stripping rules with concrete examples
- Synonym merging instructions
- Intent classification taxonomy with detailed commercial/transactional/informational/navigational guidance
- Near-me handling (deterministic post-classification at line 2164-2174)
- Brand detection
- "Other / Unclassified" fallback group
- Target group sizing guidance (1 per 5-8 keywords, 5-40 groups)

**The current prompt is good at labeling but weak on splitting decisions.** The only grouping guidance is "Target approximately 1 group per 5-8 keywords" — a density heuristic, not a semantic principle. Sonnet is left to infer when two related topics should share a cluster vs. be separate silos, and pattern-matches on surface similarity without business context. "EMT certification" and "EMT recertification" look similar but serve different audiences (new students vs. lapsed certifications) — the prompt gives no basis for that call.

The informational keyword gap is a significant contributor to cluster fragmentation. The prompt classifies informational keywords correctly by intent but says nothing about which *cluster* they belong to. Sonnet may group all informational keywords together into topic-agnostic clusters ("Cost Guides", "How-To Guides") rather than assigning "how much does EMT training cost" to the EMT Training cluster. This produces thin service clusters and orphaned informational groups.

**Three surgical additions will address both failure modes:**
1. Split/merge decision rule block — when to combine vs. separate clusters based on business significance
2. Informational keyword placement rules — cost/how-to/comparison keywords belong in their parent service cluster
3. `primary_entity_type` field in the output schema

The full prompt replacement proposed in the original task is overkill — we should surgically add the missing guidance rather than rewrite working instructions.

### Correction 4: No CHECK constraint on entity_type columns

The prompt proposes `CHECK (primary_entity_type IN (...))` on `audit_clusters`. Supabase CHECK constraints on ALTER TABLE are fragile with the SQL editor and create migration headaches. Use application-level validation with a fallback default (`?? 'Service'`), consistent with existing patterns.

---

## 2. Changes

### Change A: Enhance Phase 3c Prompt (`pipeline-generate.ts`)

**File:** `scripts/pipeline-generate.ts`, `runCanonicalize()` function

**What:** Add three blocks to the existing prompt (lines 2083-2124) without replacing the entire prompt.

**A1: Add split/merge decision rule block** — Insert after the synonym merging rule (line 2092), as a new labeled section:

```
WHEN TO SPLIT vs. MERGE:
- Merge into one cluster: same primary service, different geo modifiers, word-order variants, or specificity levels
- Merge into one cluster: informational keywords about a service (cost, how-to, FAQ) belong in that service's cluster, NOT a separate informational cluster
- Split into separate clusters: meaningfully different services a business would have dedicated pages for
- Split into separate clusters: topics with different primary audiences or buyer journeys, even if semantically adjacent (e.g., "EMT certification" vs. "EMT recertification" — new students vs. lapsed certifications. "new installation" vs. "repair" vs. "maintenance" for the same equipment type may warrant separate clusters if volume supports it)
- Do NOT create clusters that are purely informational with no commercial anchor — informational keywords attach to their service cluster
```

This addresses the core clustering quality problem: the existing prompt tells Sonnet *how to label* but gives no guidance on *when to split vs. merge*. The density heuristic ("1 group per 5-8 keywords") is necessary but insufficient — it should be subordinate to these semantic rules.

**Geo-agnostic clustering principle (already enforced, now explicit in split/merge rules):** The cluster is the topic, not the market. "EMT Training" is one cluster regardless of targeting Idaho, Washington, or Oregon. The canonical entity is the same — a Course with the same attributes, the same buyer journey, the same content structure. What changes by geography is the instantiation (different regulatory requirements, different providers). Splitting into "Idaho EMT Training" and "Washington EMT Training" fragments topic authority, duplicates Michael's silo structures, and isolates gap analysis by market. The existing geo-stripping rules in the prompt already enforce this at the keyword level — the split/merge rules reinforce it at the decision level. Michael receives a corresponding Rule 16 (Plan 4) instructing that geo pages are roles within a silo, not separate silos.

**A2: Add informational keyword placement rules** — Insert before the `UNCLASSIFIABLE KEYWORDS` section (line 2104):

```
INFORMATIONAL KEYWORD PLACEMENT:
- Cost/pricing queries ("how much does X cost", "X price") → assign to the service/course cluster they price, NOT a separate informational group
- How-to and guide content → assign to the most relevant service cluster
- Comparison queries ("X vs Y") → assign to the cluster of the primary subject, or create a standalone cluster only if both subjects are core services with substantial volume
- Informational keywords belong in the cluster of the entity they inform about, even though they'll be filtered from revenue calculations downstream
- Do NOT create clusters named "Cost Guides", "How-To Guides", "FAQ", or similar topic-agnostic informational buckets. Each informational keyword has a parent service — assign it there.
```

This directly prevents the observed failure mode where Sonnet pulls informational keywords into topic-agnostic clusters, fragmenting the service clusters they should enrich.

**A3: Add `primary_entity_type` to output schema** — Modify the JSON schema block (lines 2113-2123) to include the new field:

Current:
```json
{
  "groups": [
    {
      "canonical_key": "ac_repair",
      "canonical_topic": "AC Repair",
      "keywords": [
        { "index": 1, "is_brand": false, "intent_type": "commercial" }
      ]
    }
  ]
}
```

New:
```json
{
  "groups": [
    {
      "canonical_key": "ac_repair",
      "canonical_topic": "AC Repair",
      "primary_entity_type": "Service",
      "keywords": [
        { "index": 1, "is_brand": false, "intent_type": "commercial" }
      ]
    }
  ]
}
```

Add after the JSON schema block:

```
primary_entity_type must be one of:
- "Service" — a service the business performs (most common for local service businesses)
- "Course" — an educational program with defined duration, credential, enrollment
- "Product" — a physical or digital product
- "LocalBusiness" — the business itself (use only for brand/homepage cluster)
- "FAQPage" — primarily Q&A content with no single service anchor
- "Article" — purely informational content not tied to a specific service or course

When uncertain between Service and Course: if the offering grants a credential or certification, use Course. If it's a job performed for a customer, use Service.
Default to "Service" when the category is ambiguous for a local service business.
```

**A4: Write `primary_entity_type` to `audit_keywords`** — In the keyword update loop (lines 2181-2190), add `primary_entity_type`:

```typescript
sb.from('audit_keywords').update({
  canonical_key: group.canonical_key,
  canonical_topic: group.canonical_topic,
  cluster: group.canonical_topic,
  is_brand: group.keywords[0].is_brand,
  intent_type: group.keywords[0].intent_type,
  intent: group.keywords[0].intent_type,
  is_near_me: nearMeIds.has(kwId),
  primary_entity_type: group.primary_entity_type ?? 'Service',  // NEW
}).eq('id', kwId),
```

Note the `?? 'Service'` fallback — if Sonnet omits the field (unlikely but possible), keywords default to Service.

**A5: max_tokens check** — Current `canonicalize` max_tokens is 4096 (anthropic-client.ts). Adding one field per group (~15 chars × 20 groups = ~300 chars) is marginal. No increase needed. But if future prompt growth pushes output close to limits, this is the knob to turn.

### Change B: Aggregate `primary_entity_type` into `audit_clusters` (`sync-to-dashboard.ts`)

**File:** `scripts/sync-to-dashboard.ts`

**B1: Add to keyword SELECT** — In `rebuildClustersAndRollups()` (line 724), add `primary_entity_type` to the select list:

```typescript
.select('keyword, rank_pos, search_volume, cpc, delta_traffic, delta_revenue_low, delta_revenue_mid, delta_revenue_high, delta_leads_low, delta_leads_high, canonical_key, canonical_topic, cluster, intent_type, intent, is_brand, is_near_miss, topic, primary_entity_type')
```

**B2: Add to `ClusterAgg` type** — Extend the type (line 609-624):

```typescript
type ClusterAgg = {
  topic: string;
  primaryEntityType: string;  // NEW — most common entity_type in cluster
  positions: number[];
  // ... existing fields
};
```

**B3: Aggregate in `buildClusterMap()`** — In the cluster map builder (lines 626-671), track entity types:

When creating a new entry (line 655):
```typescript
map.set(key, {
  topic,
  primaryEntityType: r.primary_entity_type ?? 'Service',  // NEW
  positions: [pos],
  // ... rest
});
```

When updating an existing entry: entity type is per-group, not per-keyword. All keywords in a canonical_key group share the same entity type (set at group level in Phase 3c). So the first non-null value wins. Add after `existing.kwTotal++` (line 653):

```typescript
if (!existing.primaryEntityType || existing.primaryEntityType === 'Service') {
  existing.primaryEntityType = r.primary_entity_type ?? existing.primaryEntityType;
}
```

This prefers any non-Service type over the default, since within a well-formed cluster all keywords share the same type.

**B4: Include in cluster INSERT** — In the cluster record builder (lines 751-768), add:

```typescript
primary_entity_type: c.primaryEntityType ?? 'Service',
```

**B5: Preserve through rebuild** — In the status preservation SELECT (line 706), add `primary_entity_type`:

```typescript
.select('canonical_key, status, activated_at, activated_by, target_publish_date, notes, hidden_reason, primary_entity_type')
```

And in the status restore loop (lines 782-789), include it — but only as fallback. The rebuild should pick up the fresh entity type from keywords. The preservation is a safety net for clusters where all keywords were filtered (brand/informational) but the cluster record survived via status preservation.

### Change C: Cluster Strategy — Entity Map Section (`generate-cluster-strategy.ts`)

**File:** `scripts/generate-cluster-strategy.ts`

**C1: Load `primary_entity_type` from cluster** — The cluster is already loaded with `select('*')` (line 165). The new column will be available as `cluster.primary_entity_type` after migration. Use `(cluster as any).primary_entity_type ?? 'Service'` for type safety until types are regenerated.

**C2: Add entity type to prompt context block** — In the cluster context section (lines 270-274), add:

```
## Cluster: ${cluster.canonical_topic ?? args.canonicalKey}
- Entity Type: ${(cluster as any).primary_entity_type ?? 'Service'} (schema.org type for the pillar page)
- Total Volume: ${cluster.total_volume ?? 0}
- Revenue Opportunity (mid): $${(cluster.est_revenue_mid ?? 0).toFixed(0)}/mo
- Keywords: ${kwList.length}
- Existing Pages: ${pageList.length}
```

**C3: Add Section 0 (Entity Map) to the prompt** — Insert before `### 1. Buyer Journey Map` (line 300):

```
### 0. Entity Map

Define the canonical entity this cluster is built around. This entity definition governs the schema markup on the pillar page and how supporting pages reference the cluster's central subject.

Output as JSON:
\`\`\`json
{
  "entity": {
    "type": "${(cluster as any).primary_entity_type ?? 'Service'}",
    "name": "canonical name for this entity as it should appear in schema markup",
    "key_attributes": [
      "attribute name: description of what this attribute captures"
    ],
    "related_entities": [
      {
        "type": "schema.org type",
        "name": "entity name",
        "relationship": "how this entity relates to the primary entity",
        "warrants_own_page": true
      }
    ],
    "schema_notes": "Specific schema implementation notes for this entity type in this vertical"
  }
}
\`\`\`

Rules for key_attributes:
- List only attributes meaningful for this entity type that the client actually has or should have
- For Course: provider, duration, credential_issued, accrediting_body, delivery_mode, prerequisites
- For Service: provider, serviceArea, serviceType, hasOfferCatalog
- Do not list generic schema attributes that add no signal

Rules for related_entities:
- Include entities that appear naturally in supporting content for this cluster
- warrants_own_page: true = this entity should have a dedicated page in the cluster
- warrants_own_page: false = this entity appears as supporting content on existing pages
```

**C4: Update Section 3 reference** — After the Section 3 instructions (line 321), append:

```
When recommending new pages, cross-reference the entity map from Section 0:
- Pages for related_entities where warrants_own_page: true should appear as priority 1 or 2 recommendations
- Each recommended page should specify which entity it targets
- Schema type for each recommended page should be consistent with its entity type from the entity map
```

**C5: Update Section 5 reference** — After the Section 5 instructions (line 333), append:

```
Entity-based AI optimization priorities:
- Which pages are strongest candidates for establishing the primary entity as a citable entity in AI platforms?
- Which key_attributes from the entity map are absent from existing pages? Missing attributes reduce AI citation likelihood.
- Are related entities adequately covered? AI platforms frequently answer comparison and adjacent queries — gaps in related entity coverage are AI visibility gaps.
```

**C6: Replace JSON extraction with header-based approach** — The existing `extractJson` function (lines 351-370) uses **purely positional indexing** — it collects all ` ```json ``` ` blocks in document order and assumes block 0 = buyer_stages, block 1 = recommended_pages, block 2 = format_gaps. Adding Section 0 shifts all indices by 1, and any extra JSON block (inline example, narrated fragment) silently corrupts the mapping.

**Replace the entire `extractJson` function** with header-anchored extraction:

```typescript
// Header-based JSON extraction — immune to section ordering and stray JSON blocks.
// Scopes each extraction to text between its own ### header and the next.
const extractJsonBySection = (text: string, sectionHeader: RegExp): any => {
  const sectionMatch = text.match(sectionHeader);
  if (!sectionMatch || sectionMatch.index === undefined) return null;

  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  // Find the next section header (### followed by number) or end of text
  const nextSection = text.slice(sectionStart).search(/\n### \d+\./);
  const sectionText = nextSection >= 0
    ? text.slice(sectionStart, sectionStart + nextSection)
    : text.slice(sectionStart);

  // Find the FIRST fenced JSON block in this section
  const jsonMatch = sectionText.match(/```json\s*\n([\s\S]*?)```/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[1].trim());
  } catch (err) {
    console.warn(`  [cluster-strategy] Failed to parse JSON in ${sectionHeader}: ${(err as Error).message}`);
    return null;
  }
};

const entityMap = extractJsonBySection(result, /### 0\.\s*Entity Map/i);
const buyerStages = extractJsonBySection(result, /### 1\.\s*Buyer Journey Map/i);
const recommendedPages = extractJsonBySection(result, /### 3\.\s*Recommended New Pages/i);
const formatGaps = extractJsonBySection(result, /### 4\.\s*Format Gaps/i);
```

**Why this is better than positional + fallback:**
- Each extraction is scoped to the text between its `### N.` header and the next. Stray JSON blocks in other sections are invisible.
- If Opus narrates the entity map inline (as prose with attributes listed out) instead of producing a clean fenced JSON block, `entityMap` returns `null` — and buyer_stages/recommended_pages/format_gaps still parse correctly because they're anchored to their own headers.
- If Opus omits Section 0 entirely, the other three sections still extract at their correct positions.
- If Opus adds illustrative JSON examples in Section 2 (prose) or Section 5 (prose), they can't contaminate the extraction because those sections don't match any of the four header patterns.

**C7: Parse and store entity map** — The `entityMap` variable is already extracted above. In the upsert (line 381-392), add:

```typescript
entity_map: entityMap,  // NEW — null if Opus omitted Section 0
```

**C8: Update formatting rules** — The prompt's formatting rules (lines 340-344) currently say "Sections 1, 3, and 4 MUST contain valid JSON blocks." Update to:

```
Sections 0, 1, 3, and 4 MUST contain valid JSON blocks (fenced with ```json ... ```).
Sections 2, 5, and 6 are markdown prose.
Do not include any preamble before "### 0. Entity Map".
```

And update the final reminder line:

```
REMINDER: Your response IS the cluster strategy document — start with "### 0. Entity Map". No preamble, no narration.
```

**C9: Remove old `extractJson` function entirely** — The positional `extractJson` and its `sectionOrder` map are completely replaced by `extractJsonBySection`. Delete lines 351-370.

### Change D: Pam Integration (`generate-brief.ts`)

**File:** `scripts/generate-brief.ts`

**D1: Load `primary_entity_type` from `audit_clusters`** — Pam already loads cluster data indirectly through `execution_pages.canonical_key`. Add a cluster lookup near the existing data loading (around the sibling query area):

```typescript
const { data: clusterRow } = await sb
  .from('audit_clusters')
  .select('primary_entity_type')
  .eq('audit_id', auditId)
  .eq('canonical_key', pageData.canonical_key)
  .maybeSingle();

const primaryEntityType = (clusterRow as any)?.primary_entity_type ?? 'Service';
```

**D2: Load entity map from `cluster_strategy`** — Add after the cluster lookup:

```typescript
const { data: strategyRow } = await sb
  .from('cluster_strategy')
  .select('entity_map')
  .eq('audit_id', auditId)
  .eq('canonical_key', pageData.canonical_key)
  .maybeSingle();

const entityMap = (strategyRow as any)?.entity_map ?? null;
```

**D3: Inject into Page Identity block** — In the Page Identity section (lines 662-667), add after the Market line:

```typescript
- Primary Entity Type: ${primaryEntityType} (schema.org type — use for @type in JSON-LD)
```

**D4: Inject entity map when available** — After the content gap section injection (line 680), add:

```typescript
${entityMap ? `## Entity Map (from Cluster Strategy)\n${JSON.stringify(entityMap, null, 2)}\nIMPORTANT: The schema JSON-LD you produce must use the entity type and key attributes defined above. The pillar page establishes the primary entity. Supporting pages reference it via sameAs or isRelatedTo where appropriate.\n` : ''}
```

**Guard against undefined:** Both `primaryEntityType` and `entityMap` use nullish coalescing/ternary guards. Pre-migration rows return null → fallback to 'Service' / empty. Pre-cluster-strategy pages get no entity map injection. No "undefined" string risk.

---

## 3. Migration

**File:** `scripts/migrations/007-clustering-entity-type.sql`

**Sequencing note:** Plan 4 (michael-cluster-strategy-buyer-journey) uses migration 006. This migration must run after 006. If plans are implemented in a different order, adjust numbering.

```sql
-- Add entity type to audit_keywords (set by Phase 3c canonicalize)
ALTER TABLE public.audit_keywords
  ADD COLUMN IF NOT EXISTS primary_entity_type TEXT;

-- Add entity type to audit_clusters (aggregated from keywords in Phase 3d rebuild)
ALTER TABLE public.audit_clusters
  ADD COLUMN IF NOT EXISTS primary_entity_type TEXT DEFAULT 'Service';

-- Add entity map storage to cluster_strategy (from Section 0 Opus output)
ALTER TABLE public.cluster_strategy
  ADD COLUMN IF NOT EXISTS entity_map JSONB;

COMMENT ON COLUMN public.audit_keywords.primary_entity_type IS
  'Schema.org entity type assigned by Phase 3c canonicalize';
COMMENT ON COLUMN public.audit_clusters.primary_entity_type IS
  'Schema.org entity type for cluster pillar page (Service, Course, Product, LocalBusiness, FAQPage, Article)';
COMMENT ON COLUMN public.cluster_strategy.entity_map IS
  'Entity map from Cluster Strategy Section 0 — canonical entity definition, key attributes, related entities';
```

No CHECK constraints — application-level fallback (`?? 'Service'`) handles unknown values. Consistent with existing patterns (no CHECK on `status`, `intent_type`, etc.).

---

## 4. Documentation Updates

**CLAUDE.md (pipeline):** Fix the stale documentation:

```
Phase 3c Canonicalize    Semantic topic grouping (Sonnet)
```

(Currently says "Haiku" — has been Sonnet since the code was written.)

Also update the Completed > Keyword Pipeline section to reflect entity type addition.

---

## 5. Testing

### 5.1 Static
- `npx tsc --noEmit` in pipeline repo

### 5.2 Prompt Inspection
- Add temporary `console.log(prompt)` in `runCanonicalize()` to verify the enhanced prompt renders correctly
- Verify `primary_entity_type` appears in the JSON schema block
- Verify the new grouping principles and informational keyword guidance are present

### 5.3 Live Pipeline (Phase 3c + 3d)
```bash
./scripts/run-pipeline.sh idahomedicalacademy.com matt@forgegrowth.ai --start-from 3c --stop-after 3d
```

Verify:
- `audit_keywords` rows have `primary_entity_type` populated (expect "Course" for most IMA clusters)
- `audit_clusters` rows have `primary_entity_type` after rebuild
- Clusters like "EMT Certification" get `Course`, general info clusters get `Article` or `FAQPage`

### 5.4 Live Cluster Strategy
Activate a cluster on IMA to test entity map generation:
- Verify Section 0 appears in `strategy_markdown`
- Verify `entity_map` JSONB is populated in `cluster_strategy`
- Verify Sections 1, 3, 4 still parse correctly (header-based extraction)
- Verify that if entity map is missing from output (null), other sections still extract correctly

### 5.5 Pam Verification
Generate a brief for a page in an activated cluster:
- Verify "Primary Entity Type" appears in Page Identity block
- Verify entity map JSON injected when cluster_strategy exists
- Verify no injection when cluster_strategy doesn't exist (pre-activation pages)

### 5.6 Regression
- Domains with no `primary_entity_type` on keywords → `rebuildClustersAndRollups()` defaults to 'Service'
- Cluster strategies generated before this change → no `entity_map` → Pam skips injection
- `runCanonicalize()` handles missing `primary_entity_type` in Sonnet's response via `?? 'Service'`

---

## 6. Files Modified

| File | Repo | Change |
|------|------|--------|
| `scripts/pipeline-generate.ts` | pipeline | Enhance canonicalize prompt (grouping principles, informational guidance, entity type) + write entity_type to keywords |
| `scripts/sync-to-dashboard.ts` | pipeline | Add primary_entity_type to ClusterAgg, buildClusterMap, keyword SELECT, cluster INSERT, status preservation |
| `scripts/generate-cluster-strategy.ts` | pipeline | Add entity type to context, Section 0 (Entity Map), replace positional JSON extraction with header-based, store entity_map |
| `scripts/generate-brief.ts` | pipeline | Load entity_type + entity_map, inject into Pam prompt |
| `scripts/migrations/007-clustering-entity-type.sql` | pipeline | New: 3 ALTER TABLE statements |
| `CLAUDE.md` | pipeline | Fix "Haiku" → "Sonnet" for Phase 3c |

No dashboard changes. No edge function changes.

---

## 7. Risks

### 7.1 Opus Entity Map as Prose
Opus occasionally narrates structured data as prose rather than producing clean fenced JSON, especially when the JSON structure feels natural to describe verbally ("The primary entity is a Course with attributes provider, duration, credential_issued..."). **Mitigation:** The header-based `extractJsonBySection` returns `null` when no fenced JSON block is found in the section scope. `entity_map: null` is stored in `cluster_strategy` — Pam's conditional injection (`entityMap ? ... : ''`) handles this gracefully with no prompt injection. The entity type still flows from `audit_clusters.primary_entity_type` (set by Phase 3c), so Pam always has the entity type even without the full map. The entity map is additive richness, not a hard dependency.

### 7.2 Entity Type Quality
Sonnet may default most clusters to "Service" for local service businesses, reducing the value of the classification. **Mitigation:** This is acceptable — "Service" IS the correct type for most local business clusters. The value shows on domains like IMA where Course, Article, and FAQPage are genuine distinctions. The fallback cost is zero (default is already Service).

### 7.3 Prompt Length Increase (Phase 3c)
Adding ~400 chars to an already-substantial prompt. **Mitigation:** The prompt is well within Sonnet's context window. The output growth (one string field per group) is ~300 tokens — well within 4096 max_tokens.

### 7.4 Cluster Strategy Prompt Length
Adding Section 0 + entity references in Sections 3/5 adds ~600 chars to the Opus prompt. **Mitigation:** Opus has 200K context. The cluster strategy prompt is already large (keywords table, pages table, gap data, competitors, research context). This is marginal growth.

---

## 8. Definition of Done

- [ ] Phase 3c prompt enhanced with split/merge decision rules (business-context, not just density heuristic)
- [ ] Phase 3c prompt enhanced with informational keyword placement rules (no topic-agnostic info clusters)
- [ ] `primary_entity_type` field in canonicalize output schema
- [ ] `primary_entity_type` written to `audit_keywords` with `?? 'Service'` fallback
- [ ] `primary_entity_type` aggregated into `audit_clusters` by `rebuildClustersAndRollups()`
- [ ] `primary_entity_type` preserved through cluster rebuild alongside status
- [ ] Cluster Strategy: `primary_entity_type` loaded and injected into prompt context
- [ ] Cluster Strategy: Section 0 (Entity Map) added before Section 1
- [ ] Cluster Strategy: positional `extractJson` replaced with header-based `extractJsonBySection`
- [ ] Cluster Strategy: `entity_map` JSONB parsed and stored
- [ ] Cluster Strategy: Sections 3 and 5 reference entity map
- [ ] Pam: `primary_entity_type` injected into Page Identity block
- [ ] Pam: Entity map JSON injected when `cluster_strategy.entity_map` exists
- [ ] Migration `007-clustering-entity-type.sql` created
- [ ] CLAUDE.md: "Haiku" → "Sonnet" for Phase 3c
- [ ] `npx tsc --noEmit` passes
- [ ] Pre-migration data handled gracefully (null → 'Service' default, no entity map → no injection)
