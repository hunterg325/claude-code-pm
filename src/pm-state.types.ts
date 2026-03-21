import { z } from "zod";

// ---------------------------------------------------------------------------
// Worker status
// ---------------------------------------------------------------------------

export const WorkerStatusSchema = z.enum([
  "WORKING",
  "BLOCKED",
  "SELF_CHECKING",
  "AWAITING_REVIEW",
]);

export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

// ---------------------------------------------------------------------------
// Individual worker record
// ---------------------------------------------------------------------------

export const WorkerRecordSchema = z.object({
  /** Linear task ID, e.g. "AGE-55" */
  task_id: z.string(),
  status: WorkerStatusSchema,
  /** ISO-8601 timestamp of when this worker was spawned */
  spawned_at: z.string().datetime(),
  /** ISO-8601 timestamp of the most recent message received from this worker */
  last_message_at: z.string().datetime(),
  /** Git branch the worker is operating on, e.g. "task/age-55-scaffold-monorepo" */
  branch: z.string(),
  /** Absolute or repo-relative path to the git worktree, e.g. ".claude/worktrees/task-age-55-..." */
  worktree_path: z.string(),
});

export type WorkerRecord = z.infer<typeof WorkerRecordSchema>;

// ---------------------------------------------------------------------------
// Escalation record
// ---------------------------------------------------------------------------

export const EscalationReasonSchema = z.enum([
  "UNANSWERABLE_QUESTION",
  "CI_FAIL_3X",
  "WORKER_STUCK",
  "ARCHITECTURAL_DECISION",
  "WORKER_FATAL_FAILURE",
]);

export type EscalationReason = z.infer<typeof EscalationReasonSchema>;

export const EscalationSchema = z.object({
  task_id: z.string(),
  peer_id: z.string(),
  reason: EscalationReasonSchema,
  message: z.string(),
  escalated_at: z.string().datetime(),
  /** Whether a human has acknowledged this escalation */
  resolved: z.boolean().default(false),
});

export type Escalation = z.infer<typeof EscalationSchema>;

// ---------------------------------------------------------------------------
// Root pm-state schema
// ---------------------------------------------------------------------------

export const PMStateSchema = z.object({
  /**
   * Map of peer-id → worker record for all currently active workers.
   * Peer IDs are assigned by the claude-peers broker.
   */
  active_workers: z.record(z.string(), WorkerRecordSchema),
  /** Linear task IDs that have been successfully merged */
  completed_tasks: z.array(z.string()),
  /** Linear task IDs waiting for a free worker slot, in priority order */
  queued_tasks: z.array(z.string()),
  /** Escalations sent to the human operator that are pending resolution */
  escalations: z.array(EscalationSchema),
  /** ISO-8601 timestamp of the last write — useful for detecting stale state */
  last_updated_at: z.string().datetime().optional(),
  /** Schema version for forward-compatibility */
  schema_version: z.literal(1).default(1),
});

export type PMState = z.infer<typeof PMStateSchema>;

// ---------------------------------------------------------------------------
// Helpers for constructing default/empty state
// ---------------------------------------------------------------------------

export function emptyPMState(): PMState {
  return {
    active_workers: {},
    completed_tasks: [],
    queued_tasks: [],
    escalations: [],
    last_updated_at: new Date().toISOString(),
    schema_version: 1,
  };
}
