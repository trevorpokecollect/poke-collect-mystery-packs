// Nightly Cardbits integrity check for the standalone site. Every wallet balance must equal the sum of
// its ledger rows, no balance may be negative, and each customer's latest ledger row must show the
// balance the wallet has. Any mismatch emails staff (SITE_ALERT_EMAILS, else SITE_STAFF_EMAILS).
// Read-only: it never changes a balance.
import type { PrismaClient } from "@prisma/client";
import { mailerFromEnv, type Mailer } from "../email/mailer.server";

export type LedgerProblem = { customerId: string; email: string | null; wallet: number; ledgerSum: number; lastBalanceAfter: number | null; problem: string };

export async function checkLedger(db: PrismaClient): Promise<{ wallets: number; problems: LedgerProblem[]; owedBits: number }> {
  const rows = await db.$queryRaw<{ customerId: string; email: string | null; wallet: number | null; ledgerSum: bigint | null; lastBalanceAfter: number | null }[]>`
    WITH sums AS (SELECT "customerId", SUM(delta)::bigint AS s FROM "SiteLedger" GROUP BY "customerId"),
         last AS (SELECT DISTINCT ON ("customerId") "customerId", "balanceAfter" FROM "SiteLedger" ORDER BY "customerId", "createdAt" DESC, id DESC),
         ids AS (SELECT "customerId" FROM "SiteWallet" UNION SELECT "customerId" FROM sums)
    SELECT ids."customerId", c.email, w.balance AS wallet, sums.s AS "ledgerSum", last."balanceAfter" AS "lastBalanceAfter"
    FROM ids
    LEFT JOIN "SiteWallet" w ON w."customerId" = ids."customerId"
    LEFT JOIN sums ON sums."customerId" = ids."customerId"
    LEFT JOIN last ON last."customerId" = ids."customerId"
    LEFT JOIN "SiteCustomer" c ON c.id = ids."customerId"`;
  const problems: LedgerProblem[] = [];
  for (const r of rows) {
    const wallet = r.wallet ?? 0;
    const ledgerSum = Number(r.ledgerSum ?? 0);
    const base = { customerId: r.customerId, email: r.email, wallet, ledgerSum, lastBalanceAfter: r.lastBalanceAfter };
    if (wallet < 0) problems.push({ ...base, problem: "negative balance" });
    if (wallet !== ledgerSum) problems.push({ ...base, problem: "wallet does not match ledger total" });
    // Same-millisecond rows can tie on createdAt, so only flag when the total also disagrees with it.
    else if (r.lastBalanceAfter != null && r.lastBalanceAfter !== wallet) problems.push({ ...base, problem: "latest ledger row shows a different balance" });
  }
  const owed = await db.siteTopup.aggregate({ _sum: { owedBits: true } });
  return { wallets: rows.length, problems, owedBits: owed._sum.owedBits ?? 0 };
}

export async function runLedgerCheck(db: PrismaClient, env: NodeJS.ProcessEnv = process.env, mailer: Mailer = mailerFromEnv(env)) {
  const r = await checkLedger(db);
  if (!r.problems.length) {
    console.info(`[site-ledger] ok: ${r.wallets} wallets match the ledger`);
    return r;
  }
  console.error(`[site-ledger] ${r.problems.length} problem(s)`, JSON.stringify(r.problems.slice(0, 20)));
  const to = (env.SITE_ALERT_EMAILS || env.SITE_STAFF_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);
  const day = new Date().toISOString().slice(0, 10);
  const text = `The nightly Cardbits check found ${r.problems.length} problem(s). No balances were changed.\n\n${r.problems
    .slice(0, 50)
    .map((p) => `• ${p.email ?? p.customerId}: ${p.problem} (wallet ${p.wallet}, ledger ${p.ledgerSum})`)
    .join("\n")}\n\nTell Claude in the Cardbit project so it can investigate before anyone spends more.`;
  for (const addr of to)
    await mailer
      .send({ to: addr, subject: "Cardbit: Cardbits balance check failed", text, html: `<pre style="font:14px/1.5 system-ui,sans-serif;white-space:pre-wrap">${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>`, idempotencyKey: `ledger-check:${day}:${addr}`, tags: { kind: "ledger_check" } })
      .catch((e) => console.error("[site-ledger] alert failed", (e as Error).message));
  return r;
}

let timer: ReturnType<typeof setInterval> | undefined;
let lastDay = "";
/** Once a day at 3 AM Central or later (checked hourly). Production only; SITE_LEDGER_CHECK=off disables it. */
export function startLedgerCheckClock(db: PrismaClient) {
  if (timer || process.env.CARDBIT_SITE !== "on" || process.env.NODE_ENV !== "production" || process.env.SITE_LEDGER_CHECK === "off") return;
  const tick = () => {
    const now = new Date();
    const ctDay = now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const ctHour = Number(now.toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }));
    if (ctDay === lastDay || ctHour < 3) return;
    lastDay = ctDay;
    void runLedgerCheck(db).catch((e) => console.error("[site-ledger] check failed", (e as Error).message));
  };
  timer = setInterval(tick, 3_600_000);
  timer.unref();
}
