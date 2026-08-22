export interface JournalPreviewJob<TResult> {
  key: string;
  run: () => Promise<TResult>;
}

export class JournalPreviewScheduler<TResult> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: JournalPreviewJob<TResult> | null = null;
  private runningKey: string | null = null;
  private latestKey: string | null = null;
  private disposed = false;

  constructor(
    private readonly onStart: (key: string) => void,
    private readonly onResult: (key: string, result: TResult) => void,
    private readonly onError: (key: string, error: unknown) => void,
    private readonly delay = 280,
  ) {}

  request(job: JournalPreviewJob<TResult>, force = false) {
    if (this.disposed) return;
    this.latestKey = job.key;
    if (!force && (this.pending?.key === job.key || this.runningKey === job.key)) return;
    this.pending = job;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, this.delay);
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.latestKey = null;
  }

  private async drain() {
    if (this.disposed || this.runningKey || !this.pending) return;
    const job = this.pending;
    this.pending = null;
    this.runningKey = job.key;
    this.onStart(job.key);
    try {
      const result = await job.run();
      if (!this.disposed && this.latestKey === job.key) this.onResult(job.key, result);
    } catch (error) {
      if (!this.disposed && this.latestKey === job.key) this.onError(job.key, error);
    } finally {
      this.runningKey = null;
      if (!this.disposed && this.pending) void this.drain();
    }
  }
}
