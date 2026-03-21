# Claude Code PM

Autonomous Project Manager plugin for Claude Code. Orchestrates parallel worker sessions to execute Linear tasks through a structured lifecycle: **fetch → spawn → monitor → verify → review → merge**.

## What It Does

Claude Code PM turns a persistent Claude Code session into an autonomous project manager that:

- Fetches prioritized tasks from your Linear project
- Spawns up to 5 parallel worker sessions, each in an isolated git worktree
- Distributes work with context-aware prompts built from your design docs
- Answers worker questions and handles failures
- Delegates verification to a dedicated Verification Officer (VO) agent
- Creates PRs, monitors CI, and iterates on review comments
- Notifies you when human judgment is needed

You observe from an architectural perspective and merge PRs.

## Prerequisites

- [Claude Code CLI](https://docs.claude.ai/cli) with `claude-peers` channels support
- [claude-peers](https://github.com/anthropics/claude-peers) broker running on localhost:7899
- [Linear MCP](https://docs.claude.ai/integrations/linear) configured in Claude Code
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated

## Installation

```bash
# From plugin registry (once published)
claude plugin add claude-code-pm

# Or from source
git clone https://github.com/huntergemmer/claude-code-pm
claude plugin add ./claude-code-pm
```

## Quick Start

```bash
# 1. Run setup to create config
bash ./scripts/setup.sh

# 2. Edit config with your Linear project
$EDITOR .claude/pm-config.yaml

# 3. Start the PM
/pm:start
```

## Commands

| Command | Description |
|---------|-------------|
| `/pm:start` | Launch the orchestration loop (runs pre-flight checks first) |
| `/pm:status` | Show active workers, task queue, VO status, and health |
| `/pm:stop` | Gracefully shut down workers and save state |

## Configuration

Create `.claude/pm-config.yaml` in your project (see `templates/pm-config.example.yaml`):

```yaml
linear:
  project: "My Project"        # Required: your Linear project name

workers:
  max_concurrent: 5            # Max parallel worker sessions
  timeout_minutes: 45          # Alert if worker goes silent

verification:
  max_review_loops: 3          # Max VO ↔ Worker iterations
  max_ci_retries: 3            # Max CI failures before escalation

notification:
  provider: stdout             # discord | slack | stdout | custom
```

## Architecture

```
PM Session ──► claude-peers broker ◄── Worker 1 (worktree)
    │                  ▲               Worker 2 (worktree)
    │                  │               Worker 3 (worktree)
    │                  └────────────── VO Agent
    │
    ├── Linear MCP (tasks)
    └── Notification Provider (alerts)
```

The PM fetches tasks from Linear, spawns workers in isolated worktrees, monitors them via claude-peers messaging, and delegates all post-completion verification to the VO agent. See `PM-ORCHESTRATOR-DESIGN.md` for the full system design.

## Notification Providers

| Provider | Setup |
|----------|-------|
| stdout | Default — prints to PM terminal |
| Discord | Set `DISCORD_WEBHOOK_URL` env var |
| Slack | Set `SLACK_WEBHOOK_URL` env var |
| Custom | Set `notification.script` in config |

## Worker Prompt Templates

Place templates in `.claude/worker-prompt-templates/` matching your Linear labels:
- `backend.md` → tasks labeled "backend"
- `frontend.md` → tasks labeled "frontend"
- `default.md` → fallback for unlabeled tasks

Templates use `{{task_id}}`, `{{task_title}}`, `{{task_description}}`, `{{acceptance_criteria}}` placeholders.

## License

MIT
