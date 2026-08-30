import { afterEach, describe, expect, it, vi } from "vitest";
import type { JournalAutosaveQueueSnapshot } from "./journalAutosave";
import { completeJournalWithDeadline, formatJournalCompletionDiagnostic, JournalCompletionError } from "./journalCompletion";

const synchronizedQueue = (overrides: Partial<JournalAutosaveQueueSnapshot> = {}): JournalAutosaveQueueSnapshot => ({
  baseVersion: 8,
  draftRevision: 4,
  persistedRevision: 4,
  pendingRevision: null,
  inFlightRevision: null,
  latestQueuedRevision: 4,
  queueLength: 0,
  debouncePending: false,
  flushTargetRevision: null,
  flushWaiterCount: 0,
  autosaveRequestId: null,
  lastSuccessfulAutosaveRequestId: "autosave-request-4",
  expectedVersion: 8,
  savingDurationMs: null,
  lastSuccessfulSaveTimestamp: "2026-08-29T10:00:00.000Z",
  lastTransition: "revision_persisted",
  abortState: false,
  timeoutState: false,
  ...overrides,
});

afterEach(() => vi.useRealTimers());

describe("Journal completion deadline", () => {
  it("retries a pre-commit timeout with the same request ID and commits once", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    let mutations = 0;
    const request = vi.fn((requestId: string) => {
      calls += 1;
      if (calls === 1) return new Promise<{ version: number }>(() => undefined);
      expect(requestId).toBe("stable-precommit");
      mutations += 1;
      return Promise.resolve({ version: 9 });
    });
    const first = completeJournalWithDeadline({
      entryId: "entry-precommit", expectedVersion: 8, targetRevision: 4,
      queueSnapshot: () => synchronizedQueue(), requestId: "stable-precommit", request, timeoutMs: 20_000,
    });
    const rejection = expect(first).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(20_000);
    await rejection;
    await expect(completeJournalWithDeadline({
      entryId: "entry-precommit", expectedVersion: 8, targetRevision: 4,
      queueSnapshot: () => synchronizedQueue(), requestId: "stable-precommit", request, timeoutMs: 20_000,
    })).resolves.toEqual({ version: 9 });
    expect(new Set(request.mock.calls.map((call) => call[0]))).toEqual(new Set(["stable-precommit"]));
    expect(mutations).toBe(1);
    consoleError.mockRestore();
  });

  it("replays a post-commit lost response without duplicating completion or audit mutation", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ledger = new Map<string, { version: number }>();
    let completionMutations = 0;
    let auditMutations = 0;
    let calls = 0;
    const request = vi.fn((requestId: string) => {
      calls += 1;
      const replay = ledger.get(requestId);
      if (replay) return Promise.resolve(replay);
      completionMutations += 1;
      auditMutations += 1;
      const result = { version: 9 };
      ledger.set(requestId, result);
      if (calls === 1) return new Promise<{ version: number }>(() => undefined);
      return Promise.resolve(result);
    });
    const first = completeJournalWithDeadline({
      entryId: "entry-postcommit", expectedVersion: 8, targetRevision: 4,
      queueSnapshot: () => synchronizedQueue(), requestId: "stable-postcommit", request, timeoutMs: 20_000,
    });
    const rejection = expect(first).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(20_000);
    await rejection;
    await expect(completeJournalWithDeadline({
      entryId: "entry-postcommit", expectedVersion: 8, targetRevision: 4,
      queueSnapshot: () => synchronizedQueue(), requestId: "stable-postcommit", request, timeoutMs: 20_000,
    })).resolves.toEqual({ version: 9 });
    expect(completionMutations).toBe(1);
    expect(auditMutations).toBe(1);
    consoleError.mockRestore();
  });

  it("ignores a late first response after the retry result has become canonical", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let resolveLate!: (value: { version: number }) => void;
    const late = new Promise<{ version: number }>((resolve) => { resolveLate = resolve; });
    const request = vi.fn()
      .mockReturnValueOnce(late)
      .mockResolvedValueOnce({ version: 9 });
    const applied: number[] = [];
    const first = completeJournalWithDeadline({
      entryId: "entry-race", expectedVersion: 8, targetRevision: 4,
      queueSnapshot: () => synchronizedQueue(), requestId: "stable-race", request, timeoutMs: 20_000,
    });
    const rejected = first.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    const retry = await completeJournalWithDeadline<{ version: number }>({
      entryId: "entry-race", expectedVersion: 8, targetRevision: 4,
      queueSnapshot: () => synchronizedQueue(), requestId: "stable-race", request, timeoutMs: 20_000,
    });
    applied.push(retry.version);
    resolveLate({ version: 99 });
    await Promise.resolve();
    expect(applied).toEqual([9]);
    consoleError.mockRestore();
  });

  it("settles a permanently pending completion, aborts it, and emits only bounded state metadata", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let signal: AbortSignal | undefined;
    const completion = completeJournalWithDeadline({
      entryId: "entry-a",
      expectedVersion: 8,
      targetRevision: 4,
      queueSnapshot: () => synchronizedQueue(),
      request: (_requestId, requestSignal) => {
        signal = requestSignal;
        return new Promise(() => undefined);
      },
      timeoutMs: 20_000,
      now: () => Date.now(),
      requestIdFactory: () => "completion-request-a",
      diagnosticIdFactory: () => "JRN-COMPLETE-DEADLOCK",
    });
    const rejected = expect(completion).rejects.toMatchObject({
      kind: "timeout",
      diagnostic: {
        diagnosticId: "JRN-COMPLETE-DEADLOCK",
        activeEntryId: "entry-a",
        completionRequestId: "completion-request-a",
        completionTimedOut: true,
        completionAbortTriggered: true,
        completionSettled: true,
      },
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    consoleError.mockRestore();
  });

  it("settles request failures and preserves queue diagnostics without business text", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = await completeJournalWithDeadline({
      entryId: "entry-b",
      expectedVersion: 9,
      targetRevision: 5,
      queueSnapshot: () => synchronizedQueue({ draftRevision: 5, persistedRevision: 4, pendingRevision: 5, queueLength: 1 }),
      request: async () => { throw new Error("safe request failure"); },
      requestIdFactory: () => "completion-request-b",
      diagnosticIdFactory: () => "JRN-COMPLETE-FAILED",
    }).catch((error: unknown) => error as JournalCompletionError);
    expect(failure).toBeInstanceOf(JournalCompletionError);
    expect(failure.kind).toBe("request");
    const formatted = formatJournalCompletionDiagnostic(failure.diagnostic);
    expect(formatted).toContain("ACTIVE_ENTRY_ID: entry-b");
    expect(formatted).toContain("DRAFT_REVISION: 5");
    expect(formatted).toContain("PERSISTED_REVISION: 4");
    expect(formatted).toContain("QUEUE_LENGTH: 1");
    expect(formatted).toContain("COMPLETION_DEADLINE_MS: 20000");
    expect(formatted).toContain("COMPLETION_ABORT_TRIGGERED: false");
    expect(formatted).toContain("COMPLETION_TIMED_OUT: false");
    expect(formatted).toContain("COMPLETION_SETTLED: true");
    expect(formatted).toContain("COMPLETION_TARGET_REVISION: 5");
    expect(formatted).toContain("COMPLETION_EXPECTED_VERSION: 9");
    expect(formatted).toContain("LAST_COMPLETION_TRANSITION: completion_request_failed");
    expect(formatted).not.toContain("teacherComment");
    consoleError.mockRestore();
  });

  it("clears its deadline after success", async () => {
    vi.useFakeTimers();
    await expect(completeJournalWithDeadline({
      entryId: "entry-c",
      expectedVersion: 10,
      targetRevision: 4,
      queueSnapshot: () => synchronizedQueue(),
      request: async () => ({ version: 11 }),
      timeoutMs: 20_000,
    })).resolves.toEqual({ version: 11 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its deadline after a PT409-style server error", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const conflict = Object.assign(new Error("stale"), { code: "PT409" });
    await expect(completeJournalWithDeadline({
      entryId: "entry-conflict", expectedVersion: 10, targetRevision: 4,
      queueSnapshot: () => synchronizedQueue(), request: async () => { throw conflict; },
    })).rejects.toMatchObject({ kind: "request" });
    expect(vi.getTimerCount()).toBe(0);
    consoleError.mockRestore();
  });

  it("accepts a stable request ID for an idempotent retry after an ambiguous timeout", async () => {
    const request = vi.fn().mockResolvedValue({ version: 12 });
    await completeJournalWithDeadline({
      entryId: "entry-d",
      expectedVersion: 11,
      targetRevision: 4,
      queueSnapshot: () => synchronizedQueue(),
      requestId: "stable-completion-request",
      request,
    });
    expect(request).toHaveBeenCalledWith("stable-completion-request", expect.any(AbortSignal));
  });

  it("aborts and clears the deadline when the owning editor lifecycle ends", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const lifecycle = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const completion = completeJournalWithDeadline({
      entryId: "entry-unmount", expectedVersion: 11, targetRevision: 4,
      queueSnapshot: () => synchronizedQueue(), lifecycleSignal: lifecycle.signal,
      request: (_requestId, signal) => {
        requestSignal = signal;
        return new Promise(() => undefined);
      },
    });
    lifecycle.abort();
    await expect(completion).rejects.toMatchObject({ kind: "abort" });
    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    consoleError.mockRestore();
  });
});
