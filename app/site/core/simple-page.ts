// Minimal server-rendered page in the Cardbit palette (sign-in, checkout, payment return).
import { protectionScript } from "../payments/coinflow.server";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function simplePage(title: string, inner: string, extraHead = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Cardbit</title><meta name="robots" content="noindex">${protectionScript()}${extraHead}
<style>
:root{--bg:#17213B;--panel:#1f2b4a;--ink:#FAF8F3;--muted:#c7cbd6;--cobalt:#4057F5;--apricot:#FFB65C;--err:#ff8a80}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 "Atkinson Hyperlegible Next","Atkinson Hyperlegible",system-ui,sans-serif;padding:16px}
main{width:100%;max-width:420px;background:var(--panel);border-radius:16px;padding:28px}
h1{font:800 1.75rem/1.2 Outfit,system-ui,sans-serif;margin:0 0 4px}p.sub{color:var(--muted);margin:0 0 20px}
label{display:block;font-weight:700;margin:14px 0 6px}input,select{width:100%;padding:12px;border-radius:10px;border:1px solid #3a4870;background:#111a30;color:var(--ink);font-size:1rem}
.btn{display:block;width:100%;text-align:center;margin-top:18px;padding:12px;border:0;border-radius:10px;background:var(--cobalt);color:#fff;font:800 1rem Outfit,system-ui,sans-serif;text-decoration:none;cursor:pointer}
.sum{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #3a4870}.sum b{font-family:Outfit,system-ui,sans-serif}
.err{color:var(--err)}.note{color:var(--apricot)}.fine{color:var(--muted);font-size:.875rem}a{color:var(--apricot)}:focus-visible{outline:3px solid var(--apricot);outline-offset:2px}
</style></head><body><main>${inner}</main></body></html>`;
}

export const htmlResponse = (s: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(s, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers } });
