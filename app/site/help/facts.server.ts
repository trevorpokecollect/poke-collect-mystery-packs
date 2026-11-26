// Ask Latch "site facts": numbers and rules taken straight from the code that runs the site, so answers about
// levels, spins, Sparks, Pack Pass, limits and the Verified Shuffle match what the site actually does.
// Never includes card values, tier value cutoffs, EV or retail prices (internal only).
import type { PrismaClient } from "@prisma/client";
import { ICONS, MAX_LEVEL, RANKS, SPINNER_TIERS, XP_RULES, xpForLevel } from "../../lib/cardbit-levels";
import { SPARK_RATE_PERCENT, SPARK_TIERS } from "../../lib/cardbit-sparks";
import { STREAK_CARD_BONUS } from "../../lib/cardbit-spinner";
import { PLAN } from "../play/plan-brand";
import { COOL_OFF_HOURS, EXCLUSION_MONTHS, RAISE_DELAY_MS } from "../play/limits.server";
import { SHUFFLE_HOW } from "../play/shuffle-copy";
import { TIERS } from "../play/subscriptions.server";
import { storeState } from "../store/store.server";
import { htmlToText } from "./knowledge.server";

const n = (v: number) => v.toLocaleString("en-US");
const hours = (h: number) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hours`);
const months = (m: number) => (m % 12 === 0 ? `${m / 12} year${m === 12 ? "" : "s"}` : `${m} months`);

/** Stable facts (same text all deploy, so it sits in the cached prompt). */
export function siteFacts(plansOpen: boolean): string {
  const levelSteps = [2, 5, 10, 20, 30, 40, 50].map((l) => `Level ${l}: ${n(xpForLevel(l))} XP`).join("; ");
  const lines = [
    "## Levels and XP (cardbit.com/rewards)",
    `- XP comes from paid pack openings: ${XP_RULES.perCardbitsSpent * 100} XP per 100 Cardbits spent ($1 = 100 Cardbits). A daily check-in gives ${XP_RULES.dailyCheckIn} XP. Free spins and free openings don't earn pack XP.`,
    "- XP has no cash value and never turns into Cardbits.",
    `- Levels go from 1 to ${MAX_LEVEL}. Total XP needed: ${levelSteps}.`,
    `- Ranks shown beside the level: ${RANKS.map((r) => `${r.name} (Level ${r.minLevel})`).join(", ")}.`,
    `- Latch & Friends icons: ${ICONS.map((i) => `${i.name} (Level ${i.minLevel})`).join(", ")}. Members can also pick a color for their initials instead.`,
    "",
    "## Daily Spins (cardbit.com/rewards)",
    `- Every spin you've unlocked is free once per Cardbit day. Spins unlock by level: ${SPINNER_TIERS.map((t) => `${t.name} (Level ${t.minLevel})`).join(", ")}. Leveling up adds more free spins each day; higher spins have better prizes.`,
    "- Prizes can be a real card from that spin's pool, Sparks, or XP. The exact odds for each spin are shown on the Rewards page under What You Can Win; send people there rather than quoting numbers.",
    `- Check-in streak: each day in a row adds ${STREAK_CARD_BONUS.perDay * 100}% to the chance of a card prize, up to ${STREAK_CARD_BONUS.maxDays} days (+${Math.round(STREAK_CARD_BONUS.perDay * STREAK_CARD_BONUS.maxDays * 100)}%). Missing a day resets it.`,
    "- No purchase necessary; the Official Rules describe the free mail-in method.",
    "",
    "## Weekly Leaderboard (cardbit.com/leaderboard)",
    "- Every Cardbit spent on packs is 1 point. The top 10 each week win Cardbits. The week runs Monday 12:00 AM to Sunday 11:59 PM Central. Free spins and free openings don't count; refunded openings are removed. Prizes are added to winners' balances after the week is reviewed.",
    "",
    "## Sparks and the Spark Shop",
    `- When a paid pack's pulled sell-back value is below the Cardbits paid, you earn Sparks equal to ${SPARK_RATE_PERCENT}% of the difference. Daily Spins can also give Sparks.`,
    "- Sparks have no cash value, can't be transferred, and are spent only in the Spark Shop.",
    `- Spark Shop cards come in price levels: ${SPARK_TIERS.map((t) => `${n(t.sparks)} Sparks`).join(", ")}, depending on the card.`,
    "",
    "## Limits and Breaks (cardbit.com/account/limits, signed in)",
    "- Anyone signed in can set daily, weekly or monthly limits on top-ups ($1 to $10,000) and on spending (100 to 1,000,000 Cardbits).",
    `- Lowering a limit works right away. Raising or removing one takes effect after ${RAISE_DELAY_MS / 3_600_000} hours.`,
    `- Cool-off breaks: ${COOL_OFF_HOURS.map(hours).join(", ")}. Self-exclusion: ${EXCLUSION_MONTHS.map(months).join(", ")}. Neither can be shortened or canceled once started.`,
    "- During a break, top-ups, pack and single purchases, Daily Spins and subscriptions are paused. The Vault, shipping and sell-backs stay available. To also close the account, email support.",
    "- Free, confidential help: call or text 1-800-GAMBLER (1-800-426-2537).",
    "",
    "## Verified Shuffle (cardbit.com/verified-shuffle)",
    htmlToText(SHUFFLE_HOW),
  ];
  if (plansOpen) {
    lines.push(
      "",
      `## ${PLAN.name} monthly plans (cardbit.com${PLAN.path})`,
      ...TIERS.map(
        (t) =>
          `- ${t.name}: $${(t.cents / 100).toFixed(2)}/month. Each paid month adds ${n(t.monthlyBits)} Cardbits + ${n(t.bonusBits)} bonus Cardbits, +${t.xpBonusPct}% XP from packs and +${t.sparksBonusPct}% Sparks.`,
      ),
      `- Cosmetic perks: every plan puts a ${PLAN.name} portrait frame (Plus, Pro or Ultimate) around the member's icon and opens the members' chat room. Pro and Ultimate unlock 4 animated emotes (Hype, Love, LOL, Shocked) for every Latch & Friends character, picked on the Rewards page. Ultimate also gets Legendary emotes. Emotes switch back to the regular icon when the plan ends.`,
      `- Other perks: Pro ships one Ship Together shipment free each calendar month (Central time); Ultimate ships every shipment free. Ultimate sell-back offers are 85% of market instead of 80% (never above the card's price). Linking Discord on the account page gives members the ${PLAN.name} Discord role. Perks never add spins, entries, points or better odds.`,
      `- ${PLAN.name} never adds Daily Spins, giveaway entries or leaderboard points. Cancel any time; perks last until the paid month ends. A break (cool-off or self-exclusion) stops renewal.`,
    );
  } else {
    lines.push("", `## ${PLAN.name}`, `- Monthly plans called ${PLAN.name} are coming soon. Don't give prices or perks yet; say they're coming soon.`);
  }
  return lines.join("\n");
}

// ---- Live packs ---------------------------------------------------------------------------------

type PackFacts = { at: number; text: string };
let packCache: PackFacts | null = null;
const PACK_TTL_MS = 5 * 60_000;
const TOP_TIERS = ["Legendary", "Epic"];

/** What the pack pages show right now: price, cards per pack, packs left, tier odds and top-tier card names. */
export async function packFacts(db: PrismaClient, now = Date.now()): Promise<string> {
  if (packCache && now - packCache.at < PACK_TTL_MS) return packCache.text;
  let text = "";
  try {
    const { packs } = await storeState(db, null);
    text = packs
      .map((p) => {
        const total = p.cards.length;
        const counts = new Map<string, number>();
        for (const c of p.cards) if (c.tier) counts.set(c.tier, (counts.get(c.tier) ?? 0) + 1);
        const odds = [...counts.entries()].map(([tier, k]) => `${tier} ${Math.round((k / Math.max(total, 1)) * 1000) / 10}%`).join(", ");
        const top = p.cards
          .filter((c) => c.tier && TOP_TIERS.includes(c.tier))
          .map((c) => `${c.name}${c.set ? ` (${c.set})` : ""} [${c.tier}]`)
          .slice(0, 12);
        return [
          `- ${p.title}: ${n(p.priceBits)} Cardbits ($${(p.priceBits / 100).toFixed(2)}), ${p.cardsPerPack} card${p.cardsPerPack === 1 ? "" : "s"} per pack, ${p.remaining > 0 ? `${n(p.remaining)} packs left` : "sold out until the next restock"}.`,
          odds ? `  Each card's tier chance right now: ${odds}.` : "",
          top.length ? `  Top cards in the pool now: ${top.join("; ")}.` : "",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n");
  } catch (e) {
    console.warn("[help] pack facts failed", (e as Error).message);
  }
  packCache = { at: now, text };
  return text;
}

export const resetPackFacts = () => {
  packCache = null;
};
