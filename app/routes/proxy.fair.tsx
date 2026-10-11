import type { LoaderFunctionArgs } from "react-router";
import { oddsFromQuery } from "../lib/pool-page.server";
import { proxyContext } from "../lib/proxy.server";

// "Provably fair" page, rendered inside the store theme at /apps/packs/fair?product=<id>.
// Explains the commitment, shows the fingerprint, and once the series is closed lets anyone
// recompute it in the browser from the published salt and card order.

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
// Shopify Liquid would read {{ or {% in text as code.
const safe = (s: string) => escape(s).replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");

const STYLE = `
.mpf { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; line-height: 1.55; }
.mpf h1 { margin: 0 0 6px; }
.mpf-sub { margin: 0 0 24px; opacity: .75; }
.mpf-steps { list-style: none; margin: 0 0 28px; padding: 0; display: grid; gap: 14px; }
.mpf-steps li { display: flex; gap: 12px; align-items: flex-start; }
.mpf-steps p { margin: 2px 0 0; opacity: .8; }
.mpf-num { flex: none; width: 28px; height: 28px; border-radius: 50%; background: #e3350d; color: #fff; display: grid; place-items: center; font-weight: 800; }
.mpf-box { padding: 16px; border-radius: 12px; border: 1px solid rgba(0,0,0,.12); background: rgba(255,255,255,.7); margin: 0 0 16px; }
.mpf-box h2 { margin: 0 0 8px; font-size: 1.05em; }
.mpf-code { display: block; font-family: ui-monospace, Menlo, monospace; font-size: .8em; word-break: break-all; padding: 10px; border-radius: 8px; background: #f3f3f6; margin: 6px 0; }
.mpf-btn { display: inline-block; margin-top: 8px; padding: 10px 16px; border-radius: 10px; border: 0; background: #14141a; color: #fff; font-weight: 700; cursor: pointer; }
.mpf-btn::before, .mpf-btn::after { display: none !important; }
.mpf-btn:hover, .mpf-btn:focus-visible { background: #14141a !important; border-color: #14141a !important; color: #fff !important; }
.mpf-ok { color: #1f8a4c; font-weight: 700; }
.mpf-bad { color: #c0261b; font-weight: 700; }
.mpf-back { display: inline-flex !important; align-items: center; gap: 6px; margin-bottom: 20px; text-decoration: none !important; }
/* The theme's hover fill paints the button red with red text; use a plain dark-on-hover instead. */
.mpf-back::before, .mpf-back::after { display: none !important; }
.mpf-back:hover, .mpf-back:focus-visible { background: #14141a !important; border-color: #14141a !important; color: #fff !important; }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, liquid } = await proxyContext(request);
  const url = new URL(request.url);
  const odds = await oddsFromQuery(shop, url);
  const back = `<a class="mpf-back button button--secondary" href="javascript:history.back()">&larr; Back</a>`;

  const steps = `<ol class="mpf-steps">
    <li><span class="mpf-num">1</span><div><strong>The Pool Is Locked Before Any Pack Sells</strong>
      <p>When a series launches, every card in the pool is shuffled once by a secure random generator. That order decides which card is in which pack, first pack to last.</p></div></li>
    <li><span class="mpf-num">2</span><div><strong>We Publish A Fingerprint Of That Order</strong>
      <p>The fingerprint is a SHA-256 hash of the card order plus a secret code. It's shown below from the moment the series goes live, and it can't be changed without changing the fingerprint.</p></div></li>
    <li><span class="mpf-num">3</span><div><strong>When The Series Ends, Anyone Can Check It</strong>
      <p>We publish the secret code and the full card order. Hash them yourself (or tap the button below) and you'll get the same fingerprint, which proves no pull was changed after packs were bought.</p></div></li>
  </ol>`;

  if (!odds || !odds.commitHash) {
    return liquid(
      `<div class="mpf"><style>${STYLE}</style>${back}<h1>Provably Fair</h1>
       <p class="mpf-sub">How We Prove Every Pack Is Fair.</p>${steps}
       <div class="mpf-box">This pack's fingerprint isn't available yet.</div></div>`,
    );
  }

  const closed = !!odds.reveal;
  const endpoint = `/apps/packs/api/pool?series=${encodeURIComponent(odds.handle)}`;
  const check = closed
    ? `<div class="mpf-box">
        <h2>Check It Yourself</h2>
        <p>Secret code (salt):</p><code class="mpf-code">${safe(odds.reveal?.salt ?? "")}</code>
        <p>Card order: ${odds.reveal?.sequence.length ?? 0} cards, published in this pack's <a href="${endpoint}" target="_blank" rel="noopener">pool data</a> as <code>reveal.sequence</code>.</p>
        <p>Formula: <code>sha256(salt + ":" + card order joined with commas)</code></p>
        <button class="mpf-btn button button--primary" type="button" data-mpf-verify>Verify The Fingerprint</button>
        <p data-mpf-result></p>
      </div>
      <script>
      (function () {
        var btn = document.querySelector("[data-mpf-verify]");
        var out = document.querySelector("[data-mpf-result]");
        btn.addEventListener("click", function () {
          out.textContent = "Checking...";
          fetch(${JSON.stringify(endpoint)}).then(function (r) { return r.json(); }).then(function (d) {
            var text = d.reveal.salt + ":" + d.reveal.sequence.join(",");
            return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
              var hex = Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
              var ok = hex === d.commitHash;
              out.className = ok ? "mpf-ok" : "mpf-bad";
              out.textContent = ok ? "Match. The card order is exactly what was locked at launch." : "No match: " + hex;
            });
          }).catch(function () { out.className = "mpf-bad"; out.textContent = "Couldn't load the pool data. Try again."; });
        });
      })();
      </script>`
    : `<div class="mpf-box"><h2>Check It Yourself</h2>
        <p>This series is still open, so the secret code and card order stay private until it ends. Publishing them now would reveal which card is in the next pack. Save the fingerprint above and check it once the series is sold out.</p></div>`;

  return liquid(
    `<div class="mpf"><style>${STYLE}</style>${back}
      <h1>Provably Fair</h1>
      <p class="mpf-sub">${safe(odds.title)}: How We Prove Every Pack Is Fair.</p>
      ${steps}
      <div class="mpf-box"><h2>This Series' Fingerprint</h2>
        <code class="mpf-code">${safe(odds.commitHash)}</code>
        <p>${closed ? "Locked at launch. The series is now complete." : "Locked at launch, before the first pack was sold."}</p></div>
      ${check}
    </div>`,
  );
};
