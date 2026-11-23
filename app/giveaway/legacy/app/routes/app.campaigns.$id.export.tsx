import type { LoaderFunctionArgs } from "react-router";
import type { EntrantStatus } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { csvLine } from "../lib/csv";
import { breakdownSubtotal } from "../lib/analytics.server";
import { slugify } from "../lib/slug";

// CSV export, streamed in pages so large giveaways don't sit in memory.
//   ?type=entrants (default) [&status=ACTIVE|HELD|PENDING_VERIFICATION|DISQUALIFIED]
//   ?type=orders

const STATUSES = ["ACTIVE", "HELD", "PENDING_VERIFICATION", "DISQUALIFIED"];
const PAGE = 500;
const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
];

const ENTRANT_HEADER = [
  "email",
  "name",
  "status",
  "entries",
  "risk_score",
  "signals",
  "referral_code",
  "referred_by_email",
  "marketing_consent",
  "phone",
  "sms_consent_at",
  ...UTM_KEYS,
  "created_at",
];
const ORDER_HEADER = [
  "order",
  "shopify_order_id",
  "email",
  "status",
  "entries",
  "subtotal",
  "created_at",
  "updated_at",
];

/** Pulls pages from `next` until it returns null, encoding each as CSV text. */
function csvStream(
  header: string[],
  next: (cursor?: string) => Promise<{ lines: string; cursor: string } | null>,
) {
  const encoder = new TextEncoder();
  let cursor: string | undefined;
  let started = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        // BOM so Excel opens UTF-8 names correctly.
        controller.enqueue(encoder.encode("﻿" + csvLine(header)));
        return;
      }
      try {
        const page = await next(cursor);
        if (!page) return controller.close();
        cursor = page.cursor;
        controller.enqueue(encoder.encode(page.lines));
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const campaign = await db.campaign.findFirst({
    where: { id: params.id, shop: session.shop },
    select: { id: true, slug: true },
  });
  if (!campaign) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const type =
    url.searchParams.get("type") === "orders" ? "orders" : "entrants";
  const status = url.searchParams.get("status") ?? "";
  const statusWhere = STATUSES.includes(status)
    ? { status: status as EntrantStatus }
    : {};
  // Keyset paging on id keeps every page query cheap.
  const after = (cursor?: string) => (cursor ? { id: { gt: cursor } } : {});

  const body =
    type === "orders"
      ? csvStream(ORDER_HEADER, async (cursor) => {
          const rows = await db.orderLog.findMany({
            where: { campaignId: campaign.id, ...after(cursor) },
            orderBy: { id: "asc" },
            take: PAGE,
          });
          if (rows.length === 0) return null;
          return {
            cursor: rows.at(-1)!.id,
            lines: rows
              .map((o) =>
                csvLine([
                  o.orderName,
                  o.shopifyOrderId,
                  o.email,
                  o.status,
                  o.entries,
                  breakdownSubtotal(o.breakdown),
                  o.createdAt,
                  o.updatedAt,
                ]),
              )
              .join(""),
          };
        })
      : csvStream(ENTRANT_HEADER, async (cursor) => {
          const rows = await db.entrant.findMany({
            where: {
              campaignId: campaign.id,
              ...statusWhere,
              ...after(cursor),
            },
            orderBy: { id: "asc" },
            take: PAGE,
            include: {
              riskSignals: { select: { code: true } },
              referredBy: { select: { email: true } },
            },
          });
          if (rows.length === 0) return null;
          const totals = await db.entryEvent.groupBy({
            by: ["entrantId"],
            where: { entrantId: { in: rows.map((r) => r.id) } },
            _sum: { entries: true },
          });
          const totalBy = new Map(
            totals.map((t) => [t.entrantId, t._sum.entries ?? 0]),
          );
          return {
            cursor: rows.at(-1)!.id,
            lines: rows
              .map((e) => {
                const utm = (
                  e.utm && typeof e.utm === "object" ? e.utm : {}
                ) as Record<string, unknown>;
                return csvLine([
                  e.email,
                  e.name,
                  e.status,
                  Math.max(0, totalBy.get(e.id) ?? 0),
                  e.riskScore,
                  [...new Set(e.riskSignals.map((s) => s.code))].join(" "),
                  e.referralCode,
                  e.referredBy?.email,
                  e.marketingConsent ? "yes" : "no",
                  e.phone,
                  e.smsConsentAt,
                  ...UTM_KEYS.map((k) =>
                    typeof utm[k] === "string" ? utm[k] : "",
                  ),
                  e.createdAt,
                ]);
              })
              .join(""),
          };
        });

  const suffix =
    type === "orders" ? "orders" : status ? slugify(status) : "entrants";
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${campaign.slug}-${suffix}.csv"`,
      "Cache-Control": "no-store",
    },
  });
};
