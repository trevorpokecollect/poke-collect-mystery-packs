// GET /pass/soundtrack/:song: full-length soundtrack download for Pack Pass members on any plan.
// Not signed in -> sign-in, then back here. Signed in without a plan -> the Pack Pass page's soundtrack section.
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { PLAN } from "../site/play/plan-brand";
import { songBySlug, soundtrackFile, soundtrackPath, soundtrackReady } from "../site/play/soundtrack.server";
import { activeTier } from "../site/play/subscriptions.server";
import { gatePage } from "../site/waitlist/gate.server";

const go = (to: string) => new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (process.env.CARDBIT_SITE !== "on") return new Response("Not found", { status: 404 });
  { const gated = gatePage(request); if (gated) return gated; }
  const song = songBySlug(params.song);
  if (!song) return new Response("Not found", { status: 404 });
  const customer = await currentCustomer(db, request);
  if (!customer) return go(`/sign-in?return_to=${encodeURIComponent(soundtrackPath(song.slug))}`);
  if (!(await activeTier(db, customer.id))) return go(`${PLAN.path}#soundtrack`);
  if (!soundtrackReady()) return new Response("Soundtrack downloads are not open yet.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const body = await soundtrackFile(song);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(body.length),
      "Content-Disposition": `attachment; filename="Cardbit - ${song.title}.mp3"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
