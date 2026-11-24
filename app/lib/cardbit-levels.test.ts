import { describe, expect, it } from "vitest";
import {
  ICONS,
  MAX_LEVEL,
  cardbitDay,
  defaultColor,
  iconUnlocked,
  initials,
  levelForXp,
  levelProgress,
  packXp,
  previousDay,
  spinnerFor,
  xpForLevel,
} from "./cardbit-levels";

describe("Cardbit levels", () => {
  it("uses a rising curve starting at zero", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(150);
    expect(xpForLevel(10)).toBe(4950);
    for (let l = 2; l <= MAX_LEVEL; l++) expect(xpForLevel(l)).toBeGreaterThan(xpForLevel(l - 1));
    expect(levelForXp(149)).toBe(1);
    expect(levelForXp(150)).toBe(2);
    expect(levelForXp(10_000_000)).toBe(MAX_LEVEL);
    expect(levelProgress(200)).toMatchObject({ level: 2, levelXp: 50, nextLevelXp: 250, toNext: 200 });
    expect(levelProgress(10_000_000).nextLevelXp).toBeNull();
  });

  it("gives 10 XP per $1 spent plus 25 per pack", () => {
    expect(packXp(1000)).toBe(125); // $10 Mystery
    expect(packXp(1299)).toBe(154); // $12.99 Booster
    expect(packXp(0)).toBe(25);
    expect(packXp(-5)).toBe(0);
    expect(packXp(1.5)).toBe(0);
  });

  it("opens only basic icons at the start and better spinners with level", () => {
    expect(ICONS.filter((i) => iconUnlocked(i, 1)).map((i) => i.id)).toEqual(["latch", "blazebit", "driplink", "mossbit"]);
    expect(ICONS.every((i) => !i.animated)).toBe(true);
    expect(spinnerFor(1).id).toBe("basic");
    expect(spinnerFor(10).id).toBe("silver");
    expect(spinnerFor(50).id).toBe("cobalt");
  });

  it("makes initials and a stable default color", () => {
    expect(initials("trevor", "embry")).toBe("TE");
    expect(initials("", null)).toBe("?");
    expect(defaultColor("gid://shopify/Customer/1")).toBe(defaultColor("gid://shopify/Customer/1"));
  });

  it("runs the day on Central time", () => {
    expect(cardbitDay(new Date("2026-11-25T05:59:00Z"))).toBe("2026-11-24");
    expect(cardbitDay(new Date("2026-11-25T06:00:00Z"))).toBe("2026-11-25");
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
  });
});
