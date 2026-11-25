// Vault Portfolio for the standalone site: same response shape as the Shopify proxy
// (/apps/packs/api/portfolio), built from the customer's held SiteCopy rows.
// bits = Card Broker buyback offer (SitePrice.buybackBits); market = latest TCGplayer Market point
// (cents) from the same Card Broker Market history, only when CARDBIT_TCGPLAYER_MARKET_APPROVED=true.
import type { PrismaClient, SiteCopy } from "@prisma/client";
import { marketApproved } from "../../workspace/market.server";
import { identityKey } from "../../workspace/book.server";
import { portfolio, type Holding } from "../../workspace/model";
import { vaultMarketHistory, type VaultSeries } from "../../workspace/vault-market.server";
import { priceKey } from "../core/stock.server";

export const SITE_PORTFOLIO_SHOP = "cardbit-site";
const SOURCE = "site";

export const portfolioKey = (c: Pick<SiteCopy, "id" | "tcgplayerId" | "language" | "finish" | "condition">) =>
  identityKey({ tcgplayerId: c.tcgplayerId ?? undefined, language: c.language, printing: c.finish, condition: c.condition }) || `copy:${c.id}`;

export async function sitePortfolio(
  db: PrismaClient,
  customerId: string,
  market: (keys: string[]) => Promise<VaultSeries | null> = vaultMarketHistory,
  now = new Date(),
) {
  const allowMarket = marketApproved();
  const sealed = new Set(
    (await db.siteOpening.findMany({ where: { customerId, sealed: true }, select: { id: true } })).map((o) => o.id),
  );
  const copies = (await db.siteCopy.findMany({ where: { ownerId: customerId, status: "VAULTED" }, orderBy: { updatedAt: "desc" } })).filter(
    (c) => !c.openingId || !sealed.has(c.openingId),
  );
  const prices = new Map(
    (await db.sitePrice.findMany({ where: { printingKey: { in: [...new Set(copies.map((c) => priceKey(c.printingKey, c.condition)))] } } })).map(
      (p) => [p.printingKey, p],
    ),
  );
  const groups = new Map<string, { copy: SiteCopy; qty: number }>();
  for (const c of copies) {
    const k = portfolioKey(c);
    const g = groups.get(k);
    if (g) g.qty++;
    else groups.set(k, { copy: c, qty: 1 });
  }
  const series = allowMarket ? await market([...groups.keys()]) : null;
  const holdings: Holding[] = [...groups].map(([key, { copy: c, qty }]) => {
    const p = prices.get(priceKey(c.printingKey, c.condition));
    const points = series?.[key] ?? [];
    const last = points.at(-1);
    return {
      key,
      name: c.name,
      set: c.setName,
      number: c.number,
      finish: c.finish,
      condition: c.condition,
      language: c.language,
      retail: c.retailBits ?? p?.retailBits ?? null,
      cash: null,
      market: allowMarket && last ? last[1] : null,
      marketDate: allowMarket && last ? last[0] : null,
      retailDate: (p?.updatedAt ?? c.updatedAt).toISOString().slice(0, 10),
      qty,
      bits: p?.buybackBits ?? null,
      history: [],
    };
  });
  const data = portfolio(holdings, [], now.toISOString());
  const day = now.toISOString().slice(0, 10);
  const mark = {
    at: now,
    bits: data.priced === data.count ? data.bits : null,
    market: allowMarket && data.marked === data.count ? data.market : null,
  };
  const where = { shop: SITE_PORTFOLIO_SHOP, customer: customerId, source: SOURCE };
  await db.cardbitVaultMark.upsert({
    where: { shop_customer_source_day: { ...where, day } },
    create: { ...where, day, ...mark },
    update: mark,
  });
  const marks = await db.cardbitVaultMark.findMany({ where, orderBy: { day: "asc" } });
  data.history = marks.map((m) => ({ at: m.at.toISOString(), bits: m.bits, market: allowMarket ? m.market : null }));
  return {
    ...data,
    marketApproved: allowMarket,
    market: allowMarket ? data.market : null,
    marketHistory: allowMarket ? series : null,
    holdings: data.holdings.map((h) => ({
      key: h.key, name: h.name, set: h.set, number: h.number, finish: h.finish, condition: h.condition, language: h.language,
      qty: h.qty, bits: h.bits, market: h.market, marketDate: h.marketDate, retailDate: h.retailDate, history: h.history,
    })),
  };
}
