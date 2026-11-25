// One-time wiring for the standalone site. Imported by entry.server; no-op unless CARDBIT_SITE=on.
import { ledgerFeePayer } from "./core/fees.server";
import { registerSiteShipping } from "./shipping/wire.server";
import { sqlCopyStore } from "./shipping/sql-copy-store";

if (process.env.CARDBIT_SITE === "on") registerSiteShipping({ copies: sqlCopyStore(), fees: ledgerFeePayer });
