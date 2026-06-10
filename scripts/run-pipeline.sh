#!/bin/bash
# run-pipeline.sh — Sequential post-audit agent pipeline
#
# DATA OWNERSHIP CONTRACT (see docs/PIPELINE.md for full spec)
# ─────────────────────────────────────────────────────────────
# EXPECTS TO EXIST:
#   audits              — created by Dashboard useCreateAudit
#   audit_assumptions   — created by Dashboard (or auto-created by sync from benchmarks)
#   benchmarks          — seeded reference data (one row per service vertical)
#   ctr_models          — seeded reference data (one row with is_default=true)
#
# THIS PIPELINE WRITES:
#   audit_keywords      — Phase 2 (source='keyword_research'), Phase 3b (source='ranked'),
#                         Phase 3c (UPDATE canonical_key/topic/intent/brand)
#   audit_clusters      — Phase 3b (preliminary), Phase 3d (canonical, authoritative)
#   audit_rollups       — Phase 3b (preliminary), Phase 3d (canonical, authoritative)
#   audit_topic_competitors — Phase 4
#   audit_topic_dominance   — Phase 4
#   cannibalization_warnings — Phase 4c (also UPDATEs audit_clusters density columns)
#   agent_architecture_pages  — Phase 6b
#   agent_architecture_blueprint — Phase 6b
#   execution_pages     — Phase 6b (UPSERT)
#   agent_technical_pages — Phase 6c
#   gbp_snapshots       — Phase 6d
#   citation_snapshots  — Phase 6d
#   audit_snapshots     — Phase 3b, 6b, 6c
#   agent_runs          — all generation phases
#   audits              — agent_pipeline_status updates throughout
#
# THE run-audit EDGE FUNCTION WRITES NOTHING TO THE ABOVE.
# It only sets audits.status='running' + agent_pipeline_status='queued'.
# ─────────────────────────────────────────────────────────────
#
# Phase 1:  Dwight — DataForSEO OnPage crawl + HTTP verification + analysis → AUDIT_REPORT.md + CSVs
# Phase 2:  KeywordResearch — Service × city × intent matrix → keyword_research_summary.md + audit_keywords (seeded)
# Phase 3:  Jim — DataForSEO ranked-keywords + competitors → research_summary.md
# Phase 3b: sync jim — ranked_keywords.json → Supabase (audit_keywords, clusters, rollups)
# Phase 3c: canonicalize — Claude Haiku semantic topic grouping → canonical_key/topic
# Phase 3d: rebuild clusters — re-aggregate using canonical_key (post-canonicalize)
# Phase 4:  Competitors — DataForSEO SERP per topic → audit_topic_competitors/dominance
# Phase 4b: Section extraction — competitor/client H2-H3 headings → competitor_sections + coverage scores
# Phase 4c: Coverage density + cannibalization — keyword↔content embeddings → audit_clusters density scores + cannibalization_warnings
# Phase 5:  Gap — Competitive gap synthesis → content_gap_analysis.md + audit_snapshots
# Phase 6:  Michael — Reads ALL disk artifacts → architecture_blueprint.md
# Phase 6b: sync michael — architecture_blueprint.md → Supabase
# Phase 6c: sync dwight — internal_all.csv + AUDIT_REPORT.md → Supabase
# Phase 6d: local presence — GBP lookup + SERP citation scan → gbp_snapshots, citation_snapshots
#
# All phases run synchronously.
#
# Usage:
#   ./scripts/run-pipeline.sh <domain> <email> [seed_matrix.json] [competitor_urls] [--mode sales|full|prospect] [--prospect-config <path>] [--start-from <phase>] [--stop-after <phase>]
#   ./scripts/run-pipeline.sh foxhvacpro.com matt@forgegrowth.ai
#   ./scripts/run-pipeline.sh foxhvacpro.com matt@forgegrowth.ai --mode sales
#   ./scripts/run-pipeline.sh foxhvacpro.com matt@forgegrowth.ai --start-from 3 --stop-after 3d
#   ./scripts/run-pipeline.sh newsite.com matt@forgegrowth.ai audits/newsite.com/seed_matrix.json "comp1.com,comp2.com"
#   ./scripts/run-pipeline.sh prospect.com matt@forgegrowth.ai --mode prospect --prospect-config audits/prospect.com/prospect-config.json

set -euo pipefail
# errtrace: ERR trap must fire for failures inside functions (run_step wraps
# every phase step) — without this, a timed-out step exits the script silently.
set -o errtrace

DOMAIN="${1:?Usage: ./scripts/run-pipeline.sh <domain> <email> [seed_matrix.json] [competitor_urls] [--mode sales|full|prospect] [--prospect-config <path>]}"
EMAIL="${2:?Usage: ./scripts/run-pipeline.sh <domain> <email> [seed_matrix.json] [competitor_urls] [--mode sales|full|prospect] [--prospect-config <path>]}"
SEED_MATRIX="${3:-}"
COMPETITOR_URLS="${4:-}"
DATE=$(date +%Y-%m-%d)

# Parse --mode, --prospect-config, --start-from, --stop-after flags from any position
MODE="full"
PROSPECT_CONFIG=""
START_FROM=""
STOP_AFTER=""
NEXT_FLAG=""
for i in "$@"; do
  if [[ "$i" == "--mode" ]]; then
    NEXT_FLAG="mode"
    continue
  fi
  if [[ "$i" == "--prospect-config" ]]; then
    NEXT_FLAG="prospect-config"
    continue
  fi
  if [[ "$i" == "--start-from" ]]; then
    NEXT_FLAG="start-from"
    continue
  fi
  if [[ "$i" == "--stop-after" ]]; then
    NEXT_FLAG="stop-after"
    continue
  fi
  if [[ "$NEXT_FLAG" == "mode" ]]; then
    MODE="$i"
    NEXT_FLAG=""
  elif [[ "$NEXT_FLAG" == "prospect-config" ]]; then
    PROSPECT_CONFIG="$i"
    NEXT_FLAG=""
  elif [[ "$NEXT_FLAG" == "start-from" ]]; then
    START_FROM="$i"
    NEXT_FLAG=""
  elif [[ "$NEXT_FLAG" == "stop-after" ]]; then
    STOP_AFTER="$i"
    NEXT_FLAG=""
  fi
done

# Phase ordering for --start-from / --stop-after
PHASE_ORDER=(1 1c 1b 2 3 3b 3c 3d 4 4b 4c 5 6 6b 6c 6d)
should_run_phase() {
  local phase="$1"
  [[ -z "$START_FROM" && -z "$STOP_AFTER" ]] && return 0
  local idx=-1 start_idx=0 stop_idx=${#PHASE_ORDER[@]}
  for i in "${!PHASE_ORDER[@]}"; do
    [[ "${PHASE_ORDER[$i]}" == "$phase" ]] && idx=$i
    [[ -n "$START_FROM" && "${PHASE_ORDER[$i]}" == "$START_FROM" ]] && start_idx=$i
    [[ -n "$STOP_AFTER" && "${PHASE_ORDER[$i]}" == "$STOP_AFTER" ]] && stop_idx=$i
  done
  [[ $idx -ge $start_idx && $idx -le $stop_idx ]] && return 0 || return 1
}

# Clear positional args that were actually flags
[[ "$SEED_MATRIX" == "--mode" || "$SEED_MATRIX" == "--prospect-config" ]] && SEED_MATRIX=""
[[ "$COMPETITOR_URLS" == "--mode" || "$COMPETITOR_URLS" == "sales" || "$COMPETITOR_URLS" == "full" || "$COMPETITOR_URLS" == "--prospect-config" ]] && COMPETITOR_URLS=""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

MODE_ARGS=""
[[ "$MODE" != "full" ]] && MODE_ARGS="--mode $MODE"

echo "=== Post-Audit Pipeline: $DOMAIN ($DATE) [mode=$MODE] ==="

# ─── Phase 0: Scout (Prospect Discovery) ─────────────────────
# In prospect mode, only Scout runs — skips the full pipeline.
if [[ "$MODE" = "prospect" ]]; then
  if [[ -z "$PROSPECT_CONFIG" ]]; then
    echo "ERROR: --prospect-config is required for prospect mode"
    exit 1
  fi
  echo ""
  echo "--- Phase 0: Scout (Prospect Discovery) ---"
  npx tsx scripts/pipeline-generate.ts scout \
    --domain "$DOMAIN" --prospect-config "$PROSPECT_CONFIG"

  echo ""
  echo "--- Prospect Intelligence Brief ---"
  npx tsx scripts/generate-prospect-brief.ts --domain "$DOMAIN" || {
    echo "  WARNING: Prospect brief generation failed (non-fatal)"
  }

  echo ""
  echo "=== Scout Complete ==="
  exit 0
fi

# Helper: update dashboard pipeline status (non-fatal)
update_status() {
  npx tsx scripts/update-pipeline-status.ts "$DOMAIN" "$EMAIL" "$1" 2>/dev/null || true
}

# ─── Per-step timeout + run progress tracking ─────────────────
# Each phase step is wrapped in `run_step` which enforces PHASE_STEP_TIMEOUT
# (seconds, default 900). On timeout the step gets SIGTERM, then SIGKILL 30s
# later — exit 124 propagates like any other failure (ERR trap / QA || blocks).
PHASE_STEP_TIMEOUT="${PHASE_STEP_TIMEOUT:-900}"
run_step() {
  if command -v timeout >/dev/null 2>&1; then
    timeout --kill-after=30 "$PHASE_STEP_TIMEOUT" "$@"
  else
    "$@"
  fi
}

# pipeline_runs progress tracking — all writes are non-fatal (|| true);
# a Supabase blip never kills the pipeline.
CURRENT_PHASE=""
RUN_ID="$(npx tsx scripts/pipeline-progress.ts start "$DOMAIN" "$EMAIL" "$MODE" "$START_FROM" "$STOP_AFTER" 2>/dev/null || true)"
progress() { [[ -n "$RUN_ID" ]] && npx tsx scripts/pipeline-progress.ts "$@" 2>/dev/null || true; }
phase_start() { CURRENT_PHASE="$1"; progress phase-start "$RUN_ID" "$1"; }
phase_done()  { progress phase-done "$RUN_ID" "$1"; CURRENT_PHASE=""; }
phase_skip()  { progress phase-skip "$RUN_ID" "$1"; }
pipeline_fail() { update_status failed; progress fail "$RUN_ID" "$CURRENT_PHASE" "${1:-}"; }

# Trap errors to mark pipeline as failed
trap 'pipeline_fail' ERR
# Trap SIGTERM/SIGINT (Railway deploy drain / watchdog) to mark failed before exit
trap 'echo "[Pipeline] Received signal — marking failed"; pipeline_fail "terminated (signal)"; exit 1' TERM INT

update_status audit

[[ -n "$START_FROM" ]] && echo "  Resuming from Phase $START_FROM (skipping earlier phases)"
[[ -n "$STOP_AFTER" ]] && echo "  Stopping after Phase $STOP_AFTER (skipping later phases)"

# ─── Phase 1: Dwight — DataForSEO OnPage Crawl ───────────────
if should_run_phase 1; then
phase_start 1
echo ""
echo "--- Phase 1: Dwight (DataForSEO OnPage Crawl) ---"
run_step npx tsx scripts/pipeline-generate.ts dwight --domain "$DOMAIN" --user-email "$EMAIL"

# QA gate: Dwight
echo "--- QA: Dwight ---"
QA_RESULT=$(run_step npx tsx scripts/pipeline-generate.ts qa --domain "$DOMAIN" --user-email "$EMAIL" --phase dwight 2>&1) || {
  echo "  QA ENHANCE for Dwight — re-running with feedback..."
  run_step npx tsx scripts/pipeline-generate.ts dwight --domain "$DOMAIN" --user-email "$EMAIL"
  run_step npx tsx scripts/pipeline-generate.ts qa --domain "$DOMAIN" --user-email "$EMAIL" --phase dwight || {
    echo "  QA FAILED for Dwight after retry"
    pipeline_fail "QA failed for Dwight"
    exit 1
  }
}
echo "  QA PASSED: Dwight"
phase_done 1
else echo "  [SKIP] Phase 1: Dwight"; phase_skip 1; fi

# Phase 1a (Verify Dwight) is now integrated into Phase 1 — HTTP checks run
# before the Claude call so the executive summary reflects verified facts.

# ─── Phase 1c: GSC Data Fetch ─────────────────────────────────
if should_run_phase 1c; then
phase_start 1c
echo ""
echo "--- Phase 1c: GSC Data Fetch ---"
run_step npx tsx scripts/fetch-gsc-data.ts --domain "$DOMAIN" --user-email "$EMAIL" || {
  echo "  WARNING: GSC data fetch failed (non-fatal)"
}
phase_done 1c
else echo "  [SKIP] Phase 1c: GSC Data Fetch"; phase_skip 1c; fi

# ─── Phase 1b: Strategy Brief ────────────────────────────────
if should_run_phase 1b; then
phase_start 1b
echo ""
echo "--- Phase 1b: Strategy Brief ---"
run_step npx tsx scripts/strategy-brief.ts --domain "$DOMAIN" --user-email "$EMAIL" --force

# QA gate: Strategy Brief
echo "--- QA: Strategy Brief ---"
QA_RESULT=$(run_step npx tsx scripts/pipeline-generate.ts qa --domain "$DOMAIN" --user-email "$EMAIL" --phase strategy-brief 2>&1) || {
  echo "  QA ENHANCE for Strategy Brief — re-running..."
  run_step npx tsx scripts/strategy-brief.ts --domain "$DOMAIN" --user-email "$EMAIL" --force
  run_step npx tsx scripts/pipeline-generate.ts qa --domain "$DOMAIN" --user-email "$EMAIL" --phase strategy-brief || {
    echo "  QA FAILED for Strategy Brief after retry — halting (upstream-critical)"
    pipeline_fail "QA failed for Strategy Brief"
    exit 1
  }
}
echo "  QA PASSED: Strategy Brief"
phase_done 1b
else echo "  [SKIP] Phase 1b: Strategy Brief"; phase_skip 1b; fi

# ─── Review Gate (opt-in pause after Phase 1b) ──────────────
if should_run_phase 1b && [ "$MODE" = "full" ]; then
  REVIEW_GATE=$(npx tsx scripts/update-pipeline-status.ts "$DOMAIN" "$EMAIL" check-review-gate 2>/dev/null)
  if [ "$REVIEW_GATE" = "pause" ]; then
    echo "[Pipeline] Pausing for Strategy Brief review — status → awaiting_review"
    npx tsx scripts/update-pipeline-status.ts "$DOMAIN" "$EMAIL" awaiting_review
    progress pause "$RUN_ID"
    exit 0
  fi
fi

# ─── Phase 2: Keyword Research ───────────────────────────────
if should_run_phase 2; then
phase_start 2
echo ""
echo "--- Phase 2: Keyword Research (Service × City Matrix) ---"
run_step npx tsx scripts/pipeline-generate.ts keyword-research --domain "$DOMAIN" --user-email "$EMAIL"

update_status research
phase_done 2
else echo "  [SKIP] Phase 2: Keyword Research"; phase_skip 2; fi

# ─── Phase 3: Jim — DataForSEO → disk artifacts ─────────────
if should_run_phase 3; then
phase_start 3
echo ""
echo "--- Phase 3: Jim (DataForSEO + Research Summary) ---"
SEED_ARGS=""
[[ -n "$SEED_MATRIX" ]] && SEED_ARGS="--seed-matrix $SEED_MATRIX"
[[ -n "$COMPETITOR_URLS" ]] && SEED_ARGS="$SEED_ARGS --competitor-urls $COMPETITOR_URLS"
run_step npx tsx scripts/pipeline-generate.ts jim --domain "$DOMAIN" --user-email "$EMAIL" $SEED_ARGS $MODE_ARGS

# QA gate: Jim
echo "--- QA: Jim ---"
QA_RESULT=$(run_step npx tsx scripts/pipeline-generate.ts qa --domain "$DOMAIN" --user-email "$EMAIL" --phase jim 2>&1) || {
  echo "  QA ENHANCE for Jim — re-running with feedback..."
  run_step npx tsx scripts/pipeline-generate.ts jim --domain "$DOMAIN" --user-email "$EMAIL" $SEED_ARGS $MODE_ARGS
  run_step npx tsx scripts/pipeline-generate.ts qa --domain "$DOMAIN" --user-email "$EMAIL" --phase jim || {
    echo "  QA FAILED for Jim after retry"
    pipeline_fail "QA failed for Jim"
    exit 1
  }
}
echo "  QA PASSED: Jim"
phase_done 3
else echo "  [SKIP] Phase 3: Jim"; phase_skip 3; fi

# ─── Phase 3b: sync jim → Supabase ──────────────────────────
if should_run_phase 3b; then
phase_start 3b
echo ""
echo "--- Phase 3b: Sync Jim → Supabase ---"
run_step npx tsx scripts/sync-to-dashboard.ts --domain "$DOMAIN" --user-email "$EMAIL" --agents jim
phase_done 3b
else echo "  [SKIP] Phase 3b: Sync Jim"; phase_skip 3b; fi

# ─── Phase 3c: Canonicalize Topics ───────────────────────────
if should_run_phase 3c; then
phase_start 3c
echo ""
echo "--- Phase 3c: Canonicalize Topics (Hybrid) ---"
run_step npx tsx scripts/pipeline-generate.ts canonicalize --domain "$DOMAIN" --user-email "$EMAIL"
phase_done 3c
else echo "  [SKIP] Phase 3c: Canonicalize"; phase_skip 3c; fi

# ─── Phase 3d: Rebuild Clusters ──────────────────────────────
if should_run_phase 3d; then
phase_start 3d
echo ""
echo "--- Phase 3d: Rebuild Clusters (post-canonicalize) ---"
run_step npx tsx scripts/sync-to-dashboard.ts --domain "$DOMAIN" --user-email "$EMAIL" --rebuild-clusters

update_status architecture
phase_done 3d
else echo "  [SKIP] Phase 3d: Rebuild Clusters"; phase_skip 3d; fi

if [[ "$MODE" != "sales" ]]; then
  # ─── Phase 4: Competitor SERP Analysis ──────────────────────
  if should_run_phase 4; then
  phase_start 4
  echo ""
  echo "--- Phase 4: Competitor SERP Analysis ---"
  run_step npx tsx scripts/pipeline-generate.ts competitors --domain "$DOMAIN" --user-email "$EMAIL"
  phase_done 4
  else echo "  [SKIP] Phase 4: Competitors"; phase_skip 4; fi

  # ─── Phase 4b: Competitor Section Extraction ────────────────
  if should_run_phase 4b; then
  phase_start 4b
  echo ""
  echo "--- Phase 4b: Competitor Section Extraction ---"
  run_step npx tsx scripts/fetch-competitor-sections.ts --domain "$DOMAIN" --user-email "$EMAIL"
  phase_done 4b
  else echo "  [SKIP] Phase 4b: Section Extraction"; phase_skip 4b; fi

  # ─── Phase 4c: Coverage Density + Cannibalization ───────────
  if should_run_phase 4c; then
  phase_start 4c
  echo ""
  echo "--- Phase 4c: Coverage Density + Cannibalization ---"
  run_step npx tsx scripts/compute-density.ts --domain "$DOMAIN" --user-email "$EMAIL"
  phase_done 4c
  else echo "  [SKIP] Phase 4c: Coverage Density"; phase_skip 4c; fi

  # ─── Phase 5: Content Gap Analysis ──────────────────────────
  if should_run_phase 5; then
  phase_start 5
  echo ""
  echo "--- Phase 5: Content Gap Analysis ---"
  run_step npx tsx scripts/pipeline-generate.ts gap --domain "$DOMAIN" --user-email "$EMAIL"

  # QA gate: Gap
  echo "--- QA: Gap ---"
  QA_RESULT=$(run_step npx tsx scripts/pipeline-generate.ts qa --domain "$DOMAIN" --user-email "$EMAIL" --phase gap 2>&1) || {
    echo "  QA ENHANCE for Gap — re-running with feedback..."
    run_step npx tsx scripts/pipeline-generate.ts gap --domain "$DOMAIN" --user-email "$EMAIL"
    run_step npx tsx scripts/pipeline-generate.ts qa --domain "$DOMAIN" --user-email "$EMAIL" --phase gap || {
      echo "  QA FAILED for Gap after retry"
      pipeline_fail "QA failed for Gap"
      exit 1
    }
  }
  echo "  QA PASSED: Gap"
  phase_done 5
  else echo "  [SKIP] Phase 5: Gap"; phase_skip 5; fi
else
  echo ""
  echo "--- [SALES MODE] Skipping Phases 4-5 (Competitors + Gap) ---"
  phase_skip 4; phase_skip 4b; phase_skip 4c; phase_skip 5
fi

# ─── Phase 6: Michael Architecture ────────────────────────────
if should_run_phase 6; then
phase_start 6
echo ""
echo "--- Phase 6: Michael Architecture ---"
run_step npx tsx scripts/pipeline-generate.ts michael --domain "$DOMAIN" --user-email "$EMAIL" $MODE_ARGS

# QA gate: Michael
echo "--- QA: Michael ---"
QA_RESULT=$(run_step npx tsx scripts/pipeline-generate.ts qa --domain "$DOMAIN" --user-email "$EMAIL" --phase michael 2>&1) || {
  echo "  QA ENHANCE for Michael — re-running with feedback..."
  run_step npx tsx scripts/pipeline-generate.ts michael --domain "$DOMAIN" --user-email "$EMAIL" $MODE_ARGS
  run_step npx tsx scripts/pipeline-generate.ts qa --domain "$DOMAIN" --user-email "$EMAIL" --phase michael || {
    echo "  QA FAILED for Michael after retry"
    pipeline_fail "QA failed for Michael"
    exit 1
  }
}
echo "  QA PASSED: Michael"
phase_done 6
else echo "  [SKIP] Phase 6: Michael"; phase_skip 6; fi

# ─── Phase 6b: Sync Michael → Supabase ────────────────────────
if should_run_phase 6b; then
phase_start 6b
echo ""
echo "--- Phase 6b: Sync Michael → Supabase ---"
run_step npx tsx scripts/sync-to-dashboard.ts --domain "$DOMAIN" --user-email "$EMAIL" --agents michael${START_FROM:+ --start-from "$START_FROM"}
phase_done 6b
else echo "  [SKIP] Phase 6b: Sync Michael"; phase_skip 6b; fi

# ─── Phase 6c: Sync Dwight → Supabase ─────────────────────────
if should_run_phase 6c; then
phase_start 6c
echo ""
echo "--- Phase 6c: Sync Dwight → Supabase ---"
run_step npx tsx scripts/sync-to-dashboard.ts --domain "$DOMAIN" --user-email "$EMAIL" --agents dwight${START_FROM:+ --start-from "$START_FROM"}
phase_done 6c
elif should_run_phase 1; then
# Auto-sync: Phase 1 (Dwight) ran but Phase 6c was outside --stop-after range
phase_start 6c
echo ""
echo "--- Auto-sync: Dwight → Supabase (Phase 1 ran, 6c was out of range) ---"
run_step npx tsx scripts/sync-to-dashboard.ts --domain "$DOMAIN" --user-email "$EMAIL" --agents dwight
phase_done 6c
else echo "  [SKIP] Phase 6c: Sync Dwight"; phase_skip 6c; fi

# ─── Phase 6d: Local Presence Diagnostic (GBP + Citations) ────
if should_run_phase 6d; then
phase_start 6d
echo ""
echo "--- Phase 6d: Local Presence Diagnostic (GBP + Citations) ---"
run_step npx tsx scripts/local-presence.ts --domain "$DOMAIN" --user-email "$EMAIL" --force
phase_done 6d
else echo "  [SKIP] Phase 6d: Local Presence"; phase_skip 6d; fi

# ─── Post-Pipeline: Client Intelligence Brief ─────────────────
echo ""
echo "--- Client Intelligence Brief ---"
run_step npx tsx scripts/generate-client-brief.ts --domain "$DOMAIN" --user-email "$EMAIL" || {
  echo "  WARNING: Client brief generation failed (non-fatal)"
}

update_status complete
progress complete "$RUN_ID"

# ─── Summary ──────────────────────────────────────────────────
echo ""
echo "=== Pipeline Complete [mode=$MODE] ==="
echo "  Phase 1:  Dwight   — DataForSEO OnPage crawl → AUDIT_REPORT.md [QA ✓]"
echo "  Phase 1c: GSC      — Google Search Console data fetch (non-fatal)"
echo "  Phase 2:  KWRes.   — Service × city × intent matrix → keyword_research_summary.md"
echo "  Phase 3:  Jim      — DataForSEO ranked-keywords + competitors → research_summary.md [QA ✓]"
echo "  Phase 3b: sync     — ranked_keywords.json → audit_keywords (preliminary clusters)"
echo "  Phase 3c: canon.   — Claude Haiku semantic topic grouping → canonical_key/topic"
echo "  Phase 3d: rebuild  — Re-aggregate clusters using canonical groupings"
if [[ "$MODE" != "sales" ]]; then
  echo "  Phase 4:  Compet.  — SERP analysis → audit_topic_competitors/dominance"
  echo "  Phase 5:  Gap      — Competitive gap synthesis → content_gap_analysis.md [QA ✓]"
else
  echo "  Phase 4:  SKIPPED  (sales mode)"
  echo "  Phase 5:  SKIPPED  (sales mode)"
fi
echo "  Phase 6:  Michael  — All artifacts → architecture_blueprint.md [QA ✓]"
echo "  Phase 6b: sync     — architecture_blueprint.md → Supabase"
echo "  Phase 6c: sync     — internal_all.csv + AUDIT_REPORT.md → Supabase"
echo "  Phase 6d: local    — GBP lookup + citation scan (11 directories)"
echo ""
echo "Dashboard tabs: Research, Strategy, Content Factory, Technical Audit"
