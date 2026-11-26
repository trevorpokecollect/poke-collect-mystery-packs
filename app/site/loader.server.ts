// Branded page loader for cardbit.com (Nov 26 2026). Inline SVG + CSS + a few lines of JS, so it adds no
// requests and paints with the first bytes of HTML. The Cardbit "B" card draws itself, its pixel bits snap in,
// and a foil shine sweeps across; while the page is still loading the bits keep pulsing.
//
// It never holds the page back: it fades in only if the page is not ready after 150 ms (fast and cached loads
// never see it), leaves the moment the page is ready, and is removed after `maxMs` no matter what.
// Reduced motion: a still emblem, no movement.
//
// Ready signals: the page calls window.cbLoaderReady("<name>") for each name in `wait`. "dom" is sent
// automatically at DOMContentLoaded.

const EMBLEM = `<svg class="cbl__mark" viewBox="0 0 100 118" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="cbl-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14222b"/><stop offset="1" stop-color="#0c151b"/></linearGradient>
    <linearGradient id="cbl-s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#bffcff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <clipPath id="cbl-c"><path d="M12 4H76L96 24V104A10 10 0 0 1 86 114H12A10 10 0 0 1 2 104V14A10 10 0 0 1 12 4Z"/></clipPath>
  </defs>
  <path class="cbl__card" pathLength="100" d="M12 4H76L96 24V104A10 10 0 0 1 86 114H12A10 10 0 0 1 2 104V14A10 10 0 0 1 12 4Z" fill="url(#cbl-g)" stroke="#00e6e1" stroke-width="4" stroke-linejoin="round"/>
  <g class="cbl__bits" fill="#00e6e1">
    <rect style="--k:0" x="34" y="28" width="9" height="8" rx="1"/>
    <rect style="--k:1" x="19" y="41" width="9" height="8" rx="1"/>
    <rect style="--k:2" x="31" y="41" width="9" height="8" rx="1"/>
    <rect style="--k:3" x="27" y="54" width="9" height="8" rx="1"/>
    <rect style="--k:4" x="19" y="67" width="9" height="8" rx="1"/>
  </g>
  <path class="cbl__b" fill="#f6faf9" fill-rule="evenodd" d="M44 28H66C77 28 83 34 83 43C83 49 80 53 75 55C82 57 86 62 86 70C86 81 78 88 65 88H38L41 76H44V40ZM56 39V52H64C68 52 70 50 70 45.5C70 41 68 39 64 39ZM56 63V77H65C70 77 72 75 72 70C72 65 70 63 65 63Z"/>
  <g fill="#9fb3b8" opacity=".7"><path d="M66 104l5-8h4l-5 8zM74 104l5-8h4l-5 8zM82 104l5-8h4l-5 8z"/></g>
  <g clip-path="url(#cbl-c)"><rect class="cbl__shine" x="-60" y="0" width="40" height="118" fill="url(#cbl-s)" transform="skewX(-18)"/></g>
</svg>`;

const CSS = `.cbl{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:radial-gradient(60% 50% at 50% 45%,#10262b 0,#0b1114 70%);opacity:0;pointer-events:none;animation:cbl-in .2s ease-out .15s forwards}
.cbl__box{display:grid;justify-items:center;gap:18px}
.cbl__mark{width:84px;height:auto;overflow:visible;filter:drop-shadow(0 0 18px rgba(0,230,225,.28))}
.cbl__card{stroke-dasharray:100;stroke-dashoffset:100;fill-opacity:0;animation:cbl-draw .5s cubic-bezier(.2,.8,.2,1) .15s forwards,cbl-fill .3s ease-out .45s forwards}
.cbl__bits rect{opacity:0;transform:translateX(-26px);animation:cbl-bit .32s cubic-bezier(.34,1.56,.64,1) forwards,cbl-pulse 1.2s ease-in-out infinite;animation-delay:calc(.3s + var(--k)*60ms),calc(1.2s + var(--k)*120ms)}
.cbl__b{opacity:0;transform:translateY(8px) scale(.92);transform-origin:60px 58px;animation:cbl-b .35s cubic-bezier(.34,1.56,.64,1) .5s forwards}
.cbl__shine{animation:cbl-shine 1.6s ease-in-out .85s infinite}
.cbl__bar{width:96px;height:3px;border-radius:3px;background:rgba(0,230,225,.14);overflow:hidden}
.cbl__bar i{display:block;width:40%;height:100%;border-radius:inherit;background:#00e6e1;animation:cbl-bar 1.1s ease-in-out infinite}
.cbl__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.cbl--out{animation:cbl-out .25s ease forwards}
@keyframes cbl-in{to{opacity:1}}
@keyframes cbl-out{from{opacity:1}to{opacity:0}}
@keyframes cbl-draw{to{stroke-dashoffset:0}}
@keyframes cbl-fill{to{fill-opacity:1}}
@keyframes cbl-bit{to{opacity:1;transform:none}}
@keyframes cbl-pulse{0%,100%{fill:#00e6e1}50%{fill:#9df9ff}}
@keyframes cbl-b{to{opacity:1;transform:none}}
@keyframes cbl-shine{0%{transform:skewX(-18deg) translateX(0)}55%,100%{transform:skewX(-18deg) translateX(200px)}}
@keyframes cbl-bar{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){.cbl *{animation:none!important}.cbl{animation:cbl-in 0s .15s forwards}.cbl--out{animation:none;opacity:0}.cbl__card{stroke-dashoffset:0;fill-opacity:1}.cbl__bits rect,.cbl__b{opacity:1;transform:none}.cbl__shine,.cbl__bar{display:none}}`;

/** Loader overlay markup, placed first in <body>. wait: ready names to wait for; maxMs: hard cap. */
export function loaderMarkup(opts: { wait?: string[]; maxMs?: number } = {}): string {
  const wait = (opts.wait ?? ["dom"]).filter((w) => /^[a-z]+$/.test(w));
  const maxMs = Math.max(500, Math.min(opts.maxMs ?? 3000, 8000));
  return `<style>${CSS}</style>
  <div class="cbl" id="cbl" role="status" aria-live="polite"><div class="cbl__box">${EMBLEM}<div class="cbl__bar"><i></i></div><span class="cbl__sr">Loading cardbit</span></div></div>
  <script>(function(){var el=document.getElementById('cbl'),t0=Date.now(),need=${JSON.stringify(wait)},done=0;function hide(){if(done)return;done=1;if(Date.now()-t0<150){el.remove();return}el.classList.add('cbl--out');setTimeout(function(){el.remove()},260)}var q=window.cbLQ||[];window.cbLoaderReady=function(n){need=need.filter(function(x){return x!==n});if(!need.length)hide()};q.forEach(window.cbLoaderReady);setTimeout(hide,${maxMs});document.addEventListener('DOMContentLoaded',function(){window.cbLoaderReady('dom')});})();</script>`;
}

/** Head stub: queues ready signals sent before the loader markup is parsed (e.g. a cached stylesheet's onload). */
export const LOADER_HEAD = `<script>window.cbLoaderReady=function(n){(window.cbLQ=window.cbLQ||[]).push(n)}</script>`;
