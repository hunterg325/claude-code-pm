# Claude Code PM Orchestrator — User Stories

**Purpose:** Local development breakdown for building the PM orchestrator. These are NOT Linear tasks — they're implementation stories for getting the PM functional, tested, and running against real Phase 1 tasks.

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
- [ ] Protocol documented in `.claude/pm-protocol.md` (single source of truth)
- [ ] Example message pairs for each type (for testing and worker prompt injection)
- [ ] JSON schema validation helper (optional but recommended — reject malformed messages)

**Notes:** Keep messages concise. Workers in `-p` mode output structured JSON to stdout; interactive workers use `send_message`. Protocol must handle both paths.

---

## Epic 2: PM System Prompt and Behavioral Contract

### US-2.1: Write the PM system prompt

**As** the PM session, **I need** a system prompt that defines my orchestration behavior **so that** I follow a deterministic loop: fetch → plan → spawn → monitor → verify → review → merge.

**Acceptance Criteria:**
- [ ] `.claude/pm-system-prompt.md` created
- [ ] Defines PM role: "You do NOT write code. You orchestrate workers."
- [ ] Lists available tools: Linear MCP, claude-peers, Bash (gh CLI), Telegram bot
- [ ] Documents the orchestration loop (§3.1 of design doc)
- [ ] Documents escalation rules: unanswerable questions → Telegram, 3x CI fail → Telegram, 45min stuck → investigate
- [ ] Documents task assignment protocol: what must be included in every worker prompt
- [ ] Defines the PM state machine transitions: IDLE → PLANNING → SPAWNING → MONITORING → VERIFYING → REVIEWING → PR_READY → COMPLETED
- [ ] References `pm-state.json` for crash recovery

**Notes:** This prompt is appended via `--append-system-prompt`. Keep it under 3000 tokens — long system prompts degrade Claude's ability to follow instructions. Link to design docs for detail rather than duplicating.

---

### US-2.2: Write worker prompt templates per label category

**As** the PM, **I need** reusable prompt templates for each task label **so that** I can inject domain-specific context when spawning workers.

**Acceptance Criteria:**
- [ ] `.claude/worker-prompt-templates/` directory created
- [ ] Templates for each Skill Router label: `ingestion.md`, `features.md`, `ml-model.md`, `serving.md`, `infra.md`, `schema.md`
- [ ] Each template includes:
  - Worker role and behavioral contract (report via JSON, self-check before done)
  - Skills to load (file paths to SKILL.md files)
  - Architecture context pointers (SYSTEM-DESIGN.md section references)
  - Verification commands (`npm test`, `pytest`, etc.)
  - Branch naming convention
- [ ] Template variables use `{{task_id}}`, `{{task_title}}`, `{{task_description}}`, `{{acceptance_criteria}}` placeholders
- [ ] PM can compose a full worker prompt by: template + Linear task data + architecture context

**Notes:** The PM reads the Linear task's `## Skills Required` section to determine which template(s) to use. Templates are the static part; Linear task data is the dynamic part.

---

## Epic 3: PM State Management

### US-3.1: Implement pm-state.json persistence

**As** the PM, **I need** to persist my orchestration state to disk **so that** I can recover after a crash or context compaction without losing track of active workers and task assignments.

**Acceptance Criteria:**
- [ ] `.claude/pm-state.json` schema defined:
  ```json
  {
    "active_workers": {
      "peer-id": {
        "task_id": "AGE-55",
        "status": "WORKING|BLOCKED|SELF_CHECKING|AWAITING_REVIEW",
        "spawned_at": "ISO-8601",
        "last_message_at": "ISO-8601",
        "branch": "task/age-55-scaffold-monorepo",
        "worktree_path": ".claude/worktrees/task-age-55-..."
      }
    },
    "completed_tasks": ["AGE-50", "AGE-51"],
    "queued_tasks": ["AGE-56", "AGE-57"],
    "escalations": []
  }
  ```
- [ ] PM writes state after every state transition (spawn, complete, fail, escalate)
- [ ] PM reads state on startup to reconstruct orchestration context
- [ ] PM can reconcile state against live sources: `list_peers`, `git worktree list`, Linear statuses

**Notes:** This is the crash recovery mechanism. If the PM session dies, a new PM session reads `pm-state.json` + queries Linear + queries peers to rebuild its world view. The reconciliation logic is the hardest part — state can drift if a worker completed while the PM was down.

---

## Epic 4: Worker Lifecycle Management

### US-4.1: Spawn a worker session in an isolated worktree

**As** the PM, **I need** to spawn a Claude Code worker session in a git worktree **so that** workers operate on isolated branches without conflicting with each other or main.

**Acceptance Criteria:**
- [ ] PM can execute the spawn command:
  ```bash
  claude --worktree task-{id}-{slug} \
    --dangerously-skip-permissions \
    --dangerously-load-development-channels server:claude-peers \
    --allowedTools "Bash,Read,Edit,Write,Glob,Grep" \
    --append-system-prompt "$(cat .claude/worker-system-prompt.md)" \
    -p "{composed_prompt}" &
  ```
- [ ] Worktree created at `.claude/worktrees/task-{id}-{slug}/`
- [ ] Worker registers as a peer within 30s of spawn (verifiable via `list_peers`)
- [ ] Worker's initial `-p` prompt includes: task spec, acceptance criteria, architecture context, skills to load, branch name, verification commands
- [ ] PM updates `pm-state.json` with new worker entry
- [ ] PM posts Linear comment: "Assigned to worker session {peer_id}"
- [ ] PM updates Linear status → "In Progress"

**Notes:** The `&` at the end backgrounds the process. PM must capture the PID for monitoring. Workers in `-p` mode run to completion and exit — the PM detects this via the process exiting or via a `task_complete` message arriving.

---

### US-4.2: Monitor active workers and handle messages

**As** the PM, **I need** to continuously monitor worker messages **so that** I can answer questions, detect completions, and handle failures in real-time.

**Acceptance Criteria:**
- [ ] PM polls `list_peers` on a regular cadence to detect worker registrations and departures
- [ ] PM processes incoming messages by type:
  - `task_started` → update pm-state, log
  - `question` (blocking=true) → attempt to answer from design docs, or escalate to Hunter
  - `question` (blocking=false) → answer async, worker continues
  - `progress` → update pm-state with percent/summary
  - `task_complete` → trigger verification flow (US-5.1)
  - `task_failed` (recoverable=true) → re-queue task, clean up worker
  - `task_failed` (recoverable=false) → escalate to Hunter
- [ ] PM detects stuck workers: no message received in >45 minutes → investigate/escalate
- [ ] PM enforces max 5 concurrent workers — queues additional tasks

**Notes:** The polling cadence matters. Too fast burns context; too slow misses urgent questions. Start with 60-second check intervals. The PM should also react to messages proactively when they arrive via peers, not just poll.

---

### US-4.3: Clean up after worker completion

**As** the PM, **I need** to clean up worker resources after task completion and merge **so that** worktrees and branches don't accumulate.

**Acceptance Criteria:**
- [ ] After PR merged, PM runs:
  ```bash
  git worktree remove .claude/worktrees/task-{id}-{slug}
  git branch -d worktree-task-{id}-{slug}
  ```
- [ ] PM removes worker entry from `pm-state.json`
- [ ] PM updates Linear status → "Done" with merge SHA comment
- [ ] If worker process is still running (edge case), PM kills it gracefully
- [ ] Cleanup is idempotent — safe to run twice if PM crashes mid-cleanup

---

## Epic 5: Verification and Code Review

### US-5.1: Verify worker self-check results and trigger code review

**As** the PM, **I need** to validate a worker's self-check report and create a PR for review **so that** only verified code reaches the main branch.

**Acceptance Criteria:**
- [ ] PM receives `task_complete` with `SelfCheckResult`
- [ ] PM checks all `acceptance_criteria` are `true` — if any are `false`, sends `review_feedback` back to worker
- [ ] PM runs `git diff main...task/{id}` to review scope of changes
- [ ] PM creates PR via `gh pr create` with:
  - Title: `{task_id}: {task_title}`
  - Body: summary, Linear link, self-check results as checklist
- [ ] PM updates Linear status → "In Review" with PR link comment
- [ ] PM monitors CI via `gh pr checks {pr_number}` polling
- [ ] On CI failure → sends `ci_failure` message to worker with failure summary
- [ ] On CI pass → notifies Hunter that PR is ready for merge

**Notes:** The PM should also run a lightweight code review itself if possible — either via the `/code-review` skill or by spawning a review subagent in a worktree. For v1, manual Hunter review is fine.

---

### US-5.2: Handle PR review comment resolution loop

**As** the PM, **I need** to relay PR review comments back to workers **so that** feedback gets addressed without Hunter manually coordinating.

**Acceptance Criteria:**
- [ ] PM fetches PR comments via `gh api repos/{owner}/{repo}/pulls/{n}/comments`
- [ ] PM sends `review_feedback` message to the original worker with comment list
- [ ] Worker addresses comments, pushes fixes, sends `task_complete` again
- [ ] PM re-runs verification (back to US-5.1)
- [ ] Loop terminates when: all comments resolved + CI green
- [ ] If loop exceeds 3 iterations → escalate to Hunter

---

## Epic 6: Linear Integration

### US-6.1: Implement the task fetch and prioritization logic

**As** the PM, **I need** to fetch tasks from Linear, respect dependency ordering, and pick the highest-priority unblocked task **so that** workers always get the most important work.

**Acceptance Criteria:**
- [ ] PM queries: `list_issues(project: "Claude PM", status: "Todo", sort: "priority")`
- [ ] PM filters out tasks with unresolved `blockedBy` dependencies (checks if blocking task is status "Done")
- [ ] PM picks highest-priority unblocked task for each available worker slot
- [ ] PM parses the `## Skills Required` section from the task description to determine which worker template to use
- [ ] PM parses the `## Acceptance Criteria` section to extract checkboxes for the `SelfCheckResult` validation
- [ ] PM handles edge cases: no tasks available (wait and re-check), all slots full (queue), all tasks blocked (wait)

**Notes:** The dependency check is key — AGE-56 is blocked by AGE-55, so the PM must not assign AGE-56 until AGE-55 is "Done". Linear's `blockedBy` relation is the source of truth.

---

### US-6.2: Keep Linear in sync throughout the task lifecycle

**As** the PM, **I need** to update Linear statuses and post audit trail comments **so that** anyone looking at Linear can understand the current state of every task.

**Acceptance Criteria:**
- [ ] Status transitions:
  - Worker spawned → "In Progress"
  - PR created → "In Review"
  - PR merged → "Done"
  - Task failed (re-queue) → back to "Todo"
- [ ] Audit trail comments posted for each event:
  - "Assigned to worker session {peer_id} at {timestamp}"
  - "Worker question: {question}" (with PM's answer below)
  - "Self-check results: {pass/fail summary}"
  - "PR created: {pr_url}"
  - "CI status: {pass/fail}"
  - "Merged: {sha}"
  - "Task failed: {error}. Re-queued."

---

## Epic 7: Escalation to Hunter

### US-7.1: Set up Telegram bot for PM escalation notifications

**As** the PM, **I need** to send Telegram messages to Hunter **so that** blocked workers and critical failures get human attention without Hunter watching the terminal.

**Acceptance Criteria:**
- [ ] Telegram bot created via BotFather (token stored in env: `TELEGRAM_BOT_TOKEN`)
- [ ] Hunter's chat ID stored in env: `TELEGRAM_CHAT_ID`
- [ ] PM can send a notification via:
  ```bash
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" \
    -d parse_mode="Markdown" \
    -d text="${message}"
  ```
- [ ] Notification format includes: task ID, worker peer ID, issue description, context from design docs
- [ ] Escalation triggers:
  - Worker asks unanswerable question → Telegram
  - CI fails 3 times on same issue → Telegram
  - Worker stuck >45 min → Telegram
  - Architectural decision needed → Telegram with options + trade-offs

**Notes:** v1 is one-way (PM → Hunter). Hunter responds by typing in the PM terminal session directly. A two-way Telegram integration (Hunter replies in Telegram, PM receives it) is a stretch goal.

---

## Epic 8: End-to-End Integration

### US-8.1: Run the full orchestration loop with a single worker

**As** the PM, **I need** to execute the complete cycle — fetch task → spawn worker → monitor → verify → PR → merge notification **so that** I can validate the entire system works before scaling to 5 workers.

**Acceptance Criteria:**
- [ ] PM launched with system prompt via `--append-system-prompt`
- [ ] PM fetches AGE-55 (first unblocked task) from Linear
- [ ] PM composes worker prompt from template + Linear task data
- [ ] Worker spawns in worktree, receives task, executes, self-checks
- [ ] Worker reports `task_complete` with passing self-check
- [ ] PM creates PR, monitors CI
- [ ] PM notifies Hunter that PR is ready
- [ ] After merge, PM cleans up worktree, updates Linear → "Done"
- [ ] PM fetches next unblocked task (AGE-56) and repeats
- [ ] Total cycle time measured and logged

**Notes:** This is the integration test. Run it against a real Linear task (AGE-55 is the scaffold task — good candidate because it's self-contained). Expect the first run to surface edge cases in message parsing, prompt composition, and state management.

---

### US-8.2: Scale to 3-5 concurrent workers

**As** the PM, **I need** to manage multiple workers simultaneously **so that** independent tasks execute in parallel and the build accelerates.

**Acceptance Criteria:**
- [ ] PM spawns up to 5 workers concurrently (configurable cap)
- [ ] PM correctly tracks state for each worker independently in `pm-state.json`
- [ ] PM handles interleaved messages from multiple workers without confusion
- [ ] PM respects dependency ordering: won't assign AGE-57 until AGE-56 is done, even if slots are available
- [ ] PM handles partial failures: if worker 3 fails, workers 1/2/4/5 continue unaffected
- [ ] PM detects worker slot opening (process exit or `task_complete`) and immediately fills it with next queued task
- [ ] Resource monitoring: PM logs memory usage warnings if machine resources are strained

---

### US-8.3: PM crash recovery and state reconciliation

**As** the PM, **I need** to recover gracefully from a crash **so that** in-flight work isn't lost and I can resume coordination.

**Acceptance Criteria:**
- [ ] On startup, PM reads `.claude/pm-state.json` for last known state
- [ ] PM reconciles against live sources:
  - `list_peers` → which workers are still running?
  - `git worktree list` → which worktrees still exist?
  - Linear statuses → which tasks are "In Progress" vs "Done"?
- [ ] PM resolves state conflicts:
  - Worker completed while PM was down → detect from Linear status or branch existence, mark as completed
  - Worker died while PM was down → detect from missing peer, re-queue task
  - Orphaned worktree (no active worker, no merged PR) → clean up
- [ ] PM resumes orchestration loop from reconciled state
- [ ] No duplicate task assignments after recovery

---

## Implementation Order

The stories have natural dependencies that suggest this build sequence:

```
US-1.1 (peers)
  └→ US-1.2 (protocol)
       └→ US-2.1 (PM prompt) + US-2.2 (worker templates)
            └→ US-3.1 (state persistence)
                 └→ US-4.1 (spawn worker)
                      └→ US-4.2 (monitor workers) + US-6.1 (Linear fetch)
                           └→ US-5.1 (verify + PR) + US-6.2 (Linear sync)
                                └→ US-7.1 (Telegram escalation)
                                     └→ US-8.1 (single worker E2E)
                                          └→ US-8.2 (multi-worker scale)
                                               └→ US-4.3 (cleanup) + US-5.2 (review loop)
                                                    └→ US-8.3 (crash recovery)
```

**Estimated effort:** 5-7 days of focused work (maps to PM-ORCHESTRATOR-DESIGN.md §14).