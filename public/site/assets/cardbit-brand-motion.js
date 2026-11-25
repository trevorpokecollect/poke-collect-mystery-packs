/* Cardbit brand presentation. Both animations are independent of the opening result. */
(() => {
  'use strict';

  const tiles = [
    [100, 85, 53, 45, -13, -10],
    [53, 127, 58, 48, -16, -3],
    [83, 163, 73, 56, -12, 4],
    [48, 212, 48, 40, -11, 10]
  ];
  let logoPlayed = false;
  let logoSettlesAt = 0;
  let heroFinished = false;
  let autoPaused = false;
  let soundEnabled = window.CardbitMedia?.soundChoice() !== 'off';

  function lockup(asset, escape) {
    const img = (name, cls, style = '') =>
      '<img alt="" draggable="false" class="' + cls + '" style="' + style +
      '" src="' + escape(asset(name)) + '">';
    const moving = tiles.map(([x,y,w,h,dx,dy], i) => {
      const style = ['left:' + x / 2091 * 100 + '%', 'top:' + y / 419 * 100 + '%',
        'width:' + w / 2091 * 100 + '%', 'height:' + h / 419 * 100 + '%',
        '--dx:' + dx + 'px', '--dy:' + dy + 'px', '--delay:' + (i * 85 + 55) + 'ms'].join(';');
      return img('brand-piece-' + (i + 1) + '.png', 'cb-logo-tile', style);
    }).join('');
    return '<span class="cb-lockup" aria-hidden="true">' +
      img('brand-lockup.webp', 'cb-logo-exact') + '<template><span class="cb-logo-layers">' +
      img('brand-mark-base.webp', 'cb-logo-base') + moving + '</span></template></span>';
  }

  const controlPaths = {
    play:'M8 4.5 20 12 8 19.5Z', pause:'M8 5v14m8-14v14',
    replay:'M4 10a8 8 0 1 1 1 7M4 4v6h6',
    sound:'M3 9h4l5-4v14l-5-4H3ZM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
    silent:'M3 9h4l5-4v14l-5-4H3ZM16 9l5 6m0-6-5 6'
  };
  function controlIcon(name) {
    return '<svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none" aria-hidden="true"><path d="'+controlPaths[name]+'"/></svg>';
  }
  function studio(asset, escape) {
    const poster = escape(asset('latch-home-poster.webp'));
    return '<figure class="cb-workshop" aria-label="Latch Wraps a Mystery Edition Pack"><div class="cb-workshop-stage">'+
      '<img class="cb-workshop-still" alt="Latch holds the finished Mystery Edition pack" width="960" height="640" fetchpriority="high" src="'+poster+'">'+
      '<video class="cb-workshop-film" width="960" height="640" playsinline preload="none" aria-hidden="true" hidden></video></div>'+
      '<figcaption><span class="cb-workshop-controls" role="group" aria-label="Film Controls" hidden>'+
      '<button type="button" data-latch-control="motion" aria-label="Play Latch Animation">'+controlIcon('play')+'</button>'+
      '<button type="button" data-latch-control="sound" aria-label="Sound" aria-pressed="true">'+controlIcon('sound')+'</button>'+
      '</span><span class="cb-film-status" role="status"></span></figcaption></figure>';
  }


  function attach(root, asset, ready) {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const logo = root.querySelector('.cb-lockup');
    const subs = new AbortController();
    const listen = (node, name, fn) => node.addEventListener(name, fn, {signal:subs.signal});
    let settleTimer, startTimer, logoPending = false;
    function settle() {
      if (!logo) return;
      logo.classList.remove('cb-assembling');
      const layers = logo.querySelector('.cb-logo-layers');
      if (layers) layers.hidden = true;
    }
    async function assemble() {
      if (!logo || media.matches || logoPending || logo.classList.contains('cb-assembling')) return;
      logoPending = true;
      let layers = logo.querySelector('.cb-logo-layers');
      if (!layers) {
        layers = logo.querySelector('template').content.firstElementChild.cloneNode(true);
        layers.hidden = true;
        logo.append(layers);
      }
      try {
        await Promise.all([...logo.querySelectorAll('img')].map(image => image.decode()));
        if (media.matches || subs.signal.aborted) return;
        layers.hidden = false;
        logo.classList.add('cb-assembling');
        settleTimer = setTimeout(settle, 1060);
      } catch {
        settle();
      } finally {
        logoPending = false;
      }
    }
    if (logo && ready && root.dataset.animateHeader !== 'false') {
      if (!logoPlayed && !media.matches) {
        logoPlayed = true;
        logoSettlesAt = performance.now() + 1060;
        assemble();
      }
      const homeLink = logo.closest('a');
      listen(homeLink, 'pointerenter', event => { if (event.pointerType === 'mouse') assemble(); });
      listen(homeLink, 'focus', assemble);
      listen(media, 'change', () => { if (media.matches) settle(); });
    }
    const workshop = root.querySelector('.cb-workshop');
    const clean = () => {
      clearTimeout(startTimer);clearTimeout(settleTimer);subs.abort();
      settle();
    };
    if (!workshop) return clean;
    const video = workshop.querySelector('video');
    if (!video) return clean;
    const motion = workshop.querySelector('[data-latch-control="motion"]');
    const sound = workshop.querySelector('[data-latch-control="sound"]');
    const controls = workshop.querySelector('.cb-workshop-controls');
    const status = workshop.querySelector('.cb-film-status');
    let intendsPlay = !media.matches && !autoPaused && !heroFinished && root.dataset.autoplayHero !== 'false';
    let visible = !('IntersectionObserver' in window);
    let armed = performance.now() >= logoSettlesAt;
    let disposed = false, failed = false, revision = 0;
    video.muted = !soundEnabled;
    controls.hidden = false;

    function sync() {
      const label = failed ? 'Retry' : !video.paused && intendsPlay ? 'Pause' : heroFinished ? 'Replay' : 'Play';
      motion.setAttribute('aria-label',label+' Latch Animation');
      motion.title = label;
      motion.innerHTML = controlIcon(label === 'Pause' ? 'pause' : label === 'Replay' ? 'replay' : 'play');
      sound.setAttribute('aria-pressed',String(!video.muted));
      sound.title = video.muted ? 'Sound Off' : 'Sound On';
      sound.innerHTML = controlIcon(video.muted ? 'silent' : 'sound');
      status.textContent = failed ? 'Film Unavailable. Select Retry to Play Again.' : '';
    }
    async function reconcile() {
      const ticket = ++revision;
      if (!intendsPlay || !visible || document.hidden || !armed || failed || disposed) {
        video.pause();sync();return;
      }
      if (!video.hasAttribute('src')) video.src = asset('latch-home-960.mp4');
      try { await video.play(); }
      catch (error) {
        if (ticket !== revision || disposed || error.name === 'AbortError') return;
        // A browser can require the visitor's Play gesture for audible playback.
        intendsPlay = false;
        failed = Boolean(video.error);
        video.hidden = true;
        sync();
      }
    }
    listen(motion,'click',()=>{
      if (!video.paused && intendsPlay) {
        intendsPlay = false;autoPaused = true;
      } else {
        if (failed) { failed = false;video.load(); }
        if (video.ended || heroFinished) video.currentTime = 0;
        heroFinished = false;autoPaused = false;armed = true;visible = true;intendsPlay = true;
      }
      reconcile();
    });
    listen(sound,'click',()=>{
      soundEnabled = !soundEnabled;
      window.CardbitMedia?.setSound(soundEnabled);
      video.muted = !soundEnabled;
      sync();
    });
    listen(video,'playing',()=>{if (!disposed && intendsPlay) video.hidden = false;sync();});
    listen(video,'pause',sync);
    listen(video,'ended',()=>{heroFinished = true;intendsPlay = false;video.hidden = true;sync();});
    listen(video,'error',()=>{failed = true;intendsPlay = false;video.hidden = true;sync();});
    listen(document,'visibilitychange',reconcile);
    listen(media,'change',()=>{if(media.matches){intendsPlay=false;video.hidden=true;reconcile();}});
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries=>{
      visible=entries.some(entry=>entry.isIntersecting);reconcile();
    },{threshold:.08}) : null;
    observer?.observe(workshop);
    if (!armed) startTimer=setTimeout(()=>{armed=true;reconcile();},Math.max(0,logoSettlesAt-performance.now()));
    sync();reconcile();
    return ()=>{disposed=true;++revision;observer?.disconnect();clean();video.pause();};
  }


  window.CardbitBrand = Object.freeze({lockup, studio, attach});
})();
