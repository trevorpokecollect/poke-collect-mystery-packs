// Minimal server-rendered page in the Cardbit palette (sign-in, checkout, payment return).
import { protectionScript } from "../payments/coinflow.server";
import { SITE_SECURITY_HEADERS, pulseTag } from "../shell.server";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Top "Back" bar (Trevor, Nov 26 2026: the only way back was a tiny link at the bottom). Goes back in history when the
 *  visitor came from another cardbit.com page, otherwise to `href`. Pass back: false to leave it off. */
const backBar = (href: string) =>
  `<nav class="sp-top" aria-label="Back"><a class="sp-back" href="${esc(href)}" onclick="try{if(history.length>1&&document.referrer&&new URL(document.referrer).origin===location.origin&&new URL(document.referrer).pathname!==location.pathname){history.back();return false}}catch(e){}"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Back</span></a></nav>`;

export function simplePage(title: string, inner: string, extraHead = "", opts: { back?: string | false } = {}) {
  const back = opts.back === false ? "" : backBar(opts.back || "/");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Cardbit</title><meta name="robots" content="noindex">${protectionScript()}${pulseTag()}${extraHead}
<style>
@font-face{font-family:'Cardbit Outfit';src:url('/site/assets/cardbit-outfit-800-latin.woff2') format('woff2');font-weight:800;font-display:swap}
@font-face{font-family:'Cardbit Atkinson';src:url('/site/assets/cardbit-type-atkinson.woff') format('woff');font-weight:200 800;font-display:swap}
:root{--bg:#101619;--panel:#161e21;--ink:#f6faf9;--muted:#b6c4c5;--accent:#00e6e1;--on-accent:#092022;--gold:#73e6dc;--line:#344145;--err:#ffb3b3}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(1200px 600px at 50% -10%,#123033 0%,var(--bg) 60%);color:var(--ink);font:16px/1.5 'Cardbit Atkinson',system-ui,sans-serif;padding:16px}
main{width:100%;max-width:420px;background:linear-gradient(180deg,#1a2427 0%,var(--panel) 120px);border:1px solid #2b4448;border-radius:18px;padding:28px 24px;box-shadow:0 30px 90px #000a}
.brand{display:block;margin:0 auto 14px;width:130px;height:auto}
h1{font:800 1.65rem/1.2 'Cardbit Outfit',system-ui,sans-serif;margin:0 0 6px;text-align:center}p.sub{color:var(--muted);margin:0 0 20px;text-align:center}
label{display:block;font-weight:700;font-size:.875rem;margin:14px 0 6px;color:#d3dbe0}input,select{width:100%;min-height:46px;padding:10px 12px;border-radius:10px;border:1px solid #3b4a4e;background:#0d1416;color:var(--ink);font:inherit;font-size:1rem}
.btn{display:block;width:100%;text-align:center;margin-top:16px;padding:12px;border:0;border-radius:10px;background:var(--accent);color:var(--on-accent);font:800 1rem 'Cardbit Outfit',system-ui,sans-serif;text-decoration:none;cursor:pointer}
.btn.g{display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#1f1f1f;border:1px solid #dadce0;font:600 15px 'Cardbit Atkinson',system-ui,sans-serif}
.or{display:flex;align-items:center;gap:10px;color:var(--muted);margin:18px 0 0;font-size:.75rem;text-transform:uppercase;letter-spacing:.14em}.or:before,.or:after{content:"";flex:1;height:1px;background:var(--line)}
.link{background:none;border:0;color:var(--accent);padding:0;margin-top:14px;cursor:pointer;font:inherit;text-decoration:underline}
.sum{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}.sum b{font-family:'Cardbit Outfit',system-ui,sans-serif}
.err{color:var(--err);background:#ff6b6b1a;border:1px solid #ff6b6b55;border-radius:9px;padding:9px 11px}.note{color:var(--gold)}.fine{color:#8fa0a3;font-size:.8rem;text-align:center}a{color:var(--accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sp-top{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;height:calc(56px + env(safe-area-inset-top,0px));padding:env(safe-area-inset-top,0px) max(12px,env(safe-area-inset-right)) 0 max(12px,env(safe-area-inset-left));background:rgba(10,18,20,.92);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-bottom:1px solid #1f3236}
.sp-back{display:inline-flex;align-items:center;gap:4px;min-height:44px;padding:0 16px 0 10px;border-radius:999px;border:1px solid #2b4448;background:#13262a;color:var(--ink);font:800 1rem 'Cardbit Outfit',system-ui,sans-serif;text-decoration:none}
.sp-back svg{color:var(--accent)}.sp-back:hover,.sp-back:focus-visible{border-color:var(--accent)}.sp-back:active{transform:scale(.96)}
body:has(.sp-top){padding-top:calc(72px + env(safe-area-inset-top,0px))}
</style></head><body>${back}<main><a href="/" aria-label="Cardbit Home"><img class="brand" alt="cardbit" src="/site/assets/cardbit-brand-lockup.webp" width="130" height="26"></a>${inner}</main></body></html>`;
}

export const htmlResponse = (s: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(s, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...SITE_SECURITY_HEADERS, ...headers } });
