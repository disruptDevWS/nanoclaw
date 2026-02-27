#!/bin/bash
# run-pipeline.sh — Sequential post-audit agent pipeline
#
# Runs after run-audit completes (keywords already in Supabase).
# Phase 1: Jim enrichment (aggregations + narrative → audit_snapshots)
# Phase 2: Michael architecture (blueprint → disk → sync-to-dashboard)
# Phase 3: Dwight technical audit (NanoClaw task → Docker/SF crawl, async)
#
# Usage:
#   ./scripts/run-pipeline.sh <domain> <email>
#   ./scripts/run-pipeline.sh veteransplumbingcorp.com matt@forgegrowth.ai

set -euo pipefail

DOMAIN="${1:?Usage: ./scripts/run-pipeline.sh <domain> <email>}"
EMAIL="${2:?Usage: ./scripts/run-pipeline.sh <domain> <email>}"
DATE=$(date +%Y-%m-%d)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "=== Post-Audit Pipeline: $DOMAIN ($DATE) ==="

# ─── Phase 1: Jim Enrichment ──────────────────────────────────
# Computes aggregations from Supabase audit_keywords (already populated
# by run-audit), generates narrative via claude --print, inserts
# audit_snapshots directly. No file sync needed.
echo ""
echo "--- Phase 1: Jim Enrichment ---"
npx tsx scripts/pipeline-generate.ts jim --domain "$DOMAIN" --user-email "$EMAIL"

# ─── Phase 2: Michael Architecture ────────────────────────────
# Generates architecture_blueprint.md via claude --print, writes to
# audits/{domain}/architecture/{date}/, then sync-to-dashboard parses
# and inserts into Supabase (architecture pages, blueprint, execution pages).
echo ""
echo "--- Phase 2: Michael Architecture ---"
npx tsx scripts/pipeline-generate.ts michael --domain "$DOMAIN" --user-email "$EMAIL"
npx tsx scripts/sync-to-dashboard.ts --domain "$DOMAIN" --user-email "$EMAIL" --agents michael

# ─── Phase 3: Dwight Technical Audit (async) ──────────────────
# Inserts a scheduled_task into NanoClaw SQLite. NanoClaw's scheduler
# picks it up and spawns a Docker container with Screaming Frog CLI.
# Runs async — sync when the crawl finishes.
echo ""
echo "--- Phase 3: Dwight Technical Audit ---"
npx tsx scripts/pipeline-generate.ts dwight --domain "$DOMAIN"
echo ""
echo "  Dwight is running async in Docker."
echo "  When the crawl completes, sync with:"
echo "    npx tsx scripts/sync-to-dashboard.ts --domain $DOMAIN --user-email $EMAIL --agents dwight"

# ─── Summary ──────────────────────────────────────────────────
echo ""
echo "=== Pipeline Complete ==="
echo "  Jim:     done (Research tab populated)"
echo "  Michael: done (Strategy + Content Factory tabs populated)"
echo "  Dwight:  triggered (sync when crawl finishes)"
