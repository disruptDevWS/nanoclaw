# Forge OS System Review

## Date: 2026-05-29

## Evaluation Standard

> "Does this system produce outputs that would beat a competent human SEO strategist who understands entity optimization, topical authority, and AI search visibility in 2026?"

This review evaluates every agent prompt, data flow decision, and dashboard surface against this bar. Where the system meets or exceeds it, I say so. Where it falls short, I specify what's missing and what "meeting the bar" would look like.

---

## Executive Summary

Forge OS is significantly more capable than its documentation suggests. The system already contains several 2026-aligned capabilities that most competing SEO platforms lack: entity maps in cluster strategies (Opus), agentic readiness scoring in Dwight, AI citation gap tracking in Pam, hybrid vector-plus-Sonnet canonicalization, and SERP-enriched content briefs with PAA/PAS data. These are not trivial — they represent genuine strategic advantages.

However, the pipeline's conceptual spine remains keyword research → keyword clustering → keyword-to-page mapping → position-based revenue modeling. This was the correct architecture in 2024. In May 2026 — with AI Mode as Google's default search experience (1B+ monthly users), agentic booking rolling out for home services this summer, and information gain elevated to a primary ranking signal — the keyword-centric framing undervalues what the system already produces and misframes the strategic advice given to clients.

The most important gap is not a missing feature — it's a framing problem. The system's best outputs (Cluster Strategy entity maps, Pam's entity-aware briefs, Oscar's Content Effort dimensions) already reason at the entity/topic level. But the upstream agents (Jim's research narrative, Strategy Brief's keyword research directive, the revenue model's position-based CTR curves) still present the analysis through a keyword lens, diluting the strategic coherence of the overall pipeline.

The dashboard is well-structured for a single operator but shows its incremental construction. The workflow follows a logical path (Research → Audit → Strategy → Clusters → Content → Performance), and the sidebar's status indicators provide good operational clarity. The primary dashboard gap is that it reports what happened without recommending what to do next — it's a rearview mirror, not a GPS.

**Priority actions:**
1. **Reframe the Strategy Brief** from keyword research directive to entity authority directive (Tier 2 — changes agent reasoning, high confidence)
2. **Remove FAQ schema recommendations** across all agents — Google fully removed FAQ rich results (Tier 1 — immediate, no risk)
3. **Add GBP services field granularity audit** to Dwight — agentic booking this summer reads the services field to decide whether to call a business (Tier 3 — new capability, critical for local services)
4. **Add content freshness scoring** to the performance tracking loop (Tier 3 — new capability, medium effort)
5. **Adjust revenue model** to account for AI Overview CTR erosion on ~48% of queries (Tier 2 — changes calculations, high impact on client communication)

---

## 1. Documentation vs Reality

### PIPELINE.md Accuracy

Generally accurate. The phase contracts, trigger paths, and Supabase writes match the code. Notable discrepancies:

| Claim in PIPELINE.md | Reality in Code | Impact |
|---|---|---|
| Pipeline has ~10 phases | Code has additional sub-phases: Phase 1a (verify-dwight), Phase 1b (strategy-brief), Phase 1c (GSC fetch), Phase 2b (KeywordResearch extract+synth) | Low — sub-phases are documented within their parent phases but numbering is inconsistent |
| Michael produces architecture blueprint with silo tables | Michael also produces geographic rules conditional on geo_mode, buyer journey coverage rows | Low — documented behavior is a subset of actual behavior |
| Canonicalize has "hybrid" and "legacy" modes | Code also supports "shadow" mode for comparison runs | Low — shadow mode is a debug tool |

### DATA_CONTRACT.md Accuracy

Accurate for all tables checked against code references. The writer/reader ownership map matches the actual `sync-to-dashboard.ts` logic and dashboard hook queries.

### .claude/agents/ Directory — Potential Confusion Source

The `.claude/agents/` directory contains `Jim.md`, `Dwight.md`, `Michael.md`, and `Pam.md` files that look like agent role definitions. These are **not the production prompts** — the actual prompts are template strings in `pipeline-generate.ts` and the individual `generate-*.ts` scripts. The `.claude/agents/` files appear to be Claude Code agentic-mode definitions for interactive use. This dual existence could cause confusion in future sessions. **Recommendation:** Add a README to `.claude/agents/` clarifying that these are interactive-mode agent definitions, not production pipeline prompts.

### DECISIONS.md

Extensive and valuable. 40+ entries covering non-obvious architectural choices. The hybrid canonicalize decisions (entries around 2026-04-20) and Michael prompt iteration history (entries around 2026-04-10) are particularly well-documented. This is above the bar for single-operator documentation discipline.

---

## 2. Data Lineage

### Field-Level Data Flow

| Phase | Agent | Key Inputs (actual fields) | Key Outputs (actual fields) | Downstream Consumers | Keyword Dependency |
|---|---|---|---|---|---|
| 1 | Dwight | DataForSEO OnPage crawl data, domain | AUDIT_REPORT.md (prioritized fixes, agentic readiness, platform notes), site inventory (existing URLs, titles, status codes) | Strategy Brief, Jim (site inventory), sync-to-dashboard (audit_snapshots.dwight) | Keyword-independent |
| 1a | Verify Dwight | AUDIT_REPORT.md, HTTP checks (sitemap, schema, robots.txt, redirects) | verification_results.json, annotated AUDIT_REPORT.md with [VERIFIED] notes | sync-to-dashboard (corrections applied to dwight snapshot) | Keyword-independent |
| 1b | Strategy Brief | AUDIT_REPORT.md, scope.json, scout markdown, client_context, GSC summary | strategy_brief.md (4 sections: Visibility Posture, Keyword Research Directive, Architecture Directive, Risk Flags) | Jim (strategic context), Michael (binding constraints), Pam (architecture directive) | Keywords as evidence, not atomic unit |
| 1c | GSC Fetch | Google Search Console API (service account), audit domain | gsc_data.json (pages by clicks, zero-click queries, date range) | Jim (first-party search data) | Keyword-independent |
| 2 | KeywordResearch | AUDIT_REPORT.md (service/location extraction), DataForSEO keyword volume | keyword_research_summary.md (validated opportunity matrix) | Jim (upstream research foundation) | Keywords as atomic unit (problematic) |
| 3 | Jim | ranked_keywords.json (top 100 by volume), competitors.json (top 20), site inventory, keyword_research_summary, gsc_data, strategy_brief, LLM mentions data, client context | research_summary.md (11 sections: overview, position distribution, branded split, intent, top URLs, competitors, striking distance, content gaps, key takeaways, AI visibility) | sync-to-dashboard (audit_snapshots.jim, audit_keywords, audit_clusters), Michael, Pam | Keywords as primary reasoning input |
| 3b | Classify Keywords | audit_keywords rows (keyword text, domain) | is_brand, intent_type, primary_entity_type, is_near_me per keyword | Canonicalize (entity_type for clustering), downstream agents | Keywords as atomic unit, but classifies entity type (bridging) |
| 3c | Canonicalize (Hybrid) | Keyword embeddings (OpenAI), vector similarity clusters, existing canonical topics | canonical_key assignment per keyword, canonical_topic labels | audit_clusters aggregation, execution_pages, Pam (cluster context), Cluster Strategy | Keywords clustered into topic entities (correctly abstracted) |
| 4 | Competitors | competitors.json | Competitor classification (direct/indirect/aggregator) | sync-to-dashboard (audit_topic_competitors) | Keyword-independent |
| 5 | Gap | audit_keywords, competitor data, architecture pages, existing site URLs | authority_gaps, format_gaps, unaddressed_keyword_gaps, ai_citation_gaps (JSON) | sync-to-dashboard (audit_snapshots.gap), Pam (content gap intelligence) | Keywords as evidence for topic gaps |
| 6 | Michael | research_summary.md, AUDIT_REPORT.md, strategy_brief.md, scope.json, geo rules | architecture_blueprint.md (silo tables, page inventory, geographic rules, buyer journey coverage, cannibalization conflicts) | sync-to-dashboard (agent_architecture_pages, agent_architecture_blueprint), Pam (blueprint excerpt) | Keywords as evidence for architecture decisions |
| 6b | Validator | architecture_blueprint, research_summary, audit_keywords | Coverage assessment (missing clusters, thin silos, orphan keywords) | QA log, operator review | Keywords as validation evidence |
| Post-6 | Cluster Strategy (Opus) | audit_clusters, audit_keywords, execution_pages, gap data, competitors, research context, client context | Entity Map (JSON), Buyer Journey Map (JSON), Recommended Pages (JSON), Format Gaps (JSON), AI Optimization Targets (JSON), Production Sequence | cluster_strategy table, execution_pages (new pages), Pam (entity_map binding, AI targets) | Entity/topic as primary reasoning unit (correctly abstracted) |
| Post-6 | Pam | 16+ data sources: execution_page brief, keywords by canonical_key, siblings, blueprint excerpt, SERP enrichment (DataForSEO Advanced), client profile, GBP canonical entity, strategy brief, Gap agent data, cluster strategy (entity_map, AI targets, search_intent), performance data (OPTIMIZE mode), Dwight technical baseline | Sentinel-delimited output: METADATA (title, desc, H1, keyword mapping), SCHEMA (JSON-LD @graph), OUTLINE (strategic content brief with coverage requirements, AI targets, internal linking) | execution_pages (metadata_markdown, content_outline_markdown, schema_json), Oscar | Keywords as evidence in a topic/entity/intent framework (correctly abstracted) |
| Post-6 | Oscar | system-prompt.md, seo-playbook.md, brand voice, client profile, Pam's metadata + outline + schema, competitive fallback | Semantic HTML (article element, JSON-LD, production notes), slop-scanned and corrected | execution_pages.content_html, disk artifact (page.html) | Keyword-independent (follows Pam's brief) |
| Tracking | track-rankings | DataForSEO keyword position checks, audit_keywords | ranking_snapshots (position per keyword per date), ranking_deltas, cluster_performance_snapshots (authority_score, coverage_score), page_performance_snapshots, baseline_snapshots | Dashboard (Performance, Clusters pages) | Keywords as measurement unit |
| Tracking | track-gsc | Google Search Console API | gsc_snapshots, gsc_page_snapshots, ga4_page_snapshots | Dashboard (Performance page, Report page) | Query-level data (keyword-adjacent) |
| Tracking | track-llm-mentions | DataForSEO LLM mentions API | llm_visibility_snapshots, llm_mention_details | Dashboard (AI Visibility page) | Query-level, platform-level |
| Tracking | AI Visibility | DataForSEO mentions + Sonnet synthesis | llm_visibility_snapshots, synthesis_markdown, disk artifacts | Dashboard (AI Visibility page) | Keywords as query proxies |

### Key Observation: Keyword Dependency Gradient

The pipeline shows a clear gradient from keyword-centric (upstream) to entity-centric (downstream):

- **Keyword-as-atomic-unit** (problematic): KeywordResearch extract, Jim's top-100 keyword table, revenue model CTR × volume × CR calculations
- **Keywords-as-evidence** (correctly abstracted): Strategy Brief, Gap analysis, Michael architecture, Validator coverage
- **Entity/topic-as-primary-unit** (target state): Cluster Strategy entity map, Pam's entity-binding contract, Oscar's content production

The downstream agents (Cluster Strategy, Pam, Oscar) are already operating at the 2026 bar. The upstream agents (Jim, KeywordResearch, revenue model) are pulling the strategic framing backward toward 2024 practices.

---

## 3. Agent-by-Agent Assessment

### Dwight — Technical SEO Auditor

**Rating: Adequate**

**Strategic alignment:** Dwight's POP (Priority of Priority) framework and Agentic Readiness scorecard are ahead of most competing tools. The agentic readiness assessment anticipates the shift toward AI agent interoperability. However, the audit does not assess:
- GBP services field granularity (critical for agentic booking — Google's AI agent reads GBP services field to decide whether to call a business)
- Content freshness scoring (information agents scan for recency)
- Information gain signals (does existing content contain proprietary data or first-hand experience?)
- Author/E-E-A-T entity signals

**Prompt quality:** Well-structured with clear output sections and the POP framework providing actionable triage. The prompt is appropriately sized. The "YOUR ENTIRE RESPONSE IS THE AUDIT REPORT" framing is effective.

**Output utility:** AUDIT_REPORT.md is consumed by Strategy Brief, Jim (site inventory), and sync-to-dashboard. The structured fixes with priority tiers sync cleanly. Verify Dwight (Phase 1a) adds HTTP-level verification that corrects false positives — this is a strong operational addition.

**Competitive gap:**
- A best-in-class 2026 technical audit would include a **GBP services field completeness assessment** — not just "listing found/not found" but "are services listed at the granularity that agentic booking requires?"
- **Content freshness inventory**: which pages have been updated in the last 90 days? Which are stale?
- **Schema completeness score**: not just "schema present/absent" but property saturation relative to the schema type
- **Author entity presence**: does the site have author pages? Do they link to external authority signals (LinkedIn, publications)?

---

### Jim — Research Intelligence

**Rating: Adequate**

**Strategic alignment:** Jim produces a comprehensive 11-section research narrative with real DataForSEO data. The AI Visibility Data section (LLM mentions per keyword) is a genuine 2026 capability. However, the prompt's core reasoning unit is still keywords: "top 100 keywords by volume" drives the analysis, and the output structure is keyword-distribution-centric (position distribution, branded vs non-branded, intent breakdown by keyword count).

A 2026-caliber research agent would reason about **topic authority domains** first (where does this business have topical depth? where are the gaps?) and use keywords as measurement evidence, not the primary analytical lens.

**Prompt quality:** The prompt is large but not bloated — it needs the keyword table, competitor table, and various context injections. The mode-specific notes (seed mode, auto-supplement, sales mode) are well-handled. The GSC data injection provides valuable first-party grounding.

**Output utility:** `research_summary.md` is consumed by sync-to-dashboard through a complex regex parser (`parseResearchSummary`). This parser is fragile — any format drift from Jim's output breaks the sync. The parser expects specific section headers ("## 2. Keyword Overview", "## 8. Striking Distance") with specific table formats. This is the **#1 fragility point** in the pipeline.

**Competitive gap:**
- Reframe the research narrative around **topical authority assessment**: "For the topic 'water heater installation,' this domain has X coverage vs competitors who have Y. The information gain opportunity is Z."
- Add **AI citation landscape analysis**: for the top 5 commercial clusters, who is currently cited in AI Overviews? What structural patterns do those citations use?
- Add **entity recognition analysis**: what entities does Google's Knowledge Graph associate with this domain? What entities should it associate?

---

### Strategy Brief — Phase 1b

**Rating: Adequate**

**Strategic alignment:** The two-tier authority system (binding constraints vs strategic framing) is a sophisticated prompt engineering pattern. However, the four output sections reveal the keyword-centric framing:
1. Visibility Posture (good — strategic, entity-adjacent)
2. **Keyword Research Directive** (problematic — frames Phase 2 around keyword volume/intent)
3. Architecture Directive (good — structural, entity-adjacent)
4. Risk Flags (good — strategic guardrails)

**Competitive gap:** Replace "Keyword Research Directive" with "Entity Authority Directive" — what entities should this domain be known for? What topics should it have comprehensive coverage on? What information gain opportunities exist vs competitors? Keywords remain measurement evidence within this reframe, not the strategic target.

---

### Michael — Architecture Blueprint

**Rating: Adequate**

**Strategic alignment:** Michael produces silo tables with page-level specifications (slug, role, primary keyword, action, content type, buyer journey stage). The geographic architecture rules (conditional on geo_mode) are well-designed. However, the architecture reasoning is still primarily URL-and-keyword mapping rather than entity relationship design.

**Prompt quality:** The prompt is well-structured with clear output expectations. The geographic architecture block (`getGeographicArchitectureBlock()`) is a good example of conditional prompt injection based on business context.

**Output utility:** architecture_blueprint.md is consumed by sync-to-dashboard (agent_architecture_pages, agent_architecture_blueprint), Pam (blueprint excerpt for silo context), and the Dashboard Strategy page. The sync parser handles the silo table format well.

**Competitive gap:**
- A best-in-class architecture agent would produce an **entity relationship map** alongside the silo structure: "The primary entity 'Emergency Plumbing' (Service) connects to location entities (Boise, Meridian, Nampa), credential entities (licensed, bonded, insured), and related service entities (drain cleaning, water heater repair). Each connection implies specific schema relationships."
- The architecture should specify **internal linking as entity graph construction**, not just information hierarchy.

---

### Gap — Content Gap Analysis

**Rating: Adequate**

**Strategic alignment:** Produces authority gaps, format gaps, and unaddressed keyword gaps. The AI citation gaps feature (added to the output) is a 2026-relevant addition. However, the gap analysis is still primarily keyword-gap-centric: "competitors rank for X keyword and this domain doesn't."

**Competitive gap:**
- Add **information gain gaps**: "Competitor A publishes proprietary repair cost data for this market. Competitor B publishes first-hand case studies with before/after photos. This domain has neither." This directly addresses Google's March 2026 core update signal.
- Add **entity coverage gaps**: "Competitor A has author entities with Knowledge Graph presence. This domain has no author attribution."

---

### Canonicalize (Hybrid) — Keyword Clustering

**Rating: Strong**

**Strategic alignment:** The hybrid approach (OpenAI embeddings for vector pre-clustering → Sonnet arbitration for ambiguous cases → Haiku for per-keyword classification) is architecturally sound and cost-efficient. The primary_entity_type classification per keyword bridges the keyword→entity gap.

**Prompt quality:** The arbitrator prompt is well-constrained: existing topics as context, unresolved cases with similarity scores, clear decision schema (assign_existing, create_new, merge_candidate). The "raw JSON only, no markdown fences" instruction prevents parsing failures.

**Cost efficiency:** Haiku batch classification at 100 keywords/call (~$0.02-0.03 per 1000 keywords) vs legacy Sonnet-only ($0.30-0.50) is a 10-15x cost reduction with comparable quality. This is the best cost-engineering in the pipeline.

**No significant competitive gap** for what this component does. The abstraction from keywords to canonical topics with entity types is the correct approach.

---

### Cluster Strategy (Opus) — Cluster Activation

**Rating: Strong**

This is the pipeline's most 2026-aligned agent. The prompt produces:

1. **Entity Map** (JSON) — canonical entity definition with schema.org types, key attributes, related entities with `warrants_own_page` flag, and schema implementation notes
2. **Search Intent Classification** — cluster-level intent with explicit rationale
3. **Buyer Journey Map** (JSON) — stage-by-stage keyword mapping with gap severity
4. **Page Coverage Analysis** — evaluation of existing pages against cluster needs
5. **Recommended New Pages** (JSON) — with buyer stage, content type, priority, and entity targeting
6. **Format Gaps** (JSON) — competitor content format analysis
7. **AI & Search Optimization Targets** (JSON) — specific queries with target_type, structural_pattern, and condition
8. **Production Sequence** — priority-ordered content plan

**Prompt quality:** Excellent. The entity map rules are specific (key_attributes per entity type, related_entities with warrants_own_page, schema_notes). The AI optimization targets require specific structural justifications, not generic recommendations. The "do not produce generic optimization recommendations" instruction is well-placed.

**Output utility:** All JSON sections are parsed and stored in `cluster_strategy` table. Entity map and AI targets flow downstream to Pam via cluster_strategy lookup, creating a coherent entity contract from strategy through content production.

**Cost consideration:** Opus at ~$0.50-1.00 per cluster is the highest per-call cost in the pipeline, but this is also the highest-value output. The entity map and AI targets directly improve every page produced for that cluster. This cost is justified.

**Minor gap:** The prompt could benefit from an **information gain assessment section**: "What proprietary knowledge does this business have about this topic that competitors lack? What first-hand experience can be leveraged?"

---

### Pam — Content Brief Generation

**Rating: Strong**

Pam is the pipeline's most sophisticated agent by context richness. The `gatherContext()` function assembles 16+ data sources:
- Audit metadata, page data from execution_pages
- Keywords by canonical_key (with volume-based fallback)
- Sibling pages in same silo (with content outline H2 extraction for deduplication)
- Architecture blueprint excerpt (silo-specific section)
- SERP enrichment (DataForSEO Advanced — PAA, PAS, top organic competitors)
- Client profile, brand voice, GBP canonical entity
- Strategy brief (Visibility Posture + Architecture Directive)
- Jim's research summary (striking distance + key takeaways)
- Gap agent data (authority gaps, format gaps, AI citation gaps)
- Cluster strategy data (entity_map, search_intent, AI optimization targets)
- Dwight technical baseline (agentic readiness, structured data issues)
- Performance context (OPTIMIZE mode — current position, striking distance keywords, GSC data)
- Buyer journey context from cluster strategy

**Prompt quality:** The output format (sentinel-delimited METADATA + SCHEMA + OUTLINE) is well-designed for programmatic parsing. The entity_map binding contract ("entity_map.entity_type is BINDING — do not substitute") prevents downstream schema type drift. The AI citation gap labeling system ([TABLE STAKES], [OPPORTUNITY], [DEPTH SIGNAL], [AI CITATION GAP], [TIME-SENSITIVE]) gives Oscar clear structural intent per content area.

**Output utility:** All three sections are parsed and stored in execution_pages (metadata_markdown, content_outline_markdown, schema_json). Oscar consumes all three. Schema type drift detection catches mismatches between entity_map entity type and produced schema @type.

**One concern:** The prompt is ~1100 lines when fully assembled with all context injections. This is large but not redundant — each section serves a specific downstream purpose. The risk is token budget pressure on the model's output quality when input context is very large.

**Competitive gap:**
- **FAQ schema is still recommended** as an "opportunity surface" in the schema section. Google fully removed FAQ rich results in 2026. This should be updated to note that FAQPage schema is deprecated for rich results but may still serve as an AI citation signal. *(Note: this is a specific, concrete fix.)*
- Add **information gain directives**: "Identify what proprietary knowledge or first-hand experience this business brings to this topic. Flag sections where commodity content must be replaced with experience-based content."

---

### Oscar — Content Production

**Rating: Adequate**

**Strategic alignment:** Oscar's system prompt establishes the right identity: "not a template-filler," "reads like human-written," "SEO embedded naturally, not bolted on." The Content Effort Requirements in the SEO playbook (Diagnostic Specificity, Process Specificity, Local/Contextual Specificity, Comparison/Tradeoff Resolution, Evidence Anchoring) are a genuine quality framework.

**Prompt quality:** The system prompt is concise and well-structured. The SEO playbook's AI/LLM Optimization section is appropriately conditional ("do not apply universally — apply when intent warrants it"). The slop scanner (11 banned phrases with Sonnet rewrite) provides a useful QA gate.

**Output utility:** Semantic HTML with JSON-LD, production notes, and metadata comment block. The `extractHtmlContent()` function handles Claude's occasional preamble/postamble. The status mapping (in_progress = "Draft Ready") is documented in DECISIONS.md.

**Competitive gap:**
- The SEO playbook still recommends **FAQ schema** (Section 2: "FAQ structure: `<section id='faq'>` with `<details>/<summary>` pairs"). Update to note that FAQ rich results are deprecated.
- Add an **information gain checkpoint**: Oscar should self-assess whether the content contains original insights, proprietary data, or first-hand experience vs. commodity information. If the content is purely informational without differentiation, flag it in production notes.
- Add **content dating signal**: For pages targeting queries where freshness affects citation rates (especially Perplexity, which shows ~30% higher citation rates for content with "2026" in headings), Oscar should include visible date signals.

---

### AI Visibility Analysis

**Rating: Adequate**

**Strategic alignment:** Tracks Google and ChatGPT mentions via DataForSEO LLM mentions API. The Sonnet synthesis produces structural gap recommendations. Query generation uses Haiku with intent-spanning buckets (discovery, consideration, comparison).

**Competitive gap:**
- **Missing Perplexity tracking**: Perplexity averages 21.87 citations per response (highest of any AI platform) and citation overlap between platforms is only 12.5%. Not tracking Perplexity means missing a significant citation surface.
- **No citation drift monitoring**: AI Overview citations have 54-59% drift rates. A single snapshot is unreliable — periodic re-checks are needed.
- **No structural pattern analysis**: The system tracks *whether* the client is cited but not *why* competitors are cited (what structural patterns trigger citations).

---

### Verify Dwight — Phase 1a Verification

**Rating: Strong (for scope)**

A focused, deterministic verification layer that corrects known DataForSEO OnPage API false negatives via direct HTTP checks (sitemap existence, schema presence, redirect chains, robots.txt). Writes structured corrections consumed by sync-to-dashboard. This is good engineering — using deterministic checks to validate LLM-generated findings.

---

### Scout — Prospect Discovery

**Rating: Adequate**

Produces prospect narratives for sales use. The prompt assembly includes DataForSEO keyword data and competitive landscape. The output is consumed by prospect_brief generation and the Scout dashboard.

**No significant competitive gap** for the sales use case. This is a lead generation tool, not a strategic audit tool.

---

### QA Agent (per-phase)

**Rating: Adequate**

Haiku-based quality checks per phase output. Cost-efficient at ~$0.01-0.02 per check. Validates structural completeness rather than strategic quality. Appropriate use of Haiku — this is classification work, not reasoning work.

---

## 4. Dashboard Assessment

### 4a: Page Inventory

| Route | Data Source | Populated for Real Client? | Operational Purpose |
|---|---|---|---|
| `/audits` (Dashboard) | audits, audit_rollups, benchmarks | Yes | See all audits, status, revenue opportunity — primary landing page |
| `/audits/:id/overview` | audits, agent_runs, audit_snapshots, agent_architecture_pages | Yes | Executive summary with scorecard metrics — good operational clarity |
| `/audits/:id/research` | audit_keywords, audit_clusters, audit_snapshots.jim, ranking_deltas | Yes (67KB page) | Keyword visibility analysis — comprehensive but keyword-centric |
| `/audits/:id/audit` | audit_snapshots.dwight, agent_technical_pages | Yes | Technical SEO findings with priority tiers — actionable |
| `/audits/:id/local-presence` | gbp_snapshots, citation_snapshots | Yes | GBP status and citation consistency — functional but thin |
| `/audits/:id/strategy` (Roadmap) | agent_architecture_pages, agent_architecture_blueprint | Yes | Content architecture roadmap — good silo visualization |
| `/audits/:id/clusters` | audit_clusters, cluster_performance_snapshots, ranking_deltas | Yes | Topic cluster strategy — activated clusters with authority trends |
| `/audits/:id/execution` (Content) | execution_pages, pam_requests, oscar_requests | Yes | Content queue — the primary operational page for content production |
| `/audits/:id/performance` | ranking_deltas, cluster_performance_snapshots, baseline_snapshots, gsc_snapshots, ga4_page_snapshots | Yes | Ranking trends + GSC/GA4 data — comprehensive tracking |
| `/audits/:id/ai-visibility` | llm_visibility_snapshots, llm_mention_details | Partially | AI platform mentions — functional but may lack Perplexity data |
| `/audits/:id/report` | Various | Yes | Client-facing summary — printable report |
| `/audits/:id/settings` | audits, audit_assumptions, client_context, client_profiles | Yes | Configuration + pipeline controls — well-organized |
| `/audits/:id/keyword-lookup` | audit_keywords | Yes (super_admin) | Ad-hoc keyword position search — utility tool |
| `/scout` | prospects, prospect_snapshots | Yes | Prospect management — functional |
| `/reports` | Report registry (in-code) | Yes (5 reports) | Reports hub — grouped by client with category badges |
| `/admin/users` | auth.users, user_roles | Yes (super_admin) | User management — functional |

### 4b: Complexity Assessment

**Custom hooks:** ~60+ hooks across the dashboard. Most are actively used by their corresponding pages. Potentially unused hooks (defined but not actively imported):
- `useStrategyBrief()` — defined but StrategyPage uses useAgentBlueprint() instead
- `useRefreshCompetitorSnapshot()` — defined but not visibly called from any page
- `useProspectStatus()` — appears redundant with useProspect()

**Duplicated functionality:** The Research page (67KB) is the largest single component. It could benefit from component decomposition but is not functionally duplicated.

**Built but unused:** The keyword-lookup page is super_admin only and appears to be a debug/support tool rather than an operator workflow page. This is fine — it's scoped appropriately.

### 4c: Operational Clarity

**"What needs my attention?"** — The Overview page provides a scorecard and "What Happens Next" section, which partially addresses this. However, there is no cross-audit attention summary on the main `/audits` dashboard. When managing multiple clients, the operator must click into each audit to see status. **Recommendation:** Add a priority attention indicator to the audit card (e.g., "3 clusters ready for activation" or "Performance tracking due").

**Workflow guidance:** The sidebar's status indicators (✓ complete, ⟳ loading, ∘ pending) provide good phase-level orientation. The left-to-right progression (Research → Audit → Strategy → Clusters → Content → Performance) matches the pipeline's actual workflow.

**Data without context:** The Research page displays extensive keyword data tables without interpretation. A competent human strategist would say "your top opportunity is cluster X because Y" — the dashboard shows the data but doesn't surface the insight. The Cluster Strategy (when activated) provides this interpretation, but it requires manual activation per cluster.

**Key gap: No "next action" surface.** The dashboard reports what happened but doesn't recommend what to do next. After a full pipeline run, the operator must:
1. Review technical findings in Audit page → decide what to fix
2. Review architecture in Strategy page → decide what to accept
3. Activate clusters in Clusters page → decide which clusters to prioritize
4. Generate briefs in Content page → trigger Pam for each page

Each step requires the operator to know the workflow. A "Recommended Next Actions" panel on the Overview page would reduce cognitive load.

---

## 5. Redundancy and Dead Weight

### 5a: Redundancy

| Item | Locations | Impact |
|---|---|---|
| `loadEnv()` function | Duplicated in 8+ scripts (pipeline-generate, generate-brief, generate-content, generate-cluster-strategy, sync-to-dashboard, track-rankings, track-gsc, track-llm-mentions, ai-visibility-analysis) | Low — same 20-line function copied everywhere. Could be a shared utility but duplication is harmless |
| `parseArgs()` CLI parsing | Duplicated in every standalone script | Low — same pattern, different flag sets. Not worth abstracting |
| `todayStr()` / `getLatestDateDir()` / `resolveArtifactPath()` | Duplicated in 5+ scripts | Low — utility functions. Could be shared but duplication is harmless |
| Competitor context | Built by both Gap agent (stored in audit_snapshots.gap) and loaded fresh by Pam (from audit_topic_competitors/audit_topic_dominance) | Low — Pam's fallback path only fires when the outline doesn't already contain competitive context |
| .claude/agents/ definitions vs pipeline-generate.ts prompts | .claude/agents/ has agent role definitions; pipeline-generate.ts has actual production prompts | Medium — conceptual redundancy. The .claude/agents/ files could drift from production prompts without anyone noticing |

### 5b: Dead Weight

| Item | Evidence | Recommendation |
|---|---|---|
| Legacy canonicalize mode | Code path exists in pipeline-generate.ts and run-canonicalize.ts, but hybrid is default for all new audits | Keep for now — legacy mode may still be needed for re-processing older audits |
| `intent` column on audit_keywords | Documented as deprecated in FOLLOWUPS.md, but still referenced by generate-brief.ts keyword table (`k.intent`) and sync-to-dashboard | Medium priority cleanup — the column exists but `intent_type` (from classify-keywords) is the canonical field |
| Shadow canonicalize mode | Debug tool in run-canonicalize.ts for comparing legacy vs hybrid output | Keep — useful for validation but should be documented as debug-only |
| `useAgentImplementationPages()` hook | Defined in dashboard hooks but not referenced by any visible page | Low priority — may be an unused hook. Verify before removing |
| FAQ schema recommendations | In Oscar's seo-playbook.md and Pam's prompt | **Remove** — FAQ rich results fully removed by Google. Update to note FAQPage schema is deprecated for rich results |

---

## 6. Fragility Map

### Top 5 Load-Bearing Seams

**1. sync-to-dashboard.ts `parseResearchSummary()` — regex parsing of Jim's markdown output**

`sync-to-dashboard.ts:387-575` parses Jim's `research_summary.md` using ~20 regex patterns to extract keyword overview, position distribution, branded split, intent breakdown, competitor analysis, striking distance, and key takeaways. If Jim's output format drifts (different heading numbering, different table column order, different number formatting), the parser silently produces zero values. This is the single most fragile point in the pipeline.

**Mitigation:** Either (a) constrain Jim's output with a stricter template, or (b) have Jim output structured JSON alongside the markdown narrative, and parse the JSON. Option (b) is strongly recommended — it decouples the human-readable narrative from the machine-parsed data.

**2. Pam's sentinel-delimited output parsing — `---METADATA_START---` / `---SCHEMA_START---` / `---OUTLINE_START---`**

`generate-brief.ts:1181-1197` requires exact sentinel strings. If Claude omits a sentinel or produces it with slight formatting variation, the entire brief is lost with a hard error. The error message includes the first 200 chars of output for debugging, which is good, but there's no retry logic.

**Mitigation:** Add a retry with explicit feedback to Claude about the missing sentinel. This is a known LLM output format reliability issue.

**3. pipeline-generate.ts — 307KB single file containing most agent prompts**

This file contains ~6200 lines with prompts for Dwight, Jim, Michael, Gap, Validator, KeywordResearch, Scout, QA, and Competitors, plus the entire pipeline orchestration logic. Any edit to one agent's prompt risks accidentally affecting another. The file is too large for most editors to handle comfortably.

**Mitigation:** Extract agent prompts into separate files (similar to how Oscar's prompt is already in `configs/oscar/system-prompt.md`). This is a Tier 1 simplification with no behavioral change.

**4. callClaude `PHASE_MAX_TOKENS` truncation**

`anthropic-client.ts` maps phase names to max_tokens limits. If an agent's output exceeds its limit, the content is silently truncated. `warnOnTruncation` exists for Validator but is not enabled for other phases. Truncated Jim output → broken parseResearchSummary → zero values in dashboard → misleading metrics.

**Mitigation:** Enable truncation detection for all phases. Log a warning when output appears truncated. For critical phases (jim, michael, dwight), consider retry with higher token limit.

**5. Cross-date artifact resolution — `resolveArtifactPath()` date fallback**

When today's date directory doesn't contain an expected artifact, the function falls back to the latest date directory. This is correct for normal operation but can pick up stale data from a previous pipeline run if the current run failed partway. The operator may not notice they're seeing last month's research summary with this month's architecture blueprint.

**Mitigation:** Log a warning when using a date fallback. Consider adding a staleness threshold (e.g., warn if artifact is >7 days old).

---

## 7. Cost Analysis

### Per-Phase Cost Breakdown (estimated, per full pipeline run)

| Phase | Agent | Model | Est. Input Tokens | Est. Output Tokens | Est. Cost | Value Assessment |
|---|---|---|---|---|---|---|
| 1 | Dwight | Sonnet | ~8K | ~12K | $0.08-0.15 | High — foundational technical assessment |
| 1a | Verify Dwight | None (HTTP) | — | — | $0.00 | High — false positive correction |
| 1b | Strategy Brief | Sonnet | ~6K | ~4K | $0.04-0.08 | High — strategic framing |
| 2 | KeywordResearch | Haiku + Sonnet | ~4K + ~8K | ~2K + ~6K | $0.06-0.12 | Medium — could be partially deterministic |
| 3 | Jim | Sonnet | ~12K | ~14K | $0.10-0.20 | High — comprehensive research synthesis |
| 3b | Classify | Haiku (batched) | ~50K total | ~10K total | $0.02-0.05 | High — excellent cost/value ratio |
| 3c | Canonicalize (arbitrate) | Sonnet | ~6K | ~4K | $0.04-0.08 | High — handles only hard cases |
| 4 | Competitors | Haiku | ~3K | ~2K | $0.01-0.02 | Medium — simple classification |
| 5 | Gap | Sonnet | ~10K | ~8K | $0.06-0.12 | High — identifies actionable gaps |
| 6 | Michael | Sonnet | ~10K | ~12K | $0.08-0.15 | High — architecture blueprint |
| 6b | Validator | Sonnet | ~8K | ~4K | $0.04-0.08 | Medium — coverage check |
| QA (×8 phases) | QA | Haiku | ~2K each | ~1K each | $0.02-0.04 total | Low-Medium — structural validation only |
| **Total pipeline run** | | | | | **~$0.55-1.10** | |

### Per-Page Content Costs

| Phase | Agent | Model | Est. Cost | Value Assessment |
|---|---|---|---|---|
| Pam (brief) | Pam | Sonnet | $0.10-0.20/page | High — extremely rich context assembly |
| Oscar (content) | Oscar | Sonnet (65K tokens) | $0.25-0.50/page | High — production-ready HTML |
| Oscar (slop rewrite) | Oscar QA | Sonnet | $0.03-0.05/page (if triggered) | Medium — ~30% trigger rate |
| **Total per page** | | | **$0.35-0.75/page** | |

### Per-Cluster Activation

| Phase | Agent | Model | Est. Cost | Value Assessment |
|---|---|---|---|---|
| Cluster Strategy | Opus | Opus | $0.50-1.00/cluster | **Highest cost, highest value** — entity map + AI targets govern all downstream content |

### Cost Efficiency Recommendations

1. **Competitor classification (Phase 4)**: Already uses Haiku. Correct model choice.
2. **QA passes**: Already use Haiku. Correct model choice.
3. **Service key detection**: Uses Haiku. Correct model choice.
4. **No Sonnet calls that should be Haiku**: The model assignments are generally appropriate. Jim, Michael, Gap, and Pam need Sonnet's reasoning depth. Classify-keywords correctly uses Haiku for batch classification.
5. **Potential deterministic replacement**: The `parseResearchSummary()` function in sync-to-dashboard.ts already does deterministic parsing of Jim's markdown output. If Jim output a structured JSON alongside the narrative, the sync step would need no LLM call and would be more reliable.
6. **Total cost per full pipeline run + 20 pages + 5 cluster activations**: ~$1.00 + $10.00 + $3.75 = **~$15 total**. At $4,500/month per client, this is well under 1% of revenue — cost is not a concern.

---

## 8. Recommendations

### Tier 1: Remove / Simplify (reduce complexity without changing capability)

**T1-1. Remove FAQ rich result recommendations from all agents**
- What: Update `configs/oscar/seo-playbook.md` Section 2 (FAQ structure) and Pam's prompt (SCHEMA section) to note that FAQPage schema no longer produces Google rich results. Retain FAQ as a content structure pattern for user experience and potential AI citation signal, but remove the SERP feature framing.
- Why: Google fully removed FAQ rich results in 2026. Recommending FAQ schema as a SERP opportunity is actively misleading to the client.
- Effort: Small (2 file edits)
- Risk: None

**T1-2. Extract agent prompts from pipeline-generate.ts into separate files**
- What: Move the prompt template strings for Dwight, Jim, Michael, Gap, Validator, Scout, KeywordResearch, and Competitors into individual files under `configs/agents/` or `prompts/`, similar to how Oscar's prompt is already in `configs/oscar/system-prompt.md`. The pipeline-generate.ts orchestrator would `fs.readFileSync()` these files and inject context variables.
- Why: pipeline-generate.ts at 307KB / 6200 lines is the #3 fragility risk. Separating prompts from orchestration logic reduces edit risk and makes prompt iteration easier.
- Effort: Medium (extract 8 prompt templates, update pipeline-generate.ts to load from files)
- Risk: Low (behavioral change is zero — same prompts, same injection points)

**T1-3. Add README to .claude/agents/ directory**
- What: Add a note clarifying these are Claude Code interactive agent definitions, not production pipeline prompts.
- Why: Prevents future confusion between interactive and production prompt surfaces.
- Effort: Trivial
- Risk: None

**T1-4. Deprecate `intent` column references**
- What: Replace remaining references to `audit_keywords.intent` with `intent_type` (the canonical field from classify-keywords). Update generate-brief.ts keyword table column and any dashboard hooks still reading `intent`.
- Why: FOLLOWUPS.md already documents this as a deferred cleanup. The dual columns create confusion about which is authoritative.
- Effort: Small (grep for `.intent` across both repos, update references)
- Risk: Low

---

### Tier 2: Evolve (change what agents reason about)

**T2-1. Reframe Strategy Brief: Keyword Research Directive → Entity Authority Directive**
- Current: Section 2 produces "Keyword Research Directive" telling Jim which keyword categories to prioritize
- Target: Section 2 produces "Entity Authority Directive" telling downstream agents what topical domains the business should own, what entities it should be known for, and what information gain opportunities exist vs competitors
- What changes: Strategy brief prompt in `strategy-brief.ts` — rewrite Section 2 output specification. Jim's prompt in pipeline-generate.ts would receive entity authority context instead of keyword directives.
- Effort: Medium (1 prompt rewrite + downstream context injection update)
- Risk: Medium — changes the strategic framing of all downstream agents. Test with existing client data before deploying.
- Confidence: High — this aligns the pipeline with how Google evaluates content authority in 2026

**T2-2. Adjust revenue model for AI Overview CTR erosion**
- Current: TAR and delta-revenue calculations use position-based CTR curves that assume traditional organic click-through rates
- Target: Apply an AI Overview erosion factor to queries where AI Overviews trigger. For ~48% of tracked queries, organic CTR drops by ~61%. The revenue model should discount these queries accordingly.
- What changes: `sync-to-dashboard.ts` revenue calculations (calculateKeywordOpportunity, calculateClusterTAR). Add a flag or multiplier for keywords in clusters where AI Overviews are likely (based on industry vertical, query type).
- Effort: Medium (formula changes + potentially a new data source for AI Overview trigger rates per keyword)
- Risk: Medium — revenue projections will decrease, which affects client communication. But the current projections may be significantly overstated.
- Confidence: High — the data is clear that position-based CTR overestimates actual click-through in 2026

**T2-3. Add structured JSON output to Jim alongside markdown narrative**
- Current: Jim produces `research_summary.md` in markdown, which sync-to-dashboard parses with fragile regex
- Target: Jim produces both `research_summary.md` (human-readable) and `research_data.json` (machine-parseable) with the same data in structured format
- What changes: Jim's prompt in pipeline-generate.ts — add a structured data output requirement. sync-to-dashboard.ts — switch from regex parsing to JSON parsing, with markdown regex as fallback.
- Effort: Medium (prompt update + parser update)
- Risk: Low — adds a new output without removing the existing one. JSON parsing is more reliable than regex.
- Confidence: High — this directly addresses the #1 fragility point

**T2-4. Add content freshness signals to Oscar's output**
- Current: Oscar produces content with no visible date signals
- Target: Oscar includes a `datePublished` / `dateModified` in the JSON-LD schema and a visible "Last updated: [date]" in the HTML. For time-sensitive content (regulatory, pricing, scheduling), include a `[PLACEHOLDER: last verified date]` note.
- What changes: Oscar's seo-playbook.md — add a content dating section. Pam's prompt already has [TIME-SENSITIVE] classification; Oscar should act on it.
- Effort: Small (2 file edits)
- Risk: None
- Confidence: High — Perplexity shows ~30% higher citation rates for content with visible dates

---

### Tier 3: Add (new capabilities the system lacks)

**T3-1. Add GBP services field granularity audit to Dwight**
- What's missing: Dwight checks whether a GBP listing exists and whether it's claimed, but does not audit the granularity of the services field. With agentic booking rolling out for home services this summer, Google's AI agent reads the GBP services field to decide whether to call a business. "Plumbing services" is invisible to an agent looking for "tankless water heater installation."
- Why it matters: This is the single highest-impact new capability for local service business clients. A business with a complete, granular GBP services field will receive agentic booking calls. One without it will be invisible.
- How it integrates: Extend Dwight's output or add a Phase 1 sub-step that fetches the GBP services list via DataForSEO or Google Business Profile API and evaluates granularity against the audit's service_key and known service categories.
- Effort: Medium (new data source integration + Dwight prompt extension)
- Confidence: High — Google explicitly confirmed this at I/O 2026

**T3-2. Add information gain assessment to the pipeline**
- What's missing: No agent evaluates whether existing or planned content contains proprietary data, original research, first-hand experience, or unique frameworks. Google's March 2026 core update elevated information gain to a primary ranking signal. Sites with original data gained +22% visibility; AI-paraphrased content lost 71% of traffic.
- Why it matters: This is the difference between content that gets cited by AI platforms and content that gets generated by them. If the pipeline produces commodity content, it will lose to AI-generated content on the same topic.
- How it integrates: Add an information gain assessment to Pam's Required Content Coverage section. Pam should evaluate the client profile and business context to identify what unique knowledge the business has for each topic. Flag content briefs where no information gain angle is identified.
- Effort: Medium (Pam prompt enhancement + client_profiles schema extension to capture proprietary knowledge areas)
- Confidence: Medium — the concept is clear, but operationalizing "does this business have unique knowledge about X" requires good client intake data

**T3-3. Add multi-platform AI citation tracking**
- What's missing: The system tracks Google and ChatGPT mentions via DataForSEO but not Perplexity (which averages 21.87 citations per response, highest of any platform). Citation overlap between platforms is only 12.5%, meaning a site can be invisible on ChatGPT while cited on Perplexity.
- Why it matters: Multi-platform visibility is now essential. AI referral traffic converts at 9-11x the rate of traditional organic.
- How it integrates: Extend `track-llm-mentions.ts` and `ai-visibility-analysis.ts` to include Perplexity if DataForSEO supports it, or add a supplementary API source. Update the AI Visibility dashboard page to show per-platform breakdown.
- Effort: Medium (API integration + dashboard update)
- Confidence: Medium — depends on DataForSEO API coverage for Perplexity

**T3-4. Add "Next Actions" panel to Overview page**
- What's missing: The dashboard reports what happened but doesn't recommend what to do next. After a pipeline run, the operator must know the workflow to decide what to do.
- Why it matters: Operational efficiency for a single operator. Reducing cognitive load directly translates to capacity for more clients.
- How it integrates: Add a "Recommended Next Actions" component to the Overview page that reads agent_runs, audit_clusters, and execution_pages status to generate ordered recommendations: "1. Review 3 Priority-1 technical fixes in Audit → 2. Activate 'HVAC Repair' cluster (highest revenue potential) → 3. Generate briefs for 5 new pages in Content queue"
- Effort: Medium (new dashboard component + recommendation logic)
- Confidence: High — this is straightforward deterministic logic based on existing data

**T3-5. Add entity relationship visualization to Strategy/Clusters page**
- What's missing: The Cluster Strategy agent produces entity maps with related entities and relationships, but the dashboard doesn't visualize them. The operator sees silo tables and keyword lists but not the entity graph that governs schema and content strategy.
- Why it matters: Entity relationships are the new information architecture. Visualizing them helps the operator understand and explain the strategy to clients.
- How it integrates: Parse `cluster_strategy.entity_map` JSON and render a simple entity relationship diagram on the Clusters page (when a cluster is activated and has a strategy).
- Effort: Medium (new visualization component)
- Confidence: Medium — high value but depends on design execution

---

## 9. Recommended Implementation Sequence

### Phase A: Quick Wins (1-2 sessions, no behavioral change)

1. **T1-1**: Remove FAQ rich result framing from Oscar playbook and Pam prompt
2. **T1-3**: Add README to .claude/agents/
3. **T2-4**: Add content freshness/dating signals to Oscar output
4. **T1-4**: Deprecate `intent` column references (cross-repo)

### Phase B: Structural Improvements (2-3 sessions)

5. **T2-3**: Add structured JSON output to Jim (addresses #1 fragility)
6. **T1-2**: Extract agent prompts from pipeline-generate.ts (addresses #3 fragility)
7. **T2-1**: Reframe Strategy Brief keyword directive → entity authority directive

### Phase C: New Capabilities (3-5 sessions)

8. **T3-1**: GBP services field granularity audit in Dwight
9. **T3-4**: "Next Actions" panel on Overview page
10. **T2-2**: AI Overview CTR erosion adjustment to revenue model
11. **T3-2**: Information gain assessment in Pam

### Phase D: Enhancement (future sessions)

12. **T3-3**: Multi-platform AI citation tracking (Perplexity)
13. **T3-5**: Entity relationship visualization in dashboard

### Dependencies

- T2-3 (Jim JSON output) should precede T1-2 (prompt extraction) to avoid doing the Jim prompt work twice
- T2-1 (Strategy Brief reframe) should precede T3-2 (information gain assessment) since the Strategy Brief sets the directive framework
- T3-1 (GBP granularity) can proceed independently at any time
- T3-4 (Next Actions panel) can proceed independently at any time

---

## Appendix A: File Inventory

### Pipeline Scripts (LLM-calling)

| File | Purpose | Lines | Model(s) |
|---|---|---|---|
| `scripts/pipeline-generate.ts` | Main orchestrator — contains Dwight, Jim, Michael, Gap, Validator, KeywordResearch, Scout, Competitors, QA prompts | ~6200 | Sonnet, Haiku |
| `scripts/generate-brief.ts` | Pam content brief generation | ~1200 | Sonnet |
| `scripts/generate-content.ts` | Oscar content production + slop scanner | ~500 | Sonnet |
| `scripts/generate-cluster-strategy.ts` | Opus cluster activation strategy | ~600 | Opus |
| `scripts/strategy-brief.ts` | Phase 1b strategic framing | ~520 | Sonnet |
| `scripts/ai-visibility-analysis.ts` | AI visibility assessment | ~400 | Haiku, Sonnet |
| `scripts/generate-client-brief.ts` | Client intelligence brief | ~500 | Sonnet |
| `scripts/generate-prospect-brief.ts` | Prospect intelligence brief | ~400 | Sonnet |
| `scripts/anthropic-client.ts` | Anthropic SDK wrapper (callClaude, callClaudeAsync) | ~200 | — |
| `scripts/slop-scanner.ts` | Post-Oscar QA gate (banned phrase detection) | ~150 | — |

### Pipeline Scripts (Data processing)

| File | Purpose |
|---|---|
| `scripts/sync-to-dashboard.ts` | Parses agent outputs, writes to Supabase |
| `scripts/run-canonicalize.ts` | Canonicalize orchestrator (hybrid/legacy/shadow) |
| `scripts/track-rankings.ts` | Monthly ranking + authority tracking |
| `scripts/track-gsc.ts` | GSC data fetch |
| `scripts/track-llm-mentions.ts` | LLM visibility tracking |
| `scripts/verify-dwight.ts` | Phase 1a HTTP verification |
| `scripts/client-context.ts` | Shared client context utilities |

### Pipeline Infrastructure

| File | Purpose |
|---|---|
| `src/pipeline-server-standalone.ts` | HTTP server (Railway deployment) |
| `src/agents/canonicalize/classify-keywords.ts` | Haiku keyword classification |
| `src/agents/canonicalize/hybrid/arbitrator.ts` | Sonnet arbitration for hard clustering cases |
| `configs/oscar/system-prompt.md` | Oscar identity and execution rules |
| `configs/oscar/seo-playbook.md` | Oscar SEO optimization rulebook |

### Agent Definitions (Claude Code interactive mode — NOT production prompts)

| File | Purpose |
|---|---|
| `.claude/agents/Jim.md` | Jim role definition for Claude Code |
| `.claude/agents/Dwight.md` | Dwight role definition for Claude Code |
| `.claude/agents/Michael.md` | Michael role definition for Claude Code |
| `.claude/agents/Pam.md` | Pam role definition for Claude Code |

### Dashboard (key pages)

| File | Purpose |
|---|---|
| `src/App.tsx` | Route configuration |
| `src/components/layout/Header.tsx` | Top navigation |
| `src/components/layout/AuditSidebar.tsx` | Audit detail sidebar |
| `src/pages/AuditsDashboard.tsx` | Main audit list |
| `src/pages/audit-detail/OverviewPage.tsx` | Audit overview |
| `src/pages/audit-detail/ResearchPage.tsx` | Research analysis (67KB) |
| `src/pages/audit-detail/ExecutionPage.tsx` | Content queue |
| `src/pages/audit-detail/PerformancePage.tsx` | Ranking performance |
| `src/pages/audit-detail/AiVisibilityPage.tsx` | AI visibility |
| `src/constants/report-registry.ts` | Report slug → component mapping |

---

## Appendix B: Supabase Table Usage Map

| Table | Writers | Dashboard Readers | Data Populated? |
|---|---|---|---|
| `audits` | Pipeline (status updates), Dashboard (create, settings) | All pages | Yes |
| `audit_rollups` | sync-to-dashboard (jim sync) | Dashboard, Overview | Yes |
| `audit_keywords` | sync-to-dashboard (jim sync), track-rankings | Research, Performance, Clusters, Keyword Lookup | Yes |
| `audit_clusters` | sync-to-dashboard (canonicalize), generate-cluster-strategy | Clusters, Research, Strategy | Yes |
| `audit_snapshots` | sync-to-dashboard (per-agent) | Research (jim), Audit (dwight), Strategy (michael), multiple | Yes |
| `audit_assumptions` | sync-to-dashboard (auto-create from benchmarks), Dashboard (settings) | Overview, Research, Settings | Yes |
| `agent_runs` | pipeline-generate (per phase) | Overview (agent completion status) | Yes |
| `agent_technical_pages` | sync-to-dashboard (dwight sync) | Audit page | Yes |
| `agent_architecture_pages` | sync-to-dashboard (michael sync) | Strategy, Overview | Yes |
| `agent_architecture_blueprint` | sync-to-dashboard (michael sync) | Strategy, Overview | Yes |
| `execution_pages` | sync-to-dashboard (michael→execution), generate-cluster-strategy, Pam, Oscar, Dashboard | Execution, Overview | Yes |
| `pam_requests` | Dashboard (create request), generate-brief (status updates) | Execution | Yes |
| `oscar_requests` | Dashboard (create request), generate-content (status updates) | Execution | Yes |
| `ranking_snapshots` | track-rankings | Performance (via ranking_deltas view) | Yes |
| `ranking_deltas` | track-rankings (computed) | Performance, Clusters | Yes |
| `cluster_performance_snapshots` | track-rankings | Performance, Clusters | Yes |
| `baseline_snapshots` | track-rankings | Performance | Yes |
| `page_performance_snapshots` | track-rankings | Performance | Yes |
| `gsc_snapshots` | track-gsc | Performance | Yes |
| `gsc_page_snapshots` | track-gsc | Performance | Yes |
| `ga4_page_snapshots` | track-rankings (step 10) | Performance | Yes |
| `ga4_event_snapshots` | track-rankings (step 9b) | Report (Conversions) | Yes |
| `gbp_snapshots` | sync-to-dashboard (Phase 6d) | Local Presence | Yes |
| `citation_snapshots` | sync-to-dashboard (Phase 6d) | Local Presence | Yes |
| `llm_visibility_snapshots` | ai-visibility-analysis, track-llm-mentions | AI Visibility | Partially |
| `llm_mention_details` | ai-visibility-analysis | AI Visibility | Partially |
| `cluster_strategy` | generate-cluster-strategy | Clusters (strategy view), Pam (entity_map, AI targets) | Yes (per activated cluster) |
| `client_profiles` | Dashboard (settings), sync scripts | Settings, Pam, Oscar | Yes |
| `client_context` | Dashboard (settings) | Settings | Yes |
| `benchmarks` | Seeded data | Dashboard, Overview, sync-to-dashboard | Yes |
| `ctr_models` | Seeded data | sync-to-dashboard (assumptions) | Yes |
| `prospects` | Dashboard (Scout) | Scout pages | Yes |
| `prospect_snapshots` | pipeline-generate (prospect mode) | Scout Report | Yes |
| `user_roles` | Admin | Admin Users, Header | Yes |
| `user_audit_access` | Admin | RLS policies | Yes |
| `audit_topic_competitors` | sync-to-dashboard | Research, Oscar (fallback) | Yes |
| `audit_topic_dominance` | sync-to-dashboard | Research, Oscar (fallback) | Yes |
| `directory_domains` | Seeded/admin | generate-brief (aggregator filter) | Yes |

**Tables written but with limited dashboard visibility:**
- `llm_mention_snapshots` — written by track-llm-mentions, but AI Visibility page reads `llm_visibility_snapshots` and `llm_mention_details` instead. Verify whether this table is actually queried.
- `page_performance` — referenced in generate-brief.ts OPTIMIZE mode but may not have a dedicated dashboard view beyond the Performance page aggregate charts.
