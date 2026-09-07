// Private process memory only; HTTP responses remain no-store and role protected.
class ReportCache {
  constructor({ ttlMs = 45000, maxBytes = 32 * 1024 * 1024, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.maxBytes = maxBytes;
    this.now = now;
    this.entries = new Map();
    this.pending = new Map();
    this.bytes = 0;
  }
  async get(key, load) {
    const cached = this.entries.get(key);
    if (cached && cached.expires > this.now()) return cached.value;
    if (cached) this.remove(key);
    if (this.pending.has(key)) return this.pending.get(key);
    const pending = Promise.resolve()
      .then(load)
      .then((value) => {
        const bytes = Buffer.byteLength(JSON.stringify(value));
        if (bytes <= this.maxBytes) {
          while (this.entries.size >= 64 || this.bytes + bytes > this.maxBytes) {
            this.remove(this.entries.keys().next().value);
          }
          this.entries.set(key, { value, bytes, expires: this.now() + this.ttlMs });
          this.bytes += bytes;
        }
        return value;
      });
    this.pending.set(key, pending);
    try {
      return await pending;
    } finally {
      this.pending.delete(key);
    }
  }
  remove(key) {
    const cached = this.entries.get(key);
    if (cached) this.bytes -= cached.bytes;
    this.entries.delete(key);
  }
}
module.exports = { ReportCache };
