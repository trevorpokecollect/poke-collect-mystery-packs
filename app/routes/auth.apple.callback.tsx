// Apple posts the result here (response_mode=form_post).
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { callbackRoute } from "../site/core/oauth-routes.server";

export const action = async ({ request }: ActionFunctionArgs) =>
  callbackRoute("apple", request, new URLSearchParams((await request.formData()) as unknown as Record<string, string>));
export const loader = ({ request }: LoaderFunctionArgs) => callbackRoute("apple", request, new URL(request.url).searchParams);
