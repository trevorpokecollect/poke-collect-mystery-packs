/* Pack Pass portrait frames and the Rewards page emote picker (site only).
   window.cardbitPass = { frames, framesSm } comes from the server (app/site/play/pass-icons.ts).
   - CardbitPass.frame(node, tier): puts the member's frame around an avatar element (any size).
   - CardbitPass.html(tier, small): frame <img> markup for code that builds HTML strings (chat, header).
   - CardbitPass.picker(root, data, choose): the "Pack Pass Emotes" panel on the Rewards page. */
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
  }

  window.CardbitPass = { frame, html, picker, frames: cfg.frames, framesSm: cfg.framesSm };
})();
