import db from "../../db.server";

// Database-backed sliding window. Good enough for a single store; swap for Redis
// if entry volume ever needs it.

export async function hit(key: string, windowSeconds: number) {
  const since = new Date(Date.now() - windowSeconds * 1000);
  await db.rateLimitHit.create({ data: { key } });
  return db.rateLimitHit.count({ where: { key, createdAt: { gte: since } } });
}

export async function isLimited(
  key: string,
  limit: number,
  windowSeconds: number,
) {
  return (await hit(key, windowSeconds)) > limit;
}

/** Delete hits older than a day. Call from a periodic job. */
export function pruneRateLimits() {
  return db.rateLimitHit.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } },
  });
}
