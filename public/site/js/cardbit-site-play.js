/*
 * Cardbit standalone site: safer-play extras (site-only, not part of the theme port).
 * - Adds a "Limits & Breaks" link next to Sign Out on My Account, and footer links to it and Verified Shuffle.
 * - Shows a banner while a cool-off or self-exclusion is active (GET /api/play).
 * - Floating Daily Rewards launcher (GET/POST /api/rewards): a Cardbit emblem bubble with a badge for
 *   today's unclaimed check-in and spins, opening a drawer with level, streak, check-in, spins and the
 *   reset countdown. Hidden while a dialog is open and on the Rewards page itself.
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
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  const asset = name => (window.cardbitAssets && window.cardbitAssets[name]) || '';
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

  function drawerHtml() {
    const paused = window.CardbitPlay.state && window.CardbitPlay.state.paused;
    const rules = '<p class="cb-launch-fine">No purchase necessary. <a href="/official-rules">Official Rules</a></p>';
    if (!rw || rw.signedIn === false) {
      return '<h2 id="cb-launch-title">Daily Rewards</h2><p>Check in every day, build a streak and spin for free prizes.</p>' +
        '<a class="cb-launch-cta" href="/sign-in?return_to=' + encodeURIComponent(location.pathname + location.search) + '">Sign Up for 500 Cardbits</a>' + rules;
    }
    const pct = rw.nextLevelXp ? Math.min(100, Math.round((rw.levelXp / rw.nextLevelXp) * 100)) : 100;
    const rank = rw.rank && (rw.rank.name || rw.rank.title || rw.rank);
    const spins = (rw.spins || []).map(t => {
      const state = !t.unlocked ? '<span class="cb-launch-lock">Level ' + esc(t.minLevel) + '</span>'
        : t.result ? '<span class="cb-launch-done">Done \u2713</span>'
        : paused ? '<span class="cb-launch-lock">Paused</span>'
        : '<a class="cb-launch-go" href="/rewards">Spin</a>';
      return '<li><span>' + esc(t.name) + '</span>' + state + '</li>';
    }).join('');
    const check = rw.checkedInToday
      ? '<p class="cb-launch-done">Checked In Today \u2713</p>'
      : '<button type="button" class="cb-launch-cta" data-launch-checkin>Check In</button>';
    return '<h2 id="cb-launch-title">Daily Rewards</h2>' +
      '<div class="cb-launch-level"><b>Level ' + esc(rw.level) + '</b>' + (rank ? '<span>' + esc(rank) + '</span>' : '') + '</div>' +
      '<div class="cb-launch-bar" role="progressbar" aria-label="XP to next level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div>' +
      '<p class="cb-launch-meta">' + (rw.nextLevelXp ? esc(rw.toNext.toLocaleString('en-US')) + ' XP to Level ' + esc(rw.level + 1) : 'Max Level') +
      ' \u00b7 Streak ' + esc(rw.streak) + (rw.streak === 1 ? ' Day' : ' Days') + (rw.sparks ? ' \u00b7 ' + esc(rw.sparks.balance.toLocaleString('en-US')) + ' Sparks' : '') + '</p>' +
      check + (spins ? '<h3>Daily Spins</h3><ul class="cb-launch-spins">' + spins + '</ul>' : '') +
      '<p class="cb-launch-reset">New rewards in <span data-launch-clock>' + hms(nextResetMs()) + '</span></p>' +
      '<a class="cb-launch-link" href="/rewards">Open Rewards</a>' + rules;
  }

  function render() {
    let root = document.querySelector('.cb-launch');
    if (!rw || /^\/rewards/.test(location.pathname)) { if (root) root.remove(); return; }
    if (!root) {
      root = document.createElement('div');
      root.className = 'cb-launch';
      root.innerHTML = '<button type="button" class="cb-launch-btn" aria-expanded="false" aria-controls="cb-launch-panel">' +
        '<img alt="" width="34" height="34" src="' + esc(asset('cardbit-brand-emblem.png')) + '"><span class="cb-launch-sr">Daily Rewards</span><b class="cb-launch-badge" hidden></b></button>' +
        '<section class="cb-launch-panel" id="cb-launch-panel" role="dialog" aria-labelledby="cb-launch-title" hidden></section>';
      document.body.append(root);
      root.querySelector('.cb-launch-btn').addEventListener('click', () => toggle());
      root.addEventListener('click', onClick);
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) toggle(false); });
      document.addEventListener('click', e => { if (open && !root.contains(e.target)) toggle(false); });
    }
    const n = pending(rw), badge = root.querySelector('.cb-launch-badge'), btn = root.querySelector('.cb-launch-btn');
    badge.hidden = !n && rw.signedIn !== false;
    badge.textContent = rw.signedIn === false ? '!' : String(n);
    btn.setAttribute('aria-label', 'Daily Rewards' + (n ? ', ' + n + ' ready' : ''));
    btn.classList.toggle('is-ready', n > 0);
    if (open) root.querySelector('.cb-launch-panel').innerHTML = drawerHtml();
  }

  function toggle(force) {
    const root = document.querySelector('.cb-launch');
    if (!root) return;
    open = typeof force === 'boolean' ? force : !open;
    const panel = root.querySelector('.cb-launch-panel');
    root.querySelector('.cb-launch-btn').setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    clearInterval(timer);
    if (open) {
      panel.innerHTML = drawerHtml();
      const first = panel.querySelector('button, a');
      if (first) first.focus();
      timer = setInterval(() => {
        const c = panel.querySelector('[data-launch-clock]');
        if (c) c.textContent = hms(nextResetMs());
        if (nextResetMs() < 1000) setTimeout(load, 2000);
      }, 1000);
    } else root.querySelector('.cb-launch-btn').focus();
  }

  async function onClick(e) {
    const b = e.target.closest('[data-launch-checkin]');
    if (!b) return;
    b.disabled = true; b.textContent = 'Checking In\u2026';
    try {
      const res = await fetch('/api/rewards', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ action: 'checkin' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Check-in failed.');
      rw = { signedIn: true, ...data };
      render();
    } catch (err) {
      b.disabled = false; b.textContent = 'Check In';
      const p = document.createElement('p'); p.className = 'cb-launch-err'; p.setAttribute('role', 'alert'); p.textContent = err.message;
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
  let lastPath = location.pathname;
  setInterval(() => { if (location.pathname !== lastPath) { lastPath = location.pathname; render(); } }, 500);

  const tick = () => { addAccountLink(); addFooterLink(); };
  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
  tick();
})();
