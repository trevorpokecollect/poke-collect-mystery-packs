// Card Broker staff tools ↔ site (Shopify-gap audit, Nov 25 2026). Server-to-server only (pairing secret).
// Card Broker authenticates its staff and enforces roles; x-cardbit-actor names who acted (audit trail).
// POST {op:"adjust", customerId, delta, reason, requestId, visibleNote?}       → {balance, ledgerId}
// POST {op:"reverse-pack", openingId, reason, requestId}                     → {refundedBits, balance}
// POST {op:"reverse-single", ledgerId, reason, requestId}                    → {refundedBits, balance}
// POST {op:"order", type, id}                                                → order page (summary, items, notes, timeline, actions)
// POST {op:"order-note", type, id, body}                                     → {id}
// POST {op:"close"|"reopen", customerId, reason, requestId}
// POST {op:"export", customerId, reason, requestId}                          → JSON of everything held about the person
// POST {op:"erase", customerId, reason, requestId, confirmEmail}             → privacy erase (account must be closed)
// POST {op:"staff-actions", customerId}                                      → staff actions on that customer
// POST {op:"cancel-plan", customerId, reason, requestId}                     → stop Pack Pass renewal {processorCanceled, perksUntil}
// POST {op:"nexus"}                                                          → sales tax economic nexus report
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { brokerActor, cardBrokerAuthorized } from "../site/core/internal-auth.server";
import {
  AdminError, addOrderNote, adjustBalance, cancelPlan, closeAccount, customerStaffActions, eraseCustomer, exportCustomer, orderDetail, reopenAccount, reversePack, reverseSingle,
} from "../site/core/admin-desk.server";
import { nexusReport } from "../site/core/nexus.server";
import { cancelAtCoinflow } from "../site/payments/coinflow-subscriptions.server";
import { sendPlanCanceledEmail } from "../site/play/plan-emails.server";

export const loader = () => new Response("Not found", { status: 404 });

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST" || !cardBrokerAuthorized(request)) return Response.json({ error: "Unavailable." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 8000) return Response.json({ error: "Too large." }, { status: 413 });
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 422 });
  }
  const actor = brokerActor(request);
  const headers = { "Cache-Control": "no-store" };
  const ok = (v: unknown) => Response.json(v, { headers });
  try {
    switch (b.op) {
      case "adjust":
        return ok(await adjustBalance(db, actor, { customerId: b.customerId, delta: b.delta, reason: b.reason, requestId: b.requestId, visibleNote: b.visibleNote }));
      case "reverse-pack":
        return ok(await reversePack(db, actor, { openingId: b.openingId, reason: b.reason, requestId: b.requestId }));
      case "reverse-single":
        return ok(await reverseSingle(db, actor, { ledgerId: b.ledgerId, reason: b.reason, requestId: b.requestId }));
      case "order":
        return ok(await orderDetail(db, b.type, b.id));
      case "order-note":
        return ok(await addOrderNote(db, actor, { type: b.type, ref: b.id, body: b.body }));
      case "close":
        return ok(await closeAccount(db, actor, { customerId: b.customerId, reason: b.reason, requestId: b.requestId }));
      case "reopen":
        return ok(await reopenAccount(db, actor, { customerId: b.customerId, reason: b.reason, requestId: b.requestId }));
      case "export":
        return ok(await exportCustomer(db, actor, { customerId: b.customerId, reason: b.reason, requestId: b.requestId }));
      case "erase":
        return ok(await eraseCustomer(db, actor, { customerId: b.customerId, reason: b.reason, requestId: b.requestId, confirmEmail: b.confirmEmail }));
      case "staff-actions":
        return ok({ actions: await customerStaffActions(db, b.customerId) });
      case "cancel-plan": {
        const r = await cancelPlan(db, actor, { customerId: b.customerId, reason: b.reason, requestId: b.requestId }, cancelAtCoinflow);
        if (!r.replay && r.subscriptionId) await sendPlanCanceledEmail(db, r.subscriptionId);
        return ok(r);
      }
      case "nexus":
        return ok(await nexusReport(db));
    }
  } catch (e) {
    if (e instanceof AdminError) return Response.json({ error: e.message }, { status: e.status, headers });
    throw e;
  }
  return Response.json({ error: "Unknown op." }, { status: 422, headers });
}
