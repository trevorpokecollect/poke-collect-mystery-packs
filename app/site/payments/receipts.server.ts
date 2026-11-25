import type { SiteTopup } from "@prisma/client";
import db from "../../db.server";
import { mailerFromEnv } from "../email/mailer.server";
import { sendEmail } from "../email/outbox.server";

/** Sends the topup_receipt email once per top-up. */
export function topupReceiptSender(env: NodeJS.ProcessEnv = process.env) {
  return async (t: SiteTopup, balance: number, email: string) => {
    await sendEmail(
      { db, mailer: mailerFromEnv(env), env },
      "topup_receipt",
      email,
      { orderId: t.id, paidCents: t.cents, bits: t.baseBits, bonusBits: t.bonusBits, balanceBits: balance, paymentLabel: "Card (Coinflow)" },
      t.id,
    );
  };
}
