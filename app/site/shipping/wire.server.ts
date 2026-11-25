// Wiring for the site's shipping service. The lead registers the SiteCopy store and the wallet
// fee payer once at startup with registerSiteShipping(); routes call siteShippingDeps().

import prisma from "../../db.server";
import { defaultGeoLookup } from "../region.server";
import { mailerFromEnv } from "../email/mailer.server";
import { shipmentNotifier } from "../email/outbox.server";
import { fromAddressFromEnv, DEFAULT_SERVICES, type ShippingDeps } from "./service.server";
import { shippoFromEnv } from "./shippo.server";
import type { CopyStore, FeePayer } from "./types";

let registered: { copies: CopyStore; fees: FeePayer } | null = null;

export function registerSiteShipping(parts: { copies: CopyStore; fees: FeePayer }) {
  registered = parts;
}

/** Site routes are dark unless this service runs as the standalone site. */
export function siteEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CARDBIT_SITE_MODE === "on";
}

export function siteShippingDeps(env: NodeJS.ProcessEnv = process.env): ShippingDeps {
  if (!registered) throw new Error("Site shipping isn't wired: call registerSiteShipping() at startup.");
  const mailer = mailerFromEnv(env);
  return {
    db: prisma,
    copies: registered.copies,
    fees: registered.fees,
    provider: shippoFromEnv(env),
    geo: defaultGeoLookup(env),
    notify: shipmentNotifier({ db: prisma, mailer, env }),
    from: fromAddressFromEnv(env),
    services: env.CARDBIT_SHIP_SERVICES ? env.CARDBIT_SHIP_SERVICES.split(",").map((s) => s.trim()) : DEFAULT_SERVICES,
  };
}
