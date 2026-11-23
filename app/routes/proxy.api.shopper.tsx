import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { unpack, type Bundle } from "../workspace/demo-catalog.server";
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { isCardbit } from "../lib/cardbit.server";
import {
  demoAccount,
  DemoError,
  shopperView,
  type ShopperState,
} from "../lib/demo-shopper.server";
import { gql } from "../lib/orders.server";
import { json, proxyContext } from "../lib/proxy.server";

function proof(shop: string, customerId: string, day: number) {
  return createHmac("sha256", process.env.SHOPIFY_API_SECRET!)
    .update(JSON.stringify(["cardbit-demo", shop, customerId, day]))
    .digest("hex");
}
function validProof(
  value: unknown,
  shop: string,
  customerId: string,
  day: number,
) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) return false;
  return [day, day - 1].some((d) =>
    timingSafeEqual(
      Buffer.from(proof(shop, customerId, d)),
      Buffer.from(value),
    ),
  );
}
async function handle({ request }: LoaderFunctionArgs) {
  const { shop, viewer, session, admin } = await proxyContext(request);
  if (!isCardbit(shop) || session?.shop !== shop || !admin)
    return json(
      { error: "Demo shopping is unavailable.", code: "forbidden" },
      404,
    );
  const customerId = viewer?.customerId;
  if (!customerId || !/^gid:\/\/shopify\/Customer\/\d+$/.test(customerId))
    return json({ error: "Sign in to Cardbit.", code: "sign_in" }, 401);
  const method = request.method.toUpperCase(),
    day = Math.floor(Date.now() / 86400000);
  if (!["GET", "POST"].includes(method))
    return json({ error: "Method unavailable." }, 405);
  const url = new URL(request.url);
  let input;
  if (method === "POST") {
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    )
      return json(
        { error: "Use the shopping checkout.", code: "invalid" },
        415,
      );
    const body = await request.text();
    if (body.length > 28000)
      return json({ error: "Select fewer cards.", code: "invalid" }, 413);
    try {
      input = JSON.parse(body);
    } catch {
      return json({ error: "Invalid request.", code: "invalid" }, 400);
    }
    if (!validProof(input?.proof, shop, customerId, day))
      return json(
        { error: "Reload your account and try again.", code: "token_expired" },
        403,
      );
  }
  const data = await gql(
    admin,
    `#graphql
    query CardbitDemoShopper($id: ID!) {
      customer(id:$id){ id firstName
        seed:metafield(namespace:"cardbit_preview",key:"seed_v1"){jsonValue}
        catalog:metafield(namespace:"cardbit_preview",key:"catalog_v1"){jsonValue}
      }
    }`,
    { id: customerId },
  );
  const owner = data.customer,
    seed = owner?.seed?.jsonValue as ShopperState | undefined,
    archive = owner?.catalog?.jsonValue as Bundle | undefined;
  if (
    owner?.id !== customerId ||
    seed?.v !== 1 ||
    !archive ||
    seed.version !== archive.version
  )
    return json(
      {
        error: "Demo shopping is unavailable for this account.",
        code: "forbidden",
      },
      404,
    );
  try {
    const catalog = unpack(archive);
    const { state, result, prices } = await demoAccount(
      db,
      shop,
      customerId,
      seed,
      catalog,
      input,
      url.searchParams.get("catalog") || undefined,
    );
    if (state.version !== archive.version)
      throw new DemoError(
        "catalog_changed",
        "The saved demo catalog needs to be restored before shopping.",
      );
    const accountRef = createHash("sha256")
      .update(shop + "/" + customerId)
      .digest("hex")
      .slice(0, 24);
    return json({
      ...result,
      ...(prices ? { prices } : {}),
      proof: proof(shop, customerId, day),
      ...(url.searchParams.get("catalog") === archive.version
        ? {}
        : { catalog: { cards: catalog.cards, packs: catalog.packs } }),
      state: shopperView(
        state,
        owner.firstName || "Collector",
        accountRef,
        catalog,
      ),
    });
  } catch (e) {
    if (e instanceof DemoError)
      return json({ error: e.message, code: e.code }, e.status);
    throw e;
  }
}
export const loader = handle;
export const action = handle;
