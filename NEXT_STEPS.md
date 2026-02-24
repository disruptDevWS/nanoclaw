# Next Steps — Pick Up Here

**Last session:** 2026-02-23

---

## Current Progress

### Agents Built

| Agent | File | Status |
|-------|------|--------|
| **Jim** (Scout) | `.claude/agents/Jim.md` | Done — synthesis filters (keyword, competitor ranking, branded noise) tested and verified on veteransplumbingcorp.com |
| **Dwight** (Auditor) | `.claude/agents/Dwight.md` | Done — full technical audit complete, semantic toolkit added, metadata priorities refined, orphaned content discovery added |
| **Michael** (Architect) | `.claude/agents/Michael.md` | Created — waiting on semantic data from Dwight before first run |

### Audits Completed

| Domain | Path | Contents |
|--------|------|----------|
| veteransplumbingcorp.com | `audits/.../research/2026-02-23/` | Jim's ranked keywords, competitors, research summary (with synthesis filters applied) |
| veteransplumbingcorp.com | `audits/.../auditor/2026-02-23/` | Dwight's full technical audit — 53 exports + AUDIT_REPORT.md |
| veteransplumbingcorp.com | `audits/.../architecture/2026-02-23/` | Dwight's architecture crawl — structural analysis only, **no semantic scores yet** |

### Config State

- Gemini API key written to `~/.ScreamingFrogSEOSpider/spider.config` (outside repo, not committed)
- `mEnabled` patched to `true` in `configs/semantic_config.seospiderconfig` (binary, gitignored)
- `Content:Low Relevance Content` is **not** a valid `--bulk-export` in SF 23.3 — use `Content:Semantically Similar` only

---

## Next Task: Re-run Semantic Crawl

The Gemini API key is now in place. Run Dwight's architecture crawl to get actual similarity scores:

```bash
screamingfrogseospider --crawl https://www.veteransplumbingcorp.com/ \
  --headless \
  --config "./configs/semantic_config.seospiderconfig" \
  --bulk-export "Content:Semantically Similar" \
  --export-tabs "Internal:All" \
  --output-folder "./audits/veteransplumbingcorp.com/architecture/2026-02-23/"
```

**Success criteria:** `content_semantically_similar.csv` contains rows with actual cosine similarity scores (not headers-only).

### What to do with the scores

Apply Michael's thresholds from `.claude/agents/Michael.md`:

| Score | Action |
|-------|--------|
| > 0.95 | Consolidate into single page |
| 0.80-0.95 | Differentiate intent or merge |
| 0.70-0.80 | Healthy cluster members |
| < 0.70 | Delete, repurpose, or build new cluster |

### Predicted high-value findings (from structural analysis)

- **Kuna / Eagle / Nampa** water softener pages — near-identical templates, likely 0.85-0.95
- **Water-Heater-Replacement vs Tankless-Water-Heater** — overlapping Boise water heater intent
- **Residential-Plumbing-Services vs homepage** — subset topic overlap

---

## After Semantic Crawl

1. Update `audits/veteransplumbingcorp.com/architecture/2026-02-23/architecture_report.md` with scored findings
2. Update Dwight.md to fix the `--bulk-export` argument (remove `Content:Low Relevance Content`)
3. Run Michael on the scored architecture data to produce the content blueprint
4. Commit and push all results

---

## Pending Dwight.md Fix

The architecture crawl command in Dwight.md still references `Content:Low Relevance Content` which is invalid in SF 23.3. Update the command to:
```bash
--bulk-export "Content:Semantically Similar"
```
