import type { JournalAutosaveQueueSnapshot } from "./journalAutosave";

export const JOURNAL_COMPLETION_TIMEOUT_MS = 20_000;

export interface JournalCompletionDiagnostic {
  diagnosticId: string;
  activeEntryId: string;
  completionRequestId: string;
  expectedVersion: number;
  startedAt: string;
  endedAt: string;
  completionDurationMs: number;
  completionDeadlineMs: number;
  completionAbortTriggered: boolean;
  completionTimedOut: boolean;
  completionSettled: boolean;
  completionTargetRevision: number;
  completionExpectedVersion: number;
  completionLatestServerVersion: number;
  lastCompletionTransition: string;
  autosave: JournalAutosaveQueueSnapshot;
}

export class JournalCompletionError extends Error {
  constructor(
    message: string,
    readonly diagnostic: JournalCompletionDiagnostic,
    readonly kind: "timeout" | "abort" | "request",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "JournalCompletionError";
  }
}

export async function completeJournalWithDeadline<TResult>({
  entryId,
  expectedVersion,
  queueSnapshot,
  request,
  timeoutMs = JOURNAL_COMPLETION_TIMEOUT_MS,
  now = () => Date.now(),
  requestIdFactory = () => crypto.randomUUID(),
  requestId: suppliedRequestId,
  targetRevision,
  lifecycleSignal,
  diagnosticIdFactory = () => `JRN-COMPLETE-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
}: {
  entryId: string;
  expectedVersion: number;
  queueSnapshot: () => JournalAutosaveQueueSnapshot;
  request: (requestId: string, signal: AbortSignal) => Promise<TResult>;
  timeoutMs?: number;
  now?: () => number;
  requestIdFactory?: () => string;
  requestId?: string;
  targetRevision: number;
  lifecycleSignal?: AbortSignal;
  diagnosticIdFactory?: () => string;
}) {
  const startedAtMs = now();
  const requestId = suppliedRequestId ?? requestIdFactory();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  let abortTriggered = false;
  let lifecycleAbortHandler: (() => void) | null = null;
  const operation = Promise.resolve().then(() => request(requestId, controller.signal));
  void operation.catch(() => undefined);
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      abortTriggered = true;
      controller.abort();
      reject(new Error("JOURNAL_COMPLETION_TIMEOUT"));
    }, timeoutMs);
  });
  const lifecycleAbort = new Promise<never>((_resolve, reject) => {
    lifecycleAbortHandler = () => {
      abortTriggered = true;
      controller.abort();
      reject(new Error("JOURNAL_COMPLETION_ABORTED"));
    };
    if (lifecycleSignal?.aborted) lifecycleAbortHandler();
    else lifecycleSignal?.addEventListener("abort", lifecycleAbortHandler, { once: true });
  });

  try {
    return await Promise.race([operation, deadline, lifecycleAbort]);
  } catch (cause) {
    const endedAtMs = now();
    const autosave = queueSnapshot();
    const diagnostic: JournalCompletionDiagnostic = {
      diagnosticId: diagnosticIdFactory(),
      activeEntryId: entryId,
      completionRequestId: requestId,
      expectedVersion,
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      completionDurationMs: Math.max(0, endedAtMs - startedAtMs),
      completionDeadlineMs: timeoutMs,
      completionAbortTriggered: abortTriggered,
      completionTimedOut: timedOut,
      completionSettled: true,
      completionTargetRevision: targetRevision,
      completionExpectedVersion: expectedVersion,
      completionLatestServerVersion: autosave.expectedVersion,
      lastCompletionTransition: timedOut ? "completion_timeout" : lifecycleSignal?.aborted ? "completion_aborted" : "completion_request_failed",
      autosave,
    };
    console.error("[journal-completion]", diagnostic);
    throw new JournalCompletionError(
      timedOut ? "작성 완료 요청 시간이 초과되었습니다." : cause instanceof Error ? cause.message : "작성 완료 처리에 실패했습니다.",
      diagnostic,
      timedOut ? "timeout" : lifecycleSignal?.aborted ? "abort" : "request",
      { cause },
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    if (lifecycleSignal && lifecycleAbortHandler) lifecycleSignal.removeEventListener("abort", lifecycleAbortHandler);
  }
}

export function formatJournalCompletionDiagnostic(diagnostic: JournalCompletionDiagnostic) {
  const queue = diagnostic.autosave;
  return [
    ["DIAGNOSTIC_ID", diagnostic.diagnosticId],
    ["ACTIVE_ENTRY_ID", diagnostic.activeEntryId],
    ["DRAFT_REVISION", queue.draftRevision],
    ["PERSISTED_REVISION", queue.persistedRevision],
    ["PENDING_REVISION", queue.pendingRevision],
    ["IN_FLIGHT_REVISION", queue.inFlightRevision],
    ["LATEST_QUEUED_REVISION", queue.latestQueuedRevision],
    ["QUEUE_LENGTH", queue.queueLength],
    ["DEBOUNCE_PENDING", queue.debouncePending],
    ["FLUSH_TARGET_REVISION", queue.flushTargetRevision],
    ["FLUSH_WAITER_COUNT", queue.flushWaiterCount],
    ["AUTOSAVE_REQUEST_ID", queue.autosaveRequestId],
    ["COMPLETION_REQUEST_ID", diagnostic.completionRequestId],
    ["COMPLETION_STARTED_AT", diagnostic.startedAt],
    ["COMPLETION_DEADLINE_MS", diagnostic.completionDeadlineMs],
    ["COMPLETION_ABORT_TRIGGERED", diagnostic.completionAbortTriggered],
    ["COMPLETION_TIMED_OUT", diagnostic.completionTimedOut],
    ["COMPLETION_SETTLED", diagnostic.completionSettled],
    ["COMPLETION_TARGET_REVISION", diagnostic.completionTargetRevision],
    ["COMPLETION_EXPECTED_VERSION", diagnostic.completionExpectedVersion],
    ["COMPLETION_LATEST_SERVER_VERSION", diagnostic.completionLatestServerVersion],
    ["EXPECTED_VERSION", diagnostic.expectedVersion],
    ["LATEST_SERVER_VERSION", queue.expectedVersion],
    ["SAVING_DURATION_MS", queue.savingDurationMs],
    ["COMPLETION_DURATION_MS", diagnostic.completionDurationMs],
    ["LAST_SUCCESSFUL_SAVE_TIMESTAMP", queue.lastSuccessfulSaveTimestamp],
    ["LAST_COMPLETION_TRANSITION", diagnostic.lastCompletionTransition],
    ["AUTOSAVE_LAST_TRANSITION", queue.lastTransition],
    ["ABORT_STATE", queue.abortState],
    ["TIMEOUT_STATE", diagnostic.completionTimedOut || queue.timeoutState],
  ].map(([key, value]) => `${key}: ${value === null ? "NONE" : String(value)}`).join("\n");
}
