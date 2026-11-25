import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ICONS } from "../../lib/cardbit-levels";
import { CLUB_ICON_URLS, clubIcons, isClubIcon, withClubIconUrls } from "./club-icons";

describe("Club icons", () => {
  it("has an animated file for every Latch & Friends icon", () => {
    for (const i of ICONS) {
      const url = CLUB_ICON_URLS[`${i.id}-club`];
      expect(url).toBe(`/site/img/club/cardbit-icon-${i.id}-club.svg`);
      expect(existsSync(`public${url}`)).toBe(true);
    }
  });
  it("recognizes only real Club ids", () => {
    expect(isClubIcon("latch-club")).toBe(true);
    expect(isClubIcon("latch")).toBe(false);
    expect(isClubIcon("nope-club")).toBe(false);
    expect(clubIcons(false).every((i) => !i.unlocked && i.club)).toBe(true);
  });
  it("merges URLs into the page icon map", () => {
    const html = withClubIconUrls(`<div data-icons='{"latch":"/a.svg"}'></div>`);
    const map = JSON.parse(/data-icons='([^']*)'/.exec(html)![1]);
    expect(map.latch).toBe("/a.svg");
    expect(map["latch-club"]).toBe("/site/img/club/cardbit-icon-latch-club.svg");
  });
});
