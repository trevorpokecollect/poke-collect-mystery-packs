// Branded page loader for cardbit.com (Trevor, Nov 25 2026): Latch shuffling a deck, rendered in Blender from the
// same rigged Latch, studio and lights as the pack-opening films (scene + script: see docs/CARDBIT-WAITLIST.md).
//
// Rules from Trevor: full screen, the same clip everywhere, at most once per visit, and only on slow loads.
// - Fast loads never see it: the overlay stays invisible for the first 300 ms, and the clip is only requested
//   once the overlay is about to show, so a fast page never downloads it.
// - Once per visit: after it has shown, sessionStorage remembers it for the tab and later pages skip it.
// - It never holds the page back: it leaves as soon as the page is ready, and is removed after `maxMs` regardless.
// - Reduced motion: a still frame of Latch, no movement.
// Ready signals: the page calls window.cbLoaderReady("<name>") for each name in `wait`; "dom" is sent at
// DOMContentLoaded.
import { fastUrl } from "./fast-assets";

const SHOW_AFTER_MS = 300;
const SEEN_KEY = "cb-loader-seen";

const CSS = `.cbl{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:radial-gradient(80% 62% at 50% 44%,#123d4a 0,#0c2730 50%,#071419 100%);opacity:0;pointer-events:none;visibility:hidden}
.cbl--on{visibility:visible;animation:cbl-in .22s ease-out forwards}
.cbl__stage{position:relative;width:min(88vw,calc(64vh*540/636),440px);aspect-ratio:540/636;-webkit-mask:linear-gradient(90deg,transparent,#000 14%,#000 86%,transparent),linear-gradient(180deg,transparent,#000 12%,#000 80%,transparent);-webkit-mask-composite:source-in;mask:linear-gradient(90deg,transparent,#000 14%,#000 86%,transparent),linear-gradient(180deg,transparent,#000 12%,#000 80%,transparent);mask-composite:intersect}
.cbl__stage img,.cbl__stage video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.cbl__label{position:absolute;left:0;right:0;bottom:max(7vh,28px);margin:0;text-align:center;font:800 15px/1 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#9df9ff;opacity:.85}
.cbl__label i{display:inline-block;animation:cbl-dot 1.2s infinite;font-style:normal}.cbl__label i+i{animation-delay:.2s}.cbl__label i+i+i{animation-delay:.4s}
.cbl--out{animation:cbl-out .25s ease forwards}
@keyframes cbl-in{from{opacity:0}to{opacity:1}}
@keyframes cbl-out{from{opacity:1}to{opacity:0}}
@keyframes cbl-dot{0%,100%{opacity:.25}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.cbl--on{animation:none;opacity:1}.cbl--out{animation:none;opacity:0}.cbl__stage video{display:none}.cbl__label i{animation:none}}`;

/** Loader overlay markup, placed first in <body>. wait: ready names to wait for; maxMs: hard cap. */
export function loaderMarkup(opts: { wait?: string[]; maxMs?: number } = {}): string {
  const wait = (opts.wait ?? ["dom"]).filter((w) => /^[a-z]+$/.test(w));
  const maxMs = Math.max(800, Math.min(opts.maxMs ?? 4000, 8000));
  const cfg = JSON.stringify({
    need: wait, max: maxMs, after: SHOW_AFTER_MS, key: SEEN_KEY,
    poster: fastUrl("latch-shuffle-poster.webp"), mp4: fastUrl("latch-shuffle.mp4"),
  }).replace(/</g, "\\u003c");
  return `<style>${CSS}</style>
  <div class="cbl" id="cbl" role="status" aria-live="polite"><div class="cbl__stage" id="cbl-stage"></div><p class="cbl__label">Shuffling<i>.</i><i>.</i><i>.</i></p></div>
  <script>(function(c){var el=document.getElementById('cbl'),done=0,shown=0,seen=0;try{seen=sessionStorage.getItem(c.key)==='1'}catch(e){}
function hide(){if(done)return;done=1;clearTimeout(st);if(!shown){el.remove();return}el.classList.add('cbl--out');setTimeout(function(){el.remove()},260)}
function show(){if(done||seen)return;shown=1;try{sessionStorage.setItem(c.key,'1')}catch(e){}var s=document.getElementById('cbl-stage'),rm=matchMedia('(prefers-reduced-motion: reduce)').matches,p=new Image();p.alt='';p.src=c.poster;s.appendChild(p);
if(!rm){var v=document.createElement('video');v.muted=true;v.defaultMuted=true;v.loop=true;v.autoplay=true;v.playsInline=true;v.setAttribute('playsinline','');v.setAttribute('aria-hidden','true');v.preload='auto';v.poster=c.poster;
var b=document.createElement('source');b.src=c.mp4;b.type='video/mp4';v.appendChild(b);s.appendChild(v);var pr=v.play();if(pr&&pr.catch)pr.catch(function(){})}
el.classList.add('cbl--on')}
var st=setTimeout(show,c.after),q=window.cbLQ||[];window.cbLoaderReady=function(n){c.need=c.need.filter(function(x){return x!==n});if(!c.need.length)hide()};q.forEach(window.cbLoaderReady);setTimeout(hide,c.max);document.addEventListener('DOMContentLoaded',function(){window.cbLoaderReady('dom')});})(${cfg});</script>`;
}

/** Head stub: queues ready signals sent before the loader markup is parsed (e.g. a cached stylesheet's onload). */
export const LOADER_HEAD = `<script>window.cbLoaderReady=function(n){(window.cbLQ=window.cbLQ||[]).push(n)}</script>`;
