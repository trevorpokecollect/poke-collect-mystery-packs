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

  const codeError = (code, message) => Object.assign(new Error(message), { code });
  // Never show internal environment words to collectors.
  const publicText = text => /\b(?:demo|test|fixture|sandbox|preview|simulated|staging)\b/i.test(text) ? '' : text;

  function shape(state) {
    if (!state || typeof state !== 'object') throw codeError('CONNECTION', 'Cardbit could not load your account. Try again.');
    lastAccount = state.account || null;
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
