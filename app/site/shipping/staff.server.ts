// Staff gate for the site's back-office pages. A signed-in site customer whose email is listed in
// SITE_STAFF_EMAILS (comma-separated). Everyone else, and every request when CARDBIT_SITE is off,
// gets a plain 404 so the pages don't advertise themselves.

export type StaffUser = { id: string; email: string };
/** signedInAt = when this browser's session was created (a fresh sign-in, not a rolled visit). */
export type SessionResolver = (request: Request) => Promise<{ id: string; email: string | null; signedInAt?: Date | null } | null>;

/** Staff tools need a sign-in from the last SITE_STAFF_SESSION_HOURS (default 12), not just a 90-day customer session. */
export const staffFreshMs = (env: NodeJS.ProcessEnv = process.env) => {
  const h = Number(env.SITE_STAFF_SESSION_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 12) * 3_600_000;
};



export function staffEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.SITE_STAFF_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function staffUser(
  request: Request,
  resolve: SessionResolver,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StaffUser | null> {
  if (env.CARDBIT_SITE !== "on") return null;
  const allowed = staffEmails(env);
  if (!allowed.size) return null;
  const who = await resolve(request);
  const email = who?.email?.trim().toLowerCase();
  if (!who || !email || !allowed.has(email)) return null;
  if (!who.signedInAt || Date.now() - who.signedInAt.getTime() > staffFreshMs(env)) {
    const url = new URL(request.url);
    throw new Response(null, {
      status: 303,
      headers: { Location: `/sign-in?fresh=1&return_to=${encodeURIComponent(url.pathname + url.search)}`, "Cache-Control": "no-store" },
    });
  }
  return { id: who.id, email };
}

/** POSTs must come from this site (blocks cross-site form posts riding the session cookie). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
