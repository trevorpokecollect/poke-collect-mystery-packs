import { isCardbit } from "./cardbit.server";

/**
 * Engagement switches. "on" opens a feature to every Cardbit customer. "qa" opens it only to the
 * Shopify customers listed in CARDBIT_QA_CUSTOMERS (comma separated, numeric ids or Customer gids);
 * everyone else, including signed-out visitors, sees it as off. Anything else (or unset) is off.
 */
export type EngagementFlag = "CARDBIT_LEVELS" | "CARDBIT_SPARKS" | "CARDBIT_SPINNER" | "CARDBIT_LEADERBOARD" | "CARDBIT_SUBSCRIPTIONS";

const numericId = (id: string) => id.trim().match(/(\d+)$/)?.[1] ?? null;

export function qaCustomers(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.CARDBIT_QA_CUSTOMERS || "")
      .split(",")
      .map(numericId)
      .filter((id): id is string => !!id),
  );
}

export const isQaCustomer = (customerId: string | null | undefined, env: NodeJS.ProcessEnv = process.env) => {
  const id = customerId ? numericId(customerId) : null;
  return !!id && qaCustomers(env).has(id);
};

export const flagMode = (flag: EngagementFlag, env: NodeJS.ProcessEnv = process.env) =>
  env[flag] === "on" ? "on" : env[flag] === "qa" ? "qa" : "off";

/** Shop key for the standalone cardbit.com site's rows in the Cardbit* engagement tables. */
export const SITE_REWARDS_SHOP = "cardbit-site";

export function featureOn(
  flag: EngagementFlag,
  shop: string,
  customerId?: string | null,
  env: NodeJS.ProcessEnv = process.env,
) {
  // The standalone site has no QA customer list, so only "on" opens a feature there.
  if (shop === SITE_REWARDS_SHOP) return env.CARDBIT_SITE === "on" && flagMode(flag, env) === "on";
  if (!isCardbit(shop, env)) return false;
  const mode = flagMode(flag, env);
  return mode === "on" || (mode === "qa" && isQaCustomer(customerId, env));
}
