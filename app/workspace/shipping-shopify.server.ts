import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { PrismaClient } from "@prisma/client";
import { gql } from "../lib/orders.server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { choseVaultRate } from "../lib/vault-singles.server";

type Page<T> = {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};
export type OrderHeader = {
  id: string;
  name: string;
  test: boolean;
  cancelledAt: string | null;
  createdAt: string;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  shippingLine: {
    title: string;
    originalPriceSet?: { shopMoney: { amount: string; currencyCode: string } };
  } | null;
  customAttributes?: { key: string; value: string }[];
  tags?: string[];
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
};
const header = `id name test cancelledAt createdAt displayFinancialStatus displayFulfillmentStatus shippingLine{title originalPriceSet{shopMoney{amount currencyCode}}} currentTotalPriceSet{shopMoney{amount currencyCode}}`;
export function vaultReference(order: OrderHeader) {
  return (
    order.customAttributes?.find((a) => a.key === "_vault_request")?.value ||
    (order.tags?.includes("mystery-vault-shipment") ? "unlinked" : null)
  );
}
export const shopifyOrderUrl = (id: string) =>
  "https://admin.shopify.com/store/" +
  shop.split(".")[0] +
  "/orders/" +
  id.split("/").pop();
export async function orderItems(admin: AdminApiContext, id: string) {
  const items: {
    id: string;
    name: string;
    quantity: number;
    image?: string | null;
  }[] = [];
  let after: string | null = null;
  do {
    const page: {
      order: {
        lineItems: Page<{
          id: string;
          name: string;
          quantity: number;
          image: { url: string } | null;
        }>;
      };
    } =
      await gql(
        admin,
        `query ShelfOrderItems($id:ID!,$after:String){order(id:$id){lineItems(first:100,after:$after){nodes{id name quantity image{url}} pageInfo{hasNextPage endCursor}}}}`,
        { id, after },
      );
    const c = page.order.lineItems;
    items.push(
      ...c.nodes.map(({ image, ...n }) => ({ ...n, image: image?.url ?? null })),
    );
    after = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
  } while (after);
  return items;
}
export async function deliveryAddress(admin: AdminApiContext, id: string) {
  const data = await gql(
    admin,
    `query ShelfAddress($id:ID!){fulfillmentOrder(id:$id){destination{firstName lastName company address1 address2 city provinceCode zip countryCode}}}`,
    { id },
  );
  const d = data.fulfillmentOrder?.destination;
  if (!d?.address1)
    throw Error("Open this order in Shopify to view the delivery address.");
  return {
    lines: [
      [d.firstName, d.lastName].filter(Boolean).join(" "),
      d.company,
      d.address1,
      d.address2,
      [d.city, d.provinceCode, d.zip].filter(Boolean).join(" "),
      d.countryCode,
    ].filter(Boolean),
  };
}
export async function orderPage(
  db: PrismaClient,
  admin: AdminApiContext,
  input: { view?: string; after?: string; query?: string },
) {
  if (input.view === "wallet") {
    const rows = await db.packOrder.findMany({
      where: { shop, orderId: { startsWith: "cardbit-wallet:" } },
      orderBy: [{ createdAt: "desc" }, { orderId: "desc" }],
      take: 26,
      ...(input.after ? { cursor: { orderId: input.after }, skip: 1 } : {}),
      select: { orderId: true, orderName: true, createdAt: true },
    });
    return {
      orders: rows.slice(0, 25).map((r) => ({
        id: r.orderId,
        name: r.orderName,
        createdAt: r.createdAt,
        payment: "Paid with Cardbits",
        status: "Kept in vault",
        method: "Customer vault",
      })),
      next: rows.length > 25 ? rows[24].orderId : null,
    };
  }
  const search = String(input.query || "")
    .trim()
    .replace(/^#/, "");
  if (search && !/^[a-zA-Z0-9-]{1,50}$/.test(search))
    throw Error("Search by order number.");
  const data = await gql<{ orders: Page<OrderHeader> }>(
    admin,
    `query ShelfOrders($after:String,$query:String!){orders(first:25,after:$after,sortKey:PROCESSED_AT,reverse:true,query:$query){nodes{${header}} pageInfo{endCursor hasNextPage}}}`,
    {
      after: input.after || null,
      query: "test:false" + (search ? " name:" + search : ""),
    },
  );
  return {
    orders: data.orders.nodes
      .filter((o) => !o.test)
      .map((o) => ({
        id: o.id,
        name: o.name,
        createdAt: o.createdAt,
        payment: o.displayFinancialStatus,
        status: o.cancelledAt ? "CANCELLED" : o.displayFulfillmentStatus,
        method: o.shippingLine?.title || "",
        total: o.currentTotalPriceSet.shopMoney,
      })),
    next: data.orders.pageInfo.hasNextPage
      ? data.orders.pageInfo.endCursor
      : null,
  };
}
export type ParcelHeader = {
  id: string;
  status: string;
  supportedActions: { action: string }[];
  deliveryMethod: {
    methodType: string;
    presentedName?: string | null;
    serviceCode?: string | null;
  } | null;
  assignedLocation: {
    name: string;
    location: { id: string; isFulfillmentService: boolean } | null;
  };
};
export type OrderLine = {
  id: string;
  remainingQuantity: number;
  totalQuantity: number;
  lineItem: {
    id: string;
    name: string;
    title: string;
    requiresShipping: boolean;
    customAttributes: { key: string; value: string }[];
    variant: { id: string; product: { productType: string } } | null;
  };
};
type Fulfillment = {
  id: string;
  status: string;
  createdAt: string;
  trackingInfo: { number: string | null; company: string | null }[];
  fulfillmentLineItems: Page<{ quantity: number; lineItem: { id: string } }>;
};
export async function orderDetail(admin: AdminApiContext, id: string) {
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(id))
    throw Error("Choose a Shopify order.");
  const fields =
    "id status supportedActions{action} deliveryMethod{methodType presentedName serviceCode} assignedLocation{name location{id isFulfillmentService}}";
  let after: string | null = null,
    order: OrderHeader | undefined;
  const shipments: ParcelHeader[] = [];
  do {
    const page: {
      order: (OrderHeader & { fulfillmentOrders: Page<ParcelHeader> }) | null;
    } = await gql(
      admin,
      `query ShelfOrder($id:ID!,$after:String){order(id:$id){${header} tags customAttributes{key value} fulfillmentOrders(first:50,after:$after){nodes{${fields}} pageInfo{hasNextPage endCursor}}}}`,
      { id, after },
    );
    if (!page.order || page.order.test)
      throw Error("This order is unavailable in Cardbit.");
    order = page.order;
    const conn = page.order.fulfillmentOrders;
    shipments.push(...conn.nodes);
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);
  return { order: order!, shipments, adminUrl: shopifyOrderUrl(id) };
}
export function eligibility(order: OrderHeader, fo: ParcelHeader) {
  if (order.test || order.cancelledAt)
    return "This order is cancelled or marked as a test.";
  if (order.displayFinancialStatus !== "PAID")
    return "Payment must be confirmed before packing.";
  if (
    choseVaultRate({
      shipping_lines: order.shippingLine ? [order.shippingLine] : [],
    })
  )
    return "The customer chose to keep these cards in the vault.";
  if (fo.deliveryMethod?.methodType !== "SHIPPING")
    return "This fulfillment has no shipping delivery method.";
  if (
    !fo.assignedLocation.location ||
    fo.assignedLocation.location.isFulfillmentService ||
    !fo.supportedActions.some((x) => x.action === "CREATE_FULFILLMENT") ||
    !["OPEN", "IN_PROGRESS"].includes(fo.status)
  )
    return "Shopify has closed, held or assigned this fulfillment elsewhere.";
  return "";
}
export async function parcelLines(admin: AdminApiContext, id: string) {
  let after: string | null = null;
  const lines: OrderLine[] = [];
  do {
    const data: { fulfillmentOrder: { lineItems: Page<OrderLine> } | null } =
      await gql(
        admin,
        `query ShelfLines($id:ID!,$after:String){fulfillmentOrder(id:$id){lineItems(first:100,after:$after){nodes{id remainingQuantity totalQuantity lineItem{id name title requiresShipping customAttributes{key value} variant{id product{productType}}}} pageInfo{endCursor hasNextPage}}}}`,
        { id, after },
      );
    if (!data.fulfillmentOrder) throw Error("Refresh this fulfillment order.");
    const p = data.fulfillmentOrder.lineItems;
    lines.push(...p.nodes);
    after = p.pageInfo.hasNextPage ? p.pageInfo.endCursor : null;
  } while (after);
  return lines;
}
export async function parcelFulfillments(admin: AdminApiContext, id: string) {
  const rows: Fulfillment[] = [];
  let after: string | null = null;
  do {
    const data: {
      fulfillmentOrder: {
        fulfillments: Page<Omit<Fulfillment, "fulfillmentLineItems">>;
      } | null;
    } = await gql(
      admin,
      `query ShelfFulfillments($id:ID!,$after:String){fulfillmentOrder(id:$id){fulfillments(first:30,after:$after){nodes{id status createdAt trackingInfo{number company}} pageInfo{endCursor hasNextPage}}}}`,
      { id, after },
    );
    if (!data.fulfillmentOrder) throw Error("Refresh this fulfillment order.");
    for (const f of data.fulfillmentOrder.fulfillments.nodes) {
      if (f.status !== "SUCCESS") continue;
      const nodes: Fulfillment["fulfillmentLineItems"]["nodes"] = [];
      let cursor: string | null = null;
      do {
        const page: {
          node: { fulfillmentLineItems: Fulfillment["fulfillmentLineItems"] };
        } = await gql(
          admin,
          `query ShelfFulfilledLines($id:ID!,$after:String){node(id:$id){... on Fulfillment{fulfillmentLineItems(first:100,after:$after){nodes{quantity lineItem{id}} pageInfo{endCursor hasNextPage}}}}}`,
          { id: f.id, after: cursor },
        );
        const c = page.node.fulfillmentLineItems;
        nodes.push(...c.nodes);
        cursor = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
      } while (cursor);
      rows.push({
        ...f,
        fulfillmentLineItems: {
          nodes,
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      });
    }
    const info = data.fulfillmentOrder.fulfillments.pageInfo;
    after = info.hasNextPage ? info.endCursor : null;
  } while (after);
  return rows;
}
export class ShopifyDeclined extends Error {}
async function mutation(
  admin: AdminApiContext,
  query: string,
  variables: Record<string, unknown>,
  key: string,
) {
  type MutationPayload = {
    userErrors?: { message: string }[];
    fulfillment?: { id: string; status: string };
    shippingLabelPurchaseResult?: { id: string };
  };
  const result = (await (await admin.graphql(query, { variables })).json()) as {
    data?: Record<string, MutationPayload>;
    errors?: unknown;
  };
  if (result.errors || !result.data?.[key])
    throw Error("Shopify has not confirmed this request. Check its status.");
  const data = result.data[key];
  if (data.userErrors?.length)
    throw new ShopifyDeclined(
      data.userErrors
        .map((x: { message: string }) => x.message)
        .join(" ")
        .slice(0, 230),
    );
  return data;
}
export async function fulfill(
  admin: AdminApiContext,
  id: string,
  lines: { id: string; quantity: number }[],
  number: string,
  company: string,
) {
  const data = await mutation(
    admin,
    `mutation ShelfShip($fulfillment:FulfillmentInput!){fulfillmentCreate(fulfillment:$fulfillment){fulfillment{id status} userErrors{message}}}`,
    {
      fulfillment: {
        notifyCustomer: true,
        trackingInfo: { number, company },
        lineItemsByFulfillmentOrder: [
          { fulfillmentOrderId: id, fulfillmentOrderLineItems: lines },
        ],
      },
    },
    "fulfillmentCreate",
  );
  if (!data.fulfillment?.id || data.fulfillment.status !== "SUCCESS")
    throw Error("Shopify has not confirmed fulfillment yet.");
  return String(data.fulfillment.id);
}
export type LabelInput = {
  shippingDatetime: string;
  ounces: number;
  carrierCode?: string;
  serviceCode?: string;
};
export function labelOptions(id: string, input: LabelInput) {
  if (
    !input ||
    !Number.isFinite(Date.parse(input.shippingDatetime)) ||
    Date.parse(input.shippingDatetime) <= Date.now() ||
    !Number.isFinite(input.ounces) ||
    input.ounces <= 0 ||
    input.ounces > 2400
  )
    throw Error("Enter a future ship time and the packed weight in ounces.");
  if (
    !!input.carrierCode !== !!input.serviceCode ||
    [input.carrierCode, input.serviceCode].some(
      (s) => s && !/^[\w .-]{1,70}$/.test(s),
    )
  )
    throw Error(
      "Enter both Shopify rate codes or use the selected Shopify service.",
    );
  return {
    fulfillmentOrderId: id,
    shippingDatetime: new Date(input.shippingDatetime).toISOString(),
    totalWeight: { value: input.ounces, unit: "OUNCES" },
    notifyCustomer: true,
    ...(input.carrierCode
      ? {
          preferredRateSelection: {
            carrierCode: input.carrierCode,
            serviceCode: input.serviceCode,
          },
        }
      : {}),
  };
}
export async function buyLabel(
  admin: AdminApiContext,
  input: ReturnType<typeof labelOptions>,
) {
  const data = await mutation(
    admin,
    `mutation ShelfLabel($input:ShippingLabelPurchaseInput!){shippingLabelPurchase(shippingLabelPurchase:$input){shippingLabelPurchaseResult{id status} userErrors{code message}}}`,
    { input },
    "shippingLabelPurchase",
  );
  if (!data.shippingLabelPurchaseResult?.id)
    throw Error("Check the order in Shopify before purchasing postage again.");
  return String(data.shippingLabelPurchaseResult.id);
}
export async function readLabel(admin: AdminApiContext, id: string) {
  const data = await gql(
    admin,
    `query ShelfLabelStatus($id:ID!){node(id:$id){... on ShippingLabelPurchaseResult {id status errors{message} shippingLabels{trackingInfo{number company} shippingDocuments{documentType format url}}}}}`,
    { id },
  );
  if (!data.node) throw Error("Shopify has not returned this label yet.");
  return data.node as {
    status: string;
    errors: { message: string }[];
    shippingLabels: {
      trackingInfo: { number: string; company: string } | null;
      shippingDocuments: {
        documentType: string;
        format: string;
        url: string;
      }[];
    }[];
  };
}
