#!/bin/bash
# Claude Code PM — First-Time Setup
# Guides users through initial configuration.
# Usage: setup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

echo ""
echo "Claude Code PM — Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Create .claude directory if needed
mkdir -p .claude

# Copy config template if missing
if [[ ! -f .claude/pm-config.yaml ]]; then
    echo "Creating .claude/pm-config.yaml from template..."
    cp "$PLUGIN_ROOT/templates/pm-config.example.yaml" .claude/pm-config.yaml
    echo "  → Created. Edit .claude/pm-config.yaml with your Linear project name and settings."
else
    echo "  [OK] .claude/pm-config.yaml already exists"
fi

echo ""
echo "Next steps:"
echo "  1. Edit .claude/pm-config.yaml — set your Linear project name"
echo "  2. Ensure claude-peers broker is running (cd ~/claude-peers && bun run src/index.ts)"
echo "  3. Ensure Linear MCP is configured in Claude Code"
echo "  4. Run /pm:start to launch the orchestration loop"
echo ""
