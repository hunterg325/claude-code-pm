---
description: "Launch the PM orchestration loop. Use when: user runs /pm:start, wants to start autonomous task execution from Linear, or says 'start the PM'."
argument-hint: "[--dry-run]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
  - mcp__claude-peers__list_peers
  - mcp__claude-peers__send_message
  - mcp__claude-peers__set_summary
  # check_messages only needed for crash recovery on startup
  - mcp__claude-peers__check_messages
  - mcp__claude_ai_Linear__list_issues
  - mcp__claude_ai_Linear__save_issue
  - mcp__claude_ai_Linear__save_comment
  - mcp__claude_ai_Linear__list_issue_statuses
  - mcp__claude_ai_Linear__get_issue
  - mcp__claude_ai_Linear__list_projects
  - Agent
---

# /pm:start — Launch PM Orchestration

## Pre-flight Checks

Run these checks before starting. Surface clear errors for any failures:

1. **claude-peers broker**: Call `list_peers` — if it fails, tell user to start the claude-peers broker (`cd ~/claude-peers && bun run src/index.ts`)
2. **Linear MCP**: Call `list_issues` with a limit of 1 — if it fails, tell user to configure Linear MCP and link to https://docs.claude.ai/integrations/linear
3. **gh CLI**: Run `gh auth status` — if it fails, tell user to run `gh auth login`
4. **pm-config.yaml**: Read `.claude/pm-config.yaml` — if missing, offer to create it from `${CLAUDE_PLUGIN_ROOT}/templates/pm-config.example.yaml`
5. **target_repo**: Validate that `target_repo` is set in pm-config.yaml and the path exists and is a git repo

If any check fails, stop and report all failures at once. Do not proceed.

## Startup Sequence

1. Read `.claude/pm-config.yaml` and validate required fields (`target_repo`, `linear.project`)
2. Set your peer summary via `set_summary`: "PM Orchestrator — managing {project_name}"
3. Check for `.claude/pm-state.json` — if exists, enter crash recovery mode:
   - Reconcile against `list_peers`, `git worktree list`, Linear statuses
   - Report recovered state to user
4. If `--dry-run` argument provided: fetch tasks, show what would be assigned, then stop

## Spawn Worker Pool

The PM does NOT spawn workers itself. Workers are interactive Claude Code sessions
running in visible Terminal.app tabs so the user can observe them.

Run the spawn script:
```
bash ${CLAUDE_PLUGIN_ROOT}/scripts/spawn-workers.sh "{target_repo}" {max_concurrent}
```

This opens `max_concurrent` Terminal tabs, each running:
```
cd {target_repo} && claude --dangerously-skip-permissions --dangerously-load-development-channels server:claude-peers
```

Workers start idle and wait for task assignments via claude-peers messages.
After spawning, wait ~15 seconds for workers to register, then verify with `list_peers`.

## Enter Orchestration Loop

Load and follow the PM system prompt at `${CLAUDE_PLUGIN_ROOT}/templates/pm-system-prompt.md`.

The PM assigns tasks to workers by sending `task_assignment` messages via claude-peers.
Workers are already running in the target repo — the PM just routes work to them.

Orchestration loop: fetch tasks → pick unblocked → send assignment to idle worker → monitor messages → on completion delegate to VO → repeat.

The PM session should run continuously until stopped with /pm:stop or interrupted.
