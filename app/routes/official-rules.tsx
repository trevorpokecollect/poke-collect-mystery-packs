/** Cardbit standalone site: Official Rules (published only once the approved text is added). */
import db from "../db.server";
import { SITE_ENABLED, htmlResponse, notFound } from "../site/shell.server";
import { officialRulesPage } from "../site/pages.server";
import { siteSpinRulesHtml } from "../site/rewards/spin-rules.server";

export const loader = async () => {
  // C4 (Daily Spinner prizes and odds) comes from the live prize table, so the rules always match what spins pay.
  const html = SITE_ENABLED() ? officialRulesPage(await siteSpinRulesHtml(db)) : null;
  return html ? htmlResponse(html) : notFound();
};
