import { findLiveCampaign } from "../entries/signup.server";
import { burstCache } from "./burst-cache";

// Storefront reads (popup data, product/cart badges) look the live giveaway up on every
// request; during a text or email blast that is hundreds a second. Share each lookup for a
// few seconds. Sign-ups and claims still read it fresh (findLiveCampaign).
const shared = burstCache(10_000);

export const liveCampaignShared = (shop: string, slug: string) =>
  shared.get(`${shop}:${slug}`, () => findLiveCampaign(shop, slug));
