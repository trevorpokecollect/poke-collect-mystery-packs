// Staff stock desk for the standalone site: every SiteCopy Card Broker sent, with slot/pocket,
// plus the controls to price printings, fill pack pools and turn pack editions on.
// 404 unless CARDBIT_SITE=on and the signed-in email is in SITE_STAFF_EMAILS.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { esc } from "../site/core/simple-page";
import { priceKey, shelfAddress } from "../site/core/stock.server";
import { DeskError, setPrice } from "../site/core/stock-desk.server";
import { notFound, sameOrigin, staffUser } from "../site/shipping/staff.server";

const STATUSES = ["FOR_SALE", "POOLED", "VAULTED", "SHIP_LOCKED", "SHIPPED", "REMOVED"];
const resolve = (r: Request) => currentCustomer(prisma, r);
const loc = (slot: number | null, pocket: number | null) => {
  if (slot == null) return "Unfiled";
  const { box, shelf } = shelfAddress(slot);
  return `Shelf ${shelf} · Box ${box} · Slot ${slot}${pocket != null ? ` · Pocket ${pocket}` : ""}`;
};
const bitsOrNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[, ]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 && n <= 10_000_000 ? n : NaN;
};

async function gate(request: Request) {
  if (process.env.CARDBIT_SITE !== "on") return null;
  return staffUser(request, resolve);
}

export async function action({ request }: ActionFunctionArgs) {
  const staff = await gate(request);
  if (!staff) return notFound();
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  const back = String(fd.get("back") || "/staff/stock");
  let note = "";
  if (intent === "price") {
    try {
      await setPrice(prisma, `staff:${staff.email}`, String(fd.get("printingKey") || ""), String(fd.get("condition") || ""), fd.get("retailBits"), fd.get("buybackBits"));
      note = "Price saved. Card Broker's next price update replaces it.";
    } catch (e) {
      if (!(e instanceof DeskError)) throw e;
      note = e.message;
    }
  } else if (intent === "pool" || intent === "unpool") {
    const ids = fd.getAll("copyId").map(String).filter(Boolean).slice(0, 500);
    const packId = String(fd.get("packId") || "");
    if (!ids.length) note = "Select cards first.";
    else if (intent === "pool" && !(await prisma.sitePack.findUnique({ where: { id: packId } }))) note = "Choose a pack.";
    else {
      const from = intent === "pool" ? "FOR_SALE" : "POOLED";
      const to = intent === "pool" ? "POOLED" : "FOR_SALE";
      const moved = await prisma.$transaction(async (tx) => {
        const rows = await tx.siteCopy.findMany({ where: { id: { in: ids }, status: from, ownerId: null } });
        for (const r of rows) {
          await tx.siteCopy.update({ where: { id: r.id }, data: { status: to, packId: intent === "pool" ? packId : null } });
          await tx.siteCopyEvent.create({
            data: { copyId: r.id, fromStatus: from, toStatus: to, actor: `staff:${staff.email}`, reason: intent === "pool" ? `added to ${packId} pool` : "returned to shop" },
          });
        }
        return rows.length;
      });
      note = `${moved} card${moved === 1 ? "" : "s"} moved${moved < ids.length ? ` (${ids.length - moved} skipped: not in the right status)` : ""}.`;
    }
  } else if (intent === "pack") {
    const id = String(fd.get("packId") || "");
    const priceBits = bitsOrNull(fd.get("priceBits"));
    const cardsPerPack = Number(fd.get("cardsPerPack"));
    if (!priceBits || Number.isNaN(priceBits) || !Number.isInteger(cardsPerPack) || cardsPerPack < 1 || cardsPerPack > 20) note = "Check the pack price and cards per pack.";
    else {
      await prisma.sitePack.update({ where: { id }, data: { priceBits, cardsPerPack, active: fd.get("active") === "on" } });
      note = "Pack saved.";
    }
  }
  const u = new URL(back, "http://x");
  u.searchParams.set("note", note);
  return new Response(null, { status: 303, headers: { Location: u.pathname + u.search } });
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.CARDBIT_SITE !== "on") return notFound();
  // Signed out → sign in first (signed-in non-staff still get a plain 404).
  if (!(await resolve(request))) {
    const u = new URL(request.url);
    return new Response(null, { status: 303, headers: { Location: `/sign-in?return_to=${encodeURIComponent(u.pathname + u.search)}` } });
  }
  const staff = await gate(request);
  if (!staff) return notFound();
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const status = STATUSES.includes(url.searchParams.get("status") || "") ? url.searchParams.get("status")! : "";
  const note = (url.searchParams.get("note") || "").slice(0, 200);
  const where: Prisma.SiteCopyWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { setName: { contains: q, mode: "insensitive" } }, { number: { contains: q } }] } : {}),
  };
  const [rows, counts, total, packs, poolCounts] = await Promise.all([
    prisma.siteCopy.findMany({ where, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.siteCopy.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.siteCopy.count({ where }),
    prisma.sitePack.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.siteCopy.groupBy({ by: ["packId"], where: { status: "POOLED" }, _count: { _all: true } }),
  ]);
  const prices = new Map(
    (await prisma.sitePrice.findMany({ where: { printingKey: { in: [...new Set(rows.map((r) => priceKey(r.printingKey, r.condition)))] } } })).map((p) => [p.printingKey, p]),
  );
  const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const back = esc(url.pathname + url.search.replace(/([?&])note=[^&]*&?/, "$1"));
  const chips = ["", ...STATUSES]
    .map((s) => `<a class="chip${s === status ? " on" : ""}" href="?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}">${s ? `${s.replace("_", " ")} (${count(s)})` : "All"}</a>`)
    .join("");
  const packRows = packs
    .map((p) => {
      const n = poolCounts.find((c) => c.packId === p.id)?._count._all ?? 0;
      return `<form method="post" class="pk"><input type="hidden" name="intent" value="pack"><input type="hidden" name="packId" value="${esc(p.id)}"><input type="hidden" name="back" value="${back}">
<b>${esc(p.title)}</b><span class="m">${n} in pool · ${Math.floor(n / p.cardsPerPack)} packs</span>
<label>Price <input name="priceBits" value="${p.priceBits}" inputmode="numeric" size="6"></label>
<label>Cards <input name="cardsPerPack" value="${p.cardsPerPack}" inputmode="numeric" size="2"></label>
<label><input type="checkbox" name="active"${p.active ? " checked" : ""}> On sale</label><button>Save</button></form>`;
    })
    .join("");
  const packOpts = packs.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join("");
  const body = rows.length
    ? rows
        .map((r) => {
          const p = prices.get(priceKey(r.printingKey, r.condition));
          const pickable = (r.status === "FOR_SALE" || r.status === "POOLED") && !r.ownerId;
          return `<tr><td>${pickable ? `<input type="checkbox" name="copyId" value="${esc(r.id)}" form="bulk" aria-label="Select ${esc(r.title)}">` : ""}</td>
<td>${r.image ? `<img src="${esc(r.image)}" alt="" width="40" loading="lazy">` : ""}</td>
<td><b>${esc(r.title)}</b><br><span class="m">${esc([r.setName, r.number, r.finish, r.language, r.condition].filter(Boolean).join(" · "))}</span></td>
<td>${esc(loc(r.slot, r.pocket))}</td><td>${esc(r.status)}${r.packId ? `<br><span class="m">${esc(r.packId)}</span>` : ""}</td>
<td><form method="post" class="pr"><input type="hidden" name="intent" value="price"><input type="hidden" name="printingKey" value="${esc(r.printingKey)}"><input type="hidden" name="condition" value="${esc(r.condition)}"><input type="hidden" name="back" value="${back}">
<input name="retailBits" value="${p?.retailBits ?? ""}" placeholder="Price" inputmode="numeric" size="6" aria-label="Price in Cardbits">
<input name="buybackBits" value="${p?.buybackBits ?? ""}" placeholder="Buyback" inputmode="numeric" size="6" aria-label="Buyback in Cardbits"><button>Save</button></form></td>
<td class="m">${r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="7" class="m">No cards yet. Receive cards in Card Broker with “Receive to cardbit.com”.</td></tr>`;
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stock · Cardbit Staff</title><meta name="robots" content="noindex">
<style>body{margin:0;background:#101619;color:#f6faf9;font:15px/1.45 system-ui,sans-serif}main{max-width:1280px;margin:0 auto;padding:16px}
h1{font:800 1.6rem Outfit,system-ui,sans-serif;margin:8px 0}h2{font:800 1.15rem Outfit,system-ui,sans-serif;margin:20px 0 8px}a{color:#FFB65C}.m{color:#aab4b8;font-size:.85rem}
input,select{padding:8px;border-radius:8px;border:1px solid #33424a;background:#18242a;color:inherit;font:inherit}
button{padding:8px 14px;border:0;border-radius:8px;background:#4057F5;color:#fff;font-weight:700;cursor:pointer}
.search{display:flex;gap:8px;margin:12px 0}.search input{flex:1}.note{background:#1d2b22;border-left:4px solid #FFB65C;padding:8px 12px;border-radius:6px}
.pk{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #26343b}.pk b{min-width:140px}
.pr{display:flex;gap:6px;flex-wrap:wrap}.bulk{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}
.chip{display:inline-block;margin:0 6px 6px 0;padding:6px 10px;border-radius:999px;background:#18242a;text-decoration:none;color:inherit;font-size:.85rem}.chip.on{background:#4057F5}
.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #26343b;text-align:left;vertical-align:top}th{font-size:.8rem;color:#aab4b8}</style></head>
<body><main><p class="m">Signed in as ${esc(staff.email)} · <a href="/staff/shipping">Shipping desk</a></p><h1>Site Stock</h1>
${note ? `<p class="note" role="status">${esc(note)}</p>` : ""}
<h2>Packs</h2><p class="m">Prices in Cardbits (100 = $1). A pack can only be bought while it's on sale and its pool has enough cards.</p>${packRows}
<h2>Cards</h2><form class="search"><input name="q" value="${esc(q)}" placeholder="Search name, set or number" aria-label="Search"><input type="hidden" name="status" value="${esc(status)}"><button>Search</button></form>
<div>${chips}</div><p class="m">${total.toLocaleString("en-US")} card${total === 1 ? "" : "s"}${total > rows.length ? `, newest ${rows.length} shown` : ""}. Singles show in the shop once their printing has a price. Card Broker sets prices per printing and condition; a price saved here lasts until its next update.</p>
<form method="post" id="bulk" class="bulk"><input type="hidden" name="back" value="${back}">
<select name="packId" aria-label="Pack">${packOpts}</select><button name="intent" value="pool">Add Selected to Pack Pool</button>
<button name="intent" value="unpool">Return Selected to Shop</button></form>
<div class="wrap"><table><thead><tr><th></th><th></th><th>Card</th><th>Location</th><th>Status</th><th>Price / Buyback (Cardbits)</th><th>Received</th></tr></thead><tbody>${body}</tbody></table></div></main></body></html>`;
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY" } });
}
