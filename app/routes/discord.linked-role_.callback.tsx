// Discord sends the customer back here after they approve linking. Identity comes only from Discord's
// own token and user endpoints; the state cookie ties the return to the browser that started it.
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { cookieValue, currentCustomer } from "../site/core/auth.server";
import { DiscordLinkError, LINK_PATH, STATE_COOKIE, clearStateCookie, linkFinish } from "../site/community/discord.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.CARDBIT_SITE !== "on") return new Response("Not found", { status: 404 });
  const customer = await currentCustomer(db, request);
  if (!customer) return new Response(null, { status: 303, headers: { Location: `/sign-in?return_to=${encodeURIComponent(LINK_PATH)}` } });
  const headers = new Headers({ "Cache-Control": "no-store", "Set-Cookie": clearStateCookie() });
  try {
    await linkFinish(db, customer.id, new URL(request.url).searchParams, cookieValue(request, STATE_COOKIE));
    headers.set("Location", "/account/discord?linked=1");
  } catch (e) {
    if (!(e instanceof DiscordLinkError)) console.error("[site-discord] link callback failed", (e as Error).message);
    const msg = e instanceof DiscordLinkError ? e.message : "Discord linking failed. Please try again.";
    headers.set("Location", `/account/discord?error=${encodeURIComponent(msg)}`);
  }
  return new Response(null, { status: 303, headers });
}
