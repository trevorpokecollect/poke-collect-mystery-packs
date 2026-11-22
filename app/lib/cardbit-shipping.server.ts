import { createHash } from "node:crypto";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { gql } from "./orders.server";
import { PoolError } from "./pool.server";

export type ParcelAddress = {
  firstName: string;
  lastName: string;
  address1: string;
  address2: string;
  city: string;
  provinceCode: string;
  zip: string;
  countryCode: string;
};

export function parcelAddress(raw: unknown): ParcelAddress {
  if (!raw || typeof raw !== "object")
    throw new PoolError("Enter the delivery address to request rates.");
  const source = raw as Record<string, unknown>;
  const field = (key: string) =>
    typeof source[key] === "string"
      ? String(source[key]).trim().slice(0, 180)
      : "";
  const address = {
    firstName: field("firstName"),
    lastName: field("lastName"),
    address1: field("address1"),
    address2: field("address2"),
    city: field("city"),
    provinceCode: field("provinceCode").toUpperCase(),
    zip: field("zip"),
    countryCode: field("countryCode").toUpperCase(),
  };
  if (
    !address.lastName ||
    !address.address1 ||
    !address.city ||
    !address.zip ||
    !/^[A-Z]{2}$/.test(address.countryCode)
  )
    throw new PoolError(
      "Enter a name, street, city, postal code and two-letter country code.",
    );
  return address;
}

export type ShippingCard = {
  id: string;
  series: { storePurchase: boolean };
  slot: { card: { variantId: string; title: string } };
};
export function parcelLines(pulls: ShippingCard[], currencyCode: string) {
  const groups = new Map<string, { card: ShippingCard; quantity: number }>();
  for (const card of pulls) {
    const key =
      String(card.series.storePurchase) + "/" + card.slot.card.variantId;
    const row = groups.get(key) ?? { card, quantity: 0 };
    row.quantity++;
    groups.set(key, row);
  }
  return [...groups.values()].map(({ card, quantity }) =>
    card.series.storePurchase
      ? {
          title: "Vault Card: " + card.slot.card.title,
          quantity,
          originalUnitPriceWithCurrency: { amount: "0.00", currencyCode },
          requiresShipping: true,
          taxable: false,
        }
      : {
          variantId: card.slot.card.variantId,
          quantity,
          appliedDiscount: {
            value: 100,
            valueType: "PERCENTAGE",
            title: "Mystery pack pull",
          },
        },
  );
}

type Rate = {
  handle: string;
  title: string;
  price: { amount: string; currencyCode: string };
};
export async function quoteParcel(
  admin: AdminApiContext,
  shop: string,
  customerId: string,
  pulls: ShippingCard[],
  address: ParcelAddress,
) {
  const data = await gql(
    admin,
    `#graphql
    query CardbitParcelRates($input: DraftOrderAvailableDeliveryOptionsInput!) {
      draftOrderAvailableDeliveryOptions(input: $input) {
        availableShippingRates { handle title price { amount currencyCode } }
      }
    }`,
    {
      input: {
        purchasingEntity: { customerId },
        shippingAddress: address,
        lineItems: parcelLines(pulls, "USD"),
      },
    },
  );
  const ids = pulls.map((p) => p.id).sort();
  const rates: Rate[] =
    data.draftOrderAvailableDeliveryOptions.availableShippingRates;
  return rates
    .filter(
      (r) =>
        r.handle &&
        r.price.currencyCode === "USD" &&
        Number.isFinite(Number(r.price.amount)) &&
        Number(r.price.amount) >= 0 &&
        !/vault|pick[ -]?up|don.?t ship|do not ship|ship(?:s)? later/i.test(
          r.title,
        ),
    )
    .map((r) => ({
      ...r,
      quoteKey: createHash("sha256")
        .update(
          JSON.stringify([shop, customerId, ids, address, r.handle, r.price]),
        )
        .digest("hex"),
    }));
}
