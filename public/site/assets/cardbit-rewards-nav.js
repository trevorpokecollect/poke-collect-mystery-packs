/* Adds a "Rewards" link with the signed-in customer's avatar and level beside My Account.
   Uses the Mystery Packs rewards endpoint; a new account shows Level 1 with initials. */
(() => {
  const store = document.getElementById('cardbit-store');
  if (!store || store.hasAttribute('data-cb-rewards')) return;
  const root = (store.dataset.storeRoot || '/').replace(/\/?$/, '/');
  const endpoint = store.dataset.mode === 'site' ? '/api/rewards' : new URL(root + 'apps/packs/api/rewards', location.origin).pathname;
  const icons = window.CardbitRewardIcons || {};
  let data = null;
  const START = { level: 1, avatar: { iconId: null, color: 'cobalt' }, colors: [{ id: 'cobalt', bg: '#4057F5', fg: '#FAF8F3' }] };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function href() {
    /* SITE */ if (store.dataset.mode === 'site') return '/rewards';
    const u = new URL(root, location.origin);
    u.searchParams.set('view', 'rewards');
    const p = store.dataset.previewTheme || new URLSearchParams(location.search).get('preview_theme_id');
    if (p) u.searchParams.set('preview_theme_id', p);
    return u.href;
  }
  function badge() {
    const c = data.colors.find((x) => x.id === data.avatar.color) || data.colors[0];
    const url = data.avatar.iconId && icons[data.avatar.iconId];
    return url
      ? '<img class="cbr-mini" src="' + esc(url) + '" alt="" width="24" height="24">'
      : '<span class="cbr-mini" style="background:' + esc(c.bg) + ';color:' + esc(c.fg) + '">' + esc(store.dataset.initials || '?') + '</span>';
  }
  function place() {
    if (!data) return;
    for (const nav of document.querySelectorAll('#cardbit-store .cb-account')) {
      if (nav.querySelector('.cbr-nav')) continue;
      const a = document.createElement('a');
      a.className = 'cbr-nav';
      a.href = href();
      a.setAttribute('aria-label', 'Rewards, Level ' + data.level);
      a.innerHTML = badge() + '<span>Lv ' + data.level + '</span>';
      nav.insertBefore(a, nav.querySelector('.cb-binder-link'));
    }
  }
  fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((d) => {
      /* SITE */ if (store.dataset.mode === 'site' && !(d && d.enabled && d.signedIn)) return;
      data = d && d.enabled && d.signedIn ? d : START;
      const css = document.createElement('style');
      css.textContent = '#cardbit-store .cbr-nav{display:inline-flex;align-items:center;gap:6px;min-height:37px;padding:6px 10px 6px 6px;border:1px solid var(--cb-border,#344145);border-radius:8px;background:#171b27;color:var(--cb-text,#f6faf9);text-decoration:none;font:800 13px/1 var(--cb-display,system-ui)}#cardbit-store .cbr-nav:focus-visible{outline:3px solid #FFB65C;outline-offset:2px}#cardbit-store .cbr-mini{width:24px;height:24px;border-radius:50%;display:inline-grid;place-items:center;font-size:10px;overflow:hidden;flex:none}';
      document.head.append(css);
      place();
      new MutationObserver(place).observe(store, { childList: true, subtree: true });
    });
})();
