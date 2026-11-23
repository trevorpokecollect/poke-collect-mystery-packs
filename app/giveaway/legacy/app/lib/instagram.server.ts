import db from "../db.server";

// The newest post on the store's Instagram account, for the "Like & Comment On Instagram" daily
// task (action config `latestInstagram`). Uses the Instagram API with Instagram Login: a
// long-lived token for the Cardbit professional account, set once in Railway as
// INSTAGRAM_ACCESS_TOKEN. Long-lived tokens last 60 days, so the app refreshes it weekly and
// keeps the newest one in AppValue. Any failure falls back to the task's own link.

const GRAPH = "https://graph.instagram.com";
const TOKEN_KEY = "instagram_token";
// Posts go up around 10:05am CT; checking every 10 minutes picks a new one up soon after.
const CACHE_MS = 10 * 60 * 1000;
const REFRESH_AFTER_MS = 7 * 24 * 3600 * 1000;

let cache: { url: string | null; at: number } | null = null;

async function token() {
  const env = process.env.CARDBIT_GIVEAWAY_INSTAGRAM_ACCESS_TOKEN?.trim();
  if (!env) return null;
  const saved = await db.appValue.findUnique({ where: { key: TOKEN_KEY } });
  // A new token pasted into Railway wins over the one saved from an earlier refresh.
  const current = saved && saved.value.split("|")[0] === env ? saved : null;
  const value = current ? current.value.split("|")[1] : env;
  if (!current || Date.now() - current.updatedAt.getTime() > REFRESH_AFTER_MS) {
    try {
      const res = await fetch(
        `${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(value)}`,
      );
      const body = (await res.json()) as { access_token?: string };
      if (res.ok && body.access_token) {
        // Stored as "<env token>|<current token>" so a newly pasted env token is noticed.
        await db.appValue.upsert({
          where: { key: TOKEN_KEY },
          create: { key: TOKEN_KEY, value: `${env}|${body.access_token}` },
          update: { value: `${env}|${body.access_token}` },
        });
        return body.access_token;
      }
    } catch {
      // Keep using the token we have; the next look tries again.
    }
  }
  return value;
}

/** Permalink of the newest post, or null (no token, API error). Cached for 10 minutes. */
export async function latestInstagramPost(now = Date.now()) {
  if (cache && now - cache.at < CACHE_MS) return cache.url;
  let url: string | null = cache?.url ?? null;
  try {
    const t = await token();
    if (t) {
      const res = await fetch(
        `${GRAPH}/me/media?fields=permalink,timestamp&limit=1&access_token=${encodeURIComponent(t)}`,
      );
      const body = (await res.json()) as {
        data?: { permalink?: string }[];
        error?: { message?: string };
      };
      if (res.ok && body.data?.[0]?.permalink) url = body.data[0].permalink;
      else
        console.warn(
          `[instagram] newest post lookup failed: ${body.error?.message ?? res.status}`,
        );
    }
  } catch (e) {
    console.warn(`[instagram] newest post lookup failed: ${String(e)}`);
  }
  cache = { url, at: now };
  return url;
}

/** Test hook. */
export function resetInstagramCache() {
  cache = null;
}
