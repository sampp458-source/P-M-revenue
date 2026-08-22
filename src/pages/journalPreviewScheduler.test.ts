import { describe, expect, it, vi } from "vitest";
import { JournalPreviewScheduler } from "./journalPreviewScheduler";

describe("Journal latest-only preview scheduler", () => {
  it("debounces rapid changes to one latest render", async () => {
    vi.useFakeTimers();
    const result = vi.fn();
    const first = vi.fn().mockResolvedValue("first");
    const latest = vi.fn().mockResolvedValue("latest");
    const scheduler = new JournalPreviewScheduler(vi.fn(), result, vi.fn(), 280);
    scheduler.request({ key: "first", run: first });
    scheduler.request({ key: "latest", run: latest });
    await vi.advanceTimersByTimeAsync(280);
    await Promise.resolve();
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(result).toHaveBeenCalledWith("latest", "latest");
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("does not let an obsolete running render overwrite the latest request", async () => {
    vi.useFakeTimers();
    let finishFirst!: (value: string) => void;
    const first = new Promise<string>((resolve) => { finishFirst = resolve; });
    const result = vi.fn();
    const latest = vi.fn().mockResolvedValue("latest-result");
    const scheduler = new JournalPreviewScheduler(vi.fn(), result, vi.fn(), 0);
    scheduler.request({ key: "first", run: () => first });
    await vi.runOnlyPendingTimersAsync();
    scheduler.request({ key: "latest", run: latest });
    await vi.runOnlyPendingTimersAsync();
    finishFirst("stale-result");
    await first;
    await Promise.resolve();
    await Promise.resolve();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(result).toHaveBeenCalledTimes(1);
    expect(result).toHaveBeenCalledWith("latest", "latest-result");
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("settles the active A job without starting obsolete B when navigation returns A", async () => {
    vi.useFakeTimers();
    let finishA!: (value: string) => void;
    const runningA = new Promise<string>((resolve) => { finishA = resolve; });
    const starts = vi.fn();
    const result = vi.fn();
    const runB = vi.fn().mockResolvedValue("B-result");
    const scheduler = new JournalPreviewScheduler(starts, result, vi.fn(), 0);

    scheduler.request({ key: "entry-A:revision-1", run: () => runningA });
    await vi.runOnlyPendingTimersAsync();
    scheduler.request({ key: "entry-B:revision-1", run: runB });
    scheduler.request({ key: "entry-A:revision-1", run: () => runningA });
    finishA("A-result");
    await runningA;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(starts).toHaveBeenCalledTimes(1);
    expect(runB).not.toHaveBeenCalled();
    expect(result).toHaveBeenCalledWith("entry-A:revision-1", "A-result");
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("runs the latest C job after rapid A to B to C navigation", async () => {
    vi.useFakeTimers();
    let finishA!: (value: string) => void;
    const runningA = new Promise<string>((resolve) => { finishA = resolve; });
    const result = vi.fn();
    const runB = vi.fn().mockResolvedValue("B-result");
    const runC = vi.fn().mockResolvedValue("C-result");
    const scheduler = new JournalPreviewScheduler(vi.fn(), result, vi.fn(), 0);

    scheduler.request({ key: "entry-A:revision-1", run: () => runningA });
    await vi.runOnlyPendingTimersAsync();
    scheduler.request({ key: "entry-B:revision-1", run: runB });
    scheduler.request({ key: "entry-C:revision-1", run: runC });
    finishA("A-result");
    await runningA;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(runB).not.toHaveBeenCalled();
    expect(runC).toHaveBeenCalledTimes(1);
    expect(result).toHaveBeenCalledTimes(1);
    expect(result).toHaveBeenCalledWith("entry-C:revision-1", "C-result");
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("settles a hung current render as an error instead of preparing forever", async () => {
    vi.useFakeTimers();
    const error = vi.fn();
    const scheduler = new JournalPreviewScheduler(vi.fn(), vi.fn(), error, 0, 100);
    scheduler.request({ key: "entry-A:revision-1", run: () => new Promise(() => undefined) });
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(100);
    expect(error).toHaveBeenCalledWith("entry-A:revision-1", expect.objectContaining({ message: "JOURNAL_PREVIEW_JOB_TIMEOUT" }));
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("reports only a current failure and disposes pending work", async () => {
    vi.useFakeTimers();
    const error = vi.fn();
    const pending = vi.fn().mockResolvedValue("unused");
    const scheduler = new JournalPreviewScheduler(vi.fn(), vi.fn(), error, 20);
    scheduler.request({ key: "failure", run: () => Promise.reject(new Error("failed")) });
    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();
    expect(error).toHaveBeenCalledTimes(1);
    scheduler.request({ key: "pending", run: pending });
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(20);
    expect(pending).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
