/* Cardbit home hero scenes v2: Signal Decode visual language for the four homepage banners (approved Nov 25 2026).
   CardbitHeroScenes.mount(slide, kind, {asset, signal, root}) -> {start, stop, restart, seek, duration, load, ready}.
   Art loads on the first start(), so only the slide on screen (and the next one, preloaded by the carousel) downloads anything.
   Latch is driven by springs (overshoot, follow-through, secondary motion on his antenna tile) instead of fixed poses. */
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, t) => { const k = clamp((t - a) / (b - a)); return k * k * (3 - 2 * k); };
  const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);
  const easeIO = k => (k = clamp(k)) < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const backOut = t => { t = clamp(t); const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const rnd = (i, k = 1) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${clamp(a)})`; };
  const CY = '#45e3ec', GOLD = '#ffb65c', BLUE = '#4aa8ff';
  const TIER = [['Common', '#f4f7ff'], ['Uncommon', '#62e987'], ['Rare', '#538fff'], ['Epic', '#b47aff'], ['Legendary', '#ff9b3c']];
  const FONT = '"Cardbit Outfit","Outfit",system-ui,sans-serif', MONO = 'ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace';
  const GLY = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&@';
  const scramble = (text, k, T) => { const n = Math.floor(clamp(k) * text.length); let s = text.slice(0, n); for (let i = n; i < text.length; i++) s += text[i] === ' ' ? ' ' : GLY[Math.floor(rnd(i, Math.floor(T * 24)) * GLY.length)]; return s; };

  /* ---------- images ---------- */
  const cache = new Map();
  function image(url) {
    if (!url) return Promise.resolve(null);
    if (!cache.has(url)) cache.set(url, new Promise(res => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => res(null); im.src = url; }));
    return cache.get(url);
  }
  const xrays = new Map();
  function xray(im) {
    if (!im) return null;
    if (xrays.has(im)) return xrays.get(im);
    let out = null;
    try {
      const w = 220, h = Math.round(w * im.height / im.width), c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0, w, h); const d = x.getImageData(0, 0, w, h), p = d.data;
      for (let i = 0; i < p.length; i += 4) { const e = Math.pow((p[i] * .3 + p[i + 1] * .59 + p[i + 2] * .11) / 255, 1.4); p[i] = 10 + e * 150; p[i + 1] = 40 + e * 215; p[i + 2] = 50 + e * 205; }
      x.putImageData(d, 0, 0); out = c;
    } catch { out = null; }
    xrays.set(im, out);
    return out;
  }

  /* ---------- springs ---------- */
  class Spring {
    constructor(v, k = 170, z = .5) { this.v = v; this.t = v; this.vel = 0; this.k = k; this.z = z; }
    step(dt) { const c = 2 * this.z * Math.sqrt(this.k), n = Math.max(1, Math.ceil(dt * 240)), h = dt / n; for (let i = 0; i < n; i++) { this.vel += (-this.k * (this.v - this.t) - c * this.vel) * h; this.v += this.vel * h; } return this.v; }
    snap(v) { this.v = this.t = v; this.vel = 0; }
  }

  /* ---------- Latch rig (traced parts of cardbit-latch-rig-cut.webp) ---------- */
  const traces = {
    shell: 'M130 140 Q130 92 166 83 Q177 79 190 79 L331 67 Q338 67 338 77 L337 113 L381 112 Q394 112 394 126 L394 372 Q395 415 368 431 Q358 438 345 438 L179 438 Q149 437 139 416 Q129 402 129 379 Z',
    tile: 'M354 55 L392 54 Q395 56 395 62 L395 92 Q395 99 391 100 L356 100 Q352 100 352 96 L353 58 Z',
    leg: 'M155 431 L225 433 L206 506 L133 505 Q132 492 139 474 Z',
    shoe: 'M128 496 Q135 493 148 494 L191 495 Q199 495 204 501 L211 507 L216 532 L217 539 Q199 545 173 544 L107 542 Q106 540 107 528 L112 516 L116 502 Z',
    upper: 'M127 237 L111 237 Q103 238 98 245 L80 261 L79 273 L86 282 L75 301 L93 316 L109 303 L116 309 L129 302 Z',
    lower: 'M61 300 Q70 300 84 305 L104 317 Q108 324 108 338 L108 366 Q108 376 101 384 L87 389 L44 391 L30 389 Q26 383 28 372 L33 348 L45 322 Q51 308 61 300 Z',
    jawA: 'M49 380 Q57 376 70 376 L72 411 Q57 413 54 421 Q54 431 63 433 L77 438 L78 458 Q77 464 70 463 Q49 460 41 451 Q29 442 29 429 Q29 414 33 398 Q38 385 49 380 Z',
    jawB: 'M72 376 Q97 375 106 388 Q116 400 114 415 L113 427 Q111 433 101 432 L96 431 Q93 430 92 419 Q86 411 73 412 Z'
  };
  let paths = null;
  const REST = [68, 380, 0, 0];
  const BASE = [112, 264], ELBOW = [86, 310], WRIST = [68, 380];
  const UPPER = Math.hypot(ELBOW[0] - BASE[0], ELBOW[1] - BASE[1]);
  const LOWER = Math.hypot(WRIST[0] - ELBOW[0], WRIST[1] - ELBOW[1]);
  const EYES = [[[173, 182], [240, 194], [240, 212], [173, 205]], [[282, 193], [352, 171], [352, 205], [282, 214]]];

  function face(g, f) {
    const grad = g.createLinearGradient(150, 0, 370, 0);
    grad.addColorStop(0, '#303237'); grad.addColorStop(1, '#25272b');
    g.save(); g.filter = 'blur(3px)'; g.fillStyle = grad; g.beginPath(); g.roundRect(158, 156, 208, 102, 22); g.fill(); g.restore();
    g.save(); g.translate((f.look || 0) * 12, (f.lookY || 0) * 8);
    g.fillStyle = '#f5faff'; g.strokeStyle = '#f5faff'; g.lineCap = 'round';
    const glow = f.glow || 0;
    if (glow) { g.shadowColor = f.glowColor || CY; g.shadowBlur = 14 * glow; }
    EYES.forEach((q, side) => {
      const cx = (q[0][0] + q[1][0]) / 2, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
      g.save();
      if (f.dizzy > .5) {
        g.lineWidth = 9; const r = 13, a = (f.spin || 0) * (side ? -1 : 1);
        g.translate(cx, cy); g.rotate(a);
        g.beginPath(); g.moveTo(-r, -r); g.lineTo(r, r); g.moveTo(r, -r); g.lineTo(-r, r); g.stroke();
      } else if (f.wow > .5) {
        g.beginPath(); g.ellipse(cx, cy, 20, 24 * Math.max(.1, f.open ?? 1), 0, 0, TAU); g.fill();
      } else if (f.happy > .5) {
        g.lineWidth = 11; g.beginPath(); g.moveTo(q[0][0] + 6, cy + 9); g.quadraticCurveTo(cx, cy - 18, q[1][0] - 6, cy + 9); g.stroke();
      } else {
        const sq = (f.open ?? 1) * (1 - (f.squint || 0) * .5);
        g.translate(cx, cy); g.scale(1, Math.max(.07, sq)); g.translate(-cx, -cy);
        g.beginPath(); q.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill();
      }
      g.restore();
    });
    g.shadowBlur = 0;
    const grin = f.grin || 0;
    if (f.wow > .5) { g.beginPath(); g.ellipse(287, 236, 10, 13, 0, 0, TAU); g.fill(); }
    else if (f.dizzy > .5) { g.lineWidth = 4.5; g.beginPath(); for (let i = 0; i <= 8; i++) g.lineTo(262 + i * 6, 236 + (i % 2 ? -4 : 4)); g.stroke(); }
    else if (grin > .05) { g.beginPath(); g.moveTo(256, 226); g.quadraticCurveTo(286, 226 + 32 * grin, 316, 222); g.quadraticCurveTo(286, 230 + 7 * grin, 256, 226); g.fill(); }
    else if (grin < -.05) { g.lineWidth = 4.5; g.beginPath(); g.moveTo(266, 240); g.quadraticCurveTo(288, 230, 308, 238); g.stroke(); }
    else { g.lineWidth = 4.5; g.beginPath(); g.moveTo(264, 241); g.quadraticCurveTo(290, 244, 310, 228); g.stroke(); }
    g.restore();
  }
  function solve(goal) {
    const dx = goal[0] - BASE[0], dy = goal[1] - BASE[1];
    const d = clamp(Math.hypot(dx, dy), Math.abs(UPPER - LOWER) + .2, UPPER + LOWER - .2);
    const dir = Math.atan2(dy, dx), angle = dir + Math.acos(clamp((UPPER * UPPER + d * d - LOWER * LOWER) / (2 * UPPER * d), -1, 1));
    const el = [BASE[0] + Math.cos(angle) * UPPER, BASE[1] + Math.sin(angle) * UPPER];
    const wr = [BASE[0] + Math.cos(dir) * d, BASE[1] + Math.sin(dir) * d];
    return { el, wr, ua: angle - Math.atan2(ELBOW[1] - BASE[1], ELBOW[0] - BASE[0]), la: Math.atan2(wr[1] - el[1], wr[0] - el[0]) - Math.atan2(WRIST[1] - ELBOW[1], WRIST[0] - ELBOW[0]), goal };
  }
  function drawRig(g, img, p) {
    paths ||= Object.fromEntries(Object.entries(traces).map(([k, v]) => [k, new Path2D(v)]));
    const s = p.h / 500, sq = p.squash || 1;
    g.save(); g.translate(p.x, p.floor); g.scale(s / Math.sqrt(sq), s * sq); g.translate(-260, -540);
    const part = k => { g.save(); g.clip(paths[k]); g.drawImage(img, 0, 0, 520, 576); g.restore(); };
    const mirrored = (side, fn) => { g.save(); if (side) { g.translate(520, 0); g.scale(-1, 1); } fn(); g.restore(); };
    const pivot = (x, y, a, fn) => { g.save(); g.translate(x, y); g.rotate(a); g.translate(-x, -y); fn(); g.restore(); };
    const tile = (k, rest, at, a) => { g.save(); g.translate(at[0], at[1]); g.rotate(a); g.translate(-rest[0], -rest[1]); part(k); g.restore(); };
    for (let side = 0; side < 2; side++) mirrored(side, () => {
      const lift = (side ? 1 : -1) * (p.step || 0);
      g.save(); g.translate(0, -Math.max(0, lift) * 16); pivot(179, 436, lift * .14, () => { part('leg'); part('shoe'); }); g.restore();
    });
    const arms = [solve(p.left || REST), solve(p.right || REST)];
    pivot(260, 430, p.lean || 0, () => {
      g.save(); g.translate(0, -(p.bob || 0));
      arms.forEach((a, side) => mirrored(side, () => tile('upper', BASE, BASE, a.ua)));
      part('shell');
      g.save(); g.translate(373, 100); g.rotate(p.tileRot || 0); g.translate(0, -(p.tileHop || 0)); g.translate(-373, -100); part('tile'); g.restore();
      face(g, p.face || {});
      arms.forEach((a, side) => mirrored(side, () => {
        g.fillStyle = '#2c323a'; g.beginPath(); g.arc(a.el[0], a.el[1], 12, 0, TAU); g.fill();
        const wa = a.goal[2] || 0, op = a.goal[3] || 0;
        const held = () => { g.save(); g.translate(a.wr[0], a.wr[1]); g.rotate(wa); g.translate(18, 52); g.rotate(-wa - (p.lean || 0) + (p.hold.tilt || 0)); p.hold.draw(g); g.restore(); };
        // A big held item (a pack) goes behind the forearm and claw; a small one (a Cardbit) goes in front of the forearm, behind the jaws.
        if (p.hold && p.hold.side === side && p.hold.behind) held();
        tile('lower', ELBOW, a.el, a.la);
        g.save(); g.translate(a.wr[0], a.wr[1]); g.rotate(wa); g.translate(-68, -380);
        g.fillStyle = '#24292c'; g.beginPath(); g.ellipse(68, 383, 28, 14, 0, 0, TAU); g.fill();
        // Held item sits in the jaw opening (about 86,430 in claw space) behind both jaws, so the pincers close over its edge.
        if (p.hold && p.hold.side === side && !p.hold.behind) { g.restore(); held(); g.save(); g.translate(a.wr[0], a.wr[1]); g.rotate(wa); g.translate(-68, -380); }
        pivot(68, 380, op, () => part('jawA')); pivot(72, 380, -op, () => part('jawB'));
        g.restore();
      }));
      g.restore();
    });
    g.restore();
  }
  // Rig point (520 space, unmirrored) to screen, honouring lean, bob and squash.
  function rigToScreen(p, rx, ry) {
    const s = p.h / 500, sq = p.squash || 1, a = p.lean || 0;
    let x = rx - 260, y = ry - 430 - (p.bob || 0);
    const c = Math.cos(a), si = Math.sin(a); const xr = x * c - y * si, yr = x * si + y * c; x = xr; y = yr + (430 - 540);
    return [p.x + x * s / Math.sqrt(sq), p.floor + y * s * sq];
  }

  /* A Latch performer: springs for arms, lean, squash, look, and a lagging antenna tile. */
  function Latch() {
    const sp = (v, k, z) => new Spring(v, k, z);
    const a = {
      sq: sp(1, 320, .28), lean: sp(0, 150, .42), tileY: sp(0, 420, .14), tileR: sp(0, 320, .13), look: sp(0, 140, .72), lookY: sp(0, 140, .72),
      arm: [0, 1].map(() => [sp(68, 160, .5), sp(380, 160, .5), sp(0, 160, .5), sp(0, 260, .55)]),
      lift: 0, step: 0, autoLook: true, face: { happy: 0, grin: .25, wow: 0, dizzy: 0, squint: 0, glow: 0 },
      _nb: 1.4, _bl: -9, _dbl: false, _sacc: 0, _pl: 0, _pvl: 0, _plean: 0, last: null, open: 1
    };
    a.arms = (L, R, k) => { [L, R].forEach((goal, s) => { if (!goal) return; a.arm[s].forEach((S, i) => { S.t = goal[i]; S.k = i === 3 ? 260 : (k || 160); }); }); };
    a.reset = () => { a.arm.forEach(arm => arm.forEach((S, i) => S.snap(REST[i]))); [a.sq].forEach(S => S.snap(1)); [a.lean, a.tileY, a.tileR, a.look, a.lookY].forEach(S => S.snap(0)); a.lift = 0; a._pl = 0; a._pvl = 0; a.step = 0; Object.assign(a.face, { happy: 0, grin: .25, wow: 0, dizzy: 0, squint: 0, glow: 0 }); a.autoLook = true; };
    a.update = (dt, T, h) => {
      if (T > a._nb) { a._bl = T; a._dbl = Math.random() < .22; a._nb = T + 2.2 + Math.random() * 3; }
      const bt = T - a._bl; let open = 1;
      if (bt >= 0 && bt < .13) open = Math.abs(bt - .065) / .065; else if (a._dbl && bt > .2 && bt < .33) open = Math.abs(bt - .265) / .065;
      a.open = Math.max(.06, open);
      if (a.autoLook && T > a._sacc) { a._sacc = T + 1.1 + Math.random() * 2.2; a.look.t = (Math.random() - .5) * .9; a.lookY.t = (Math.random() - .45) * .5; }
      // Take-off and landing feed squash and the antenna tile.
      const vl = (a.lift - a._pl) / Math.max(dt, 1e-3), al = (vl - a._pvl) / Math.max(dt, 1e-3);
      if (a._pl > 1 && a.lift <= .01) { a.sq.vel -= 2.6; a.tileY.vel -= 60; }
      else if (a._pl <= .01 && a.lift > 1) { a.sq.vel += 1.6; }
      a.tileY.vel -= clamp(al, -4000, 4000) * dt * (500 / Math.max(40, h || 200)) * .5;
      a._pl = a.lift; a._pvl = vl;
      const lv = (a.lean.v - a._plean) / Math.max(dt, 1e-3); a._plean = a.lean.v; a.tileR.vel -= clamp(lv, -12, 12) * dt * 30;
      [a.sq, a.lean, a.look, a.lookY, a.tileY, a.tileR, ...a.arm.flat()].forEach(S => S.step(dt));
      a.tileY.v = clamp(a.tileY.v, -26, 30); a.tileR.v = clamp(a.tileR.v, -.6, .6);
    };
    a.pose = (x, floor, h, T) => ({ x, floor: floor - a.lift, h, lean: a.lean.v, bob: 2.2 * Math.sin(T * 2.3), squash: a.sq.v * (1 + .012 * Math.sin(T * 2.3)), step: a.step,
      left: a.arm[0].map(S => S.v), right: a.arm[1].map(S => S.v), tileHop: a.tileY.v, tileRot: a.tileR.v,
      face: { ...a.face, open: a.open, look: a.look.v, lookY: a.lookY.v, spin: T * 9 } });
    let off = null;
    a.draw = (g, img, x, floor, h, T, o = {}) => {
      const p = a.pose(x, floor, h, T); a.last = p;
      if (!img) return p;
      const dpr = g.canvas._dpr || 1, ow = Math.ceil(h * 1.7), oh = Math.ceil(h * 1.55);
      off ||= document.createElement('canvas');
      if (off.width !== Math.ceil(ow * dpr) || off.height !== Math.ceil(oh * dpr)) { off.width = Math.ceil(ow * dpr); off.height = Math.ceil(oh * dpr); }
      const og = off.getContext('2d');
      og.setTransform(1, 0, 0, 1, 0, 0); og.clearRect(0, 0, off.width, off.height); og.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRig(og, img, { ...p, x: ow / 2, floor: oh * .93, hold: o.hold });
      if (o.holo) {
        og.globalCompositeOperation = 'source-atop';
        const hg = og.createLinearGradient(0, 0, ow, oh);
        for (let j = 0; j <= 6; j++) hg.addColorStop(j / 6, `hsla(${(T * 140 + j * 60) % 360},95%,62%,${.5 * o.holo})`);
        og.fillStyle = hg; og.fillRect(0, 0, ow, oh); og.globalCompositeOperation = 'source-over';
      }
      if (o.flash) { og.globalCompositeOperation = 'source-atop'; og.fillStyle = `rgba(255,255,255,${o.flash})`; og.fillRect(0, 0, ow, oh); og.globalCompositeOperation = 'source-over'; }
      g.save();
      if (o.alpha != null) g.globalAlpha *= o.alpha;
      if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = o.glowBlur || 22; }
      if (o.clipY != null) { g.beginPath(); g.rect(x - ow, o.clipY, ow * 2, oh * 2); g.clip(); }
      g.drawImage(off, p.x - ow / 2, p.floor - oh * .93, ow, oh);
      g.restore();
      return p;
    };
    a.hand = side => { const p = a.last; if (!p) return [0, 0]; const w = solve(side ? p.right : p.left).wr; const rx = side ? 520 - w[0] : w[0]; return rigToScreen(p, rx, w[1] + 46); };
    a.point = (rx, ry) => a.last ? rigToScreen(a.last, rx, ry) : [0, 0];
    return a;
  }
  const hop = (k, k0, d, h) => (k > k0 && k < k0 + d) ? h * 4 * ((k - k0) / d) * (1 - (k - k0) / d) : 0;

  /* ---------- particles ---------- */
  function Fx() {
    const P = [];
    const fx = {
      P,
      add(o) { if (P.length < 340) P.push(Object.assign({ k: 'spark', x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, s: 3, c: '#fff', gy: 0, drag: .94 }, o)); },
      burst(x, y, n, c, spd = 5, o = {}) { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = spd * (.25 + Math.random() * .75); fx.add(Object.assign({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: .5 + Math.random() * .7, s: 2 + Math.random() * 3, c: Math.random() < .3 ? '#fff' : c }, o)); } },
      wave(x, y, c, r1, w = 3, max = .8) { fx.add({ k: 'wave', x, y, c, r1, w, max }); },
      confetti(x, y, n, cols, spd = 8) { for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (Math.random() - .5) * 2.4, v = spd * (.4 + Math.random() * .8); fx.add({ k: 'conf', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, gy: .22, drag: .985, max: 1.6 + Math.random(), s: 4 + Math.random() * 4, c: cols[i % cols.length], r: Math.random() * 6, vr: (Math.random() - .5) * .5 }); } },
      // Bits that burst out, then home in on a target (a point or a function returning one).
      home(x, y, n, cols, target, o = {}) { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = (o.spd || 4) * (.3 + Math.random() * .9); fx.add(Object.assign({ k: 'home', x: x + (Math.random() - .5) * (o.w || 0), y: y + (Math.random() - .5) * (o.h || 0), vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: 4, out: (o.out || .22) + Math.random() * .15, s: 2 + Math.random() * 2.6, c: cols[i % cols.length], target, onArrive: o.onArrive }, o.extra || {})); } },
      step(dt) {
        const f = Math.min(3, dt * 60);
        for (let i = P.length - 1; i >= 0; i--) {
          const p = P[i]; p.life += dt;
          if (p.life >= p.max) { P.splice(i, 1); continue; }
          p.px = p.x; p.py = p.y;
          if (p.k === 'home') {
            if (p.life < p.out) { p.x += p.vx * f; p.y += p.vy * f; p.vx *= Math.pow(.9, f); p.vy *= Math.pow(.9, f); }
            else { const t = typeof p.target === 'function' ? p.target() : p.target; const dx = t[0] - p.x, dy = t[1] - p.y; p.vx = (p.vx + dx * .035 * f) * Math.pow(.8, f); p.vy = (p.vy + dy * .035 * f) * Math.pow(.8, f); p.x += p.vx * f; p.y += p.vy * f; if (Math.hypot(dx, dy) < 7) { p.onArrive?.(p); P.splice(i, 1); continue; } }
          } else if (p.k !== 'wave') { p.x += p.vx * f; p.y += p.vy * f; p.vx *= Math.pow(p.drag, f); p.vy = p.vy * Math.pow(p.drag, f) + p.gy * f; if (p.r != null) p.r += p.vr * f; }
        }
      },
      draw(g) {
        g.save();
        for (const p of P) {
          const a = 1 - p.life / p.max;
          if (p.k === 'conf') { g.globalCompositeOperation = 'source-over'; g.globalAlpha = clamp(a * 2); g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.scale(1, Math.abs(Math.cos(p.r * 1.7)) + .2); g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); g.restore(); continue; }
          g.globalCompositeOperation = 'lighter';
          if (p.k === 'wave') { const k = easeOut(p.life / p.max); g.globalAlpha = a; g.strokeStyle = p.c; g.lineWidth = p.w * a + .5; g.beginPath(); g.arc(p.x, p.y, 6 + (p.r1 - 6) * k, 0, TAU); g.stroke(); continue; }
          g.globalAlpha = p.k === 'home' ? .95 : a;
          if (p.px != null && p.k === 'home') { g.strokeStyle = p.c; g.lineWidth = p.s * .55; g.beginPath(); g.moveTo(p.px, p.py); g.lineTo(p.x, p.y); g.stroke(); }
          g.fillStyle = p.c; g.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
        }
        g.restore();
      },
      clear() { P.length = 0; }
    };
    return fx;
  }

  /* ---------- shared decode drawing ---------- */
  function glow(g, x, y, r, color, a) { if (a <= 0 || r <= 0) return; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, hexA(color, a)); gr.addColorStop(1, hexA(color, 0)); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  function floorGrid(g, W, H, y, T, color = CY, cx = W / 2) {
    g.save(); g.beginPath(); g.rect(0, y, W, H - y); g.clip();
    const fg = g.createLinearGradient(0, y, 0, H); fg.addColorStop(0, hexA(color, 0)); fg.addColorStop(1, hexA(color, .06)); g.fillStyle = fg; g.fillRect(0, y, W, H - y);
    g.strokeStyle = hexA(color, .16); g.lineWidth = 1;
    for (let i = 0; i < 7; i++) { const k = (i + (T * .35) % 1) / 7, yy = y + Math.pow(k, 2.2) * (H - y); g.globalAlpha = .25 + k * .75; g.beginPath(); g.moveTo(0, yy); g.lineTo(W, yy); g.stroke(); }
    g.globalAlpha = 1; for (let i = -14; i <= 14; i++) { g.beginPath(); g.moveTo(cx + i * W * .025, y); g.lineTo(cx + i * W * .14, H); g.stroke(); }
    g.restore();
    const line = g.createLinearGradient(0, 0, W, 0); line.addColorStop(0, hexA(color, 0)); line.addColorStop(.6, hexA(color, .5)); line.addColorStop(1, hexA(color, .1));
    g.fillStyle = line; g.fillRect(0, y - 1, W, 1.5);
  }
  function dust(g, W, H, T, n, color = '#bff7fa') { g.save(); g.fillStyle = color; for (let i = 0; i < n; i++) { const z = .3 + rnd(i, 3) * .7, y = ((rnd(i, 2) - T * .02 * z) % 1 + 1) % 1; g.globalAlpha = .06 + .16 * z * (.6 + .4 * Math.sin(T + i)); g.fillRect(rnd(i) * W, y * H, 1.6 * z, 1.6 * z); } g.restore(); }
  function shadow(g, x, y, w, a = .5) { const r = g.createRadialGradient(x, y, 0, x, y, w); r.addColorStop(0, `rgba(0,0,0,${a})`); r.addColorStop(1, 'rgba(0,0,0,0)'); g.save(); g.translate(x, y); g.scale(1, .2); g.translate(-x, -y); g.fillStyle = r; g.beginPath(); g.arc(x, y, w, 0, TAU); g.fill(); g.restore(); }
  function bay(g, x, y, rx, T, e, color = CY) {
    const ry = rx * .22;
    g.save(); g.globalCompositeOperation = 'lighter';
    const rg = g.createRadialGradient(x, y, 0, x, y, rx); rg.addColorStop(0, hexA(color, .12 + .2 * e)); rg.addColorStop(1, hexA(color, 0)); g.fillStyle = rg; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill();
    g.strokeStyle = hexA(color, .35 + .45 * e); g.lineWidth = 1.6; g.beginPath(); g.ellipse(x, y, rx * .76, ry * .76, 0, 0, TAU); g.stroke();
    g.lineWidth = 2.6; for (let i = 0; i < 36; i++) { if (i % 3 === 0) continue; const a = i / 36 * TAU + T * .5 * (1 + e * 3); g.globalAlpha = .25 + .6 * e * (i % 2 ? 1 : .5); g.beginPath(); g.ellipse(x, y, rx * .95, ry * .95, 0, a, a + .08); g.stroke(); }
    g.restore();
  }
  function beamCone(g, x, y, rx, top, a, color = CY) {
    if (a <= 0) return; g.save(); g.globalCompositeOperation = 'lighter';
    const cg = g.createLinearGradient(0, y, 0, top); cg.addColorStop(0, hexA(color, .2 * a)); cg.addColorStop(1, hexA(color, 0));
    g.fillStyle = cg; g.beginPath(); g.moveTo(x - rx * .76, y); g.lineTo(x + rx * .76, y); g.lineTo(x + rx * .5, top); g.lineTo(x - rx * .5, top); g.closePath(); g.fill(); g.restore();
  }
  function packScan(g, im, xr, x, y, h, scan, beam, o = {}) {
    if (!im) return; const w = h * im.width / im.height;
    g.save(); g.translate(x, y); g.rotate(o.rot || 0); g.scale(o.scale ?? 1, o.scale ?? 1); g.globalAlpha *= o.alpha ?? 1;
    const top = -h / 2, sy = top + h * scan;
    if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = 24; }
    if (scan < 1) { g.save(); g.beginPath(); g.rect(-w, sy, w * 2, h * 2); g.clip(); g.drawImage(im, -w / 2, top, w, h); g.restore(); }
    g.shadowBlur = 0;
    if (scan > 0) {
      g.save(); g.beginPath(); g.rect(-w, top - 4, w * 2, sy - top + 4); g.clip();
      if (xr) g.drawImage(xr, -w / 2, top, w, h); else { g.drawImage(im, -w / 2, top, w, h); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(30,160,170,.55)'; g.fillRect(-w / 2, top, w, h); }
      g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(69,227,236,.08)'; for (let yy = top; yy < sy; yy += 3) g.fillRect(-w / 2, yy, w, 1);
      g.restore();
    }
    if (o.sheen != null && scan <= 0) { const sx = mix(-w * 1.2, w * 1.2, o.sheen); const sg = g.createLinearGradient(sx - w * .3, top, sx + w * .3, -top); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(.5, 'rgba(255,255,255,.3)'); sg.addColorStop(1, 'rgba(255,255,255,0)'); g.globalCompositeOperation = 'source-atop'; g.fillStyle = sg; g.fillRect(-w / 2, top, w, h); g.globalCompositeOperation = 'source-over'; }
    if (beam && scan < 1) {
      g.globalCompositeOperation = 'lighter'; const bw = w * 1.6, bh = h * .14, N = 10;
      for (let j = 0; j < N; j++) { const al = Math.pow((j + 1) / N, 2.2) * .34, hg = g.createLinearGradient(-bw / 2, 0, bw / 2, 0); hg.addColorStop(0, 'rgba(69,227,236,0)'); hg.addColorStop(.22, `rgba(69,227,236,${al})`); hg.addColorStop(.78, `rgba(69,227,236,${al})`); hg.addColorStop(1, 'rgba(69,227,236,0)'); g.fillStyle = hg; g.fillRect(-bw / 2, sy - bh + bh * j / N, bw, bh / N + .5); }
      const lg = g.createLinearGradient(-bw / 2, 0, bw / 2, 0); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(.15, 'rgba(255,255,255,.95)'); lg.addColorStop(.85, 'rgba(255,255,255,.95)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = lg; g.fillRect(-bw / 2, sy - 1.2, bw, 2.4);
    }
    g.restore();
  }
  function core(g, x, y, r, a, color, T) {
    if (a <= 0 || r <= 0) return; const rr = r * (1 + .07 * Math.sin(T * 9));
    g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = a;
    const rg = g.createRadialGradient(x, y, 0, x, y, rr * 3.2); rg.addColorStop(0, '#fff'); rg.addColorStop(.12, hexA(color, .95)); rg.addColorStop(.4, hexA(color, .25)); rg.addColorStop(1, hexA(color, 0)); g.fillStyle = rg; g.beginPath(); g.arc(x, y, rr * 3.2, 0, TAU); g.fill();
    g.strokeStyle = hexA(color, .7); g.lineWidth = 1.4; for (let i = 0; i < 3; i++) { const an = T * 2 * (i % 2 ? -1 : 1) * (1 + i * .4) + i; g.beginPath(); g.ellipse(x, y, rr * (1.5 + i * .35), rr * (1.5 + i * .35) * .42, an, 0, Math.PI * 1.4); g.stroke(); }
    g.restore();
  }
  /* Lock ring: segs segments. colorOf(k) gives a lit segment's colour; state {locked, flicker, final, shatter, seek} */
  function ring(g, x, y, R, a, T, s, segs = 5, colorOf = k => TIER[k][1]) {
    if (a <= 0) return; const lw = Math.max(4, R * .09);
    g.save(); g.globalAlpha = a; g.strokeStyle = 'rgba(69,227,236,.32)'; g.lineWidth = 1.2;
    const ticks = segs > 8 ? 0 : 60;
    for (let i = 0; i < ticks; i++) { const an = i / ticks * TAU + T * .15, l = i % 6 === 0 ? lw * .9 : lw * .4; g.beginPath(); g.moveTo(x + Math.cos(an) * (R + lw * 1.1), y + Math.sin(an) * (R + lw * 1.1)); g.lineTo(x + Math.cos(an) * (R + lw * 1.1 + l), y + Math.sin(an) * (R + lw * 1.1 + l)); g.stroke(); }
    const gap = segs > 8 ? .05 : .07;
    for (let k = 0; k < segs; k++) {
      const a0 = -Math.PI / 2 + k * (TAU / segs) + gap, a1 = a0 + TAU / segs - gap * 2; let col = s.off || '#15323a', gl = 0;
      if (s.final) { col = s.final; gl = 1; } else if (k < s.locked) { col = colorOf(k); gl = 1; } else if (k === s.flicker && Math.floor(T * 14) % 2) { col = s.flickerColor || colorOf(k); gl = .5; }
      const sh = s.shatter || 0, ox = Math.cos((a0 + a1) / 2) * sh * R * .8, oy = Math.sin((a0 + a1) / 2) * sh * R * .8;
      g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.arc(x + ox, y + oy, R, a0, a1); g.stroke();
      if (gl) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = a * .32 * gl * (1 - sh); g.lineWidth = lw * 2.6; g.beginPath(); g.arc(x + ox, y + oy, R, a0, a1); g.stroke(); g.restore(); }
    }
    if (s.seek != null) { g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 8; i++) { g.globalAlpha = a * (1 - i / 8) * .85; g.strokeStyle = '#fff'; g.lineWidth = lw * .45; const an = s.seek - i * .05; g.beginPath(); g.arc(x, y, R - lw * .95, an - .05, an); g.stroke(); } }
    g.restore();
  }
  function rays(g, x, y, len, a, color, T, n = 14) {
    if (a <= 0) return; g.save(); g.globalCompositeOperation = 'lighter'; g.translate(x, y); g.rotate(T * .25);
    for (let i = 0; i < n; i++) { g.rotate(TAU / n); const gr = g.createLinearGradient(0, 0, len, 0); gr.addColorStop(0, color === 'holo' ? `hsla(${(T * 120 + i * 26) % 360},95%,70%,${.38 * a})` : hexA(color, .38 * a)); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.lineTo(len, -len * .06); g.lineTo(len, len * .06); g.fill(); }
    g.restore();
  }
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
  /* A card: raster prints in from the top (line 0..1), tier glow, sheen, slight 3D turn (turn -1..1). */
  function cardFace(g, im, x, y, h, o = {}) {
    const w = h * 5 / 7, line = o.line ?? 1, turn = o.turn || 0;
    g.save(); g.translate(x, y); g.rotate(o.rot || 0); g.scale(Math.cos(turn * .5), 1); g.globalAlpha *= o.alpha ?? 1;
    const color = o.color || '#fff';
    if (o.glow && line >= 1) { g.save(); g.shadowColor = color; g.shadowBlur = h * .18 * o.glow; g.fillStyle = color; rrect(g, -w / 2, -h / 2, w, h, w * .05); g.fill(); g.restore(); }
    g.save(); rrect(g, -w / 2, -h / 2, w, h, w * .05); g.clip();
    g.fillStyle = 'rgba(69,227,236,.06)'; g.fillRect(-w / 2, -h / 2, w, h);
    if (line < 1) { g.strokeStyle = 'rgba(69,227,236,.18)'; g.lineWidth = 1; for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(-w / 2 + w * i / 8, -h / 2); g.lineTo(-w / 2 + w * i / 8, h / 2); g.stroke(); } for (let i = 1; i < 11; i++) { g.beginPath(); g.moveTo(-w / 2, -h / 2 + h * i / 11); g.lineTo(w / 2, -h / 2 + h * i / 11); g.stroke(); } }
    const ly = -h / 2 + h * line;
    if (im) { g.save(); g.beginPath(); g.rect(-w / 2, -h / 2, w, ly + h / 2); g.clip(); g.drawImage(im, -w / 2, -h / 2, w, h); g.restore(); }
    if (o.sheen != null && line >= 1) { const sx = mix(-w * 1.4, w * 1.4, o.sheen % 1); const sg = g.createLinearGradient(sx - w * .35, -h / 2, sx + w * .35, h / 2); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(.42, 'rgba(255,120,240,.22)'); sg.addColorStop(.5, 'rgba(255,255,255,.55)'); sg.addColorStop(.58, 'rgba(90,240,255,.25)'); sg.addColorStop(1, 'rgba(255,255,255,0)'); g.globalCompositeOperation = 'overlay'; g.fillStyle = sg; g.fillRect(-w / 2, -h / 2, w, h); g.globalCompositeOperation = 'source-over'; }
    if (line < 1) { g.globalCompositeOperation = 'lighter'; const bg = g.createLinearGradient(0, ly - h * .08, 0, ly + 2); bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(1, hexA(color === 'holo' ? CY : color, .85)); g.fillStyle = bg; g.fillRect(-w / 2, ly - h * .08, w, h * .08 + 2); g.fillStyle = '#fff'; g.fillRect(-w / 2, ly - 1, w, 2); }
    if (o.flash) { g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(255,255,255,${o.flash})`; g.fillRect(-w / 2, -h / 2, w, h); }
    g.restore();
    g.strokeStyle = line >= 1 ? color : hexA(CY, .6); g.lineWidth = line >= 1 ? 2 : 1.2; rrect(g, -w / 2, -h / 2, w, h, w * .05); g.stroke();
    g.restore();
  }
  function label(g, text, x, y, size, color, o = {}) {
    g.save(); g.font = (o.weight || 800) + ' ' + Math.round(size) + 'px ' + (o.mono ? MONO : FONT); g.textAlign = o.align || 'center'; g.textBaseline = 'middle';
    g.globalAlpha *= o.alpha ?? 1; if (o.glow !== false) { g.shadowColor = o.shadow || color; g.shadowBlur = o.blur ?? 12; } if (o.ls) g.letterSpacing = o.ls + 'px';
    g.fillStyle = color; g.fillText(text, x, y); g.restore();
  }

  /* ---------- Cardbits token: the Cardbit B emblem as a minted tile with a cyan edge ---------- */
  let backSprite = null;
  function tokenBack(emb) {
    if (backSprite || !emb) return backSprite;
    const w = 218, h = Math.round(w * emb.height / emb.width), c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    const bg = x.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#0b2a33'); bg.addColorStop(1, '#04141a');
    x.fillStyle = bg; x.beginPath(); x.roundRect(5, 5, w - 10, h - 10, w * .16); x.fill(); x.strokeStyle = CY; x.lineWidth = 8; x.stroke();
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = BLUE; x.shadowColor = BLUE; x.shadowBlur = 16; x.font = '800 56px ' + FONT; x.fillText('10,000', w / 2, h / 2 - 10);
    x.shadowBlur = 0; x.fillStyle = '#cdeef6'; x.font = '800 23px ' + FONT; x.fillText('CARDBITS', w / 2, h / 2 + 36);
    return backSprite = c;
  }
  function token(g, emb, x, y, h, spin, o = {}) {
    if (!emb || h < 1) return;
    const w = h * emb.width / emb.height, c = Math.cos(spin), s = Math.sin(spin), sx = Math.max(.04, Math.abs(c)), th = h * (o.th || .1) * Math.abs(s), d = c * s >= 0 ? 1 : -1, rr = w * .17;
    g.save(); g.translate(x, y); if (o.rot) g.rotate(o.rot); if (o.alpha != null) g.globalAlpha *= o.alpha;
    if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = o.glowBlur || h * .35; }
    if (th > .4) { g.fillStyle = '#0d4c55'; g.beginPath(); g.roundRect(-d * th / 2 - w * sx / 2, -h / 2, w * sx, h, Math.min(rr, w * sx / 2)); g.fill(); g.fillRect(-th / 2, -h / 2 + rr * .5, th, h - rr); g.shadowBlur = 0; g.fillStyle = hexA(CY, .85); g.fillRect(-th / 2, -h / 2 + rr * .5, th, Math.max(1, h * .012)); }
    const back = c < 0 && o.back ? o.back : emb;
    g.drawImage(back, d * th / 2 - w * sx / 2, -h / 2, w * sx, h);
    g.shadowBlur = 0;
    if (o.glint) {
      g.save(); g.beginPath(); g.roundRect(d * th / 2 - w * sx / 2, -h / 2, w * sx, h, Math.min(rr, w * sx / 2)); g.clip(); g.globalCompositeOperation = 'lighter';
      const k = ((spin / Math.PI) % 2 + 2) % 2 / 2, gx = mix(-w * 1.4, w * 1.4, k);
      const gg = g.createLinearGradient(gx - w * .4, -h / 2, gx + w * .4, h / 2); gg.addColorStop(0, 'rgba(255,255,255,0)'); gg.addColorStop(.5, `rgba(200,245,255,${.5 * o.glint})`); gg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gg; g.fillRect(-w, -h, w * 2, h * 2); g.restore();
    }
    g.restore();
  }
  function flatToken(g, emb, x, y, h, a = 1) {
    if (!emb) return; const w = h * emb.width / emb.height, fh = h * .36, th = h * .09;
    g.save(); g.globalAlpha *= a; g.fillStyle = '#0d4c55'; g.beginPath(); g.roundRect(x - w / 2, y - fh / 2 + th, w, fh, w * .12); g.fill();
    g.drawImage(emb, x - w / 2, y - fh / 2, w, fh); g.restore();
  }
  function bitsLabel(g, emb, text, x, y, size, o = {}) {
    g.save(); g.font = '800 ' + Math.round(size) + 'px ' + FONT; const tw = g.measureText(text).width; g.restore();
    const ih = size * 1.05, iw = emb ? ih * emb.width / emb.height : 0, gap = size * .28, x0 = x - (iw + gap + tw) / 2;
    g.save(); g.globalAlpha *= o.alpha ?? 1; if (emb) g.drawImage(emb, x0, y - ih / 2, iw, ih); g.restore();
    label(g, text, x0 + iw + gap, y, size, BLUE, { align: 'left', alpha: o.alpha, shadow: BLUE, blur: 10 });
  }
  function sparkle(g, x, y, r, color, a = 1) {
    if (r <= 0 || a <= 0) return; g.save(); g.globalAlpha *= a; g.globalCompositeOperation = 'lighter'; g.translate(x, y); g.fillStyle = color;
    g.beginPath(); for (let i = 0; i < 8; i++) { const rr = i % 2 ? r * .22 : r, an = i * Math.PI / 4; g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); } g.closePath(); g.fill(); g.restore();
  }

  /* ================= Scene 1: Signal Decode showcase ================= */
  const PACKS = ['mystery', 'booster', 'gold', 'japanese', 'wildcard'];
  const PACK_COLORS = { mystery: '#ae76ff', booster: '#55a9ff', gold: '#e7b251', japanese: '#ff6976', wildcard: '#cc74ff' };
  const PULLS = [
    // Real cards each pack could hold, with the tier their TCGplayer market price would land in (Nov 25 2026).
    { pack: 'gold', card: 'card-gold-charizard-ex-151-199.webp', tier: 4 },       // Charizard ex SIR, 151, ~$323
    { pack: 'booster', card: 'card-booster-venusaur-ex-151-182.webp', tier: 2 },   // Venusaur ex UR, 151, ~$13
    { pack: 'japanese', card: 'latch-pikachu-173-jp.webp', tier: 3 },              // Pikachu AR 173/165, JP 151, ~$18.62
    { pack: 'mystery', card: 'card-mystery-charizard-ex-151-006.webp', tier: 1 },  // Charizard ex RR, 151, ~$8
    { pack: 'wildcard', card: 'card-wildcard-pikachu-151-025.webp', tier: 0 }      // Pikachu, 151 reverse holo, ~$0.84
  ];
  function packsScene(art, slide, opts) {
    const L = Latch(), fx = Fx(); const CYCLE = 8.6;
    let lt = 0, cyc = 0, st, T = 0, lastLay = null, shown = -1; // each time the slide comes back it plays the next pull
    const showTier = opts.tierNames !== false;
    function reset(c = 0) {
      cyc = c; lt = 0; const pull = PULLS[cyc % PULLS.length], nx = PULLS[(cyc + 1) % PULLS.length];
      [pull, nx].forEach(q => { art.img('latch-pack-' + q.pack + '.webp'); art.img(q.card); });
      st = { pull, n: pull.tier + 1, core: 0, coreA: 0, locks: 0, flicker: -1, missAt: -1, shatter: 0, revealed: false, imploded: false, released: false, exitBits: false, rel: null, pumpUntil: 0, flash: 0, formed: c === 0 ? 1 : 0 };
      st.lockStart = 2.6; st.lockStep = .34; st.lockEnd = st.lockStart + st.n * st.lockStep + (pull.tier < 4 ? .45 : 0); st.reveal = st.lockEnd + .08;
    }
    reset(0);
    function lay(W, H, ctx) {
      const m = W < 560, cL = m ? 0 : ctx.colL, cW = m ? W : ctx.colR - ctx.colL;
      return m ? { m, bx: W * .77, by: H * .55, ph: H * .32, ch: H * .4, lx: W * .5, lh: H * .3, floor: H * .975 }
        : { m, bx: cL + cW * .66, by: H * .46, ph: H * .5, ch: H * .58, lx: cL + cW * .875, lh: H * .62, floor: H * .935 };
    }
    const HOLD = [150, 392, -1.15, .12], READY = [112, 352, -.9, 0], PUMP = [96, 238, -1.45, 0], WAIT = [60, 396, .12, .24];
    function frame(g, W, H, dt, Tg, ctx) {
      T = Tg; lt += dt;
      if (lt >= CYCLE) { reset(cyc + 1); st.formed = 1; }
      const t = lt, p = st.pull, Ly = lay(W, H, ctx); lastLay = Ly;
      const tc = TIER[p.tier][1], packIm = art.img('latch-pack-' + p.pack + '.webp'), cardIm = art.img(p.card);
      const R = Ly.ch * .42;
      // ---- Latch choreography ----
      L.autoLook = false; L.face.squint = 0; L.face.glow = 0;
      let lean = 0, sqT = 1, left = HOLD, right = [100, 370, -.4, .1];
      if (t < .46) { // wind-up: pack swings up and back over his shoulder
        const k = smooth(.02, .42, t); left = [mix(150, 128, k), mix(392, 150, k), mix(-1.15, -2.3, k), .12]; right = [mix(100, 70, k), mix(370, 330, k), -.4, .2];
        lean = .1 * k; sqT = 1 - .07 * k; L.look.t = -.8; L.lookY.t = -.1; L.face.squint = .5 * k;
      } else if (t < 1.2) { // throw and follow-through
        if (!st.released) { st.released = true; st.rel = L.hand(0); L.sq.vel += 1.4; L.lean.vel -= 1.8; }
        left = t < .75 ? [-6, 300, -.2, .55] : READY; right = t < .75 ? [150, 300, -1.2, .1] : [100, 370, -.4, .1]; lean = t < .8 ? -.13 : -.03; L.look.t = -1; L.lookY.t = -.15;
      } else if (t < st.lockStart) { left = right = WAIT; lean = -.06; L.look.t = -1; L.lookY.t = 0; L.face.squint = .55; }
      else if (t < st.reveal) {
        left = right = WAIT; lean = -.08 - (T < st.pumpUntil ? .05 : 0); L.look.t = -1; L.lookY.t = -.1; L.face.squint = st.locks >= 3 ? 0 : .3;
        L.face.wow = st.locks >= 3 ? 1 : 0;
        if (st.missAt > 0 && t > st.missAt) { L.face.wow = 0; L.face.grin = -.4; lean = .03; left = right = [96, 178, -1.75, .3]; }
      } else if (t < CYCLE - 1.0) {
        const k = t - st.reveal; L.face.wow = 0; L.face.grin = .4; L.face.happy = 0; L.look.t = -.7; L.lookY.t = -.2;
        if (p.tier === 0) { left = right = k < 1.3 ? [26, 322, -.45, .45] : REST; lean = .04 * Math.sin(k * 7) * (k < 1.3 ? 1 : 0); L.face.grin = .1; L.lookY.t = .1; }
        else if (p.tier === 1) { left = (k % .5) < .26 && k < 1.6 ? PUMP : READY; right = [100, 370, -.4, .1]; L.face.happy = 1; L.face.grin = .7; }
        else if (p.tier === 2) { const c = k < 1.5 && Math.floor(k * 8) % 2; left = right = c ? [188, 316, -1.5, 0] : [158, 306, -1.15, .45]; L.face.happy = 1; L.face.grin = .9; }
        else if (p.tier === 3) { L.lift = hop(k, .05, .42, H * .07) + hop(k, .55, .42, H * .07); left = right = [70, 150 + Math.sin(T * 10) * 10, -1.3, .35]; L.face.happy = 1; L.face.grin = 1; }
        else { L.lift = hop(k, .2, .62, H * .17); const w = Math.sin(T * 11) * 14; left = [70, 150 + w, -1.3, .4]; right = [70, 150 - w, -1.3, .4]; L.face.wow = k < .35 ? 1 : 0; L.face.happy = k >= .35 ? 1 : 0; L.face.grin = 1; L.face.glow = 1; L.face.glowColor = tc; sqT = k < .2 ? .84 : 1; }
      } else { left = HOLD; right = [100, 370, -.4, .1]; L.face.happy = 0; L.face.grin = .3; L.autoLook = true; }
      if (t < st.reveal) L.lift = 0;
      if (t >= CYCLE - 1.0) L.lift = 0;
      L.arms(left, right, t > .44 && t < .6 ? 520 : 170); L.lean.t = lean; L.sq.t = sqT;
      L.update(dt, T, Ly.lh);

      // ---- world state ----
      const scanK = smooth(1.2, 2.0, t), implodeK = smooth(2.0, 2.5, t);
      if (t > 2.0 && !st.imploded) { st.imploded = true; const cols = [CY, '#fff', PACK_COLORS[p.pack]]; fx.home(Ly.bx, Ly.by, Ly.m ? 34 : 60, cols, [Ly.bx, Ly.by], { w: Ly.ph * .5, h: Ly.ph * .8, spd: 6, onArrive: () => { st.core = Math.min(1, st.core + .04); } }); fx.wave(Ly.bx, Ly.by, CY, Ly.ph * .9, 2); }
      st.coreA = t > 2.05 && t < st.reveal ? 1 : Math.max(0, st.coreA - dt * 4);
      for (let i = st.locks; i < st.n; i++) if (t > st.lockStart + i * st.lockStep) { st.locks = i + 1; st.pumpUntil = T + .14; L.sq.vel -= .7; L.tileY.vel -= 40; fx.burst(Ly.bx, Ly.by - R, 10, TIER[i][1], 3.5); fx.wave(Ly.bx, Ly.by, TIER[i][1], R * 1.25, 2, .5); }
      if (p.tier < 4 && t > st.lockStart + st.n * st.lockStep && t < st.lockEnd) st.flicker = st.n; else st.flicker = -1;
      if (p.tier < 4 && st.missAt < 0 && t > st.lockEnd - .1) st.missAt = t;
      if (!st.revealed && t > st.reveal) { st.revealed = true; st.flash = 1; fx.wave(Ly.bx, Ly.by, tc, Math.max(W, H) * .5, 4, 1); fx.burst(Ly.bx, Ly.by, p.tier >= 3 ? 46 : 24, tc, p.tier >= 3 ? 9 : 6); if (p.tier >= 3) fx.confetti(Ly.bx, Ly.by - Ly.ch * .3, p.tier === 4 ? 40 : 20, [tc, '#fff', CY, BLUE], 9); }
      st.flash = Math.max(0, st.flash - dt * 2.6); st.shatter = st.revealed ? clamp((t - st.reveal) / .5) : 0;
      if (!st.exitBits && t > CYCLE - .95) { st.exitBits = true; const nxt = PULLS[(cyc + 1) % PULLS.length]; fx.home(Ly.bx, Ly.by, Ly.m ? 26 : 44, [CY, '#fff', PACK_COLORS[nxt.pack]], () => L.hand(0), { w: Ly.ch * .5, h: Ly.ch * .8, spd: 3, out: .12 }); }
      fx.step(dt);

      // ---- draw ----
      glow(g, Ly.bx, Ly.by, Math.max(W, H) * .55, st.revealed ? tc : PACK_COLORS[p.pack], .12 + (st.revealed ? .06 : 0));
      floorGrid(g, W, H, Ly.floor, T, CY, Ly.bx); dust(g, W, H, T, Ly.m ? 18 : 36);
      const bayY = Ly.by + Ly.ph * .56;
      bay(g, Ly.bx, bayY, Math.min(W * .3, Ly.ph * .66), T, smooth(.9, 1.3, t) * (1 - smooth(st.reveal, st.reveal + .8, t) * .5));
      beamCone(g, Ly.bx, bayY, Math.min(W * .3, Ly.ph * .66), Ly.by - Ly.ph * .7, smooth(.6, 1.0, t) * (1 - implodeK));
      rays(g, Ly.bx, Ly.by, Math.max(W, H) * .7, p.tier >= 2 && st.revealed ? smooth(st.reveal, st.reveal + .3, t) * (1 - smooth(CYCLE - 1.2, CYCLE - .8, t)) * (p.tier === 4 ? 1 : .55) : 0, tc, T);
      // pack: in hand, in flight, in the bay
      if (t < 2.5 && packIm) {
        const xr = xray(packIm);
        if (t < .46 || !st.rel) { /* held: drawn in front of Latch below */ } else if (t < 1.02) {
          const k = clamp((t - .46) / .56), e = easeIO(k); const s0 = st.rel;
          const x = mix(s0[0], Ly.bx, e), y = mix(s0[1] - Ly.lh * .12, Ly.by, e) - Math.sin(k * Math.PI) * H * .22;
          packScan(g, packIm, null, x, y, mix(Ly.lh * .46, Ly.ph, e), 0, false, { rot: mix(-.6, 0, e) - (1 - e) * TAU * 1.0, glow: hexA(PACK_COLORS[p.pack], .5) });
        } else {
          const w = t - 1.02, wob = Math.exp(-6 * w) * Math.sin(w * 26) * .2, bob = Math.sin(T * 2.2) * H * .006;
          if (t < 1.08) fx.wave(Ly.bx, bayY, CY, Ly.ph * .7, 2, .5);
          packScan(g, packIm, xr, Ly.bx, Ly.by + bob - implodeK * Ly.ph * .1, Ly.ph, scanK, t > 1.2 && t < 2.0, { rot: wob, scale: 1 - implodeK, alpha: 1 - implodeK * .6, glow: hexA(PACK_COLORS[p.pack], .5), sheen: (T * .5) % 1.6 - .3 });
        }
      }
      core(g, Ly.bx, Ly.by, Ly.ch * .07 * (.4 + st.core), st.coreA, st.locks ? TIER[st.locks - 1][1] : CY, T);
      const ringA = smooth(2.3, 2.6, t) * (1 - smooth(st.reveal, st.reveal + .5, t));
      ring(g, Ly.bx, Ly.by, R, ringA, T, { locked: st.locks, flicker: st.flicker, flickerColor: st.missAt > 0 && t > st.missAt ? '#5a2a30' : null, shatter: st.shatter, seek: t > 2.55 && t < st.lockEnd ? -Math.PI / 2 + (t - 2.55) * 7 : null });
      // card
      if (st.revealed && t < CYCLE - .3) {
        const line = clamp((t - st.reveal) / .6), exit = smooth(CYCLE - 1.0, CYCLE - .4, t);
        const turn = Math.sin(T * 1.3) * .35 * (1 - exit), y = Ly.by + Math.sin(T * 2) * H * .008;
        cardFace(g, cardIm, Ly.bx, y - exit * Ly.ch * .1, Ly.ch * mix(1, .3, exit) * backOut(clamp((t - st.reveal) / .35) * .5 + .5), { line, color: tc, glow: p.tier >= 1 ? .4 + .6 * (p.tier / 4) : .25, sheen: p.tier >= 2 ? T * .4 : null, turn, alpha: 1 - exit, flash: st.flash * .8 });
        if (t > st.reveal + .35 && exit < .5) {
          const ty = y + Ly.ch * .5 + (Ly.m ? 12 : 18), k = clamp((t - st.reveal - .35) / .45);
          if (showTier) { g.save(); g.globalAlpha = 1 - exit * 2; const tw = Ly.m ? 70 : 96, th = Ly.m ? 16 : 20; g.fillStyle = tc; rrect(g, Ly.bx - tw / 2, ty - th / 2, tw, th, 4); g.fill(); g.restore(); label(g, scramble(TIER[p.tier][0].toUpperCase(), k, T), Ly.bx, ty + .5, Ly.m ? 9.5 : 11.5, '#04110f', { mono: true, glow: false, ls: 1.4, alpha: 1 - exit * 2 }); }
        }
      }
      // readout above the bay
      const ro = t < 1.2 ? 'PACK IN BAY' : t < 2.0 ? 'SCANNING' : t < 2.6 ? 'DECODING' : t < st.reveal ? 'SIGNAL LOCK ' + st.locks + '/5' : t < CYCLE - 1 ? 'DECODED' : 'NEXT PACK';
      if (!Ly.m || t > 1.0) label(g, '\u25CF ' + scramble(ro, clamp((t % 10) * 4), T), Ly.bx, Math.max(14, Ly.by - Ly.ch * .5 - (Ly.m ? 10 : 14)), Ly.m ? 9 : 10.5, CY, { mono: true, weight: 700, ls: 1.6, blur: 8, alpha: t < CYCLE - 1 || t > CYCLE - .9 ? 1 : 0 });
      // Latch
      shadow(g, Ly.lx, Ly.floor, Ly.lh * .42 * (1 - L.lift / H), .5);
      const nextPull = t > CYCLE - 1.0 ? PULLS[(cyc + 1) % PULLS.length] : (t < .46 || !st.rel) ? p : null, heldIm = nextPull && art.img('latch-pack-' + nextPull.pack + '.webp');
      const formed = t > CYCLE - 1.0 ? smooth(CYCLE - .55, CYCLE - .1, t) : 1;
      // The pack's bottom edge is pinched in his left claw (rig space, ~200 units tall), so it moves with the wrist instead of floating near it.
      const hold = heldIm ? { side: 0, behind: true, tilt: -.12, draw: c => packScan(c, heldIm, null, 0, -82, 196, 0, false, { alpha: formed, glow: hexA(PACK_COLORS[nextPull.pack], .5) }) } : null;
      L.draw(g, art.latch, Ly.lx, Ly.floor, Ly.lh, T, { glow: p.tier === 4 && st.revealed && t < CYCLE - 1 ? hexA(tc, .55) : null, glowBlur: 26, hold });
      fx.draw(g);
      if (st.flash > 0) { g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = hexA(tc, st.flash * .25); g.fillRect(0, 0, W, H); g.restore(); }
    }
    return { frame, reset: adv => { reset(shown < 0 ? 0 : adv ? shown + 1 : shown); shown = cyc; st.formed = 1; fx.clear(); L.reset(); }, duration: CYCLE, stillAt: 6.2, lay: () => lastLay };
  }

  /* ================= Scene 2: Daily giveaway (Jackpot Core) ================= */
  function nextDraw(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
    const chicagoNow = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    const offset = chicagoNow - Math.floor(now.getTime() / 1000) * 1000;
    let target = Date.UTC(+parts.year, +parts.month - 1, +parts.day, 20, 0, 0);
    if (chicagoNow >= target) target += 864e5;
    return new Date(target - offset);
  }
  function giveawayScene(art) {
    const L = Latch(), fx = Fx();
    let coins = [], flats = [], spawnAt = 0, surgeAt = 3, T = 0, flip = null, nFlip = -1, lastLay = null, stars = 0;
    const P = 4.8;
    function lay(W, H, ctx) {
      const m = W < 560, cL = m ? 0 : ctx.colL, cW = m ? W : ctx.colR - ctx.colL;
      return m ? { m, gx: W * .79, gy: H * .3, R: H * .12, lx: W * .79, lh: H * .29, floor: H * .975, x0: W * .5 }
        : { m, gx: cL + cW * .66, gy: H * .44, R: H * .24, lx: cL + cW * .885, lh: H * .56, floor: H * .935, x0: cL + cW * .38 };
    }
    function spawn(W, H, Ly, front) {
      const z = front ? .55 + Math.random() * .45 : Math.random() * .55;
      coins.push({ x: mix(Ly.x0, W, Math.random()), y: -30, z, vy: H * (.35 + .55 * z), r: H * (.016 + .03 * z) * (Ly.m ? .9 : 1), spin: Math.random() * TAU, ws: 3 + Math.random() * 6, rot: (Math.random() - .5) * .5, bounces: 0, land: Ly.floor + (z - .55) * H * .14 });
    }
    function frame(g, W, H, dt, Tg, ctx) {
      T = Tg; const Ly = lay(W, H, ctx); lastLay = Ly; const E = art.emblem, big = tokenBack(E);
      // rain
      if (T > spawnAt) { spawnAt = T + (Ly.m ? .3 : .17); spawn(W, H, Ly, Math.random() < .4); }
      if (T > surgeAt) { surgeAt = T + 6; fx.wave(Ly.gx, Ly.gy, CY, Ly.R * 2.6, 3, 1); for (let i = 0; i < (Ly.m ? 4 : 7); i++) { const a = -Math.PI / 2 + (i - 3) * .5 + (Math.random() - .5) * .3; coins.push({ x: Ly.gx, y: Ly.gy, z: .6, vx: Math.cos(a) * W * .18, vy: Math.sin(a) * H * .8, r: Ly.R * .22, spin: Math.random() * TAU, ws: 9, rot: 0, surge: true, grow: .9 + Math.random() * .6, bounces: 0, land: H * 2 }); } }
      for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i]; c.spin += c.ws * dt;
        if (c.surge) { c.age = (c.age || 0) + dt; c.x += c.vx * dt; c.vy += H * 1.6 * dt; c.y += c.vy * dt; c.r = Math.min(H * .16, c.r + c.r * c.grow * dt); if (c.age > 1.5 || c.y > H + c.r * 2 || c.x < -c.r * 2 || c.x > W + c.r * 2) coins.splice(i, 1); continue; }
        c.vy += H * .6 * dt; c.y += c.vy * dt;
        if (c.z > .55 && c.z < .85 && c.y > c.land) {
          if (c.bounces < 2) { c.y = c.land; c.vy *= -.32; c.ws *= .5; c.bounces++; fx.burst(c.x, c.land, 3, CY, 1.6, { max: .35 }); }
          else { flats.push({ x: c.x, y: c.land, r: c.r, t: T }); coins.splice(i, 1); }
        } else if (c.y > H + 40) coins.splice(i, 1);
      }
      flats = flats.filter(f => T - f.t < 2.2); if (flats.length > 40) flats.shift();
      // Held Cardbit: upright, face to camera, its bottom edge pinched in the claw (not edge-on beside it).
      const hold = () => { const hp = L.hand(0); flip.held = true; flip.x = hp[0] + flip.r * .1; flip.y = hp[1] - flip.r * .78; flip.rot = -.1 + Math.sin(T * 2.4) * .04; };
      // flip routine
      const n = Math.floor((T + 1.2) / P), kf = (T + 1.2) % P, gag = n % 2 === 1; // the second flip of every visit bonks his antenna
      if (n !== nFlip) { nFlip = n; flip = { launched: false, caught: false, bonked: false, gag, picked: false, held: false, rot: 0, r: Ly.lh * .07 }; }
      L.autoLook = false; L.face.dizzy = 0; L.face.happy = 0; L.face.wow = 0; L.face.grin = .3;
      let left = [128, 408, -1.0, -.04], right = [96, 372, -.4, .1], lean = 0, sqT = 1;
      const hpk = Ly.m ? H * .3 : H * .46, D = 1.25;
      if (kf < .38) { const k = smooth(0, .36, kf); left = [128, mix(408, 430, k), mix(-1, -.6, k), -.04]; sqT = 1 - .08 * k; lean = .03 * k; L.look.t = -.35; L.lookY.t = .45; }
      else if (!flip.launched) { flip.launched = true; flip.t0 = kf; flip.p0 = L.hand(0); L.sq.vel += 1.8; fx.burst(flip.p0[0], flip.p0[1], 6, CY, 2); }
      if (flip.launched) {
        const ft = kf - flip.t0;
        const target = gag ? L.point(373, 50) : [flip.p0[0] + (Ly.m ? 4 : 10), flip.p0[1] - Ly.lh * .12];
        if (!flip.caught && !flip.bonked) {
          const k = clamp(ft / D), y1 = target[1], y0 = flip.p0[1], dy = y1 - y0;
          const s = (Math.sqrt(2 * hpk) + Math.sqrt(Math.max(0, 2 * hpk + 2 * dy))) / D, gr = s * s, vy = -Math.sqrt(2 * gr * hpk);
          flip.x = mix(flip.p0[0], target[0], k); flip.y = y0 + vy * ft + .5 * gr * ft * ft;
          flip.spin = ft * 19; flip.r = Ly.lh * .07;
          left = ft < .28 ? [92, 250, -1.5, .38] : gag ? [120, 380, -.9, .3] : [132, 326, -1.25, .42];
          L.look.t = clamp((flip.x - Ly.lx) / (Ly.lh * .6), -1, 1); L.lookY.t = clamp((flip.y - (Ly.floor - Ly.lh * .75)) / (Ly.lh * .6), -1, .8); L.face.wow = ft > .3 && ft < D - .2 ? 1 : 0; lean = -.02 + L.lookY.v * .03;
          if (ft >= D) { if (gag) { flip.bonked = true; flip.bt = kf; L.tileY.vel -= 220; L.tileR.vel += 7; L.lean.vel += 1.6; L.sq.vel -= 1.4; fx.burst(flip.x, flip.y, 10, '#c8f4ff', 4); flip.vx = Ly.lh * 1.4; flip.vy = -Ly.lh * 2.2; flip.bx = flip.x; flip.by = flip.y; } else { flip.caught = true; flip.ct = kf; L.sq.vel -= 1.6; L.tileY.vel -= 50; fx.burst(flip.x, flip.y, 14, BLUE, 4); fx.wave(flip.x, flip.y, CY, Ly.lh * .5, 2, .5); } }
        } else if (flip.caught) {
          const k = kf - flip.ct; left = k < .5 ? [132, 326, -1.25, -.05] : [70, 150 + Math.sin(T * 10) * 8, -1.3, -.05]; right = k > .5 ? [70, 150 - Math.sin(T * 10) * 8, -1.3, .35] : right;
          L.lift = hop(k, .45, .42, H * .06); L.face.happy = 1; L.face.grin = 1; L.look.t = 0; L.lookY.t = -.2;
          hold(); flip.spin = .22 + Math.sin(T * 3) * .1;
        } else {
          const k = kf - flip.bt; L.face.dizzy = k < 1.25 ? 1 : 0; stars = k < 1.25 ? 1 - k / 1.25 : 0;
          lean = k < 1.25 ? Math.sin(k * 9) * .07 : 0;
          if (!flip.picked) {
            flip.vy += H * 3 * dt; flip.bx += flip.vx * dt; flip.by += flip.vy * dt; if (flip.by > Ly.floor - flip.r) { flip.by = Ly.floor - flip.r; flip.vy *= -.3; flip.vx *= .5; }
            flip.x = flip.bx; flip.y = flip.by; flip.spin += dt * 12;
            if (k > 1.3) { left = [58, 470, .2, .4]; right = [70, 360, -.2, .1]; lean = -.16; sqT = .9; L.look.t = 1; L.lookY.t = .8; }
            if (k > 1.75) { flip.picked = true; }
          } else { left = k < 2.3 ? [128, 400, -1.0, -.05] : [70, 150 + Math.sin(T * 10) * 8, -1.3, -.05]; L.face.happy = k > 2.1 ? 1 : 0; L.face.grin = k > 2.1 ? 1 : .2; hold(); flip.spin = .22 + Math.sin(T * 3) * .1; L.look.t = 0; L.lookY.t = -.2; }
        }
      }
      if (!(flip.caught && kf - flip.ct > .45 && kf - flip.ct < .9)) L.lift = 0;
      L.arms(left, right, flip.launched && kf - flip.t0 < .2 ? 600 : 180); L.lean.t = lean; L.sq.t = sqT;
      L.update(dt, T, Ly.lh);
      fx.step(dt);

      // ---- draw: back coins, jackpot core, floor coins, Latch, front coins ----
      glow(g, Ly.gx, Ly.gy, Math.max(W, H) * .6, BLUE, .13);
      floorGrid(g, W, H, Ly.floor, T, CY, Ly.gx); dust(g, W, H, T, Ly.m ? 14 : 30);
      const sorted = coins.filter(c => !c.surge).sort((a, b) => a.z - b.z);
      for (const c of sorted) if (c.z < .55) token(g, E, c.x, c.y, c.r * 2, c.spin, { rot: c.rot, alpha: .35 + c.z });
      // jackpot ring: 24 hour segments, lit for each hour since the last draw
      const left24 = Math.max(0, nextDraw() - Date.now()) / 36e5, lit = clamp(24 - Math.ceil(left24), 0, 23);
      const RR = Ly.R * 1.34;
      g.save(); g.globalCompositeOperation = 'lighter'; glow(g, Ly.gx, Ly.gy, Ly.R * 2.2, BLUE, .25 + .06 * Math.sin(T * 3)); g.restore();
      ring(g, Ly.gx, Ly.gy, RR, 1, T, { locked: lit, flicker: lit, flickerColor: '#a8dcff', off: '#0f2a36', seek: (T * 1.6) % TAU - Math.PI / 2 }, 24, () => BLUE);
      const spin = T * .9 + .6 * Math.sin(T * .9);
      g.save(); g.shadowColor = 'rgba(74,168,255,.6)'; g.shadowBlur = Ly.R * .5; token(g, E, Ly.gx, Ly.gy + Math.sin(T * 1.6) * H * .01, Ly.R * 1.9, spin, { back: big, glint: 1, th: .12 }); g.restore();
      for (const f of flats) flatToken(g, E, f.x, f.y, f.r * 2, 1 - smooth(1.6, 2.2, T - f.t));
      shadow(g, Ly.lx, Ly.floor, Ly.lh * .42 * (1 - L.lift / H), .5);
      const inClaw = flip.held || (!flip.launched && kf < .38), sp = flip.held ? flip.spin : .22;
      L.draw(g, art.latch, Ly.lx, Ly.floor, Ly.lh, T, inClaw ? { hold: { side: 0, tilt: -.08 + Math.sin(T * 2.4) * .04, draw: c => token(c, E, 0, 36, 76, sp, { glint: .5, th: .12 }) } } : {});
      if (flip.launched && !flip.held) token(g, E, flip.x, flip.y, flip.r * 2, flip.spin, { glint: .6, th: .14 });;
      if (stars > 0) { const hp = L.point(260, 70); for (let i = 0; i < 3; i++) { const a = T * 6 + i * TAU / 3; sparkle(g, hp[0] + Math.cos(a) * Ly.lh * .22, hp[1] + Math.sin(a) * Ly.lh * .06, Ly.lh * .05, '#c8f4ff', stars); } }
      for (const c of sorted) if (c.z >= .55) token(g, E, c.x, c.y, c.r * 2, c.spin, { rot: c.rot, glint: c.z > .85 ? .5 : 0 });
      for (const c of coins) if (c.surge) token(g, E, c.x, c.y, c.r * 2, c.spin, { glint: .7, alpha: 1 - smooth(1.0, 1.5, c.age || 0) });
      fx.draw(g);
    }
    return { frame, reset: () => { coins = []; flats = []; spawnAt = 0; surgeAt = 3; nFlip = -1; stars = 0; fx.clear(); L.reset(); }, duration: 9.6, stillAt: 3.0, lay: () => lastLay };
  }

  /* ================= Scene 3: Levels (Tier Climb) ================= */
  const LEVELS = [['Basic', 1, '#9fb3c8'], ['Bronze', 5, '#d48a4c'], ['Silver', 10, '#cfd8e3'], ['Gold', 20, '#f2c14e'], ['Cobalt', 30, '#4057f5'], ['Holo', 40, 'holo']];
  function levelsScene(art) {
    const L = Latch(), fx = Fx(); const HOP = 1.15, START = .5, N = LEVELS.length, END = START + HOP * (N - 1), CYCLE = END + 4.0;
    let lt = 0, T = 0, unlocked = 1, unlockAt = [0], beamOut = false, lastLay = null;
    const reset = () => { lt = 0; unlocked = 1; unlockAt = [0]; beamOut = false; fx.clear(); L.reset(); };
    function lay(W, H, ctx) {
      const m = W < 560, cL = m ? 0 : ctx.colL, cW = m ? W : ctx.colR - ctx.colL;
      const x0 = m ? W * .1 : cL + cW * .47, x1 = m ? W * .9 : cL + cW * .955, y0 = m ? H * .93 : H * .9, y1 = m ? H * .74 : H * .58;
      const pads = LEVELS.map((_, i) => ({ x: mix(x0, x1, i / (N - 1)), y: mix(y0, y1, Math.pow(i / (N - 1), .9)) }));
      return { m, pads, lh: m ? H * .17 : H * .27, pw: m ? W * .1 : Math.min(W * .075, 100), bo: m ? H * .26 : H * .4, br: m ? H * .045 : H * .062 };
    }
    const colOf = (c, T, j = 0) => c === 'holo' ? `hsl(${(T * 120 + j * 60) % 360},90%,65%)` : c;
    function frame(g, W, H, dt, Tg, ctx) {
      T = Tg; lt += dt; if (lt >= CYCLE) reset();
      const t = lt, Ly = lay(W, H, ctx); lastLay = Ly; const pads = Ly.pads;
      const at = clamp((t - START) / HOP, 0, N - 1), idx = Math.min(N - 2, Math.floor(at)), k = at - idx, done = t >= END;
      // Latch: charge, crouch, launch, land
      let x, floor, left = REST, right = REST, sqT = 1;
      L.autoLook = false; L.face.happy = 0; L.face.grin = .4; L.face.wow = 0; L.face.glow = 0;
      if (!done && t >= START) {
        const a = pads[idx], b = pads[idx + 1];
        if (k < .3) { x = a.x; floor = a.y; L.lift = 0; left = [96, 238 + Math.sin(T * 14) * 6, -1.45, 0]; right = [100, 360, -.6, .1]; L.look.t = .8; L.lookY.t = -.5; L.face.grin = .6; }
        else if (k < .44) { x = a.x; floor = a.y; L.lift = 0; sqT = .8; left = right = [40, 418, .35, .15]; L.look.t = .9; L.lookY.t = -.7; L.face.squint = .5; }
        else { const u = clamp((k - .44) / .48); x = mix(a.x, b.x, easeIO(u)); floor = mix(a.y, b.y, u); L.lift = u < 1 ? Math.sin(u * Math.PI) * (Ly.m ? H * .14 : H * .2) + (b.y < a.y ? 0 : 0) : 0; left = right = u < 1 ? [64, 170, -1.5, .32] : REST; sqT = u < 1 ? 1.06 : 1; L.face.squint = 0; L.face.happy = u > .2 ? 1 : 0; L.face.grin = .8; L.look.t = .5; L.lookY.t = -.3; }
        if (k >= .92) { L.lift = 0; L.face.happy = 1; }
      } else if (!done) { x = pads[0].x; floor = pads[0].y; L.lift = 0; L.autoLook = true; }
      else { x = pads[N - 1].x; floor = pads[N - 1].y; L.lift = hop(t - END, .1, .5, H * .09); const w = Math.sin(T * 11) * 12; left = [70, 150 + w, -1.3, .4]; right = [70, 150 - w, -1.3, .4]; L.face.happy = 1; L.face.grin = 1; L.face.glow = 1; L.face.glowColor = '#ffffff'; }
      L.arms(left, right, 190); L.sq.t = sqT; L.lean.t = 0; L.update(dt, T, Ly.lh);
      // unlocks when he lands
      for (let i = unlocked; i < N; i++) if (t > START + HOP * (i - 1) + HOP * .92) {
        unlocked = i + 1; unlockAt[i] = t; const p = pads[i], c = LEVELS[i][2] === 'holo' ? '#ffffff' : LEVELS[i][2], by = p.y - Ly.bo;
        fx.wave(p.x, by, c, Ly.br * 3, 3, .7); fx.burst(p.x, by, 14, c, 4); fx.burst(p.x, p.y, 8, CY, 2.5, { gy: .05 });
        if (i === N - 1) { fx.confetti(p.x, p.y - Ly.lh, Ly.m ? 26 : 50, ['#ff6ad5', '#ffd166', '#45e3ec', '#9b8cff', '#62e987'], 10); fx.wave(p.x, p.y - Ly.lh * .5, '#ffffff', Math.max(W, H) * .5, 4, 1); }
      }
      if (t > CYCLE - .9 && !beamOut) { beamOut = true; fx.home(x, floor - Ly.lh * .5, Ly.m ? 30 : 50, [CY, '#fff', '#9b8cff'], [pads[0].x, pads[0].y - Ly.lh * .5], { w: Ly.lh * .6, h: Ly.lh, spd: 2.5, out: .15 }); }
      // XP bits stream along the conduit while charging
      if (!done && t > START && k < .3 && Math.random() < dt * (Ly.m ? 22 : 40)) { const a = pads[idx], b = pads[idx + 1]; fx.home(a.x, a.y, 1, [CY, '#7cf3ff'], [b.x, b.y], { spd: 1.5, out: .05 }); }
      fx.step(dt);

      // ---- draw ----
      const fade = 1 - smooth(CYCLE - .5, CYCLE, t);
      g.save(); g.globalAlpha = fade;
      glow(g, pads[N - 1].x, pads[N - 1].y - Ly.bo * .6, Math.max(W, H) * .5, '#4057f5', .14);
      dust(g, W, H, T, Ly.m ? 16 : 32);
      // conduit
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = 'rgba(64,87,245,.22)'; g.lineWidth = Ly.m ? 5 : 7; g.beginPath(); g.moveTo(0, pads[0].y + 3); pads.forEach(p => g.lineTo(p.x, p.y + 3)); g.stroke();
      const prog = done ? N - 1 : t < START ? 0 : idx + (k < .3 ? smooth(0, .3, k) : 1);
      g.save(); g.globalCompositeOperation = 'lighter'; const fg = g.createLinearGradient(pads[0].x, 0, pads[N - 1].x, 0); fg.addColorStop(0, '#4057f5'); fg.addColorStop(1, '#7cf3ff');
      g.strokeStyle = fg; g.shadowColor = CY; g.shadowBlur = 12; g.lineWidth = Ly.m ? 4 : 5; g.beginPath(); g.moveTo(pads[0].x, pads[0].y + 3);
      for (let i = 1; i <= Math.ceil(prog) && i < N; i++) { const f = Math.min(1, prog - (i - 1)), a = pads[i - 1], b = pads[i]; g.lineTo(mix(a.x, b.x, f), mix(a.y, b.y, f) + 3); }
      g.stroke(); g.restore();
      // pads + badges
      pads.forEach((p, i) => {
        const [name, lvl, c0] = LEVELS[i], lit = i < unlocked, c = colOf(c0, T), u = lit ? t - (unlockAt[i] ?? -9) : 99;
        const pw = Ly.pw, ry = pw * .2;
        // platform: front band + top
        g.fillStyle = lit ? '#13203a' : '#10171f'; g.beginPath(); g.ellipse(p.x, p.y + 5, pw / 2, ry, 0, 0, Math.PI); g.lineTo(p.x - pw / 2, p.y); g.ellipse(p.x, p.y, pw / 2, ry, 0, Math.PI, 0, true); g.fill();
        g.fillStyle = lit ? '#1b2c52' : '#141e29'; g.beginPath(); g.ellipse(p.x, p.y, pw / 2, ry, 0, 0, TAU); g.fill();
        g.save(); if (lit) { g.globalCompositeOperation = 'lighter'; g.shadowColor = c; g.shadowBlur = 10; } g.strokeStyle = lit ? c : '#2a3542'; g.lineWidth = 1.6; g.beginPath(); g.ellipse(p.x, p.y, pw / 2 * .86, ry * .86, 0, 0, TAU); g.stroke(); g.restore();
        if (lit && u < 1.2) beamCone(g, p.x, p.y, pw / 2, p.y - Ly.bo * 1.1, 1 - u / 1.2, c0 === 'holo' ? '#ffffff' : c0);
        // badge crystal
        const by = p.y - Ly.bo + Math.sin(T * 2 + i) * 2, pop = lit ? (i === 0 ? 1 : backOut(clamp(u / .45))) : 1, br = Ly.br * (lit ? .85 + .15 * pop : .8);
        if (lit) { g.save(); g.globalCompositeOperation = 'lighter'; glow(g, p.x, by, br * 2.4, c0 === 'holo' ? '#c0a0ff' : c0, .4 + (u < .6 ? .5 * (1 - u / .6) : 0)); g.restore(); }
        g.save(); g.translate(p.x, by); g.rotate(lit ? 0 : Math.sin(T + i) * .04);
        const hex = () => { g.beginPath(); for (let j = 0; j < 6; j++) { const a = j * Math.PI / 3 - Math.PI / 2; g.lineTo(Math.cos(a) * br, Math.sin(a) * br); } g.closePath(); };
        hex();
        if (lit) { const hg = g.createLinearGradient(-br, -br, br, br); if (c0 === 'holo') for (let j = 0; j <= 6; j++) hg.addColorStop(j / 6, colOf('holo', T, j)); else { hg.addColorStop(0, '#ffffff'); hg.addColorStop(.25, c0); hg.addColorStop(1, hexA(c0 === 'holo' ? '#ffffff' : c0, .7)); } g.fillStyle = hg; g.fill();
          g.save(); g.clip(); g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.moveTo(-br, -br); g.lineTo(br, -br); g.lineTo(-br, br * .2); g.fill(); g.restore();
          hex(); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.75)'; g.stroke();
        } else { g.fillStyle = '#18222d'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#34414f'; g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]); }
        g.restore();
        label(g, String(lvl), p.x, by + 1, br * .66, lit ? '#0b1416' : '#5d6b78', { glow: false });
        // lock ring snaps shut when unlocked
        if (i > 0 && u < .5) ring(g, p.x, by, br * 1.45, 1 - u / .5, T, { locked: 6, final: c0 === 'holo' ? '#ffffff' : c0, shatter: u / .5 }, 6);
        if (!lit && i === unlocked && !done && t > START) ring(g, p.x, by, br * 1.45, .9, T, { locked: Math.floor(smooth(0, .3, k) * 6), flicker: Math.floor(smooth(0, .3, k) * 6) }, 6, () => c0 === 'holo' ? '#c0a0ff' : c0);
        label(g, name, p.x, by - br - (Ly.m ? 9 : 13), Ly.m ? 10 : 13, lit ? '#f6faf9' : '#5d6b78', { glow: lit, blur: 8, shadow: c0 === 'holo' ? '#c0a0ff' : c0 });
        if (i > 0 && u < 1.2) label(g, '+Spin', p.x + br * 1.6, by - u * 18, Ly.m ? 10 : 13, GOLD, { alpha: 1 - u / 1.2 });
      });
      // finale
      const fin = done ? t - END : -1;
      if (fin > 0) {
        const hp = pads[N - 1];
        rays(g, hp.x, hp.y - Ly.lh * .5, Math.max(W, H) * .6, smooth(0, .3, fin) * (1 - smooth(3.2, 3.8, fin)), 'holo', T, 12);
        const lk = clamp((fin - .15) / .5);
        label(g, scramble('LEVEL UP', lk, T), hp.x - Ly.lh * .7 - (Ly.m ? 0 : 10), hp.y - Ly.lh * .55, Ly.m ? 16 : 26, '#ffffff', { align: 'right', shadow: '#9b8cff', blur: 18, alpha: smooth(0, .2, fin) * (1 - smooth(3.2, 3.6, fin)) });
      }
      // Latch (beams out at the end of the cycle)
      const out = smooth(CYCLE - .95, CYCLE - .6, t);
      shadow(g, x, floor, Ly.lh * .4 * (1 - L.lift / H), .35);
      if (out < 1) L.draw(g, art.latch, x, floor, Ly.lh, T, { holo: done ? smooth(END, END + .4, t) : 0, glow: done ? 'rgba(180,160,255,.6)' : null, glowBlur: 20, alpha: 1 - out, flash: out * .8 });
      fx.draw(g);
      g.restore();
    }
    return { frame, reset, duration: CYCLE, stillAt: END + 1.6, lay: () => lastLay };
  }

  /* ================= Scene 4: How It Works (interactive) ================= */
  // Banner 4 follows one Mystery Pack pull end to end: Nidoking IR, 151 #174 (~$17.30 market, Rare in a $10 pack).
  // Sell offer = 80% buyback = 1,384 Cardbits. Retail is never shown.
  const HOW_CARD = 'card-mystery-nidoking-151-174.webp', HOW_TIER = 2, HOW_SELL = 1384;
  function howScene(art, slide) {
    const L = Latch(), fx = Fx();
    const steps = [...slide.querySelectorAll('[data-how-step]')], toggle = slide.querySelector('[data-how-toggle]');
    let active = 0, since = 0, ripped = -1, mode = 'keep', manualUntil = 0, lx = null, phase = 0, now = 0, ev = {}, lastLay = null;
    const STEP = 4.4;
    function select(i, manual, T) {
      active = (i + steps.length) % steps.length; since = T; ripped = -1; ev = {};
      if (manual) manualUntil = T + 12;
      steps.forEach((b, j) => { b.classList.toggle('is-active', j === active); b.setAttribute('aria-pressed', String(j === active)); });
      if (toggle) toggle.hidden = active !== 2;
    }
    const setMode = m => { mode = m; ev = {}; toggle?.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.mode === m))); };
    steps.forEach((b, i) => b.addEventListener('click', () => select(i, true, now)));
    toggle?.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { setMode(b.dataset.mode); since = now; manualUntil = now + 12; }));
    slide.addEventListener('click', e => { if (active === 1 && !e.target.closest('a,button') && ripped < 0) { ripped = now; manualUntil = now + 12; } });
    select(0, false, 0);
    function frame(g, W, H, dt, T, ctx) {
      now = T;
      if (ctx.first) select(0, false, T);
      if (T - since > STEP && T > manualUntil) select(active + 1, false, T);
      if (active === 2 && T > manualUntil && T - since > STEP / 2 && !ev.toggled) { ev.toggled = true; setMode(mode === 'keep' ? 'sell' : 'keep'); ev.toggled = true; }
      const m = W < 560, floor = H * (m ? .74 : .84), st = T - since;
      const xs = steps.map(b => { const r = b.getBoundingClientRect(), s = ctx.rect; return r.width ? r.left - s.left + r.width / 2 : W * .5; });
      const sx = xs[active], lh = H * (m ? .28 : .42), u = lh / 150;
      lastLay = { m };
      if (lx == null || ctx.resized) lx = Math.max(lh * .38, sx - lh * .62);
      const target = Math.max(lh * .38, sx - lh * .62), v = clamp((target - lx) * 4, -W * .7, W * .7); lx += v * dt;
      const moving = Math.min(1, Math.abs(v) / (W * .22)); phase += dt * (4 + 9 * moving);
      const ox = Math.min(sx + lh * .32, W - 50 * u), oy = floor - lh * .48;
      // Latch: walk cycle with opposite arm swing, then present the step
      const sw = Math.sin(phase) * moving;
      let left = [68 + sw * 26, 380 - Math.abs(sw) * 10, sw * .4, .05], right = [68 - sw * 26, 380 - Math.abs(sw) * 10, -sw * .4, .05];
      L.autoLook = moving < .2; L.face.happy = 0; L.face.grin = .35; L.face.wow = 0;
      const present = moving < .15 ? smooth(.1, .5, st) : 0;
      if (present > 0) { right = [mix(right[0], 36, present), mix(right[1], 255 + Math.sin(T * 3) * 6, present), mix(right[2], -1.6, present), .25 * present]; L.look.t = .9; L.lookY.t = .1; }
      L.step = sw; L.lift = Math.abs(Math.sin(phase)) * 5 * moving; L.lean.t = clamp(v / W * .5, -.15, .15);
      L.face.squint = 0;

      floorGrid(g, W, H, floor, T, CY, W * .7); dust(g, W, H, T, m ? 14 : 28);
      xs.forEach((x, i) => { g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = i === active ? 'rgba(69,227,236,.2)' : 'rgba(255,255,255,.04)'; g.beginPath(); g.ellipse(x + lh * .1, floor, lh * .55, lh * .09, 0, 0, TAU); g.fill(); g.restore(); });
      const E = art.emblem, nido = art.img(HOW_CARD), tc = TIER[HOW_TIER][1];
      if (active === 0) {
        // Cardbits drop onto a growing stack and the total counts up.
        const n = Math.min(10, Math.floor(st * 3.6));
        for (let i = 0; i < n; i++) flatToken(g, E, ox, floor - 8 * u - i * 5.5 * u, 46 * u);
        const fk = (st * 3.6) % 1; if (n < 10) token(g, E, ox + Math.sin(fk * 3) * 4 * u, mix(-40, floor - 8 * u - n * 5.5 * u - 26 * u, fk * fk), 40 * u, fk * 14, { glint: .5, th: .14 });
        if (n !== ev.n) { if (ev.n != null && n > ev.n) fx.burst(ox, floor - 8 * u - n * 5.5 * u, 6, CY, 2.4); ev.n = n; }
        bitsLabel(g, E, '+' + (n * 100).toLocaleString('en-US') + (m ? '' : ' Cardbits'), Math.min(ox + (m ? 70 : 96) * u, W - (m ? 30 : 80) * u), floor - 34 * u, 22 * u, { alpha: smooth(.2, .6, st) });
        if (n >= 10) { L.face.happy = 1; L.face.grin = .9; }
      } else if (active === 1) {
        // Tap (or wait) to open: scan, decode, print.
        const r0 = ripped >= 0 ? ripped - since : 1.5, k = st - r0, ph = 140 * u, im = art.img('latch-pack-mystery.webp'), cardIm = nido;
        bay(g, ox, floor - 4 * u, ph * .55, T, smooth(-1, 0, k) * .5 + smooth(0, .3, k) * .5);
        if (k < .95) {
          if (k > .8 && !ev.bits) { ev.bits = true; fx.home(ox, oy, m ? 22 : 34, [CY, '#fff', '#ae76ff'], [ox, oy], { w: ph * .4, h: ph * .7, spd: 4 }); }
          packScan(g, im, xray(im), ox, oy + Math.sin(T * 2) * 2, ph, smooth(0, .7, k), k > 0 && k < .7, { alpha: 1 - smooth(.75, .95, k), scale: 1 - smooth(.75, .95, k) * .8, sheen: (T * .5) % 1.6 - .3, glow: 'rgba(174,118,255,.5)' });
          if (k < 0) label(g, m ? 'Tap' : 'Tap to Open', ox, oy + ph * .62, 13 * u + 2, '#c2e9ec', { weight: 700, alpha: .6 + .4 * Math.sin(T * 5), glow: false });
        } else {
          if (!ev.reveal) { ev.reveal = true; fx.wave(ox, oy, tc, ph, 3, .8); fx.burst(ox, oy, 18, tc, 5); L.sq.vel -= 1; }
          cardFace(g, cardIm, ox, oy + Math.sin(T * 2) * 2, ph * .92, { line: clamp((k - .95) / .5), color: tc, glow: .7, sheen: T * .4, turn: Math.sin(T * 1.3) * .3 });
          left = [96, 238 + Math.sin(T * 12) * 6, -1.45, 0]; L.face.happy = 1; L.face.grin = 1;
        }
        if (k > .1 && k < .95) { L.face.squint = .5; L.look.t = .9; }
      } else if (active === 2) {
        const c = (st % (STEP / 2)) / (STEP / 2), cardIm = nido, vaultX = Math.min(sx + lh * .62, W - 46 * u), vy = floor - 36 * u, ch = 104 * u;
        if (mode === 'keep') {
          // Vault hatch opens, the card slides in, the lock ring snaps shut.
          const open = smooth(.08, .25, c) * (1 - smooth(.62, .74, c)), lockK = smooth(.74, .9, c), kc = smooth(.25, .6, c);
          g.save(); g.translate(vaultX, vy);
          g.fillStyle = '#0c1b20'; g.beginPath(); g.arc(0, 0, 40 * u, 0, TAU); g.fill();
          g.save(); g.globalCompositeOperation = 'lighter'; glow(g, 0, 0, 40 * u, CY, .35 * open); g.restore();
          g.restore();
          if (kc > 0 && kc < 1) cardFace(g, cardIm, mix(ox - 20 * u, vaultX, easeIO(kc)), mix(oy, vy, easeIO(kc)) - Math.sin(kc * Math.PI) * 40 * u, ch * mix(1, .35, kc), { color: tc, glow: .5, rot: mix(-.08, 0, kc) });
          else if (kc <= 0) cardFace(g, cardIm, ox - 20 * u, oy + Math.sin(T * 2) * 2, ch, { color: tc, glow: .5, sheen: T * .4, rot: -.08 });
          // door swings on its left hinge
          g.save(); g.translate(vaultX - 40 * u, vy); g.scale(1 - open * .85, 1); g.translate(40 * u, 0);
          const dg = g.createLinearGradient(-40 * u, -40 * u, 40 * u, 40 * u); dg.addColorStop(0, '#2a3f47'); dg.addColorStop(1, '#13232a');
          g.fillStyle = dg; g.beginPath(); g.arc(0, 0, 38 * u, 0, TAU); g.fill(); g.strokeStyle = CY; g.lineWidth = 2; g.stroke();
          g.strokeStyle = 'rgba(69,227,236,.5)'; g.lineWidth = 3 * u; for (let i = 0; i < 3; i++) { g.save(); g.rotate(i * TAU / 3 + lockK * 1.2); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -22 * u); g.stroke(); g.restore(); }
          g.restore();
          ring(g, vaultX, vy, 48 * u, .9, T, { locked: Math.floor(lockK * 6), final: lockK >= 1 ? CY : null }, 6, () => CY);
          if (lockK >= 1 && !ev.locked) { ev.locked = true; fx.wave(vaultX, vy, CY, 70 * u, 2); }
          label(g, lockK >= 1 ? 'In Your Vault' : 'Vault', vaultX, vy + 62 * u, 13 * u + 2, CY, { blur: 8 });
          if (lockK >= 1) { L.face.happy = 1; L.face.grin = .8; }
        } else {
          // The card is scanned, breaks into bits, and the bits mint into Cardbits.
          const scan = smooth(.06, .28, c), gone = c > .32;
          if (!gone) { cardFace(g, cardIm, ox, oy, ch, { color: tc, glow: .5 }); if (scan > 0) { const w = ch * 5 / 7, ly = oy - ch / 2 + ch * scan; g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(69,227,236,.18)'; g.fillRect(ox - w / 2, oy - ch / 2, w, ch * scan); g.fillStyle = '#fff'; g.fillRect(ox - w * .7, ly - 1, w * 1.4, 2); g.restore(); } }
          else if (!ev.bits) { ev.bits = true; fx.home(ox, oy, m ? 24 : 40, [BLUE, '#fff', CY], [mix(ox, vaultX, .5), oy - 20 * u], { w: ch * .7, h: ch, spd: 4 }); }
          for (let i = 0; i < 5; i++) { const f = clamp((c - .5 - i * .05) / .3); if (f <= 0 || f >= 1) continue; token(g, E, mix(mix(ox, vaultX, .5), vaultX, easeIO(f)), mix(oy - 20 * u, vy - 18 * u, f) - Math.sin(f * Math.PI) * 30 * u, 24 * u, f * 14 + i, { glint: .5 }); }
          const val = Math.round(smooth(.55, .9, c) * HOW_SELL).toLocaleString('en-US');
          bitsLabel(g, E, '+' + val + (m ? '' : ' Cardbits'), Math.min(vaultX, W - (m ? 40 : 90) * u), vy - 4 * u, 19 * u, { alpha: smooth(.45, .55, c) });
          if (c > .85) { L.face.happy = 1; L.face.grin = .9; }
        }
      } else {
        // Box it, print the label, load the van, drive.
        const k = st / STEP, drop = smooth(.04, .24, k), flap = smooth(.28, .4, k), print = smooth(.4, .52, k), stick = smooth(.52, .58, k), arrive = smooth(.44, .6, k), load = smooth(.6, .7, k), drive = smooth(.74, 1, k);
        const by = floor - 30 * u, top = -44 * u, away = drive * drive * W * .7;
        const tx = mix(ox + W * .35, ox + 6 * u, arrive) + away, bx = ox + away, lift = -40 * u * load - Math.sin(load * Math.PI) * 26 * u;
        if (arrive > 0) {
          g.save(); g.translate(tx, by); g.globalAlpha = smooth(0, .3, arrive);
          const vg = g.createLinearGradient(0, -50 * u, 0, 6 * u); vg.addColorStop(0, '#24343b'); vg.addColorStop(1, '#101a1e');
          g.fillStyle = vg; rrect(g, -66 * u, -50 * u, 112 * u, 54 * u, 8 * u); g.fill(); rrect(g, 46 * u, -34 * u, 26 * u, 38 * u, 7 * u); g.fill();
          g.fillStyle = 'rgba(160,230,240,.35)'; rrect(g, 50 * u, -30 * u, 16 * u, 14 * u, 3 * u); g.fill();
          g.fillStyle = CY; g.fillRect(-66 * u, -18 * u, 138 * u, 4 * u);
          [[-40, 6], [48, 6]].forEach(([x, y]) => { g.fillStyle = '#05090b'; g.beginPath(); g.arc(x * u, y * u, 11 * u, 0, TAU); g.fill(); g.strokeStyle = '#6b7f86'; g.lineWidth = 2 * u; g.save(); g.translate(x * u, y * u); g.rotate(-away / (11 * u)); g.beginPath(); g.moveTo(-6 * u, 0); g.lineTo(6 * u, 0); g.moveTo(0, -6 * u); g.lineTo(0, 6 * u); g.stroke(); g.restore(); });
          g.restore();
          if (drive > 0) for (let i = 0; i < 4; i++) { g.strokeStyle = `rgba(69,227,236,${(.35 - i * .07) * smooth(0, .15, drive)})`; g.lineWidth = 2; g.beginPath(); g.moveTo(tx - 72 * u - i * 16 * u, by - 22 * u + i * 8 * u); g.lineTo(tx - 110 * u - i * 16 * u, by - 22 * u + i * 8 * u); g.stroke(); }
        }
        if (flap < .25) { g.fillStyle = '#05090b'; g.fillRect(bx - 34 * u, by + top + lift - 3 * u, 68 * u, 7 * u); g.save(); g.beginPath(); g.rect(bx - 200 * u, -H, 400 * u, H + by + top + lift); g.clip(); cardFace(g, nido, bx, mix(oy - 70 * u, by + 4 * u, easeIO(drop)), 76 * u, { color: tc, glow: .4 }); g.restore(); }
        g.save(); g.translate(bx, by + lift);
        const bg2 = g.createLinearGradient(-34 * u, 0, 34 * u, 0); bg2.addColorStop(0, '#3a4f57'); bg2.addColorStop(1, '#1c2a30');
        g.fillStyle = bg2; g.fillRect(-34 * u, top, 68 * u, 48 * u); g.strokeStyle = hexA(CY, .6); g.lineWidth = 1.2; g.strokeRect(-34 * u, top, 68 * u, 48 * u); g.fillStyle = CY; g.fillRect(-34 * u, top + 34 * u, 68 * u, 3 * u);
        g.fillStyle = '#44595f';
        g.save(); g.translate(-34 * u, top); g.rotate(-Math.PI * .85 * (1 - flap)); g.fillRect(0, -3 * u, 34 * u, 6 * u); g.restore();
        g.save(); g.translate(34 * u, top); g.rotate(Math.PI * .85 * (1 - flap)); g.fillRect(-34 * u, -3 * u, 34 * u, 6 * u); g.restore();
        if (flap >= 1) { g.fillStyle = CY; g.fillRect(-4 * u, top - 2 * u, 8 * u, 48 * u * smooth(.4, .46, k)); }
        if (print > 0) { // label slides out of the printer, then sticks on
          const lxp = mix(0, -6 * u, stick), lyp = mix(top - 34 * u, top + 12 * u, easeIO(stick)), lw = 30 * u, lhh = 20 * u;
          g.save(); g.translate(lxp, lyp); g.rotate(mix(0, -.06, stick));
          g.save(); g.beginPath(); g.rect(-lw / 2, -lhh / 2, lw, lhh * print); g.clip(); g.fillStyle = '#f3f6f7'; g.fillRect(-lw / 2, -lhh / 2, lw, lhh);
          g.fillStyle = '#0b1214'; g.fillRect(-lw / 2 + 3 * u, -lhh / 2 + 3 * u, 14 * u, 2 * u); g.fillRect(-lw / 2 + 3 * u, -lhh / 2 + 7 * u, 10 * u, 2 * u); for (let i = 0; i < 10; i++) g.fillRect(-lw / 2 + 3 * u + i * 2.4 * u, 2 * u, (i % 3 ? 1 : 1.8) * u, 6 * u); g.restore();
          if (print < 1) { g.globalCompositeOperation = 'lighter'; g.fillStyle = '#fff'; g.fillRect(-lw * .65, -lhh / 2 + lhh * print - 1, lw * 1.3, 2); g.fillStyle = hexA(CY, .25); g.fillRect(-lw / 2, -lhh / 2, lw, lhh * print); }
          g.restore();
        }
        g.restore();
        if (stick >= 1 && !ev.stuck) { ev.stuck = true; fx.burst(bx, by + top + 8 * u, 6, CY, 2); }
        if (!m) label(g, 'Processed Within 48 Hours', ox + 10 * u, by + 36 * u, 12 * u + 2, '#c2e9ec', { weight: 700, glow: false, alpha: smooth(.62, .7, k) * (1 - smooth(.94, 1, k)) });
        if (drive > 0) { L.face.happy = 1; L.face.grin = .8; left = [70, 160 + Math.sin(T * 10) * 8, -1.3, .3]; }
      }
      L.arms(left, right, 190); L.update(dt, T, lh); fx.step(dt);
      shadow(g, lx, floor, lh * .42, .5);
      L.draw(g, art.latch, lx, floor, lh, T);
      fx.draw(g);
    }
    return { frame, reset: () => { select(0, false, now); fx.clear(); L.reset(); lx = null; }, duration: 17.6, stillAt: 2.5, lay: () => lastLay };
  }

  /* ---------- mounting ---------- */
  function mount(slide, kind, opts = {}) {
    const asset = opts.asset;
    const host = slide.querySelector('.cbh-scene') || slide.insertBefore(Object.assign(document.createElement('div'), { className: 'cbh-scene' }), slide.firstChild);
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true'); host.appendChild(canvas);
    const g = canvas.getContext('2d');
    // Nothing downloads until the slide is first shown (start()). Scenes ask art.img(file) for what they draw; it returns null until loaded.
    const imgs = {}; let live = false;
    const art = { latch: null, emblem: null, img(f) { if (!(f in imgs)) { if (!live) return null; imgs[f] = null; image(asset(f)).then(i => imgs[f] = i); } return imgs[f]; } };
    const pre = kind === 'packs' ? [0, 1].flatMap(i => ['latch-pack-' + PULLS[i].pack + '.webp', PULLS[i].card]) : kind === 'how' ? ['latch-pack-mystery.webp', HOW_CARD] : [];
    const scene = { packs: packsScene, giveaway: giveawayScene, levels: levelsScene, how: howScene }[kind](art, slide, opts);
    let W = 0, H = 0, raf = 0, last = 0, T = 0, running = false, first = true, resized = true, ready = false, rect = null, errored = false;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => opts.reduced ? opts.reduced() : motion.matches;
    function size() {
      const r = host.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      if (!r.width) return;
      W = r.width; H = r.height; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas._dpr = dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px'; resized = true;
      if (!running && ready) still();
    }
    function draw(dt) {
      if (!ready || !W) return;
      const dpr = canvas._dpr || 1; rect = host.getBoundingClientRect();
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const inner = slide.querySelector('.cbh-inner')?.getBoundingClientRect(); const colL = inner?.width ? inner.left - rect.left : 0, colR = inner?.width ? inner.right - rect.left : W;
      try { scene.frame(g, W, H, dt, T, { first, resized, rect, colL, colR }); } catch (e) { if (!errored) console.warn('[cardbit hero]', e); errored = true; }
      first = false; resized = false;
    }
    function frame(now) {
      raf = 0; if (!running) return;
      const dt = last ? Math.min(.05, (now - last) / 1000) : 1 / 60; last = now; T += dt; draw(dt);
      raf = requestAnimationFrame(frame);
    }
    // Reduced motion: fast-forward to a composed moment and hold it.
    function still() { if (!ready || !W) return; scene.reset(); T = 0; first = true; const step = 1 / 15; while (T < scene.stillAt) { T += step; draw(step); } }
    function start() { if (running) return; if (!ready) { want = true; load(); return; } if (reduced()) { still(); return; } running = true; last = 0; raf = requestAnimationFrame(frame); }
    function stop() { want = false; running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
    function restart() { stop(); scene.reset(true); T = 0; first = true; start(); }
    let loading = null, want = false;
    function load() {
      if (loading) return loading; live = true;
      const files = pre.map(f => image(asset(f)).then(i => imgs[f] = i));
      loading = Promise.all([image(asset('latch-rig-cut.webp')).then(i => art.latch = i), image(asset('brand-emblem.png')).then(i => art.emblem = i), ...files])
        .then(() => (document.fonts?.ready || Promise.resolve())).then(() => { ready = true; size(); if (want) { want = false; scene.reset(); T = 0; first = true; start(); } /* size() fast-forwarded a still, so begin again from frame one */ });
      return loading;
    }
    new ResizeObserver(() => size()).observe(host);
    opts.signal?.addEventListener('abort', stop);
    return { start, stop, restart, seek: (t, adv) => { stop(); scene.reset(adv); T = 0; first = true; const step = 1 / 30; while (T < t) { T += step; draw(step); } }, duration: scene.duration, load, get ready() { return ready; }, get running() { return running; } };
  }
  function drawClock(el) {
    const ms = Math.max(0, nextDraw() - Date.now());
    const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
    el.textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }
  window.CardbitHeroScenes = { mount, nextDraw, drawClock, version: 2 };
})();
