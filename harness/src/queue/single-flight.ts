type Task<T> = () => Promise<T>;

export class SingleFlightQueue {
  private chain: Promise<void> = Promise.resolve();

  enqueue<T>(task: Task<T>): Promise<T> {
    const run = this.chain.then(task);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export const globalQueue = new SingleFlightQueue();
