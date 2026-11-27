/*
 * Cardbit standalone site: app-style navigation on phones (Trevor, Nov 26 2026).
 *
 * - A slim bottom tab bar replaces the header's menu row: Packs, Top Hits, Card Shop, Pack Pass, How It Works.
 * - The round floating buttons (Chat, Daily Giveaway, Ask Latch, Daily Rewards) become small, static buttons
 *   in one slim row just above the tab bar. Each widget keeps its own button and panel; this script only places
 *   the buttons (inline !important styles beat the widgets' own measured offsets).
 *
 * Phones only (max-width 640px, same breakpoint as the widgets). Wider screens keep the header menu and the
 * widgets' own corners. Styles: public/site/css/cardbit-site-appnav.css.
 */
(function () {
  'use strict';
  if (window.CardbitAppNav) return;
  const PHONE = window.matchMedia('(max-width: 640px)');
  const html = document.documentElement;

  // Cardbit nav icons (Trevor picked Nov 26 2026): small renders of the site's own art: a real Mystery pack, a glowing
  // Legendary card, two Cardbit cards, the gold Cardbit coin (Pack Pass) and a help bubble. Gray when idle, full color
  // when current (CSS). Files: public/site/img/nav/<id>.webp (192px, also used for the app designs).
  const ICON_V = 'r2';
  const icon = id => '<img class="cb-ic cb-ic-' + id + '" src="/site/img/nav/' + id + '.webp?v=' + ICON_V + '" alt="" width="24" height="24" decoding="async">';
  // Same five destinations as the desktop header menu.
  const TABS = [
    { id: 'packs', href: '/packs', label: 'Packs' },
    { id: 'chase', href: '/chase', label: 'Top Hits' },
    { id: 'shop', href: '/shop', label: 'Card Shop' },
    { id: 'pass', href: '/pass', label: 'Pack Pass', pass: true },
    { id: 'help', href: '/help', label: 'How It Works', short: 'Help' },
  ];
  const ALIASES = { 'how-it-works': 'help', 'card-shop': 'shop', singles: 'shop' };

  function current() {
    const seg = location.pathname.replace(/^\/+/, '').split('/')[0].toLowerCase();
    return ALIASES[seg] || seg;
  }

  let bar = null;
  function mountBar() {
    if (bar && bar.isConnected) return bar;
    bar = document.createElement('nav');
    bar.className = 'cb-tabbar';
    bar.setAttribute('aria-label', 'Main');
    bar.innerHTML = TABS.map(t =>
      '<a class="cb-tab' + (t.pass ? ' cb-tab-pass' : '') + '" href="' + t.href + '" data-tab="' + t.id + '" aria-label="' + t.label + '">' +
      icon(t.id) + '<span>' + (t.short || t.label) + '</span></a>').join('');
    document.body.append(bar);
    return bar;
  }
  function markCurrent() {
    if (!bar) return;
    const cur = current();
    for (const a of bar.querySelectorAll('.cb-tab')) {
      if (a.dataset.tab === cur) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }

  // Desktop header (and any page header): swap the old one-color mask icons for the same set.
  function upgradeHeaderIcons() {
    for (const span of document.querySelectorAll('.cb-nav .cb-nav-icon:not(.cb-ic-host)')) {
      const id = (span.className.match(/cb-nav-(packs|chase|shop|help|pass)\b/) || [])[1];
      if (!id) continue;
      span.classList.add('cb-ic-host');
      span.innerHTML = icon(id);
    }
  }

  // ---- Quick-action row: the floating widget buttons, small and static, in one row ----------------
  // [element that is position:fixed, its visible round button] in row order, left to right.
  const ITEMS = [
    () => { const b = document.querySelector('.cb-chat-btn'); return b && [b, b]; },
    () => { const s = document.querySelector('.cbg-shortcut'); return s && !s.hidden && [s, s.querySelector('[data-giveaway-open]') || s]; },
    () => { const h = document.querySelector('.cb-help'); return h && [h, h.querySelector('.cb-help-btn') || h]; },
    () => { const l = document.querySelector('.cb-launch'); return l && [l, l.querySelector('.cb-launch-btn') || l]; },
  ];
  const PROPS = ['left', 'right', 'top', 'bottom', 'transform', 'translate'];
  let placed = new Set();
  function clear(el) {
    for (const p of PROPS) el.style.removeProperty(p);
    el.classList.remove('cb-dock-item');
  }
  // Pack openings play full screen: no bars while the pack is being opened.
  const immersive = () => /^\/open(\/|$)/.test(location.pathname);
  // Row style: "bar" = the buttons sit in a slim strip above the tab bar; "float" = no strip behind them.
  const dockStyle = () => (document.querySelector('[data-dock-style]')?.dataset.dockStyle || 'bar');
  let strip = null;
  function layout() {
    const on = PHONE.matches && !!bar;
    html.classList.toggle('cb-app', on);
    html.classList.toggle('cb-app-immersive', on && immersive());
    html.dataset.dock = dockStyle();
    const items = on ? ITEMS.map(f => f()).filter(Boolean) : [];
    const next = new Set(items.map(([fixed]) => fixed));
    for (const el of placed) if (!next.has(el)) clear(el);
    placed = next;
    html.classList.toggle('cb-app-dock', items.length > 0);
    if (items.length && !(strip && strip.isConnected)) {
      strip = document.createElement('div');
      strip.className = 'cb-dockbar';
      strip.setAttribute('aria-hidden', 'true');
      document.body.append(strip);
    }
    if (!items.length) return;
    // Evenly spaced across the screen, like an app's action row.
    const w = window.innerWidth, n = items.length, size = 40;
    items.forEach(([fixed], i) => {
      const center = ((i + 0.5) / n) * w;
      fixed.classList.add('cb-dock-item');
      fixed.style.setProperty('left', Math.round(center - size / 2) + 'px', 'important');
      fixed.style.setProperty('right', 'auto', 'important');
      fixed.style.setProperty('top', 'auto', 'important');
      fixed.style.setProperty('bottom', 'var(--cb-dock-bottom)', 'important');
      fixed.style.setProperty('transform', 'none', 'important');
      fixed.style.setProperty('translate', 'none', 'important');
    });
  }

  let queued = false;
  function update() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!document.body) return;
      mountBar();
      markCurrent();
      upgradeHeaderIcons();
      layout();
    });
  }

  // The storefront routes with history.pushState; follow it so the right tab lights up.
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function () { const r = orig.apply(this, arguments); update(); return r; };
  }
  window.addEventListener('popstate', update);
  window.addEventListener('resize', update);
  if (PHONE.addEventListener) PHONE.addEventListener('change', update);
  function start() {
    update();
    // The storefront redraws its header on every route; re-apply the icons when it does.
    const store = document.getElementById('cardbit-store');
    if (store) new MutationObserver(() => { if (store.querySelector('.cb-nav .cb-nav-icon:not(.cb-ic-host)')) update(); }).observe(store, { childList: true, subtree: true });
    // Widgets mount (and the giveaway shortcut shows/hides) after load; re-place when the body changes.
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'attributes' || [...m.addedNodes, ...m.removedNodes].some(n => n.nodeType === 1 && !n.classList?.contains('cb-tabbar') && !n.classList?.contains('cb-dockbar'))) { update(); return; }
      }
    }).observe(document.body, { childList: true, attributes: true, attributeFilter: ['hidden'], subtree: false });
    // The giveaway shortcut toggles [hidden] on itself.
    const watchShortcut = () => { const s = document.querySelector('.cbg-shortcut'); if (s && !s.dataset.cbDockWatch) { s.dataset.cbDockWatch = '1'; new MutationObserver(update).observe(s, { attributes: true, attributeFilter: ['hidden'] }); } };
    watchShortcut();
    new MutationObserver(watchShortcut).observe(document.body, { childList: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  window.CardbitAppNav = { update };
})();
