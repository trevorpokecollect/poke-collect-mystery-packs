/* Cardbit How It Works: live pack prices and links, the Cardbits calculator, the jump bar and scroll reveals.
   The storefront app renders the page (cardbit-storefront.js helpPage) and leaves window.cardbitHowContext. */
(() => {
  const TOPUPS = [ // [dollars, Cardbits]
    [10, 1000], [50, 5000], [100, 10500], [500, 55000]
  ];
  const fmt = n => Number(n).toLocaleString('en-US');

  // Cheapest mix of top-up packages that covers `need` Cardbits.
  function bestTopUp(need) {
    if (!(need > 0)) return null;
    let best = null;
    const max500 = Math.ceil(need / 55000);
    for (let a = 0; a <= max500; a++) {
      const left1 = Math.max(0, need - a * 55000);
      for (let b = 0; b <= Math.ceil(left1 / 10500); b++) {
        const left2 = Math.max(0, left1 - b * 10500);
        for (let c = 0; c <= Math.ceil(left2 / 5000); c++) {
          const left3 = Math.max(0, left2 - c * 5000);
          const d = Math.ceil(left3 / 1000);
          const dollars = a * 500 + b * 100 + c * 50 + d * 10;
          const bits = a * 55000 + b * 10500 + c * 5000 + d * 1000;
          if (!best || dollars < best.dollars || (dollars === best.dollars && bits > best.bits)) best = { dollars, bits, mix: [a, b, c, d] };
        }
      }
    }
    return best;
  }
  function mixLabel(mix) {
    return mix.map((n, i) => n ? (n > 1 ? n + ' × ' : '') + '$' + TOPUPS[3 - i][0] : '').filter(Boolean).join(' + ');
  }

  function initCalc(root) {
    const form = root.querySelector('[data-hiw-calc]');
    if (!form) return;
    const sel = form.querySelector('[data-hiw-calc-pack]'), qty = form.querySelector('[data-hiw-calc-qty]');
    const update = () => {
      const price = Number(sel.selectedOptions[0]?.dataset.price) || 0;
      const n = Math.min(50, Math.max(1, Math.floor(Number(qty.value) || 1)));
      const need = price * n;
      const best = bestTopUp(need);
      form.querySelector('[data-hiw-calc-need]').textContent = fmt(need);
      form.querySelector('[data-hiw-calc-buy]').textContent = best ? '$' + fmt(best.dollars) : '—';
      const note = form.querySelector('[data-hiw-calc-buy-note]');
      note.textContent = best ? mixLabel(best.mix) + ' = ' + fmt(best.bits) + ' Cardbits' : '';
    };
    sel.addEventListener('change', update);
    qty.addEventListener('input', update);
    update();
  }

  function initJump(root) {
    const links = [...root.querySelectorAll('.hiw-jump a')];
    links.forEach(a => a.addEventListener('click', e => {
      const target = root.querySelector(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      history.replaceState(null, '', a.getAttribute('href'));
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }));
    root.querySelectorAll('.hiw-loop a').forEach(a => a.addEventListener('click', e => {
      const target = root.querySelector(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }));
    if (!('IntersectionObserver' in window)) return;
    const sections = links.map(a => root.querySelector(a.getAttribute('href'))).filter(Boolean);
    const spy = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        links.forEach(a => a.setAttribute('aria-current', String(a.getAttribute('href') === '#' + en.target.id)));
        const on = links.find(a => a.getAttribute('aria-current') === 'true');
        on?.scrollIntoView({ block: 'nearest', inline: 'center' });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(s => spy.observe(s));
  }

  function initReveal(root) {
    if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const items = root.querySelectorAll('.hiw-panel, .hiw-pack, .hiw-loop li');
    const io = new IntersectionObserver(entries => entries.forEach(en => {
      if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
    }), { rootMargin: '0px 0px -8% 0px' });
    items.forEach(el => { el.setAttribute('data-hiw-in', ''); io.observe(el); });
    /* SITE */ const sweep = () => items.forEach(el => { if (!el.classList.contains('is-in') && el.getBoundingClientRect().top < innerHeight) { el.classList.add('is-in'); io.unobserve(el); } });
    /* SITE */ requestAnimationFrame(sweep); addEventListener('scroll', sweep, {passive:true}); addEventListener('resize', sweep); addEventListener('load', sweep);
    /* SITE */ const tick = setInterval(() => { if (!root.isConnected || [...items].every(el => el.classList.contains('is-in'))) clearInterval(tick); else sweep(); }, 700); // IntersectionObserver can stall (hidden or embedded views); timers still run.
    /* SITE */ addEventListener('beforeprint', () => items.forEach(el => el.classList.add('is-in')));
  }

  // Live prices and pack links from the storefront's pack list. Static copy stays if anything is missing.
  function fillPacks(root, ctx) {
    if (!ctx) return;
    (ctx.packs || []).forEach(p => {
      const slug = ctx.slug?.(p);
      if (!slug) return;
      const card = root.querySelector('[data-hiw-pack="' + slug + '"]');
      if (Number.isSafeInteger(p.priceBits) && p.priceBits > 0) {
        if (card) card.querySelector('[data-hiw-price]').textContent = fmt(p.priceBits);
        const opt = root.querySelector('[data-hiw-calc-pack] option[value="' + slug + '"]');
        if (opt) opt.dataset.price = p.priceBits;
      }
      const link = card?.querySelector('[data-hiw-odds]');
      if (link && ctx.href) link.href = ctx.href('packs/' + p.id);
    });
    if (ctx.href) root.querySelectorAll('[data-hiw-route]').forEach(a => { a.href = ctx.href(a.dataset.hiwRoute); });
  }

  window.CardbitHowItWorks = {
    init(root) {
      this.ctx = window.cardbitHowContext || this.ctx;
      const page = root.querySelector('[data-hiw]');
      if (!page || page.dataset.hiwReady) return;
      page.dataset.hiwReady = '1';
      fillPacks(page, this.ctx);
      initCalc(page);
      initJump(page);
      initReveal(page);
      if (location.hash && location.hash.startsWith('#hiw-')) page.querySelector(location.hash)?.scrollIntoView();
    }
  };
  const start = () => { const root = document.getElementById('cardbit-store'); if (root) window.CardbitHowItWorks.init(root); };
  window.addEventListener('cardbit:storefront-rendered', start);
  start(); // The storefront may have rendered before this script loaded.
})();
