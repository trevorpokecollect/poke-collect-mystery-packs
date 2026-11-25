import type { LoaderFunctionArgs } from "react-router";
import { startRoute } from "../site/core/oauth-routes.server";

export const loader = ({ request }: LoaderFunctionArgs) => startRoute("discord", request);
