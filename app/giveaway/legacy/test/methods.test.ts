import { describe, expect, it } from "vitest";
import { methodKey, methodLabel, methodRows } from "../app/lib/entries/methods";

const actions = [
  { id: "s", type: "SIGNUP" as const, label: "Sign Up", config: null },
  {
    id: "w",
    type: "SOCIAL_FOLLOW" as const,
    label: "Follow Us On Whatnot",
    config: null,
  },
  {
    id: "i",
    type: "SOCIAL_FOLLOW" as const,
    label: "Follow Us On Instagram",
    config: null,
  },
  { id: "r", type: "REFERRAL" as const, label: "Refer A Friend", config: null },
  {
    id: "old",
    type: "VISIT_URL" as const,
    label: "Old Task",
    config: { archived: true },
  },
  {
    id: "gone",
    type: "VISIT_URL" as const,
    label: "Unused Old Task",
    config: { archived: true },
  },
];

describe("entries by method", () => {
  it("keys actions and referrals by action, everything else by source", () => {
    expect(methodKey("ACTION", "w")).toBe("action:w");
    expect(methodKey("REFERRAL", "r")).toBe("action:r");
    expect(methodKey("PURCHASE", null)).toBe("purchase");
    expect(methodKey("ROLLBACK", "r")).toBe("rollback");
  });

  it("lists each action by its own label, then purchases and imports, with shares", () => {
    const rows = methodRows(
      [
        { key: "action:s", entries: 10, times: 10, people: 10 },
        { key: "action:w", entries: 100, times: 1, people: 1 },
        { key: "action:old", entries: 5, times: 5, people: 5 },
        { key: "purchase", entries: 80, times: 2, people: 2 },
        { key: "import", entries: 5, times: 1, people: 1 },
        { key: "rollback", entries: -50, times: 0, people: 0 },
        { key: "action:deleted", entries: 0, times: 0, people: 0 },
      ],
      actions,
    );
    expect(rows.map((r) => r.label)).toEqual([
      "Sign Up",
      "Follow Us On Whatnot",
      "Follow Us On Instagram",
      "Refer A Friend",
      "Old Task (Removed)",
      "Purchases",
      "Imported (GiveawayNinja)",
      "Refunds And Clawbacks",
      "Removed Actions",
    ]);
    expect(rows.find((r) => r.key === "action:i")).toMatchObject({
      entries: 0,
      share: 0,
    });
    expect(rows.find((r) => r.key === "action:w")?.share).toBeCloseTo(
      100 / 200,
    );
    expect(rows.find((r) => r.key === "rollback")?.share).toBe(0);
  });

  it("labels single events", () => {
    expect(methodLabel("ACTION", "i", actions)).toBe("Follow Us On Instagram");
    expect(methodLabel("PURCHASE", null, actions)).toBe("Purchases");
    expect(methodLabel("ACTION", "nope", actions)).toBe("Removed Action");
  });
});
