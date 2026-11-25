// Printable packing slip. Staff pull cards by slot/pocket; the customer sees the card list.
import type { SiteShipment, SiteShipmentItem } from "@prisma/client";
import { BRAND, esc } from "../brand/html";
import type { Address } from "./shippo.server";

export function packingSlipHtml(s: SiteShipment & { items: SiteShipmentItem[] }) {
  const a = s.toAddress as unknown as Address;
  const items = [...s.items].sort(
    (x, y) =>
      (x.slot ?? 1e9) - (y.slot ?? 1e9) ||
      (x.pocket ?? 1e9) - (y.pocket ?? 1e9) ||
      x.title.localeCompare(y.title),
  );
  const rows = items
    .map((i, n) => {
      const loc = i.slot != null ? `S${i.slot}${i.pocket != null ? `·P${i.pocket}` : ""}` : "—";
      return `<tr><td class="n">${n + 1}</td><td>${esc(i.title)}</td><td class="loc">${loc}</td><td class="chk">☐</td></tr>`;
    })
    .join("");
  const fee = s.feeKind === "FREE" ? "Free (over 30 cards)" : s.feeKind === "CARDBITS" ? "600 Cardbits" : "$6.00";
  const shipBy = s.processBy.toISOString().slice(0, 16).replace("T", " ");
  const tracking = s.trackingNumber ? ` · ${esc((s.carrier ?? "").toUpperCase())} ${esc(s.trackingNumber)}` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Packing Slip ${esc(s.id)}</title>
<style>
@page{size:letter;margin:0.5in}
body{font-family:${BRAND.body};color:${BRAND.ink};margin:0}
h1{font-family:${BRAND.heading};font-weight:800;font-size:22px;margin:0 0 4px;color:${BRAND.navy}}
.top{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid ${BRAND.cobalt};padding-bottom:12px;margin-bottom:16px}
.muted{color:${BRAND.muted};font-size:12px}
.addr{font-size:14px;line-height:1.4}
table{width:100%;border-collapse:collapse;font-size:13px}
th{font-family:${BRAND.heading};text-align:left;border-bottom:1px solid ${BRAND.line};padding:6px 4px}
td{border-bottom:1px solid ${BRAND.line};padding:6px 4px;vertical-align:top}
td.n{width:28px;color:${BRAND.muted}} td.loc{width:80px;font-family:monospace} td.chk{width:24px;text-align:center}
.foot{margin-top:18px;font-size:12px;color:${BRAND.muted}}
</style></head><body>
<div class="top"><div><h1>cardbit</h1><div class="muted">Hosted by Poke-Collect.</div>
<div class="muted">Shipment ${esc(s.id)}<br>Requested ${esc(s.createdAt.toISOString().slice(0, 10))} · Ship by ${esc(shipBy)} UTC</div></div>
<div class="addr"><strong>Ship To</strong><br>${esc(a.name)}<br>${esc(a.street1)}${a.street2 ? `<br>${esc(a.street2)}` : ""}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}</div></div>
<table><thead><tr><th>#</th><th>Card</th><th>Location</th><th>✓</th></tr></thead><tbody>${rows}</tbody></table>
<div class="foot">${s.cardCount} card${s.cardCount === 1 ? "" : "s"} · Shipping: ${esc(fee)}${tracking}<br>Every card is guaranteed authentic. Questions: hello@cardbit.com</div>
</body></html>`;
}
