import {
  Prisma,
  type PrismaClient,
  type CardbitShelfParcel,
} from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { digest, reclaimClosed, shelfLock } from "./shelf.server";
import {
  orderDetail,
  vaultReference,
  orderItems,
  deliveryAddress,
  orderPage,
  parcelLines,
  parcelFulfillments,
  eligibility,
  buyLabel,
  readLabel,
  labelOptions,
  fulfill,
  ShopifyDeclined,
  type OrderLine,
  type LabelInput,
} from "./shipping-shopify.server";

type Pick = {
  id: string;
  slot: number;
  title: string;
  details: string;
  image: string | null;
  lineId: string;
  pullId?: string;
};
type Line = { id: string; lineItemId: string; quantity: number };
type Manifest = {
  vaultRequest: string | null;
  picks: Pick[];
  lines: Line[];
  snapshot: string;
  location: string;
  coversAll: boolean;
  prior: string[];
};
type Input = {
  action: string;
  id: string;
  fo: string;
  revision?: string;
  checked?: string[];
  tracking?: string;
  carrier?: string;
  label?: LabelInput;
  view?: string;
  after?: string;
  query?: string;
};
type Tx = Prisma.TransactionClient;
const manifest = (p: CardbitShelfParcel) => p.manifest as unknown as Manifest;
const doc = (p: CardbitShelfParcel) => ({
  id: p.id,
  state: p.state,
  revision: p.revision,
  labelState: p.labelState,
  tracking: p.tracking,
  carrier: p.carrier,
  fulfillmentId: p.fulfillmentId,
  ...manifest(p),
});
const snapshot = (lines: OrderLine[], location: string) =>
  digest([
    location,
    ...lines
      .filter((l) => l.remainingQuantity > 0)
      .map((l) => [
        l.id,
        l.remainingQuantity,
        l.lineItem.id,
        l.lineItem.requiresShipping,
        l.lineItem.variant?.id,
        l.lineItem.customAttributes,
      ])
      .sort(),
  ]);
type Native = {
  id: string;
  slotId: string;
  series: { storePurchase: boolean };
  slot: { card: { variantId: string; title: string } };
};
export function matchingPulls(line: OrderLine, native: Native[]) {
  const variant = line.lineItem.variant?.id;
  if (variant)
    return native.filter(
      (p) => !p.series.storePurchase && p.slot.card.variantId === variant,
    );
  const attribute = line.lineItem.customAttributes.find(
    (a) => a.key === "_cardbit_vault_variant",
  )?.value;
  if (attribute)
    return native.filter(
      (p) => p.series.storePurchase && p.slot.card.variantId === attribute,
    );
  const rows = native.filter(
    (p) =>
      p.series.storePurchase &&
      "Vault Card: " + p.slot.card.title === line.lineItem.title,
  );
  if (new Set(rows.map((p) => p.slot.card.variantId)).size > 1)
    throw Error(
      "Two vaulted printings share this line description. Review the shipment in Shopify.",
    );
  return rows;
}
async function assign(
  tx: Tx,
  input: Input,
  expectedRequest: string | null,
  lines: OrderLine[],
  location: string,
  prior: string[],
  actor: string,
) {
  await shelfLock(tx);
  const existing = await tx.cardbitShelfParcel.findFirst({
    where: { id: input.fo, shop, orderId: input.id },
  });
  if (existing) return doc(existing);
  const request = await tx.shipRequest.findFirst({
    where: { shop, orderId: input.id },
    select: {
      id: true,
      status: true,
      pickup: true,
      customerId: true,
      cardCount: true,
    },
  });
  if (expectedRequest && expectedRequest !== request?.id)
    throw Error(
      "Waiting for Cardbit to link this paid order to its exact vault shipment.",
    );
  if (request && (request.status !== "PAID" || request.pickup))
    throw Error("This vault shipment is awaiting payment or is local pickup.");
  const pack = await tx.packOrder.findFirst({
    where: { shop, orderId: input.id },
    select: { vault: true, finalized: true },
  });
  const sourcePulls = await tx.pull.findMany({
    where: {
      shop,
      ...(request ? { shipRequestId: request.id } : { orderId: input.id }),
      series: { staffTest: false },
    },
    include: {
      series: { select: { storePurchase: true } },
      slot: { select: { card: { select: { variantId: true, title: true } } } },
    },
  });
  if (
    request &&
    (sourcePulls.length !== request.cardCount ||
      sourcePulls.some(
        (p) =>
          p.status !== "FULFILLING" ||
          p.shipOrderId !== input.id ||
          p.customerId !== request.customerId ||
          p.refundFlaggedAt,
      ))
  )
    throw Error(
      "The vault shipment and its paid order do not agree. Review the exact cards before picking.",
    );
  if (!request && pack && !pack.vault && !pack.finalized)
    throw Error("The pack results are still being assigned to this order.");
  if (
    !request &&
    pack &&
    !pack.vault &&
    sourcePulls.some((p) => p.refundFlaggedAt || p.status === "VOIDED")
  )
    throw Error(
      "A pack award on this order needs refund reconciliation before shipping.",
    );
  const native = sourcePulls.filter(
    (p) =>
      request ||
      (!pack?.vault &&
        p.status === "FULFILLING" &&
        !p.refundFlaggedAt &&
        !p.shipOrderId),
  );
  const wrappers = new Set(sourcePulls.map((p) => p.lineItemId));
  const seen = new Set<string>(),
    picks: Pick[] = [],
    selected: Line[] = [];
  await reclaimClosed(tx);
  for (const l of lines.filter(
    (l) => l.remainingQuantity > 0 && l.lineItem.requiresShipping,
  )) {
    if (!request && wrappers.has(l.lineItem.id)) continue;
    const found = matchingPulls(l, native);
    let copies;
    if (found.length) {
      if (
        found.length !== l.remainingQuantity ||
        found.some((p) => seen.has(p.id))
      )
        throw Error(
          "This vault line was split or edited. Reconcile the exact physical copies before packing.",
        );
      copies = await tx.cardbitShelfCopy.findMany({
        where: {
          shop,
          poolSlotId: { in: found.map((p) => p.slotId) },
          slot: { not: null },
          filedAt: { not: null },
          parcelId: null,
          OR: [{ locationId: location }, { locationId: null }],
        },
        orderBy: { slot: "asc" },
      });
      if (copies.length !== found.length)
        throw Error(
          "An awarded copy has no confirmed shelf location for this order. Review its intake or existing pick.",
        );
      found.forEach((p) => seen.add(p.id));
    } else {
      if (request)
        throw Error(
          "A shipping line could not be matched to the customer's vaulted cards.",
        );
      const variant = l.lineItem.variant?.id;
      if (
        /sealed product|accessor|apparel|supplies/i.test(
          l.lineItem.variant?.product?.productType || "",
        )
      )
        continue;
      if (!variant)
        throw Error("This custom physical item has no verified shelf copy.");
      copies = await tx.cardbitShelfCopy.findMany({
        where: {
          shop,
          variantId: variant,
          slot: { not: null },
          filedAt: { not: null },
          poolSlotId: null,
          parcelId: null,
          OR: [{ locationId: location }, { locationId: null }],
        },
        orderBy: [{ slot: "asc" }, { id: "asc" }],
        take: l.remainingQuantity,
      });
      if (copies.length !== l.remainingQuantity)
        throw Error(
          "There are too few filed copies of " +
            l.lineItem.name.slice(0, 85) +
            " at the assigned location.",
        );
    }
    const ids = copies.map((c) => c.id);
    const result = await tx.cardbitShelfCopy.updateMany({
      where: { shop, id: { in: ids }, parcelId: null, slot: { not: null } },
      data: { parcelId: input.fo },
    });
    if (result.count !== copies.length)
      throw Error(
        "A copy was reserved by another order. Refresh the pick list.",
      );
    picks.push(
      ...copies.map((c) => ({
        id: c.id,
        slot: c.slot!,
        title: c.title,
        details: c.details,
        image: c.image,
        lineId: l.id,
        ...(c.poolSlotId
          ? { pullId: found.find((p) => p.slotId === c.poolSlotId)!.id }
          : {}),
      })),
    );
    selected.push({
      id: l.id,
      lineItemId: l.lineItem.id,
      quantity: l.remainingQuantity,
    });
  }
  if (!selected.length)
    throw Error("There are no physical cards to ship on this fulfillment.");
  if (request && seen.size !== native.length) {
    // Different fulfillment orders can own different variants, but never silently omit a vaulted copy in this one.
    const hasOther = await tx.cardbitShelfBinding.count({
      where: {
        shop,
        poolSlotId: {
          in: native.filter((p) => !seen.has(p.id)).map((p) => p.slotId),
        },
      },
    });
    if (hasOther !== native.length - seen.size)
      throw Error("Some cards in this vault shipment have no shelf record.");
  }
  const data: Manifest = {
    vaultRequest: request?.id || null,
    picks: picks.sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id)),
    lines: selected,
    location,
    snapshot: snapshot(lines, location),
    coversAll:
      lines.filter((l) => l.remainingQuantity > 0).length === selected.length,
    prior,
  };
  return doc(
    await tx.cardbitShelfParcel.create({
      data: {
        id: input.fo,
        shop,
        orderId: input.id,
        state: "READY",
        actor,
        revision: digest(data),
        manifest: data as unknown as Prisma.InputJsonValue,
      },
    }),
  );
}
export function exactFulfillment(
  lines: Line[],
  actual: { quantity: number; lineItem: { id: string } }[],
) {
  const a = new Map<string, number>(),
    b = new Map<string, number>();
  for (const l of lines)
    a.set(l.lineItemId, (a.get(l.lineItemId) || 0) + l.quantity);
  for (const l of actual)
    b.set(l.lineItem.id, (b.get(l.lineItem.id) || 0) + l.quantity);
  return (
    a.size > 0 && a.size === b.size && [...a].every(([k, n]) => b.get(k) === n)
  );
}
async function finish(
  db: PrismaClient,
  id: string,
  orderId: string,
  revision: string,
  fulfillmentId: string,
) {
  return db.$transaction(async (tx) => {
    await shelfLock(tx);
    const p = await tx.cardbitShelfParcel.findFirstOrThrow({
      where: { shop, id, orderId, revision },
    });
    if (p.state === "SHIPPED") return doc(p);
    if (!["PACKED", "SENDING"].includes(p.state))
      throw Error("Confirm the physical cards before releasing their slots.");
    const picks = manifest(p).picks,
      ids = picks.map((c) => c.id);
    const count = await tx.$executeRaw(
      Prisma.sql`UPDATE "CardbitShelfCopy" SET "lastSlot"=slot, slot=NULL, pocket=NULL, "shippedAt"=CURRENT_TIMESTAMP WHERE shop=${shop} AND "parcelId"=${id} AND slot IS NOT NULL AND id IN (${Prisma.join(ids)})`,
    );
    if (count !== ids.length)
      throw Error(
        "Shelf custody changed. Review this pick list before reconciling.",
      );
    return doc(
      await tx.cardbitShelfParcel.update({
        where: { id },
        data: { state: "SHIPPED", fulfillmentId },
      }),
    );
  });
}
export async function reconcile(
  db: PrismaClient,
  admin: AdminApiContext,
  p: CardbitShelfParcel,
) {
  if (!["PACKED", "SENDING"].includes(p.state)) return doc(p);
  const m = manifest(p),
    fs = await parcelFulfillments(admin, p.id);
  const matches = fs.filter(
    (f) =>
      !m.prior.includes(f.id) &&
      exactFulfillment(m.lines, f.fulfillmentLineItems.nodes) &&
      (!p.tracking ||
        !f.trackingInfo.length ||
        f.trackingInfo.some((t) => t.number === p.tracking)),
  );
  if (matches.length > 1)
    throw Error(
      "Multiple fulfillments match. Review the order before releasing any shelf copies.",
    );
  return matches.length
    ? finish(db, p.id, p.orderId, p.revision, matches[0].id)
    : doc(p);
}
export async function reconcileOrder(
  db: PrismaClient,
  admin: AdminApiContext,
  id: string,
) {
  for (const p of await db.cardbitShelfParcel.findMany({
    where: { shop, orderId: id, state: { in: ["PACKED", "SENDING"] } },
  }))
    await reconcile(db, admin, p);
}
export async function staffShipping(
  db: PrismaClient,
  admin: AdminApiContext,
  input: Input,
  actor: string,
) {
  if (input.action === "orders") return orderPage(db, admin, input);
  if (input.action === "order" && input.id?.startsWith("cardbit-wallet:")) {
    const receipt = await db.packOrder.findFirstOrThrow({
      where: { orderId: input.id, shop, vault: true },
      select: { orderId: true, orderName: true },
    });
    const pulls = await db.pull.findMany({
      where: { shop, orderId: receipt.orderId, series: { staffTest: false } },
      select: {
        id: true,
        status: true,
        slot: { select: { card: { select: { title: true, imageUrl: true } } } },
      },
    });
    return {
      order: {
        id: receipt.orderId,
        name: receipt.orderName,
        displayFinancialStatus: "Paid with Cardbits",
        displayFulfillmentStatus: "Kept in vault",
      },
      items: pulls.map((p) => ({
        id: p.id,
        name: p.status === "UNOPENED" ? "Unopened card" : p.slot.card.title,
        quantity: 1,
        image: p.status === "UNOPENED" ? null : p.slot.card.imageUrl,
      })),
      shipments: [],
    };
  }
  const { order, shipments, adminUrl } = await orderDetail(admin, input.id);
  if (input.action === "order") {
    const saved = await db.cardbitShelfParcel.findMany({
      where: { shop, orderId: order.id },
    });
    return {
      order,
      adminUrl,
      // What the customer picked and paid at checkout. Shopify's API does not list label rates;
      // a label purchase without codes keeps this buyer-selected method when it is available.
      shipping: order.shippingLine
        ? {
            title: order.shippingLine.title,
            price: order.shippingLine.originalPriceSet?.shopMoney ?? null,
          }
        : null,
      items: await orderItems(admin, order.id),
      shipments: shipments.map((s) => ({
        id: s.id,
        name: s.assignedLocation.name,
        status: s.status,
        delivery: s.deliveryMethod?.presentedName ?? null,
        // Carrier-calculated checkout rates carry a service code; flat and free rates do not.
        carrierRate: !!s.deliveryMethod?.serviceCode,
        reason: eligibility(order, s),
        parcel: saved.find((p) => p.id === s.id)
          ? doc(saved.find((p) => p.id === s.id)!)
          : null,
      })),
    };
  }
  const fo = shipments.find((s) => s.id === input.fo);
  if (!fo)
    throw Error(
      "This fulfillment does not belong to the selected Cardbit order.",
    );
  if (input.action === "deliveryAddress") return deliveryAddress(admin, fo.id);
  const p = await db.cardbitShelfParcel.findFirst({
    where: { shop, id: fo.id, orderId: order.id },
  });
  if (input.action === "labelStatus") {
    if (!p?.labelResultId)
      throw Error(
        "No label request has been confirmed by Shopify. Check the order before buying postage.",
      );
    const result = await readLabel(admin, p.labelResultId),
      label = result.shippingLabels[0],
      tracking = label?.trackingInfo;
    await db.cardbitShelfParcel.updateMany({
      where: { shop, id: fo.id, labelResultId: p.labelResultId },
      data: {
        labelState: result.status,
        ...(tracking?.number
          ? { tracking: tracking.number, carrier: tracking.company }
          : {}),
      },
    });
    return {
      status: result.status,
      error: result.errors.map((e) => e.message).join(" "),
      documents: (label?.shippingDocuments || []).filter((d) =>
        d.url?.startsWith("https://"),
      ),
      tracking: tracking?.number || "",
    };
  }
  if (input.action === "checkShipment" && p) return reconcile(db, admin, p);
  if (
    p &&
    input.action === "shipParcel" &&
    input.revision === p.revision &&
    ["SHIPPED", "SENDING"].includes(p.state)
  )
    return reconcile(db, admin, p);
  if (
    p &&
    input.action === "buyLabel" &&
    input.revision === p.revision &&
    p.labelResultId &&
    p.labelState !== "PURCHASE_FAILED"
  )
    return { requested: true };
  if (input.action === "releasePick" && p) {
    if (
      p.revision !== input.revision ||
      !["READY", "PACKED"].includes(p.state) ||
      p.labelState
    )
      throw Error("This pick list can no longer be returned.");
    const fs = await parcelFulfillments(admin, fo.id);
    if (fs.some((f) => !manifest(p).prior.includes(f.id)))
      throw Error(
        "A fulfillment has been recorded. Reconcile it before returning cards.",
      );
    return db.$transaction(async (tx) => {
      await shelfLock(tx);
      const cleared = await tx.cardbitShelfParcel.deleteMany({
        where: {
          shop,
          id: p.id,
          revision: p.revision,
          state: p.state,
          labelState: null,
        },
      });
      if (!cleared.count) throw Error("This parcel has changed.");
      await tx.cardbitShelfCopy.updateMany({
        where: { shop, parcelId: p.id, shippedAt: null },
        data: { parcelId: null },
      });
      return { returned: true };
    });
  }
  const reason = eligibility(order, fo);
  if (reason) throw Error(reason);
  const lines = await parcelLines(admin, fo.id),
    location = fo.assignedLocation.location!.id;
  if (input.action === "prepareShipment") {
    if (p) return doc(p);
    const previous = await parcelFulfillments(admin, fo.id);
    return db.$transaction(
      (tx) =>
        assign(
          tx,
          input,
          vaultReference(order),
          lines,
          location,
          previous.map((f) => f.id),
          actor,
        ),
      { timeout: 60000 },
    );
  }
  if (
    !p ||
    p.revision !== input.revision ||
    manifest(p).snapshot !== snapshot(lines, location)
  )
    throw Error(
      "Shopify or this pick list has changed. Reconcile or return these cards before starting again.",
    );
  const physical = manifest(p);
  if (vaultReference(order) && vaultReference(order) !== physical.vaultRequest)
    throw Error(
      "The vault request changed. Reconcile this parcel before packing.",
    );
  const nativeIds = physical.picks.flatMap((c) => (c.pullId ? [c.pullId] : []));
  if (nativeIds.length) {
    const request = physical.vaultRequest
      ? await db.shipRequest.findFirst({
          where: {
            id: physical.vaultRequest,
            shop,
            orderId: order.id,
            status: "PAID",
            pickup: false,
          },
          select: { id: true, customerId: true },
        })
      : null;
    if (physical.vaultRequest && !request)
      throw Error("This vault shipment was returned or cancelled.");
    const matching = await db.pull.count({
      where: {
        id: { in: nativeIds },
        shop,
        status: "FULFILLING",
        refundFlaggedAt: null,
        ...(request
          ? {
              shipOrderId: order.id,
              shipRequestId: request.id,
              customerId: request.customerId,
            }
          : { orderId: order.id, shipOrderId: null, shipRequestId: null }),
      },
    });
    if (matching !== nativeIds.length)
      throw Error(
        "Custody changed on a packed card. Review its order before shipping.",
      );
  }
  if (input.action === "packShipment") {
    const ids = manifest(p)
      .picks.map((i) => i.id)
      .sort();
    if (
      !Array.isArray(input.checked) ||
      digest([...input.checked].sort()) !== digest(ids)
    )
      throw Error("Confirm every physical copy on this pick list.");
    const updated = await db.cardbitShelfParcel.updateMany({
      where: {
        shop,
        id: p.id,
        state: { in: ["READY", "PACKED"] },
        revision: p.revision,
      },
      data: { state: "PACKED", actor },
    });
    if (!updated.count) throw Error("Refresh this parcel before packing.");
    return { packed: true };
  }
  if (p.state !== "PACKED")
    throw Error("Confirm packing and check any existing shipment first.");
  if (input.action === "buyLabel") {
    if (!manifest(p).coversAll)
      throw Error("Use Shopify to choose postage for a partial fulfillment.");
    const options = labelOptions(p.id, input.label!);
    const won = await db.cardbitShelfParcel.updateMany({
      where: {
        shop,
        id: p.id,
        state: "PACKED",
        revision: p.revision,
        OR: [{ labelState: null }, { labelState: "PURCHASE_FAILED" }],
      },
      data: { labelState: "SUBMITTING", labelResultId: null, actor },
    });
    if (!won.count)
      throw Error("A label request already exists. Check its status.");
    try {
      const resultId = await buyLabel(admin, options);
      await db.cardbitShelfParcel.update({
        where: { id: p.id },
        data: { labelResultId: resultId, labelState: "PENDING_PURCHASE" },
      });
      return { requested: true };
    } catch (e) {
      if (e instanceof ShopifyDeclined)
        await db.cardbitShelfParcel.updateMany({
          where: { id: p.id, shop, labelState: "SUBMITTING" },
          data: { labelState: null },
        });
      throw e;
    }
  }
  if (input.action !== "shipParcel")
    throw Error("Choose a fulfillment action.");
  const number = (p.tracking || input.tracking || "").trim(),
    company = (p.carrier || input.carrier || "").trim();
  if (
    number.length < 3 ||
    number.length > 120 ||
    !company ||
    company.length > 80
  )
    throw Error(
      "Enter the carrier and tracking number from the shipping label.",
    );
  if (p.labelState && !["PURCHASED", "PURCHASE_FAILED"].includes(p.labelState))
    throw Error(
      "Check the existing postage purchase before creating fulfillment.",
    );
  const won = await db.cardbitShelfParcel.updateMany({
    where: {
      shop,
      id: p.id,
      state: "PACKED",
      revision: p.revision,
      labelState: p.labelState,
    },
    data: { state: "SENDING", tracking: number, carrier: company, actor },
  });
  if (!won.count)
    throw Error("This shipment is already being updated. Check its status.");
  let fid: string;
  try {
    fid = await fulfill(
      admin,
      p.id,
      manifest(p).lines.map(({ id, quantity }) => ({ id, quantity })),
      number,
      company,
    );
  } catch (e) {
    if (e instanceof ShopifyDeclined)
      await db.cardbitShelfParcel.updateMany({
        where: { id: p.id, shop, state: "SENDING" },
        data: { state: "PACKED" },
      });
    throw e;
  }
  return finish(db, p.id, p.orderId, p.revision, fid);
}
