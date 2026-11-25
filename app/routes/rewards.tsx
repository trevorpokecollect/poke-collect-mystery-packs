/** Cardbit standalone site: Rewards page (levels, check-in, Daily Spins, icons). Only when CARDBIT_SITE=on. */
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { SITE_ENABLED, htmlResponse, notFound } from "../site/shell.server";
import { rewardsPage } from "../site/pages.server";
import { gatePage } from "../site/waitlist/gate.server";

export const loader = async ({ request }: LoaderFunctionArgs) =>
  !SITE_ENABLED() ? notFound() : (gatePage(request) ?? htmlResponse(rewardsPage(await currentCustomer(db, request))));
