// Staff gate for the site's back-office pages. A signed-in site customer whose email is listed in
// SITE_STAFF_EMAILS (comma-separated). Everyone else, and every request when CARDBIT_SITE is off,
// gets a plain 404 so the pages don't advertise themselves.

export type StaffUser = { id: string; email: string };
export type SessionResolver = (request: Request) => Promise<{ id: string; email: string | null } | null>;

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
