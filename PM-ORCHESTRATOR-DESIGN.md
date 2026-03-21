# System Design: Claude Code PM — Autonomous Project Manager Plugin

**Version:** 2.0
**Date:** 2026-03-21
**Author:** Hunter
**Status:** Draft
**License:** MIT (open-source)

---

## 1. Problem Statement

Complex software projects span multiple services, languages, and phases. Building them serially in a single Claude Code session is slow — each task blocks the next, context windows fill up, and the human becomes the bottleneck for task routing and review.

**Claude Code PM** is a Claude Code plugin that turns a persistent session into an **autonomous project manager**. It fetches tasks from Linear, spawns up to 5 parallel worker sessions (each in an isolated git worktree), distributes work with context-aware prompts, and answers clarifying questions. When a worker completes, the PM delegates all verification, code review, CI monitoring, and PR shepherding to a dedicated **Verification Officer (VO)** agent. The human observes from an architectural perspective and merges PRs.

This plugin is **project-agnostic**. It knows nothing about your domain — you configure it by pointing it at your Linear project, your repo, and your design docs. It handles the orchestration; your project provides the context.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Developer's Machine                              │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                    claude-peers broker                              │   │
│  │                localhost:7899 + SQLite                              │   │
│  └──┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┘   │
│     │          │          │          │          │          │               │
│ ┌───┴────┐ ┌───┴────┐ ┌───┴────┐ ┌───┴────┐ ┌───┴────┐ ┌───┴──────┐     │
│ │ PM     │ │Worker 1│ │Worker 2│ │Worker 3│ │Worker 4│ │ VO       │     │
│ │Session │ │worktree│ │worktree│ │worktree│ │worktree│ │(Verifier)│     │
│ │        │ │task-101│ │task-102│ │task-103│ │task-104│ │          │     │
│ └───┬────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────┬─────┘     │
│     │                                                        │            │
│     ├── Linear MCP (fetch/update tasks)                      │            │
│     ├── Notification Provider (Discord / Slack / custom)     │            │
│     │                                                        │            │
│     │              PM delegates on task_complete ────────────►│            │
│     │                                                        │            │
│     │                                            ┌───────────┘            │
│     │                                            │                        │
│     │                                            ├── GitHub CLI (PRs, CI) │
│     │                                            ├── Code review          │
│     │                                            └── Worker feedback loop │
│     │                                                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Role | Runtime |
|-----------|------|---------|
| **PM Session** | Persistent Claude Code session. Orchestrates task distribution, worker lifecycle, and Linear sync. Does NOT verify or review code. | `claude --dangerously-skip-permissions --dangerously-load-development-channels server:claude-peers` |
| **Worker Sessions** | Ephemeral Claude Code sessions, one per task. Spawned by PM in isolated worktrees. | `claude --worktree task-{id} --dangerously-skip-permissions --dangerously-load-development-channels server:claude-peers -p "{prompt}"` |
| **Verification Officer (VO)** | Dedicated agent for all post-completion work: diff review, PR creation, CI monitoring, code review, review comment loops, and merge-readiness signaling. Spawned by PM when a worker reports `task_complete`. | Subagent spawned per completed task (see §7) |
| **claude-peers broker** | Localhost daemon on port 7899. Routes messages between PM and workers via SQLite-backed message queue. | Auto-launched by first session. |
| **Linear MCP** | Already connected. PM reads tasks, updates statuses, posts comments. | MCP server (existing) |
| **GitHub CLI** | PM uses `gh` for PR creation, review requests, CI status checks. Workers use it for pushing branches. | System CLI |
| **Notification Provider** | Pluggable interface for escalation alerts. Ships with Discord and Slack adapters. | See §9 |

---

## 3. PM Session — The Orchestration Loop

The PM session runs a continuous **orchestration loop**. It doesn't execute tasks itself — it coordinates workers. The PM's system prompt defines its role, and it uses a combination of Linear MCP tools, `claude-peers` tools, and shell commands to manage the workflow.

### 3.1 PM System Prompt (appended)

The PM session is launched with `--append-system-prompt` containing its orchestration instructions. This is the core behavioral contract:

```
You are the Project Manager — an autonomous Claude Code orchestrator.

YOUR ROLE: You do NOT write code. You orchestrate Claude Code worker sessions
that write code. You fetch tasks from Linear, spawn workers, distribute work,
answer questions, verify outputs, and shepherd PRs to merge.

TOOLS AVAILABLE:
- Linear MCP: fetch tasks (list_issues), update status (save_issue), post comments (save_comment)
- claude-peers: list_peers, send_message, set_summary — for communicating with worker sessions
- Bash: spawn worker sessions, run gh CLI for PRs/reviews, check CI status
- Notification provider: alert the developer when human judgment is needed

PROJECT CONTEXT:
Read your project config at .claude/pm-config.yaml for:
- Which Linear project to pull tasks from
- Which design docs to inject into worker prompts
- Which skills map to which task labels
- Notification provider settings
- Max concurrent workers (default: 5)

ORCHESTRATION LOOP:
1. Fetch unstarted tasks from Linear (status: "Todo", prioritized by label)
2. Check active workers (list_peers) — maintain max concurrent cap
3. For each available slot, pick highest-priority unblocked task
4. Spawn a worker session with task-specific prompt
5. Monitor workers: answer questions, handle failures
6. On task_complete: delegate to Verification Officer (VO) for review, PR, CI
7. VO reports back: PR ready → notify developer for merge, update Linear
8. Repeat

DELEGATION TO VERIFICATION OFFICER:
When a worker reports task_complete, you MUST spawn a VO agent to handle all
post-completion work. You do NOT review code, create PRs, or monitor CI yourself.
The VO is a specialized agent that handles:
- Self-check result validation
- Diff review and code quality assessment
- PR creation and CI monitoring
- Review comment relay back to the worker
- Final merge-readiness determination
Send the VO the task_id, branch name, worker peer_id, and self-check results.

ESCALATION RULES:
- If a worker asks a question you cannot answer from the project docs
  or Linear task description → notify developer and BLOCK the worker
- If CI fails 3 times on the same issue → escalate to developer
- If a worker has been running >45 minutes with no progress → investigate

TASK ASSIGNMENT PROTOCOL:
When assigning a task to a worker, your message MUST include:
1. The Linear task ID and title
2. Full task description and acceptance criteria from Linear
3. Relevant architecture context from project design docs
4. Branch naming convention: task/{linear-id}-{short-description}
5. Verification criteria the worker must self-check before reporting done
```

### 3.2 PM State Machine

```
                    ┌─────────┐
                    │  IDLE   │◄──────────────────────────────┐
                    └────┬────┘                                │
                         │ fetch tasks from Linear             │
                         ▼                                     │
                    ┌─────────┐                                │
                    │ PLANNING│ pick next task, check deps     │
                    └────┬────┘                                │
                         │ slot available                      │
                         ▼                                     │
                    ┌──────────┐                               │
                    │SPAWNING  │ launch worker session          │
                    └────┬─────┘                               │
                         │ worker registered in peers           │
                         ▼                                     │
                    ┌──────────┐  worker asks question          │
                    │MONITORING│◄─────────────────┐            │
                    └──┬───┬───┘                  │            │
                       │   │ worker reports done   │            │
                       │   ▼                      │            │
                       │ ┌───────────────┐         │            │
                       │ │VO_DELEGATED   │ spawn VO│            │
                       │ └────┬──────────┘         │            │
                       │      │ VO reports back     │            │
                       │      ▼                    │            │
                       │ ┌──────────┐  VO rejects  │            │
                       │ │ PR_READY │─────────────►│            │
                       │ └────┬─────┘  (back to worker)        │
                       │      │ VO approves + CI green         │
                       │      ▼                                │
                       │ ┌──────────┐                          │
                       │ │MERGE_WAIT│ notify developer          │
                       │ └────┬─────┘                          │
                       │      │ merged                         │
                       │      ▼                                │
                       │ ┌──────────┐                          │
                       └►│COMPLETED │──────────────────────────┘
                         └──────────┘
                           update Linear → "Done"
```

The PM tracks state per-worker in a local JSON file (`.claude/pm-state.json`) so it survives context compaction.

---

## 4. Worker Session Lifecycle

### 4.1 Spawning

The PM spawns workers using Bash. Each worker gets an isolated worktree and a task-specific prompt:

```bash
# PM spawns a worker for Linear task ENG-101
claude --worktree task-eng-101-short-slug \
  --dangerously-skip-permissions \
  --dangerously-load-development-channels server:claude-peers \
  --allowedTools "Bash,Read,Edit,Write,Glob,Grep" \
  --append-system-prompt "$(cat .claude/worker-system-prompt.md)" \
  -p "$(cat <<'PROMPT'
## Task Assignment: ENG-101

**Title:** {task title from Linear}

**Description:**
{full description from Linear}

**Acceptance Criteria:**
{parsed from Linear task body}

**Architecture Context:**
{relevant sections from project design docs, per pm-config.yaml}

**Branch:** task/eng-101-short-slug
**Verify before reporting done:** {verification commands from worker template}
PROMPT
)" &
```

### 4.2 Worker Communication Protocol

All messages go through `claude-peers` `send_message`. Messages use a simple JSON envelope:

```typescript
// PM → Worker messages
type PMMessage =
  | { type: "task_assignment"; task_id: string; payload: TaskPayload }
  | { type: "clarification_response"; task_id: string; answer: string }
  | { type: "abort"; task_id: string; reason: string }

// VO → Worker messages (sent directly via claude-peers)
type VOToWorkerMessage =
  | { type: "review_feedback"; task_id: string; comments: string[] }
  | { type: "ci_failure"; task_id: string; log_url: string; failure_summary: string }

// Worker → PM messages
type WorkerMessage =
  | { type: "task_started"; task_id: string; peer_id: string }
  | { type: "question"; task_id: string; question: string; blocking: boolean }
  | { type: "progress"; task_id: string; percent: number; summary: string }
  | { type: "task_complete"; task_id: string; branch: string; summary: string; self_check: SelfCheckResult }
  | { type: "task_failed"; task_id: string; error: string; recoverable: boolean }

// VO → PM messages
type VOMessage =
  | { type: "vo_started"; task_id: string; vo_peer_id: string }
  | { type: "vo_rejected"; task_id: string; reason: string; sent_to_worker: boolean }
  | { type: "vo_approved"; task_id: string; pr_url: string; pr_number: number }
  | { type: "vo_escalation"; task_id: string; reason: string }

interface SelfCheckResult {
  tests_pass: boolean;
  lint_pass: boolean;
  build_pass: boolean;
  acceptance_criteria: Record<string, boolean>; // criterion → met?
}
```

### 4.3 Worker Lifecycle

```
  spawn (claude -p)
       │
       ▼
  INITIALIZING ── read project design docs, set_summary via peers
       │
       ▼
  WORKING ◄────── receives clarifications from PM
       │
       ├── needs help → send question to PM → BLOCKED
       │                                        │
       │                PM answers ──────────────┘
       │
       ▼
  SELF-CHECKING ── run tests, lint, build, check acceptance criteria
       │
       ├── fails → fix and retry (max 3 loops)
       │
       ▼
  REPORTING ── send task_complete to PM with self-check results
       │
       ▼
  AWAITING_REVIEW ── VO may send review_feedback → back to WORKING
       │
       ▼
  DONE ── session exits, worktree kept for PR
```

### 4.4 Worker Teardown

After a worker's PR is merged, the PM cleans up:

```bash
# PM runs after merge confirmed
git worktree remove .claude/worktrees/task-{id}-{slug}
git branch -d worktree-task-{id}-{slug}
```

---

## 5. Worker Prompt Templates

The PM uses **worker prompt templates** to compose the prompt each worker receives. Templates are matched by Linear task label — if a task has the label `backend`, the PM looks for `backend.md`. If no match is found, it falls back to `default.md`.

```
.claude/worker-prompt-templates/
├── default.md          # Fallback for any label without a custom template
├── backend.md          # Template for "backend" labeled tasks
├── frontend.md         # Template for "frontend" labeled tasks
└── {custom-label}.md   # Users add templates matching their Linear labels
```

Each template defines: worker identity, tech stack constraints, coding conventions, verification commands, and the JSON reporting protocol. Templates use `{{task_id}}`, `{{task_title}}`, `{{task_description}}`, `{{acceptance_criteria}}` placeholders that the PM fills from the Linear task.

Skills are **not** managed by the PM. Claude Code skills trigger themselves via their own frontmatter descriptions — if a worker's task context matches a skill's trigger, the skill activates naturally. The PM's job is orchestration, not skill routing.

---

## 6. Linear Integration

### 6.1 Task Structure in Linear

Tasks in Linear should follow this structure for the PM to parse them:

**Required fields:**
- **Title:** Clear, imperative description (e.g., "Implement user authentication middleware")
- **Description:** Full spec with acceptance criteria as a checklist
- **Labels:** One or more matching worker prompt template names (§5)
- **Priority:** Urgent / High / Medium / Low — PM picks highest priority first
- **Status workflow:** Todo → In Progress → In Review → Done

**Optional but recommended:**
- **Blocked by:** Linear issue links for dependency tracking
- **Estimate:** Story points (PM uses for load balancing)

### 6.2 PM Task Fetch Logic

```
1. Query Linear: list_issues(project: configured_project, status: "Todo", sort: "priority", limit: 10)
2. Filter out tasks with unresolved "blocked by" dependencies
3. Check active worker count via list_peers
4. For each available slot (up to max_workers - active_count):
     a. Pick highest-priority unblocked task
     b. Update Linear status → "In Progress"
     c. Spawn worker with task prompt
     d. Post Linear comment: "Assigned to worker session {peer_id}"
5. If no tasks available or all slots full → wait and re-check in 2 minutes
```

### 6.3 Linear Status Sync

The PM keeps Linear in sync throughout the lifecycle:

| Event | Linear Update |
|-------|--------------|
| Worker spawned | Status → "In Progress", comment with peer ID |
| Worker asks question | Comment with the question (for audit trail) |
| Worker completes | Comment with self-check results |
| PR created | Comment with PR link, status → "In Review" |
| PR merged | Status → "Done", comment with merge SHA |
| Task failed | Comment with error, status → "Todo" (re-queue) |

---

## 7. Verification Officer (VO)

The VO is a dedicated agent that owns all post-completion work. The PM's job ends when a worker reports `task_complete` — from that point, the VO takes over. This separation keeps the PM focused on orchestration while the VO handles the deep, iterative work of code quality assurance.

### 7.1 Why a Separate Agent

Verification is the highest-effort phase of the lifecycle. It involves diff analysis, code review, CI monitoring, comment relay loops, and judgment calls about merge-readiness. Bundling this into the PM would bloat its context, create a bottleneck (PM can't assign new tasks while reviewing), and mix two fundamentally different concerns — routing vs. quality.

### 7.2 VO Lifecycle

The PM spawns a VO agent when a worker reports `task_complete`:

```
PM receives task_complete from Worker
    │
    ▼
PM spawns VO agent with:
  - task_id, branch, worker peer_id
  - self_check results from worker
  - acceptance criteria from Linear task
    │
    ▼
┌─────────────────────────────────────────────────┐
│                 VO Agent                          │
│                                                   │
│  1. VALIDATE self-check results                   │
│     └─ any criteria false? → send review_feedback │
│        to worker via claude-peers, wait for fix   │
│                                                   │
│  2. REVIEW diff                                   │
│     └─ git diff main...task/{id}                  │
│     └─ assess scope, quality, conventions         │
│     └─ flag issues → send review_feedback         │
│                                                   │
│  3. CREATE PR                                     │
│     └─ gh pr create with title, summary,          │
│        Linear link, self-check results            │
│     └─ update Linear status → "In Review"         │
│                                                   │
│  4. MONITOR CI                                    │
│     └─ poll gh pr checks                          │
│     └─ on failure → send ci_failure to worker,    │
│        wait for fix, re-verify                    │
│                                                   │
│  5. REVIEW COMMENTS (if any from developer)       │
│     └─ fetch via gh api                           │
│     └─ relay to worker → wait for fix → re-verify │
│     └─ max 3 loops before escalation              │
│                                                   │
│  6. APPROVE                                       │
│     └─ all checks green + review clean            │
│     └─ report to PM: vo_approved                  │
│                                                   │
└─────────────────────────────────────────────────┘
    │
    ▼
PM receives vo_approved → notify developer → MERGE_WAIT
```

### 7.3 VO ↔ Worker Communication

The VO communicates directly with the worker via `claude-peers` using the same `PMMessage` types (`review_feedback`, `ci_failure`). From the worker's perspective, it doesn't matter whether the PM or VO sends the message — the protocol is identical.

### 7.4 VO ↔ PM Communication

The VO reports status back to the PM via a simple message set:

```typescript
// VO → PM messages
type VOMessage =
  | { type: "vo_started"; task_id: string; vo_peer_id: string }
  | { type: "vo_rejected"; task_id: string; reason: string; sent_to_worker: boolean }
  | { type: "vo_approved"; task_id: string; pr_url: string; pr_number: number }
  | { type: "vo_escalation"; task_id: string; reason: string }
```

### 7.5 Worker Self-Verification (unchanged)

Before reporting completion, every worker runs the verification commands defined in the worker template for its task's label. The worker sends a `SelfCheckResult` to the PM. If any check fails, the worker attempts to fix (up to 3 iterations) before escalating. This happens *before* the VO is involved — workers should only report `task_complete` when their own checks pass.

### 7.6 VO System Prompt

The VO gets its own system prompt (`templates/vo-system-prompt.md`) defining:

- Its role: "You are the Verification Officer. You review completed work, not write code."
- The review checklist: self-check validation, diff review, PR creation, CI monitoring, comment loops
- Communication protocol: how to message workers and report to PM
- Escalation rules: when to give up and notify the developer
- Quality bar: what "approved" means (all criteria met, CI green, no unresolved comments)

### 7.7 VO Configuration

```yaml
# .claude/pm-config.yaml
verification:
  max_review_loops: 3              # Max VO ↔ Worker iterations before escalation
  max_ci_retries: 3                # Max CI failure relays before escalation
  auto_approve_self_check: false   # If true, skip VO diff review when all self-checks pass
```

---

## 8. Concurrency and Resource Management

### 8.1 Worker Slot Management

The PM enforces a configurable cap on concurrent workers (default: **5**). This is driven by:
- **Claude Code rate limits:** 5-hour usage windows with session-count-dependent throttling
- **Machine resources:** Each Claude Code session consumes ~200-500MB RAM
- **Context quality:** Too many parallel update streams overwhelms PM context

### 8.2 Task Prioritization When Slots Are Full

When all slots are occupied and new high-priority tasks arrive:

1. PM does **not** preempt running workers (no task is so urgent it justifies wasted work)
2. PM queues the task and assigns it as soon as a slot frees up
3. PM logs a priority inversion warning if a P0 task is waiting behind P2 workers

### 8.3 PM Context Management

The PM session will run for extended periods. To prevent context overflow:

- PM persists worker state to `.claude/pm-state.json` (survives compaction)
- PM uses `set_summary` to keep its peer description updated
- PM keeps messages to workers concise and structured (JSON protocol, not prose)
- If PM session needs restart, it can reconstruct state from:
  - `.claude/pm-state.json` for worker tracking
  - Linear statuses for task state
  - `list_peers` for active workers
  - `git worktree list` for existing worktrees

---

## 9. Notification Provider Interface

The PM needs to alert the developer when human judgment is required. Rather than hardcoding a single service, the PM uses a **provider-agnostic notification interface**.

### 9.1 Provider Contract

Every notification provider implements a single shell-callable contract:

```bash
# .claude/notify.sh <severity> <title> <body>
# severity: info | warning | critical
# Providers are responsible for formatting and delivery.
```

The PM calls this script for all escalations. The script dispatches to whichever provider is configured.

### 9.2 Built-in Providers

The plugin ships with adapters for:

| Provider | Config Required | Notes |
|----------|----------------|-------|
| **Discord** | `DISCORD_WEBHOOK_URL` env var | Posts to a webhook-enabled channel. Supports markdown formatting. |
| **Slack** | `SLACK_WEBHOOK_URL` env var | Posts via incoming webhook. Supports Block Kit formatting. |
| **stdout** | None | Prints to PM terminal. Default fallback — always available. |

### 9.3 Custom Providers

Users can add their own provider by creating a script at `.claude/notify.sh` that handles the `<severity> <title> <body>` contract. Examples: PagerDuty, email via `sendmail`, Ntfy, Pushover, or any webhook.

### 9.4 Configuration

```yaml
# .claude/pm-config.yaml
notification:
  provider: discord          # discord | slack | stdout | custom
  webhook_url_env: DISCORD_WEBHOOK_URL  # env var name containing the URL
  # Or for custom:
  # provider: custom
  # script: .claude/my-notify.sh
```

### 9.5 Escalation Triggers

| Trigger | Severity | Action |
|---------|----------|--------|
| Worker asks unanswerable question | warning | Notify with question + context |
| CI fails 3 times on same issue | critical | Notify with failure log + branch |
| Worker stuck >45 min | warning | Notify with worker summary + peer ID |
| Architectural decision needed | critical | Notify with options + trade-off analysis |

---

## 10. Plugin Structure

Claude Code PM is packaged as a standard Claude Code plugin:

```
claude-code-pm/
├── plugin.json                          # Plugin manifest
├── README.md                            # Open-source documentation
├── LICENSE                              # MIT
├── .claude/
│   ├── skills/
│   │   └── pm-orchestrator/
│   │       └── SKILL.md                 # PM skill (triggers on project management tasks)
│   ├── commands/
│   │   ├── pm-start.md                  # /pm:start — launch orchestration loop
│   │   ├── pm-status.md                 # /pm:status — show active workers and task queue
│   │   └── pm-stop.md                   # /pm:stop — gracefully shut down workers
│   └── agents/
│       ├── pm-orchestrator.md           # PM agent definition
│       └── verification-officer.md      # VO agent definition
├── templates/
│   ├── pm-system-prompt.md              # PM behavioral contract
│   ├── vo-system-prompt.md              # VO behavioral contract
│   ├── worker-system-prompt.md          # Base worker behavioral contract
│   ├── pm-protocol.md                   # Message types reference (PM, VO, Worker)
│   ├── pm-config.example.yaml           # Example configuration
│   ├── pm-state.schema.json             # JSON Schema for pm-state.json
│   └── worker-prompt-templates/
│       └── default.md                   # Generic fallback worker template
├── providers/
│   ├── notify.sh                        # Dispatcher script
│   ├── discord.sh                       # Discord webhook adapter
│   ├── slack.sh                         # Slack webhook adapter
│   └── stdout.sh                        # Terminal fallback
└── scripts/
    ├── setup.sh                         # First-time setup (install peers, verify gh, create config)
    └── health-check.sh                  # Verify broker, Linear MCP, gh CLI are operational
```

### 10.1 Installation

```bash
# Install the plugin
claude plugin add claude-code-pm

# Or from source
git clone https://github.com/{org}/claude-code-pm
claude plugin add ./claude-code-pm
```

### 10.2 Project Setup

After installing the plugin, users configure it per-project:

```bash
# Run setup wizard
claude /pm:start

# Or manually create config
cp node_modules/claude-code-pm/templates/pm-config.example.yaml .claude/pm-config.yaml
# Edit pm-config.yaml with your Linear project, worker templates, notification settings
```

---

## 11. Configuration Reference

```yaml
# .claude/pm-config.yaml — Project-specific PM configuration

# Linear integration
linear:
  project: "My Project"              # Linear project name to pull tasks from
  team: "Engineering"                # Linear team (optional filter)
  status_map:                        # Map PM states to your Linear workflow
    ready: "Todo"
    in_progress: "In Progress"
    in_review: "In Review"
    done: "Done"

# Worker management
workers:
  max_concurrent: 5                  # Max parallel worker sessions
  timeout_minutes: 45                # Alert if worker silent for this long

# Verification Officer (VO) settings
verification:
  max_review_loops: 3                # Max VO ↔ Worker iterations before escalation
  max_ci_retries: 3                  # Max CI failure relays before escalation
  auto_approve_self_check: false     # Skip VO diff review when all self-checks pass

# Project context — design docs injected into worker prompts
project_docs:
  - path: "DESIGN.md"
    description: "System architecture and design decisions"
  - path: "ADR/"
    description: "Architecture Decision Records"
  # Users list whatever docs are relevant to their project

# Worker templates — maps Linear labels to verification commands
# Templates themselves live in .claude/worker-prompt-templates/{label}.md
# Skills are NOT configured here — they self-trigger via their own frontmatter
worker_templates:
  # Each key is a Linear label name → matched to a template file
  backend:
    verify: ["npm test", "npm run lint", "npm run build"]
  frontend:
    verify: ["npm test", "npm run lint"]
  # Add your own labels...

# Notification provider
notification:
  provider: stdout                   # discord | slack | stdout | custom
  # webhook_url_env: DISCORD_WEBHOOK_URL
  # script: .claude/my-notify.sh     # For custom provider

# Git conventions
git:
  base_branch: main                  # Branch PRs target
  branch_prefix: "task/"             # Prefix for worker branches
  branch_format: "{prefix}{task_id}-{slug}"
```

---

## 12. Constraints and Limitations

### 12.1 Channels Research Preview

- `claude-peers` requires `--dangerously-load-development-channels` on every session launch
- Channels require `claude.ai` login (not API key auth)
- No background mode — PM terminal must stay open
- If the PM session crashes, workers continue independently but lose coordination

### 12.2 Rate Limits

- Claude Code has 5-hour usage windows and monthly session caps on Pro/Max plans
- Running 6 sessions (1 PM + 5 workers) in parallel burns through limits faster
- **Mitigation:** Workers use `-p` (non-interactive) where possible, reducing idle consumption. PM stays interactive for channel reception.

### 12.3 Worker `-p` Mode vs Interactive

A critical design decision: `claude -p` runs non-interactively and **exits after completion**. This means:

- Workers spawned with `-p` can receive the initial task but **cannot receive follow-up channel messages** after they start executing
- For tasks that are self-contained (clear spec, no ambiguity), `-p` mode is fine — the worker executes and exits
- For tasks that may need clarification, the worker needs to be interactive to receive channel messages

**Recommended approach:** Use `-p` for the initial task assignment. If the worker realizes it needs clarification, it outputs a structured JSON question to stdout instead of completing, and the PM captures this, answers it, and re-launches the worker with `-p` again including the answer.

**Alternative for complex tasks:** Launch without `-p` (interactive mode) so the worker can receive channel messages mid-execution. The PM sends the task via `send_message` after the worker registers. Trade-off: interactive workers consume rate limit even when idle/thinking.

---

## 13. Trade-offs and What to Revisit

| Decision | Trade-off | Revisit when... |
|----------|-----------|-----------------|
| **Local PM** | Simple but requires open terminal. No mobile oversight. | Channels graduate from research preview; consider headless server. |
| **Configurable worker cap** | Conservative default (5). Prevents rate limit exhaustion. | If on Enterprise plan with higher limits, can increase. |
| **JSON message protocol** | Structured but verbose. Workers must parse/emit JSON. | If messages get complex, consider a shared schema package. |
| **`-p` mode for workers** | Simple lifecycle but no mid-task channel messages. | If many tasks need multi-turn clarification, switch to interactive workers. |
| **claude-peers broker** | Third-party, SQLite-backed. Single point of failure. | If broker crashes, all inter-session comms stop. Add health checks. |
| **Dedicated VO agent** | Clean separation of concerns but adds session overhead per completed task. | If VO is too heavyweight, consider inlining lightweight reviews back into PM for trivial tasks. |
| **Shell-based notification** | Simple, universal, but limited to one-way alerts. | Build two-way notification provider for in-app replies. |
| **Linear as source of truth** | Good for task management but adds latency to status updates. | If real-time state matters, use pm-state.json as primary, Linear as async sync. |
| **Plugin packaging** | Portable and reusable, but adds installation step. | If Claude Code adds native PM capabilities, may become redundant. |

---

## 14. Implementation Phases

### Phase A: Foundation (Day 1-2)

1. Scaffold the plugin (`plugin.json`, directory structure, README)
2. Install and test `claude-peers` — verify two sessions can communicate
3. Create the PM system prompt (`templates/pm-system-prompt.md`)
4. Create the generic worker system prompt and default template
5. Define the message protocol (`templates/pm-protocol.md`)
6. Test spawning a single worker from PM and receiving completion message

### Phase B: Linear Integration (Day 3)

1. Configure Linear MCP with correct team/project filters
2. Implement the `pm-config.yaml` loader in the PM system prompt
3. Test PM fetching tasks and updating statuses
4. Test worker template label matching from config

### Phase C: Notification Providers (Day 4)

1. Implement `notify.sh` dispatcher
2. Build Discord webhook adapter
3. Build Slack webhook adapter
4. Wire escalation triggers to notification calls
5. Test each provider end-to-end

### Phase D: Verification Officer (Day 5-6)

1. Create VO system prompt (`templates/vo-system-prompt.md`)
2. Create VO agent definition (`agents/verification-officer.md`)
3. Implement VO lifecycle: self-check validation → diff review → PR creation → CI monitoring
4. Implement VO ↔ Worker review comment loop via claude-peers
5. Implement VO → PM reporting (`vo_approved`, `vo_rejected`, `vo_escalation`)
6. Test full flow: worker completes → PM delegates to VO → VO reviews → PR ready

### Phase E: Full Loop (Day 7-8)

1. PM spawns workers, distributes tasks, monitors completion
2. PM delegates to VO on task_complete, VO handles review pipeline
3. Test with 2-3 concurrent workers and parallel VO instances
4. Implement PM state persistence and crash recovery
5. Implement the `/pm:start`, `/pm:status`, `/pm:stop` commands

### Phase F: Scale and Harden (Day 9-10)

1. Scale to 5 concurrent workers with VO agents running in parallel
2. Stress test: worker hangs, VO hangs, broker restarts, PM crash recovery
3. Test VO escalation paths (max review loops, max CI retries)

### Phase G: Open Source Polish (Day 11-12)

1. Write comprehensive README with quickstart guide
2. Add `pm-config.example.yaml` with annotated examples
3. Add setup wizard (`scripts/setup.sh`)
4. Write CONTRIBUTING.md
5. Create GitHub Actions for plugin CI
6. Publish to Claude Code plugin registry
