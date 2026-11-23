import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { Catalog } from "../lib/demo-shopper.server";
export type Bundle = { version: string; data: string };
const catalogCache = new Map<string, Catalog>();
export function unpack(archive: Bundle): Catalog {
  const cached = catalogCache.get(archive.version);
  if (cached) return cached;
  const bytes = gunzipSync(Buffer.from(archive.data, "base64"), {
    maxOutputLength: 4 * 1024 * 1024,
  });
  if (createHash("sha256").update(bytes).digest("hex") !== archive.version)
    throw new Error("Invalid demo catalog.");
  const catalog: Catalog = JSON.parse(bytes.toString());
  if (catalogCache.size >= 4) catalogCache.clear();
  catalogCache.set(archive.version, catalog);
  return catalog;
}
