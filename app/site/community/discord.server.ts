// Cardbit Discord community (standalone site only, CARDBIT_SITE=on).
//
// 1. Site rank roles through Discord Linked Roles. A customer links Discord at /discord/linked-role
//    (also the app's "Linked Roles Verification URL"), and we push their Cardbit level as role-connection
//    metadata. The server's rank roles (Rookie, Collector, Curator, Archivist, Vaultkeeper, Legend, Mythic)
//    each require "Cardbit Level ≥ N", the same thresholds as RANKS in app/lib/cardbit-levels.ts.
// 2. The opt-in live pulls feed. Customers who switch it on get their top-tier pulls posted to
//    #pulls-showcase through a channel webhook (DISCORD_PULLS_WEBHOOK_URL). Off by default; no card values.
//
// Env: DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET (the existing Cardbit app, shared with Discord sign-in),
// DISCORD_BOT_TOKEN (only to register the metadata schema, once, at boot), DISCORD_PULLS_WEBHOOK_URL,
// DISCORD_PULLS_TIERS (default "Legendary,Epic"). Kill switches: SITE_DISCORD_ROLES=off, SITE_DISCORD_PULLS=off.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { levelForXp, rankFor } from "../../lib/cardbit-levels";
import { activeTier, activeTiers } from "../play/subscriptions.server";
import { siteOrigin } from "../core/auth.server";
import { SITE_SHOP, alias } from "../rewards/rewards.server";

type Env = NodeJS.ProcessEnv;
const API = "https://discord.com/api/v10";
export const LINK_PATH = "/discord/linked-role";
export const CALLBACK_PATH = "/discord/linked-role/callback";
export const STATE_COOKIE = "cb_site_discord_role";
export const ROLE_SCOPES = "identify role_connections.write";

export class DiscordLinkError extends Error {}

export const rolesConfigured = (env: Env = process.env) =>
  Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) && env.SITE_DISCORD_ROLES !== "off";
export const pullsFeedConfigured = (env: Env = process.env) =>
  Boolean(env.DISCORD_PULLS_WEBHOOK_URL) && env.SITE_DISCORD_PULLS !== "off";
export const feedTiers = (env: Env = process.env) =>
  (env.DISCORD_PULLS_TIERS ?? "Legendary,Epic").split(",").map((s) => s.trim()).filter(Boolean);

/** The one metadata field the rank roles compare against. type 2 = INTEGER_GREATER_THAN_OR_EQUAL. */
export const ROLE_METADATA = [
  { key: "level", name: "Cardbit Level", description: "Collector level on cardbit.com", type: 2 },
  // Pack Pass role (Trevor, Nov 25): 0 none, 1 Plus, 2 Pro, 3 Ultimate. The "Pack Pass" role requires >= 1.
  { key: "pass_tier", name: "Pack Pass Tier", description: "1 Plus, 2 Pro, 3 Ultimate", type: 2 },
] as const;
const PASS_TIER_NUM: Record<string, number> = { plus: 1, pro: 2, ultimate: 3 };
async function passTierNum(db: PrismaClient, customerId: string, now = new Date()) {
  const t = await activeTier(db, customerId, now);
  return t ? PASS_TIER_NUM[t.id] ?? 0 : 0;
}

// ---- Token encryption (AES-256-GCM, key derived from the app's client secret) -----------------
// Rotating the client secret makes old tokens unreadable; those links simply ask the customer to link again.
const keyOf = (env: Env) => createHash("sha256").update(`cardbit-discord-tokens:${env.DISCORD_CLIENT_SECRET ?? ""}`).digest();
export function seal(plain: string, env: Env = process.env) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyOf(env), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}
export function unseal(sealed: string | null | undefined, env: Env = process.env) {
  if (!sealed) return null;
  try {
    const [v, iv, tag, body] = sealed.split(".");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", keyOf(env), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ---- OAuth (link Discord) -----------------------------------------------------------------------
export function linkStart(env: Env = process.env) {
  if (!rolesConfigured(env)) throw new DiscordLinkError("Discord linking isn't set up yet.");
  const state = randomBytes(16).toString("base64url");
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID!,
    redirect_uri: `${siteOrigin()}${CALLBACK_PATH}`,
    response_type: "code",
    scope: ROLE_SCOPES,
    state,
  }).toString();
  const prod = env.NODE_ENV === "production";
  const cookie = `${STATE_COOKIE}=${state}; Path=${LINK_PATH}; HttpOnly; SameSite=Lax; Max-Age=600${prod ? "; Secure" : ""}`;
  return { url: url.toString(), cookie, state };
}
export const clearStateCookie = (env: Env = process.env) =>
  `${STATE_COOKIE}=; Path=${LINK_PATH}; HttpOnly; SameSite=Lax; Max-Age=0${env.NODE_ENV === "production" ? "; Secure" : ""}`;

type TokenSet = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };

async function tokenRequest(body: Record<string, string>, fetcher: typeof fetch, env: Env) {
  const res = await fetcher("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID || "", client_secret: env.DISCORD_CLIENT_SECRET || "", ...body }),
  });
  if (!res.ok) return { ok: false as const, status: res.status };
  const t = (await res.json()) as TokenSet;
  if (!t.access_token) return { ok: false as const, status: 502 };
  return { ok: true as const, tokens: t };
}

const tokenData = (t: TokenSet, env: Env, now: Date) => ({
  accessToken: seal(t.access_token, env),
  refreshToken: t.refresh_token ? seal(t.refresh_token, env) : null,
  expiresAt: new Date(now.getTime() + Math.max(60, t.expires_in ?? 604800) * 1000),
});

/**
 * Finish the link: check state, trade the code, read the Discord user, save the link and push the level.
 * One Discord account links to one Cardbit account; linking a different Discord replaces the old link.
 */
export async function linkFinish(
  db: PrismaClient,
  customerId: string,
  params: URLSearchParams,
  savedState: string | null,
  fetcher: typeof fetch = fetch,
  env: Env = process.env,
  now = new Date(),
) {
  const state = params.get("state");
  if (!savedState || !state || state !== savedState) throw new DiscordLinkError("That link expired. Please try again.");
  if (params.get("error")) throw new DiscordLinkError("Discord linking was cancelled.");
  const code = params.get("code");
  if (!code) throw new DiscordLinkError("Discord linking was cancelled.");
  const failed = "Discord linking failed. Please try again.";
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: `${siteOrigin()}${CALLBACK_PATH}` }, fetcher, env);
  if (!t.ok) throw new DiscordLinkError(failed);
  if (t.tokens.scope && !t.tokens.scope.split(" ").includes("role_connections.write")) throw new DiscordLinkError(failed);
  const me = await fetcher(`${API}/users/@me`, { headers: { Authorization: `Bearer ${t.tokens.access_token}` } });
  if (!me.ok) throw new DiscordLinkError(failed);
  const u = (await me.json()) as { id?: string; username?: string; global_name?: string | null };
  if (!u.id || !/^\d{5,25}$/.test(u.id)) throw new DiscordLinkError(failed);

  const other = await db.siteDiscordLink.findUnique({ where: { discordUserId: u.id } });
  if (other && other.customerId !== customerId) throw new DiscordLinkError("That Discord account is already linked to another Cardbit account.");
  const data = { discordUserId: u.id, discordName: (u.global_name || u.username || "").slice(0, 64) || null, ...tokenData(t.tokens, env, now) };
  await db.siteDiscordLink.upsert({ where: { customerId }, create: { customerId, ...data }, update: { ...data, pushedLevel: null } });
  await pushLevel(db, customerId, fetcher, env, now);
  return { discordName: data.discordName };
}

/** A usable access token for the link, refreshing it when it is about to expire. Null = must link again. */
async function accessTokenFor(db: PrismaClient, customerId: string, fetcher: typeof fetch, env: Env, now: Date) {
  const link = await db.siteDiscordLink.findUnique({ where: { customerId } });
  if (!link?.accessToken) return null;
  const access = unseal(link.accessToken, env);
  if (access && link.expiresAt && link.expiresAt.getTime() > now.getTime() + 5 * 60_000) return access;
  const refresh = unseal(link.refreshToken, env);
  if (!refresh) return dropTokens(db, customerId);
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh }, fetcher, env);
  if (!t.ok) {
    if (t.status === 400 || t.status === 401) return dropTokens(db, customerId); // revoked or invalid grant
    throw new DiscordLinkError("Discord is unavailable right now.");
  }
  await db.siteDiscordLink.update({ where: { customerId }, data: tokenData(t.tokens, env, now) });
  return t.tokens.access_token;
}
async function dropTokens(db: PrismaClient, customerId: string) {
  await db.siteDiscordLink.update({ where: { customerId }, data: { accessToken: null, refreshToken: null, expiresAt: null } });
  return null;
}

export async function levelOf(db: PrismaClient, customerId: string) {
  const p = await db.cardbitProfile.findUnique({ where: { shop_customerId: { shop: SITE_SHOP, customerId } }, select: { xp: true } });
  return levelForXp(p?.xp ?? 0);
}

/** The role-connection body Discord stores for the customer (shown on their Discord profile). */
export const roleConnectionBody = (customerId: string, level: number, passTier = 0) => ({
  platform_name: "Cardbit",
  platform_username: `${alias(customerId)} · ${rankFor(level)}`,
  metadata: { level: String(level), pass_tier: String(passTier) },
});

/** Send the customer's current level to Discord. Returns the pushed level, or null when the link needs redoing. */
export async function pushLevel(db: PrismaClient, customerId: string, fetcher: typeof fetch = fetch, env: Env = process.env, now = new Date()) {
  const token = await accessTokenFor(db, customerId, fetcher, env, now);
  if (!token) return null;
  const [level, passTier] = await Promise.all([levelOf(db, customerId), passTierNum(db, customerId, now)]);
  const res = await fetcher(`${API}/users/@me/applications/${env.DISCORD_CLIENT_ID}/role-connection`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(roleConnectionBody(customerId, level, passTier)),
  });
  if (res.status === 401 || res.status === 403) return dropTokens(db, customerId);
  if (!res.ok) throw new DiscordLinkError("Discord is unavailable right now.");
  await db.siteDiscordLink.update({ where: { customerId }, data: { pushedLevel: level, pushedPassTier: passTier, pushedAt: now } });
  return level;
}

/** Unlink: clear the role connection (rank roles drop off), revoke the token and delete the link. */
export async function unlink(db: PrismaClient, customerId: string, fetcher: typeof fetch = fetch, env: Env = process.env) {
  const link = await db.siteDiscordLink.findUnique({ where: { customerId } });
  if (!link) return;
  const access = unseal(link.accessToken, env);
  if (access) {
    await fetcher(`${API}/users/@me/applications/${env.DISCORD_CLIENT_ID}/role-connection`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ platform_name: "Cardbit", metadata: {} }),
    }).catch(() => null);
    await fetcher("https://discord.com/api/oauth2/token/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID || "", client_secret: env.DISCORD_CLIENT_SECRET || "", token: access, token_type_hint: "access_token" }),
    }).catch(() => null);
  }
  await db.siteDiscordLink.delete({ where: { customerId } });
}

export async function setPullsFeed(db: PrismaClient, customerId: string, on: boolean, now = new Date()) {
  const link = await db.siteDiscordLink.findUnique({ where: { customerId } });
  if (!link) throw new DiscordLinkError("Link your Discord account first.");
  await db.siteDiscordLink.update({ where: { customerId }, data: { shareFeedAt: on ? link.shareFeedAt ?? now : null } });
}

export async function discordStatus(db: PrismaClient, customerId: string) {
  const link = await db.siteDiscordLink.findUnique({ where: { customerId } });
  const level = await levelOf(db, customerId);
  return {
    linked: Boolean(link),
    needsRelink: Boolean(link && !link.accessToken),
    discordName: link?.discordName ?? null,
    level,
    rank: rankFor(level),
    pushedLevel: link?.pushedLevel ?? null,
    sharePulls: Boolean(link?.shareFeedAt),
  };
}

// ---- Hourly level sync --------------------------------------------------------------------------
/** Push every linked customer whose level changed since the last push. Closed accounts are unlinked. */
export async function syncLevels(db: PrismaClient, fetcher: typeof fetch = fetch, env: Env = process.env, now = new Date()) {
  const links = await db.siteDiscordLink.findMany({ where: { accessToken: { not: null } }, select: { customerId: true, pushedLevel: true, pushedPassTier: true } });
  if (!links.length) return { pushed: 0, unlinked: 0 };
  const ids = links.map((l) => l.customerId);
  const [profiles, closed] = await Promise.all([
    db.cardbitProfile.findMany({ where: { shop: SITE_SHOP, customerId: { in: ids } }, select: { customerId: true, xp: true } }),
    db.siteCustomer.findMany({ where: { id: { in: ids }, closedAt: { not: null } }, select: { id: true } }),
  ]);
  const xp = new Map(profiles.map((p) => [p.customerId, p.xp]));
  const tiers = await activeTiers(db, ids, now);
  const closedIds = new Set(closed.map((c) => c.id));
  let pushed = 0, unlinked = 0;
  for (const l of links) {
    try {
      if (closedIds.has(l.customerId)) {
        await unlink(db, l.customerId, fetcher, env);
        unlinked++;
        continue;
      }
      const tierNow = PASS_TIER_NUM[tiers.get(l.customerId)?.id ?? ""] ?? 0;
      if (levelForXp(xp.get(l.customerId) ?? 0) === l.pushedLevel && tierNow === (l.pushedPassTier ?? 0)) continue;
      if ((await pushLevel(db, l.customerId, fetcher, env, now)) !== null) pushed++;
    } catch {
      // Discord hiccup or rate limit: try again next hour.
    }
    await new Promise((r) => setTimeout(r, 250)); // stay well under Discord's rate limits
  }
  return { pushed, unlinked };
}

/** Register the "Cardbit Level" metadata field on the app (idempotent PUT; needs the bot token). */
export async function registerRoleMetadata(fetcher: typeof fetch = fetch, env: Env = process.env) {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_CLIENT_ID) return false;
  const res = await fetcher(`${API}/applications/${env.DISCORD_CLIENT_ID}/role-connections/metadata`, {
    method: "PUT",
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(ROLE_METADATA),
  });
  if (!res.ok) console.error(`[site-discord] metadata registration returned HTTP ${res.status}`);
  return res.ok;
}

// ---- Live pulls feed ------------------------------------------------------------------------------
type FeedPull = { copyId: string; customerId: string; openingId: string; discordUserId: string; name: string; setName: string; tier: string; image: string | null; packTitle: string };

/** The webhook message for one pull. Mentions show the member's name without pinging them. No card values. */
export function pullMessage(p: FeedPull) {
  const embed: Record<string, unknown> = {
    title: p.name.slice(0, 240),
    description: `${p.setName} · ${p.tier} pull from ${p.packTitle}`.slice(0, 400),
    url: `${siteOrigin()}/packs`,
    color: p.tier === "Legendary" ? 0xffb65c : 0x00e6e1,
  };
  if (p.image && /^https:\/\//.test(p.image)) embed.image = { url: p.image };
  return {
    username: "Cardbit Pulls",
    content: `<@${p.discordUserId}> just pulled a **${p.tier}** card on cardbit.com!`,
    embeds: [embed],
    allowed_mentions: { parse: [] as string[] },
  };
}

/** Top-tier pulls revealed recently by opted-in customers that haven't been posted yet. */
export async function pendingFeedPulls(db: PrismaClient, env: Env = process.env, now = new Date()): Promise<FeedPull[]> {
  const links = await db.siteDiscordLink.findMany({ where: { shareFeedAt: { not: null } }, select: { customerId: true, discordUserId: true, shareFeedAt: true } });
  if (!links.length) return [];
  const since = new Date(now.getTime() - 60 * 60_000);
  const openings = await db.siteOpening.findMany({
    where: { customerId: { in: links.map((l) => l.customerId) }, revealedAt: { gte: since }, reversedAt: null, demo: false },
    select: { id: true, customerId: true, packId: true, revealedAt: true },
  });
  const optedAt = new Map(links.map((l) => [l.customerId, l]));
  const fresh = openings.filter((o) => o.revealedAt && o.revealedAt >= (optedAt.get(o.customerId)!.shareFeedAt as Date));
  if (!fresh.length) return [];
  const tiers = feedTiers(env);
  const [copies, packs] = await Promise.all([
    db.siteCopy.findMany({
      where: { openingId: { in: fresh.map((o) => o.id) }, pulledTier: { in: tiers }, demo: false },
      select: { id: true, openingId: true, name: true, setName: true, pulledTier: true, image: true },
    }),
    db.sitePack.findMany({ where: { id: { in: [...new Set(fresh.map((o) => o.packId))] } }, select: { id: true, title: true } }),
  ]);
  if (!copies.length) return [];
  const done = new Set((await db.siteDiscordPost.findMany({ where: { copyId: { in: copies.map((c) => c.id) } }, select: { copyId: true } })).map((r) => r.copyId));
  const byOpening = new Map(fresh.map((o) => [o.id, o]));
  const packTitle = new Map(packs.map((p) => [p.id, p.title]));
  return copies
    .filter((c) => !done.has(c.id))
    .map((c) => {
      const o = byOpening.get(c.openingId!)!;
      return {
        copyId: c.id, customerId: o.customerId, openingId: o.id, discordUserId: optedAt.get(o.customerId)!.discordUserId,
        name: c.name, setName: c.setName, tier: c.pulledTier!, image: c.image, packTitle: packTitle.get(o.packId) ?? "a Cardbit pack",
      };
    });
}

/** Post pending pulls (at most 10 a run). The claim row is written first, so a pull is never posted twice. */
export async function runPullsFeed(db: PrismaClient, fetcher: typeof fetch = fetch, env: Env = process.env, now = new Date()) {
  if (!pullsFeedConfigured(env)) return { posted: 0 };
  let posted = 0;
  for (const p of (await pendingFeedPulls(db, env, now)).slice(0, 10)) {
    try {
      await db.siteDiscordPost.create({ data: { copyId: p.copyId, customerId: p.customerId, openingId: p.openingId } });
    } catch {
      continue; // another run claimed it
    }
    const res = await fetcher(`${env.DISCORD_PULLS_WEBHOOK_URL}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pullMessage(p)),
    }).catch(() => null);
    await db.siteDiscordPost.update({
      where: { copyId: p.copyId },
      data: res?.ok ? { postedAt: now } : { error: res ? `HTTP ${res.status}` : "network error" },
    });
    if (res?.ok) posted++;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { posted };
}

// ---- Clocks -------------------------------------------------------------------------------------
let roleTimer: NodeJS.Timeout | null = null;
let feedTimer: NodeJS.Timeout | null = null;
let roleRunning = false, feedRunning = false;

export function startDiscordClocks(db: PrismaClient) {
  if (process.env.CARDBIT_SITE !== "on" || process.env.NODE_ENV !== "production") return;
  if (!roleTimer && rolesConfigured()) {
    void registerRoleMetadata().catch(() => console.error("[site-discord] metadata registration failed"));
    const tick = () => {
      if (roleRunning) return;
      roleRunning = true;
      void syncLevels(db)
        .catch((e) => console.error("[site-discord] level sync failed", (e as Error).message))
        .finally(() => (roleRunning = false));
    };
    roleTimer = setInterval(tick, 60 * 60_000);
    roleTimer.unref();
  }
  if (!feedTimer && pullsFeedConfigured()) {
    const tick = () => {
      if (feedRunning) return;
      feedRunning = true;
      void runPullsFeed(db)
        .catch((e) => console.error("[site-discord] pulls feed failed", (e as Error).message))
        .finally(() => (feedRunning = false));
    };
    feedTimer = setInterval(tick, 2 * 60_000);
    feedTimer.unref();
  }
}
