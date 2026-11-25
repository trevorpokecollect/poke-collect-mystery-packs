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
