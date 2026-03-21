/**
 * PM Orchestrator entry-point.
 *
 * On startup:
 *   1. Load pm-state.json (or start fresh on first run)
 *   2. Reconcile against live sources (peers, git worktrees, Linear)
 *   3. Hand off to the orchestration loop (not yet implemented)
 */
import { loadPMState, DEFAULT_STATE_PATH } from "./pm-state.js";
import { reconcilePMState, buildAdapters } from "./pm-reconcile.js";

async function main() {
  const statePath = process.env["PM_STATE_PATH"] ?? DEFAULT_STATE_PATH;

  // -------------------------------------------------------------------------
  // 1. Load persisted state
  // -------------------------------------------------------------------------
  const { state: loaded, recovered } = await loadPMState(statePath);

  if (recovered) {
    console.warn(
      "[pm] State file was corrupt — started fresh. Will reconcile from live sources."
    );
  } else {
    console.info("[pm] Loaded pm-state.json", {
      active_workers: Object.keys(loaded.active_workers).length,
      queued_tasks: loaded.queued_tasks.length,
      completed_tasks: loaded.completed_tasks.length,
    });
  }

  // -------------------------------------------------------------------------
  // 2. Reconcile against live sources
  // -------------------------------------------------------------------------
  const adapters = buildAdapters();
  const result = await reconcilePMState(loaded, adapters.peers, adapters.linear, statePath);

  console.info("[pm] Reconciliation complete", {
    requeued: result.requeued,
    markedComplete: result.markedComplete,
    orphanedWorktrees: result.orphanedWorktrees.map((w) => w.path),
  });

  // -------------------------------------------------------------------------
  // 3. TODO: start orchestration loop
  // -------------------------------------------------------------------------
  console.info("[pm] State reconciled. Orchestration loop not yet implemented.");
}

main().catch((err) => {
  console.error("[pm] Fatal error during startup", err);
  process.exit(1);
});
