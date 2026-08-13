#!/usr/bin/env bash
# End-to-end smoke driver. Brings up the docker-compose stack (if not already
# running), runs the Python smoke checks, prints the markdown summary.
#
# Usage:
#   bash scripts/smoke_e2e.sh           # auth disabled (default)
#   HOPE_API_AUTH=enabled bash scripts/smoke_e2e.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # hope-dashboard/
cd "$ROOT"
mkdir -p outputs

AUTH_MODE="${HOPE_API_AUTH:-disabled}"
SECRET="${HOPE_API_SECRET:-dev-secret}"
COMMENT_URL="${COMMENT_GEN_URL:-http://localhost:8001}"
DROPOUT_URL="${DROPOUT_API_URL:-http://localhost:8000}"

if [ -n "${SKIP_COMPOSE:-}" ]; then
    echo "skipping docker compose up (SKIP_COMPOSE set)"
else
    echo "ensuring docker compose stack is up..."
    docker compose up -d risk-api comment-api >/dev/null
fi

echo "running smoke checks against $COMMENT_URL and $DROPOUT_URL (auth=$AUTH_MODE)"
python3 scripts/smoke_e2e.py \
    --comment-url "$COMMENT_URL" \
    --dropout-url "$DROPOUT_URL" \
    --secret "$SECRET" \
    --auth-mode "$AUTH_MODE" \
    --out "outputs/smoke_summary.md"

EXIT=$?
echo
echo "smoke summary written to outputs/smoke_summary.md"
exit $EXIT
