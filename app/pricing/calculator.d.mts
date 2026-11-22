export type PriceCard = {
  key: string;
  id: string;
  name: string;
  no: string;
  set: string;
  finish: string;
  condition: string;
  market: number | null;
  retail: number | null;
  cash: number | null;
  credit: number | null;
  value: number | null;
  buyback: number | null;
};
export type Pool = {
  id: string;
  title: string;
  draws: number;
  price: number;
  pricing: {
    basis: "poke-collect-retail";
    targetBps: number;
    buybackBps: number;
  };
  rows: { i: number; qty: number; tier: string }[];
};
export type Catalog = {
  version: string;
  date: string;
  cards: PriceCard[];
  pools: Pool[];
};
export type Band = {
  set: string;
  min: number;
  max: number | null;
  bps: number;
};
export type BuyRule =
  | { mode: "current" | "off" }
  | { mode: "retail" | "market" | "value"; bps: number; coverage: "quoted" };
export type ValueRule =
  | { mode: "current" }
  | { mode: "market"; bps: number }
  | { mode: "fixed"; amount: number };
export type Policy = { buyback?: BuyRule; value?: ValueRule };
export type PoolRule = {
  price?: number;
  target?: number;
  buyback?: BuyRule;
  bands?: Band[];
  quantities?: Record<string, number>;
};
export type Draft = {
  version: string;
  defaults: Policy;
  pools: Record<string, PoolRule>;
  cards: Record<string, Policy>;
};
type Rules = {
  price: number;
  target: number;
  buyback?: BuyRule;
  snapshotBps?: number;
  bands: Band[];
  quantities: Record<string, number>;
};
type Quote = { value: number | null; offer: number | null; unknown: boolean };
type Totals = Record<
  "market" | "value" | "offer" | "cash" | "credit",
  number | null
>;
declare const Pricing: {
  empty(version: string): Draft;
  validate(draft: unknown, catalog: Catalog): draft is Draft;
  properties(pool: Pool, draft: Draft): Rules;
  cardQuote(card: PriceCard, draft: Draft, rules?: Rules): Quote;
  poolSummary(
    pool: Pool,
    cards: PriceCard[],
    draft: Draft,
  ): {
    rows: ({ i: number; qty: number; tier: string; card: PriceCard } & Quote)[];
    total: Totals;
    ev: Totals;
    count: number;
    eligible: number;
    price: number;
    target: number;
    targetValue: number;
    packs: number;
    remainder: number;
  };
  portion(amount: number, bps: number): number;
};
export default Pricing;
