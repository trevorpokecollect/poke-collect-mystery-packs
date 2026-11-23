import db from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import { normalizeEmail } from "../bot/email";
import { issueEntrantToken } from "../token.server";
import { burstCache } from "./burst-cache";

// Shoppers signed in to their store account: Shopify adds logged_in_customer_id to every
// proxied request and signs it, so the app can trust it and skip the email/name form.

export interface ShopCustomer {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Already subscribed to the store's marketing emails. */
  emailSubscribed: boolean;
}

const CUSTOMER = `#graphql
  query GiveawayCustomer($id: ID!) {
    customer(id: $id) {
      defaultEmailAddress { emailAddress marketingState }
      firstName
      lastName

    }
  }`;

const cache = burstCache(60_000);

export const customerGid = (raw: string | null | undefined) =>
  raw && /^\d+$/.test(raw) ? `gid://shopify/Customer/${raw}` : null;

/** The signed-in customer's email, name and email-marketing status (cached a minute). */
export function shopCustomer(
  shop: string,
  id: string,
): Promise<ShopCustomer | null> {
  return cache.get(`${shop}:${id}`, async () => {
    const { admin } = await unauthenticated.admin(shop);
    const res = await admin.graphql(CUSTOMER, { variables: { id } });
    const json = (await res.json()) as {
      data?: {
        customer?: {
          defaultEmailAddress: { emailAddress: string | null; marketingState: string } | null;
          firstName: string | null;
          lastName: string | null;
          emailMarketingConsent: { marketingState: string } | null;
        } | null;
      };
    };
    const c = json.data?.customer;
    if (!c) return null;
    return {
      email: c.defaultEmailAddress?.emailAddress ?? null,
      firstName: c.firstName,
      lastName: c.lastName,
      emailSubscribed: c.defaultEmailAddress?.marketingState === "SUBSCRIBED",
    };
  });
}

export const fullName = (c: ShopCustomer) =>
  [c.firstName, c.lastName]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ");

/**
 * A signed-in customer who already entered this giveaway (by account, or by the same email
 * before they signed in) gets their entrant token back, so the widget shows their entries
 * instead of the form on any device. Returns null when they haven't entered yet.
 */
export async function tokenForCustomer(
  campaignId: string,
  customerId: string,
  customer: () => Promise<ShopCustomer | null>,
) {
  let entrant = await db.entrant.findFirst({
    where: { campaignId, shopifyCustomerId: customerId },
  });
  if (!entrant) {
    const email = (await customer())?.email;
    if (!email) return null;
    entrant = await db.entrant.findUnique({
      where: {
        campaignId_emailNormalized: {
          campaignId,
          emailNormalized: normalizeEmail(email),
        },
      },
    });
    if (!entrant) return null;
    if (!entrant.shopifyCustomerId)
      await db.entrant.update({
        where: { id: entrant.id },
        data: { shopifyCustomerId: customerId },
      });
  }
  if (entrant.status === "DISQUALIFIED") return null;
  return issueEntrantToken(entrant.id, campaignId);
}
