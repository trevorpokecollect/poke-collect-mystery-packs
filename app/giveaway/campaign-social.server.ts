import type { EntryAction } from "@prisma/client";
import db from "../db.server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { drawWindow, SOCIAL, type Social } from "./rules";
import { lockDesk, post } from "./entries.server";
import { award } from "./legacy/app/lib/entries/ledger.server";
export function sharedTask(
  action: Pick<EntryAction, "type" | "config">,
): Social | "share" | null {
  if (action.type === "SOCIAL_SHARE") return "share";
  if (action.type !== "SOCIAL_FOLLOW") return null;
  const href = String((action.config as { url?: string } | null)?.url ?? "");
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, ""),
    p = u.pathname.toLowerCase().replace(/\/$/, "");
  if (host === "whatnot.com" && p === "/invite/pokecollectcards")
    return "whatnot";
  if (host === "instagram.com" && p === "/cardbitshop") return "instagram";
  if (
    host === "facebook.com" &&
    (p === "/cardbitshop" ||
      (p === "/profile.php" && u.searchParams.get("id") === "61596993114628"))
  )
    return "facebook";
  return null;
}
export async function claimCampaignSocial(
  action: EntryAction,
  entrant: { id: string; shopifyCustomerId: string | null },
  task: Social | "share",
) {
  const customerId = entrant.shopifyCustomerId;
  if (!customerId) return false;
  return db.$transaction(async (tx) => {
    await lockDesk(tx);
    const person = await tx.cardbitGiveawayPerson.findUnique({
      where: { shop_customerId: { shop, customerId } },
    });
    if (!person?.whatnotAt || person.held) return false;
    const { day } = drawWindow(new Date()),
      key =
        task === "share"
          ? "share:" + day + ":" + customerId
          : task + ":" + customerId;
    const old = await tx.cardbitGiveawayEvent.findUnique({
      where: { shop_key: { shop, key } },
    });
    const cfg = await tx.cardbitGiveawayConfig.findUnique({ where: { shop } });
    const points =
      task === "whatnot" || old
        ? 0
        : task === "share"
          ? (cfg?.shareEntries ?? 100)
          : SOCIAL[task].entries;
    if (!old && task !== "whatnot")
      await post(tx, {
        day,
        customerId,
        key,
        kind: task,
        entries: 0,
        note: "Awarded in campaign " + action.campaignId,
      });
    const recorded = await award(
      {
        campaignId: action.campaignId,
        entrantId: entrant.id,
        entries: points,
        source: "ACTION",
        actionId: action.id,
        dedupeKey:
          "account-task:" +
          action.id +
          ":" +
          entrant.id +
          (task === "share" ? ":" + day : ""),
      },
      tx,
    );
    return recorded && points > 0;
  });
}
