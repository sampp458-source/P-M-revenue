export interface VersionedJournalSnapshot {
  version: number;
}

export type JournalSaveState = "idle" | "saving" | "saved" | "error";

export class JournalAutosaveQueue<TSnapshot, TResult extends VersionedJournalSnapshot> {
  private pending: TSnapshot | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

  constructor(
    private version: number,
    private readonly save: (snapshot: TSnapshot, expectedVersion: number) => Promise<TResult>,
    private readonly onResult: (result: TResult) => void,
    private readonly onState: (state: JournalSaveState) => void,
    private readonly delay = 800,
  ) {}

  schedule(snapshot: TSnapshot) {
    this.pending = snapshot;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, this.delay);
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending && !this.running) return;
    const completion = new Promise<void>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
    void this.drain();
    return completion;
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  private settleWaiters(error?: unknown) {
    const waiters = this.waiters.splice(0);
    waiters.forEach((waiter) =>
      error === undefined ? waiter.resolve() : waiter.reject(error),
    );
  }

  private drain() {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        while (this.pending) {
          const snapshot = this.pending;
          this.pending = null;
          this.onState("saving");
          const result = await this.save(snapshot, this.version);
          this.version = result.version;
          this.onResult(result);
        }
        this.onState("saved");
        this.settleWaiters();
      } catch (error) {
        this.onState("error");
        this.pending = null;
        this.settleWaiters(error);
      } finally {
        this.running = null;
        if (this.pending) void this.drain();
      }
    })();
    return this.running;
  }
}
