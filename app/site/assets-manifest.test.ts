import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import manifest from "./assets-manifest.json";

// Asset URLs carry ?v=<hash> from this manifest, so a stale hash leaves browsers on an old cached file.
describe("site asset manifest", () => {
  it("matches every asset's current contents", () => {
    const stale = Object.entries(manifest as Record<string, string>).filter(([name, hash]) =>
      createHash("sha256").update(readFileSync(new URL(`../../public/site/assets/${name}`, import.meta.url))).digest("hex").slice(0, 10) !== hash);
    expect(stale.map(([name]) => name)).toEqual([]);
  });
});
