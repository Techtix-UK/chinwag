/** Simple counting semaphore used to limit concurrent Chromium start-ups. */
export class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private readonly max: number) {}

  get pending() {
    return this.queue.length;
  }
  get running() {
    return this.active;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(() => {
      this.active++;
      resolve();
    }));
  }

  private release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}
