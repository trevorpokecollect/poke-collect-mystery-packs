// Transactional email transport for the standalone site. Resend over HTTP (same provider the
// giveaway mailer uses), with its own keys so the site never shares the giveaway sender.
//   CARDBIT_SITE_RESEND_API_KEY   re_…   (Resend → API Keys, "Sending access", domain cardbit.com)
//   CARDBIT_SITE_MAIL_FROM        "Cardbit <hello@cardbit.com>"
//   CARDBIT_SITE_MAIL_REPLY_TO    optional, defaults to hello@cardbit.com
// Without a key the message is logged (local dev / tests).

export type OutgoingMail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Provider-side dedupe so a retry after a timeout can't send twice. */
  idempotencyKey: string;
  tags?: Record<string, string>;
};

export type SendResult = { id: string | null };

export class MailRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailRejected";
  }
}

export interface Mailer {
  send(mail: OutgoingMail): Promise<SendResult>;
  readonly live: boolean;
}

export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): Mailer {
  const key = env.CARDBIT_SITE_RESEND_API_KEY;
  const from = env.CARDBIT_SITE_MAIL_FROM || "Cardbit <hello@cardbit.com>";
  const replyTo = env.CARDBIT_SITE_MAIL_REPLY_TO || "hello@cardbit.com";
  return key ? new ResendMailer(key, from, replyTo, fetcher) : new LogMailer();
}

export class ResendMailer implements Mailer {
  readonly live = true;
  constructor(
    private key: string,
    private from: string,
    private replyTo: string,
    private fetcher: typeof fetch = fetch,
  ) {}

  async send(mail: OutgoingMail): Promise<SendResult> {
    const res = await this.fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": mail.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: this.from,
        to: [mail.to],
        reply_to: this.replyTo,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        tags: Object.entries(mail.tags ?? {}).map(([name, value]) => ({
          name,
          value: value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256),
        })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (res.status === 422 || res.status === 400) throw new MailRejected(body.message || `Rejected (${res.status})`);
    if (!res.ok) throw new Error(`Email send failed: ${res.status} ${body.message ?? ""}`.trim());
    return { id: body.id ?? null };
  }
}

export class LogMailer implements Mailer {
  readonly live = false;
  sent: OutgoingMail[] = [];
  async send(mail: OutgoingMail): Promise<SendResult> {
    this.sent.push(mail);
    if (process.env.NODE_ENV !== "test")
      console.info(`[site-mail:log] to=${mail.to} subject=${JSON.stringify(mail.subject)}`);
    return { id: null };
  }
}
