import {
  createJournalDiagnosticId,
  journalPersistenceErrorFromUnknown,
  logJournalSaveFailure,
  safeJournalFailureDiagnostic,
  type JournalPersistenceContext,
  type JournalSaveFailureDiagnostic,
  type JournalValidationShape,
} from "./journalPersistenceDiagnostics";

export interface VersionedJournalSnapshot {
  version: number;
}

export type JournalSaveState = "idle" | "pending" | "saving" | "slow" | "saved" | "timeout" | "error";

export const JOURNAL_AUTOSAVE_TIMEOUT_MS = 20_000;
export const JOURNAL_AUTOSAVE_SLOW_MS = 8_000;

type SaveRevision<TSnapshot> = { revision: number; requestId: string; snapshot: TSnapshot; attemptNumber: number };
type RevisionWaiter = {
  targetRevision: number;
  resolve: (savedRevision: number) => void;
  reject: (error: unknown) => void;
};

export class JournalAutosaveQueueError extends Error {
  constructor(message: string, readonly kind: "timeout" | "disposed") {
    super(message);
    this.name = "JournalAutosaveQueueError";
  }
}

export class JournalAutosaveQueue<TSnapshot, TResult extends VersionedJournalSnapshot> {
  private draftRevision = 0;
  private savedRevision = 0;
  private pending: SaveRevision<TSnapshot> | null = null;
  private retryPending: SaveRevision<TSnapshot> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private runningRevision: SaveRevision<TSnapshot> | null = null;
  private activeController: AbortController | null = null;
  private waiters: RevisionWaiter[] = [];
  private disposed = false;
  private blockedFailure: Error | null = null;

  constructor(
    private version: number,
    private readonly save: (
      snapshot: TSnapshot,
      expectedVersion: number,
      requestId: string,
      signal: AbortSignal,
    ) => Promise<TResult>,
    private readonly onResult: (result: TResult) => void,
    private readonly onState: (state: JournalSaveState) => void,
    private readonly delay = 800,
    private readonly timeoutMs = JOURNAL_AUTOSAVE_TIMEOUT_MS,
    private readonly slowMs = JOURNAL_AUTOSAVE_SLOW_MS,
    private readonly requestIdFactory: () => string = () => crypto.randomUUID(),
    private readonly diagnostics?: {
      context: () => Pick<JournalPersistenceContext, "entryId" | "entryStatus">;
      onFailure: (diagnostic: JournalSaveFailureDiagnostic | null) => void;
      validationShape?: (snapshot: TSnapshot) => JournalValidationShape;
      now?: () => number;
      diagnosticIdFactory?: () => string;
    },
  ) {}

  schedule(snapshot: TSnapshot) {
    if (this.disposed) throw new JournalAutosaveQueueError("종료된 저장 큐에는 변경을 추가할 수 없습니다.", "disposed");
    this.draftRevision += 1;
    this.pending = { revision: this.draftRevision, requestId: this.requestIdFactory(), snapshot, attemptNumber: 0 };
    if (this.blockedFailure) {
      this.retryPending = null;
      this.onState("error");
      return this.draftRevision;
    }
    this.diagnostics?.onFailure(null);
    this.onState("pending");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, this.delay);
    return this.draftRevision;
  }

  async flush(targetRevision = this.draftRevision) {
    if (this.disposed) throw new JournalAutosaveQueueError("저장 큐가 종료되었습니다.", "disposed");
    if (targetRevision <= this.savedRevision) return this.savedRevision;
    if (this.blockedFailure) throw this.blockedFailure;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const completion = new Promise<number>((resolve, reject) => {
      this.waiters.push({ targetRevision, resolve, reject });
    });
    void this.drain();
    return completion;
  }

  dismissError() {
    if (this.disposed) return;
    if (this.blockedFailure) {
      this.onState("error");
      return;
    }
    this.diagnostics?.onFailure(null);
    this.onState(this.pending || this.retryPending ? "pending" : this.savedRevision === this.draftRevision ? "saved" : "idle");
  }

  acknowledgeExternalVersion(version: number) {
    if (this.pending || this.retryPending || this.running) throw new Error("JOURNAL_AUTOSAVE_EXTERNAL_VERSION_WITH_PENDING_SAVE");
    this.version = version;
  }

  getDraftRevision() { return this.draftRevision; }
  getSavedRevision() { return this.savedRevision; }
  getPendingRevision() { return this.pending?.revision ?? this.retryPending?.revision ?? null; }
  getRunningRevision() { return this.runningRevision?.revision ?? null; }
  isSynchronized() { return !this.pending && !this.retryPending && !this.running && this.savedRevision === this.draftRevision; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.activeController?.abort();
    this.activeController = null;
    const error = new JournalAutosaveQueueError("저장 큐가 종료되었습니다.", "disposed");
    this.settleWaiters(error);
    if (this.pending || this.retryPending || this.runningRevision) this.onState("error");
  }

  private settleWaiters(error?: unknown) {
    const remaining: RevisionWaiter[] = [];
    this.waiters.forEach((waiter) => {
      if (error !== undefined) waiter.reject(error);
      else if (waiter.targetRevision <= this.savedRevision) waiter.resolve(this.savedRevision);
      else remaining.push(waiter);
    });
    this.waiters = error === undefined ? remaining : [];
  }

  private async saveWithDeadline(item: SaveRevision<TSnapshot>, expectedVersion: number) {
    const controller = new AbortController();
    this.activeController = controller;
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let slow: ReturnType<typeof setTimeout> | null = null;
    const request = Promise.resolve(this.save(item.snapshot, expectedVersion, item.requestId, controller.signal));
    void request.catch(() => undefined);
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new JournalAutosaveQueueError("저장을 완료하지 못했습니다.", "timeout"));
      }, this.timeoutMs);
    });
    slow = setTimeout(() => {
      if (!timedOut && !controller.signal.aborted) this.onState("slow");
    }, this.slowMs);
    try {
      return await Promise.race([request, deadline]);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (slow) clearTimeout(slow);
      if (this.activeController === controller) this.activeController = null;
    }
  }

  private drain() {
    if (this.running || this.disposed) return this.running;
    this.running = (async () => {
      try {
        while ((this.retryPending || this.pending) && !this.disposed) {
          const item = this.retryPending ?? this.pending;
          if (!item) break;
          if (this.retryPending) this.retryPending = null;
          else this.pending = null;
          this.runningRevision = item;
          this.onState("saving");
          const expectedVersion = this.version;
          item.attemptNumber += 1;
          const startedAt = this.diagnostics?.now?.() ?? Date.now();
          try {
            const result = await this.saveWithDeadline(item, expectedVersion);
            if (this.disposed) return;
            this.blockedFailure = null;
            this.diagnostics?.onFailure(null);
            this.version = result.version;
            this.savedRevision = Math.max(this.savedRevision, item.revision);
            this.onResult(result);
            this.settleWaiters();
          } catch (error) {
            if (this.disposed) return;
            const contextValue = this.diagnostics?.context();
            const context: JournalPersistenceContext = {
              operation: "update_journal_entry_draft",
              entryId: contextValue?.entryId ?? "unknown-entry",
              entryStatus: contextValue?.entryStatus ?? "UNKNOWN",
              expectedVersion,
              requestId: item.requestId,
            };
            const failure = journalPersistenceErrorFromUnknown(
              error,
              context,
              {},
              error instanceof JournalAutosaveQueueError && error.kind === "timeout" ? "TIMEOUT" : undefined,
            );
            const endedAt = this.diagnostics?.now?.() ?? Date.now();
            const diagnostic = safeJournalFailureDiagnostic({
              diagnosticId: this.diagnostics?.diagnosticIdFactory?.() ?? createJournalDiagnosticId(),
              failureKind: failure.kind,
              operation: failure.operation,
              entryId: failure.entryId,
              entryStatus: failure.entryStatus,
              serverExpectedVersion: expectedVersion,
              localDraftRevision: item.revision,
              requestId: item.requestId,
              attemptNumber: item.attemptNumber,
              startedAt: new Date(startedAt).toISOString(),
              endedAt: new Date(endedAt).toISOString(),
              durationMs: Math.max(0, endedAt - startedAt),
              httpStatus: failure.httpStatus,
              postgresCode: failure.postgresCode,
              isTimeout: failure.isTimeout,
              isAbort: failure.isAbort,
              isNetwork: failure.isNetwork,
            }, failure, this.diagnostics?.validationShape?.(item.snapshot));
            if (this.diagnostics) {
              logJournalSaveFailure(diagnostic);
              this.diagnostics.onFailure(diagnostic);
            }
            if (failure.kind === "VERSION_CONFLICT") {
              this.blockedFailure = failure;
              this.pending = item;
              this.retryPending = null;
            } else {
              this.retryPending = item;
            }
            this.onState(failure.kind === "TIMEOUT" ? "timeout" : "error");
            this.settleWaiters(failure);
            return;
          } finally {
            this.runningRevision = null;
          }
        }
        if (!this.disposed && this.savedRevision === this.draftRevision) this.onState("saved");
      } finally {
        this.running = null;
        if ((this.retryPending || this.pending) && this.waiters.length > 0 && !this.disposed) void this.drain();
      }
    })();
    return this.running;
  }
}
