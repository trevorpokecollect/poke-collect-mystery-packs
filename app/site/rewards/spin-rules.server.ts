// Official Rules C4 (Daily Spinner prizes and odds), drawn from the live site prize table so the rules always match
// what a spin pays. Staff change the table in Card Broker → Pools → Daily Spin Prizes; the page shows the date of the
// last change. Card caps and the total cap come from rewards/spin-pools.server.ts, which enforces them on every draw.
import type { PrismaClient } from "@prisma/client";
import { SPINNER_TIERS } from "../../lib/cardbit-levels";
import { DEFAULT_SPIN_TABLE, STREAK_CARD_BONUS, displayOdds, weightedSlices, type SpinTable } from "../../lib/cardbit-spinner";
import { siteSpinTableUpdatedAt, spinTable } from "../../lib/cardbit-spinner.server";
import { SITE_SHOP } from "./rewards.server";
import { SPIN_CARD_CAP_BITS, SPIN_TOTAL_CAP_BITS } from "./spin-pools.server";

const n = (v: number) => v.toLocaleString("en-US");
const pct = (v: number) => v.toFixed(1) + "%";
const usd = (bits: number) => "$" + (bits / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (name: string) => name.replace(/ Spin$/, "");
const list = (items: string[]) => (items.length <= 1 ? items.join("") : items.slice(0, -1).join(", ") + " and " + items[items.length - 1]);

export function spinRulesHtml(table: SpinTable, updatedAt: Date | null) {
  const rows = SPINNER_TIERS.map((t) => {
    const slices = table[t.id] ?? DEFAULT_SPIN_TABLE[t.id];
    const odds = displayOdds(slices);
    const card = odds.filter((o) => o.kind === "card").reduce((a, o) => a + o.percent, 0);
    const cell = (kind: "sparks" | "xp") =>
      odds
        .filter((o) => o.kind === kind && o.percent > 0)
        .sort((a, b) => (b.max ?? b.amount ?? 0) - (a.max ?? a.amount ?? 0))
        .map((o) => `${o.max ? `${n(o.amount!)}–${n(o.max)}` : n(o.amount!)} ${kind === "sparks" ? "Sparks" : "XP"}, ${pct(o.percent)}`)
        .join("<br>") || "—";
    const full = displayOdds(weightedSlices(slices, STREAK_CARD_BONUS.maxDays)).filter((o) => o.kind === "card").reduce((a, o) => a + o.percent, 0);
    return { name: short(t.name), card, sparks: cell("sparks"), xp: cell("xp"), full, cap: SPIN_CARD_CAP_BITS[t.id] ?? 0 };
  });
  const changed = updatedAt
    ? ` This prize table was last changed on ${updatedAt.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" })}; a change applies only to spins made after it is posted here.`
    : "";
  return `<p>Each spin awards exactly one of these results, using the table for the tier being spun. A result shown as a range (for example, 25–50 Sparks) pays a whole number in that range, each number equally likely.${changed}</p>
<table>
<thead>
<tr>
<th>Tier</th>
<th>Card prize</th>
<th>Sparks</th>
<th>XP</th>
</tr>
</thead>
<tbody>
${rows.map((r) => `<tr>
<td>${r.name}</td>
<td>${pct(r.card)}</td>
<td>${r.sparks}</td>
<td>${r.xp}</td>
</tr>`).join("\n")}
</tbody>
</table>
<p><strong>Check-in streak.</strong> Each consecutive day you check in raises the weight of the card-prize result on every tier by ${Math.round(STREAK_CARD_BONUS.perDay * 100)}% of its base weight, up to ${STREAK_CARD_BONUS.maxDays} days (+${Math.round(STREAK_CARD_BONUS.perDay * STREAK_CARD_BONUS.maxDays * 100)}%). The bonus applies only to Daily Spins and does not change the odds of any pack, the Spark Shop or any other promotion. It applies to online and Mail-In spins alike and resets to zero when you miss a daily check-in. With a full ${STREAK_CARD_BONUS.maxDays}-day streak, the card-prize odds are about <strong>${list(rows.map((r) => `${pct(r.full)} (${r.name})`))}</strong>, and the other results shrink proportionally. Check-ins are free.</p>
<p><strong>Card prizes</strong> come from a separate prize pool of real cards for each tier. Each card is reserved for one winner only, and a card result is drawn at random, each qualifying card equally likely, from the cards in that tier's pool at the time of the spin. <strong>Maximum ARV of one card prize: ${list(rows.map((r) => `${r.name} ${usd(r.cap)}`))}.</strong> ARV is the card's Cardbit price at the time of the spin; cards above the maximum are never awarded. If no card in a tier's pool qualifies, a card result pays that tier's highest Sparks result instead.</p>
<p><strong>Sparks</strong> are awarded only while the Sparks program is active. Otherwise, a Sparks result pays the same number of XP.</p>
<p><strong>Total prize value.</strong> Sponsor will not award card prizes with a total ARV over <strong>${usd(SPIN_TOTAL_CAP_BITS)}</strong> during the Promotion Period. Once that total is reached, card results pay the tier's highest Sparks result.</p>`;
}

export async function siteSpinRulesHtml(db: PrismaClient) {
  try {
    const [table, updatedAt] = await Promise.all([spinTable(db, SITE_SHOP), siteSpinTableUpdatedAt(db)]);
    return spinRulesHtml(table, updatedAt);
  } catch {
    // Database unreachable: never serve rules without the prize table. The page errors instead of guessing.
    throw new Response("The Official Rules are briefly unavailable. Please try again in a minute.", { status: 503, headers: { "Retry-After": "60" } });
  }
}
