# Claude Code PM

Autonomous Project Manager plugin for Claude Code. Orchestrates parallel worker sessions to execute Linear tasks through a structured lifecycle: **fetch → assign → implement → verify → review → merge**.

## What It Does

Claude Code PM turns a persistent Claude Code session into an autonomous project manager that:

- Fetches prioritized tasks from your Linear project
- Opens up to 5 interactive worker sessions in visible Terminal tabs
- Assigns work via `claude-peers` messaging with context-aware prompts
- Monitors workers, answers questions, and handles failures
- Delegates verification to a dedicated Verification Officer (VO) agent
- Creates PRs, monitors CI, iterates on review feedback, and signals merge-readiness
- Notifies you when human judgment is needed

You observe from an architectural perspective and merge PRs.

## Prerequisites

- [Claude Code CLI](https://docs.claude.ai/cli) with channels support (`--dangerously-load-development-channels`)
- [claude-peers](https://github.com/anthropics/claude-peers) broker running on localhost:7899
- [Linear MCP](https://docs.claude.ai/integrations/linear) configured in Claude Code
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated
- macOS with Terminal.app (for worker tab spawning)

## Installation

```bash
# From source
git clone https://github.com/huntergemmer/claude-code-pm
claude plugin add ./claude-code-pm
```

## Quick Start

```bash
# 1. Run setup to create config
bash ./scripts/setup.sh

# 2. Edit config — set target_repo and Linear project
$EDITOR .claude/pm-config.yaml

# 3. Start the PM (spawns worker tabs, runs pre-flight checks, enters orchestration loop)
/pm:start
```

## How It Works

```
┌─────────────┐     claude-peers      ┌──────────────────────┐
│  PM Session  │◄────── broker ──────►│  Worker 1 (Tab)      │
│  (your tab)  │         ▲            │  Worker 2 (Tab)      │
│              │         │            │  Worker 3 (Tab)      │
│              │         │            │  Worker 4 (Tab)      │
│              │         │            │  Worker 5 (Tab)      │
│              │         └───────────►│  VO Agent (subagent) │
│              │                      └──────────────────────┘
│  Linear MCP  │   All sessions run in target_repo
│  Notify.sh   │   Workers are visible Terminal tabs
└─────────────┘
```

1. **`/pm:start`** runs pre-flight checks, then opens N Terminal tabs with idle Claude Code sessions in your target repo
2. PM fetches "Todo" tasks from Linear, sorted by priority
3. PM assigns the highest-priority unblocked task to an idle worker via `claude-peers`
4. Worker creates a branch, implements the task, runs verification commands, reports back
5. PM delegates to the **Verification Officer** — a subagent that reviews the diff, creates a PR, monitors CI
6. If CI fails or review comments arrive, VO relays them back to the worker for fixes
7. Once approved, PM notifies you to merge. After merge, PM updates Linear → "Done"
8. Repeat

## Commands

| Command | Description |
|---------|-------------|
| `/pm:start` | Run pre-flight checks, spawn worker pool, enter orchestration loop |
| `/pm:start --dry-run` | Fetch tasks and show what would be assigned without starting |
| `/pm:status` | Show active workers, task queue, VO status, and health |
| `/pm:stop` | Gracefully notify workers and save state |

## Configuration

Create `.claude/pm-config.yaml` in the PM plugin directory (see `templates/pm-config.example.yaml`):

```yaml
# Required
target_repo: "/absolute/path/to/your/project"

linear:
  project: "My Project"
  team: "My Team"
  status_map:
    ready: "Todo"
    in_progress: "In Progress"
    in_review: "In Review"
    done: "Done"

# Optional (shown with defaults)
workers:
  max_concurrent: 5
  timeout_minutes: 45

verification:
  max_review_loops: 3
  max_ci_retries: 3
  auto_approve_self_check: false

notification:
  provider: stdout           # discord | slack | stdout | custom

git:
  base_branch: main
  branch_prefix: "task/"
  branch_format: "{prefix}{task_id}-{slug}"
```

### Project Docs

Inject architecture context into worker prompts:

```yaml
project_docs:
  - path: "DESIGN.md"
    description: "System architecture"
  - path: "ADR/"
    description: "Architecture Decision Records"
```

### Worker Templates

Map Linear labels to verification commands:

```yaml
worker_templates:
  backend:
    verify: ["npm test", "npm run lint", "npm run build"]
  frontend:
    verify: ["npm test", "npm run lint"]
```

Place custom prompt templates in `.claude/worker-prompt-templates/{label}.md` for label-specific instructions. Falls back to `default.md`.

## Notification Providers

| Provider | Setup |
|----------|-------|
| stdout | Default — prints to PM terminal |
| Discord | Set `DISCORD_WEBHOOK_URL` env var |
| Slack | Set `SLACK_WEBHOOK_URL` env var |
| Custom | Point `notification.script` to your own script |

## Plugin Structure

```
claude-code-pm/
├── .claude-plugin/plugin.json      # Plugin manifest
├── agents/
│   └── verification-officer.md     # VO agent definition
├── skills/
│   ├── pm-start/SKILL.md           # /pm:start
│   ├── pm-status/SKILL.md          # /pm:status
│   └── pm-stop/SKILL.md            # /pm:stop
├── templates/
│   ├── pm-system-prompt.md         # PM behavioral contract
│   ├── worker-system-prompt.md     # Worker behavioral contract
│   ├── vo-system-prompt.md         # VO behavioral contract
│   ├── pm-protocol.md              # Message types reference
│   ├── pm-config.example.yaml      # Config template
│   ├── pm-state.schema.json        # State file schema
│   └── worker-prompt-templates/
│       └── default.md              # Default worker template
├── providers/
│   ├── notify.sh                   # Notification dispatcher
│   ├── discord.sh                  # Discord adapter
│   ├── slack.sh                    # Slack adapter
│   └── stdout.sh                   # Terminal fallback
└── scripts/
    ├── spawn-workers.sh            # Opens worker Terminal tabs
    ├── setup.sh                    # First-time config setup
    └── health-check.sh             # Verify prerequisites
```

## License

MIT
