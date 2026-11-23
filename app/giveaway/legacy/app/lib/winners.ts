import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Pure helpers for winner notices, prize claims and consolation codes. Kept free
// of the database so they can be unit tested.

export const DAY_MS = 86_400_000;

/** Fills {{prize}}, {{title}} and {{claim_url}} (any other {{tag}} is left as typed). */
export function fillTemplate(
  template: string,
  vars: Record<string, string>,
  escape: (s: string) => string = (s) => s,
) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (tag, name: string) =>
    name in vars ? escape(vars[name]) : tag,
  );
}

/** Like fillTemplate, but escapes the merchant's text and inserts `htmlVars` as given. */
export function fillTemplateHtml(
  template: string,
  htmlVars: Record<string, string>,
) {
  return template
    .split(/(\{\{\s*\w+\s*\}\})/)
    .map((part) => {
      const name = /^\{\{\s*(\w+)\s*\}\}$/.exec(part)?.[1];
      return name && name in htmlVars ? htmlVars[name] : escapeHtml(part);
    })
    .join("");
}

/** HTML-escapes text. Braces become entities too, so the result is inert inside Liquid. */
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"'{}]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
        "{": "&#123;",
        "}": "&#125;",
      })[c]!,
  );

export { publicName } from "./names";

// ── Claim tokens ────────────────────────────────────────────────────────────
// Format: "c.<winnerId>.<expires epoch seconds>.<sig>". The "c" prefix and part
// count keep it from ever being mistaken for an entrant token.

const signClaim = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(`claim:${payload}`).digest("base64url");

export function issueClaimToken(
  secret: string,
  winnerId: string,
  expiresAt: Date,
) {
  const payload = `${winnerId}.${Math.floor(expiresAt.getTime() / 1000)}`;
  return `c.${payload}.${signClaim(secret, payload)}`;
}

export function readClaimToken(secret: string, token: string | undefined) {
  const parts = (token ?? "").split(".");
  if (parts.length !== 4 || parts[0] !== "c") return null;
  const [, winnerId, exp, sig] = parts;
  const expected = Buffer.from(signClaim(secret, `${winnerId}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  const expiresAt = new Date(Number(exp) * 1000);
  return {
    winnerId,
    expiresAt,
    expired: Number.isNaN(expiresAt.getTime()) || expiresAt < new Date(),
  };
}

/** When a winner's claim window closes, or null if they haven't been emailed yet. */
export const claimDeadline = (notifiedAt: Date | null, claimDays: number) =>
  notifiedAt ? new Date(notifiedAt.getTime() + claimDays * DAY_MS) : null;

export type ClaimState =
  "claimed" | "forfeited" | "not_sent" | "open" | "expired";

export function claimState(
  w: { claimedAt: Date | null; forfeited: boolean; notifiedAt: Date | null },
  claimDays: number,
  now = new Date(),
): ClaimState {
  if (w.forfeited) return "forfeited";
  if (w.claimedAt) return "claimed";
  const deadline = claimDeadline(w.notifiedAt, claimDays);
  if (!deadline) return "not_sent";
  return deadline < now ? "expired" : "open";
}

const field = (max: number) => z.string().trim().min(1).max(max);
export const claimFormSchema = z.object({
  name: field(120),
  address1: field(200),
  address2: z.string().trim().max(200).default(""),
  city: field(120),
  province: z.string().trim().max(120).default(""),
  zip: field(20),
  country: field(80),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s().-]{7,20}$/, "Enter a valid phone number."),
});
export type ClaimData = z.infer<typeof claimFormSchema>;

// ── Consolation codes ───────────────────────────────────────────────────────

/**
 * Deterministic per entrant, so retrying after a crash finds the code that
 * already exists in Shopify instead of creating a second one.
 */
export function consolationCode(campaignId: string, entrantId: string) {
  const h = createHash("sha256")
    .update(`${campaignId}:${entrantId}`)
    .digest("base64url")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 8)
    .toUpperCase();
  return `PC-THANKS-${h}`;
}

// ── Branded email shell ─────────────────────────────────────────────────────

/** Table-based layout so it renders in Gmail/Outlook. `content` is trusted HTML. */
export function brandedEmail(opts: {
  heading: string;
  content: string;
  button?: { label: string; url: string };
  footer?: string;
}) {
  const display = "Oswald, 'Arial Narrow', Impact, Arial, sans-serif";
  const body = "'Helvetica Neue', Arial, sans-serif";
  const button = opts.button
    ? `<tr><td style="padding:8px 32px 28px" align="center">
<a href="${escapeHtml(opts.button.url)}" style="display:inline-block;padding:14px 28px;border-radius:10px;background:#4057f5;color:#ffffff;font-family:${display};font-weight:700;font-size:16px;letter-spacing:1px;text-transform:uppercase;text-decoration:none">${escapeHtml(opts.button.label)}</a>
</td></tr>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#f1eee4">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1eee4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#161616;padding:22px 32px;border-bottom:4px solid #ffd800">
<div style="font-family:${display};font-weight:700;font-size:14px;letter-spacing:2px;color:#ffd800;text-transform:uppercase">Cardbit Giveaways</div>
<h1 style="margin:8px 0 0;font-family:${display};font-weight:700;font-size:28px;line-height:1.15;color:#ffffff;text-transform:uppercase">${escapeHtml(opts.heading)}</h1>
</td></tr>
<tr><td style="padding:28px 32px 12px;font-family:${body};font-size:16px;line-height:1.55;color:#1a1a1a">${opts.content}</td></tr>
${button}
<tr><td style="padding:16px 32px;background:#1a1a1a;font-family:${body};font-size:12px;line-height:1.5;color:#bdbdbd">${opts.footer ?? "Cardbit &middot; cardbit.com"}</td></tr>
</table></td></tr></table></body></html>`;
}

/** Turns plain text (already escaped) into paragraphs. */
export const paragraphs = (escaped: string) =>
  escaped
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
