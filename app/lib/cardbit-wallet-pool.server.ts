// Wallet pools sell committed slots through the wallet ledger. Shopify checkout keeps its own series.
export const walletPoolFilter = {
  path: ["cardbitSalesChannel"],
  equals: "wallet",
};
export function isWalletPool(rules: unknown) {
  return (
    !!rules &&
    typeof rules === "object" &&
    "cardbitSalesChannel" in rules &&
    rules.cardbitSalesChannel === "wallet"
  );
}
