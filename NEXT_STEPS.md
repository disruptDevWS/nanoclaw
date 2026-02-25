# Next Steps — Pick Up Here

**Last session:** 2026-02-24

---

## Current Progress

### Agents Built

| Agent | File | Status |
|-------|------|--------|
| **Jim** (Scout) | `.claude/agents/Jim.md` | Done — synthesis filters tested and verified on veteransplumbingcorp.com |
| **Dwight** (Auditor) | `.claude/agents/Dwight.md` | Done — full technical audit + semantic crawl working end-to-end |
| **Michael** (Architect) | `.claude/agents/Michael.md` | Created — semantic data ready, has not been run yet |

### Audits Completed

| Domain | Path | Contents |
|--------|------|----------|
| veteransplumbingcorp.com | `audits/.../research/2026-02-23/` | Jim's ranked keywords, competitors, research summary (with synthesis filters) |
| veteransplumbingcorp.com | `audits/.../auditor/2026-02-23/` | Dwight's full technical audit — 53 exports + AUDIT_REPORT.md |
| veteransplumbingcorp.com | `audits/.../auditor/2026-02-24/` | Dwight's re-run with Gemini connected (internal_all.csv) |
| veteransplumbingcorp.com | `audits/.../architecture/2026-02-24/` | Semantic crawl with actual scores — `internal_all.csv` + `semantically_similar_report.csv` |

### Semantic Results Summary

| Score | Flag | Page | Closest Match |
|-------|------|------|--------------|
| 0.966 | NEAR-DUP | `/contact-us` | `/about-us` |
| 0.956 | NEAR-DUP | `/` (homepage) | `/Water-Softener-System` |
| 0.950 | NEAR-DUP | `/hot-water-heater-meridian` | `/water-softeners-Kuna-id` |
| 0.948 | CANNIBAL | `/Residential-Plumbing-Services` | `/` |
| 0.948 | CANNIBAL | `/water-softeners-nampa-idaho` | `/water-softeners-Kuna-id` |
| 0.945 | CANNIBAL | `/Water-Heater-Replacement` | `/Tankless-Water-Heater` |
| 0.943 | CANNIBAL | `/water-softener-eagle-idaho` | `/hot-water-heater-meridian` |

---

## Next Task: Run Michael

Michael has everything he needs in `audits/veteransplumbingcorp.com/architecture/2026-02-24/`:
- `internal_all.csv` — full crawl data with semantic similarity scores and relevance scores
- `semantically_similar_report.csv` — near-duplicate pairs (>0.95 threshold)

Michael should produce:
1. Topic cluster map with pillar/cluster assignments
2. Cannibalization resolution plan (which pages to consolidate, differentiate, or remove)
3. Page title & metadata blueprint (primary keyword + value prop per page)
4. Architecture report saved to `audits/veteransplumbingcorp.com/architecture/2026-02-24/`

---

## Lessons Learned (Screaming Frog CLI + Gemini)

These are baked into Dwight.md but worth noting for reference:

1. **`--use-gemini` flag is required** on the CLI even if the config has Gemini enabled
2. **`mAutoAnalyse` must be `true`** in the config binary — without it, embeddings are generated but cosine similarity is never calculated
3. **WSL2 has separate config paths** — Windows GUI saves to `C:\Users\{user}\.ScreamingFrogSEOSpider\`, Linux CLI reads from `~/.ScreamingFrogSEOSpider/`. The API key must be in the Linux `spider.config` with `GEMINI.auto_connect=true`
4. **`Content:Low Relevance Content`** is not a valid `--bulk-export` in SF 23.3 — use `Content:Semantically Similar` only
5. **Output directory must exist** before running the CLI — SF does not create it
