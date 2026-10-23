// @ts-check

/**
 * @typedef {import("../generated/api").CartDeliveryOptionsTransformRunInput} CartDeliveryOptionsTransformRunInput
 * @typedef {import("../generated/api").CartDeliveryOptionsTransformRunResult} CartDeliveryOptionsTransformRunResult
 */

// "Keep In My Vault (Ships Later)" is a $0 shipping rate: the singles go to the buyer's vault instead
// of shipping. It's only offered to logged-in customers whose cart is all Pokemon singles; everyone
// else never sees it. When it is offered it's moved to the end, so a paid shipping option stays the
// one checkout picks first and nobody vaults by accident.
// Settings (optional) come from the customization's metafield: { "rateTitle": "...", "productType": "..." }.
export const DEFAULT_CONFIG = { rateTitle: "Keep In My Vault (Ships Later)", productType: "Pokemon Single" };

/** @param {CartDeliveryOptionsTransformRunInput} input */
export function readConfig(input) {
  const raw = /** @type {any} */ (input.deliveryCustomization?.metafield?.jsonValue) ?? {};
  return {
    rateTitle: typeof raw.rateTitle === "string" && raw.rateTitle.trim() ? raw.rateTitle.trim() : DEFAULT_CONFIG.rateTitle,
    productType: typeof raw.productType === "string" && raw.productType.trim() ? raw.productType.trim() : DEFAULT_CONFIG.productType,
  };
}

/** @param {CartDeliveryOptionsTransformRunInput} input @param {string} productType */
export function eligible(input, productType) {
  const buyer = input.cart.buyerIdentity;
  if (!buyer?.customer?.id) return false;
  const want = productType.toLowerCase();
  const lines = input.cart.lines;
  return lines.length > 0 && lines.every((line) => {
    const type = /** @type {any} */ (line.merchandise)?.product?.productType ?? "";
    return type.trim().toLowerCase() === want;
  });
}

/**
 * @param {CartDeliveryOptionsTransformRunInput} input
 * @returns {CartDeliveryOptionsTransformRunResult}
 */
export function cartDeliveryOptionsTransformRun(input) {
  const { rateTitle, productType } = readConfig(input);
  const want = rateTitle.toLowerCase();
  const ok = eligible(input, productType);
  /** @type {CartDeliveryOptionsTransformRunResult["operations"]} */
  const operations = [];
  for (const group of input.cart.deliveryGroups) {
    const count = group.deliveryOptions.length;
    for (const option of group.deliveryOptions) {
      if ((option.title ?? "").trim().toLowerCase() !== want) continue;
      if (!ok) operations.push({ deliveryOptionHide: { deliveryOptionHandle: option.handle } });
      else if (count > 1) operations.push({ deliveryOptionMove: { deliveryOptionHandle: option.handle, index: count - 1 } });
    }
  }
  return { operations };
}
