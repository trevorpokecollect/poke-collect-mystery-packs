// HTTP server for cardbit.com (cardbit-mystery-packs / site / app-site only; started by scripts/start-cardbit-site.sh).
// Same as `react-router-serve build/server/index.js` (compression, static files, React Router handler) with one
// change: static files requested with a ?v=<content hash> query (every /site/ asset URL the pages build) are
// cached by browsers for a year, since a new file always gets a new URL. Unversioned files keep a 1-hour cache.
// react-router-serve serves build/client with max-age=0, so every visit re-checked every image and font, and
// Railway's CDN (Edge settings on app-site) could not keep them. Pages and API responses set their own headers.
import path from "node:path";
import url from "node:url";
import express from "express";
import compression from "compression";
import morgan from "morgan";
import { createRequestHandler } from "@react-router/express";

const YEAR = "public, max-age=31536000, immutable";
const HOUR = "public, max-age=3600";

export function staticCacheHeader(query) {
  return query && typeof query.v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(query.v) ? YEAR : HOUR;
}

export function createApp(build, buildModule) {
  const app = express();
  app.disable("x-powered-by");
  app.use(compression());
  const setHeaders = (res) => res.setHeader("Cache-Control", staticCacheHeader(res.req?.query));
  app.use(path.posix.join(build.publicPath, "assets"), express.static(path.join(build.assetsBuildDirectory, "assets"), { immutable: true, maxAge: "1y" }));
  app.use(build.publicPath, express.static(build.assetsBuildDirectory, { cacheControl: false, setHeaders }));
  app.use(express.static("public", { cacheControl: false, setHeaders }));
  app.use(morgan("tiny"));
  app.all("*", createRequestHandler({ build: buildModule, mode: process.env.NODE_ENV }));
  return app;
}

if (import.meta.url === url.pathToFileURL(process.argv[1] || "").href) {
  const buildPath = path.resolve(process.argv[2] || "build/server/index.js");
  const buildModule = await import(url.pathToFileURL(buildPath).href);
  const port = Number(process.env.PORT) || 3000;
  const server = process.env.HOST ? createApp(buildModule, buildModule).listen(port, process.env.HOST) : createApp(buildModule, buildModule).listen(port);
  server.on("listening", () => console.log(`[cardbit-site-serve] http://localhost:${port}`));
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close(console.error));
}
