/*
 * Cardbit standalone site: the storefront's data connection.
 * Replaces the theme's Shopify-session and on-device stores with the site's own API
 * (same-origin session cookie). The server is the only source of balances, ownership and prices.
 *
 *   GET  /api/store/state   -> state
 *   POST /api/store/action  {action, requestId, id, amount, openLater, copyIds, destination} -> {...result, state}
 *   POST /api/store/logout  -> {state}
 *
 * The storefront already supports a server-held account ("shopper-test" code paths: per-card
 * retailBits, server orders and shipments). This store reports that mode plus `site: true`
 * for the few places the site differs (sign-in page, top-up checkout, API paths).
 */
(() => {
  'use strict';
  const root = document.getElementById('cardbit-store');

  // Card photos: if a TCGplayer photo fails, try TCGplayer's other image host, then a branded placeholder.
  // Capture phase, because image error events don't bubble.
  const photoPlaceholder = name => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#14323a"/><stop offset="1" stop-color="#0b1418"/></linearGradient></defs>' +
    '<rect width="250" height="350" rx="14" fill="url(#g)"/><rect x="8" y="8" width="234" height="334" rx="10" fill="none" stroke="#2dd4bf" stroke-opacity=".45" stroke-width="2"/>' +
    '<circle cx="125" cy="140" r="34" fill="none" stroke="#2dd4bf" stroke-width="5"/><path d="M91 140h68" stroke="#2dd4bf" stroke-width="5"/><circle cx="125" cy="140" r="9" fill="#0b1418" stroke="#2dd4bf" stroke-width="5"/>' +
    '<text x="125" y="215" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="17" fill="#e6fffb">Photo Coming Soon</text>' +
    '<text x="125" y="242" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" fill="#9fb8bd">' +
    String(name || '').slice(0, 30).replace(/[&<>"']/g, '') + '</text></svg>');
  document.addEventListener('error', event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.cbPhotoFallback === 'done') return;
    const src = img.currentSrc || img.src || '';
    const id = (src.match(/product-images\.tcgplayer\.com\/(?:fit-in\/\d+x\d+\/)?(\d+)\.jpg/) || [])[1];
    if (id && !img.dataset.cbPhotoFallback) {
      img.dataset.cbPhotoFallback = 'cdn';
      img.removeAttribute('srcset');
      img.src = 'https://tcgplayer-cdn.tcgplayer.com/product/' + id + '_in_1000x1000.jpg';
      return;
    }
    if (!id && !/tcgplayer/.test(src) && !img.closest('[class*="card"],[class*="pull"],[class*="vault"],[class*="single"]')) return;
    img.dataset.cbPhotoFallback = 'done';
    img.removeAttribute('srcset');
    img.src = photoPlaceholder(img.alt);
  }, true);
  const apiBase = (root && root.dataset.apiBase) || '/api';
  const sameOrigin = path => {
    const url = new URL(path, location.origin);
    return url.origin === location.origin ? url.pathname + url.search : '/';
  };
  const here = () => location.pathname + location.search;

  // Vault "TCGplayer Market" labels from /api/portfolio. Shown only when the server says market data is
  // approved; the Vault Portfolio panel (cardbit-portfolio.js) reads the same endpoint itself.
  let market = null, marketLoad = null;
  const norm = v => String(v ?? '').trim().toLowerCase();
  const marketKey = c => [c.name, c.number, c.finish ?? c.printing, c.condition, c.language].map(norm).join('|');
  const money = cents => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function loadMarket() {
    if (marketLoad) return marketLoad;
    marketLoad = fetch(apiBase + '/portfolio', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        market = new Map();
        if (data && data.marketApproved) for (const h of data.holdings || []) if (Number.isFinite(h.market) && h.market > 0) market.set(marketKey(h), h);
        if (market.size) window.CardbitSiteRefreshVault?.();
      })
      .catch(() => { market = new Map(); });
    return marketLoad;
  }

  window.CardbitSite = Object.freeze({
    marketLabel: card => {
      if (!market) { loadMarket(); return null; }
      const h = market.get(marketKey(card));
      return h ? { amount: money(h.market), date: h.marketDate ? 'TCGplayer Market as of ' + String(h.marketDate).slice(0, 10) : '' } : null;
    },
    api: path => apiBase + '/' + String(path).replace(/^\/+/, ''),
    signInURL: (returnTo = here()) => (root?.dataset.signIn || '/sign-in') + '?return_to=' + encodeURIComponent(sameOrigin(returnTo)),
    topupURL: amount => (root?.dataset.topupCheckout || '/checkout/cardbits') + '?amount=' + encodeURIComponent(amount) + '&return_to=' + encodeURIComponent(here()),
  });

  // Player card on pack pages: level, XP bar, what this pack earns, Cardbits and Sparks.
  // Mirrors app/lib/cardbit-levels.ts (XP_RULES, xpForLevel, RANKS, SPINNER_TIERS).
  const xpForLevel = level => { const n = Math.min(Math.max(Math.floor(level), 1), 50) - 1; return 50 * n * n + 100 * n; };
  const levelForXp = xp => { let l = 1; while (l < 50 && xp >= xpForLevel(l + 1)) l++; return l; };
  const packXp = bits => Math.floor((Number(bits) || 0) * 0.1) + 25;
  const ranks = [[50, 'Mythic'], [40, 'Legend'], [30, 'Vaultkeeper'], [20, 'Archivist'], [10, 'Curator'], [5, 'Collector'], [1, 'Rookie']];
  const spins = [[5, 'Bronze Spin'], [10, 'Silver Spin'], [20, 'Gold Spin'], [30, 'Cobalt Spin'], [40, 'Holo Spin']];
  const ppNum = n => Number(n || 0).toLocaleString('en-US');
  const escText = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.CardbitPlayerPanel = Object.freeze({
    html(pack) {
      const gain = packXp(pack?.priceBits);
      const acct = lastAccount;
      if (!acct) {
        return '<section class="cbpp" aria-label="Your Player Card"><div class="cbpp-head"><b>Earn XP With Every Pack</b>' +
          '<span class="cbpp-gain">+' + ppNum(gain) + ' XP</span></div><p class="cbpp-note">Sign In to Level Up, Unlock Daily Spins and Collect Sparks.</p></section>';
      }
      const lv = acct.level;
      const bits = '<div><small>Cardbits</small><b>' + ppNum(acct.bits) + '</b></div>';
      const sparks = acct.sparks != null ? '<div><small>Sparks</small><b>' + ppNum(acct.sparks) + '</b></div>' : '';
      if (!lv) return '<section class="cbpp" aria-label="Your Player Card"><div class="cbpp-stats">' + bits + sparks + '</div></section>';
      const rank = (ranks.find(([min]) => lv.level >= min) || [1, 'Rookie'])[1];
      const pct = lv.nextLevelXp ? Math.min(100, Math.round(lv.levelXp / lv.nextLevelXp * 1000) / 10) : 100;
      const after = levelForXp(lv.xp + gain);
      const unlock = spins.find(([min]) => min > lv.level);
      let note;
      if (lv.nextLevelXp == null) note = 'Max Level Reached.';
      else if (after > lv.level) note = 'Opening This Pack Takes You to Level ' + after + '.';
      else note = ppNum(lv.toNext) + ' XP to Level ' + (lv.level + 1) + '.';
      if (unlock) note += ' Reach Level ' + unlock[0] + ' to Unlock the ' + unlock[1] + '.';
      return '<section class="cbpp" aria-label="Your Player Card"><div class="cbpp-head"><span class="cbpp-level"><small>Level</small>' + lv.level + '</span>' +
        '<div class="cbpp-who"><b>' + escText(acct.name) + '</b><small>' + rank + '</small></div></div>' +
        '<div class="cbpp-bar" role="progressbar" aria-label="Level progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '">' +
        '<i style="width:' + pct + '%"></i><i class="cbpp-bar-next" style="left:' + pct + '%;width:' +
        (lv.nextLevelXp ? Math.max(0, Math.min(100 - pct, gain / lv.nextLevelXp * 100)) : 0) + '%"></i></div>' +
        '<p class="cbpp-xp">' + ppNum(lv.levelXp) + (lv.nextLevelXp ? ' / ' + ppNum(lv.nextLevelXp) + ' XP · Lighter Bar Shows This Pack' : ' XP') + '</p>' +
        '<div class="cbpp-stats">' + bits + sparks + '<div><small>This Pack Earns</small><b>+' + ppNum(gain) + ' XP</b></div></div>' +
        '<p class="cbpp-note">' + note + '</p></section>';
    },
  });

  const codeError = (code, message) => Object.assign(new Error(message), { code });
  // Never show internal environment words to collectors.
  const publicText = text => /\b(?:demo|test|fixture|sandbox|preview|simulated|staging)\b/i.test(text) ? '' : text;

  function shape(state) {
    if (!state || typeof state !== 'object') throw codeError('CONNECTION', 'Cardbit could not load your account. Try again.');
    lastAccount = state.account || null;
    // Header level badge (cardbit-rewards-nav.js) follows level-ups without a reload.
    if (state.account?.level?.level) window.CardbitRewardsNav?.update({ level: state.account.level.level });
    // For the Sign In / Buy Cardbits dialogs (cardbit-site-auth.js).
    window.CardbitSiteSession = Object.freeze({ signedIn: !!state.account, id: state.account ? String(state.account.id) : undefined, bits: state.account ? Number(state.account.bits) : undefined });
    // Initials for the header Rewards badge (cardbit-rewards-nav.js).
    if (root && state.account) {
      const parts = String(state.account.name || '').trim().split(/\s+/).filter(Boolean);
      root.dataset.initials = ((parts[0] || '')[0] || '' ) .toUpperCase() + ((parts.length > 1 ? parts[parts.length - 1] : '')[0] || '').toUpperCase() || '?';
    }
    return {
      ...state,
      mode: 'shopper-test',
      topupPromotions: state.topupPromotions !== false,
      packs: state.packs || [], singles: state.singles || [], binder: state.binder || [],
      openings: (state.openings || []).map(o => ({ createdAt: o.at, ...o, cards: o.cards || [] })),
      wants: state.wants || [], shipments: state.shipments || [], history: state.history || [], orders: state.orders || [],
    };
  }

  async function call(endpoint, payload) {
    const options = { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (payload !== undefined) {
      options.method = 'POST';
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload);
    }
    let response, body;
    try { response = await fetch(apiBase + '/store/' + endpoint, options); }
    catch { throw codeError('CONNECTION', 'Cardbit could not be reached. Check your connection and try again.'); }
    try { body = await response.json(); }
    catch { throw codeError('CONNECTION', 'Cardbit could not load your account. Try again.'); }
    if (!response.ok || body.error) {
      if (response.status === 401 || body.code === 'sign_in') throw codeError('sign_in', 'Sign In to Continue.');
      const error = codeError(body.code || 'REQUEST_FAILED', publicText(String(body.error || '')) || 'This Action Could Not Be Completed. Try Again.');
      if (Array.isArray(body.fields)) error.fields = body.fields.map(String);
      if (Array.isArray(body.unavailable)) error.unavailable = body.unavailable.map(String);
      throw error;
    }
    return body;
  }

  /* Pack rewards on the reveal: XP (with an animated level bar the first time) and Sparks.
     The server already credited both when the pack was bought (or, for staff demo packs, revealed);
     this only shows them. A replay shows the same numbers without animating or adding anything. */
  let lastAccount = null;
  const fresh = new Map();
  const fmt = n => Number(n || 0).toLocaleString('en-US');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const pct = lv => (lv && lv.nextLevelXp ? Math.max(0, Math.min(100, (lv.levelXp / lv.nextLevelXp) * 100)) : 100);
  function rewardsNode(openingId, rewards, level, sparksOn) {
    const earnedXp = rewards?.xp || 0, earnedSparks = rewards?.sparks || 0;
    if (!earnedXp && !earnedSparks && !level && !sparksOn) return null;
    const first = fresh.get(openingId);
    fresh.delete(openingId);
    const box = el('section', 'cbpr-rewards' + (first ? ' is-fresh' : ''));
    box.setAttribute('aria-label', 'Pack Rewards');
    box.append(el('p', 'cbpr-kicker', first ? 'Pack Rewards' : 'Earned From This Pack'));
    const row = el('div', 'cbpr-row');
    if (level && earnedXp) {
      const xp = el('div', 'cbpr-xp');
      const head = el('div', 'cbpr-xp-head');
      const gain = el('b', 'cbpr-xp-gain', '+' + fmt(earnedXp) + ' XP');
      const lvl = el('span', 'cbpr-level', 'Level ' + level.level);
      head.append(gain, lvl);
      const bar = el('div', 'cbpr-bar'); const fill = el('i'); bar.append(fill);
      bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Level Progress');
      bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(level.nextLevelXp || 1)); bar.setAttribute('aria-valuenow', String(level.nextLevelXp ? level.levelXp : 1));
      const note = el('small', 'cbpr-note', level.nextLevelXp ? fmt(level.levelXp) + ' / ' + fmt(level.nextLevelXp) + ' XP to Level ' + (level.level + 1) : 'Max Level');
      xp.append(head, bar, note);
      row.append(xp);
      const before = first?.level;
      if (first && before && !reduced()) {
        const ups = Math.max(0, level.level - before.level);
        fill.style.width = pct(before) + '%';
        gain.textContent = '+0 XP';
        lvl.textContent = 'Level ' + before.level;
        const t0 = performance.now(), dur = 1400;
        const tick = now => {
          const k = Math.min(1, (now - t0) / dur);
          gain.textContent = '+' + fmt(Math.round(earnedXp * (1 - Math.pow(1 - k, 3)))) + ' XP';
          if (k < 1) requestAnimationFrame(tick);
        };
        setTimeout(() => {
          requestAnimationFrame(tick);
          if (!ups) { fill.style.width = pct(level) + '%'; return; }
          fill.style.width = '100%';
          setTimeout(() => {
            fill.style.transition = 'none'; fill.style.width = '0%';
            lvl.textContent = 'Level ' + level.level;
            box.classList.add('is-level-up');
            const badge = el('span', 'cbpr-level-up', 'Level Up!'); head.append(badge);
            void fill.offsetWidth; fill.style.transition = ''; fill.style.width = pct(level) + '%';
          }, 760);
        }, 350);
      } else fill.style.width = pct(level) + '%';
    }
    if (sparksOn || earnedSparks) {
      const sp = el('div', 'cbpr-sparks' + (earnedSparks ? '' : ' is-none'));
      const icon = el('img'); icon.alt = ''; icon.width = 34; icon.height = 34; icon.src = sparksIcon();
      const text = el('div');
      text.append(el('b', '', earnedSparks ? '+' + fmt(earnedSparks) + ' Sparks' : 'No Sparks This Time'),
        el('small', '', earnedSparks ? 'Added to Your Sparks. Spend Them in the Spark Shop.' : 'Sparks Are Earned When Your Pulls Come In Under the Pack Price.'));
      sp.append(icon, text);
      row.append(sp);
    }
    if (!row.children.length) return null;
    box.append(row);
    return box;
  }
  function sparksIcon() { return window.cardbitAssets?.['sparks.svg'] || '/site/assets/cardbit-sparks.svg'; }
  // While a just-opened pack is still face down, the header keeps the old Sparks balance so it can't
  // hint at the pull (Sparks only come when the pull is under the pack price).
  let heldSparks = null;
  window.CardbitRevealRewards = Object.freeze({
    node(opening) {
      const acct = lastAccount;
      if (!opening || !acct) return null;
      const box = rewardsNode(opening.id, opening.rewards, acct.level || null, acct.sparks != null);
      if (!fresh.size && heldSparks != null) {
        heldSparks = null;
        const v = fmt(acct.sparks);
        for (const n of document.querySelectorAll('[data-sparks-balance]')) n.textContent = v;
        for (const a of document.querySelectorAll('.cb-sparks-link')) a.setAttribute('aria-label', 'Sparks, Balance ' + v);
      }
      return box;
    },
    shownSparks: n => (heldSparks != null && fresh.size ? heldSparks : n),
  });

  // Keep the original request if a response is lost, so a retry returns the saved result.
  const inFlight = new Map();
  async function action(input) {
    const key = 'cardbit:site-request:' + input.requestId;
    let original = inFlight.get(key);
    if (!original) { try { original = JSON.parse(sessionStorage.getItem(key)); } catch {} }
    if (!original) {
      original = { ...input, payment: undefined };
      inFlight.set(key, original);
      try { sessionStorage.setItem(key, JSON.stringify(original)); } catch {}
    }
    const forget = () => { inFlight.delete(key); try { sessionStorage.removeItem(key); } catch {} };
    try {
      const before = lastAccount;
      const body = await call('action', original);
      forget();
      if ((input.action === 'open' || input.action === 'reveal') && body.openingId && body.rewards && (body.rewards.xp || body.rewards.sparks))
      { fresh.set(body.openingId, { level: before?.level || null }); if (before?.sparks != null) heldSparks = before.sparks; }
      return { ...body, state: shape(body.state) };
    } catch (error) {
      if (error.code !== 'CONNECTION') forget();
      throw error;
    }
  }

  window.CardbitStore = Object.freeze({
    mode: 'shopper-test', site: true,
    requestKey: () => crypto.randomUUID(),
    state: async () => shape(await call('state')),
    action,
    login: () => {
      if (window.CardbitSiteAuth) window.CardbitSiteAuth.signIn();
      else location.assign(window.CardbitSite.signInURL());
      return new Promise(() => {});
    },
    logout: async () => ({ state: shape((await call('logout', {})).state) }),
  });
})();
