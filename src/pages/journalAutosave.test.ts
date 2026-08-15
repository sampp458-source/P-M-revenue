import { describe, expect, it, vi } from "vitest";
import { JournalAutosaveQueue } from "./journalAutosave";

describe("Journal ordered autosave queue", () => {
  it("debounces rapid input to the latest snapshot", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (snapshot: string, version: number) => ({ snapshot, version: version + 1 }));
    const result = vi.fn();
    const queue = new JournalAutosaveQueue(1, save, result, vi.fn(), 800);
    queue.schedule("first");
    queue.schedule("latest");
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("latest", 1);
    expect(result).toHaveBeenCalledWith({ snapshot: "latest", version: 2 });
    vi.useRealTimers();
  });

  it("serializes an input arriving during a save and uses the returned version", async () => {
    let release!: (value: { snapshot: string; version: number }) => void;
    const first = new Promise<{ snapshot: string; version: number }>((resolve) => { release = resolve; });
    const save = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ snapshot: "second", version: 3 });
    const queue = new JournalAutosaveQueue(1, save, vi.fn(), vi.fn(), 0);
    queue.schedule("first");
    const flushing = queue.flush();
    await Promise.resolve();
    queue.schedule("second");
    release({ snapshot: "first", version: 2 });
    await flushing;
    expect(save.mock.calls).toEqual([["first", 1], ["second", 2]]);
  });

  it("flushes pending input immediately before completion", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (_snapshot: string, version: number) => ({ version: version + 1 }));
    const queue = new JournalAutosaveQueue(4, save, vi.fn(), vi.fn(), 800);
    queue.schedule("last input");
    await queue.flush();
    expect(save).toHaveBeenCalledWith("last input", 4);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
