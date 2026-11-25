// One-time wiring for the standalone site. Imported by entry.server; no-op unless CARDBIT_SITE=on.
import { ledgerFeePayer } from "./core/fees.server";
import { registerSiteShipping } from "./shipping/wire.server";
import { sqlCopyStore } from "./shipping/sql-copy-store";

if (process.env.CARDBIT_SITE === "on") registerSiteShipping({ copies: sqlCopyStore(), fees: ledgerFeePayer });

// Hourly automatic buyback restock (verified restocks). Production only; SITE_AUTO_RESTOCK=off disables it.
import db from "../db.server";
import { startAutoRestockClock } from "./core/restock.server";
startAutoRestockClock(db);

// Nightly Cardbits balance check (read-only; emails staff on a mismatch). SITE_LEDGER_CHECK=off disables it.
import { startLedgerCheckClock } from "./core/ledger-check.server";
startLedgerCheckClock(db);

// Klaviyo marketing sync (consent + flow events) every 5 minutes. Off unless KLAVIYO_PRIVATE_KEY is set; KLAVIYO_SYNC=off stops it.
import { startKlaviyoClock } from "./marketing/klaviyo.server";
startKlaviyoClock(db);

// Daily sales tax nexus check (read-only; emails staff when a state reaches 70/90/100% of its threshold). SITE_NEXUS_ALERTS=off disables it.
import { startNexusClock } from "./core/nexus.server";
startNexusClock(db);

// Discord community: hourly rank-role sync (Linked Roles) and the opt-in live pulls feed every 2 minutes.
// Each is off until its keys are set; SITE_DISCORD_ROLES=off / SITE_DISCORD_PULLS=off disable them.
import { startDiscordClocks } from "./community/discord.server";
startDiscordClocks(db);
