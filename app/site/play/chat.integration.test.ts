import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { confirmAge } from "../../lib/cardbit-age.server";
import { SITE_SHOP } from "../rewards/rewards.server";
import { startCoolOff } from "./limits.server";
import { startSubscription, creditSubscriptionPayment } from "./subscriptions.server";
import { ChatError, chatAccess, cleanBody, deleteMessage, listMessages, markSeen, muteAuthor, onlineCounts, sendMessage } from "./chat.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const env = { SITE_STAFF_EMAILS: "staff@chat.test" } as NodeJS.ProcessEnv;

describe("chat message rules", () => {
  it("cleans text and blocks links and contact details", () => {
    expect(cleanBody("  hi   there ​ ")).toBe("hi there");
    for (const bad of ["see https://x.io", "www.example.org", "join discord.gg/abc", "buy at cards.shop", "me@mail.com", "call 256-555-0100", "", "x".repeat(281)])
      expect(() => cleanBody(bad), bad).toThrow(ChatError);
    expect(cleanBody("Pulled a Charizard ex 199/165!")).toBe("Pulled a Charizard ex 199/165!");
  });
});

describe("chat online counts", () => {
  it("counts readers seen in the last minute, per room", () => {
    const t = 1_000_000_000_000;
    markSeen("on-1", "main", t);
    markSeen("on-2", "club", t);
    markSeen("on-3", "main", t - 61_000);
    expect(onlineCounts(t)).toMatchObject({ main: 2, club: 1 });
    expect(onlineCounts(t + 61_000)).toMatchObject({ main: 0, club: 0 });
  });
});

describe.skipIf(!url)("live chat", () => {
  let a: { id: string; email: string; frozenAt: Date | null };
  let b: typeof a;
  let staff: typeof a;
  const wipe = async () => {
    const ids = (await db.siteCustomer.findMany({ where: { email: { endsWith: "@chat.test" } }, select: { id: true } })).map((c) => c.id);
    await db.siteChatMessage.deleteMany({ where: { customerId: { in: ids } } });
    await db.siteChatMute.deleteMany({ where: { customerId: { in: ids } } });
    await db.siteChatFlag.deleteMany({ where: { customerId: { in: ids } } });
    await db.sitePlayEvent.deleteMany({ where: { customerId: { in: ids } } });
    await db.sitePlayControl.deleteMany({ where: { customerId: { in: ids } } });
    await db.siteSubscriptionPayment.deleteMany({ where: { customerId: { in: ids } } });
    await db.siteSubscription.deleteMany({ where: { customerId: { in: ids } } });
    await db.siteLedger.deleteMany({ where: { customerId: { in: ids } } });
    await db.siteWallet.deleteMany({ where: { customerId: { in: ids } } });
    await db.cardbitAgeConfirmation.deleteMany({ where: { shop: SITE_SHOP, customerId: { in: ids } } });
    await db.cardbitProfile.deleteMany({ where: { shop: SITE_SHOP, customerId: { in: ids } } });
    await db.siteCustomer.deleteMany({ where: { id: { in: ids } } });
  };
  const make = async (email: string) => {
    const c = await db.siteCustomer.create({ data: { email } });
    await confirmAge(db, SITE_SHOP, c.id, "prompt");
    return { id: c.id, email, frozenAt: null };
  };
  const prevSubs = process.env.SITE_SUBSCRIPTIONS;
  beforeAll(() => {
    process.env.SITE_SUBSCRIPTIONS = "on";
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(async () => {
    await wipe();
    a = await make("a@chat.test");
    b = await make("b@chat.test");
    staff = await make("staff@chat.test");
  });
  afterAll(async () => {
    await wipe();
    process.env.SITE_SUBSCRIPTIONS = prevSubs;
    await db.$disconnect();
  });

  it("posts to the main room with rate limits and hides customer ids", async () => {
    await sendMessage(db, a, "main", "hello", env);
    await expect(sendMessage(db, a, "main", "again", env)).rejects.toMatchObject({ code: "slow_down" });
    await db.siteChatMessage.updateMany({ where: { customerId: a.id }, data: { createdAt: new Date(Date.now() - 10_000) } });
    await expect(sendMessage(db, a, "main", "HELLO", env)).rejects.toMatchObject({ code: "repeat" });
    const msgs = await listMessages(db, await chatAccess(db, b, env), "main");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ body: "hello", badge: null, canModerate: false });
    expect(JSON.stringify(msgs)).not.toContain(a.id);
  });

  it("keeps the Club room for members and badges them", async () => {
    await expect(sendMessage(db, a, "club", "hi club", env)).rejects.toMatchObject({ code: "club_only" });
    expect(await listMessages(db, await chatAccess(db, a, env), "club")).toEqual([]);
    await startSubscription(db, { customerId: a.id, tier: "pro", provider: "coinflow", providerRef: "chat_sub" });
    await creditSubscriptionPayment(db, { providerRef: "chat_sub", paymentId: "chat_pay", cents: 4999 });
    await sendMessage(db, a, "club", "hi club", env);
    const msgs = await listMessages(db, await chatAccess(db, staff, env), "club");
    expect(msgs[0]).toMatchObject({ badge: "pro", canModerate: true });
  });

  it("lets staff delete and mute; muted and paused accounts can't post", async () => {
    await sendMessage(db, a, "main", "rude", env);
    const id = (await db.siteChatMessage.findFirstOrThrow({ where: { customerId: a.id } })).id;
    await expect(deleteMessage(db, b, id, env)).rejects.toMatchObject({ code: "forbidden" });
    await muteAuthor(db, staff, id, 24, env);
    expect(await listMessages(db, await chatAccess(db, b, env), "main")).toEqual([]);
    await db.siteChatMessage.updateMany({ where: { customerId: a.id }, data: { createdAt: new Date(Date.now() - 10_000) } });
    await expect(sendMessage(db, a, "main", "sorry", env)).rejects.toMatchObject({ code: "muted" });
    await startCoolOff(db, b.id, 24);
    expect(await chatAccess(db, b, env)).toMatchObject({ canRead: false, reason: "paused" });
    await sendMessage(db, staff, "main", "Be kind, everyone.", env);
    expect((await listMessages(db, await chatAccess(db, staff, env), "main"))[0]).toMatchObject({ name: "Cardbit Staff", badge: "staff" });
  });

  it("quotes replies, stamps levels, and hides a quote once staff remove the original", async () => {
    await db.cardbitProfile.create({ data: { shop: SITE_SHOP, customerId: a.id, xp: 5000 } });
    await sendMessage(db, a, "main", "Pulled a Snorlax!", env);
    const [orig] = await listMessages(db, await chatAccess(db, b, env), "main");
    expect(orig.level).toBeGreaterThan(1);
    expect(orig.reply).toBeNull();
    await sendMessage(db, b, "main", "Nice one", env, orig.id);
    let rows = await listMessages(db, await chatAccess(db, b, env), "main");
    expect(rows[1]).toMatchObject({ body: "Nice one", level: 1, reply: { id: orig.id, name: orig.name, body: "Pulled a Snorlax!" } });
    await expect(sendMessage(db, b, "club", "x", env, orig.id)).rejects.toThrow(ChatError);
    await deleteMessage(db, staff, orig.id, env);
    rows = await listMessages(db, await chatAccess(db, b, env), "main");
    expect(rows).toHaveLength(1);
    expect(rows[0].reply).toMatchObject({ removed: true, body: null });
    await expect(new Promise((r) => setTimeout(r, 3100)).then(() => sendMessage(db, b, "main", "again", env, orig.id))).rejects.toMatchObject({ code: "reply_gone" });
  });
});
