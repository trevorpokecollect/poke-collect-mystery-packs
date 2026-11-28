/* Cardbit site: Signal Decode opening (design approved by Trevor, Nov 25 2026).
   Replaces the presentation of window.CardbitOpening.mount (tierFor and the other helpers are kept) on the site. Same contract:
     mount(host, {edition:{id,name,image,color}, cards:[{name,tier,image,copyId}], sample, demo,
                  finishLabel, onFinish, onShare, onInspect, onSpread}) -> {destroy}
   It only plays the stored result it is given. Replay, skip and refresh never ask the server for
   anything, so they can't change or add an award. Rewards come from onSpread (the site's own
   CardbitRevealRewards node), so XP and Sparks shown here are the server's numbers.
   Turn off with <html data-cb-decode="off"> (shell sets it from SITE_DECODE=off). */
(() => {
  'use strict';
  const original = window.CardbitOpening?.mount;
  if (!original || document.documentElement.dataset.cbDecode === 'off') return;

  const TIERS = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
  const FALLBACK = { Common: '#f4f7ff', Uncommon: '#62e987', Rare: '#538fff', Epic: '#b47aff', Legendary: '#ff9b3c' };
  const CY = '#45e3ec';
  const tc = t => { const c = window.CardbitLatchScene?.tiers?.[t]?.color; return /^#[0-9a-f]{6}$/i.test(c || '') ? c : FALLBACK[t] || '#f4f7ff'; };
  const rankOf = t => TIERS.findIndex(x => x.toLowerCase() === String(t || '').trim().toLowerCase());
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeIO = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const easeOut = k => 1 - Math.pow(1 - k, 3);
  // Cardbit value per card: the same buyback number the pool pages show (never retail).
  const BITS_ICON = document.currentScript?.dataset.bits || '';
  // Opening music: six original 8-bit songs written for Cardbit (Trevor, Nov 27 2026), each a seamless loop.
  // data-music lists them (space separated); every opening picks one at random, never the same song twice
  // in a row. Only the picked file loads, and only when sound is on; the built-in chiptune plays if it can't load.
  const MUSIC_URLS = String(document.currentScript?.dataset.music || '').split(/[\s,]+/).filter(Boolean);
  const musicBufs = new Map(); // url -> Promise<AudioBuffer> | false (failed)
  // "holo-hunt.mp3?v=s1" -> slug "holo-hunt", title "Holo Hunt". Full versions download from /pass/soundtrack/<slug>
  // (Pack Pass members; everyone else lands on the Pack Pass page).
  const songSlug = url => (String(url).split('?')[0].split('/').pop() || '').replace(/\.mp3$/, '').replace(/[^a-z0-9-]/g, '');
  const songTitle = slug => slug.split('-').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  function pickMusic() {
    if (!MUSIC_URLS.length) return '';
    let last = -1; try { last = Number(sessionStorage.getItem('cardbit.music.last') ?? -1); } catch {}
    let i = Math.floor(Math.random() * MUSIC_URLS.length);
    if (MUSIC_URLS.length > 1 && i === last) i = (i + 1 + Math.floor(Math.random() * (MUSIC_URLS.length - 1))) % MUSIC_URLS.length;
    try { sessionStorage.setItem('cardbit.music.last', String(i)); } catch {}
    return MUSIC_URLS[i];
  }
  const bitsOf = c => { const v = Number(c?.buybackBits); return Number.isSafeInteger(v) && v > 0 ? v : 0; };
  const fmtBits = n => Math.round(n).toLocaleString('en-US');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hexA = (hex, a) => { const n = parseInt(String(hex).slice(1), 16) || 0; return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${clamp(a)})`; };
  const safeUrl = v => { try { const u = new URL(String(v || ''), location.href); return /^(https?|blob):$/.test(u.protocol) || /^data:image\//.test(String(v)) ? u.href : ''; } catch { return ''; } };
  const GLY = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&@';

  /* ---------- Sound: one shared graph, made live (no audio files) ---------- */
  // Openings play with sound unless the customer turned it off (Trevor, Nov 25 2026). Audio still waits for their tap.
  const soundPref = () => { try { return (window.CardbitMedia?.soundChoice?.() || localStorage.getItem('cardbit.sound.v1')) !== 'off'; } catch { return true; } };
  const saveSound = on => { try { if (window.CardbitMedia?.setSound) window.CardbitMedia.setSound(on); else localStorage.setItem('cardbit.sound.v1', on ? 'on' : 'off'); } catch {} };
  let ac = null, master, verb, noiseBuf;
  function audio(on) {
    if (!on) return null;
    try {
      if (!ac) {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain(); master.gain.value = .8;
        const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
        master.connect(comp).connect(ac.destination);
        const len = ac.sampleRate * 2.4, ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
        verb = ac.createConvolver(); verb.buffer = ir; const vg = ac.createGain(); vg.gain.value = .38; verb.connect(vg).connect(master);
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    } catch { return null; }
  }
  function makeSfx(isOn, MUSIC_URL = '', onMusic = () => {}) {
    const A = () => audio(isOn());
    const out = (node, wet = 0) => { node.connect(master); if (wet && verb) { const s = ac.createGain(); s.gain.value = wet; node.connect(s).connect(verb); } };
    const env = (gn, t, a, peak, d) => { gn.gain.setValueAtTime(.0001, t); gn.gain.exponentialRampToValueAtTime(peak, t + a); gn.gain.exponentialRampToValueAtTime(.0001, t + a + d); };
    function tone(f, dur, { type = 'sine', peak = .2, at = 0, glide, wet = 0, attack = .008 } = {}) { const c = A(); if (!c) return; const t = c.currentTime + at, o = c.createOscillator(), gn = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur); env(gn, t, attack, peak, dur); o.connect(gn); out(gn, wet); o.start(t); o.stop(t + dur + attack + .05); }
    function noise(dur, f1, f2, { peak = .3, type = 'bandpass', q = 1, at = 0, wet = 0, attack = .006 } = {}) { const c = A(); if (!c) return; const t = c.currentTime + at, s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true; const f = c.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f1, t); f.frequency.exponentialRampToValueAtTime(f2, t + dur); const gn = c.createGain(); env(gn, t, attack, peak, dur); s.connect(f).connect(gn); out(gn, wet); s.start(t, Math.random() * .5); s.stop(t + dur + attack + .05); }
    /* 8-bit music loop: an original 4-bar tune in A minor (Am F C G) at 140 BPM, made live with
       square, triangle and noise voices. Low in the mix so the reveal sounds sit on top. */
    const MEL = [76,-1,-1,79,-1,81,-1,79,76,-1,74,-1,72,-1,74,-1, 72,-1,-1,72,-1,74,-1,76,77,-1,76,-1,74,-1,72,-1,
                 72,-1,-1,76,-1,79,-1,84,83,-1,79,-1,76,-1,79,-1, 79,-1,81,-1,83,-1,86,-1,83,-1,81,-1,79,-1,-1,-1];
    const BASS = [45, 41, 48, 43], MINOR = [true, false, false, false];
    const hz = m => 440 * Math.pow(2, (m - 69) / 12);
    let music = null, wanted = false;
    function voice(c, bus, type, f, t, dur, peak) { const o = c.createOscillator(), gn = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); gn.gain.setValueAtTime(peak, t); gn.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(gn).connect(bus); o.start(t); o.stop(t + dur + .02); return o; }
    function hit(c, bus, t, dur, peak, freq, type = 'highpass') { const sN = c.createBufferSource(); sN.buffer = noiseBuf; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; const gn = c.createGain(); gn.gain.setValueAtTime(peak, t); gn.gain.exponentialRampToValueAtTime(.0001, t + dur); sN.connect(f).connect(gn).connect(bus); sN.start(t, Math.random() * .5); sN.stop(t + dur + .02); }
    let musicPos = 0;
    function startMusic() {
      const c = A(); if (!c || music) return;
      if (MUSIC_URL && musicBufs.get(MUSIC_URL) !== false) return startTrack(c);
      startSynth(c);
    }
    function startTrack(c) {
      let src = null, t0 = 0, stopped = false;
      const bus = c.createGain(); bus.gain.setValueAtTime(.0001, c.currentTime); bus.connect(master);
      const me = music = { stop() { stopped = true; const t = c.currentTime; if (src) musicPos = (musicPos + t - t0) % src.buffer.duration; bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(Math.max(.0001, bus.gain.value), t); bus.gain.exponentialRampToValueAtTime(.0001, t + .5); setTimeout(() => { try { src?.stop(); bus.disconnect(); } catch {} }, 700); } };
      (musicBufs.get(MUSIC_URL) || musicBufs.set(MUSIC_URL, fetch(MUSIC_URL).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); }).then(b => new Promise((ok, no) => c.decodeAudioData(b, ok, no)))).get(MUSIC_URL))
        .then(buf => {
          musicBufs.set(MUSIC_URL, Promise.resolve(buf));
          if (stopped || music !== me) return;
          src = c.createBufferSource(); src.buffer = buf; src.loop = true; src.connect(bus);
          t0 = c.currentTime; src.start(t0, musicPos % buf.duration);
          bus.gain.exponentialRampToValueAtTime(.32, t0 + 1);
        })
        .catch(() => { musicBufs.set(MUSIC_URL, false); onMusic(false); if (!stopped && music === me) { music = null; startSynth(c); } });
    }
    function startSynth(c) {
      const bus = c.createGain(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      bus.gain.setValueAtTime(.0001, c.currentTime); bus.gain.exponentialRampToValueAtTime(.055, c.currentTime + .8);
      bus.connect(lp).connect(master);
      const STEP = 60 / 140 / 4; let step = 0, next = c.currentTime + .08;
      const tick = () => {
        while (next < c.currentTime + .15) {
          const bar = Math.floor(step / 16) % 4, i = step % 16, root = BASS[bar], t = next;
          const tones = MINOR[bar] ? [0, 3, 7, 12] : [0, 4, 7, 12];
          voice(c, bus, 'square', hz(root + 24 + tones[i % 4]), t, STEP * .9, .18);                       // arpeggio
          if (i % 2 === 0) voice(c, bus, 'triangle', hz(root + (i % 4 ? 12 : 0)), t, STEP * 1.8, .9);     // bass
          const m = MEL[step % 64]; if (m > 0) voice(c, bus, 'square', hz(m), t, STEP * 1.7, .32);          // lead
          if (i % 8 === 0) { const k = c.createOscillator(), kg = c.createGain(); k.type = 'triangle'; k.frequency.setValueAtTime(150, t); k.frequency.exponentialRampToValueAtTime(40, t + .12); kg.gain.setValueAtTime(1.2, t); kg.gain.exponentialRampToValueAtTime(.0001, t + .14); k.connect(kg).connect(bus); k.start(t); k.stop(t + .16); }
          if (i % 8 === 4) hit(c, bus, t, .12, .5, 1800, 'bandpass');                                       // snare
          if (i % 2 === 1) hit(c, bus, t, .03, .25, 7000);                                                  // hat
          step++; next += STEP;
        }
      };
      tick(); const iv = setInterval(tick, 25);
      music = { stop() { clearInterval(iv); const t = c.currentTime; bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(Math.max(.0001, bus.gain.value), t); bus.gain.exponentialRampToValueAtTime(.0001, t + .6); setTimeout(() => { try { bus.disconnect(); } catch {} }, 900); } };
    }
    return {
      musicOn() { wanted = true; startMusic(); },
      musicOff() { wanted = false; if (music) { music.stop(); music = null; } },
      musicPause() { if (music) { music.stop(); music = null; } },
      get musicWanted() { return wanted; },
      tick(i = 0) { tone(900 + i * 120, .05, { type: 'square', peak: .05 }); },
      coin(i = 0) { tone(1500 + i * 50, .05, { type: 'triangle', peak: .06 }); tone(2250 + i * 50, .05, { peak: .04, at: .03 }); },
      charge() { tone(110, .9, { type: 'sawtooth', peak: .05, glide: 440, attack: .2 }); noise(.9, 200, 1800, { peak: .08, attack: .3 }); },
      scan(d) { noise(d, 500, 5200, { peak: .16, q: 3, attack: .05 }); for (let i = 0; i < d / .07; i++) if (Math.random() < .55) tone(2200 + Math.random() * 3200, .02, { type: 'square', peak: .035, at: i * .07 }); },
      detect() { tone(1320, .08, { type: 'triangle', peak: .1, wet: .4 }); tone(1760, .12, { type: 'triangle', peak: .1, at: .08, wet: .4 }); },
      implode() { noise(.7, 6000, 300, { peak: .4, q: .7, attack: .6 }); tone(70, .5, { peak: .55, at: .62, glide: 32, wet: .25 }); noise(.12, 300, 120, { peak: .3, type: 'lowpass', at: .62 }); },
      search(d) { tone(300, d, { type: 'sawtooth', peak: .03, glide: 900, attack: .05 }); noise(d, 800, 2400, { peak: .05, q: 6 }); },
      lock(k) { const n = [392, 494, 587, 740, 988][k]; noise(.02, 4000, 3000, { peak: .35, type: 'highpass' }); tone(n, .35, { type: 'triangle', peak: .16, wet: .5 }); tone(n * 2, .18, { peak: .05, at: .01, wet: .5 }); if (k >= 3) tone(n / 4, .5, { type: 'sawtooth', peak: .06, wet: .3 }); },
      miss() { tone(116, .22, { type: 'sawtooth', peak: .09 }); tone(123, .22, { type: 'sawtooth', peak: .09 }); noise(.22, 900, 400, { peak: .08, q: 2 }); },
      print(d, r) { noise(d, 1200, 3600, { peak: .07, q: 4, attack: .04 }); const steps = Math.floor(d / .06); for (let i = 0; i < steps; i++) tone(400 * Math.pow(2, (i % 12) / 12 + r * .1), .03, { type: 'square', peak: .025, at: i * .06 }); },
      glitch() { noise(.09, 5000, 800, { peak: .22, q: .5 }); tone(60, .08, { type: 'square', peak: .08 }); },
      stinger(r) { const base = [523, 587, 659, 698, 784][r], chord = [[0, 7], [0, 4, 7], [0, 4, 7, 11], [0, 3, 7, 10, 14], [0, 4, 7, 11, 14, 19]][r]; chord.forEach((s, i) => tone(base * Math.pow(2, s / 12), .7 + r * .3, { type: r >= 3 ? 'sawtooth' : 'triangle', peak: r >= 3 ? .05 : .09, at: i * .035, wet: .55, attack: .01 }));
        if (r >= 2) noise(.6 + r * .2, 9000, 3000, { peak: .06, type: 'highpass', wet: .6 });
        if (r >= 3) { tone(85, 1.1, { peak: .6, glide: 30, wet: .2 }); noise(.25, 400, 90, { peak: .4, type: 'lowpass' }); }
        if (r === 4) { [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(1046 * Math.pow(2, s / 12), .22, { type: 'triangle', peak: .05, at: .35 + i * .06, wet: .7 })); tone(130.8, 2.6, { type: 'sawtooth', peak: .04, attack: .4, wet: .6 }); tone(196, 2.6, { type: 'sawtooth', peak: .03, attack: .4, wet: .6 }); } },
      whoosh() { noise(.3, 400, 3000, { peak: .18, q: .8 }); },
      spark(i) { tone(1800 + i * 90, .06, { peak: .06, wet: .3 }); }
    };
  }

  const upright = im => (window.CardbitUpright?.image ? window.CardbitUpright.image(im) : im);
  const imgCache = new Map();
  function loadImg(src) {
    if (!src) return Promise.resolve(null);
    if (!imgCache.has(src)) imgCache.set(src, new Promise(res => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }));
    return imgCache.get(src);
  }
  const xrayCache = new Map();
  function xray(im, src) {
    if (!im) return null;
    if (xrayCache.has(src)) return xrayCache.get(src);
    let out = null;
    try {
      const w = 320, h = Math.round(w * im.height / im.width), c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0, w, h); const d = x.getImageData(0, 0, w, h), p = d.data;
      for (let i = 0; i < p.length; i += 4) { const e = Math.pow((p[i] * .3 + p[i + 1] * .59 + p[i + 2] * .11) / 255, 1.4); p[i] = 10 + e * 150; p[i + 1] = 40 + e * 215; p[i + 2] = 50 + e * 205; }
      x.putImageData(d, 0, 0); out = c;
    } catch { out = null; } // cross-origin wrapper: scan without the x-ray tint
    xrayCache.set(src, out);
    return out;
  }

  function mount(host, options = {}) {
    const edition = options.edition || {};
    const sample = options.sample === true || options.demo === true;
    const cards = Array.from(options.cards || [], c => ({ ...c, rank: Math.max(0, rankOf(c.tier)), image: safeUrl(c.image) }))
      .map((c, i) => ({ ...c, order: i })).sort((a, b) => a.rank - b.rank || a.order - b.order);
    if (!cards.length) return original(host, options);
    const packColor = /^#[0-9a-f]{6}$/i.test(edition.color || '') ? edition.color : '#55a9ff';
    const packSrc = safeUrl(edition.image);
    const name = String(edition.name || 'Cardbit Pack');
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const S = { sound: soundPref(), reduced: mq.matches, destroyed: false };
    const MUSIC = pickMusic();
    let npEl = null;
    // Song banner (Trevor, Nov 27): on the whole animation, paid and demo, from the first frame until the results.
    // Hidden only if the song file can't load (the built-in tune plays then) and on the results screen.
    const sfx = makeSfx(() => S.sound && !S.destroyed, MUSIC, ok => { if (!ok && npEl) npEl.remove(); });
    const vib = p => { if (S.reduced) return; try { navigator.vibrate && navigator.vibrate(p); } catch {} };
    const events = new AbortController(), on = (t, e, f, o) => t.addEventListener(e, f, { signal: events.signal, ...(o || {}) });

    host.replaceChildren();
    const root = document.createElement('section');
    root.className = 'cbd';
    root.setAttribute('aria-label', name + (sample ? ' Demo Opening' : ' Opening'));
    root.innerHTML =
      '<div class="cbd-top"><div><p class="cbd-kicker">' + (sample ? 'Demo Opening <span class="cbd-demo">Demo — No Purchase.</span>' : 'Pack Opening') + '</p><h1 class="cbd-title">' + esc(name) + '</h1></div>' +
      '<div class="cbd-tools"><button type="button" class="cbd-btn" data-cbd="sound" aria-pressed="false"></button><button type="button" class="cbd-btn" data-cbd="motion" aria-pressed="false">Reduce Motion</button><button type="button" class="cbd-btn" data-cbd="skip">Skip</button></div></div>' +
      '<div class="cbd-stage" tabindex="0" aria-label="Opening stage. Press Enter or Space to continue."><canvas aria-hidden="true"></canvas>' +
      '<div class="cbd-readout" aria-hidden="true"></div><div class="cbd-tier" aria-hidden="true"><small>Signal Lock</small><span></span></div>' +
      '<div class="cbd-banner" aria-hidden="true"></div><div class="cbd-row" aria-hidden="true"></div><div class="cbd-hint" aria-live="polite"></div>' +
      (songSlug(MUSIC) ? '<p class="cbd-np"><span class="cbd-np-now"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 18.5a3 3 0 1 1-2-2.83V5l12-2v12.5a3 3 0 1 1-2-2.83V7.1L9 8.6z" fill="currentColor"/></svg><span class="cbd-np-lab">Now Playing</span> <b>' + esc(songTitle(songSlug(MUSIC))) + '</b></span><a class="cbd-np-dl" href="/pass/soundtrack/' + songSlug(MUSIC) + '">Download Full Version with Pack Pass</a></p>' : '') + '</div>' +
      (sample ? '<p class="cbd-note">A Demo Opening spends zero Cardbits and awards no physical card.</p>' : '');
    host.append(root);
    const stage = root.querySelector('.cbd-stage'), cv = stage.querySelector('canvas'), g = cv.getContext('2d');
    const ro = stage.querySelector('.cbd-readout'), tierlab = stage.querySelector('.cbd-tier'), tierTxt = tierlab.querySelector('span');
    const banner = stage.querySelector('.cbd-banner'), rowEl = stage.querySelector('.cbd-row'), hint = stage.querySelector('.cbd-hint');
    npEl = root.querySelector('.cbd-np');
    if (MUSIC_URLS.length && musicBufs.get(MUSIC) === false) npEl?.remove();
    const soundBtn = root.querySelector('[data-cbd=sound]'), motionBtn = root.querySelector('[data-cbd=motion]'), skipBtn = root.querySelector('[data-cbd=skip]');
    const syncButtons = () => { soundBtn.textContent = S.sound ? 'Sound On' : 'Sound Off'; soundBtn.setAttribute('aria-pressed', S.sound); motionBtn.setAttribute('aria-pressed', S.reduced); root.classList.toggle('cbd-calm', S.reduced); const lab = root.querySelector('.cbd-np-lab'); if (lab) lab.textContent = S.sound ? 'Now Playing' : 'Opening Song'; };
    syncButtons();
    on(soundBtn, 'click', () => { S.sound = !S.sound; saveSound(S.sound); syncButtons(); if (S.sound) { audio(true); sfx.tick(3); if (sfx.musicWanted && !done) sfx.musicOn(); } else sfx.musicPause(); });
    on(motionBtn, 'click', () => { S.reduced = !S.reduced; syncButtons(); });
    on(skipBtn, 'click', () => finish(true));

    /* ---------- world + renderer ---------- */
    let Wd = 0, Ht = 0;
    const L = {};
    const W = { pack: null, packAlpha: 0, scan: 0, scanOn: false, platform: 0, dim: 0, beams: 0, beamColor: '#fff', shake: 0,
      core: { a: 0, r: 0, color: CY }, ring: { a: 0, scale: 1, locked: 0, seek: -Math.PI / 2, seekOn: false, flicker: -1, final: null, shatter: 0 },
      raster: null, bits: [], flies: [], sparks: [], waves: [], dust: [] };
    // Pack Pass opening style (own openings only; looks only). Empty for guests and non-members.
    const style = { sleeve: null, sleeveIm: null, reveal: null };
    W.fx = [];
    const sleeveSlots = () => { if (!style.sleeve) return; rowEl.querySelectorAll('.cbd-slot:not(.filled)').forEach(n => { n.classList.add('sleeved'); n.style.backgroundImage = 'url("' + style.sleeve.replace(/"/g, '') + '")'; }); };
    fetch('/api/pass/style', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(r => (r.ok ? r.json() : null)).then(d => {
      if (!d || S.destroyed) return;
      if (d.reveal && /^[a-z]+$/.test(d.reveal.element || '') && Array.isArray(d.reveal.colors)) style.reveal = { element: d.reveal.element, colors: d.reveal.colors.filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 3) };
      const url = safeUrl(d.sleeve), u = url ? new URL(url) : null; if (u && u.origin === location.origin && u.pathname.startsWith('/site/img/pass/sleeves/')) { style.sleeve = url; loadImg(url).then(im => { style.sleeveIm = im; }); sleeveSlots(); }
    }).catch(() => {});
    for (let i = 0; i < 46; i++) W.dust.push({ x: Math.random(), y: Math.random(), z: .3 + Math.random() * .7, p: Math.random() * 6 });
    function layout() { const narrow = Wd < 560; L.cx = Wd / 2; L.cy = Ht * (narrow ? .42 : .44); L.ph = Math.min(Ht * .52, Wd * .62 * 1520 / 842); L.pw = L.ph * 842 / 1520; L.ch = Math.min(Ht * (narrow ? .42 : .5), Wd * .62 * 7 / 5); L.cw = L.ch * 5 / 7; fitCard(); L.R = Math.min(L.ch * .4, Wd * .34); L.floor = Ht * .73; }
    // Keep the card, its tier/Cardbits/name tag and the hint pill from overlapping on short stages.
    function fitCard() {
      const hintTop = Ht - (Ht * .11 + 24) - 42, tagH = Ht * .014 + 62, top = 50;
      const maxBottom = hintTop - tagH - 6;
      if (L.cy + L.ch / 2 <= maxBottom) return;
      L.ch = Math.max(120, Math.min(L.ch, maxBottom - top)); L.cw = L.ch * 5 / 7;
      L.cy = Math.min(L.cy, maxBottom - L.ch / 2);
    }
    function resize() { const r = stage.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); Wd = r.width; Ht = r.height; cv.width = Math.round(Wd * dpr); cv.height = Math.round(Ht * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0); layout(); const card = stage.querySelector('.cbd-card'); if (card) place(card); }
    const rrect = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    function drawBg(t) {
      g.fillStyle = '#040b0d'; g.fillRect(0, 0, Wd, Ht);
      const rg = g.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, Math.max(Wd, Ht) * .7); rg.addColorStop(0, hexA(packColor, .14 + W.platform * .08)); rg.addColorStop(.45, 'rgba(8,30,36,.5)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(0, 0, Wd, Ht);
      const hz = L.floor; g.save(); g.beginPath(); g.rect(0, hz, Wd, Ht - hz); g.clip();
      const fg = g.createLinearGradient(0, hz, 0, Ht); fg.addColorStop(0, 'rgba(69,227,236,0)'); fg.addColorStop(1, 'rgba(69,227,236,.05)'); g.fillStyle = fg; g.fillRect(0, hz, Wd, Ht - hz);
      g.strokeStyle = 'rgba(69,227,236,.13)'; g.lineWidth = 1; const off = S.reduced ? 0 : (t * .00025) % 1;
      for (let i = 0; i < 14; i++) { const k = (i + off) / 14, y = hz + Math.pow(k, 2.2) * (Ht - hz); g.globalAlpha = .25 + k * .75; g.beginPath(); g.moveTo(0, y); g.lineTo(Wd, y); g.stroke(); }
      g.globalAlpha = 1; for (let i = -12; i <= 12; i++) { g.beginPath(); g.moveTo(L.cx + i * Wd * .02, hz); g.lineTo(L.cx + i * Wd * .16, Ht); g.stroke(); }
      g.restore();
      g.fillStyle = '#bff7fa'; for (const d of W.dust) { const y = ((d.y - (S.reduced ? 0 : t * .00002 * d.z)) % 1 + 1) % 1; g.globalAlpha = .08 + .18 * d.z * (.6 + .4 * Math.sin(t * .001 + d.p)); g.fillRect(d.x * Wd, y * Ht, 1.6 * d.z, 1.6 * d.z); } g.globalAlpha = 1;
    }
    function drawPlatform(t) {
      const e = W.platform, y = L.cy + L.ph * .53, rx = Math.min(Wd * .42, L.ph * .62), ry = rx * .2;
      g.save(); g.globalCompositeOperation = 'lighter';
      const rg = g.createRadialGradient(L.cx, y, 0, L.cx, y, rx); rg.addColorStop(0, hexA(CY, .10 + .18 * e)); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.beginPath(); g.ellipse(L.cx, y, rx, ry, 0, 0, 7); g.fill();
      g.strokeStyle = hexA(CY, .35 + .4 * e); g.lineWidth = 2; g.beginPath(); g.ellipse(L.cx, y, rx * .78, ry * .78, 0, 0, 7); g.stroke();
      g.lineWidth = 3; for (let i = 0; i < 36; i++) { if (i % 3 === 0) continue; const a = i / 36 * Math.PI * 2 + (S.reduced ? 0 : t * .0004 * (1 + e * 3)); g.globalAlpha = .25 + .6 * e * (i % 2 ? 1 : .5); g.beginPath(); g.ellipse(L.cx, y, rx * .95, ry * .95, 0, a, a + .08); g.stroke(); }
      g.globalAlpha = 1;
      if (e > 0) { const cg = g.createLinearGradient(0, y, 0, y - L.ph * 1.1); cg.addColorStop(0, hexA(CY, .16 * e)); cg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = cg; g.beginPath(); g.moveTo(L.cx - rx * .78, y); g.lineTo(L.cx + rx * .78, y); g.lineTo(L.cx + rx * .5, y - L.ph * 1.1); g.lineTo(L.cx - rx * .5, y - L.ph * 1.1); g.fill(); }
      g.restore();
    }
    function drawPack(t) {
      if (!W.pack?.im || W.packAlpha <= 0) return;
      const bob = S.reduced ? 0 : Math.sin(t / 900) * Ht * .006, x = L.cx - L.pw / 2, y = L.cy - L.ph / 2 + bob; W.pack.box = { x, y };
      g.save(); g.globalAlpha = W.packAlpha; const sy = y + L.ph * W.scan;
      if (W.scan < 1) { g.save(); g.beginPath(); g.rect(x - 40, sy, L.pw + 80, L.ph + 40); g.clip(); g.drawImage(W.pack.im, x, y, L.pw, L.ph); g.restore(); }
      if (W.scan > 0) { g.save(); g.beginPath(); g.rect(x - 40, y - 40, L.pw + 80, sy - y + 40); g.clip(); if (W.pack.xr) g.drawImage(W.pack.xr, x, y, L.pw, L.ph); else { g.drawImage(W.pack.im, x, y, L.pw, L.ph); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(30,160,170,.55)'; g.fillRect(x, y, L.pw, L.ph); } g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(69,227,236,.08)'; for (let yy = y; yy < sy; yy += 3) g.fillRect(x, yy, L.pw, 1); g.restore(); }
      if (W.scanOn && W.scan < 1) {
        g.globalCompositeOperation = 'lighter'; const bw = L.pw * 1.5, bx = L.cx - bw / 2, bh = L.ph * .13, N = 12;
        for (let j = 0; j < N; j++) { const a = Math.pow((j + 1) / N, 2.2) * .34, hg = g.createLinearGradient(bx, 0, bx + bw, 0); hg.addColorStop(0, 'rgba(69,227,236,0)'); hg.addColorStop(.22, `rgba(69,227,236,${a})`); hg.addColorStop(.78, `rgba(69,227,236,${a})`); hg.addColorStop(1, 'rgba(69,227,236,0)'); g.fillStyle = hg; g.fillRect(bx, sy - bh + bh * j / N, bw, bh / N + .5); }
        const lg = g.createLinearGradient(bx, 0, bx + bw, 0); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(.15, 'rgba(255,255,255,.95)'); lg.addColorStop(.85, 'rgba(255,255,255,.95)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = lg; g.fillRect(bx, sy - 1.5, bw, 3);
      }
      g.restore();
    }
    function drawCore(t) {
      const c = W.core; if (c.a <= 0) return; const r = c.r * (1 + .06 * Math.sin(t / 110));
      g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = c.a;
      const rg = g.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, r * 3.2); rg.addColorStop(0, '#fff'); rg.addColorStop(.12, hexA(c.color, .95)); rg.addColorStop(.4, hexA(c.color, .25)); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.beginPath(); g.arc(L.cx, L.cy, r * 3.2, 0, 7); g.fill();
      g.strokeStyle = hexA(c.color, .7); g.lineWidth = 1.5; for (let i = 0; i < 3; i++) { const a = t * .002 * (i % 2 ? -1 : 1) * (1 + i * .4) + i; g.beginPath(); g.ellipse(L.cx, L.cy, r * (1.5 + i * .35), r * (1.5 + i * .35) * .42, a, 0, Math.PI * 1.4); g.stroke(); }
      g.restore();
    }
    function drawRing(t) {
      const R0 = W.ring; if (R0.a <= 0) return; const R = L.R * R0.scale, lw = Math.max(6, R * .085);
      g.save(); g.globalAlpha = R0.a; g.strokeStyle = 'rgba(69,227,236,.35)'; g.lineWidth = 1.5;
      for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2 + t * .00015, l = i % 6 === 0 ? lw * .9 : lw * .4; g.beginPath(); g.moveTo(L.cx + Math.cos(a) * (R + lw * 1.1), L.cy + Math.sin(a) * (R + lw * 1.1)); g.lineTo(L.cx + Math.cos(a) * (R + lw * 1.1 + l), L.cy + Math.sin(a) * (R + lw * 1.1 + l)); g.stroke(); }
      for (let k = 0; k < 5; k++) {
        const a0 = -Math.PI / 2 + k * (Math.PI * 2 / 5) + .07, a1 = a0 + Math.PI * 2 / 5 - .14; let col = '#15323a', glow = 0;
        if (R0.final) { col = R0.final; glow = 1; } else if (k < R0.locked) { col = tc(TIERS[k]); glow = 1; } else if (k === R0.flicker && Math.floor(t / 70) % 2) { col = tc(TIERS[k]); glow = .5; }
        const ox = Math.cos((a0 + a1) / 2) * R0.shatter * R * .8, oy = Math.sin((a0 + a1) / 2) * R0.shatter * R * .8;
        g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.arc(L.cx + ox, L.cy + oy, R, a0, a1); g.stroke();
        if (glow) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = R0.a * .35 * glow; g.lineWidth = lw * 2.6; g.beginPath(); g.arc(L.cx + ox, L.cy + oy, R, a0, a1); g.stroke(); g.restore(); }
      }
      if (R0.seekOn) { g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 8; i++) { g.globalAlpha = R0.a * (1 - i / 8) * .9; g.strokeStyle = '#fff'; g.lineWidth = lw * .5; const a = R0.seek - i * .05; g.beginPath(); g.arc(L.cx, L.cy, R - lw * .95, a - .05, a); g.stroke(); } }
      g.restore();
    }
    function drawRaster() {
      const r = W.raster; if (!r) return; const x = L.cx - L.cw / 2, y = L.cy - L.ch / 2, w = L.cw, h = L.ch, ly = y + h * r.line;
      g.save(); rrect(x, y, w, h, w * .046); g.clip();
      g.fillStyle = 'rgba(69,227,236,.05)'; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(69,227,236,.16)'; g.lineWidth = 1;
      for (let i = 1; i < 10; i++) { g.beginPath(); g.moveTo(x + w * i / 10, y); g.lineTo(x + w * i / 10, y + h); g.stroke(); }
      for (let i = 1; i < 14; i++) { g.beginPath(); g.moveTo(x, y + h * i / 14); g.lineTo(x + w, y + h * i / 14); g.stroke(); }
      if (style.sleeveIm && r.line < 1) { g.save(); g.beginPath(); g.rect(x, ly, w, y + h - ly); g.clip(); g.drawImage(style.sleeveIm, x, y, w, h); g.restore(); }
      if (r.im) { g.save(); g.beginPath(); g.rect(x, y, w, ly - y); g.clip();
        if (r.glitch > 0) { for (let s = 0; s < 6; s++) { const off = (Math.random() - .5) * w * .08; g.drawImage(r.im, 0, r.im.height * s / 6, r.im.width, r.im.height / 6, x + off, y + h * s / 6, w, h / 6); } } else g.drawImage(r.im, x, y, w, h);
        g.restore(); }
      g.globalCompositeOperation = 'lighter'; const bg = g.createLinearGradient(0, ly - h * .07, 0, ly + 2); bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(1, hexA(r.color, .85)); g.fillStyle = bg; g.fillRect(x, ly - h * .07, w, h * .07 + 2); g.fillStyle = '#fff'; g.fillRect(x, ly - 1, w, 2);
      g.restore(); g.save(); g.strokeStyle = hexA(CY, .6); g.lineWidth = 1.5; rrect(x, y, w, h, w * .046); g.stroke(); g.restore();
    }
    function drawBeams(t) {
      if (W.beams <= 0) return; g.save(); g.globalCompositeOperation = 'lighter'; g.translate(L.cx, L.cy); g.rotate(t * .00025); const len = Math.max(Wd, Ht) * 1.1;
      for (let i = 0; i < 14; i++) { g.rotate(Math.PI * 2 / 14); const gr = g.createLinearGradient(0, 0, len, 0); gr.addColorStop(0, hexA(W.beamColor, .4 * W.beams)); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.lineTo(len, -len * .06); g.lineTo(len, len * .06); g.fill(); }
      g.restore();
    }
    function drawParticles() {
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let i = W.bits.length - 1; i >= 0; i--) { const b = W.bits[i]; b.life++; const px = b.x, py = b.y;
        if (b.life < b.out) { b.x += b.vx; b.y += b.vy; b.vx *= .9; b.vy *= .9; }
        else { const dx = L.cx - b.x, dy = L.cy - b.y; b.vx = (b.vx + dx * .03) * .8; b.vy = (b.vy + dy * .03) * .8; b.x += b.vx; b.y += b.vy; if (Math.hypot(dx, dy) < Math.max(8, W.core.r * .8)) { W.bits.splice(i, 1); W.core.r = Math.min(L.R * .22, W.core.r + .35); continue; } }
        g.globalAlpha = .9; g.strokeStyle = b.c; g.lineWidth = b.s * .6; g.beginPath(); g.moveTo(px, py); g.lineTo(b.x, b.y); g.stroke(); g.fillStyle = b.c; g.fillRect(b.x - b.s / 2, b.y - b.s / 2, b.s, b.s); }
      for (let i = W.flies.length - 1; i >= 0; i--) { const p = W.flies[i]; p.life++; if (p.life < p.delay) continue; const k = clamp((p.life - p.delay) / p.dur), e = easeIO(k); const x = lerp(p.sx, p.tx, e) + Math.sin(k * Math.PI) * p.curve, y = lerp(p.sy, p.ty, e); g.globalAlpha = k >= 1 ? Math.max(0, 1 - (p.life - p.delay - p.dur) / 8) : 1; g.fillStyle = p.c; g.fillRect(x - p.s / 2, y - p.s / 2, p.s, p.s); if (p.life > p.delay + p.dur + 8) W.flies.splice(i, 1); }
      for (let i = W.sparks.length - 1; i >= 0; i--) { const p = W.sparks[i]; p.life++; p.x += p.vx; p.y += p.vy; p.vx *= .96; p.vy = p.vy * .96 + p.gy; const a = 1 - p.life / p.max; if (a <= 0) { W.sparks.splice(i, 1); continue; } g.globalAlpha = a; g.fillStyle = p.c; g.fillRect(p.x, p.y, p.s, p.s); }
      for (let i = W.waves.length - 1; i >= 0; i--) { const r = W.waves[i]; r.r += (r.max - r.r) * .07 + 2; r.a -= .022; if (r.a <= 0) { W.waves.splice(i, 1); continue; } g.globalAlpha = r.a; g.strokeStyle = r.c; g.lineWidth = 3 * r.a + 1; g.beginPath(); g.arc(r.x, r.y, r.r, 0, 7); g.stroke(); }
      g.restore();
    }

    /* ---------- Pack Pass reveal effect: a burst in the member's character's element, behind the card ---------- */
    const rnd = (a, b) => a + Math.random() * (b - a);
    function revealBurst(rk) {
      const rv = style.reveal; if (!rv || S.reduced) return;
      const el = rv.element, cols = rv.colors.length ? rv.colors : [CY, CY, '#fff'], n = [16, 26, 40, 70, 110][rk] || 26;
      for (let i = 0; i < n && W.fx.length < 260; i++) {
        const a = rnd(0, Math.PI * 2), sp = rnd(1.5, 6) * (1 + rk * .12);
        const p = { el, x: L.cx + Math.cos(a) * L.cw * .4, y: L.cy + Math.sin(a) * L.ch * .4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(50, 90), age: 0, r: rnd(3, 8) * (L.ch / 400 + .5), rot: rnd(0, 6), vr: rnd(-.2, .2), col: cols[i % cols.length] };
        if (el === 'fire' || el === 'dragon') { p.vy = -rnd(1.5, 5); p.vx = rnd(-2.5, 2.5); }
        if (el === 'ghost') { p.vy = -rnd(.4, 1.6); p.vx = rnd(-1, 1); p.r *= 3; p.life = rnd(70, 110); }
        if (el === 'ice') { p.vx *= .5; p.vy = rnd(-1, 1.5); p.life = rnd(80, 120); }
        if (el === 'grass') { p.vx *= .7; p.vy = rnd(-3, 1); }
        if (el === 'wind') { p.ang = a; p.rad = L.ch * rnd(.3, .5); p.spd = rnd(.05, .1); p.len = rnd(.3, .8); }
        if (el === 'electric' && i % 4 === 0) { p.bolt = 1; p.life = rnd(10, 18); }
        W.fx.push(p);
      }
      if (el === 'water' || el === 'crystal' || el === 'holo') wave(L.cx, L.cy, cols[0], L.ch * 1.2);
      if (el === 'dragon' || el === 'electric') wave(L.cx, L.cy, cols[2] || cols[0], L.ch * 1.1);
    }
    function drawFx() {
      if (!W.fx.length) return; g.save();
      for (let i = W.fx.length - 1; i >= 0; i--) {
        const p = W.fx[i]; p.age++; if (p.age >= p.life) { W.fx.splice(i, 1); continue; }
        const k = p.age / p.life, al = 1 - k, el = p.el;
        if (el === 'wind') p.ang += p.spd; else { p.x += p.vx; p.y += p.vy; p.rot += p.vr; }
        if (el === 'gold' || el === 'water' || el === 'card' || el === 'holo' || el === 'crystal') p.vy += .12;
        if (el === 'grass') { p.vy += .05; p.vx += Math.sin(p.age * .1) * .15; }
        if (el === 'ice') p.vy += .02;
        if (el === 'fire' || el === 'dragon') p.vx *= .98;
        g.globalAlpha = al; g.fillStyle = g.strokeStyle = p.col;
        if (el === 'wind') { g.lineWidth = 2.5; g.lineCap = 'round'; g.beginPath(); g.arc(L.cx, L.cy, p.rad + p.age * 2.4, p.ang, p.ang + p.len); g.stroke(); continue; }
        if (p.bolt) { g.lineWidth = 3; g.beginPath(); let x = L.cx, y = L.cy; g.moveTo(x, y); for (let j = 0; j < 6; j++) { x += Math.cos(p.rot) * L.ch * .08 + rnd(-12, 12); y += Math.sin(p.rot) * L.ch * .08 + rnd(-12, 12); g.lineTo(x, y); } g.stroke(); continue; }
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot); const r = p.r;
        switch (el) {
          case 'card': g.fillRect(-r * .7, -r, r * 1.4, r * 2); break;
          case 'gold': g.beginPath(); g.ellipse(0, 0, r, Math.max(.5, r * Math.abs(Math.cos(p.age * .2))), 0, 0, 7); g.fill(); break;
          case 'holo': g.fillStyle = 'hsl(' + ((p.age * 8 + p.x) % 360) + ' 90% 72%)'; g.beginPath(); g.moveTo(0, -r); g.lineTo(r * .7, 0); g.lineTo(0, r); g.lineTo(-r * .7, 0); g.fill(); break;
          case 'water': g.beginPath(); g.moveTo(0, -r * 1.4); g.quadraticCurveTo(r, r * .4, 0, r); g.quadraticCurveTo(-r, r * .4, 0, -r * 1.4); g.fill(); break;
          case 'grass': g.beginPath(); g.ellipse(0, 0, r * 1.3, r * .55, 0, 0, 7); g.fill(); break;
          case 'ice': g.lineWidth = 1.8; for (let j = 0; j < 3; j++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(-r, 0); g.lineTo(r, 0); g.stroke(); } break;
          case 'crystal': g.beginPath(); g.moveTo(0, -r * 1.5); g.lineTo(r * .6, r); g.lineTo(-r * .6, r); g.fill(); break;
          case 'ghost': { g.globalAlpha = al * .35; const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, p.col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); break; }
          case 'electric': g.fillRect(-2, -2, 4, 4); break;
          default: g.beginPath(); g.arc(0, 0, r * (1 - k * .6), 0, 7); g.fill(); // fire, dragon
        }
        g.restore();
      }
      g.restore();
    }
    let visible = true, running = false;
    function frame(now) {
      if (S.destroyed) { running = false; return; }
      g.save();
      if (W.shake > 0 && !S.reduced) { g.translate((Math.random() - .5) * W.shake, (Math.random() - .5) * W.shake); W.shake *= .88; if (W.shake < .3) W.shake = 0; }
      drawBg(now); drawPlatform(now);
      if (W.dim > 0) { g.fillStyle = `rgba(0,0,0,${W.dim * .65})`; g.fillRect(-20, -20, Wd + 40, Ht + 40); }
      drawBeams(now); drawPack(now); drawCore(now); drawRing(now); drawRaster(); drawParticles(); drawFx();
      g.restore();
      if (visible && !document.hidden) requestAnimationFrame(frame); else running = false;
    }
    const startLoop = () => { if (!running && !S.destroyed) { running = true; requestAnimationFrame(frame); } };
    const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) startLoop(); }); io.observe(stage);
    on(document, 'visibilitychange', () => { if (!document.hidden) { startLoop(); if (sfx.musicWanted && !done) sfx.musicOn(); } else sfx.musicPause(); });
    const rs = new ResizeObserver(resize); rs.observe(stage); resize(); startLoop();

    const sparks = (x, y, c, n, spd = 1, gy = .06) => { if (S.reduced) return; for (let i = 0; i < n && W.sparks.length < 240; i++) { const a = Math.random() * Math.PI * 2, v = (1 + Math.random() * 5) * spd; W.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, gy, life: 0, max: 30 + Math.random() * 45, s: 2 + Math.random() * 3, c: Math.random() < .3 ? '#fff' : c }); } };
    const wave = (x, y, c, max) => { if (!S.reduced) W.waves.push({ x, y, r: 8, max: max || Math.max(Wd, Ht) * .6, c, a: 1 }); };

    /* ---------- run control ---------- */
    let RUN = 0, tapRes = null, holdAction = null, done = false;
    const ABORT = Symbol('abort');
    function ctxNew() {
      const id = ++RUN;
      return {
        alive: () => id === RUN && !S.destroyed,
        wait(ms) { return new Promise((res, rej) => setTimeout(() => id === RUN && !S.destroyed ? res() : rej(ABORT), ms)); },
        tap() { return new Promise((res, rej) => { tapRes = () => { tapRes = null; id === RUN && !S.destroyed ? res() : rej(ABORT); }; }); },
        tween(obj, key, to, ms, ease = easeIO) { const from = obj[key]; if (S.reduced) ms = Math.min(ms, 120); return new Promise((res, rej) => { const t0 = performance.now(); const f = now => { if (id !== RUN || S.destroyed) return rej(ABORT); const k = clamp((now - t0) / ms); obj[key] = from + (to - from) * ease(k); if (k < 1) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }); }
      };
    }
    // Taps count anywhere on the page (not just the stage, which can sit partly off screen), except on
    // controls, links, form fields, the header and the chat. Only while the opening is mostly in view.
    const IGNORE = 'button,a,input,textarea,select,label,summary,[role=button],[contenteditable],header,nav,dialog,.cb-chat,[class*="cb-chat"]';
    const inView = () => { if (!root.isConnected) return false; const r = stage.getBoundingClientRect(); const vis = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0); return vis > Math.min(r.height, innerHeight) * .35; };
    const pageTap = e => !S.destroyed && !e.target.closest?.(IGNORE) && (stage.contains(e.target) || inView());
    on(document, 'click', e => { if (tapRes && e.button === 0 && pageTap(e)) tapRes(); });
    on(stage, 'keydown', e => { if (e.key !== 'Enter' && e.key !== ' ') return; if (e.target !== stage) return; e.preventDefault(); if (holdAction) holdAction(); else tapRes?.(); });
    on(stage, 'pointermove', e => { if (S.reduced) return; const n = stage.querySelector('.cbd-card'); if (!n || n.getAnimations().length) return; const r = n.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; n.style.transform = `rotateY(${x * 18}deg) rotateX(${-y * 14}deg)`; const sh = n.querySelector('.cbd-sheen'); if (sh) sh.style.backgroundPosition = `${50 + x * 140}% 0`; });
    const setHint = h => { hint.innerHTML = h || ''; };
    const center = node => { const s = stage.getBoundingClientRect(), r = node.getBoundingClientRect(); return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2, w: r.width, h: r.height }; };
    function scramble(node, text, ms = 420) { if (S.reduced) { node.textContent = text; return; } const t0 = performance.now(); const f = now => { if (S.destroyed) return; const k = clamp((now - t0) / ms), n = Math.floor(k * text.length); let s = text.slice(0, n); for (let i = n; i < text.length; i++) s += text[i] === ' ' ? ' ' : GLY[Math.floor(Math.random() * GLY.length)]; node.textContent = s; if (k < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); }
    const readout = t => scramble(ro, t, 300);
    function place(n) { n.style.left = (L.cx - L.cw / 2) + 'px'; n.style.top = (L.cy - L.ch / 2) + 'px'; n.style.width = L.cw + 'px'; n.style.height = L.ch + 'px'; }

    /* ---------- phases ---------- */
    async function bay(ctx) {
      const im = await loadImg(packSrc);
      if (!ctx.alive()) throw ABORT;
      W.pack = { im, xr: xray(im, packSrc) };
      ctx.tween(W, 'packAlpha', 1, 500, easeOut);
      readout(sample ? 'DEMO PACK IN BAY' : 'PACK IN BAY');
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'cbd-hold';
      btn.innerHTML = '<i></i><span>Tap or Hold to Open</span>';
      stage.append(btn);
      setHint('');
      await new Promise((res, rej) => {
        // Tap or hold anywhere on the stage. A tap opens right away (the meter races to full);
        // a drag of more than a few pixels, or the browser taking the touch for a scroll, cancels.
        let t0 = 0, held = false, last = -1, af = 0, sx = 0, sy = 0, pid = null, fast = false, closed = false;
        const fill = btn.querySelector('i'), HOLD = S.reduced ? 300 : 700, MOVE = 12;
        const finish = () => { held = false; closed = true; holdAction = null; vib(25); res(); };
        const step = now => { if (!held) return; if (!ctx.alive()) return rej(ABORT); const k = clamp((now - t0) / (fast ? 220 : HOLD)); fill.style.transform = `scaleX(${k})`; W.platform = k * .6; const tk = Math.floor(k * 7); if (tk !== last) { last = tk; sfx.tick(tk); } if (k >= 1) { finish(); return; } af = requestAnimationFrame(step); };
        const begin = () => { if (held || closed || !ctx.alive()) return; audio(S.sound); held = true; fast = false; last = -1; t0 = performance.now(); af = requestAnimationFrame(step); };
        const stop = () => { if (!held) return; held = false; pid = null; cancelAnimationFrame(af); fill.style.transform = 'scaleX(0)'; W.platform = 0; };
        const tapFinish = () => { if (!held) return; const k = clamp((performance.now() - t0) / HOLD); fast = true; t0 = performance.now() - k * 220; };
        on(document, 'pointerdown', e => { if (e.button > 0 || closed) return; if (e.target !== btn && !btn.contains(e.target) && !pageTap(e)) return; pid = e.pointerId; sx = e.clientX; sy = e.clientY; if (btn.contains(e.target)) e.preventDefault(); begin(); });
        on(window, 'pointermove', e => { if (held && e.pointerId === pid && Math.hypot(e.clientX - sx, e.clientY - sy) > MOVE) stop(); });
        on(window, 'pointerup', e => { if (held && e.pointerId === pid) { pid = null; tapFinish(); } });
        on(window, 'pointercancel', e => { if (e.pointerId === pid) stop(); }); on(window, 'scroll', stop, { passive: true }); // page scroll only, not chat/feeds scrolling themselves
        on(btn, 'keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); e.stopPropagation(); begin(); tapFinish(); } });
        // Keyboard on the stage, or assistive tech clicking the button, opens without holding.
        holdAction = () => { holdAction = null; closed = true; sfx.musicOn(); res(); };
        on(btn, 'click', e => { if (e.detail === 0 && !closed) { holdAction = null; closed = true; sfx.musicOn(); res(); } });
      });
      btn.remove();
      sfx.musicOn(); sfx.charge(); readout(sample ? 'CHARGING · DEMO' : 'CHARGING');
      // Cardbits stream from the wallet into the bay (a demo spends none, so nothing flies).
      const wallet = document.querySelector('.cb-wallet-link .cb-balance');
      if (!sample && wallet && !S.reduced) { const s = stage.getBoundingClientRect(), r = wallet.getBoundingClientRect(); const fx = clamp(r.left - s.left + r.width / 2, 0, Wd), fy = Math.max(-40, r.top - s.top + r.height / 2); for (let i = 0; i < 44; i++) W.flies.push({ sx: fx + (Math.random() - .5) * 30, sy: fy, tx: L.cx + (Math.random() - .5) * L.pw * .7, ty: L.cy + (Math.random() - .5) * L.ph * .6, dur: 34 + Math.random() * 12, delay: i * 1.1, curve: (Math.random() - .5) * 140, s: 3 + Math.random() * 3, c: i % 4 ? CY : '#fff', life: 0 }); for (let i = 0; i < 8; i++) setTimeout(() => sfx.coin(i), i * 90); }
      await ctx.tween(W, 'platform', 1, 900);
    }
    async function scanAndCompress(ctx) {
      const n = cards.length;
      readout('SCANNING'); W.scanOn = true; sfx.scan(1.15);
      let shown = 0; const counter = setInterval(() => { const c = Math.min(n, Math.floor(W.scan * n + .2)); if (c > shown) { shown = c; ro.textContent = `SCANNING · ${c} CARD${c > 1 ? 'S' : ''} FOUND`; sfx.tick(c * 2); } }, 40);
      try { await ctx.tween(W, 'scan', 1, 1150, k => k); } finally { clearInterval(counter); }
      W.scanOn = false; sfx.detect(); readout(`${n} CARD${n > 1 ? 'S' : ''} DETECTED`); await ctx.wait(420);
      readout('COMPRESSING'); sfx.implode();
      const box = W.pack.box || { x: L.cx - L.pw / 2, y: L.cy - L.ph / 2 };
      if (W.pack.im && !S.reduced) {
        let px = null; const cols = 20, rows = Math.round(cols * 1520 / 842);
        try { const sc = document.createElement('canvas'); sc.width = cols; sc.height = rows; const sg = sc.getContext('2d'); sg.drawImage(W.pack.im, 0, 0, cols, rows); px = sg.getImageData(0, 0, cols, rows).data; } catch { px = null; }
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
          const k = (y * cols + x) * 4; if (px && px[k + 3] < 80) continue;
          const bx = box.x + (x + .5) * L.pw / cols, by = box.y + (y + .5) * L.ph / rows, dx = bx - L.cx, dy = by - L.cy;
          const col = px ? (Math.random() < .5 ? `rgb(${px[k]},${px[k + 1]},${px[k + 2]})` : `rgb(${80 + px[k] * .3},${200 + px[k + 1] * .2},210)`) : (Math.random() < .3 ? '#fff' : CY);
          W.bits.push({ x: bx, y: by, vx: dx * .025 + (Math.random() - .5) * 3, vy: dy * .025 + (Math.random() - .5) * 3, out: 6 + Math.random() * 10, life: 0, s: L.pw / cols * .55, c: col });
        }
      }
      W.core.a = 1; W.core.r = 4; W.core.color = CY; W.packAlpha = 0;
      await ctx.wait(S.reduced ? 150 : 620); W.shake = 10; vib(30); wave(L.cx, L.cy, CY, L.R * 2.4); sparks(L.cx, L.cy, CY, 30, 1.2, 0);
      await ctx.wait(S.reduced ? 100 : 500); W.bits.length = 0; if (W.core.r < L.R * .12) W.core.r = L.R * .14;
    }
    async function signal(ctx, c, i) {
      const R = W.ring, rk = c.rank, n = cards.length;
      readout(n > 1 ? `DECODING CARD ${i + 1} / ${n}` : 'DECODING');
      Object.assign(R, { a: 0, scale: .6, locked: 0, final: null, flicker: -1, shatter: 0, seekOn: true, seek: -Math.PI / 2 });
      ctx.tween(R, 'a', 1, 300, easeOut); ctx.tween(R, 'scale', 1, 500, easeOut);
      tierlab.style.top = (L.cy + L.R + Math.max(18, L.R * .16)) + 'px'; tierlab.style.setProperty('--tc', '#8fa9ae'); tierTxt.textContent = '······'; tierlab.classList.add('on');
      if (!S.reduced) { sfx.search(.55); await ctx.tween(R, 'seek', R.seek + Math.PI * 3, 620, easeOut); }
      const segA = k => -Math.PI / 2 + k * (Math.PI * 2 / 5) + Math.PI / 5;
      for (let k = 0; k <= rk; k++) {
        let target = segA(k); while (target < R.seek) target += Math.PI * 2; if (target - R.seek > Math.PI * 1.2) target -= Math.PI * 2;
        await ctx.tween(R, 'seek', Math.max(target, R.seek), k < 2 ? 220 : 300 + k * 110, easeIO);
        R.locked = k + 1; const col = tc(TIERS[k]); W.core.color = col; sfx.lock(k); vib(12 + k * 10);
        tierlab.style.setProperty('--tc', col); scramble(tierTxt, TIERS[k].toUpperCase(), 220);
        sparks(L.cx + Math.cos(R.seek) * L.R, L.cy + Math.sin(R.seek) * L.R, col, 8 + k * 6, .8, 0);
        if (k >= 2) W.core.r *= 1.1;
        if (k >= 3) { ctx.tween(W, 'dim', 1, 400); wave(L.cx, L.cy, col, L.R * 2); W.shake = 4 + k * 2; }
        await ctx.wait(k >= 2 ? 240 : 120);
      }
      if (rk >= 1 && rk < 4 && !S.reduced) {
        let target = segA(rk + 1); while (target < R.seek) target += Math.PI * 2;
        await ctx.tween(R, 'seek', target - .22, 700, easeOut); R.flicker = rk + 1; await ctx.wait(480); R.flicker = -1; sfx.miss(); vib(8); ro.textContent = 'SIGNAL CAPPED';
        await ctx.tween(R, 'seek', target - .7, 260, easeOut);
      }
      R.seekOn = false; R.final = tc(c.tier || 'Common');
      if (rk === 4) { readout('LEGENDARY SIGNAL'); W.beamColor = R.final; ctx.tween(W, 'beams', 1, 500); W.shake = 16; vib([40, 30, 80]); wave(L.cx, L.cy, '#fff'); await ctx.wait(300); await ctx.tween(R, 'shatter', 1.4, 600, easeOut); R.a = 0; }
      else { await ctx.wait(260); await ctx.tween(R, 'scale', .15, 320, k => k * k); R.a = 0; }
      W.core.r *= 1.6; await ctx.wait(80); W.core.a = 0; wave(L.cx, L.cy, '#fff', L.ch); tierlab.classList.remove('on');
    }
    function bitsChip(cls) { return '<span class="' + cls + '">' + (BITS_ICON ? '<img alt="Cardbits" src="' + esc(BITS_ICON) + '">' : '<small>Cardbits</small>') + '<em>0</em></span>'; }
    // Animated count-up with coin ticks; ends with a tier-colored pop.
    function countUp(node, from, to, ms, rank = 0, quiet = false) {
      const em = node.querySelector('em') || node;
      if (S.reduced || ms <= 0) { em.textContent = fmtBits(to); node.classList.add('pop'); return Promise.resolve(); }
      node.classList.remove('pop'); node.classList.add('counting');
      return new Promise(res => {
        const t0 = performance.now(); let lastTick = 0, i = 0;
        const f = now => {
          if (S.destroyed || !node.isConnected) return res();
          const k = clamp((now - t0) / ms); em.textContent = fmtBits(lerp(from, to, easeOut(k)));
          if (!quiet && now - lastTick > 75 && k < 1) { lastTick = now; sfx.coin(Math.min(12, i++)); }
          if (k < 1) requestAnimationFrame(f);
          else { node.classList.remove('counting'); void node.offsetWidth; node.classList.add('pop'); if (!quiet) sfx.tick(rank); res(); }
        };
        requestAnimationFrame(f);
      });
    }
    function cardNode(c, flash) {
      const n = document.createElement('div');
      n.className = 'cbd-card r' + c.rank; n.style.setProperty('--tc', tc(c.tier || 'Common'));
      n.innerHTML = '<div class="cbd-face">' + (c.image ? '<img alt="' + esc(c.name) + '" src="' + esc(c.image) + '">' : '<span class="cbd-noimg">' + esc(c.name) + '</span>') + '<i class="cbd-sheen"></i></div>' + (flash ? '<div class="cbd-flash"></div>' : '') +
        '<div class="cbd-tag"><span class="cbd-tagrow"><span class="cbd-pill"></span>' + (bitsOf(c) ? bitsChip('cbd-bits') : '') + '</span><b></b></div>';
      place(n); stage.append(n); return n;
    }
    async function print(ctx, c) {
      const rk = c.rank, col = tc(c.tier || 'Common'); readout('PRINTING');
      W.raster = { im: upright(await loadImg(c.image)), line: 0, color: col, glitch: 0 }; const R = W.raster; const dur = [560, 680, 820, 1150, 1550][rk]; sfx.print(dur / 1000, rk);
      const lineFx = setInterval(() => { if (!S.reduced && W.raster) sparks(L.cx - L.cw / 2 + Math.random() * L.cw, L.cy - L.ch / 2 + L.ch * R.line, col, 2, .5, .02); }, 40);
      try {
        if (rk >= 3) { await ctx.tween(R, 'line', .42, dur * .4, k => k); R.glitch = 1; sfx.glitch(); W.shake = 5; await ctx.wait(110); R.line = .34; R.glitch = 0; await ctx.tween(R, 'line', .72, dur * .3, k => k); R.glitch = 1; sfx.glitch(); await ctx.wait(90); R.glitch = 0; await ctx.tween(R, 'line', 1, dur * .3, k => k); }
        else await ctx.tween(R, 'line', 1, dur, k => k);
      } finally { clearInterval(lineFx); }
      const n = cardNode(c, true); W.raster = null;
      scramble(n.querySelector('.cbd-pill'), (c.tier || '').toUpperCase(), 360); scramble(n.querySelector('b'), c.name || 'Card', 520);
      revealBurst(rk); sfx.stinger(rk); sparks(L.cx, L.cy, col, [8, 18, 36, 70, 130][rk], [.6, .8, 1, 1.3, 1.7][rk]); if (rk >= 2) wave(L.cx, L.cy, col, L.ch * 1.3);
      if (rk >= 3) { vib(rk === 4 ? [60, 40, 120] : 60); const bt = rk === 4 ? 'LEGENDARY PULL' : 'EPIC PULL'; banner.style.setProperty('--tc', col); banner.style.setProperty('--chars', bt.length); banner.className = 'cbd-banner'; banner.textContent = bt; void banner.offsetWidth; banner.classList.add('on'); scramble(banner, bt, 480); }
      readout((c.tier || 'CARD').toUpperCase() + ' · DECODED');
      const chip = n.querySelector('.cbd-bits');
      if (chip) setTimeout(() => { if (S.destroyed || !chip.isConnected) return; chip.classList.add('on'); countUp(chip, 0, bitsOf(c), [520, 650, 800, 1100, 1400][rk], rk).then(() => { if (!S.reduced && chip.isConnected) { const p = center(chip); sparks(p.x, p.y, col, [6, 8, 12, 20, 32][rk], .6, .02); } }); }, S.reduced ? 0 : 420);
      return n;
    }
    async function toRow(ctx, n, i, c) {
      const s = rowEl.children[i]; if (!s) { n.remove(); return; }
      const a = center(n), b = center(s); n.style.transform = ''; sfx.whoosh();
      if (S.reduced) await n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished;
      else await n.animate([{ transform: 'none' }, { transform: `translate(${b.x - a.x}px,${b.y - a.y}px) scale(${b.h / a.h})`, opacity: .85 }], { duration: 400, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' }).finished;
      if (!ctx.alive()) throw ABORT;
      n.remove(); s.classList.remove('sleeved'); s.style.backgroundImage = ''; s.classList.add('filled'); s.style.setProperty('--tc', tc(c.tier || 'Common')); s.innerHTML = c.image ? '<img alt="" src="' + esc(c.image) + '">' : ''; sfx.tick(i);
    }
    async function reform(ctx) {
      readout('RE-SYNC'); W.core.a = 1; W.core.r = 3; W.core.color = CY;
      if (!S.reduced) for (let i = 0; i < 70; i++) { const a = Math.random() * Math.PI * 2, r = Math.max(Wd, Ht) * .6; W.flies.push({ sx: L.cx + Math.cos(a) * r, sy: L.cy + Math.sin(a) * r, tx: L.cx, ty: L.cy, dur: 26 + Math.random() * 10, delay: Math.random() * 8, curve: (Math.random() - .5) * 80, s: 3, c: i % 3 ? CY : '#fff', life: 0 }); }
      sfx.whoosh(); await ctx.tween(W.core, 'r', L.R * .14, 520, easeOut);
    }
    async function run(ctx) {
      rowEl.replaceChildren(...cards.map(() => Object.assign(document.createElement('div'), { className: 'cbd-slot' })));
      sleeveSlots(); await bay(ctx); await scanAndCompress(ctx);
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        if (i > 0) { setHint(`<i>Tap</i> to Decode · ${i + 1} of ${cards.length}`); await ctx.tap(); setHint(''); await reform(ctx); }
        await signal(ctx, c, i); const n = await print(ctx, c);
        await ctx.wait(c.rank >= 3 ? 1500 : 650);
        setHint(i < cards.length - 1 ? '<i>Tap</i> for Next Card' : '<i>Tap</i> for Results'); await ctx.tap(); setHint('');
        ctx.tween(W, 'dim', 0, 400).catch(() => {}); ctx.tween(W, 'beams', 0, 400).catch(() => {});
        await toRow(ctx, n, i, c);
      }
      finish(false);
    }

    /* ---------- results ---------- */
    function finish(instant) {
      if (done || S.destroyed) return; done = true; RUN++; tapRes = null; holdAction = null;
      sfx.musicOff(); npEl?.remove(); Object.assign(W, { dim: 0, beams: 0, raster: null, packAlpha: 0, scanOn: false }); W.core.a = 0; W.ring.a = 0; W.bits.length = 0;
      stage.querySelectorAll('.cbd-card,.cbd-hold').forEach(n => n.remove()); tierlab.classList.remove('on'); setHint(''); rowEl.replaceChildren(); ro.textContent = '';
      skipBtn.hidden = true;
      const box = document.createElement('div'); box.className = 'cbd-summary';
      const total = cards.reduce((a, c) => a + bitsOf(c), 0);
      box.innerHTML = '<h2>Your ' + esc(name) + ' Pulls</h2><div class="cbd-pulls"></div>' + (total ? '<div class="cbd-total"><span>Total Cardbit Value</span>' + bitsChip('cbd-bits cbd-sum') + '</div>' : '') + '<div class="cbd-rewards"></div><div class="cbd-acts"></div>';
      stage.append(box); void box.offsetWidth; box.classList.add('on');
      const pulls = box.querySelector('.cbd-pulls');
      cards.forEach((c, i) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'cbd-pull'; b.style.setProperty('--tc', tc(c.tier || 'Common'));
        const v = bitsOf(c);
        b.innerHTML = (c.image ? '<img alt="" src="' + esc(c.image) + '">' : '<span class="cbd-noimg"></span>') + (v ? '<i class="cbd-pv">' + (BITS_ICON ? '<img alt="" src="' + esc(BITS_ICON) + '">' : '') + fmtBits(v) + '</i>' : '') + '<span><b>' + esc(c.tier || '') + '</b>' + esc(c.name || 'Card') + '</span>';
        b.setAttribute('aria-label', [c.name, c.tier, v ? fmtBits(v) + ' Cardbits' : ''].filter(Boolean).join(', '));
        if (options.onInspect) on(b, 'click', () => options.onInspect(c)); else b.disabled = true;
        pulls.append(b);
        if (instant || S.reduced) b.classList.add('in'); else setTimeout(() => { if (!S.destroyed) { b.classList.add('in'); sfx.tick(c.rank); } }, 120 + i * 110);
      });
      // The total tallies up as the pulls land, then pops with a burst.
      const sum = box.querySelector('.cbd-sum');
      if (sum) {
        if (instant || S.reduced) { sum.querySelector('em').textContent = fmtBits(total); sum.classList.add('pop'); }
        else {
          const top = Math.max(0, ...cards.map(c => c.rank));
          setTimeout(() => { if (S.destroyed || !sum.isConnected) return; countUp(sum, 0, total, Math.min(2200, 700 + cards.length * 160), top).then(() => { if (S.destroyed || !sum.isConnected) return; const p = center(sum); sparks(p.x, p.y, tc(TIERS[top] || 'Common'), 34, 1, .02); sfx.stinger(Math.min(2, top)); }); }, 160 + cards.length * 110);
        }
      }
      // Server-side XP and Sparks for this opening (the site's own component).
      let rewards = null; try { rewards = options.onSpread?.() || null; } catch { rewards = null; }
      if (rewards) {
        box.querySelector('.cbd-rewards').append(rewards);
        const sp = rewards.querySelector?.('.cbpr-sparks:not(.is-none)');
        if (sp && !instant && !S.reduced) setTimeout(() => { if (S.destroyed) return; const p = center(sp); sparks(p.x - p.w / 3, p.y, '#ffb65c', 40, 1.1, .03); for (let i = 0; i < 8; i++) setTimeout(() => sfx.spark(i), i * 70); }, 1700);
      }
      const acts = box.querySelector('.cbd-acts');
      const primary = document.createElement('button'); primary.type = 'button'; primary.className = 'cbd-btn cbd-primary'; primary.textContent = options.finishLabel || 'View My Vault';
      on(primary, 'click', () => options.onFinish?.()); acts.append(primary);
      if (options.onShare) { const sh = document.createElement('button'); sh.type = 'button'; sh.className = 'cbd-btn'; sh.textContent = 'Share'; on(sh, 'click', () => options.onShare()); acts.append(sh); }
      const again = document.createElement('button'); again.type = 'button'; again.className = 'cbd-btn'; again.textContent = 'Watch Again';
      on(again, 'click', () => { box.remove(); done = false; skipBtn.hidden = false; start(); }); acts.append(again);
      primary.focus({ preventScroll: true });
    }

    async function start() {
      Object.assign(W, { packAlpha: 0, scan: 0, scanOn: false, platform: 0, dim: 0, beams: 0, shake: 0, raster: null });
      W.core = { a: 0, r: 0, color: CY }; W.ring = { a: 0, scale: 1, locked: 0, seek: -Math.PI / 2, seekOn: false, flicker: -1, final: null, shatter: 0 };
      W.bits.length = W.flies.length = W.sparks.length = W.waves.length = 0;
      const ctx = ctxNew();
      try { await run(ctx); } catch (e) { if (e !== ABORT) { console.error(e); finish(true); } }
    }
    start();

    const player = {
      destroy() { if (S.destroyed) return; S.destroyed = true; RUN++; sfx.musicOff(); events.abort(); io.disconnect(); rs.disconnect(); root.remove(); },
      skip() { finish(true); }
    };
    return player;
  }

  // The player object is frozen, so swap in a frozen copy that keeps its other helpers.
  window.CardbitOpening = Object.freeze({
    ...window.CardbitOpening,
    mount(host, options) { try { return mount(host, options); } catch (e) { console.error(e); return original(host, options); } }
  });
  window.CardbitDecodeOpening = Object.freeze({ mount });
})();
