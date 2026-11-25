// Transactional email outbox. Each logical email has a dedupeKey (e.g. "pack_opened:<pullId>"),
// stored once in SiteEmail, so replays, refreshes and retried jobs can never send it twice.
// Call sites enqueue AFTER their own transaction commits; sendPendingEmails() retries failures.

import type { PrismaClient, SiteEmail, SiteShipment } from "@prisma/client";
import type { ShipEmailKind } from "../shipping/service.server";
import type { Address } from "../shipping/shippo.server";
import { MailRejected, type Mailer } from "./mailer.server";
import { renderEmail, type EmailData, type EmailKind } from "./templates";

const MAX_ATTEMPTS = 6;
/** Fields that must never be stored in the outbox payload. */
const SECRET_FIELDS: Partial<Record<EmailKind, string[]>> = { signin_code: ["code"] };

export type EmailDeps = { db: PrismaClient; mailer: Mailer; env?: NodeJS.ProcessEnv };

export async function sendEmail<K extends EmailKind>(
  deps: EmailDeps,
  kind: K,
  to: string,
  data: EmailData[K],
  dedupeKey: string,
): Promise<SiteEmail> {
  const address = to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new MailRejected("Invalid email address.");
  const rendered = renderEmail(kind, data, deps.env);
  const key = `${kind}:${dedupeKey}`.slice(0, 190);
  const stored = redact(kind, data);

  let row: SiteEmail;
  try {
    row = await deps.db.siteEmail.create({
      data: { kind, to: address, subject: rendered.subject, dedupeKey: key, payload: stored as object },
    });
  } catch (err) {
    if ((err as { code?: string }).code !== "P2002") throw err;
    return deps.db.siteEmail.findUniqueOrThrow({ where: { dedupeKey: key } });
  }
  return deliver(deps, row, rendered);
}

async function deliver(deps: EmailDeps, row: SiteEmail, rendered: ReturnType<typeof renderEmail>) {
  // Claim the row so two workers never send the same message at once.
  const claim = await deps.db.siteEmail.updateMany({
    where: { id: row.id, status: { in: ["PENDING", "FAILED"] }, attempts: row.attempts },
    data: { attempts: { increment: 1 } },
  });
  if (claim.count !== 1) return deps.db.siteEmail.findUniqueOrThrow({ where: { id: row.id } });
  try {
    const res = await deps.mailer.send({
      to: row.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: row.dedupeKey,
      tags: { kind: row.kind },
    });
    return deps.db.siteEmail.update({
      where: { id: row.id },
      data: { status: "SENT", providerId: res.id, sentAt: new Date(), error: null },
    });
  } catch (err) {
    const rejected = err instanceof MailRejected;
    return deps.db.siteEmail.update({
      where: { id: row.id },
      data: {
        status: rejected ? "REJECTED" : "FAILED",
        error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      },
    });
  }
}

/** Retries FAILED emails with backoff (attempt n waits 2^n minutes). Run from the site cron. */
export async function sendPendingEmails(deps: EmailDeps, now = new Date()) {
  const rows = await deps.db.siteEmail.findMany({
    where: {
      OR: [
        { status: "FAILED", attempts: { lt: MAX_ATTEMPTS } },
        { status: "PENDING", createdAt: { lt: new Date(now.getTime() - 120_000) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  let sent = 0;
  for (const row of rows) {
    if (row.status === "FAILED" && now.getTime() - row.updatedAt.getTime() < 2 ** row.attempts * 60_000) continue;
    if (SECRET_FIELDS[row.kind as EmailKind]) {
      // Codes aren't stored; a stale sign-in email isn't worth resending. The customer asks again.
      await deps.db.siteEmail.update({ where: { id: row.id }, data: { status: "REJECTED", error: "expired, not retried" } });
      continue;
    }
    const rendered = renderEmail(row.kind as EmailKind, row.payload as never, deps.env);
    const done = await deliver(deps, row, rendered);
    if (done.status === "SENT") sent++;
  }
  return { checked: rows.length, sent };
}

function redact(kind: EmailKind, data: unknown) {
  const hide = SECRET_FIELDS[kind];
  if (!hide || !data || typeof data !== "object") return data;
  const copy: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const f of hide) copy[f] = "[redacted]";
  return copy;
}

// ---------- shipping glue ----------

/** ShipNotifier for the shipping service: maps a shipment to its customer email. */
export function shipmentNotifier(deps: EmailDeps) {
  return async (kind: ShipEmailKind, s: SiteShipment & { items: { title: string }[] }) => {
    if (!s.toEmail) return;
    const cards = s.items.map((i) => i.title);
    if (kind === "shipment_created") {
      const a = s.toAddress as unknown as Address;
      await sendEmail(deps, kind, s.toEmail, {
        shipmentId: s.id,
        cards,
        feeKind: s.feeKind as "FREE" | "CARDBITS" | "USD",
        processBy: s.processBy.toISOString(),
        address: { name: a.name, street1: a.street1, street2: a.street2, city: a.city, state: a.state, zip: a.zip },
      }, s.id);
    } else if (kind === "shipment_shipped") {
      await sendEmail(deps, kind, s.toEmail, {
        shipmentId: s.id,
        cards,
        carrier: s.carrier ?? "",
        trackingNumber: s.trackingNumber ?? "",
        trackingUrl: s.trackingUrl,
      }, s.id);
    } else {
      await sendEmail(deps, kind, s.toEmail, { shipmentId: s.id, cardCount: s.cardCount, trackingUrl: s.trackingUrl }, s.id);
    }
  };
}
