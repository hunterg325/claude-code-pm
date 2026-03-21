#!/bin/bash
# stdout Notification Adapter (default fallback)

set -euo pipefail

SEVERITY="$1"
TITLE="$2"
BODY="${3:-}"

# Format with severity prefix
case "$SEVERITY" in
    critical) PREFIX="[!!!]" ;;
    warning)  PREFIX="[!!]" ;;
    info)     PREFIX="[i]" ;;
    *)        PREFIX="[?]" ;;
esac

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " $PREFIX PM NOTIFICATION: $TITLE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ -n "$BODY" ]]; then
    echo " $BODY"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi
echo ""
