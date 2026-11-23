import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { runAsGiveawayOwner } from "./legacy/app/shopify.server";
import { unauthenticated } from "../shopify.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as index from "./legacy/app/routes/app._index";
import * as create from "./legacy/app/routes/app.campaigns.new";
import * as detail from "./legacy/app/routes/app.campaigns.$id";
import * as edit from "./legacy/app/routes/app.campaigns.$id_.edit";
import * as analytics from "./legacy/app/routes/app.campaigns.$id_.analytics";
import * as entrant from "./legacy/app/routes/app.campaigns.$id_.entrants.$entrantId";
import * as upload from "./legacy/app/routes/app.campaigns.$id_.import";
import * as download from "./legacy/app/routes/app.campaigns.$id.export";

type Handler = {
  loader: (args: LoaderFunctionArgs) => Promise<unknown>;
  action?: (args: ActionFunctionArgs) => Promise<unknown>;
};
const pages: Record<string, Handler> = {
  index,
  create,
  detail,
  edit,
  analytics,
  entrant,
  import: upload,
  export: download,
};
export async function campaignDesk(
  context: Awaited<ReturnType<typeof unauthenticated.admin>>,
  input: Record<string, unknown>,
) {
  const path = String(input.path ?? "");
  if (!path.startsWith("/staff/cardbit-campaigns") || path.length > 3000)
    throw Error("Invalid campaign page.");
  const target = new URL(path, "https://cardbit.cardbroker.app");
  const match =
    /^\/staff\/cardbit-campaigns(?:\/campaigns\/(new|[a-z0-9_-]+)(?:\/(edit|analytics|import|export|entrants)(?:\/([a-z0-9_-]+))?)?)?\/?$/.exec(
      target.pathname,
    );
  if (!match) throw Error("Unknown campaign page.");
  const [, id, sub, entrantId] = match;
  const view = !id
    ? "index"
    : id === "new"
      ? "create"
      : sub === "entrants"
        ? "entrant"
        : sub || "detail";
  const handlers = pages[view],
    writing = input.method === "POST",
    handler = writing ? handlers?.action : handlers?.loader;
  if (!handler) throw Error("Choose an available campaign action.");
  const form = new FormData();
  if (writing && Array.isArray(input.fields))
    for (const pair of input.fields) {
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        typeof pair[0] !== "string"
      )
        throw Error("Invalid campaign form.");
      const [key, v] = pair;
      if (typeof v === "string") form.append(key, v);
      else if (
        v &&
        typeof v.base64 === "string" &&
        typeof v.name === "string" &&
        v.base64.length <= 7000000
      )
        form.append(
          key,
          new Blob([new Uint8Array(Buffer.from(v.base64, "base64"))], {
            type: String(v.mime ?? ""),
          }),
          v.name,
        );
      else throw Error("Invalid campaign attachment.");
    }
  const request = new Request(target, {
    method: writing ? "POST" : "GET",
    body: writing ? form : undefined,
  });
  return runAsGiveawayOwner(context, async () => {
    let result: unknown;
    try {
      result = await handler({
        request,
        params: { id, entrantId },
        context: {} as LoaderFunctionArgs["context"],
        url: target,
        pattern: target.pathname,
      });
    } catch (error) {
      if (error instanceof Response) result = error;
      else throw error;
    }
    if (result instanceof Response) {
      const location = result.headers.get("location");
      if (location && location.startsWith("/staff/cardbit-campaigns"))
        return { redirect: location };
      if (!result.ok)
        throw Error("Campaign request failed (" + result.status + ").");
      if (result.headers.get("content-type")?.includes("text/csv"))
        return {
          csv: await result.text(),
          filename:
            result.headers
              .get("content-disposition")
              ?.match(/filename="([^"]+)"/)?.[1] || "entries.csv",
        };
      return { data: await result.json() };
    }
    return { data: result };
  });
}
export async function campaignProducts(admin: AdminApiContext, q: unknown) {
  const response = await admin.graphql(
    `#graphql
 query CardbitGiveawayProducts($query:String){products(first:25,query:$query){nodes{id title handle hasOnlyDefaultVariant variantsCount{count} media(first:1){nodes{preview{image{url}}}} variants(first:100){nodes{id title price media(first:1){nodes{preview{image{url}}}}}}}}}
 `,
    {
      variables: {
        query:
          String(q ?? "")
            .trim()
            .slice(0, 120) || null,
      },
    },
  );
  const body = await response.json();
  if (("errors" in body && body.errors) || !body.data?.products)
    throw Error("Cardbit product search is unavailable.");
  return { products: body.data.products.nodes };
}
