/**
 * Canonical example message pairs for each protocol type.
 *
 * Used for:
 * - Integration tests
 * - Worker prompt injection (show workers what valid output looks like)
 * - PM prompt injection (show PM what valid incoming messages look like)
 */

import type {
  TaskAssignmentMessage,
  ClarificationResponseMessage,
  ReviewFeedbackMessage,
  CIFailureMessage,
  AbortMessage,
  TaskStartedMessage,
  QuestionMessage,
  ProgressMessage,
  TaskCompleteMessage,
  TaskFailedMessage,
  SelfCheckResult,
  MessageEnvelope,
} from "./types.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TASK_ID = "AGE-55";
const WORKER_PEER_ID = "worker-age55-abc123";
const PM_PEER_ID = "pm-session-xyz789";
const BRANCH = "task/age-55-scaffold-monorepo";
const WORKTREE = "/Users/hunter/projects/ageflow/.claude/worktrees/task-age-55-scaffold-monorepo";
const TS = "2026-03-21T10:00:00.000Z";

// ---------------------------------------------------------------------------
// SelfCheckResult example
// ---------------------------------------------------------------------------

export const exampleSelfCheckPass: SelfCheckResult = {
  tests_pass: true,
  lint_pass: true,
  build_pass: true,
  acceptance_criteria: {
    "Monorepo root package.json created with workspaces": true,
    "pnpm-workspace.yaml lists all packages": true,
    "turbo.json pipeline defined for build/test/lint": true,
    "CI workflow passes on GitHub Actions": true,
  },
  notes: "All checks green. Build time 4.2s.",
};

export const exampleSelfCheckFail: SelfCheckResult = {
  tests_pass: false,
  lint_pass: true,
  build_pass: true,
  acceptance_criteria: {
    "Monorepo root package.json created with workspaces": true,
    "pnpm-workspace.yaml lists all packages": true,
    "turbo.json pipeline defined for build/test/lint": true,
    "CI workflow passes on GitHub Actions": false,
  },
  notes: "Test suite failing: 2 tests in packages/core/src/__tests__/index.test.ts",
};

// ---------------------------------------------------------------------------
// PM → Worker examples
// ---------------------------------------------------------------------------

export const exampleTaskAssignment: TaskAssignmentMessage = {
  type: "task_assignment",
  message_id: "pm-msg-001",
  task_id: TASK_ID,
  task_title: "Scaffold monorepo structure",
  task_description:
    "Set up the pnpm + Turborepo monorepo with packages/core, packages/api, and apps/web. " +
    "Configure the Turbo pipeline for build, test, and lint. Add a root-level CI workflow.",
  acceptance_criteria: [
    "Monorepo root package.json created with workspaces",
    "pnpm-workspace.yaml lists all packages",
    "turbo.json pipeline defined for build/test/lint",
    "CI workflow passes on GitHub Actions",
  ],
  branch: BRANCH,
  worktree_path: WORKTREE,
  verification_commands: ["pnpm install", "pnpm turbo build", "pnpm turbo test", "pnpm turbo lint"],
  skills: [
    "/Users/hunter/.agents/skills/turborepo/SKILL.md",
    "/Users/hunter/.agents/skills/github-actions-templates/SKILL.md",
  ],
  timestamp: TS,
};

export const exampleClarificationResponse: ClarificationResponseMessage = {
  type: "clarification_response",
  message_id: "pm-msg-002",
  in_reply_to: "worker-msg-002",
  task_id: TASK_ID,
  answer:
    "Use Node 20 as the base image. The CI workflow should run on ubuntu-latest. " +
    "Cache pnpm store between runs using actions/cache.",
  timestamp: TS,
};

export const exampleReviewFeedback: ReviewFeedbackMessage = {
  type: "review_feedback",
  message_id: "pm-msg-003",
  task_id: TASK_ID,
  pr_number: 42,
  comments: [
    {
      file: "turbo.json",
      line: 12,
      body: 'The "outputs" field for the build task should include "dist/**" not "build/**".',
    },
    {
      file: ".github/workflows/ci.yml",
      line: 28,
      body: "Missing `--frozen-lockfile` flag on pnpm install step.",
    },
    {
      file: "general",
      body: "Please add a root-level README.md with setup instructions.",
    },
  ],
  require_self_check: true,
  timestamp: TS,
};

export const exampleCIFailure: CIFailureMessage = {
  type: "ci_failure",
  message_id: "pm-msg-004",
  task_id: TASK_ID,
  pr_number: 42,
  job_name: "test (ubuntu-latest, node-20)",
  failure_summary:
    "FAIL packages/core/src/__tests__/index.test.ts\n" +
    "  ● should export createContext\n" +
    "    TypeError: createContext is not a function\n" +
    "      at Object.<anonymous> (src/__tests__/index.test.ts:8:5)\n" +
    "\nTest Suites: 1 failed, 2 passed, 3 total\n" +
    "Tests:       1 failed, 14 passed, 15 total",
  failure_count: 1,
  timestamp: TS,
};

export const exampleAbort: AbortMessage = {
  type: "abort",
  message_id: "pm-msg-005",
  task_id: TASK_ID,
  reason:
    "Task AGE-55 has been cancelled in Linear. Stopping work immediately. " +
    "Do not push any branches or open PRs.",
  timestamp: TS,
};

// ---------------------------------------------------------------------------
// Worker → PM examples
// ---------------------------------------------------------------------------

export const exampleTaskStarted: TaskStartedMessage = {
  type: "task_started",
  message_id: "worker-msg-001",
  task_id: TASK_ID,
  worker_peer_id: WORKER_PEER_ID,
  branch: BRANCH,
  timestamp: TS,
};

export const exampleQuestionBlocking: QuestionMessage = {
  type: "question",
  message_id: "worker-msg-002",
  task_id: TASK_ID,
  worker_peer_id: WORKER_PEER_ID,
  question:
    "The CI workflow needs a Node version. Should I use Node 18 or Node 20? " +
    "Also, should I cache the pnpm store?",
  blocking: true,
  context:
    "I'm setting up .github/workflows/ci.yml. The package.json engines field is not set. " +
    "Using Node 20 LTS seems safest but want to confirm.",
  timestamp: TS,
};

export const exampleQuestionNonBlocking: QuestionMessage = {
  type: "question",
  message_id: "worker-msg-003",
  task_id: TASK_ID,
  worker_peer_id: WORKER_PEER_ID,
  question: "Should I add a .nvmrc file to the repo root?",
  blocking: false,
  context: "I'll proceed with Node 20 and add .nvmrc. Let me know if you want a different version.",
  timestamp: TS,
};

export const exampleProgress: ProgressMessage = {
  type: "progress",
  message_id: "worker-msg-004",
  task_id: TASK_ID,
  worker_peer_id: WORKER_PEER_ID,
  percent: 60,
  summary:
    "Monorepo structure created. packages/core and packages/api scaffolded. " +
    "Working on turbo.json pipeline and CI workflow.",
  timestamp: TS,
};

export const exampleTaskComplete: TaskCompleteMessage = {
  type: "task_complete",
  message_id: "worker-msg-005",
  task_id: TASK_ID,
  worker_peer_id: WORKER_PEER_ID,
  branch: BRANCH,
  self_check: exampleSelfCheckPass,
  summary:
    "Monorepo scaffolded with pnpm workspaces + Turborepo. " +
    "packages/core, packages/api, apps/web created. " +
    "CI workflow green on ubuntu-latest/node-20. All 4 acceptance criteria met.",
  timestamp: TS,
};

export const exampleTaskFailed: TaskFailedMessage = {
  type: "task_failed",
  message_id: "worker-msg-006",
  task_id: TASK_ID,
  worker_peer_id: WORKER_PEER_ID,
  error:
    "pnpm install failed with ENOENT: no such file or directory, open " +
    "'/Users/hunter/projects/ageflow/.claude/worktrees/task-age-55-scaffold-monorepo/node_modules/.modules.yaml'. " +
    "Worktree may have been corrupted. Cannot proceed.",
  recoverable: true,
  timestamp: TS,
};

export const exampleTaskFailedUnrecoverable: TaskFailedMessage = {
  type: "task_failed",
  message_id: "worker-msg-007",
  task_id: TASK_ID,
  worker_peer_id: WORKER_PEER_ID,
  error:
    "Architectural conflict: the task requires adding a new database schema but " +
    "the existing schema in packages/db/schema.ts uses a different ORM than specified " +
    "in the acceptance criteria. Human decision required on which ORM to standardize on.",
  recoverable: false,
  timestamp: TS,
};

// ---------------------------------------------------------------------------
// Envelope examples
// ---------------------------------------------------------------------------

export const examplePMEnvelope: MessageEnvelope<TaskAssignmentMessage> = {
  protocol_version: "1.0",
  from: PM_PEER_ID,
  to: WORKER_PEER_ID,
  payload: exampleTaskAssignment,
};

export const exampleWorkerEnvelope: MessageEnvelope<TaskCompleteMessage> = {
  protocol_version: "1.0",
  from: WORKER_PEER_ID,
  to: PM_PEER_ID,
  payload: exampleTaskComplete,
};

// ---------------------------------------------------------------------------
// Grouped exports for prompt injection and test iteration
// ---------------------------------------------------------------------------

export const PM_MESSAGE_EXAMPLES = {
  task_assignment: exampleTaskAssignment,
  clarification_response: exampleClarificationResponse,
  review_feedback: exampleReviewFeedback,
  ci_failure: exampleCIFailure,
  abort: exampleAbort,
} as const;

export const WORKER_MESSAGE_EXAMPLES = {
  task_started: exampleTaskStarted,
  question: exampleQuestionBlocking,
  progress: exampleProgress,
  task_complete: exampleTaskComplete,
  task_failed: exampleTaskFailed,
} as const;
