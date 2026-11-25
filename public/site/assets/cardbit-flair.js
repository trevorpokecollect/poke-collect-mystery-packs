/* Cardbit flair: pack tilt + holo, card sheen by rarity, Cardbits count-up, confetti, Latch reactions.
   Purely presentational. Reads the rendered page only and never changes prices, odds or ownership.
   Every effect is skipped when the visitor prefers reduced motion. */
(() => {
  'use strict';
  const cheerArt = (() => { try { const src = document.currentScript?.src || ''; return src ? src.replace(/cardbit-flair\.js(\?.*)?$/, 'cardbit-latch-cheer.webp') : ''; } catch { return ''; } })();
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => motionQuery.matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const tierRank = {common:0, uncommon:1, rare:2, epic:3, legendary:4, master:4};
  const tierColor = {uncommon:'#62e987', rare:'#538fff', epic:'#b47aff', legendary:'#ffb65c', master:'#ffb65c'};

  /* Sound: a short coin tick, only when the visitor has turned Cardbit sound on. */
  let audio;
  function soundOn() {
    try { return (window.CardbitMedia?.soundChoice?.() || localStorage.getItem('cardbit.sound.v1')) === 'on'; } catch { return false; }
  }
  function tick(pitch = 1) {
    if (!soundOn() || document.hidden) return;
    try {
      const Engine = window.AudioContext || window.webkitAudioContext;
      if (!Engine) return;
      audio = audio || new Engine();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      const t = audio.currentTime + .005, osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = 'triangle'; osc.frequency.setValueAtTime(1760 * pitch, t); osc.frequency.exponentialRampToValueAtTime(2350 * pitch, t + .05);
      gain.gain.setValueAtTime(.0001, t); gain.gain.exponentialRampToValueAtTime(.07, t + .008); gain.gain.exponentialRampToValueAtTime(.0001, t + .09);
      osc.connect(gain); gain.connect(audio.destination); osc.start(t); osc.stop(t + .1);
    } catch {}
  }

  /* 1. Pack wrappers tilt toward the cursor with a holographic shine clipped to the wrapper. */
  function holoFor(img) {
    const host = img.parentElement;
    if (!host || host.querySelector(':scope > .cbf-holo')) return;
    host.classList.add('cbf-tilt-host');
    const holo = document.createElement('span');
    holo.className = 'cbf-holo'; holo.setAttribute('aria-hidden', 'true');
    const src = img.currentSrc || img.src;
    if (src) holo.style.setProperty('--cbf-mask', 'url("' + src.replace(/"/g, '%22') + '")');
    img.after(holo);
    /* SITE */ fitHolo(img, holo);
  }
  /* SITE */ function fitHolo(img, holo) {
    const sync = () => {
      const host = img.parentElement;
      if (!host || !holo.isConnected || !img.offsetWidth) return;
      const t = getComputedStyle(img).transform;
      const turned = t && t !== 'none';
      if (!turned && img.offsetWidth >= host.clientWidth - 2 && img.offsetHeight >= host.clientHeight - 2) return;
      Object.assign(holo.style, {inset:'auto', left:img.offsetLeft+'px', top:img.offsetTop+'px', width:img.offsetWidth+'px', height:img.offsetHeight+'px', transform:turned ? t : ''});
    };
    sync();
    if (!img.complete) img.addEventListener('load', sync, {once:true});
    if (window.ResizeObserver) new ResizeObserver(sync).observe(img);
  }
  function bindTilt(scope) {
    scope.querySelectorAll('.cb-shelf-wrapper > img, .cb-pack-portrait, .cc-pack-art > img').forEach(holoFor);
  }
  let tiltTarget = null, tiltFrame = 0, lastEvent = null;
  function applyTilt() {
    tiltFrame = 0;
    if (!tiltTarget || !lastEvent) return;
    const box = tiltTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (lastEvent.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (lastEvent.clientY - box.top) / box.height));
    tiltTarget.style.setProperty('--cbf-rx', ((.5 - y) * 14).toFixed(2) + 'deg');
    tiltTarget.style.setProperty('--cbf-ry', ((x - .5) * 18).toFixed(2) + 'deg');
    tiltTarget.style.setProperty('--cbf-mx', (x * 100).toFixed(1) + '%');
    tiltTarget.style.setProperty('--cbf-my', (y * 100).toFixed(1) + '%');
    tiltTarget.classList.add('cbf-tilting');
  }
  function resetTilt(node) {
    if (!node) return;
    node.classList.remove('cbf-tilting');
    ['--cbf-rx','--cbf-ry','--cbf-mx','--cbf-my'].forEach(p => node.style.removeProperty(p));
  }
  document.addEventListener('pointermove', event => {
    if (still() || !finePointer.matches) return;
    const zone = event.target.closest?.('.cb-pack-tile, .cb-detail-stage, .cc-pack-art, .cb-feed-card, .cb-card-tile, .cc-vault-grid a, .cb-chase-link, .ct-chase-card');
    const target = zone ? (zone.querySelector('.cbf-tilt-host') && !zone.matches('.cb-feed-card, .cb-card-tile, .cc-vault-grid a, .cb-chase-link, .ct-chase-card') ? zone.querySelector('.cbf-tilt-host') : zone) : null;
    if (target !== tiltTarget) { resetTilt(tiltTarget); tiltTarget = target; }
    lastEvent = event;
    if (tiltTarget && !tiltFrame) tiltFrame = requestAnimationFrame(applyTilt);
  }, {passive:true});
  document.addEventListener('pointerleave', () => { resetTilt(tiltTarget); tiltTarget = null; }, true);

  /* 2. Card sheen strength follows rarity. The tier is read from the card's own badge. */
  function tierOf(node) {
    const badge = node.querySelector('.cb-tier-badge, .cg-rank');
    const text = (badge?.textContent || node.getAttribute('aria-label') || '').toLowerCase();
    let best = -1, name = '';
    for (const key of Object.keys(tierRank)) if (new RegExp('\\b' + key + '\\b').test(text) && tierRank[key] > best) { best = tierRank[key]; name = key; }
    return name;
  }
  function markTiers(scope) {
    scope.querySelectorAll('.cb-feed-card, .cb-card-tile, .cc-vault-grid a, .cb-chase-link, .ct-chase-card, .cbop-result-card, .lo-cardlist li').forEach(node => {
      if (node.dataset.cbfTier !== undefined) return;
      const tier = tierOf(node);
      node.dataset.cbfTier = tier || 'common';
      node.classList.add('cbf-sheen');
      if (tierColor[tier]) node.style.setProperty('--cbf-glow', tierColor[tier]);
    });
  }

  /* 3. The Cardbits balance counts up (or down) with a coin tick when it changes. */
  let shownBalance = null;
  const parse = text => { const n = Number(String(text).replace(/[^\d-]/g, '')); return Number.isFinite(n) && /\d/.test(text) ? n : null; };
  function animateBalance(node, from, to) {
    if (node.dataset.cbfCounting) return;
    const steps = Math.min(24, Math.max(6, Math.round(Math.log10(Math.abs(to - from) + 1) * 7)));
    let i = 0;
    node.dataset.cbfCounting = '1';
    node.closest('.cb-balance, .cb-wallet-link')?.classList.add('cbf-bump');
    const step = () => {
      i++;
      const value = Math.round(from + (to - from) * (1 - Math.pow(1 - i / steps, 3)));
      node.textContent = value.toLocaleString('en-US');
      if (i % 3 === 1) tick(to >= from ? 1 : .8);
      if (i < steps) setTimeout(step, 38);
      else {
        node.textContent = to.toLocaleString('en-US');
        delete node.dataset.cbfCounting;
        setTimeout(() => node.closest('.cb-balance, .cb-wallet-link')?.classList.remove('cbf-bump'), 400);
      }
    };
    step();
  }
  function watchBalance() {
    document.querySelectorAll('[data-wallet-balance]').forEach(node => {
      if (node.dataset.cbfCounting) return;
      const value = parse(node.textContent);
      if (value == null) return;
      if (shownBalance != null && value !== shownBalance && !still()) {
        const from = shownBalance;
        shownBalance = value;
        animateBalance(node, from, value);
      } else shownBalance = value;
    });
  }

  /* 4. Confetti for big hits. Canvas only, removed when finished. */
  function confetti(color = '#ffb65c', origin) {
    if (still()) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'cbf-confetti'; canvas.setAttribute('aria-hidden', 'true');
    document.body.append(canvas);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.width = innerWidth * dpr, h = canvas.height = innerHeight * dpr;
    const g = canvas.getContext('2d');
    const palette = [color, '#4057f5', '#ffb65c', '#faf8f3', '#62e987'];
    const ox = (origin?.x ?? innerWidth / 2) * dpr, oy = (origin?.y ?? innerHeight * .45) * dpr;
    const bits = Array.from({length: 110}, () => ({
      x: ox, y: oy, r: (3 + Math.random() * 4) * dpr,
      vx: (Math.random() - .5) * 15 * dpr, vy: (-6 - Math.random() * 11) * dpr,
      a: Math.random() * 6.28, va: (Math.random() - .5) * .3, c: palette[Math.floor(Math.random() * palette.length)]
    }));
    const start = performance.now();
    function frame(now) {
      const t = now - start;
      g.clearRect(0, 0, w, h);
      for (const b of bits) {
        b.vy += .35 * dpr; b.vx *= .99; b.x += b.vx; b.y += b.vy; b.a += b.va;
        g.save(); g.globalAlpha = Math.max(0, 1 - t / 2200); g.translate(b.x, b.y); g.rotate(b.a);
        g.fillStyle = b.c; g.fillRect(-b.r, -b.r * .45, b.r * 2, b.r * .9); g.restore();
      }
      if (t < 2200) requestAnimationFrame(frame); else canvas.remove();
    }
    requestAnimationFrame(frame);
  }

  /* 5. Latch reacts to big pulls in the reveal: Epic and Legendary get a cheer. */
  const cheers = {epic:['Whoa!','Epic Pull!'], legendary:['Legendary!','No Way!'], master:['Legendary!','No Way!']};
  function latchReact(tier, host) {
    const lines = cheers[tier];
    if (!lines || !host) return;
    host.querySelector('.cbf-latch')?.remove();
    const art = cheerArt && /cardbit-latch-cheer\.webp/.test(cheerArt) ? cheerArt : '';
    const node = document.createElement('div');
    node.className = 'cbf-latch cbf-latch-' + tier; node.setAttribute('aria-hidden', 'true');
    node.style.setProperty('--cbf-glow', tierColor[tier]);
    node.innerHTML = (art ? '<img alt="" src="' + art.replace(/"/g, '%22') + '">' : '') + '<b></b>';
    node.querySelector('b').textContent = lines[Math.floor(Math.random() * lines.length)];
    host.append(node);
    if (still()) node.classList.add('is-still');
    setTimeout(() => node.remove(), 3200);
    if (tier !== 'epic') { const box = host.getBoundingClientRect(); confetti(tierColor[tier], {x: box.left + box.width / 2, y: box.top + box.height * .4}); }
  }
  // Openings announce each revealed card; react to the rarest ones.
  window.addEventListener('cardbit:card-revealed', event => {
    const tier = String(event.detail?.tier || '').toLowerCase().trim();
    const host = event.detail?.host;
    // Rarity glow behind the revealed card: blue for Rare, purple for Epic, gold for Legendary.
    if (host && tierRank[tier] >= 2) {
      host.style.setProperty('--cbf-glow', tierColor[tier]);
      host.classList.remove('cbf-reveal-glow'); void host.offsetWidth; host.classList.add('cbf-reveal-glow');
      clearTimeout(host._cbfGlow); host._cbfGlow = setTimeout(() => host.classList.remove('cbf-reveal-glow'), 2400);
    }
    latchReact(tier, host);
  });

  /* Wiring: rescan whenever the storefront re-renders. */
  let queued = false;
  function scan() {
    queued = false;
    bindTilt(document);
    markTiers(document);
    watchBalance();
  }
  function queue() { if (!queued) { queued = true; requestAnimationFrame(scan); } }
  new MutationObserver(queue).observe(document.documentElement, {childList:true, subtree:true, characterData:true});
  window.addEventListener('cardbit:storefront-rendered', queue);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queue, {once:true}); else queue();

  window.CardbitFlair = Object.freeze({confetti, tick, latchReact, tierColor, still});
})();
