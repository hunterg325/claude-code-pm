#!/usr/bin/env bash
# =============================================================================
# telegram-notify.sh — PM escalation notifications via Telegram (US-7.1)
#
# Usage:
#   ./scripts/telegram-notify.sh <trigger> <task_id> <worker_peer_id> <description> [context]
#
# Arguments:
#   trigger        One of: unanswerable_question | ci_fail_3x | worker_stuck | arch_decision
#   task_id        Linear task ID, e.g. AGE-55
#   worker_peer_id Peer ID of the blocked worker session, e.g. worker-abc123
#   description    Short description of the issue (will be escaped for Markdown)
#   context        Optional extra context — trade-offs, options, relevant file paths, etc.
#
# Environment (set in .env or export before calling):
#   TELEGRAM_BOT_TOKEN   Bot token from @BotFather
#   TELEGRAM_CHAT_ID     Your personal or group chat ID
#
# Examples:
#   ./scripts/telegram-notify.sh unanswerable_question AGE-55 worker-abc123 \
#     "Worker cannot determine correct DB migration strategy" \
#     "See docs/schema-v2.md — two conflicting approaches on line 42 and 87"
#
#   ./scripts/telegram-notify.sh ci_fail_3x AGE-56 worker-def456 \
#     "TypeScript build fails: cannot find module './generated/types'" ""
#
#   ./scripts/telegram-notify.sh worker_stuck AGE-57 worker-ghi789 \
#     "Worker has been idle for 47 minutes" "Last log: waiting for test runner"
#
#   ./scripts/telegram-notify.sh arch_decision AGE-58 worker-jkl012 \
#     "Need decision: REST vs GraphQL for new public API" \
#     "Option A: REST — simpler, existing tooling. Option B: GraphQL — flexible, more setup."
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Load .env if present (non-fatal — env vars may already be exported)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

# ---------------------------------------------------------------------------
# Validate required env vars
# ---------------------------------------------------------------------------
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  echo "ERROR: TELEGRAM_BOT_TOKEN is not set. See .env.example." >&2
  exit 1
fi
if [[ -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "ERROR: TELEGRAM_CHAT_ID is not set. See .env.example." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
if [[ $# -lt 4 ]]; then
  echo "Usage: $0 <trigger> <task_id> <worker_peer_id> <description> [context]" >&2
  exit 1
fi

TRIGGER="$1"
TASK_ID="$2"
WORKER_PEER_ID="$3"
DESCRIPTION="$4"
CONTEXT="${5:-}"

# ---------------------------------------------------------------------------
# escape_md: escape special Markdown v1 characters so Telegram doesn't choke
# Telegram Markdown v1 special chars: _ * [ ] ( ) ~ ` > # + - = | { } . !
# We escape the minimal set that breaks inline formatting: _ * ` [
# ---------------------------------------------------------------------------
escape_md() {
  local s="$1"
  # Escape backslash first, then the Markdown-special chars
  s="${s//\\/\\\\}"
  s="${s//_/\\_}"
  s="${s//\*/\\*}"
  s="${s//\`/\\\`}"
  s="${s//\[/\\[}"
  echo "$s"
}

# ---------------------------------------------------------------------------
# Map trigger → human-readable label + emoji
# ---------------------------------------------------------------------------
case "$TRIGGER" in
  unanswerable_question)
    TRIGGER_LABEL="❓ Unanswerable Question"
    ;;
  ci_fail_3x)
    TRIGGER_LABEL="🔴 CI Failed 3× Same Issue"
    ;;
  worker_stuck)
    TRIGGER_LABEL="⏱ Worker Stuck >45 min"
    ;;
  arch_decision)
    TRIGGER_LABEL="🏗 Architectural Decision Needed"
    ;;
  *)
    TRIGGER_LABEL="⚠️ Escalation: $(escape_md "$TRIGGER")"
    ;;
esac

# ---------------------------------------------------------------------------
# Build message
# ---------------------------------------------------------------------------
ESCAPED_TASK="$(escape_md "$TASK_ID")"
ESCAPED_WORKER="$(escape_md "$WORKER_PEER_ID")"
ESCAPED_DESC="$(escape_md "$DESCRIPTION")"
ESCAPED_CTX="$(escape_md "$CONTEXT")"

TIMESTAMP="$(date -u '+%Y-%m-%d %H:%M UTC')"

MESSAGE="*PM Escalation — ${TRIGGER_LABEL}*

*Task:* \`${ESCAPED_TASK}\`
*Worker:* \`${ESCAPED_WORKER}\`
*Time:* ${TIMESTAMP}

*Issue:*
${ESCAPED_DESC}"

if [[ -n "$CONTEXT" ]]; then
  MESSAGE="${MESSAGE}

*Context:*
${ESCAPED_CTX}"
fi

MESSAGE="${MESSAGE}

_Reply in the PM terminal session to unblock._"

# ---------------------------------------------------------------------------
# Send via Telegram Bot API
# ---------------------------------------------------------------------------
RESPONSE="$(curl -s -X POST \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_CHAT_ID}" \
  -d "parse_mode=Markdown" \
  --data-urlencode "text=${MESSAGE}")"

# Check for Telegram API error
OK="$(echo "$RESPONSE" | grep -o '"ok":[a-z]*' | cut -d: -f2 || true)"
if [[ "$OK" != "true" ]]; then
  echo "ERROR: Telegram API returned an error:" >&2
  echo "$RESPONSE" >&2
  exit 1
fi

echo "Notification sent: [${TRIGGER}] ${TASK_ID} / ${WORKER_PEER_ID}"
