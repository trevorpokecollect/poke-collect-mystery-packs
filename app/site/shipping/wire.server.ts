// Wiring for the site's shipping service. The lead registers the SiteCopy store and the wallet
// fee payer once at startup with registerSiteShipping(); routes call siteShippingDeps().

import prisma from "../../db.server";
import { defaultGeoLookup } from "../region.server";
import { claimFreeShip, passFreeShip } from "../play/pass-perks.server";
import { mailerFromEnv } from "../email/mailer.server";
import { shipmentNotifier } from "../email/outbox.server";
import { fromAddressFromEnv, type ShippingDeps } from "./service.server";
import { easypostFromEnv } from "./easypost.server";
import { shippoFromEnv, type ShippingProvider } from "./shippo.server";
import type { CopyStore, FeePayer } from "./types";

let registered: { copies: CopyStore; fees: FeePayer } | null = null;

export function registerSiteShipping(parts: { copies: CopyStore; fees: FeePayer }) {
  registered = parts;
}

/** Site routes are dark unless this service runs as the standalone site. */
export function siteEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CARDBIT_SITE === "on";
}

export type LabelProviderName = "shippo" | "easypost";

/** CARDBIT_LABEL_PROVIDER picks who buys labels: "shippo" (default) or "easypost". */
export function labelProviderName(env: NodeJS.ProcessEnv = process.env): LabelProviderName {
  return (env.CARDBIT_LABEL_PROVIDER ?? "").trim().toLowerCase() === "easypost" ? "easypost" : "shippo";
}

export function labelProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  which: LabelProviderName = labelProviderName(env),
): ShippingProvider | null {
  return which === "easypost" ? easypostFromEnv(env) : shippoFromEnv(env);
}

/**
 * `provider` forces one provider (each tracking webhook re-reads from the provider that sent it,
 * so labels bought before a switch keep tracking).
 */
export function siteShippingDeps(env: NodeJS.ProcessEnv = process.env, provider?: LabelProviderName): ShippingDeps {
  if (!registered) throw new Error("Site shipping isn't wired: call registerSiteShipping() at startup.");
  const mailer = mailerFromEnv(env);
  return {
    db: prisma,
    copies: registered.copies,
    fees: registered.fees,
    provider: labelProviderFromEnv(env, provider ?? labelProviderName(env)),
    geo: defaultGeoLookup(env),
    notify: shipmentNotifier({ db: prisma, mailer, env }),
    from: fromAddressFromEnv(env),
    services: env.CARDBIT_SHIP_SERVICES ? env.CARDBIT_SHIP_SERVICES.split(",").map((s) => s.trim()) : undefined,
    passShip: { available: (customerId, now) => passFreeShip(prisma, customerId, now), claim: claimFreeShip },
  };
}
