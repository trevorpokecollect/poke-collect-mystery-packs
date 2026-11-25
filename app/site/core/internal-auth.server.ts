import { createHash, timingSafeEqual } from "node:crypto";

export const CARDBIT_SHOP = "hhuuev-81.myshopify.com";

/** Card Broker → site server-to-server auth (same pairing secret as intake). */
export function cardBrokerAuthorized(request: Request, env: NodeJS.ProcessEnv = process.env) {
  const key = env.CARDBIT_SITE_INTAKE_SECRET;
  const hash = (v: string) => createHash("sha256").update(v).digest();
  return (
    env.CARDBIT_SITE === "on" &&
    !!key &&
    key.length >= 32 &&
    request.headers.get("x-cardbit-shop") === CARDBIT_SHOP &&
    timingSafeEqual(hash(request.headers.get("authorization") || ""), hash("Bearer " + key))
  );
}

/** Staff email Card Broker says is acting (audit only; Card Broker authenticates its own staff). */
export function brokerActor(request: Request) {
  const v = (request.headers.get("x-cardbit-actor") || "").trim().toLowerCase().slice(0, 190);
  return /^[^\s@]+@[^\s@]+$/.test(v) ? `cardbroker:${v}` : "cardbroker";
}
