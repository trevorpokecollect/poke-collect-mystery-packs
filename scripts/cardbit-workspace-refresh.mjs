// Scheduled process for the isolated Cardbit service. Secrets come from its environment.
const origin = new URL(process.env.CARDBIT_PACKS_ORIGIN || "about:blank");
if (
  process.env.CARDBIT_WORKSPACE_MODE !== "test" ||
  !process.env.CRON_SECRET ||
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password
) {
  throw new Error(
    "Configure the Cardbit test origin, workspace mode and cron secret.",
  );
}
const response = await fetch(new URL("/jobs/cardbit-prices", origin.origin), {
  method: "POST",
  redirect: "error",
  headers: { Authorization: "Bearer " + process.env.CRON_SECRET },
  signal: AbortSignal.timeout(12 * 60_000),
});
if (!response.ok)
  throw new Error(
    "Cardbit scheduled pricing failed with HTTP " + response.status,
  );
console.log("Cardbit pricing and vault observations refreshed.");
