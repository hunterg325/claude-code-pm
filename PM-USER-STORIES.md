# Claude Code PM — User Stories

**Purpose:** Implementation breakdown for building the Claude Code PM plugin. These are development stories for getting the PM functional, tested, and published as an open-source Claude Code plugin.

**Reference:** PM-ORCHESTRATOR-DESIGN.md (full system design)

---

## Epic 1: Session-to-Session Communication

### US-1.1: Install and verify claude-peers broker

**As** the PM orchestrator, **I need** a working claude-peers broker on localhost:7899 **so that** I can exchange messages with worker sessions.

**Acceptance Criteria:**
- [ ] `claude-peers` installed and runnable (`cd ~/claude-peers && bun install`)
- [ ] Broker starts on port 7899 with SQLite backing store
- [ ] Two test sessions can register as peers (`list_peers` returns both)
- [ ] `send_message` delivers a JSON payload from session A → session B
- [ ] `set_summary` updates a peer's description visible to other peers
- [ ] Broker survives a session disconnect without losing queued messages

**Notes:** This is the critical path — if peers can't talk, nothing else works. Test with two plain `claude` sessions before building PM logic.

---

### US-1.2: Define and validate the PM ↔ Worker message protocol

**As** the PM, **I need** a structured JSON message protocol **so that** I can send task assignments and receive completion reports without ambiguity.

**Acceptance Criteria:**
- [ ] `PMMessage` types defined: `task_assignment`, `clarification_response`, `review_feedback`, `ci_failure`, `abort`
- [ ] `WorkerMessage` types defined: `task_started`, `question`, `progress`, `task_complete`, `task_failed`
- [ ] `SelfCheckResult` interface defined: `tests_pass`, `lint_pass`, `build_pass`, `acceptance_criteria` map
- [ ] Protocol documented in `templates/pm-protocol.md` (single source of truth)
- [ ] Example message pairs for each type (for testing and worker prompt injection)
- [ ] JSON schema validation helper (optional but recommended — reject malformed messages)

**Notes:** Keep messages concise. Workers in `-p` mode output structured JSON to stdout; interactive workers use `send_message`. Protocol must handle both paths.

---

## Epic 2: Plugin Scaffold and Configuration

### US-2.1: Scaffold the plugin directory structure

**As** a plugin developer, **I need** the correct plugin directory layout and `plugin.json` manifest **so that** the PM can be installed as a standard Claude Code plugin.

**Acceptance Criteria:**
- [ ] `plugin.json` created with correct schema (name, version, description, skills, commands, agents)
- [ ] Directory structure matches PM-ORCHESTRATOR-DESIGN.md §10
- [ ] `templates/` directory with all prompt and config files
- [ ] `providers/` directory with notification adapters
- [ ] `scripts/` directory with setup and health-check scripts
- [ ] README.md with project overview, installation, and quickstart
- [ ] LICENSE file (MIT)

---

### US-2.2: Implement pm-config.yaml loader and validation

**As** the PM, **I need** to read project-specific configuration from `.claude/pm-config.yaml` **so that** I can adapt to any project's Linear setup, worker templates, and notification preferences.

**Acceptance Criteria:**
- [ ] `pm-config.example.yaml` created with annotated defaults for all settings
- [ ] PM system prompt includes instructions to read and parse `pm-config.yaml` on startup
- [ ] Config covers: Linear project/team, max workers, timeout thresholds, project docs, worker template verify commands, notification provider, git conventions
- [ ] Missing config gracefully falls back to sensible defaults (stdout notifications, 5 workers, `main` branch)
- [ ] PM validates required fields (Linear project name) and surfaces clear errors for missing config

---

## Epic 3: PM System Prompt and Behavioral Contract

### US-3.1: Write the PM system prompt

**As** the PM session, **I need** a system prompt that defines my orchestration behavior **so that** I follow a deterministic loop: fetch → plan → spawn → monitor → verify → review → merge.

**Acceptance Criteria:**
- [ ] `templates/pm-system-prompt.md` created
- [ ] Defines PM role: "You do NOT write code. You orchestrate workers."
- [ ] Lists available tools: Linear MCP, claude-peers, Bash (gh CLI), notification provider
- [ ] Documents the orchestration loop (§3.1 of design doc)
- [ ] Documents escalation rules: unanswerable questions → notify, 3x CI fail → notify, 45min stuck → investigate
- [ ] Documents task assignment protocol: what must be included in every worker prompt
- [ ] Defines PM state machine transitions: IDLE → PLANNING → SPAWNING → MONITORING → VERIFYING → REVIEWING → PR_READY → COMPLETED
- [ ] References `pm-state.json` for crash recovery
- [ ] References `pm-config.yaml` for project-specific settings
- [ ] Contains zero project-specific or domain-specific content — fully generic

**Notes:** This prompt is appended via `--append-system-prompt`. Keep it under 3000 tokens — long system prompts degrade Claude's ability to follow instructions. Link to design docs for detail rather than duplicating.

---

### US-3.2: Write the base worker system prompt

**As** a worker session, **I need** a system prompt that defines how I report progress, ask questions, and self-verify **so that** the PM can coordinate me without ambiguity.

**Acceptance Criteria:**
- [ ] `templates/worker-system-prompt.md` created
- [ ] Defines worker role: "You receive tasks from the PM, write code, and report back."
- [ ] Documents JSON message protocol for reporting to PM
- [ ] Documents self-check requirements before reporting done
- [ ] Documents how to ask questions (blocking vs non-blocking)
- [ ] Documents scope boundaries: only work on the assigned task, stay on the assigned branch
- [ ] Contains zero project-specific content — fully generic

---

### US-3.3: Write the default worker prompt template

**As** the PM, **I need** a generic fallback worker template **so that** tasks without a label-specific template still get properly formatted prompts.

**Acceptance Criteria:**
- [ ] `templates/worker-prompt-templates/default.md` created
- [ ] Uses `{{task_id}}`, `{{task_title}}`, `{{task_description}}`, `{{acceptance_criteria}}` placeholders
- [ ] Includes generic verification commands (configurable)
- [ ] Includes branch naming convention from config
- [ ] Works for any language/framework — no tech stack assumptions

---

## Epic 4: PM State Management

### US-4.1: Implement pm-state.json persistence

**As** the PM, **I need** to persist my orchestration state to disk **so that** I can recover after a crash or context compaction without losing track of active workers and task assignments.

**Acceptance Criteria:**
- [ ] `templates/pm-state.schema.json` with JSON Schema validation
- [ ] State schema tracks: `active_workers`, `completed_tasks`, `queued_tasks`, `escalations`, `current_cycle`, `last_self_check`
- [ ] PM writes state after every state transition (spawn, complete, fail, escalate)
- [ ] PM reads state on startup to reconstruct orchestration context
- [ ] PM can reconcile state against live sources: `list_peers`, `git worktree list`, Linear statuses

**Notes:** This is the crash recovery mechanism. If the PM session dies, a new PM session reads `pm-state.json` + queries Linear + queries peers to rebuild its world view.

---

## Epic 5: Worker Lifecycle Management

### US-5.1: Spawn a worker session in an isolated worktree

**As** the PM, **I need** to spawn a Claude Code worker session in a git worktree **so that** workers operate on isolated branches without conflicting with each other or main.

**Acceptance Criteria:**
- [ ] PM composes worker prompt from: template + Linear task data + project doc context
- [ ] Worktree created at configured path
- [ ] Worker registers as a peer within 30s of spawn (verifiable via `list_peers`)
- [ ] PM updates `pm-state.json` with new worker entry
- [ ] PM posts Linear comment: "Assigned to worker session {peer_id}"
- [ ] PM updates Linear status → "In Progress"

---

### US-5.2: Monitor active workers and handle messages

**As** the PM, **I need** to continuously monitor worker messages **so that** I can answer questions, detect completions, and handle failures in real-time.

**Acceptance Criteria:**
- [ ] PM polls `list_peers` on a regular cadence to detect worker registrations and departures
- [ ] PM processes incoming messages by type:
  - `task_started` → update pm-state, log
  - `question` (blocking=true) → attempt to answer from project docs, or escalate
  - `question` (blocking=false) → answer async, worker continues
  - `progress` → update pm-state with percent/summary
  - `task_complete` → trigger verification flow (US-6.1)
  - `task_failed` (recoverable=true) → re-queue task, clean up worker
  - `task_failed` (recoverable=false) → escalate to developer
- [ ] PM detects stuck workers: no message received in >timeout_minutes → investigate/escalate
- [ ] PM enforces max concurrent workers — queues additional tasks

---

### US-5.3: Clean up after worker completion

**As** the PM, **I need** to clean up worker resources after task completion and merge **so that** worktrees and branches don't accumulate.

**Acceptance Criteria:**
- [ ] After PR merged, PM removes worktree and branch
- [ ] PM removes worker entry from `pm-state.json`
- [ ] PM updates Linear status → "Done" with merge SHA comment
- [ ] If worker process is still running (edge case), PM kills it gracefully
- [ ] Cleanup is idempotent — safe to run twice if PM crashes mid-cleanup

---

## Epic 6: Verification Officer (VO) Agent

### US-6.1: Write the VO system prompt and agent definition

**As** the plugin, **I need** a dedicated Verification Officer agent with its own system prompt **so that** all post-completion work (review, PR, CI) is handled by a focused agent separate from the PM.

**Acceptance Criteria:**
- [ ] `templates/vo-system-prompt.md` created
- [ ] Defines VO role: "You review completed work. You do NOT write code or assign tasks."
- [ ] Documents the VO review checklist: self-check validation → diff review → PR creation → CI monitoring → comment loop
- [ ] Documents VO ↔ Worker communication protocol (`review_feedback`, `ci_failure` messages via claude-peers)
- [ ] Documents VO → PM reporting protocol (`vo_started`, `vo_approved`, `vo_rejected`, `vo_escalation`)
- [ ] Documents escalation rules: max review loops, max CI retries (from `pm-config.yaml`)
- [ ] Documents quality bar: what "approved" means
- [ ] `agents/verification-officer.md` agent definition created
- [ ] Contains zero project-specific content — fully generic

---

### US-6.2: Implement PM → VO delegation on task_complete

**As** the PM, **I need** to spawn a VO agent when a worker reports `task_complete` **so that** verification is handled without blocking my orchestration loop.

**Acceptance Criteria:**
- [ ] PM receives `task_complete` with `SelfCheckResult`
- [ ] PM spawns VO agent with: task_id, branch, worker peer_id, self-check results, acceptance criteria
- [ ] PM transitions task state to `VO_DELEGATED` in `pm-state.json`
- [ ] PM is free to continue assigning new tasks while VO works
- [ ] PM processes `vo_approved` → transitions task to `MERGE_WAIT`, notifies developer
- [ ] PM processes `vo_rejected` → logs, waits for VO ↔ Worker loop to resolve
- [ ] PM processes `vo_escalation` → notifies developer via notification provider

---

### US-6.3: Implement VO review pipeline

**As** the VO, **I need** to validate self-check results, review the diff, create a PR, and monitor CI **so that** only quality code reaches the main branch.

**Acceptance Criteria:**
- [ ] VO validates all `acceptance_criteria` are `true` — if any are `false`, sends `review_feedback` to worker, waits for fix
- [ ] VO runs `git diff main...task/{id}` to assess scope and quality
- [ ] VO creates PR via `gh pr create` with: title, summary, Linear link, self-check results
- [ ] VO updates Linear status → "In Review" with PR link comment
- [ ] VO monitors CI via `gh pr checks` polling
- [ ] On CI failure → sends `ci_failure` message to worker, waits for fix, re-verifies
- [ ] On all checks green → sends `vo_approved` to PM with PR URL

---

### US-6.4: Implement VO ↔ Worker review comment loop

**As** the VO, **I need** to relay PR review comments back to the worker and iterate until resolved **so that** feedback is addressed without human coordination.

**Acceptance Criteria:**
- [ ] VO fetches PR comments via `gh api repos/{owner}/{repo}/pulls/{n}/comments`
- [ ] VO sends `review_feedback` message to worker via claude-peers
- [ ] Worker addresses comments, pushes fixes, sends `task_complete` again
- [ ] VO re-runs review pipeline (back to US-6.3 validation step)
- [ ] Loop terminates when: all comments resolved + CI green → `vo_approved`
- [ ] If loop exceeds `verification.max_review_loops` → sends `vo_escalation` to PM

---

## Epic 7: Linear Integration

### US-7.1: Implement the task fetch and prioritization logic

**As** the PM, **I need** to fetch tasks from Linear, respect dependency ordering, and pick the highest-priority unblocked task **so that** workers always get the most important work.

**Acceptance Criteria:**
- [ ] PM queries Linear using project name from `pm-config.yaml`
- [ ] PM filters out tasks with unresolved `blockedBy` dependencies
- [ ] PM picks highest-priority unblocked task for each available worker slot
- [ ] PM matches task labels to worker prompt template filenames (e.g., label `backend` → `backend.md`)
- [ ] PM parses the `## Acceptance Criteria` section to extract checkboxes for `SelfCheckResult` validation
- [ ] PM handles edge cases: no tasks available (wait), all slots full (queue), all tasks blocked (wait)

---

### US-7.2: Keep Linear in sync throughout the task lifecycle

**As** the PM, **I need** to update Linear statuses and post audit trail comments **so that** anyone looking at Linear can understand the current state of every task.

**Acceptance Criteria:**
- [ ] Status transitions use the status names from `pm-config.yaml` status_map
- [ ] Audit trail comments posted for each lifecycle event
- [ ] Comments include: peer ID, timestamps, self-check results, PR links, merge SHAs, error details

---

## Epic 8: Notification Provider System

### US-8.1: Implement the notification dispatcher

**As** the PM, **I need** a provider-agnostic notification interface **so that** developers can receive escalation alerts via their preferred channel.

**Acceptance Criteria:**
- [ ] `providers/notify.sh` dispatcher created — reads provider from `pm-config.yaml`
- [ ] Contract: `notify.sh <severity> <title> <body>` where severity is `info | warning | critical`
- [ ] Dispatcher routes to the configured provider adapter
- [ ] Falls back to `stdout` if configured provider fails
- [ ] All escalation triggers (§9.5 of design doc) wired to notification calls

---

### US-8.2: Build Discord and Slack adapters

**As** a developer using Discord or Slack, **I need** webhook-based notification adapters **so that** I receive PM escalation alerts in my existing team channels.

**Acceptance Criteria:**
- [ ] `providers/discord.sh` — posts to Discord via webhook URL from env var
- [ ] `providers/slack.sh` — posts to Slack via incoming webhook from env var
- [ ] `providers/stdout.sh` — prints formatted message to PM terminal
- [ ] Each adapter formats messages appropriately for its platform (markdown for Discord, Block Kit for Slack)
- [ ] Each adapter handles network failures gracefully (log error, don't crash PM)
- [ ] Setup instructions documented in README for each provider

---

### US-8.3: Support custom notification providers

**As** a developer with a non-standard notification setup, **I need** to plug in my own notification script **so that** I can use PagerDuty, email, Ntfy, or any other service.

**Acceptance Criteria:**
- [ ] Custom provider configured via `notification.script` in `pm-config.yaml`
- [ ] PM invokes the custom script with the same `<severity> <title> <body>` contract
- [ ] README documents how to write a custom provider with example
- [ ] At least one example custom provider included (e.g., `examples/ntfy-provider.sh`)

---

## Epic 9: Plugin Commands

### US-9.1: Implement /pm:start command

**As** a developer, **I need** a `/pm:start` command **so that** I can launch the PM orchestration loop with a single command.

**Acceptance Criteria:**
- [ ] `/pm:start` command defined in `commands/pm-start.md`
- [ ] Runs pre-flight checks: claude-peers broker, Linear MCP, gh CLI, pm-config.yaml
- [ ] Surfaces clear errors for any missing prerequisites
- [ ] Launches the PM orchestration loop with the system prompt
- [ ] On first run, offers to create `pm-config.yaml` from the example template

---

### US-9.2: Implement /pm:status command

**As** a developer, **I need** a `/pm:status` command **so that** I can see active workers, task queue, and PM health at a glance.

**Acceptance Criteria:**
- [ ] `/pm:status` command defined in `commands/pm-status.md`
- [ ] Shows: active workers (task, status, duration), queued tasks, completed tasks, recent escalations
- [ ] Reads from `pm-state.json` + live `list_peers` for reconciled view
- [ ] Formats output for terminal readability

---

### US-9.3: Implement /pm:stop command

**As** a developer, **I need** a `/pm:stop` command **so that** I can gracefully shut down the PM and all workers.

**Acceptance Criteria:**
- [ ] `/pm:stop` command defined in `commands/pm-stop.md`
- [ ] Sends `abort` message to all active workers
- [ ] Waits for workers to acknowledge or times out
- [ ] Saves final state to `pm-state.json` for recovery
- [ ] Cleans up orphaned worktrees (optional, with confirmation)

---

## Epic 10: End-to-End Integration

### US-10.1: Run the full orchestration loop with a single worker

**As** the PM, **I need** to execute the complete cycle — fetch task → spawn worker → monitor → delegate to VO → VO reviews → PR → merge notification **so that** I can validate the entire system works before scaling.

**Acceptance Criteria:**
- [ ] PM launched with `/pm:start`
- [ ] PM fetches the first unblocked task from the configured Linear project
- [ ] PM composes worker prompt from template + Linear task data
- [ ] Worker spawns in worktree, receives task, executes, self-checks
- [ ] Worker reports `task_complete` with passing self-check
- [ ] PM delegates to VO agent
- [ ] VO reviews diff, creates PR, monitors CI
- [ ] VO reports `vo_approved` to PM
- [ ] PM notifies developer that PR is ready
- [ ] After merge, PM cleans up worktree, updates Linear → "Done"
- [ ] PM fetches next unblocked task and repeats
- [ ] Total cycle time measured and logged

**Notes:** Run against a real Linear task in any project. The task should be self-contained and well-specified to minimize variables during initial testing.

---

### US-10.2: Scale to 3-5 concurrent workers with parallel VOs

**As** the PM, **I need** to manage multiple workers and VO agents simultaneously **so that** independent tasks execute and verify in parallel.

**Acceptance Criteria:**
- [ ] PM spawns up to configured max workers concurrently
- [ ] PM correctly tracks state for each worker independently in `pm-state.json`
- [ ] PM handles interleaved messages from multiple workers and VOs without confusion
- [ ] Multiple VO agents can run in parallel (one per completed task)
- [ ] PM respects dependency ordering even when slots are available
- [ ] PM handles partial failures: if one worker or VO fails, others continue unaffected
- [ ] PM detects worker slot opening and immediately fills it with next queued task

---

### US-10.3: PM crash recovery and state reconciliation

**As** the PM, **I need** to recover gracefully from a crash **so that** in-flight work isn't lost and I can resume coordination.

**Acceptance Criteria:**
- [ ] On startup, PM reads `.claude/pm-state.json` for last known state
- [ ] PM reconciles against live sources: `list_peers`, `git worktree list`, Linear statuses
- [ ] PM resolves state conflicts:
  - Worker completed while PM was down → detect, mark completed
  - Worker died while PM was down → detect from missing peer, re-queue task
  - Orphaned worktree (no active worker, no merged PR) → clean up
- [ ] PM resumes orchestration loop from reconciled state
- [ ] No duplicate task assignments after recovery

---

## Epic 11: Open Source Polish

### US-11.1: Write comprehensive documentation

**As** an open-source user, **I need** clear documentation **so that** I can install, configure, and use Claude Code PM on my own projects.

**Acceptance Criteria:**
- [ ] README.md with: project overview, features, prerequisites, installation, quickstart, configuration reference, FAQ
- [ ] CONTRIBUTING.md with: dev setup, PR guidelines, code style, testing instructions
- [ ] In-code comments on all non-obvious design decisions
- [ ] Example configurations for common project types (Node.js, Python, polyglot)

---

### US-11.2: Publish to Claude Code plugin registry

**As** a plugin author, **I need** to publish to the registry **so that** anyone can `claude plugin add claude-code-pm`.

**Acceptance Criteria:**
- [ ] `plugin.json` passes registry validation
- [ ] GitHub Actions CI for linting and validation
- [ ] Version tagging and changelog
- [ ] Published and installable via `claude plugin add`

---

## Implementation Order

```
US-1.1 (peers)
  └→ US-1.2 (protocol — now includes VO message types)
       └→ US-2.1 (plugin scaffold) + US-2.2 (config loader)
            └→ US-3.1 (PM prompt) + US-3.2 (worker prompt) + US-3.3 (default template)
                 └→ US-4.1 (state persistence)
                      └→ US-5.1 (spawn worker)
                           └→ US-5.2 (monitor workers) + US-7.1 (Linear fetch)
                                └→ US-6.1 (VO prompt + agent) + US-7.2 (Linear sync)
                                     └→ US-6.2 (PM → VO delegation)
                                          └→ US-6.3 (VO review pipeline) + US-6.4 (VO ↔ Worker loop)
                                               └→ US-8.1 (notify) + US-8.2 (Discord/Slack) + US-8.3 (custom)
                                                    └→ US-9.1 (start) + US-9.2 (status) + US-9.3 (stop)
                                                         └→ US-10.1 (single worker + VO E2E)
                                                              └→ US-10.2 (multi-worker + parallel VOs)
                                                                   └→ US-5.3 (cleanup)
                                                                        └→ US-10.3 (crash recovery)
                                                                             └→ US-11.1 (docs) + US-11.2 (publish)
```

**Estimated effort:** 10-12 days of focused work (maps to PM-ORCHESTRATOR-DESIGN.md §14).
