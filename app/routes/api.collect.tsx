// Quiet sink for third-party beacons that POST /api/collect on the standalone site (not sent by
// our storefront code). Accepts and discards; stores nothing.
export const loader = () => new Response("Not found", { status: 404 });
export const action = () => new Response(null, { status: process.env.CARDBIT_SITE === "on" ? 204 : 404 });
