import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { countdownGif } from "../lib/countdown";
import { periodFor } from "../lib/daily";
import { campaignSettingsSchema } from "../lib/settings";

// Public live countdown to the next daily draw, for emails: <img src=".../countdown.gif">.
// Optional ?slug= picks the giveaway (default "daily-giveaway") for its timezone and draw time.
// Never cached, so every open shows the real time left.

const DEFAULT_SLUG = "daily-giveaway";

async function drawClock(slug: string) {
  const campaign = await db.campaign
    .findFirst({
      where: {shop:"hhuuev-81.myshopify.com", slug, status: "ACTIVE" },
      select: { timezone: true, settings: true },
    })
    .catch(() => null);
  const cfg = campaignSettingsSchema.safeParse(campaign?.settings ?? {});
  return {
    timeZone: campaign?.timezone ?? "America/Chicago",
    drawTime: campaign && cfg.success ? cfg.data.daily.drawTime : "20:00",
  };
}

// Many people open a campaign at once; reuse the image for the same second.
let cached: { key: string; gif: Uint8Array } | null = null;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const slug = (new URL(request.url).searchParams.get("slug") ?? DEFAULT_SLUG)
    .replace(/[^a-z0-9-]/gi, "")
    .slice(0, 80);
  const now = new Date();
  const { timeZone, drawTime } = await drawClock(slug);
  const { drawAt } = periodFor(now, timeZone, drawTime);
  const secondsLeft = Math.max(
    0,
    Math.floor((drawAt.getTime() - now.getTime()) / 1000),
  );
  const key = `${slug}:${drawAt.getTime()}:${secondsLeft}`;
  if (cached?.key !== key) cached = { key, gif: countdownGif(secondsLeft) };
  return new Response(new Uint8Array(cached.gif), {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
