// Cardbit Club (standalone site): monthly plans. GET shows plans and the customer's plan; POST
// subscribes (Coinflow hosted checkout) or cancels renewal. 404 unless CARDBIT_SITE=on.
// While SITE_SUBSCRIPTIONS is off (or Coinflow plans aren't set up) the page shows "Coming Soon".
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { clientIp, currentCustomer, siteOrigin } from "../site/core/auth.server";
import { esc, htmlResponse, simplePage } from "../site/core/simple-page";
import { EXCLUDED_STATES, RegionBlocked, US_STATES, assertAllowedRegion, defaultGeoLookup } from "../site/region.server";
import { CoinflowError } from "../site/payments/coinflow.server";
import { cancelAtCoinflow, createSubscriptionLink, subscriptionsReady } from "../site/payments/coinflow-subscriptions.server";
import { PlayPaused, assertNotPaused, fmtDate } from "../site/play/limits.server";
import { SubscriptionError, TIERS, currentSubscription, requestCancel, subscriptionView, tierById, type TierId } from "../site/play/subscriptions.server";
import { AGE_REQUIRED, ageConfirmed } from "../lib/cardbit-age.server";
import { SITE_SHOP } from "../site/rewards/rewards.server";

const on = () => process.env.CARDBIT_SITE === "on";
const PATH = "/club";
const fmt = (n: number) => n.toLocaleString("en-US");
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const allowedStates = [...US_STATES].filter((s) => !(EXCLUDED_STATES as readonly string[]).includes(s)).sort();

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === new URL(request.url).host || host === request.headers.get("x-forwarded-host");
  } catch {
    return false;
  }
}

async function page(customerId: string | null, flash?: { ok?: string; error?: string }) {
  const v = await subscriptionView(db, customerId);
  const ready = subscriptionsReady();
  const msg = flash?.error ? `<p class="err" role="alert">${esc(flash.error)}</p>` : flash?.ok ? `<p class="note" role="status">${esc(flash.ok)}</p>` : "";
  const live = v.current && ["PENDING", "ACTIVE", "PAST_DUE"].includes(v.current.status);
  const cards = TIERS.map((t) => {
    const mine = v.current?.tier === t.id && live;
    const cta = !ready && !mine
      ? `<button class="btn" disabled>Coming Soon</button>`
      : !customerId
      ? `<a class="btn" href="/sign-in?return_to=${encodeURIComponent(PATH)}">Sign In to Join</a>`
      : mine
        ? `<p class="note">Your Plan</p>`
        : live || !ready
          ? `<button class="btn" disabled>${ready ? "Cancel Your Plan to Switch" : "Coming Soon"}</button>`
          : `<button class="btn" form="join" name="tier" value="${t.id}">Join ${esc(t.name)}</button>`;
    return `<section class="plan${t.id === "pro" ? " pop" : ""}">${t.id === "pro" ? '<span class="tag">Popular</span>' : t.id === "ultimate" ? '<span class="tag">Best Value</span>' : ""}
      <h2>${esc(t.name)}</h2><p class="price">${usd(t.cents)}<small>/month</small></p>
      <ul><li><b>${fmt(t.monthlyBits)} + ${fmt(t.bonusBits)} Bonus Cardbits</b> every month</li>
      <li>+${t.xpBonusPct}% XP on every pack</li><li>+${t.sparksBonusPct}% Sparks</li>
      <li>Animated Latch &amp; Friends icons</li><li>Club badge + Club chat room</li></ul>${cta}</section>`;
  }).join("");
  const status = live && v.current
    ? `<div class="sum"><span>Your Plan</span><b>${esc(tierById(v.current.tier)?.name || v.current.tier)} · ${esc(v.current.status === "PAST_DUE" ? "Payment Retrying" : v.current.status === "PENDING" ? "Activating" : "Active")}</b></div>
       ${v.current.currentPeriodEnd ? `<p class="fine">Renews ${esc(fmtDate(new Date(v.current.currentPeriodEnd)))}.</p>` : ""}
       <form method="post"><button class="btn ghost" name="op" value="cancel">Cancel Renewal</button></form><p class="fine">Perks last until the end of the month you paid for.</p>`
    : v.current?.status === "CANCELED" && v.perksTier && v.current.currentPeriodEnd
      ? `<p class="note">Your ${esc(tierById(v.perksTier)?.name || "")} perks last until ${esc(fmtDate(new Date(v.current.currentPeriodEnd)))}.</p>`
      : "";
  return simplePage(
    "Cardbit Club",
    `<style>main{max-width:980px}.plans{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-top:16px}
     .plan{position:relative;border:1px solid var(--line);border-radius:14px;padding:18px}.plan.pop{border-color:var(--accent)}
     .plan h2{margin:0;font:800 1.3rem 'Cardbit Outfit',system-ui,sans-serif}.price{font:800 2rem 'Cardbit Outfit',system-ui,sans-serif;margin:6px 0}.price small{font-size:.9rem;color:var(--muted)}
     .plan ul{padding-left:1.1rem;margin:10px 0}.plan li{margin:5px 0}.tag{position:absolute;top:12px;right:12px;font-size:.75rem;font-weight:800;color:var(--on-accent);background:var(--accent);border-radius:999px;padding:2px 10px}
     .bill{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:520px}.btn[disabled]{opacity:.55;cursor:not-allowed}.ghost{background:transparent;color:var(--accent);border:2px solid var(--accent)}</style>
     <h1>Cardbit Club</h1><p class="sub">Monthly Cardbits with a bonus, faster levels and Club perks.${ready ? "" : " Coming soon."}</p>${msg}${status}
     ${customerId && ready && !live ? `<form method="post" id="join"><input type="hidden" name="op" value="join"><div class="bill"><div><label for="state">Billing State</label><select id="state" name="state" required><option value="">Choose…</option>${allowedStates.map((st) => `<option>${st}</option>`).join("")}</select></div>
       <div><label for="zip">Billing ZIP Code</label><input id="zip" name="zip" inputmode="numeric" autocomplete="postal-code" pattern="[0-9]{5}" maxlength="5" required></div></div></form>` : ""}
     <div class="plans">${cards}</div>
     <p class="fine">Billed monthly by card until you cancel. Cancel any time here; perks last through the month you paid for. Club Cardbits are store credit (100 = $1), never cash, and follow the Terms. Bonus Cardbits are promotional.
     A plan never adds Daily Spins, giveaway entries or leaderboard points; those stay free for everyone. Not available in ${EXCLUDED_STATES.join(", ")}. 18+. <a href="/policies#terms">Terms</a> · <a href="/">Back to Cardbit</a></p>`,
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  const customer = await currentCustomer(db, request);
  const url = new URL(request.url);
  return htmlResponse(await page(customer?.id ?? null, url.searchParams.get("joined") ? { ok: "Thanks! Your plan activates as soon as the payment clears." } : undefined));
}

export async function action({ request }: ActionFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const customer = await currentCustomer(db, request);
  if (!customer) return new Response(null, { status: 303, headers: { Location: `/sign-in?return_to=${encodeURIComponent(PATH)}` } });
  const fd = await request.formData();
  const fail = async (error: string, status = 400) => htmlResponse(await page(customer.id, { error }), status);
  try {
    if (fd.get("op") === "cancel") {
      await requestCancel(db, customer.id, cancelAtCoinflow);
      return htmlResponse(await page(customer.id, { ok: "Renewal canceled. Your perks last until the end of this month." }));
    }
    if (fd.get("op") === "join") {
      const tier = tierById(fd.get("tier"));
      if (!tier) return fail("Choose a plan.");
      if (!subscriptionsReady()) return fail("Cardbit Club isn't open yet.", 503);
      if (customer.frozenAt || customer.closedAt) return fail("This account is on hold. Contact Support@cardbit.com.", 403);
      if (!(await ageConfirmed(db, SITE_SHOP, customer.id))) return fail(AGE_REQUIRED.error, 403);
      await assertNotPaused(db, customer.id);
      if (await currentSubscription(db, customer.id)) return fail("You already have a plan. Cancel it before switching.", 409);
      const ip = clientIp(request);
      if (!ip) return fail("We couldn't confirm your connection. Please try again.");
      const state = String(fd.get("state") || "").trim().toUpperCase();
      const zip = String(fd.get("zip") || "").trim();
      if (!/^[0-9]{5}$/.test(zip)) return fail("Enter a 5-digit billing ZIP code.");
      await assertAllowedRegion({ action: "topup", billing: { country: "US", state }, ip }, defaultGeoLookup());
      const link = await createSubscriptionLink({ customerId: customer.id, email: customer.email, tier: tier.id as TierId, ip, callbackUrl: `${siteOrigin()}${PATH}?joined=1` });
      return new Response(null, { status: 303, headers: { Location: link } });
    }
    return fail("Choose an option.");
  } catch (e) {
    if (e instanceof PlayPaused || e instanceof RegionBlocked || e instanceof SubscriptionError || e instanceof CoinflowError) return fail(e.message, 403);
    throw e;
  }
}
