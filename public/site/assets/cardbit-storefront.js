/* Cardbit private storefront. All prices, inventory and ownership come from CardbitStore. */
(() => {
  'use strict';
  const editions = {
    cobalt: { name: 'Mystery Edition', slug: 'mystery', hue: '#42d8ef', line: 'Modern English Singles', detail: 'Latch Grips an Iridescent Question-Mark Pack Against Violet and Cyan Foil.' },
    prism: { name: 'Booster Edition', slug: 'booster', hue: '#60baff', line: 'Five Modern English Cards', detail: 'Latch Holds a Fan of Blue Cards Framed by Orange and Cobalt Streaks.' },
    gold: { name: 'Gold Edition', slug: 'gold', hue: '#e6b650', line: 'One Premium English or Japanese Single', detail: 'Latch Presents a Gold Card Against Faceted Black and Gold Foil.' },
    ember: { name: 'Japanese Edition', slug: 'japanese', hue: '#f07477', line: 'One Modern Japanese Single', detail: 'Latch Holds a Crimson Card Against a Red Sun on Silver Foil.' },
    amethyst: { name: 'Wildcard Edition', slug: 'wildcard', hue: '#c5e368', line: 'One English or Japanese Single', detail: 'Latch Grips the Magenta and Lime Cards While a Cyan Card Floats Between Them.' }
  };
  const poolBySlug = new Map(Object.entries(editions).map(([pool, edition]) => [edition.slug, pool]));
  const editionProducts = {cobalt:'10414094975138',prism:'10414095007906',gold:'10414095040674',ember:'10414095073442',amethyst:'10414095106210'};
  const nativeEdition = product => Object.keys(editionProducts).find(id => editionProducts[id] === String(product)) || '';
  function poolKey(value) {
    const key = String(value || '').trim().toLowerCase().replace(/(?:[- ]edition)$/, '');
    return poolBySlug.get(key) || key;
  }
  // Card categories shown in place of pack subtext. Every edition holds Pokémon cards.
  const categoryDefs = {
    pokemon:{label:'Pokémon',path:'M12 3l2.2 4.6 5 .7-3.6 3.5.9 5L12 14.4 7.5 16.8l.9-5L4.8 8.3l5-.7z'},
    modern:{label:'Modern',path:'M12 3v4m0 10v4M3 12h4m10 0h4M6.3 6.3l2.4 2.4m6.6 6.6 2.4 2.4m0-11.4-2.4 2.4m-6.6 6.6-2.4 2.4'},
    vintage:{label:'Vintage',path:'M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9'},
    english:{label:'English',code:'EN'},
    japanese:{label:'Japanese',code:'JP'}
  };
  const packCategories = {
    cobalt:['pokemon','modern','english'],
    prism:['pokemon','modern','english','japanese'],
    ember:['pokemon','modern','japanese'],
    gold:['pokemon','modern','vintage','english','japanese'],
    amethyst:['pokemon','modern','vintage','english','japanese']
  };
  function categoryTags(id, compact=false) {
    const keys = packCategories[poolKey(id)] || ['pokemon'];
    return '<ul class="cb-cats'+(compact?' cb-cats-compact':'')+'" aria-label="Card Types">'+keys.map(key => {
      const c = categoryDefs[key];
      const mark = c.code ? '<span class="cb-cat-code" aria-hidden="true">'+c.code+'</span>' :
        '<svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="'+c.path+'"/></svg>';
      return '<li class="cb-cat cb-cat-'+key+'">'+mark+'<span>'+c.label+'</span></li>';
    }).join('')+'</ul>';
  }
  function editionRoute(route, publicLink) {
    const parts = route.split('/');
    if (parts[0] === 'latch') parts[0] = 'demo';
    if (parts[0] === 'bits') parts[0] = 'cardbits';
    if (parts[0] === 'demo' || parts[0] === 'open') parts[0] = publicLink ? 'open' : 'demo';
    if (parts[0] === 'packs' && ['walkthrough', 'with-cardbits'].includes(parts[2])) {
      parts[2] = publicLink ? 'with-cardbits' : 'walkthrough';
    }
    if (parts[0] === 'binder') parts[0] = 'vault';
    if (parts[0] === 'ship-together' && parts[1] && parts[1] !== 'select') parts[0] = 'shipments';
    if(parts[0]==='marketplace' || parts[0]==='market')parts[0]='shop';
    if ((['packs', 'demo', 'open'].includes(parts[0])) && parts[1]) {
      const key = poolKey(parts[1]);
      if (editions[key]) parts[1] = publicLink ? editions[key].slug : key;
    }
    return parts.join('/');
  }
  const iconPaths = {
    arrow:'M5 12h14m-5-5 5 5-5 5',back:'M19 12H5m5-5-5 5 5 5',chevron:'m9 5 7 7-7 7',
    bits:'M5 8.5 12 4l7 4.5v7L12 20l-7-4.5zM12 4v8m7-3.5L12 12 5 8.5m7 3.5v8',
    binder:'M5 3h13a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm2 0v18m3-13h6v5h-6z',
    pack:'M6 3h12v18H6zM6 6h12M6 18h12m-6-9 2 3-2 3-2-3z',
    search:'m20 20-5-5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    single:'M7 3h11v16H7zM4 6v16h11',ship:'m3 8 9-5 9 5-9 5-9-5zm0 0v9l9 5 9-5V8m-9 5v9m-5-17 9 5',
    check:'m4 12 5 5L20 6',close:'m6 6 12 12m0-12L6 18',play:'m8 4 12 8-12 8z',
    pause:'M8 5v14m8-14v14',user:'M3 21c1-5 5-7 9-7s8 2 9 7m-5-14a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    plus:'M5 12h14m-7-7v14',clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0m-9-5v5l3 2',
    angle:'m8 4 8 8-8 8',expand:'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5'
  };
  const icon = (name,size=18) => name==='bits' && window.cardbitValueIcon ? '<img alt="" width="'+size+'" height="'+size+'" style="object-fit:contain" src="'+esc(window.cardbitValueIcon)+'">' : '<svg aria-hidden="true" focusable="false" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="'+(iconPaths[name]||iconPaths.arrow)+'"/></svg>';
  const esc = value => String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const number = n => Number.isFinite(+n) ? Math.round(+n).toLocaleString('en-US') : '—';
  const plural = (n,s) => {
    const word=Number(n)===1?s:s.endsWith('copy')?s.slice(0,-1)+'ies':s+'s';
    return number(n)+' '+word.replace(/\b[a-z]/g,letter=>letter.toUpperCase());
  };
  const enc = value => encodeURIComponent(String(value));
  const money = n => number(n)+' Cardbits';
  const valueLine = card => window.CardbitValueView ? '<span class="cb-art-value">'+window.CardbitValueView.html(card)+'</span>' : '';
  const titleCase = s => s ? s.charAt(0).toUpperCase()+s.slice(1) : '';
  const describeDate = value => {const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});};
  const safeImage = value => {
    if (!value) return '';
    try {const u=new URL(String(value),location.href);return ['http:','https:','file:'].includes(u.protocol)||/^data:image\/(?:png|jpe?g|webp|avif);base64,/i.test(String(value))?String(value):'';} catch{return '';}
  };
  let walletBalanceLive=null;
  const topupBonus=n=>n===10000?500:n===50000?5000:0;
  let root, state, dialog, lastFocus, destroyOpening, activeMount, lastRoute, version=0, working=false, message='', pendingAction=null;
  const memoryRequests = new Map();
  const asset = file => {
    const value=window.cardbitAssets?.[file];
    if(file==='card-back-ja-old.webp' && !value) return '';
    // Portable builds carry the film and foley inline. Hosted themes use CDN URLs.
    if (typeof value==='string' && ((file.endsWith('.mp4') && value.startsWith('data:video/mp4;base64,')) ||
        (file.endsWith('.wav') && /^data:audio\/(?:wav|wave|x-wav|vnd\.wave);base64,/i.test(value)))) return value;
    return safeImage(value || ((root?.dataset.routing==='path')?'/assets/':'assets/')+file);
  };
  const artURL = card => card.localImage ? asset(card.localImage) : safeImage(card.image || card.imageUrl || card.thumbnail);
  const cardName = card => card.name || card.title || 'Card';
  const cardSet = card => card.set || card.setName || '';
  function scanMarkup(src, label, eager, fallback='', kind='single') {
    const sources = !eager && src && window.CardbitMedia?.gridSources?.(src);
    const retry = fallback && fallback !== src ? ' data-scan-fallback="' + esc(fallback) + '"' : '';
    const image = src ? '<span class="cb-scan-hit"' + (kind === 'slab' ? ' data-slab' : ' data-cb-scan') +
      '><span class="cb-scan-face"><img alt="' + esc(label) + '" loading="' + (eager ? 'eager' : 'lazy') +
      '" decoding="async"' + (sources ? ' srcset="' + esc(sources) + '"' : '') + retry +
      ' src="' + esc(src) + '"></span></span>' : '';
    return '<span class="cb-card-image cb-scan-mount"><span class="cb-art-fallback" aria-hidden="true">' +
      icon('single',32) + '</span>' + (image || '<small class="cc-art-missing">Artwork Unavailable</small>') + '</span>';
  }
  const frontScan = (c, eager) => scanMarkup(artURL(c), cardName(c), eager, safeImage(c.thumbnail), c.kind);
  const art = (c, eager=false) => frontScan(c, eager) + valueLine(c);

  function scanError(event) {
    const image = event.target;
    if (image.matches?.('.cb-mini-scan img')) {
      if (image.dataset.scanFallback) {
        const fallback = image.dataset.scanFallback;
        delete image.dataset.scanFallback;
        image.src = fallback;
      } else image.remove();
      return;
    }
    if (!image.matches?.('.cb-scan-face > img')) return;
    if (image.hasAttribute('srcset')) {
      const retryOriginal = image.currentSrc !== image.src;
      image.removeAttribute('srcset');
      if (retryOriginal) return;
    }
    if (image.dataset.scanFallback) {
      const fallback = image.dataset.scanFallback;
      delete image.dataset.scanFallback;
      image.src = fallback;
      return;
    }
    const mount = image.closest('.cb-scan-mount');
    image.closest('.cb-scan-hit').remove();
    const note = document.createElement('small');
    note.className = 'cc-art-missing';
    note.textContent = 'Artwork Unavailable';
    mount.append(note);
  }
  const skin = id => editions[poolKey(id)] || {name:titleCase(id),hue:'#7391d2',line:'Foil Edition',detail:''};
  const wrapper = p => asset('latch-pack-' + (skin(p.id).slug || 'mystery') + '.webp');
  const packTitle = p => skin(p.id).name;
  const demoOpeningLabel = 'Demo Opening';
  const isDemoShopper = () => window.CardbitStore?.mode === 'shopper-test';
  /* SITE */ const site = () => window.CardbitStore?.site === true;
  const retailAmount = card => isDemoShopper() ? (card?.retailBits > 0 ? card.retailBits : null) : window.CardbitRetail?.amount(card);
  const inBrowser = () => state?.mode==='device-test';
  const account = () => inBrowser() && root?.hasAttribute('data-member-signed-in') ? null : state?.account;
  const isHeld = c => c.status==='held';
  const vaultStatusIcon = c => window.CardbitValueView.statusIcon(c.status,copyStatus(c) || 'Status Unavailable').outerHTML;
  const copyStatus = c => ({held:'Held in Vault',shipping:'Shipping Requested',returned:'Sold Back',sold:'Sold Back'})[c.status] || titleCase(c.status);
  function readRoute(){
    const u=new URL(location.href);
    let route=root?.dataset.routing==='path'?u.pathname:u.searchParams.get('cb')||'';
    if(location.protocol==='file:' && location.hash.startsWith('#/')) route=location.hash.slice(1);
    if(!route && /^#(home|pack|packs|cards|market|account|collection|bits|cardbits|policies|guide)(?:\/|$)/.test(u.hash)){
      const legacy=u.hash.slice(1).split('/'),aliases={home:'',pack:'packs',market:'shop',cards:'shop',account:'account',collection:'vault',guide:'help'};
      legacy[0]=aliases[legacy[0]]??legacy[0];route=legacy.join('/');
    }
    if (!route && root?.dataset.productId) route = 'packs/'+(nativeEdition(root.dataset.productId) || 'cobalt');
    if (!route && window.CardbitWelcome?.isSample) route = 'welcome';
    if (!route && root?.dataset.defaultRoute) route = root.dataset.defaultRoute;
    return editionRoute(route.replace(/^\/+|\/+$/g,''), false);
  }
  function href(route){
    route = editionRoute(route, true);
    // The How It Works page lives at its own URL; every other route goes back to the storefront root.
    const ownPage = root?.dataset.defaultRoute;
    if (route === 'help' && root?.dataset.howPage && !ownPage) return new URL(root.dataset.howPage, location.origin).href;
    if (ownPage && route === ownPage) return location.href.split('#')[0];
    if (ownPage) { const home = new URL(root.dataset.storeRoot || '/', location.origin); if (route) home.searchParams.set('cb', route); if (root.dataset.previewTheme) home.searchParams.set('preview_theme_id', root.dataset.previewTheme); return home.href; }
    if (!route && window.CardbitWelcome?.isSample) return window.CardbitWelcome.exit;
    if (route === 'welcome' && window.CardbitWelcome) return window.CardbitWelcome.entry;
    let u=new URL(location.href);u.hash='';
    const nativeSlug = editions[nativeEdition(root?.dataset.productId)]?.slug;
    if (nativeSlug && !['packs/'+nativeSlug,'packs/'+nativeSlug+'/pool','open/'+nativeSlug].includes(route)) {
      u = new URL(root.dataset.storeRoot || '/', u.origin);
    }
    if(root?.dataset.routing==='path'){ u.pathname='/'+route;u.searchParams.delete('cb'); }
    else if(location.protocol==='file:'){u.hash='/'+route;}
    else { if(route)u.searchParams.set('cb',route);else u.searchParams.delete('cb');if(root?.dataset.previewTheme && !u.searchParams.has('preview_theme_id'))u.searchParams.set('preview_theme_id',root.dataset.previewTheme); }
    return u.href;
  }
  const link = (route,html,cls='',extra='') => '<a data-cb-route="'+esc(route)+'" class="'+cls+'" href="'+esc(href(route))+'" '+extra+'>'+html+'</a>';
  const btn = (action,html,cls='cb-secondary',attrs='') => '<button type="button" class="'+cls+'" data-cb-do="'+action+'" '+attrs+'>'+html+'</button>';
  const chip = (value,s='') => '<span class="cb-chip '+s+'">'+esc(value)+'</span>';
  const sectionHd = (title,route='',label='') => '<div class="cb-section-head"><h2>'+esc(title)+'</h2>'+(label?link(route,esc(label)+icon('arrow'),'cb-textlink'):'')+'</div>';
  const bread = (parent,title) => '<div class="cb-crumb">'+link(parent,icon('back',15)+esc(title))+'</div>';
  const empty = (title,note,label='',route='',glyph='binder') => '<section class="cb-empty">'+icon(glyph,30)+'<h2>'+esc(title)+'</h2><p>'+esc(note)+'</p>'+(label?link(route,esc(label)+icon('arrow'),'cb-secondary'):'')+'</section>';
  const known = (array,id) => (array||[]).find(x=>String(x.id)===String(id));
  const context = {
    root:()=>root, state:()=>state, setState:next=>{state=next;}, busy:()=>working, setBusy:value=>{working=value;},
    esc, enc, link, btn, art, asset, artURL, icon, tierMarkup, cardBuyback, bread, empty, packTitle, facts, loginForm, vaultStatusIcon,
    date:describeDate, shipmentStatus:p=>pages.parcelState(p), modal, dialog:()=>dialog, close:closeDialog, render, refresh, go:navigate, error:errorNote, requestId
  };
  const collectors = window.CardbitCollectors.create(context);
  const pages = window.CardbitCollectorPages.create({...context, skin, wrapper, plural, money, cardViewer, cardTile, sectionHd,
    shelf:shelfOrder, tierName, tierSymbol, compareTiers, cardBuyback, option:(...args)=>option(...args), purchaseControl,
    welcomeAccount:()=>window.CardbitWelcome?.teaser('account') || ''});
  function accountLink() {
    const label = icon('user',18) + '<span>My Account</span>';
    if (isDemoShopper() || (account() && !root.hasAttribute('data-member-signed-in'))) return link('account',label,'cb-binder-link','aria-label="My Account"');
    const target = new URL(root.dataset.storeRoot || '/',location.origin);
    target.searchParams.set('view','account');
    if (root.dataset.previewTheme) target.searchParams.set('preview_theme_id',root.dataset.previewTheme);
    return '<a class="cb-binder-link" aria-label="My Account" href="' + esc(target.href) + '">' + label + '</a>';
  }
  function shelfOrder(){
    const ordered=(root.dataset.order||'cobalt,prism,gold,ember,amethyst').split(',').map(poolKey);
    return [...(state.packs||[])].sort((a,b)=>(ordered.includes(a.id)?ordered.indexOf(a.id):99)-(ordered.includes(b.id)?ordered.indexOf(b.id):99));
  }
  function header(route){
    const nav=(to,label)=>link(to,'<span class="cb-nav-icon cb-nav-'+to+'" aria-hidden="true"></span><span>'+label+'</span>','cb-navlink',route===to||route.startsWith(to+'/')?'aria-current="page"':'');
    const walletBalance=account()?.bits ?? walletBalanceLive ?? (root.hasAttribute('data-member-signed-in') || isDemoShopper() ? null : 0);
    const shownBalance=walletBalance == null ? '—' : number(walletBalance);
    const wallet=link('cardbits','<span class="cb-buy-label">Buy Cardbits</span><span class="cb-balance">'+icon('bits',19)+'<span data-wallet-balance>'+shownBalance+'</span></span>',
      'cb-wallet-link','aria-label="Buy Cardbits'+(walletBalance == null ? '' : ', Balance '+shownBalance+' Cardbits')+'"');
    const skipHref=new URL(location.href);skipHref.hash='cb-stage';
    return '<a href="'+esc(skipHref.href)+'" data-cb-skip class="cb-skip">Skip to Content</a><header class="cb-header"><div class="cb-wrap cb-head">'+link('',window.CardbitBrand?.lockup(asset,esc) || '<span class="cb-lockup"><img class="cb-logo-exact" alt="" src="'+esc(asset('brand-lockup.webp'))+'"></span>','cb-brand','aria-label="Cardbit Home"')+'<nav aria-label="Shop" class="cb-nav">'+nav('packs','Packs')+nav('chase','Chase')+nav('shop','Card Shop')+nav('help','How It Works')+'</nav><nav aria-label="Account" class="cb-account">'+wallet+accountLink()+'</nav></div></header>';
  }
  function policyLink(label, newTab=false){
    const target=root.dataset.policyView;
    if (!target) return link('policies',esc(label),'cb-textlink');
    return '<a class="cb-textlink" href="'+esc(target)+'"'+(newTab?' target="_blank" rel="noopener"':'')+'>'+esc(label)+'</a>';
  }
  function footer(){
    const welcomeLink = window.CardbitWelcome ? link('welcome','Welcome Rewards') : '';
    return '<footer class="cb-footer"><div class="cb-wrap"><div class="cb-foot-main"><div><img alt="cardbit" width="135" height="27" src="'+esc(asset('brand-lockup.webp'))+'"><p>Hosted by Poke-Collect</p></div><nav aria-label="Footer">'+link('packs','Browse Packs')+link('chase','Chase')+link('ship-together','Ship Together')+link('shop','Card Shop')+link('help','How It Works')+welcomeLink+/* SITE */(site() ? '<a href="'+esc(root.dataset.policyView || '/policies')+'">Policies</a>' : policyLink('Policies'))+'<a href="mailto:Support@cardbit.com">Contact Us</a></nav></div><div class="cb-foot-end"><span>Cardbit, LLC · Madison, Alabama</span></div></div></footer>';
  }
  function displayTitle(value) {
    const minor = /^(?:a|an|the|and|as|at|but|by|for|from|in|into|nor|of|on|or|per|to|via|with|without)$/i;
    return String(value || '').trim().replace(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu,(word,index,line)=>{
      const first = index===0 || /[.!?]\s+$/.test(line.slice(0,index));
      if (!first && minor.test(word)) return word.toLowerCase();
      return word === 'cardbit' ? word : word.charAt(0).toUpperCase()+word.slice(1);
    });
  }

  function shelfTitle() {
    return displayTitle(root.dataset.shelfTitle) || 'Shop Packs';
  }

  function chaseCards(pack) {
    if (!(pack.remaining > 0)) return [];
    const printings = new Map();
    for (const card of pack.cards || []) {
      if (!(card.remaining > 0)) continue;
      const key = window.CardbitCollectorRules.printingKey(card);
      const value = retailAmount(card);
      if (value == null || printings.has(key)) continue;
      printings.set(key, {card, key, value});
    }
    return [...printings.values()].sort((a,b) => b.value - a.value || a.key.localeCompare(b.key)).slice(0,3);
  }

  function shortName(card) {
    return cardName(card).replace(/\s*[-–]\s*#?\d+[A-Z]?\s*\/\s*\d+[A-Z]?\s*$/i, '').trim();
  }

  function miniature(card) {
    const original = artURL(card);
    const src = safeImage(card.thumbnail) || original;
    const retry = original && original !== src ? ' data-scan-fallback="'+esc(original)+'"' : '';
    return '<span class="cb-mini-scan" aria-hidden="true">'+icon('single',17)+
      (src ? '<img alt="" loading="lazy" decoding="async"'+retry+' src="'+esc(src)+'">' : '')+'</span>';
  }

  function cardBuyback(card, available = true) {
    const amount = card.buybackBits;
    if (!available) return {amount:null, label:'Buyback Unavailable'};
    if (card.canBuyback === false || amount === 0 || amount === null) return {amount:null, label:'No Buyback Offer'};
    if (Number.isSafeInteger(amount) && amount > 0) return {amount, label:money(amount)};
    return {amount:null, label:'Buyback Unavailable'};
  }

  function pullCardLink(card, key, pack, isChase, available = true) {
    const {amount, label:quote} = cardBuyback(card, available);
    const hasOffer = amount !== null;
    const tier = window.CardbitOpening?.tierFor(card);
    const tierLabel = tier?.name || (typeof card.tier === 'string' ? card.tier.trim() : '');
    const color = /^#[\da-f]{6}$/i.test(tier?.color || '') ? tier.color : '';
    const meta = [tierMarkup(card), esc(isChase ? card.number || cardSet(card) : packTitle(pack))]
      .filter(Boolean).join('<span aria-hidden="true"> · </span>');
    const content = miniature(card)+'<span class="cb-pull-copy"><strong class="cb-pull-name">'+esc(shortName(card))+
      '</strong><span class="cb-pull-meta">'+meta+'</span></span><span class="cb-pull-quote">'+
      (hasOffer ? '<strong class="cb-pull-amount">'+esc(quote)+'</strong>' :
        '<span class="cb-offer-unavailable">'+esc(quote)+'</span>')+'</span>';
    const description = [cardName(card), isChase ? cardSet(card) : packTitle(pack), isChase ? card.printing : '', tierLabel,
      quote].filter(Boolean).join(' · ');
    const attributes = 'aria-label="'+esc(description)+'"'+(color ? ' style="--cb-pull-tier:'+color+'"' : '');
    return link('chase/'+enc(key),content,isChase ? 'cb-chase-link'+(color?' cb-tier-glow':'') : 'cb-feed-card',attributes);
  }

  function packInfo(pack) {
    const name = packTitle(pack);
    const price = Number.isSafeInteger(pack.priceBits) && pack.priceBits > 0 ? money(pack.priceBits) : 'Price Pending';
    const chases = chaseCards(pack);
    const list = chases.length ? '<p class="cb-chase-heading">Top Chases</p><ul class="cb-chase-list">'+
      chases.map(({card,key}) => '<li>'+pullCardLink(card,key,pack,true)+'</li>').join('')+'</ul>' :
      '<p class="cb-chase-empty">'+(pack.remaining === 0 ? 'Sold Out' : 'Chases Unavailable')+'</p>';
    return link('packs/'+enc(pack.id),'<div class="cb-tile-head"><h3>'+esc(name)+'</h3>'+icon('arrow',16)+'</div>'+
      '<span class="cb-tile-price">'+price+'</span>','cb-edition-name')+categoryTags(pack.id,true)+list;
  }

  function packTile(pack) {
    const art = '<div class="cb-niche" style="--foil:'+skin(pack.id).hue+'"><span class="cb-niche-line"></span>'+
      '<span class="cb-shelf-wrapper"><img alt="'+esc(packTitle(pack))+' foil wrapper" src="'+esc(wrapper(pack))+'" loading="lazy"><i aria-hidden="true"></i></span></div>';
    return '<article class="cb-pack-tile">'+link('packs/'+enc(pack.id),art,'cb-pack-art','tabindex="-1" aria-hidden="true"')+
      '<div class="cb-pack-info" data-edition-info="'+esc(pack.id)+'">'+packInfo(pack)+'</div></article>';
  }

  function pullFeed() {
    if (!site() && (root.dataset.mode !== 'demo' || !(inBrowser() || isDemoShopper()))) return '';
    return '<section class="cb-pull-feed" aria-labelledby="cb-feed-title"><div class="cb-feed-heading">'+
      '<h2 id="cb-feed-title">Just Pulled</h2>'+
      '<button type="button" class="cb-feed-control" data-feed-toggle aria-label="Pause Just Pulled">'+icon('pause',15)+'</button></div>'+
      /* SITE */(site() ? '' : '<div class="cbf-ticker" data-pull-ticker hidden><span class="cbf-ticker-live" data-ticker-label>Live</span><div class="cbf-ticker-track" data-ticker-track aria-live="polite"></div></div>')+
      '<ul class="cb-feed-items" data-feed-items aria-live="off"></ul></section>';
  }

  // Booster holds five cards, so Just Pulled shows only its Uncommon or higher pulls.
  const feedFloor = {prism:'Uncommon'};
  const tierRanks = ['Common','Uncommon','Rare','Epic','Legendary'];
  function feedEligible(pack, card) {
    const floor = feedFloor[poolKey(pack.id)];
    if (!floor) return true;
    const tier = String(window.CardbitOpening?.tierFor(card)?.name || card.tier || '').trim().toLowerCase();
    const rank = tierRanks.findIndex(name => name.toLowerCase() === tier);
    return rank >= tierRanks.indexOf(floor);
  }

  // Live ticker: newest real pulls from /apps/packs/api/recent. Unopened packs never appear there.
  // Without a live feed (local preview), it cycles the sample cards and says Demo.
  const tickerTierColor = {uncommon:'#62e987', rare:'#538fff', epic:'#b47aff', legendary:'#ffb65c', master:'#ffb65c'};
  function timeAgo(iso) {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (!Number.isFinite(s)) return '';
    if (s < 60) return 'Just Now';
    if (s < 3600) return Math.floor(s/60) + 'm Ago';
    if (s < 86400) return Math.floor(s/3600) + 'h Ago';
    return Math.floor(s/86400) + 'd Ago';
  }
  function mountTicker(signal) {
    const box = root.querySelector('[data-pull-ticker]');
    if (!box) return;
    const track = box.querySelector('[data-ticker-track]'), tag = box.querySelector('[data-ticker-label]');
    const hosted = Boolean((root.dataset.previewTheme || root.dataset.memberPath) && /^https?:$/.test(location.protocol));
    let items = [], at = 0, seen = new Set(), first = true, demo = false;
    function show() {
      if (!items.length) items = sample();
      if (!items.length) { box.hidden = true; return; }
      box.hidden = false;
      const p = items[at % items.length]; at++;
      const tier = String(p.tier || '');
      const row = document.createElement('span');
      row.className = 'cbf-ticker-item';
      row.style.setProperty('--cbf-glow', tickerTierColor[tier.toLowerCase()] || '#d7deed');
      row.innerHTML = '<span class="cbf-ticker-tier">' + esc(tier) + '</span><span>' + esc(p.card) + '</span><span class="cbf-ticker-when">· ' +
        esc(p.packId ? packTitle({id:p.packId}) : String(p.pack || '').replace(/\s+Test Series(?:\s+\d+)?$/i,'')) + (p.pulledAt ? ' · ' + esc(timeAgo(p.pulledAt)) : '') + '</span>';
      track.replaceChildren(row);
    }
    function sample() {
      const out = [];
      for (const pack of state.packs || []) for (const card of pack.cards || []) {
        if (!feedEligible(pack, card)) continue;
        const tier = window.CardbitOpening?.tierFor(card)?.name || card.tier;
        if (tier) out.push({card:card.name || card.title, tier, packId:pack.id});
      }
      return out.sort(() => Math.random() - .5).slice(0, 12);
    }
    async function read() {
      if (signal.aborted || document.hidden) return;
      if (!hosted) { if (!items.length) { items = sample(); demo = true; } }
      else try {
        const res = await fetch('/apps/packs/api/recent?limit=12', {headers:{Accept:'application/json'}, credentials:'same-origin', cache:'no-store', signal});
        if (!res.ok) throw Error('Recent pulls unavailable');
        const data = await res.json();
        const pulls = (Array.isArray(data?.pulls) ? data.pulls : []).map(p => ({...p, packId:nativeEdition(p.productId)}))
          .filter(p => typeof p.card === 'string' && feedEligible({id:p.packId}, {tier:p.tier}));
        if (pulls.length) {
          const fresh = pulls.filter(p => !seen.has(p.id));
          pulls.forEach(p => seen.add(p.id));
          items = pulls; demo = false;
          if (!first && fresh.length) {
            at = 0;
            const big = fresh.find(p => p.topTier || /legendary|master/i.test(p.tier));
            if (big) { const r = box.getBoundingClientRect(); window.CardbitFlair?.confetti(tickerTierColor[String(big.tier).toLowerCase()] || '#ffb65c', {x:r.left + r.width/2, y:r.top}); }
          }
        } else if (!items.length) { items = sample(); demo = true; }
      } catch { if (signal.aborted) return; if (!items.length) { items = sample(); demo = true; } }
      first = false;
      tag.textContent = 'Live';
      if (!track.firstChild) show();
    }
    read();
    const poll = setInterval(read, 30000), spin = setInterval(() => { if (!document.hidden) show(); }, 4500);
    signal.addEventListener('abort', () => { clearInterval(poll); clearInterval(spin); }, {once:true});
  }

  function mountSampleFeed(feed, signal) {
    if (!feed) return () => {};
    const toggle = root.querySelector('[data-feed-toggle]');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let source = new Map(), visible = [], previousMarkup = null;
    let paused = motion.matches, hover = false, available = true;
    /* SITE */ let live = null;

    function draw() {
      /* SITE */ if (live) return drawLive();
      const markup = visible.map(ref => {
        const {card, key, pack} = source.get(ref);
        return '<li data-feed-ref="'+esc(ref)+'">'+pullCardLink(card,key,pack,false,available)+'</li>';
      }).join('') || '<li class="cb-feed-empty">No featured cards available.</li>';
      if (markup === previousMarkup) return;
      const focused = feed.contains(document.activeElement) ? document.activeElement.closest('[data-feed-ref]')?.dataset.feedRef : null;
      const scroll = feed.scrollLeft;
      feed.innerHTML = markup;
      feed.scrollLeft = scroll;
      if (focused) {
        const same = [...feed.children].find(row => row.dataset.feedRef === focused);
        (same?.querySelector('a') || feed.querySelector('a'))?.focus({preventScroll:true});
      }
      previousMarkup = markup;
    }

    function nextPull() {
      const showing = new Set(visible.map(ref => source.get(ref).key));
      const choices = [...source.values()].filter(entry => !showing.has(entry.key));
      if (!choices.length) return;
      const quoted = choices.filter(({card}) => cardBuyback(card).amount !== null);
      const candidates = quoted.length ? quoted : choices;
      const chosen = candidates[Math.floor(Math.random()*candidates.length)];
      visible = [chosen.ref, ...visible].slice(0,5);
    }

    function syncControl() {
      toggle.innerHTML = icon(paused?'play':'pause',15);
      toggle.setAttribute('aria-label',(paused?'Play':'Pause')+' Just Pulled');
      toggle.title = toggle.getAttribute('aria-label');
    }

    function update(packs) {
      available = Array.isArray(packs);
      if (available) {
        source = new Map();
        const printings = new Set();
        for (const pack of packs) for (const card of pack.cards || []) {
          if (!feedEligible(pack, card)) continue;
          const key = window.CardbitCollectorRules.printingKey(card);
          const ref = pack.id+'/'+key;
          if (!source.has(ref)) source.set(ref,{card,key,pack,ref});
          printings.add(key);
        }
        visible = visible.filter(ref => source.has(ref));
        const count = Math.min(5,printings.size);
        while (visible.length < count) nextPull();
        toggle.hidden = live ? true : printings.size <= 5;
      }
      draw();
    }

    /* SITE: Live Pulls. Real revealed pulls from /api/recent show as "Just Pulled"; until there are any,
       the feed cycles cards from the pack pools under "In the Packs" so the heading stays truthful. */
    function livePullLink(p){
      const pack=(state.packs||[]).find(x=>x.id===p.packId);
      const match=pack&&(pack.cards||[]).find(c=>cardName(c)===p.name&&String(c.number||'')===String(p.number||''));
      const route=match?'chase/'+enc(window.CardbitCollectorRules.printingKey(match)):'packs/'+enc(p.packId);
      const tier=typeof p.tier==='string'?p.tier:'';
      const color=window.CardbitOpening?.tierFor?.({tier})?.color;
      const when=timeAgo(p.at);
      const meta=[tier?tierMarkup({tier}):'',esc(packTitle({id:p.packId}))].filter(Boolean).join('<span aria-hidden="true"> · </span>');
      return link(route,miniature({image:p.image,name:p.name})+'<span class="cb-pull-copy"><strong class="cb-pull-name">'+esc(shortName({name:p.name}))+
        '</strong><span class="cb-pull-meta">'+meta+'</span></span><span class="cb-pull-quote"><span class="cb-offer-unavailable">'+esc(when)+'</span></span>',
        'cb-feed-card','aria-label="'+esc([p.name,p.set,tier,when].filter(Boolean).join(' · '))+'"'+(/^#[\da-f]{6}$/i.test(color||'')?' style="--cb-pull-tier:'+color+'"':''));
    }
    function drawLive(){
      const markup=live.slice(0,5).map(p=>'<li data-feed-ref="'+esc(p.id)+'">'+livePullLink(p)+'</li>').join('');
      if(markup===previousMarkup)return;
      feed.innerHTML=markup;previousMarkup=markup;
    }
    if(site()){
      const title=root.querySelector('#cb-feed-title');
      if(title)title.textContent='In the Packs';
      const readLive=async()=>{
        if(signal.aborted||document.hidden)return;
        try{
          const res=await fetch(window.CardbitSite.api('recent?limit=12'),{headers:{Accept:'application/json'},credentials:'same-origin',signal});
          if(!res.ok)return;
          const data=await res.json();
          const pulls=(Array.isArray(data?.pulls)?data.pulls:[]).filter(p=>p&&typeof p.id==='string'&&typeof p.name==='string');
          if(!pulls.length)return;
          live=pulls;
          if(title)title.textContent='Just Pulled';
          toggle.hidden=true;previousMarkup=null;draw();
        }catch{}
      };
      readLive();
      const livePoll=setInterval(readLive,30000);
      signal.addEventListener('abort',()=>clearInterval(livePoll),{once:true});
    }
    toggle.addEventListener('click',()=>{paused=!paused;syncControl();},{signal});
    motion.addEventListener('change',event=>{if(event.matches){paused=true;syncControl();}},{signal});
    feed.addEventListener('pointerenter',event=>{hover=event.pointerType==='mouse';},{signal});
    feed.addEventListener('pointerleave',()=>{hover=false;},{signal});
    const timer = setInterval(()=>{
      if (!available || paused || hover || document.hidden || feed.contains(document.activeElement) || feed.scrollLeft > 1) return;
      nextPull();draw();
    },8000);
    signal.addEventListener('abort',()=>clearInterval(timer),{once:true});
    syncControl();
    update(state.packs || []);
    return update;
  }

  function mountShelf() {
    const controller = new AbortController();
    const signal = controller.signal;
    const panels = [...root.querySelectorAll('[data-edition-info]')];
    const signatures = new Map();
    const updateFeed = mountSampleFeed(root.querySelector('[data-feed-items]'),signal);
    mountTicker(signal);
    mountHero(signal);
    function signature(pack) {
      return JSON.stringify([pack.priceBits, pack.remaining === 0, chaseCards(pack).map(({key,value,card}) => [key,value,card.tier,cardBuyback(card).label])]);
    }
    for (const pack of state.packs || []) signatures.set(pack.id, signature(pack));
    async function read() {
      if (working || dialog || signal.aborted) return;
      try {
        const next = await window.CardbitStore.state();
        if (working || dialog || signal.aborted) return;
        state = next;
        updateFeed(next.packs || []);
        for (const panel of panels) {
          const pack = known(next.packs, panel.dataset.editionInfo);
          const key = pack ? signature(pack) : null;
          if (signatures.get(panel.dataset.editionInfo) === key) continue;
          signatures.set(panel.dataset.editionInfo,key);
          const focused = panel.contains(document.activeElement) ? document.activeElement.dataset.cbRoute : null;
          panel.innerHTML = pack ? packInfo(pack) : '<p class="cb-chase-empty">Edition Unavailable</p>';
          if (focused) ([...panel.querySelectorAll('a')].find(a => a.dataset.cbRoute === focused) || panel.querySelector('a'))?.focus({preventScroll:true});
        }
      } catch {
        if (signal.aborted) return;
        updateFeed(null);
        for (const panel of panels) {
          panel.querySelector('.cb-chase-list')?.remove();
          const heading=panel.querySelector('.cb-chase-heading');
          if (heading) heading.textContent='Chases Unavailable';
        }
        signatures.clear();
      }
    }
    watchPoolPage(read,signal);
    return () => controller.abort();
  }


  function cardTile(c,route,meta,tail='',eager=false){
    return link(route,art(c,eager)+'<div class="cb-card-title"><h3>'+esc(cardName(c))+'</h3></div>'+(route.startsWith('vault/')?'':tierMarkup(c))+'<small>'+esc(meta||cardSet(c))+'</small>'+(tail?'<div class="cb-card-tail">'+tail+'</div>':''),'cb-card-tile');
  }
  function cardViewer(card, extraControl='') {
    const design=window.CardbitMedia?.backFor(card);
    const reverse=design && (design.url ? safeImage(design.url) : asset(design.file));
    const front = frontScan(card, true);
    const tools = extraControl || valueLine(card);
    if (!reverse) return '<div class="cb-card-view cb-unverified">'+front+'<div class="cb-scan-actions"><small>'+ (design?.file==='card-back-ja-old.webp'?'Vintage Japanese Back · Scan Pending':'Back Unverified')+'</small>'+tools+'</div></div>';
    return '<div class="cb-card-view" data-card-view><div class="cb-inspect-perspective"><div class="cb-inspect-turn">'+
      '<div class="cb-inspect-front">'+front+'</div><div class="cb-inspect-back" aria-hidden="true">'+scanMarkup(reverse,design.label,true,'',card.kind)+'</div>'+
      '</div></div><div class="cb-scan-actions">'+btn('flip-copy','Show Back','cb-ghost','aria-pressed="false"')+tools+'</div></div>';
  }
  function flipCopy(control) {
    const viewer=control.closest('[data-card-view]');
    const back=viewer.classList.toggle('cb-show-back');
    control.setAttribute('aria-pressed',String(back));
    control.textContent=back?'Show Front':'Show Back';
    viewer.querySelector('.cb-inspect-back').setAttribute('aria-hidden',String(!back));
    viewer.querySelector('.cb-inspect-front').setAttribute('aria-hidden',String(back));
  }
  // Home hero: four rotating banners at half the old hero height. Copy stays truthful while features are off.
  function heroSlides() {
    const giveawayButton = document.querySelector('script[data-cardbit-entry]')
      ? '<button type="button" class="cb-primary" data-giveaway-open aria-controls="cb-daily-giveaway" aria-expanded="false">Enter Now'+icon('arrow',17)+'</button>' : '';
    const title = root.dataset.headline?.trim();
    const custom = title && !['meet your next pull.', 'digital packs. real cards.', 'digital packs real cards'].includes(title.toLowerCase());
    const headline = custom ? esc(displayTitle(title)) : 'Digital Packs<br><em>Real Cards</em>';
    const howURL = (root.dataset.howUrl || '').trim();
    const external = /^https:\/\//i.test(howURL);
    const rewards = root.dataset.rewardsView ? '<a class="cb-primary" href="'+esc(root.dataset.rewardsView)+'">See Your Level'+icon('arrow',17)+'</a>' : '';
    const step = (n, label, short) => '<button type="button" class="cbh-how-step" data-how-step aria-pressed="'+(n===1)+'"><b>'+n+'</b><span>'+label+'</span><span class="cbh-how-short" aria-hidden="true">'+short+'</span></button>';
    return [
      {name:'Digital Packs, Real Cards', kind:'packs', html:
        '<div class="cbh-copy"><h1>'+headline+'</h1><p>Ship Your Favorites or Sell Eligible Cards for Cardbits.</p>'+
        '<div class="cb-actions"><a class="cb-primary" href="#cb-pack-counter">Explore Packs'+icon('arrow',17)+'</a></div></div>'},
      {name:'Daily 10,000 Cardbits Giveaway', kind:'giveaway', html:
        '<div class="cbh-copy"><p class="cbh-kicker">Daily Giveaway</p><h2>Win <span class="cbh-count" data-count-to="10000">10,000</span> Cardbits</h2>'+
        '<p class="cbh-clock">Next Draw In <b data-draw-clock>--:--:--</b></p><div class="cb-actions">'+giveawayButton+'</div>'+
        '<p class="cbh-fine">No Purchase Necessary. <a href="/official-rules">Official Rules</a>.</p></div>'},
      {name:'Levels and Rewards', kind:'levels', html:
        '<div class="cbh-copy"><p class="cbh-kicker">Levels &amp; Rewards</p><h2>Level Up as You Collect</h2>'+
        '<p>Earn XP From Every Pack and Daily Check-In. Each Tier Unlocks a Bigger Daily Spin.</p><div class="cb-actions">'+rewards+'</div></div>'},
      {name:'How It Works', kind:'how', html:
        '<div class="cbh-copy"><p class="cbh-kicker">New Here?</p><h2>How Cardbit Works</h2>'+
        '<div class="cb-actions">'+link('demo/mystery','Try a Demo Opening'+icon('arrow',17),'cb-primary')+'</div>'+
        (external ? '<p class="cbh-fine"><a href="'+esc(howURL)+'" target="_blank" rel="noopener">Watch the Video</a></p>' : '')+'</div>'+
        '<div class="cbh-how-steps" role="group" aria-label="How It Works Steps">'+step(1,'Get Cardbits','Cardbits')+step(2,'Open a Pack','Open')+step(3,'Keep or Sell','Keep/Sell')+step(4,'Ship Home','Ship')+'</div>'+
        '<div class="cbh-how-toggle" data-how-toggle hidden><button type="button" data-mode="keep" aria-pressed="true">Keep in Vault</button><button type="button" data-mode="sell" aria-pressed="false">Sell for Cardbits</button></div>'}
    ];
  }
  function heroCarousel() {
    const slides = heroSlides();
    const artBack = safeImage(root.dataset.art);
    const background = artBack ? ' style="--cb-showroom:url(&quot;'+esc(artBack)+'&quot;)"' : '';
    return '<section class="cbh" aria-roledescription="carousel" aria-label="Cardbit Highlights" data-hero-carousel'+background+'>'+
      '<div class="cbh-track">'+slides.map((slide,i)=>'<div class="cbh-slide cbh-'+slide.kind+(i===0?' is-active':'')+'" role="group" aria-roledescription="slide" aria-label="'+(i+1)+' of '+slides.length+': '+esc(slide.name)+'" data-slide="'+i+'"'+(i?' inert':'')+'><div class="cb-wrap cbh-inner">'+slide.html+'</div></div>').join('')+'</div>'+
      '<div class="cbh-controls"><button type="button" class="cbh-arrow" data-hero-prev aria-label="Previous Slide">'+icon('arrow',16)+'</button>'+
      '<div class="cbh-dots">'+slides.map((slide,i)=>'<button type="button" class="cbh-dot" data-hero-dot="'+i+'" aria-label="Show Slide '+(i+1)+': '+esc(slide.name)+'"'+(i===0?' aria-current="true"':'')+'></button>').join('')+'</div>'+
      '<button type="button" class="cbh-arrow cbh-next" data-hero-next aria-label="Next Slide">'+icon('arrow',16)+'</button>'+
      '<button type="button" class="cbh-pause" data-hero-pause aria-label="Pause Slides">'+icon('pause',14)+'</button></div></section>';
  }
  function mountHero(signal) {
    const box = root.querySelector('[data-hero-carousel]');
    if (!box) return;
    const slides = [...box.querySelectorAll('.cbh-slide')], dots = [...box.querySelectorAll('[data-hero-dot]')];
    const pauseBtn = box.querySelector('[data-hero-pause]');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let index = 0, timer = 0, userPaused = motion.matches, hovering = false, focused = false, countTimer = 0;
    const scenes = slides.map(slide => {
      const kind = (/\bcbh-(packs|giveaway|levels|how)\b/.exec(slide.className) || [])[1];
      try { return kind && window.CardbitHeroScenes ? window.CardbitHeroScenes.mount(slide, kind, {asset, signal, root}) : null; } catch (e) { console.warn('[cardbit hero]', e); return null; }
    });
    box._scenes = scenes;
    const clock = box.querySelector('[data-draw-clock]');
    if (clock && window.CardbitHeroScenes) { const tick = () => window.CardbitHeroScenes.drawClock(clock); tick(); const ct = setInterval(tick, 1000); signal.addEventListener('abort', () => clearInterval(ct), {once:true}); }
    function countUp(slide) {
      clearInterval(countTimer);
      const node = slide.querySelector('[data-count-to]');
      if (!node) return;
      const to = Number(node.dataset.countTo);
      if (motion.matches) { node.textContent = to.toLocaleString('en-US'); return; }
      let i = 0; const steps = 28;
      countTimer = setInterval(() => { i++; node.textContent = Math.round(to * (1 - Math.pow(1 - i/steps, 3))).toLocaleString('en-US'); if (i >= steps) clearInterval(countTimer); }, 40);
    }
    function show(next, fromUser) {
      index = (next + slides.length) % slides.length;
      slides.forEach((slide, i) => {
        const on = i === index;
        slide.classList.toggle('is-active', on);
        slide.toggleAttribute('inert', !on);
        if (!on) { slide.querySelectorAll('video').forEach(v => { try { v.pause(); } catch {} }); scenes[i]?.stop(); }
        else { playFilm(slide); scenes[i]?.start(); }
      });
      dots.forEach((dot, i) => on(dot, i === index));
      countUp(slides[index]);
      if (fromUser) restart();
    }
    function playFilm(slide) {
      const v = slide.querySelector('.cbh-video');
      if (!v || motion.matches) return;
      if (!v.src && v.dataset.src) v.src = v.dataset.src;
      v.addEventListener('playing', () => slide.classList.add('is-playing'), {once:true, signal});
      v.play?.().catch(() => {});
    }
    function on(dot, active) { if (active) dot.setAttribute('aria-current','true'); else dot.removeAttribute('aria-current'); }
    function running() { return !userPaused && !hovering && !focused && !document.hidden; }
    function restart() { clearTimeout(timer); if (running()) timer = setTimeout(() => show(index + 1), slides[index]?.classList.contains('cbh-how') ? 17500 : 8000); }
    function syncPause() {
      pauseBtn.innerHTML = icon(userPaused ? 'play' : 'pause', 14);
      pauseBtn.setAttribute('aria-label', userPaused ? 'Play Slides' : 'Pause Slides');
      box.classList.toggle('is-paused', userPaused);
    }
    box.querySelector('[data-hero-prev]').addEventListener('click', () => show(index - 1, true), {signal});
    box.querySelector('[data-hero-next]').addEventListener('click', () => show(index + 1, true), {signal});
    dots.forEach((dot, i) => dot.addEventListener('click', () => show(i, true), {signal}));
    pauseBtn.addEventListener('click', () => { userPaused = !userPaused; syncPause(); restart(); }, {signal});
    box.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { hovering = true; clearTimeout(timer); } }, {signal});
    box.addEventListener('pointerleave', () => { hovering = false; restart(); }, {signal});
    box.addEventListener('focusin', () => { focused = true; clearTimeout(timer); }, {signal});
    box.addEventListener('focusout', e => { if (!box.contains(e.relatedTarget)) { focused = false; restart(); } }, {signal});
    box.addEventListener('keydown', e => {
      if (e.target.closest('input,textarea,select')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1, true); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1, true); }
    }, {signal});
    let startX = null, startY = 0;
    box.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') { startX = e.clientX; startY = e.clientY; } }, {signal});
    box.addEventListener('pointerup', e => {
      if (startX == null) return;
      const dx = e.clientX - startX, dy = e.clientY - startY; startX = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) show(index + (dx < 0 ? 1 : -1), true);
    }, {signal});
    box.addEventListener('pointercancel', () => { startX = null; }, {signal});
    document.addEventListener('visibilitychange', restart, {signal});
    motion.addEventListener('change', e => { if (e.matches) { userPaused = true; syncPause(); restart(); } }, {signal});
    signal.addEventListener('abort', () => { clearTimeout(timer); clearInterval(countTimer); }, {once:true});
    syncPause(); restart(); scenes[0]?.start();
  }
  function home() {
    const counter = shelfOrder();
    const shelf = counter.length ? '<div class="cb-shelf">'+counter.map(packTile).join('')+'</div>' :
      empty('No Packs Available','Check Back for the Next Release.');
    return heroCarousel()+'<div class="cb-wrap cb-stack cb-home-stack">'+/* SITE */(site() ? pullFeed() : '')+
      '<section id="cb-pack-counter" tabindex="-1">'+sectionHd(shelfTitle())+shelf+'</section>'+
      (root.dataset.welcomeShelf !== 'false' ? window.CardbitWelcome?.teaser('home') || '' : '')+featuredSingles()+'</div>';
  }

  function shopTile(card, meta) {
    const price = retailAmount(card);
    return link('shop/'+enc(card.id),frontScan(card,false)+'<div class="cb-card-title"><h3>'+esc(cardName(card))+'</h3></div>'+tierMarkup(card)+
      '<small>'+esc(meta)+'</small><div class="cb-card-tail"><strong>'+ (price == null?'Price Pending':money(price))+
      '</strong>'+(!card.available?'<span>Sold Out</span>':'')+'</div>','cb-card-tile');
  }

  function featuredSingles() {
    const picks=(state.singles||[]).filter(card=>card.available>0 && retailAmount(card)!=null).slice(0,5);
    if (!picks.length) return '';
    return '<section>'+sectionHd('Shop Singles','shop','View All')+'<div class="cb-card-grid cb-featured">'+
      picks.map(card=>shopTile(card,cardSet(card))).join('')+'</div></section>';
  }

  function packsPage() {
    return '<div class="cb-wrap cb-page"><div class="cb-section-head cb-pack-page-head"><h1>'+esc(shelfTitle())+'</h1>'+
      link('packs/compare/mystery/gold','Compare Editions'+icon('arrow',15),'cb-textlink')+'</div>'+
      (state.packs?.length ? '<div class="cb-shelf cb-page-shelf">'+shelfOrder().map(packTile).join('')+'</div>' :
        empty('No Packs Available','Check Back for the Next Release.'))+'</div>';
  }


  function percentage(hits, total) {
    const scaled = hits * 10000n;
    const rounded = (scaled * 2n + total) / (total * 2n);
    if (hits && !rounded) return '<0.01%';
    if (hits < total && rounded === 10000n) return '>99.99%';
    return (Number(rounded) / 100).toLocaleString('en-US') + '%';
  }

  function countedOdds(hits, total) {
    if (!Number.isSafeInteger(hits) || !Number.isSafeInteger(total) || hits < 0 || total < 1 || hits > total) return null;
    return percentage(BigInt(hits), BigInt(total));
  }

  // Only the device walkthrough draws individual copies uniformly without replacement.
  function uniformOdds(copies, total, size) {
    if (![copies,total,size].every(Number.isSafeInteger) || size < 1 || total < size || copies < 0 || copies > total) return null;
    let all = 1n;
    let miss = copies + size > total ? 0n : 1n;
    for (let i = 0; i < size; i++) {
      all *= BigInt(total - i);
      if (miss) miss *= BigInt(total - copies - i);
    }
    return percentage(all - miss, all);
  }

  function poolOdds(pool, cards, uniform = false) {
    const size = pool.cardsPerPack;
    const copies = cards.reduce((sum, card) => sum + card.remaining, 0);
    const complete = Math.floor(copies / size);
    if (pool.status === 'CLOSED') return {message:'This Series Is Closed.'};
    if (!Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(copies)) return {message:'Per-Pack Odds Are Unavailable.'};
    if (!complete || pool.packsRemaining === 0 || pool.completePacks === 0) return {message:'There Are No Complete Packs Left.'};
    if ((pool.packsRemaining != null && pool.packsRemaining !== complete) ||
        (pool.completePacks != null && pool.completePacks !== complete)) return {message:'Pool Counts Are Updating.'};
    const counted = pool.completePacks === complete;
    if (size > 1 && !uniform && !counted) return {message:'This Series Has Not Supplied per-Pack Odds.'};

    const byTier = new Map();
    const tierCounts = new Map();
    const cardTier = card => tierName(card) || 'Unassigned';
    for (const card of cards) {
      const name = cardTier(card);
      byTier.set(name, (byTier.get(name) || 0) + card.remaining);
    }
    for (const row of pool.tiers || []) {
      const name = cardTier({tier:row.name});
      // Two distinct server labels can share a display name. Their pack memberships may overlap.
      tierCounts.set(name,tierCounts.has(name) ? null : row.packsContaining);
      if (!byTier.has(name)) byTier.set(name,0);
    }
    const assigned = [...byTier.keys()].some(name => name !== 'Unassigned');
    const standard = Object.keys(window.CardbitLatchScene?.tiers || {});
    const names = new Set([...standard.filter(name => byTier.has(name) ||
      (assigned && !byTier.has('Unassigned') && [...byTier.keys()].every(t => standard.includes(t)))), ...byTier.keys()]);
    const copyOdds = count => uniform ? uniformOdds(count,copies,size) : countedOdds(count,complete);
    const fromCopies = uniform || size === 1;
    const tiers = assigned ? [...names].map(name => {
      const count = byTier.get(name) || 0;
      const hits = tierCounts.get(name);
      const odds = fromCopies ? copyOdds(count) : countedOdds(!byTier.has(name) ? 0 : hits,complete);
      return {name, odds};
    }) : [];
    return {tiers, card:card => fromCopies ? copyOdds(card.remaining) : countedOdds(card.packsContaining,complete),
      multi:size > 1, uniform};
  }

  function oddsValue(odds) {
    return odds == null ? '<span class="cb-odds-unavailable">Unavailable</span>' : '<strong>' + esc(odds) + '</strong>';
  }
  function tierSymbol(name) { return window.CardbitOpening?.tierSymbol(name) || ''; }
  function tierOddsContent(model, poolPath) {
    if (model.message || !model.tiers?.length) return '<p class="cb-odds-note">' +
      esc(model.message || 'Tiers Are Unavailable for This Pool.') + '</p>';
    const shortNames = {Common:'Com', Uncommon:'Unc', Rare:'Rare', Epic:'Epic', Legendary:'Leg'};
    const label = model.multi ? 'Chance per Pack of at Least One Card of Each Tier. A Pack May Contain Several Tiers.' : 'Tier Odds per Pack';
    return '<nav class="cb-odds-scroll" aria-label="'+esc(label)+'"><div class="cb-odds-grid">' +
      model.tiers.slice().sort((a,b) => compareTiers(a.name,b.name)).map(({name,odds}) => {
        const short = Object.hasOwn(shortNames,name) ? shortNames[name] : '';
        const color = window.CardbitLatchScene?.tiers?.[name]?.color;
        const style = /^#[0-9a-f]{6}$/i.test(color || '') ? ' style="--cb-tier-color:'+color+'"' : '';
        const term = '<span class="cg-tier-full">'+esc(name)+'</span>'+(short ? '<abbr class="cg-tier-short" title="'+esc(name)+'">'+esc(short)+'</abbr>' : '');
        return link(poolPath+'/'+enc(name),tierSymbol(name)+oddsValue(odds)+'<span class="cg-tier-label">'+term+'</span>',
          'cb-odds-link',style+' title="'+esc(name)+'" aria-label="'+esc(name+' · '+(odds ?? 'odds unavailable')+' · view available cards')+'"');
      }).join('')+'</div></nav>';
  }
  function tierOddsPanel(content) {
    return '<section class="cb-tier-odds" aria-labelledby="cb-tier-odds-title"><h2 id="cb-tier-odds-title">Tier Pull Odds</h2>' +
      '<div data-tier-odds>' + (content || '<p class="cb-odds-note">Loading Odds…</p>') + '</div></section>';
  }
  function appSeriesEnabled(pack) {
    if (!root.dataset.memberPath && window.CardbitPackStage && !window.CardbitPackStage.initial(pack.id)?.cardIds.length) return false;
    return !isDemoShopper() && (root.dataset.mode === 'demo' || !!root.dataset.memberPath) && Object.hasOwn(editionProducts,pack.id) &&
      (pack.id === 'cobalt' || Boolean(root.dataset.previewTheme || root.dataset.memberPath));
  }

  function isMysteryRoute(route) {
    const [page,id,sub] = route.split('/');
    return (page==='packs'||page==='demo') && (!sub || sub==='pool') && appSeriesEnabled({id});
  }

  function tierName(card) {
    return window.CardbitOpening?.tierFor?.(card)?.name || (typeof card.tier === 'string' ? card.tier.trim() : '');
  }
  function tierMarkup(card) {
    const name = tierName(card);
    if (!name) return '';
    return window.CardbitOpening?.tierBadgeHtml?.(card) || '<span class="cb-tier-badge">'+esc(name)+'</span>';
  }
  function compareTiers(a, b) {
    const tiers = window.CardbitPackStage?.tiers || ['Common','Uncommon','Rare','Epic','Legendary'];
    return tiers.indexOf(b) - tiers.indexOf(a) || a.localeCompare(b);
  }
  function availableRows(cards) {
    return cards.filter(card => card.remaining > 0)
      .sort((a,b) => compareTiers(tierName(a),tierName(b)) || cardName(a).localeCompare(cardName(b)));
  }
  function poolQuote(card) {
    const {amount} = cardBuyback(card);
    return '<span class="cb-art-value">'+(amount === null ? 'Offer unavailable' : money(amount))+'</span>';
  }
  function seriesCardTiles(cards, odds) {
    return cards.map(card => {
      const details = [cardSet(card), card.number, card.printing].filter(Boolean).join(' · ');
      const tier = tierMarkup(card);
      const meta = odds ? '<div class="cb-card-odds">' + tier +
        '<span class="cb-odds-sr">Pull Odds </span>' + oddsValue(odds.card?.(card)) + '</div>' : tier;
      return '<article class="cb-card-tile">' + (odds ? frontScan(card,false) + poolQuote(card) : art(card)) + '<h3>' + esc(cardName(card)) +
        '</h3>' + meta + '<small>' + esc(details) + '</small></article>';
    }).join('');
  }

  function seriesGallery() {
    return '<section class="cb-pool" id="cb-product-pool" aria-labelledby="cb-pool-heading">' +
      '<div class="cb-section-head"><h2 id="cb-pool-heading" tabindex="-1">Cards and Pull Odds</h2></div>' +
      '<p class="cb-sub" data-card-odds-basis hidden></p>' +
      '<div class="ct-search"><label for="cb-series-search">Search the Card Pool</label><div>' + icon('search',20) +
      '<input id="cb-series-search" type="search" placeholder="Card Name, Set, Number, or Finish"></div></div>' +
      '<fieldset class="cb-tier-filters" hidden><legend>Filter by Tier</legend><div class="cb-tier-options"></div></fieldset>' +
      '<p class="ct-count" data-series-count role="status"></p><div class="cb-card-grid" data-series-cards></div></section>';
  }

  function seriesPoolPage(id, tier = '') {
    return '<div class="cb-wrap cb-page" data-series-pool="'+esc(tier)+'">' + bread('packs/'+id,packTitle({id})) +
      '<h1>'+esc(tier ? tier+' Cards · '+packTitle({id}) : packTitle({id})+' Card Pool')+'</h1><p class="cb-sub" data-series-source role="status">Loading the Card Pool…</p>' +
      tierOddsPanel() + seriesGallery() + '</div>';
  }

  // "Odds Left" meters: copies of each tier still sealed in unclaimed packs, against the pool's starting count.
  // Only drawn from real remaining/total counts; nothing is shown when the pool does not supply both.
  const meterColor = {common:'#aeb8d8', uncommon:'#62e987', rare:'#538fff', epic:'#b47aff', legendary:'#ffb65c', master:'#ffb65c'};
  function oddsLeftMeter(series, cards) {
    let rows = Array.isArray(series?.tiers) && series.tiers.every(t => t && typeof t.name === 'string' &&
      Number.isSafeInteger(t.remaining) && Number.isSafeInteger(t.total) && t.total > 0 && t.remaining <= t.total)
      ? series.tiers.map(t => ({name:t.name, left:t.remaining, total:t.total})) : null;
    if (!rows?.length && (cards || []).length && cards.every(c => Number.isSafeInteger(c.quantity) && c.quantity > 0 && c.remaining <= c.quantity)) {
      const by = new Map();
      for (const c of cards) { const name = tierName(c) || 'Unassigned'; const row = by.get(name) || {name, left:0, total:0}; row.left += c.remaining; row.total += c.quantity; by.set(name,row); }
      const order = Object.keys(window.CardbitLatchScene?.tiers || {});
      rows = [...by.values()].sort((a,b) => (order.indexOf(b.name) - order.indexOf(a.name)));
    }
    if (!rows?.length) return '';
    const items = rows.map(r => {
      const share = Math.round(r.left / r.total * 1000) / 10;
      const color = meterColor[String(r.name).toLowerCase()] || '#9fb0ff';
      return '<li><span>' + esc(r.name) + '</span><span class="cbf-odds-bar" role="meter" aria-valuemin="0" aria-valuemax="' + r.total +
        '" aria-valuenow="' + r.left + '" aria-label="' + esc(r.name + ': ' + r.left + ' of ' + r.total + ' left') + '"><i style="--cbf-left:' + share +
        '%;--cbf-glow:' + color + '"></i></span><span class="cbf-odds-count">' + number(r.left) + ' / ' + number(r.total) + '</span></li>';
    }).join('');
    const packs = Number.isSafeInteger(series.packsRemaining) && Number.isSafeInteger(series.totalPacks)
      ? '<p>' + number(series.packsRemaining) + ' of ' + number(series.totalPacks) + ' Packs Left. Meters Drain as Packs Are Opened.</p>'
      : '<p>Meters Drain as Packs Are Opened.</p>';
    return '<section class="cbf-odds" aria-label="Odds Left"><h3>Odds Left</h3><ul>' + items + '</ul>' + packs + '</section>';
  }
  function mysteryProduct(pack, portrait) {
    return '<div class="cb-wrap cb-page" data-series-pool>' + bread('packs','All Packs') + '<div class="cb-detail cb-detail-with-odds">' +
      portrait + '<div class="cb-detail-copy"><h1>' +
      esc(packTitle(pack)) + '</h1>' + categoryTags(pack.id) + tierOddsPanel() + '<div data-odds-left hidden></div>' +
      '<p class="cb-detail-desc" data-series-source role="status">Loading This Product’s Card Pool…</p>' +
      '<div class="cb-actions"><span data-series-buy></span><button class="cb-secondary" type="button" data-series-demo disabled>' + icon('play',15) +
      demoOpeningLabel + '</button>' + link('packs/' + enc(pack.id) + '/pool','View Card Pool','cb-secondary') + '</div>' +
      '<p class="cb-micro">Demo openings use no Cardbits and add no cards to your vault.</p></div></div>' + seriesGallery() + pages.detailsForPack(pack,null) + '</div>';
  }

  function pickSeriesSample(cards, size) {
    const copies = cards.filter(card => card.remaining > 0).map(card => ({card, count:card.remaining}));
    let total = copies.reduce((sum, row) => sum + row.count, 0);
    if (total < size || size < 1) return [];
    const sample = [];
    for (let i=0; i<size; i++) {
      let target = Math.floor(Math.random() * total);
      const selected = copies.find(row => { target -= row.count; return target < 0; });
      sample.push({...selected.card, copyId:'sample-mystery-' + (i+1)});
      selected.count--;
      total--;
    }
    const ranks=window.CardbitPackStage?.tiers;
    return ranks ? sample.sort((a,b)=>(a.cardbitValue??0)-(b.cardbitValue??0) || ranks.indexOf(a.tier)-ranks.indexOf(b.tier)) : sample;
  }

  // Keep read-only pool views current. An opening has its own fixed result.
  function watchPoolPage(read, signal) {
    let timer, pending = false;
    function schedule() {
      clearTimeout(timer);
      if (!signal.aborted && !document.hidden) timer = setTimeout(refresh,30000);
    }
    async function refresh() {
      clearTimeout(timer);
      if (document.hidden || pending || signal.aborted) return;
      pending = true;
      try { await read(); } finally { pending = false; schedule(); }
    }
    document.addEventListener('visibilitychange',refresh,{signal});
    window.addEventListener('focus',refresh,{signal});
    window.addEventListener('pageshow',event => { if (event.persisted) refresh(); },{signal});
    signal.addEventListener('abort',() => clearTimeout(timer),{once:true});
    schedule();
  }

  function mountFixtureOdds(panel, id) {
    const controller = new AbortController();
    const signal = controller.signal;
    let unavailable = false, reading = false;
    async function refreshFixture() {
      if (working || dialog || signal.aborted || reading) return;
      reading = true;
      try {
        const next = await window.CardbitStore.state();
        if (signal.aborted || working || dialog) return;
        const poolState = packs => id === 'compare' ? packs : known(packs,id);
        if (!unavailable && JSON.stringify(poolState(next.packs)) === JSON.stringify(poolState(state?.packs))) return;
        const guideOpen = panel.querySelector('.cg-guide')?.open;
        const focused = document.activeElement?.dataset.compare;
        state = next;
        render();
        const guide = root.querySelector('.cg-guide');
        if (guide && guideOpen) guide.open = true;
        if (focused !== undefined) root.querySelector('[data-compare="'+focused+'"]')?.focus({preventScroll:true});
      } catch {
        if (signal.aborted || unavailable) return;
        unavailable = true;
        const guide = panel.querySelector('[data-guide-body]');
        if (guide) guide.innerHTML = pages.guideBody({id},null);
        if (id === 'compare') panel.innerHTML = '<p role="status">The current pools could not be loaded. Checking again automatically.</p>';
        const summary = panel.querySelector('[data-tier-odds]');
        if (summary) summary.innerHTML = tierOddsContent({message:'Current Pull Odds Are Unavailable.'});
        panel.querySelectorAll('.cb-card-odds strong').forEach(node => { node.textContent = 'Unavailable'; });
      } finally { reading = false; }
    }
    watchPoolPage(refreshFixture,signal);
    refreshFixture();
    return () => controller.abort();
  }

  function mountSeriesPool(panel) {
    const controller = new AbortController();
    const signal = controller.signal;
    const snapshot = window.CardbitMysteryPool;
    const id = readRoute().split('/')[1] || 'cobalt';
    const product = editionProducts[id];
    const saved = String(snapshot?.product) === product && Array.isArray(snapshot?.cards) ? snapshot.cards : [];
    const byTitle = new Map(saved.map(card => [card.title,card]));
    const search = panel.querySelector('input');
    const status = panel.querySelector('[data-series-source]');
    const demo = panel.querySelector('[data-series-demo]');
    const theater = panel.querySelector('[data-series-opening]');
    const count = panel.querySelector('[data-series-count]');
    const grid = panel.querySelector('[data-series-cards]');
    const filters = panel.querySelector('.cb-tier-filters');
    const poolPath = 'packs/'+enc(id)+'/pool';
    const selectedTier = panel.dataset.seriesPool || '';
    const hosted = Boolean((root.dataset.previewTheme || root.dataset.memberPath) && /^https?:$/.test(location.protocol));
    const stage = window.CardbitPackStage;
    const staged = Boolean(stage && (!window.CardbitStore || window.CardbitStore.mode === 'device-test'));
    const watchOdds = (hosted || staged) && Boolean(grid) && !theater;
    let request, lastResponse;
    let filterKey = '';
    let cards = [];
    let current = false;
    let odds = {message:'Pull Odds Are Unavailable.'};
    let player;

    function showOdds(model) {
      odds = model;
      const summary = panel.querySelector('[data-tier-odds]');
      if (summary) {
        const scroll = summary.querySelector('.cb-odds-scroll');
        const left = scroll?.scrollLeft || 0;
        const focused = scroll?.contains(document.activeElement) ? document.activeElement.dataset.cbRoute : null;
        summary.innerHTML = tierOddsContent(model,poolPath);
        const replacement = summary.querySelector('.cb-odds-scroll');
        if (replacement && left) replacement.scrollLeft = left;
        if (focused) [...replacement?.querySelectorAll('a') || []].find(a => a.dataset.cbRoute === focused)?.focus({preventScroll:true});
      }
      const basis = panel.querySelector('[data-card-odds-basis]');
      if (basis) {
        basis.hidden = !model.message;
        basis.textContent = model.message || '';
      }
    }

    function clearBuy() {
      panel.querySelector('[data-series-buy]')?.replaceChildren();
      const guide = panel.querySelector('[data-guide-body]');
      if (guide) guide.innerHTML = pages.guideBody({id},null);
    }
    function showTierFilters() {
      if (!filters) return;
      const names = [...new Set(cards.map(card => tierName(card) || 'Unassigned'))].sort(compareTiers);
      if (selectedTier && !names.includes(selectedTier)) names.push(selectedTier);
      filters.hidden = !names.length;
      const key = JSON.stringify(names);
      if (filterKey === key) return;
      filterKey = key;
      filters.querySelector('.cb-tier-options').innerHTML = ['', ...names].map(name =>
        link(poolPath+(name ? '/'+enc(name) : ''),name ? tierMarkup({tier:name}) : 'All Tiers',
          'cb-tier-choice',name === selectedTier ? 'aria-current="page"' : '')).join('');
    }
    function showCards() {
      if (!grid) return;
      const normalize = window.CardbitCollectorRules.normalize;
      const terms = normalize(search.value).split(/\s+/).filter(Boolean);
      const available = availableRows(cards);
      const matches = available.filter(card => {
        const text = normalize([card.title,card.name,card.set,card.number,card.printing,card.tier].join(' '));
        return (!selectedTier || selectedTier === (tierName(card) || 'Unassigned')) && terms.every(term => text.includes(term));
      });
      count.textContent = terms.length || selectedTier ? matches.length + ' of ' + plural(available.length,'printing') : plural(available.length,'printing');
      grid.innerHTML = matches.length ? seriesCardTiles(matches,odds) :
        '<p class="cb-sub">' + (terms.length ? 'No matching printings. Try another name or set number.' : selectedTier ? 'No cards are available in this tier.' : 'No cards are available in this pool.') + '</p>';
    }

    // The shared player’s demo option controls its badge. The sample flag controls free-opening behavior.
    function showDemoResult(sample) {
      const pack = {id};
      const edition = {...skin(pack.id),id:pack.id,presentation:'storefront',image:wrapper(pack),color:skin(pack.id).hue};
      if (window.CardbitOpening?.mount) {
        try {
          player = window.CardbitOpening.mount(theater,{edition,cards:sample,demo:false,sample:true,asset,
            finishLabel:'Back to '+packTitle(pack),onFinish:()=>navigate('packs/'+id),onInspect:sampleInspect,
            onShare:()=>collectors.share(edition.name,sample,edition.image)});
          return;
        } catch { player?.destroy?.(); }
      }
      theater.innerHTML = '<h2>Opening Results</h2><div class="cb-card-grid">' + seriesCardTiles(sample) + '</div>';
    }

    function display(series) {
      if (!Array.isArray(series.cards) || !Number.isInteger(series.cardsPerPack) || series.cardsPerPack < 1 ||
          !(series.preview && window.CardbitPackStage || ['LIVE','CLOSED'].includes(series.status)) || !series.cards.every(c => c && typeof c.title === 'string' &&
            c.title.trim() && Number.isSafeInteger(c.remaining) && c.remaining >= 0)) throw Error('Invalid Product Pool');
      cards = series.cards.map(card => {
        const labels = byTitle.get(card.title);
        return {...labels,...card,tier:card.tier,name:card.name || labels?.name || card.title,image:card.imageUrl || card.image || labels?.image};
      });
      const title = panel.querySelector('[data-series-title]');
      if (title) title.textContent = (series.title || packTitle({id})).replace(/\s+Test Series(?:\s+\d+)?$/i,'');
      const copies = cards.reduce((sum,card)=>sum+card.remaining,0);
      const available = (series.status === 'LIVE' || series.preview) && series.packsRemaining !== 0 && copies >= series.cardsPerPack;
      showOdds(poolOdds(series,cards,Boolean(series.preview)));
      const leftNode = panel.querySelector('[data-odds-left]');
      if (leftNode) { const meter = oddsLeftMeter(series, cards); leftNode.innerHTML = meter; leftNode.hidden = !meter; }
      const guide = panel.querySelector('[data-guide-body]');
      if (guide) guide.innerHTML = pages.guideBody({id},current ? {...series,cards} : null,odds,poolPath);
      const stock = current ? plural(copies,'copy') + ' Remaining. ' : '';
      status.textContent = (current ? '' : 'Archived Card Pool. ') + plural(series.cardsPerPack,'card') + ' per Pack. ' + stock +
        (available ? '' : series.status === 'CLOSED' ? 'This Series Is Closed.' : 'There Are No Complete Packs Left.');
      if (theater && available && series.cardsPerPack > 1) status.textContent +=
        ' Demo Openings Draw Individual Cards. The Listed Odds Apply to Complete Packs.';
      showTierFilters();
      if (series.preview) {
        status.textContent = plural(series.cardsPerPack,'card')+' per Pack · Pool Size: '+plural(series.packsRemaining,'pack')+'.';
        if (series.startingOnly) status.textContent += ' Showing the Starting Pool. Progress Cannot Be Saved in This Browser.';
      }
      showCards();
      if (demo) demo.disabled = !available;
      const buy = panel.querySelector('[data-series-buy]');
      if (buy) {
        if (series.walletOnly && !isDemoShopper()) buy.innerHTML=available ? link('cardbits/'+id,'Buy With Cardbits','cb-primary') : '';
        else if (staged) buy.innerHTML = purchaseControl('open',id,series.priceBits,available,'Buy Pack');
        else if (available && (stage || id !== 'cobalt')) buy.innerHTML = link('packs/'+id+'/walkthrough','Buy Pack','cb-primary');
        else buy.replaceChildren();
      }
      if (theater && available) showDemoResult(pickSeriesSample(cards,series.cardsPerPack));
    }

    function displayIfChanged(series) {
      const key = JSON.stringify([series.handle,series.title,series.status,series.cardsPerPack,series.packsRemaining,
        series.completePacks,series.tiers,series.cards,series.asOf,series.startingOnly]);
      if (key === lastResponse) return;
      current = true;
      display(series);
      lastResponse = key;
    }

    async function readProductPool() {
      if (signal.aborted || request) return;
      const active = new AbortController();
      request = active;
      const timeout = setTimeout(() => active.abort(),10000);
      try {
        if (staged && hosted && /^\d+$/.test(product || '')) {
          const live = await fetch(window.CardbitSite.api('pool?product='+enc(product)),{credentials:'same-origin',cache:'no-store',signal:active.signal});
          if(live.ok){
            const actual=await live.json();
            if(actual.walletOnly && !signal.aborted){displayIfChanged(actual);return;}
          } else if(live.status!==404)throw Error('Pool Availability Could Not Be Verified');
        }
        if (staged) {
          const cancelled = new Promise((_,reject) => active.signal.addEventListener('abort',
            () => reject(Error('Pool Read Interrupted')),{once:true}));
          const ledger = await Promise.race([window.CardbitStore?.state(),cancelled]);
          if (signal.aborted || active.signal.aborted) return;
          if (ledger) state = ledger;
          const pack = ledger ? known(ledger.packs,id) : stage.initial(id);
          if (!pack) throw Error('Pool Unavailable');
          displayIfChanged({...stage.series(pack),startingOnly:!ledger || Boolean(ledger.storageUnavailable)});
          return;
        }
        if (!/^\d+$/.test(product || '')) throw Error('Missing Product');
        if (!hosted) {
          if (!snapshot?.cardsPerPack || !saved.length) throw Error('Missing Saved Pool');
          display({...snapshot,cards:saved});
          return;
        }
        const response = await fetch(window.CardbitSite.api('pool?product=' + enc(product)), {
          headers:{Accept:'application/json'},credentials:'same-origin',cache:'no-store',signal:active.signal
        });
        if (signal.aborted) return;
        if (response.status === 404) {
          if (lastResponse === 'missing') return;
          lastResponse = 'missing';
          current = false;
          cards = [];
          if (demo) demo.disabled = true;
          clearBuy();
          const title = panel.querySelector('[data-series-title]');
          if (title) title.textContent = '';
          status.textContent = 'This Product Has No Visible Card Pool in Mystery Packs.';
          showOdds({message:'Odds Will Appear When a Pool Is Linked to This Edition.'});
          showTierFilters();
          showCards();
          return;
        }
        if (!response.ok) throw Error('Pool Unavailable');
        const series = await response.json();
        if (signal.aborted) return;
        displayIfChanged(series);
      } catch {
        if (signal.aborted || lastResponse === 'unavailable') return;
        lastResponse = 'unavailable';
        current = false;
        if (!cards.length && !staged) cards = saved;
        showOdds({message:'Current Pull Odds Are Unavailable.'});
        if (demo) demo.disabled = true;
        clearBuy();
        status.textContent = 'The Current Pool Could Not Be Loaded. ' +
          (!theater && cards.length ? 'Showing the Last Available Card List. ' : '') +
          (watchOdds ? 'Checking Again Automatically.' : 'Reload to Try Again.');
        showTierFilters();
        showCards();
      } finally {
        clearTimeout(timeout);
        request = null;
      }
    }

    search?.addEventListener('input',showCards,{signal});
    demo?.addEventListener('click',()=>navigate('demo/'+id),{signal});
    if (watchOdds) watchPoolPage(readProductPool,signal);
    readProductPool();
    return () => {
      controller.abort();
      request?.abort();
      player?.destroy?.();
    };
  }

  function fixtureOdds(pack) {
    return poolOdds({...pack,packsRemaining:pack.remaining}, pack.cards || [], pack.drawModel === 'uniform-without-replacement');
  }
  function fixturePoolPage(pack, walkthrough, tier = '') {
    const rows = window.CardbitPackStage && pack.cards ? window.CardbitPackStage.aggregate(pack.cards, pack.cardsPerPack) : (pack.cards || []);
    const model = fixtureOdds(pack);
    const path = 'packs/' + enc(pack.id) + (walkthrough ? '/walkthrough' : '');
    const available = availableRows(rows).filter(card => !tier || (tierName(card) || 'Unassigned') === tier);
    const poolPath = path+'/pool';
    return '<div class="cb-wrap cb-page" data-fixture-odds>' + bread(path,packTitle(pack)) + '<h1>' +
      esc(tier ? tier+' Cards · '+packTitle(pack) : packTitle(pack)+' Card Pool') + '</h1>'+
      tierOddsPanel(tierOddsContent(model,poolPath)) + (tier ? link(poolPath,'All Tiers','cb-textlink') : '')+
      '<p class="ct-count">'+plural(available.length,'printing')+'</p>'+
      (available.length ? '<div class="cb-card-grid">'+seriesCardTiles(available,model)+'</div>' :
        '<p>No cards are available '+(tier ? 'in this tier.' : 'in this pool.')+'</p>')+'</div>';
  }
  function packDetail(pack, walkthrough=false) {
    const edition = skin(pack.id);
    const portrait = '<div class="cb-detail-stage" style="--foil:' + edition.hue + '"><div class="cb-stage-ring"></div>' +
      '<img class="cb-pack-portrait" alt="' + esc(edition.name) + ' foil pack" src="' + esc(wrapper(pack)) + '"></div>';
    if (pack.remaining === 0 && (!pack.cards || !pack.cards.length)) {
      return '<div class="cb-wrap cb-page">'+bread('packs','All Packs')+'<div class="cb-detail">'+portrait+
        '<div class="cb-detail-copy"><h1>'+esc(edition.name)+'</h1><p class="cb-lead">Sold Out</p>'+
        link('packs','Browse Packs','cb-secondary')+'</div></div>'+pages.detailsForPack(pack)+'</div>';
    }
    if (!walkthrough && appSeriesEnabled(pack)) return mysteryProduct(pack, portrait);
    const count = pack.cardsPerPack || 5;
    const rows = window.CardbitPackStage && pack.cards ? window.CardbitPackStage.aggregate(pack.cards, pack.cardsPerPack) : (pack.cards || []);
    const available = pack.remaining > 0;
    const inStock = availableRows(rows);
    const odds = fixtureOdds(pack);
    const checkout = purchaseControl('open', pack.id, pack.priceBits, available, 'Buy Pack');
    const controls = checkout + (available ? link('demo/' + enc(pack.id), icon('play',15) + demoOpeningLabel,'cb-secondary') : '');
    const factLabels = ['Pack Size','Pool Size','Price'];
    const factsMarkup = '<div class="cb-facts"><div><small>' + factLabels[0] + '</small><b>' + plural(count, 'card') +
      '</b></div><div><small>' + factLabels[1] + '</small><b>' + plural(pack.remaining, 'pack') +
      '</b></div><div><small>' + factLabels[2] + '</small><b>' + money(pack.priceBits) + '</b></div></div>';

    const path = 'packs/' + enc(pack.id) + (walkthrough ? '/walkthrough' : '');
    const intro = '<div class="cb-detail-copy"><h1>' + esc(edition.name) +
      '</h1>' + categoryTags(pack.id) + tierOddsPanel(tierOddsContent(odds,path+'/pool')) + factsMarkup + '<div class="cb-actions">' + controls + link(path+'/pool','View Card Pool','cb-secondary') + '</div></div>';

    const remaining = available ? (pack.remainingCards ?? rows.reduce((sum, card) => sum + (Number(card.remaining) || 0), 0)) : 0;
    const poolNote = odds.message ? '<p class="cb-sub">' + esc(odds.message) + '</p>' : '';
    const visibleCards = inStock;
    const tiles = visibleCards.length ? '<div class="cb-card-grid">' + seriesCardTiles(visibleCards.slice(0,10),odds) +
      '</div>' : empty('Pool Unavailable', 'No Eligible Card Records Were Returned.', '', '', 'pack');
    const fullList = inStock.length > 10 ? link(path+'/pool','View All ' + number(inStock.length) + ' Printings','cb-secondary') : '';

    return '<div class="cb-wrap cb-page" data-fixture-odds>' + bread('packs', 'All Packs') + '<div class="cb-detail cb-detail-with-odds">' + portrait + intro +
      '</div><section class="cb-pool"><div class="cb-section-head"><div>' +
      '<h2>Inside This Edition</h2></div><span>' + plural(remaining, 'eligible copy') + '</span></div>' +
      poolNote + tiles + fullList + '</section>' + pages.detailsForPack(pack,pack,odds,path+'/pool') + '</div>';
  }
  function purchaseControl(action,id,price,available,label){
    if(!available && !readRequest(action,id))return '<button class="cb-primary" type="button" disabled>Sold Out</button>';
    return btn('review',(readRequest(action,id)?'Check Previous Request':label)+icon('arrow'),'cb-primary','data-action="'+action+'" data-id="'+esc(id)+'"');
  }
  let shopPosition=0, restoreShopOnLoad=true;
  const positionKey='cardbit:singles-position:v2';
  function saveShopPosition(){
    shopPosition=window.scrollY || 0;
    try{sessionStorage.setItem(positionKey,String(shopPosition));}catch{}
  }
  function restoreShopPosition(){
    requestAnimationFrame(()=>{if(readRoute()==='shop')window.scrollTo(0,shopPosition);});
  }
  function loadShopSearch(){
    try{
      const previous=JSON.parse(sessionStorage.getItem('cardbit:singles-search:v1')||'null');
      shopPosition=Math.max(0,Number(sessionStorage.getItem(positionKey) ?? previous?.shopPosition)||0);
    }catch{}
  }
  const catalog=window.CardbitCatalogFilters;
  const singlesFilters=catalog.create(context,'shop',()=> (state.singles||[]).map(card=>({
    key:card.id,name:cardName(card),variants:[catalog.listing(card,retailAmount(card),{
      availability:card.available>0?'In stock':'Sold out'
    })]
  })),({variants})=>shopTile(variants[0].card,pages.metadata(variants[0].card)));
  const option=(v,l,current)=>'<option value="'+esc(v)+'" '+(current===v?'selected':'')+'>'+esc(l)+'</option>';
  function shop(){return singlesFilters.page();}
  function single(c) {
    const zoom = btn('inspect-single',icon('expand',16)+'Inspect Card','cb-secondary','data-id="'+esc(c.id)+'"');
    const retail = retailAmount(c);
    const canBuy = retail != null && c.priceBits === retail;
    const price = retail == null ? 'Price Pending' : money(retail);
    const buy = canBuy ? purchaseControl('buy',c.id,retail,c.available>0,'Buy This Card') :
      '<button class="cb-primary" type="button" disabled>Price Unavailable</button>';
    return '<div class="cb-wrap cb-page">'+bread('shop','Shop Singles')+'<div class="cb-detail"><div class="cb-detail-stage cb-single-stage">'+
      cardViewer(c,zoom)+'</div><div class="cb-detail-copy"><h1>'+esc(cardName(c))+'</h1><p class="cb-edition-line">'+esc(cardSet(c))+'</p>'+
      '<h2 class="cb-price">'+price+'</h2>'+facts([['Printing',c.printing],['Language',pages.language(c.language)],['Condition',c.condition],['Card Number',c.number]])+
      buy+'</div></div>'+pages.variantList(c)+'</div>';
  }
  function facts(pairs){return '<dl class="cb-data">'+pairs.filter(([,v])=>v!=null&&v!=='').map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>';}
  function memberEntry(forWallet=false) {
    const signedIn = root.hasAttribute('data-member-signed-in');
    const destination = root.dataset.memberPath + (forWallet ? '#cbp-cardbits' : '');
    const target = new URL(signedIn ? destination : root.dataset.memberSignIn, location.href);
    if (!signedIn && forWallet) target.searchParams.set('return_to',destination);
    const label = signedIn ? (forWallet ? 'Open My Wallet' : 'Open My Packs') : 'Sign In to Cardbit';
    return '<a class="cb-primary" href="'+esc(target)+'">'+label+icon('arrow')+'</a>';
  }
  function loginForm(context='Your Collector Account', localProfiles=false){
    /* SITE */ if (site()) return '<div class="cb-login"><p class="cb-kicker">Collector Account</p><h2>'+esc(context)+'</h2><p>Sign In With Google or an Email Code to Open Packs, Hold Cards in Your Vault and Buy Cardbits.</p><a class="cb-primary" href="'+esc(window.CardbitSite.signInURL())+'">Sign In'+icon('arrow')+'</a></div>';
    if (root.dataset.memberPath && inBrowser() && !localProfiles) {
      return '<div class="cb-login"><h2>'+esc(context)+'</h2>'+memberEntry()+'</div>';
    }
    const demo=inBrowser();return '<div class="cb-login"><p class="cb-kicker">'+(demo?'On This Device':'Collector Account')+'</p><h2>'+esc(context)+'</h2><p>'+(demo?'Choose a Profile to Keep Your Collection on This Device.':'Sign In to View Your Packs and Vault.')+'</p><form data-cb-form="login">'+(demo?'<label>Collector Profile<select name="name"><option value="new-riley">Riley · Start with a Sealed Pack</option><option value="new-casey">Casey · Start with an Empty Vault</option><option value="resume-tour">Resume My Collection</option><option value="avery">Avery</option><option value="morgan">Morgan</option></select></label>':'<label>Username<input name="name" required autocomplete="username" autocapitalize="none" spellcheck="false"></label><label>Passphrase<input name="password" required type="password" autocomplete="current-password"></label>')+'<div data-dialog-error aria-live="polite"></div><button type="submit" class="cb-primary">'+(demo?'Continue as Collector':'Sign In')+icon('arrow')+'</button></form></div>';
  }
  function copyDetail(c){
    const held=isHeld(c);
    const market=isDemoShopper() ? window.CardbitVaultMarket?.label(c) : null;
    return '<div class="cb-wrap cb-page">'+bread('binder','My Vault')+'<div class="cb-detail"><div class="cb-detail-stage cb-single-stage">'+cardViewer(c)+'</div><div class="cb-detail-copy"><p class="cb-kicker">Vault Copy</p><h1>'+esc(cardName(c))+'</h1><p class="cb-edition-line">'+esc(cardSet(c))+'</p>'+vaultStatusIcon(c)+valueLine(c)+facts([...(isDemoShopper()?[['TCGplayer Market',market ? market.amount+' · '+market.date : 'No matched quote']]:[]),['Condition',c.condition],['Printing',c.printing],['Origin',c.openingId?'Pack Opening':'Cardbit Shop'],['Copy Reference',c.id]])+(held?'<p class="cb-detail-desc">This Copy Is Already in Your Vault. Keep It Here, Accept an Available Buyback Offer, or Request Shipping.</p><div class="cb-copy-actions">'+link('binder',icon('check',16)+'Keep in My Vault','cb-primary')+(Number.isFinite(c.buybackBits)&&c.buybackBits>0?btn('review','Sell Back · '+money(c.buybackBits),'cb-secondary','data-action="buyback" data-id="'+esc(c.id)+'"'):'')+link('ship-together/select/'+enc(c.id),icon('ship',16)+'Request Shipping','cb-secondary')+'</div>':'<p class="cb-detail-desc">'+(c.status==='shipping'?'Your Shipping Selection Is Saved. No Postage Has Been Purchased.':'This Copy Was Returned for Cardbits.')+'</p>')+(c.status==='shipping'?link('shipments/'+enc(c.shipRequestId||'copy-'+c.id),'View Shipment '+icon('arrow',15),'cb-textlink'):'')+(c.openingId?link('openings/'+enc(c.openingId),'View Original Opening '+icon('arrow',15),'cb-textlink'):'')+'</div></div></div>';
  }
  function topupControl(amount){
    const demo=isDemoShopper(),bonus=demo ? topupBonus(amount) : 0;
    const best=demo && amount===50000;
    const blocked=bonus && !state?.topupPromotions;
    const action=blocked ? '<button type="button" class="cb-secondary" disabled>Unavailable</button>' :
      btn('review',icon('plus',16)+'Add to Wallet',best?'cb-primary':'cb-secondary','data-action="topup" data-amount="'+amount+'"');
    return '<article class="cb-package'+(bonus?' cb-package-bonus':'')+(best?' cb-package-best':'')+'">'+(best?'<span class="cb-package-flag">Best Value</span>':'')+
      (window.cardbitValueIcon?'<img class="cb-package-coin" alt="" width="44" height="48" src="'+esc(window.cardbitValueIcon)+'">':'')+
      '<div class="cb-package-total"><strong class="cb-package-number">'+number(amount+bonus)+'</strong><span class="cb-package-unit">Cardbits</span></div>'+
      '<p class="cb-package-math">'+(bonus?number(amount)+' + '+number(bonus)+' Bonus':'No Bonus')+'</p>'+
      (bonus?'<span class="cb-package-chip">+'+Math.round(bonus*100/amount)+'% Bonus</span>':'')+
      (demo?'<p class="cb-package-price">$'+number(amount/100)+'</p>':'')+action+'</article>';
  }
  function bitsPage(){
    if(root.dataset.memberPath && !isDemoShopper() && root.hasAttribute('data-member-signed-in')){
      return '<div class="cb-wrap cb-page cb-wallet"><h1>My Cardbits</h1><section data-real-wallet><div data-wallet-body aria-live="polite">Loading Your Wallet…</div></section></div>';
    }
    if (root.dataset.memberPath && !isDemoShopper()) {
      return '<div class="cb-wrap cb-page cb-wallet"><h1>My Cardbits</h1><div data-wallet-catalog></div><p class="cb-sub">Sign In to View Your Balance and Purchase Options.</p>'+memberEntry(true)+'</div>';
    }
    if(!account())return '<div class="cb-wrap cb-page cb-narrow">'+loginForm('My Cardbits')+'</div>';
    const records=state.history||[];
    return '<div class="cb-wrap cb-page cb-wallet"><p class="cb-kicker">Collector Account</p><h1>My Cardbits.</h1><div class="cb-wallet-card"><span class="cb-bit-emblem">'+icon('bits',46)+'</span><div><small>Available Balance</small><h2>'+number(account().bits)+' <em>Cardbits</em></h2></div></div><section class="cb-topups cb-wallet-packages"><div class="cb-package-head"><h2>Add Cardbits</h2><p>'+(isDemoShopper()?'100 Cardbits = $1.00. Bigger Packages Include Bonus Cardbits.':'Choose an Amount to Add to This Collector Profile.')+'</p></div><div class="cb-package-grid">'+(isDemoShopper()?[1000,5000,10000,50000]:[100,500,1000]).map(topupControl).join('')+'</div></section><section>'+sectionHd('Balance History')+(records.length?'<div class="cb-history">'+records.slice().sort((a,b)=>new Date(b.at)-new Date(a.at)).map(t=>'<div class="cb-history-row"><div>'+icon(t.delta>0?'plus':'bits')+'<span><b>'+esc(String(t.label || '').replace(/^Starting test balance$/i,'Opening Balance').replace(/\b(?:test |demo )?(?:Cardbits|Bits?)\b/gi,'Cardbits').replace(/^Demo top-up$/i,'Cardbits Added'))+'</b><small>'+esc(describeDate(t.at))+'</small></span></div><strong class="'+(t.delta>0?'cb-credit':'')+'">'+(t.delta>0?'+':'')+number(t.delta)+' Cardbits</strong></div>').join('')+'</div>':'<p class="cb-sub">Your First Cardbits Transaction Will Appear Here.</p>')+'</section></div>';
  }
  function resultPage(o){
    const pack=known(state.packs,o.packId),label=pack?packTitle(pack):skin(o.packId).name;
    return '<div class="cb-wrap cb-page">'+bread('binder','My Vault')+'<div class="cb-section-head"><div><p class="cb-kicker">Saved Opening</p><h1>'+esc(label)+' Spread.</h1></div>'+btn('replay',icon('play',16)+'Replay Opening','cb-secondary','data-id="'+esc(o.id)+'"')+'</div><p class="cb-lead">'+plural(o.cards.length,'assigned card')+' · '+esc(describeDate(o.at))+'</p><div class="cb-card-grid cb-spread">'+o.cards.map((c,i)=>cardTile(c,'binder/'+enc(c.id),cardSet(c),'<span>Pull '+(i+1)+'</span>'+chip(copyStatus(c)))).join('')+'</div><div class="cb-actions">'+btn('share-saved','Share This Pull','cb-secondary','data-id="'+esc(o.id)+'"')+link('vault/opening/'+enc(o.id),'View These '+o.cards.length+' in My Vault'+icon('arrow'),'cb-primary')+link('packs','Browse Packs','cb-secondary')+'</div></div>';
  }
  function demoCards(pack){
    if(window.CardbitPackStage || isDemoShopper())return pickSeriesSample(pack.cards || [],pack.cardsPerPack);
    const reference=window.CardbitStock;
    const definition=known(reference?.packs,pack.id),rows=definition?.cardIds?.length?
      definition.cardIds.slice(0,5).map(id=>known(reference.cards,id)).filter(Boolean):[...(pack.cards||[])].sort((a,b)=>String(a.id).localeCompare(String(b.id))).slice(0,5);
    return rows.map((c,i)=>({...c,copyId:'sample-'+pack.id+'-'+(i+1),image:artURL(c)}));
  }
  function demoSpread(pack,cards){
    return '<div class="cb-wrap cb-page">'+bread('packs/'+enc(pack.id),packTitle(pack)+' pack')+'<p class="cb-kicker">'+'Demo — No Purchase'+'</p><h1>Your Pulls.</h1><p class="cb-lead">Replay to See the Same Cards. Demo Openings Stay Outside Your Vault.</p><div class="cb-card-grid">'+cards.map(c=>'<article class="cb-card-tile">'+art(c)+'<h3>'+esc(cardName(c))+'</h3>'+tierMarkup(c)+'<small>'+esc(cardSet(c))+'</small></article>').join('')+'</div>'+btn('share-sample','Share This Pull','cb-primary','data-id="'+esc(pack.id)+'"')+'</div>';
  }
  function sampleInspect(card){
    modal('<p class="cb-kicker">Card Details</p><h2>'+esc(cardName(card))+'</h2>'+tierMarkup(card)+'<p>'+esc(cardSet(card))+'</p><div class="cb-sample-image">'+cardViewer(card)+'</div>'+facts([['Card Number',card.number],['Printing',card.printing]])+'');
  }
  function helpPage(isPolicy=false){
    const portablePolicies=document.getElementById('cb-portable-policies');
    if (isPolicy && portablePolicies) return portablePolicies.innerHTML;
    const how = !isPolicy && document.getElementById('cb-portable-how');
    if (how) { window.cardbitHowContext = {packs: state?.packs || [], href, slug: p => skin(p.id).slug}; return how.innerHTML; }
    const faq = [
      ['How Do I Open a Pack?','Choose an Edition to See Its Cards, Pull Odds and Price in Cardbits. Open the Pack, Skip to the Results or Replay the Reveal from My Vault.'],
      ['Where Are My Cards?','My Vault Shows Your Individual Copies, Their Current Status, and the Openings They Came from. A Bought Single Goes Straight to Your Vault.'],
      ['Can I Sell Back a Single?', 'Yes. Shop Singles Charges Full Poke-Collect Retail. Open the Card in My Vault to See Its 80% Buyback Offer and Choose Sell Back.'],
      ['What Can I Do with a Pull?','Keep the Card in My Vault, Request Delivery or Accept an Available Buyback Offer in Cardbits.'],
      ['How Does Shipping Work?','In My Vault, Choose the Cards You Want Delivered Together. Review the Destination, Shipping Charge and Any Applicable Tax Before Confirming.'],
      ['What Happens If I Replay?','The Opening Displays Your Previously Assigned Copies in the Same Order. Replays Carry No Cardbits Charge.']
    ];
    if(root.dataset.question && root.dataset.answer)faq.push([displayTitle(root.dataset.question),displayTitle(root.dataset.answer)]);
    const policy=[
      ['Cardbits','Pack and single prices are shown in Cardbits. Review the price and your balance before confirming.'],
      ['Custody and Shipping','Revealed physical cards stay in My Vault until you request delivery or accept a buyback. Contact Support@cardbit.com for current storage terms.'],
      ['Sales, Cancellations and Refunds','Confirmed purchases are final for a change of mind. Orders cannot be cancelled for a change of mind or dissatisfaction with a pull. Missing inventory, an incorrect card, or damage on arrival may qualify for a refund or another remedy. Email Support@cardbit.com with your order reference and a description so Cardbit can review the issue. Applicable legal rights remain available.'],
      ['Buybacks','If a buyback is available, review the offered Cardbits before accepting. The copy is returned to Cardbit once accepted. Cardbits cannot be transferred between collectors or cashed out.'],
      ['Privacy',inBrowser()?'This browser stores your local collection and activity. Clearing site data removes those records.':'Your collector profile stores your balance, cards and account activity.'],
      ['Company and Support','Cardbit, LLC · Madison, Alabama. Contact Support@cardbit.com for help.']
    ];
    return '<div class="cb-wrap cb-page cb-read"><h1>'+(isPolicy?'Policies.':'How It Works')+'</h1><div class="cb-faq">'+(isPolicy?policy:faq).map(([q,a],i)=>'<details '+(i===0?'open':'')+'><summary>'+esc(q)+'</summary><p>'+esc(a)+'</p></details>').join('')+'</div><div class="cb-support"><div><h2>Need a Hand?</h2><p>For Help with a Pack, a Specific Copy, or Your Account.</p></div><a class="cb-secondary" href="mailto:Support@cardbit.com">Email Support '+icon('arrow')+'</a></div></div>';
  }
  function readRequest(action,id) {
    const key='cardbit:pending:v1:'+JSON.stringify([state?.mode,(isDemoShopper() || account()?.id?.match(/^(riley|casey)-/)) ? account()?.id : account()?.name,action,id||'']);
    try{return sessionStorage.getItem(key)||memoryRequests.get(key);}catch{return memoryRequests.get(key);}
  }
  function requestId(action,id,clear=false){
    const key='cardbit:pending:v1:'+JSON.stringify([state?.mode,(isDemoShopper() || account()?.id?.match(/^(riley|casey)-/)) ? account()?.id : account()?.name,action,id||'']);
    if(clear){memoryRequests.delete(key);try{sessionStorage.removeItem(key);}catch{} return;}
    const value=readRequest(action,id)||window.CardbitStore.requestKey();
    memoryRequests.set(key,value);try{sessionStorage.setItem(key,value);}catch{}return value;
  }
  function closeDialog(){
    if(!dialog)return;const old=dialog;dialog=null;if(old.open)old.close();old.remove();
    if(lastFocus?.isConnected) lastFocus.focus({preventScroll:true});
    lastFocus=null;
  }
  function modal(html){
    closeDialog();lastFocus=document.activeElement;dialog=document.createElement('dialog');dialog.className='cb-dialog';dialog.setAttribute('aria-label','Review Action');
    dialog.innerHTML='<div class="cb-dialog-bar">'+btn('close',icon('close',18),'cb-x','aria-label="Close Dialog"')+'</div>'+html;
    root.append(dialog);dialog.addEventListener('cancel',e=>{e.preventDefault();if(!working)closeDialog();});
    if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
    const first=dialog.querySelector('input:not([type=hidden]),select,[data-cb-do=confirm],button[type=submit]');if(first)first.focus({preventScroll:true});
  }
  function errorNote(err){
    const text=String(err?.message||'This Action Could Not Be Completed. Try Again.');
    const el=(dialog||root).querySelector('[data-dialog-error]')||(dialog||root).querySelector('[data-message]');
    if(el){el.textContent=text;el.classList.add('cb-error');}else{message=text;render();}
  }
  function itemFor(a,id){return a==='open'?known(state.packs,id):a==='buy'?known(state.singles,id):known(state.binder,id);}
  let afterLogin=null;
  function review(action,id,amount){
    if(!account()){afterLogin={action,id,amount};modal(loginForm('Sign In to Continue'));return;}
    /* SITE */ if (site() && action==='ship') { navigate('ship-together/select/'+enc(id)); return; }
    /* SITE */ if (site() && action==='topup') { location.assign(window.CardbitSite.topupURL(amount)); return; }
    const item=action==='topup'?null:itemFor(action,id);
    if(action!=='topup'&&!item){message='That Item Is Unavailable Now.';render();return;}
    const retry=!!readRequest(action,id||(action==='topup'?amount:''));
    if(!retry){
      if(action==='buy' && (retailAmount(item)==null || item.priceBits!==retailAmount(item))){
        message='Price Unavailable';render();return;
      }
      if(action==='open'&&!item.remaining||action==='buy'&&!item.available){message='That Item Has Sold Out.';render();return;}
      if((action==='ship'||action==='buyback')&&!isHeld(item)){message='The Status of This Copy Has Changed.';render();return;}
    }
    if(retry){
      pendingAction={action,id,amount};
      modal('<p class="cb-kicker">Previous Request</p><h2>Check the Result?</h2><p>Cardbit Will Look Up Your Earlier Request. If It Already Completed, You Will Receive the Saved Result. This Will Use the Same Request Reference.</p>'+confirmRow('Check Request'));
      return;
    }
    const balance=Number(account().bits);
    const price=(action==='open'||action==='buy')?Number(item.priceBits):0;
    if(price>balance&&!retry){
      if(isDemoShopper()){closeDialog();navigate('cardbits');return;}
      const short=price-balance;pendingAction={action:'topup',amount:short,returnTo:{action,id}};
      modal('<p class="cb-kicker">Cardbits Balance</p><h2>Add '+money(short)+'?</h2><p>This Selection Costs '+money(price)+'. Your balance is '+money(balance)+'. Add the difference and then confirm the purchase.</p>'+facts([['Add Cardbits','+'+money(short)],['Balance After',money(balance+short)]])+demoPayment(short)+confirmRow('Add Cardbits'));return;
    }
    const copyName=item?cardName(item):'';
    const text={
      open:['Open '+(item&&packTitle(item))+'?',plural(item?.cardsPerPack || 5,'card')+' Will Be Saved to Your Vault.','Confirm & Open'],
      buy:['Buy This Card?',copyName+' Will Go Straight to Your Vault.','Confirm Purchase'],
      buyback:['Sell Back to Cardbit?',copyName+' Will Return to Cardbit. The Cardbits Will Be Added to Your Balance.','Accept Buyback'],
      ship:['Request Shipping?',copyName+' Will Be Marked for Shipping and Will No Longer Be Available for Buyback. No Postage Is Purchased Here.','Confirm Request'],
      topup:['Add Cardbits?','This Credits Your Collector Profile. No Payment Is Taken.','Add '+money(amount)]
    }[action];
    if(!text)return;
    if (action==='buyback') {
      amount=cardBuyback(item).amount;
      if (amount===null) {message='No Current Cardbits Offer';render();return;}
    }
    let delta=action==='buyback'?amount:action==='topup'?Number(amount)+(isDemoShopper()?topupBonus(Number(amount)):0):-price;
    pendingAction={action,id,amount};
    modal('<h2>'+esc(text[0])+'</h2><p>'+esc(text[1])+'</p>'+facts(action==='ship'?[['Copy',item.id],['Current Status',copyStatus(item)]]:[['Current Balance',money(balance)],[delta>0?'Credit':'Price',money(Math.abs(delta))],['Balance After',money(balance+delta)]])+(action==='open' && (inBrowser() || isDemoShopper())?'<label class="cc-open-later"><input type="checkbox" data-open-later> Save Sealed Pack to My Account and Open Later</label>':'')+(action==='topup'?demoPayment(amount):'')+policyLink('Read the Policies',true)+confirmRow(text[2]));
  }
  function demoPayment(amount) {
    if (!isDemoShopper()) return '';
    return '<label class="cb-filter">Payment Method <select data-demo-payment><option value="demo-4242">Visa ending in 4242</option><option value="demo-0002">Visa ending in 0002</option></select></label><p class="cb-micro">Cardbits value $'+(Number(amount)/100).toFixed(2)+'. Amount charged today: $0.00.</p>';
  }
  function confirmRow(label){return '<div data-dialog-error role="status"></div><div class="cb-dialog-actions">'+btn('cancel','Cancel','cb-secondary')+btn('confirm',esc(label)+icon('arrow',16),'cb-primary')+'</div>';}
  async function submitAction(){
    if(working||!pendingAction)return;
    const a=pendingAction,id=a.id||(a.action==='topup'?a.amount:'');
    const req=requestId(a.action,id);working=true;
    const button=dialog?.querySelector('[data-cb-do=confirm]');if(button){button.disabled=true;button.textContent='Processing…';}
    try{
      const result=await window.CardbitStore.action({action:a.action,id:a.id,amount:a.amount,openLater:dialog?.querySelector('[data-open-later]')?.checked===true,payment:a.action==='topup' && isDemoShopper() ? (dialog?.querySelector('[data-demo-payment]')?.value || 'demo-4242') : undefined,requestId:req});
      if(!result?.state)throw Error('The Server Did Not Confirm This Action. Retry to Check the Same Request.');
      requestId(a.action,id,true);state=result.state;pendingAction=null;closeDialog();working=false;
      if(a.action==='open' && result.openingId){if(result.sealed){message='Your Sealed Pack Is Ready in My Account.';navigate('account');return;}navigate('openings/'+enc(result.openingId)+'/reveal');return;}
      if(a.action==='buy' && result.copyId){message='Your Card Was Added to the Vault.';navigate('binder/'+enc(result.copyId));return;}
      if(a.action==='topup' && result.approved===false){message='Card declined. Choose another payment method.';render();return;}
      if(a.action==='topup' && a.returnTo){render();review(a.returnTo.action,a.returnTo.id);return;}
      message={buyback:'Buyback Complete. Your Cardbits Have Been Credited.',ship:'Shipping Requested for This Copy.',topup:'Cardbits Added to Your Balance.'}[a.action]||'Saved.';
      if(a.action==='buyback')navigate('binder');else render();
    }catch(err){
      working=false;if(button){button.disabled=false;button.textContent='Retry Action';}
      // Keep the request ID after an uncertain response; the server can return its original result.
      const code=String(err?.code||'').toLowerCase();
      const denied=['insufficient_bits','sold_out','not_found','not_held','unauthorized','sign_in','forbidden','conflict','request_changed','invalid','limit'].includes(code);
      // The private API also uses unavailable for a transient server error.
      const copyUnavailable=code==='unavailable'&&/copy is|copy has/i.test(String(err.message));
      if(denied||copyUnavailable){
        requestId(a.action,id,true);
        try{state=await window.CardbitStore.state();}catch{}
        closeDialog();message=String(err.message||'Availability Changed. Please Review Again.');render();
      }else errorNote(err);
    }
  }
  let detachSeriesPool = () => {};
  let detachBrand=()=>{};
  function noteBar(){
    return '<div role="status" aria-live="polite" data-message class="'+(message?'cb-note':'')+'">'+esc(message)+'</div>';
  }
  function render(){
    if(!root||!root.isConnected)return;
    detachSeriesPool();
    detachSeriesPool = () => {};
    if(destroyOpening){destroyOpening();destroyOpening=null;}
    const path=readRoute(),parts=path.split('/').map(s=>{try{return decodeURIComponent(s);}catch{return '';}}),[base,id,sub]=parts;
    if (base === 'welcome' && window.CardbitWelcome && !window.CardbitWelcome.isSample) {
      location.replace(window.CardbitWelcome.entry);
      return;
    }
    if (root.hasAttribute('data-member-signed-in') && inBrowser() &&
        ['account','vault','shipments','openings','ship-together','collector-profiles'].includes(base)) {
      location.replace(root.dataset.memberPath + (base==='vault' ? '#cbp-owned' : ''));
      return;
    }
    if(base==='policies' && root.dataset.policyView){location.replace(root.dataset.policyView);return;}
    let body,title;
    const missing=()=>empty('Page Unavailable','This Link May Belong to a Different Collector, or the Item Is Unavailable.','Browse Packs','packs');
    try{
      if(base==='latch'&&window.CardbitLatchOpening&&Object.hasOwn(window.CardbitLatchEditions,id)){body='<div class="cb-wrap cb-page" data-latch-demo></div>';title=window.CardbitLatchEditions[id].name+' opening';}
      else if(base==='cardbits' && root.dataset.memberPath && !isDemoShopper()){body=bitsPage();title='My Cardbits';}
      else if(!state && !isMysteryRoute(path)){body='<div class="cb-wrap cb-page">'+(message?empty('Store Unavailable',message,'','','clock')+btn('retry','Try Again','cb-primary'):'<div class="cb-loading" role="status">'+icon('pack',30)+'Loading Packs…</div>')+'</div>';title='Cardbit';}
      else if(!base){body=home();title='Mystery Packs';}
      else if(base==='welcome' && window.CardbitWelcome?.isSample){body=window.CardbitWelcome.page(state);title='Welcome Rewards';}
      else if(base==='packs'&&!id){body=packsPage();title='Browse Packs';}
      else if(base==='packs'&&id==='compare'){body=pages.compare(sub,parts[3]);title='Compare Editions';}
      else if(base==='packs'&&sub==='pool'&&appSeriesEnabled({id})){body=seriesPoolPage(id,parts[3]);title=packTitle({id})+' Card Pool';}
      else if(base==='packs'&&id&&(sub==='pool' || (sub==='walkthrough' && parts[3]==='pool'))){
        const pack=known(state?.packs,id);
        body=pack?fixturePoolPage(pack,sub==='walkthrough',parts[sub==='walkthrough' ? 4 : 3]):missing();
        title=pack?packTitle(pack)+' Card Pool':'Unavailable Pool';
      }
      else if(base==='packs'&&id){const p=appSeriesEnabled({id})&&sub!=='walkthrough'?{id}:known(state?.packs,id);body=p?packDetail(p,sub==='walkthrough'):missing();title=p?packTitle(p)+' pack':'Unavailable Pack';}
      else if(base==='demo'&&appSeriesEnabled({id})){
        body='<section class="cb-wrap cb-page" data-series-pool>'+bread('packs/'+id,packTitle({id}))+'<h1>'+esc(packTitle({id}))+' Opening</h1><p class="cb-sub" data-series-source role="status">Loading This Product’s Card Pool…</p><div data-series-opening></div></section>';
        title='Open a '+packTitle({id})+' pack';
      }
      else if(base==='demo'&&id){const p=known(state.packs,id);body=p?.remaining>0?'<div data-theater="sample"></div>':empty('Opening Unavailable','This Edition Has Sold Out.','Browse Packs','packs');title=p?.remaining>0?packTitle(p)+' opening':'Opening Unavailable';}
      else if(base==='collector-profiles' && inBrowser() && !root.hasAttribute('data-member-signed-in')){
        body='<div class="cb-wrap cb-page cb-narrow">'+loginForm('Choose a Collector Profile',true)+'</div>';title='Collector Profiles';
      }
      else if(base==='chase'){body=collectors.chasePage(id);title='Chase';}
      else if(base==='ship-together'){body=collectors.shipPage(id,sub);title='Ship Together';}
      else if(base==='shop'&&!id){body=shop();title='Shop Singles';}
      else if(base==='shop'&&id){const c=known(state.singles,id);body=c?single(c):missing();title=c?cardName(c):'Unavailable Single';}
      else if(base==='account'&&(!id||id==='openings')){body=pages.dashboard(id);title=id?'My Packs':'My Account';}
      else if(base==='orders' && isDemoShopper()){body=pages.orders(id);title='My Orders';}
      else if(base==='shipments'){body=pages.shipments(id);title='Shipments';}
      else if(base==='vault'&&(!id||['all','held','shipping','opening'].includes(id))){body=pages.vault(id,sub);title='My Vault';}
      else if(base==='cardbits'){body=bitsPage();title='My Cardbits';}
      else if(base==='help'||base==='policies'){body=helpPage(base==='policies');title=base==='policies'?'Policies':'How It Works';}
      else if((base==='vault'||base==='openings')&&!account()){body='<div class="cb-wrap cb-page cb-narrow">'+loginForm()+'</div>';title='Sign In';}
      else if(base==='vault'&&id){const c=known(state.binder,id)||(state.openings||[]).flatMap(o=>o.cards).find(c=>String(c.id)===id);body=c?copyDetail(c):missing();title=c?cardName(c):'Unavailable Copy';}
      else if(base==='openings'&&id){const o=known(state.openings,id);body=o?(o.sealed?pages.sealedPage(o):sub==='reveal'&&window.CardbitOpening?'<div data-theater></div>':resultPage(o)):missing();title='Saved Pack Opening';}
      else {body=missing();title='Page Unavailable';}
    }catch(e){body='<div class="cb-wrap cb-page">'+empty('View Unavailable','Please Retry Loading the Storefront.','','','clock')+btn('retry','Reload','cb-secondary')+'</div>';title='Unavailable';console.warn('Cardbit Page Unavailable',e);}
    detachBrand();
    const oldFocus=root.contains(document.activeElement);
    root.innerHTML=header(path)+'<main class="cb-main" id="cb-stage" tabindex="-1">'+(state?noteBar():'')+body+'</main>'+footer();
    window.dispatchEvent(new Event('cardbit:storefront-rendered'));
    const walletPanel=root.querySelector('[data-real-wallet]');
    if(walletPanel && window.CardbitWallet)window.CardbitWallet.load(walletPanel,id && editionProducts[id]?'gid://shopify/Product/'+editionProducts[id]:null);
    const walletCatalog=root.querySelector('[data-wallet-catalog]');
    if(walletCatalog && window.CardbitWallet)walletCatalog.replaceChildren(window.CardbitWallet.catalog());
    const welcomePanel=root.querySelector('[data-cbw-panel]');
    if (welcomePanel) window.CardbitWelcome.bind(welcomePanel,context);
    document.title=title+' · cardbit';if(lastRoute!=null&&lastRoute!==path&&oldFocus)root.querySelector('main').focus({preventScroll:true});lastRoute=path;message='';
    detachBrand=window.CardbitBrand?.attach(root,asset,Boolean(state)) || (()=>{});
    const poolPanel = root.querySelector('[data-series-pool]');
    if (poolPanel) detachSeriesPool = mountSeriesPool(poolPanel);
    else {
      const fixture = root.querySelector('[data-fixture-odds], [data-compare-pools]');
      if (fixture) detachSeriesPool = mountFixtureOdds(fixture,id);
      else if (state && (!base || (base==='packs' && !id))) detachSeriesPool = mountShelf();
    }
    const latchHost=root.querySelector('[data-latch-demo]');
    if(latchHost){
      const player=window.CardbitLatchOpening.mount(latchHost,{edition:id,asset,demo:false,onShare:(cards,ed)=>collectors.share(ed.name,cards,asset(ed.file)),finishLabel:'Back to Packs',onFinish:()=>navigate('packs')});
      destroyOpening=()=>player.destroy();
    }
    const theater=root.querySelector('[data-theater]');
    if(theater){
      const sample=theater.dataset.theater==='sample';
      const o=sample?null:known(state.openings,id),p=known(state.packs,sample?id:o.packId)||{id:o.packId};
      const edition={...p,...skin(p.id),id:p.id,presentation:'storefront',image:wrapper(p),color:skin(p.id).hue};
      const cards=sample?demoCards(p):o.cards.map(c=>({...c,copyId:c.id,image:artURL(c)}));
      try{
        if(!window.CardbitOpening?.mount||!cards.length)throw Error('Opening Player Unavailable');
        const active=window.CardbitOpening.mount(theater,{edition,cards,demo:false,sample,asset,onShare:()=>collectors.share(edition.name,cards,edition.image),finishLabel:sample?'Back to Pack':'View These '+cards.length+' in My Vault',
          onFinish:()=>navigate(sample?'packs/'+enc(p.id):'vault/opening/'+enc(o.id)),onInspect:sample?sampleInspect:c=>navigate('binder/'+enc(c.copyId||c.id))});
        destroyOpening=()=>active?.destroy?.();
      }catch{theater.innerHTML=sample?demoSpread(p,cards):resultPage(o);}
    }
  }
  function navigate(route){
    const current=readRoute();
    const ownPage=root?.dataset.defaultRoute;
    if ((ownPage && route !== ownPage) || (!ownPage && route === 'help' && root?.dataset.howPage)) { location.assign(href(route)); return; }
    if (window.CardbitWelcome && ((route === 'welcome' && !window.CardbitWelcome.isSample) || (!route && window.CardbitWelcome.isSample))) {
      location.assign(href(route));
      return;
    }
    if(current==='shop') saveShopPosition();
    if(current.startsWith('vault') && current!==route) pages.clearSearch();
    closeDialog();pendingAction=null;afterLogin=null;
    const url=href(route);
    if (root?.dataset.productId && new URL(url).pathname !== location.pathname) { location.assign(url); return; }
    if(location.href!==url){try{history.pushState({},'',url);}catch{location.href=url;return;}}
    render();if(!state && !isMysteryRoute(readRoute()))refresh();
    root?.querySelector('#cb-stage')?.focus({preventScroll:true});
    if(readRoute()==='shop') restoreShopPosition(); else window.scrollTo(0,0);
    syncCollectorState(readRoute());
  }
  async function syncCollectorState(path) {
    if(!state || working || dialog || !/^(account|orders|cardbits|openings|chase|ship-together|shipments|vault|binder|welcome)(?:\/|$)/.test(path))return;
    const ticket=++version;
    try{
      const next=await window.CardbitStore.state();
      if(ticket!==version || readRoute()!==path || working || dialog || JSON.stringify(next)===JSON.stringify(state))return;
      const f=document.activeElement,editing=f?.matches('[data-cf-query]'),start=editing?f.selectionStart:null;
      state=next;render();
      if(editing){const input=root.querySelector('[data-cf-query]');input?.focus({preventScroll:true});input?.setSelectionRange(start,start);}
    }catch(e){
      if(ticket===version && readRoute()===path) {
        if(isDemoShopper() && ['sign_in','forbidden'].includes(e.code)){state=null;message=e.message;render();}
        else errorNote(e);
      }
    }
  }
  async function refresh(){
    const ticket=++version;
    try{if(!window.CardbitStore)throw Error('The Store Connection Could Not Be Loaded. Please Reload This Page.');const next=await window.CardbitStore.state();if(ticket!==version)return;state=next;message='';}
    catch(e){if(ticket!==version)return;state=null;message=e.message||'The Store Is Temporarily Unavailable.';}
    render();
    if(restoreShopOnLoad && state){restoreShopOnLoad=false;if(readRoute()==='shop')restoreShopPosition();}
  }
  function handleClick(e){
    if(!(e.target instanceof Element))return;
    const skip=e.target.closest('[data-cb-skip]');if(skip){e.preventDefault();root.querySelector('#cb-stage')?.focus();return;}
    const anchor=e.target.closest('[data-cb-route]');
    if(anchor&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.shiftKey&&e.button===0){e.preventDefault();if(working)return;navigate(anchor.dataset.cbRoute);return;}
    const jump = e.target.closest('a[href="#cb-pack-counter"]');
    if (jump && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();const section = root.querySelector('#cb-pack-counter');
      section?.focus({preventScroll:true});section?.scrollIntoView({block:'start'});return;
    }
    const el=e.target.closest('[data-cb-do]');if(!el||working)return;
    if(singlesFilters.click(el)||pages.click(el)||collectors.click(el))return;
    switch(el.dataset.cbDo){
      case 'share-saved':{const o=known(state.openings,el.dataset.id);if(o)collectors.share(packTitle({id:o.packId}),o.cards,wrapper({id:o.packId}));break;}
      case 'share-sample':{const p=known(state.packs,el.dataset.id);if(p)collectors.share(packTitle(p),demoCards(p),wrapper(p));break;}
      case 'flip-copy':flipCopy(el);break;
      case 'retry': refresh();break;
      case 'review':review(el.dataset.action,el.dataset.id,Number(el.dataset.amount)||undefined);break;
      case 'close':case 'cancel':closeDialog();pendingAction=null;afterLogin=null;break;
      case 'confirm':submitAction();break;
      case 'replay':navigate('openings/'+enc(el.dataset.id)+'/reveal');break;
      case 'logout':{working=true;el.disabled=true;window.CardbitStore.logout().then(r=>{state=r.state;working=false;message='Signed Out.';pages.clearSearch();navigate('account');}).catch(e=>{working=false;el.disabled=false;errorNote(e);});break;}
    }
  }
  function handleInput(e){
    if(singlesFilters.input(e.target)||pages.input(e.target))return;
    collectors.input(e.target);
  }
  async function handleSubmit(e){
    const form=e.target.closest('[data-cb-form="login"]');if(!form)return;e.preventDefault();
    if(working)return;working=true;const submit=form.querySelector('[type=submit]');submit.disabled=true;
    try{const values=new FormData(form);const next=await window.CardbitStore.login(String(values.get('name')||'').trim(),String(values.get('password')||''));
      state=next.state;const resume=afterLogin;afterLogin=null;closeDialog();render();working=false;
      if(resume)review(resume.action,resume.id,resume.amount);
      else if(readRoute()==='collector-profiles')navigate('account');
    }catch(err){working=false;submit.disabled=false;const line=form.querySelector('[data-dialog-error]');line.className='cb-error';line.textContent=err?.message||'Sign-In Failed. Check the Account Details.';}
  }
  function mount(){
    const fresh=document.querySelector('#cardbit-store');if(!fresh||fresh.hasAttribute('data-cb-member')||fresh===root&&fresh.childElementCount)return;
    activeMount?.abort();activeMount=new AbortController();const opts={signal:activeMount.signal};
    closeDialog();destroyOpening?.();destroyOpening=null;state=null;root=fresh;lastRoute=null;pendingAction=null;afterLogin=null;working=false;
    if (root.dataset.mode === 'demo') {
      const choice = new URL(location.href).searchParams.get('cb_font');
      if (['inter','nunito','atkinson'].includes(choice)) root.dataset.cbFont = choice;
    }
    if(/^#[a-f\d]{6}$/i.test(root.dataset.accent||'')){
      const rgb=root.dataset.accent.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
      const luminance=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
      root.style.setProperty('--cb-accent',root.dataset.accent);
      root.style.setProperty('--cb-on-accent',luminance>.179?'#080b11':'#fff');
    }
    window.addEventListener('cardbit-wallet-balance',e=>{if(Number.isSafeInteger(e.detail))walletBalanceLive=e.detail},opts);
    root.addEventListener('click',handleClick,opts);root.addEventListener('input',handleInput,opts);
    root.addEventListener('submit',handleSubmit,opts);
    root.addEventListener('error',scanError,{capture:true,...opts});
    window.CardbitMedia?.bindScans?.(root,activeMount.signal);
    window.addEventListener('popstate',()=>{closeDialog();pages.clearSearch();render();if(readRoute()==='shop')restoreShopPosition();syncCollectorState(readRoute());},opts);
    window.addEventListener('focus',()=>syncCollectorState(readRoute()),opts);
    root.addEventListener('click',e=>{if(e.target===dialog&&!working){const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)closeDialog();}},opts);
    loadShopSearch();render();if(!isMysteryRoute(readRoute()))refresh();
  }
  window.CardbitStorefront={mount, vaultHoldings(){
    return isDemoShopper() && state?.account ? {accountId:state.account.id,cards:state.binder || []} : null;
  }};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  document.addEventListener('shopify:section:load',mount);
})();
