// scripts/site/serve.mjs: long cache only for ?v=<hash> asset URLs, so Railway's CDN and browsers keep them;
// pages and API responses keep their own no-store headers (never cached at the edge).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp, staticCacheHeader } from "../../scripts/site/serve.mjs";

describe("cardbit.com static cache headers", () => {
  it("gives hashed asset URLs a one-year immutable cache and everything else one hour", () => {
    expect(staticCacheHeader({ v: "eabf8cb2c0" })).toBe("public, max-age=31536000, immutable");
    expect(staticCacheHeader({ v: "1" })).toBe("public, max-age=31536000, immutable");
    expect(staticCacheHeader({})).toBe("public, max-age=3600");
    expect(staticCacheHeader({ v: ["a", "b"] })).toBe("public, max-age=3600");
    expect(staticCacheHeader({ v: "<script>" })).toBe("public, max-age=3600");
  });

  it("serves files with those headers and leaves the page handler's no-store alone", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-serve-"));
    fs.mkdirSync(path.join(dir, "site"), { recursive: true });
    fs.writeFileSync(path.join(dir, "site", "a.css"), "body{}");
    const build = {
      publicPath: "/",
      assetsBuildDirectory: dir,
      entry: { module: { default: () => new Response("page", { headers: { "Cache-Control": "no-store" } }) } },
      routes: {},
    };
    const app = createApp(build, build);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const v = await fetch(`http://127.0.0.1:${port}/site/a.css?v=abc123`);
      expect(v.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      const plain = await fetch(`http://127.0.0.1:${port}/site/a.css`);
      expect(plain.headers.get("cache-control")).toBe("public, max-age=3600");
    } finally {
      server.close();
    }
  });
});
