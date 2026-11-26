// Monthly plans page (standalone site; customer-facing name lives in site/play/plan-brand.ts). GET shows plans and the customer's plan; POST
// subscribes (Coinflow hosted checkout) or cancels renewal. 404 unless CARDBIT_SITE=on.
// While SITE_SUBSCRIPTIONS is off (or Coinflow plans aren't set up) the page shows "Coming Soon".
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { TERMS_VERSION, clientIp, currentCustomer, siteOrigin } from "../site/core/auth.server";
import { esc, htmlResponse, simplePage } from "../site/core/simple-page";
import { appNavTags } from "../site/shell.server";
import { EXCLUDED_STATES, RegionBlocked, US_STATES, assertAllowedRegion, geoLookupFor } from "../site/region.server";
import { CoinflowError } from "../site/payments/coinflow.server";
import { cancelAtCoinflow, createSubscriptionLink, subscriptionsReady } from "../site/payments/coinflow-subscriptions.server";
import { LimitReached, PlayPaused, assertNotPaused, assertWithinLimits, fmtDate } from "../site/play/limits.server";
import { PLAN } from "../site/play/plan-brand";
import { sendPlanCanceledEmail } from "../site/play/plan-emails.server";
import { SubscriptionError, TIERS, currentSubscription, requestCancel, subscriptionView, tierById, type TierId } from "../site/play/subscriptions.server";
import { AGE_REQUIRED, ageConfirmed } from "../lib/cardbit-age.server";
import { SITE_SHOP } from "../site/rewards/rewards.server";
import { gateApi, gatePage } from "../site/waitlist/gate.server";

const on = () => process.env.CARDBIT_SITE === "on";
const PATH = PLAN.path;
const fmt = (n: number) => n.toLocaleString("en-US");
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
/** Auto-renewal consent shown next to the checkbox and stored with each sign-up. */
const RENEW_CONSENT_TEXT =
  "I agree that my plan renews automatically every month at the price shown, charged to my card until I cancel. I can cancel any time on this page or by emailing Support@cardbit.com, and my perks last through the month I paid for.";
const RENEW_CONSENT = `<span>${esc(RENEW_CONSENT_TEXT)} See the <a href="/policies#terms">Terms</a>.</span>`;
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
        ? `<p class="mine">✓ Your Plan</p>`
        : live || !ready
          ? `<button class="btn" disabled>${ready ? "Cancel Your Plan to Switch" : "Coming Soon"}</button>`
          : `<button class="btn" form="join" name="tier" value="${t.id}">Join ${esc(t.name)}</button>`;
    const look = TIER_LOOK[t.id];
    const total = t.monthlyBits + t.bonusBits;
    return `<section class="plan t-${t.id}${mine ? " is-mine" : ""}" aria-labelledby="plan-${t.id}">
      ${look.tag ? `<span class="tag">${look.tag}</span>` : ""}
      <div class="plan-top"><img class="plan-icon" src="/site/img/pass/emotes/${look.icon}.svg" alt="" width="72" height="72">
        <div><h2 id="plan-${t.id}">${esc(t.name)}</h2><p class="price">${usd(t.cents)}<small>/month</small></p></div></div>
      <div class="bits"><img src="/site/assets/cardbit-bits-card-emblem.png" alt="" width="34" height="34">
        <div><b>${fmt(total)}</b><span>Cardbits every month</span></div></div>
      <p class="bits-split">${fmt(t.monthlyBits)} + <em>${fmt(t.bonusBits)} bonus</em></p>
      <ul class="perks">
        <li>${ICON.xp}<span><b>+${t.xpBonusPct}% XP</b> on every paid pack</span></li>
        <li>${ICON.spark}<span><b>+${t.sparksBonusPct}% Sparks</b> on every paid pack</span></li>
        <li>${ICON.star}<span><b>${esc(t.name)} portrait frame</b> around your icon</span></li>
        ${t.id === "plus" ? "" : `<li>${ICON.star}<span><b>Animated emotes:</b> 4 for every BitBot</span></li>`}
        ${t.id === "ultimate" ? `<li>${ICON.star}<span><b>Legendary emotes</b>, only on Ultimate</span></li>` : ""}
        ${t.id === "plus" ? "" : `<li>${ICON.star}<span><b>Card sleeves + reveal effects</b> for your openings${t.id === "ultimate" ? ", including the Gold Legendary sleeve" : ""}</span></li>`}
        ${t.id === "plus" ? "" : `<li>${ICON.box}<span><b>Free Ship Together</b> ${t.id === "ultimate" ? "2 shipments a month" : "1 shipment a month"}</span></li>`}
        ${t.id === "ultimate" ? `<li>${ICON.coin}<span><b>+5% Cardbits</b> on all buybacks</span></li>` : ""}
        <li>${ICON.chat}<span>Members' chat room + <b>${esc(PLAN.name)}</b> Discord role</span></li>
      </ul>${cta}</section>`;
  }).join("");
  const status = live && v.current
    ? `<div class="mybox"><div class="sum"><span>Your Plan</span><b>${esc(tierById(v.current.tier)?.name || v.current.tier)} · ${esc(v.current.status === "PAST_DUE" ? "Payment Retrying" : v.current.status === "PENDING" ? "Activating" : "Active")}</b></div>
       ${v.current.currentPeriodEnd ? `<p class="fine">Renews ${esc(fmtDate(new Date(v.current.currentPeriodEnd)))}.</p>` : ""}
       <form method="post"><button class="btn ghost" name="op" value="cancel">Cancel Renewal</button></form><p class="fine">Perks last until the end of the month you paid for.</p></div>`
    : v.current?.status === "CANCELED" && v.perksTier && v.current.currentPeriodEnd
      ? `<p class="note">Your ${esc(tierById(v.perksTier)?.name || "")} perks last until ${esc(fmtDate(new Date(v.current.currentPeriodEnd)))}.</p>`
      : "";
  return simplePage(
    PLAN.name,
    `<style>${PASS_CSS}</style>
     <header class="hero">
       <div class="orbit" aria-hidden="true">${["latch-hype", "latch-holo-love", "latch-gold-legend", "zappix-hype", "blazebit-lol"].map((i, n) => `<img class="o o${n}" src="/site/img/pass/emotes/${i}.svg" alt="" width="64" height="64">`).join("")}</div>
       <p class="kicker">${ready ? "Monthly Plan" : "Coming Soon"}</p>
       <h1 class="title">${esc(PLAN.name)}</h1>
       <p class="sub">Cardbits every month with a bonus on top, faster levels, extra Sparks and member-only perks.</p>
       <ul class="steps" aria-label="How it works">
         <li><span>1</span>Pick a plan</li><li><span>2</span>Cardbits land every month</li><li><span>3</span>Cancel any time</li>
       </ul>
     </header>${msg}${status}
     ${customerId && ready && !live ? `<form method="post" id="join" class="joinbox"><input type="hidden" name="op" value="join"><div class="bill"><div><label for="state">Billing State</label><select id="state" name="state" required><option value="">Choose…</option>${allowedStates.map((st) => `<option>${st}</option>`).join("")}</select></div>
       <div><label for="zip">Billing ZIP Code</label><input id="zip" name="zip" inputmode="numeric" autocomplete="postal-code" pattern="[0-9]{5}" maxlength="5" required></div></div>
       <label class="agree"><input type="checkbox" name="renew_ok" value="yes" required> ${RENEW_CONSENT}</label></form>` : ""}
     <div class="plans">${cards}</div>
     <p class="free">${ICON.gift}<span>Daily Spins, giveaway entries and the leaderboard stay <b>free for everyone</b>. A plan never adds spins, entries or points.</span></p>
     <p class="fine">Renews automatically every month at the plan's price, charged to the card you use at checkout, until you cancel. Cancel any time on this page or by emailing Support@cardbit.com, at least a day before your renewal date to avoid the next charge; perks last through the month you paid for. Monthly charges are final once the month's Cardbits are added, except as the <a href="/policies#refund-policy">Refund Policy</a> says. Plan Cardbits are store credit (100 = $1), never cash, and follow the Terms. Bonus Cardbits are promotional. Plan charges count toward your Top-Up Limits.
     Not available in ${EXCLUDED_STATES.join(", ")}. 18+. <a href="/policies#terms">Terms</a> · <a href="/">Back to Cardbit</a></p>`,
    appNavTags(), // phones: the site's bottom tab bar, with Pack Pass lit
  );
}

const TIER_LOOK: Record<TierId, { icon: string; tag?: string }> = {
  plus: { icon: "latch-love" },
  pro: { icon: "latch-holo-hype", tag: "Most Popular" },
  ultimate: { icon: "latch-gold-legend", tag: "Best Value" },
};

const svg = (d: string) => `<svg class="pi" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`;
const ICON = {
  xp: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor"/>'),
  spark: svg('<path d="M12 2l2.2 6.3L20 10l-5.8 1.7L12 18l-2.2-6.3L4 10l5.8-1.7z" fill="currentColor"/><circle cx="19" cy="19" r="2" fill="currentColor"/>'),
  star: svg('<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" fill="currentColor"/>'),
  chat: svg('<path d="M4 5h16v10H9l-5 4z" fill="currentColor"/>'),
  box: svg('<path d="M12 2 3 6.5v11L12 22l9-4.5v-11zM12 4.3l6.4 3.2L12 10.7 5.6 7.5zM5 9.1l6 3v7.6l-6-3zm8 10.6v-7.6l6-3v7.6z" fill="currentColor"/>'),
  coin: svg('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7v10M9.5 9.5h4a1.8 1.8 0 0 1 0 3.5h-3a1.8 1.8 0 0 0 0 3.5h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  gift: svg('<path d="M3 10h18v4H3zM5 14h14v7H5zM11 10h2v11h-2zM12 10c-2-4-6-4-6-1.5S10 10 12 10c2 0 6-.5 6-1.5S14 6 12 10z" fill="currentColor"/>'),
};

const PASS_CSS = `
body{place-items:start center;padding:24px 16px 48px}
main{max-width:1040px;background:radial-gradient(700px 320px at 50% -60px,#00e6e12e,transparent 70%),linear-gradient(180deg,#172326 0%,var(--panel) 260px);overflow:hidden}
.hero{position:relative;text-align:center;padding:8px 0 6px}
.orbit{position:relative;height:84px;margin:0 auto 4px;max-width:420px}
.o{position:absolute;top:10px;width:64px;height:64px;border-radius:50%;filter:drop-shadow(0 8px 18px #0009);animation:float 4.5s ease-in-out infinite}
.o0{left:2%;width:52px;height:52px;top:20px;animation-delay:-1s}.o1{left:21%;animation-delay:-2.2s}.o2{left:calc(50% - 40px);width:80px;height:80px;top:0;animation-delay:-.4s}.o3{right:21%;animation-delay:-3s}.o4{right:2%;width:52px;height:52px;top:20px;animation-delay:-1.6s}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.kicker{display:inline-block;margin:0 0 6px;padding:4px 12px;border-radius:999px;border:1px solid #00e6e166;background:#00e6e114;color:var(--accent);font:800 .75rem 'Cardbit Outfit',system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase}
.title{font:800 clamp(2.4rem,7vw,3.6rem)/1.05 'Cardbit Outfit',system-ui,sans-serif;margin:0 0 8px;background:linear-gradient(100deg,#7ffcf8 0%,#00e6e1 35%,#6f86ff 65%,#ffb65c 100%);-webkit-background-clip:text;background-clip:text;color:transparent;background-size:200% 100%;animation:sheen 8s ease-in-out infinite}
@keyframes sheen{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
.hero .sub{max-width:560px;margin:0 auto 16px;font-size:1.05rem}
.steps{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 18px;list-style:none;padding:0;margin:0 0 6px;color:#d3dbe0;font-size:.92rem}
.steps li{display:flex;align-items:center;gap:8px}.steps span{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#00e6e122;color:var(--accent);font:800 .8rem 'Cardbit Outfit',system-ui,sans-serif}
.joinbox,.mybox{max-width:720px;margin:18px auto 0;padding:16px;border:1px solid var(--line);border-radius:14px;background:#0d1416aa}
.bill{display:grid;grid-template-columns:1fr 1fr;gap:12px}.bill label{margin-top:0}
.agree{display:flex;gap:10px;align-items:flex-start;margin:14px 0 0;font-size:.95rem;font-weight:400;line-height:1.45;color:var(--ink)}.agree input{margin-top:4px;width:18px;height:18px;min-height:0;flex:none;accent-color:#00e6e1}
.plans{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));margin-top:22px;align-items:stretch}
.plan{--c1:#00e6e1;--c2:#00a9b5;--glow:#00e6e133;position:relative;display:flex;flex-direction:column;border-radius:18px;padding:20px 18px 18px;background:linear-gradient(180deg,#1b282b,#121a1c) padding-box,linear-gradient(160deg,var(--c1),var(--c2) 45%,#2b3a3e 80%) border-box;border:2px solid transparent;box-shadow:0 18px 50px -20px var(--glow);transition:transform .2s ease,box-shadow .2s ease}
.plan:hover{transform:translateY(-4px);box-shadow:0 26px 60px -18px var(--glow)}
.plan::before{content:"";position:absolute;inset:0;border-radius:16px;background:radial-gradient(260px 140px at 80% -20px,var(--glow),transparent 70%);pointer-events:none}
.t-pro{--c1:#7ffcf8;--c2:#6f86ff;--glow:#6f86ff55}
.t-pro::after{content:"";position:absolute;inset:-2px;border-radius:18px;padding:2px;background:conic-gradient(from var(--a,0deg),#00e6e1,#6f86ff,#c77dff,#ffb65c,#00e6e1);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:spin 6s linear infinite;pointer-events:none}
@property --a{syntax:'<angle>';inherits:false;initial-value:0deg}@keyframes spin{to{--a:360deg}}
.t-ultimate{--c1:#ffd59a;--c2:#ffb65c;--glow:#ffb65c4d}
.tag{position:absolute;z-index:2;top:-12px;left:50%;transform:translateX(-50%);white-space:nowrap;font:800 .72rem 'Cardbit Outfit',system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#062022;background:linear-gradient(90deg,var(--c1),var(--c2));border-radius:999px;padding:4px 12px;box-shadow:0 6px 18px -6px var(--glow)}
.plan-top{display:flex;align-items:center;gap:12px}
.plan-icon{width:72px;height:72px;border-radius:50%;background:radial-gradient(circle,var(--glow),transparent 70%);flex:none}
.plan h2{margin:0;font:800 1.45rem 'Cardbit Outfit',system-ui,sans-serif;color:var(--c1)}
.price{font:800 2.1rem/1.1 'Cardbit Outfit',system-ui,sans-serif;margin:2px 0 0}.price small{font-size:.9rem;color:var(--muted);margin-left:2px}
.bits{display:flex;align-items:center;gap:10px;margin:16px 0 2px;padding:10px 12px;border-radius:12px;background:linear-gradient(90deg,var(--glow),transparent);border:1px solid #ffffff14}
.bits img{flex:none}.bits b{display:block;font:800 1.55rem/1.1 'Cardbit Outfit',system-ui,sans-serif}.bits span{font-size:.85rem;color:var(--muted)}
.bits-split{margin:4px 2px 10px;font-size:.85rem;color:var(--muted)}.bits-split em{font-style:normal;color:var(--c1);font-weight:700}
.perks{list-style:none;padding:0;margin:4px 0 14px;display:grid;gap:9px;flex:1}
.perks li{display:flex;gap:10px;align-items:flex-start;font-size:.95rem;line-height:1.35}
.pi{width:20px;height:20px;flex:none;color:var(--c1);margin-top:1px}
.plan .btn{margin-top:auto;background:linear-gradient(90deg,var(--c1),var(--c2));color:#062022;box-shadow:0 10px 24px -12px var(--glow)}
.plan .btn[disabled]{background:#2a3639;color:#b6c4c5;box-shadow:none;cursor:not-allowed}
.btn.ghost{background:transparent;color:var(--accent);border:2px solid var(--accent)}
.mine{margin:auto 0 0;text-align:center;font:800 1rem 'Cardbit Outfit',system-ui,sans-serif;color:var(--c1);padding:12px;border:2px dashed var(--c1);border-radius:10px}
.is-mine{box-shadow:0 0 0 3px var(--glow),0 18px 50px -20px var(--glow)}
.free{display:flex;gap:10px;align-items:center;justify-content:center;margin:22px auto 4px;max-width:640px;padding:10px 14px;border-radius:12px;background:#00e6e10f;border:1px solid #00e6e133;font-size:.92rem;text-align:left}.free .pi{color:var(--accent)}
.fine{margin-top:14px}
@media (max-width:560px){.bill{grid-template-columns:1fr}.orbit{height:70px}.o{width:48px;height:48px}.o2{width:64px;height:64px}}
@media (prefers-reduced-motion:reduce){.o,.title,.t-pro::after{animation:none}.plan,.plan:hover{transition:none;transform:none}}
`;

export async function loader({ request }: LoaderFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  { const gated = gatePage(request); if (gated) return gated; }
  const customer = await currentCustomer(db, request);
  const url = new URL(request.url);
  return htmlResponse(await page(customer?.id ?? null, url.searchParams.get("joined") ? { ok: "Thanks! Your plan activates as soon as the payment clears." } : undefined));
}

export async function action({ request }: ActionFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  { const gated = gateApi(request); if (gated) return gated; }
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const customer = await currentCustomer(db, request);
  if (!customer) return new Response(null, { status: 303, headers: { Location: `/sign-in?return_to=${encodeURIComponent(PATH)}` } });
  const fd = await request.formData();
  const fail = async (error: string, status = 400) => htmlResponse(await page(customer.id, { error }), status);
  try {
    if (fd.get("op") === "cancel") {
      const s = await requestCancel(db, customer.id, cancelAtCoinflow);
      await sendPlanCanceledEmail(db, s.id);
      return htmlResponse(await page(customer.id, { ok: "Renewal canceled. Your perks last until the end of this month." }));
    }
    if (fd.get("op") === "join") {
      const tier = tierById(fd.get("tier"));
      if (!tier) return fail("Choose a plan.");
      if (!subscriptionsReady()) return fail(`${PLAN.name} isn't open yet.`, 503);
      if (fd.get("renew_ok") !== "yes") return fail("Please tick the box to agree to the monthly renewal terms.");
      if (customer.frozenAt || customer.closedAt) return fail("This account is on hold. Contact Support@cardbit.com.", 403);
      if (!(await ageConfirmed(db, SITE_SHOP, customer.id))) return fail(AGE_REQUIRED.error, 403);
      await assertNotPaused(db, customer.id);
      await assertWithinLimits(db, customer.id, "topup", tier.cents);
      if (await currentSubscription(db, customer.id)) return fail("You already have a plan. Cancel it before switching.", 409);
      const ip = clientIp(request);
      if (!ip) return fail("We couldn't confirm your connection. Please try again.");
      const state = String(fd.get("state") || "").trim().toUpperCase();
      const zip = String(fd.get("zip") || "").trim();
      if (!/^[0-9]{5}$/.test(zip)) return fail("Enter a 5-digit billing ZIP code.");
      await assertAllowedRegion({ action: "topup", billing: { country: "US", state }, ip }, geoLookupFor(customer.email));
      // Proof of the customer's auto-renewal consent (state automatic-renewal laws).
      await db.sitePlayEvent.create({ data: { customerId: customer.id, kind: "plan_consent", detail: { tier: tier.id, cents: tier.cents, termsVersion: TERMS_VERSION, consent: RENEW_CONSENT_TEXT, ip, state, at: new Date().toISOString() } } });
      const link = await createSubscriptionLink({ customerId: customer.id, email: customer.email, tier: tier.id as TierId, ip, callbackUrl: `${siteOrigin()}${PATH}?joined=1` });
      return new Response(null, { status: 303, headers: { Location: link } });
    }
    return fail("Choose an option.");
  } catch (e) {
    if (e instanceof PlayPaused || e instanceof LimitReached || e instanceof RegionBlocked || e instanceof SubscriptionError || e instanceof CoinflowError) return fail(e.message, 403);
    throw e;
  }
}
