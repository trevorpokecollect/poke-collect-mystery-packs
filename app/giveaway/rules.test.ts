import { describe, it, expect } from "vitest";
import {
  drawWindow,
  paidEntries,
  giveawayTotals,
  isSocial,
  rulesLink,
  STATES,
  SOCIAL,
} from "./rules";
import { drawWinners, snapshotHash } from "./draw";
import { verifiedMerchandise } from "./purchases.server";
import { subscribers } from "./consent.server";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
describe("Cardbit giveaway rules", () => {
  it.each([
    [1000, 10],
    [5000, 50],
    [10000, 100],
    [50000, 500],
    [99, 0],
    [199, 1],
    [0, 0],
    [-100, 0],
    [1.5, 0],
  ])("counts %s purchased Cardbits as %s entries", (v, n) =>
    expect(paidEntries(v)).toBe(n),
  );
  it("changes the period at exactly 8 pm Central and supports both daylight transitions", () => {
    expect(drawWindow(new Date("2026-11-24T01:59:59Z")).day).toBe("2026-11-23");
    expect(drawWindow(new Date("2026-11-24T02:00:00Z")).day).toBe("2026-11-24");
    const spring = drawWindow(new Date("2026-03-08T15:00Z")),
      fall = drawWindow(new Date("2026-11-01T15:00Z"));
    expect(+spring.closesAt - +spring.opensAt).toBe(23 * 3600000);
    expect(+fall.closesAt - +fall.opensAt).toBe(25 * 3600000);
  });
  it("filters unentered, unsubscribed, held and voided entries from the draw", () => {
    const e = (
      customerId: string,
      kind: string,
      entries: number,
      voided = false,
    ) => ({ customerId, kind, entries, voided });
    expect(
      giveawayTotals(
        [
          e("a", "daily", 1),
          e("a", "purchase", 100),
          e("a", "facebook", 50, true),
          e("b", "purchase", 500),
          e("c", "daily", 1),
        ],
        new Set(["a", "b"]),
      ),
    ).toEqual([{ entrantId: "a", entries: 101 }]);
  });
  it("reproduces the same draw and proof regardless of input order", () => {
    const s = "77".repeat(32),
      t = [
        { entrantId: "a", entries: 1 },
        { entrantId: "b", entries: 500 },
      ];
    expect(drawWinners(t, 1, s)).toEqual(drawWinners([...t].reverse(), 1, s));
    expect(snapshotHash(t)).toBe(snapshotHash([...t].reverse()));
    expect(drawWinners([], 1, s)).toEqual([]);
  });
  it("uses verified invite and Cardbit pages; accepts 50 states and DC", () => {
    expect(STATES).toHaveLength(51);
    expect(STATES).toContain("DC");
    expect(STATES).not.toContain("PR");
    expect(SOCIAL.whatnot.href).toBe(
      "https://whatnot.com/invite/pokecollectcards",
    );
    expect(isSocial("__proto__")).toBe(false);
    expect(rulesLink("/pages/daily-rules")).toBe(
      "https://cardbit.com/pages/daily-rules",
    );
    expect(() => rulesLink("//elsewhere.test/path")).toThrow();
  });
  it("reads actual Shopify subscriptions and fails closed on incomplete upstream responses", async () => {
    const admin = (body: unknown) =>
      ({
        graphql: async () => Response.json(body),
      }) as unknown as AdminApiContext;
    expect([
      ...(await subscribers(
        admin({
          data: {
            nodes: [
              {
                id: "a",
                defaultEmailAddress: { marketingState: "SUBSCRIBED" },
              },
              { id: "b", defaultEmailAddress: { marketingState: "PENDING" } },
              null,
            ],
          },
        }),
        ["a", "b", "c"],
      )),
    ]).toEqual(["a"]);
    await expect(
      subscribers(admin({ errors: [{ message: "failure" }] }), ["a"]),
    ).rejects.toThrow();
  });
  it("requires confirmed paid non-test activity belonging to the referred customer", () => {
    const money = (amount: string) => ({
      shopMoney: { amount, currencyCode: "USD" },
    });
    const t = {
      test: false,
      manualPaymentGateway: false,
      kind: "CAPTURE",
      status: "SUCCESS",
      gateway: "approved",
      amountSet: money("10.00"),
    };
    const o = {
      id: "order",
      test: false,
      cancelledAt: null,
      customer: { id: "a" },
      displayFinancialStatus: "PAID",
      totalRefundedSet: money("0.00"),
      transactions: [t],
    };
    const providers = new Set(["approved"]);
    expect(verifiedMerchandise(o, "a", providers)).toBe(true);
    for (const bad of [
      { test: true },
      { cancelledAt: "y" },
      { displayFinancialStatus: "PENDING" },
      { totalRefundedSet: money("1.00") },
      { transactions: [{ ...t, kind: "AUTHORIZATION" }] },
      { transactions: [{ ...t, manualPaymentGateway: true }] },
    ])
      expect(verifiedMerchandise({ ...o, ...bad }, "a", providers)).toBe(false);
    expect(verifiedMerchandise(o, "b", providers)).toBe(false);
  });
});
