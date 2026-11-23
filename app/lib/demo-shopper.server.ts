import { topups } from "./cardbit-topups.server";
import { createHash, randomInt, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { enabled, reviewWorkspaceEnabled, readBook, lockBook, quoteFor, type Book, type Identity } from "../workspace/book.server";
import { samplePack } from "./cardbit.server";

export type DemoCard = Identity & {
  id: string;
  name: string;
  priceBits: number;
  buybackBits: number | null;
  cardbitValue: number;
  editionId: string | null;
  tier: string | null;
};
export type DemoPack = {
  id: string;
  title: string;
  priceBits: number;
  cardsPerPack: number;
  cardIds: string[];
};
export type Catalog = {
  cards: DemoCard[];
  packs: DemoPack[];
  replacesVersion?: string;
  archivedCards?: (Identity & { id: string; name: string; buybackBits?: number | null })[];
};
type Copy = {
  id: string;
  cardId: string;
  status: "held" | "sealed" | "shipping" | "returned";
  at: string;
  openingId: string | null;
  shipRequestId: string | null;
};
type Opening = {
  id: string;
  packId: string;
  sealed: boolean;
  at: string;
  copyIds: string[];
};
type Line = {
  kind: "pack" | "single";
  source: string;
  price: number;
  copyId?: string;
  openingId?: string;
};
type Order = {
  id: string;
  at: string;
  label: string;
  status: string;
  amount: number;
  lines: Line[];
};
type Shipment = {
  id: string;
  at: string;
  status: string;
  destination: string;
  rateCents: number;
  copyIds: string[];
  tracking?: { number: string } | null;
};
type Entry = {
  id: string;
  at: string;
  label: string;
  delta: number;
  orderId?: string;
};
type Result = {
  openingId?: string;
  copyId?: string;
  shipmentId?: string;
  orderId?: string;
  sealed?: boolean;
  approved?: boolean;
};
export type ShopperState = {
  v: number;
  version: string;
  balance: number;
  copies: Copy[];
  packs: Opening[];
  used: string[];
  stock: Record<string, number>;
  shipments: Shipment[];
  orders: Order[];
  history: Entry[];
  wants: string[];
  requests?: Record<string, { fingerprint: string; result: Result }>;
};
export class DemoError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export type ShopperAction = {
  action: string;
  id?: string;
  amount?: number;
  requestId: string;
  openLater?: boolean;
  payment?: string;
  copyIds?: string[];
  destination?: string;
};
const destinations: Record<string, number> = { madison: 495, seattle: 695 };
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const invalid = (message: string) => new DemoError("invalid", message, 400);
const jsonState = (state: ShopperState) =>
  state as unknown as Prisma.InputJsonValue;

export function shopAction(
  state: ShopperState,
  catalog: Catalog,
  input: ShopperAction,
  quotedVersion?: string,
  currentOffers?: Record<string, number | null>,
): Result {
  if (
    !input ||
    !uuid.test(input.requestId) ||
    typeof input.action !== "string" ||
    (input.id !== undefined &&
      (typeof input.id !== "string" || input.id.length > 300))
  )
    throw invalid("Review this action again.");
  const { action, id, amount, payment, requestId } = input;
  const ids = input.copyIds;
  if (ids !== undefined && !Array.isArray(ids))
    throw invalid("Invalid card selection.");
  if (
    action === "ship-group" &&
    (!Array.isArray(ids) ||
      !ids.length ||
      ids.length > 500 ||
      ids.some((x) => typeof x !== "string" || !uuid.test(x)) ||
      new Set(ids).size !== ids.length)
  )
    throw invalid("Choose each held card once.");
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        action,
        id ?? null,
        amount ?? null,
        payment ?? null,
        input.openLater === true,
        ids ? [...ids].sort() : null,
        input.destination ?? null,
      ]),
    )
    .digest("hex");
  const prior = state.requests?.[requestId];
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      throw new DemoError(
        "conflict",
        "This confirmation belongs to a different action.",
      );
    return prior.result;
  }
  if (
    quotedVersion &&
    quotedVersion !== state.version &&
    ["buy", "buyback", "open"].includes(action)
  ) {
    throw new DemoError(
      "catalog_changed",
      "Card prices or availability changed. Review your selection again.",
    );
  }
  const at = new Date().toISOString(),
    result: Result = {};
  const cards = new Map(catalog.cards.map((c) => [c.id, c]));
  function entry(label: string, delta: number, orderId?: string) {
    if (
      !Number.isSafeInteger(delta) ||
      !Number.isSafeInteger(state.balance + delta)
    )
      throw invalid("Invalid Cardbits amount.");
    if (state.balance + delta < 0)
      throw new DemoError(
        "insufficient_bits",
        "Add Cardbits before confirming this purchase.",
      );
    state.balance += delta;
    state.history.push({
      id: randomUUID(),
      at,
      label,
      delta,
      ...(orderId ? { orderId } : {}),
    });
  }
  function purchase(label: string, line: Line) {
    const orderId = randomUUID();
    entry(label, -line.price, orderId);
    state.orders.push({
      id: orderId,
      label,
      at,
      status: "Paid",
      lines: [line],
      amount: line.price,
    });
    result.orderId = orderId;
  }
  function held(copyId?: string) {
    const copy = state.copies.find((c) => c.id === copyId);
    if (!copy || copy.status !== "held")
      throw new DemoError(
        "not_held",
        "This copy is unavailable in your vault.",
      );
    return copy;
  }
  if (action === "topup") {
    if (
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > 1_000_000 ||
      !["demo-4242", "demo-0002"].includes(payment || "")
    )
      throw invalid("Choose a demo card and a valid Cardbits amount.");
    result.approved = payment === "demo-4242";
    entry(
      result.approved
        ? "Demo Card •4242 · Cardbits Purchase"
        : "Demo Card •0002 · Declined",
      result.approved ? amount : 0,
    );
    const bonus = topups.find((tier) => tier.amount === amount)?.bonus;
    if (result.approved && bonus) entry("Cardbits Top-Up Bonus", bonus);
  } else if (action === "open") {
    const pack = catalog.packs.find((p) => p.id === id);
    if (!pack)
      throw new DemoError("not_found", "This edition is unavailable.", 404);
    const taken = new Set(state.used);
    const available = pack.cardIds
      .filter((key) => !taken.has(key))
      .map((card) => ({ card, copies: 1 }));
    const drawn = samplePack(
      available,
      pack.cardsPerPack,
      () => randomInt(0x100000000) / 0x100000000,
    );
    if (drawn.length !== pack.cardsPerPack)
      throw new DemoError("sold_out", "This edition has sold out.");
    const openingId = randomUUID(),
      sealed = input.openLater === true;
    purchase(pack.title, {
      kind: "pack",
      source: pack.id,
      price: pack.priceBits,
      openingId,
    });
    const copyIds: string[] = [];
    for (const cardId of drawn.sort(
      (a, b) => cards.get(a)!.cardbitValue - cards.get(b)!.cardbitValue,
    )) {
      const copyId = randomUUID();
      state.copies.push({
        id: copyId,
        cardId,
        openingId,
        shipRequestId: null,
        status: sealed ? "sealed" : "held",
        at,
      });
      state.used.push(cardId);
      copyIds.push(copyId);
    }
    state.packs.push({ id: openingId, packId: pack.id, at, sealed, copyIds });
    result.openingId = openingId;
    result.sealed = sealed;
  } else if (action === "reveal") {
    const pack = state.packs.find((p) => p.id === id);
    if (!pack)
      throw new DemoError("not_found", "This pack is unavailable.", 404);
    if (pack.sealed) {
      const copyIds = new Set(pack.copyIds);
      for (const copy of state.copies)
        if (copyIds.has(copy.id) && copy.status === "sealed")
          copy.status = "held";
      pack.sealed = false;
    }
    result.openingId = pack.id;
  } else if (action === "buy") {
    const card = cards.get(id || "");
    if (!card || (state.stock[card.id] ?? (card.editionId ? 0 : 1)) < 1)
      throw new DemoError("sold_out", "This single has sold out.");
    if (!Number.isSafeInteger(card.priceBits) || card.priceBits <= 0)
      throw new DemoError("unpriced", "Retail Price Unavailable.");
    const available = state.stock[card.id] ?? 1;
    const copyId = randomUUID();
    purchase(card.name, {
      kind: "single",
      source: card.id,
      price: card.priceBits,
      copyId,
    });
    state.stock[card.id] = available - 1;
    state.copies.push({
      id: copyId,
      cardId: card.id,
      openingId: null,
      shipRequestId: null,
      status: "held",
      at,
    });
    result.copyId = copyId;
  } else if (action === "buyback") {
    const copy = held(id),
      listed = cards.get(copy.cardId),
      archived = !listed && currentOffers?.[copy.cardId] ? catalog.archivedCards?.find(c => c.id === copy.cardId) : null,
      card = listed ?? (archived ? { ...archived, buybackBits: currentOffers?.[copy.cardId] } : null);
    if (
      !card?.buybackBits ||
      !Number.isSafeInteger(card.buybackBits) ||
      card.buybackBits < 1
    )
      throw new DemoError(
        "no_offer",
        "No buyback offer is available for this printing.",
      );
    entry("Sold Back · " + card.name, card.buybackBits);
    copy.status = "returned";
    if (listed) state.stock[card.id] = (state.stock[card.id] ?? (listed.editionId ? 0 : 1)) + 1;
    result.copyId = copy.id;
  } else if (action === "ship-group") {
    const destination = input.destination || "";
    if (!Object.hasOwn(destinations, destination))
      throw invalid("Choose a shipping destination.");
    const copies = ids!.map(held),
      shipmentId = randomUUID();
    for (const copy of copies) {
      copy.status = "shipping";
      copy.shipRequestId = shipmentId;
    }
    state.shipments.push({
      id: shipmentId,
      at,
      status: "preparing",
      destination,
      rateCents: destinations[destination],
      copyIds: copies.map((c) => c.id),
    });
    entry(
      "Shipment Requested · " +
        copies.length +
        " " +
        (copies.length === 1 ? "Card" : "Cards"),
      0,
    );
    result.shipmentId = shipmentId;
  } else if (action === "want-add" || action === "want-remove") {
    if (!id) throw invalid("Choose a printing.");
    const wants = new Set(state.wants);
    if (action === "want-add") wants.add(id);
    else wants.delete(id);
    state.wants = [...wants];
  } else throw invalid("This action is unavailable.");
  (state.requests ??= {})[requestId] = { fingerprint, result };
  return result;
}

export function shopperView(
  state: ShopperState,
  name: string,
  accountRef: string,
  catalog?: Catalog,
) {
  const { balance, used, stock, wants } = state;
  const copies = state.copies.filter((c) => c.status !== "sealed");
  const openings = state.packs
    .slice()
    .reverse()
    .map(({ copyIds, ...p }) => ({
      ...p,
      cardCount: copyIds.length,
      copyIds: p.sealed ? [] : copyIds,
    }));
  const visibleCardIds = new Set(copies.map((copy) => copy.cardId));
  const historyCards =
    catalog?.archivedCards?.filter((card) => visibleCardIds.has(card.id)) ?? [];
  return {
    historyCards,
    topupPromotions: true,
    version: state.version,
    account: { id: accountRef, name, bits: balance },
    used,
    stock,
    wants,
    copies,
    openings,
    shipments: state.shipments.slice().reverse(),
    orders: state.orders.slice().reverse(),
    history: state.history.slice().reverse(),
  };
}

function shopperOffers(catalog: Catalog, book: Book, review: boolean) {
  const prices: Record<string, number | null> = {};
  for (const card of [...catalog.cards, ...(catalog.archivedCards ?? [])]) {
    if (review || ["ja", "jp", "japanese"].includes(String(card.language).trim().toLowerCase()))
      prices[card.id] = quoteFor(card, book);
  }
  return prices;
}

export async function demoAccount(
  db: PrismaClient,
  shop: string,
  customerId: string,
  seed: ShopperState,
  catalog: Catalog,
  input?: ShopperAction,
  quotedVersion?: string,
) {
  const where = { shop_customerId: { shop, customerId } };
  const load = async (tx: Prisma.TransactionClient) => {
    const row = await tx.cardbitDemoAccount.findUnique({ where });
    if (row) return row.state as unknown as ShopperState;
    // A GET can arrive while first-time checkout is initializing this customer.
    await tx.$executeRaw`INSERT INTO "CardbitDemoAccount" ("shop","customerId","state")
      VALUES (${shop}, ${customerId}, ${JSON.stringify(seed)}::jsonb)
      ON CONFLICT ("shop","customerId") DO NOTHING`;
    const created = await tx.cardbitDemoAccount.findUniqueOrThrow({ where });
    return created.state as unknown as ShopperState;
  };
  if (!input) {
    const state = await load(db);
    if (state.version === seed.version) {
      const prices = enabled(shop) ? shopperOffers(catalog, await readBook(db), reviewWorkspaceEnabled(shop)) : undefined;
      return { state, result: {}, prices };
    }
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"demo-shopper/" + shop + "/" + customerId},0))::text`;
    const state = await load(tx);
    if (state.version !== seed.version) {
      const knownIds = new Set(
        [...catalog.cards, ...(catalog.archivedCards ?? [])].map(
          (card) => card.id,
        ),
      );
      if (
        state.version !== catalog.replacesVersion ||
        state.copies.some((copy) => !knownIds.has(copy.cardId))
      )
        throw new DemoError(
          "catalog_changed",
          "Reload your account to load the current catalog.",
        );
      // The signed replacement catalog preserves existing copy IDs and entitlements.
      // Only its version changes. Never restore the starting wallet or orders here.
      state.version = seed.version;
    }
    let prices: Record<string,number|null> | undefined;
    let current=catalog;
    if (enabled(shop)) {
      await lockBook(tx);
      const book=await readBook(tx);
      const offers = shopperOffers(catalog, book, reviewWorkspaceEnabled(shop));
      prices = offers;
      current = {...catalog, cards:catalog.cards.map(card => Object.hasOwn(offers,card.id)
        ? {...card, buybackBits:offers[card.id], cardbitValue:offers[card.id] ?? 0} : card)};
      if (input?.action==="buyback" && !state.requests?.[input.requestId]) {
        const copy=state.copies.find(c=>c.id===input.id && c.status==="held");
        if (!copy || (Object.hasOwn(prices, copy.cardId) && (!prices[copy.cardId] || input.amount !== prices[copy.cardId])))
          throw new DemoError("catalog_changed","The Cardbits offer changed. Review the current price.");
      }
    }
    const result = input ? shopAction(state, current, input, quotedVersion, prices) : {};
    await tx.cardbitDemoAccount.update({
      where,
      data: { state: jsonState(state) },
    });
    return { state, result, prices };
  });
}
