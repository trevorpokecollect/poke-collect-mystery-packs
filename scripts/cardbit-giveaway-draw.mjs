// Run every minute. The server owns the time zone, entry lock, selection and payout.
const service = new URL(
  process.env.CARDBIT_PACKS_ORIGIN ||
    "https://app-production-74528444.up.railway.app",
);
if (
  service.origin !== "https://app-production-74528444.up.railway.app" ||
  !process.env.CRON_SECRET
)
  throw Error("Configure the Cardbit draw service and cron secret.");
const response = await fetch(new URL("/jobs/cardbit-giveaways", service), {
  method: "POST",
  headers: { Authorization: "Bearer " + process.env.CRON_SECRET },
  redirect: "error",
  signal: AbortSignal.timeout(120000),
});
if (!response.ok) throw Error("Cardbit draw job returned " + response.status);
console.info("Cardbit daily draw job complete.");
