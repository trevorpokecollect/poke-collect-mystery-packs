/* Cardbit Rewards page: level, streak, Daily Spins with a prize carousel, and icons.
   The Mystery Packs app (apps/packs/api/rewards) rolls and stores every result. This page only
   shows what the server returns; the carousel lands on the prize the server already chose. */
(() => {
  const root = document.querySelector('[data-cb-rewards][data-cb-authenticated]');
  if (!root) return;
  const $ = (s, el = root) => el.querySelector(s);
  const endpoint = root.dataset.endpoint;
  const iconUrls = JSON.parse(root.dataset.icons || '{}');
  const spinArt = JSON.parse(root.dataset.spinArt || '{}');
  const sparksArt = root.dataset.sparksArt;
  const first = root.dataset.first || '', last = root.dataset.last || '';
  const initials = ((first.trim()[0] || '') + (last.trim()[0] || '')).toUpperCase() || '?';
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const status = $('[data-rw-status]'), content = $('[data-rw-content]');
  let state = null, busy = false;

  const TIERS = [['basic', 'Basic Spin', 1], ['bronze', 'Bronze Spin', 5], ['silver', 'Silver Spin', 10],
    ['gold', 'Gold Spin', 20], ['cobalt', 'Cobalt Spin', 30], ['holo', 'Holo Spin', 40]];
  const BASE_ODDS = { basic: [25, 50, 2], bronze: [35, 75, 3], silver: [50, 100, 4], gold: [75, 150, 8], cobalt: [100, 250, 15], holo: [150, 400, 22] };
  const ICONS = [['latch', 'Latch', 1], ['blazebit', 'Blazebit', 1], ['driplink', 'Driplink', 1], ['mossbit', 'Mossbit', 1],
    ['zappix', 'Zappix', 5], ['cryobyte', 'Cryobyte', 5], ['glitchog', 'Glitchog', 10], ['phantab', 'Phantab', 10],
    ['nimbyte', 'Nimbyte', 15], ['wyrmware', 'Wyrmware', 15], ['latch-gold', 'Latch Gold', 20], ['latch-holo', 'Latch Holo', 30]];
  const COLORS = [['cobalt', '#4057F5', '#FAF8F3'], ['apricot', '#FFB65C', '#17213B'], ['navy', '#17213B', '#FAF8F3'], ['mint', '#3DD6A3', '#17213B'],
    ['berry', '#C2417A', '#FAF8F3'], ['sky', '#5FC3F2', '#17213B'], ['violet', '#7A52E0', '#FAF8F3'], ['ember', '#E8553B', '#FAF8F3']];
  /** A brand-new account's view, used until the app returns this customer's own rewards. */
  const START = {
    level: 1, xp: 0, levelXp: 0, nextLevelXp: 100, toNext: 100, rank: 'Rookie', monthXp: 0, checkedInToday: false, streak: 0,
    avatar: { iconId: null, color: 'cobalt' },
    colors: COLORS.map(([id, bg, fg]) => ({ id, bg, fg })),
    icons: ICONS.map(([id, name, minLevel]) => ({ id, name, minLevel, unlocked: minLevel <= 1 })),
    rules: { perCardbitsSpent: 0.1, perPackOpened: 25, dailyCheckIn: 50 },
    streakBonus: { perDay: 0.1, maxDays: 7 },
    spins: TIERS.map(([id, name, minLevel]) => {
      const [xp, sp] = BASE_ODDS[id];
      return { id, name, minLevel, unlocked: minLevel <= 1, result: null, cards: [],
        odds: [{ kind: 'xp', amount: xp, percent: 55 }, { kind: 'xp', amount: sp, percent: 30 }, { kind: 'xp', amount: Math.round(sp * 1.5), percent: 15 }] };
    }),
  };
  const friendly = (e, fallback) => (e && e.status === 403 && e.message ? e.message : fallback);

  /* SITE: one-time 18+ confirmation before a Daily Spin (the server stores it, like Shopify's age gate). */
  function siteConfirmAge() {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'cbr-age';
      d.innerHTML = '<form method="dialog"><h2>Confirm Your Age</h2><p>Cardbit Is for Collectors 18 or Older.</p>' +
        '<label><input type="checkbox" name="age" required> I\'m 18 or Older</label>' +
        '<p class="cbr-age-error" role="alert"></p><div class="cbr-age-actions"><button type="button" class="cb-secondary" value="cancel">Cancel</button>' +
        '<button type="submit" class="cb-primary" value="ok">Continue</button></div></form>';
      root.append(d);
      const done = (ok) => { d.close(); d.remove(); resolve(ok); };
      d.querySelector('[value=cancel]').addEventListener('click', () => done(false));
      d.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
      d.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await call({ action: 'confirm-age' }); done(true); }
        catch (err) { d.querySelector('.cbr-age-error').textContent = err.message || 'Try Again.'; }
      });
      d.showModal();
    });
  }

  async function call(body) {
    const res = await fetch(endpoint, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    /* SITE */ if (!res.ok && data.code === 'AGE_REQUIRED' && body && body.action !== 'confirm-age' && await siteConfirmAge()) return call(body);
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something Went Wrong.'), { status: res.status });
    return data;
  }
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const img = (src, w, h, cls) => { const i = new Image(); i.src = src; i.alt = ''; i.width = w; i.height = h; i.decoding = 'async'; if (cls) i.className = cls; return i; };

  function avatar(node, data) {
    const color = data.colors.find((c) => c.id === data.avatar.color) || data.colors[0];
    node.replaceChildren();
    if (data.avatar.iconId && iconUrls[data.avatar.iconId]) { node.append(img(iconUrls[data.avatar.iconId], 112, 112)); node.style.background = '#17213B'; node.style.color = ''; }
    else { node.textContent = initials; node.style.background = color.bg; node.style.color = color.fg; }
  }

  /* ---------- Prize tiles (carousel, odds and reveal) ---------- */
  const RARITY = { common: 'c', uncommon: 'u', rare: 'r', epic: 'e', master: 'l', legendary: 'l', mythic: 'l' };
  const rarityClass = (r) => 'is-' + (RARITY[String(r || '').toLowerCase()] || 'r');
  function tile(prize) {
    const t = el('div', 'cbr-tile');
    if (prize.kind === 'card') {
      t.classList.add('is-card', rarityClass(prize.rarity));
      if (prize.imageUrl) t.append(img(prize.imageUrl, 120, 168, 'cbr-tile-card'));
      else t.append(el('span', 'cbr-tile-blank', 'Card'));
      t.append(el('span', 'cbr-tile-label', prize.rarity ? prize.rarity : 'Card'));
    } else if (prize.kind === 'sparks') {
      t.classList.add('is-sparks');
      t.append(img(sparksArt, 64, 64, 'cbr-tile-icon'), el('b', 'cbr-tile-amount', fmt(prize.amount)), el('span', 'cbr-tile-label', 'Sparks'));
    } else {
      t.classList.add('is-xp');
      t.append(el('span', 'cbr-tile-xp', 'XP'), el('b', 'cbr-tile-amount', '+' + fmt(prize.amount)), el('span', 'cbr-tile-label', 'XP'));
    }
    return t;
  }
  /** The prizes a tier can land on, weighted by its odds, for filling the carousel. */
  function pool(tier) {
    const out = [];
    for (const o of tier.odds) {
      const n = Math.max(1, Math.round(o.percent / 4));
      if (o.kind === 'card') {
        const cards = tier.cards.length ? tier.cards : [{ title: 'Mystery Card', imageUrl: null, rarity: 'Rare' }];
        for (let i = 0; i < Math.max(n, 8); i++) { const c = cards[i % cards.length]; out.push({ kind: 'card', title: c.title, imageUrl: c.imageUrl, rarity: c.rarity }); }
      } else for (let i = 0; i < n; i++) out.push({ kind: o.kind, amount: o.amount });
    }
    return out.length ? out : [{ kind: 'xp', amount: 25 }];
  }
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const resultPrize = (r) => (r.prizeKind === 'card'
    ? { kind: 'card', title: r.card?.title || 'Card', imageUrl: r.card?.imageUrl || null, rarity: r.card?.tier || 'Rare' }
    : { kind: r.prizeKind, amount: r.amount });
  const prizeName = (p) => (p.kind === 'card' ? p.title : p.kind === 'sparks' ? fmt(p.amount) + ' Sparks' : fmt(p.amount) + ' XP');

  /* ---------- Page render ---------- */
  function render(data) {
    state = data;
    avatar($('[data-rw-avatar]'), data);
    $('[data-rw-rank]').textContent = data.rank || 'Rookie';
    $('[data-rw-level]').textContent = 'Level ' + data.level;
    const bar = $('[data-rw-bar]'), pct = data.nextLevelXp ? Math.min(100, (data.levelXp / data.nextLevelXp) * 100) : 100;
    bar.setAttribute('aria-valuemax', String(data.nextLevelXp || data.levelXp || 1));
    bar.setAttribute('aria-valuenow', String(data.levelXp));
    bar.setAttribute('aria-valuetext', fmt(data.xp) + ' XP');
    $('[data-rw-fill]').style.width = pct + '%';
    $('[data-rw-xp]').textContent = data.nextLevelXp ? fmt(data.levelXp) + ' / ' + fmt(data.nextLevelXp) + ' XP' : fmt(data.xp) + ' XP';
    $('[data-rw-next]').textContent = data.nextLevelXp ? 'Level ' + (data.level + 1) : 'Max Level';
    $('[data-rw-total]').textContent = fmt(data.xp);
    $('[data-rw-month]').textContent = fmt(data.monthXp);
    const spins = data.spins || START.spins.map((t) => ({ ...t, unlocked: data.level >= t.minLevel }));
    $('[data-rw-left]').textContent = String(spins.filter((t) => t.unlocked && !t.result).length);

    // Streak
    const sb = data.streakBonus || START.streakBonus, days = Math.min(data.streak || 0, sb.maxDays);
    $('[data-rw-streak-count]').textContent = String(data.streak || 0);
    $('[data-rw-flames]').replaceChildren(...Array.from({ length: sb.maxDays }, (_, i) => { const li = el('li'); if (i < days) li.className = 'is-lit'; return li; }));
    $('[data-rw-bonus]').textContent = /* SITE */ days ? 'Card Prizes ' + Math.round(days * sb.perDay * 100) + '% More Likely' : 'No Streak Boost Yet';
    const btn = $('[data-rw-checkin]');
    btn.disabled = data.checkedInToday;
    btn.textContent = data.checkedInToday ? 'Checked In Today' : 'Check In · +' + data.rules.dailyCheckIn + ' XP';
    $('[data-rw-streak-note]').textContent = data.checkedInToday
      ? 'Come Back Tomorrow to Keep Your Streak Going.'
      : /* SITE */ 'Check In Every Day. Each Day in a Row Makes Card Prizes on Your Daily Spins ' + Math.round(sb.perDay * 100) + '% More Likely, Up to ' + sb.maxDays + ' Days.';

    // Daily Spins grid
    $('[data-rw-spins]').replaceChildren(...spins.map((t) => {
      const card = el('article', 'cbr-spin-card is-' + t.id + (t.unlocked ? '' : ' is-locked') + (t.result ? ' is-done' : ''));
      const art = el('div', 'cbr-spin-art'); art.append(img(spinArt[t.id], 160, 160));
      if (!t.unlocked) art.append(el('span', 'cbr-lock', 'Lv ' + t.minLevel));
      const name = el('h3', null, t.name);
      const sub = el('p', 'cbr-muted', t.result ? 'Won ' + prizeName(resultPrize(t.result)) : t.unlocked ? (t.cards.length ? t.cards.length + ' Cards in the Spin' : 'Free Once a Day') : 'Unlocks at Level ' + t.minLevel);
      const b = el('button', t.unlocked && !t.result ? 'cb-primary cbr-cta' : 'cb-secondary', t.result ? 'View Spin' : t.unlocked ? 'Spin' : 'Level ' + t.minLevel + ' Required');
      b.type = 'button';
      if (!t.unlocked) b.disabled = true;
      else b.addEventListener('click', () => openSpin(t.id));
      card.append(art, name, sub, b);
      return card;
    }));

    // Icons
    const colors = $('[data-rw-colors]');
    colors.replaceChildren(...data.colors.map((c) => {
      const b = el('button', 'cbr-swatch'); b.type = 'button'; b.style.background = c.bg;
      b.setAttribute('aria-label', c.id[0].toUpperCase() + c.id.slice(1));
      b.setAttribute('aria-pressed', String(!data.avatar.iconId && data.avatar.color === c.id));
      b.addEventListener('click', () => save({ color: c.id, iconId: null }));
      return b;
    }));
    $('[data-rw-icons]').replaceChildren(...data.icons.map((i) => {
      const b = el('button', 'cbr-icon'); b.type = 'button'; b.disabled = !i.unlocked;
      b.setAttribute('aria-pressed', String(data.avatar.iconId === i.id));
      b.append(img(iconUrls[i.id], 64, 64), el('span', null, i.name), el('small', null, i.unlocked ? '' : /* SITE */ i.club ? 'Club' : 'Level ' + i.minLevel));
      b.setAttribute('aria-label', i.unlocked ? i.name : i.name + (/* SITE */ i.club ? ', For Cardbit Club Members' : ', Unlocks at Level ' + i.minLevel));
      if (i.unlocked) b.addEventListener('click', () => save({ iconId: i.id }));
      return b;
    }));
    const r = data.rules;
    $('[data-rw-earn]').replaceChildren(...[
      [Math.round(r.perCardbitsSpent * 100) + ' XP', 'For Every 100 Cardbits Spent on Packs'],
      [r.perPackOpened + ' XP', 'For Every Pack You Open'],
      [r.dailyCheckIn + ' XP', 'For Your Daily Check-In'],
      ['Free', 'A Daily Spin for Every Spin Tier You Unlock'],
    ].map(([a, b]) => { const li = el('li'); li.append(el('b', null, a), ' ' + b); return li; }));
  }

  /* SITE */ function savedFlash(note) {
    const picked = root.querySelector('[data-rw-icons] [aria-pressed="true"], [data-rw-colors] [aria-pressed="true"]');
    for (const n of [picked, note, root.querySelector('.cbr-hero-avatar, [data-rw-avatar]')]) { if (!n) continue; n.classList.remove('cbr-saved'); void n.offsetWidth; n.classList.add('cbr-saved'); }
  }
  async function save(body) {
    if (busy) return; busy = true;
    const note = $('[data-rw-icon-status]'); note.textContent = 'Saving…';
    try { const saved = await call({ action: 'avatar', ...body }); render(saved); note.textContent = 'Icon Saved'; /* SITE */ savedFlash(note); window.CardbitRewardsNav?.update({ level: saved.level, avatar: saved.avatar }); }
    catch (e) { note.textContent = friendly(e, "We Couldn't Save Your Icon. Please Try Again."); }
    finally { busy = false; }
  }
  $('[data-rw-open-icons]').addEventListener('click', () => $('[data-rw-icon-panel]').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }));

  $('[data-rw-checkin]').addEventListener('click', async (ev) => {
    if (busy || state?.checkedInToday) return; busy = true; const b = ev.currentTarget; b.disabled = true;
    try {
      const data = await call({ action: 'checkin' }); render(data);
      const note = $('[data-rw-streak-note]'); note.textContent = data.checkIn.already ? 'You Already Checked In Today.' : '+' + data.checkIn.xp + ' XP. Streak Saved!';
      if (!data.checkIn.already && window.CardbitFlair?.confetti) window.CardbitFlair.confetti('#00e6e1');
    } catch (e) { $('[data-rw-streak-note]').textContent = friendly(e, "Check-In Isn't Available Right Now. Please Try Again Later."); b.disabled = false; }
    finally { busy = false; }
  });

  /* ---------- Reset countdown (midnight Central) ---------- */
  function untilMidnightCentral() {
    const now = new Date();
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now).map((p) => [p.type, p.value]));
    const secs = 86400 - ((+parts.hour % 24) * 3600 + +parts.minute * 60 + +parts.second);
    const p2 = (n) => String(n).padStart(2, '0');
    return p2(Math.floor(secs / 3600)) + ':' + p2(Math.floor((secs % 3600) / 60)) + ':' + p2(secs % 60);
  }
  const reset = $('[data-rw-reset]');
  setInterval(() => { reset.textContent = untilMidnightCentral(); }, 1000); reset.textContent = untilMidnightCentral();

  /* ---------- Spin modal with the prize carousel ---------- */
  const modal = $('[data-rw-modal]'), track = $('[data-rw-reel]'), wrap = $('[data-rw-reel-wrap]');
  const go = $('[data-rw-go]'), skip = $('[data-rw-skip]'), done = $('[data-rw-done]'), vault = $('[data-rw-vault]');
  const reveal = $('[data-rw-reveal]'), mstatus = $('[data-rw-modal-status]');
  vault.href = root.dataset.vault || '#';
  let tier = null, finish = null, lastFocus = null;
  const TILE = () => (track.firstElementChild ? track.firstElementChild.getBoundingClientRect().width + 12 : 132);

  function idleReel(t) {
    const items = shuffle(pool(t)).slice(0, 24);
    while (items.length < 24) items.push(...pool(t));
    track.style.transition = 'none';
    track.replaceChildren(...items.slice(0, 24).map(tile));
    requestAnimationFrame(() => { track.style.transform = 'translateX(' + (wrap.clientWidth / 2 - TILE() * 12 + 6 - TILE() / 2) + 'px)'; });
  }
  function oddsList(t) {
    const label = (o) => (o.kind === 'card' ? 'A Real Card' : o.kind === 'sparks' ? fmt(o.amount) + ' Sparks' : fmt(o.amount) + ' XP');
    $('[data-rw-odds]').replaceChildren(...t.odds.map((o) => { const li = el('li', 'is-' + o.kind); li.append(el('span', null, label(o)), el('b', null, o.percent + '%')); return li; }));
    const box = $('[data-rw-contents]');
    box.replaceChildren(...t.cards.slice(0, 18).map((c) => { const f = el('figure'); if (c.imageUrl) f.append(img(c.imageUrl, 72, 100)); f.append(el('figcaption', null, c.title)); return f; }));
    box.hidden = !t.cards.length;
  }
  function showResult(prize, replay) {
    wrap.classList.remove('is-spinning');
    wrap.hidden = true;
    reveal.hidden = false;
    $('[data-rw-reveal-tile]').replaceChildren(tile(prize));
    $('[data-rw-reveal-name]').textContent = prizeName(prize);
    $('[data-rw-reveal-note]').textContent = prize.kind === 'card' ? 'It’s in Your Vault. Ship It or Keep It.' : replay ? 'You Already Spun This One Today.' : 'Added to Your Account.';
    go.hidden = true; skip.hidden = true; done.hidden = false; vault.hidden = prize.kind !== 'card';
    if (!replay && window.CardbitFlair?.confetti) window.CardbitFlair.confetti(prize.kind === 'card' ? '#ffb65c' : '#00e6e1');
    done.focus();
  }
  function openSpin(id) {
    tier = (state.spins || START.spins).find((t) => t.id === id);
    if (!tier) return;
    lastFocus = document.activeElement;
    $('[data-rw-modal-title]').textContent = tier.name;
    $('[data-rw-modal-kicker]').textContent = tier.result ? "Today's Spin" : 'Free Daily Spin';
    reveal.hidden = true; wrap.hidden = false; mstatus.textContent = '';
    go.hidden = !!tier.result; go.disabled = false; skip.hidden = true; done.hidden = !tier.result; vault.hidden = true;
    modal.hidden = false; document.documentElement.classList.add('cbr-lock-scroll');
    oddsList(tier); idleReel(tier);
    if (tier.result) showResult(resultPrize(tier.result), true);
    else go.focus();
  }
  function closeSpin() {
    if (wrap.classList.contains('is-spinning')) return;
    modal.hidden = true; document.documentElement.classList.remove('cbr-lock-scroll');
    if (lastFocus) lastFocus.focus();
  }
  $('[data-rw-close]').addEventListener('click', closeSpin);
  done.addEventListener('click', closeSpin);
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSpin(); });
  modal.addEventListener('click', (e) => { if (e.target === modal) closeSpin(); });

  go.addEventListener('click', async () => {
    if (busy || !tier) return; busy = true;
    go.disabled = true; go.textContent = 'Spinning…'; mstatus.textContent = '';
    // Start moving right away; the stop position is set once the server returns the prize.
    const items = shuffle(pool(tier).concat(pool(tier), pool(tier), pool(tier))).slice(0, 56);
    while (items.length < 56) items.push(...pool(tier));
    const WIN = 48;
    let data;
    try { data = await call({ action: 'spin', tier: tier.id }); }
    catch (e) { mstatus.textContent = friendly(e, "Spins Aren't Available Right Now. Please Try Again Later."); go.disabled = false; go.textContent = 'Spin'; busy = false; return; }
    const prize = resultPrize(data.result);
    items[WIN] = prize;
    const near = pool(tier).find((p) => p.kind === 'card');
    if (near && prize.kind !== 'card') items[WIN + (Math.random() < 0.5 ? 1 : -1)] = near;
    track.style.transition = 'none';
    track.replaceChildren(...items.slice(0, 56).map(tile));
    const w = TILE(), center = wrap.clientWidth / 2;
    const jitter = (Math.random() - 0.5) * (w - 40);
    track.style.transform = 'translateX(' + (center - w * 2) + 'px)';
    void track.offsetWidth;
    const end = center - (w * WIN + (w - 12) / 2) + jitter;
    const ms = reduce ? 0 : 6200;
    wrap.classList.add('is-spinning'); skip.hidden = false; go.hidden = true;
    track.style.transition = 'transform ' + ms + 'ms cubic-bezier(.08,.6,.12,1)';
    track.style.transform = 'translateX(' + end + 'px)';
    const after = () => {
      if (!finish) return; finish = null;
      track.style.transition = 'transform 250ms ease-out';
      track.style.transform = 'translateX(' + (center - (w * WIN + (w - 12) / 2)) + 'px)';
      track.children[WIN]?.classList.add('is-winner');
      setTimeout(() => { render(data); tier = (data.spins || []).find((t) => t.id === tier.id) || tier; showResult(prize, data.result.replay); busy = false; }, reduce ? 0 : 450);
    };
    finish = after;
    setTimeout(after, ms + 30);
  });
  skip.addEventListener('click', () => { if (finish) { track.style.transition = 'none'; finish(); } });

  /* ---------- Load ---------- */
  async function load() {
    status.hidden = false; status.textContent = 'Loading Your Rewards…';
    let data = null;
    try { data = await call(); } catch { data = null; }
    render(data && data.enabled && data.signedIn ? data : START);
    content.hidden = false; status.hidden = true;
  }
  load();
})();
