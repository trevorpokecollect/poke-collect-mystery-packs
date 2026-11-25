/** Cardbit standalone site: Official Rules (published only once the approved text is added). */
import { SITE_ENABLED, htmlResponse, notFound } from "../site/shell.server";
import { officialRulesPage } from "../site/pages.server";

export const loader = async () => {
  const html = SITE_ENABLED() ? officialRulesPage() : null;
  return html ? htmlResponse(html) : notFound();
};
