import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { confirmAge } from "../../lib/cardbit-age.server";
import { SITE_SHOP } from "../rewards/rewards.server";
import { chatAccess, listMessages, sendMessage } from "./chat.server";
import { chatDeskList, chatDeskMute, chatDeskMutes, chatDeskPost, chatDeskRemove, chatDeskRestore, chatDeskUnmute } from "./chat-desk.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });
const env = { SITE_STAFF_EMAILS: "", SITE_CHAT: "on" } as NodeJS.ProcessEnv;
const actor = "cardbroker:mod@cardbit.test";

describe.skipIf(!url)("Card Broker chat desk", () => {
  let a: { id: string; email: string; frozenAt: Date | null };
  let b: typeof a;
  const wipe = async () => {
    const ids = (await db.siteCustomer.findMany({ where: { email: { endsWith: "@desk.test" } }, select: { id: true } })).map((c) => c.id);
    await db.siteChatMessage.deleteMany({ where: { OR: [{ customerId: { in: ids } }, { customerId: { startsWith: "staff:mod@cardbit.test" } }] } });
    await db.siteChatMute.deleteMany({ where: { customerId: { in: ids } } });
    await db.siteChatFlag.deleteMany({ where: { customerId: { in: ids } } });
    await db.cardbitAgeConfirmation.deleteMany({ where: { shop: SITE_SHOP, customerId: { in: ids } } });
    await db.siteCustomer.deleteMany({ where: { id: { in: ids } } });
  };
  const make = async (email: string) => {
    const c = await db.siteCustomer.create({ data: { email } });
    await confirmAge(db, SITE_SHOP, c.id, "prompt");
    return { id: c.id, email, frozenAt: null };
  };
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(async () => {
    await wipe();
    a = await make("a@desk.test");
    b = await make("b@desk.test");
  });
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it("lists messages with author emails, searches, removes and restores", async () => {
    await sendMessage(db, a, "main", "pulled a gold charizard", env);
    await sendMessage(db, b, "main", "nice hit", env);
    let r = await chatDeskList(db, { q: "a@desk" }, env);
    expect(r.chatOn).toBe(true);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toMatchObject({ email: "a@desk.test", body: "pulled a gold charizard", staff: false, deletedAt: null });
    const id = r.messages[0].id;
    await chatDeskRemove(db, id, actor);
    await expect(chatDeskRemove(db, id, actor)).rejects.toMatchObject({ code: "gone" });
    expect((await chatDeskList(db, { q: "desk.test" }, env)).messages.map((m) => m.body)).toEqual(["nice hit"]);
    r = await chatDeskList(db, { q: "desk.test", show: "removed" }, env);
    expect(r.messages[0]).toMatchObject({ id, deletedBy: actor });
    await chatDeskRestore(db, id);
    expect((await listMessages(db, await chatAccess(db, b, env), "main")).map((m) => m.body)).toContain("pulled a gold charizard");
  });

  it("mutes and unmutes an author, and posts as Cardbit Staff", async () => {
    await sendMessage(db, a, "main", "spam spam", env);
    const id = (await chatDeskList(db, { q: "a@desk" }, env)).messages[0].id;
    await expect(chatDeskMute(db, { id, hours: 5 }, actor)).rejects.toMatchObject({ code: "bad_hours" });
    await chatDeskMute(db, { id, hours: 24 }, actor);
    expect((await chatDeskMutes(db)).mutes.find((m) => m.email === "a@desk.test")).toMatchObject({ by: actor });
    expect((await chatDeskList(db, { q: "a@desk", show: "all" }, env)).messages[0]).toMatchObject({ deletedBy: actor });
    await db.siteChatMessage.updateMany({ where: { customerId: a.id }, data: { createdAt: new Date(Date.now() - 70_000) } });
    await expect(sendMessage(db, a, "main", "hello again", env)).rejects.toMatchObject({ code: "muted" });
    await chatDeskUnmute(db, a.id);
    await sendMessage(db, a, "main", "hello again", env);

    await expect(chatDeskPost(db, "main", "visit www.x.com", actor)).rejects.toMatchObject({ code: "link" });
    const { id: staffMsg } = await chatDeskPost(db, "club", "Welcome to the Club room!", actor);
    const row = (await chatDeskList(db, { room: "club", q: "Welcome to the Club" }, env)).messages[0];
    expect(row).toMatchObject({ id: staffMsg, name: "Cardbit Staff", badge: "staff", staff: true, customerId: null, email: "mod@cardbit.test" });
    await expect(chatDeskMute(db, { id: staffMsg, hours: 1 }, actor)).rejects.toMatchObject({ code: "staff" });
  });
});
