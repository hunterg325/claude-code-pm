# PM ↔ Worker Message Protocol

**Version:** 1.0  
**Source of truth:** This file + `src/protocol/types.ts`  
**Validation:** `src/protocol/validate.ts`  
**Examples:** `src/protocol/examples.ts`

---

## Overview

All messages are JSON objects. Workers in `-p` mode write one JSON object per line to stdout. Interactive workers send messages via `claude-peers` `send_message`. Both paths use the same message shapes.

The PM parses worker stdout lines with `parseWorkerStdout(line)` and receives peers messages with `parsePeersMessage(raw)`. Both functions return a `ValidationResult<WorkerMessage>` — reject any message where `ok === false`.

---

## Transport

| Path | Direction | Mechanism |
|------|-----------|-----------|
| `-p` mode worker output | Worker → PM | Worker writes JSON to stdout; PM reads process stdout |
| Interactive worker | Worker → PM | `send_message` via claude-peers |
| PM to worker | PM → Worker | `send_message` via claude-peers (worker must be registered as peer) |

**Envelope (optional):** When sending via claude-peers, messages may be wrapped in a `MessageEnvelope`:

```json
{
  "protocol_version": "1.0",
  "from": "<peer-id>",
  "to": "<peer-id>",
  "payload": { ...message }
}
```

Bare payloads (without the envelope) are also accepted.

---

## PM → Worker Messages

### `task_assignment`

Sent once per task. Contains everything the worker needs to start.

```json
{
  "type": "task_assignment",
  "message_id": "pm-msg-001",
  "task_id": "AGE-55",
  "task_title": "Scaffold monorepo structure",
  "task_description": "Set up the pnpm + Turborepo monorepo...",
  "acceptance_criteria": [
    "Monorepo root package.json created with workspaces",
    "pnpm-workspace.yaml lists all packages",
    "turbo.json pipeline defined for build/test/lint",
    "CI workflow passes on GitHub Actions"
  ],
  "branch": "task/age-55-scaffold-monorepo",
  "worktree_path": "/path/to/.claude/worktrees/task-age-55-scaffold-monorepo",
  "verification_commands": [
    "pnpm install",
    "pnpm turbo build",
    "pnpm turbo test",
    "pnpm turbo lint"
  ],
  "skills": ["/path/to/turborepo/SKILL.md"],
  "timestamp": "2026-03-21T10:00:00.000Z"
}
```

**Worker response:** `task_started` immediately, then `progress` updates, then `task_complete` or `task_failed`.

---

### `clarification_response`

Answer to a worker's `question`. The `in_reply_to` field must match the question's `message_id`.

```json
{
  "type": "clarification_response",
  "message_id": "pm-msg-002",
  "in_reply_to": "worker-msg-002",
  "task_id": "AGE-55",
  "answer": "Use Node 20. Cache the pnpm store with actions/cache.",
  "timestamp": "2026-03-21T10:05:00.000Z"
}
```

---

### `review_feedback`

Sent after PR review comments arrive. Worker must address all comments and re-run self-check if `require_self_check` is true.

```json
{
  "type": "review_feedback",
  "message_id": "pm-msg-003",
  "task_id": "AGE-55",
  "pr_number": 42,
  "comments": [
    {
      "file": "turbo.json",
      "line": 12,
      "body": "outputs should be dist/**, not build/**"
    },
    {
      "file": "general",
      "body": "Add a root-level README.md"
    }
  ],
  "require_self_check": true,
  "timestamp": "2026-03-21T11:00:00.000Z"
}
```

**Worker response:** Address comments, push, then send `task_complete` again.

---

### `ci_failure`

Sent when a CI check fails on the worker's PR. Worker must fix the failure and push.

```json
{
  "type": "ci_failure",
  "message_id": "pm-msg-004",
  "task_id": "AGE-55",
  "pr_number": 42,
  "job_name": "test (ubuntu-latest, node-20)",
  "failure_summary": "FAIL packages/core/src/__tests__/index.test.ts\n  TypeError: createContext is not a function",
  "failure_count": 1,
  "timestamp": "2026-03-21T11:30:00.000Z"
}
```

**Escalation rule:** If `failure_count >= 3`, PM escalates to Telegram instead of re-sending to worker.

---

### `abort`

Sent when the PM needs the worker to stop immediately (task cancelled, architectural conflict, etc.).

```json
{
  "type": "abort",
  "message_id": "pm-msg-005",
  "task_id": "AGE-55",
  "reason": "Task cancelled in Linear.",
  "timestamp": "2026-03-21T12:00:00.000Z"
}
```

**Worker behavior:** Stop all work, do not push, do not open PRs. Exit cleanly.

---

## Worker → PM Messages

### `task_started`

Sent immediately after receiving `task_assignment`. Confirms the worker is alive and on the right branch.

```json
{
  "type": "task_started",
  "message_id": "worker-msg-001",
  "task_id": "AGE-55",
  "worker_peer_id": "worker-age55-abc123",
  "branch": "task/age-55-scaffold-monorepo",
  "timestamp": "2026-03-21T10:00:30.000Z"
}
```

---

### `question`

Worker needs information to proceed. Two modes:

**Blocking** (`blocking: true`) — worker is paused, waiting for `clarification_response`:

```json
{
  "type": "question",
  "message_id": "worker-msg-002",
  "task_id": "AGE-55",
  "worker_peer_id": "worker-age55-abc123",
  "question": "Should I use Node 18 or Node 20 for the CI workflow?",
  "blocking": true,
  "context": "Setting up .github/workflows/ci.yml. No engines field in package.json.",
  "timestamp": "2026-03-21T10:03:00.000Z"
}
```

**Non-blocking** (`blocking: false`) — worker continues with its best guess:

```json
{
  "type": "question",
  "message_id": "worker-msg-003",
  "task_id": "AGE-55",
  "worker_peer_id": "worker-age55-abc123",
  "question": "Should I add a .nvmrc file?",
  "blocking": false,
  "context": "Proceeding with Node 20 and adding .nvmrc. Correct me if wrong.",
  "timestamp": "2026-03-21T10:04:00.000Z"
}
```

**PM behavior:**
- `blocking: true` → answer immediately; if unanswerable, escalate to Telegram
- `blocking: false` → answer async; log question + answer in Linear

---

### `progress`

Periodic status update. `percent` is 0–100.

```json
{
  "type": "progress",
  "message_id": "worker-msg-004",
  "task_id": "AGE-55",
  "worker_peer_id": "worker-age55-abc123",
  "percent": 60,
  "summary": "Monorepo structure created. Working on turbo.json and CI workflow.",
  "timestamp": "2026-03-21T10:15:00.000Z"
}
```

**PM behavior:** Update `pm-state.json`. Reset the 45-minute stuck timer.

---

### `task_complete`

Worker has finished and self-checked. PM validates `self_check` before creating a PR.

```json
{
  "type": "task_complete",
  "message_id": "worker-msg-005",
  "task_id": "AGE-55",
  "worker_peer_id": "worker-age55-abc123",
  "branch": "task/age-55-scaffold-monorepo",
  "self_check": {
    "tests_pass": true,
    "lint_pass": true,
    "build_pass": true,
    "acceptance_criteria": {
      "Monorepo root package.json created with workspaces": true,
      "pnpm-workspace.yaml lists all packages": true,
      "turbo.json pipeline defined for build/test/lint": true,
      "CI workflow passes on GitHub Actions": true
    },
    "notes": "All checks green. Build time 4.2s."
  },
  "summary": "Monorepo scaffolded. All 4 acceptance criteria met.",
  "timestamp": "2026-03-21T10:45:00.000Z"
}
```

**PM behavior:**
- If any `self_check` field is false → send `review_feedback` back to worker
- If all pass → run `git diff main...{branch}`, create PR, update Linear → "In Review"

---

### `task_failed`

Worker encountered an error it cannot resolve.

**Recoverable** — PM re-queues the task:

```json
{
  "type": "task_failed",
  "message_id": "worker-msg-006",
  "task_id": "AGE-55",
  "worker_peer_id": "worker-age55-abc123",
  "error": "pnpm install failed: ENOENT in worktree. Worktree may be corrupted.",
  "recoverable": true,
  "timestamp": "2026-03-21T10:20:00.000Z"
}
```

**Unrecoverable** — PM escalates to Telegram:

```json
{
  "type": "task_failed",
  "message_id": "worker-msg-007",
  "task_id": "AGE-55",
  "worker_peer_id": "worker-age55-abc123",
  "error": "Architectural conflict: two incompatible ORMs. Human decision required.",
  "recoverable": false,
  "timestamp": "2026-03-21T10:25:00.000Z"
}
```

---

## SelfCheckResult

Workers must run all verification commands before sending `task_complete`. Every field must be `true`.

```typescript
interface SelfCheckResult {
  tests_pass: boolean;           // test suite passed
  lint_pass: boolean;            // linter passed with zero errors
  build_pass: boolean;           // build succeeded
  acceptance_criteria: Record<string, boolean>;  // each criterion → pass/fail
  notes?: string;                // optional human-readable notes
}
```

The `acceptance_criteria` keys must match the strings in the `task_assignment.acceptance_criteria` array exactly.

---

## Validation

Import from `src/protocol/`:

```typescript
import { parseWorkerStdout, parsePeersMessage, validatePMMessage } from "./src/protocol/index.js";

// Parse worker stdout line
const result = parseWorkerStdout(line);
if (!result.ok) {
  console.error("Invalid worker message:", result.errors);
  return;
}
const msg = result.value; // typed as WorkerMessage

// Parse peers message (envelope or bare)
const result2 = parsePeersMessage(rawPayload);

// Validate before sending
const result3 = validatePMMessage(myMessage);
if (!result3.ok) throw new Error(result3.errors.join(", "));
```

---

## Message ID Convention

- PM messages: `pm-msg-{sequence}` (e.g. `pm-msg-001`)
- Worker messages: `worker-msg-{sequence}` (e.g. `worker-msg-001`)
- Sequence resets per session; uniqueness within a session is sufficient

---

## Stuck Worker Detection

If the PM receives no message from a worker for **45 minutes**, it escalates to Telegram. The timer resets on any `progress`, `question`, `task_started`, `task_complete`, or `task_failed` message.

---

## Protocol Version

The current version is `1.0`. If the protocol changes in a breaking way, increment the version and update this document and `src/protocol/types.ts`.
