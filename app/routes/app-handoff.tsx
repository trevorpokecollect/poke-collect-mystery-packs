// GET /app-handoff?challenge=... : iPhone app sign-in (see app/site/core/app-handoff.server.ts).
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { startHandoff, validChallenge } from "../site/core/app-handoff.server";

const noStore = { "Cache-Control": "no-store" };

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.CARDBIT_SITE !== "on") return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const challenge = url.searchParams.get("challenge");
  if (!validChallenge(challenge)) return new Response("Invalid app sign-in request.", { status: 400, headers: noStore });
  const customer = await currentCustomer(db, request);
  if (!customer) {
    const back = `/app-handoff?challenge=${challenge}`;
    return new Response(null, { status: 302, headers: { ...noStore, Location: `/sign-in?return_to=${encodeURIComponent(back)}` } });
  }
  const { redirect } = await startHandoff(db, customer.id, challenge);
  return new Response(null, { status: 302, headers: { ...noStore, Location: redirect } });
}
