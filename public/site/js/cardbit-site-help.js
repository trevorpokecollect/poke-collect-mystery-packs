/*
 * Cardbit standalone site: Ask Latch, the AI help chat (site-only, loaded only when SITE_HELP=on).
 * A Latch bubble bottom-right opens a panel that posts questions to POST /api/help. The server enforces
 * every rule (18+, breaks, rate limits, what the bot may say). The chat survives page changes within the
 * tab (sessionStorage); "New Chat" starts over. The bubble stacks above whatever sits in the bottom-right
 * corner (the Daily Rewards launcher), measured live so a redesign of that launcher can't overlap it.
 */
(() => {
  'use strict';
  if (window.__cbHelp) return;
  window.__cbHelp = true;
  const me = document.currentScript;
  const MODE = (me && me.dataset.mode) === 'waitlist' ? 'waitlist' : 'site';
  const ART = (me && me.dataset.icon) || '';
  const SUPPORT = 'support@cardbit.com';
  const KEY = 'cb_help_chat_v1';
  const ADULT = 'cb_help_adult_v1';
  const SEEN = 'cb_help_seen_v1';
  const MAX = 600;
  const CHIPS = MODE === 'waitlist'
    ? [['What Is Cardbit?', 'The basics'], ['How Do Founding Collector Rewards Work?', 'Waitlist bonus'], ['Are the Cards Real?', 'Every pull ships'], ['How Does Shipping Work?', 'Fees and timing']]
    : [['How Do I Get Cardbits?', 'Top-ups and bonuses'], ['How Does Sell Back Work?', 'Trade cards for Cardbits'], ['How Do I Ship My Cards?', 'From your Vault'], ['What Are Sparks?', 'And the Spark Shop']];
  const HELLO = MODE === 'waitlist'
    ? "Hi, I'm Latch! Ask me how Cardbit will work or about the Founding Collector bonus."
    : "Hi, I'm Latch! Ask me anything about packs, Cardbits, shipping, rewards or our policies.";
  const HELLO_FINE = MODE === 'waitlist'
    ? "I'm Cardbit's AI helper. I answer from our published pages and can't see accounts."
    : "I'm Cardbit's AI helper. I answer from our pages and can't see or change your account. For orders and account help, email " + SUPPORT + '.';

  const ICON = {
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l15-7-5 15-3-6-7-2z" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    fresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4z M4 7l8 6 8-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v6c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  const store = {
    get(k, s) { try { const v = (s ? sessionStorage : localStorage).getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
    set(k, v, s) { try { (s ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
    del(k, s) { try { (s ? sessionStorage : localStorage).removeItem(k); } catch { /* ignore */ } },
  };
  let state = store.get(KEY, true) || { id: null, log: [] };
  let open = false, busy = false, access = null, adult = !!store.get(ADULT);
  let rendered = 0; // log entries already animated in

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  // Escaped text with only safe links: the support email and cardbit.com pages (same-origin paths).
  function rich(text) {
    return esc(text)
      .replace(/support@cardbit\.com/gi, '<a href="mailto:' + SUPPORT + '">' + SUPPORT + '</a>')
      .replace(/(^|[\s(])(?:https?:\/\/)?(?:www\.)?cardbit\.com(\/[^\s<)]*)?/g, (m, pre, path) => {
        const t = (path || '').replace(/[.,;:!?]+$/, ''), p = t.replace(/^\/+/, '/');
        return pre + '<a href="' + (p || '/') + '">cardbit.com' + p + '</a>' + (path || '').slice(t.length);
      });
  }
  const avatar = cls => '<span class="cb-help-av ' + (cls || '') + '" aria-hidden="true">' + (ART ? '<img src="' + esc(ART) + '" alt="">' : '') + '</span>';

  const root = document.createElement('div');
  root.className = 'cb-help';
  root.innerHTML =
    '<div class="cb-help-panel" id="cb-help-panel" role="dialog" aria-modal="false" aria-labelledby="cb-help-title" hidden>' +
      '<div class="cb-help-head">' +
        '<span class="cb-help-grip" aria-hidden="true"></span>' +
        avatar('cb-help-av-lg') +
        '<div class="cb-help-sp"><h2 id="cb-help-title">Ask Latch <span class="cb-help-tag">AI</span></h2><p><i class="cb-help-live" aria-hidden="true"></i>Cardbit Help</p></div>' +
        '<button type="button" class="cb-help-icon" data-new title="New Chat" aria-label="Start a New Chat">' + ICON.fresh + '</button>' +
        '<button type="button" class="cb-help-icon" data-close title="Close" aria-label="Close Ask Latch">' + ICON.close + '</button>' +
      '</div>' +
      '<div class="cb-help-log" role="log" aria-live="polite" aria-relevant="additions"></div>' +
      '<div class="cb-help-foot"></div>' +
    '</div>' +
    '<div class="cb-help-dock">' +
      '<span class="cb-help-hint" aria-hidden="true">Questions? <b>Ask Latch</b></span>' +
      '<button type="button" class="cb-help-btn" aria-expanded="false" aria-controls="cb-help-panel" aria-label="Ask Latch, Cardbit\'s AI helper">' +
        '<span class="cb-help-ring" aria-hidden="true"></span>' +
        (ART ? '<img src="' + esc(ART) + '" alt="" width="64" height="68">' : '<span class="cb-help-q" aria-hidden="true">?</span>') +
        '<span class="cb-help-x" aria-hidden="true">' + ICON.close + '</span>' +
      '</button>' +
    '</div>';
  const $ = s => root.querySelector(s);
  const panel = $('.cb-help-panel'), btn = $('.cb-help-btn'), log = $('.cb-help-log'), foot = $('.cb-help-foot');

  function save() { store.set(KEY, { id: state.id, log: state.log.slice(-60) }, true); }

  function mailHref() {
    const lines = state.log.filter(m => m.who !== 'err').map(m => (m.who === 'me' ? 'Me: ' : 'Latch: ') + m.text);
    let body = 'Hi Cardbit Support,\n\n[Describe what you need help with. Include the email on your Cardbit account and any order details. Never send passwords or card numbers.]\n\n';
    if (lines.length) body += '--- My Ask Latch chat ---\n' + lines.join('\n\n');
    if (body.length > 1800) body = body.slice(0, 1800) + '…';
    return 'mailto:' + SUPPORT + '?subject=' + encodeURIComponent('Help Request') + '&body=' + encodeURIComponent(body);
  }

  function renderLog() {
    const canAsk = !access || access.canAsk;
    let html = '<div class="cb-help-hero">' + avatar('cb-help-av-hero') +
      '<p class="cb-help-hello">' + esc(HELLO) + '</p><p class="cb-help-hello-fine">' + rich(HELLO_FINE) + '</p></div>';
    if (!state.log.length && canAsk)
      html += '<div class="cb-help-chips" role="list">' + CHIPS.map(([q, sub]) =>
        '<button type="button" role="listitem" data-chip="' + esc(q) + '"><span><b>' + esc(q) + '</b><small>' + esc(sub) + '</small></span>' + ICON.arrow + '</button>').join('') + '</div>';
    html += state.log.map((m, i) => {
      const prev = state.log[i - 1];
      const fresh = i >= rendered ? ' is-new' : '';
      if (m.who === 'me') return '<div class="cb-help-row cb-help-row-me' + fresh + '"><div class="cb-help-msg cb-help-me">' + esc(m.text) + '</div></div>';
      if (m.who === 'err') return '<div class="cb-help-row' + fresh + '"><div class="cb-help-msg cb-help-err">' + rich(m.text) + '</div></div>';
      const first = !prev || prev.who !== 'bot';
      return '<div class="cb-help-row cb-help-row-bot' + fresh + '">' + (first ? avatar() : '<span class="cb-help-av cb-help-av-gap" aria-hidden="true"></span>') +
        '<div class="cb-help-msg cb-help-bot">' + rich(m.text) + '</div></div>';
    }).join('');
    if (busy) html += '<div class="cb-help-row cb-help-row-bot is-new">' + avatar() + '<div class="cb-help-msg cb-help-bot cb-help-typing" role="status" aria-label="Latch is typing"><span></span><span></span><span></span></div></div>';
    log.innerHTML = html;
    rendered = state.log.length;
    log.scrollTop = state.log.length || busy ? log.scrollHeight : 0;
  }

  function renderFoot() {
    const note = '<div class="cb-help-meta"><p>AI answers can be wrong; our <a href="/policies">Policies</a> always win. Chats are kept 90 days. Never share passwords or card numbers.</p>' +
      '<a class="cb-help-mail" href="' + esc(mailHref()) + '">' + ICON.mail + 'Email Support</a></div>';
    if (access && !access.canAsk) {
      foot.innerHTML = '<div class="cb-help-gate"><p>' +
        (access.reason === 'paused' ? 'Ask Latch is paused during your break.' : 'Ask Latch isn\'t available for this account.') +
        ' For help, email <a href="mailto:' + SUPPORT + '">' + SUPPORT + '</a>.</p></div>';
      return;
    }
    if (!adult && !(access && access.adultOnFile)) {
      foot.innerHTML = '<div class="cb-help-gate">' + ICON.shield + '<p>Cardbit is for collectors 18 and older.</p>' +
        '<button type="button" class="cb-help-cta" data-adult>I\'m 18 or Older, Start Chatting</button></div>' + note;
      return;
    }
    foot.innerHTML = '<form class="cb-help-form"><label class="cb-help-sr" for="cb-help-input">Your question</label>' +
      '<textarea id="cb-help-input" rows="1" maxlength="' + MAX + '" placeholder="Ask Latch a Question" autocomplete="off"></textarea>' +
      '<button type="submit" class="cb-help-send" aria-label="Send"' + (busy ? ' disabled' : '') + '>' + ICON.send + '</button></form>' + note;
  }

  // Re-rendering the footer must not lose a half-typed question or the keyboard focus.
  function render() {
    const input = $('#cb-help-input');
    const draft = input ? input.value : '', hadFocus = !!input && document.activeElement === input;
    renderLog(); renderFoot();
    const next = $('#cb-help-input');
    if (next && draft) next.value = draft;
    if (next && hadFocus) next.focus();
  }

  async function loadAccess() {
    try {
      const r = await fetch('/api/help', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (r.ok) access = (await r.json()).access || null;
    } catch { /* offline: the send will report it */ }
    render();
  }

  async function ask(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    if (text.length > MAX) text = text.slice(0, MAX);
    state.log.push({ who: 'me', text });
    busy = true; save(); render();
    try {
      const r = await fetch('/api/help', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: 'ask', conversationId: state.id, message: text, adult: adult || !!(access && access.adultOnFile) }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.reply) {
        state.id = data.conversationId || state.id;
        state.log.push({ who: 'bot', text: data.reply });
      } else {
        if (data.code === 'paused' || data.code === 'on_hold') access = { canAsk: false, reason: data.code };
        if (data.code === 'long') state.id = null;
        state.log.push({ who: 'err', text: data.error || 'Something went wrong. Email ' + SUPPORT + ' for help.' });
      }
    } catch {
      state.log.push({ who: 'err', text: "Couldn't reach Latch. Check your connection, or email " + SUPPORT + '.' });
    }
    busy = false; save(); render();
    const input = $('#cb-help-input');
    if (input && open) input.focus();
  }

  function setOpen(v) {
    open = v;
    panel.hidden = !v;
    root.classList.toggle('is-open', v);
    btn.setAttribute('aria-expanded', String(v));
    if (v) {
      store.set(SEEN, true);
      root.classList.remove('is-hinting');
      rendered = state.log.length; // don't replay old messages' entrance
      render();
      if (!access) loadAccess();
      const target = $('#cb-help-input') || $('[data-adult]') || $('[data-close]');
      if (target) target.focus({ preventScroll: true });
    } else btn.focus();
  }

  btn.addEventListener('click', () => setOpen(!open));
  root.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-close')) setOpen(false);
    else if (t.hasAttribute('data-new')) { state = { id: null, log: [] }; rendered = 0; store.del(KEY, true); render(); const i = $('#cb-help-input'); if (i) i.focus(); }
    else if (t.hasAttribute('data-adult')) { adult = true; store.set(ADULT, true); renderFoot(); const i = $('#cb-help-input'); if (i) i.focus(); }
    else if (t.hasAttribute('data-chip')) {
      if (!adult && !(access && access.adultOnFile)) { const a = $('[data-adult]'); if (a) { a.focus(); a.classList.remove('is-nudge'); void a.offsetWidth; a.classList.add('is-nudge'); } return; }
      ask(t.getAttribute('data-chip'));
    }
  });
  root.addEventListener('submit', e => {
    e.preventDefault();
    const i = $('#cb-help-input');
    if (!i) return;
    const v = i.value; i.value = ''; i.style.height = '';
    ask(v);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && open && (root.contains(document.activeElement) || document.activeElement === document.body)) { e.preventDefault(); setOpen(false); }
  });
  root.addEventListener('keydown', e => {
    if (e.target.id === 'cb-help-input' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      root.querySelector('.cb-help-form').requestSubmit();
    }
  });
  root.addEventListener('input', e => {
    if (e.target.id !== 'cb-help-input') return;
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  });

  // Stack above the Daily Rewards launcher (or anything else fixed in the bottom-right corner).
  function dock() {
    const launch = document.querySelector('.cb-launch');
    const r = launch && launch.getClientRects().length ? launch.getBoundingClientRect() : null;
    const lift = r && r.height ? Math.max(0, window.innerHeight - r.top) + 12 : 0;
    root.style.setProperty('--cb-help-lift', lift + 'px');
  }

  const mount = () => {
    document.body.appendChild(root);
    if (state.log.length) btn.classList.add('has-chat');
    dock();
    const launch = document.querySelector('.cb-launch');
    if (window.ResizeObserver && launch) new ResizeObserver(dock).observe(launch);
    window.addEventListener('resize', dock, { passive: true });
    // The launcher may mount after us; check again shortly.
    setTimeout(dock, 800); setTimeout(dock, 2500);
    // First visit: a short "Ask Latch" hint beside the bubble.
    if (!store.get(SEEN)) {
      setTimeout(() => { if (!open) root.classList.add('is-hinting'); }, 1800);
      setTimeout(() => root.classList.remove('is-hinting'), 9000);
    }
  };
  // Staff test mode (SITE_HELP=staff): show the bubble only if the server says this visitor may use it.
  const start = () => {
    if (!(me && me.dataset.staff)) return mount();
    fetch('/api/help', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) { access = d.access || null; mount(); } })
      .catch(() => {});
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
