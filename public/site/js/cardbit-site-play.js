/*
 * Cardbit standalone site: safer-play extras (site-only, not part of the theme port).
 * - Adds "Discord" and "Limits & Breaks" links next to Sign Out on My Account, and footer links to it and Verified Shuffle.
 * - Shows a banner while a cool-off or self-exclusion is active (GET /api/play).
 * - Floating Daily Rewards launcher (GET/POST /api/rewards): a Cardbit emblem bubble with a badge for
 *   today's unclaimed check-in and spins, opening a drawer with level, streak, check-in, spins and the
 *   reset countdown. Shown on the home page only, and hidden while a dialog is open.
 */
(() => {
  'use strict';
  const LIMITS = '/account/limits';
  const fmt = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  function addAccountLink() {
    const out = document.querySelector('[data-cb-do="logout"]');
    const intro = out && out.closest('.cc-intro');
    if (!intro || intro.querySelector('.cb-play-link')) return;
    const a = document.createElement('a');
    a.href = LIMITS;
    a.className = 'cb-play-link cb-ghost';
    a.textContent = 'Limits & Breaks';
    out.insertAdjacentElement('beforebegin', a);
    const d = document.createElement('a');
    d.href = '/account/discord';
    d.className = 'cb-play-link cb-ghost';
    d.textContent = 'Discord';
    a.insertAdjacentElement('beforebegin', d);
  }
  function addFooterLink() {
    const foot = document.querySelector('footer');
    if (!foot || foot.querySelector('.cb-play-foot')) return;
    const policies = [...foot.querySelectorAll('a')].find(a => /policies/i.test(a.getAttribute('href') || '') || a.textContent.trim() === 'Policies');
    if (!policies) return;
    const a = document.createElement('a');
    a.href = LIMITS;
    a.className = 'cb-play-foot ' + policies.className;
    a.textContent = 'Limits & Breaks';
    policies.insertAdjacentElement('afterend', a);
    const v = document.createElement('a');
    v.href = '/verified-shuffle';
    v.className = 'cb-play-foot ' + policies.className;
    v.textContent = 'Verified Shuffle';
    a.insertAdjacentElement('afterend', v);
  }
  function banner(paused) {
    if (!paused || document.querySelector('.cb-play-banner')) return;
    const b = document.createElement('div');
    b.className = 'cb-play-banner';
    b.setAttribute('role', 'status');
    b.innerHTML = '<span></span> <a href="' + LIMITS + '">Limits &amp; Breaks</a>';
    b.firstChild.textContent = (paused.kind === 'self_exclusion' ? 'Self-Exclusion' : 'Cool-Off') + ' active until ' + fmt(paused.until) +
      '. Purchases and spins are paused; your Vault, shipping and sell-backs still work.';
    document.body.prepend(b);
  }

  window.CardbitPlay = { state: null };
  fetch('/api/play', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
    .then(r => (r.ok ? r.json() : null))
    .then(s => {
      if (!s) return;
      window.CardbitPlay.state = s;
      banner(s.paused);
      document.dispatchEvent(new CustomEvent('cardbit:play', { detail: s }));
    })
    .catch(() => {});

  // ---- Floating Daily Rewards launcher ------------------------------------------------------
  // Home page only. Bubble = Latch in a glowing ring + label + ready count; panel = level ring and
  // animated XP bar, streak flame, Sparks counter, check-in, tier-colored Daily Spin tiles, reset
  // countdown and one strong call to action. All motion stops under prefers-reduced-motion.
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  const asset = name => (window.cardbitAssets && window.cardbitAssets[name]) || '';
  const still = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The launcher shows on the home page, and on every page on phones (the app nav's quick-action row).
  const PHONE = window.matchMedia('(max-width: 640px)');
  const onHome = () => location.pathname === '/' || location.pathname === '' || PHONE.matches;
  const num = n => Number(n || 0).toLocaleString('en-US');
  let rw = null, open = false, timer = 0;

  function nextResetMs() {
    // Cardbit days run midnight to midnight Central time.
    const now = new Date();
    const ct = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const mid = new Date(ct); mid.setHours(24, 0, 0, 0);
    return mid - ct;
  }
  const hms = ms => { const t = Math.max(0, Math.floor(ms / 1000)); return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map(n => String(n).padStart(2, '0')).join(':'); };
  const readySpins = r => (r && r.spins ? r.spins.filter(t => t.unlocked && !t.result) : []);
  const pending = r => (r && r.signedIn !== false && r.enabled !== false ? (r.checkedInToday ? 0 : 1) + readySpins(r).length : 0);

  const FLAME = '<svg class="cb-lr-flame" viewBox="0 0 32 40" aria-hidden="true"><defs><linearGradient id="cbLrFl" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff4d2e"/><stop offset=".55" stop-color="#ff9a3d"/><stop offset="1" stop-color="#ffe08a"/></linearGradient></defs>' +
    '<path class="cb-lr-flame-o" d="M16 1c2 7 10 11 10 22a10 10 0 0 1-20 0c0-5 2-8 4-10 0 4 2 6 4 6-2-6 0-13 2-18z" fill="url(#cbLrFl)"/>' +
    '<path class="cb-lr-flame-i" d="M16 20c1 3 5 5 5 10a5 5 0 0 1-10 0c0-3 2-5 3-6 0 2 1 3 2 3-1-3-1-5 0-7z" fill="#fff4c4"/></svg>';
  const LOCK = '<svg viewBox="0 0 16 16" aria-hidden="true" width="12" height="12"><path d="M4 7V5a4 4 0 1 1 8 0v2h1v8H3V7zm2 0h4V5a2 2 0 1 0-4 0z" fill="currentColor"/></svg>';
  const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true" width="12" height="12"><path d="M6.2 11.6 2.6 8l1.4-1.4 2.2 2.2 5.8-5.8L13.4 4.4z" fill="currentColor"/></svg>';
  const tierId = t => String(t.id || String(t.name || '').split(' ')[0]).toLowerCase();
  const prizeText = r => !r ? '' : r.prizeKind === 'card' ? (r.card && r.card.title ? r.card.title : 'Card Won')
    : '+' + num(r.amount) + (r.prizeKind === 'xp' ? ' XP' : r.prizeKind === 'sparks' ? ' Sparks' : r.prizeKind === 'cardbits' ? ' Cardbits' : '');

  function spinTile(t, paused) {
    const id = tierId(t);
    const label = esc(String(t.name || '').replace(/\s*Spin$/i, ''));
    // Same Latch & Friends characters as the Rewards page: the happy animation once unlocked, a still when locked.
    const icon = asset('spin-' + id + (t.unlocked ? '-happy' : '-still') + '.svg') || asset('spin-' + id + '.svg');
    let state, cls;
    if (!t.unlocked && t.minLevel <= 1) { cls = 'is-locked'; state = '<span class="cb-lr-tile-state">Free Daily</span>'; }
    else if (!t.unlocked) { cls = 'is-locked'; state = '<span class="cb-lr-tile-state">' + LOCK + ' Level ' + esc(t.minLevel) + '</span>'; }
    else if (t.result) { cls = 'is-done'; state = '<span class="cb-lr-tile-state">' + CHECK + ' <span class="cb-lr-prize">' + esc(prizeText(t.result)) + '</span></span>'; }
    else if (paused) { cls = 'is-locked'; state = '<span class="cb-lr-tile-state">Paused</span>'; }
    else { cls = 'is-ready'; state = '<span class="cb-lr-tile-state">Ready</span>'; }
    const inner = '<span class="cb-lr-tile-art">' + (icon ? '<img alt="" width="44" height="44" src="' + esc(icon) + '">' : '') + '</span>' +
      '<b class="cb-lr-tile-name">' + label + '</b>' + state;
    const aria = esc(t.name) + ': ' + (!t.unlocked && t.minLevel <= 1 ? 'free daily after sign up' : !t.unlocked ? 'unlocks at Level ' + esc(t.minLevel) : t.result ? 'done, ' + esc(prizeText(t.result)) : paused ? 'paused' : 'ready to spin');
    return cls === 'is-ready'
      ? '<li><a class="cb-lr-tile tier-' + esc(id) + ' ' + cls + '" href="/rewards" aria-label="' + aria + '">' + inner + '</a></li>'
      : '<li><div class="cb-lr-tile tier-' + esc(id) + ' ' + cls + '" role="img" aria-label="' + aria + '">' + inner + '</div></li>';
  }

  function drawerHtml() {
    const paused = window.CardbitPlay.state && window.CardbitPlay.state.paused;
    const rules = '<p class="cb-lr-fine">No purchase necessary \u00b7 <a href="/official-rules">Official Rules</a></p>';
    const close = '<button type="button" class="cb-lr-close" data-launch-close aria-label="Close Daily Rewards">\u00d7</button>';
    const latch = asset('latch-cheer.webp') || asset('icon-latch.webp');
    const hero = (sub, extra) => '<header class="cb-lr-hero">' + close +
      (latch ? '<img class="cb-lr-latch" alt="" width="104" height="110" src="' + esc(latch) + '">' : '') +
      '<p class="cb-lr-kicker">Free Every Day</p><h2 id="cb-launch-title">Daily Rewards</h2>' + (sub ? '<p class="cb-lr-sub">' + sub + '</p>' : '') + (extra || '') + '</header>';
    if (!rw || rw.signedIn === false) {
      const preview = [['basic', 'Sprout'], ['bronze', 'Ember'], ['silver', 'Frost'], ['gold', 'Gold Rush'], ['cobalt', 'Dragon'], ['holo', 'Prism']].map(([id, n], i) =>
        spinTile({ id, name: n + ' Spin', minLevel: [1, 5, 10, 20, 30, 40][i], unlocked: false })).join('');
      return hero('Check In, Build A Streak And Spin For Free Prizes.') +
        '<div class="cb-lr-body"><h3 class="cb-lr-h">Daily Spins</h3><ul class="cb-lr-tiles is-preview">' + preview + '</ul>' +
        '</div><div class="cb-lr-foot"><a class="cb-lr-cta" href="/sign-in?return_to=' + encodeURIComponent(location.pathname + location.search) + '"><span>Sign Up for 500 Cardbits</span></a>' + rules + '</div>';
    }
    const pct = rw.nextLevelXp ? Math.min(100, Math.round((rw.levelXp / rw.nextLevelXp) * 100)) : 100;
    const rank = rw.rank && (rw.rank.name || rw.rank.title || rw.rank);
    const streak = Number(rw.streak || 0);
    const pips = Array.from({ length: 7 }, (_, i) => '<i class="' + (i < Math.min(streak, 7) ? 'on' : '') + '"></i>').join('');
    const ready = readySpins(rw).length;
    const spins = (rw.spins || []).map(t => spinTile(t, paused)).join('');
    const level = '<div class="cb-lr-level">' +
      '<div class="cb-lr-ring" style="--p:' + pct + '"><b>' + esc(rw.level) + '</b><small>Level</small></div>' +
      '<div class="cb-lr-xp"><div class="cb-lr-xp-top"><span class="cb-lr-rank">' + esc(rank || 'Collector') + '</span>' +
      '<span class="cb-lr-xp-num">' + (rw.nextLevelXp ? num(rw.levelXp) + ' / ' + num(rw.nextLevelXp) + ' XP' : 'Max Level') + '</span></div>' +
      '<div class="cb-lr-bar" role="progressbar" aria-label="XP to next level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><i data-pct="' + pct + '"></i></div>' +
      '<p class="cb-lr-xp-next">' + (rw.nextLevelXp ? '<b>' + num(rw.toNext) + ' XP</b> To Level ' + esc(rw.level + 1) : 'Top Level Reached') + '</p></div></div>';
    const stats = '<div class="cb-lr-stats">' +
      '<div class="cb-lr-stat cb-lr-streak' + (streak ? ' is-lit' : '') + '">' + FLAME +
      '<div><b>' + esc(streak) + (streak === 1 ? ' Day' : ' Days') + '</b><span>Streak</span><span class="cb-lr-pips" aria-hidden="true">' + pips + '</span></div></div>' +
      (rw.sparks ? '<div class="cb-lr-stat cb-lr-sparks"><img alt="" width="34" height="34" src="' + esc(asset('sparks.svg')) + '">' +
        '<div><b data-count="' + esc(rw.sparks.balance) + '">' + num(rw.sparks.balance) + '</b><span>Sparks</span></div></div>' : '') + '</div>';
    const check = rw.checkedInToday
      ? '<p class="cb-lr-checked">' + CHECK + ' Checked In Today</p>'
      : '<button type="button" class="cb-lr-cta is-checkin" data-launch-checkin><span>Check In</span><small>+' + esc((rw.rules && rw.rules.dailyCheckIn) || 5) + ' XP</small></button>';
    const cta = ready && !paused
      ? '<a class="cb-lr-cta" href="/rewards"><span>Spin Now</span><small>' + ready + ' Ready</small></a>'
      : '<a class="cb-lr-cta is-quiet" href="/rewards"><span>Open Rewards</span></a>';
    return hero('', '<div class="cb-lr-clock"><span>New Rewards In</span><b data-launch-clock>' + hms(nextResetMs()) + '</b></div>') +
      '<div class="cb-lr-body">' + level + stats + check +
      (spins ? '<h3 class="cb-lr-h">Daily Spins' + (ready ? ' <em>' + ready + ' Ready</em>' : '') + '</h3><ul class="cb-lr-tiles">' + spins + '</ul>' : '') +
      '</div><div class="cb-lr-foot">' + cta + rules + '</div>';
  }

  // Fill the XP bar from zero and count Sparks up when the panel opens.
  function animateIn(panel) {
    const bar = panel.querySelector('.cb-lr-bar i');
    if (bar) {
      if (still()) bar.style.width = bar.dataset.pct + '%';
      else { bar.style.width = '0%'; requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = bar.dataset.pct + '%'; })); }
    }
    const c = panel.querySelector('[data-count]');
    const end = c ? Number(c.dataset.count) : 0;
    if (!c || still() || !end) return;
    const t0 = performance.now(), dur = 900;
    const step = now => { const k = Math.min(1, (now - t0) / dur); c.textContent = num(Math.round(end * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  function render() {
    let root = document.querySelector('.cb-launch');
    if (!rw || !onHome()) { if (root) { open = false; clearInterval(timer); root.remove(); window.dispatchEvent(new Event('resize')); } return; }
    if (!root) {
      root = document.createElement('div');
      root.className = 'cb-launch';
      root.innerHTML = '<button type="button" class="cb-launch-btn" aria-expanded="false" aria-controls="cb-launch-panel">' +
        '<span class="cb-launch-orb"><img alt="" width="44" height="44" src="/site/img/nav/daily-rewards.webp?v=r2"></span>' +
        '<span class="cb-launch-text"><span class="cb-launch-label">Daily Rewards</span><span class="cb-launch-sub"></span></span>' +
        '<b class="cb-launch-badge" hidden></b></button>' +
        '<section class="cb-launch-panel" id="cb-launch-panel" role="dialog" aria-labelledby="cb-launch-title" hidden></section>';
      document.body.append(root);
      // Let Ask Latch re-measure and dock above the bubble (it listens for resize).
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      root.querySelector('.cb-launch-btn').addEventListener('click', () => toggle());
      root.addEventListener('click', onClick);
    }
    const n = pending(rw), badge = root.querySelector('.cb-launch-badge'), btn = root.querySelector('.cb-launch-btn');
    badge.hidden = !n && rw.signedIn !== false;
    badge.textContent = rw.signedIn === false ? '!' : String(n);
    root.querySelector('.cb-launch-sub').textContent = rw.signedIn === false ? 'Free Spins Daily' : n ? n + ' Ready To Claim' : 'All Claimed Today';
    btn.setAttribute('aria-label', 'Daily Rewards' + (n ? ', ' + n + ' ready' : ''));
    btn.classList.toggle('is-ready', n > 0);
    if (open) { const p = root.querySelector('.cb-launch-panel'); p.innerHTML = drawerHtml(); animateIn(p); }
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) toggle(false); });
  document.addEventListener('click', e => { const root = document.querySelector('.cb-launch'); if (open && root && !root.contains(e.target)) toggle(false); });

  function toggle(force) {
    const root = document.querySelector('.cb-launch');
    if (!root) return;
    open = typeof force === 'boolean' ? force : !open;
    const panel = root.querySelector('.cb-launch-panel');
    root.querySelector('.cb-launch-btn').setAttribute('aria-expanded', String(open));
    root.classList.toggle('is-open', open);
    panel.hidden = !open;
    clearInterval(timer);
    if (open) {
      panel.innerHTML = drawerHtml();
      animateIn(panel);
      const first = panel.querySelector('.cb-lr-cta, .cb-lr-tile[href], a, button');
      if (first) first.focus({ preventScroll: true });
      timer = setInterval(() => {
        const c = panel.querySelector('[data-launch-clock]');
        if (c) c.textContent = hms(nextResetMs());
        if (nextResetMs() < 1000) setTimeout(load, 2000);
      }, 1000);
    } else root.querySelector('.cb-launch-btn').focus();
  }

  async function onClick(e) {
    if (e.target.closest('[data-launch-close]')) { toggle(false); return; }
    const b = e.target.closest('[data-launch-checkin]');
    if (!b) return;
    b.disabled = true; b.innerHTML = '<span>Checking In\u2026</span>';
    try {
      const res = await fetch('/api/rewards', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ action: 'checkin' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Check-in failed.');
      rw = { signedIn: true, ...data };
      render();
    } catch (err) {
      b.disabled = false; b.innerHTML = '<span>Check In</span>';
      const p = document.createElement('p'); p.className = 'cb-lr-err'; p.setAttribute('role', 'alert'); p.textContent = err.message;
      b.insertAdjacentElement('afterend', p);
    }
  }

  function load() {
    fetch('/api/rewards', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : null))
      .then(data => { rw = data && data.enabled !== false ? data : null; render(); })
      .catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
  // The storefront routes client-side; re-check visibility when the URL changes.
  PHONE.addEventListener?.('change', () => render());
  let lastPath = location.pathname;
  setInterval(() => { if (location.pathname !== lastPath) { lastPath = location.pathname; render(); } }, 500);

  const tick = () => { addAccountLink(); addFooterLink(); };
  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
  tick();
})();
