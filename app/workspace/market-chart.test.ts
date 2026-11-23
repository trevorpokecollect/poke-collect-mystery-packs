import { afterEach, expect, it, vi } from "vitest";
import { marketChartHistory } from "./market-chart.server";
import { site } from "./sources.server";
vi.mock("./sources.server", () => ({ site: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("reads a dated raw market price from the Card Broker chart for the exact printing", async () => {
  const day = new Date().toISOString().slice(0, 10);
  // A React Router single-fetch response, including a row with no observed market.
  const wire = [
    { _1: 2 },
    "routes/card",
    { _3: 4 },
    "data",
    { _5: 6, _12: 13 },
    "card",
    { _7: 8, _9: 10, _11: 18 },
    "id",
    "card-id",
    "game",
    "pokemon-japan",
    "printing",
    "rows",
    [14, 17],
    [15, 16],
    day,
    20,
    [15, -5],
    "Holofoil",
  ];
  vi.mocked(site).mockResolvedValue({
    items: [
      {
        id: "card-id",
        game: "pokemon-japan",
        printing: "Holofoil",
        tcgplayerId: 32,
      },
    ],
  });
  const fetchChart = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(wire) + "\n"));
  vi.stubGlobal("fetch", fetchChart);
  const p = {
    key: "32|ja|holofoil|near mint",
    product: 32,
    game: "pokemon-japan",
    finish: "holofoil",
  };
  expect(await marketChartHistory([p])).toEqual({ [p.key]: [[day, 2000]] });
  expect(fetchChart.mock.calls[0][0]).toBe(
    "https://www.cardbroker.app/market/card/card-id.data",
  );
  await marketChartHistory([p]);
  expect(fetchChart).toHaveBeenCalledTimes(1);
});

it("skips an ambiguous catalog match without fetching a chart", async () => {
  const c = { id: "a", game: "pokemon", printing: "Normal", tcgplayerId: 18 };
  vi.mocked(site).mockResolvedValue({ items: [c, { ...c, id: "b" }] });
  const fetchChart = vi.fn();
  vi.stubGlobal("fetch", fetchChart);
  expect(
    await marketChartHistory([
      {
        key: "18|en|normal|near mint",
        product: 18,
        game: "pokemon",
        finish: "normal",
      },
    ]),
  ).toEqual({});
  expect(fetchChart).not.toHaveBeenCalled();
});

it("resolves older Market catalog IDs while rejecting another product with the same name", async () => {
  const p = {
    key: "33|ja|holofoil|near mint",
    product: 33,
    game: "pokemon-japan",
    finish: "holofoil",
  };
  const card = {
    id: "new-id",
    tcgplayerId: 33,
    game: p.game,
    name: "Example - 12/50",
    number: "12/50",
    set: { name: "Test Set" },
    printing: "Holofoil",
  };
  vi.mocked(site).mockResolvedValue({ items: [card] });
  const day = new Date().toISOString().slice(0, 10);
  function response(value: unknown) {
    // Encode the JSON subset of the pinned React Router stream protocol.
    const records: unknown[] = [];
    function put(v: unknown): number {
      if (v === null) return -5;
      const n = records.length;
      records.push(null);
      if (Array.isArray(v)) records[n] = v.map(put);
      else if (typeof v === "object")
        records[n] = Object.fromEntries(
          Object.entries(v as Record<string, unknown>).map(([k, val]) => [
            "_" + put(k),
            put(val),
          ]),
        );
      else records[n] = v;
      return n;
    }
    put(value);
    return new Response(JSON.stringify(records) + "\n");
  }
  const hit = {
    ...card,
    id: "old-id",
    imageUrl: "https://product-images.tcgplayer.com/fit-in/400x400/33.jpg",
  };
  const fetchChart = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(
      response({
        "routes/search": {
          data: {
            cards: [
              hit,
              {
                ...hit,
                id: "wrong",
                imageUrl: "https://product-images.tcgplayer.com/44.jpg",
              },
            ],
          },
        },
      }),
    )
    .mockResolvedValueOnce(
      response({ "routes/card": { data: { card: hit, rows: [[day, 20]] } } }),
    );
  vi.stubGlobal("fetch", fetchChart);
  expect(await marketChartHistory([p])).toEqual({ [p.key]: [[day, 2000]] });
  expect(fetchChart.mock.calls[2][0]).toBe(
    "https://www.cardbroker.app/market/card/old-id.data",
  );
});
