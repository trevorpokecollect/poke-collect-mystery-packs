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
    // For the Sign In / Buy Cardbits dialogs (cardbit-site-auth.js).
    window.CardbitSiteSession = Object.freeze({ signedIn: !!state.account, bits: state.account ? Number(state.account.bits) : undefined });
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
      const body = await call('action', original);
      forget();
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
