// Serializes outbound effects without letting one failed effect poison the
// queue. Each caller receives its own result, including an uncertain failure;
// no item is retried or replayed by this queue. Callers own guards and timeouts.
export class OutboundQueue {
  constructor() {
    this.tail = Promise.resolve();
    this.queued = 0;
    this.running = false;
    this.completed = 0;
    this.failed = 0;
  }
  enqueue(task) {
    if (typeof task !== 'function') throw new TypeError('Outbound task must be a function');
    this.queued++;
    const result = this.tail.then(async () => {
      this.queued--;
      this.running = true;
      try {
        const value = await task();
        this.completed++;
        return value;
      } catch (error) {
        this.failed++;
        throw error;
      } finally {
        this.running = false;
      }
    });
    // Keep the caller's rejection while giving the next item a settled tail.
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
  idle() { return this.tail; }
  status() {
    return {queued: this.queued, running: this.running, completed: this.completed, failed: this.failed};
  }
}
