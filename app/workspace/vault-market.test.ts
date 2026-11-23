import { afterEach, expect, it, vi } from "vitest";
import { marketPrintings, vaultMarketHistory } from "./vault-market.server";
afterEach(() => vi.unstubAllEnvs());
it("selects unique keyed near-mint English and Japanese printings", () => {
  const good = "99|ja|reverse holofoil|near mint";
  expect(
    marketPrintings([
      good,
      good,
      "99|ja|reverse holofoil|played",
      "99|bad|normal|near mint",
      "invalid",
      "4000000000|en|normal|near mint",
    ]),
  ).toEqual([
    {
      key: good,
      product: 99,
      game: "pokemon-japan",
      finish: "reverse holofoil",
    },
  ]);
});
it("omits history when market display is disabled", async () => {
  vi.stubEnv("CARDBIT_TCGPLAYER_MARKET_APPROVED", "false");
  expect(await vaultMarketHistory(["65|en|normal|near mint"])).toBeNull();
});
