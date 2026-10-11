// Changes with every deploy so phones fetch the new opener files instead of a cached copy.
export const OPENER_VERSION = (
  process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_GIT_COMMIT_SHA || String(Date.now())
).slice(0, 12);
