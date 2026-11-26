// Card Broker "Chat" tab ↔ cardbit.com live chat (Trevor 2026-11-26: finish live chat). Staff review every message
// (live and removed) with the author's email, remove or restore messages, mute and unmute authors, and post as
// "Cardbit Staff". Server-to-server only: routes/internal.site-chat.tsx checks the pairing secret, and Card Broker
// authenticates its own staff and sends their email as the actor (audit).
import type { Prisma, PrismaClient } from "@prisma/client";
import { ChatError, HISTORY, MUTE_HOURS, chatOn, cleanBody, isRoom } from "./chat.server";
import { AUTO_ACTOR, BAN_UNTIL, type Classifier, aiModel, aiOn, claudeClassify } from "./chat-moderation.server";
import { filterMessage } from "./chat-filter.server";

type Db = PrismaClient;
const STAFF_PREFIX = "staff:";
const DAY = 86_400_000;

export const staffAuthor = (actor: string) => STAFF_PREFIX + actor.replace(/^cardbroker:/, "").slice(0, 190);
const isStaffAuthor = (customerId: string) => customerId.startsWith(STAFF_PREFIX);

export async function chatDeskList(
  db: Db,
  opts: { room?: string; show?: string; q?: string; offset?: number; limit?: number },
  env: NodeJS.ProcessEnv = process.env,
) {
  const limit = Math.min(Math.max(Number(opts.limit) || HISTORY, 1), 200);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const where: Prisma.SiteChatMessageWhereInput = {};
  if (isRoom(opts.room)) where.room = opts.room;
  if (opts.show === "removed") where.deletedAt = { not: null };
  else if (opts.show !== "all") where.deletedAt = null;
  const q = (opts.q ?? "").trim().toLowerCase();
  if (q) {
    const people = await db.siteCustomer.findMany({ where: { email: { contains: q } }, select: { id: true }, take: 200 });
    where.OR = [{ body: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { customerId: { in: people.map((p) => p.id) } }];
  }
  const since = new Date(Date.now() - DAY);
  const now = new Date();
  const [rows, matched, last24h, removed24h, chatters, activeMutes] = await Promise.all([
    db.siteChatMessage.findMany({ where, orderBy: { createdAt: "desc" }, skip: offset, take: limit }),
    db.siteChatMessage.count({ where }),
    db.siteChatMessage.count({ where: { createdAt: { gte: since } } }),
    db.siteChatMessage.count({ where: { deletedAt: { gte: since } } }),
    db.siteChatMessage.groupBy({ by: ["customerId"], where: { createdAt: { gte: since } } }),
    db.siteChatMute.count({ where: { until: { gt: now } } }),
  ]);
  const ids = [...new Set(rows.map((r) => r.customerId).filter((id) => !isStaffAuthor(id)))];
  const [people, mutes] = await Promise.all([
    db.siteCustomer.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }),
    db.siteChatMute.findMany({ where: { customerId: { in: ids }, until: { gt: now } } }),
  ]);
  const email = new Map(people.map((p) => [p.id, p.email]));
  const muted = new Map(mutes.map((m) => [m.customerId, m.until.toISOString()]));
  return {
    chatOn: chatOn(env),
    muteHours: MUTE_HOURS,
    stats: { last24h, removed24h, chatters24h: chatters.length, activeMutes, flagsOpen: await db.siteChatFlag.count({ where: { status: "open" } }) },
    matched,
    messages: rows.map((r) => ({
      id: r.id,
      room: r.room,
      name: r.name,
      badge: r.badge,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      deletedAt: r.deletedAt?.toISOString() ?? null,
      deletedBy: r.deletedBy,
      staff: isStaffAuthor(r.customerId),
      customerId: isStaffAuthor(r.customerId) ? null : r.customerId,
      email: isStaffAuthor(r.customerId) ? r.customerId.slice(STAFF_PREFIX.length) : email.get(r.customerId) ?? null,
      mutedUntil: muted.get(r.customerId) ?? null,
    })),
    next: offset + rows.length < matched ? offset + rows.length : null,
  };
}

export async function chatDeskMutes(db: Db) {
  const rows = await db.siteChatMute.findMany({ where: { until: { gt: new Date() } }, orderBy: { until: "asc" }, take: 200 });
  const people = await db.siteCustomer.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, email: true } });
  const email = new Map(people.map((p) => [p.id, p.email]));
  return {
    mutes: rows.map((r) => ({
      customerId: r.customerId,
      email: email.get(r.customerId) ?? null,
      until: r.until.toISOString(),
      by: r.byEmail,
      since: r.updatedAt.toISOString(),
      banned: r.until >= BAN_UNTIL,
      auto: r.byEmail === AUTO_ACTOR,
      reason: r.reason,
    })),
  };
}

const messageId = (id: unknown) => {
  if (typeof id !== "string" || !id || id.length > 64) throw new ChatError("bad_id", "Choose a message.");
  return id;
};

export async function chatDeskRemove(db: Db, id: unknown, actor: string) {
  const { count } = await db.siteChatMessage.updateMany({ where: { id: messageId(id), deletedAt: null }, data: { deletedAt: new Date(), deletedBy: actor } });
  if (!count) throw new ChatError("gone", "That message is already removed.", 404);
  return { ok: true };
}

export async function chatDeskRestore(db: Db, id: unknown) {
  const { count } = await db.siteChatMessage.updateMany({ where: { id: messageId(id), deletedAt: { not: null } }, data: { deletedAt: null, deletedBy: null } });
  if (!count) throw new ChatError("gone", "That message isn't removed.", 404);
  return { ok: true };
}

/** Mutes a message's author (or a customer by id) and removes their messages from the last hour. */
export async function chatDeskMute(db: Db, input: { id?: unknown; customerId?: unknown; hours?: unknown }, actor: string) {
  const h = Number(input.hours);
  if (!(MUTE_HOURS as readonly number[]).includes(h)) throw new ChatError("bad_hours", "Choose how long to mute.");
  let customerId: string | null = null;
  if (typeof input.customerId === "string" && input.customerId) {
    customerId = (await db.siteCustomer.findUnique({ where: { id: input.customerId.slice(0, 64) }, select: { id: true } }))?.id ?? null;
  } else {
    customerId = (await db.siteChatMessage.findUnique({ where: { id: messageId(input.id) }, select: { customerId: true } }))?.customerId ?? null;
  }
  if (!customerId) throw new ChatError("bad_id", "That message or customer is gone.", 404);
  if (isStaffAuthor(customerId)) throw new ChatError("staff", "Staff messages can't be muted.");
  const until = new Date(Date.now() + h * 3_600_000);
  await db.$transaction([
    db.siteChatMute.upsert({ where: { customerId }, create: { customerId, until, byEmail: actor, reason: "staff" }, update: { until, byEmail: actor } }),
    db.siteChatMessage.updateMany({
      where: { customerId, deletedAt: null, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
      data: { deletedAt: new Date(), deletedBy: actor },
    }),
  ]);
  return { until: until.toISOString() };
}

export async function chatDeskUnmute(db: Db, customerId: unknown) {
  if (typeof customerId !== "string" || !customerId) throw new ChatError("bad_id", "Choose a customer.");
  await db.siteChatMute.deleteMany({ where: { customerId: customerId.slice(0, 64) } });
  return { ok: true };
}

/** Posts as "Cardbit Staff" (same badge as staff posting on the site). Same text rules as customers. */
export async function chatDeskPost(db: Db, room: unknown, raw: unknown, actor: string) {
  if (!isRoom(room)) throw new ChatError("bad_room", "Choose a room.");
  const body = cleanBody(raw);
  const m = await db.siteChatMessage.create({
    data: { room, customerId: staffAuthor(actor), name: "Cardbit Staff", badge: "staff", body },
    select: { id: true },
  });
  return { id: m.id };
}

// ---------- Auto-moderation: flagged queue, ban (chat-moderation.server.ts) ----------

const FLAG_STATUS = ["open", "dismissed", "actioned"] as const;

/**
 * The flagged queue, one item per posted message (all its reports and AI flags together) or per stopped message.
 * Messages that never posted (instant filter or AI "hide") show the text that was stopped.
 */
export async function chatDeskFlags(db: Db, opts: { status?: string; offset?: number; limit?: number }, env: NodeJS.ProcessEnv = process.env) {
  const status = (FLAG_STATUS as readonly string[]).includes(opts.status ?? "") ? opts.status! : "open";
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 300);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const since = new Date(Date.now() - DAY);
  const now = new Date();
  const [flags, open, stopped24h, autoMutes] = await Promise.all([
    db.siteChatFlag.findMany({ where: { status }, orderBy: { createdAt: "desc" }, skip: offset, take: limit }),
    db.siteChatFlag.count({ where: { status: "open" } }),
    db.siteChatFlag.count({ where: { hidden: true, createdAt: { gte: since } } }),
    db.siteChatMute.count({ where: { byEmail: AUTO_ACTOR, until: { gt: now } } }),
  ]);
  const authorIds = [...new Set(flags.map((f) => f.customerId))];
  const messageIds = [...new Set(flags.map((f) => f.messageId).filter((x): x is string => !!x))];
  const [people, mutes, messages] = await Promise.all([
    db.siteCustomer.findMany({ where: { id: { in: authorIds } }, select: { id: true, email: true } }),
    db.siteChatMute.findMany({ where: { customerId: { in: authorIds }, until: { gt: now } } }),
    db.siteChatMessage.findMany({ where: { id: { in: messageIds } }, select: { id: true, name: true, deletedAt: true, deletedBy: true } }),
  ]);
  const email = new Map(people.map((p) => [p.id, p.email]));
  const muted = new Map(mutes.map((m) => [m.customerId, m.until]));
  const msg = new Map(messages.map((m) => [m.id, m]));
  const strikes = new Map(
    (await db.siteChatFlag.groupBy({ by: ["customerId"], where: { customerId: { in: authorIds }, strike: true, status: { not: "dismissed" }, createdAt: { gte: since } }, _count: true })).map((g) => [g.customerId, g._count]),
  );
  const items = new Map<string, {
    key: string; flagIds: string[]; messageId: string | null; room: string; body: string; customerId: string; email: string | null; name: string | null;
    sources: string[]; categories: string[]; reasons: string[]; reports: number; severity: number; strike: boolean;
    state: "visible" | "removed" | "auto_hidden" | "stopped"; removedBy: string | null; createdAt: string; reviewedBy: string | null;
    mutedUntil: string | null; banned: boolean; strikes24h: number;
  }>();
  for (const f of flags) {
    const key = f.messageId ?? f.id;
    let it = items.get(key);
    if (!it) {
      const m = f.messageId ? msg.get(f.messageId) : null;
      const until = muted.get(f.customerId) ?? null;
      it = {
        key, flagIds: [], messageId: f.messageId, room: f.room, body: f.body, customerId: f.customerId, email: email.get(f.customerId) ?? null, name: m?.name ?? null,
        sources: [], categories: [], reasons: [], reports: 0, severity: 0, strike: false,
        state: !f.messageId ? "stopped" : !m?.deletedAt ? "visible" : m.deletedBy?.startsWith("auto:") ? "auto_hidden" : "removed",
        removedBy: m?.deletedBy ?? null, createdAt: f.createdAt.toISOString(), reviewedBy: f.reviewedBy,
        mutedUntil: until?.toISOString() ?? null, banned: !!until && until >= BAN_UNTIL, strikes24h: strikes.get(f.customerId) ?? 0,
      };
      items.set(key, it);
    }
    it.flagIds.push(f.id);
    if (!it.sources.includes(f.source)) it.sources.push(f.source);
    if (!it.categories.includes(f.category)) it.categories.push(f.category);
    if (f.reason && f.source !== "report" && !it.reasons.includes(f.reason)) it.reasons.push(f.reason);
    if (f.source === "report") it.reports++;
    it.severity = Math.max(it.severity, f.severity);
    it.strike ||= f.strike;
  }
  return {
    status,
    ai: { on: aiOn(env), model: aiModel(env) },
    stats: { open, stopped24h, autoMutes },
    items: [...items.values()],
    next: flags.length === limit ? offset + limit : null,
  };
}

/**
 * Staff decide a queue item. dismiss: no action, its strikes stop counting, and a message hidden by reports comes
 * back. remove: the message is removed (if it posted). mute / ban: remove, then mute for `hours` or ban.
 */
export async function chatDeskResolve(db: Db, input: { flagIds?: unknown; decision?: unknown; hours?: unknown }, actor: string) {
  const ids = Array.isArray(input.flagIds) ? input.flagIds.filter((x): x is string => typeof x === "string" && x.length <= 64).slice(0, 100) : [];
  if (!ids.length) throw new ChatError("bad_id", "Choose a flagged message.");
  const decision = String(input.decision);
  if (!["dismiss", "remove", "mute", "ban"].includes(decision)) throw new ChatError("bad_decision", "Choose what to do.");
  const flags = await db.siteChatFlag.findMany({ where: { id: { in: ids } } });
  if (!flags.length) throw new ChatError("gone", "Those flags are gone.", 404);
  const authors = [...new Set(flags.map((f) => f.customerId))];
  if (authors.length !== 1) throw new ChatError("mixed", "Decide one author at a time.");
  const customerId = authors[0];
  const messageIds = [...new Set(flags.map((f) => f.messageId).filter((x): x is string => !!x))];
  const now = new Date();
  let until: Date | null = null;
  if (decision === "mute") {
    const h = Number(input.hours);
    if (!(MUTE_HOURS as readonly number[]).includes(h)) throw new ChatError("bad_hours", "Choose how long to mute.");
    until = new Date(now.getTime() + h * 3_600_000);
  }
  if (decision === "ban") until = BAN_UNTIL;
  await db.$transaction(async (tx) => {
    // Every open flag on the same message(s) is decided together, plus the chosen ones.
    await tx.siteChatFlag.updateMany({
      where: { OR: [{ id: { in: flags.map((f) => f.id) } }, ...(messageIds.length ? [{ messageId: { in: messageIds }, status: "open" }] : [])] },
      data: { status: decision === "dismiss" ? "dismissed" : "actioned", reviewedAt: now, reviewedBy: actor },
    });
    if (decision === "dismiss") {
      if (messageIds.length) await tx.siteChatMessage.updateMany({ where: { id: { in: messageIds }, deletedBy: "auto:reports" }, data: { deletedAt: null, deletedBy: null } });
    } else if (messageIds.length) {
      await tx.siteChatMessage.updateMany({ where: { id: { in: messageIds }, OR: [{ deletedAt: null }, { deletedBy: { startsWith: "auto:" } }] }, data: { deletedAt: now, deletedBy: actor } });
    }
    if (until && !isStaffAuthor(customerId)) {
      await tx.siteChatMute.upsert({ where: { customerId }, create: { customerId, until, byEmail: actor, reason: decision === "ban" ? "ban" : "staff" }, update: { until, byEmail: actor, reason: decision === "ban" ? "ban" : "staff" } });
    }
  });
  return { ok: true, until: until?.toISOString() ?? null };
}

/** Bans a customer from chat (they can still read) by message id or customer id. Unban with op "unmute". */
export async function chatDeskBan(db: Db, input: { id?: unknown; customerId?: unknown }, actor: string) {
  let customerId: string | null = null;
  if (typeof input.customerId === "string" && input.customerId) {
    customerId = (await db.siteCustomer.findUnique({ where: { id: input.customerId.slice(0, 64) }, select: { id: true } }))?.id ?? null;
  } else {
    customerId = (await db.siteChatMessage.findUnique({ where: { id: messageId(input.id) }, select: { customerId: true } }))?.customerId ?? null;
  }
  if (!customerId) throw new ChatError("bad_id", "That message or customer is gone.", 404);
  if (isStaffAuthor(customerId)) throw new ChatError("staff", "Staff can't be banned.");
  await db.siteChatMute.upsert({ where: { customerId }, create: { customerId, until: BAN_UNTIL, byEmail: actor, reason: "ban" }, update: { until: BAN_UNTIL, byEmail: actor, reason: "ban" } });
  return { ok: true };
}

/** Staff try a message against the filter and the AI check without posting it (no strike, no record). */
export async function chatDeskCheck(raw: unknown, env: NodeJS.ProcessEnv = process.env, classify: Classifier = claudeClassify) {
  const body = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
  if (!body) throw new ChatError("empty", "Type a message to check.");
  const filter = filterMessage(body);
  if (filter) return { body, filter: { category: filter.category, message: filter.message, strike: filter.strike }, ai: null };
  if (!aiOn(env)) return { body, filter: null, ai: null, aiOff: true };
  const v = await classify({ body, room: "main", context: [] });
  return { body, filter: null, ai: v ?? { error: "The AI check didn't answer (it posts unchecked when that happens)." } };
}
