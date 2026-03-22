#!/bin/bash
# Discord Notification Adapter
# Requires: DISCORD_WEBHOOK_URL environment variable

set -euo pipefail

SEVERITY="$1"
TITLE="$2"
BODY="${3:-}"

WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-}"

if [[ -z "$WEBHOOK_URL" ]]; then
    echo "[discord] DISCORD_WEBHOOK_URL not set, falling back to stdout" >&2
    "$(dirname "$0")/stdout.sh" "$SEVERITY" "$TITLE" "$BODY"
    exit 0
fi

# Color by severity
case "$SEVERITY" in
    critical) COLOR=15158332 ;;  # Red
    warning)  COLOR=16776960 ;;  # Yellow
    info)     COLOR=3447003 ;;   # Blue
    *)        COLOR=8421504 ;;   # Gray
esac

# Build Discord embed payload
PAYLOAD=$(cat <<EOF
{
  "embeds": [{
    "title": "[$SEVERITY] $TITLE",
    "description": "$BODY",
    "color": $COLOR,
    "footer": {"text": "Claude Code PM"}
  }]
}
EOF
)

if ! curl -sf -H "Content-Type: application/json" -d "$PAYLOAD" "$WEBHOOK_URL" > /dev/null 2>&1; then
    echo "[discord] Failed to send notification, falling back to stdout" >&2
    "$(dirname "$0")/stdout.sh" "$SEVERITY" "$TITLE" "$BODY"
fi
