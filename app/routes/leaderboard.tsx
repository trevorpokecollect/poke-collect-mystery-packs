/** Cardbit standalone site: Weekly Leaderboard page. Only when CARDBIT_SITE=on. */
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { SITE_ENABLED, htmlResponse, notFound } from "../site/shell.server";
import { leaderboardPage } from "../site/pages.server";

export const loader = async ({ request }: LoaderFunctionArgs) =>
  SITE_ENABLED() ? htmlResponse(leaderboardPage(await currentCustomer(db, request))) : notFound();
