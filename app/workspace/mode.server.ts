import { isCardbit } from "../lib/cardbit.server";

export const reviewWorkspaceEnabled = (shop: string) =>
  isCardbit(shop) &&
  process.env.CARDBIT_WORKSPACE_MODE === "test" &&
  !(
    process.env.RAILWAY_ENVIRONMENT_NAME === "production" &&
    ["card-broker", "cardbit-mystery-packs", "poke-collect-singles"].includes(
      process.env.RAILWAY_PROJECT_NAME ?? "",
    )
  );
export const liveWorkspace = (shop: string) =>
  isCardbit(shop) &&
  process.env.CARDBIT_WORKSPACE_MODE === "live" &&
  process.env.RAILWAY_PROJECT_NAME === "cardbit-mystery-packs" &&
  process.env.RAILWAY_ENVIRONMENT_NAME === "production" &&
  process.env.RAILWAY_SERVICE_NAME === "app";
export const enabled = (shop: string) =>
  liveWorkspace(shop) || reviewWorkspaceEnabled(shop);
