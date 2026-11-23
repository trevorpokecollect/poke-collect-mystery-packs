import { countryCode, provinceCode } from "./address";

// US-only giveaways (settings.usOnly). Eligible addresses are the 50 states and DC, matching
// the Official Rules; territories (PR, GU, VI...) and military mail are not.

const STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " ",
  ),
);

export const US_ONLY_MESSAGE =
  "This giveaway is only open to people who live in the US and have a US shipping address.";

/** Why a claim address can't be used for a US-only giveaway, or null when it's fine. */
export function usAddressProblem(a: {
  country: string;
  province: string;
  zip: string;
}): string | null {
  if (countryCode(a.country) !== "US")
    return "Prizes ship only to US addresses (the 50 states and DC).";
  const state = provinceCode(a.province, "US");
  if (!state || !STATES.has(state))
    return "Enter a US state (the 50 states and DC).";
  if (!/^\d{5}(-?\d{4})?$/.test(a.zip.trim()))
    return "Enter a 5-digit US ZIP code.";
  return null;
}

/** True when an order has a shipping address outside the US (pickup / no address counts as US). */
export function shipsOutsideUs(
  shipping: { country_code?: string | null } | null | undefined,
) {
  const c = shipping?.country_code?.trim().toUpperCase();
  return !!c && c !== "US";
}
