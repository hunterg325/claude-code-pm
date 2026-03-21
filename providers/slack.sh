#!/bin/bash
# Slack Notification Adapter
# Requires: SLACK_WEBHOOK_URL environment variable

set -euo pipefail

SEVERITY="$1"
TITLE="$2"
BODY="${3:-}"

WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"

if [[ -z "$WEBHOOK_URL" ]]; then
    echo "[slack] SLACK_WEBHOOK_URL not set, falling back to stdout" >&2
    "$(dirname "$0")/stdout.sh" "$SEVERITY" "$TITLE" "$BODY"
    exit 0
fi

# Emoji by severity
case "$SEVERITY" in
    critical) EMOJI=":rotating_light:" ;;
    warning)  EMOJI=":warning:" ;;
    info)     EMOJI=":information_source:" ;;
    *)        EMOJI=":speech_balloon:" ;;
esac

# Build Slack Block Kit payload
PAYLOAD=$(cat <<EOF
{
  "blocks": [
    {
      "type": "header",
      "text": {"type": "plain_text", "text": "$EMOJI [$SEVERITY] $TITLE"}
    },
    {
      "type": "section",
      "text": {"type": "mrkdwn", "text": "$BODY"}
    },
    {
      "type": "context",
      "elements": [{"type": "mrkdwn", "text": "Claude Code PM"}]
    }
  ]
}
EOF
)

if ! curl -sf -H "Content-Type: application/json" -d "$PAYLOAD" "$WEBHOOK_URL" > /dev/null 2>&1; then
    echo "[slack] Failed to send notification, falling back to stdout" >&2
    "$(dirname "$0")/stdout.sh" "$SEVERITY" "$TITLE" "$BODY"
fi
