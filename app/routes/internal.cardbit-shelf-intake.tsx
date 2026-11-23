import { createHash, timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { CARDBIT_SHOP } from "../lib/cardbit.server";
import { liveWorkspace } from "../workspace/mode.server";
import { receiveCopies } from "../workspace/shelf.server";
export async function action({ request }: ActionFunctionArgs) {
  const key = process.env.CARDBIT_DESK_SECRET;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (
    request.method !== "POST" ||
    !liveWorkspace(CARDBIT_SHOP) ||
    !key ||
    key.length < 32 ||
    request.headers.get("x-cardbit-shop") !== CARDBIT_SHOP ||
    !timingSafeEqual(
      hash(request.headers.get("authorization") || ""),
      hash("Bearer " + key),
    )
  )
    return Response.json({ error: "Unavailable." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 16000)
    return Response.json({ error: "Receipt too large." }, { status: 413 });
  try {
    return Response.json(await receiveCopies(db, JSON.parse(raw)));
  } catch {
    return Response.json(
      { error: "Review this physical receipt in Card Broker." },
      { status: 409 },
    );
  }
}
