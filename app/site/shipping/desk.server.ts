// Staff shipping desk (/staff/shipping): queue, pick list with photos and slot/pocket, Fix Card,
// Buy Label (Shippo), Mark Shipped, Cancel, Print Slip. Server-rendered HTML with plain forms
// (post → redirect → get), so it works without client JavaScript.

import { shelfLabel } from "../core/stock.server";
import type { SiteShipment, SiteShipmentItem } from "@prisma/client";
import { BRAND, esc, usd } from "../brand/html";
import {
  buyLabel,
  cancelShipment,
  fixShipmentCard,
  markShipped,
  pickRate,
  ratesForShipment,
  shippingQueue,
  ShippingError,
  type ShippingDeps,
} from "./service.server";
import type { Address, Rate } from "./shippo.server";
import { CopyLockError, FeePaymentError } from "./types";
import { parcelFor } from "./policy";
import { sendEmail, type EmailDeps } from "../email/outbox.server";

type Shipment = SiteShipment & { items: SiteShipmentItem[] };
type QueueRow = Shipment & { overdue: boolean };

export const DESK_PATH = "/staff/shipping";

// ---------- loader ----------

export async function loadDesk(deps: ShippingDeps, url: URL) {
  const queue = await shippingQueue(deps.db, deps.now?.() ?? new Date());
  const id = url.searchParams.get("id");
  const selected = id
    ? await deps.db.siteShipment.findUnique({ where: { id }, include: { items: true } })
    : null;
  let rates: Rate[] | null = null;
  let suggested: Rate | null = null;
  let rateError: string | null = null;
  if (selected && url.searchParams.get("rates") === "1" && selected.status === "PAID") {
    try {
      const r = await ratesForShipment(deps, selected.id);
      rates = r.rates;
      suggested = r.suggested;
    } catch (err) {
      rateError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    queue,
    selected,
    rates,
    suggested,
    rateError,
    msg: url.searchParams.get("msg"),
    err: url.searchParams.get("err"),
    labelsLive: deps.provider ? !(deps.provider as { test?: boolean }).test : false,
    providerReady: Boolean(deps.provider),
  };
}

// ---------- action ----------

export async function deskAction(deps: ShippingDeps, form: FormData, actor: string, emailDeps?: EmailDeps): Promise<string> {
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("shipmentId") ?? "");
  const back = (params: Record<string, string>) =>
    `${DESK_PATH}?${new URLSearchParams({ ...(id ? { id } : {}), ...params }).toString()}`;
  try {
    switch (intent) {
      case "swap":
      case "remove": {
        const copyId = String(form.get("copyId") ?? "");
        await fixShipmentCard(
          deps,
          id,
          { action: intent, copyId, revision: String(form.get("revision") ?? "") || undefined },
          actor,
        );
        return back({ msg: intent === "swap" ? "Card swapped. Pull the new copy shown below." : "Card removed and returned to the customer's vault." });
      }
      case "label": {
        const rateId = String(form.get("rateId") ?? "") || undefined;
        const s = await buyLabel(deps, id, actor, rateId);
        return back({ msg: `Label bought: ${(s.carrier ?? "").toUpperCase()} ${s.trackingNumber ?? ""}` });
      }
      case "shipped":
        await markShipped(deps, id, actor);
        return back({ msg: "Marked shipped. The customer was emailed tracking." });
      case "selftest-address": {
        if (!deps.provider) return back({ err: "Shippo isn't connected (SHIPPO_API_TOKEN)." });
        const from = await deps.provider.validateAddress(deps.from);
        if (!from.valid) return back({ err: `Ship-from address failed carrier check: ${from.messages.join(" ") || "no details"}` });
        const sample = { name: "Rate Check", street1: "1600 Pennsylvania Ave NW", city: "Washington", state: "DC", zip: "20500", country: "US" };
        const rates = await deps.provider.rates(deps.from, sample, parcelFor(2), "selftest");
        const pick = pickRate(rates, deps.services);
        return back({
          msg: `Ship-from address verified (${from.address.street1}, ${from.address.city} ${from.address.state}). ${rates.length} rates to a sample address; default ${pick ? `${pick.carrier} ${pick.service} ${usd(pick.amountCents)}` : "none matched"}.`,
        });
      }
      case "selftest-email": {
        const to = String(form.get("to") ?? "");
        if (!emailDeps) return back({ err: "Email isn't wired." });
        const row = await sendEmail(emailDeps, "shipment_delivered", to, { shipmentId: "selftest", cardCount: 1, trackingUrl: null }, `selftest:${Date.now()}`);
        return row.status === "SENT"
          ? back({ msg: `Test email sent to ${to}${emailDeps.mailer.live ? "" : " (log only: no Resend key)"}.` })
          : back({ err: `Test email ${row.status.toLowerCase()}: ${row.error ?? ""}` });
      }
      case "cancel": {
        const reason = String(form.get("reason") ?? "").trim() || "staff canceled";
        await cancelShipment(deps, id, actor, reason);
        return back({ msg: "Shipment canceled. Cards are back in the vault and any Cardbits fee was refunded." });
      }
      default:
        return back({ err: "Unknown action." });
    }
  } catch (err) {
    if (err instanceof ShippingError || err instanceof CopyLockError || err instanceof FeePaymentError)
      return back({ err: [err.message, ...("details" in err && Array.isArray(err.details) ? err.details : [])].join(" ") });
    console.error("[site-shipping] desk action failed", intent, id, err);
    return back({ err: "Something went wrong. Refresh and try again." });
  }
}

// ---------- view ----------

const STATUS_LABEL: Record<string, string> = {
  PAID: "To Pack",
  LABEL_PENDING: "Buying Label…",
  LABEL_PURCHASED: "Label Printed",
  IN_TRANSIT: "In Transit",
  EXCEPTION: "Carrier Problem",
  RETURNED: "Returned",
  DELIVERED: "Delivered",
  CANCELED: "Canceled",
  DRAFT: "Draft",
};

const ct = (d: Date) =>
  d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function feeText(s: SiteShipment) {
  return s.feeKind === "FREE" ? "Free" : s.feeKind === "CARDBITS" ? "600 Cardbits" : usd(s.feeCents);
}

function queueHtml(rows: QueueRow[], selectedId: string | null) {
  if (!rows.length) return `<p class="empty">Nothing to ship. New requests show up here.</p>`;
  return `<table class="queue"><thead><tr><th>Ship By (CT)</th><th>Status</th><th>Cards</th><th>Customer</th></tr></thead><tbody>${rows
    .map(
      (r) => `<tr class="${r.id === selectedId ? "sel" : ""}${r.overdue ? " late" : ""}"><td><a href="${DESK_PATH}?id=${encodeURIComponent(r.id)}">${esc(ct(r.processBy))}</a>${r.overdue ? ' <span class="tag late">Overdue</span>' : ""}</td><td>${esc(STATUS_LABEL[r.status] ?? r.status)}</td><td>${r.cardCount}</td><td>${esc(r.toName)}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function pickListHtml(s: Shipment) {
  const editable = s.status === "PAID";
  const items = [...s.items].sort(
    (a, b) => (a.slot ?? 1e9) - (b.slot ?? 1e9) || (a.pocket ?? 1e9) - (b.pocket ?? 1e9) || a.title.localeCompare(b.title),
  );
  const rev = s.updatedAt.toISOString();
  return `<ol class="picks">${items
    .map((i) => {
      const photo = i.image
        ? `<img src="${esc(i.image)}" alt="${esc(i.title)}" loading="lazy">`
        : `<div class="nophoto">No Photo</div>`;
      const loc = shelfLabel(i.slot, i.pocket);
      const fix = editable
        ? `<details class="fix"><summary>Fix Card</summary>
<form method="post"><input type="hidden" name="intent" value="swap"><input type="hidden" name="shipmentId" value="${esc(s.id)}"><input type="hidden" name="copyId" value="${esc(i.copyId)}"><input type="hidden" name="revision" value="${esc(rev)}"><button>Swap For Another Copy</button><small>Wrong or damaged copy. Takes the next filed copy of the same printing and condition. This copy goes back to stock to re-inspect and re-file.</small></form>
<form method="post"><input type="hidden" name="intent" value="remove"><input type="hidden" name="shipmentId" value="${esc(s.id)}"><input type="hidden" name="copyId" value="${esc(i.copyId)}"><input type="hidden" name="revision" value="${esc(rev)}"><button class="ghost">Remove From Shipment</button><small>Can't ship it. The card goes back to the customer's vault.</small></form>
</details>`
        : "";
      return `<li><div class="photo">${photo}</div><div class="info"><strong>${esc(i.title)}</strong><span class="loc">${esc(loc)}</span><code>${esc(i.copyId)}</code>${fix}</div></li>`;
    })
    .join("")}</ol>`;
}

function labelHtml(s: Shipment, d: Awaited<ReturnType<typeof loadDesk>>) {
  const hidden = `<input type="hidden" name="shipmentId" value="${esc(s.id)}">`;
  if (s.status === "PAID") {
    if (!d.providerReady) return `<p class="warn">Connect Shippo (SHIPPO_API_TOKEN) to buy labels.</p>`;
    const rates = d.rates
      ? `<form method="post" class="rates">${hidden}<input type="hidden" name="intent" value="label">${d.rates
          .slice()
          .sort((a, b) => a.amountCents - b.amountCents)
          .map(
            (r) =>
              `<label><input type="radio" name="rateId" value="${esc(r.rateId)}"${d.suggested?.rateId === r.rateId ? " checked" : ""}> ${esc(r.carrier)} ${esc(r.service)} · ${usd(r.amountCents)}${r.days ? ` · ${r.days} day${r.days === 1 ? "" : "s"}` : ""}</label>`,
          )
          .join("")}<button>Buy Label</button></form>`
      : `<a class="button ghost" href="${DESK_PATH}?id=${encodeURIComponent(s.id)}&rates=1">Compare Rates</a>
<form method="post" class="inline">${hidden}<input type="hidden" name="intent" value="label"><button>Buy Label (Ground Advantage)</button></form>`;
    return `${d.labelsLive ? "" : '<p class="note">Shippo test mode: labels are free samples and can\'t be mailed.</p>'}${d.rateError ? `<p class="warn">${esc(d.rateError)}</p>` : ""}${rates}
<details class="cancel"><summary>Cancel Shipment</summary><form method="post">${hidden}<input type="hidden" name="intent" value="cancel"><input name="reason" placeholder="Reason (customer asked, address problem…)" required><button class="danger">Cancel And Refund</button></form></details>`;
  }
  if (s.status === "LABEL_PURCHASED")
    return `<p>${esc((s.carrier ?? "").toUpperCase())} ${esc(s.service ?? "")} · ${s.postageCents != null ? usd(s.postageCents) : ""}<br>Tracking <a href="${esc(s.trackingUrl ?? "#")}" target="_blank" rel="noopener">${esc(s.trackingNumber ?? "")}</a></p>
<a class="button" href="${esc(s.labelUrl ?? "#")}" target="_blank" rel="noopener">Print Label</a>
<form method="post" class="inline">${hidden}<input type="hidden" name="intent" value="shipped"><button class="ghost">Mark Dropped Off</button></form>`;
  if (s.trackingNumber)
    return `<p>${esc(STATUS_LABEL[s.status] ?? s.status)} · <a href="${esc(s.trackingUrl ?? "#")}" target="_blank" rel="noopener">${esc(s.trackingNumber)}</a>${s.trackingDetail ? `<br><small>${esc(s.trackingDetail)}</small>` : ""}</p>${s.labelUrl ? `<a class="button ghost" href="${esc(s.labelUrl)}" target="_blank" rel="noopener">Reprint Label</a>` : ""}`;
  return `<p>${esc(STATUS_LABEL[s.status] ?? s.status)}</p>`;
}

function detailHtml(s: Shipment, d: Awaited<ReturnType<typeof loadDesk>>) {
  const a = s.toAddress as unknown as Address;
  return `<section class="detail">
<header><h2>${esc(s.toName)} · ${s.cardCount} card${s.cardCount === 1 ? "" : "s"}</h2><span class="tag">${esc(STATUS_LABEL[s.status] ?? s.status)}</span></header>
<div class="cols">
<div><h3>Ship To</h3><p>${esc(a.name)}<br>${esc(a.street1)}${a.street2 ? `<br>${esc(a.street2)}` : ""}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}${s.addressValidated ? '<br><small class="ok">Carrier verified</small>' : '<br><small class="warn">Not carrier verified</small>'}</p></div>
<div><h3>Details</h3><p>Requested ${esc(ct(s.createdAt))} CT<br>Ship by ${esc(ct(s.processBy))} CT<br>Shipping ${esc(feeText(s))}<br><small><code>${esc(s.id)}</code></small></p></div>
<div><h3>Label</h3>${labelHtml(s, d)}</div>
</div>
<div class="bar"><h3>Pick List</h3><a class="button ghost" href="${DESK_PATH}/slip/${encodeURIComponent(s.id)}" target="_blank" rel="noopener">Print Packing Slip</a></div>
${pickListHtml(s)}
</section>`;
}

export function renderDesk(d: Awaited<ReturnType<typeof loadDesk>>, staffEmail: string) {
  const body = `<header class="top"><a href="${DESK_PATH}" class="brand">cardbit <span>Shipping Desk</span></a><span class="who"><a href="/staff/review">Fraud Review</a> · ${esc(staffEmail)}</span></header>
${d.msg ? `<p class="flash ok" role="status">${esc(d.msg)}</p>` : ""}${d.err ? `<p class="flash bad" role="alert">${esc(d.err)}</p>` : ""}
<main class="grid"><aside><h2>Queue</h2>${queueHtml(d.queue, d.selected?.id ?? null)}</aside>
<div>${d.selected ? detailHtml(d.selected, d) : `<p class="empty">Pick a shipment from the queue.</p>`}
<details class="selftest"><summary>System Check</summary>
<form method="post" class="inline"><input type="hidden" name="intent" value="selftest-address"><button class="ghost">Check Ship-From And Rates</button></form>
<form method="post" class="inline"><input type="hidden" name="intent" value="selftest-email"><input type="hidden" name="to" value="${esc(staffEmail)}"><button class="ghost">Send Me A Test Email</button></form>
</details></div></main>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Shipping Desk · cardbit</title>
<style>
:root{--cobalt:${BRAND.cobalt};--apricot:${BRAND.apricot};--navy:${BRAND.navy};--ivory:${BRAND.ivory};--ink:${BRAND.ink};--muted:${BRAND.muted};--line:${BRAND.line};--bad:#B42318;--good:#067647}
*{box-sizing:border-box}body{margin:0;background:var(--ivory);color:var(--ink);font:15px/1.45 ${BRAND.body}}
a{color:var(--cobalt)}h2,h3{font-family:${BRAND.heading};font-weight:800;color:var(--navy);margin:0 0 8px}h2{font-size:20px}h3{font-size:15px}
.top{display:flex;justify-content:space-between;align-items:center;background:var(--navy);color:#fff;padding:12px 20px}
.brand{color:#fff;text-decoration:none;font:800 22px ${BRAND.heading}}.brand span{font-size:14px;color:var(--apricot);margin-left:6px}.who{font-size:13px;opacity:.8}
.flash{margin:12px 20px 0;padding:10px 14px;border-radius:10px}.flash.ok{background:#E8F5EE;color:var(--good)}.flash.bad{background:#FDECEC;color:var(--bad)}
.grid{display:grid;grid-template-columns:minmax(260px,360px) 1fr;gap:20px;padding:20px}
@media (max-width:820px){.grid{grid-template-columns:1fr}}
aside,.detail{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px}
table.queue{width:100%;border-collapse:collapse;font-size:14px}table.queue th{text-align:left;color:var(--muted);font-weight:600;border-bottom:1px solid var(--line);padding:6px 4px}
table.queue td{border-bottom:1px solid var(--line);padding:8px 4px}tr.sel{background:#EEF1FE}tr.late td:first-child a{color:var(--bad);font-weight:700}
.tag{display:inline-block;font-size:12px;padding:2px 8px;border-radius:999px;background:#EEF1FE;color:var(--cobalt)}.tag.late{background:#FDECEC;color:var(--bad)}
.detail header{display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:16px}.cols p{margin:0}
.bar{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:12px}
ol.picks{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:10px}
ol.picks li{display:flex;gap:12px;border:1px solid var(--line);border-radius:12px;padding:10px}
.photo img,.nophoto{width:84px;height:117px;object-fit:contain;border-radius:6px;background:var(--ivory)}.nophoto{display:grid;place-items:center;font-size:12px;color:var(--muted)}
.info{display:flex;flex-direction:column;gap:3px;min-width:0}.loc{font:800 16px ${BRAND.heading};color:var(--navy)}code{font-size:11px;color:var(--muted);word-break:break-all}
button,.button{display:inline-block;font:800 14px ${BRAND.heading};background:var(--cobalt);color:#fff;border:0;border-radius:999px;padding:9px 16px;cursor:pointer;text-decoration:none}
button.ghost,.button.ghost{background:#fff;color:var(--cobalt);border:1.5px solid var(--cobalt)}button.danger{background:var(--bad)}
button:focus-visible,.button:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible{outline:3px solid var(--apricot);outline-offset:2px}
details.fix,details.cancel{margin-top:6px}details.selftest{margin-top:16px}details.selftest form{margin:8px 8px 0 0}details summary{cursor:pointer;color:var(--cobalt);font-weight:700}
details form{display:flex;flex-direction:column;align-items:flex-start;gap:4px;margin:8px 0}details small{color:var(--muted);max-width:52ch}
form.inline{display:inline}form.rates{display:flex;flex-direction:column;gap:6px;margin:8px 0}
input[name=reason]{width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;font:inherit}
.warn{color:var(--bad)}.ok{color:var(--good)}.note{color:var(--muted);font-size:13px}.empty{color:var(--muted)}
</style></head><body>${body}</body></html>`;
}
