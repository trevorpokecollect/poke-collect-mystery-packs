// Verified Shuffle (standalone site): explains the draw, shows the customer's seed fingerprint, lets
// them set a client seed or reveal + rotate the server seed, and re-checks past openings in the
// browser. 404 unless CARDBIT_SITE=on. Draw rules: app/site/play/fair.server.ts.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { currentCustomer } from "../site/core/auth.server";
import { esc, htmlResponse, simplePage } from "../site/core/simple-page";
import { FairInputError, fairView, rotateSeed, setClientSeed } from "../site/play/fair.server";

const on = () => process.env.CARDBIT_SITE === "on";
const PATH = "/verified-shuffle";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === new URL(request.url).host || host === request.headers.get("x-forwarded-host");
  } catch {
    return false;
  }
}

const HOW = `<h2>How It Works</h2>
<ol class="steps">
  <li><b>Before you open,</b> we lock in a secret <em>server seed</em> and show you its fingerprint (SHA-256 hash). Once shown, it can't change.</li>
  <li><b>You can add your own</b> <em>client seed</em>, so we can't know the full input in advance.</li>
  <li><b>Each opening</b> lists the pack's remaining cards in a fixed order and picks from them with your seeds and an opening number (<em>nonce</em>). Each card is drawn once.</li>
  <li><b>Reveal any time.</b> Press Reveal &amp; New Seed and we show the old secret seed. Then Verify recomputes every opening right here in your browser.</li>
</ol>
<p class="fine">Formula: pick <i>i</i> = HMAC-SHA256(server seed, "client seed:nonce:i"), first 13 hex digits as a number, mod the cards left. The card at that spot is removed before the next pick. Card values never change the draw.</p>`;

function verifierScript() {
  // Browser re-check with Web Crypto. Mirrors fairIndex()/fairDraw() in fair.server.ts.
  return `<script>
(function(){
  var enc=new TextEncoder();
  function hex(b){return Array.from(new Uint8Array(b)).map(function(x){return x.toString(16).padStart(2,'0')}).join('')}
  async function sha(s){return hex(await crypto.subtle.digest('SHA-256',enc.encode(s)))}
  async function hmac(k,m){var key=await crypto.subtle.importKey('raw',enc.encode(k),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,enc.encode(m)))}
  document.addEventListener('click',async function(e){
    var b=e.target.closest('[data-verify]');if(!b)return;
    var d=JSON.parse(b.getAttribute('data-verify')),out=b.parentNode.querySelector('.vr');
    try{
      if(await sha(d.serverSeed)!==d.serverSeedHash){out.textContent='✗ Seed does not match its fingerprint.';out.className='vr err';return}
      var left=d.poolIds.slice(),picks=[];
      for(var i=0;i<d.pickIds.length;i++){var h=await hmac(d.serverSeed,d.clientSeed+':'+d.nonce+':'+i);picks.push(left.splice(parseInt(h.slice(0,13),16)%left.length,1)[0])}
      var ok=picks.join()===d.pickIds.join();
      out.textContent=ok?'✓ Verified: the seeds pick exactly these cards.':'✗ Picks do not match.';out.className='vr '+(ok?'note':'err');
    }catch(x){out.textContent='Your browser could not run the check.';out.className='vr err'}
  });
})();
</script>`;
}

async function page(customerId: string | null, flash?: { ok?: string; error?: string }) {
  const msg = flash?.error ? `<p class="err" role="alert">${esc(flash.error)}</p>` : flash?.ok ? `<p class="note" role="status">${esc(flash.ok)}</p>` : "";
  const css = `<style>main{max-width:760px}h2{font:800 1.2rem 'Cardbit Outfit',system-ui,sans-serif;margin:26px 0 6px}
  .steps{padding-left:1.2rem}.steps li{margin:6px 0}code,.mono{font-family:ui-monospace,Menlo,monospace;font-size:.82rem;word-break:break-all}
  .op{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:10px 0}.op h3{margin:0 0 6px;font-size:1rem}
  .row{display:flex;gap:8px}.row input{flex:1}.mini{padding:0 18px;border:0;border-radius:10px;background:var(--accent);color:var(--on-accent);font:800 .95rem 'Cardbit Outfit',system-ui,sans-serif;cursor:pointer}
  .ghost{background:transparent;color:var(--accent);border:2px solid var(--accent)}.vr{display:block;margin-top:6px}</style>`;
  if (!customerId) {
    return simplePage(
      "Verified Shuffle",
      `${css}<h1>Verified Shuffle</h1><p class="sub">Every pack opening can be checked by you.</p>${HOW}
       <a class="btn" href="/sign-in?return_to=${encodeURIComponent(PATH)}">Sign In to See Your Seeds</a>`,
    );
  }
  const v = await fairView(db, customerId);
  const ops = v.openings.length
    ? v.openings
        .map((o) => {
          const when = new Date(o.at).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
          const data = o.serverSeed && !o.sealed ? esc(JSON.stringify({ serverSeed: o.serverSeed, serverSeedHash: o.serverSeedHash, clientSeed: o.clientSeed, nonce: o.nonce, poolIds: o.poolIds, pickIds: o.pickIds })) : "";
          return `<div class="op"><h3>${esc(o.packTitle)} · ${esc(when)} CT</h3>
            <div class="fine">Nonce ${o.nonce} · Client seed <span class="mono">${esc(o.clientSeed)}</span></div>
            <div class="fine">Fingerprint <span class="mono">${esc(o.serverSeedHash)}</span></div>
            ${o.sealed ? `<div class="fine">Open this pack to see its cards.</div>` : `<div class="fine">Cards: ${esc(o.picks.join(", "))} (from ${o.poolIds.length} left in the pack)</div>`}
            ${o.serverSeed ? `<div class="fine">Server seed <span class="mono">${esc(o.serverSeed)}</span></div>` : `<div class="fine">Server seed hidden until you reveal it.</div>`}
            ${data ? `<button class="mini ghost" type="button" data-verify="${data}">Verify</button><span class="vr" aria-live="polite"></span>` : ""}</div>`;
        })
        .join("")
    : `<p class="fine">No openings yet. Your first paid opening will appear here.</p>`;
  return simplePage(
    "Verified Shuffle",
    `${css}<h1>Verified Shuffle</h1><p class="sub">Every pack opening can be checked by you.</p>${msg}
     <h2>Your Current Seeds</h2>
     <div class="sum"><span>Server seed fingerprint</span></div><p class="mono">${esc(v.active.serverSeedHash)}</p>
     <div class="sum"><span>Next opening number (nonce)</span><b>${v.active.nonce}</b></div>
     <form method="post"><label for="cs">Client Seed</label><div class="row"><input id="cs" name="clientSeed" maxlength="64" value="${esc(v.active.clientSeed)}">
       <button class="mini" name="op" value="client">Save</button></div></form>
     <form method="post"><button class="btn" name="op" value="rotate">Reveal &amp; New Seed</button>
       <p class="fine">Shows the current secret seed so you can verify past openings, then starts a fresh one.</p></form>
     <h2>Your Openings</h2>${ops}${HOW}<p class="fine"><a href="/">Back to Cardbit</a></p>${verifierScript()}`,
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  const customer = await currentCustomer(db, request);
  return htmlResponse(await page(customer?.id ?? null));
}

export async function action({ request }: ActionFunctionArgs) {
  if (!on()) return new Response("Not found", { status: 404 });
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const customer = await currentCustomer(db, request);
  if (!customer) return new Response(null, { status: 303, headers: { Location: `/sign-in?return_to=${encodeURIComponent(PATH)}` } });
  const fd = await request.formData();
  try {
    if (fd.get("op") === "client") {
      await setClientSeed(db, customer.id, String(fd.get("clientSeed") || ""));
      return htmlResponse(await page(customer.id, { ok: "Client seed saved for your next opening." }));
    }
    if (fd.get("op") === "rotate") {
      await rotateSeed(db, customer.id);
      return htmlResponse(await page(customer.id, { ok: "Seed revealed. Press Verify on any opening below." }));
    }
    throw new FairInputError("Choose an option.");
  } catch (e) {
    if (e instanceof FairInputError) return htmlResponse(await page(customer.id, { error: e.message }), 400);
    throw e;
  }
}
