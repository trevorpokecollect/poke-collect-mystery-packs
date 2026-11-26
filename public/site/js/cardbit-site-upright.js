/* Cardbit site: show sideways (landscape) card images upright everywhere (Trevor, Nov 25 2026).
   Some printings (LEGEND halves, BREAK cards, a few promos) are scanned landscape. Wherever a card
   image is shown as a card (scan frames, Live Pulls, the opening, results, chat pulls), this turns it
   90° clockwise so it stands like every other card. Logos, pack art and banners are never touched.
   How: redraw the picture rotated on a canvas and swap in that copy. If the image host doesn't allow
   that (no CORS), fall back to rotating the <img> with CSS.
   Also exposes window.CardbitUpright.image(img) -> canvas|img for canvas renderers (the Decode player). */
(() => {
  'use strict';
  const LANDSCAPE = 1.12; // width / height above this counts as sideways
  const done = new WeakSet();
  const cache = new Map(); // original src -> Promise<rotated blob URL | ''>

  const isLandscape = (w, h) => w > 0 && h > 0 && w / h > LANDSCAPE;
  // Where card pictures live. Anything else (logos, banners, pack art) is left alone.
  const CARD = '.cb-scan-face,.cb-mini-scan,.cb-card-image,.cbd-face,.cbd-slot,.cbd-pull,.cbx-hit,.cbx-spot,.cb-chat-pull,[data-card-image]';
  const isCard = img => !!img.closest(CARD) || (+img.getAttribute('height') > +img.getAttribute('width') * 1.2 && !!img.closest('#cardbit-store,.cbd'));
  const style = document.createElement('style');
  style.textContent = 'img.cb-upright-css{object-fit:contain!important;transform:rotate(90deg) scale(var(--cb-upright-scale,1))}';
  (document.head || document.documentElement).append(style);

  // Rotated copy for canvas drawing. Drawing never needs CORS, so this always works.
  function image(im) {
    if (!im || !isLandscape(im.naturalWidth || im.width, im.naturalHeight || im.height)) return im;
    const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
    const c = document.createElement('canvas'); c.width = h; c.height = w;
    const g = c.getContext('2d'); g.translate(h, 0); g.rotate(Math.PI / 2); g.drawImage(im, 0, 0, w, h);
    return c;
  }

  // TCGplayer's CDN sends no CORS header, so its pictures are read through cardbit.com's own copy
  // (/api/card-image) and the rotated canvas can be exported. Other hosts are tried directly.
  const TCG = /^https:\/\/(product-images|tcgplayer-cdn)\.tcgplayer\.com\//;
  const readable = src => TCG.test(src) ? '/api/card-image?u=' + encodeURIComponent(src) : src;

  function rotatedUrl(src) {
    if (!cache.has(src)) cache.set(src, new Promise(res => {
      const im = new Image();
      im.crossOrigin = 'anonymous'; im.decoding = 'async';
      im.onload = () => {
        try {
          const c = image(im);
          if (c === im) return res('');
          c.toBlob(b => res(b ? URL.createObjectURL(b) : ''), 'image/webp', .92);
        } catch { res(''); } // host without CORS: canvas can't export
      };
      im.onerror = () => res('');
      im.src = readable(src);
    }));
    return cache.get(src);
  }

  function cssFallback(img) {
    // object-fit:contain keeps the whole picture inside the frame, then the turn + scale fills it.
    const r = img.getBoundingClientRect();
    if (!r.width || !r.height) return;
    img.classList.add('cb-upright-css');
    const mount = img.closest('.cb-scan-mount');
    if (mount && img.parentElement?.classList.contains('cb-scan-face')) {
      // Scan frames size to the picture, so give it a portrait box first (the frame follows), then turn
      // and enlarge the contained landscape picture to fill it. Without this the card sat small in a wide frame.
      const k = Math.min(1, (mount.clientHeight * .86) / r.width, (mount.clientWidth * .86) / r.height);
      img.style.width = (r.height * k) + 'px';
      img.style.height = (r.width * k) + 'px';
      img.style.maxWidth = img.style.maxHeight = 'none';
      img.style.setProperty('--cb-upright-scale', String(r.width / r.height));
      return;
    }
    img.style.setProperty('--cb-upright-scale', String(r.height / r.width));
  }

  async function fix(img) {
    if (done.has(img) || img.dataset.cbUpright) return;
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!isLandscape(w, h)) return;
    if (!isCard(img)) return;
    done.add(img);
    const src = img.currentSrc || img.src;
    if (!/^https?:|^blob:/.test(src)) return;
    const url = await rotatedUrl(src);
    if (!img.isConnected) return;
    if (url) {
      img.dataset.cbUpright = 'canvas';
      img.dataset.cbUprightFrom = src;
      img.removeAttribute('srcset');
      img.src = url;
    } else {
      img.dataset.cbUpright = 'css';
      cssFallback(img);
    }
  }

  const check = img => { if (img.complete && img.naturalWidth) fix(img); };
  // load doesn't bubble, but a capturing listener sees every image that finishes loading.
  document.addEventListener('load', e => { if (e.target instanceof HTMLImageElement) check(e.target); }, true);
  const scan = () => document.querySelectorAll('img').forEach(check);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, { once: true });
  else scan();
  // Cached images can be complete before any load event reaches us.
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) { if (n.nodeType !== 1) continue; if (n.tagName === 'IMG') check(n); else n.querySelectorAll?.('img').forEach(check); } })
    .observe(document.documentElement, { childList: true, subtree: true });
  // A src change on an already-fixed image (re-render reusing the node) should be checked again.
  new MutationObserver(ms => { for (const m of ms) { const img = m.target; if (img.dataset.cbUpright === 'canvas' && img.src.startsWith('blob:')) continue; delete img.dataset.cbUpright; img.classList.remove('cb-upright-css'); done.delete(img); } })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['src'], subtree: true });

  window.CardbitUpright = Object.freeze({ image, isLandscape });
})();
