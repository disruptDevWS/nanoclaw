# Plan: AI Visibility "Why" Analysis — Jim Section 11 + Gap Agent

## Summary

Jim's current Section 11 reports AI visibility *counts* (mention frequency, platforms, citation sources). This plan adds **causal reasoning** — why the gap exists, what structural factors drive citation, and specific remediation tied to pages. Also tightens the data block to expose per-keyword granularity and data quality caveats that prevent Jim from hallucinating precision the API didn't provide.

---

## 1. Current State Analysis

### Jim's AI Visibility Data Block (pipeline-generate.ts:1268–1313)

The `aiVisibilityBlock` string is built when `llmMentionsResult.domain_mentions` has data. Currently a flat bullet list:

```
## AI Visibility Data (LLM Mentions)
- Client total mentions across AI platforms: 12 (google: 8, chat_gpt: 4)
- Keywords queried: hvac repair boise, furnace installation, ...
- Top citation sources: yelp.com, bbb.org, ...
- Competitor mention counts: competitor1.com: 18, competitor2.com: 7
```

**Problems:**
- No per-keyword breakdown — Jim can't reason about which topics have gaps vs. which are cited
- Competitor counts are presented with false precision. `fetchCompetitorMentions()` (dataforseo-llm-mentions.ts:304–311) uses the `/aggregated_metrics/live` endpoint which returns a **single total per domain×platform**, then evenly distributes across keywords via `Math.round(mentionCount / keywords.length)`. This synthetic distribution is injected as if it were real per-keyword data.
- No `ai_search_volume` passed through (available on `LlmMention` but not formatted into the block)
- No indication when competitor data was budget-skipped. When `fetchCompetitorMentions` hits the budget ceiling inside its per-platform loop (line 271), it silently breaks. The resulting `competitor_mentions` array will be partially populated or empty, but Jim receives no signal about this.

### Jim's Section 11 Prompt (pipeline-generate.ts:1449–1458)

Generic instructions: "Summarize how domain appears... Include total mention count, AI search volume, top citation sources, client vs competitor comparison, recommendations." No structured subsections. No requirement for causal analysis. Generic recommendation examples ("add structured data, authoritative content, FAQ coverage").

### Gap Agent's AI Injection (pipeline-generate.ts:2567–2597)

`runGap()` reads `llm_mentions.json` from disk and builds `aiVisibilitySection`. Competitor data is presented per-keyword without the aggregation caveat. The Gap agent then produces `ai_citation_gaps` (line 2647) comparing client vs competitor mention counts — but treats the synthetic per-keyword competitor counts as granular measurements.

### Data Source: dataforseo-llm-mentions.ts

Two API endpoints with fundamentally different granularity:
- **Domain mentions** (`/search/live`): Per-keyword × per-platform. Returns `mention_count`, `ai_search_volume`, `citation_sources[]`, `mention_texts[]`. This is granular, reliable.
- **Competitor mentions** (`/aggregated_metrics/live`): Per-domain × per-platform aggregate total. Returns one `mentions` count per domain per platform. The code then distributes evenly across keywords (line 310) — this is synthetic, not measured.

### QA & Truncation

- Jim QA rubric (line 4746): checks for "Sections 2-10 present" — does not validate Section 11
- Truncation detection (line 1476): checks for `## 8.` — doesn't check for Section 11
- Jim `max_tokens`: 16384 (anthropic-client.ts:27). Adding 5 subsections to Section 11 adds ~300-500 output tokens. No risk of truncation.
- Jim already produces 10 sections + optional Section 11. The conditional gate (`aiVisibilityBlock ? ...`) correctly omits Section 11 entirely when no data exists, producing a coherent 10-section report.

---

## 2. Proposed Changes by File

### File 1: `scripts/pipeline-generate.ts`

#### Change 1A: Replace `aiVisibilityBlock` construction (lines 1268–1313)

**Delete** the current block from `// ── LLM Mentions: AI visibility data ──` through the closing `catch`.

**Replace with** new construction that:

1. Breaks platform counts into Google vs ChatGPT variables separately (currently aggregated into a generic `platformBreakdown` Map)
2. Builds a **per-keyword breakdown table** from `domain_mentions`:
   ```
   Keyword | Google Mentions | ChatGPT Mentions | AI Search Volume | Top Citation Source
   hvac repair boise | 3 | 1 | 480 | yelp.com
   ```
3. Builds a **competitor comparison section** with explicit caveat:
   ```
   ### Competitor Comparison (aggregated totals — per-keyword breakdown not available)
   Domain | Google Total | ChatGPT Total
   competitor1.com | 12 | 6
   NOTE: These are aggregate totals. Distribution across keywords is estimated, not measured.
   ```
4. Adds a **Data Quality Notes** subsection documenting the precision difference
5. Detects budget skip: if `llmMentionsResult.competitor_mentions.length === 0` but `llmMentionsResult.queried_competitors.length > 0`, emit a budget-skip note

**Data available from `LlmMention` interface** (all fields confirmed present):
- `keyword: string` ✓
- `platform: string` ("google" | "chat_gpt") ✓
- `mention_count: number` ✓
- `ai_search_volume: number` ✓
- `citation_sources: string[]` ✓
- `mention_texts: string[]` (not needed in prompt injection)

**Data available from `CompetitorMention` interface:**
- `domain: string`, `keyword: string`, `platform: string`, `mention_count: number`
- But `keyword` and `mention_count` are synthetic (evenly distributed from aggregate). We should aggregate back to domain × platform totals for honest presentation.

**Important: widen the conditional gate.** Currently, the block is only built when `llmMentionsResult.domain_mentions.length > 0` (line 1276). But `fetchDomainMentions()` always returns entries (even with `mention_count: 0`) for every keyword × platform combination (line 231-238 + fallback at 241-248). So this condition is effectively "keywords were queried", not "mentions were found". This is actually correct — Jim should see zero-mention data too (it's meaningful signal). No change needed to the gate.

#### Change 1B: Replace Section 11 prompt instructions (lines 1449–1458)

Replace the single generic `[Summarize how...]` block with 5 structured subsections:

- **11.1 Mention Summary** — counts by platform, AI search volume, zero-mentions-as-gap framing
- **11.2 Citation Source Analysis** — structural commonalities among cited domains (schema, content depth, accreditation, entity clarity). This is the key addition — Jim has Dwight's crawl data in context and can cross-reference
- **11.3 Competitor Comparison** — directional only, no per-keyword precision claims
- **11.4 Structural Gap Analysis (required)** — specific reasons AI isn't citing the domain, evidence-based against crawl data and citation patterns. Candidate list provided but Jim must reason against actual evidence. The prompt instruction must explicitly direct Jim to cross-reference: *"Cross-reference the citation sources listed in the AI Visibility Data above against the Site Inventory and All Ranked URLs in this prompt — specifically schema markup presence, content depth signals, and structured page patterns. Identify what the cited domains have structurally that ${domain} lacks."* Without this explicit pointer, Jim will produce generic gap analysis even though the right data is in context.
- **11.5 Recommendations** — must reference the gap from 11.4 and name specific pages/content types

Keep the conditional gate: only include Section 11 when `aiVisibilityBlock` is non-empty.

**Why the cross-reference pointer matters:** Jim has Dwight's site inventory (`siteInventory`) and all ranked URLs in context, plus the citation sources from LLM mentions data. The data for causal reasoning is present — but Sonnet won't reliably cross-reference two distant sections of a large prompt without explicit instruction to do so. The 11.4 instruction must name the specific data sources ("Site Inventory", "All Ranked URLs", "citation sources listed above") and name the specific signals to look for ("schema markup presence, content depth, structured page patterns"). Generic "use crawl data" will produce generic output.

#### Change 1C: Add caveat to Gap agent's AI visibility injection (lines 2567–2597)

After the existing `aiVisibilitySection` construction (line 2591), append a note block:

```
NOTE FOR GAP ANALYSIS: Competitor AI mention counts are aggregate totals, not per-topic measurements.
Identify ai_citation_gaps based on citation source patterns (which domains appear, why they appear)
rather than treating mention count differentials as precise topic-level gaps.
```

Also restructure the competitor lines to show domain-level totals instead of per-keyword synthetic counts. Currently (line 2580-2583) it shows `competitor.com — keyword (platform): N mentions` where N is the evenly-distributed synthetic count.

**Re-aggregation logic:** The `compMentions` array from `llm_mentions.json` contains synthetic per-keyword rows (one per keyword × platform × domain). To recover honest domain × platform totals, reduce the array before formatting:

```typescript
// Re-aggregate synthetic per-keyword rows back to domain × platform totals
const compAgg = new Map<string, { google: number; chatgpt: number }>();
for (const cm of compMentions) {
  const key = cm.domain;
  if (!compAgg.has(key)) compAgg.set(key, { google: 0, chatgpt: 0 });
  const entry = compAgg.get(key)!;
  if (cm.platform === 'google') entry.google += cm.mention_count;
  else if (cm.platform === 'chat_gpt') entry.chatgpt += cm.mention_count;
}
```

Then format as domain-level lines:

```
Competitor aggregate totals (not per-keyword — directional only):
competitor1.com: 18 total mentions (google: 12, chat_gpt: 6)
competitor2.com: 7 total mentions (google: 5, chat_gpt: 2)
```

This same `reduce()` pattern must be applied in **both** Change 1A (Jim's `aiVisibilityBlock`) and Change 1C (Gap's `aiVisibilitySection`). In Change 1A, the input is `llmMentionsResult.competitor_mentions`. In Change 1C, the input is the parsed `compMentions` array from `llm_mentions.json`.

### File 2: No other files modified

All changes are within `scripts/pipeline-generate.ts`. The API client (`dataforseo-llm-mentions.ts`) is not modified — the data it returns is correct; the problem is how the data is formatted for prompt injection. The sync logic (`sync-to-dashboard.ts`) is unaffected — it reads `llm_mentions.json` which is written by the API client, not by the prompt formatting code.

---

## 3. Migration/Schema Changes

**None.** This change is entirely within prompt engineering — how data is formatted before injection into Jim's and Gap's Claude calls. No database tables, columns, or edge functions are affected. The `llm_mentions.json` disk artifact format is unchanged (written by `fetchAllLlmMentions`, not by the code being modified).

---

## 4. Testing Approach

### 4.1 Static Verification

- `npx tsc --noEmit` — confirms no TypeScript errors after string template changes
- Verify the `aiVisibilityBlock` conditional gate still produces an empty string (and thus omits Section 11) when there's no LLM data
- Verify the `aiVisibilityBlock` conditional gate triggers correctly when data exists but all mention_counts are 0 (should still include Section 11 — zero mentions is meaningful)

### 4.2 Prompt Inspection (dry run)

Before running a live pipeline, add a temporary `console.log(aiVisibilityBlock)` after construction and a `console.log(aiVisibilitySection)` in the Gap agent to inspect the formatted prompt strings. Verify:

1. Per-keyword table has correct columns and data alignment
2. Competitor section shows aggregate totals (not synthetic per-keyword)
3. Data quality notes section is present
4. Budget skip note appears when competitors array is empty but queried_competitors is non-empty

### 4.3 Live Pipeline Run

Run a pipeline on a domain with existing LLM mentions data (IMA or SMA):

```bash
./scripts/run-pipeline.sh idahomedicalacademy.com matt@forgegrowth.ai --start-from 3 --stop-after 3d
```

Then inspect:
- `audits/idahomedicalacademy.com/research/{date}/research_summary.md` — verify Section 11 has all 5 subsections
- Verify Section 11.4 references specific structural observations (not generic)
- Verify Section 11.5 recommendations name specific pages or content types
- Verify Sections 1-10 are unaffected

For Gap agent verification, run Phase 5:
```bash
./scripts/run-pipeline.sh idahomedicalacademy.com matt@forgegrowth.ai --start-from 5 --stop-after 5
```

Inspect `content_gap_analysis.md` (it's JSON) — check `ai_citation_gaps` array uses directional language, not precise per-keyword claims.

### 4.4 Regression: No-Data Path

Confirm a domain with no LLM mentions data (or a run where `selectLlmKeywords` returns empty) produces a clean 10-section report with no Section 11 and no template artifacts.

---

## 5. Known Risks

### 5.1 Section 11 Output Quality

**Risk:** The 5 structured subsections (especially 11.4 Structural Gap Analysis) are ambitious for a single-shot Sonnet call that already produces 10 dense sections. Jim may produce shallow or generic content in 11.4/11.5 despite instructions.

**Mitigation:** Jim already handles 10 complex sections well at 16384 max_tokens. Section 11 adds ~300-500 tokens. The primary defense is the explicit cross-reference pointer in 11.4's prompt text — it names the exact data sources (Site Inventory, All Ranked URLs, citation sources) and the exact signals to look for (schema markup, content depth, structured page patterns). This converts "reason about why" from an open-ended inference task into a directed lookup-and-compare task that Sonnet handles reliably. If output quality is still poor after the first live run, the candidate list in 11.4 can be further tightened. The QA rubric could also be extended to validate Section 11 structure, but that's a separate follow-up.

### 5.2 Prompt Length Increase

**Risk:** The per-keyword table and data quality notes add ~200-400 chars to the prompt (5 keywords × 2 platforms = 10 rows + header + notes). Combined with the expanded Section 11 instructions, total prompt growth is ~800-1200 chars.

**Mitigation:** Jim's prompt is already large (keyword tables, competitor tables, URL lists). This is a marginal increase. No risk of hitting the 200K context window.

### 5.3 Competitor Data Suppression

**Risk:** Re-aggregating competitor mentions back to domain totals (undoing the per-keyword distribution) means Jim and Gap see less detail. This is intentional — the per-keyword data was fabricated.

**Mitigation:** The honest aggregate totals plus directional caveats give Jim enough signal to make comparative claims without false precision. This is a net improvement in output reliability.

### 5.4 Budget Skip Detection

**Risk:** The budget skip detection heuristic (`competitor_mentions.length === 0 && queried_competitors.length > 0`) doesn't distinguish between "budget exhausted" and "API returned no results". The `fetchCompetitorMentions` function always creates entries even on failure (lines 315-322: inserts `mention_count: 0` for each keyword).

**Mitigation:** Refine the detection: if `queried_competitors.length > 0` but ALL competitor `mention_count` values are 0, AND the total cost from `llmMentionsResult.total_cost` exceeds the budget threshold, emit the budget skip note. Otherwise treat as genuine zero-mention data. Alternatively, expose a `budget_exhausted: boolean` flag from `fetchCompetitorMentions` — but that changes the API client interface and is out of scope. The simpler heuristic (all-zeros + cost check) is sufficient for prompt annotation.

**Revised approach:** Since `fetchCompetitorMentions` doesn't surface budget exhaustion explicitly, and the current `competitor_mentions` array ALWAYS has entries (even zeros), we can't reliably detect budget skip from the result alone. The cleanest approach: check if `llmMentionsResult.competitor_mentions.length === 0` (which only happens when `competitorDomains.length === 0` — no competitors were passed in). For the budget-exhaustion-mid-fetch case, competitor entries with all-zero counts are indistinguishable from "no mentions found." Add a general note: "Competitor counts reflect aggregate API data. Zero values may indicate no mentions or budget constraints." This is honest without false alarm.

---

## 6. Files Modified

| File | Lines Affected | Change |
|------|---------------|--------|
| `scripts/pipeline-generate.ts` | ~1268–1313 | Replace `aiVisibilityBlock` construction with per-keyword table + competitor aggregates + data quality notes |
| `scripts/pipeline-generate.ts` | ~1449–1458 | Replace Section 11 with 5 structured subsections (11.1–11.5) |
| `scripts/pipeline-generate.ts` | ~2567–2597 | Add competitor caveat to Gap agent's `aiVisibilitySection` + restructure competitor display |

No other files modified. No migrations. No dashboard changes.

---

## 7. Definition of Done Checklist

- [ ] `aiVisibilityBlock` includes per-keyword breakdown table and data quality notes section
- [ ] Competitor caveat present in both Jim's data block and Gap's data block
- [ ] Budget/zero-data condition noted in the data block (not silently omitted)
- [ ] Section 11.4 Structural Gap Analysis is a required sub-section (not optional prose)
- [ ] Section 11.5 recommendations reference specific structural gaps and pages
- [ ] Jim still produces a coherent 10-section report when `aiVisibilityBlock` is empty
- [ ] `npx tsc --noEmit` passes in pipeline repo
