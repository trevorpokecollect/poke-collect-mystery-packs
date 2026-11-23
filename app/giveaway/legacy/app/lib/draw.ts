import { createHash, createHmac, randomBytes } from "node:crypto";

// Weighted winner draw. A random seed drives a deterministic HMAC stream, and the
// seed plus a hash of the eligible snapshot are saved on the Draw, so anyone can
// re-run the draw later and get the same winners.

export interface Ticket {
  entrantId: string;
  entries: number;
}

export function snapshotHash(tickets: Ticket[]) {
  const lines = sortTickets(tickets).map((t) => `${t.entrantId}:${t.entries}`);
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export function newSeed() {
  return randomBytes(32).toString("hex");
}

function sortTickets(tickets: Ticket[]) {
  return tickets
    .filter((t) => t.entries > 0)
    .sort((a, b) => a.entrantId.localeCompare(b.entrantId));
}

/** Uniform integer in [0, max) from the seed stream, using rejection sampling to avoid modulo bias. */
function* uniformStream(seed: string, round: number, max: number) {
  const limit = 2 ** 48 - (2 ** 48 % max);
  for (let counter = 0; ; counter++) {
    const block = createHmac("sha256", Buffer.from(seed, "hex"))
      .update(`${round}:${counter}`)
      .digest();
    const value = block.readUIntBE(0, 6);
    if (value < limit) yield value % max;
  }
}

export function drawWinners(
  tickets: Ticket[],
  count: number,
  seed: string,
): string[] {
  let pool = sortTickets(tickets);
  const winners: string[] = [];
  let round = 0;
  while (winners.length < count && pool.length > 0) {
    const total = pool.reduce((s, t) => s + t.entries, 0);
    // A fresh stream per round keeps each pick independent of earlier rejections.
    const pick = uniformStream(seed, round, total).next().value as number;
    let acc = 0;
    const idx = pool.findIndex((t) => (acc += t.entries) > pick);
    winners.push(pool[idx].entrantId);
    // Each entrant can win at most once.
    pool = pool.filter((_, i) => i !== idx);
    round++;
  }
  return winners;
}
