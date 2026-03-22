#!/bin/bash
# PM Notification Dispatcher
# Usage: notify.sh <severity> <title> <body>
# severity: info | warning | critical

set -euo pipefail

SEVERITY="${1:?Usage: notify.sh <severity> <title> <body>}"
TITLE="${2:?Usage: notify.sh <severity> <title> <body>}"
BODY="${3:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE=".claude/pm-config.yaml"

# Parse provider from config (simple grep-based, no yq dependency)
if [[ -f "$CONFIG_FILE" ]]; then
    PROVIDER=$(grep -A1 'notification:' "$CONFIG_FILE" | grep 'provider:' | awk '{print $2}' | tr -d '"' || echo "stdout")
    CUSTOM_SCRIPT=$(grep -A3 'notification:' "$CONFIG_FILE" | grep 'script:' | awk '{print $2}' | tr -d '"' || echo "")
else
    PROVIDER="stdout"
fi

# Route to provider
case "${PROVIDER:-stdout}" in
    discord)
        "$SCRIPT_DIR/discord.sh" "$SEVERITY" "$TITLE" "$BODY"
        ;;
    slack)
        "$SCRIPT_DIR/slack.sh" "$SEVERITY" "$TITLE" "$BODY"
        ;;
    custom)
        if [[ -n "$CUSTOM_SCRIPT" && -x "$CUSTOM_SCRIPT" ]]; then
            "$CUSTOM_SCRIPT" "$SEVERITY" "$TITLE" "$BODY"
        else
            echo "[notify] Custom script not found or not executable: $CUSTOM_SCRIPT" >&2
            "$SCRIPT_DIR/stdout.sh" "$SEVERITY" "$TITLE" "$BODY"
        fi
        ;;
    stdout|*)
        "$SCRIPT_DIR/stdout.sh" "$SEVERITY" "$TITLE" "$BODY"
        ;;
esac
