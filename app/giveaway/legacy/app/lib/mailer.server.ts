// Transactional email (verification codes, winner notices) via Resend's HTTP API.
// Without RESEND_API_KEY the message is logged instead, which is fine for local dev.

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Resend refused the address itself (422), as opposed to an outage. Callers can show a friendly
// "check your email" message instead of a 500.
export class MailAddressRejected extends Error {}

export async function sendMail(mail: Mail) {
  const key = process.env.CARDBIT_GIVEAWAY_RESEND_API_KEY;
  const from = process.env.CARDBIT_GIVEAWAY_MAIL_FROM;
  if (!key || !from) throw Error("Connect the Cardbit giveaway sender.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, ...mail }),
  });
  if (!res.ok) {
    const message = `Email send failed: ${res.status}`;
    if (res.status === 422) throw new MailAddressRejected(message);
    throw new Error(message);
  }
}
