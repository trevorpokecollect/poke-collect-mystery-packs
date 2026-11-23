import { randomUUID } from "node:crypto";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { CARDBIT_SHOP as shop } from "../lib/cardbit.server";
import { liveWorkspace } from "../workspace/mode.server";
import { activeRound, lockDesk } from "./entries.server";
import { closeDue } from "./draw.server";
import { notifyWinners } from "./notify.server";
import { tickDaily } from "./legacy/app/lib/daily.server";
const key = "cardbit:giveaway:clock";
export async function runGiveawayClock() {
  const [config, campaign, pending] = await Promise.all([
    db.cardbitGiveawayConfig.findUnique({ where: { shop } }),
    db.campaign.findFirst({
      where: { shop, status: "ACTIVE" },
      select: { id: true },
    }),
    db.cardbitGiveawayRound.findFirst({
      where: { shop, winnerId: { not: null }, notifiedAt: null },
      select: { day: true },
    }),
  ]);
  if (!config?.enabled && !campaign && !pending)
    return { closed: 0, notified: 0, campaignErrors: 0 };
  const token = randomUUID();
  const claimed = await db.$transaction(async (tx) => {
    await lockDesk(tx);
    const row = await tx.appValue.findUnique({ where: { key } });
    if (row && row.updatedAt.getTime() > Date.now() - 300000) return false;
    await tx.appValue.upsert({
      where: { key },
      create: { key, value: token },
      update: { value: token },
    });
    if (config?.enabled) await activeRound(tx, new Date());
    return true;
  });
  if (!claimed) return { closed: 0, notified: 0, campaignErrors: 0 };
  try {
    const { admin, session } = await unauthenticated.admin(shop);
    if (session.shop !== shop) throw Error("Incorrect Cardbit installation.");
    const closed = config?.enabled ? await closeDue(db, admin) : 0;
    const advanced = campaign ? await tickDaily() : null;
    const notified = await notifyWinners(db, admin);
    return { closed, notified, campaignErrors: advanced?.errors?.length ?? 0 };
  } finally {
    await db.appValue.deleteMany({ where: { key, value: token } });
  }
}
let timer: ReturnType<typeof setInterval> | undefined;
export function startGiveawayClock() {
  if (timer || !liveWorkspace(shop) || process.env.NODE_ENV !== "production")
    return;
  const tick = () => {
    void runGiveawayClock()
      .then((r) => {
        if (r.campaignErrors)
          console.error("Cardbit giveaway campaign needs review.");
      })
      .catch(() => console.error("Cardbit giveaway clock will retry."));
  };
  timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
}
