/*
 * Cardbit standalone site: Ask Latch, the AI help chat (site-only, loaded only when SITE_HELP=on).
 * A Latch bubble bottom-right (above the Daily Rewards launcher) opens a panel that posts questions to
 * POST /api/help. The server enforces every rule (18+, breaks, rate limits, what the bot may say).
 * The chat survives page changes within the tab (sessionStorage); "New Chat" starts over.
 */
(() => {
  'use strict';
  if (window.__cbHelp) return;
  window.__cbHelp = true;
  const me = document.currentScript;
  const MODE = (me && me.dataset.mode) === 'waitlist' ? 'waitlist' : 'site';
  const ICON = (me && me.dataset.icon) || '';
  const SUPPORT = 'support@cardbit.com';
  const KEY = 'cb_help_chat_v1';
  const ADULT = 'cb_help_adult_v1';
  const MAX = 600;
  const CHIPS = MODE === 'waitlist'
    ? ['What Is Cardbit?', 'How Do Founding Collector Rewards Work?', 'Are the Cards Real?', 'How Does Shipping Work?']
    : ['How Do I Get Cardbits?', 'How Does Sell Back Work?', 'How Do I Ship My Cards?', 'What Are Sparks?'];
  const INTRO = MODE === 'waitlist'
    ? "Hi, I'm Latch, Cardbit's AI helper. Ask me how Cardbit will work or about the Founding Collector bonus. I answer from our published pages and can't see accounts."
    : "Hi, I'm Latch, Cardbit's AI helper. I answer from our How It Works, FAQ and Policies pages. I can't see or change your account, so for orders and account help, email " + SUPPORT + '.';

  const store = {
    get(k, s) { try { const v = (s ? sessionStorage : localStorage).getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
    set(k, v, s) { try { (s ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
    del(k, s) { try { (s ? sessionStorage : localStorage).removeItem(k); } catch { /* ignore */ } },
  };
  let state = store.get(KEY, true) || { id: null, log: [] };
  let open = false, busy = false, access = null, adult = !!store.get(ADULT);

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

  const root = document.createElement('div');
  root.className = 'cb-help';
  root.innerHTML =
    '<div class="cb-help-panel" id="cb-help-panel" role="dialog" aria-modal="false" aria-labelledby="cb-help-title" hidden>' +
      '<div class="cb-help-head">' +
        (ICON ? '<img src="' + esc(ICON) + '" alt="" width="36" height="36">' : '') +
        '<div class="cb-help-sp"><h2 id="cb-help-title">Ask Latch<span class="cb-help-tag">AI</span></h2><p>Cardbit Help</p></div>' +
        '<button type="button" class="cb-help-icon" data-new>New Chat</button>' +
        '<button type="button" class="cb-help-icon cb-help-x" data-close aria-label="Close Ask Latch">&times;</button>' +
      '</div>' +
      '<div class="cb-help-log" role="log" aria-live="polite" aria-relevant="additions"></div>' +
      '<div class="cb-help-foot"></div>' +
    '</div>' +
    '<button type="button" class="cb-help-btn" aria-expanded="false" aria-controls="cb-help-panel" aria-label="Ask Latch, Cardbit\'s AI helper">' +
      (ICON ? '<img src="' + esc(ICON) + '" alt="" width="44" height="44">' : '') + '<span class="cb-help-q" aria-hidden="true">?</span>' +
    '</button>';
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
    let html = '<div class="cb-help-msg cb-help-bot">' + rich(INTRO) + '</div>';
    if (!state.log.length && (!access || access.canAsk))
      html += '<div class="cb-help-chips">' + CHIPS.map(c => '<button type="button" data-chip>' + esc(c) + '</button>').join('') + '</div>';
    html += state.log.map(m =>
      '<div class="cb-help-msg ' + (m.who === 'me' ? 'cb-help-me' : m.who === 'err' ? 'cb-help-err' : 'cb-help-bot') + '">' + (m.who === 'me' ? esc(m.text) : rich(m.text)) + '</div>').join('');
    if (busy) html += '<div class="cb-help-typing" aria-label="Latch is typing">Latch Is Thinking<span></span><span></span><span></span></div>';
    log.innerHTML = html;
    log.scrollTop = log.scrollHeight;
  }

  function renderFoot() {
    const note = '<p class="cb-help-note">AI answers can be wrong; our Policies always win. Chats are saved for 90 days so staff can improve support. Don\'t share passwords or card numbers. <a href="/policies#privacy-policy">Privacy Policy</a></p>' +
      '<a class="cb-help-mail" href="' + esc(mailHref()) + '">Email Support Instead</a>';
    if (access && !access.canAsk) {
      foot.innerHTML = '<p class="cb-help-note" style="margin-top:0">' +
        (access.reason === 'paused' ? 'Ask Latch is paused during your break.' : 'Ask Latch isn\'t available for this account.') +
        ' For help, email <a href="mailto:' + SUPPORT + '">' + SUPPORT + '</a>.</p>';
      return;
    }
    if (!adult && !(access && access.adultOnFile)) {
      foot.innerHTML = '<div class="cb-help-age"><p>Cardbit is for collectors 18 and older.</p>' +
        '<button type="button" class="cb-help-cta" data-adult>I\'m 18 or Older, Start Chatting</button></div>' + note;
      return;
    }
    foot.innerHTML = '<form class="cb-help-form"><label class="cb-sr" for="cb-help-input" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Your question</label>' +
      '<textarea id="cb-help-input" rows="1" maxlength="' + MAX + '" placeholder="Ask a Question" autocomplete="off"></textarea>' +
      '<button type="submit" class="cb-help-send"' + (busy ? ' disabled' : '') + '>Send</button></form>' + note;
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
      render();
      if (!access) loadAccess();
      const target = $('#cb-help-input') || $('[data-adult]') || $('[data-close]');
      if (target) target.focus();
    } else btn.focus();
  }

  btn.addEventListener('click', () => setOpen(!open));
  root.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-close')) setOpen(false);
    else if (t.hasAttribute('data-new')) { state = { id: null, log: [] }; store.del(KEY, true); render(); const i = $('#cb-help-input'); if (i) i.focus(); }
    else if (t.hasAttribute('data-adult')) { adult = true; store.set(ADULT, true); renderFoot(); const i = $('#cb-help-input'); if (i) i.focus(); }
    else if (t.hasAttribute('data-chip')) {
      if (!adult && !(access && access.adultOnFile)) { const a = $('[data-adult]'); if (a) a.focus(); return; }
      ask(t.textContent);
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

  const mount = () => { document.body.appendChild(root); if (state.log.length) btn.classList.add('has-chat'); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
