import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";

// Public prize images for the storefront widget. Ids are random cuids and
// images are never edited in place, so they can be cached forever.
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const image = await db.campaignImage.findFirst({
    where: { id: params.id ?? "", shop: "hhuuev-81.myshopify.com" },
  });
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
