import type { PrismaClient } from "@prisma/client";
import { StoreError } from "./store.server";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const siteOn = () => process.env.CARDBIT_SITE === "on";

/** Same-origin JSON POSTs only (blocks cross-site form posts riding the session cookie). */
export function sameOriginJson(request: Request) {
  const ct = request.headers.get("content-type")?.toLowerCase() || "";
  if (!ct.startsWith("application/json")) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host || new URL(origin).host === request.headers.get("x-forwarded-host");
  } catch {
    return false;
  }
}

export function storeErrorResponse(e: unknown) {
  if (e instanceof StoreError) return json({ error: e.message, code: e.code }, e.status);
  throw e;
}

export type Db = PrismaClient;
