// GET/POST /api/giveaway: the site's Daily Giveaway entry window. Same request and response shapes as
// the Shopify proxy route (proxy.api.giveaway.tsx); consent comes from the site's email signup.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { json, sameOriginJson, siteOn } from "../site/store/http.server";
import { enterOrBonus } from "../giveaway/entries.server";
import { customerView, promptView } from "../giveaway/service.server";
import { SITE_GIVEAWAY_SHOP as shop, giveawayHeld, settleDueSiteRounds, subscribedToEmail } from "../site/promos/promos.server";
import { gateApi } from "../site/waitlist/gate.server";

const SAFE = /^(Enter today|Choose an|Your entry|Visit Whatnot|Confirm you|The daily|Email subscription)/;

async function handle(request: Request, mutate: boolean) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  { const gated = gateApi(request); if (gated) return gated; }
  const customer = await currentCustomer(db, request);
  const id = customer?.id ?? null;
  if (mutate && (!customer || request.method !== "POST")) return json({ error: "Sign in to enter." }, 403);
  if (mutate && !sameOriginJson(request)) return json({ error: "Use the giveaway page to enter." }, 415);
  try {
    if (!mutate) await settleDueSiteRounds(db).catch(() => 0); // Lazy close; never blocks the window.
    const held = customer ? await giveawayHeld(db, customer) : false;
    const prompt = new URL(request.url).searchParams.get("view") === "prompt";
    if (prompt && !mutate) {
      const view = await promptView(db, id, shop);
      return json("held" in view ? { ...view, held: view.held || held } : view);
    }
    const opted = id ? await subscribedToEmail(db, id) : false;
    if (mutate) {
      if (held) return json({ error: "Your entry is under review." }, 409);
      if (!opted) return json({ error: "Join Cardbit email news in Welcome Rewards before entering." }, 403);
      const raw = await request.text();
      if (raw.length > 2048) return json({ error: "Request is too large." }, 413);
      const body = JSON.parse(raw);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request." }, 400);
      if (prompt && (body.intent !== "enter" || typeof body.expectedDay !== "string")) return json({ error: "Choose today's giveaway." }, 400);
      const receipt = await enterOrBonus(db, id!, body, shop);
      if (prompt) return json(receipt);
    }
    const view = await customerView(db, id, opted, shop);
    return json({ ...view, held: view.held || held });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return json({ error: SAFE.test(msg) ? msg : "Giveaway details are unavailable. Try again." }, 409);
  }
}
export const loader = ({ request }: LoaderFunctionArgs) => handle(request, false);
export const action = ({ request }: ActionFunctionArgs) => handle(request, true);
