/*
 * Cardbit standalone site: safer-play extras (site-only, not part of the theme port).
 * - Adds a "Limits & Breaks" link next to Sign Out on My Account and in the footer.
 * - Shows a banner while a cool-off or self-exclusion is active (GET /api/play).
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
  const tick = () => { addAccountLink(); addFooterLink(); };
  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
  tick();
})();
