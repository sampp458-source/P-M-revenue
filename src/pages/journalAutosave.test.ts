import { afterEach, describe, expect, it, vi } from "vitest";
import { JournalAutosaveQueue, JournalAutosaveQueueError } from "./journalAutosave";
import { JournalPersistenceError, type JournalSaveFailureDiagnostic } from "./journalPersistenceDiagnostics";

const signal = expect.any(AbortSignal);

afterEach(() => vi.useRealTimers());

describe("Journal revision autosave queue", () => {
  it("debounces rapid input to the latest revision and request", async () => {
    vi.useFakeTimers();
    const ids = ["request-1", "request-2"];
    const save = vi.fn(async (snapshot: string, version: number) => ({ snapshot, version: version + 1 }));
    const result = vi.fn();
    const queue = new JournalAutosaveQueue(1, save, result, vi.fn(), 800, 20_000, 8_000, () => ids.shift()!);
    expect(queue.schedule("first")).toBe(1);
    expect(queue.schedule("latest")).toBe(2);
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("latest", 1, "request-2", signal);
    expect(result).toHaveBeenCalledWith({ snapshot: "latest", version: 2 });
    expect(queue.getDraftRevision()).toBe(2);
    expect(queue.getSavedRevision()).toBe(2);
    expect(queue.isSynchronized()).toBe(true);
  });

  it("joins a running revision and saves a newer edit before its target flush resolves", async () => {
    let releaseFirst!: (value: { snapshot: string; version: number }) => void;
    const first = new Promise<{ snapshot: string; version: number }>((resolve) => { releaseFirst = resolve; });
    const save = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ snapshot: "second", version: 3 });
    const ids = ["request-1", "request-2"];
    const queue = new JournalAutosaveQueue(1, save, vi.fn(), vi.fn(), 800, 20_000, 8_000, () => ids.shift()!);
    queue.schedule("first");
    const firstFlush = queue.flush(1);
    await Promise.resolve();
    expect(queue.getRunningRevision()).toBe(1);
    queue.schedule("second");
    const latestFlush = queue.flush(2);
    expect(save).toHaveBeenCalledTimes(1);
    releaseFirst({ snapshot: "first", version: 2 });
    await firstFlush;
    expect(queue.getSavedRevision()).toBe(1);
    await latestFlush;
    expect(save.mock.calls).toEqual([
      ["first", 1, "request-1", signal],
      ["second", 2, "request-2", signal],
    ]);
    expect(queue.getSavedRevision()).toBe(2);
  });

  it("uses the saved fast path without a network request", async () => {
    const save = vi.fn();
    const queue = new JournalAutosaveQueue(1, save, vi.fn(), vi.fn());
    await expect(queue.flush(queue.getDraftRevision())).resolves.toBe(0);
    expect(save).not.toHaveBeenCalled();
  });

  it("aborts at the deadline, preserves the revision, and retries the same snapshot and request ID", async () => {
    vi.useFakeTimers();
    let firstSignal: AbortSignal | undefined;
    const never = new Promise<{ version: number }>(() => undefined);
    const save = vi.fn()
      .mockImplementationOnce((_snapshot, _version, _requestId, requestSignal) => {
        firstSignal = requestSignal;
        return never;
      })
      .mockResolvedValueOnce({ version: 2 });
    const states: string[] = [];
    const queue = new JournalAutosaveQueue(1, save, vi.fn(), (state) => states.push(state), 800, 20_000, 8_000, () => "request-stable");
    queue.schedule("unsaved input");
    const flushing = queue.flush(1);
    const timeoutResult = expect(flushing).rejects.toMatchObject({ kind: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(states.at(-1)).toBe("slow");
    await vi.advanceTimersByTimeAsync(12_000);
    await timeoutResult;
    expect(firstSignal?.aborted).toBe(true);
    expect(queue.getSavedRevision()).toBe(0);
    expect(queue.getPendingRevision()).toBe(1);
    await queue.flush(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0].slice(0, 3)).toEqual(["unsaved input", 1, "request-stable"]);
    expect(save.mock.calls[1].slice(0, 3)).toEqual(["unsaved input", 1, "request-stable"]);
    expect(queue.isSynchronized()).toBe(true);
  });

  it("keeps a failed snapshot pending for recovery", async () => {
    const save = vi.fn().mockRejectedValue(new Error("network unavailable"));
    const queue = new JournalAutosaveQueue(1, save, vi.fn(), vi.fn(), 800, 20_000, 8_000, () => "request-1");
    queue.schedule("preserved");
    await expect(queue.flush(1)).rejects.toThrow("network unavailable");
    expect(queue.getPendingRevision()).toBe(1);
    expect(queue.getSavedRevision()).toBe(0);
  });

  it("reconciles an ambiguous timed-out revision before saving an edit made during that request", async () => {
    vi.useFakeTimers();
    const save = vi.fn()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce({ version: 2 })
      .mockResolvedValueOnce({ version: 3 });
    const ids = ["request-1", "request-2"];
    const queue = new JournalAutosaveQueue(1, save, vi.fn(), vi.fn(), 800, 20_000, 8_000, () => ids.shift()!);
    queue.schedule("first");
    const firstFlush = queue.flush(1);
    const firstFailure = expect(firstFlush).rejects.toMatchObject({ kind: "TIMEOUT" });
    await Promise.resolve();
    queue.schedule("latest");
    const latestFlush = queue.flush(2);
    const latestFailure = expect(latestFlush).rejects.toMatchObject({ kind: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(20_000);
    await firstFailure;
    await latestFailure;
    await queue.flush(2);
    expect(save.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ["first", 1, "request-1"],
      ["first", 1, "request-1"],
      ["latest", 2, "request-2"],
    ]);
    expect(queue.isSynchronized()).toBe(true);
  });

  it("disposes explicitly, aborts a running request, and rejects its waiter", async () => {
    let activeSignal: AbortSignal | undefined;
    const save = vi.fn((_snapshot, _version, _requestId, requestSignal: AbortSignal) => {
      activeSignal = requestSignal;
      return new Promise<{ version: number }>(() => undefined);
    });
    const queue = new JournalAutosaveQueue(1, save, vi.fn(), vi.fn(), 800, 20_000, 8_000, () => "request-1");
    queue.schedule("pending");
    const flushing = queue.flush(1);
    await Promise.resolve();
    queue.dispose();
    await expect(flushing).rejects.toBeInstanceOf(JournalAutosaveQueueError);
    expect(activeSignal?.aborted).toBe(true);
    expect(() => queue.schedule("later")).toThrow("종료된 저장 큐");
  });

  it("captures timeout runtime evidence and retries the same request", async () => {
    vi.useFakeTimers();
    const diagnostics: Array<JournalSaveFailureDiagnostic | null> = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const save = vi.fn()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce({ version: 18 });
    const queue = new JournalAutosaveQueue(
      17,
      save,
      vi.fn(),
      vi.fn(),
      0,
      20_000,
      8_000,
      () => "request-timeout",
      {
        context: () => ({ entryId: "entry-1", entryStatus: "COMPLETED" }),
        onFailure: (diagnostic) => diagnostics.push(diagnostic),
        diagnosticIdFactory: () => "JRN-SAVE-TIMEOUT1",
      },
    );
    queue.schedule("local input");
    const first = queue.flush(1);
    const rejection = expect(first).rejects.toMatchObject({ kind: "TIMEOUT", isTimeout: true });
    await vi.advanceTimersByTimeAsync(20_000);
    await rejection;
    expect(diagnostics.at(-1)).toMatchObject({
      diagnosticId: "JRN-SAVE-TIMEOUT1",
      failureKind: "TIMEOUT",
      entryId: "entry-1",
      entryStatus: "COMPLETED",
      serverExpectedVersion: 17,
      localDraftRevision: 1,
      requestId: "request-timeout",
      attemptNumber: 1,
      durationMs: 20_000,
      isTimeout: true,
    });
    await queue.flush(1);
    expect(save.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ["local input", 17, "request-timeout"],
      ["local input", 17, "request-timeout"],
    ]);
    expect(diagnostics.at(-1)).toBeNull();
    consoleError.mockRestore();
  });

  it("keeps network retry idempotent and classifies explicit abort separately", async () => {
    const diagnostics: Array<JournalSaveFailureDiagnostic | null> = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const save = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ version: 2 });
    const queue = new JournalAutosaveQueue(
      1, save, vi.fn(), vi.fn(), 0, 20_000, 8_000, () => "request-network",
      {
        context: () => ({ entryId: "entry-1", entryStatus: "IN_PROGRESS" }),
        onFailure: (diagnostic) => diagnostics.push(diagnostic),
        diagnosticIdFactory: () => "JRN-SAVE-NETWORK1",
      },
    );
    queue.schedule("input");
    await expect(queue.flush(1)).rejects.toMatchObject({ kind: "NETWORK", isNetwork: true });
    expect(diagnostics.at(-1)).toMatchObject({ failureKind: "NETWORK", requestId: "request-network" });
    await queue.flush(1);
    expect(save.mock.calls[1].slice(0, 3)).toEqual(["input", 1, "request-network"]);

    const abortSave = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    const abortDiagnostics: Array<JournalSaveFailureDiagnostic | null> = [];
    const abortQueue = new JournalAutosaveQueue(
      1, abortSave, vi.fn(), vi.fn(), 0, 20_000, 8_000, () => "request-abort",
      {
        context: () => ({ entryId: "entry-1", entryStatus: "IN_PROGRESS" }),
        onFailure: (diagnostic) => abortDiagnostics.push(diagnostic),
      },
    );
    abortQueue.schedule("input");
    await expect(abortQueue.flush(1)).rejects.toMatchObject({ kind: "ABORT", isAbort: true });
    expect(abortDiagnostics.at(-1)).toMatchObject({ failureKind: "ABORT" });
    consoleError.mockRestore();
  });

  it("blocks blind retries after a version conflict while preserving newer local input", async () => {
    const diagnostics: Array<JournalSaveFailureDiagnostic | null> = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const conflict = new JournalPersistenceError(
      "VERSION_CONFLICT",
      "update_journal_entry_draft",
      "entry-1",
      "COMPLETED",
      17,
      "request-conflict",
      { httpStatus: 409, postgresCode: "PT409", message: "stale" },
    );
    const save = vi.fn().mockRejectedValue(conflict);
    const queue = new JournalAutosaveQueue(
      17, save, vi.fn(), vi.fn(), 0, 20_000, 8_000, () => "request-conflict",
      {
        context: () => ({ entryId: "entry-1", entryStatus: "COMPLETED" }),
        onFailure: (diagnostic) => diagnostics.push(diagnostic),
        diagnosticIdFactory: () => "JRN-SAVE-CONFLICT1",
      },
    );
    queue.schedule("unsaved input");
    await expect(queue.flush(1)).rejects.toMatchObject({ kind: "VERSION_CONFLICT" });
    expect(diagnostics.at(-1)).toMatchObject({
      failureKind: "VERSION_CONFLICT",
      serverExpectedVersion: 17,
      localDraftRevision: 1,
      requestId: "request-conflict",
    });
    await expect(queue.flush(1)).rejects.toBe(conflict);
    queue.schedule("newer local input");
    await expect(queue.flush(2)).rejects.toBe(conflict);
    expect(queue.getPendingRevision()).toBe(2);
    expect(queue.getSavedRevision()).toBe(0);
    expect(save).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
