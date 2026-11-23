import { describe, expect, it } from "vitest";
import { buildWinnersFeed, type FeedDrawRow } from "../app/lib/winners-feed";

const campaign = (slug: string) => ({
  slug,
  title: slug === "monthly" ? "October Monthly Giveaway" : "Daily Giveaway",
  prize: slug === "monthly" ? "30th Celebration UPC Case" : null,
  imageUrl: null,
});
const winner = (name: string | null, email: string, extra = {}) => ({
  position: 1,
  forfeited: false,
  entrant: { name, email, status: "ACTIVE" },
  ...extra,
});

describe("buildWinnersFeed", () => {
  it("splits daily and monthly draws, newest first, with privacy-safe names", () => {
    const rows: FeedDrawRow[] = [
      {
        createdAt: new Date("2026-10-13T01:00:00Z"),
        campaign: campaign("daily-giveaway"),
        dailyPrize: {
          periodKey: "2026-10-12",
          title: "Japanese Storm Emeralda Booster Box",
          imageUrl: "https://cdn.example/a.png",
          productHandle: "storm-emeralda",
        },
        winners: [winner("Gary Oakley", "gary@example.com")],
      },
      {
        createdAt: new Date("2026-10-14T01:00:00Z"),
        campaign: campaign("daily-giveaway"),
        dailyPrize: {
          periodKey: "2026-10-13",
          title: "Elite Trainer Box",
          imageUrl: null,
          productHandle: null,
        },
        winners: [
          winner("Erika Tamsin", "r@example.com", { forfeited: true }),
          winner("ash", "ash@example.com", { position: 2 }),
        ],
      },
      {
        createdAt: new Date("2026-11-01T14:00:00Z"),
        campaign: campaign("monthly"),
        dailyPrize: null,
        winners: [
          winner("Misty Waters", "m@example.com", { position: 2 }),
          winner("Brock Harrison", "b@example.com"),
          winner("Gone Person", "g@example.com", {
            position: 3,
            entrant: {
              name: "Gone Person",
              email: "g@x",
              status: "DISQUALIFIED",
            },
          }),
        ],
      },
    ];
    const feed = buildWinnersFeed(rows);
    expect(feed.daily.map((d) => [d.date, d.winners])).toEqual([
      ["2026-10-13", ["Ash"]],
      ["2026-10-12", ["Gary O."]],
    ]);
    expect(feed.monthly).toHaveLength(1);
    expect(feed.monthly[0].winners).toEqual(["Brock H.", "Misty W."]);
    expect(feed.monthly[0].prize).toBe("30th Celebration UPC Case");
    expect(JSON.stringify(feed)).not.toMatch(/@|Oakley|Harrison/);
  });

  it("drops draws whose winners all forfeited", () => {
    const feed = buildWinnersFeed([
      {
        createdAt: new Date(),
        campaign: campaign("daily-giveaway"),
        dailyPrize: {
          periodKey: "2026-10-14",
          title: "X",
          imageUrl: null,
          productHandle: null,
        },
        winners: [winner("A B", "a@b.c", { forfeited: true })],
      },
    ]);
    expect(feed.daily).toEqual([]);
  });
});
