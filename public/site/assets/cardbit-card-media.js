/* Shared by the reveal, catalog inspector and homepage. */
(function publish(root) {
  'use strict';
  const backs = Object.freeze({
    en: { file: 'card-back-en.webp', label: 'English Pokémon back' },
    'ja-modern': { file: 'card-back-ja-modern.webp', label: 'Modern Japanese Pokémon back' },
    'ja-old': { file: 'card-back-ja-old.webp', label: 'Vintage Japanese Pocket Monsters back' }
  });
  const normalized = value => String(value || '').normalize('NFKC').trim().toLowerCase()
    .replace(/é/g, 'e').replace(/[\s._’'★,!…/–-]+/gu, '');
  const oldSets = new Set([
    'Expansion Pack', 'Pokémon Jungle', 'Jungle', 'Mystery of the Fossils', 'Fossil',
    'Rocket Gang', 'Team Rocket', 'Leaders’ Stadium', 'Challenge from the Darkness',
    'Gold, Silver, to a New World...', 'Crossing the Ruins...', 'Awakening Legends',
    'Darkness, and to Light...', 'Neo Genesis', 'Neo Discovery', 'Neo Revelation',
    'Neo Destiny', 'ポケモンジャングル', '化石の秘密', 'ロケット団'
  ].map(normalized));
  const newSets = new Set([
    'VS', 'Pokémon VS', 'Pokémon Card ★VS', 'Web', 'Pokémon Web', 'Pokémon Card ★web',
    'Pokémon Card 151', 'SV2a', 'Stellar Miracle', 'Terastal Festival ex'
  ].map(normalized));

  function backFor(card = {}) {
    const copyImage = card.backImageUrl || card.backImage;
    if (typeof copyImage === 'string' && copyImage) return { url: copyImage, label: 'Photographed card back' };
    if (card.backDesign) return Object.hasOwn(backs, card.backDesign) ? backs[card.backDesign] : null;
    if (card.hasSpecialBack || card.doubleSided) return null;
    const tag = Array.isArray(card.tags) && card.tags.find(value => /^language_/i.test(value));
    const lang = String(card.language || card.languageCode || (tag && tag.slice(9)) ||
      (/japanese/i.test(card.productType || '') ? 'ja' : '')).trim().toLowerCase();
    if (/^(en(?:[-_].+)?|english)$/.test(lang)) return backs.en;
    if (!/^(ja(?:[-_].+)?|jp|jpn|japanese|日本語)$/.test(lang)) return null;
    // Use the release of this physical printing. A copyright year can refer to earlier art.
    const date = /^(\d{4})(?:-(0[1-9]|1[0-2])(?:-\d{2})?)?$/.exec(String(card.printingReleaseDate || card.releaseDate || ''));
    if (date) {
      const year = Number(date[1]), month = Number(date[2] || 0);
      if (year >= 1996 && (year < 2001 || (year === 2001 && month > 0 && month < 7))) return backs['ja-old'];
      if (year > 2001 || (year === 2001 && month > 7)) return backs['ja-modern'];
    }
    const set = [card.setCode, card.set, card.setName].map(normalized);
    if (set.some(key => oldSets.has(key))) return backs['ja-old'];
    if (set.some(key => newSets.has(key))) return backs['ja-modern'];
    return null;
  }

  function gridSources(source) {
    let url;
    try { url = new URL(source); } catch { return ''; }
    if (url.protocol !== 'https:' || [...url.searchParams.keys()].some(key => !['v', 'width'].includes(key))) return '';
    if (url.hostname === 'product-images.tcgplayer.com' && /^\/fit-in\/1000x1000\/\d+\.jpg$/.test(url.pathname)) {
      const small = new URL(url);
      small.pathname = url.pathname.replace('/1000x1000/', '/500x500/');
      return small.href + ' 1x, ' + url.href + ' 2x';
    }
    if (url.hostname === 'cdn.shopify.com' && url.pathname.startsWith('/s/files/')) {
      return [360, 720, 1080].map((width, i) => {
        const size = new URL(url);
        size.searchParams.set('width', String(width));
        return size.href + ' ' + (i + 1) + 'x';
      }).join(', ');
    }
    return '';
  }

  function bindScans(container, signal) {
    const motion = window.matchMedia('(any-hover: hover) and (any-pointer: fine) and (prefers-reduced-motion: no-preference)');
    let active = null, point = null, frameId = 0;
    const options = { passive: true, signal };

    function release() {
      if (!active) return;
      active.removeAttribute('data-cb-tilting');
      for (const property of ['--scan-rx', '--scan-ry', '--scan-x', '--scan-y']) active.style.removeProperty(property);
      active = null;
    }
    function stop() {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      point = null;
      release();
    }
    function paint() {
      frameId = 0;
      if (!point || !motion.matches) { stop(); return; }
      const under = document.elementFromPoint(point.x, point.y);
      const tile = under?.closest('.cb-scan-mount, .cb-card-tile, .ct-chase-card');
      const hit = tile?.querySelector('[data-cb-scan]');
      if (!hit || !container.contains(hit) || hit.closest('[aria-hidden="true"]') || !hit.querySelector('img')?.naturalWidth) {
        release();
        return;
      }
      if (active !== hit) { release(); active = hit; }
      const rect = hit.getBoundingClientRect();
      if (!rect.width || !rect.height) { release(); return; }
      const fraction = (value, start, size) => Math.min(1, Math.max(0, (value - start) / size));
      const x = fraction(point.x, rect.left, rect.width);
      const y = fraction(point.y, rect.top, rect.height);
      hit.style.setProperty('--scan-rx', ((.5 - y) * 15).toFixed(2) + 'deg');
      hit.style.setProperty('--scan-ry', ((x - .5) * 21).toFixed(2) + 'deg');
      hit.style.setProperty('--scan-x', (x * 100).toFixed(1) + '%');
      hit.style.setProperty('--scan-y', (y * 100).toFixed(1) + '%');
      hit.setAttribute('data-cb-tilting', '');
    }
    function schedule() {
      if (point && !frameId) frameId = requestAnimationFrame(paint);
    }
    function track(event) {
      if (event.pointerType === 'touch' || !motion.matches) { stop(); return; }
      point = { x: event.clientX, y: event.clientY };
      schedule();
    }
    container.addEventListener('pointermove', track, options);
    container.addEventListener('pointerover', track, options);
    container.addEventListener('pointerleave', stop, options);
    container.addEventListener('pointercancel', stop, options);
    window.addEventListener('scroll', schedule, { ...options, capture: true });
    window.addEventListener('blur', stop, options);
    motion.addEventListener('change', stop, options);
    signal.addEventListener('abort', stop, { once: true });
  }

  let soundChoice = null;
  try { soundChoice = root.localStorage?.getItem('cardbit.sound.v1') || null; } catch {}
  function setSound(on) {
    soundChoice = on ? 'on' : 'off';
    try { root.localStorage?.setItem('cardbit.sound.v1', soundChoice); } catch {}
  }
  const media = Object.freeze({ backs, backFor, gridSources, bindScans, setSound, soundChoice: () => soundChoice });
  root.CardbitMedia = media;
  if (typeof module !== 'undefined' && module.exports) module.exports = media;
})(globalThis);
