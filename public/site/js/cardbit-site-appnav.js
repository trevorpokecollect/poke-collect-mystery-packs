/*
 * Cardbit standalone site: app-style navigation on phones (Trevor, Nov 26 2026).
 *
 * - A slim bottom tab bar replaces the header's menu row: Packs, Chase, Card Shop, Pack Pass, How It Works.
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

  const svg = (d, extra = '') =>
    '<svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"' + extra + '>' + d + '</svg>';
  // Same five destinations as the desktop header menu.
  const TABS = [
    { id: 'packs', href: '/packs', label: 'Packs', icon: svg('<path d="M7 3h10l1 3v15H6V6z"/><path d="M6 6h12"/><path d="M10 11.5 12 10l2 1.5v3L12 16l-2-1.5z"/>') },
    { id: 'chase', href: '/chase', label: 'Chase', icon: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/><path d="m11 8 .9 1.9 2.1.3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1L8 10.2l2.1-.3z" stroke-width="1.3"/>') },
    { id: 'shop', href: '/shop', label: 'Card Shop', icon: svg('<rect x="5" y="3" width="11" height="15" rx="1.6"/><path d="M8.5 21H19V7"/><path d="M8 7h5M8 10h5"/>') },
    { id: 'pass', href: '/pass', label: 'Pack Pass', icon: svg('<path d="M3 8.5V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2.5a2.5 2.5 0 0 0 0 5V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2.5a2.5 2.5 0 0 0 0-5z"/><path d="M14.5 5v12" stroke-dasharray="1.6 2"/><path d="m9 8.6.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z" stroke-width="1.3"/>'), pass: true },
    { id: 'help', href: '/help', label: 'How It Works', short: 'Help', icon: svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.2-2.4 3.7"/><circle cx="12" cy="17.2" r=".4" fill="currentColor"/>') },
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
      t.icon + '<span>' + (t.short || t.label) + '</span></a>').join('');
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
