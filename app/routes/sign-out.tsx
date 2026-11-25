import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { endSession } from "../site/core/auth.server";

export async function action({ request }: ActionFunctionArgs) {
  if (process.env.CARDBIT_SITE !== "on") return new Response("Not found", { status: 404 });
  return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": await endSession(db, request) } });
}
export const loader = () => new Response("Not found", { status: 404 });
