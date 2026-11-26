import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { confirmAge } from "../../lib/cardbit-age.server";
import { SITE_SHOP } from "../rewards/rewards.server";
import { startCoolOff } from "../play/limits.server";
import { htmlToText, knowledge } from "./knowledge.server";
import { type Ask, HelpError, askHelp, helpAllowed, buildSystem, cleanQuestion, helpConversation, helpList, helpMark, helpOn, purgeOld, tidyReply } from "./help.server";
import { helpTags } from "./tag.server";

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://localhost/unconfigured_test" } } });

describe("Ask Latch basics", () => {
  it("is off without the flag or the API key", () => {
    expect(helpOn({} as NodeJS.ProcessEnv)).toBe(false);
    expect(helpOn({ SITE_HELP: "on" } as NodeJS.ProcessEnv)).toBe(false);
    expect(helpOn({ SITE_HELP: "on", ANTHROPIC_API_KEY: "sk-x" } as NodeJS.ProcessEnv)).toBe(true);
    expect(helpTags("site", "/latch.webp", {} as NodeJS.ProcessEnv)).toBe("");
    const staffEnv = { SITE_HELP: "staff", ANTHROPIC_API_KEY: "k", SITE_STAFF_EMAILS: "boss@help.test" } as NodeJS.ProcessEnv;
    expect(helpAllowed(null, staffEnv)).toBe(false);
    expect(helpAllowed({ email: "fan@help.test" }, staffEnv)).toBe(false);
    expect(helpAllowed({ email: "Boss@help.test" }, staffEnv)).toBe(true);
    expect(helpAllowed(null, { ...staffEnv, SITE_HELP: "on" })).toBe(true);
    expect(helpTags("site", "/latch.webp", staffEnv)).toContain('data-staff="1"');
    expect(helpTags("waitlist", "/latch.webp", { SITE_HELP: "on", ANTHROPIC_API_KEY: "k" } as NodeJS.ProcessEnv)).toContain('data-mode="waitlist"');
  });

  it("cleans questions and masks card numbers", () => {
    expect(cleanQuestion("  how   do I ship? ")).toBe("how do I ship?");
    expect(cleanQuestion("my card 4111 1111 1111 1111 was charged")).toBe("my card [number removed] was charged");
    expect(() => cleanQuestion("")).toThrow(HelpError);
    expect(() => cleanQuestion("x".repeat(601))).toThrow(HelpError);
  });

  it("turns the site pages into reference text the bot answers from", () => {
    expect(htmlToText('<h2>Ship It</h2><p>Fast&nbsp;&amp; <a href="/policies#ship">free</a></p><script>x()</script>')).toBe("### Ship It\nFast & free (cardbit.com/policies#ship)");
    const k = knowledge();
    expect(k).toContain("Frequently Asked Questions");
    expect(k).toContain("POLICIES");
    expect(k).toContain("Founding Collector");
    expect(k).not.toMatch(/<script|<style/i);
    expect(k.length).toBeLessThan(200_000);
  });

  it("caches the rules + pages and adds the visitor's mode after the cache point", () => {
    const [stable, ctx] = buildSystem("waitlist", false, new Date("2026-11-26T12:00:00Z"));
    expect(stable.cache_control).toBeTruthy();
    expect(stable.text).toContain("support@cardbit.com");
    expect(stable.text).not.toContain("2026-11-26");
    expect(ctx.text).toContain("NOT launched");
    expect(buildSystem("site", true)[1].text).toContain("signed in");
  });

  it("strips markdown from replies", () => {
    expect(tidyReply("## Hi\n**Bold** and\n* item")).toBe("Hi\nBold and\n- item");
  });
});

describe.skipIf(!url)("Ask Latch conversations", () => {
  const seen: Parameters<Ask>[0][] = [];
  const fake: Ask = async (args) => {
    seen.push(args);
    const last = args.messages[args.messages.length - 1].content as string;
    return { text: last.includes("refund") ? "Our support team handles refunds. Email support@cardbit.com." : `Answer to: ${last}`, model: "test-model", inputTokens: 10, outputTokens: 5, cacheReadTokens: 900 };
  };
  const env = { SITE_HELP_DAILY_CAP: "1000" } as NodeJS.ProcessEnv;
  const base = { ipHash: "iphash-help-test", mode: "site" as const };
  let member: { id: string; email: string; frozenAt: Date | null };

  const wipe = async () => {
    await db.siteHelpConversation.deleteMany({ where: { OR: [{ visitorKey: { startsWith: "v:helptest" } }, { ipHash: { in: [base.ipHash, "iphash-other"] } }] } });
    const ids = (await db.siteCustomer.findMany({ where: { email: { endsWith: "@help.test" } }, select: { id: true } })).map((c) => c.id);
    await db.siteHelpConversation.deleteMany({ where: { customerId: { in: ids } } });
    await db.sitePlayEvent.deleteMany({ where: { customerId: { in: ids } } });
    await db.sitePlayControl.deleteMany({ where: { customerId: { in: ids } } });
    await db.cardbitAgeConfirmation.deleteMany({ where: { shop: SITE_SHOP, customerId: { in: ids } } });
    await db.siteCustomer.deleteMany({ where: { id: { in: ids } } });
  };
  // Moves a visitor's messages back in time (keeping their order) so the next question isn't "too fast".
  const later = async (visitorKey: string, ms = 10_000) =>
    db.$executeRaw`UPDATE "SiteHelpMessage" m SET "createdAt" = m."createdAt" - (${ms} * interval '1 millisecond') FROM "SiteHelpConversation" c WHERE c.id = m."conversationId" AND c."visitorKey" = ${visitorKey}`;

  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  });
  beforeEach(async () => {
    await wipe();
    seen.length = 0;
    const c = await db.siteCustomer.create({ data: { email: "m@help.test" } });
    await confirmAge(db, SITE_SHOP, c.id, "prompt");
    member = { id: c.id, email: c.email, frozenAt: null };
  });
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it("needs an 18+ confirmation from anonymous visitors, then answers and logs both sides", async () => {
    const visitorKey = "v:helptest-anon";
    await expect(askHelp(db, { ...base, customer: null, visitorKey, question: "What is Cardbit?", adult: false }, fake, env)).rejects.toMatchObject({ code: "age" });
    const out = await askHelp(db, { ...base, customer: null, visitorKey, question: "What is Cardbit?", adult: true }, fake, env);
    expect(out.reply).toBe("Answer to: What is Cardbit?");
    expect(out.handoff).toBe(false);
    const convo = await helpConversation(db, out.conversationId);
    expect(convo.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(convo.messages[1].model).toBe("test-model");
  });

  it("rebuilds history from the database and marks support handoffs", async () => {
    const visitorKey = "v:helptest-history";
    const first = await askHelp(db, { ...base, customer: null, visitorKey, question: "How do packs work?", adult: true }, fake, env);
    await later(visitorKey);
    const second = await askHelp(db, { ...base, customer: null, visitorKey, conversationId: first.conversationId, question: "Can I get a refund?", adult: true }, fake, env);
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.handoff).toBe(true);
    expect(seen[1].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    // Someone else's conversation id starts a fresh conversation instead of reading theirs.
    const other = await askHelp(db, { ...base, ipHash: "iphash-other", customer: null, visitorKey: "v:helptest-other", conversationId: first.conversationId, question: "hi", adult: true }, fake, env);
    expect(other.conversationId).not.toBe(first.conversationId);
    expect(seen[2].messages).toHaveLength(1);
    await db.siteHelpConversation.deleteMany({ where: { visitorKey: "v:helptest-other" } });
  });

  it("rate limits per visitor", async () => {
    const visitorKey = "v:helptest-rate";
    await askHelp(db, { ...base, customer: null, visitorKey, question: "one", adult: true }, fake, env);
    await expect(askHelp(db, { ...base, customer: null, visitorKey, question: "two", adult: true }, fake, env)).rejects.toMatchObject({ code: "slow_down" });
    const convo = await db.siteHelpConversation.findFirstOrThrow({ where: { visitorKey } });
    await db.siteHelpMessage.createMany({ data: Array.from({ length: 19 }, () => ({ conversationId: convo.id, role: "user", body: "x", createdAt: new Date(Date.now() - 60_000) })) });
    await later(visitorKey, 60_000);
    await expect(askHelp(db, { ...base, customer: null, visitorKey, question: "three", adult: true }, fake, env)).rejects.toMatchObject({ code: "limit" });
  });

  it("uses the account's age confirmation and pauses during a break", async () => {
    const visitorKey = `c:${member.id}`;
    const out = await askHelp(db, { ...base, customer: member, visitorKey, question: "How do Sparks work?", adult: false }, fake, env);
    expect(out.reply).toContain("Sparks");
    expect((await db.siteHelpConversation.findUniqueOrThrow({ where: { id: out.conversationId } })).customerId).toBe(member.id);
    await startCoolOff(db, member.id, 24);
    await later(visitorKey);
    await expect(askHelp(db, { ...base, customer: member, visitorKey, question: "hi", adult: true }, fake, env)).rejects.toMatchObject({ code: "paused" });
    await expect(askHelp(db, { ...base, customer: { ...member, frozenAt: new Date() }, visitorKey, question: "hi", adult: true }, fake, env)).rejects.toMatchObject({ code: "on_hold" });
  });

  it("lists, flags and purges transcripts for staff", async () => {
    const visitorKey = "v:helptest-staff";
    const out = await askHelp(db, { ...base, customer: null, visitorKey, question: "Can I get a refund?", adult: true }, fake, env);
    const list = await helpList(db, { handoff: true, q: "refund" });
    expect(list.conversations.find((c) => c.id === out.conversationId)).toMatchObject({ handoff: true, firstQuestion: "Can I get a refund?" });
    expect(list.stats.answers7).toBeGreaterThan(0);
    const marked = await helpMark(db, "cardbroker:staff@help.test", out.conversationId, { flagged: true, reviewed: true });
    expect(marked).toMatchObject({ flagged: true, reviewedBy: "cardbroker:staff@help.test" });
    await db.siteHelpConversation.update({ where: { id: out.conversationId }, data: { updatedAt: new Date(Date.now() - 91 * 86_400_000) } });
    expect(await purgeOld(db)).toBeGreaterThanOrEqual(1);
    await expect(helpConversation(db, out.conversationId)).rejects.toMatchObject({ code: "not_found" });
  });
});
