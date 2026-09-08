const { failure } = require('./iiko-dashboard-client');

// Owner-only report results stay in bounded process memory, never in browser storage.
class ReportJobs {
  constructor({
    now = Date.now,
    ttlMs = 45000,
    deadlineMs = 180000,
    maxEntries = 16,
    maxBytes = 32 * 1024 * 1024,
  } = {}) {
    Object.assign(this, { now, ttlMs, deadlineMs, maxEntries, maxBytes });
    this.entries = new Map();
  }
  get(key, load) {
    for (const [id, entry] of this.entries) {
      if (entry.status === 'pending' && this.now() - entry.created >= this.deadlineMs) {
        Object.assign(entry, {
          status: 'failed',
          error: failure('IIKO_REPORT_TIMEOUT'),
          expires: this.now() + 5000,
        });
      }
      if (entry.expires <= this.now()) this.entries.delete(id);
    }
    let entry = this.entries.get(key);
    if (entry) return entry;
    while (this.entries.size >= this.maxEntries) {
      const finished = [...this.entries].find(([, item]) => item.status !== 'pending');
      if (!finished) throw failure('IIKO_REPORT_BUSY', 429);
      this.entries.delete(finished[0]);
    }
    entry = { status: 'pending', created: this.now(), expires: Infinity, bytes: 0 };
    this.entries.set(key, entry);
    entry.promise = Promise.resolve()
      .then(load)
      .then((value) => {
        if (entry.status !== 'pending') return;
        const bytes = Buffer.byteLength(JSON.stringify(value));
        if (bytes > this.maxBytes) throw failure('IIKO_REPORT_TOO_LARGE', 422);
        for (const [id, item] of this.entries) {
          const total = [...this.entries.values()].reduce((sum, row) => sum + row.bytes, 0);
          if (total + bytes <= this.maxBytes) break;
          if (id !== key && item.status !== 'pending') this.entries.delete(id);
        }
        Object.assign(entry, { status: 'ready', value, bytes, expires: this.now() + this.ttlMs });
      })
      .catch((error) => {
        Object.assign(entry, { status: 'failed', error, expires: this.now() + 5000 });
      });
    return entry;
  }
  read(key, load) {
    const entry = this.get(key, load);
    if (entry.status === 'failed') {
      this.entries.delete(key);
      throw entry.error;
    }
    return entry.status === 'ready' ? entry.value : { pending: true };
  }
  async result(key, load) {
    const entry = this.get(key, load);
    await entry.promise;
    if (entry.status === 'failed') throw entry.error;
    return entry.value;
  }
}
module.exports = { ReportJobs };
