// GET /api/card-image?u=<TCGplayer product image URL>: the same picture, served from cardbit.com.
// Why (Nov 26 2026, Trevor): sideways scans (LEGEND halves, BREAK cards) are turned upright in the browser by
// redrawing them on a canvas (public/site/js/cardbit-site-upright.js). TCGplayer's image CDN sends no CORS
// header, so the canvas can't be exported and the card fell back to a CSS turn that left it small inside a
// landscape frame. Same-origin copies make the canvas path work. Only TCGplayer product image URLs are accepted.
import type { LoaderFunctionArgs } from "react-router";
import { siteOn } from "../site/store/http.server";

const ALLOWED: Array<[string, RegExp]> = [
  ["product-images.tcgplayer.com", /^\/fit-in\/\d{2,4}x\d{2,4}\/\d{1,10}\.jpg$/],
  ["tcgplayer-cdn.tcgplayer.com", /^\/product\/\d{1,10}_in_\d{2,4}x\d{2,4}\.jpg$/],
];
const MAX_BYTES = 5 * 1024 * 1024;

export function cardImageSource(raw: string | null): URL | null {
  if (!raw || raw.length > 300) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
  return ALLOWED.some(([host, path]) => url.hostname === host && path.test(url.pathname)) ? url : null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (!siteOn()) return new Response("Not found", { status: 404 });
  const source = cardImageSource(new URL(request.url).searchParams.get("u"));
  if (!source) return new Response("Bad image", { status: 400 });
  try {
    const upstream = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(8000) });
    const type = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !/^image\/(jpeg|png|webp)$/.test(type.split(";")[0].trim())) return new Response("Not found", { status: 404 });
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return new Response("Too large", { status: 413 });
    return new Response(body, {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=604800, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new Response("Unavailable", { status: 502 });
  }
}
