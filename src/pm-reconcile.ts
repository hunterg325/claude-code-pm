import { exec } from "node:child_process";
import { promisify } from "node:util";
import { writePMState } from "./pm-state.js";
import type { PMState, WorkerRecord } from "./pm-state.types.js";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// External source interfaces
// Implementations live in adapters/. These interfaces allow the reconciler
// to be tested with stubs before real integrations are wired up.
// ---------------------------------------------------------------------------

/** A peer registered with the claude-peers broker. */
export interface Peer {
  id: string;
  summary?: string;
  last_seen_at: string;
}

/**
 * Adapter for the claude-peers broker.
 * TODO: implement against the real claude-peers HTTP API on localhost:7899.
 */
export interface PeersAdapter {
  listPeers(): Promise<Peer[]>;
}

/** A Linear task with its current workflow status. */
export interface LinearTask {
  id: string;
  /** Linear workflow state name, e.g. "In Progress", "Done", "Todo" */
  status: string;
}

/**
 * Adapter for the Linear API.
 * TODO: implement using the Linear MCP tool or the Linear GraphQL API.
 */
export interface LinearAdapter {
  getTask(taskId: string): Promise<LinearTask | null>;
}

/** A git worktree entry from `git worktree list`. */
export interface GitWorktree {
  path: string;
  branch: string | null;
  isMain: boolean;
}

// ---------------------------------------------------------------------------
// Git worktree adapter (real implementation — no external deps)
// ---------------------------------------------------------------------------

/**
 * Parse the output of `git worktree list --porcelain`.
 *
 * Example output:
 *   worktree /repo
 *   HEAD abc123
 *   branch refs/heads/main
 *
 *   worktree /repo/.claude/worktrees/task-age-55-scaffold
 *   HEAD def456
 *   branch refs/heads/task/age-55-scaffold-monorepo
 */
export function parseGitWorktreeList(output: string): GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  const blocks = output.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    let path = "";
    let branch: string | null = null;
    let isMain = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length).trim();
      } else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length).trim();
        branch = ref.replace(/^refs\/heads\//, "");
      } else if (line === "bare") {
        isMain = true;
      }
    }

    // The first worktree block is always the main worktree
    if (worktrees.length === 0) {
      isMain = true;
    }

    if (path) {
      worktrees.push({ path, branch, isMain });
    }
  }

  return worktrees;
}

export async function listGitWorktrees(cwd?: string): Promise<GitWorktree[]> {
  const { stdout } = await execAsync("git worktree list --porcelain", {
    cwd: cwd ?? process.cwd(),
  });
  return parseGitWorktreeList(stdout);
}

// ---------------------------------------------------------------------------
// Reconciliation result
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  /** Workers that were in state but no longer have a live peer — re-queued */
  requeued: string[];
  /** Workers whose Linear task shows "Done" — moved to completed_tasks */
  markedComplete: string[];
  /** Orphaned worktrees that have no corresponding active worker */
  orphanedWorktrees: GitWorktree[];
  /** Final reconciled state */
  state: PMState;
}

// ---------------------------------------------------------------------------
// Core reconciliation logic
// ---------------------------------------------------------------------------

/**
 * Reconcile pm-state.json against three live sources:
 *   1. claude-peers broker  → which workers are still connected?
 *   2. git worktree list    → which worktrees still exist?
 *   3. Linear statuses      → which tasks are already Done?
 *
 * Rules:
 *   - Worker in state but NOT in live peers → assume dead, re-queue task
 *   - Worker's Linear task is "Done"        → move to completed_tasks
 *   - Worktree exists but no active worker  → flag as orphan (caller cleans up)
 *
 * This function does NOT mutate the input state — it returns a new state.
 * It writes the reconciled state to disk before returning.
 */
export async function reconcilePMState(
  state: PMState,
  peers: PeersAdapter,
  linear: LinearAdapter,
  statePath?: string,
  cwd?: string
): Promise<ReconciliationResult> {
  const requeued: string[] = [];
  const markedComplete: string[] = [];

  let next = { ...state };

  // -------------------------------------------------------------------------
  // Step 1: Check live peers
  // -------------------------------------------------------------------------
  const livePeers = await peers.listPeers();
  const livePeerIds = new Set(livePeers.map((p) => p.id));

  for (const [peerId, worker] of Object.entries(state.active_workers)) {
    if (!livePeerIds.has(peerId)) {
      // Worker is gone — re-queue its task unless already completed
      if (!state.completed_tasks.includes(worker.task_id)) {
        requeued.push(worker.task_id);
        console.info(
          `[reconcile] Worker ${peerId} (${worker.task_id}) not in live peers — re-queuing`
        );
      }

      const { [peerId]: _removed, ...rest } = next.active_workers;
      next = {
        ...next,
        active_workers: rest,
        queued_tasks: state.completed_tasks.includes(worker.task_id)
          ? next.queued_tasks
          : [worker.task_id, ...next.queued_tasks.filter((t) => t !== worker.task_id)],
      };
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Check Linear statuses for remaining active workers
  // -------------------------------------------------------------------------
  for (const [peerId, worker] of Object.entries(next.active_workers)) {
    const task = await linear.getTask(worker.task_id);

    if (task === null) {
      console.warn(
        `[reconcile] Linear task ${worker.task_id} not found — skipping`
      );
      continue;
    }

    if (task.status === "Done") {
      // Task completed while PM was down
      markedComplete.push(worker.task_id);
      console.info(
        `[reconcile] Task ${worker.task_id} is Done in Linear — marking complete`
      );

      const { [peerId]: _removed, ...rest } = next.active_workers;
      next = {
        ...next,
        active_workers: rest,
        completed_tasks: [...next.completed_tasks, worker.task_id],
        // Remove from queue if it somehow ended up there
        queued_tasks: next.queued_tasks.filter((t) => t !== worker.task_id),
      };
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Find orphaned worktrees
  // -------------------------------------------------------------------------
  let worktrees: GitWorktree[] = [];
  try {
    worktrees = await listGitWorktrees(cwd);
  } catch {
    console.warn("[reconcile] Could not list git worktrees — skipping orphan check");
  }

  const activeWorktreePaths = new Set(
    Object.values(next.active_workers).map((w) => w.worktree_path)
  );

  const orphanedWorktrees = worktrees.filter((wt) => {
    if (wt.isMain) return false;
    // A worktree is orphaned if it's under .claude/worktrees/ but has no owner
    const isManagedWorktree = wt.path.includes(".claude/worktrees/");
    return isManagedWorktree && !activeWorktreePaths.has(wt.path);
  });

  if (orphanedWorktrees.length > 0) {
    console.warn(
      `[reconcile] Found ${orphanedWorktrees.length} orphaned worktree(s):`,
      orphanedWorktrees.map((w) => w.path)
    );
  }

  // -------------------------------------------------------------------------
  // Step 4: Deduplicate queued_tasks (safety net)
  // -------------------------------------------------------------------------
  const seen = new Set<string>();
  next = {
    ...next,
    queued_tasks: next.queued_tasks.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  };

  // -------------------------------------------------------------------------
  // Persist reconciled state
  // -------------------------------------------------------------------------
  await writePMState(next, statePath);

  return {
    requeued,
    markedComplete,
    orphanedWorktrees,
    state: next,
  };
}

// ---------------------------------------------------------------------------
// Stub adapters for development / testing
// ---------------------------------------------------------------------------

/**
 * No-op peers adapter — reports no live peers.
 * Replace with a real HTTP client against localhost:7899.
 */
export class StubPeersAdapter implements PeersAdapter {
  constructor(private readonly peers: Peer[] = []) {}

  async listPeers(): Promise<Peer[]> {
    // TODO: implement GET http://localhost:7899/peers
    return this.peers;
  }
}

/**
 * No-op Linear adapter — reports every task as "In Progress".
 * Replace with the Linear MCP tool or Linear GraphQL client.
 */
export class StubLinearAdapter implements LinearAdapter {
  constructor(
    private readonly overrides: Record<string, string> = {}
  ) {}

  async getTask(taskId: string): Promise<LinearTask | null> {
    // TODO: implement via Linear MCP tool: get_issue({ id: taskId })
    return {
      id: taskId,
      status: this.overrides[taskId] ?? "In Progress",
    };
  }
}

// ---------------------------------------------------------------------------
// Convenience: build reconciliation adapters from environment
// ---------------------------------------------------------------------------

export interface ReconciliationAdapters {
  peers: PeersAdapter;
  linear: LinearAdapter;
}

/**
 * Build the default adapter set.
 * Stubs are used until real integrations are wired up.
 *
 * TODO: swap StubPeersAdapter for a real HTTP client once claude-peers is running.
 * TODO: swap StubLinearAdapter for the Linear MCP adapter once available.
 */
export function buildAdapters(): ReconciliationAdapters {
  return {
    peers: new StubPeersAdapter(),
    linear: new StubLinearAdapter(),
  };
}
