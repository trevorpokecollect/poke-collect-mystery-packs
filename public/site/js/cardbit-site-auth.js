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
  const AGE_TICK_KEY = 'cardbit:age-ticked:v1';
  const AGE_OK_KEY = 'cardbit:age-ok:';
  const AGE_MSG = 'Confirm You’re 18 or Older to Continue.';
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
  const APPLE = '<svg class="cbx-g" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16.37 1.43c0 1.14-.5 2.27-1.18 3.08-.74.9-1.99 1.57-2.99 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.57-2.27 1.21-2.98.8-.94 2.14-1.64 3.25-1.68.03.13.05.28.05.43zm4.56 15.71c-.03.07-.46 1.58-1.52 3.12-.94 1.34-1.94 2.71-3.43 2.71-1.52 0-1.9-.88-3.63-.88-1.7 0-2.3.91-3.67.91-1.38 0-2.33-1.26-3.43-2.8C3.96 18.38 2.92 15.57 2.92 12.92c0-4.28 2.8-6.55 5.55-6.55 1.45 0 2.68.95 3.6.95.87 0 2.22-1.01 3.9-1.01.61 0 2.89.06 4.37 2.19-.13.09-2.38 1.37-2.38 4.19 0 3.26 2.85 4.42 2.96 4.45z"/></svg>';
  const DISCORD = '<svg class="cbx-g" viewBox="0 0 127.14 96.36" width="22" height="17" aria-hidden="true" focusable="false"><path fill="currentColor" d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15zM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69z"/></svg>';
  const providers = () => {
    const raw = store()?.dataset.signInProviders;
    return raw == null ? ['google'] : raw.split(',').filter(Boolean);
  };
  const PROVIDER_BUTTONS = {
    google: ['cbx-google', GOOGLE_G, 'Continue With Google'],
    apple: ['cbx-apple', APPLE, 'Continue With Apple'],
    discord: ['cbx-discord', DISCORD, 'Continue With Discord'],
  };
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
    signInState = { returnTo: opts.returnTo ? sameOrigin(opts.returnTo) : null, after: opts.after || null, email: signInState.email || '', age: false };
    emailStep(opts.error);
  }
  function emailStep(error) {
    const back = signInState.returnTo || here();
    const ticked = !!local.get(AGE_TICK_KEY);
    const buttons = providers().filter(p => PROVIDER_BUTTONS[p]).map(p => {
      const [cls, logo, label] = PROVIDER_BUTTONS[p];
      return '<a class="cbx-provider ' + cls + '" data-cbx="provider" href="/auth/' + p + '?return_to=' + encodeURIComponent(back) + '">' + logo + '<span>' + label + '</span></a>';
    }).join('');
    open('Sign In',
      head('Collector Account', 'Sign In to Cardbit', 'Open Packs, Keep Your Pulls and Buy Cardbits. New Here? Signing In Creates Your Account.') +
      '<label class="cbx-check"><input type="checkbox" data-cbx-age' + (ticked ? ' checked' : '') + '><span>I’m 18 or Older and Agree to the <a href="/policies" target="_blank" rel="noopener">Terms and Privacy Policy</a>.</span></label>' +
      (buttons ? '<div class="cbx-providers">' + buttons + '</div><div class="cbx-or"><span>or</span></div>' : '') +
      '<form class="cbx-form" data-cbx-form="send" novalidate><label for="cbx-email">Email</label>' +
      '<input id="cbx-email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" required value="' + esc(signInState.email) + '"' + (buttons ? '' : ' data-cbx-focus') + '>' +
      errorLine + '<button type="submit" class="cb-primary cbx-wide">Email Me a Sign-In Code</button></form>',
      'cbx-signin');
    if (error) setError(error);
  }
  function ageTicked() {
    const box = dlg?.querySelector('[data-cbx-age]');
    if (!box) return signInState.age === true;
    if (!box.checked) { setError(AGE_MSG); box.focus(); return false; }
    signInState.age = true; local.set(AGE_TICK_KEY, true);
    return true;
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
    if (!resend && !ageTicked()) return;
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
      await post('/sign-in', { intent: 'verify', email: signInState.email, code, age: signInState.age ? '1' : null, return_to: signInState.returnTo || here() });
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
  async function buy(amount) {
    if (signedIn() === false) { signIn({ after: 'buy:' + (amount || '') }); return; }
    if (await needsAge()) { agePrompt(() => buy(amount)); return; }
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
      else if (act === 'age-yes' || act === 'age-no') { e.preventDefault(); if (!busy) ageAnswer(t, act === 'age-yes'); }
      else if (act === 'reload') { e.preventDefault(); location.assign('/'); }
      else if (act === 'provider') {
        if (!ageTicked()) { e.preventDefault(); return; }
        if (signInState.after) session.set(AFTER_KEY, signInState.after);
        t.href = t.getAttribute('href').replace(/&age=1$/, '') + '&age=1';
      }
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
  // ---------- 18+ confirmation for signed-in accounts that haven't confirmed yet ----------
  function agePrompt(then) {
    open('Confirm Your Age',
      head('One Quick Thing', 'Are You 18 or Older?', 'Cardbit Is for Collectors 18 and Older. Confirm Once and You’re All Set.') +
      errorLine +
      '<div class="cbx-stack"><button type="button" class="cb-primary cbx-wide" data-cbx="age-yes">I’m 18 or Older</button>' +
      '<button type="button" class="cb-secondary cbx-wide" data-cbx="age-no">I’m Under 18</button></div>' +
      '<p class="cbx-fine">See the <a href="/policies" target="_blank" rel="noopener">Terms and Privacy Policy</a>.</p>',
      'cbx-age');
    ageThen = then || null;
  }
  let ageThen = null;
  async function ageAnswer(button, yes) {
    if (!yes) {
      setBusy(button, true, 'Signing Out…');
      try { await fetch('/api/store/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' }); } catch {}
      busy = false; local.set(AGE_TICK_KEY, false);
      open('Signed Out', head('Signed Out', 'Come Back When You’re 18', 'Cardbit Accounts Are Only for Collectors 18 and Older.') +
        '<button type="button" class="cb-primary cbx-wide" data-cbx="reload">Continue Browsing</button>', 'cbx-age');
      return;
    }
    setError(''); setBusy(button, true, 'Saving…');
    try {
      const res = await fetch('/api/age', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ confirm: true, source: 'prompt' }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'That Didn’t Save. Please Try Again.');
      const id = window.CardbitSiteSession?.id; if (id) session.set(AGE_OK_KEY + id, '1');
      busy = false; const next = ageThen; ageThen = null; close(); next?.();
    } catch (e) { setBusy(button, false); setError(e.message); }
  }
  async function needsAge() {
    const id = window.CardbitSiteSession?.id;
    if (!signedIn() || !id || session.get(AGE_OK_KEY + id)) return false;
    try {
      const res = await fetch('/api/age', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!res.ok) return false;
      const body = await res.json();
      if (body.confirmed) { session.set(AGE_OK_KEY + id, '1'); return false; }
      return true;
    } catch { return false; }
  }

  // After a reload or a sign-in round trip: confirm age if needed, reopen what the shopper was
  // doing, or show a sign-in error.
  async function resume() {
    const url = new URL(location.href);
    const err = url.searchParams.get('signin_error');
    if (err) {
      url.searchParams.delete('signin_error');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      signIn({ error: err.slice(0, 200) });
      return;
    }
    const after = session.get(AFTER_KEY);
    session.set(AFTER_KEY, null);
    const continueAfter = () => { if (after && after.startsWith('buy:') && signedIn()) buy(Number(after.slice(4)) || undefined); };
    if (await needsAge()) { if (!dlg) agePrompt(continueAfter); return; }
    continueAfter();
  }
  // Wait for the first account read so we know whether the shopper is signed in.
  let tries = 0;
  (function waitForSession() {
    if (window.CardbitSiteSession || tries++ > 50) resume(); else setTimeout(waitForSession, 100);
  })();
})();
