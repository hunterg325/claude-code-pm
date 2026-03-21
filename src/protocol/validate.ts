/**
 * Runtime validation for PM ↔ Worker protocol messages.
 *
 * Keeps the validation logic co-located with the types so both paths
 * (stdout JSON parsing and claude-peers message receipt) use the same checks.
 */

import type {
  PMMessage,
  PMMessageType,
  WorkerMessage,
  WorkerMessageType,
  MessageEnvelope,
  SelfCheckResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail<T>(errors: string[]): ValidationResult<T> {
  return { ok: false, errors };
}

// ---------------------------------------------------------------------------
// Primitive guards
// ---------------------------------------------------------------------------

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return isObject(v) && Object.values(v).every(isString);
}

function isBooleanRecord(v: unknown): v is Record<string, boolean> {
  return isObject(v) && Object.values(v).every(isBoolean);
}

// ---------------------------------------------------------------------------
// Required field helpers
// ---------------------------------------------------------------------------

function requireString(obj: Record<string, unknown>, field: string, errors: string[]): string {
  const v = obj[field];
  if (!isString(v) || v.trim() === "") {
    errors.push(`"${field}" must be a non-empty string`);
    return "";
  }
  return v;
}

function requireBoolean(obj: Record<string, unknown>, field: string, errors: string[]): boolean {
  const v = obj[field];
  if (!isBoolean(v)) {
    errors.push(`"${field}" must be a boolean`);
    return false;
  }
  return v;
}

function requireStringArray(obj: Record<string, unknown>, field: string, errors: string[]): string[] {
  const v = obj[field];
  if (!isStringArray(v)) {
    errors.push(`"${field}" must be an array of strings`);
    return [];
  }
  return v;
}

// ---------------------------------------------------------------------------
// SelfCheckResult validation
// ---------------------------------------------------------------------------

export function validateSelfCheckResult(raw: unknown): ValidationResult<SelfCheckResult> {
  const errors: string[] = [];

  if (!isObject(raw)) {
    return fail(["SelfCheckResult must be an object"]);
  }

  requireBoolean(raw, "tests_pass", errors);
  requireBoolean(raw, "lint_pass", errors);
  requireBoolean(raw, "build_pass", errors);

  if (!isBooleanRecord(raw["acceptance_criteria"])) {
    errors.push('"acceptance_criteria" must be an object mapping strings to booleans');
  }

  if (raw["notes"] !== undefined && !isString(raw["notes"])) {
    errors.push('"notes" must be a string if present');
  }

  if (errors.length > 0) return fail(errors);

  return ok(raw as unknown as SelfCheckResult);
}

// ---------------------------------------------------------------------------
// PM message validation
// ---------------------------------------------------------------------------

const PM_MESSAGE_TYPES: PMMessageType[] = [
  "task_assignment",
  "clarification_response",
  "review_feedback",
  "ci_failure",
  "abort",
];

function validateTaskAssignment(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  requireString(raw, "message_id", errors);
  requireString(raw, "task_id", errors);
  requireString(raw, "task_title", errors);
  requireString(raw, "task_description", errors);
  requireStringArray(raw, "acceptance_criteria", errors);
  requireString(raw, "branch", errors);
  requireString(raw, "worktree_path", errors);
  requireStringArray(raw, "verification_commands", errors);
  requireStringArray(raw, "skills", errors);
  requireString(raw, "timestamp", errors);
  return errors;
}

function validateClarificationResponse(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  requireString(raw, "message_id", errors);
  requireString(raw, "in_reply_to", errors);
  requireString(raw, "task_id", errors);
  requireString(raw, "answer", errors);
  requireString(raw, "timestamp", errors);
  return errors;
}

function validateReviewFeedback(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  requireString(raw, "message_id", errors);
  requireString(raw, "task_id", errors);

  if (raw["pr_number"] !== undefined && !isNumber(raw["pr_number"])) {
    errors.push('"pr_number" must be a number if present');
  }

  if (!Array.isArray(raw["comments"])) {
    errors.push('"comments" must be an array');
  } else {
    raw["comments"].forEach((c: unknown, i: number) => {
      if (!isObject(c)) {
        errors.push(`comments[${i}] must be an object`);
        return;
      }
      if (!isString(c["file"])) errors.push(`comments[${i}].file must be a string`);
      if (c["line"] !== undefined && !isNumber(c["line"])) {
        errors.push(`comments[${i}].line must be a number if present`);
      }
      if (!isString(c["body"])) errors.push(`comments[${i}].body must be a string`);
    });
  }

  requireBoolean(raw, "require_self_check", errors);
  requireString(raw, "timestamp", errors);
  return errors;
}

function validateCIFailure(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  requireString(raw, "message_id", errors);
  requireString(raw, "task_id", errors);
  if (!isNumber(raw["pr_number"])) errors.push('"pr_number" must be a number');
  requireString(raw, "job_name", errors);
  requireString(raw, "failure_summary", errors);
  if (!isNumber(raw["failure_count"])) errors.push('"failure_count" must be a number');
  requireString(raw, "timestamp", errors);
  return errors;
}

function validateAbort(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  requireString(raw, "message_id", errors);
  requireString(raw, "task_id", errors);
  requireString(raw, "reason", errors);
  requireString(raw, "timestamp", errors);
  return errors;
}

export function validatePMMessage(raw: unknown): ValidationResult<PMMessage> {
  if (!isObject(raw)) return fail(["Message must be a JSON object"]);

  const type = raw["type"];
  if (!isString(type) || !(PM_MESSAGE_TYPES as string[]).includes(type)) {
    return fail([`"type" must be one of: ${PM_MESSAGE_TYPES.join(", ")}`]);
  }

  let errors: string[];
  switch (type as PMMessageType) {
    case "task_assignment":
      errors = validateTaskAssignment(raw);
      break;
    case "clarification_response":
      errors = validateClarificationResponse(raw);
      break;
    case "review_feedback":
      errors = validateReviewFeedback(raw);
      break;
    case "ci_failure":
      errors = validateCIFailure(raw);
      break;
    case "abort":
      errors = validateAbort(raw);
      break;
  }

  if (errors.length > 0) return fail(errors);
  return ok(raw as unknown as PMMessage);
}

// ---------------------------------------------------------------------------
// Worker message validation
// ---------------------------------------------------------------------------

const WORKER_MESSAGE_TYPES: WorkerMessageType[] = [
  "task_started",
  "question",
  "progress",
  "task_complete",
  "task_failed",
];

function validateTaskStarted(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  requireString(raw, "message_id", errors);
  requireString(raw, "task_id", errors);
  requireString(raw, "worker_peer_id", errors);
  requireString(raw, "branch", errors);
  requireString(raw, "timestamp", errors);
  return errors;
}

function validateQuestion(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  requireString(raw, "message_id", errors);
  requireString(raw, "task_id", errors);
  requireString(raw, "worker_peer_id", errors);
  requireString(raw, "question", errors);
  requireBoolean(raw, "blocking", errors);
  if (raw["context"] !== undefined && !isString(raw["context"])) {
    errors.push('"context" must be a string if present');
  }
  requireString(raw, "timestamp", errors);
  return errors;
}

function validateProgress(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  requireString(raw, "message_id", errors);
  requireString(raw, "task_id", errors);
  requireString(raw, "worker_peer_id", errors);
  if (!isNumber(raw["percent"]) || (raw["percent"] as number) < 0 || (raw["percent"] as number) > 100) {
    errors.push('"percent" must be a number between 0 and 100');
  }
  requireString(raw, "summary", errors);
  requireString(raw, "timestamp", errors);
  return errors;
}

function validateTaskComplete(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  requireString(raw, "message_id", errors);
  requireString(raw, "task_id", errors);
  requireString(raw, "worker_peer_id", errors);
  requireString(raw, "branch", errors);

  const selfCheckResult = validateSelfCheckResult(raw["self_check"]);
  if (!selfCheckResult.ok) {
    errors.push(...selfCheckResult.errors.map((e) => `self_check.${e}`));
  }

  requireString(raw, "summary", errors);
  requireString(raw, "timestamp", errors);
  return errors;
}

function validateTaskFailed(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  requireString(raw, "message_id", errors);
  requireString(raw, "task_id", errors);
  requireString(raw, "worker_peer_id", errors);
  requireString(raw, "error", errors);
  requireBoolean(raw, "recoverable", errors);
  requireString(raw, "timestamp", errors);
  return errors;
}

export function validateWorkerMessage(raw: unknown): ValidationResult<WorkerMessage> {
  if (!isObject(raw)) return fail(["Message must be a JSON object"]);

  const type = raw["type"];
  if (!isString(type) || !(WORKER_MESSAGE_TYPES as string[]).includes(type)) {
    return fail([`"type" must be one of: ${WORKER_MESSAGE_TYPES.join(", ")}`]);
  }

  let errors: string[];
  switch (type as WorkerMessageType) {
    case "task_started":
      errors = validateTaskStarted(raw);
      break;
    case "question":
      errors = validateQuestion(raw);
      break;
    case "progress":
      errors = validateProgress(raw);
      break;
    case "task_complete":
      errors = validateTaskComplete(raw);
      break;
    case "task_failed":
      errors = validateTaskFailed(raw);
      break;
  }

  if (errors.length > 0) return fail(errors);
  return ok(raw as unknown as WorkerMessage);
}

// ---------------------------------------------------------------------------
// Envelope validation
// ---------------------------------------------------------------------------

export function validateEnvelope(raw: unknown): ValidationResult<MessageEnvelope> {
  if (!isObject(raw)) return fail(["Envelope must be a JSON object"]);

  const errors: string[] = [];

  if (raw["protocol_version"] !== "1.0") {
    errors.push('"protocol_version" must be "1.0"');
  }

  requireString(raw, "from", errors);
  requireString(raw, "to", errors);

  if (errors.length > 0) return fail(errors);

  const payloadResult =
    validatePMMessage(raw["payload"]).ok
      ? validatePMMessage(raw["payload"])
      : validateWorkerMessage(raw["payload"]);

  if (!payloadResult.ok) {
    return fail(payloadResult.errors.map((e) => `payload.${e}`));
  }

  return ok(raw as unknown as MessageEnvelope);
}

// ---------------------------------------------------------------------------
// Parse helpers (JSON string → validated message)
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string from worker stdout and validate it as a WorkerMessage.
 * Workers in -p mode write one JSON object per line to stdout.
 */
export function parseWorkerStdout(line: string): ValidationResult<WorkerMessage> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return fail([`Invalid JSON: ${line.slice(0, 120)}`]);
  }
  return validateWorkerMessage(parsed);
}

/**
 * Parse a JSON string received via claude-peers send_message and validate it.
 * The outer envelope is optional — bare payloads are also accepted.
 */
export function parsePeersMessage(
  raw: unknown,
): ValidationResult<PMMessage | WorkerMessage> {
  // Try envelope first
  if (isObject(raw) && "protocol_version" in raw) {
    const envResult = validateEnvelope(raw);
    if (envResult.ok) return ok(envResult.value.payload);
    return envResult as ValidationResult<PMMessage | WorkerMessage>;
  }

  // Fall back to bare payload
  const pmResult = validatePMMessage(raw);
  if (pmResult.ok) return pmResult;

  const workerResult = validateWorkerMessage(raw);
  if (workerResult.ok) return workerResult;

  return fail([
    "Could not parse as PMMessage or WorkerMessage",
    ...pmResult.errors.map((e) => `PM: ${e}`),
    ...workerResult.errors.map((e) => `Worker: ${e}`),
  ]);
}
