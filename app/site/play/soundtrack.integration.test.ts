// Pack Pass soundtrack downloads: members on any plan get the file; everyone else is sent to sign in or to the plan page.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { SOUNDTRACK, songBySlug, soundtrackFile } from "./soundtrack.server";

describe("soundtrack files", () => {
  it("has a full-length MP3 for every song and none in public/", () => {
    for (const s of SOUNDTRACK) {
      const f = path.join(process.cwd(), "assets", "soundtrack", `${s.slug}.mp3.enc`);
      expect(existsSync(path.join(process.cwd(), "assets", "soundtrack", `${s.slug}.mp3`))).toBe(false); // never the plain file (public repo)
      expect(statSync(f).size).toBeGreaterThan(1_000_000);
      expect(existsSync(path.join(process.cwd(), "public", "site", "audio", "opening", `${s.slug}.mp3`))).toBe(true); // the opening loop
    }
    expect(existsSync(path.join(process.cwd(), "public", "soundtrack"))).toBe(false);
  });
  it("decrypts only with the right key", async () => {
    const song = songBySlug("pixel-rush")!;
    await expect(soundtrackFile(song, process.cwd(), {})).rejects.toThrow(/SITE_SOUNDTRACK_KEY/);
    await expect(soundtrackFile(song, process.cwd(), { SITE_SOUNDTRACK_KEY: Buffer.alloc(32, 7).toString("base64") })).rejects.toThrow();
    if (process.env.SITE_SOUNDTRACK_KEY) expect((await soundtrackFile(song)).subarray(0, 3).toString()).toBe("ID3");
  });
  it("only knows its own songs", () => {
    expect(songBySlug("holo-hunt")?.title).toBe("Holo Hunt");
    expect(songBySlug("../package.json")).toBeNull();
    expect(songBySlug("")).toBeNull();
  });
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url || !process.env.SITE_SOUNDTRACK_KEY)("soundtrack downloads", () => {
  let db: typeof import("../../db.server").default;
  let loader: typeof import("../../routes/pass_.soundtrack.$song").loader;
  let passLoader: typeof import("../../routes/pass").loader;
  let member = "", plain = "";
  const saved = { ...process.env };
  const req = (p: string, cookie = "") => new Request(`https://cardbit.test${p}`, { headers: cookie ? { cookie } : {} });
  const call = (slug: string, cookie = "") => loader({ request: req(`/pass/soundtrack/${slug}`, cookie), params: { song: slug }, context: {} } as never) as Promise<Response>;
  beforeAll(async () => {
    process.env.DATABASE_URL = url; process.env.CARDBIT_SITE = "on"; process.env.SITE_SUBSCRIPTIONS = "on"; delete process.env.CARDBIT_WAITLIST;
    db = (await import("../../db.server")).default;
    ({ loader } = await import("../../routes/pass_.soundtrack.$song"));
    ({ loader: passLoader } = await import("../../routes/pass"));
    const { createSessionToken, SESSION_COOKIE } = await import("../core/auth.server");
    await db.siteSubscription.deleteMany({ where: { providerRef: { startsWith: "st-test" } } });
    await db.siteCustomer.deleteMany({ where: { email: { endsWith: "@soundtrack.test" } } });
    const m = await db.siteCustomer.create({ data: { email: "m@soundtrack.test" } });
    const p = await db.siteCustomer.create({ data: { email: "p@soundtrack.test" } });
    await db.siteSubscription.create({ data: { customerId: m.id, tier: "plus", providerRef: "st-test-1", status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 10 * 864e5) } });
    const r = new Request("https://cardbit.test/");
    member = `${SESSION_COOKIE}=${(await createSessionToken(db, m.id, r)).token}`;
    plain = `${SESSION_COOKIE}=${(await createSessionToken(db, p.id, r)).token}`;
  });
  afterAll(async () => {
    await db.siteSession.deleteMany({ where: { customerId: { in: (await db.siteCustomer.findMany({ where: { email: { endsWith: "@soundtrack.test" } } })).map((c) => c.id) } } });
    await db.siteSubscription.deleteMany({ where: { providerRef: { startsWith: "st-test" } } });
    await db.siteCustomer.deleteMany({ where: { email: { endsWith: "@soundtrack.test" } } });
    process.env = saved;
  });
  it("sends signed-out visitors to sign in, then back to the song", async () => {
    const r = await call("holo-hunt");
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/sign-in?return_to=%2Fpass%2Fsoundtrack%2Fholo-hunt");
  });
  it("sends signed-in non-members to the Pack Pass soundtrack section", async () => {
    const r = await call("holo-hunt", plain);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/pass#soundtrack");
  });
  it("gives members on Plus the full MP3 as a download", async () => {
    const r = await call("holo-hunt", member);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("audio/mpeg");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="Cardbit - Holo Hunt.mp3"');
    expect(r.headers.get("cache-control")).toContain("private");
    expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(1_000_000);
  });
  it("says downloads aren't open while the key is missing", async () => {
    const k = process.env.SITE_SOUNDTRACK_KEY; delete process.env.SITE_SOUNDTRACK_KEY;
    try { expect((await call("holo-hunt", member)).status).toBe(503); } finally { process.env.SITE_SOUNDTRACK_KEY = k; }
  });
  it("404s unknown songs, even for members", async () => {
    expect((await call("..%2F..%2Fpackage.json", member)).status).toBe(404);
    expect((await call("treasure-token-trot", member)).status).toBe(404);
  });
  it("lists the soundtrack on the Pack Pass page: download links for members, locks for others", async () => {
    const page = async (cookie: string) => (await (await passLoader({ request: req("/pass", cookie), params: {}, context: {} } as never) as Response).text());
    const m = await page(member), p = await page(plain);
    expect(m).toContain('id="soundtrack"');
    expect(m.match(/href="\/pass\/soundtrack\/[a-z-]+" download/g)?.length).toBe(6);
    expect(p).not.toContain('href="/pass/soundtrack/');
    expect(p).toContain("Pack opening soundtrack:");
  });
});
