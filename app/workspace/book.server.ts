import { marketApproved } from "./market.server";
import type { Prisma, PrismaClient } from "@prisma/client";
import { CARDBIT_SHOP } from "../lib/cardbit.server";
import {
  initialPolicy,
  offer,
  printingKey,
  validatePolicy,
  type Policy,
  type Reference,
} from "./model";

export { enabled, reviewWorkspaceEnabled } from "./mode.server";
export type DeskDb = Prisma.TransactionClient;
export const asJson = (value: unknown) => value as Prisma.InputJsonValue;
export type References = Record<string, Reference>;
export async function readBook(db: DeskDb) {
  const row = await db.cardbitDeskBook.findUnique({
    where: { shop: CARDBIT_SHOP },
  });
  const refs = (row?.references ?? {}) as References;
  const allowMarket = marketApproved();
  for (const ref of Object.values(refs)) {
    ref.quoteSource ??= "snapshot";
    if (!allowMarket) {
      ref.market = null;
      ref.marketDate = null;
    }
  }
  return {
    revision: row?.revision ?? 0,
    policy: (row?.policy ?? initialPolicy) as Policy,
    refs,
    variants: (row?.variants ?? {}) as Record<string, string>,
    refreshed: row?.refreshedAt?.toISOString() ?? null,
    date: row?.referenceDate ?? null,
  };
}
export async function lockBook(tx: DeskDb) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"cardbit-desk/prices/" + CARDBIT_SHOP},0))::text`;
}
export async function changeBook(
  db: PrismaClient,
  change:
    | { policy: Policy; expected: number; actor: string }
    | {
        refs: References;
        variants: Record<string, string>;
        date: string;
        started: Date;
      },
) {
  return db.$transaction(
    async (tx) => {
      await lockBook(tx);
      const before = await readBook(tx);
      const latest = await tx.cardbitDeskTick.findFirst({
        where: { shop: CARDBIT_SHOP },
        orderBy: { at: "desc" },
        select: { at: true },
      });
      const now = new Date(
        Math.max(Date.now(), (latest?.at.getTime() ?? 0) + 1),
      );
      const observeDay =
        "date" in change &&
        before.refreshed?.slice(0, 10) !== now.toISOString().slice(0, 10);
      if ("expected" in change && before.revision !== change.expected)
        throw Error("Pricing changed. Reload before publishing.");
      if (
        "started" in change &&
        before.refreshed &&
        change.started.getTime() < Date.parse(before.refreshed)
      )
        return before.revision;
      const policy = "policy" in change ? change.policy : before.policy;
      validatePolicy(policy);
      if (
        "policy" in change &&
        policy.basis === "market" &&
        (!marketApproved() ||
          !Object.values(before.refs).some(
            (r) =>
              r.market != null &&
              r.quoteSource === "merchant" &&
              r.cash &&
              r.retail,
          ))
      )
        throw Error(
          "TCGplayer pricing needs approved market access and at least one matched active offer.",
        );
      const refs = "refs" in change ? change.refs : before.refs;
      // Keep exact mappings after a printing sells out. Its owner can still see price history.
      const variants =
        "variants" in change
          ? { ...before.variants, ...change.variants }
          : before.variants;
      const ticks = [];
      for (const key of new Set([
        ...Object.keys(before.refs),
        ...Object.keys(refs),
      ])) {
        const a = before.refs[key],
          b = refs[key],
          bits = b ? offer(b, policy) : null,
          market = b?.market ?? null;
        if (
          observeDay ||
          !a ||
          !b ||
          offer(a, before.policy) !== bits ||
          a.market !== market
        )
          ticks.push({ shop: CARDBIT_SHOP, key, at: now, bits, market });
      }
      if (ticks.length) await tx.cardbitDeskTick.createMany({ data: ticks });
      const values = {
        revision: before.revision + 1,
        policy: asJson(policy),
        references: asJson(refs),
        variants: asJson(variants),
        ...("actor" in change
          ? { actor: change.actor }
          : { refreshedAt: now, referenceDate: change.date }),
      };
      await tx.cardbitDeskBook.upsert({
        where: { shop: CARDBIT_SHOP },
        create: { shop: CARDBIT_SHOP, ...values },
        update: values,
      });
      return values.revision;
    },
    { maxWait: 10000, timeout: 45000 },
  );
}
export type Book = Awaited<ReturnType<typeof readBook>>;
export type Identity = {
  tcgplayerId?: string | number;
  language?: string;
  printing?: string;
  condition?: string;
};
export const identityKey = (c?: Identity) =>
  c &&
  printingKey(
    c.tcgplayerId,
    c.language || "",
    c.printing || "",
    c.condition || "",
  );
export function quoteFor(c: Identity, book: Book) {
  const key = identityKey(c),
    ref = key && book.refs[key];
  return ref ? offer(ref, book.policy) : null;
}
