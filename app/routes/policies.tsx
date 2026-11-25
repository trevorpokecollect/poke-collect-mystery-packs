/**
 * Cardbit standalone site: Policies (approved redesign, ported from the theme's cardbit-policies section).
 * Server-rendered so the legal text reads without JavaScript. Only active when CARDBIT_SITE=on.
 */
import { SITE_ENABLED, htmlResponse, notFound } from "../site/shell.server";
import { policiesPage } from "../site/pages.server";

export const loader = async () => (SITE_ENABLED() ? htmlResponse(policiesPage()) : notFound());
