// @ts-check

/**
 * @typedef {import("../generated/api").CartPaymentMethodsTransformRunInput} CartPaymentMethodsTransformRunInput
 * @typedef {import("../generated/api").CartPaymentMethodsTransformRunResult} CartPaymentMethodsTransformRunResult
 */

// Store credit can't pay for digital mystery packs: when the cart holds a pack, checkout hides
// every payment method whose name matches. Settings come from the customization's metafield:
// { "productType": "Mystery Pack", "hide": ["store credit"] }
export const DEFAULT_CONFIG = { productType: "Mystery Pack", hide: ["store credit"] };

/** Settings for this customization, falling back to the defaults for anything missing. */
export function readConfig(input) {
  const raw = /** @type {any} */ (input.paymentCustomization?.metafield?.jsonValue) ?? {};
  const productType = typeof raw.productType === "string" && raw.productType.trim() ? raw.productType.trim() : DEFAULT_CONFIG.productType;
  const hide = Array.isArray(raw.hide) && raw.hide.length ? raw.hide.map((h) => String(h).toLowerCase()) : DEFAULT_CONFIG.hide;
  return { productType, hide };
}

/** True when any cart line is a mystery pack. */
export function hasPack(input, productType) {
  const want = productType.toLowerCase();
  return input.cart.lines.some((line) => {
    const type = /** @type {any} */ (line.merchandise)?.product?.productType ?? "";
    return type.trim().toLowerCase() === want;
  });
}

/**
 * @param {CartPaymentMethodsTransformRunInput} input
 * @returns {CartPaymentMethodsTransformRunResult}
 */
export function cartPaymentMethodsTransformRun(input) {
  const { productType, hide } = readConfig(input);
  // Logged so a function run shows which payment methods Shopify offered this checkout.
  console.error(JSON.stringify({ methods: input.paymentMethods.map((m) => m.name) }));
  if (!hasPack(input, productType)) return { operations: [] };
  return {
    operations: input.paymentMethods
      .filter((method) => hide.some((h) => method.name.toLowerCase().includes(h)))
      .map((method) => ({ paymentMethodHide: { paymentMethodId: method.id } })),
  };
}
