// Staff fraud review for the standalone site: accounts whose top-up was flagged (shipping paused or
// account frozen), with the reasons, and buttons to clear, trust or freeze. Same staff gate as the
// shipping desk (SITE_STAFF_EMAILS + a sign-in from the last 12 hours).
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { currentStaffCandidate } from "../site/core/auth.server";
import { esc } from "../site/core/simple-page";
import { notFound, sameOrigin, staffUser } from "../site/shipping/staff.server";

const resolve = (r: Request) => currentStaffCandidate(prisma, r);
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const ct = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const html = (body: string) =>
  new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" } });

export async function loader({ request }: LoaderFunctionArgs) {
  const staff = await staffUser(request, resolve);
  if (!staff) return notFound();
  const msg = new URL(request.url).searchParams.get("msg");
  const accounts = await prisma.siteCustomer.findMany({
    where: { OR: [{ riskStatus: "review" }, { frozenAt: { not: null } }] },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const flagged = await prisma.siteTopup.findMany({
    where: { riskLevel: { in: ["elevated", "highest"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const emails = new Map((await prisma.siteCustomer.findMany({ where: { id: { in: flagged.map((t) => t.customerId) } }, select: { id: true, email: true } })).map((c) => [c.id, c.email]));
  const btn = (id: string, intent: string, label: string, cls = "") =>
    `<form method="post"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="intent" value="${intent}"><button class="${cls}">${label}</button></form>`;
  const rows = accounts.length
    ? accounts
        .map(
          (c) => `<tr><td><strong>${esc(c.email)}</strong><br><small>Joined ${ct(c.createdAt)}</small></td>
<td>${c.frozenAt ? '<span class="tag red">Frozen</span>' : '<span class="tag">Shipping Paused</span>'}</td>
<td><small>${esc(c.riskNote || (c.frozenAt ? "Frozen (chargeback or staff)" : ""))}</small></td>
<td class="acts">${btn(c.id, "clear", "Clear")}${btn(c.id, "trust", "Trust Account", "ghost")}${c.frozenAt ? "" : btn(c.id, "freeze", "Freeze", "danger")}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="empty">Nothing to review.</td></tr>`;
  const recent = flagged
    .map((t) => {
      const reasons = Array.isArray(t.riskReasons) ? (t.riskReasons as { detail?: string; code: string }[]).map((r) => r.detail || r.code).join("; ") : "";
      return `<tr><td>${ct(t.createdAt)}</td><td>${esc(emails.get(t.customerId) || t.customerId)}</td><td>${usd(t.cents)} ${esc(t.provider)}</td><td>${esc(t.riskLevel || "")}</td><td><small>${esc(reasons)}</small></td><td>${esc(t.status)}</td></tr>`;
    })
    .join("");
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Fraud Review · cardbit</title>
<style>body{font:15px/1.45 system-ui,sans-serif;margin:0;background:#FAF8F3;color:#17213B}main{max-width:1100px;margin:0 auto;padding:16px}h1{margin:8px 0}table{width:100%;border-collapse:collapse;background:#fff;margin:12px 0 28px}td,th{padding:10px;border-bottom:1px solid #e6e2d8;text-align:left;vertical-align:top}.acts form{display:inline-block;margin:0 6px 6px 0}button{font:inherit;border:0;border-radius:8px;padding:8px 12px;background:#4057F5;color:#fff;cursor:pointer}button.ghost{background:#e9ecff;color:#17213B}button.danger{background:#b3261e}.tag{display:inline-block;padding:2px 8px;border-radius:99px;background:#FFB65C33}.tag.red{background:#b3261e22;color:#b3261e}.msg{background:#e9ecff;padding:10px;border-radius:8px}.empty{color:#666}nav a{margin-right:14px}@media(max-width:700px){td,th{display:block;border:0}tr{border-bottom:1px solid #e6e2d8;display:block}}</style></head>
<body><main><nav><a href="/staff/shipping">Shipping Desk</a><a href="/staff/stock">Stock</a></nav><h1>Fraud Review</h1>
${msg ? `<p class="msg" role="status">${esc(msg)}</p>` : ""}
<p>A flagged Cardbits purchase pauses shipping for that account. The worst cases also freeze it. Clear an account once you're happy it's genuine, or refund the payment in Stripe or Coinflow (that takes the Cardbits back automatically). Trust Account stops automatic reviews for that customer.</p>
<table><thead><tr><th>Account</th><th>Status</th><th>Why</th><th></th></tr></thead><tbody>${rows}</tbody></table>
<h2>Recent Flagged Purchases</h2><table><thead><tr><th>When (CT)</th><th>Customer</th><th>Amount</th><th>Risk</th><th>Signals</th><th>Status</th></tr></thead><tbody>${recent || '<tr><td colspan="6" class="empty">None yet.</td></tr>'}</tbody></table>
</main></body></html>`);
}

export async function action({ request }: ActionFunctionArgs) {
  const staff = await staffUser(request, resolve);
  if (!staff) return notFound();
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const fd = await request.formData();
  const id = String(fd.get("id") || "");
  const intent = String(fd.get("intent") || "");
  const c = await prisma.siteCustomer.findUnique({ where: { id } });
  if (!c) return new Response(null, { status: 303, headers: { Location: "/staff/review?msg=Account%20not%20found." } });
  const stamp = `${intent} by ${staff.email} ${new Date().toISOString()}`;
  const note = `${c.riskNote ? c.riskNote + " | " : ""}${stamp}`.slice(-1500);
  const data =
    intent === "clear"
      ? { riskStatus: "ok", frozenAt: null, riskNote: note }
      : intent === "trust"
        ? { riskStatus: "trusted", frozenAt: null, riskNote: note }
        : intent === "freeze"
          ? { riskStatus: "review", frozenAt: new Date(), riskNote: note }
          : null;
  if (!data) return new Response(null, { status: 303, headers: { Location: "/staff/review" } });
  await prisma.siteCustomer.update({ where: { id }, data });
  console.info(`[site-review] ${c.email}: ${stamp}`);
  const done = intent === "clear" ? "cleared" : intent === "trust" ? "trusted" : "frozen";
  return new Response(null, { status: 303, headers: { Location: `/staff/review?msg=${encodeURIComponent(`${c.email} ${done}.`)}` } });
}
