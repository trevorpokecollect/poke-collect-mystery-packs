import type { LoaderFunctionArgs } from "react-router";
import { callbackRoute } from "../site/core/oauth-routes.server";

export const loader = ({ request }: LoaderFunctionArgs) => callbackRoute("discord", request, new URL(request.url).searchParams);
