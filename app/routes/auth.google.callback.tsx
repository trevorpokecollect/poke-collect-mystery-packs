import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { SignInError, createSession, googleFinish } from "../site/core/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.CARDBIT_SITE !== "on") return new Response("Not found", { status: 404 });
  try {
    const { customer, returnTo, clearState } = await googleFinish(db, request);
    const session = await createSession(db, customer.id, request);
    const headers = new Headers({ Location: returnTo });
    headers.append("Set-Cookie", session);
    headers.append("Set-Cookie", clearState);
    return new Response(null, { status: 303, headers });
  } catch (e) {
    if (!(e instanceof SignInError)) console.error("google callback failed", e);
    const msg = e instanceof SignInError ? e.message : "Google sign-in failed. Please try again.";
    return new Response(null, { status: 303, headers: { Location: `/sign-in?error=${encodeURIComponent(msg)}` } });
  }
}
