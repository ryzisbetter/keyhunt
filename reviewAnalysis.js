/**
 * cache.js — Caching System
 * --------------------------
 * Lightweight in-memory TTL cache for aggregated query results. Keyed by a
 * normalized (game + kind + amount) signature. In production this would be
 * Redis/Memcached; the interface here mirrors that so it can be swapped.
 *
 * Caching matters because aggregation across many sources is the expensive
 * step. A warm cache turns a multi-second search into an instant response.
 */

class TTLCache {
  constructor({ ttlMs = 1000 * 60 * 5, maxEntries = 500 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.store = new Map(); // key -> { value, expires }
    this.hits = 0;
    this.misses = 0;
  }

  static key({ game, kind, amount }) {
    return `${game.trim().toLowerCase()}::${kind}::${amount}`;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    // Refresh LRU position.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.store.size >= this.maxEntries) {
      // Evict oldest (first inserted) entry.
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      entries: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? +(this.hits / total).toFixed(3) : 0,
    };
  }

  clear() {
    this.store.clear();
  }
}

export const resultCache = new TTLCache({ ttlMs: 1000 * 60 * 5, maxEntries: 500 });
