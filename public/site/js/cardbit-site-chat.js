/*
 * Cardbit standalone site: live chat (site-only, loaded only when SITE_CHAT=on).
 * A chat bubble bottom-left opens a panel with two rooms: Everyone and Club (Cardbit Club members).
 * Polls GET /api/chat every 5 seconds while the panel is open and the tab is visible; the server
 * enforces every rule (18+, breaks, links, rate limits, mutes, Club-only room).
 */
(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  const icons = () => window.CardbitRewardIcons || {};
  const PLAN = Object.assign({ name: 'Pack Pass', short: 'Pass', path: '/pass' }, window.cardbitPlan || {});
  const BADGE = { staff: 'Staff', plus: PLAN.short + ' Plus', pro: PLAN.short + ' Pro', ultimate: PLAN.short + ' Ultimate' };
  const REASON = {
    sign_in: 'Sign In to join the chat.',
    age: 'Confirm you are 18 or older on the Rewards page to join the chat.',
    paused: 'Chat is paused during your break.',
    on_hold: 'This account is on hold. Contact Support@cardbit.com.',
  };
  let open = false, room = 'main', data = null, timer = 0, busy = false;

  const time = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const initials = n => (/^Collector /.test(n || '') ? n.slice(-2) : (n || '?').split(' ').map(w => w[0]).join('').slice(0, 2));
  function avatar(m) {
    const url = m.iconId && icons()[m.iconId];
    const style = ' style="background:' + esc(m.bg) + ';color:' + esc(m.fg) + '"';
    return url
      ? '<img class="cb-chat-av" alt="" width="30" height="30"' + style + ' src="' + esc(url) + '">'
      : '<span class="cb-chat-av"' + style + '>' + esc(initials(m.name)) + '</span>';
  }
  function messageHtml(m) {
    const badge = m.badge ? '<span class="cb-chat-badge cb-chat-badge-' + esc(m.badge) + '">' + esc(BADGE[m.badge] || m.badge) + '</span>' : '';
    const mod = m.canModerate
      ? '<span class="cb-chat-mod"><button type="button" data-chat-del="' + esc(m.id) + '">Delete</button>' +
        '<button type="button" data-chat-mute="' + esc(m.id) + '">Mute 24h</button></span>'
      : '';
    return '<li>' + avatar(m) + '<div><p class="cb-chat-who"><b>' + esc(m.name) + '</b>' + badge + '<time>' + esc(time(m.createdAt)) + '</time></p>' +
      '<p class="cb-chat-text">' + esc(m.body) + '</p>' + mod + '</div></li>';
  }

  function panelHtml() {
    const a = data && data.access;
    const tabs = '<div class="cb-chat-tabs" role="tablist">' +
      '<button type="button" role="tab" data-chat-room="main" aria-selected="' + (room === 'main') + '">Everyone</button>' +
      '<button type="button" role="tab" data-chat-room="club" aria-selected="' + (room === 'club') + '">' + esc(PLAN.short) + '</button></div>';
    let body;
    if (!a) body = '<p class="cb-chat-note">Loading\u2026</p>';
    else if (!a.canRead) {
      body = '<p class="cb-chat-note">' + esc(REASON[a.reason] || 'Chat is unavailable.') + '</p>' +
        (a.reason === 'sign_in' ? '<a class="cb-chat-cta" href="/sign-in?return_to=' + encodeURIComponent(location.pathname) + '">Sign In</a>' : '') +
        (a.reason === 'paused' ? '<a class="cb-chat-cta" href="/account/limits">Limits &amp; Breaks</a>' : '');
    } else if (room === 'club' && !a.club) {
      body = '<p class="cb-chat-note">The ' + esc(PLAN.short) + ' room is for ' + esc(PLAN.name) + ' members.</p><a class="cb-chat-cta" href="' + esc(PLAN.path) + '">See ' + esc(PLAN.name) + '</a>';
    } else {
      const list = data.messages.length ? data.messages.map(messageHtml).join('') : '<li class="cb-chat-empty">No messages yet. Say hi!</li>';
      const form = a.mutedUntil
        ? '<p class="cb-chat-note">You\u2019re muted until ' + esc(new Date(a.mutedUntil).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '.</p>'
        : '<form class="cb-chat-form"><label class="cb-chat-sr" for="cb-chat-input">Message</label>' +
          '<input id="cb-chat-input" name="body" maxlength="280" autocomplete="off" placeholder="Say something nice\u2026" required>' +
          '<button type="submit">Send</button></form>';
      body = '<ol class="cb-chat-list" aria-live="polite">' + list + '</ol><p class="cb-chat-err" role="alert" hidden></p>' + form;
    }
    return '<header><h2 id="cb-chat-title">Chat</h2><button type="button" class="cb-chat-x" aria-label="Close chat">\u00d7</button></header>' + tabs +
      '<div class="cb-chat-body">' + body + '</div>' +
      '<p class="cb-chat-fine">Be kind. No links, contact details or trading off Cardbit. <a href="/policies#terms">Rules</a></p>';
  }

  function paint() {
    const panel = document.querySelector('.cb-chat-panel');
    if (!panel || !open) return;
    const input = panel.querySelector('#cb-chat-input');
    const draft = input ? input.value : '', focused = document.activeElement === input;
    const list = panel.querySelector('.cb-chat-list');
    const atBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    panel.innerHTML = panelHtml();
    const ni = panel.querySelector('#cb-chat-input');
    if (ni) { ni.value = draft; if (focused) ni.focus(); }
    const nl = panel.querySelector('.cb-chat-list');
    if (nl && atBottom) nl.scrollTop = nl.scrollHeight;
  }
  function showError(msg) {
    const e = document.querySelector('.cb-chat-err');
    if (e) { e.textContent = msg; e.hidden = !msg; }
  }

  async function load() {
    if (busy) return;
    try {
      const r = await fetch('/api/chat?room=' + room, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      data = await r.json();
      paint();
    } catch (_) { /* try again next tick */ }
  }
  async function post(body) {
    busy = true;
    try {
      const r = await fetch('/api/chat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ room, ...body }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Something went wrong.');
      data = d;
      return true;
    } catch (err) {
      showError(err.message);
      return false;
    } finally { busy = false; }
  }

  function poll() {
    clearInterval(timer);
    if (open) timer = setInterval(() => { if (!document.hidden) load(); }, 5000);
  }
  function toggle(force) {
    open = typeof force === 'boolean' ? force : !open;
    const root = document.querySelector('.cb-chat');
    root.querySelector('.cb-chat-btn').setAttribute('aria-expanded', String(open));
    const panel = root.querySelector('.cb-chat-panel');
    panel.hidden = !open;
    if (open) { paint(); load(); } else root.querySelector('.cb-chat-btn').focus();
    poll();
  }

  function mount() {
    if (document.querySelector('.cb-chat')) return;
    const root = document.createElement('div');
    root.className = 'cb-chat';
    root.innerHTML = '<button type="button" class="cb-chat-btn" aria-expanded="false" aria-controls="cb-chat-panel" aria-label="Chat">' +
      '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg></button>' +
      '<section class="cb-chat-panel" id="cb-chat-panel" role="dialog" aria-labelledby="cb-chat-title" hidden></section>';
    document.body.append(root);
    root.querySelector('.cb-chat-btn').addEventListener('click', () => toggle());
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) toggle(false); });
    root.addEventListener('click', async e => {
      if (e.target.closest('.cb-chat-x')) return toggle(false);
      const tab = e.target.closest('[data-chat-room]');
      if (tab) { room = tab.dataset.chatRoom; data = data && { ...data, messages: [] }; paint(); return load(); }
      const del = e.target.closest('[data-chat-del]');
      if (del && await post({ action: 'delete', id: del.dataset.chatDel })) paint();
      const mute = e.target.closest('[data-chat-mute]');
      if (mute && await post({ action: 'mute', id: mute.dataset.chatMute, hours: 24 })) paint();
    });
    root.addEventListener('submit', async e => {
      e.preventDefault();
      const input = root.querySelector('#cb-chat-input');
      const text = input.value.trim();
      if (!text) return;
      const btn = root.querySelector('.cb-chat-form button');
      btn.disabled = true;
      if (await post({ action: 'send', body: text })) { input.value = ''; paint(); }
      const b2 = root.querySelector('.cb-chat-form button');
      if (b2) b2.disabled = false;
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
