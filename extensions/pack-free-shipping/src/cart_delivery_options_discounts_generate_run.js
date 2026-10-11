import {DeliveryDiscountSelectionStrategy, DiscountClass} from "../generated/api";

/**
 * @typedef {import("../generated/api").DeliveryInput} RunInput
 * @typedef {import("../generated/api").CartDeliveryOptionsDiscountsGenerateRunResult} CartDeliveryOptionsDiscountsGenerateRunResult
 */

// Free shipping once the cart holds enough mystery packs. Other items never count toward
// the threshold. Settings come from the discount's configuration metafield:
// { "threshold": 5, "productType": "Mystery Pack" }
export const DEFAULT_CONFIG = {threshold: 5, productType: "Mystery Pack"};

/** Settings for this discount, falling back to the defaults for anything missing. */
export function readConfig(input) {
  const raw = input.discount.metafield?.jsonValue ?? {};
  const threshold = Number(raw.threshold);
  return {
    threshold: Number.isInteger(threshold) && threshold > 0 ? threshold : DEFAULT_CONFIG.threshold,
    productType:
      typeof raw.productType === "string" && raw.productType.trim()
        ? raw.productType.trim()
        : DEFAULT_CONFIG.productType,
  };
}

/** Number of mystery packs in the cart. */
export function packCount(input, productType) {
  const want = productType.toLowerCase();
  return input.cart.lines.reduce((count, line) => {
    const type = line.merchandise?.product?.productType ?? "";
    return type.trim().toLowerCase() === want ? count + line.quantity : count;
  }, 0);
}

/**
 * @param {RunInput} input
 * @returns {CartDeliveryOptionsDiscountsGenerateRunResult}
 */
export function cartDeliveryOptionsDiscountsGenerateRun(input) {
  if (!input.discount.discountClasses.includes(DiscountClass.Shipping)) return {operations: []};
  if (input.cart.deliveryGroups.length === 0) return {operations: []};

  const {threshold, productType} = readConfig(input);
  if (packCount(input, productType) < threshold) return {operations: []};

  return {
    operations: [
      {
        deliveryDiscountsAdd: {
          candidates: input.cart.deliveryGroups.map((group) => ({
            message: `Free shipping with ${threshold}+ mystery packs`,
            targets: [{deliveryGroup: {id: group.id}}],
            value: {percentage: {value: 100}},
          })),
          selectionStrategy: DeliveryDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}
