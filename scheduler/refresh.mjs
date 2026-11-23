// One execution of the Cardbit production pricing and vault observation job.
const packsOrigin = "https://app-production-74528444.up.railway.app";
const configuredOrigin = process.env.CARDBIT_PACKS_ORIGIN?.replace(/\/$/, "");
const secret = process.env.CRON_SECRET;

if (
  configuredOrigin !== packsOrigin ||
  process.env.CARDBIT_WORKSPACE_MODE !== "live" ||
  !secret?.trim()
) {
  throw new Error("Configure the Cardbit production origin, live workspace mode and cron secret.");
}

const response = await fetch(new URL("/jobs/cardbit-prices", packsOrigin), {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
  redirect: "error",
  signal: AbortSignal.timeout(12 * 60_000),
});
if (!response.ok) {
  throw new Error(`Cardbit refresh returned HTTP ${response.status}.`);
}
const result = await response.json();
if (result?.updated !== true || result.unrecorded !== 0) {
  throw new Error("Cardbit did not confirm a complete refresh and all vault observations.");
}
console.log("Cardbit pricing refreshed. All eligible vault observations were recorded.");
