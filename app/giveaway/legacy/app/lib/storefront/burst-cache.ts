// A small in-memory cache for storefront reads that are the same for every shopper (the
// campaign, today's prize, the Shop & Earn products). When an email or text blast sends
// hundreds of people to the popup at once, each lookup runs once per few seconds instead of
// once per page load, and requests that arrive while it is running wait for that one result
// rather than starting their own. Failures are not cached.

interface Entry<T> {
  at: number;
  value?: T;
  pending?: Promise<T>;
}

const MAX_KEYS = 500;

export function burstCache(ttlMs: number, now: () => number = Date.now) {
  const entries = new Map<string, Entry<unknown>>();

  return {
    get<T>(key: string, load: () => Promise<T>): Promise<T> {
      const hit = entries.get(key) as Entry<T> | undefined;
      if (hit?.pending) return hit.pending;
      if (hit && "value" in hit && now() - hit.at < ttlMs)
        return Promise.resolve(hit.value as T);
      if (entries.size >= MAX_KEYS) entries.clear();
      const pending = load().then(
        (value) => {
          entries.set(key, { at: now(), value });
          return value;
        },
        (err) => {
          entries.delete(key);
          throw err;
        },
      );
      entries.set(key, { at: now(), pending });
      return pending;
    },
    clear() {
      entries.clear();
    },
  };
}
