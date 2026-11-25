import { describe, expect, it } from "vitest";
import { isPublicPath, robotsTags, robotsTxt, sitemapXml } from "./seo.server";
import { storefrontShell } from "./shell.server";

const env = { SITE_ORIGIN: "https://cardbit.com" } as NodeJS.ProcessEnv;

describe("search engines", () => {
  it("indexes public pages with a canonical link, keeps private ones noindex", () => {
    expect(robotsTags("/packs/", env)).toContain('<link rel="canonical" href="https://cardbit.com/packs">');
    expect(robotsTags("/packs", env)).toContain("index, follow");
    expect(robotsTags(null, env)).toBe('<meta name="robots" content="noindex, nofollow">');
    expect(robotsTags("/packs", { ...env, CARDBIT_SITE_INDEXING: "off" })).toContain("noindex");
    expect(isPublicPath("/shop")).toBe(true);
    expect(isPublicPath("/vault")).toBe(false);
    expect(isPublicPath("/account/settings")).toBe(false);
    expect(storefrontShell({ indexPath: "/" })).toContain("index, follow");
    expect(storefrontShell()).toContain("noindex, nofollow");
  });
  it("robots.txt blocks other hosts and lists the sitemap on cardbit.com", () => {
    expect(robotsTxt("app-site-site.up.railway.app", env)).toBe("User-agent: *\nDisallow: /\n");
    const txt = robotsTxt("cardbit.com", env);
    expect(txt).toContain("Disallow: /account");
    expect(txt).toContain("Sitemap: https://cardbit.com/sitemap.xml");
    expect(sitemapXml(env, "2026-11-25")).toContain("<loc>https://cardbit.com/shop</loc><lastmod>2026-11-25</lastmod>");
  });
});
