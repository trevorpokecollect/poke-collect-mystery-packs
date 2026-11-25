// POST /api/store/logout -> {state} (signed out). Clears the site session cookie.
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { endSession } from "../site/core/auth.server";
import { storeState } from "../site/store/store.server";
import { json, sameOriginJson, siteOn } from "../site/store/http.server";

export const loader = () => new Response("Not found", { status: 404 });

export async function action({ request }: ActionFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  if (!sameOriginJson(request)) return json({ error: "Invalid request.", code: "invalid" }, 400);
  const cookie = await endSession(db, request);
  const res = json({ state: await storeState(db, null) });
  if (typeof cookie === "string") res.headers.append("Set-Cookie", cookie);
  return res;
}
