/* Cardbit ad pixels behind a consent banner (Trevor 2026-11-25: Meta, TikTok and Google Ads).
 * Nothing loads until the visitor taps Accept. Decline, a Global Privacy Control signal, or "Do Not Sell
 * or Share" in Your Privacy Choices keeps every pixel off. Choice is kept 12 months in the first-party
 * cookie cb_consent (granted | denied). Pixel IDs come from Railway variables via data-* attributes
 * (shell.server.ts adsTag); with none set this script is never included. No email, name or phone is
 * sent to ad partners (no advanced matching). Events: PageView, and Purchase on the Cardbits Added page
 * (<meta name="cb-ad-event">, sent once per top-up).
 */
(() => {
  const me = document.currentScript;
  if (!me) return;
  const cfg = { meta: me.dataset.meta || '', tiktok: me.dataset.tiktok || '', gads: me.dataset.gads || '', gadsPurchase: me.dataset.gadsPurchase || '' };
  if (!cfg.meta && !cfg.tiktok && !cfg.gads) return;
  const COOKIE = 'cb_consent';
  const YEAR = 365 * 24 * 3600;
  const gpc = navigator.globalPrivacyControl === true;
  const read = () => (document.cookie.match(/(?:^|; )cb_consent=(granted|denied)/) || [])[1] || null;
  const write = (v) => { document.cookie = `${COOKIE}=${v}; Path=/; Max-Age=${YEAR}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; };
  const choice = () => (gpc ? 'denied' : read());
  const partners = [cfg.meta && 'Meta', cfg.tiktok && 'TikTok', cfg.gads && 'Google'].filter(Boolean).join(', ');

  // ---------- pixels ----------
  let loaded = false;
  function addScript(src) {
    const s = document.createElement('script');
    s.async = true;
    s.src = src;
    document.head.appendChild(s);
  }
  function load() {
    if (loaded) return;
    loaded = true;
    if (cfg.meta) {
      const f = (window.fbq = function () { f.callMethod ? f.callMethod.apply(f, arguments) : f.queue.push(arguments); });
      if (!window._fbq) window._fbq = f;
      f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
      addScript('https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', cfg.meta);
      window.fbq('track', 'PageView');
    }
    if (cfg.tiktok) {
      const t = (window.ttq = window.ttq || []);
      t.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
      t.setAndDefer = (o, m) => { o[m] = function () { o.push([m].concat([].slice.call(arguments, 0))); }; };
      t.methods.forEach((m) => t.setAndDefer(t, m));
      t.instance = (id) => { const e = t._i[id] || []; t.methods.forEach((m) => t.setAndDefer(e, m)); return e; };
      t.load = (id) => {
        t._i = t._i || {}; t._i[id] = []; t._i[id]._u = 'https://analytics.tiktok.com/i18n/pixel/events.js';
        t._t = t._t || {}; t._t[id] = +new Date(); t._o = t._o || {}; t._o[id] = {};
        addScript('https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=' + encodeURIComponent(id) + '&lib=ttq');
      };
      t.load(cfg.tiktok);
      t.page();
    }
    if (cfg.gads) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag('consent', 'default', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'denied' });
      window.gtag('js', new Date());
      window.gtag('config', cfg.gads);
      addScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(cfg.gads));
    }
    sendEvents();
  }
  function sendEvents() {
    document.querySelectorAll('meta[name="cb-ad-event"]').forEach((m) => {
      let e;
      try { e = JSON.parse(m.content); } catch { return; }
      if (!e || e.event !== 'purchase' || !e.id) return;
      const key = 'cardbit:ad-sent:' + e.id;
      try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch {}
      const value = Number(e.value) || 0;
      if (cfg.meta && window.fbq) window.fbq('track', 'Purchase', { value, currency: 'USD', content_type: 'product', content_name: 'Cardbits' }, { eventID: e.id });
      if (cfg.tiktok && window.ttq) window.ttq.track('CompletePayment', { value, currency: 'USD', content_type: 'product', content_name: 'Cardbits' }, { event_id: e.id });
      if (cfg.gads && window.gtag && cfg.gadsPurchase) window.gtag('event', 'conversion', { send_to: cfg.gads + '/' + cfg.gadsPurchase, value, currency: 'USD', transaction_id: e.id });
    });
  }
  // Partner cookies set on our own domain; cleared when someone turns ads off.
  function clearPartnerCookies() {
    const host = location.hostname.replace(/^www\./, '');
    ['_fbp', '_fbc', '_ttp', '_gcl_au', '_gcl_aw'].forEach((n) => {
      for (const d of ['', '; Domain=' + host, '; Domain=.' + host]) document.cookie = `${n}=; Path=/; Max-Age=0${d}`;
    });
  }

  // ---------- banner and Your Privacy Choices ----------
  const css = `
.cbc{position:fixed;z-index:2147483000;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;background:#101619;color:#d4e0df;border:1px solid #2c3a3d;border-radius:16px;padding:16px 18px;box-shadow:0 18px 50px rgba(0,0,0,.45);font:15px/1.45 "Atkinson Hyperlegible Next",system-ui,sans-serif}
.cbc h2{margin:0 0 6px;font:800 18px Outfit,system-ui,sans-serif;color:#fff}
.cbc p{margin:0 0 12px}
.cbc a{color:#00e6e1}
.cbc-row{display:flex;flex-wrap:wrap;gap:8px}
.cbc button{flex:1 1 140px;min-height:44px;border-radius:12px;font:800 15px Outfit,system-ui,sans-serif;cursor:pointer;border:1px solid #2c3a3d;background:#1d2729;color:#fff}
.cbc button.cbc-yes{background:#00e6e1;border-color:#00e6e1;color:#0b1517}
.cbc button:focus-visible{outline:2px solid #ffb65c;outline-offset:2px}
.cbc label{display:flex;gap:10px;align-items:flex-start;margin:0 0 12px;cursor:pointer}
.cbc input{margin-top:4px;width:18px;height:18px;accent-color:#00e6e1}
.cbc small{display:block;color:#9fb0b1}
.cbc-foot{color:inherit;opacity:.8;text-decoration:underline;font-size:13px;background:none;border:0;padding:0;cursor:pointer;font-family:inherit}`;
  let box = null;
  function ensureCss() {
    if (document.getElementById('cbc-css')) return;
    const st = document.createElement('style');
    st.id = 'cbc-css';
    st.textContent = css;
    document.head.appendChild(st);
  }
  function close() { if (box) { box.remove(); box = null; } }
  function decide(v) {
    const was = choice();
    write(v);
    close();
    if (v === 'granted') load();
    else {
      clearPartnerCookies();
      if (was === 'granted' || loaded) location.reload(); // unload pixels already running on this page
    }
  }
  function banner() {
    ensureCss();
    close();
    box = document.createElement('section');
    box.className = 'cbc';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Cookie Choices');
    box.innerHTML = `<h2>Cookies for Ads</h2><p>With your OK, our ad partners (${partners}) set cookies to measure our ads. We never send them your email, name or phone. Change this anytime in Your Privacy Choices. <a href="/policies#privacy">Privacy Policy</a></p><div class="cbc-row"><button type="button" class="cbc-yes">Accept</button><button type="button" class="cbc-no">Decline</button></div>`;
    box.querySelector('.cbc-yes').onclick = () => decide('granted');
    box.querySelector('.cbc-no').onclick = () => decide('denied');
    document.body.appendChild(box);
  }
  function settings() {
    ensureCss();
    close();
    const on = choice() === 'granted';
    box = document.createElement('section');
    box.className = 'cbc';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Your Privacy Choices');
    box.innerHTML = `<h2>Your Privacy Choices</h2>` +
      (gpc
        ? `<p>Your browser sends a Global Privacy Control signal, so we treat it as a request not to sell or share your personal information. Ad cookies stay off.</p><div class="cbc-row"><button type="button" class="cbc-no">Close</button></div>`
        : `<label><input type="checkbox" ${on ? 'checked' : ''}><span><b>Ad Cookies</b><small>${partners} cookies that measure our ads. Turning this off is how you opt out of the "sale" or "sharing" of your personal information for targeted ads under California and other state laws.</small></span></label><div class="cbc-row"><button type="button" class="cbc-yes">Save</button><button type="button" class="cbc-no">Cancel</button></div>`) +
      `<p style="margin:10px 0 0"><a href="/policies#privacy">Privacy Policy</a></p>`;
    const yes = box.querySelector('.cbc-yes');
    if (yes) yes.onclick = () => decide(box.querySelector('input').checked ? 'granted' : 'denied');
    box.querySelector('.cbc-no').onclick = close;
    document.body.appendChild(box);
    (box.querySelector('input') || box.querySelector('button')).focus();
  }
  window.cardbitPrivacyChoices = settings;
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('[data-privacy-choices], a[href="#privacy-choices"]');
    if (!a) return;
    e.preventDefault();
    settings();
  });

  // A "Your Privacy Choices" link in the footer (the storefront footer is drawn by script, so wait for it).
  function addFooterLink() {
    const foot = document.querySelector('footer');
    if (!foot || foot.querySelector('[data-privacy-choices]')) return !!foot;
    const p = document.createElement('p');
    p.style.cssText = 'margin:8px 0 0;text-align:center';
    p.innerHTML = '<button type="button" class="cbc-foot" data-privacy-choices>Your Privacy Choices · Do Not Sell or Share My Personal Information</button>';
    ensureCss();
    foot.appendChild(p);
    return true;
  }

  function start() {
    const c = choice();
    if (c === 'granted') load();
    else if (c == null) banner();
    if (!addFooterLink()) {
      let tries = 0;
      const t = setInterval(() => { if (addFooterLink() || ++tries > 20) clearInterval(t); }, 500);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
