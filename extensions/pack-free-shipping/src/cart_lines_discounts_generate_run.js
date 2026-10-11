/**
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

// This discount only changes shipping, so it never discounts products or the order.
/** @returns {CartLinesDiscountsGenerateRunResult} */
export function cartLinesDiscountsGenerateRun() {
  return {operations: []};
}
