import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { json, proxyContext } from "../lib/proxy.server";
import { enabled } from "../workspace/mode.server";
import { subscribers } from "../giveaway/consent.server";
import { enterOrBonus } from "../giveaway/entries.server";
import { customerView, promptView } from "../giveaway/service.server";
async function handle(request: Request, mutate: boolean) {
  const { shop, viewer, admin } = await proxyContext(request);
  if (!enabled(shop) || !admin)
    return json({ error: "Giveaway unavailable." }, 404);
  const id = viewer?.customerId ?? null;
  if (mutate && (!id || request.method !== "POST"))
    return json({ error: "Sign in to enter." }, 403);
  if (
    mutate &&
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return json({ error: "Use the giveaway page to enter." }, 415);
  try {
    const prompt = new URL(request.url).searchParams.get("view") === "prompt";
    if (prompt && !mutate) return json(await promptView(db, id));
    const opted = id ? (await subscribers(admin, [id])).has(id) : false;
    if (mutate) {
      if (!opted)
        return json(
          {
            error:
              "Enable email marketing on your Cardbit account before entering.",
          },
          403,
        );
      const raw = await request.text();
      if (raw.length > 2048)
        return json({ error: "Request is too large." }, 413);
      const body = JSON.parse(raw);
      if (!body || typeof body !== "object" || Array.isArray(body))
        return json({ error: "Invalid request." }, 400);
      if (
        prompt &&
        (body.intent !== "enter" || typeof body.expectedDay !== "string")
      )
        return json({ error: "Choose today's giveaway." }, 400);
      const receipt = await enterOrBonus(db, id!, body);
      if (prompt) return json(receipt);
    }
    return json(await customerView(db, id, opted));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return json(
      {
        error:
          /^(Enter today|Choose an|Your entry|Visit Whatnot|Confirm you|The daily|Email subscription)/.test(
            msg,
          )
            ? msg
            : "Giveaway details are unavailable. Try again.",
      },
      409,
    );
  }
}
export const loader = ({ request }: LoaderFunctionArgs) =>
  handle(request, false);
export const action = ({ request }: ActionFunctionArgs) =>
  handle(request, true);
