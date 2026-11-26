/* Pack Pass portrait frames and the Rewards page emote picker (site only).
   window.cardbitPass = { frames, framesSm } comes from the server (app/site/play/pass-icons.ts).
   - CardbitPass.frame(node, tier): puts the member's frame around an avatar element (any size).
   - CardbitPass.html(tier, small): frame <img> markup for code that builds HTML strings (chat, header).
   - CardbitPass.picker(root, data, choose): the "Pack Pass Emotes" panel on the Rewards page, followed by
     "My Opening Style" (card sleeve + reveal effect for the member's own openings; data.style from /api/rewards). */
(() => {
  if (window.CardbitPass) return;
  const cfg = window.cardbitPass || { frames: {}, framesSm: {} };
  const plan = () => window.cardbitPlan || { name: 'Pack Pass', short: 'Pass', path: '/pass' };
  const TIER_NAME = { plus: 'Plus', pro: 'Pro', ultimate: 'Ultimate' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const css = document.createElement('style');
  css.textContent = [
    '.cbp-host{position:relative;overflow:visible!important}',
    '.cbp-frame{position:absolute;left:-24.4%;top:-19.8%;width:148.8%;height:148.8%;max-width:none!important;pointer-events:none;border-radius:0!important;background:none!important;z-index:1}',
    '.cbp-mini{position:relative;display:inline-grid;flex:none;margin:5px}',
    '.cbp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '.cbp-panel{margin-top:22px;padding:18px;border:1px solid #2b3d42;border-radius:16px;background:linear-gradient(160deg,#10262b,#0c1a1e)}',
    '.cbp-panel h3{margin:0;font:800 1.15rem "Cardbit Outfit",system-ui,sans-serif}',
    '.cbp-panel>p{margin:4px 0 14px;color:#a8b3c7}',
    '.cbp-chars{display:flex;gap:8px;overflow-x:auto;padding:4px 2px 10px;scrollbar-width:thin}',
    '.cbp-char{flex:none;display:grid;justify-items:center;gap:4px;width:74px;padding:6px 4px;border:1px solid transparent;border-radius:12px;background:none;color:#cfe0e2;font:600 .74rem "Cardbit Outfit",system-ui,sans-serif;cursor:pointer}',
    '.cbp-char img{width:48px;height:48px;border-radius:50%}',
    '.cbp-char[aria-pressed="true"]{border-color:#2EE6F0;background:#0f3138;color:#fff}',
    '.cbp-char:focus-visible,.cbp-emote:focus-visible{outline:2px solid #2EE6F0;outline-offset:2px}',
    '.cbp-emotes{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px}',
    '.cbp-emote{position:relative;display:grid;justify-items:center;gap:6px;padding:10px 6px;border:1px solid #2b3d42;border-radius:14px;background:#0b1719;color:#e8f4f3;font:700 .86rem "Cardbit Outfit",system-ui,sans-serif;cursor:pointer}',
    '.cbp-emote img{width:84px;height:84px;border-radius:50%}',
    '.cbp-emote small{font:600 .7rem "Cardbit Outfit",system-ui,sans-serif;color:#a8b3c7}',
    '.cbp-emote.is-ult small{color:#FFC94D}',
    '.cbp-emote[aria-pressed="true"]{border-color:#2EE6F0;box-shadow:0 0 0 2px #2EE6F0 inset}',
    '.cbp-emote:disabled{cursor:not-allowed}.cbp-emote:disabled img{filter:grayscale(.85) brightness(.55)}',
    '.cbp-join{display:inline-flex;margin-top:14px}',
    '.cbp-panel h4{margin:16px 0 8px;font:800 .95rem "Cardbit Outfit",system-ui,sans-serif;color:#cfe0e2}',
    '.cbp-sleeves{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px}',
    '.cbp-sleeve{display:grid;justify-items:center;gap:5px;padding:8px 6px;border:1px solid #2b3d42;border-radius:14px;background:#0b1719;color:#e8f4f3;font:700 .8rem "Cardbit Outfit",system-ui,sans-serif;cursor:pointer}',
    '.cbp-sleeve img{width:72px;aspect-ratio:600/837;border-radius:6px}',
    '.cbp-sleeve .cbp-none{width:72px;aspect-ratio:600/837;border-radius:6px;border:1px dashed #3a5257;display:grid;place-items:center;color:#a8b3c7;font-size:.7rem}',
    '.cbp-sleeve small{font:600 .68rem "Cardbit Outfit",system-ui,sans-serif;color:#a8b3c7}.cbp-sleeve.is-ult small{color:#FFC94D}',
    ':is(#cardbit-store,body) .cbp-panel button.cbp-sleeve[aria-pressed="true"],:is(#cardbit-store,body) .cbp-panel button.cbp-fx[aria-pressed="true"]{border-color:#2EE6F0;background:#0f3138;box-shadow:0 0 0 2px #2EE6F0 inset}',
    '.cbp-sleeve:disabled,.cbp-fx:disabled{cursor:not-allowed;opacity:.5}',
    '.cbp-fxs{display:flex;flex-wrap:wrap;gap:6px}',':is(#cardbit-store,body) .cbp-panel button.cbp-fx,:is(#cardbit-store,body) .cbp-panel button.cbp-sleeve{border:1px solid #2b3d42}',':is(#cardbit-store,body) .cbp-panel button.cbp-fx{padding:6px 11px;background:#0b1719}',':is(#cardbit-store,body) .cbp-panel button.cbp-sleeve{padding:8px 6px;background:#0b1719}',
    '.cbp-fx{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border:1px solid #2b3d42;border-radius:999px;background:#0b1719;color:#e8f4f3;font:600 .8rem "Cardbit Outfit",system-ui,sans-serif;cursor:pointer}',
    '.cbp-fx img{width:22px;height:22px;border-radius:50%}',
    '.cbp-sleeve:focus-visible,.cbp-fx:focus-visible{outline:2px solid #2EE6F0;outline-offset:2px}',
    '.cbp-note{margin:8px 0 0;color:#a8b3c7;font-size:.85rem}.cbp-err{color:#ff8a8a}',
  ].join('');
  document.head.append(css);

  const frameUrl = (tier, small) => (small ? cfg.framesSm : cfg.frames)[tier] || null;
  function frame(node, tier, opts) {
    if (!node) return;
    node.querySelectorAll(':scope > .cbp-frame, :scope > .cbp-sr').forEach((n) => n.remove());
    node.classList.remove('cbp-host');
    const small = opts && 'small' in opts ? opts.small : node.getBoundingClientRect().width < 48;
    const url = tier && frameUrl(tier, small);
    if (!url) return;
    node.classList.add('cbp-host');
    const img = new Image(); img.className = 'cbp-frame'; img.alt = ''; img.src = url; img.decoding = 'async';
    const sr = document.createElement('span'); sr.className = 'cbp-sr'; sr.textContent = plan().name + ' ' + TIER_NAME[tier] + ' member';
    node.append(img, sr);
  }
  function html(tier, small) {
    const url = tier && frameUrl(tier, small);
    return url ? '<img class="cbp-frame" alt="" src="' + esc(url) + '"><span class="cbp-sr">' + esc(plan().name + ' ' + TIER_NAME[tier] + ' member') + '</span>' : '';
  }

  // Rewards page: emotes grouped by character, after the regular icon grid.
  let current = null;
  function picker(root, data, choose) {
    const grid = root.querySelector('[data-rw-icons]');
    const pass = data && data.pass;
    if (!grid || !pass) return;
    const icons = JSON.parse(root.dataset.icons || '{}');
    let panel = root.querySelector('.cbp-panel');
    if (!panel) { panel = document.createElement('section'); panel.className = 'cbp-panel'; panel.setAttribute('aria-labelledby', 'cbp-title'); grid.after(panel); }
    const chosen = pass.characters.find((c) => c.emotes.some((e) => e.id === data.avatar.iconId));
    if (!current || !pass.characters.some((c) => c.id === current)) current = chosen ? chosen.id : pass.characters[0].id;
    const p = plan();
    const unlocked = pass.tier === 'pro' || pass.tier === 'ultimate';
    const intro = unlocked
      ? 'Pick an Animated Emote as Your Icon. It Shows in Chat, on the Leaderboard and in the Header.' + (pass.tier === 'ultimate' ? ' Legendary Emotes Are Yours as an Ultimate Member.' : ' Legendary Emotes Are for Ultimate Members.')
      : p.name + ' Pro Unlocks 4 Animated Emotes for Each Character. Ultimate Adds Legendary Emotes.' + (pass.tier ? ' Your Plus Frame Already Shows Around Your Icon.' : ' Every Plan Puts a Frame Around Your Icon.');
    panel.innerHTML = '<h3 id="cbp-title">' + esc(p.name) + ' Emotes</h3><p>' + esc(intro) + '</p>' +
      '<div class="cbp-chars" role="group" aria-label="Characters"></div><div class="cbp-emotes" role="group" aria-label="Emotes"></div>' +
      (unlocked ? '' : '<a class="cb-primary cbp-join" href="' + esc(p.path) + '">See ' + esc(p.name) + '</a>');
    const chars = panel.querySelector('.cbp-chars');
    for (const c of pass.characters) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'cbp-char';
      b.setAttribute('aria-pressed', String(c.id === current));
      b.innerHTML = '<img alt="" src="' + esc(icons[c.id + '-hype'] || '') + '" loading="lazy"><span>' + esc(c.name) + '</span>';
      b.addEventListener('click', () => { current = c.id; picker(root, data, choose); panel.querySelector('.cbp-char[aria-pressed="true"]')?.focus(); });
      chars.append(b);
    }
    const list = panel.querySelector('.cbp-emotes');
    const char = pass.characters.find((c) => c.id === current);
    for (const e of char.emotes) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'cbp-emote' + (e.ultimate ? ' is-ult' : '');
      b.disabled = !e.unlocked;
      b.setAttribute('aria-pressed', String(data.avatar.iconId === e.id));
      const lock = e.unlocked ? (e.ultimate ? 'Ultimate' : '') : e.ultimate ? 'Ultimate Only' : 'Pro and Ultimate';
      b.setAttribute('aria-label', char.name + ' ' + e.name + (e.unlocked ? '' : ', ' + lock));
      b.innerHTML = '<img alt="" src="' + esc(icons[e.id] || '') + '" loading="lazy"><span>' + esc(e.name) + '</span><small>' + esc(lock) + '</small>';
      if (e.unlocked) b.addEventListener('click', () => choose(e.id));
      list.append(b);
    }
    if (data.style) stylePanel(panel, data.style, icons);
  }

  // My Opening Style: sleeve + reveal effect. Saves straight to /api/rewards and redraws this part only.
  const ELEMENT = { card: 'Card Sparks', gold: 'Gold Coins', holo: 'Holo Prisms', fire: 'Flames', water: 'Splash', grass: 'Leaves', electric: 'Bolts', ice: 'Snowflakes', crystal: 'Crystal Shards', ghost: 'Ghost Wisps', wind: 'Gusts', dragon: 'Dragon Fire' };
  function stylePanel(panel, st, icons) {
    let box = panel.querySelector('.cbp-style');
    if (!box) { box = document.createElement('div'); box.className = 'cbp-style'; }
    panel.append(box);
    const p = plan();
    box.innerHTML = '<h3 style="margin-top:22px">My Opening Style</h3><p class="cbp-note">' + esc(st.unlocked
      ? 'Your sleeve covers each card until it prints, and your reveal effect plays behind the card. Only in your own openings, and it never changes what you pull.'
      : p.name + ' Pro and Ultimate Members Pick a Card Sleeve and Reveal Effect for Their Openings. Ultimate Adds the Gold Legendary Sleeve.') + '</p>' +
      '<h4>Card Sleeve</h4><div class="cbp-sleeves" role="group" aria-label="Card sleeve"></div>' +
      '<h4>Reveal Effect</h4><div class="cbp-fxs" role="group" aria-label="Reveal effect"></div><p class="cbp-note cbp-msg" aria-live="polite"></p>';
    const msg = box.querySelector('.cbp-msg');
    async function save(body) {
      msg.textContent = 'Saving…'; msg.classList.remove('cbp-err');
      try {
        const r = await fetch('/api/rewards', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(Object.assign({ action: 'style' }, body)) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.style) throw new Error(d.error || 'Could Not Save. Try Again.');
        stylePanel(panel, d.style, icons);
        const m = panel.querySelector('.cbp-msg'); if (m) m.textContent = 'Saved.';
      } catch (e) { msg.textContent = e.message; msg.classList.add('cbp-err'); }
    }
    const sl = box.querySelector('.cbp-sleeves');
    const opt = (id, label, inner, extra, unlocked, pressed, cls) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.disabled = !unlocked;
      b.setAttribute('aria-pressed', String(pressed)); b.innerHTML = inner;
      b.setAttribute('aria-label', label + (extra ? ', ' + extra : ''));
      return b;
    };
    const none = opt('', 'Standard', '<span class="cbp-none">None</span><span>Standard</span><small></small>', '', st.unlocked, !st.sleeve, 'cbp-sleeve');
    none.addEventListener('click', () => save({ sleeve: null })); sl.append(none);
    for (const s of st.sleeves) {
      const lock = s.unlocked ? (s.ultimate ? 'Ultimate' : '') : s.ultimate ? 'Ultimate Only' : 'Pro and Ultimate';
      const b = opt(s.id, s.name + ' sleeve', '<img alt="" src="' + esc(s.url) + '" loading="lazy"><span>' + esc(s.name) + '</span><small>' + esc(lock) + '</small>', s.unlocked ? '' : lock, s.unlocked, st.sleeve === s.id, 'cbp-sleeve' + (s.ultimate ? ' is-ult' : ''));
      if (s.unlocked) b.addEventListener('click', () => save({ sleeve: s.id }));
      sl.append(b);
    }
    const fx = box.querySelector('.cbp-fxs');
    const autoName = st.autoReveal && (st.characters.find((c) => c.id === st.autoReveal) || {}).name;
    const auto = opt('', 'Match My Icon', 'Match My Icon' + (autoName ? ' (' + esc(autoName) + ')' : ''), '', st.unlocked, st.reveal === null, 'cbp-fx');
    auto.addEventListener('click', () => save({ reveal: null })); fx.append(auto);
    for (const c of st.characters) {
      const b = opt(c.id, c.name + ' ' + (ELEMENT[c.element] || ''), '<img alt="" src="' + esc(icons[c.id + '-hype'] || '') + '" loading="lazy">' + esc(c.name) + ' · ' + esc(ELEMENT[c.element] || ''), '', st.unlocked, st.reveal === c.id, 'cbp-fx');
      b.addEventListener('click', () => save({ reveal: c.id })); fx.append(b);
    }
    const off = opt('', 'Off', 'Off', '', st.unlocked, st.reveal === 'off', 'cbp-fx');
    off.addEventListener('click', () => save({ reveal: 'off' })); fx.append(off);
  }

  window.CardbitPass = { frame, html, picker, frames: cfg.frames, framesSm: cfg.framesSm };
})();
