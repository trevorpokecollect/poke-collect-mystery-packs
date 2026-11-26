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

  // Cardbit nav icons (Nov 26 2026): one set for the phone tab bar, the desktop header and the app designs.
  // Stroke = currentColor; fills come from CSS vars (--ic-fill body, --ic-accent / --ic-accent2 highlights, --ic-solid backing),
  // so the same icon reads quiet when idle and lights up when current. Standalone files: public/site/img/nav/.
  const ICONS = {
    packs: `<path class="f" d="M5 4.6 7.33 3l2.33 1.6L12 3l2.33 1.6L16.67 3 19 4.6V19.4L16.67 21l-2.33-1.6L12 21l-2.33-1.6L7.33 21 5 19.4z"/><path class="a" d="M13.4 7.2h4.2L9.8 16.8H5.6z" stroke="none" opacity=".45"/><path d="M5 4.6 7.33 3l2.33 1.6L12 3l2.33 1.6L16.67 3 19 4.6V19.4L16.67 21l-2.33-1.6L12 21l-2.33-1.6L7.33 21 5 19.4z"/><path d="M5 7.4h14M5 16.6h14"/><path class="a2" d="m12 9.2 1.15 2.8L12 14.8 10.85 12z" stroke-width="1.4"/>`,
    chase: `<rect class="f" x="4.2" y="5.2" width="11" height="15.3" rx="1.8" transform="rotate(-9 9.7 12.9)"/><rect x="4.2" y="5.2" width="11" height="15.3" rx="1.8" transform="rotate(-9 9.7 12.9)"/><path class="a2" d="M17.6 2.4l1.1 2.6 2.6 1.1-2.6 1.1-1.1 2.6-1.1-2.6-2.6-1.1 2.6-1.1z" stroke-width="1.2"/><path class="a" d="m9.6 9.6 1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z" stroke-width="1.2"/>`,
    shop: `<rect class="a2" x="9.4" y="2.4" width="7" height="9.6" rx="1.1" transform="rotate(12 12.9 7.2)" stroke-width="1.4"/><path class="s" d="M4.6 9.6h14.8l-1.2 10a1.6 1.6 0 0 1-1.6 1.4H7.4a1.6 1.6 0 0 1-1.6-1.4z" stroke="none"/><path class="f" d="M4.6 9.6h14.8l-1.2 10a1.6 1.6 0 0 1-1.6 1.4H7.4a1.6 1.6 0 0 1-1.6-1.4z"/><circle cx="9" cy="13" r=".9" fill="currentColor" stroke="none"/><circle cx="15" cy="13" r=".9" fill="currentColor" stroke="none"/><path d="M9 13v1.2a3 3 0 0 0 6 0V13" stroke-width="1.4"/>`,
    pass: `<path class="f" d="M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v2.2a2.4 2.4 0 0 0 0 4.6v2.2a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-2.2a2.4 2.4 0 0 0 0-4.6z"/><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v2.2a2.4 2.4 0 0 0 0 4.6v2.2a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-2.2a2.4 2.4 0 0 0 0-4.6z"/><path d="M15.6 6.4v11.2" stroke-dasharray="1.4 1.9"/><path class="a" d="m9.4 8.6 1.05 2.1 2.3.34-1.66 1.62.4 2.3-2.09-1.1-2.09 1.1.4-2.3-1.66-1.62 2.3-.34z" stroke-width="1.25"/>`,
    help: `<rect class="f" x="4" y="4.5" width="16" height="13.5" rx="4.2"/><rect x="4" y="4.5" width="16" height="13.5" rx="4.2"/><path d="M8.5 18v2.6l3.2-2.6"/><path class="a2" d="M8.2 10.4c.5-.9 1.5-.9 2 0M13.8 10.4c.5-.9 1.5-.9 2 0" stroke-width="1.7"/><path d="M9.6 13.6c1.4 1.1 3.4 1.1 4.8 0" stroke-width="1.6"/><path d="M12 4.5V2.6" /><circle class="a" cx="12" cy="2.2" r="1.1" stroke-width="1.1"/>`,
  };
  const icon = id => '<svg class="cb-ic cb-ic-' + id + '" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICONS[id] + '</svg>';
  // Same five destinations as the desktop header menu.
  const TABS = [
    { id: 'packs', href: '/packs', label: 'Packs' },
    { id: 'chase', href: '/chase', label: 'Chase' },
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
