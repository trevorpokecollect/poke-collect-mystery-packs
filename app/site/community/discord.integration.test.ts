import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { xpForLevel } from "../../lib/cardbit-levels";
import { SITE_SHOP } from "../rewards/rewards.server";
import {
  DiscordLinkError,
  discordStatus,
  linkFinish,
  linkStart,
  pendingFeedPulls,
  pullMessage,
  pushLevel,
  registerRoleMetadata,
  roleConnectionBody,
  runPullsFeed,
  seal,
  setPullsFeed,
  syncLevels,
  unlink,
  unseal,
} from "./discord.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const env = {
  DISCORD_CLIENT_ID: "1575003923188551760",
  DISCORD_CLIENT_SECRET: "test-secret",
  DISCORD_PULLS_WEBHOOK_URL: "https://discord.com/api/webhooks/1/abc",
  NODE_ENV: "test",
} as NodeJS.ProcessEnv;

type Call = { url: string; init?: RequestInit };
function fakeDiscord(opts: { userId?: string; tokenStatus?: number; putStatus?: number; refreshStatus?: number } = {}) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    calls.push({ url: u, init });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (u === "https://discord.com/api/oauth2/token") {
      const grant = new URLSearchParams(String(init?.body)).get("grant_type");
      const status = grant === "refresh_token" ? opts.refreshStatus ?? 200 : opts.tokenStatus ?? 200;
      if (status !== 200) return json({ error: "invalid_grant" }, status);
      return json({ access_token: `at-${grant}`, refresh_token: `rt-${grant}`, expires_in: 604800, scope: "identify role_connections.write" });
    }
    if (u.endsWith("/users/@me")) return json({ id: opts.userId ?? "111122223333444455", username: "latchfan", global_name: "Latch Fan" });
    if (u.includes("/role-connection")) return json({}, opts.putStatus ?? 200);
    if (u.includes("/oauth2/token/revoke")) return json({});
    if (u.includes("/role-connections/metadata")) return json([]);
    if (u.startsWith("https://discord.com/api/webhooks/")) return json({ id: "m1" });
    return json({}, 404);
  }) as typeof fetch;
  return { fetcher, calls };
}

const wipe = async () => {
  await db.siteDiscordPost.deleteMany();
  await db.siteDiscordLink.deleteMany();
  await db.siteCopy.deleteMany({ where: { receiptKey: { startsWith: "dsc:" } } });
  await db.siteOpening.deleteMany({ where: { packId: "dsc-pack" } });
  await db.sitePack.deleteMany({ where: { id: "dsc-pack" } });
  await db.cardbitProfile.deleteMany({ where: { shop: SITE_SHOP } });
  await db.siteCustomer.deleteMany({ where: { email: { endsWith: "@discord.test" } } });
};
const customer = (n: string) => db.siteCustomer.create({ data: { email: `${n}@discord.test` } });
const setLevel = (customerId: string, level: number) =>
  db.cardbitProfile.upsert({
    where: { shop_customerId: { shop: SITE_SHOP, customerId } },
    create: { shop: SITE_SHOP, customerId, xp: xpForLevel(level) },
    update: { xp: xpForLevel(level) },
  });
async function linked(n: string, userId = String(100000000000000000n + BigInt(n.length * 7919 + n.charCodeAt(0)))) {
  const c = await customer(n);
  const { fetcher } = fakeDiscord({ userId });
  await linkFinish(db, c.id, new URLSearchParams({ state: "s", code: "c" }), "s", fetcher, env);
  return c;
}

describe.skipIf(!url)("Discord linked roles and pulls feed", () => {
  beforeEach(wipe);
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it("seals tokens and refuses tampered ones", () => {
    const s = seal("secret-token", env);
    expect(s).not.toContain("secret-token");
    expect(unseal(s, env)).toBe("secret-token");
    expect(unseal(s.slice(0, -2) + "xx", env)).toBeNull();
    expect(unseal(s, { ...env, DISCORD_CLIENT_SECRET: "rotated" })).toBeNull();
  });

  it("starts linking with only the role scopes and a state cookie", () => {
    const { url: to, cookie, state } = linkStart(env);
    const u = new URL(to);
    expect(u.searchParams.get("scope")).toBe("identify role_connections.write");
    expect(u.searchParams.get("redirect_uri")).toMatch(/\/discord\/linked-role\/callback$/);
    expect(cookie).toContain(state);
    expect(() => linkStart({ ...env, SITE_DISCORD_ROLES: "off" })).toThrow(DiscordLinkError);
  });

  it("links, pushes the level and rejects a bad state or a Discord already linked elsewhere", async () => {
    const c = await customer("a");
    await setLevel(c.id, 12);
    const { fetcher, calls } = fakeDiscord();
    await expect(linkFinish(db, c.id, new URLSearchParams({ state: "x", code: "c" }), "s", fetcher, env)).rejects.toThrow("expired");
    await linkFinish(db, c.id, new URLSearchParams({ state: "s", code: "c" }), "s", fetcher, env);
    const put = calls.find((x) => x.url.endsWith(`/users/@me/applications/${env.DISCORD_CLIENT_ID}/role-connection`))!;
    expect(JSON.parse(String(put.init!.body))).toEqual(roleConnectionBody(c.id, 12));
    expect(JSON.parse(String(put.init!.body)).metadata).toEqual({ level: "12", pass_tier: "0" });
    const row = await db.siteDiscordLink.findUniqueOrThrow({ where: { customerId: c.id } });
    expect(row.accessToken).not.toContain("at-");
    expect(row.pushedLevel).toBe(12);
    expect(row.shareFeedAt).toBeNull(); // feed is opt-in
    const s = await discordStatus(db, c.id);
    expect(s).toMatchObject({ linked: true, discordName: "Latch Fan", rank: "Curator", sharePulls: false });

    const other = await customer("b");
    await expect(linkFinish(db, other.id, new URLSearchParams({ state: "s", code: "c" }), "s", fetcher, env)).rejects.toThrow("already linked");
  });

  it("syncs only changed levels, refreshes expired tokens and drops revoked links", async () => {
    const c = await linked("sync");
    expect((await syncLevels(db, fakeDiscord().fetcher, env)).pushed).toBe(0); // level 1 already pushed
    await setLevel(c.id, 30);
    const { fetcher, calls } = fakeDiscord();
    await db.siteDiscordLink.update({ where: { customerId: c.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await syncLevels(db, fetcher, env)).pushed).toBe(1);
    expect(calls.some((x) => new URLSearchParams(String(x.init?.body ?? "")).get("grant_type") === "refresh_token")).toBe(true);
    expect((await db.siteDiscordLink.findUniqueOrThrow({ where: { customerId: c.id } })).pushedLevel).toBe(30);

    await setLevel(c.id, 40);
    expect(await pushLevel(db, c.id, fakeDiscord({ putStatus: 401 }).fetcher, env)).toBeNull();
    expect((await discordStatus(db, c.id)).needsRelink).toBe(true);
  });

  it("unlinks closed accounts during sync and on request", async () => {
    const c = await linked("closed");
    await db.siteCustomer.update({ where: { id: c.id }, data: { closedAt: new Date() } });
    const { fetcher, calls } = fakeDiscord();
    expect((await syncLevels(db, fetcher, env)).unlinked).toBe(1);
    expect(calls.some((x) => x.url.includes("/oauth2/token/revoke"))).toBe(true);
    expect(await db.siteDiscordLink.findUnique({ where: { customerId: c.id } })).toBeNull();

    const d = await linked("unlink-me");
    await unlink(db, d.id, fakeDiscord().fetcher, env);
    expect(await db.siteDiscordLink.findUnique({ where: { customerId: d.id } })).toBeNull();
  });

  it("registers the level metadata only with a bot token", async () => {
    const { fetcher, calls } = fakeDiscord();
    expect(await registerRoleMetadata(fetcher, env)).toBe(false);
    expect(await registerRoleMetadata(fetcher, { ...env, DISCORD_BOT_TOKEN: "bot" })).toBe(true);
    const body = JSON.parse(String(calls[0].init!.body));
    expect(body).toEqual([{ key: "level", name: "Cardbit Level", description: "Collector level on cardbit.com", type: 2 }, { key: "pass_tier", name: "Pack Pass Tier", description: "1 Plus, 2 Pro, 3 Ultimate", type: 2 }]);
  });

  it("posts only opted-in, top-tier, post-opt-in pulls, once, with no values and no pings", async () => {
    const c = await linked("feed", "222233334444555566");
    const quiet = await linked("quiet", "333344445555666677");
    await db.sitePack.create({ data: { id: "dsc-pack", title: "Gold Pack", priceBits: 3899 } });
    const t0 = new Date(Date.now() - 10 * 60_000);
    const open = async (customerId: string, at: Date, tiers: string[], extra: { demo?: boolean } = {}) => {
      const o = await db.siteOpening.create({ data: { customerId, packId: "dsc-pack", priceBits: 3899, revealedAt: at, ...extra } });
      for (const [i, tier] of tiers.entries())
        await db.siteCopy.create({
          data: {
            receiptKey: `dsc:${o.id}:${i}`, printingKey: `p${i}`, title: "t", game: "pokemon", setName: "Obsidian Flames", number: `${i}`,
            name: `Card ${tier} ${i}`, finish: "Holofoil", language: "English", condition: "Near Mint", lookKey: `${o.id}${i}`, faceKey: `${o.id}${i}`,
            status: "VAULTED", ownerId: customerId, openingId: o.id, pulledTier: tier, image: "https://tcgplayer-cdn.tcgplayer.com/x.jpg",
          },
        });
      return o;
    };
    await open(c.id, t0, ["Legendary"]); // before opt-in: never posted
    await setPullsFeed(db, c.id, true);
    const now = new Date(Date.now() + 1000);
    await open(c.id, now, ["Legendary", "Common", "Epic"]);
    await open(c.id, now, ["Legendary"], { demo: true });
    await open(quiet.id, now, ["Legendary"]); // not opted in

    const pending = await pendingFeedPulls(db, env, new Date(now.getTime() + 1000));
    expect(pending.map((p) => p.tier).sort()).toEqual(["Epic", "Legendary"]);

    const { fetcher, calls } = fakeDiscord();
    expect((await runPullsFeed(db, fetcher, env, new Date(now.getTime() + 1000))).posted).toBe(2);
    const msg = JSON.parse(String(calls.find((x) => x.url.startsWith(env.DISCORD_PULLS_WEBHOOK_URL!))!.init!.body));
    expect(msg.content).toContain("<@222233334444555566>");
    expect(msg.allowed_mentions).toEqual({ parse: [] });
    expect(JSON.stringify(msg)).not.toMatch(/\$|Cardbits|value/i);
    expect(msg.embeds[0].description).toContain("Gold Pack");

    expect((await runPullsFeed(db, fakeDiscord().fetcher, env, new Date(now.getTime() + 2000))).posted).toBe(0); // never twice
    await setPullsFeed(db, c.id, false);
    expect((await discordStatus(db, c.id)).sharePulls).toBe(false);
    expect(await runPullsFeed(db, fetcher, { ...env, DISCORD_PULLS_WEBHOOK_URL: "" })).toEqual({ posted: 0 });
  });

  it("formats a pull without an image when the image isn't https", () => {
    const m = pullMessage({ copyId: "c", customerId: "x", openingId: "o", discordUserId: "1", name: "Mew", setName: "151", tier: "Epic", image: "http://x", packTitle: "Mystery" });
    expect(m.embeds[0]).not.toHaveProperty("image");
  });
});
