import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { marketDailyReport, marketSnapshot, REPORT_TIME_ZONE } from "../lib/market-report.server";

// Daily Vault Market numbers for the scheduled summary:
// GET /jobs/market-report?shop=<shop>&days=7 with the cron secret. Days run midnight to midnight Central;
// `yesterday` is the last full day, `days` is newest first (today so far included).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) return Response.json({ error: "shop is required" }, { status: 400 });
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 7, 2), 90);
  const report = await marketDailyReport(db, shop, days);
  return Response.json({ timeZone: REPORT_TIME_ZONE, yesterday: report[1], today: report[0], days: report, open: await marketSnapshot(db, shop) });
};
