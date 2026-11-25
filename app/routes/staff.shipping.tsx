// Staff shipping desk for the standalone site. 404 unless CARDBIT_SITE=on and the signed-in
// customer's email is in SITE_STAFF_EMAILS.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { deskAction, loadDesk, renderDesk } from "../site/shipping/desk.server";
import { notFound, sameOrigin, staffUser } from "../site/shipping/staff.server";
import { siteShippingDeps } from "../site/shipping/wire.server";
import { mailerFromEnv } from "../site/email/mailer.server";

const resolve = (request: Request) => currentCustomer(prisma, request);

const html = (body: string) =>
  new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
    },
  });

export async function loader({ request }: LoaderFunctionArgs) {
  const staff = await staffUser(request, resolve);
  if (!staff) return notFound();
  const data = await loadDesk(siteShippingDeps(), new URL(request.url));
  return html(renderDesk(data, staff.email));
}

export async function action({ request }: ActionFunctionArgs) {
  const staff = await staffUser(request, resolve);
  if (!staff) return notFound();
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const to = await deskAction(siteShippingDeps(), await request.formData(), `staff:${staff.email}`, {
    db: prisma,
    mailer: mailerFromEnv(),
  });
  return new Response(null, { status: 303, headers: { Location: to } });
}
