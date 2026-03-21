/**
 * PM ↔ Worker message protocol types.
 *
 * Workers in -p mode write structured JSON to stdout.
 * Interactive workers use send_message via claude-peers.
 * Both paths use the same message shapes.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** ISO-8601 timestamp string */
export type ISOTimestamp = string;

/** Linear task identifier, e.g. "AGE-55" */
export type TaskId = string;

/** claude-peers session identifier */
export type PeerId = string;

// ---------------------------------------------------------------------------
// SelfCheckResult
// ---------------------------------------------------------------------------

/**
 * Report emitted by a worker before declaring task_complete.
 * All boolean fields must be true for the PM to accept the result.
 */
export interface SelfCheckResult {
  /** Did the test suite pass? */
  tests_pass: boolean;
  /** Did the linter pass with zero errors? */
  lint_pass: boolean;
  /** Did the build succeed? */
  build_pass: boolean;
  /**
   * Map of acceptance criterion text → pass/fail.
   * Keys are the checkbox labels from the Linear task description.
   * Every value must be true for the PM to create a PR.
   */
  acceptance_criteria: Record<string, boolean>;
  /** Optional human-readable notes from the worker */
  notes?: string;
}

// ---------------------------------------------------------------------------
// PM → Worker messages
// ---------------------------------------------------------------------------

export interface TaskAssignmentMessage {
  type: "task_assignment";
  /** Unique message ID for correlation */
  message_id: string;
  task_id: TaskId;
  task_title: string;
  task_description: string;
  /** Extracted acceptance criteria checkboxes from Linear */
  acceptance_criteria: string[];
  /** Git branch the worker should create and push to */
  branch: string;
  /** Absolute path to the git worktree */
  worktree_path: string;
  /** Shell commands the worker must run to verify correctness */
  verification_commands: string[];
  /** Skill file paths to load (SKILL.md absolute paths) */
  skills: string[];
  timestamp: ISOTimestamp;
}

export interface ClarificationResponseMessage {
  type: "clarification_response";
  message_id: string;
  /** The message_id of the WorkerMessage question this answers */
  in_reply_to: string;
  task_id: TaskId;
  answer: string;
  timestamp: ISOTimestamp;
}

export interface ReviewFeedbackMessage {
  type: "review_feedback";
  message_id: string;
  task_id: TaskId;
  /** PR number if the PR already exists */
  pr_number?: number;
  /** List of review comments to address */
  comments: ReviewComment[];
  /** Whether the worker must re-run self-check after addressing comments */
  require_self_check: boolean;
  timestamp: ISOTimestamp;
}

export interface ReviewComment {
  /** File path, or "general" for PR-level comments */
  file: string;
  /** Line number, omitted for general comments */
  line?: number;
  body: string;
}

export interface CIFailureMessage {
  type: "ci_failure";
  message_id: string;
  task_id: TaskId;
  pr_number: number;
  /** Which CI job failed */
  job_name: string;
  /** Truncated failure log (last ~100 lines) */
  failure_summary: string;
  /** How many times this CI check has failed on this PR */
  failure_count: number;
  timestamp: ISOTimestamp;
}

export interface AbortMessage {
  type: "abort";
  message_id: string;
  task_id: TaskId;
  reason: string;
  timestamp: ISOTimestamp;
}

/** Union of all messages the PM sends to workers */
export type PMMessage =
  | TaskAssignmentMessage
  | ClarificationResponseMessage
  | ReviewFeedbackMessage
  | CIFailureMessage
  | AbortMessage;

export type PMMessageType = PMMessage["type"];

// ---------------------------------------------------------------------------
// Worker → PM messages
// ---------------------------------------------------------------------------

export interface TaskStartedMessage {
  type: "task_started";
  message_id: string;
  task_id: TaskId;
  worker_peer_id: PeerId;
  /** Branch the worker created */
  branch: string;
  timestamp: ISOTimestamp;
}

export interface QuestionMessage {
  type: "question";
  message_id: string;
  task_id: TaskId;
  worker_peer_id: PeerId;
  question: string;
  /**
   * If true, the worker is paused and waiting for an answer before continuing.
   * If false, the worker continues and will incorporate the answer when it arrives.
   */
  blocking: boolean;
  /** Context that may help the PM answer without escalating */
  context?: string;
  timestamp: ISOTimestamp;
}

export interface ProgressMessage {
  type: "progress";
  message_id: string;
  task_id: TaskId;
  worker_peer_id: PeerId;
  /** 0–100 */
  percent: number;
  summary: string;
  timestamp: ISOTimestamp;
}

export interface TaskCompleteMessage {
  type: "task_complete";
  message_id: string;
  task_id: TaskId;
  worker_peer_id: PeerId;
  branch: string;
  /** The worker's self-check report — PM validates this before creating a PR */
  self_check: SelfCheckResult;
  /** Short human-readable summary of what was implemented */
  summary: string;
  timestamp: ISOTimestamp;
}

export interface TaskFailedMessage {
  type: "task_failed";
  message_id: string;
  task_id: TaskId;
  worker_peer_id: PeerId;
  error: string;
  /**
   * If true, the PM should re-queue the task and try again.
   * If false, human intervention is required — PM escalates to Telegram.
   */
  recoverable: boolean;
  timestamp: ISOTimestamp;
}

/** Union of all messages workers send to the PM */
export type WorkerMessage =
  | TaskStartedMessage
  | QuestionMessage
  | ProgressMessage
  | TaskCompleteMessage
  | TaskFailedMessage;

export type WorkerMessageType = WorkerMessage["type"];

// ---------------------------------------------------------------------------
// Envelope (used when messages are transmitted via claude-peers)
// ---------------------------------------------------------------------------

export interface MessageEnvelope<T extends PMMessage | WorkerMessage = PMMessage | WorkerMessage> {
  /** Protocol version for forward compatibility */
  protocol_version: "1.0";
  from: PeerId;
  to: PeerId;
  payload: T;
}
