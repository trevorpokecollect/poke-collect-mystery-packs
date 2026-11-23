// "Were they already on our lists?" from a Shopify customer record (see list-status.server.ts).

interface Consent {
  marketingState: string;
  consentUpdatedAt: string | null;
}
export interface CustomerNode {
  createdAt: string;
  emailMarketingConsent: Consent | null;
  smsMarketingConsent: Consent | null;
}

// Allows for the moment between signing up and our own opt-in reaching Shopify.
const GRACE_MS = 2 * 60 * 1000;

/** Status before entering, from the customer record (null when there's no customer). */
export function statusBefore(customer: CustomerNode | null, enteredAt: Date) {
  const before = (iso: string | null | undefined) =>
    !iso || new Date(iso).getTime() < enteredAt.getTime() - GRACE_MS;
  const subscribed = (c: Consent | null) =>
    !!c && c.marketingState === "SUBSCRIBED" && before(c.consentUpdatedAt);
  return {
    existingCustomer: !!customer && before(customer.createdAt),
    emailWasSubscribed: subscribed(customer?.emailMarketingConsent ?? null),
    smsWasSubscribed: subscribed(customer?.smsMarketingConsent ?? null),
  };
}
