import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ZodError } from "zod";
import {
  PMStateSchema,
  WorkerRecord,
  Escalation,
  emptyPMState,
  type PMState,
} from "./pm-state.types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const DEFAULT_STATE_PATH = ".claude/pm-state.json";

// ---------------------------------------------------------------------------
// Low-level I/O
// ---------------------------------------------------------------------------

/**
 * Read and parse pm-state.json from disk.
 * Returns `null` when the file does not exist (first run).
 * Throws on parse/validation errors so callers can decide how to handle corruption.
 */
export async function readPMState(
  statePath: string = DEFAULT_STATE_PATH
): Promise<PMState | null> {
  const abs = resolve(statePath);

  if (!existsSync(abs)) {
    return null;
  }

  const raw = await readFile(abs, "utf-8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`pm-state.json is not valid JSON at ${abs}`, { cause });
  }

  const result = PMStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new PMStateValidationError(
      `pm-state.json failed schema validation at ${abs}`,
      result.error
    );
  }

  return result.data;
}

/**
 * Atomically write pm-state.json by writing to a temp file then renaming.
 * This prevents partial writes from corrupting state on crash.
 */
export async function writePMState(
  state: PMState,
  statePath: string = DEFAULT_STATE_PATH
): Promise<void> {
  const abs = resolve(statePath);
  const dir = dirname(abs);
  const tmp = `${abs}.tmp`;

  await mkdir(dir, { recursive: true });

  const updated: PMState = {
    ...state,
    last_updated_at: new Date().toISOString(),
  };

  await writeFile(tmp, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  await rename(tmp, abs);
}

// ---------------------------------------------------------------------------
// State transition helpers — called after every PM state change
// ---------------------------------------------------------------------------

/**
 * Register a newly spawned worker. Call immediately after the worker process
 * is launched and its peer-id is known.
 */
export async function spawnWorker(
  state: PMState,
  peerId: string,
  record: Omit<WorkerRecord, "spawned_at" | "last_message_at">,
  statePath?: string
): Promise<PMState> {
  const now = new Date().toISOString();
  const next: PMState = {
    ...state,
    active_workers: {
      ...state.active_workers,
      [peerId]: {
        ...record,
        spawned_at: now,
        last_message_at: now,
      },
    },
    // Remove from queue if it was queued
    queued_tasks: state.queued_tasks.filter((id) => id !== record.task_id),
  };
  await writePMState(next, statePath);
  return next;
}

/**
 * Update a worker's status (e.g. WORKING → SELF_CHECKING).
 * Also bumps last_message_at to now.
 */
export async function updateWorkerStatus(
  state: PMState,
  peerId: string,
  status: WorkerRecord["status"],
  statePath?: string
): Promise<PMState> {
  const existing = state.active_workers[peerId];
  if (!existing) {
    throw new Error(`No active worker with peer-id "${peerId}"`);
  }

  const next: PMState = {
    ...state,
    active_workers: {
      ...state.active_workers,
      [peerId]: {
        ...existing,
        status,
        last_message_at: new Date().toISOString(),
      },
    },
  };
  await writePMState(next, statePath);
  return next;
}

/**
 * Mark a task as completed and remove the worker from active_workers.
 */
export async function completeWorker(
  state: PMState,
  peerId: string,
  statePath?: string
): Promise<PMState> {
  const worker = state.active_workers[peerId];
  if (!worker) {
    throw new Error(`No active worker with peer-id "${peerId}"`);
  }

  const { [peerId]: _removed, ...remainingWorkers } = state.active_workers;

  const next: PMState = {
    ...state,
    active_workers: remainingWorkers,
    completed_tasks: [...state.completed_tasks, worker.task_id],
  };
  await writePMState(next, statePath);
  return next;
}

/**
 * Mark a worker as failed. If `requeue` is true the task goes back to the
 * front of the queue; otherwise it is simply dropped from active_workers.
 */
export async function failWorker(
  state: PMState,
  peerId: string,
  requeue: boolean,
  statePath?: string
): Promise<PMState> {
  const worker = state.active_workers[peerId];
  if (!worker) {
    throw new Error(`No active worker with peer-id "${peerId}"`);
  }

  const { [peerId]: _removed, ...remainingWorkers } = state.active_workers;

  const next: PMState = {
    ...state,
    active_workers: remainingWorkers,
    queued_tasks: requeue
      ? [worker.task_id, ...state.queued_tasks]
      : state.queued_tasks,
  };
  await writePMState(next, statePath);
  return next;
}

/**
 * Record an escalation to the human operator.
 */
export async function addEscalation(
  state: PMState,
  escalation: Omit<Escalation, "escalated_at" | "resolved">,
  statePath?: string
): Promise<PMState> {
  const next: PMState = {
    ...state,
    escalations: [
      ...state.escalations,
      {
        ...escalation,
        escalated_at: new Date().toISOString(),
        resolved: false,
      },
    ],
  };
  await writePMState(next, statePath);
  return next;
}

/**
 * Mark an escalation as resolved (human acknowledged).
 */
export async function resolveEscalation(
  state: PMState,
  taskId: string,
  statePath?: string
): Promise<PMState> {
  const next: PMState = {
    ...state,
    escalations: state.escalations.map((e) =>
      e.task_id === taskId ? { ...e, resolved: true } : e
    ),
  };
  await writePMState(next, statePath);
  return next;
}

/**
 * Enqueue a task for future assignment.
 * No-op if the task is already queued or active.
 */
export async function enqueueTask(
  state: PMState,
  taskId: string,
  statePath?: string
): Promise<PMState> {
  const alreadyActive = Object.values(state.active_workers).some(
    (w) => w.task_id === taskId
  );
  if (alreadyActive || state.queued_tasks.includes(taskId)) {
    return state;
  }

  const next: PMState = {
    ...state,
    queued_tasks: [...state.queued_tasks, taskId],
  };
  await writePMState(next, statePath);
  return next;
}

// ---------------------------------------------------------------------------
// Startup / load
// ---------------------------------------------------------------------------

/**
 * Load pm-state.json on PM startup.
 *
 * - If the file does not exist, returns a fresh empty state (first run).
 * - If the file is corrupted, backs it up and returns empty state so the PM
 *   can still start (reconciliation will rebuild from live sources).
 */
export async function loadPMState(
  statePath: string = DEFAULT_STATE_PATH
): Promise<{ state: PMState; recovered: boolean }> {
  try {
    const state = await readPMState(statePath);
    if (state === null) {
      return { state: emptyPMState(), recovered: false };
    }
    return { state, recovered: false };
  } catch (err) {
    // Back up the corrupt file before returning empty state
    const abs = resolve(statePath);
    if (existsSync(abs)) {
      const backup = `${abs}.corrupt.${Date.now()}`;
      await rename(abs, backup).catch(() => {
        // Best-effort — ignore if rename fails
      });
      console.error(
        `[pm-state] Corrupt state backed up to ${backup}. Starting fresh.`,
        err
      );
    }
    return { state: emptyPMState(), recovered: true };
  }
}

// ---------------------------------------------------------------------------
// Custom error type
// ---------------------------------------------------------------------------

export class PMStateValidationError extends Error {
  constructor(
    message: string,
    public readonly zodError: ZodError
  ) {
    super(message);
    this.name = "PMStateValidationError";
  }
}
