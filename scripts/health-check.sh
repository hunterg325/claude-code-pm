#!/bin/bash
# Claude Code PM — Health Check
# Verifies all prerequisites are operational.
# Usage: health-check.sh [--verbose]

set -euo pipefail

VERBOSE="${1:-}"
PASS=0
FAIL=0

check() {
    local name="$1"
    local cmd="$2"
    local hint="$3"

    if eval "$cmd" > /dev/null 2>&1; then
        echo "  [OK] $name"
        ((PASS++))
    else
        echo "  [FAIL] $name"
        echo "         → $hint"
        ((FAIL++))
    fi
}

echo ""
echo "Claude Code PM — Health Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "Prerequisites:"
check "gh CLI installed" "command -v gh" "Install: https://cli.github.com/"
check "gh CLI authenticated" "gh auth status" "Run: gh auth login"
check "claude CLI installed" "command -v claude" "Install Claude Code CLI"
check "git available" "command -v git" "Install git"

echo ""
echo "Configuration:"
check "pm-config.yaml exists" "test -f .claude/pm-config.yaml" "Copy from: \${CLAUDE_PLUGIN_ROOT}/templates/pm-config.example.yaml → .claude/pm-config.yaml"
check "Linear project configured" "grep -q 'project:' .claude/pm-config.yaml 2>/dev/null" "Set linear.project in .claude/pm-config.yaml"

echo ""
echo "Services:"
check "claude-peers broker" "curl -sf http://localhost:7899/health > /dev/null 2>&1 || curl -sf http://localhost:7899/ > /dev/null 2>&1" "Start broker: cd ~/claude-peers && bun run src/index.ts"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ $FAIL -gt 0 ]]; then
    exit 1
fi
