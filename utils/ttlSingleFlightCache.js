/**
 * TTL + single-flight + LRU cache (ship-from-repo spec §3.5 "Caching and budget", NFR-011, BT-14).
 * Concurrent callers for one key share one in-flight promise; failures are never cached.
 */
class TtlSingleFlightCache {
  /**
   * @param {{ max?: number, now?: () => number }} [opts]
   */
  constructor({ max = 500, now = Date.now } = {}) {
    this.max = max;
    this.now = now;
    this.entries = new Map(); // key -> { value, expiresAt } (insertion order = LRU order)
    this.inflight = new Map(); // key -> Promise
  }

  /** Cached value or undefined (also refreshes LRU position). */
  peek(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs) {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value);
  }

  delete(key) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
    this.inflight.clear();
  }

  /**
   * @param {string} key
   * @param {() => Promise<any>} loader
   * @param {number | ((value:any) => number)} ttlMs  Static TTL or a function of the loaded value
   *        (e.g. 10 s while running, 60 s once terminal). A TTL ≤ 0 means "do not cache".
   */
  async get(key, loader, ttlMs) {
    const hit = this.peek(key);
    if (hit !== undefined) return hit;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const promise = (async () => {
      try {
        const value = await loader();
        const ttl = typeof ttlMs === 'function' ? ttlMs(value) : ttlMs;
        if (ttl > 0) this.set(key, value, ttl);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }
}

module.exports = TtlSingleFlightCache;
