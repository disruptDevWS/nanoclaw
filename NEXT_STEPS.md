# Next Steps — Pick Up Here

**Last session:** 2026-02-24

---

## What We Did Today

### Connected NanoClaw Agents to Market Position Dashboard

Built a sync bridge that pushes agent output files into Supabase so the dashboard can display technical health, architecture plans, and implementation roadmaps alongside its existing revenue model.

**Integration model:** A Node.js script (`scripts/sync-to-dashboard.ts`) on the NanoClaw host reads agent output files, transforms them into Supabase records, and upserts via the service role key.

#### Sync Bridge Results (veteransplumbingcorp.com)

| Agent | Records Synced | Notes |
|-------|---------------|-------|
| **Jim** | 30 keywords, 5 clusters, rollup | Revenue range: $4,039 – $161,550/mo. Ports CTR formula from `run-audit` edge function |
| **Dwight** | 14 technical pages | Semantic CSV columns were empty in export — no flags. BOM handling fixed |
| **Michael** | 61 architecture pages, 47KB blueprint | Executive summary extracted, silo map parsed from markdown tables |
| **Pam** | 1 implementation page (`/plumber-boise`) | Meta title, H1, schema JSON-LD, content outline synced |

#### Files Created/Modified

**NanoClaw:**
- `scripts/sync-to-dashboard.ts` — Sync bridge (Jim/Dwight/Michael/Pam parsers + revenue formula)
- `scripts/migration-agent-pipeline.sql` — DDL for new Supabase tables
- `scripts/run-migration.ts` — Migration verification helper
- `package.json` — Added `@supabase/supabase-js`, `csv-parse`, `pg`; added `npm run sync`
- `.env` — Added `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

**Market Position Dashboard:**
- `database/schema.sql` — 5 new tables, RLS policies, indexes, audits ALTER
- `src/types/database.ts` — 5 new type interfaces, extended Audit type
- `src/hooks/useAgentData.ts` — React Query hooks for all agent tables
- `src/components/audit/TechnicalHealthCard.tsx` — Crawl data + semantic flags
- `src/components/audit/ArchitecturePlanCard.tsx` — Silo map + blueprint markdown
- `src/components/audit/ImplementationRoadmapCard.tsx` — Per-page assets + copy-to-clipboard
- `src/pages/AuditsDashboard.tsx` — Pipeline progress badge (1/4 through 4/4)
- `src/pages/AuditResults.tsx` — Wired in 3 new agent cards

#### Supabase Migration Applied

5 new tables with RLS + indexes:
- `agent_runs` — Tracks what has been synced
- `agent_technical_pages` — Dwight's crawl data per URL
- `agent_architecture_pages` — Michael's per-page plan
- `agent_architecture_blueprint` — Full markdown report
- `agent_implementation_pages` — Pam's per-page output

`audits` table extended with `agent_pipeline_status` and `agent_pipeline_domain`.

---

## Next Task: Dashboard Cleanup, Security Review & UI Enhancements

### 1. Security & Access Review

- [ ] Audit all Supabase RLS policies — verify agent tables are properly scoped to `audits.user_id`
- [ ] Review service role key usage — ensure it is never exposed to frontend code or committed to git
- [ ] Verify edge functions (`run-audit`, `generate-report`, `recalculate-audit`, `run-competitor-dominance`) authenticate properly (JWT or `x-internal-key`)
- [ ] Check that `.env` is in `.gitignore` across both repos
- [ ] Review CORS headers on edge functions — restrict `Access-Control-Allow-Origin` from `*` to production domain
- [ ] Confirm Supabase publishable key in `client.ts` is safe for frontend use (it is, but document why)
- [ ] Audit the sync bridge — it uses service role key to bypass RLS (correct for server-side sync, but must never run in browser)

### 2. User Access & Auth

- [ ] Review auth flow — ensure only authenticated users can view audits
- [ ] Test that RLS prevents cross-user data access on all new agent tables
- [ ] Consider adding `DELETE` policies to agent tables (currently only `SELECT` + `INSERT`)
- [ ] Verify cascading deletes work — deleting an audit should cascade to all agent_* rows

### 3. Export PDF Functionality

- [ ] Implement the "Export PDF" button (currently disabled in `AuditResults.tsx`)
- [ ] Decide approach: client-side (html2canvas/jspdf) vs server-side (edge function with Puppeteer/Playwright)
- [ ] Include all sections: revenue metrics, opportunity breakdown, report narrative, competitive snapshot, agent cards (technical health, architecture, implementation)
- [ ] Style for print — ensure tables, markdown, and cards render cleanly in PDF

### 4. UI Cleanup & Enhancements

- [ ] Fix schema drift — `database/schema.sql` is significantly out of date vs live DB (uses old column names like `service_category` instead of `service_key`, old `ctr_models` shape, missing `audit_raw_payloads`, missing `v_opportunity_breakdown` view)
- [ ] Agent cards currently render between Competitive Snapshot and Keyword Evidence — review placement and ordering
- [ ] Add loading states for agent cards (they return `null` when no data, but could show a subtle "No agent data" placeholder)
- [ ] TechnicalHealthCard: add sorting/filtering to page inventory table
- [ ] ArchitecturePlanCard: improve table parsing robustness — Michael's markdown table formats may vary
- [ ] ImplementationRoadmapCard: extract `target_word_count` more reliably from content outlines
- [ ] Pipeline badge: consider showing individual agent status icons instead of just N/4
- [ ] "Share Link" button (currently disabled) — implement shareable read-only audit URLs
- [ ] Mobile responsiveness — test all new cards on small screens
- [ ] Dark mode — verify new components look correct in dark theme

### 5. Sync Bridge Improvements

- [ ] Deduplicate agent_runs — re-running sync creates duplicate records (add upsert or delete-before-insert per agent)
- [ ] Dwight semantic data — Screaming Frog CSV export doesn't always populate semantic columns; consider parsing the `.seospider` project file directly or requiring `--bulk-export Content:Semantically Similar`
- [ ] Add `--dry-run` flag to preview what would be synced without writing to Supabase
- [ ] Add `npm run sync:verify` script to check data integrity post-sync
- [ ] Phase 4 (automation) — add `sync_dashboard` IPC task type so Pam auto-triggers sync after completing

---

## Previous Session Context

### Agents Built

| Agent | File | Status |
|-------|------|--------|
| **Jim** (Scout) | `.claude/agents/Jim.md` | Done — research + synthesis for veteransplumbingcorp.com |
| **Dwight** (Auditor) | `.claude/agents/Dwight.md` | Done — technical audit + semantic crawl |
| **Michael** (Architect) | `.claude/agents/Michael.md` | Done — architecture blueprint for veteransplumbingcorp.com |
| **Pam** (Implementer) | `.claude/agents/Pam.md` | Done — first pillar output (`/plumber-boise`) |

### Lessons Learned (Screaming Frog CLI + Gemini)

1. **`--use-gemini` flag is required** on the CLI even if the config has Gemini enabled
2. **`mAutoAnalyse` must be `true`** in the config binary — without it, embeddings are generated but cosine similarity is never calculated
3. **WSL2 has separate config paths** — Windows GUI saves to `C:\Users\{user}\.ScreamingFrogSEOSpider\`, Linux CLI reads from `~/.ScreamingFrogSEOSpider/`
4. **`Content:Low Relevance Content`** is not a valid `--bulk-export` in SF 23.3 — use `Content:Semantically Similar` only
5. **Output directory must exist** before running the CLI
6. **UTF-8 BOM** — Screaming Frog CSVs include a BOM character; strip `charCodeAt(0) === 0xfeff` before parsing
