/*
 * Cardbit standalone site: Sign In and Buy Cardbits dialogs.
 *
 * Small themed windows over the page (the site stays visible behind them) instead of the
 * full-page /sign-in and /checkout/cardbits screens, which remain as no-JavaScript fallbacks.
 *
 *   POST /sign-in             (Accept: application/json) intent=send|verify -> {step}|{signedIn}|{error}
 *   POST /checkout/cardbits   (Accept: application/json) amount,state,zip   -> {redirect}|{error}
 *   GET  /auth/google?return_to=
 *
 * The storefront theme file is generated (scripts/site/port-theme.mjs), so this file hooks in
 * from outside: clicks on sign-in links, the signed-out account button, the header wallet and
 * the top-up buttons open these dialogs. The server re-checks everything.
 */
(() => {
  'use strict';
  const PACKAGES = [
    { bits: 1000, bonus: 0, cents: 1000 },
    { bits: 5000, bonus: 0, cents: 5000 },
    { bits: 10000, bonus: 500, cents: 10000 },
    { bits: 50000, bonus: 5000, cents: 50000 },
  ];
  const STATES = [['AK','Alaska'],['AR','Arkansas'],['AZ','Arizona'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DC','District of Columbia'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],['IA','Iowa'],['IL','Illinois'],['IN','Indiana'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['MA','Massachusetts'],['MD','Maryland'],['ME','Maine'],['MI','Michigan'],['MO','Missouri'],['MS','Mississippi'],['MT','Montana'],['NC','North Carolina'],['ND','North Dakota'],['NE','Nebraska'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['VA','Virginia'],['VT','Vermont'],['WI','Wisconsin'],['WV','West Virginia'],['WY','Wyoming']];
  const AFTER_KEY = 'cardbit:after-sign-in';
  const BILLING_KEY = 'cardbit:billing:v1';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  const num = n => Number(n).toLocaleString('en-US');
  const usd = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const here = () => location.pathname + location.search;
  const sameOrigin = path => { try { const u = new URL(path, location.origin); return u.origin === location.origin ? u.pathname + u.search : '/'; } catch { return '/'; } };
  const store = () => document.getElementById('cardbit-store');
  const asset = name => (window.cardbitAssets || {})[name] || '';
  const session = { get(k) { try { return sessionStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} } };
  const local = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

  const GOOGLE_G = '<svg class="cbx-g" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  const CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const LOCK = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

  // ---------- who is signed in (recorded by cardbit-site-store.js from each state read) ----------
  const signedIn = () => window.CardbitSiteSession?.signedIn;
  const balance = () => window.CardbitSiteSession?.bits;

  // ---------- dialog frame ----------
  let dlg = null, lastFocus = null, busy = false;
  function close() {
    if (!dlg || busy) return;
    const old = dlg; dlg = null;
    if (old.open) old.close();
    old.remove();
    document.documentElement.classList.remove('cbx-lock');
    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }
  function open(label, html, cls) {
    // Close a storefront dialog that asked the shopper to sign in, so only one window shows.
    store()?.querySelector('dialog.cb-dialog:not(.cbx) [data-cb-do=close]')?.click();
    if (dlg) { dlg.remove(); dlg = null; } else lastFocus = document.activeElement;
    dlg = document.createElement('dialog');
    dlg.className = 'cb-dialog cbx ' + (cls || '');
    dlg.setAttribute('aria-labelledby', 'cbx-title');
    dlg.innerHTML = '<button type="button" class="cbx-x" data-cbx="close" aria-label="Close">' + CLOSE + '</button>' + html;
    (store() || document.body).append(dlg);
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dlg.addEventListener('click', e => {
      if (e.target === dlg) { const b = dlg.getBoundingClientRect(); if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) close(); }
    });
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    document.documentElement.classList.add('cbx-lock');
    focusFirst();
    return dlg;
  }
  function focusFirst() {
    const first = dlg?.querySelector('[data-cbx-focus]') || dlg?.querySelector('input:not([type=hidden]),select,button:not(.cbx-x)');
    first?.focus({ preventScroll: true });
  }
  function setError(text) {
    const el = dlg?.querySelector('[data-cbx-error]');
    if (el) { el.textContent = text || ''; el.hidden = !text; }
  }
  function setBusy(button, on, label) {
    busy = on;
    if (!button) return;
    if (on) { button.dataset.label = button.innerHTML; button.disabled = true; button.innerHTML = '<span class="cbx-spin" aria-hidden="true"></span>' + esc(label); }
    else { button.disabled = false; if (button.dataset.label) button.innerHTML = button.dataset.label; }
  }
  async function post(url, fields) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) if (v != null) body.set(k, String(v));
    let res, data;
    try { res = await fetch(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, body }); }
    catch { throw new Error('Cardbit Could Not Be Reached. Check Your Connection and Try Again.'); }
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok || data.error) throw Object.assign(new Error(data.error || 'Something Went Wrong. Please Try Again.'), { code: data.code, status: res.status });
    return data;
  }

  // ---------- Sign In ----------
  const head = (kicker, title, sub, emblem = true) =>
    '<div class="cbx-head">' + (emblem && asset('brand-emblem.png') ? '<img class="cbx-emblem" alt="" width="40" height="40" src="' + esc(asset('brand-emblem.png')) + '">' : '') +
    '<p class="cb-kicker">' + esc(kicker) + '</p><h2 id="cbx-title">' + esc(title) + '</h2>' + (sub ? '<p class="cbx-sub">' + sub + '</p>' : '') + '</div>';
  const errorLine = '<p class="cbx-error" data-cbx-error role="alert" hidden></p>';
  const terms = '<p class="cbx-fine">By Continuing You Agree to the <a href="/policies" target="_blank" rel="noopener">Terms and Privacy Policy</a>.</p>';

  let signInState = { returnTo: null, after: null, email: '' };
  function signIn(opts = {}) {
    signInState = { returnTo: opts.returnTo ? sameOrigin(opts.returnTo) : null, after: opts.after || null, email: signInState.email || '' };
    emailStep(opts.error);
  }
  function emailStep(error) {
    const back = signInState.returnTo || here();
    open('Sign In',
      head('Collector Account', 'Sign In to Cardbit', 'Open Packs, Keep Your Pulls in My Vault and Buy Cardbits. New Here? This Creates Your Account.') +
      '<a class="cbx-google" data-cbx="google" href="/auth/google?return_to=' + encodeURIComponent(back) + '">' + GOOGLE_G + '<span>Continue With Google</span></a>' +
      '<div class="cbx-or"><span>or</span></div>' +
      '<form class="cbx-form" data-cbx-form="send" novalidate><label for="cbx-email">Email</label>' +
      '<input id="cbx-email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" required value="' + esc(signInState.email) + '">' +
      errorLine + '<button type="submit" class="cb-primary cbx-wide">Email Me a Sign-In Code</button></form>' + terms,
      'cbx-signin');
    if (error) setError(error);
  }
  function codeStep(email, note) {
    open('Sign In',
      head('Check Your Email', 'Enter Your Code', 'We Sent a 6-Digit Code to <b>' + esc(email) + '</b>. It Works for 10 Minutes.') +
      '<form class="cbx-form" data-cbx-form="verify" novalidate><label for="cbx-code">Sign-In Code</label>' +
      '<input id="cbx-code" class="cbx-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required data-cbx-focus>' +
      errorLine + (note ? '<p class="cbx-note" role="status">' + esc(note) + '</p>' : '') +
      '<button type="submit" class="cb-primary cbx-wide">Sign In</button></form>' +
      '<div class="cbx-links"><button type="button" class="cbx-link" data-cbx="resend">Send a New Code</button><button type="button" class="cbx-link" data-cbx="change-email">Use a Different Email</button></div>',
      'cbx-signin');
  }
  async function sendCode(button, resend) {
    const input = dlg?.querySelector('#cbx-email');
    const email = resend ? signInState.email : String(input?.value || '').trim();
    if (!resend && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setError('Enter a Valid Email Address.'); input?.focus(); return; }
    setError(''); setBusy(button, true, 'Sending…');
    try {
      const r = await post('/sign-in', { intent: 'send', email, return_to: signInState.returnTo || here() });
      busy = false; signInState.email = r.email || email;
      codeStep(signInState.email, resend ? 'A New Code Is on Its Way.' : '');
    } catch (e) { setBusy(button, false); setError(e.message); }
  }
  async function verify(button) {
    const input = dlg?.querySelector('#cbx-code');
    const code = String(input?.value || '').replace(/\D/g, '');
    if (code.length !== 6) { setError('Enter the 6-Digit Code From the Email.'); input?.focus(); return; }
    setError(''); setBusy(button, true, 'Signing In…');
    try {
      await post('/sign-in', { intent: 'verify', email: signInState.email, code, return_to: signInState.returnTo || here() });
      finishSignIn();
    } catch (e) { setBusy(button, false); setError(e.message); input?.select(); }
  }
  function finishSignIn() {
    if (signInState.after) session.set(AFTER_KEY, signInState.after);
    const to = signInState.returnTo;
    busy = false;
    if (to && to !== here()) location.assign(to); else location.reload();
  }

  // ---------- Buy Cardbits ----------
  let buyState = { amount: 10000 };
  function buy(amount) {
    if (signedIn() === false) { signIn({ after: 'buy:' + (amount || '') }); return; }
    if (PACKAGES.some(p => p.bits === Number(amount))) buyState.amount = Number(amount);
    const billing = local.get(BILLING_KEY) || {};
    const bal = balance();
    const tiles = PACKAGES.map(p =>
      '<label class="cbx-pack' + (p.bonus ? ' cbx-pack-bonus' : '') + '">' +
      '<input type="radio" name="amount" value="' + p.bits + '"' + (p.bits === buyState.amount ? ' checked data-cbx-focus' : '') + '>' +
      (p.bits === 50000 ? '<span class="cbx-flag">Best Value</span>' : '') +
      '<span class="cbx-pack-bits">' + (window.cardbitValueIcon ? '<img alt="" width="20" height="22" src="' + esc(window.cardbitValueIcon) + '">' : '') + num(p.bits + p.bonus) + '</span>' +
      '<span class="cbx-pack-math">' + (p.bonus ? '+' + num(p.bonus) + ' Bonus' : 'Cardbits') + '</span>' +
      '<span class="cbx-pack-price">' + usd(p.cents) + '</span></label>').join('');
    const options = STATES.map(([c, n]) => '<option value="' + c + '"' + (billing.state === c ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
    open('Buy Cardbits',
      head('Cardbits Wallet', 'Buy Cardbits', Number.isFinite(bal) ? 'Your Balance: <b>' + num(bal) + ' Cardbits</b>' : 'Use Cardbits to Open Packs and Buy Cards.', false) +
      '<form class="cbx-form" data-cbx-form="buy" novalidate><fieldset class="cbx-packs"><legend class="cbx-sr">Choose an Amount</legend>' + tiles + '</fieldset>' +
      '<div class="cbx-total" data-cbx-total></div>' +
      '<div class="cbx-row"><div><label for="cbx-state">Billing State</label><select id="cbx-state" name="state" autocomplete="billing address-level1" required><option value="">Choose…</option>' + options + '</select></div>' +
      '<div><label for="cbx-zip">Billing ZIP</label><input id="cbx-zip" name="zip" inputmode="numeric" autocomplete="billing postal-code" pattern="[0-9]{5}" maxlength="5" required value="' + esc(billing.zip || '') + '"></div></div>' +
      errorLine + '<button type="submit" class="cb-primary cbx-wide">' + LOCK + '<span>Continue to Secure Checkout</span></button></form>' +
      '<p class="cbx-fine">$1 Buys 100 Cardbits. Pay by Card on Our Payment Partner’s Secure Page. Cardbits Purchases Are Final Sale. Not Available in AL, HI, ID, MN, NV, NY, UT or WA. <a href="/cardbits">Balance History</a></p>',
      'cbx-buy');
    updateTotal();
  }
  function updateTotal() {
    const picked = Number(dlg?.querySelector('input[name=amount]:checked')?.value);
    const p = PACKAGES.find(x => x.bits === picked);
    const el = dlg?.querySelector('[data-cbx-total]');
    if (!el || !p) return;
    buyState.amount = p.bits;
    el.innerHTML = '<span>You Get <b>' + num(p.bits + p.bonus) + ' Cardbits</b>' + (p.bonus ? ' <small>(' + num(p.bits) + ' + ' + num(p.bonus) + ' Bonus)</small>' : '') + '</span><b>' + usd(p.cents) + '</b>';
  }
  async function checkout(button) {
    const f = dlg.querySelector('form');
    const state = f.state.value, zip = String(f.zip.value || '').trim();
    if (!state) { setError('Choose Your Billing State.'); f.state.focus(); return; }
    if (!/^\d{5}$/.test(zip)) { setError('Enter a 5-Digit ZIP Code.'); f.zip.focus(); return; }
    local.set(BILLING_KEY, { state, zip });
    let device = '';
    try { device = window.nSureSDK?.getDeviceId?.() || ''; } catch {}
    setError(''); setBusy(button, true, 'Opening Secure Checkout…');
    try {
      const r = await post('/checkout/cardbits', { amount: buyState.amount, state, zip, device_id: device, return_to: here() });
      location.assign(r.redirect);
    } catch (e) {
      setBusy(button, false);
      if (e.code === 'sign_in') { busy = false; signIn({ after: 'buy:' + buyState.amount, error: 'Sign In to Buy Cardbits.' }); return; }
      setError(e.message);
    }
  }

  // ---------- wiring ----------
  document.addEventListener('submit', e => {
    const form = e.target.closest?.('[data-cbx-form]');
    if (!form || !dlg?.contains(form)) return;
    e.preventDefault();
    if (busy) return;
    const button = form.querySelector('button[type=submit]');
    ({ send: () => sendCode(button), verify: () => verify(button), buy: () => checkout(button) })[form.dataset.cbxForm]?.();
  }, true);
  document.addEventListener('change', e => { if (dlg && e.target.name === 'amount' && dlg.contains(e.target)) updateTotal(); }, true);
  document.addEventListener('input', e => {
    if (e.target.id === 'cbx-code' && String(e.target.value).replace(/\D/g, '').length === 6 && !busy) verify(dlg.querySelector('[data-cbx-form=verify] button[type=submit]'));
  }, true);

  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const t = e.target.closest?.('a,button');
    if (!t) return;
    if (dlg && dlg.contains(t)) {
      const act = t.dataset.cbx;
      if (act === 'close') { e.preventDefault(); close(); }
      else if (act === 'resend') { e.preventDefault(); if (!busy) sendCode(t, true); }
      else if (act === 'change-email') { e.preventDefault(); emailStep(); }
      else if (act === 'google') { if (signInState.after) session.set(AFTER_KEY, signInState.after); }
      return;
    }
    const href = t.tagName === 'A' ? t.getAttribute('href') || '' : '';
    // Header wallet or any Buy Cardbits button: open the Buy Cardbits window.
    if (t.matches('.cb-wallet-link,[data-cb-buy-cardbits]')) { e.preventDefault(); e.stopPropagation(); buy(); return; }
    // Top-up package buttons on the Cardbits page.
    if (t.matches('[data-cb-do=review][data-action=topup]')) { e.preventDefault(); e.stopPropagation(); buy(Number(t.dataset.amount)); return; }
    // Account button while signed out: sign in right away (lands on My Account).
    if (t.matches('.cb-binder-link') && signedIn() === false) { e.preventDefault(); e.stopPropagation(); signIn({ returnTo: '/account' }); return; }
    // Any link to the full-page sign-in.
    if (href && /^\/sign-in(?:[?#]|$)/.test(href)) {
      e.preventDefault(); e.stopPropagation();
      const rt = new URL(href, location.origin).searchParams.get('return_to');
      signIn({ returnTo: rt && rt !== here() ? rt : null });
    }
  }, true);

  window.CardbitSiteAuth = Object.freeze({ signIn, buy, close });

  // The storefront asks signed-out shoppers to sign in with its own small dialog that links to
  // /sign-in. Swap it straight for the sign-in window so it takes one click, not two.
  function watchStorefront() {
    const root = store();
    if (!root) return;
    new MutationObserver(() => {
      const theirs = root.querySelector('dialog.cb-dialog:not(.cbx) .cb-login a[href^="/sign-in"]');
      if (theirs && !dlg) signIn();
    }).observe(root, { childList: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchStorefront); else watchStorefront();

  // After a reload or a Google round trip: reopen what the shopper was doing, or show a sign-in error.
  function resume() {
    const url = new URL(location.href);
    const err = url.searchParams.get('signin_error');
    if (err) {
      url.searchParams.delete('signin_error');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      signIn({ error: err.slice(0, 200) });
      return;
    }
    const after = session.get(AFTER_KEY);
    if (!after) return;
    session.set(AFTER_KEY, null);
    if (after.startsWith('buy:') && signedIn()) buy(Number(after.slice(4)) || undefined);
  }
  // Wait for the first account read so we know whether the shopper is signed in.
  let tries = 0;
  (function waitForSession() {
    if (window.CardbitSiteSession || tries++ > 50) resume(); else setTimeout(waitForSession, 100);
  })();
})();
