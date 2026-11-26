/* Cardbit site: Live Pulls, upgraded (approved by Trevor, Nov 25 2026).
   Works on top of the storefront's own feed (cardbit-storefront.js keeps rendering the list and
   choosing pulls). This file only presents it:
   - new pulls slide in face down and flip over, with a glow in their tier color
   - Epic and Legendary pulls get a "Big Hit" badge and, at most once every 20 seconds, a short
     spotlight over the section (only while it is on screen; never with reduced motion)
   - a "Biggest Hit Today" tile from /api/recent (revealed, paid pulls only). With no live pulls yet
     it shows the best card currently in the feed as "Top Chase Right Now".
   It shows nothing the feed doesn't already show: no customer names, no retail values. */
(() => {
  'use strict';
  const RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, master: 4 };
  const NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
  const COLORS = ['#f4f7ff', '#62e987', '#538fff', '#b47aff', '#ff9b3c'];
  const SPOT_GAP = 20000;
  const script = document.currentScript;
  const BACK = script?.dataset.back || '';
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => motion.matches;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeSrc = v => { try { const u = new URL(String(v || ''), location.href); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };

  function rankOf(text) {
    const k = String(text || '').trim().toLowerCase();
    return Object.hasOwn(RANK, k) ? RANK[k] : -1;
  }
  function tierOfCard(a) {
    const badge = a.querySelector('.cb-tier-badge');
    const r = rankOf(badge?.textContent);
    if (r >= 0) return r;
    const color = (a.style.getPropertyValue('--cb-pull-tier') || '').trim().toLowerCase();
    const i = COLORS.indexOf(color);
    return color === '#ffb65c' ? 4 : i;
  }

  function mount(section) {
    if (section.dataset.cbxLive) return;
    const list = section.querySelector('[data-feed-items]');
    const heading = section.querySelector('.cb-feed-heading');
    if (!list || !heading) return;
    section.dataset.cbxLive = '1';
    section.classList.add('cbx-lp');

    const title = heading.querySelector('h2');
    if (title && !heading.querySelector('.cbx-live')) {
      const live = document.createElement('span');
      live.className = 'cbx-live';
      live.textContent = 'Live';
      title.after(live);
    }

    const body = document.createElement('div');
    body.className = 'cbx-lp-body';
    const hit = document.createElement('aside');
    hit.className = 'cbx-hit';
    hit.hidden = true;
    hit.setAttribute('aria-label', 'Biggest Hit Today');
    const rail = document.createElement('div');
    rail.className = 'cbx-rail';
    heading.after(body);
    rail.append(list);
    body.append(hit, rail);

    const spot = document.createElement('div');
    spot.className = 'cbx-spot';
    spot.setAttribute('aria-hidden', 'true');
    section.append(spot);

    let seen = null, lastSpot = 0, onScreen = false, spotTimer = 0;
    new IntersectionObserver(es => { onScreen = es[0].isIntersecting; }, { threshold: 0.35 }).observe(section);

    function decorate(li, fresh) {
      const a = li.querySelector('.cb-feed-card');
      if (!a) return -1;
      const r = tierOfCard(a);
      li.classList.remove('cbx-r0', 'cbx-r1', 'cbx-r2', 'cbx-r3', 'cbx-r4');
      if (r >= 0) { li.classList.add('cbx-r' + r); li.style.setProperty('--cbx-tc', COLORS[r]); }
      const scan = a.querySelector('.cb-mini-scan');
      if (scan && BACK && !scan.querySelector('.cbx-back')) {
        const back = document.createElement('img');
        back.className = 'cbx-back'; back.alt = ''; back.src = BACK; back.decoding = 'async';
        scan.append(back);
      }
      if (r >= 3 && !a.querySelector('.cbx-badge')) {
        const b = document.createElement('span');
        b.className = 'cbx-badge'; b.textContent = 'Big Hit'; b.setAttribute('aria-hidden', 'true');
        a.prepend(b);
      }
      if (fresh && !reduced()) {
        li.classList.add('cbx-new');
        li.addEventListener('animationend', e => { if (e.target === li) li.classList.remove('cbx-new'); }, { once: true });
      }
      return r;
    }

    function process() {
      const items = [...list.querySelectorAll(':scope > li[data-feed-ref]')];
      const refs = new Set(items.map(li => li.dataset.feedRef));
      let best = null;
      for (const li of items) {
        const fresh = seen !== null && !seen.has(li.dataset.feedRef);
        const r = decorate(li, fresh);
        if (fresh && r >= 3 && (!best || r > best.r)) best = { li, r };
      }
      if (best) spotlight(best.li, best.r);
      seen = refs;
      if (!liveHit) feedHit(items);
    }

    function spotlight(li, r) {
      if (reduced() || !onScreen || document.hidden || Date.now() - lastSpot < SPOT_GAP) return;
      const a = li.querySelector('.cb-feed-card');
      const src = safeSrc(a?.querySelector('.cb-mini-scan img:not(.cbx-back)')?.src);
      if (!src) return;
      lastSpot = Date.now();
      const name = a.querySelector('.cb-pull-name')?.textContent || '';
      const pack = [...(a.querySelector('.cb-pull-meta')?.childNodes || [])].filter(n => !(n.nodeType === 1 && (n.classList.contains('cb-tier-badge') || n.getAttribute('aria-hidden')))).map(n => n.textContent).join('').replace(/^\s*·\s*/, '').trim();
      spot.style.setProperty('--cbx-tc', COLORS[r]);
      spot.innerHTML = '<i class="cbx-rays"></i><div class="cbx-spot-in"><strong>' + esc(NAMES[r]) + ' Pull!</strong><img alt="" src="' + esc(src) + '"><span>' + esc([name, pack].filter(Boolean).join(' · ')) + '</span></div>';
      spot.classList.add('on');
      clearTimeout(spotTimer);
      spotTimer = setTimeout(() => spot.classList.remove('on'), 2300);
    }
    spot.addEventListener('click', () => spot.classList.remove('on'));

    // Biggest Hit Today
    let liveHit = null;
    function drawHit(h) {
      if (!h) { hit.hidden = true; section.classList.remove('cbx-has-hit'); return; }
      const key = [h.label, h.name, h.src, h.meta, h.when].join('|');
      if (hit.dataset.key === key) return;
      hit.dataset.key = key;
      hit.style.setProperty('--cbx-tc', COLORS[Math.max(0, h.r)]);
      const inner = '<i class="cbx-rays" aria-hidden="true"></i><span class="cbx-hit-label">' + esc(h.label) + '</span>' +
        '<img alt="' + esc(h.name) + '" src="' + esc(h.src) + '" loading="lazy" decoding="async">' +
        '<strong class="cbx-hit-name">' + esc(h.name) + '</strong><span class="cbx-hit-meta">' + esc(h.meta) + '</span>' +
        (h.when ? '<span class="cbx-hit-when">' + esc(h.when) + '</span>' : '');
      hit.innerHTML = h.href ? '<a href="' + esc(h.href) + '">' + inner + '</a>' : inner;
      hit.hidden = false;
      section.classList.add('cbx-has-hit');
    }
    function feedHit(items) {
      let best = null;
      for (const li of items) {
        const a = li.querySelector('.cb-feed-card');
        const r = a ? tierOfCard(a) : -1;
        const src = safeSrc(a?.querySelector('.cb-mini-scan img:not(.cbx-back)')?.src);
        if (src && (!best || r > best.r)) best = { r, src, a };
      }
      if (!best || best.r < 2) return drawHit(null);
      drawHit({ label: 'Top Chase Right Now', r: best.r, src: best.src, name: best.a.querySelector('.cb-pull-name')?.textContent || '', meta: NAMES[best.r] || '', href: best.a.getAttribute('href') || '' });
    }
    function ago(iso) {
      const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
      if (!Number.isFinite(s)) return '';
      if (s < 60) return 'Just Now';
      if (s < 3600) return Math.floor(s / 60) + 'm Ago';
      return Math.floor(s / 3600) + 'h Ago';
    }
    async function readHit() {
      if (document.hidden || !section.isConnected) return;
      try {
        const url = window.CardbitSite?.api ? window.CardbitSite.api('recent?limit=24') : '/api/recent?limit=24';
        const res = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        if (!res.ok) return;
        const data = await res.json();
        const day = Date.now() - 86400000;
        let best = null;
        for (const p of Array.isArray(data?.pulls) ? data.pulls : []) {
          const at = Date.parse(p?.at), r = rankOf(p?.tier), src = safeSrc(p?.image);
          if (!src || !(at >= day) || r < 2) continue;
          if (!best || r > best.r || (r === best.r && at > best.at)) best = { r, at, src, p };
        }
        if (!best) { liveHit = null; process(); return; }
        const pack = document.querySelector('[data-edition-info="' + CSS.escape(String(best.p.packId || '')) + '"] h3')?.textContent || '';
        const match = [...list.querySelectorAll('.cb-feed-card')].find(a => a.querySelector('.cb-pull-name')?.textContent === best.p.name);
        liveHit = { label: 'Biggest Hit Today', r: best.r, src: best.src, name: best.p.name, meta: [NAMES[best.r], pack].filter(Boolean).join(' · '), when: ago(best.p.at), href: match?.getAttribute('href') || '' };
        drawHit(liveHit);
      } catch { /* the feed still works without the tile */ }
    }

    new MutationObserver(() => process()).observe(list, { childList: true });
    process();
    readHit();
    const poll = setInterval(() => { if (!section.isConnected) { clearInterval(poll); return; } readHit(); }, 60000);
  }

  // The storefront renders client-side and re-renders on navigation, so watch for the feed.
  function scan() { document.querySelectorAll('#cardbit-store .cb-pull-feed').forEach(mount); }
  const start = () => {
    scan();
    const root = document.getElementById('cardbit-store') || document.body;
    new MutationObserver(scan).observe(root, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
