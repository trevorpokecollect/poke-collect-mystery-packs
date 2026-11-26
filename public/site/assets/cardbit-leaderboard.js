/* Cardbit weekly leaderboard page. Standings come from the Mystery Packs rewards endpoint. */
(() => {
  const root = document.querySelector('[data-cb-board]');
  if (!root) return;
  const $ = (s) => root.querySelector(s);
  const iconUrls = JSON.parse(root.dataset.icons || '{}');
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const PRIZES = [5000, 3000, 2000, 1000, 1000, 500, 500, 500, 500, 500];
  const COLORS = { cobalt: ['#4057F5', '#FAF8F3'], apricot: ['#FFB65C', '#17213B'], navy: ['#17213B', '#FAF8F3'], mint: ['#3DD6A3', '#17213B'],
    berry: ['#C2417A', '#FAF8F3'], sky: ['#5FC3F2', '#17213B'], violet: ['#7A52E0', '#FAF8F3'], ember: ['#E8553B', '#FAF8F3'] };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1) && n % 10] || 'th');

  /** End of this week (next Monday 00:00 Central) as a Date. */
  function weekEnd() {
    const now = new Date();
    const c = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const offset = c.getTime() - now.getTime();
    const end = new Date(c); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + (7 - ((end.getDay() + 6) % 7)));
    return new Date(end.getTime() - offset);
  }
  let ends = weekEnd();
  function tick() {
    const s = Math.max(0, Math.floor((ends - Date.now()) / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    $('[data-lb-ends]').textContent = (d ? d + 'd ' : '') + p(h) + 'h ' + p(m) + 'm ' + p(x) + 's';
  }
  setInterval(tick, 1000); tick();

  function face(node, r) { /* SITE */ siteFace(node, r); window.CardbitPass?.frame(node, r && r.tier, { small: !node.classList.contains('cbr-pod-avatar') }); }
  function siteFace(node, r) {
    if (r && r.iconId && iconUrls[r.iconId]) { const i = new Image(); i.src = iconUrls[r.iconId]; i.alt = ''; node.append(i); node.style.background = '#17213B'; return; }
    const [bg, fg] = COLORS[r?.color] || ['#202b2e', '#b6c4c5'];
    node.style.background = bg; node.style.color = fg;
    node.textContent = r ? (r.you ? 'You' : r.name.replace(/^Collector\s*/, '').slice(0, 2)) : '?';
  }
  function render(board) {
    const top = (board && board.top) || [];
    const prizes = (board && board.prizes) || PRIZES;
    $('[data-lb-podium]').replaceChildren(...[0, 1, 2].map((i) => {
      const r = top[i];
      const a = el('article', 'is-' + (i + 1));
      if (i === 0) a.append(el('span', 'cbr-crown', '👑'));
      const av = el('div', 'cbr-pod-avatar'); face(av, r);
      const name = el('p', 'cbr-pod-name', r ? (r.you ? 'You' : r.name) : 'Open Spot');
      const score = el('p', 'cbr-pod-score'); score.append(r ? fmt(r.score) : '0', el('small', null, 'pts'));
      a.append(av, el('span', 'cbr-pod-rank', String(i + 1)), name, score, el('p', 'cbr-pod-prize', fmt(prizes[i]) + ' Cardbits'));
      return a;
    }));
    const rows = [];
    for (let i = 3; i < Math.max(10, top.length); i++) {
      const r = top[i];
      const li = el('li', r && r.you ? 'is-you' : null);
      const who = el('span', 'cbr-row-who'); const dot = el('i'); face(dot, r);
      who.append(dot, el('span', r ? null : 'cbr-open', r ? (r.you ? 'You' : r.name) : 'Open Spot'));
      const score = el('span', 'cbr-row-score'); score.append(r ? fmt(r.score) : '–', el('small', null, r ? 'pts' : ''));
      li.append(el('span', 'cbr-row-rank', '#' + (i + 1)), who, score,
        el('span', 'cbr-row-prize' + (prizes[i] ? '' : ' is-none'), prizes[i] ? fmt(prizes[i]) + ' Cardbits' : '–'));
      rows.push(li);
    }
    $('[data-lb-table]').replaceChildren(...rows);
    const you = board && board.you;
    if (root.hasAttribute('data-cb-authenticated')) {
      $('[data-lb-rank]').textContent = you ? ord(you.rank) : 'Unranked';
      $('[data-lb-points]').textContent = you ? fmt(you.score) : '0';
      $('[data-lb-prize]').textContent = you && prizes[you.rank - 1] ? fmt(prizes[you.rank - 1]) + ' Cardbits' : '–';
    }
    if (board && board.end) { ends = new Date(board.end); tick(); }
  }
  render(null);
  fetch(root.dataset.endpoint, { credentials: 'same-origin', cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((d) => { if (d && d.leaderboard) render(d.leaderboard); });
})();
