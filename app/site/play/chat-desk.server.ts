// Card Broker "Chat" tab ↔ cardbit.com live chat (Trevor 2026-11-26: finish live chat). Staff review every message
// (live and removed) with the author's email, remove or restore messages, mute and unmute authors, and post as
// "Cardbit Staff". Server-to-server only: routes/internal.site-chat.tsx checks the pairing secret, and Card Broker
// authenticates its own staff and sends their email as the actor (audit).
import type { Prisma, PrismaClient } from "@prisma/client";
import { ChatError, HISTORY, MUTE_HOURS, chatOn, cleanBody, isRoom } from "./chat.server";

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
    stats: { last24h, removed24h, chatters24h: chatters.length, activeMutes },
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
    mutes: rows.map((r) => ({ customerId: r.customerId, email: email.get(r.customerId) ?? null, until: r.until.toISOString(), by: r.byEmail, since: r.updatedAt.toISOString() })),
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
