/*
 * Cardbit standalone site: live chat (site-only, loaded only when SITE_CHAT=on).
 * Closed by default. The "Chat" toggle (bottom-left) opens a full-height chat rail on the LEFT side of the
 * page; on wide screens the page slides over to make room, on phones the rail covers the page.
 * Rooms: Everyone and Pass (Pack Pass members), picked from the room dropdown with live "online" counts.
 * Extras: replies, author levels, big pulls (Epic/Legendary) dropped into the Everyone room, chat rules,
 * settings (big pulls on/off, hidden users), hide a user, jump to latest, unread count on the toggle.
 * Polls GET /api/chat every 5s while open (every 30s while closed, for the unread count) and only while
 * the tab is visible. The server enforces every rule (18+, breaks, links, rate limits, mutes, Pass room).
 */
(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  const icons = () => window.CardbitRewardIcons || {};
  const PLAN = Object.assign({ name: 'Pack Pass', short: 'Pass', path: '/pass' }, window.cardbitPlan || {});
  const BADGE = { staff: 'Staff', plus: PLAN.short + ' Plus', pro: PLAN.short + ' Pro', ultimate: PLAN.short + ' Ultimate' };
  const ROOM_NAME = { main: 'Everyone', club: PLAN.short };
  const BIG = { Legendary: 1, Epic: 1 };
  const REASON = {
    sign_in: 'Sign In to join the chat.',
    age: 'Confirm you are 18 or older on the Rewards page to join the chat.',
    paused: 'Chat is paused during your break.',
    on_hold: 'This account is on hold. Contact Support@cardbit.com.',
  };
  const RULES = [
    ['Be Kind', 'No harassment, hate or threats. Treat everyone with respect.'],
    ['No Links or Contact Details', 'Links, emails and phone numbers are blocked to stop scams.'],
    ['Keep Trades on Cardbit', 'No buying, selling or trading off the site.'],
    ['No Spam', 'No repeated messages, codes or self-promotion.'],
    ['18+ Only', 'Chat is for verified adults. Staff will never ask for your password.'],
  ];

  // Per-browser preferences (never required: everything works if storage is blocked).
  const store = {
    get(k, d) { try { const v = localStorage.getItem('cb-chat-' + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('cb-chat-' + k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
  };
  const session = {
    get(k) { try { return sessionStorage.getItem('cb-chat-' + k); } catch (_) { return null; } },
    set(k, v) { try { sessionStorage.setItem('cb-chat-' + k, v); } catch (_) { /* private mode */ } },
  };

  let open = false, room = store.get('room', 'main'), data = null, timer = 0, busy = false, stopPeek = false;
  let menu = null; // 'rooms' | 'emoji' | 'rules' | 'settings' | null
  let replyTo = null; // { id, name, body }
  let pulls = [], pullsAt = 0;
  let seenId = session.get('seen') || null, unread = 0, unseenBelow = 0, lastId = null;
  let showPulls = store.get('pulls', true);
  let hidden = store.get('hidden', []);
  if (!Array.isArray(hidden)) hidden = [];
  if (room !== 'main' && room !== 'club') room = 'main';

  const time = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const initials = n => (/^Collector /.test(n || '') ? n.slice(-2) : (n || '?').split(' ').map(w => w[0]).join('').slice(0, 2));
  const svg = (d, s = 18) => '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true"><path fill="currentColor" d="' + d + '"/></svg>';
  const I = {
    chat: 'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    chev: 'M7 10l5 5 5-5z',
    left: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z',
    reply: 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
    hide: 'M12 6a9.8 9.8 0 0 1 9 6 9.9 9.9 0 0 1-2.6 3.6l1.4 1.4L18.4 18.4 4.6 4.6 6 3.2l2.2 2.2A10 10 0 0 1 12 6zm-9 6a9.8 9.8 0 0 1 3.3-4.2l1.5 1.5A4 4 0 0 0 13.7 15l1.6 1.6A10 10 0 0 1 3 12z',
    rules: 'M6 2h9l5 5v15H6zm8 1.5V8h4.5zM8 12h10v2H8zm0 4h10v2H8z',
    gear: 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
    down: 'M11 4h2v12l5.5-5.5 1.4 1.4L12 19.8 4.1 11.9l1.4-1.4L11 16z',
    lock: 'M12 2a5 5 0 0 1 5 5v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v3h6V7a3 3 0 0 0-3-3z',
    smile: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-3.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7 14a5.5 5.5 0 0 0 10 0z',
  };
  const EMOJI = ['🔥', '😍', '😂', '🙌', '👏', '💎', '⚡', '🎉', '😭', '👀', '🤞', '❤️'];

  function avatar(m) {
    const url = m.iconId && icons()[m.iconId];
    const style = ' style="background:' + esc(m.bg) + ';color:' + esc(m.fg) + '"';
    return url
      ? '<img class="cb-chat-av" alt="" width="32" height="32"' + style + ' src="' + esc(url) + '">'
      : '<span class="cb-chat-av"' + style + '>' + esc(initials(m.name)) + '</span>';
  }
  function messageHtml(m) {
    const badge = m.badge ? '<span class="cb-chat-badge cb-chat-badge-' + esc(m.badge) + '">' + esc(BADGE[m.badge] || m.badge) + '</span>' : '';
    const level = m.level ? '<span class="cb-chat-lv" title="Level ' + esc(m.level) + '">' + esc(m.level) + '</span>' : '';
    const quote = m.reply
      ? '<p class="cb-chat-quote">' + svg(I.reply, 12) + (m.reply.removed ? '<i>Message removed</i>' : '<b>' + esc(m.reply.name) + '</b> ' + esc(m.reply.body)) + '</p>'
      : '';
    const canReply = data && data.access && data.access.canRead && !data.access.mutedUntil;
    const acts = '<span class="cb-chat-acts">' +
      (canReply ? '<button type="button" data-chat-reply="' + esc(m.id) + '" aria-label="Reply to ' + esc(m.name) + '" title="Reply">' + svg(I.reply, 15) + '</button>' : '') +
      (m.badge !== 'staff' ? '<button type="button" data-chat-hide="' + esc(m.name) + '" aria-label="Hide messages from ' + esc(m.name) + '" title="Hide this user">' + svg(I.hide, 15) + '</button>' : '') +
      (m.canModerate ? '<button type="button" class="cb-chat-danger" data-chat-del="' + esc(m.id) + '" title="Delete for everyone">Delete</button>' +
        '<button type="button" class="cb-chat-danger" data-chat-mute="' + esc(m.id) + '" title="Mute this author for 24 hours">Mute 24h</button>' : '') +
      '</span>';
    return '<li tabindex="-1" class="cb-chat-msg' + (m.badge === 'staff' ? ' is-staff' : '') + '">' + quote + '<div class="cb-chat-row">' + avatar(m) +
      '<div class="cb-chat-main"><p class="cb-chat-who"><b>' + esc(m.name) + '</b>' + level + badge + '<time>' + esc(time(m.createdAt)) + '</time></p>' +
      '<p class="cb-chat-text">' + esc(m.body) + '</p></div></div>' + acts + '</li>';
  }
  function pullHtml(p) {
    const img = p.image ? '<img src="' + esc(p.image) + '" alt="" width="54" height="75" loading="lazy">' : '';
    return '<li class="cb-chat-pull cb-chat-pull-' + esc(String(p.tier).toLowerCase()) + '"><div><p class="cb-chat-pull-k">' + esc(p.tier) + ' Pull!</p>' +
      '<p class="cb-chat-pull-n">' + esc(p.name) + '</p><p class="cb-chat-pull-s">' + esc(p.set || '') + (p.number ? ' · #' + esc(p.number) : '') + '</p>' +
      '<p class="cb-chat-pull-t">A Collector Just Pulled This · ' + esc(time(p.at)) + '</p></div>' + img + '</li>';
  }
  function feedHtml() {
    const msgs = data.messages.filter(m => !hidden.includes(m.name));
    let items = msgs.map(m => ({ at: m.createdAt, html: messageHtml(m) }));
    if (room === 'main' && showPulls && pulls.length) {
      const since = data.messages.length ? data.messages[0].createdAt : new Date(Date.now() - 3600e3).toISOString();
      items = items.concat(pulls.filter(p => BIG[p.tier] && p.at >= since).map(p => ({ at: p.at, html: pullHtml(p) })));
      items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    }
    return items.length ? items.map(x => x.html).join('') : '<li class="cb-chat-empty">No messages yet. Say hi!</li>';
  }

  const count = n => (typeof n === 'number' ? '<span class="cb-chat-dot" aria-hidden="true"></span>' + n.toLocaleString('en-US') : '');
  function roomsMenu(a) {
    const online = (data && data.online) || {};
    return '<div class="cb-chat-pop cb-chat-rooms" role="menu">' + ['main', 'club'].map(r => {
      const locked = r === 'club' && !(a && a.club);
      return '<button type="button" role="menuitemradio" aria-checked="' + (room === r) + '" data-chat-room="' + r + '">' +
        '<span>' + esc(ROOM_NAME[r]) + (locked ? ' ' + svg(I.lock, 13) : '') + '<small>' + (r === 'main' ? 'Every Collector' : esc(PLAN.name) + ' Members') + '</small></span>' +
        '<em>' + count(online[r]) + '</em></button>';
    }).join('') + '</div>';
  }
  function rulesPop() {
    return '<div class="cb-chat-pop cb-chat-sheet"><header><h3>Chat Rules</h3><button type="button" data-chat-menu="" aria-label="Close rules">×</button></header><ul>' +
      RULES.map(([t, d]) => '<li><b>' + esc(t) + '</b>' + esc(d) + '</li>').join('') +
      '</ul><p>Breaking the rules can get you muted. <a href="/policies#terms">Full Terms</a></p></div>';
  }
  function settingsPop() {
    const list = hidden.length
      ? '<ul class="cb-chat-hidden">' + hidden.map(n => '<li><span>' + esc(n) + '</span><button type="button" data-chat-unhide="' + esc(n) + '">Unhide</button></li>').join('') + '</ul>'
      : '<p class="cb-chat-muted">You haven’t hidden anyone.</p>';
    return '<div class="cb-chat-pop cb-chat-sheet"><header><h3>Chat Settings</h3><button type="button" data-chat-menu="" aria-label="Close settings">×</button></header>' +
      '<label class="cb-chat-switch"><span>Big Pulls in Chat<small>Epic and Legendary pulls show in Everyone</small></span>' +
      '<input type="checkbox" data-chat-pulls' + (showPulls ? ' checked' : '') + '><i aria-hidden="true"></i></label>' +
      '<h4>Hidden Users</h4>' + list + '</div>';
  }

  function railHtml() {
    const a = data && data.access;
    const online = data && data.online;
    const head = '<header class="cb-chat-head"><h2 id="cb-chat-title">Chat</h2>' +
      '<button type="button" class="cb-chat-room" data-chat-menu="rooms" aria-haspopup="menu" aria-expanded="' + (menu === 'rooms') + '">' +
      '<span>' + esc(ROOM_NAME[room]) + '</span><em>' + count(online && online[room]) + '</em>' + svg(I.chev, 18) + '</button>' +
      '<button type="button" class="cb-chat-x" aria-label="Close chat" title="Close chat">' + svg(I.left, 22) + '</button></header>' +
      (menu === 'rooms' ? roomsMenu(a) : '');
    let body;
    if (!a) body = '<p class="cb-chat-note">Loading…</p>';
    else if (!a.canRead) {
      body = '<div class="cb-chat-gate"><p class="cb-chat-note">' + esc(REASON[a.reason] || 'Chat is unavailable.') + '</p>' +
        (a.reason === 'sign_in' ? '<a class="cb-chat-cta" href="/sign-in?return_to=' + encodeURIComponent(location.pathname) + '">Sign In</a>' : '') +
        (a.reason === 'age' ? '<a class="cb-chat-cta" href="/rewards">Go to Rewards</a>' : '') +
        (a.reason === 'paused' ? '<a class="cb-chat-cta" href="/account/limits">Limits &amp; Breaks</a>' : '') + '</div>';
    } else if (room === 'club' && !a.club) {
      body = '<div class="cb-chat-gate"><p class="cb-chat-note">The ' + esc(PLAN.short) + ' room is for ' + esc(PLAN.name) + ' members.</p><a class="cb-chat-cta" href="' + esc(PLAN.path) + '">See ' + esc(PLAN.name) + '</a></div>';
    } else {
      const reply = replyTo
        ? '<div class="cb-chat-replying">' + svg(I.reply, 14) + '<span>Replying to <b>' + esc(replyTo.name) + '</b> ' + esc(replyTo.body.slice(0, 60)) + '</span>' +
          '<button type="button" data-chat-unreply aria-label="Cancel reply">×</button></div>'
        : '';
      const form = a.mutedUntil
        ? '<p class="cb-chat-note cb-chat-foot-note">You’re muted until ' + esc(new Date(a.mutedUntil).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '.</p>'
        : reply + '<form class="cb-chat-form"><label class="cb-chat-sr" for="cb-chat-input">Message</label>' +
          '<input id="cb-chat-input" name="body" maxlength="280" autocomplete="off" placeholder="Say something nice…" required>' +
          '<button type="button" class="cb-chat-emo-btn" data-chat-menu="emoji" aria-label="Add emoji" aria-expanded="' + (menu === 'emoji') + '">' + svg(I.smile, 20) + '</button>' +
          '<button type="submit" class="cb-chat-send">Send</button></form>' +
          (menu === 'emoji' ? '<div class="cb-chat-pop cb-chat-emoji">' + EMOJI.map(e => '<button type="button" data-chat-emoji="' + e + '">' + e + '</button>').join('') + '</div>' : '');
      body = '<ol class="cb-chat-list" aria-live="polite">' + feedHtml() + '</ol>' +
        '<button type="button" class="cb-chat-jump"' + (unseenBelow ? '' : ' hidden') + '>' + svg(I.down, 14) + (unseenBelow > 0 ? unseenBelow + ' New' : 'Latest') + '</button>' +
        '<p class="cb-chat-err" role="alert" hidden></p>' + form;
    }
    const pop = menu === 'rules' ? rulesPop() : menu === 'settings' ? settingsPop() : '';
    const tools = '<footer class="cb-chat-tools">' +
      '<button type="button" data-chat-menu="rules" aria-expanded="' + (menu === 'rules') + '" title="Chat rules">' + svg(I.rules, 16) + 'Rules</button>' +
      '<button type="button" data-chat-menu="settings" aria-expanded="' + (menu === 'settings') + '" title="Chat settings">' + svg(I.gear, 16) + 'Settings</button></footer>';
    return head + '<div class="cb-chat-body">' + body + '</div>' + pop + tools;
  }

  function onScroll(e) {
    const l = e.currentTarget;
    const jump = document.querySelector('.cb-chat-jump');
    const near = l.scrollHeight - l.scrollTop - l.clientHeight < 60;
    if (near) unseenBelow = 0;
    if (jump) { jump.hidden = near; if (near) jump.innerHTML = svg(I.down, 14) + 'Latest'; }
  }
  function paint() {
    const rail = document.querySelector('.cb-chat-rail');
    if (!rail || !open) return;
    const input = rail.querySelector('#cb-chat-input');
    const draft = input ? input.value : '', focused = document.activeElement === input;
    const list = rail.querySelector('.cb-chat-list');
    const atBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    const top = list ? list.scrollTop : 0;
    rail.innerHTML = railHtml();
    const ni = rail.querySelector('#cb-chat-input');
    if (ni) { ni.value = draft; if (focused) ni.focus(); }
    const nl = rail.querySelector('.cb-chat-list');
    if (nl) {
      if (atBottom) { nl.scrollTop = nl.scrollHeight; unseenBelow = 0; rail.querySelector('.cb-chat-jump').hidden = true; } else nl.scrollTop = top;
      nl.addEventListener('scroll', onScroll, { passive: true });
    }
  }
  function showError(msg) {
    const e = document.querySelector('.cb-chat-err');
    if (e) { e.textContent = msg; e.hidden = !msg; }
  }
  function badge() {
    const b = document.querySelector('.cb-chat-unread');
    if (!b) return;
    b.textContent = unread > 99 ? '99+' : String(unread);
    b.hidden = open || !unread;
    const on = document.querySelector('.cb-chat-btn-online');
    const n = data && data.online && data.online.main;
    if (on) on.innerHTML = typeof n === 'number' && n > 0 ? count(n) : '';
  }

  // Unread (toggle badge, Everyone room) and "N New" (rail, when scrolled up) bookkeeping.
  function track(prevLast) {
    const msgs = (data && data.messages) || [];
    const newest = msgs.length ? msgs[msgs.length - 1].id : null;
    if (open) {
      if (prevLast && newest && newest !== prevLast) {
        const i = msgs.findIndex(m => m.id === prevLast);
        const added = i >= 0 ? msgs.length - 1 - i : 1;
        const list = document.querySelector('.cb-chat-list');
        if (list && list.scrollHeight - list.scrollTop - list.clientHeight >= 60) unseenBelow += added;
      }
      if (room === 'main') { seenId = newest; unread = 0; if (newest) session.set('seen', newest); }
    } else {
      const i = seenId ? msgs.findIndex(m => m.id === seenId) : -1;
      unread = !seenId ? 0 : i < 0 ? msgs.length : msgs.length - 1 - i;
      if (!seenId && newest) { seenId = newest; session.set('seen', newest); }
    }
    lastId = newest;
  }

  async function loadPulls() {
    if (!open || room !== 'main' || !showPulls || Date.now() - pullsAt < 30_000) return;
    pullsAt = Date.now();
    try {
      const r = await fetch('/api/recent?limit=24', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (r.ok) pulls = ((await r.json()).pulls || []).filter(p => BIG[p.tier]);
    } catch (_) { /* next time */ }
  }
  async function load() {
    if (busy) return;
    const r0 = open ? room : 'main';
    try {
      const [r] = await Promise.all([
        fetch('/api/chat?room=' + r0, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } }),
        loadPulls(),
      ]);
      if (!r.ok) { if (!open) stopPeek = true; return; }
      const prev = lastId;
      data = await r.json();
      // Signed-out or blocked visitors: no background polling while chat is closed.
      if (!open && (!data.access || !data.access.canRead)) stopPeek = true;
      track(prev);
      paint();
      badge();
    } catch (_) { /* try again next tick */ }
  }
  async function post(body) {
    busy = true;
    try {
      const r = await fetch('/api/chat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ room, ...body }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Something went wrong.');
      const prev = lastId;
      data = { ...d, online: d.online || (data && data.online) };
      track(prev);
      return true;
    } catch (err) {
      showError(err.message);
      return false;
    } finally { busy = false; }
  }

  function poll() {
    clearInterval(timer);
    timer = setInterval(() => {
      if (document.hidden) return;
      if (open || !stopPeek) load();
    }, open ? 5000 : 30000);
  }
  function setOpen(v, focus) {
    open = v;
    menu = null;
    session.set('open', open ? '1' : '');
    const root = document.querySelector('.cb-chat');
    const btn = root.querySelector('.cb-chat-btn');
    btn.setAttribute('aria-expanded', String(open));
    root.querySelector('.cb-chat-rail').hidden = !open;
    document.documentElement.classList.toggle('cb-chat-open', open);
    if (open) {
      unread = 0; stopPeek = false; lastId = null;
      paint(); load();
      if (focus) setTimeout(() => { const x = root.querySelector('#cb-chat-input') || root.querySelector('.cb-chat-x'); if (x) x.focus(); }, 30);
    } else { replyTo = null; if (focus) btn.focus(); }
    badge();
    poll();
  }
  function insertEmoji(e) {
    const input = document.querySelector('#cb-chat-input');
    if (!input) return;
    const s = input.selectionStart ?? input.value.length, t = input.selectionEnd ?? s;
    input.value = input.value.slice(0, s) + e + input.value.slice(t);
    input.focus();
    input.setSelectionRange(s + e.length, s + e.length);
  }

  function mount() {
    if (document.querySelector('.cb-chat')) return;
    const root = document.createElement('div');
    root.className = 'cb-chat';
    root.innerHTML = '<button type="button" class="cb-chat-btn" aria-expanded="false" aria-controls="cb-chat-rail">' + svg(I.chat, 20) +
      '<span class="cb-chat-btn-label">Chat</span><span class="cb-chat-btn-online"></span>' + svg(I.chev, 18) +
      '<span class="cb-chat-unread" hidden></span></button>' +
      '<aside class="cb-chat-rail" id="cb-chat-rail" aria-labelledby="cb-chat-title" hidden></aside>';
    document.body.append(root);
    root.querySelector('.cb-chat-btn').addEventListener('click', () => setOpen(!open, true));
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !open) return;
      if (menu) { menu = null; paint(); } else setOpen(false, true);
    });
    root.addEventListener('change', e => {
      if (e.target.matches('[data-chat-pulls]')) { showPulls = e.target.checked; store.set('pulls', showPulls); pullsAt = 0; load(); }
    });
    root.addEventListener('click', async e => {
      const t = e.target;
      if (t.closest('.cb-chat-x')) return setOpen(false, true);
      const jump = t.closest('.cb-chat-jump');
      if (jump) { const l = root.querySelector('.cb-chat-list'); if (l) l.scrollTop = l.scrollHeight; unseenBelow = 0; jump.hidden = true; return; }
      const m = t.closest('[data-chat-menu]');
      if (m) { const v = m.dataset.chatMenu || null; menu = menu === v ? null : v; return paint(); }
      const em = t.closest('[data-chat-emoji]');
      if (em) { insertEmoji(em.dataset.chatEmoji); return; }
      const tab = t.closest('[data-chat-room]');
      if (tab) {
        menu = null; replyTo = null;
        if (tab.dataset.chatRoom !== room) { room = tab.dataset.chatRoom; store.set('room', room); data = data && { ...data, messages: [] }; lastId = null; unseenBelow = 0; }
        paint(); return load();
      }
      const rep = t.closest('[data-chat-reply]');
      if (rep) {
        const msg = data && data.messages.find(x => x.id === rep.dataset.chatReply);
        if (msg) { replyTo = { id: msg.id, name: msg.name, body: msg.body }; menu = null; paint(); const i = root.querySelector('#cb-chat-input'); if (i) i.focus(); }
        return;
      }
      if (t.closest('[data-chat-unreply]')) { replyTo = null; return paint(); }
      const hide = t.closest('[data-chat-hide]');
      if (hide) { const n = hide.dataset.chatHide; if (!hidden.includes(n)) hidden = hidden.concat(n).slice(-200); store.set('hidden', hidden); return paint(); }
      const un = t.closest('[data-chat-unhide]');
      if (un) { hidden = hidden.filter(n => n !== un.dataset.chatUnhide); store.set('hidden', hidden); return paint(); }
      const del = t.closest('[data-chat-del]');
      if (del) { if (await post({ action: 'delete', id: del.dataset.chatDel })) paint(); return; }
      const mute = t.closest('[data-chat-mute]');
      if (mute) { if (await post({ action: 'mute', id: mute.dataset.chatMute, hours: 24 })) paint(); return; }
      if (menu && !t.closest('.cb-chat-pop')) { menu = null; paint(); }
    });
    root.addEventListener('submit', async e => {
      e.preventDefault();
      const input = root.querySelector('#cb-chat-input');
      const text = input.value.trim();
      if (!text) return;
      const btn = root.querySelector('.cb-chat-send');
      btn.disabled = true;
      menu = null;
      if (await post({ action: 'send', body: text, ...(replyTo ? { replyTo: replyTo.id } : {}) })) {
        root.querySelector('#cb-chat-input').value = ''; replyTo = null; unseenBelow = 0;
        paint();
        const l = root.querySelector('.cb-chat-list'); if (l) l.scrollTop = l.scrollHeight;
      }
      const b2 = root.querySelector('.cb-chat-send');
      if (b2) b2.disabled = false;
    });
    // Closed on every fresh visit; stays open while moving between pages in the same tab.
    if (session.get('open') === '1') setOpen(true, false); else { load(); poll(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
