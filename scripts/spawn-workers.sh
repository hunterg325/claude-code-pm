#!/bin/bash
# Claude Code PM — Spawn Worker Sessions
# Opens N interactive Claude Code sessions in visible Terminal.app tabs.
#
# Usage: spawn-workers.sh <target_repo_path> [count]
#   target_repo_path: absolute path to the target repository
#   count: number of workers to spawn (default: 5)

set -euo pipefail

TARGET_REPO="${1:?Usage: spawn-workers.sh <target_repo_path> [count]}"
COUNT="${2:-5}"

if [[ ! -d "$TARGET_REPO/.git" ]]; then
    echo "[spawn-workers] Error: $TARGET_REPO is not a git repository" >&2
    exit 1
fi

echo ""
echo "Claude Code PM — Spawning $COUNT worker sessions"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Target repo: $TARGET_REPO"
echo ""

for i in $(seq 1 "$COUNT"); do
    TAB_TITLE="PM Worker $i"

    osascript <<EOF
tell application "Terminal"
    activate
    if (count of windows) = 0 then
        do script "cd '$TARGET_REPO' && echo '=== PM Worker $i ===' && claude --dangerously-skip-permissions --dangerously-load-development-channels server:claude-peers"
    else
        tell front window
            set newTab to do script "cd '$TARGET_REPO' && echo '=== PM Worker $i ===' && claude --dangerously-skip-permissions --dangerously-load-development-channels server:claude-peers"
        end tell
    end if
    set custom title of selected tab of front window to "$TAB_TITLE"
end tell
EOF

    echo "  [OK] Worker $i tab opened"
    sleep 1
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  $COUNT workers spawned in Terminal.app tabs"
echo "  Workers are idle — PM will assign tasks via claude-peers"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
