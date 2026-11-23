import { AsyncLocalStorage } from "node:async_hooks";
import {
  authenticate as installed,
  unauthenticated as offline,
} from "../../../shopify.server";
import { CARDBIT_SHOP } from "../../../lib/cardbit.server";
import { enabled } from "../../../workspace/mode.server";
type Offline = Awaited<ReturnType<typeof offline.admin>>;
const ownerRequest = new AsyncLocalStorage<Offline>();
export const runAsGiveawayOwner = <T>(context: Offline, fn: () => Promise<T>) =>
  ownerRequest.run(context, fn);
export const unauthenticated = {
  admin: async (shop: string) => {
    if (shop !== CARDBIT_SHOP || !enabled(shop))
      throw new Response(null, { status: 404 });
    return offline.admin(shop);
  },
};
export const authenticate = {
  admin: async (request: Request) => {
    request.signal.throwIfAborted();
    const ctx = ownerRequest.getStore();
    if (!ctx || !enabled(ctx.session.shop))
      throw new Response(null, { status: 403 });
    return ctx;
  },
  public: {
    appProxy: async (request: Request) => {
      const ctx = await installed.public.appProxy(request);
      if (!ctx.session || !enabled(ctx.session.shop))
        throw new Response(null, { status: 404 });
      return ctx;
    },
    customerAccount: installed.public.customerAccount,
    checkout: installed.public.checkout,
  },
  webhook: installed.webhook,
};
