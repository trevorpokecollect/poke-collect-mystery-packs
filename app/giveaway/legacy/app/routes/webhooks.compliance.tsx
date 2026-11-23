import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { normalizeEmail } from "../lib/bot/email";

// Mandatory privacy webhooks (customers/data_request, customers/redact, shop/redact).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const p = payload as { customer?: { email?: string; id?: number } };

  if (topic === "CUSTOMERS_REDACT" && p.customer?.email) {
    const emailNormalized = normalizeEmail(p.customer.email);
    await db.entrant.deleteMany({
      where: { emailNormalized, campaign: { shop } },
    });
  }
  if (topic === "SHOP_REDACT") {
    await db.campaign.deleteMany({ where: { shop } });
  }
  // customers/data_request: entrant data is visible in the admin and exportable as CSV;
  // the store owner fulfils the request from there.
  await db.auditLog.create({
    data: { shop, action: `webhook:${topic}`, data: payload as object },
  });
  return new Response();
};
