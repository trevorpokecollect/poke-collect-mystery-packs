import type { LoaderFunctionArgs } from "react-router";
import { SignInError, googleStart } from "../site/core/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.CARDBIT_SITE !== "on") return new Response("Not found", { status: 404 });
  const rt = new URL(request.url).searchParams.get("return_to") || "/account";
  try {
    const { url, cookie } = googleStart(rt);
    return new Response(null, { status: 303, headers: { Location: url, "Set-Cookie": cookie } });
  } catch (e) {
    const msg = e instanceof SignInError ? e.message : "Google sign-in is unavailable.";
    return new Response(null, { status: 303, headers: { Location: `/sign-in?error=${encodeURIComponent(msg)}` } });
  }
}
