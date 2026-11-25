// Printable packing slip for one site shipment (staff only).
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { packingSlipHtml } from "../site/shipping/packing-slip";
import { notFound, staffUser } from "../site/shipping/staff.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const staff = await staffUser(request, (r) => currentCustomer(prisma, r));
  if (!staff) return notFound();
  const s = await prisma.siteShipment.findUnique({ where: { id: params.id ?? "" }, include: { items: true } });
  if (!s) return notFound();
  return new Response(packingSlipHtml(s), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
