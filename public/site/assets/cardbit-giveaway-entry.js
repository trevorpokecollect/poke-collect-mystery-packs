(() => {
  'use strict';
  const script = document.querySelector('script[data-cardbit-entry]');
  const dialog = document.querySelector('dialog[data-cbg-dialog]');
  if (!script || !dialog || dialog.dataset.ready) return;
  dialog.dataset.ready = 'true';
  const labels = document.querySelector('[data-cbg-labels]').content.querySelectorAll('[data-label]');
  const t = Object.fromEntries(Array.from(labels, label => [label.dataset.label, label.textContent]));
  const el = name => dialog.querySelector('[data-cbg-' + name + ']');
  const shortcut = document.querySelector('[data-cbg-shortcut]');
  const join = dialog.querySelector('[data-cbg-act="join"]');
  const visit = dialog.querySelector('[data-cbg-act="visit"]');
  const extraButton = dialog.querySelector('[data-cbg-act="extra"]');
  const extraLink = el('extra-link');
  const region = dialog.querySelector('#cbg-region');
  const cards = [...dialog.querySelectorAll('[data-cbg-method]')];
  const onlySample = script.hasAttribute('data-cbg-sample-only');
  const allowSample = script.hasAttribute('data-cardbit-entry-preview');
  const root = script.dataset.root || '/';
  const endpoint = script.dataset.endpoint;
  const storageKey = 'cardbit:daily-giveaway-panel:' + script.dataset.account;
  const byMethod = Object.fromEntries(cards.map(card => [card.dataset.cbgMethod, card]));
  const integer = n => Number.isSafeInteger(n) && n >= 0;
  const count = n => new Intl.NumberFormat(document.documentElement.lang || 'en').format(n);
  const centralTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', hourCycle: 'h23',
  });
  const clockLabel = el('clock-label'), clockValue = el('clock'), clockCaption = el('clock-caption');
  let view = null, mode = 'loading', visitedLive = false, reading = false, writing = false;
  let activeExtra = '', eligibleForm = false, opener = null, timer = 0;
  let nextDrawCheck = 0;
  let sampleRecord, dismissedDay = '', wasHome = false;
  const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;

  function readSession(key) {
    try { return sessionStorage.getItem(key); } catch { return null; }
  }
  function writeSession(key, value) {
    try { sessionStorage.setItem(key, value); } catch { /* Session storage is optional. */ }
  }
  function referredBy() {
    const code = new URLSearchParams(location.search).get('ref');
    if (uuid.test(code || '')) writeSession('cbGiveawayRef', code);
    const saved = readSession('cbGiveawayRef');
    return uuid.test(code || '') ? code : uuid.test(saved || '') ? saved : '';
  }
  function centralParts(date) {
    return Object.fromEntries(centralTime.formatToParts(date).map(part => [part.type,part.value]));
  }
  function drawDay(now = new Date()) {
    const parts = centralParts(now);
    const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
    if (Number(parts.hour) >= 20) date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }
  function previewClose(day) {
    // At 20:00 UTC Chicago is already past that date's daylight-saving transition.
    const afternoon = new Date(day + 'T20:00:00Z');
    const hoursUntilEight = 20 - Number(centralParts(afternoon).hour);
    return new Date(afternoon.getTime() + hoursUntilEight * 3600000).toISOString();
  }
  function onHome() {
    const p = new URLSearchParams(location.search), route = p.get('cb'), surface = p.get('view');
    return (!surface || surface === 'daily-giveaway') && (!route || route === 'home') &&
      (!location.hash || /^#(?:home|daily-giveaway)?\/?$/i.test(location.hash));
  }
  function sampleView(settings) {
    if (!sampleRecord) {
      try { sampleRecord = JSON.parse(readSession(storageKey)) || {}; } catch { sampleRecord = {}; }
      if (!Array.isArray(sampleRecord.claimed)) sampleRecord.claimed = [];
    }
    const day = drawDay();
    if (sampleRecord.day !== day || !sampleRecord.byKind || typeof sampleRecord.byKind !== 'object') {
      sampleRecord.day = day;
      sampleRecord.byKind = {};
    }
    const byKind = sampleRecord.byKind;
    const shareEntries = integer(settings?.shareEntries) ? settings.shareEntries : 100;
    const referralEntries = integer(settings?.referralEntries) ? settings.referralEntries : 500;
    const closesAt = settings?.day === day && Date.parse(settings.closesAt) > Date.now()
      ? settings.closesAt : previewClose(day);
    return { enabled: true, signedIn: true, subscribed: true, held: false, day, prize: 10000,
      closesAt, claimed: sampleRecord.claimed, whatnotDone: sampleRecord.claimed.includes('whatnot'),
      entered: byKind.daily === 1, byKind, total: Object.values(byKind).filter(integer).reduce((a,b) => a+b,0),
      shareEntries, referralEntries, winners: [], freeInstructions: '', rulesUrl: '' };
  }
  function showSample(settings) {
    mode = 'sample';
    view = sampleView(settings);
  }
  function validState(s) {
    return s && typeof s.enabled === 'boolean' && /^\d{4}-\d{2}-\d{2}$/.test(s.day) &&
      Number.isFinite(Date.parse(s.closesAt)) && typeof s.signedIn === 'boolean' &&
      typeof s.subscribed === 'boolean' && typeof s.held === 'boolean' && typeof s.whatnotDone === 'boolean' &&
      typeof s.entered === 'boolean' && Array.isArray(s.claimed) && s.byKind && typeof s.byKind === 'object' &&
      integer(s.total) && integer(s.prize) && integer(s.shareEntries) && integer(s.referralEntries);
  }
  function acceptLive(s) {
    const changed = view?.day && view.day !== s.day;
    if (s.enabled) visitedLive = true;
    if (!s.enabled && allowSample && !visitedLive) showSample(s);
    else { view = s; mode = s.enabled ? 'live' : 'paused'; }
    if (changed) { clearExtras(); notice(t.change_day); }
  }
  async function request(body) {
    const response = await fetch(endpoint, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !validState(data)) throw new Error(data?.error || t.unavailable);
    return data;
  }
  async function load() {
    if (reading || writing) return;
    if (onlySample) { showSample(view); render(); return; }
    reading = true;
    try { acceptLive(await request()); }
    catch {
      if (allowSample && !visitedLive) showSample(view);
      else { mode = 'error'; view = null; clearExtras(); }
    } finally { reading = false; render(); }
  }
  function notice(text = '') { if (el('message').textContent !== text) el('message').textContent = text; }
  function countdownText(seconds) {
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map(part => String(part).padStart(2,'0')).join(':');
  }
  function clock(now = Date.now()) {
    const active = mode === 'live' || mode === 'sample';
    const label = active ? t.draw_in : t.draw_time;
    if (clockLabel.textContent !== label) clockLabel.textContent = label;
    clockValue.hidden = !active;
    const seconds = active ? Math.max(0, Math.ceil((Date.parse(view.closesAt) - now) / 1000)) : 0;
    if (active) {
      const display = countdownText(seconds);
      if (clockValue.textContent !== display) clockValue.textContent = display;
    }
    const expired = active && seconds === 0;
    const caption = expired ? t.draw_ended : t.schedule;
    if (clockCaption.textContent !== caption) clockCaption.textContent = caption;
    return expired;
  }
  function tick() {
    if (!dialog.open || document.hidden) return;
    const now = Date.now();
    if (clock(now) && !reading && !writing && now >= nextDrawCheck) {
      nextDrawCheck = now + 15000;
      void load();
    }
  }
  function gate() {
    if (!view || mode === 'error') return 'error';
    if (mode === 'paused') return 'paused';
    if (!view.signedIn) return 'signin';
    if (view.held) return 'held';
    if (!view.subscribed) return 'email';
    return '';
  }
  function clearExtras() {
    eligibleForm = false; activeExtra = '';
    el('eligibility').hidden = true; el('extra').hidden = true;
  }
  function safeRules(input) {
    if (!input) return '';
    try {
      const u = new URL(input, 'https://cardbit.com');
      return u.origin === 'https://cardbit.com' && !u.username && !u.password && u.pathname !== '/' ? u.href : '';
    } catch { return ''; }
  }
  function render() {
    const promotion = onHome();
    document.documentElement.toggleAttribute('data-cardbit-daily-promotion', promotion);
    const today = view?.day || drawDay();
    shortcut.hidden = !promotion || dismissedDay === today || dialog.open;
    document.querySelectorAll('[data-giveaway-open]').forEach(button => {
      button.setAttribute('aria-haspopup','dialog'); button.setAttribute('aria-expanded',String(dialog.open));
    });
    if (!promotion || !dialog.open) return;
    const sample = mode === 'sample', valid = mode === 'live' || sample, lock = gate();
    const already = valid && !lock && view.entered;
    const intros = { loading:t.loading, error:t.unavailable, paused:t.paused, held:t.held, signin:t.signin_note, email:t.email_note };
    const captions = { loading:t.loading, error:t.retry, paused:t.paused, held:t.held, signin:t.signin, email:t.refresh };
    const key = mode === 'loading' ? 'loading' : lock;
    el('preview').hidden = !sample; el('sample-note').hidden = !sample;
    el('prize').textContent = count(view?.prize || 10000);
    el('total').textContent = valid && view.signedIn ? count(view.total) : '—';
    clock();
    el('intro').textContent = intros[key] || (already ? t.joined_note : view.whatnotDone ? t.daily_intro : t.first_visit);
    el('join-label').textContent = captions[key] || (already ? t.joined : t.join);
    el('free').hidden = Boolean(key);
    el('free').textContent = already ? '✓' : '+1';
    join.toggleAttribute('data-joined', Boolean(already));
    join.setAttribute('aria-disabled', String(Boolean(already || writing || ['loading','paused','held'].includes(key))));
    const preferences = el('preferences');
    preferences.hidden = key !== 'email';
    if (key === 'email') preferences.href = root + '?cb=welcome';
    if (lock || view?.whatnotDone) { eligibleForm = false; el('eligibility').hidden = true; }
    if (lock || (!view?.entered && activeExtra !== 'purchase')) { activeExtra = ''; el('extra').hidden = true; }
    const done = { whatnot:view?.whatnotDone, facebook:view?.claimed?.includes('facebook'),
      instagram:view?.claimed?.includes('instagram'), share:Boolean(view?.byKind?.share) };
    const rates = { whatnot:100, facebook:50, instagram:50, share:view?.shareEntries ?? 100, referral:view?.referralEntries ?? 500, purchase:1 };
    cards.forEach(card => {
      const method = card.dataset.cbgMethod, completed = Boolean(done[method]);
      card.toggleAttribute('data-complete', completed);
      const hint = ['facebook','instagram'].includes(method) ? t.social_hint : t[method + '_hint'];
      card.querySelector('[data-cbg-hint]').textContent = completed ? t.complete : rates[method] === 0 ? t.off : hint;
      card.querySelector('[data-cbg-rate]').textContent = '+' + count(rates[method]);
      if (!['facebook','instagram'].includes(method))
        card.setAttribute('aria-expanded', String((method === 'whatnot' && eligibleForm) || activeExtra === method));
    });
    const rules = safeRules(view?.rulesUrl);
    el('rules').hidden = !rules;
    if (rules) el('rules').href = rules;
    el('instructions').hidden = !view?.freeInstructions;
    el('instructions').textContent = view?.freeInstructions || '';
    const results = Array.isArray(view?.winners) ? view.winners : [];
    const winners = el('winners'); winners.hidden = results.length === 0;
    const list = winners.querySelector('ul'); list.replaceChildren();
    results.forEach(result => {
      const li = document.createElement('li');
      li.textContent = result.day + ' · ' + (result.yours ? t.won : t.awarded);
      list.appendChild(li);
    });
  }
  function sampleAction(body) {
    const day = drawDay();
    if (view.day !== day) { showSample(view); throw new Error(t.change_day); }
    const kind = body.intent === 'social' ? body.network : body.intent === 'enter' ? 'daily' : body.intent;
    const once = ['whatnot','facebook','instagram'].includes(kind);
    const amount = { whatnot:100, facebook:50, instagram:50, daily:1, share:view.shareEntries }[kind];
    if (!amount || (once && view.claimed.includes(kind)) || view.byKind[kind]) return;
    if (kind === 'daily' && !view.whatnotDone || !['whatnot','daily'].includes(kind) && !view.entered) throw new Error(t.join_first);
    if (once) sampleRecord.claimed.push(kind);
    sampleRecord.byKind[kind] = amount;
    if (kind === 'whatnot') sampleRecord.whatnotPending = true;
    if (kind === 'daily' && sampleRecord.whatnotPending) {
      sampleRecord.byKind.whatnot = 100; sampleRecord.whatnotPending = false;
    }
    writeSession(storageKey, JSON.stringify(sampleRecord));
    showSample(view);
  }
  async function mutate(body, message) {
    if (writing || reading || !view || gate()) return;
    if (mode === 'live' && Date.now() >= Date.parse(view.closesAt)) { await load(); notice(t.change_day); return; }
    writing = true; render(); notice('');
    try {
      if (mode === 'sample') sampleAction(body);
      else {
        const day = view.day;
        const result = await request(body);
        acceptLive(result);
        if (!result.enabled || result.day !== day || (body.intent === 'enter' && (!result.entered || result.byKind.daily !== 1)) ||
          (body.intent === 'whatnot' && !result.whatnotDone) ||
          (body.intent === 'social' && !result.claimed.includes(body.network)) || (body.intent === 'share' && !result.byKind.share))
          throw new Error(result.day !== day ? t.change_day : t.unavailable);
        if (body.intent === 'enter') window.dispatchEvent(new CustomEvent('cardbit:daily-entered', {detail:{day}}));
      }
      const restore = el('eligibility').contains(document.activeElement) || el('extra').contains(document.activeElement);
      clearExtras(); notice(message);
      if (restore && dialog.open) focusArea(body.intent === 'share' ? byMethod.share : join);
    } catch (err) {
      notice(err.message || t.unavailable);
      if (visitedLive) {
        try { acceptLive(await request()); } catch { mode = 'error'; view = null; clearExtras(); }
      }
    } finally { writing = false; render(); }
  }
  function focusArea(node) {
    node.focus({preventScroll:true});
    node.scrollIntoView({block:'nearest',inline:'nearest'});
  }
  function showEligibility() {
    clearExtras(); eligibleForm = true; el('eligibility').hidden = false;
    const sample = mode === 'sample';
    el('real-eligibility').hidden = sample; el('sample-eligibility').hidden = !sample;
    visit.textContent = sample ? t.try_visit : t.visit;
    notice(''); render(); focusArea(sample ? visit : region);
  }
  function referralLink() {
    if (!uuid.test(view?.refCode || '')) return '';
    const address = new URL('/apps/packs/giveaways','https://cardbit.com');
    address.searchParams.set('ref',view.refCode); return address.href;
  }
  function showExtra(kind) {
    clearExtras(); activeExtra = kind;
    const box = el('extra'), sample = mode === 'sample', input = el('ref-link');
    box.hidden = false; input.hidden = true; extraButton.hidden = true; extraLink.hidden = true;
    extraLink.removeAttribute('href'); extraButton.dataset.action = '';
    let heading, detail;
    if (kind === 'referral') {
      heading = t.ref_title; detail = sample ? t.ref_sample : t.ref_description;
      const address = referralLink();
      if (!sample && address) {
        input.value = address; input.hidden = false; extraButton.hidden = false;
        extraButton.textContent = t.copy; extraButton.dataset.action = 'copy';
      } else if (!sample) detail = t.no_ref;
    } else if (kind === 'purchase') {
      heading = t.purchase; detail = t.buy_info;
      extraLink.href = root + '?cb=cardbits'; extraLink.textContent = t.view_topups; extraLink.hidden = false;
    } else {
      heading = t.share_title; detail = sample ? t.share_sample : t.share_alt;
      if (sample) { extraButton.hidden = false; extraButton.textContent = t.share_try; extraButton.dataset.action = 'shared'; }
      else {
        const address = referralLink() || 'https://cardbit.com/apps/packs/giveaways';
        extraLink.href = 'mailto:?subject=Cardbit%20Daily%20Giveaway&body=' + encodeURIComponent(address);
        extraLink.textContent = t.share_email; extraLink.hidden = false;
      }
    }
    el('extra-title').textContent = heading; el('extra-desc').textContent = detail;
    notice(''); render(); focusArea(box);
  }
  async function handleJoin() {
    if (writing || reading) return;
    const lock = gate();
    if (lock === 'signin') {
      const back = new URL(location.href); back.searchParams.set('giveaway','open');
      const login = new URL(script.dataset.login,location.origin);
      login.searchParams.set('return_url',back.pathname + back.search);
      location.assign(login.href); return;
    }
    if (lock === 'email' || lock === 'error') { notice(''); await load(); return; }
    if (lock || !view || view.entered) return;
    if (!view.whatnotDone) { showEligibility(); return; }
    await mutate({intent:'enter',expectedDay:view.day},t.plus_one);
  }
  async function handleMethod(event, method) {
    const realSocial = ['facebook','instagram'].includes(method) && mode === 'live' && !gate() &&
      view.entered && !view.claimed.includes(method) && !writing && !reading && Date.now() < Date.parse(view.closesAt);
    if (!realSocial) event.preventDefault();
    if (writing || reading) return;
    if (gate()) { notice(el('intro').textContent); focusArea(join); return; }
    if (mode === 'live' && Date.now() >= Date.parse(view.closesAt)) { await load(); notice(t.change_day); return; }
    if (byMethod[method].hasAttribute('data-complete')) { notice(t.already); return; }
    if (method === 'whatnot') { showEligibility(); return; }
    if ((method === 'share' && !view.shareEntries) || (method === 'referral' && !view.referralEntries)) { notice(t.off); return; }
    if (method === 'purchase') { showExtra(method); return; }
    if (!view.entered) { notice(t.join_first); focusArea(join); return; }
    if (['facebook','instagram'].includes(method)) { await mutate({intent:'social',network:method},t.saved_bonus); return; }
    if (method === 'share' && mode === 'live' && navigator.share) {
      const day = view.day;
      try {
        await navigator.share({title:document.getElementById('cbg-title').textContent, url:referralLink() || 'https://cardbit.com/apps/packs/giveaways'});
        if (view?.day === day) await mutate({intent:'share'},t.saved_bonus);
        else notice(t.change_day);
      } catch (err) { if (err.name !== 'AbortError') notice(t.share_problem); }
      return;
    }
    showExtra(method);
  }
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
      return;
    }
    const target = event.target.closest('[data-cbg-method],[data-cbg-act],[data-cbg-close],[data-cbg-extra-link]');
    if (!target) return;
    if (target.hasAttribute('data-cbg-close')) { dialog.close(); return; }
    if (target.dataset.cbgMethod) { void handleMethod(event,target.dataset.cbgMethod); return; }
    if (target === join) { void handleJoin(); return; }
    if (target === visit) {
      const sample = mode === 'sample';
      if (sample || writing || reading || gate() || !eligibleForm || !region.value || !el('adult').checked) event.preventDefault();
      if (writing || reading || gate() || !eligibleForm) return;
      if (!sample && (!region.value || !el('adult').checked)) { notice(t.state_needed); focusArea(region.value ? el('adult') : region); return; }
      void mutate({intent:'whatnot',adult:el('adult').checked,region:region.value,ref:referredBy()},t.saved_whatnot);
      return;
    }
    if (target === extraLink && activeExtra === 'share' && mode === 'live') {
      extraButton.hidden = false; extraButton.dataset.action = 'shared'; extraButton.textContent = t.share_confirm; return;
    }
    if (target === extraButton && extraButton.dataset.action === 'shared' && activeExtra === 'share') {
      void mutate({intent:'share'},t.saved_bonus);
    } else if (target === extraButton && extraButton.dataset.action === 'copy') {
      const address = referralLink();
      if (address) Promise.resolve().then(() => navigator.clipboard.writeText(address)).then(() => notice(t.copied)).catch(() => {
        el('ref-link').select(); notice(t.manual_copy);
      });
    }
  });
  function openPanel(button) {
    if (!onHome() || dialog.open) return;
    opener = button || document.querySelector('[data-giveaway-open]');
    clearExtras(); notice(''); dialog.showModal(); el('close').focus({preventScroll:true});
    render(); void load();
    timer = window.setInterval(tick,1000);
  }
  dialog.addEventListener('close', () => {
    clearInterval(timer); render();
    const button = opener?.isConnected && !opener.closest('[hidden]') ? opener : document.querySelector('[data-giveaway-open]');
    if (button && onHome()) button.focus({preventScroll:true});
  });
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-giveaway-open]');
    if (button && onHome()) { event.preventDefault(); openPanel(button); }
  });
  shortcut.querySelector('[data-cbg-dismiss]').addEventListener('click', () => {
    dismissedDay = view?.day || drawDay(); writeSession(storageKey + ':dismiss',dismissedDay);
    render(); document.querySelector('#cardbit-store [data-giveaway-open]')?.focus({preventScroll:true});
  });
  function routeChanged() {
    const home = onHome();
    if (!home && dialog.open) dialog.close();
    const requested = onlySample || new URLSearchParams(location.search).get('giveaway') === 'open';
    if (home && !wasHome && requested) openPanel(null);
    wasHome = home; render();
  }
  window.addEventListener('cardbit:storefront-rendered',routeChanged);
  window.addEventListener('popstate',routeChanged); window.addEventListener('hashchange',routeChanged);
  document.addEventListener('visibilitychange',() => { if (!document.hidden && dialog.open) { clock(); void load(); } });
  window.addEventListener('pageshow',event => { if (event.persisted && dialog.open) void load(); });
  dismissedDay = readSession(storageKey + ':dismiss') || '';
  referredBy(); routeChanged();
})();
