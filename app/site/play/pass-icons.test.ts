import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ICONS } from "../../lib/cardbit-levels";
import { PASS_FRAME_SM_URLS, PASS_FRAME_URLS, PASS_ICON_URLS, PASS_ICONS, isPassIcon, passIconAllowed, passPicker, shownIcon, withPassIconUrls } from "./pass-icons";

describe("Pack Pass emotes", () => {
  it("has 5 emotes per character (4 for every plan + Legendary) and every file exists", () => {
    expect(PASS_ICONS).toHaveLength(ICONS.length * 5);
    for (const p of PASS_ICONS) expect(existsSync(`public${PASS_ICON_URLS[p.id]}`)).toBe(true);
    for (const u of [...Object.values(PASS_FRAME_URLS), ...Object.values(PASS_FRAME_SM_URLS)]) expect(existsSync(`public${u}`)).toBe(true);
  });
  it("unlocks by tier: Legendary only on Ultimate, nothing without a plan", () => {
    expect(passIconAllowed("zappix-hype", "plus")).toBe(false);
    expect(passIconAllowed("zappix-hype", "pro")).toBe(true);
    expect(passIconAllowed("zappix-legend", "pro")).toBe(false);
    expect(passIconAllowed("zappix-legend", "ultimate")).toBe(true);
    expect(passIconAllowed("latch-gold-love", null)).toBe(false);
    expect(passIconAllowed("zappix", "ultimate")).toBe(false);
    expect(isPassIcon("nope-hype")).toBe(false);
  });
  it("keeps old Club icon ids working as the Hype emote", () => {
    expect(isPassIcon("latch-holo-club")).toBe(true);
    expect(PASS_ICON_URLS["latch-holo-club"]).toBe("/site/img/pass/emotes/latch-holo-hype.svg");
  });
  it("falls back to the regular character once a plan stops covering the emote", () => {
    expect(shownIcon("mossbit-lol", null)).toBe("mossbit");
    expect(shownIcon("mossbit-legend", "pro")).toBe("mossbit");
    expect(shownIcon("mossbit-love", "plus")).toBe("mossbit");
    expect(shownIcon("mossbit-legend", "ultimate")).toBe("mossbit-legend");
    expect(shownIcon("latch-gold-hype", null, () => false)).toBeNull();
    expect(shownIcon("blazebit", null)).toBe("blazebit");
    expect(shownIcon(null, "pro")).toBeNull();
  });
  it("builds the picker grouped by character with a frame for members", () => {
    const none = passPicker(null);
    expect(none.frame).toBeNull();
    expect(none.characters.every((c) => c.emotes.every((e) => !e.unlocked))).toBe(true);
    const pro = passPicker("pro");
    expect(pro.frame).toBe("/site/img/pass/frames/pro.svg");
    const z = pro.characters.find((c) => c.id === "zappix")!;
    expect(z.emotes.filter((e) => e.unlocked).map((e) => e.id)).toEqual(["zappix-hype", "zappix-love", "zappix-lol", "zappix-shock"]);
  });
  it("merges URLs into a page icon map", () => {
    const html = withPassIconUrls(`<div data-icons='{"latch":"/a.svg"}'></div>`);
    const map = JSON.parse(/data-icons='([^']*)'/.exec(html)![1]);
    expect(map.latch).toBe("/a.svg");
    expect(map["wyrmware-shock"]).toBe("/site/img/pass/emotes/wyrmware-shock.svg");
  });
});
