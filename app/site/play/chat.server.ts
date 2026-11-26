// Cardbit site live chat. Two rooms: "main" for every signed-in 18+ account and "club" for Cardbit
// Club members. Off unless SITE_CHAT=on. Clients poll GET /api/chat while the panel is open.
//
// Safety rules (kept server-side so the UI can't skip them):
// - Signed in, 18+ confirmed, not frozen/closed, not on a cool-off or self-exclusion (a break hides chat).
// - Plain text, 1-280 characters, through the instant filter (chat-filter.server.ts: slurs, threats, links, contact
//   details, payment apps and "DM me", spam, caps), then the AI check (chat-moderation.server.ts) when it's on.
// - One message every 3 seconds, at most 10 a minute, no repeating the same message within a minute.
// - Strikes from the filter and AI check auto-mute repeat offenders; readers can report messages.
// - Staff (SITE_STAFF_EMAILS) can delete any message and mute an author; muted accounts can read only.
// Customer ids are never sent to the browser: staff act on a message id and the server finds the author.
import type { PrismaClient } from "@prisma/client";
import { AVATAR_COLORS, defaultColor, levelForXp } from "../../lib/cardbit-levels";
import { ageConfirmed } from "../../lib/cardbit-age.server";
import { PlayPaused, assertNotPaused } from "./limits.server";
import { activeTier } from "./subscriptions.server";
import { SITE_SHOP, alias } from "../rewards/rewards.server";
import { staffEmails } from "../shipping/staff.server";
import { PLAN } from "./plan-brand";
import { type FilterHit, filterMessage } from "./chat-filter.server";
import { type Classifier, aiOn, claudeClassify, recordAiHide, recordAiReview, recordFilterBlock } from "./chat-moderation.server";

type Db = PrismaClient;
export const ROOMS = ["main", "club"] as const;
export type Room = (typeof ROOMS)[number];
export const isRoom = (r: unknown): r is Room => typeof r === "string" && (ROOMS as readonly string[]).includes(r);
export const MAX_LEN = 280;
export const HISTORY = 50;
const GAP_MS = 3_000;
const PER_MINUTE = 10;
export const MUTE_HOURS = [1, 24, 168, 720] as const;

export const chatOn = (env: NodeJS.ProcessEnv = process.env) => env.SITE_CHAT === "on";

// Who's here: readers seen polling in the last minute, per room. In memory (one app-site instance);
// it only drives the "N online" counts, so a restart just resets them.
const ONLINE_MS = 60_000;
const seen = new Map<string, { room: Room; at: number }>();
export function markSeen(customerId: string, room: Room, now = Date.now()) {
  seen.set(customerId, { room, at: now });
  if (seen.size > 5_000) for (const [k, v] of seen) if (now - v.at > ONLINE_MS) seen.delete(k);
}
export function onlineCounts(now = Date.now()) {
  let main = 0, club = 0;
  for (const [k, v] of seen) {
    if (now - v.at > ONLINE_MS) { seen.delete(k); continue; }
    main++;
    if (v.room === "club") club++;
  }
  return { main, club };
}

export class ChatError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly hit?: FilterHit,
  ) {
    super(message);
  }
}

/** Normalizes a message, or throws ChatError with a customer-facing reason. */
export function cleanBody(raw: unknown): string {
  const body = String(raw ?? "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!body) throw new ChatError("empty", "Type a message.");
  if ([...body].length > MAX_LEN) throw new ChatError("too_long", `Keep messages under ${MAX_LEN} characters.`);
  const hit = filterMessage(body);
  if (hit) throw new ChatError(hit.category, hit.message, 400, hit);
  return body;
}

export type Viewer = { id: string; email: string | null; frozenAt: Date | null; closedAt?: Date | null };

export const isStaff = (v: Viewer | null, env: NodeJS.ProcessEnv = process.env) =>
  Boolean(v?.email && staffEmails(env).has(v.email.trim().toLowerCase()));

/** What the viewer may do. Reading needs a signed-in 18+ account that isn't on a break. */
export async function chatAccess(db: Db, v: Viewer | null, env: NodeJS.ProcessEnv = process.env) {
  if (!v) return { canRead: false as const, reason: "sign_in" as const };
  if (v.frozenAt || v.closedAt) return { canRead: false as const, reason: "on_hold" as const };
  try {
    await assertNotPaused(db, v.id);
  } catch (e) {
    if (e instanceof PlayPaused) return { canRead: false as const, reason: "paused" as const };
    throw e;
  }
  if (!(await ageConfirmed(db, SITE_SHOP, v.id))) return { canRead: false as const, reason: "age" as const };
  const staff = isStaff(v, env);
  const [tier, mute] = await Promise.all([activeTier(db, v.id), db.siteChatMute.findUnique({ where: { customerId: v.id } })]);
  const mutedUntil = mute && mute.until > new Date() ? mute.until : null;
  return { canRead: true as const, staff, club: Boolean(tier) || staff, tier: tier?.id ?? null, mutedUntil };
}

type Access = Awaited<ReturnType<typeof chatAccess>>;
const roomAllowed = (a: Access, room: Room) => a.canRead && (room === "main" || ("club" in a && a.club));

export async function listMessages(db: Db, access: Access, room: Room, viewerId?: string) {
  if (!roomAllowed(access, room)) return [];
  const staff = "staff" in access && access.staff;
  const rows = await db.siteChatMessage.findMany({
    where: { room, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: HISTORY,
    select: { id: true, customerId: true, name: true, iconId: true, iconColor: true, badge: true, level: true, body: true, replyToId: true, replyName: true, replyBody: true, createdAt: true },
  });
  // A quote of a message staff removed shows as removed, never the removed text.
  const quoted = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => !!x))];
  const live = new Set(
    quoted.length ? (await db.siteChatMessage.findMany({ where: { id: { in: quoted }, deletedAt: null }, select: { id: true } })).map((r) => r.id) : [],
  );
  return rows.reverse().map(({ customerId, iconColor, replyToId, replyName, replyBody, ...r }) => {
    const c = AVATAR_COLORS.find((x) => x.id === iconColor) ?? AVATAR_COLORS[0];
    const reply = replyToId ? (live.has(replyToId) ? { id: replyToId, name: replyName, body: replyBody } : { id: replyToId, name: null, body: null, removed: true }) : null;
    return { ...r, reply, bg: c.bg, fg: c.fg, createdAt: r.createdAt.toISOString(), canModerate: staff, mine: !!viewerId && customerId === viewerId };
  });
}

const recentFor = (db: Pick<Db, "siteChatMessage">, customerId: string, now: number) =>
  db.siteChatMessage.findMany({
    where: { customerId, createdAt: { gte: new Date(now - 60_000) } },
    orderBy: { createdAt: "desc" },
    select: { body: true, createdAt: true },
  });
function assertPace(recent: { body: string; createdAt: Date }[], body: string, now: number) {
  if (recent[0] && now - recent[0].createdAt.getTime() < GAP_MS) throw new ChatError("slow_down", "Slow down a little.", 429);
  if (recent.length >= PER_MINUTE) throw new ChatError("slow_down", "You're sending messages too fast. Try again in a minute.", 429);
  if (recent.some((r) => r.body.toLowerCase() === body.toLowerCase())) throw new ChatError("repeat", "You just sent that.", 429);
}
const mutedNote = (until: Date | null) => (until ? " You're muted in chat for now." : "");

export async function sendMessage(
  db: Db,
  v: Viewer,
  room: Room,
  raw: unknown,
  env: NodeJS.ProcessEnv = process.env,
  replyTo?: unknown,
  classify: Classifier = claudeClassify,
) {
  const access = await chatAccess(db, v, env);
  if (!access.canRead) throw new ChatError(access.reason, "You can't use chat right now.", 403);
  if (!roomAllowed(access, room)) throw new ChatError("club_only", `The ${PLAN.short} room is for ${PLAN.name} members.`, 403);
  if (access.mutedUntil) throw new ChatError("muted", "You're muted in chat for now.", 403);
  let body: string;
  try {
    body = cleanBody(raw);
  } catch (e) {
    if (e instanceof ChatError && e.hit?.strike && !access.staff) {
      const until = await recordFilterBlock(db, v.id, room, String(raw ?? "").slice(0, 1000), e.hit);
      throw new ChatError(e.code, e.message + mutedNote(until), 400);
    }
    throw e;
  }
  // Cheap pace check first so spam never reaches the AI check; repeated inside the locked transaction below.
  assertPace(await recentFor(db, v.id, Date.now()), body, Date.now());
  const target = typeof replyTo === "string" && replyTo
    ? await db.siteChatMessage.findFirst({ where: { id: replyTo, room, deletedAt: null }, select: { id: true, name: true, body: true } })
    : null;
  if (replyTo && !target) throw new ChatError("reply_gone", "That message is gone.", 404);

  const verdict = access.staff || !aiOn(env)
    ? null
    : await classify({
        body,
        room,
        replyTo: target ? { name: target.name, body: target.body } : null,
        context: (await db.siteChatMessage.findMany({ where: { room, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 4, select: { name: true, body: true } })).reverse(),
      });
  if (verdict?.action === "hide") {
    const until = await recordAiHide(db, v.id, room, body, verdict);
    throw new ChatError("held", "That message wasn't posted because it breaks the chat rules." + mutedNote(until), 422);
  }

  const created = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"site-chat:" + v.id}, 0))`;
    const now = Date.now();
    assertPace(await recentFor(tx, v.id, now), body, now);
    const profile = await tx.cardbitProfile.findUnique({ where: { shop_customerId: { shop: SITE_SHOP, customerId: v.id } } });
    const iconId = profile?.iconId && (!profile.iconId.endsWith("-club") || access.tier) ? profile.iconId : null;
    return tx.siteChatMessage.create({
      data: {
        room,
        customerId: v.id,
        name: access.staff ? "Cardbit Staff" : alias(v.id),
        iconId,
        iconColor: profile?.iconColor ?? defaultColor(v.id),
        badge: access.staff ? "staff" : access.tier,
        level: access.staff ? null : levelForXp(profile?.xp ?? 0),
        body,
        ...(target ? { replyToId: target.id, replyName: target.name, replyBody: [...target.body].slice(0, 90).join("") } : {}),
      },
      select: { id: true },
    });
  });
  if (verdict?.action === "review") await recordAiReview(db, v.id, room, created.id, body, verdict);
  return created;
}

export async function deleteMessage(db: Db, staff: Viewer, id: unknown, env: NodeJS.ProcessEnv = process.env) {
  if (!isStaff(staff, env)) throw new ChatError("forbidden", "Staff only.", 403);
  if (typeof id !== "string") throw new ChatError("bad_id", "Choose a message.");
  const { count } = await db.siteChatMessage.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), deletedBy: staff.email } });
  return count === 1;
}

/** Mutes the author of a message and removes their messages from the last hour. */
export async function muteAuthor(db: Db, staff: Viewer, id: unknown, hours: unknown, env: NodeJS.ProcessEnv = process.env) {
  if (!isStaff(staff, env)) throw new ChatError("forbidden", "Staff only.", 403);
  const h = Number(hours);
  if (!(MUTE_HOURS as readonly number[]).includes(h)) throw new ChatError("bad_hours", "Choose how long to mute.");
  const msg = typeof id === "string" ? await db.siteChatMessage.findUnique({ where: { id }, select: { customerId: true } }) : null;
  if (!msg) throw new ChatError("bad_id", "That message is gone.", 404);
  if (msg.customerId === staff.id) throw new ChatError("self", "You can't mute yourself.");
  if (msg.customerId.startsWith("staff:")) throw new ChatError("staff", "Staff messages can't be muted.");
  const until = new Date(Date.now() + h * 3_600_000);
  await db.siteChatMute.upsert({
    where: { customerId: msg.customerId },
    create: { customerId: msg.customerId, until, byEmail: staff.email!, reason: "staff" },
    update: { until, byEmail: staff.email! },
  });
  await db.siteChatMessage.updateMany({
    where: { customerId: msg.customerId, deletedAt: null, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
    data: { deletedAt: new Date(), deletedBy: staff.email },
  });
  return until;
}
