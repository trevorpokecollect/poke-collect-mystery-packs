// Limits & Breaks (standalone site): Top-Up Limits, Spend Limits, Cool-Off and Self-Exclusion.
// 404 unless CARDBIT_SITE=on. Signed-out visitors go to sign-in. Rules: app/site/play/limits.server.ts.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { esc, htmlResponse, simplePage } from "../site/core/simple-page";
import {
  COOL_OFF_HOURS,
  EXCLUSION_MONTHS,
  KINDS,
  PERIODS,
  PlayInputError,
  cancelPending,
  fmtDate,
  playSummary,
  selfExclude,
  setLimit,
  startCoolOff,
  type LimitKey,
  type LimitKind,
} from "../site/play/limits.server";
import { currentSubscription, requestCancel } from "../site/play/subscriptions.server";
import { cancelAtCoinflow } from "../site/payments/coinflow-subscriptions.server";

const on = () => process.env.CARDBIT_SITE === "on";
const PATH = "/account/limits";
const KIND_LABEL: Record<LimitKind, string> = { topup: "Top-Up Limits", spend: "Spend Limits" };
const PERIOD_LABEL = { day: "Daily", week: "Weekly", month: "Monthly" } as const;
const COOL_LABEL: Record<number, string> = { 24: "24 Hours", 72: "3 Days", 168: "7 Days", 720: "30 Days" };
const EXCL_LABEL: Record<number, string> = { 6: "6 Months", 12: "1 Year", 60: "5 Years" };

const show = (kind: LimitKind, v: number) => (kind === "topup" ? `$${(v / 100).toLocaleString("en-US")}` : `${v.toLocaleString("en-US")} Cardbits`);
const inputValue = (kind: LimitKind, v: number | undefined) => (v === undefined ? "" : kind === "topup" ? String(v / 100) : String(v));

/** Form posts must come from this site (blocks cross-site posts riding the session cookie). */
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

async function page(customerId: string, flash?: { ok?: string; error?: string }) {
  const s = await playSummary(db, customerId);
  const msg = flash?.error
    ? `<p class="err" role="alert">${esc(flash.error)}</p>`
    : flash?.ok
      ? `<p class="note" role="status">${esc(flash.ok)}</p>`
      : "";
  const pause = s.pause
    ? `<div class="sum" role="status"><span>${s.pause.kind === "self_exclusion" ? "Self-Exclusion" : "Cool-Off"} Active</span><b>Until ${esc(fmtDate(s.pause.until))}</b></div>
       <p class="fine">Top-ups, pack and single purchases, Daily Spins and subscriptions are paused. You can still view your Vault, ship cards and sell cards back. A break can't be shortened.</p>`
    : "";

  const limitBlocks = KINDS.map((kind) => {
    const rows = PERIODS.map((p) => {
      const key = `${kind}:${p}` as LimitKey;
      const cur = s.limits[key];
      const used = s.used[key] ?? 0;
      const pend = s.pending.find((x) => x.key === key);
      const pendTxt = pend
        ? `<p class="fine">Changing to ${pend.value === null ? "no limit" : esc(show(kind, pend.value))} on ${esc(fmtDate(new Date(pend.at)))}.
           <button class="link" name="op" value="cancel:${key}">Keep Current Limit</button></p>`
        : "";
      const id = `l-${kind}-${p}`;
      return `<label for="${id}">${PERIOD_LABEL[p]} ${kind === "topup" ? "($)" : "(Cardbits)"}</label>
        <div class="row"><input id="${id}" name="${key}" inputmode="numeric" placeholder="No limit" value="${esc(inputValue(kind, cur))}">
        <button class="mini" name="op" value="set:${key}">Save</button></div>
        <p class="fine">${cur === undefined ? "No limit set." : `Limit ${esc(show(kind, cur))}.`} Used in the last ${p === "day" ? "24 hours" : p === "week" ? "7 days" : "30 days"}: ${esc(show(kind, used))}.</p>${pendTxt}`;
    }).join("");
    return `<h2>${KIND_LABEL[kind]}</h2><p class="fine">${
      kind === "topup" ? "Caps how much you can pay for Cardbits." : "Caps how many Cardbits you can spend on packs and singles."
    } Lowering a limit works right away. Raising or removing one takes 24 hours.</p>${rows}`;
  }).join("");

  const cool = COOL_OFF_HOURS.map((h) => `<option value="${h}">${COOL_LABEL[h]}</option>`).join("");
  const excl = EXCLUSION_MONTHS.map((m) => `<option value="${m}">${EXCL_LABEL[m]}</option>`).join("");

  return simplePage(
    "Limits & Breaks",
    `<style>h2{font:800 1.2rem 'Cardbit Outfit',system-ui,sans-serif;margin:26px 0 4px}.row{display:flex;gap:8px}.row input{flex:1}
     .mini{padding:0 18px;border:0;border-radius:10px;background:var(--accent);color:var(--on-accent);font:800 .95rem 'Cardbit Outfit',system-ui,sans-serif;cursor:pointer}
     .link{background:none;border:0;color:var(--accent);text-decoration:underline;cursor:pointer;font:inherit;padding:0}
     .warn{background:transparent;color:var(--err);border:2px solid var(--err)}.chk{display:flex;gap:8px;align-items:flex-start;font-weight:400}.chk input{width:auto;margin-top:4px}</style>
     <h1>Limits &amp; Breaks</h1><p class="sub">Set limits or take a break whenever you like.</p>${msg}${pause}
     <form method="post">${limitBlocks}</form>
     <h2>Cool-Off</h2><p class="fine">Take a short break. You can't undo it early.</p>
     <form method="post"><label for="cool">Length</label><select id="cool" name="hours">${cool}</select>
       <label class="chk"><input type="checkbox" name="confirm" value="yes" required> I understand I can't buy Cardbits, packs or singles, or spin, until it ends.</label>
       <button class="btn" name="op" value="cool">Start Cool-Off</button></form>
     <h2>Self-Exclusion</h2><p class="fine">A longer break. It can't be shortened or canceled. Your Vault, shipping and sell-backs stay available. Email Support@cardbit.com if you'd also like your account closed.</p>
     <form method="post"><label for="excl">Length</label><select id="excl" name="months">${excl}</select>
       <label class="chk"><input type="checkbox" name="confirm" value="yes" required> I understand this can't be undone until it ends.</label>
       <button class="btn warn" name="op" value="exclude">Self-Exclude</button></form>
     <p class="fine" style="margin-top:22px">Need to talk to someone? Call or text 1-800-GAMBLER (1-800-426-2537), free and confidential. <a href="/">Back to Cardbit</a></p>`,
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  const customer = await currentCustomer(db, request);
  if (!customer) return new Response(null, { status: 303, headers: { Location: `/sign-in?return_to=${encodeURIComponent(PATH)}` } });
  return htmlResponse(await page(customer.id));
}

export async function action({ request }: ActionFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const customer = await currentCustomer(db, request);
  if (!customer) return new Response(null, { status: 303, headers: { Location: `/sign-in?return_to=${encodeURIComponent(PATH)}` } });
  const fd = await request.formData();
  const op = String(fd.get("op") || "");
  try {
    if (op.startsWith("set:")) {
      const key = op.slice(4) as LimitKey;
      if (!/^(topup|spend):(day|week|month)$/.test(key)) throw new PlayInputError("Choose a limit.");
      const kind = key.split(":")[0] as LimitKind;
      const raw = String(fd.get(key) || "").replace(/[$,\s]/g, "");
      let value: number | null = null;
      if (raw) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) throw new PlayInputError("Enter a whole number, or leave it blank for no limit.");
        value = kind === "topup" ? Math.round(n * 100) : Math.floor(n);
      }
      const r = await setLimit(db, customer.id, key, value);
      return htmlResponse(await page(customer.id, { ok: r.applied ? "Limit saved." : `Saved. The change takes effect ${fmtDate(r.at)}.` }));
    }
    if (op.startsWith("cancel:")) {
      await cancelPending(db, customer.id, op.slice(7) as LimitKey);
      return htmlResponse(await page(customer.id, { ok: "Kept your current limit." }));
    }
    if (op === "cool" || op === "exclude") {
      if (fd.get("confirm") !== "yes") throw new PlayInputError("Check the box to confirm.");
      const until = op === "cool" ? await startCoolOff(db, customer.id, Number(fd.get("hours"))) : await selfExclude(db, customer.id, Number(fd.get("months")));
      // A break also stops Cardbit Club renewals (perks already paid for last until the month ends).
      if (await currentSubscription(db, customer.id))
        await requestCancel(db, customer.id, cancelAtCoinflow, op === "cool" ? "cool_off" : "self_exclusion").catch(async (e) => {
          console.error("[site] subscription cancel on break failed; staff must cancel at Coinflow", customer.id, (e as Error).message);
          const s = await currentSubscription(db, customer.id);
          if (s) await db.siteSubscription.update({ where: { id: s.id }, data: { status: "CANCELED", canceledAt: new Date(), cancelReason: "break_processor_cancel_failed" } });
        });
      return htmlResponse(await page(customer.id, { ok: `${op === "cool" ? "Cool-off" : "Self-exclusion"} active until ${fmtDate(until)}.` }));
    }
    throw new PlayInputError("Choose an option.");
  } catch (e) {
    if (e instanceof PlayInputError) return htmlResponse(await page(customer.id, { error: e.message }), 400);
    throw e;
  }
}
