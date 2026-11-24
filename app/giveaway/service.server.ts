import { mailInLog } from "./mail-in.server";
import type { PrismaClient } from "@prisma/client";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { activeRound, lockDesk, post } from "./entries.server";
import { drawWindow, rulesLink, entryRate, PRIZE } from "./rules";

export const configDefaults = {
  enabled: false,
  rulesUrl: "",
  freeInstructions: "",
  referralEntries: 500,
  shareEntries: 100,
};

export async function promptView(db: PrismaClient, customerId: string | null) {
  const config = await db.cardbitGiveawayConfig.findUnique({
    where: { shop },
    select: { enabled: true },
  });
  if (!config?.enabled) return { enabled: false };
  const { day, closesAt } = drawWindow(new Date());
  const window = { enabled: true, day, closesAt: closesAt.toISOString() };
  if (!customerId) return { ...window, signedIn: false };
  const account = { shop_customerId: { shop, customerId } };
  const [person, wallet, entry] = await Promise.all([
    db.cardbitGiveawayPerson.findUnique({
      where: account,
      select: { whatnotAt: true, held: true },
    }),
    db.cardbitWallet.findUnique({ where: account, select: { held: true } }),
    db.cardbitGiveawayEvent.findUnique({
      where: { shop_key: { shop, key: "daily:" + day + ":" + customerId } },
      select: { voided: true },
    }),
  ]);
  return {
    ...window,
    signedIn: true,
    whatnotDone: Boolean(person?.whatnotAt),
    held: Boolean(person?.held || wallet?.held),
    entered: Boolean(entry && !entry.voided),
  };
}
const roundFields = {
  day: true,
  opensAt: true,
  closesAt: true,
  commitment: true,
  closedAt: true,
  winnerId: true,
  totalEntries: true,
  participantCount: true,
  snapshotHash: true,
} as const;
export async function customerView(
  db: PrismaClient,
  customerId: string | null,
  subscribed: boolean,
) {
  const { day, closesAt } = drawWindow(new Date());
  const [cfg, round, person, events, claimed, winners, wallet] =
    await Promise.all([
      db.cardbitGiveawayConfig.findUnique({ where: { shop } }),
      db.cardbitGiveawayRound.findUnique({
        where: { shop_day: { shop, day } },
        select: { commitment: true },
      }),
      customerId
        ? db.cardbitGiveawayPerson.findUnique({
            where: { shop_customerId: { shop, customerId } },
          })
        : null,
      customerId
        ? db.cardbitGiveawayEvent.findMany({
            where: { shop, day, customerId, voided: false },
            select: { kind: true, entries: true },
          })
        : [],
      customerId
        ? db.cardbitGiveawayEvent.findMany({
            where: {
              shop,
              customerId,
              kind: { in: ["whatnot", "facebook", "instagram"] },
            },
            select: { kind: true },
          })
        : [],
      db.cardbitGiveawayRound.findMany({
        where: { shop, closedAt: { not: null }, winnerId: { not: null } },
        orderBy: { day: "desc" },
        take: 7,
        select: { day: true, winnerId: true, totalEntries: true },
      }),
      customerId
        ? db.cardbitWallet.findUnique({
            where: { shop_customerId: { shop, customerId } },
            select: { held: true },
          })
        : null,
    ]);
  const config = cfg ?? configDefaults,
    entered = events.some((e) => e.kind === "daily");
  const byKind: Record<string, number> = {};
  for (const e of events) byKind[e.kind] = (byKind[e.kind] ?? 0) + e.entries;
  return {
    day,
    closesAt,
    enabled: config.enabled,
    prize: PRIZE,
    commitment: round?.commitment ?? null,
    rulesUrl: config.rulesUrl,
    freeInstructions: config.freeInstructions,
    referralEntries: config.referralEntries,
    shareEntries: config.shareEntries,
    signedIn: !!customerId,
    subscribed,
    whatnotDone: !!person?.whatnotAt,
    held: !!person?.held || !!wallet?.held,
    entered,
    refCode: person?.code ?? null,
    claimed: claimed.map((c) => c.kind),
    byKind,
    total: events.reduce((n, e) => n + e.entries, 0),
    winners: winners.map((w) => ({
      day: w.day,
      yours: !!customerId && w.winnerId === customerId,
      totalEntries: w.totalEntries,
    })),
  };
}
export async function ownerView(
  db: PrismaClient,
  input: Record<string, unknown>,
) {
  const now = drawWindow(new Date());
  const day =
    typeof input.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.day)
      ? input.day
      : now.day;
  const search = String(input.search ?? "")
    .trim()
    .slice(0, 120);
  const [config, rounds, events, people, stats, audit, selected] =
    await Promise.all([
      db.cardbitGiveawayConfig.findUnique({ where: { shop } }),
      db.cardbitGiveawayRound.findMany({
        where: { shop },
        orderBy: { day: "desc" },
        take: 35,
        select: roundFields,
      }),
      db.cardbitGiveawayEvent.findMany({
        where: {
          shop,
          day,
          ...(search
            ? {
                OR: [
                  { customerId: { contains: search } },
                  { key: { contains: search } },
                  { kind: { contains: search } },
                ],
              }
            : {}),
        },
        orderBy: [{ postedAt: "desc" }, { id: "asc" }],
        take: 100,
      }),
      db.cardbitGiveawayPerson.count({ where: { shop, held: true } }),
      db.cardbitGiveawayEvent.groupBy({
        by: ["kind"],
        where: { shop, day, voided: false },
        _sum: { entries: true },
        _count: true,
      }),
      db.cardbitGiveawayAudit.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      db.cardbitGiveawayRound.findUnique({
        where: { shop_day: { shop, day } },
      }),
    ]);
  const proof = selected?.closedAt
    ? {
        seed: selected.seed,
        commitment: selected.commitment,
        snapshotHash: selected.snapshotHash,
        tickets: selected.snapshot,
      }
    : null;
  return {
    config: config ?? configDefaults,
    day,
    today: now.day,
    closesAt: now.closesAt,
    rounds,
    events,
    held: people,
    stats: stats.map((s) => ({
      kind: s.kind,
      events: s._count,
      entries: s._sum.entries ?? 0,
    })),
    audit,
    proof,
    mailIn: await mailInLog(db),
  };
}
export async function manage(
  db: PrismaClient,
  actor: string,
  input: Record<string, unknown>,
) {
  const intent = String(input.intent);
  await db.$transaction(async (tx) => {
    await lockDesk(tx);
    let detail = "";
    if (intent === "settings") {
      const rulesUrl = rulesLink(input.rulesUrl),
        freeInstructions = String(input.freeInstructions ?? "")
          .trim()
          .slice(0, 4000);
      const enabled = input.enabled === true;
      if (enabled && (!rulesUrl || !freeInstructions))
        throw Error(
          "Add the official rules and free bonus-entry instructions before opening entries.",
        );
      const data = {
        rulesUrl,
        freeInstructions,
        enabled,
        referralEntries: entryRate(input.referralEntries),
        shareEntries: entryRate(input.shareEntries),
      };
      await tx.cardbitGiveawayConfig.upsert({
        where: { shop },
        create: { shop, ...data },
        update: data,
      });
      if (enabled) await activeRound(tx, new Date());
      detail = JSON.stringify(data);
    } else if (intent === "hold" || intent === "release") {
      const customerId = String(input.customerId ?? ""),
        reason = String(input.reason ?? "")
          .trim()
          .slice(0, 240);
      if (!reason) throw Error("Enter the reason for the review.");
      await tx.cardbitGiveawayPerson.update({
        where: { shop_customerId: { shop, customerId } },
        data: { held: intent === "hold" },
      });
      detail = customerId + " " + reason;
    } else if (intent === "adjust" || intent === "free-entry") {
      const { day } = drawWindow(new Date()),
        customerId = String(input.customerId ?? ""),
        n = Number(input.entries),
        reason = String(input.reason ?? "")
          .trim()
          .slice(0, 240),
        token = String(input.requestId ?? "");
      if (
        !Number.isInteger(n) ||
        !n ||
        Math.abs(n) > 100000 ||
        !reason ||
        !/^[a-f\d-]{36}$/i.test(token) ||
        (intent === "free-entry" && n <= 0)
      )
        throw Error("Enter a valid amount and a reason.");
      const p = await tx.cardbitGiveawayPerson.findUnique({
        where: { shop_customerId: { shop, customerId } },
      });
      if (!p || p.held || !p.whatnotAt)
        throw Error("Choose an eligible giveaway account first.");
      const cfg = await tx.cardbitGiveawayConfig.findUnique({
        where: { shop },
      });
      if (!cfg?.enabled) throw Error("The daily giveaway is paused.");
      await activeRound(tx, new Date());
      const prior = await tx.cardbitGiveawayEvent.findUnique({
        where: { shop_key: { shop, key: "desk:" + token } },
      });
      if (prior) {
        if (
          prior.customerId !== customerId ||
          prior.entries !== n ||
          prior.kind !== intent ||
          prior.note !== reason
        )
          throw Error("This adjustment reference is already in use.");
        return;
      }
      await post(tx, {
        day,
        customerId,
        kind: intent,
        key: "desk:" + token,
        entries: n,
        actor,
        note: reason,
      });
      detail = customerId + " " + n + " " + reason;
    } else throw Error("Choose a giveaway management action.");
    await tx.cardbitGiveawayAudit.create({
      data: { shop, actor, action: intent, detail },
    });
  });
}

export async function entryExport(
  db: PrismaClient,
  input: Record<string, unknown>,
) {
  const day = String(input.day ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error("Select a draw date.");
  const cursor =
    typeof input.cursor === "string" && input.cursor ? input.cursor : null;
  const cutoff = input.asOf ? new Date(String(input.asOf)) : new Date();
  if (!Number.isFinite(+cutoff) || +cutoff > Date.now() + 1000)
    throw Error("Invalid export date.");
  const rows = await db.cardbitGiveawayEvent.findMany({
    where: {
      shop,
      day,
      postedAt: { lte: cutoff },
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: "asc" },
    take: 501,
    select: {
      id: true,
      customerId: true,
      kind: true,
      entries: true,
      voided: true,
      note: true,
      postedAt: true,
    },
  });
  return {
    rows: rows.slice(0, 500),
    next: rows.length > 500 ? rows[499].id : null,
    asOf: cutoff.toISOString(),
  };
}
