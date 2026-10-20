import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LoaderFunctionArgs } from "react-router";

// Card back images with CORS headers, so the 3D pack opening (WebGL on poke-collect.com) can draw
// them. The app's own /packs/ static files are served without CORS.
const FILES: Record<string, string> = {
  "card-back-en.jpg": "image/jpeg",
  "card-back-jp.jpg": "image/jpeg",
};

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const file = params.file ?? "";
  const type = FILES[file];
  if (!type) return new Response("Not found", { status: 404 });
  const body = await readFile(path.join(process.cwd(), "public", "packs", file));
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400",
    },
  });
};
