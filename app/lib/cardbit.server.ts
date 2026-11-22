// Shopify supplies the permanent store name after verifying each request.
export const CARDBIT_SHOP = "hhuuev-81.myshopify.com";
// The Cardbit release enables its store explicitly. Other installations keep their existing defaults.
export function isCardbit(shop: string, env: NodeJS.ProcessEnv = process.env) {
  return shop === CARDBIT_SHOP && env.CARDBIT_STOREFRONT_SHOP === CARDBIT_SHOP;
}

export function samplePack<T>(
  rows: { card: T; copies: number }[],
  count: number,
  random = Math.random,
): T[] {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    !rows.every((r) => Number.isSafeInteger(r.copies) && r.copies >= 0)
  )
    return [];
  const total = rows.reduce((n, row) => n + row.copies, 0);
  if (count < 1 || total < count) return [];
  const available = rows.map((row) => ({ ...row }));
  const picks: T[] = [];
  for (let remaining = total; picks.length < count; remaining--) {
    let ticket = Math.floor(random() * remaining);
    for (const row of available) {
      ticket -= row.copies;
      if (ticket < 0) {
        picks.push(row.card);
        row.copies--;
        break;
      }
    }
  }
  return picks;
}

/** Count complete remaining packs in the committed sequence, without disclosing their order. */
export function packFrequencies(
  slots: { cardId: string; card: { tier: string } }[],
  size: number,
) {
  if (!Number.isSafeInteger(size) || size < 1)
    throw new RangeError("Invalid pack size");
  const packs = Math.floor(slots.length / size);
  const cards = new Map<string, number>();
  const tiers = new Map<string, number>();
  for (let start = 0; start < packs * size; start += size) {
    const pack = slots.slice(start, start + size);
    for (const id of new Set(pack.map((s) => s.cardId)))
      cards.set(id, (cards.get(id) ?? 0) + 1);
    for (const tier of new Set(pack.map((s) => s.card.tier)))
      tiers.set(tier, (tiers.get(tier) ?? 0) + 1);
  }
  return { packs, cards, tiers };
}
