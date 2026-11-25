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

  window.CardbitSite = Object.freeze({
    api: path => apiBase + '/' + String(path).replace(/^\/+/, ''),
    signInURL: (returnTo = here()) => (root?.dataset.signIn || '/sign-in') + '?return_to=' + encodeURIComponent(sameOrigin(returnTo)),
    topupURL: amount => (root?.dataset.topupCheckout || '/checkout/cardbits') + '?amount=' + encodeURIComponent(amount) + '&return_to=' + encodeURIComponent(here()),
  });

  const codeError = (code, message) => Object.assign(new Error(message), { code });
  // Never show internal environment words to collectors.
  const publicText = text => /\b(?:demo|test|fixture|sandbox|preview|simulated|staging)\b/i.test(text) ? '' : text;

  function shape(state) {
    if (!state || typeof state !== 'object') throw codeError('CONNECTION', 'Cardbit could not load your account. Try again.');
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
    login: () => { location.assign(window.CardbitSite.signInURL()); return new Promise(() => {}); },
    logout: async () => ({ state: shape((await call('logout', {})).state) }),
  });
})();
