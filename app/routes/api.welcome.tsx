// GET/POST /api/welcome: Welcome Rewards for the signed-in site customer (app/site/promos/promos.server.ts).
// POST {action:"email", consent:true} | {action:"sms", phone, consent:true} | {action:"leave", channel}
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { clientIp, currentCustomer } from "../site/core/auth.server";
import { json, sameOriginJson, siteOn } from "../site/store/http.server";
import { PromoError, joinEmail, leave, requestSms, welcomeOn, welcomeView } from "../site/promos/promos.server";
import { foundingView } from "../site/waitlist/waitlist.server";
import { gateApi } from "../site/waitlist/gate.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  { const gated = gateApi(request); if (gated) return gated; }
  const customer = await currentCustomer(db, request);
  // Founding Collector (waitlist) badge + bonus status, for the account pages.
  return json({ ...(await welcomeView(db, customer)), founding: customer ? await foundingView(db, customer) : null });
}

export async function action({ request }: ActionFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  { const gated = gateApi(request); if (gated) return gated; }
  if (!welcomeOn()) return json({ error: "Welcome Rewards Are Not Open Yet." }, 404);
  if (request.method !== "POST" || !sameOriginJson(request)) return json({ error: "Method not allowed." }, 405);
  const customer = await currentCustomer(db, request);
  if (!customer) return json({ error: "Sign In to Cardbit.", code: "sign_in" }, 401);
  if (customer.frozenAt) return json({ error: "This account is on hold. Contact Support@cardbit.com.", code: "account_frozen" }, 403);
  const input = (await request.json().catch(() => null)) as { action?: unknown; consent?: unknown; phone?: unknown; channel?: unknown } | null;
  const ctx = { ip: clientIp(request) };
  try {
    let message = "";
    if (input?.action === "email") {
      const r = await joinEmail(db, customer, input.consent, ctx);
      message = r.credited ? r.credited + " Cardbits Added to Your Wallet." : "Email Preference Saved.";
    } else if (input?.action === "sms") {
      await requestSms(db, customer, input.phone, input.consent, ctx);
      message = "Text Alerts Requested. Reply YES to Our Confirmation Text to Earn Your Reward.";
    } else if (input?.action === "leave") {
      await leave(db, customer, input.channel);
      message = "Preference Turned Off. You Keep Your Earned Cardbits.";
    } else return json({ error: "Unknown action." }, 400);
    return json({ message, ...(await welcomeView(db, customer)) });
  } catch (e) {
    if (e instanceof PromoError) return json({ error: e.message }, e.status);
    throw e;
  }
}
