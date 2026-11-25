/* Cardbit standalone site: Welcome Rewards, backed by /api/welcome (replaces the theme's on-device preview).
   200 Cardbits for email news (credited at signup), 300 for text alerts (credited after the number confirms).
   The storefront renders page() at /welcome and calls bind(); the home band is <cardbit-welcome-summary>. */
(() => {
  'use strict';
  const script = document.querySelector('script[data-cardbit-welcome]');
  if (!script) return;
  const endpoint = script.dataset.endpoint || '/api/welcome';
  const policies = script.dataset.policies || '/policies';
  const methods = {
    email: { name: 'Email News', amount: 200, description: 'New Editions and Featured Singles in Your Inbox.',
      consent: 'Email Me Cardbit News and Offers.', join: 'Join Email News' },
    sms: { name: 'Text Alerts', amount: 300, description: 'Get a Text When a New Pack Drops.',
      consent: 'I Agree to Recurring Automated Marketing Texts from Cardbit at This Number.', join: 'Join Text Alerts' },
  };
  const channels = Object.keys(methods);
  const maxReward = channels.reduce((sum, key) => sum + methods[key].amount, 0);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const coin = () => window.cardbitValueIcon ? '<img class="cbw-coin" src="' + esc(window.cardbitValueIcon) + '" alt="" width="72" height="72" decoding="async">' : '';
  const badge = amount => '<span class="cbw-amount">+' + amount + ' <span>Cardbits</span></span>';

  let view = null, loading = null, flash = '';
  function load(force = false) {
    if (loading && !force) return loading;
    loading = fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('unavailable'))))
      .then(v => { view = v; document.querySelectorAll('cardbit-welcome-summary').forEach(el => el.paint()); return v; })
      .catch(e => { loading = null; throw e; });
    return loading;
  }
  const earned = v => channels.reduce((n, k) => n + (v?.[k]?.awardedAt ? methods[k].amount : 0), 0);

  class WelcomeSummary extends HTMLElement {
    connectedCallback() { this.paint(); load().catch(() => {}); }
    paint() {
      if (!view) { this.innerHTML = ''; return; }
      if (!view.enabled) { this.innerHTML = ''; return; }
      const account = this.dataset.placement === 'account', total = earned(view);
      const started = channels.some(k => view[k]?.status);
      const title = account || started ? 'Welcome Rewards' : 'Get Up to ' + maxReward + ' Free Cardbits';
      const items = channels.map(k => '<li><strong>' + methods[k].amount + '</strong><span>' + methods[k].name +
        (account && view.signedIn ? '<small>' + statusText(view[k]) + '</small>' : '') + '</span></li>').join('');
      this.innerHTML = '<section class="cbw-summary cbw-' + (account ? 'account' : 'home') + '"><div class="cbw-summary-title">' + coin() +
        '<div><h2>' + title + '</h2><p>' + (started ? total + ' of ' + maxReward + ' Cardbits Earned.' : 'Choose Email, Texts, or Both. Earn Cardbits When You Sign Up.') +
        '</p></div></div><ul class="cbw-split">' + items + '</ul><a class="cb-primary" href="/welcome" data-cb-route="welcome">' +
        (started ? 'View Rewards' : 'Get Started') + '</a></section>';
    }
  }
  function statusText(c) {
    if (c?.status === 'subscribed') return c.awardedAt ? 'On · Reward Earned' : 'On';
    if (c?.status === 'pending') return 'Awaiting Confirmation';
    if (c?.status === 'unsubscribed') return 'Turned Off';
    return 'Available to Earn';
  }
  function teaser(placement) { return '<cardbit-welcome-summary data-placement="' + esc(placement) + '"></cardbit-welcome-summary>'; }

  function methodCard(key) {
    const m = methods[key], c = view[key] || {};
    const button = (action, text, style) => '<button type="button" class="' + style + '" data-cbw-action="' + action + '">' + text + '</button>';
    let controls;
    if (c.status === 'pending') {
      controls = '<div class="cbw-pending"><b>Awaiting Confirmation</b><p>Our Text Line Opens Soon. We’ll Text a Confirmation to the Number Ending in ' + esc(c.last4 || '') +
        ' as Soon as It Does. Reply YES to Earn ' + m.amount + ' Cardbits.</p></div><div class="cbw-controls">' + button('leave', 'Cancel Request', 'cbw-quiet') + '</div>';
    } else if (c.status === 'subscribed') {
      controls = '<div class="cbw-confirmed"><b>' + (c.awardedAt ? 'Reward Earned' : 'Preference Saved') + '</b><p>' +
        (c.awardedAt ? m.amount + ' Cardbits Added to Your Wallet.' : 'You’re Signed Up.') + '</p></div>' +
        button('leave', key === 'email' ? 'Turn Off Email' : 'Turn Off Texts', 'cbw-quiet');
    } else {
      const field = key === 'email'
        ? '<label class="cbw-field">Email Address<input type="email" value="' + esc(view.email?.address || '') + '" readonly aria-readonly="true"></label>'
        : '<label class="cbw-field">Mobile Number<input type="tel" autocomplete="tel" inputmode="tel" placeholder="(555) 555-0123" data-cbw-contact required></label>';
      const legal = key === 'sms' ? '<p class="cbw-legal" id="cbw-sms-terms">Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of purchase. US numbers only. See our <a href="' + esc(policies) + '#sms-terms" target="_blank" rel="noopener">Text Message Terms</a> and <a href="' + esc(policies) + '#privacy-policy" target="_blank" rel="noopener">Privacy Policy</a>.</p>' : '';
      controls = '<form data-cbw-form>' + field + '<label class="cbw-consent"><input type="checkbox" data-cbw-consent required' +
        (key === 'sms' ? ' aria-describedby="cbw-sms-terms"' : '') + '><span>' + m.consent + '</span></label>' + legal +
        (c.awardedAt ? '<p class="cbw-kept">Reward Already Earned. You Can Rejoin at Any Time.</p>' : '') +
        '<button class="cb-secondary" type="submit">' + (c.awardedAt ? 'Subscribe Again' : m.join) + '</button></form>';
    }
    return '<section class="cbw-method" data-cbw-channel="' + key + '" aria-labelledby="cbw-' + key + '-name"><div class="cbw-method-head"><h2 id="cbw-' + key +
      '-name" tabindex="-1">' + m.name + '</h2>' + badge(m.amount) + '</div><p class="cbw-desc">' + m.description + '</p>' + controls + '</section>';
  }
  function body() {
    if (!view) return '<p class="cbw-feedback" role="status">Loading Your Rewards…</p>';
    if (!view.enabled) return '<header class="cbw-intro"><div><h1>Welcome Rewards</h1><p>Welcome Rewards Are Coming Soon.</p></div></header>';
    const intro = '<header class="cbw-intro"><div><h1>Get Up to <span>' + maxReward + '</span> Free Cardbits</h1>' +
      '<p>Choose How You Hear About New Packs and Singles. Each Signup Earns Its Reward Once.</p></div>' +
      (view.signedIn ? '<div class="cbw-total">' + coin() + '<div><b>' + earned(view) + ' <span>/ ' + maxReward + '</span></b><small>Cardbits Earned</small></div></div>' : '') + '</header>';
    if (!view.signedIn) return intro + '<div class="cbw-after"><p>Sign In to Choose Your Rewards.</p><div class="cbw-controls"><button type="button" class="cb-primary" data-cbw-signin>Sign In</button></div></div>';
    return intro + '<div class="cbw-methods">' + channels.map(methodCard).join('') + '</div>' +
      '<p class="cbw-feedback" role="status" aria-live="polite" tabindex="-1">' + esc(flash) + '</p>' +
      '<div class="cbw-after"><p>One Reward per Channel per Account. No Purchase Required. You Keep Earned Cardbits If You Unsubscribe. ' +
      '<a href="' + esc(policies) + '" target="_blank" rel="noopener">Cardbit Policies</a>.</p>' +
      (earned(view) ? '<div class="cbw-controls"><a class="cb-secondary" href="/cardbits" data-cb-route="cardbits">View My Wallet</a><a class="cb-primary" href="/shop" data-cb-route="shop">Shop Singles</a></div>' : '') + '</div>';
  }
  function page() { return '<div class="cb-wrap cb-page cbw-page" data-cbw-panel>' + body() + '</div>'; }

  function bind(panel, ctx) {
    const paint = () => { if (panel.isConnected) panel.innerHTML = body(); flash = ''; };
    load(true).then(paint).catch(() => { panel.innerHTML = '<p class="cbw-feedback" role="status">Welcome Rewards Could Not Load. Refresh to Try Again.</p>'; });
    async function send(payload, control) {
      if (ctx.busy()) return;
      const feedback = panel.querySelector('.cbw-feedback');
      ctx.setBusy(true); control.disabled = true; panel.setAttribute('aria-busy', 'true');
      if (feedback) feedback.textContent = 'Saving…';
      try {
        const res = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
        const out = await res.json().catch(() => ({}));
        if (res.status === 401) { window.CardbitStore?.login(); return; }
        if (!res.ok || out.error) throw new Error(out.error || 'Your Preference Could Not Be Saved. Try Again.');
        view = out; flash = out.message || '';
        // Refresh the wallet balance after a credit, then redraw this page.
        const state = await window.CardbitStore?.state().catch(() => null);
        if (state) ctx.setState(state);
        ctx.render();
      } catch (error) {
        if (feedback) { feedback.textContent = error.message; feedback.focus({ preventScroll: true }); }
      } finally {
        ctx.setBusy(false); control.disabled = false; panel.removeAttribute('aria-busy');
      }
    }
    panel.addEventListener('submit', event => {
      const form = event.target.closest('[data-cbw-form]');
      if (!form) return;
      event.preventDefault();
      if (!form.reportValidity()) return;
      const key = form.closest('[data-cbw-channel]').dataset.cbwChannel;
      const consent = form.querySelector('[data-cbw-consent]').checked;
      send(key === 'email' ? { action: 'email', consent } : { action: 'sms', consent, phone: form.querySelector('[data-cbw-contact]').value }, form.querySelector('[type="submit"]'));
    });
    panel.addEventListener('click', event => {
      if (event.target.closest('[data-cbw-signin]')) { window.CardbitStore?.login(); return; }
      const control = event.target.closest('[data-cbw-action="leave"]');
      if (control) send({ action: 'leave', channel: control.closest('[data-cbw-channel]').dataset.cbwChannel }, control);
    });
  }
  if (!customElements.get('cardbit-welcome-summary')) customElements.define('cardbit-welcome-summary', WelcomeSummary);
  window.CardbitWelcome = Object.freeze({ isSample: false, site: true, entry: '/welcome', exit: '/', methods, teaser, page, bind, refresh: () => load(true) });
})();
