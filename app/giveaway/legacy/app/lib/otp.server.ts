import { createHash, randomInt } from "node:crypto";
import db from "../db.server";
import { sendMail } from "./mailer.server";

const TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;

const hashCode = (entrantId: string, code: string) =>
  createHash("sha256").update(`${entrantId}:${code}`).digest("hex");

export async function issueOtp(
  entrant: { id: string; email: string },
  campaignTitle: string,
) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.emailOtp.create({
    data: {
      entrantId: entrant.id,
      codeHash: hashCode(entrant.id, code),
      expiresAt: new Date(Date.now() + TTL_MINUTES * 60_000),
    },
  });
  await sendMail({
    to: entrant.email,
    subject: `Your code for ${campaignTitle}: ${code}`,
    text: `Your verification code is ${code}. It expires in ${TTL_MINUTES} minutes.`,
    html: `<p>Your verification code is <strong style="font-size:20px">${code}</strong>.</p><p>It expires in ${TTL_MINUTES} minutes.</p>`,
  });
}

export async function checkOtp(entrantId: string, code: string) {
  const otp = await db.emailOtp.findFirst({
    where: { entrantId, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.attempts >= MAX_ATTEMPTS) return false;
  if (otp.codeHash !== hashCode(entrantId, code.trim())) {
    await db.emailOtp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    return false;
  }
  await db.emailOtp.update({
    where: { id: otp.id },
    data: { usedAt: new Date() },
  });
  return true;
}
