---
description: "Show PM orchestration status. Use when: user runs /pm:status, asks 'what's the PM doing', 'show workers', 'task queue status', or wants to see active workers and task queue."
allowed-tools:
  - Read
  - Bash
  - mcp__claude-peers__list_peers
---

# /pm:status — Show PM Status

Read `.claude/pm-state.json` and reconcile with live `list_peers` data. Display:

## Output Format

### Active Workers
| Task | Worker | Branch | Status | Duration |
|------|--------|--------|--------|----------|
For each entry in active_workers, show task_id, peer_id, branch, status, and time since spawned_at.

### Verification Officers
| Task | VO | Status | PR | Review Loops |
|------|-----|--------|-----|-------------|
For each entry in vo_agents, show task_id, vo_peer_id, status, pr_url, review_loop_count.

### Queued Tasks
Numbered list of queued_tasks with task_id, title, priority.

### Recently Completed
Last 5 entries from completed_tasks with task_id, pr_url, completed_at.

### Escalations
Any unresolved escalations with task_id, type, message, timestamp.

### Health
- PM peer ID and uptime
- Workers: {active}/{max_concurrent} slots used
- Broker: connected/disconnected (based on list_peers success)

If pm-state.json doesn't exist, report "PM is not running. Use /pm:start to launch."
