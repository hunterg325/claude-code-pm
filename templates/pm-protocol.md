# PM Protocol — Message Reference

> Single source of truth for all message types exchanged between PM, Worker, and VO agents.
> All messages are sent via claude-peers `send_message` as JSON strings.

---

## PM → Worker Messages

### `task_assignment`

Assigns a task to a newly spawned worker.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"task_assignment"` | Message type discriminator |
| `task_id` | `string` | Linear issue ID or internal task ID |
| `payload.title` | `string` | Short task title |
| `payload.description` | `string` | Full task description / requirements |
| `payload.acceptance_criteria` | `string[]` | List of criteria that must all pass |
| `payload.branch` | `string` | Git branch the worker must use |
| `payload.verify_commands` | `string[]` | Commands to run during self-check |
| `payload.architecture_context` | `string` | Relevant architecture notes injected from project docs |

```json
{
  "type": "task_assignment",
  "task_id": "ENG-142",
  "payload": {
    "title": "Add rate limiting to /api/upload endpoint",
    "description": "Implement a token-bucket rate limiter scoped per API key. Limit to 100 req/min. Return 429 with Retry-After header when exceeded.",
    "acceptance_criteria": [
      "Rate limiter enforces 100 req/min per API key",
      "Returns 429 with Retry-After header",
      "Unit tests cover limit exceeded and normal flow",
      "Existing tests still pass"
    ],
    "branch": "task/ENG-142-rate-limiting",
    "verify_commands": ["npm test", "npm run lint", "npm run build"],
    "architecture_context": "The API layer uses Express with middleware chain defined in src/middleware/index.ts. Rate limiting should be added as middleware before the route handler."
  }
}
```

### `clarification_response`

Answers a blocking question from a worker.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"clarification_response"` | Message type discriminator |
| `task_id` | `string` | Task the question relates to |
| `answer` | `string` | PM's answer to the worker's question |

```json
{
  "type": "clarification_response",
  "task_id": "ENG-142",
  "answer": "Use a simple in-memory Map for the token bucket store. We will add Redis backing in a follow-up task."
}
```

### `abort`

Tells a worker to stop work immediately.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"abort"` | Message type discriminator |
| `task_id` | `string` | Task to abort |
| `reason` | `string` | Why the task is being aborted |

```json
{
  "type": "abort",
  "task_id": "ENG-142",
  "reason": "Requirements changed — this endpoint is being removed in favor of a new upload service."
}
```

---

## VO → Worker Messages

### `review_feedback`

Sent when the VO rejects a PR and needs the worker to fix issues.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"review_feedback"` | Message type discriminator |
| `task_id` | `string` | Task under review |
| `comments` | `string[]` | List of issues the worker must address |

```json
{
  "type": "review_feedback",
  "task_id": "ENG-142",
  "comments": [
    "Rate limiter does not reset the token count after the window expires — tokens accumulate forever.",
    "Missing test for the Retry-After header value."
  ]
}
```

### `ci_failure`

Sent when CI fails on the worker's PR.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"ci_failure"` | Message type discriminator |
| `task_id` | `string` | Task whose CI failed |
| `log_url` | `string` | URL to the failed CI run |
| `failure_summary` | `string` | Condensed description of what failed |

```json
{
  "type": "ci_failure",
  "task_id": "ENG-142",
  "log_url": "https://github.com/acme/api/actions/runs/987654321",
  "failure_summary": "Test suite 'rate-limiter.test.ts' failed: expected 429 but received 200. Build step succeeded."
}
```

---

## Worker → PM Messages

### `task_started`

Sent once the worker has checked out its branch and is beginning work.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"task_started"` | Message type discriminator |
| `task_id` | `string` | Task being started |
| `peer_id` | `string` | Worker's claude-peers peer ID |

```json
{
  "type": "task_started",
  "task_id": "ENG-142",
  "peer_id": "worker-ENG-142-a1b2c3"
}
```

### `question`

Worker needs clarification before it can proceed.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"question"` | Message type discriminator |
| `task_id` | `string` | Related task |
| `question` | `string` | The question text |
| `blocking` | `boolean` | If `true`, worker is paused waiting for an answer |

```json
{
  "type": "question",
  "task_id": "ENG-142",
  "question": "Should the rate limiter state be stored in-memory or in Redis?",
  "blocking": true
}
```

### `progress`

Periodic progress update from worker to PM.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"progress"` | Message type discriminator |
| `task_id` | `string` | Related task |
| `percent` | `number` | Estimated completion percentage (0-100) |
| `summary` | `string` | Brief description of current status |

```json
{
  "type": "progress",
  "task_id": "ENG-142",
  "percent": 60,
  "summary": "Rate limiter middleware implemented. Writing unit tests now."
}
```

### `task_complete`

Worker declares the task done and reports self-check results.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"task_complete"` | Message type discriminator |
| `task_id` | `string` | Completed task |
| `branch` | `string` | Branch with the committed work |
| `summary` | `string` | What was done |
| `self_check` | `SelfCheckResult` | Results of verification commands |

```json
{
  "type": "task_complete",
  "task_id": "ENG-142",
  "branch": "task/ENG-142-rate-limiting",
  "summary": "Added token-bucket rate limiter middleware at src/middleware/rate-limiter.ts. Added 6 unit tests. All acceptance criteria met.",
  "self_check": {
    "tests_pass": true,
    "lint_pass": true,
    "build_pass": true,
    "acceptance_criteria": {
      "Rate limiter enforces 100 req/min per API key": true,
      "Returns 429 with Retry-After header": true,
      "Unit tests cover limit exceeded and normal flow": true,
      "Existing tests still pass": true
    }
  }
}
```

### `task_failed`

Worker cannot complete the task.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"task_failed"` | Message type discriminator |
| `task_id` | `string` | Failed task |
| `error` | `string` | What went wrong |
| `recoverable` | `boolean` | If `true`, PM may retry or reassign |

```json
{
  "type": "task_failed",
  "task_id": "ENG-142",
  "error": "Cannot implement rate limiting — the Express middleware chain is not exposed in the current architecture. Requires a refactor of src/server.ts first.",
  "recoverable": false
}
```

---

## VO → PM Messages

### `vo_started`

VO confirms it has begun reviewing a worker's completed task.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"vo_started"` | Message type discriminator |
| `task_id` | `string` | Task under review |
| `vo_peer_id` | `string` | VO agent's claude-peers peer ID |

```json
{
  "type": "vo_started",
  "task_id": "ENG-142",
  "vo_peer_id": "vo-ENG-142-d4e5f6"
}
```

### `vo_rejected`

VO found issues and sent feedback to the worker.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"vo_rejected"` | Message type discriminator |
| `task_id` | `string` | Task that was rejected |
| `reason` | `string` | Summary of rejection |
| `sent_to_worker` | `boolean` | Whether `review_feedback` was already sent to the worker |

```json
{
  "type": "vo_rejected",
  "task_id": "ENG-142",
  "reason": "Token bucket does not expire — tokens accumulate indefinitely. Missing Retry-After header test.",
  "sent_to_worker": true
}
```

### `vo_approved`

VO approved the work and created / approved the PR.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"vo_approved"` | Message type discriminator |
| `task_id` | `string` | Approved task |
| `pr_url` | `string` | URL of the pull request |
| `pr_number` | `number` | PR number |

```json
{
  "type": "vo_approved",
  "task_id": "ENG-142",
  "pr_url": "https://github.com/acme/api/pull/87",
  "pr_number": 87
}
```

### `vo_escalation`

VO cannot resolve an issue and needs PM intervention.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"vo_escalation"` | Message type discriminator |
| `task_id` | `string` | Task being escalated |
| `reason` | `string` | Why the VO is escalating |

```json
{
  "type": "vo_escalation",
  "task_id": "ENG-142",
  "reason": "Worker has failed to fix the token expiry bug after 3 review loops. Recommend reassigning or splitting the task."
}
```

---

## SelfCheckResult Interface

Returned by workers as part of `task_complete`.

```typescript
interface SelfCheckResult {
  tests_pass: boolean;
  lint_pass: boolean;
  build_pass: boolean;
  acceptance_criteria: Record<string, boolean>;
}
```

```json
{
  "tests_pass": true,
  "lint_pass": true,
  "build_pass": true,
  "acceptance_criteria": {
    "Rate limiter enforces 100 req/min per API key": true,
    "Returns 429 with Retry-After header": true,
    "Unit tests cover limit exceeded and normal flow": true,
    "Existing tests still pass": true
  }
}
```
