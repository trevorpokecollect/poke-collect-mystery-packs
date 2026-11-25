// Discord (standalone site): link Discord for the site rank roles and switch the live pulls feed on or off.
// 404 unless CARDBIT_SITE=on. Signed-out visitors go to sign-in. Rules: app/site/community/discord.server.ts.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { esc, htmlResponse, simplePage } from "../site/core/simple-page";
import {
  DiscordLinkError,
  LINK_PATH,
  discordStatus,
  feedTiers,
  pullsFeedConfigured,
  pushLevel,
  rolesConfigured,
  setPullsFeed,
  unlink,
} from "../site/community/discord.server";

const on = () => process.env.CARDBIT_SITE === "on";
const PATH = "/account/discord";
const DISCORD_INVITE = "https://discord.gg/F9Z6jbgj4Y";

/** Form posts must come from this site (blocks cross-site posts riding the session cookie). */
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === new URL(request.url).host || host === request.headers.get("x-forwarded-host");
  } catch {
    return false;
  }
}

async function page(customerId: string, flash?: { ok?: string; error?: string }) {
  const s = await discordStatus(db, customerId);
  const msg = flash?.error
    ? `<p class="err" role="alert">${esc(flash.error)}</p>`
    : flash?.ok
      ? `<p class="note" role="status">${esc(flash.ok)}</p>`
      : "";
  const tiers = feedTiers().join(" and ");
  const ready = rolesConfigured();

  const status = s.linked
    ? `<div class="sum"><span>Discord</span><b>${esc(s.discordName || "Linked")}</b></div>`
    : `<div class="sum"><span>Discord</span><b>Not Linked</b></div>`;
  const level = `<div class="sum"><span>Your Rank</span><b>Level ${s.level} · ${esc(s.rank)}</b></div>`;

  const link = !ready
    ? `<p class="fine">Discord linking opens soon.</p>`
    : !s.linked || s.needsRelink
      ? `${s.needsRelink ? `<p class="err" role="alert">Discord disconnected this link. Link again to keep your rank role.</p>` : ""}
         <a class="btn" href="${LINK_PATH}">Link Discord</a>`
      : `<form method="post"><button class="btn" name="op" value="refresh">Update My Rank Role</button></form>`;

  const how = `<h2>Claim Your Rank Role</h2>
    <p class="fine">1. Join the <a href="${DISCORD_INVITE}" target="_blank" rel="noopener">Cardbit Discord</a>. 2. Link Discord here. 3. In Discord, open the server menu, choose <b>Linked Roles</b>, then pick Cardbit. Your role (Rookie, Collector, Curator, Archivist, Vaultkeeper, Legend or Mythic) follows your level and updates about once an hour.</p>`;

  const feed =
    s.linked && pullsFeedConfigured()
      ? `<h2>Live Pulls Feed</h2>
         <p class="fine">Off unless you turn it on. When it's on, your ${esc(tiers)} pulls are posted in #pulls-showcase on the Cardbit Discord with your Discord name, the card, its set, its tier and the pack. Card values are never posted. Pulls from before you turn it on are never posted.</p>
         <form method="post"><button class="btn${s.sharePulls ? " ghost" : ""}" name="op" value="${s.sharePulls ? "feed_off" : "feed_on"}">${s.sharePulls ? "Stop Sharing My Pulls" : "Share My Big Pulls"}</button></form>`
      : "";

  const unlinkForm = s.linked
    ? `<form method="post"><button class="link" name="op" value="unlink">Unlink Discord</button></form>
       <p class="fine">Unlinking removes your rank role, stops the pulls feed and deletes the link from Cardbit.</p>`
    : "";

  return simplePage(
    "Discord",
    `<style>h2{font:800 1.1rem 'Cardbit Outfit',system-ui,sans-serif;margin:22px 0 4px}.fine{text-align:left}.btn.ghost{background:#26363a;color:var(--ink)}</style>
     <h1>Discord</h1><p class="sub">Show off your Cardbit rank and your best pulls.</p>${msg}
     ${status}${level}${link}${how}${feed}${unlinkForm}
     <p class="fine" style="margin-top:22px">We store your Discord user ID and name so we can update your role. We never see your Discord email or messages. See our <a href="/policies">Privacy Policy</a>. <a href="/account">Back to My Account</a></p>`,
  );
}

const flashFrom = (url: URL) => {
  const error = url.searchParams.get("error");
  if (error) return { error: error.slice(0, 200) };
  if (url.searchParams.get("linked")) return { ok: "Discord linked. Claim your rank role from Linked Roles in the Cardbit Discord." };
  return undefined;
};

export async function loader({ request }: LoaderFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  const customer = await currentCustomer(db, request);
  if (!customer) return new Response(null, { status: 303, headers: { Location: `/sign-in?return_to=${encodeURIComponent(PATH)}` } });
  return htmlResponse(await page(customer.id, flashFrom(new URL(request.url))));
}

export async function action({ request }: ActionFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const customer = await currentCustomer(db, request);
  if (!customer) return new Response(null, { status: 303, headers: { Location: `/sign-in?return_to=${encodeURIComponent(PATH)}` } });
  const op = String((await request.formData()).get("op") || "");
  try {
    if (op === "refresh") {
      const level = await pushLevel(db, customer.id);
      return htmlResponse(await page(customer.id, level === null ? { error: "Discord disconnected this link. Link again to keep your rank role." } : { ok: "Rank role updated." }));
    }
    if (op === "feed_on" || op === "feed_off") {
      if (op === "feed_on" && !pullsFeedConfigured()) throw new DiscordLinkError("The pulls feed isn't open yet.");
      await setPullsFeed(db, customer.id, op === "feed_on");
      return htmlResponse(await page(customer.id, { ok: op === "feed_on" ? "Your big pulls will be shared in #pulls-showcase." : "Your pulls won't be shared." }));
    }
    if (op === "unlink") {
      await unlink(db, customer.id);
      return htmlResponse(await page(customer.id, { ok: "Discord unlinked." }));
    }
    throw new DiscordLinkError("Choose an option.");
  } catch (e) {
    if (e instanceof DiscordLinkError) return htmlResponse(await page(customer.id, { error: e.message }), 400);
    throw e;
  }
}
