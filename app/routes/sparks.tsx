// Spark Shop (standalone site, Trevor 2026-11-26): cardbit.com/sparks. Browse the Spark Shop pool and redeem a card
// for Sparks. Redeem is two steps: ?card=<key> shows a confirm panel with a one-time requestId, then the form posts.
// 404 unless CARDBIT_SITE=on; before launch the waitlist gate applies like every other page.
// Rules: app/site/rewards/spark-shop.server.ts.
import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { clientIp, currentCustomer } from "../site/core/auth.server";
import { takeToken } from "../site/core/guard.server";
import { SITE_ENABLED, htmlResponse, notFound } from "../site/shell.server";
import { sparkShopPage, type SparkShopView } from "../site/pages.server";
import { SparkShopError, redeemSparkCard, sparkBalance, sparkShopCards } from "../site/rewards/spark-shop.server";
import { siteSparksOn } from "../site/rewards/rewards.server";
import { PlayPaused, assertNotPaused } from "../site/play/limits.server";
import { gateApi, gatePage } from "../site/waitlist/gate.server";

/** Form posts must come from this site (blocks cross-site posts riding the session cookie). */
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === new URL(request.url).host || host === request.headers.get("x-forwarded-host");
  } catch {
    return false;
  }
}

async function view(customerId: string | null, extra: Partial<SparkShopView> = {}): Promise<SparkShopView> {
  const open = siteSparksOn();
  const [cards, balance] = await Promise.all([open ? sparkShopCards(db) : [], customerId && open ? sparkBalance(db, customerId) : null]);
  return { open, signedIn: Boolean(customerId), balance, cards, ...extra };
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (!SITE_ENABLED()) return notFound();
  { const gated = gatePage(request); if (gated) return gated; }
  const customer = await currentCustomer(db, request);
  const v = await view(customer?.id ?? null);
  const key = new URL(request.url).searchParams.get("card");
  if (key && customer && v.open) {
    const pick = v.cards.find((c) => c.key === key) ?? null;
    if (pick) return htmlResponse(sparkShopPage({ ...v, confirm: pick, requestId: randomUUID() }));
    return htmlResponse(sparkShopPage({ ...v, notice: { kind: "err", text: "That card is no longer in the Spark Shop. Pick another one." } }));
  }
  return htmlResponse(sparkShopPage(v));
}

export async function action({ request }: ActionFunctionArgs) {
  if (!SITE_ENABLED()) return notFound();
  { const gated = gateApi(request); if (gated) return gated; }
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const customer = await currentCustomer(db, request);
  if (!customer) return new Response(null, { status: 303, headers: { Location: `/sign-in?return_to=${encodeURIComponent("/sparks")}` } });
  const fd = await request.formData();
  const err = async (text: string, status = 409) => htmlResponse(sparkShopPage(await view(customer.id, { notice: { kind: "err", text } })), status);
  if (customer.frozenAt) return err("This account is on hold. Contact Support@cardbit.com.", 403);
  if (!takeToken(`sparks:c:${customer.id}`, { perMinute: 10, perHour: 120 }) || !takeToken(`sparks:ip:${clientIp(request) ?? "?"}`, { perMinute: 20, perHour: 240 }))
    return err("Too Many Tries. Wait a Minute and Try Again.", 429);
  try {
    await assertNotPaused(db, customer.id);
    const r = await redeemSparkCard(db, customer.id, fd.get("card"), fd.get("sparks"), fd.get("requestId"));
    return htmlResponse(
      sparkShopPage(
        await view(customer.id, {
          notice: { kind: "ok", text: r.replay ? `${r.title} is already in My Vault.` : `${r.title} is in My Vault. ${r.sparks.toLocaleString("en-US")} Sparks spent.`, link: { href: "/vault", label: "Go to My Vault" } },
        }),
      ),
    );
  } catch (e) {
    if (e instanceof PlayPaused) return err(e.message, 403);
    if (e instanceof SparkShopError) return err(e.message, e.status);
    throw e;
  }
}
