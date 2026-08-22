export interface JournalPreviewJob<TResult> {
  key: string;
  run: () => Promise<TResult>;
}

export const JOURNAL_PREVIEW_JOB_TIMEOUT_MS = 15_000;

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
    private readonly timeout = JOURNAL_PREVIEW_JOB_TIMEOUT_MS,
  ) {}

  request(job: JournalPreviewJob<TResult>, force = false) {
    if (this.disposed) return;
    this.latestKey = job.key;
    if (!force && this.runningKey === job.key) {
      this.clearPending();
      return;
    }
    if (!force && this.pending?.key === job.key) return;
    this.pending = job;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, this.delay);
  }

  dispose() {
    this.disposed = true;
    this.clearPending();
    this.latestKey = null;
  }

  private clearPending() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  private runWithTimeout(job: JournalPreviewJob<TResult>) {
    return new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("JOURNAL_PREVIEW_JOB_TIMEOUT")),
        this.timeout,
      );
      void Promise.resolve().then(job.run).then(resolve, reject).finally(() => clearTimeout(timeout));
    });
  }

  private continueWithLatestPending() {
    if (this.disposed) return;
    if (this.pending?.key === this.latestKey) void this.drain();
    else if (this.pending) this.clearPending();
  }

  private async drain() {
    if (this.disposed || this.runningKey || !this.pending) return;
    const job = this.pending;
    this.pending = null;
    if (job.key !== this.latestKey) return;
    this.runningKey = job.key;
    this.onStart(job.key);
    try {
      const result = await this.runWithTimeout(job);
      if (!this.disposed && this.latestKey === job.key) this.onResult(job.key, result);
    } catch (error) {
      if (!this.disposed && this.latestKey === job.key) this.onError(job.key, error);
    } finally {
      this.runningKey = null;
      this.continueWithLatestPending();
    }
  }
}
