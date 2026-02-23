#!/usr/bin/env bash
set -euo pipefail

# foundational_scout.sh — DataForSEO interface for Jim (The Scout)
# Usage: ./scripts/foundational_scout.sh <domain> <command> [options]
#        ./scripts/foundational_scout.sh credits

DATAFORSEO_API="https://api.dataforseo.com/v3"
DEFAULT_LOCATION=2840
DEFAULT_LANGUAGE="en"
DEFAULT_LIMIT=1000
DEFAULT_SESSION_BUDGET="1.00"
COST_LOG="audits/.dataforseo_cost.log"

usage() {
  cat <<'EOF'
Usage: ./scripts/foundational_scout.sh <domain> <command> [options]
       ./scripts/foundational_scout.sh credits

Commands:
  credits            Check account balance (no domain needed)
  ranked-keywords    All keywords a domain ranks for (volume, CPC, position, intent)
  competitors        Domains competing for the same keywords
  related-keywords   Topic expansion from a seed keyword (requires --keyword)
  serp-local         Live SERP scrape for local pack listings (requires --keyword)

Options:
  --keyword "..."    Seed keyword (required for related-keywords and serp-local)
  --location CODE    Location code (default: 2840 = US)
  --language CODE    Language code (default: en)
  --limit N          Result limit for ranked-keywords/competitors (default: 1000)
  --budget N         Session budget in credits (default: 1.00)

Environment:
  DATAFORSEO_LOGIN             DataForSEO account email
  DATAFORSEO_PASSWORD          DataForSEO account password
  DATAFORSEO_SESSION_BUDGET    Override default session budget (default: 1.00)

Output:
  Raw JSON saved to audits/<domain>/research/<YYYY-MM-DD>/
  File path printed to stdout on success.
EOF
  exit 1
}

die() { echo "Error: $*" >&2; exit 1; }

# --- Credits subcommand (no domain needed) ---

if [[ "${1:-}" == "credits" ]]; then
  [[ -n "${DATAFORSEO_LOGIN:-}" ]]    || die "DATAFORSEO_LOGIN is not set"
  [[ -n "${DATAFORSEO_PASSWORD:-}" ]] || die "DATAFORSEO_PASSWORD is not set"

  AUTH=$(printf '%s:%s' "$DATAFORSEO_LOGIN" "$DATAFORSEO_PASSWORD" | base64 | tr -d '\n')

  response=$(curl -s \
    -H "Authorization: Basic ${AUTH}" \
    -H "Content-Type: application/json" \
    "${DATAFORSEO_API}/appendix/user_data")

  if command -v jq &>/dev/null; then
    balance=$(echo "$response" | jq -r '.tasks[0].result[0].money.balance // "N/A"')
    deposited=$(echo "$response" | jq -r '.tasks[0].result[0].money.total_deposited // "N/A"')
    spent=$(echo "$response" | jq -r '.tasks[0].result[0].money.total_spent // "N/A"')
    printf 'Balance:   $%s\nDeposited: $%s\nSpent:     $%s\n' "$balance" "$deposited" "$spent"
  else
    echo "$response"
  fi
  exit 0
fi

# --- Argument parsing ---

[[ $# -ge 2 ]] || usage

DOMAIN="$1"; shift
COMMAND="$1"; shift

KEYWORD=""
LOCATION="$DEFAULT_LOCATION"
LANGUAGE="$DEFAULT_LANGUAGE"
LIMIT="$DEFAULT_LIMIT"
SESSION_BUDGET="${DATAFORSEO_SESSION_BUDGET:-$DEFAULT_SESSION_BUDGET}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keyword)  KEYWORD="$2"; shift 2 ;;
    --location) LOCATION="$2"; shift 2 ;;
    --language) LANGUAGE="$2"; shift 2 ;;
    --limit)    LIMIT="$2"; shift 2 ;;
    --budget)   SESSION_BUDGET="$2"; shift 2 ;;
    *) die "Unknown option: $1" ;;
  esac
done

# --- Validate credentials ---

[[ -n "${DATAFORSEO_LOGIN:-}" ]]    || die "DATAFORSEO_LOGIN is not set"
[[ -n "${DATAFORSEO_PASSWORD:-}" ]] || die "DATAFORSEO_PASSWORD is not set"

AUTH=$(printf '%s:%s' "$DATAFORSEO_LOGIN" "$DATAFORSEO_PASSWORD" | base64 | tr -d '\n')

# --- Session budget tracking ---

CUMULATIVE_COST="0"

# --- Output directory ---

TODAY=$(date +%Y-%m-%d)
OUTDIR="audits/${DOMAIN}/research/${TODAY}"
mkdir -p "$OUTDIR"

# --- Helper: POST to DataForSEO and save response ---

api_post() {
  local endpoint="$1"
  local payload="$2"
  local outfile="$3"

  local http_code
  http_code=$(curl -s -o "$outfile.tmp" -w '%{http_code}' \
    -X POST "${DATAFORSEO_API}/${endpoint}" \
    -H "Authorization: Basic ${AUTH}" \
    -H "Content-Type: application/json" \
    -d "$payload")

  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    local body
    body=$(cat "$outfile.tmp" 2>/dev/null || echo "(no response body)")
    rm -f "$outfile.tmp"
    die "API returned HTTP ${http_code}: ${body}"
  fi

  # Extract cost and track budget (requires jq)
  if command -v jq &>/dev/null; then
    local call_cost
    call_cost=$(jq -r '.cost // 0' "$outfile.tmp" 2>/dev/null || echo "0")

    # Append to cost log
    mkdir -p "$(dirname "$COST_LOG")"
    printf '%s %s %s\n' "$(date -Iseconds)" "$endpoint" "$call_cost" >> "$COST_LOG"

    # Update cumulative cost
    CUMULATIVE_COST=$(jq -n "$CUMULATIVE_COST + $call_cost")

    echo "[cost] ${call_cost} credits (budget: ${SESSION_BUDGET})" >&2

    # Check budget
    local over
    over=$(jq -n "$CUMULATIVE_COST >= $SESSION_BUDGET" 2>/dev/null || echo "false")
    if [[ "$over" == "true" ]]; then
      # Still save the response before dying
      jq '.' "$outfile.tmp" > "$outfile" 2>/dev/null || mv "$outfile.tmp" "$outfile"
      rm -f "$outfile.tmp"
      echo "$outfile"
      die "Session budget exhausted (spent: ${CUMULATIVE_COST}, budget: ${SESSION_BUDGET}). Increase with --budget or DATAFORSEO_SESSION_BUDGET."
    fi
  fi

  # Pretty-print if jq is available, otherwise save raw
  if command -v jq &>/dev/null; then
    jq '.' "$outfile.tmp" > "$outfile" 2>/dev/null || mv "$outfile.tmp" "$outfile"
    rm -f "$outfile.tmp"
  else
    mv "$outfile.tmp" "$outfile"
  fi

  echo "$outfile"
}

# --- Subcommands ---

cmd_ranked_keywords() {
  local payload
  payload=$(cat <<JSON
[{
  "target": "${DOMAIN}",
  "location_code": ${LOCATION},
  "language_code": "${LANGUAGE}",
  "limit": ${LIMIT}
}]
JSON
)
  api_post "dataforseo_labs/google/ranked_keywords/live" "$payload" "${OUTDIR}/ranked_keywords.json"
}

cmd_competitors() {
  local payload
  payload=$(cat <<JSON
[{
  "target": "${DOMAIN}",
  "location_code": ${LOCATION},
  "language_code": "${LANGUAGE}",
  "limit": ${LIMIT}
}]
JSON
)
  api_post "dataforseo_labs/google/competitors_domain/live" "$payload" "${OUTDIR}/competitors.json"
}

cmd_related_keywords() {
  [[ -n "$KEYWORD" ]] || die "related-keywords requires --keyword"

  # Sanitize keyword for filename: lowercase, spaces to underscores, strip non-alnum
  local slug
  slug=$(echo "$KEYWORD" | tr '[:upper:]' '[:lower:]' | tr ' ' '_' | tr -cd '[:alnum:]_')

  local payload
  payload=$(cat <<JSON
[{
  "keyword": "${KEYWORD}",
  "location_code": ${LOCATION},
  "language_code": "${LANGUAGE}",
  "limit": ${LIMIT}
}]
JSON
)
  api_post "dataforseo_labs/google/related_keywords/live" "$payload" "${OUTDIR}/related_${slug}.json"
}

cmd_serp_local() {
  [[ -n "$KEYWORD" ]] || die "serp-local requires --keyword"

  local slug
  slug=$(echo "$KEYWORD" | tr '[:upper:]' '[:lower:]' | tr ' ' '_' | tr -cd '[:alnum:]_')

  local payload
  payload=$(cat <<JSON
[{
  "keyword": "${KEYWORD}",
  "location_code": ${LOCATION},
  "language_code": "${LANGUAGE}",
  "device": "desktop",
  "os": "windows"
}]
JSON
)
  api_post "serp/google/organic/live/advanced" "$payload" "${OUTDIR}/serp_${slug}.json"
}

# --- Dispatch ---

case "$COMMAND" in
  ranked-keywords)   cmd_ranked_keywords ;;
  competitors)       cmd_competitors ;;
  related-keywords)  cmd_related_keywords ;;
  serp-local)        cmd_serp_local ;;
  *) die "Unknown command: $COMMAND. Run without arguments for usage." ;;
esac
