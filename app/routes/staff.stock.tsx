// Staff stock view for the standalone site: every SiteCopy Card Broker sent, with slot/pocket.
// 404 unless CARDBIT_SITE=on and the signed-in email is in SITE_STAFF_EMAILS. Read-only.
import type { LoaderFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { esc } from "../site/core/simple-page";
import { shelfAddress } from "../site/core/stock.server";
import { notFound, staffUser } from "../site/shipping/staff.server";

const STATUSES = ["FOR_SALE", "POOLED", "VAULTED", "SHIP_LOCKED", "SHIPPED", "REMOVED"];
const loc = (slot: number | null, pocket: number | null) => {
  if (slot == null) return "Unfiled";
  const { box, shelf } = shelfAddress(slot);
  return `Shelf ${shelf} · Box ${box} · Slot ${slot}${pocket != null ? ` · Pocket ${pocket}` : ""}`;
};

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.CARDBIT_SITE !== "on") return notFound();
  const staff = await staffUser(request, (r) => currentCustomer(prisma, r));
  if (!staff) return notFound();
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const status = STATUSES.includes(url.searchParams.get("status") || "") ? url.searchParams.get("status")! : "";
  const where: Prisma.SiteCopyWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { setName: { contains: q, mode: "insensitive" } }, { number: { contains: q } }] } : {}),
  };
  const [rows, counts, total] = await Promise.all([
    prisma.siteCopy.findMany({ where, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.siteCopy.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.siteCopy.count({ where }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const chips = ["", ...STATUSES]
    .map((s) => `<a class="chip${s === status ? " on" : ""}" href="?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}">${s ? `${s.replace("_", " ")} (${count(s)})` : "All"}</a>`)
    .join("");
  const body = rows.length
    ? rows
        .map(
          (r) => `<tr><td>${r.image ? `<img src="${esc(r.image)}" alt="" width="40" loading="lazy">` : ""}</td>
<td><b>${esc(r.title)}</b><br><span class="m">${esc([r.setName, r.number, r.finish, r.language].filter(Boolean).join(" · "))}</span></td>
<td>${esc(r.condition || "")}</td><td>${esc(loc(r.slot, r.pocket))}</td><td>${esc(r.status)}</td>
<td>${r.retailBits != null ? r.retailBits.toLocaleString("en-US") : "—"}</td><td class="m">${r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="7" class="m">No cards yet. Receive cards in Card Broker with “Receive to cardbit.com”.</td></tr>`;
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stock · Cardbit Staff</title><meta name="robots" content="noindex">
<style>body{margin:0;background:#101619;color:#f6faf9;font:15px/1.45 system-ui,sans-serif}main{max-width:1200px;margin:0 auto;padding:16px}
h1{font:800 1.6rem Outfit,system-ui,sans-serif;margin:8px 0}a{color:#FFB65C}.m{color:#aab4b8;font-size:.85rem}
form{display:flex;gap:8px;margin:12px 0}input{flex:1;padding:10px;border-radius:8px;border:1px solid #33424a;background:#18242a;color:inherit}
button{padding:10px 16px;border:0;border-radius:8px;background:#4057F5;color:#fff;font-weight:700}
.chip{display:inline-block;margin:0 6px 6px 0;padding:6px 10px;border-radius:999px;background:#18242a;text-decoration:none;color:inherit;font-size:.85rem}.chip.on{background:#4057F5}
.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #26343b;text-align:left;vertical-align:top}th{font-size:.8rem;color:#aab4b8}</style></head>
<body><main><p class="m">Signed in as ${esc(staff.email)} · <a href="/staff/shipping">Shipping desk</a></p><h1>Site Stock</h1>
<form><input name="q" value="${esc(q)}" placeholder="Search name, set or number" aria-label="Search"><input type="hidden" name="status" value="${esc(status)}"><button>Search</button></form>
<div>${chips}</div><p class="m">${total.toLocaleString("en-US")} card${total === 1 ? "" : "s"}${total > rows.length ? `, newest ${rows.length} shown` : ""}</p>
<div class="wrap"><table><thead><tr><th></th><th>Card</th><th>Condition</th><th>Location</th><th>Status</th><th>Cardbits</th><th>Received</th></tr></thead><tbody>${body}</tbody></table></div></main></body></html>`;
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY" } });
}
