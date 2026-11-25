/* Cardbit home hero scenes: full-width canvas animations behind each banner's copy.
   Latch is drawn from cardbit-latch-rig-cut.webp, split into parts (shell, arms, claws, legs)
   using the same traced outlines as the pack opening, so he can walk, reach, jump and cheer. */
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, t) => { const k = clamp((t - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const back = t => { t = clamp(t, 0, 1); const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const rnd = (i, k = 1) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };

  /* ---------- images ---------- */
  const cache = new Map();
  function image(url) {
    if (!url) return Promise.resolve(null);
    if (!cache.has(url)) cache.set(url, new Promise(res => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => res(null); im.src = url; }));
    return cache.get(url);
  }

  /* ---------- Latch rig ---------- */
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

  function eyeShape(g, q, open, happy) {
    const cx = (q[0][0] + q[1][0]) / 2, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    g.save();
    if (happy > .5) {
      // Happy: the eye becomes an upturned arc.
      g.strokeStyle = '#f5faff'; g.lineWidth = 11; g.lineCap = 'round';
      g.beginPath(); g.moveTo(q[0][0] + 6, cy + 9); g.quadraticCurveTo(cx, cy - 16, q[1][0] - 6, cy + 9); g.stroke();
    } else {
      g.translate(cx, cy); g.scale(1, Math.max(.07, open)); g.translate(-cx, -cy);
      g.fillStyle = '#f5faff'; g.beginPath();
      q.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill();
    }
    g.restore();
  }
  function face(g, f) {
    // Paint over the drawn face with the screen colour, then draw expressive eyes and mouth.
    const grad = g.createLinearGradient(150, 0, 370, 0);
    grad.addColorStop(0, '#303237'); grad.addColorStop(1, '#25272b');
    g.save(); g.filter = 'blur(3px)'; g.fillStyle = grad;
    g.beginPath(); g.roundRect(158, 158, 208, 98, 22); g.fill(); g.restore();
    const lx = (f.look || 0) * 10, ly = (f.lookY || 0) * 6;
    g.save(); g.translate(lx, ly);
    EYES.forEach(q => eyeShape(g, q, f.open ?? 1, f.happy || 0));
    g.strokeStyle = '#f4faff'; g.fillStyle = '#f4faff'; g.lineCap = 'round';
    const grin = f.grin || 0;
    if (grin > .05) {
      g.beginPath(); g.moveTo(258, 226); g.quadraticCurveTo(286, 226 + 30 * grin, 314, 222); g.quadraticCurveTo(286, 230 + 6 * grin, 258, 226); g.fill();
    } else {
      g.lineWidth = 4.5; g.beginPath(); g.moveTo(264, 241); g.quadraticCurveTo(290, 244, 310, 228); g.stroke();
    }
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
  /* pose: x, floor, h (px height of Latch), lean, bob, step, squash, left/right [x,y,wristAngle,open] in rig units, face {...} */
  function drawLatch(g, img, p) {
    if (!img) return;
    paths ||= Object.fromEntries(Object.entries(traces).map(([k, v]) => [k, new Path2D(v)]));
    const s = p.h / 500, sq = p.squash || 1;
    g.save(); g.translate(p.x, p.floor); g.scale(s / Math.sqrt(sq), s * sq); g.translate(-260, -540);
    const part = k => { g.save(); g.clip(paths[k]); g.drawImage(img, 0, 0, 520, 576); g.restore(); };
    const mirrored = (side, fn) => { g.save(); if (side) { g.translate(520, 0); g.scale(-1, 1); } fn(); g.restore(); };
    const pivot = (x, y, a, fn) => { g.save(); g.translate(x, y); g.rotate(a); g.translate(-x, -y); fn(); g.restore(); };
    const tile = (k, rest, at, a) => { g.save(); g.translate(at[0], at[1]); g.rotate(a); g.translate(-rest[0], -rest[1]); part(k); g.restore(); };
    for (let side = 0; side < 2; side++) mirrored(side, () => {
      const lift = (side ? 1 : -1) * (p.step || 0);
      g.save(); g.translate(0, -Math.max(0, lift) * 14); pivot(179, 436, lift * .12, () => { part('leg'); part('shoe'); }); g.restore();
    });
    const arms = [solve(p.left || REST), solve(p.right || REST)];
    arms.forEach((a, side) => mirrored(side, () => tile('upper', BASE, BASE, a.ua)));
    pivot(260, 425, p.lean || 0, () => {
      g.save(); g.translate(0, -(p.bob || 0));
      part('shell');
      g.save(); g.translate(0, -(p.tileHop || 0)); part('tile'); g.restore();
      face(g, p.face || {});
      g.restore();
    });
    arms.forEach((a, side) => mirrored(side, () => {
      g.fillStyle = '#2c323a'; g.beginPath(); g.arc(a.el[0], a.el[1], 12, 0, TAU); g.fill();
      tile('lower', ELBOW, a.el, a.la);
      const wa = a.goal[2] || 0, op = a.goal[3] || 0;
      g.save(); g.translate(a.wr[0], a.wr[1]); g.rotate(wa); g.translate(-68, -380);
      g.fillStyle = '#24292c'; g.beginPath(); g.ellipse(68, 383, 28, 14, 0, 0, TAU); g.fill();
      pivot(68, 380, op, () => part('jawA')); pivot(72, 380, -op, () => part('jawB'));
      g.restore();
    }));
    g.restore();
  }
  // Rig point (520-space, left side) to canvas px, for attaching held objects to a claw.
  function handPoint(p, side, goal) {
    const s = p.h / 500, sq = p.squash || 1;
    const gx = side ? 520 - goal[0] : goal[0], gy = goal[1] + 40;
    return [p.x + (gx - 260) * s / Math.sqrt(sq), p.floor + (gy - 540) * s * sq];
  }
  function shadow(g, x, y, w, a = .45) {
    const r = g.createRadialGradient(x, y, 0, x, y, w);
    r.addColorStop(0, 'rgba(0,0,0,' + a + ')'); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.save(); g.translate(x, y); g.scale(1, .22); g.translate(-x, -y); g.fillStyle = r; g.beginPath(); g.arc(x, y, w, 0, TAU); g.fill(); g.restore();
  }
  function blinkAt(t, seed = 0) { const c = (t + seed) % 3.7; return c < .12 ? Math.abs(c - .06) / .06 : 1; }
  function idle(t) { return { bob: 3 * Math.sin(t * 2.4), lean: .02 * Math.sin(t * 1.2) }; }

  /* ---------- shared drawing ---------- */
  function glow(g, x, y, r, color, a) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(color, a)); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function floorGrid(g, W, H, y, t, color = '#00e6e1') {
    g.save();
    const fade = g.createLinearGradient(0, y, 0, H);
    fade.addColorStop(0, rgba(color, .22)); fade.addColorStop(1, rgba(color, 0));
    g.strokeStyle = fade; g.lineWidth = 1;
    for (let i = -12; i <= 12; i++) { g.beginPath(); g.moveTo(W / 2 + i * W * .05, y); g.lineTo(W / 2 + i * W * .16, H); g.stroke(); }
    for (let k = 0; k < 5; k++) { const yy = y + Math.pow((k + (t * .4) % 1) / 5, 1.8) * (H - y); g.globalAlpha = .7; g.beginPath(); g.moveTo(0, yy); g.lineTo(W, yy); g.stroke(); }
    g.globalAlpha = 1;
    const line = g.createLinearGradient(0, 0, W, 0);
    line.addColorStop(0, rgba(color, 0)); line.addColorStop(.5, rgba(color, .55)); line.addColorStop(1, rgba(color, 0));
    g.fillStyle = line; g.fillRect(0, y - 1, W, 2);
    g.restore();
  }
  function sparkle(g, x, y, r, color, a = 1) {
    g.save(); g.globalAlpha *= a; g.translate(x, y); g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i < 8; i++) { const rr = i % 2 ? r * .28 : r; const an = i * Math.PI / 4; g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); }
    g.closePath(); g.fill(); g.restore();
  }
  function coin(g, x, y, r, spin, emblem) {
    const sx = Math.max(.12, Math.abs(Math.cos(spin)));
    g.save(); g.translate(x, y); g.scale(sx, 1);
    const edge = g.createLinearGradient(-r, -r, r, r); edge.addColorStop(0, '#ffe08a'); edge.addColorStop(1, '#c9821f');
    g.fillStyle = edge; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    const face = g.createRadialGradient(-r * .3, -r * .35, r * .1, 0, 0, r * .9); face.addColorStop(0, '#fff3c4'); face.addColorStop(.6, '#ffc34d'); face.addColorStop(1, '#e3961f');
    g.fillStyle = face; g.beginPath(); g.arc(0, 0, r * .82, 0, TAU); g.fill();
    if (emblem && sx > .35) { const h = r * 1.05, w = h * 109 / 128; g.globalAlpha = sx; g.drawImage(emblem, -w / 2, -h / 2, w, h); }
    g.restore();
  }
  function flatCoin(g, x, y, r) {
    g.save(); g.translate(x, y);
    g.fillStyle = '#b8741c'; g.beginPath(); g.ellipse(0, 4, r, r * .34, 0, 0, TAU); g.fill(); g.fillRect(-r, 0, r * 2, 4);
    const f = g.createLinearGradient(-r, 0, r, 0); f.addColorStop(0, '#ffe08a'); f.addColorStop(.5, '#ffc34d'); f.addColorStop(1, '#e3961f');
    g.fillStyle = f; g.beginPath(); g.ellipse(0, 0, r, r * .34, 0, 0, TAU); g.fill();
    g.strokeStyle = '#fff3c4aa'; g.lineWidth = 1; g.beginPath(); g.ellipse(0, 0, r * .72, r * .22, 0, 0, TAU); g.stroke();
    g.restore();
  }
  function card(g, img, x, y, h, rot, opts = {}) {
    const w = h * 451 / 620;
    g.save(); g.translate(x, y); g.rotate(rot); g.scale(opts.flip ?? 1, 1);
    g.shadowColor = opts.glow || 'rgba(0,0,0,.5)'; g.shadowBlur = opts.glow ? 26 : 14;
    g.fillStyle = '#0d1417'; g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, h * .045); g.fill();
    g.shadowBlur = 0;
    if (opts.backside) {
      const b = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2); b.addColorStop(0, '#1b3a8a'); b.addColorStop(1, '#0d1f4a');
      g.fillStyle = b; g.beginPath(); g.roundRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, h * .04); g.fill();
      if (opts.emblem) { const eh = h * .3; g.drawImage(opts.emblem, -eh * 109 / 256, -eh / 2, eh * 109 / 128, eh); }
    } else if (img) {
      g.save(); g.beginPath(); g.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, h * .04); g.clip();
      g.drawImage(img, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
      if (opts.holo) {
        const k = opts.holo; const hx = mix(-w, w, k);
        const hg = g.createLinearGradient(hx - w * .5, -h / 2, hx + w * .5, h / 2);
        hg.addColorStop(0, 'rgba(255,255,255,0)'); hg.addColorStop(.35, 'rgba(255,120,240,.35)'); hg.addColorStop(.5, 'rgba(255,255,255,.7)'); hg.addColorStop(.65, 'rgba(90,240,255,.35)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
        g.globalCompositeOperation = 'screen'; g.fillStyle = hg; g.fillRect(-w / 2, -h / 2, w, h);
      }
      g.restore();
    }
    g.restore();
  }
  function pack(g, img, x, y, h, rot, opts = {}) {
    if (!img) return;
    const w = h * 842 / 1520;
    g.save(); g.translate(x, y); g.rotate(rot);
    if (opts.skew) g.transform(1, 0, opts.skew, 1, 0, 0);
    g.globalAlpha *= opts.alpha ?? 1;
    if (opts.glow) { g.shadowColor = opts.glow; g.shadowBlur = 24; }
    if (opts.clipTop != null) { g.beginPath(); g.rect(-w, -h / 2 + opts.clipTop * h, w * 2, h * 2); g.clip(); }
    g.drawImage(img, -w / 2, -h / 2, w, h);
    g.shadowBlur = 0;
    if (opts.sheen != null) {
      const sx = mix(-w * 1.2, w * 1.2, opts.sheen);
      const sg = g.createLinearGradient(sx - w * .3, -h / 2, sx + w * .3, h / 2);
      sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(.5, 'rgba(255,255,255,.32)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalCompositeOperation = 'source-atop'; g.fillStyle = sg; g.fillRect(-w / 2, -h / 2, w, h);
    }
    g.restore();
  }

  /* ---------- scenes ---------- */
  const PACKS = ['mystery', 'booster', 'gold', 'japanese', 'wildcard'];
  const PACK_COLORS = { mystery: '#ae76ff', booster: '#55a9ff', gold: '#e7b251', japanese: '#ff6976', wildcard: '#cc74ff' };
  const CARDS = ['latch-pilot-50938395361442.webp', 'latch-aipom-026.webp', 'latch-pikachu-173-jp.webp', 'latch-clefairy-184.webp', 'latch-slowking-014.webp'];
  const TIERS = [['Basic', 1, '#9fb3c8'], ['Bronze', 5, '#d48a4c'], ['Silver', 10, '#cfd8e3'], ['Gold', 20, '#f2c14e'], ['Cobalt', 30, '#4057f5'], ['Holo', 40, 'holo']];

  function packsScene(art) {
    const CYCLE = 9;
    let grabbed = -1, grabCycle = -1;
    return (g, W, H, T, ctx) => {
      const t = T % CYCLE, cyc = Math.floor(T / CYCLE);
      const floor = H * .9, mobile = W < 640;
      const lx = W * (mobile ? .74 : .8), lh = H * (mobile ? .42 : .66);
      floorGrid(g, W, H, floor, T);
      glow(g, lx, H * .55, H * .7, '#00e6e1', .12);
      // Conveyor: packs glide left to right across the whole bar.
      const ph = H * (mobile ? .34 : .42), gap = ph * .82, speed = W * .06;
      const span = W + gap * 2, count = Math.ceil(span / gap) + 1;
      const beltY = floor - ph / 2 - 6;
      const reachAt = 2.2, liftAt = 3.0, tearAt = 4.4;
      if (grabCycle !== cyc && t > reachAt) {
        // Pick the pack closest to Latch when he reaches out.
        let best = -1, bd = 1e9;
        for (let i = 0; i < count; i++) { const x = ((T * speed + i * gap) % span) - gap; if (Math.abs(x - lx) < bd) { bd = Math.abs(x - lx); best = i; } }
        grabbed = best; grabCycle = cyc;
      }
      for (let i = 0; i < count; i++) {
        const x = ((T * speed + i * gap) % span) - gap;
        if (i === grabbed && grabCycle === cyc && x > lx - gap * .6) continue;
        const kind = PACKS[i % PACKS.length];
        const hover = ctx.pointer && Math.abs(ctx.pointer.x - x) < ph * .3 && Math.abs(ctx.pointer.y - beltY) < ph * .55;
        const bobY = Math.sin(T * 2 + i) * 3;
        g.save(); g.globalAlpha = .95;
        pack(g, art.packs[kind], x, beltY + bobY - (hover ? 8 : 0), ph * (hover ? 1.06 : 1), Math.sin(T * 1.3 + i) * .03 + (hover ? (ctx.pointer.x - x) / ph * .25 : 0),
          { sheen: ((T * .35 + i * .21) % 1.6) - .3, glow: hover ? rgba(PACK_COLORS[kind], .8) : rgba(PACK_COLORS[kind], .25) });
        g.restore();
      }
      // Latch reaches, lifts, tears, then the cards fan out.
      const reach = smooth(reachAt, liftAt, t) * (1 - smooth(tearAt + .2, tearAt + .6, t));
      const lift = smooth(liftAt, liftAt + .7, t);
      const shake = t > liftAt + .7 && t < tearAt ? Math.sin(t * 60) * 4 * smooth(liftAt + .7, tearAt, t) : 0;
      const cheer = smooth(tearAt + .3, tearAt + .7, t) * (1 - smooth(CYCLE - 1.6, CYCLE - .8, t));
      const id = idle(T);
      const holdY = mix(470, 330, lift), holdX = mix(40, 150, lift);
      const armGoal = [mix(68, holdX, reach), mix(380, holdY, reach), mix(0, -.9, reach), mix(.1, -.2, reach)];
      const up = [70, 150, -1.3, .35];
      const goal = cheer > 0 ? [mix(armGoal[0], up[0], cheer), mix(armGoal[1], up[1] + Math.sin(T * 9) * 10, cheer), mix(armGoal[2], up[2], cheer), up[3]] : armGoal;
      const hop = cheer * Math.abs(Math.sin((t - tearAt) * 6)) * H * .05;
      const pose = { x: lx + shake * .3, floor: floor - hop, h: lh, bob: id.bob, lean: id.lean - reach * .05 * (1 - lift), squash: 1 + (hop ? 0 : 0), left: goal, right: goal,
        face: { open: blinkAt(T), happy: cheer > .4 ? 1 : 0, grin: cheer, look: reach && !lift ? -.6 : 0 } };
      shadow(g, lx, floor, lh * .45);
      drawLatch(g, art.latch, pose);
      // Pack held in both claws, then torn.
      if (grabCycle === cyc && t > reachAt + .45 && t < tearAt + .9) {
        const kind = PACKS[grabbed % PACKS.length];
        const hp = [lx + shake, floor - lh * mix(.06, .42, lift) - hop];
        const tear = smooth(tearAt, tearAt + .35, t);
        const hold = ph * mix(.95, .82, lift);
        if (tear < 1) pack(g, art.packs[kind], hp[0], hp[1], hold, shake * .01, { clipTop: tear * .14, alpha: 1 - smooth(tearAt + .3, tearAt + .9, t), glow: rgba(PACK_COLORS[kind], .6) });
        if (t > tearAt) {
          // Torn strip flies off.
          const k = (t - tearAt) / .9;
          g.save(); g.globalAlpha = 1 - k; g.translate(hp[0] + k * 90, hp[1] - hold * .43 - k * 70 + k * k * 120); g.rotate(k * 3);
          g.fillStyle = rgba(PACK_COLORS[kind], .9); g.fillRect(-hold * .28, -5, hold * .56, 10); g.restore();
          glow(g, hp[0], hp[1] - hold * .3, hold * (1.2 - k * .5), '#ffffff', .5 * (1 - k));
        }
      }
      // Cards fan out behind the headline.
      if (t > tearAt) {
        const fan = W * (mobile ? .55 : .5), fy = H * .48, ch = H * (mobile ? .36 : .5);
        const out = smooth(tearAt, CYCLE - 1, t), gone = smooth(CYCLE - 1.2, CYCLE - .2, t);
        const src = [lx, floor - lh * .55];
        CARDS.forEach((name, i) => {
          const k = back(clamp((t - tearAt - i * .12) / .7, 0, 1));
          const tx = fan + (i - 2) * ch * .52, ty = fy + Math.abs(i - 2) * ch * .07, rot = (i - 2) * .12;
          const x = mix(src[0], tx, k), y = mix(src[1], ty, k) - Math.sin(k * Math.PI) * H * .12;
          const flip = Math.cos(clamp((t - tearAt - .5 - i * .12) / .35, 0, 1) * Math.PI);
          const legendary = i === 4;
          g.save(); g.globalAlpha = (1 - gone) * (mobile ? .7 : .8);
          if (legendary && flip < 0) glow(g, x, y, ch * .9, '#ffb65c', .35 + .15 * Math.sin(T * 6));
          card(g, art.cards[name], x, y, ch * mix(.35, 1, k), rot * k, { flip: Math.abs(flip), backside: flip > 0, emblem: art.emblem,
            holo: legendary && flip < 0 ? (t - tearAt - 1.1) % 1.4 / 1.4 : 0, glow: legendary && flip < 0 ? 'rgba(255,182,92,.9)' : null });
          g.restore();
        });
        void out;
      }
    };
  }

  function nextDraw(now = new Date()) {
    // Next 8:00 PM America/Chicago, as a Date.
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
    const chicagoNow = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    const offset = chicagoNow - Math.floor(now.getTime() / 1000) * 1000;
    let target = Date.UTC(+parts.year, +parts.month - 1, +parts.day, 20, 0, 0);
    if (chicagoNow >= target) target += 864e5;
    return new Date(target - offset);
  }

  function giveawayScene(art) {
    const coins = [];
    let lx = null, vx = 0, fill = 0, burst = -10, pops = [], last = 0, spawnAt = 0, phase = 0;
    return (g, W, H, T, ctx) => {
      const dt = clamp(T - last, 0, .05); last = T;
      const floor = H * .9, mobile = W < 640, lh = H * (mobile ? .46 : .6);
      const minX = W * (mobile ? .66 : .56), maxX = W * .92;
      if (lx == null || ctx.resized) lx = W * .78;
      floorGrid(g, W, H, floor, T, '#ffb65c');
      glow(g, W * .7, H * .2, H * .9, '#ffb65c', .1);
      // Spawn coins across the full width.
      if (T > spawnAt) {
        spawnAt = T + (mobile ? .22 : .14);
        const near = coins.length % 3 === 0;
        coins.push({ x: near ? mix(minX, maxX, Math.random()) : Math.random() * W, y: -20, v: H * (.45 + Math.random() * .35), r: H * (.028 + Math.random() * .03), s: Math.random() * TAU, w: 4 + Math.random() * 5, z: Math.random() });
      }
      const bucketY = floor - lh * .3, bw = lh * .34;
      // Latch heads for the coin that will reach the bucket soonest within his range.
      let target = null, best = 1e9;
      for (const c of coins) { if (c.x < minX || c.x > maxX || c.y > bucketY) continue; const time = (bucketY - c.y) / c.v; if (time < best && Math.abs(c.x - lx) / (W * .5) < time + .4) { best = time; target = c; } }
      const goalX = target ? target.x : W * .78 + Math.sin(T * .6) * W * .06;
      const want = clamp((goalX - lx) * 4, -W * .45, W * .45);
      vx = mix(vx, want, clamp(dt * 8, 0, 1)); lx = clamp(lx + vx * dt, minX, maxX);
      const moving = Math.abs(vx) / (W * .45);
      phase += dt * (6 + 12 * moving);
      const jump = Math.max(0, 1 - (T - burst) / .8);
      const hop = jump > 0 ? Math.sin((1 - jump) * Math.PI) * H * .12 : Math.abs(Math.sin(phase)) * 6 * moving;
      // Coins.
      for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i]; c.y += c.v * dt; c.s += c.w * dt;
        if (Math.abs(c.x - lx) < bw * .5 && Math.abs(c.y - (bucketY - hop)) < c.v * dt + 6 && c.z > .25) {
          coins.splice(i, 1); fill = Math.min(1, fill + .09); pops.push({ x: c.x, y: bucketY - hop, t: T });
          if (fill >= 1) { burst = T; fill = 0; for (let k = 0; k < 14; k++) pops.push({ x: lx, y: bucketY - hop, t: T, vx: (Math.random() - .5) * W * .5, vy: -H * (1 + Math.random()), coin: true, s: Math.random() * TAU }); }
          continue;
        }
        if (c.y > H + 30) { coins.splice(i, 1); continue; }
        g.save(); g.globalAlpha = c.z < .25 ? .45 : 1; coin(g, c.x, c.y, c.r * (c.z < .25 ? .7 : 1), c.s, art.emblem); g.restore();
      }
      const happy = jump > 0 || pops.some(p => T - p.t < .25);
      const id = idle(T);
      const hold = [150, 400, -1.2, -.05];
      const goal = jump > 0 ? [70, 170, -1.3, .35] : hold;
      const pose = { x: lx, floor: floor - hop, h: lh, bob: id.bob, lean: clamp(vx / W, -.18, .18), step: Math.sin(phase) * moving,
        left: goal, right: goal, face: { open: blinkAt(T, 1), happy: happy ? 1 : 0, grin: happy ? 1 : .2, look: clamp((goalX - lx) / (W * .2), -1, 1), lookY: -.6 } };
      shadow(g, lx, floor, lh * .45);
      drawLatch(g, art.latch, pose);
      // Bucket held in front.
      if (jump <= 0) {
        const bx = lx, by = bucketY - hop + lh * .06;
        g.save(); g.translate(bx, by);
        const body = g.createLinearGradient(-bw / 2, 0, bw / 2, 0); body.addColorStop(0, '#1b2a3a'); body.addColorStop(.5, '#2c4a63'); body.addColorStop(1, '#14202c');
        g.fillStyle = body; g.beginPath(); g.moveTo(-bw / 2, 0); g.lineTo(bw / 2, 0); g.lineTo(bw * .38, bw * .62); g.lineTo(-bw * .38, bw * .62); g.closePath(); g.fill();
        g.strokeStyle = '#00e6e1'; g.lineWidth = 3; g.beginPath(); g.ellipse(0, 0, bw / 2, bw * .12, 0, 0, TAU); g.stroke();
        if (fill > 0) { g.save(); g.beginPath(); g.ellipse(0, 0, bw / 2 - 3, bw * .1, 0, 0, TAU); g.clip(); for (let k = 0; k < Math.ceil(fill * 9); k++) coin(g, (rnd(k) - .5) * bw * .7, (rnd(k, 2) - .3) * bw * .1, bw * .1, rnd(k, 3) * 3, null); g.restore(); }
        g.restore();
      }
      // Sparkles and burst coins.
      pops = pops.filter(p => T - p.t < (p.coin ? 1.6 : .5));
      for (const p of pops) {
        const k = T - p.t;
        if (p.coin) { const x = p.x + p.vx * k, y = p.y + p.vy * k + H * 2.2 * k * k; coin(g, x, y, H * .035, p.s + k * 8, art.emblem); }
        else { sparkle(g, p.x, p.y - k * 30, H * .06 * Math.max(0, 1 - k * 1.5), '#fff3c4', clamp(1 - k * 2, 0, 1)); g.strokeStyle = rgba('#ffb65c', 1 - k * 2); g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, Math.max(0, k) * H * .25, 0, TAU); g.stroke(); }
      }
    };
  }

  function levelsScene(art, root) {
    const CYCLE = 12;
    let userLevel = 0;
    const read = () => { const a = document.querySelector('a[href*="view=rewards"]'); const m = a && /Lv\s*(\d+)/i.exec(a.textContent || ''); userLevel = m ? +m[1] : 0; };
    return (g, W, H, T, ctx) => {
      if (ctx.first) read();
      const t = T % CYCLE, mobile = W < 640;
      const n = TIERS.length;
      const x0 = W * (mobile ? .1 : .5), x1 = W * (mobile ? .9 : .94);
      const yLow = H * .88, yHigh = H * (mobile ? .66 : .64);
      const stops = TIERS.map((_, i) => ({ x: mix(x0, x1, i / (n - 1)), y: mix(yLow, yHigh, Math.pow(i / (n - 1), .9)) }));
      const lh = H * (mobile ? .22 : .3);
      const hopT = 1.15, start = .6;
      const at = clamp((t - start) / hopT, 0, n - 1);
      const idx = Math.floor(at), k = at - idx;
      const done = t > start + hopT * (n - 1);
      const fade = 1 - smooth(CYCLE - .7, CYCLE, t);
      g.save(); g.globalAlpha = fade;
      // XP track across the full width.
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(64,87,245,.25)'; g.lineWidth = 8; g.beginPath(); g.moveTo(0, yLow + 4); stops.forEach(s => g.lineTo(s.x, s.y)); g.stroke();
      const lead = g.createLinearGradient(0, 0, x0, 0); lead.addColorStop(0, 'rgba(64,87,245,0)'); lead.addColorStop(1, '#4057f5'); g.strokeStyle = lead; g.beginPath(); g.moveTo(0, yLow + 4); g.lineTo(x0, yLow); g.stroke();
      const prog = done ? n - 1 : idx + smooth(.55, 1, k);
      const fillG = g.createLinearGradient(x0, 0, x1, 0); fillG.addColorStop(0, '#4057f5'); fillG.addColorStop(1, '#7cf3ff');
      g.strokeStyle = fillG; g.lineWidth = 8; g.shadowColor = '#00e6e1'; g.shadowBlur = 14; g.beginPath();
      for (let i = 0; i <= Math.ceil(prog) && i < n; i++) { const s = stops[i]; if (i === 0) { g.moveTo(s.x, s.y); continue; } const f = Math.min(1, prog - (i - 1)); const p0 = stops[i - 1]; g.lineTo(mix(p0.x, s.x, f), mix(p0.y, s.y, f)); }
      g.stroke(); g.shadowBlur = 0;
      // Platforms and tier badges.
      stops.forEach((s, i) => {
        const [name, lvl, color] = TIERS[i];
        const lit = i < idx + (k > .55 ? 1 : 0) || i === 0 || done;
        const litAt = start + hopT * (i - 1) + hopT * .62;
        const pop = i === 0 ? 1 : back(clamp((t - litAt) / .4, 0, 1));
        const c = color === 'holo' ? 'hsl(' + ((T * 120) % 360) + ',90%,65%)' : color;
        const pw = W * (mobile ? .1 : .075);
        g.fillStyle = lit ? '#1d2a4e' : '#151d27'; g.beginPath(); g.roundRect(s.x - pw / 2, s.y, pw, 8, 4); g.fill();
        g.fillStyle = lit ? c : '#2a3542'; g.fillRect(s.x - pw / 2, s.y, pw, 3);
        const by = s.y - lh * 1.2 - H * .05, br = H * (mobile ? .055 : .065) * (lit ? .8 + .2 * pop : .8);
        if (lit) { g.save(); g.globalAlpha *= .5; g.fillStyle = c; g.beginPath(); g.arc(s.x, by, br * 1.5, 0, TAU); g.filter = 'blur(10px)'; g.fill(); g.restore(); }
        g.save(); g.translate(s.x, by);
        g.beginPath(); for (let j = 0; j < 6; j++) { const a = j * Math.PI / 3 - Math.PI / 2; g.lineTo(Math.cos(a) * br, Math.sin(a) * br); } g.closePath();
        if (color === 'holo' && lit) { const hg = g.createLinearGradient(-br, -br, br, br); for (let j = 0; j <= 6; j++) hg.addColorStop(j / 6, 'hsl(' + ((T * 120 + j * 60) % 360) + ',90%,65%)'); g.fillStyle = hg; } else g.fillStyle = lit ? c : '#26303b';
        g.fill(); g.lineWidth = 2; g.strokeStyle = lit ? '#ffffffaa' : '#3a4654'; g.stroke();
        g.fillStyle = lit ? '#0b1416' : '#6b7a88'; g.font = '800 ' + Math.round(br * .62) + 'px "Cardbit Outfit",Outfit,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(lvl), 0, 1);
        g.restore();
        g.font = '800 ' + Math.round(H * .045) + 'px "Cardbit Outfit",Outfit,system-ui,sans-serif'; g.textAlign = 'center'; g.fillStyle = lit ? '#f6faf9' : '#5d6b78';
        g.fillText(name, s.x, by - br - H * .035);
        if (i > 0 && t > litAt && t < litAt + 1.1) { const u = (t - litAt) / 1.1; g.save(); g.globalAlpha *= 1 - u; g.fillStyle = '#ffb65c'; g.font = '800 ' + Math.round(H * .04) + 'px "Cardbit Outfit",Outfit,system-ui,sans-serif'; g.fillText('Spin Unlocked', s.x, by - br - H * .09 - u * 16); g.restore(); }
        if (userLevel && lvl <= userLevel && (i === n - 1 || TIERS[i + 1][1] > userLevel)) {
          g.save(); g.fillStyle = '#00e6e1'; g.font = '800 ' + Math.round(H * .038) + 'px "Cardbit Outfit",Outfit,system-ui,sans-serif'; g.fillText('You', s.x, s.y + H * .07); g.restore();
        }
      });
      // Latch hops platform to platform.
      const from = stops[Math.min(idx, n - 1)], to = stops[Math.min(idx + 1, n - 1)];
      let x = from.x, y = from.y, squash = 1, armsUp = 0;
      if (!done) {
        const crouch = smooth(0, .15, k) * (1 - smooth(.15, .25, k));
        const air = smooth(.22, .75, k), land = smooth(.75, .85, k) * (1 - smooth(.85, 1, k));
        x = mix(from.x, to.x, air); y = mix(from.y, to.y, air) - Math.sin(air * Math.PI) * H * .22;
        squash = 1 - crouch * .14 - land * .12 + (air > 0 && air < 1 ? .08 : 0);
        armsUp = air > 0 && air < 1 ? .7 : 0;
      } else { x = stops[n - 1].x; y = stops[n - 1].y; armsUp = 1; }
      const holo = done ? smooth(start + hopT * (n - 1), start + hopT * (n - 1) + .4, t) : 0;
      if (holo) {
        // Level-up burst.
        const u = t - (start + hopT * (n - 1));
        g.save(); g.translate(x, y - lh * .5); g.rotate(u * .6);
        for (let r = 0; r < 12; r++) { g.rotate(Math.PI / 6); const rg = g.createLinearGradient(0, 0, H * .7, 0); rg.addColorStop(0, 'hsla(' + ((T * 120 + r * 30) % 360) + ',90%,70%,.45)'); rg.addColorStop(1, 'hsla(0,0%,100%,0)'); g.fillStyle = rg; g.beginPath(); g.moveTo(0, 0); g.lineTo(H * .7, -10); g.lineTo(H * .7, 10); g.closePath(); g.fill(); }
        g.restore();
        for (let c = 0; c < 22; c++) { const a = rnd(c) * TAU, sp = .4 + rnd(c, 2); const px = x + Math.cos(a) * sp * u * H * .8, py = y - lh * .5 + Math.sin(a) * sp * u * H * .6 + u * u * H * .5; g.save(); g.globalAlpha *= clamp(1 - u / 2.5, 0, 1); g.fillStyle = 'hsl(' + (c * 37 % 360) + ',90%,65%)'; g.translate(px, py); g.rotate(u * 6 + c); g.fillRect(-4, -2, 8, 4); g.restore(); }
        g.save(); g.globalAlpha *= clamp(u * 2, 0, 1) * clamp(2.6 - u, 0, 1); g.fillStyle = '#fff'; g.font = '800 ' + Math.round(H * .075) + 'px "Cardbit Outfit",Outfit,system-ui,sans-serif'; g.textAlign = 'center'; g.shadowColor = '#7cf3ff'; g.shadowBlur = 16; g.textAlign = 'right'; g.fillText('Level Up!', x - lh * .55, y - lh * .3); g.restore();
      }
      const up = [70, 150 + Math.sin(T * 10) * 8 * (done ? 1 : 0), -1.3, .35];
      const goal = [mix(REST[0], up[0], armsUp), mix(REST[1], up[1], armsUp), mix(0, up[2], armsUp), mix(0, up[3], armsUp)];
      shadow(g, x, from.y, lh * .4, .3);
      const pose = { x, floor: y, h: lh, squash, bob: done ? 0 : idle(T).bob * .5, lean: 0, left: goal, right: goal, tileHop: armsUp * 10,
        face: { open: blinkAt(T, 2), happy: done || (armsUp > 0) ? 1 : 0, grin: done ? 1 : .3 } };
      if (holo) drawHolo(g, art.latch, pose, holo, T); else drawLatch(g, art.latch, pose);
      g.restore();
      void root;
    };
  }
  let tintCanvas = null, maskCanvas = null;
  function drawHolo(g, img, pose, amount, T) {
    const c = g.canvas, dpr = c._dpr || 1;
    tintCanvas ||= document.createElement('canvas'); maskCanvas ||= document.createElement('canvas');
    for (const k of [tintCanvas, maskCanvas]) if (k.width !== c.width || k.height !== c.height) { k.width = c.width; k.height = c.height; }
    const mg = maskCanvas.getContext('2d'), tg = tintCanvas.getContext('2d');
    mg.setTransform(1, 0, 0, 1, 0, 0); mg.clearRect(0, 0, c.width, c.height); mg.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLatch(mg, img, pose);
    tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, c.width, c.height);
    tg.drawImage(maskCanvas, 0, 0);
    tg.setTransform(dpr, 0, 0, dpr, 0, 0);
    const hg = tg.createLinearGradient(pose.x - pose.h * .5, pose.floor - pose.h, pose.x + pose.h * .5, pose.floor);
    for (let j = 0; j <= 6; j++) hg.addColorStop(j / 6, 'hsla(' + ((T * 140 + j * 60) % 360) + ',95%,62%,' + (.6 * amount) + ')');
    tg.globalCompositeOperation = 'color'; tg.fillStyle = hg; tg.fillRect(pose.x - pose.h, pose.floor - pose.h * 1.4, pose.h * 2, pose.h * 1.5);
    tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'destination-in'; tg.drawImage(maskCanvas, 0, 0);
    tg.globalCompositeOperation = 'source-over';
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(tintCanvas, 0, 0); g.restore();
  }

  /* How It Works: an interactive four-step walkthrough. */
  function howScene(art, slide) {
    const steps = [...slide.querySelectorAll('[data-how-step]')];
    const toggle = slide.querySelector('[data-how-toggle]');
    let active = 0, since = 0, autoAt = 0, ripped = -1, mode = 'keep', manualUntil = 0, lx = null, last = 0, phase = 0;
    const STEP = 4.2;
    function select(i, manual, T) {
      active = (i + steps.length) % steps.length; since = T; ripped = -1;
      if (manual) manualUntil = T + 12;
      steps.forEach((b, j) => { b.classList.toggle('is-active', j === active); b.setAttribute('aria-pressed', String(j === active)); });
      if (toggle) toggle.hidden = active !== 2;
    }
    let now = 0;
    steps.forEach((b, i) => b.addEventListener('click', () => select(i, true, now)));
    toggle?.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.mode; since = now; manualUntil = now + 12;
      toggle.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    }));
    slide.addEventListener('click', e => { if (active === 1 && !e.target.closest('a,button')) { ripped = now; manualUntil = now + 12; } });
    select(0, false, 0);
    return (g, W, H, T, ctx) => {
      now = T; const dt = clamp(T - last, 0, .05); last = T;
      if (ctx.first) select(0, false, T);
      if (T - since > STEP && T > manualUntil) select(active + 1, false, T);
      if (active === 2 && T > manualUntil && T - since > STEP / 2 && T - since - dt <= STEP / 2) { mode = mode === 'keep' ? 'sell' : 'keep'; toggle?.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.mode === mode))); }
      const mobile = W < 640, floor = H * (mobile ? .72 : .82);
      const xs = steps.map(b => { const r = b.getBoundingClientRect(), s = ctx.rect; return r.width ? r.left - s.left + r.width / 2 : W * .5; });
      const sx = xs[active], st = T - since;
      const lh = H * (mobile ? .3 : .44);
      if (lx == null || ctx.resized) lx = sx;
      const target = Math.max(lh * .38, sx - lh * .62);
      const v = clamp((target - lx) * 5, -W * .8, W * .8); lx += v * dt;
      const moving = Math.min(1, Math.abs(v) / (W * .3)); phase += dt * (5 + 12 * moving);
      floorGrid(g, W, H, floor, T);
      // Station pads under each step.
      xs.forEach((x, i) => { g.fillStyle = i === active ? 'rgba(0,230,225,.22)' : 'rgba(255,255,255,.05)'; g.beginPath(); g.ellipse(x, floor, lh * .5, lh * .09, 0, 0, TAU); g.fill(); });
      const ox = sx + lh * .32, oy = floor - lh * .45, u = lh / 150;
      if (active === 0) {
        // Coins drop onto a growing stack.
        const n = Math.min(10, Math.floor(st * 3.2));
        for (let i = 0; i < n; i++) flatCoin(g, ox, floor - 8 * u - i * 7 * u, 24 * u);
        const fk = (st * 3.2) % 1; if (n < 10) coin(g, ox, mix(-20, floor - 8 * u - n * 7 * u - 20 * u, easeOut(fk)), 20 * u, fk * 12, art.emblem);
        g.fillStyle = '#ffb65c'; g.font = '800 ' + Math.round(24 * u) + 'px "Cardbit Outfit",Outfit,system-ui,sans-serif'; g.textAlign = 'center';
        g.globalAlpha = smooth(.3, .8, st); g.fillText('+' + (n * 100).toLocaleString('en-US') + (mobile ? '' : ' Cardbits'), ox, floor - 50 * u - n * 7 * u); g.globalAlpha = 1;
      } else if (active === 1) {
        // Tap to rip, or it rips on its own.
        const rip = ripped >= 0 ? T - ripped : (st > 1.6 ? st - 1.6 : -1);
        const ph = 150 * u;
        if (rip < 0) {
          pack(g, art.packs.mystery, ox, oy, ph, Math.sin(T * 4) * .05, { sheen: (T * .6) % 1.6 - .3, glow: 'rgba(174,118,255,.6)' });
          g.fillStyle = '#c2cfce'; g.font = '700 ' + Math.round(14 * u + 3) + 'px system-ui,sans-serif'; g.textAlign = 'center';
          g.globalAlpha = .6 + .4 * Math.sin(T * 5); g.fillText('Tap to Rip', ox, oy + ph * .62); g.globalAlpha = 1;
        } else {
          const tear = smooth(0, .25, rip);
          pack(g, art.packs.mystery, ox, oy + rip * 40 * u, ph, 0, { clipTop: tear * .14, alpha: 1 - smooth(.3, .8, rip) });
          glow(g, ox, oy - ph * .3, ph, '#ae76ff', .5 * (1 - smooth(0, .6, rip)));
          const k = back(clamp((rip - .2) / .6, 0, 1)), flip = Math.cos(clamp((rip - .7) / .35, 0, 1) * Math.PI);
          card(g, art.cards['latch-aipom-026.webp'], ox, mix(oy, oy - 30 * u, k), ph * .8 * mix(.4, 1, k), 0, { flip: Math.abs(flip), backside: flip > 0, emblem: art.emblem });
          if (flip < 0) sparkle(g, ox + 50 * u, oy - 70 * u, 14 * u * (1 + .3 * Math.sin(T * 8)), '#fff');
        }
      } else if (active === 2) {
        const c = (st % (STEP / 2)) / (STEP / 2);
        const vaultX = sx + lh * .55, vy = floor - 34 * u;
        if (mode === 'keep') {
          // Vault box on the right; the card slides in.
          g.fillStyle = '#16222b'; g.strokeStyle = '#00e6e1'; g.lineWidth = 2; g.beginPath(); g.roundRect(vaultX - 40 * u, vy - 40 * u, 80 * u, 74 * u, 10 * u); g.fill(); g.stroke();
          g.fillStyle = '#00e6e1'; g.font = '800 ' + Math.round(14 * u + 2) + 'px "Cardbit Outfit",Outfit,system-ui,sans-serif'; g.textAlign = 'center'; g.fillText('Vault', vaultX, vy + 50 * u);
          const k = smooth(.15, .7, c);
          card(g, art.cards['latch-clefairy-184.webp'], mix(ox - 30 * u, vaultX, k), mix(oy - 10 * u, vy - 4 * u, k) - Math.sin(k * Math.PI) * 40 * u, 110 * u * mix(1, .5, k), mix(-.1, 0, k), { holo: (T * .5) % 1 });
          if (c > .7) sparkle(g, vaultX + 30 * u, vy - 40 * u, 12 * u, '#7cf3ff', 1 - smooth(.7, 1, c));
        } else {
          // The card bursts into Cardbits coins that fly to a counter.
          const k = smooth(.1, .4, c);
          if (k < 1) card(g, art.cards['latch-clefairy-184.webp'], ox, oy - 10 * u, 110 * u * (1 - k * .3), 0, { glow: 'rgba(255,182,92,.7)' });
          for (let i = 0; i < 8; i++) { const f = clamp((c - .3 - i * .04) / .45, 0, 1); if (f <= 0 || f >= 1) continue; coin(g, mix(ox, vaultX, easeOut(f)) + Math.sin(f * Math.PI) * (rnd(i) - .5) * 60 * u, mix(oy, vy - 20 * u, f) - Math.sin(f * Math.PI) * 50 * u, 12 * u, f * 10 + i, null); }
          g.fillStyle = '#ffb65c'; g.font = '800 ' + Math.round(20 * u) + 'px "Cardbit Outfit",Outfit,system-ui,sans-serif'; g.textAlign = 'center';
          g.fillText(Math.round(smooth(.4, .85, c) * 350) + ' Cardbits', vaultX, vy);
        }
      } else {
        // Card drops into a box, the box closes and drives away.
        const k = st / STEP;
        const drive = smooth(.62, 1, k), bx = ox + drive * W * .6, by = floor - 30 * u;
        const flap = smooth(.32, .48, k);
        if (k < .35) card(g, art.cards['latch-slowking-014.webp'], ox, mix(oy - 60 * u, by - 10 * u, smooth(.05, .3, k)), 80 * u, 0, {});
        g.save(); g.translate(bx, by);
        if (drive > 0) { g.fillStyle = '#e8eef2'; g.beginPath(); g.roundRect(-62 * u, -46 * u, 124 * u, 50 * u, 8 * u); g.fill(); g.fillStyle = '#0b1416'; [[-38, 8], [38, 8]].forEach(([x, y]) => { g.beginPath(); g.arc(x * u, y * u, 11 * u, 0, TAU); g.fill(); }); g.fillStyle = '#00e6e1'; g.fillRect(-62 * u, -14 * u, 124 * u, 5 * u); }
        g.fillStyle = '#c99a5b'; g.fillRect(-34 * u, -44 * u + (drive ? -40 * u : 0), 68 * u, 48 * u);
        g.fillStyle = '#b5874a'; g.save(); g.translate(-34 * u, -44 * u + (drive ? -40 * u : 0)); g.rotate(-Math.PI * .85 * (1 - flap)); g.fillRect(0, 0, 34 * u, 6 * u); g.restore();
        g.save(); g.translate(34 * u, -44 * u + (drive ? -40 * u : 0)); g.rotate(Math.PI * .85 * (1 - flap)); g.fillRect(-34 * u, 0, 34 * u, 6 * u); g.restore();
        if (flap >= 1) { g.fillStyle = '#00e6e1'; g.fillRect(-4 * u, -46 * u + (drive ? -40 * u : 0), 8 * u, 50 * u); }
        g.restore();
        if (drive > 0) for (let i = 0; i < 4; i++) { g.strokeStyle = 'rgba(255,255,255,' + (.3 - i * .06) + ')'; g.lineWidth = 2; g.beginPath(); g.moveTo(bx - 70 * u - i * 18 * u, by - 20 * u + i * 8 * u); g.lineTo(bx - 100 * u - i * 18 * u, by - 20 * u + i * 8 * u); g.stroke(); }
      }
      // Latch walks to the active step and gestures at it.
      const point = moving < .2 ? smooth(0, .4, st) : 0;
      const gesture = [mix(68, 40, point), mix(380, 250 + Math.sin(T * 3) * 8, point), mix(0, -1.6, point), .2 * point];
      const cheer = active === 1 && ripped >= 0 && T - ripped > .8;
      const up = [70, 150 + Math.sin(T * 9) * 8, -1.3, .35];
      const pose = { x: lx, floor: floor - Math.abs(Math.sin(phase)) * 5 * moving, h: lh, bob: idle(T).bob, lean: clamp(v / W * .5, -.15, .15), step: Math.sin(phase) * moving,
        left: cheer ? up : REST, right: cheer ? up : gesture, face: { open: blinkAt(T, 3), happy: cheer ? 1 : 0, grin: cheer ? 1 : .3, look: .8 } };
      shadow(g, lx, floor, lh * .42);
      drawLatch(g, art.latch, pose);
    };
  }

  /* ---------- mounting ---------- */
  function mount(slide, kind, opts) {
    const asset = opts.asset;
    const host = slide.querySelector('.cbh-scene') || slide.insertBefore(Object.assign(document.createElement('div'), { className: 'cbh-scene' }), slide.firstChild);
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true'); host.appendChild(canvas);
    const g = canvas.getContext('2d');
    const art = { latch: null, packs: {}, cards: {}, emblem: null };
    const loads = [image(asset('latch-rig-cut.webp')).then(i => art.latch = i), image(asset('brand-emblem.png')).then(i => art.emblem = i)];
    if (kind === 'packs' || kind === 'how') PACKS.forEach(p => loads.push(image(asset('latch-pack-' + p + '.webp')).then(i => art.packs[p] = i)));
    if (kind === 'packs' || kind === 'how') CARDS.forEach(c => loads.push(image(asset(c)).then(i => art.cards[c] = i)));
    const scene = { packs: packsScene, giveaway: giveawayScene, levels: levelsScene, how: howScene }[kind](art, kind === 'how' ? slide : opts.root);
    let errored = false, W = 0, H = 0, raf = 0, t0 = 0, running = false, first = true, resized = true, pointer = null, ready = false, rect = null;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    function size() {
      const r = host.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (!r.width) return;
      W = r.width; H = r.height; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas._dpr = dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px'; resized = true;
    }
    function frame(now) {
      raf = 0; if (!running) return;
      if (!t0) t0 = now;
      draw((now - t0) / 1000);
      raf = requestAnimationFrame(frame);
    }
    function draw(T) {
      if (!ready || !W) return;
      const dpr = canvas._dpr || 1; rect = host.getBoundingClientRect();
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      try { scene(g, W, H, T, { first, resized, pointer, rect }); } catch (e) { if (!errored) console.warn('[cardbit hero]', e); errored = true; }
      first = false; resized = false;
    }
    function start() { if (running) return; running = true; if (motion.matches) { draw(kind === 'packs' ? 5.6 : kind === 'levels' ? 8.4 : 2.5); running = false; return; } raf = requestAnimationFrame(frame); }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
    Promise.all(loads).then(() => { ready = true; size(); if (slide.classList.contains('is-active')) { stop(); start(); } });
    new ResizeObserver(() => size()).observe(host);
    slide.addEventListener('pointermove', e => { const r = host.getBoundingClientRect(); pointer = { x: e.clientX - r.left, y: e.clientY - r.top }; }, opts.signal ? { signal: opts.signal } : undefined);
    slide.addEventListener('pointerleave', () => { pointer = null; }, opts.signal ? { signal: opts.signal } : undefined);
    opts.signal?.addEventListener('abort', stop);
    return { start, stop, seek: T => { stop(); draw(T); } };
  }

  function drawClock(el) {
    const ms = Math.max(0, nextDraw() - Date.now());
    const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
    el.textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }

  window.CardbitHeroScenes = { mount, nextDraw, drawClock };
})();
