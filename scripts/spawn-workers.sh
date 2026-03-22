#!/bin/bash
# Claude Code PM — Spawn Worker Sessions
# Opens N interactive Claude Code sessions in visible terminal tabs.
# Supports Ghostty and Terminal.app (auto-detected via TERM_PROGRAM).
#
# Usage: spawn-workers.sh <target_repo_path> [count]
#   target_repo_path: absolute path to the target repository
#   count: number of workers to spawn (default: 5)

set -euo pipefail

TARGET_REPO="${1:?Usage: spawn-workers.sh <target_repo_path> [count]}"
COUNT="${2:-5}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -d "$TARGET_REPO/.git" ]]; then
    echo "[spawn-workers] Error: $TARGET_REPO is not a git repository" >&2
    exit 1
fi

# Detect which terminal emulator is running
detect_terminal() {
    if [[ "${TERM_PROGRAM:-}" == "ghostty" ]]; then
        echo "ghostty"
    elif [[ "${TERM_PROGRAM:-}" == "Apple_Terminal" ]]; then
        echo "terminal"
    elif pgrep -qx "ghostty"; then
        echo "ghostty"
    else
        echo "terminal"
    fi
}

TERMINAL="$(detect_terminal)"

# Create a temporary launcher script that each tab executes.
# This avoids embedding complex shell commands in AppleScript strings.
create_launcher() {
    local worker_num="$1"
    local launcher="/tmp/pm-worker-${worker_num}-$$.sh"
    cat > "$launcher" <<'SCRIPT'
#!/bin/bash
cd "$1"
echo "=== DEV $2 ==="
# Re-set tab title after Claude initializes (it overrides the title on startup).
# This background process writes to the tab's tty, not expect's pty.
(sleep 10 && printf '\033]1;DEV %s\007' "$2" && printf '\033]2;DEV %s\007' "$2") &
# Use expect to auto-accept the dev channels confirmation prompt.
# The TUI reads raw keypresses from the tty, so piping won't work.
# We wait 3 seconds for the prompt to render, then send Enter.
expect -c "
    spawn claude --dangerously-skip-permissions --dangerously-load-development-channels server:claude-peers
    sleep 3
    send \"\r\"
    interact
"
SCRIPT
    chmod +x "$launcher"
    echo "$launcher"
}

spawn_in_ghostty() {
    local worker_num="$1"
    local launcher
    launcher="$(create_launcher "$worker_num")"

    osascript <<EOF
tell application "Ghostty"
    activate
end tell
delay 0.3
tell application "System Events"
    tell process "Ghostty"
        keystroke "t" using command down
        delay 0.5
        keystroke "$launcher $TARGET_REPO $worker_num"
        keystroke return
    end tell
end tell
EOF
}

spawn_in_terminal() {
    local worker_num="$1"
    local tab_title="DEV $worker_num"
    local launcher
    launcher="$(create_launcher "$worker_num")"

    osascript <<EOF
tell application "Terminal"
    activate
    if (count of windows) = 0 then
        do script "$launcher $TARGET_REPO $worker_num"
    else
        tell front window
            set newTab to do script "$launcher $TARGET_REPO $worker_num"
        end tell
    end if
    set custom title of selected tab of front window to "$tab_title"
end tell
EOF
}

echo ""
echo "Claude Code PM — Spawning $COUNT worker sessions"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Target repo: $TARGET_REPO"
echo "  Terminal:    $TERMINAL"
echo ""

for i in $(seq 1 "$COUNT"); do
    if [[ "$TERMINAL" == "ghostty" ]]; then
        spawn_in_ghostty "$i"
    else
        spawn_in_terminal "$i"
    fi

    echo "  [OK] Worker $i tab opened"
    sleep 1
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  $COUNT workers spawned in $TERMINAL tabs"
echo "  Workers are idle — PM will assign tasks via claude-peers"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
