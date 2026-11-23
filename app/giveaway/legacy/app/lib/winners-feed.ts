import { publicName } from "./names";

// Builds the public "Giveaway Winners" feed (/apps/packs/campaigns/winners) from draw rows.
// Pure so it can be unit tested; the database read is winnersFeed() in winners.server.ts.
// Only first name + last initial ever leaves the server: no emails, addresses or prize values.

export interface FeedDrawRow {
  createdAt: Date;
  campaign: {
    slug: string;
    title: string;
    prize: string | null;
    imageUrl: string | null;
  };
  dailyPrize: {
    periodKey: string;
    title: string;
    imageUrl: string | null;
    productHandle: string | null;
  } | null;
  winners: {
    position: number;
    forfeited: boolean;
    entrant: { name: string | null; email: string; status: string };
  }[];
}

export interface DailyFeedItem {
  date: string; // store-local draw day, YYYY-MM-DD
  giveaway: string;
  prize: string;
  imageUrl: string | null;
  productHandle: string | null;
  winners: string[];
}

export interface MonthlyFeedItem {
  drawnAt: string; // ISO time of the draw
  giveaway: string;
  title: string;
  prize: string;
  imageUrl: string | null;
  winners: string[];
}

const names = (row: FeedDrawRow) =>
  row.winners
    .filter((w) => !w.forfeited && w.entrant.status !== "DISQUALIFIED")
    .sort((a, b) => a.position - b.position)
    .map((w) => publicName(w.entrant.name, w.entrant.email))
    .map((n) => n.charAt(0).toUpperCase() + n.slice(1));

export function buildWinnersFeed(rows: FeedDrawRow[]) {
  const daily: DailyFeedItem[] = [];
  const monthly: MonthlyFeedItem[] = [];
  for (const row of rows) {
    const winners = names(row);
    if (winners.length === 0) continue;
    if (row.dailyPrize) {
      daily.push({
        date: row.dailyPrize.periodKey,
        giveaway: row.campaign.slug,
        prize: row.dailyPrize.title,
        imageUrl: row.dailyPrize.imageUrl,
        productHandle: row.dailyPrize.productHandle,
        winners,
      });
    } else {
      monthly.push({
        drawnAt: row.createdAt.toISOString(),
        giveaway: row.campaign.slug,
        title: row.campaign.title,
        prize: row.campaign.prize || row.campaign.title,
        imageUrl: row.campaign.imageUrl,
        winners,
      });
    }
  }
  daily.sort((a, b) => b.date.localeCompare(a.date));
  monthly.sort((a, b) => b.drawnAt.localeCompare(a.drawnAt));
  return { daily, monthly };
}
