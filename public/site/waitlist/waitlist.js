/* Cardbit coming-soon waitlist: motion + signup. No libraries.
 * - Hero: headline split, cursor tilt + holo on the pack, looping rip → rise → flip reveal, pack swaps.
 * - Pinned How It Works scenes driven by scroll progress.
 * - 3D pack carousel (buttons, dots, arrows, swipe), reveals, Daily Spin reel / XP / shuffle demos (visual only).
 * - POST /api/waitlist, success state with confetti; consent-gated Lead event if an ad pixel is loaded.
 * Everything respects prefers-reduced-motion. */
(() => {
  const d = document;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = d) => r.querySelector(s);
  const $$ = (s, r = d) => Array.from(r.querySelectorAll(s));
  const fine = matchMedia('(pointer: fine)').matches;
  d.documentElement.classList.remove('no-js');

  /* ---------- headline split ---------- */
  const h1 = $('[data-wl-split]');
  if (h1 && !reduce) {
    const words = h1.textContent.trim().split(/\s+/);
    h1.setAttribute('aria-label', h1.textContent.trim());
    h1.innerHTML = words.map((w, i) => `<span class="w" aria-hidden="true"><span style="--d:${i}">${w}</span></span>`).join(' ');
  }

  /* ---------- header ---------- */
  const top = $('[data-wl-top]');
  const onScrollTop = () => top && top.classList.toggle('is-scrolled', scrollY > 20);
  addEventListener('scroll', onScrollTop, { passive: true });
  onScrollTop();
  $$('[data-wl-jump], .wl-skip').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const join = $('#join');
    join.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => { const f = $('input[name=email]', join); f && f.focus({ preventScroll: true }); }, reduce ? 0 : 600);
  }));

  /* ---------- background sparks ---------- */
  const cv = $('[data-wl-sparks]');
  if (cv && !reduce) {
    const ctx = cv.getContext('2d');
    let w, h, dots = [];
    const size = () => {
      const r = Math.min(devicePixelRatio || 1, 2);
      w = cv.width = innerWidth * r; h = cv.height = innerHeight * r;
      dots = Array.from({ length: Math.round(Math.min(70, innerWidth / 18)) }, () => ({
        x: Math.random() * w, y: Math.random() * h, r: (Math.random() * 1.6 + .4) * r, s: Math.random() * .35 + .08, t: Math.random() * 6.28,
        c: ['0,230,225', '255,182,92', '139,92,255', '255,255,255'][Math.floor(Math.random() * 4)],
      }));
    };
    size();
    addEventListener('resize', size);
    let raf;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of dots) {
        p.y -= p.s; p.t += .02;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        ctx.beginPath();
        ctx.fillStyle = `rgba(${p.c},${(Math.sin(p.t) + 1) * .35 + .1})`;
        ctx.arc(p.x + Math.sin(p.t) * 6, p.y, p.r, 0, 6.283);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    d.addEventListener('visibilitychange', () => { cancelAnimationFrame(raf); if (!d.hidden) tick(); });
  }

  /* ---------- hero pack: tilt + holo ---------- */
  const stage = $('[data-wl-stage]');
  const rip = $('[data-wl-rip]');
  if (stage && rip && fine && !reduce) {
    stage.addEventListener('pointermove', (e) => {
      const r = stage.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      rip.style.setProperty('--ry', (x * 26).toFixed(2) + 'deg');
      rip.style.setProperty('--rx', (-y * 18).toFixed(2) + 'deg');
      rip.style.setProperty('--sx', (50 + x * 80).toFixed(1) + '%');
    });
    stage.addEventListener('pointerleave', () => { rip.style.setProperty('--ry', '0deg'); rip.style.setProperty('--rx', '0deg'); });
  }

  /* ---------- hero rip loop ---------- */
  const A = window.CardbitWaitlist || {};
  const packs = A.packs || [];
  const rips = A.rips || [], backs = A.backs || [];
  if (rip && !reduce && packs.length) {
    let n = 0;
    const body = $('.wl-rip__body', rip), topEl = $('.wl-rip__top', rip), shine = $('.wl-rip__shine', rip);
    const fronts = $$('[data-wl-front]', rip), backEls = $$('[data-wl-back]', rip);
    const setPack = (i) => {
      const url = `url('${packs[i % packs.length]}')`;
      [body, topEl].forEach((el) => el.style.setProperty('--art', url));
      shine.style.setProperty('--art-mask', url);
    };
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const run = async () => {
      for (;;) {
        rip.dataset.phase = 'idle';
        await wait(2600);
        rip.dataset.phase = 'tear';
        await wait(650);
        rip.dataset.phase = 'rise';
        await wait(900);
        rip.dataset.phase = 'flip';
        await wait(3400);
        rip.dataset.phase = 'reset';
        await wait(520);
        n++;
        setPack(n);
        // Each pack shows pulls its rules allow (and the Japanese card back for Japanese).
        const pulls = rips[n % rips.length] || [], back = backs[n % backs.length];
        fronts.forEach((f, k) => { if (pulls[k]) f.src = pulls[k]; });
        if (back) backEls.forEach((b) => { b.src = back; });
        rip.dataset.phase = 'enter';
        await wait(700);
      }
    };
    // Only animate while visible.
    let started = false;
    new IntersectionObserver(([en]) => {
      if (en.isIntersecting && !started) { started = true; run(); }
    }).observe(rip);
    setPack(0);
  }

  /* ---------- count-up ---------- */
  $$('[data-wl-count]').forEach((el) => {
    if (reduce) return;
    const to = +el.dataset.wlCount, t0 = performance.now() + 900, dur = 1400;
    const fmt = (x) => Math.round(x).toLocaleString('en-US');
    el.textContent = '0';
    const step = (t) => {
      const p = Math.min(1, Math.max(0, (t - t0) / dur));
      el.textContent = fmt(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  /* ---------- reveals ---------- */
  const io = new IntersectionObserver((ents) => ents.forEach((en) => {
    if (!en.isIntersecting) return;
    en.target.classList.add('is-in');
    io.unobserve(en.target);
  }), { rootMargin: '0px 0px -10% 0px', threshold: .12 });
  $$('[data-wl-reveal]').forEach((el) => io.observe(el));

  /* ---------- how it works (pinned scroll) ---------- */
  const how = $('[data-wl-how]');
  const hs = $('[data-wl-how-stage]');
  const steps = $$('[data-wl-step]');
  const rail = $('[data-wl-rail]');
  const setScene = (i) => {
    if (!hs || hs.dataset.scene === String(i)) return;
    hs.dataset.scene = String(i);
    steps.forEach((s, k) => s.classList.toggle('is-on', k === i));
  };
  if (how && hs) {
    if (reduce) {
      steps.forEach((s) => s.classList.add('is-on'));
      hs.dataset.scene = '0';
    } else {
      setScene(0); steps[0].classList.add('is-on');
      const onScroll = () => {
        const r = how.getBoundingClientRect();
        const total = r.height - innerHeight;
        const p = Math.min(1, Math.max(0, -r.top / total));
        if (rail) rail.style.setProperty('--p', p.toFixed(3));
        setScene(Math.min(steps.length - 1, Math.floor(p * steps.length * .999)));
      };
      addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
    // Clicking a step jumps there.
    steps.forEach((s, i) => s.addEventListener('click', () => {
      if (reduce) return;
      const r = how.getBoundingClientRect();
      const total = r.height - innerHeight;
      scrollTo({ top: scrollY + r.top + total * ((i + .5) / steps.length), behavior: 'smooth' });
    }));
  }

  /* ---------- pack carousel ---------- */
  const car = $('[data-wl-carousel]');
  if (car) {
    const items = $$('.wl-packcard', car);
    const dots = $$('[data-wl-dots] button');
    let at = 0;
    const show = (i) => {
      at = (i + items.length) % items.length;
      items.forEach((el, k) => {
        let o = k - at;
        if (o > items.length / 2) o -= items.length;
        if (o < -items.length / 2) o += items.length;
        el.style.setProperty('--o', o);
        el.style.setProperty('--ao', Math.abs(o));
        el.classList.toggle('is-active', o === 0);
        el.setAttribute('aria-hidden', o === 0 ? 'false' : 'true');
      });
      dots.forEach((b, k) => b.setAttribute('aria-current', k === at ? 'true' : 'false'));
    };
    show(0);
    $('[data-wl-prev]').addEventListener('click', () => { show(at - 1); stop(); });
    $('[data-wl-next]').addEventListener('click', () => { show(at + 1); stop(); });
    dots.forEach((b) => b.addEventListener('click', () => { show(+b.dataset.i); stop(); }));
    items.forEach((el, k) => el.addEventListener('click', () => { show(k); stop(); }));
    car.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { show(at - 1); stop(); e.preventDefault(); }
      if (e.key === 'ArrowRight') { show(at + 1); stop(); e.preventDefault(); }
    });
    let x0 = null;
    car.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
    car.addEventListener('pointerup', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) { show(at + (dx < 0 ? 1 : -1)); stop(); }
    });
    let auto = reduce ? null : setInterval(() => show(at + 1), 3800);
    const stop = () => { if (auto) { clearInterval(auto); auto = null; } };
    car.addEventListener('focusin', stop);
  }

  /* ---------- play demos (visual only; nothing is awarded) ---------- */
  const reel = $('[data-wl-reel]'), xp = $('[data-wl-xp]'), lvl = $('[data-wl-level]'), shuffle = $('[data-wl-shuffle]'), hash = $('[data-wl-hash]');
  const once = (el, fn) => {
    if (!el) return;
    const o = new IntersectionObserver(([en]) => { if (en.isIntersecting) { fn(); o.disconnect(); } }, { threshold: .4 });
    o.observe(el);
  };
  // Daily Spin: the same prize reel as the real spin (tiles slide under the marker and stop on one).
  once(reel, () => {
    const track = $('[data-wl-reel-track]', reel);
    const tiles = $$('.wl-tile', track);
    if (!track || tiles.length < 12) return;
    const step = () => tiles[1].offsetLeft - tiles[0].offsetLeft;
    const at = (i) => reel.clientWidth / 2 - (tiles[i].offsetLeft + tiles[i].offsetWidth / 2);
    // Land on a card, then Sparks, then a card, then XP... always near the end of the strip.
    const order = ['card', 'sparks', 'card', 'xp'];
    let k = 0;
    const target = () => {
      const want = order[k++ % order.length];
      const ok = tiles.map((t, i) => i).filter((i) => i >= tiles.length - 12 && i < tiles.length - 3 && tiles[i].dataset.k === want);
      return ok[Math.floor(Math.random() * ok.length)] ?? tiles.length - 6;
    };
    const place = (x, ms) => { track.style.transition = ms ? `transform ${ms}ms cubic-bezier(.08,.6,.12,1)` : 'none'; track.style.transform = `translateX(${x}px)`; };
    if (reduce) { const i = target(); tiles[i].classList.add('is-winner'); place(at(i), 0); return; }
    const spin = () => {
      tiles.forEach((t) => t.classList.remove('is-winner'));
      place(at(2), 0);
      void track.offsetWidth;
      const i = target();
      const jitter = (Math.random() - 0.5) * (step() - 30);
      place(at(i) + jitter, 4200);
      setTimeout(() => { place(at(i), 250); tiles[i].classList.add('is-winner'); }, 4250);
    };
    spin();
    setInterval(spin, 7000);
  });
  once(xp, () => {
    xp.style.width = '72%';
    if (reduce) return;
    setTimeout(() => { xp.style.width = '100%'; }, 1800);
    setTimeout(() => { if (lvl) lvl.textContent = '8'; xp.style.transition = 'none'; xp.style.width = '0'; xp.offsetWidth; xp.style.transition = ''; xp.style.width = '34%'; }, 3500);
  });
  once(shuffle, () => {
    if (reduce) return;
    shuffle.classList.add('is-live');
    const hex = '0123456789abcdef';
    const rnd = () => Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => hex[Math.floor(Math.random() * 16)]).join('')).join('·');
    setInterval(() => { if (hash) hash.textContent = rnd(); }, 3600);
  });

  /* ---------- confetti ---------- */
  function confetti(from) {
    if (reduce) return;
    const c = d.createElement('canvas');
    c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60';
    d.body.appendChild(c);
    const r = Math.min(devicePixelRatio || 1, 2);
    c.width = innerWidth * r; c.height = innerHeight * r;
    const g = c.getContext('2d');
    const box = from.getBoundingClientRect();
    const ox = (box.left + box.width / 2) * r, oy = (box.top + 80) * r;
    const colors = ['#00e6e1', '#ffb65c', '#4057f5', '#8b5cff', '#ffffff', '#ff6fb5'];
    const ps = Array.from({ length: 160 }, () => {
      const a = Math.random() * Math.PI * 2, s = (Math.random() * 9 + 4) * r;
      return { x: ox, y: oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 7 * r, w: (Math.random() * 7 + 4) * r, h: (Math.random() * 4 + 3) * r, rot: Math.random() * 6, vr: Math.random() * .3 - .15, c: colors[Math.floor(Math.random() * colors.length)], life: 1 };
    });
    const t0 = performance.now();
    const frame = (t) => {
      g.clearRect(0, 0, c.width, c.height);
      for (const p of ps) {
        p.vy += .32 * r; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= .006;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = Math.max(0, p.life);
        g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2))); g.restore();
      }
      if (t - t0 < 3200) requestAnimationFrame(frame); else c.remove();
    };
    requestAnimationFrame(frame);
  }

  /* ---------- toast ---------- */
  const toast = $('[data-wl-toast]');
  let toastT;
  const say = (msg) => { if (!toast) return; toast.textContent = msg; toast.classList.add('is-on'); clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('is-on'), 2600); };

  /* ---------- signup ---------- */
  // First-touch attribution: the first visit that carried UTMs, an ad click ID or an outside referrer is kept
  // for 30 days, so a visitor who lands from an ad, browses /policies and comes back still credits the ad.
  const source = (() => {
    const KEY = 'cardbit:first-touch', DAYS30 = 30 * 864e5;
    const q = new URLSearchParams(location.search), now = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'ttclid', 'gclid'].forEach((k) => { if (q.get(k)) now[k] = q.get(k).slice(0, 200); });
    if (d.referrer && !d.referrer.startsWith(location.origin)) now.referrer = d.referrer.slice(0, 200);
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* private mode */ }
    if (saved && (!saved.at || Date.now() - saved.at > DAYS30)) saved = null;
    if (!saved && Object.keys(now).length) {
      saved = { ...now, landing: location.pathname.slice(0, 100), at: Date.now() };
      try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode */ }
    }
    if (!saved) return now;
    const { at, ...first } = saved;
    return first;
  })();
  const joined = () => { try { return localStorage.getItem('cardbit:waitlist') === '1'; } catch { return false; } };
  const markJoined = () => { try { localStorage.setItem('cardbit:waitlist', '1'); } catch { /* private mode */ } };
  // Never show a broken-image box on the success card: retry the Latch once, then hide it.
  $$('.wl-success__latch').forEach((img) => {
    let retried = false;
    const bad = () => {
      if (!retried) { retried = true; img.src = img.src.split('?')[0] + '?r=' + Date.now(); return; }
      img.hidden = true;
    };
    img.addEventListener('error', bad);
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) bad();
  });

  function showSuccess(form, data) {
    const wrap = form.parentElement;
    const ok = $('[data-wl-success]', wrap);
    if (!ok) return;
    if (data && data.status === 'already') $('[data-wl-success-title]', ok).textContent = "You're Already on the List";
    if (data && data.note) { const p = d.createElement('p'); p.textContent = data.note; ok.insertBefore(p, $('.wl-share', ok)); }
    // No phone saved: they have the email part only (400). Say so, and offer to add a number for the other 600.
    const text = $('[data-wl-success-text]', ok);
    if (data && data.phoneSaved === false && text) {
      const f = data.founding || { email: 400, sms: 600 };
      const fmt = (x) => Number(x).toLocaleString('en-US');
      text.innerHTML = '';
      text.append('Watch your inbox. When Cardbit launches, sign up with this email and make your first top-up to unlock ');
      const b = d.createElement('b'); b.textContent = fmt(f.email) + ' Cardbits'; text.append(b, '. Add your mobile number for text alerts to get ' + fmt(f.sms) + ' more.');
      if (!$('[data-wl-addphone]', ok)) {
        const add = d.createElement('button');
        add.type = 'button'; add.className = 'wl-btn wl-btn--ghost'; add.dataset.wlAddphone = '';
        add.textContent = 'Add My Number (+' + fmt(f.sms) + ')';
        add.addEventListener('click', () => {
          ok.hidden = true; form.hidden = false;
          const t = wrap.querySelector('.wl-join__title'); if (t) t.hidden = false;
          form.elements.phone.focus();
        });
        $('.wl-share', ok).prepend(add);
      }
    }
    form.hidden = true;
    ok.hidden = false;
    const title = wrap.querySelector('.wl-join__title');
    if (title) title.hidden = true;
    ok.focus({ preventScroll: true });
    confetti(ok);
  }

  $$('[data-wl-form]').forEach((form) => {
    const phone = form.elements.phone, sms = $('[data-wl-sms]', form), err = $('[data-wl-error]', form), btn = $('button[type=submit]', form);
    const syncSms = () => sms.classList.toggle('is-open', phone.value.trim() !== '');
    phone.addEventListener('input', syncSms);
    syncSms();
    const fail = (msg, field) => {
      err.textContent = msg; err.hidden = false;
      $$('input', form).forEach((i) => i.removeAttribute('aria-invalid'));
      if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      const email = form.elements.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('Enter a Valid Email Address.', form.elements.email);
      const digits = phone.value.replace(/\D/g, '');
      if (digits && !(digits.length === 10 || (digits.length === 11 && digits[0] === '1'))) return fail('Enter a 10-Digit US Mobile Number, or Leave It Blank.', phone);
      if (digits && !form.elements.smsConsent.checked) return fail('Check the Text Alerts Box to Add Your Phone Number.', form.elements.smsConsent);
      if (!form.elements.emailConsent.checked) return fail('Check the Box to Join the List and Get Cardbit Emails.', form.elements.emailConsent);
      btn.setAttribute('aria-busy', 'true');
      try {
        const res = await fetch('/api/waitlist', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ email, phone: phone.value, emailConsent: true, smsConsent: form.elements.smsConsent.checked, company: form.elements.company.value, source }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return fail(data.error || 'Something Went Wrong. Please Try Again.');
        markJoined();
        showSuccess(form, data);
        // Ad pixels load only after the visitor accepts ads, so these calls are consent-gated by construction.
        try {
          if (data.status === 'joined') {
            if (window.fbq) window.fbq('track', 'Lead', { content_name: 'Cardbit Waitlist' });
            if (window.ttq) window.ttq.track('SubmitForm', { content_name: 'Cardbit Waitlist' });
            if (window.gtag) {
              window.gtag('event', 'generate_lead', { event_category: 'waitlist' });
              // Google Ads "Waitlist Signup" conversion (label from CARDBIT_SITE_GOOGLE_ADS_LEAD_LABEL via the ads script tag).
              const ads = document.querySelector('script[data-gads-lead]');
              const aw = ads && ads.dataset.gads, label = ads && ads.dataset.gadsLead;
              if (aw && label) window.gtag('event', 'conversion', { send_to: aw + '/' + label, value: 1.0, currency: 'USD' });
            }
          }
        } catch { /* never block signup on a pixel */ }
      } catch {
        fail('No Connection. Check Your Internet and Try Again.');
      } finally {
        btn.removeAttribute('aria-busy');
      }
    });
  });

  // Returning visitor who already joined: show the badge right away (no confetti).
  if (joined()) $$('[data-wl-form]').forEach((f) => {
    const ok = $('[data-wl-success]', f.parentElement);
    if (!ok) return;
    $('[data-wl-success-title]', ok).textContent = "You're on the List";
    f.hidden = true; ok.hidden = false;
    const t = f.parentElement.querySelector('.wl-join__title'); if (t) t.hidden = true;
  });

  /* ---------- share ---------- */
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-wl-share]');
    if (!b) return;
    const data = { title: 'Cardbit is Launching Soon', text: 'Rip real Pokémon packs online. Join the Cardbit waitlist.', url: location.origin + '/' };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(data.url); say('Link Copied'); }
    } catch { /* closed share sheet */ }
  });
})();
