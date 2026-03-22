---
description: "Stop the PM orchestration loop and optionally shut down workers. Use when: user runs /pm:stop, wants to 'stop the PM', 'shut down workers', or 'halt orchestration'."
allowed-tools:
  - Read
  - Write
  - Bash
  - mcp__claude-peers__send_message
  - mcp__claude-peers__list_peers
---

# /pm:stop — Graceful Shutdown

## Shutdown Sequence

1. Read `.claude/pm-state.json` for active state
2. For each active worker:
   - Send `abort` message via claude-peers: `{ "type": "abort", "task_id": "{id}", "reason": "PM shutting down" }`
   - Log the abort
3. For each active VO agent:
   - Send abort message
4. Wait up to 30 seconds for workers to acknowledge (check_messages)
5. Update pm-state.json:
   - Move active workers to a `shutdown_pending` state
   - Record shutdown timestamp
6. Report summary:
   - Workers notified: N
   - Workers acknowledged: N
   - Tasks that were in progress (may need re-queue on next /pm:start)

## Optional Cleanup

Ask user: "Would you like to clean up orphaned worktrees? This removes worktrees for tasks that haven't been merged."

If yes:
- Run `git worktree list`
- Cross-reference with merged branches
- Remove unmerged worktrees with confirmation for each
