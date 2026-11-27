// Pack Pass soundtrack (Trevor, Nov 27 2026): full-length versions of the six original 8-bit pack opening songs,
// downloadable by members on every plan. This repo is public, so the files are committed only encrypted
// (assets/soundtrack/<slug>.mp3.enc, AES-256-GCM: 12-byte IV, 16-byte tag, ciphertext). The key lives only in
// the app-site variable SITE_SOUNDTRACK_KEY (base64, 32 bytes), and only /pass/soundtrack/:song decrypts them,
// after checking the plan. The opening plays short loops of the same songs
// (public/site/audio/opening/). Source: scripts/audio/cardbit-soundtrack-full.py.
import { createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type Song = { slug: string; title: string; length: string };
export const SOUNDTRACK: Song[] = [
  { slug: "pixel-rush", title: "Pixel Rush", length: "1:52" },
  { slug: "neon-vault", title: "Neon Vault", length: "2:03" },
  { slug: "lucky-shuffle", title: "Lucky Shuffle", length: "2:26" },
  { slug: "holo-hunt", title: "Holo Hunt", length: "2:13" },
  { slug: "gold-rush-gallop", title: "Gold Rush Gallop", length: "1:42" },
  { slug: "boss-bit-showdown", title: "Boss Bit Showdown", length: "1:57" },
];
export const songBySlug = (slug: unknown) => SOUNDTRACK.find((s) => s.slug === slug) ?? null;
export const soundtrackPath = (slug: string) => `/pass/soundtrack/${slug}`;

const keyFrom = (env: NodeJS.ProcessEnv) => {
  const k = Buffer.from(env.SITE_SOUNDTRACK_KEY ?? "", "base64");
  return k.length === 32 ? k : null;
};
/** Downloads work only once the key is set on the service. */
export const soundtrackReady = (env: NodeJS.ProcessEnv = process.env) => keyFrom(env) !== null;

/** The full-length MP3 for a known song (never a caller-built path), decrypted. Throws if the key is missing or wrong. */
export async function soundtrackFile(song: Song, root = process.cwd(), env: NodeJS.ProcessEnv = process.env) {
  const key = keyFrom(env);
  if (!key) throw new Error("SITE_SOUNDTRACK_KEY is not set");
  const box = await readFile(path.join(root, "assets", "soundtrack", `${song.slug}.mp3.enc`));
  const d = createDecipheriv("aes-256-gcm", key, box.subarray(0, 12));
  d.setAuthTag(box.subarray(12, 28));
  return Buffer.concat([d.update(box.subarray(28)), d.final()]);
}
