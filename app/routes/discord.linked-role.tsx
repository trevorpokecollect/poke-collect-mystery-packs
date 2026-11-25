// Discord Linked Roles entry point (also the app's "Linked Roles Verification URL").
// Signed-in customers are sent to Discord to approve `identify role_connections.write`.
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { DiscordLinkError, LINK_PATH, linkStart } from "../site/community/discord.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.CARDBIT_SITE !== "on") return new Response("Not found", { status: 404 });
  const customer = await currentCustomer(db, request);
  if (!customer) return new Response(null, { status: 303, headers: { Location: `/sign-in?return_to=${encodeURIComponent(LINK_PATH)}` } });
  try {
    const { url, cookie } = linkStart();
    return new Response(null, { status: 303, headers: { Location: url, "Set-Cookie": cookie, "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof DiscordLinkError ? e.message : "Discord linking is unavailable right now.";
    return new Response(null, { status: 303, headers: { Location: `/account/discord?error=${encodeURIComponent(msg)}` } });
  }
}
