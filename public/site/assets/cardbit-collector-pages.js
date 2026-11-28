/* Custom storefront account, vault, shipments and shopping views. */
(function (root) {
  'use strict';

  function create(ctx) {
    const {esc, enc, link, btn, art, icon, cardTile, cardViewer, bread, empty, sectionHd,
      skin, wrapper, packTitle, plural, date, facts, money, option, purchaseControl, loginForm} = ctx;
    const get = ctx.state;
    const norm = root.CardbitCollectorRules.normalize;
    const sameId = (a, b) => String(a) === String(b);
    const byId = (rows, id) => rows.find(row => sameId(row.id, id));
    const language = value => ({en:'English', ja:'Japanese', jp:'Japanese'})[value] || value || 'Unlisted';
    const metadata = c => [c.set, c.number, c.printing, language(c.language)].filter(Boolean).join(' · ');
    const inventory = () => get().binder || [];
    const openings = () => get().openings || [];
    const held = () => inventory().filter(c => c.status === 'held');
    const page = content => '<div class="cb-wrap cb-page cc-page">' + content + '</div>';
    const next = icon('arrow', 17);
    const start = (title, lead = '') => '<div class="cc-heading"><h1>' + esc(title) + '</h1>' +
      (lead ? '<p class="cb-lead">' + esc(lead) + '</p>' : '') + '</div>';
    const chip = (text, cls = '') => '<span class="cb-chip ' + cls + '">' + esc(text) + '</span>';
    const action = (route, text, style = 'cb-primary') => link(route, esc(text) + next, style);
    const countLabel = amount => amount === 1 ? 'card' : 'cards';
    const vaultLabel = c => ({held:'Held in Vault',shipping:'Shipping Requested',returned:'Sold Back',sold:'Sold Back'})[c.status] || c.status || 'Status Unavailable';
    const accordionLink = (route, title, sub, end = '') => link(route,
      '<span><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span><span>' + esc(end) + next + '</span>', 'cc-line');

    function nav(active) {
      return '<nav class="cc-tabs" aria-label="Collector Account">' +
        [['account','Overview','user'], ['vault','My Vault','binder'], ['account/openings','My Packs','pack'], ['shipments','Shipments','ship'],...(get()?.mode==='shopper-test'?[['orders','Orders','single'],['cardbits','My Cardbits','bits']]:[])].map(([to,label,glyph]) =>
          link(to, icon(glyph,17) + esc(label), 'cc-tab', active === to ? 'aria-current="page"' : '')
        ).join('') + '</nav>';
    }
    function orders(id) {
      const list = get().orders || [];
      const ref = o => 'Order ' + o.id.slice(0,8).toUpperCase();
      if (!id) return page(nav('orders') + start('My Orders') + (list.length ? '<div class="cc-ledger">' +
        list.map(o=>accordionLink('orders/'+enc(o.id),ref(o),o.label+' · '+date(o.at),o.amount.toLocaleString()+' Cardbits')).join('')+'</div>' :
        empty('No orders yet','Your pack and single purchases will appear here.','Browse Packs','packs')));
      const order=byId(list,id);
      if(!order) return page(nav('orders')+empty('Order unavailable','Choose an order from your history.','My Orders','orders'));
      const lines=order.lines.map(l=>{
        const path=l.openingId?'openings/'+enc(l.openingId):'vault/'+enc(l.copyId);
        if(l.kind==='single' && !inventory().some(c=>c.id===l.copyId)) return '<div class="cc-line"><span><b>'+esc(l.title || 'Card')+'</b><small>Sold Back</small></span><span>'+esc(l.price.toLocaleString())+' Cardbits</span></div>';
        return accordionLink(path,l.title || 'Card',l.kind==='pack'?'Pack':'Single',l.price.toLocaleString()+' Cardbits');
      }).join('');
      return page(nav('orders')+bread('orders','My Orders')+start(ref(order),date(order.at))+
        facts([['Payment',order.status],['Order Total',order.amount.toLocaleString()+' Cardbits']])+'<div class="cc-ledger">'+lines+'</div>');
    }
    function parcelRecords() {
      const rows = get().shipments || [];
      const included = new Set(rows.flatMap(row => row.copyIds || []));
      const earlier = inventory().filter(c => c.status === 'shipping' && !included.has(c.id));
      return rows.concat(earlier.map(c => ({id:'copy-' + c.id, copyIds:[c.id], status:'requested', at:null, earlier:true})));
    }
    function parcelName(p) {
      return 'Parcel · ' + String(p.id).replace(/[^a-z0-9]/gi,'').slice(-6).toUpperCase();
    }
    const parcelState = p => ({preparing:'Preparing',in_transit:'In Transit',requested:'Awaiting Tracking', pending:'Awaiting Tracking', shipped:'Shipped', delivered:'Delivered'})[String(p.status).toLowerCase()] || 'Shipment Requested';
    function cover(p, css = '') {
      return '<div class="cc-pack-art ' + css + '" style="--cc-foil:' + skin(p.id).hue + '"><img src="' + esc(wrapper(p)) +
        '" width="842" height="1520" alt="' + esc(packTitle(p)) + ' wrapper"></div>';
    }
    function fan(cards) {
      return '<div class="cc-fan" aria-hidden="true">' + cards.slice(0,3).map(c => art(c,true)).join('') + '</div>';
    }
    function feature(kicker, title, text, control, media) {
      return '<section class="cc-feature"><div class="cc-feature-copy"><p class="cb-kicker">' + esc(kicker) +
        '</p><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p><div class="cb-actions">' +
        control + '</div></div>' + media + '</section>';
    }
    function signedOut() {
      const pilot = {id:'cobalt'};
      return page(start('My Account') + '<div class="cc-entry"><div>' + loginForm('Your Packs and Cards') +
        '</div>' + cover(pilot) + '</div>' + (ctx.welcomeAccount?.() || ''));
    }
    function openButton(o) {
      return btn('reveal-held','Open My Pack' + next,'cb-primary','data-id="' + esc(o.id) + '"');
    }
    function packHistory() {
      if (!openings().length) return empty('No Packs Yet','Your Saved Packs and Openings Will Appear Here.','Explore Packs','packs','pack');
      return '<div class="cc-ledger">' + openings().map(o => {
        const title = packTitle({id:o.packId});
        const sub = (o.reversed ? 'Reversed · Cardbits Returned' : plural(o.cardCount || o.cards.length,'card')) + ' · ' + date(o.at);
        return '<div class="cc-pack-row"><img src="' + esc(wrapper({id:o.packId})) + '" alt="" width="36" height="64">' +
          '<span><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span>' +
          (o.reversed ? chip('Reversed') : o.sealed ? openButton(o) : action('openings/' + enc(o.id),'View Result','cb-secondary')) + '</div>';
      }).join('') + '</div>';
    }
    function dashboard(tab) {
      if (!get().account) return signedOut();
      if (tab === 'openings') return page(nav('account/openings') + start('My Packs') + packHistory());
      const sealed = openings().find(o => o.sealed);
      const parcels = parcelRecords();
      const recent = openings().find(o => !o.sealed && !o.reversed);
      let hero;
      if (sealed) {
        const pack = {id:sealed.packId};
        hero = feature('Ready to Open',packTitle(pack),plural(sealed.cardCount,'card') + (sealed.cardCount===1 ? ' Is' : ' Are') + ' Sealed in This Pack.',openButton(sealed),cover(pack));
      } else if (parcels.length) {
        const p = parcels[0];
        hero = feature('Latest Shipment',parcelName(p),plural(p.copyIds.length,'card') + ' · ' + parcelState(p),
          action('shipments/' + enc(p.id),'View Shipment'),fan(inventory().filter(c => p.copyIds.includes(c.id))));
      } else if (recent || held().length) {
        const cards = recent ? recent.cards : held();
        hero = feature('Latest Additions',recent ? packTitle({id:recent.packId}) : 'Your Latest Cards',
          recent ? plural(cards.length,'card') + ' in This Opening.' : plural(cards.length,'held card') + ' in Your Collection.',
          action(recent ? 'vault/opening/' + enc(recent.id) : 'vault','View in My Vault'),fan(cards));
      } else {
        hero = feature('Your First Pack','Find Your First Edition','Browse the Wrappers, Compare Their Pools, and Try an Opening.',
          action('packs','Explore Packs'),cover({id:'cobalt'}));
      }
      const stats = [['account/openings',openings().filter(o => o.sealed).length,'Unopened Packs'],['vault/held',held().length,'Held Cards'],['shipments',parcels.length,'Shipments']];
      return page(nav('account') + '<div class="cc-intro"><div>' + start('My Account',get().account.name === 'Collector' ? 'Welcome Back.' : 'Welcome, ' + get().account.name + '.') +
        '</div>' + btn('logout','Sign Out','cb-ghost') + '</div>' + hero +
        '<div class="cc-stats">' + stats.map(([route,n,label]) => link(route,'<strong>' + n + '</strong><span>' + label + next + '</span>','cc-stat')).join('') + '</div>' +
        (ctx.welcomeAccount?.() || '') +
        (recent ? '<section class="cb-separated">' + sectionHd('Recently Opened','account/openings','All Packs') +
          accordionLink('openings/' + enc(recent.id),packTitle({id:recent.packId}),date(recent.at),'View Result') + '</section>' : ''));
    }
    function reversedPage(o) {
      return page(nav('account/openings') + start(packTitle({id:o.packId}),date(o.at)) +
        empty('This Pack Was Reversed','Cardbit Support Returned Your Cardbits, and These Cards Went Back Into Stock.','View My Vault','vault','pack'));
    }
    function sealedPage(o) {
      return page(nav('account/openings') + start('Unopened Pack') +
        feature('Ready to Open',packTitle({id:o.packId}),plural(o.cardCount,'card') + ' Assigned to This Pack.',openButton(o),cover({id:o.packId})));
    }
    function tiles(cards) {
      return '<div class="cb-card-grid cc-vault-grid">' + cards.map(c => {
        const quote = get().mode==='shopper-test' && (root.CardbitStore?.site ? root.CardbitSite?.marketLabel?.(c) : root.CardbitVaultMarket?.label(c));
        const market = quote ? '<small class="cb-vault-market" title="'+esc(quote.date)+'">TCGplayer Market '+esc(quote.amount)+'</small>' : '';
        return cardTile(c,'vault/'+enc(c.id),metadata(c),market+ctx.vaultStatusIcon(c));
      }).join('') + '</div>';
    }
    let vaultSearch = '';
    function visibleCards(scope, openingId) {
      if (scope === 'opening') return byId(openings(),openingId)?.cards || [];
      if (scope === 'held' || scope === 'shipping') return inventory().filter(c => c.status === scope);
      return inventory();
    }
    function vaultCards(scope, openingId) {
      const terms = norm(vaultSearch).split(/\s+/).filter(Boolean);
      const matches = visibleCards(scope,openingId).filter(c => terms.every(s => norm(c.name + ' ' + metadata(c)).includes(s)));
      if (matches.length) return '<p class="ct-count" role="status">' + plural(matches.length,'copy') + '</p>' + tiles(matches);
      if (terms.length) return empty('No Matching Cards','Try a Different Card Name, Set or Number.') + btn('clear-vault','Clear Search','cb-secondary');
      return empty(scope === 'shipping' ? 'No Cards in a Shipment Yet' : 'No Cards Here Yet',
        scope === 'shipping' ? 'Choose Held Cards When You Are Ready to Ship.' : 'Your Opened Cards and Purchased Singles Appear Here.',
        scope === 'shipping' ? 'See Held Cards' : 'Explore Packs',scope === 'shipping' ? 'vault/held' : 'packs');
    }
    function vault(scope = '', openingId = '') {
      if (!get().account) return signedOut();
      const opening = scope === 'opening' && byId(openings(),openingId);
      if (scope === 'opening' && !opening) return page(nav('vault') + empty('Opening Unavailable','Choose an Opening from Your Account.','My Packs','account/openings'));
      if (opening?.sealed) return sealedPage(opening);
      if (opening?.reversed) return reversedPage(opening);
      const detail = opening ? packTitle({id:opening.packId}) + ' · ' + date(opening.at) : 'Your Individual Cards and Their Current Status.';
      const demo = get().mode==='shopper-test';
      if(demo && !scope) scope='held';
      const tabs = demo ? [['held','Held'],['shipping','In Shipments'],['all','All Cards']] :
        [['','All Cards'],['held','Held'],['shipping','Shipping Requested']];
      return page(nav('vault') + '<div class="cc-intro"><div>' + start('My Vault',detail) + '</div>' +
        (held().length ? action('ship-together','Select Cards to Ship','cb-secondary') : '') + '</div>' +
        (demo && !opening && scope!=='shipping' ? '<cardbit-vault-portfolio data-source="'+(root.CardbitStore?.site ? 'wallet' : 'shopper')+'"></cardbit-vault-portfolio>' : '') +
        (opening ? '<div class="cc-filter-note">' + esc(plural(opening.cards.length,'card')) + ' from This Opening ' +
          link('vault','View All Cards','cb-textlink') + '</div>' : '<nav class="cc-filters" aria-label="Vault Status">' +
          tabs.map(([key,label]) => link('vault' + (key ? '/' + key : ''),esc(label),'cc-filter',key === scope ? 'aria-current="page"' : '')).join('') + '</nav>') +
        '<label class="cc-search">' + icon('search') + '<input type="search" data-vault-search aria-label="Search My Vault" placeholder="Search Your Cards" value="' +
        esc(vaultSearch) + '"></label><div data-vault-results data-scope="' + esc(scope) + '" data-opening="' + esc(openingId) + '">' +
        vaultCards(scope,openingId) + '</div>');
    }
    /* SITE */ root.CardbitSiteRefreshVault = () => updateVault();
    function updateVault() {
      const box = ctx.root().querySelector('[data-vault-results]');
      if (box) box.innerHTML = vaultCards(box.dataset.scope,box.dataset.opening);
    }
    function shipments(id) {
      if (!get().account) return signedOut();
      const parcels = parcelRecords();
      if (id) {
        const p = byId(parcels,id);
        if (!p) return page(nav('shipments') + empty('Shipment Unavailable','Choose a Parcel from Your Shipments.','My Shipments','shipments'));
        const cards = p.copyIds.map(k => byId(inventory(),k)).filter(Boolean);
        const dest = root.CardbitCollectorRules.destinations[p.destination];
        return page(nav('shipments') + bread('shipments','All Shipments') + start(parcelName(p)) +
          '<div class="cc-status">' + icon('ship',26) + '<div><b>' + esc(parcelState(p)) + '</b><p>' +
          (p.tracking?.number ? esc([p.tracking.company || p.tracking.carrier,'Tracking Number '+p.tracking.number].filter(Boolean).join(' · ')) : 'Tracking Will Appear Here When a Carrier Number Is Available.') + '</p>' +
          (trackURL(p) ? '<a class="cb-primary cc-track" target="_blank" rel="noopener noreferrer" href="' + esc(trackURL(p)) + '">Track Package</a>' : '') + '</div></div>' +
          facts([['Requested',p.at ? date(p.at) : 'Date Unavailable'],['Selected Cards',p.copyIds.length],['Destination',dest?.label || (typeof p.destination==='string' ? p.destination : null)],
            /* SITE */ ['Shipping',root.CardbitStore?.site ? (p.feeBits ? Number(p.feeBits).toLocaleString('en-US')+' Cardbits' : 'Free') : 'Calculated at Shipping Checkout'],['Parcel Reference',p.earlier ? null : p.id]]) +
          '<div class="cb-actions">' + contact('Cardbit Package ' + (p.tracking?.number || p.id)) + '</div>' +
          '<section class="cb-separated">' + sectionHd('Cards in This Shipment') + tiles(cards) + '</section>');
      }
      return page(nav('shipments') + '<div class="cc-intro">' + start('Shipments') +
        (held().length ? action('ship-together','Select Cards to Ship') : '') + '</div>' +
        (parcels.length ? '<div class="cc-ledger">' + parcels.map(p => accordionLink('shipments/' + enc(p.id),parcelName(p),
          [plural(p.copyIds.length,'card'),p.at && date(p.at)].filter(Boolean).join(' · '),parcelState(p))).join('') + '</div>'
        : empty('No Shipments Yet','When You Request Shipping, the Parcel and Its Exact Cards Will Appear Here.','View My Vault','vault','ship')) +
        '<div class="cb-actions cc-support-row">' + contact('Cardbit Shipping Question') + '</div>');
    }
    function trackURL(p) {
      try { const u = new URL(p.tracking?.url || ''); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
    }
    function contact(subject) {
      return '<a class="cb-secondary cc-contact" href="mailto:Support@cardbit.com?subject=' + enc(subject) + '">Contact Customer Service</a>';
    }
    function compareLink(pack) {
      const other = pack.id === 'gold' ? 'mystery' : 'gold';
      return link('packs/compare/' + skin(pack.id).slug + '/' + other,'Compare Editions' + next,'cb-textlink');
    }
    const format = n => n.toLocaleString('en-US',{maximumFractionDigits:1});
    const printingCount = cards => new Set(cards.map(card =>
      card.variantId || (card.tcgplayerId || card.catalogId || card.set || card.number
        ? root.CardbitCollectorRules.printingKey(card) : card.title || card.name || card.id))).size;

    function valueRange(cards) {
      if (!cards.length) return '—';
      let min = Infinity, max = -Infinity;
      for (const card of cards) {
        const {amount} = ctx.cardBuyback(card);
        if (amount === null) return 'Unavailable';
        min = Math.min(min,amount);
        max = Math.max(max,amount);
      }
      return min === max ? format(min) : format(min)+'–'+format(max);
    }

    function typicalValue(cards, pool) {
      if (!cards.length) return '—';
      // Different-cards packs: each copy's exact chance is its weight (totals the cards per pack, not 1).
      const distinct = pool.drawModel === 'distinct-printings';
      const uniform = distinct || pool.drawModel === 'uniform-without-replacement' || (!pool.drawModel && pool.preview === true) ||
        (pool.completePacks > 0 && pool.completePacks === pool.packsRemaining && !pool.drawModel);
      const weights = new Map();
      let total = 0;
      for (const card of cards) {
        const {amount} = ctx.cardBuyback(card);
        // At-least-one odds in a multi-card pack are not per-card draw probabilities.
        const weight = distinct ? card.chanceInPack : uniform ? card.remaining : card.drawProbability ?? (pool.cardsPerPack === 1 ? card.chanceInPack : undefined);
        if (amount === null || !Number.isFinite(weight) || weight < 0) return 'Unavailable';
        if (!weight) continue;
        weights.set(amount,(weights.get(amount) || 0)+weight);
        total += weight;
      }
      if (!total || (!uniform && Math.abs(total-1) > 1e-8)) return 'Unavailable';
      const values = [...weights.keys()].sort((a,b) => a-b);
      let cumulative = 0;
      for (const [index,value] of values.entries()) {
        cumulative += weights.get(value);
        if (Math.abs(cumulative-total/2) <= total*1e-12 && index+1 < values.length) return format((value+values[index+1])/2);
        if (cumulative > total/2) return format(value);
      }
      return 'Unavailable';
    }

    function editionStats(pool) {
      const stock = pool.packsRemaining ?? pool.remaining;
      const sold = stock === 0 || pool.status === 'CLOSED';
      const rows = (pool.cards || []).filter(c => c.remaining > 0);
      const languages = [...new Set(rows.map(c => c.language).filter(Boolean).map(language))].sort().join(' / ');
      const valid = Number.isSafeInteger(stock) && stock >= 0 && pool.cardsPerPack > 0 &&
        Array.isArray(pool.cards) && pool.cards.every(c => Number.isSafeInteger(c.remaining) && c.remaining >= 0) &&
        (pool.drawModel === 'distinct-printings' ? stock <= Math.floor(rows.reduce((n,c) => n+c.remaining,0)/pool.cardsPerPack) :
        Math.floor(rows.reduce((n,c) => n+c.remaining,0)/pool.cardsPerPack) === stock);
      const available = valid && !sold ? rows : [];
      const range = valid || sold ? valueRange(available) : 'Unavailable';
      const typical = valid || sold ? typicalValue(available,pool) : 'Unavailable';
      const top = range !== 'Unavailable' ? available.reduce((best,c) =>
        !best || c.buybackBits > best.buybackBits ? c : best,null) : null;
      return {stock,sold,valid,available,range,typical,top,languages,count:printingCount(available)};
    }

    function guideBody(p,pool,model,path) {
      if (!pool) return '<p class="cg-note">Current pool details are unavailable.</p>'+compareLink(p);
      const d = editionStats(pool);
      const basics = [Number.isInteger(pool.cardsPerPack) ? plural(pool.cardsPerPack,'card')+' per pack' : ''].filter(Boolean);
      if (d.languages && !d.languages.split(' / ').every(lang => basics.join(' ').includes(lang))) basics.push(d.languages);
      const info = '<p class="cg-basics">'+basics.map(esc).join('<span aria-hidden="true"> · </span>')+'</p>';
      if (d.sold || !d.valid) return info+'<p class="cg-note">'+(d.sold ? 'Sold out' : 'Current pool details are unavailable.')+'</p>'+compareLink(p);
      const stats = '<dl class="cg-metrics">'+[
        /* SITE */ ['Cardbits per card',d.range],['Packs remaining',format(d.stock)],['Distinct printings',format(d.count)]
      ].map(([label,value]) => '<div><dt>'+label+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl>';
      const odds = new Map((model?.tiers || []).map(t => [t.name,t.odds]));
      const names = [...new Set([...odds.keys(),...d.available.map(c => ctx.tierName(c) || 'Unassigned')])].sort(ctx.compareTiers);
      const header = '<div class="cg-tier-head" aria-hidden="true"><span>Tier</span><span>Pull odds</span><span>Cardbits</span><span>Printings</span></div>';
      const rows = names.map(name => {
        const cards = d.available.filter(c => (ctx.tierName(c) || 'Unassigned') === name);
        const chance = odds.get(name) ?? '—', range = valueRange(cards), count = printingCount(cards);
        return link(path+'/'+enc(name),'<span class="cg-tier-name">'+ctx.tierSymbol(name)+esc(name)+'</span><span>'+esc(chance)+'</span><span>'+esc(range)+'</span><span>'+count+icon('angle',12)+'</span>',
          'cg-tier-row','aria-label="'+esc(name+', pull odds '+chance+', Cardbit range '+range+', '+plural(count,'printing'))+'"');
      }).join('');
      return info+stats+header+rows+'<p class="cg-note">Odds are the chance of pulling at least one card from a tier. Cardbit values show the current sell-back offer per card.</p>'+compareLink(p);
    }

    function detailsForPack(p,pool=p,model,path='packs/'+enc(p.id)+'/pool') {
      return '<details class="cb-edition-guide cg-guide"><summary>Edition Guide'+icon('chevron',18)+'</summary><div data-guide-body>'+
        guideBody(p,pool,model,path)+'</div></details>';
    }

    function compare(first,second) {
      const packs = ctx.shelf();
      if (packs.length < 2) return page(bread('packs','Packs') + empty('Comparison Unavailable','Two Editions Are Needed for a Comparison.'));
      const left = packs.find(p => skin(p.id).slug === first) || packs[0];
      const right = packs.find(p => skin(p.id).slug === second && p !== left) || packs.find(p => p.id === 'gold' && p !== left) || packs.find(p => p !== left);
      function column(pack,i) {
        const d = editionStats(pack);
        const slug = skin(pack.id).slug;
        const metrics = [
          ['Pack price',Number.isSafeInteger(pack.priceBits) ? money(pack.priceBits) : 'Unavailable'],
          ['Cards per pack',pack.cardsPerPack ?? 'Unavailable'],
          ['Language',d.languages || ({cobalt:'English',prism:'English',ember:'Japanese',gold:'English / Japanese',amethyst:'English / Japanese'})[pack.id] || 'Unlisted'],
          /* SITE */ ['Cardbits per card',d.range],
          ['Packs remaining',d.sold ? 'Sold out' : d.valid ? format(d.stock) : 'Unavailable']
        ];
        const chase = d.top;
        const src = chase && ctx.artURL(chase);
        return '<section class="cg-column" style="--edition:'+skin(pack.id).hue+'"><div class="cg-compare-top"><label>'+
          '<span class="cb-odds-sr">'+(i===0?'First':'Second')+' edition</span><select data-compare="'+i+'" data-previous="'+esc(slug)+'">'+
          packs.map(p => option(skin(p.id).slug,packTitle(p),slug)).join('')+'</select></label>'+cover(pack)+'</div>'+
          metrics.map(([label,value]) => '<div class="cg-spec"><span>'+label+'</span><strong>'+esc(value)+'</strong></div>').join('')+
          '<div class="cg-chase"><span>Top chase</span>'+(chase ? (src ? '<img loading="lazy" src="'+esc(src)+'" alt="">' : '')+
          '<strong>'+esc(chase.name || chase.title)+'</strong>'+ctx.tierMarkup(chase)+'<small>'+esc(money(chase.buybackBits))+'</small>' :
          '<strong>'+ (d.sold ? 'Sold out' : 'Unavailable')+'</strong>')+'</div>'+
          action('packs/'+slug,'View Pack','cb-secondary')+'</section>';
      }
      return page(bread('packs','Packs')+start('Compare Editions')+'<div class="cg-compare" data-compare-pools>'+
        [left,right].map(column).join('')+'</div><p class="cg-note">Cardbit values are current sell-back offers per card.</p>');
    }
    function variantList(c) {
      const others = (get().singles || []).filter(x => x.name === c.name && !sameId(x.id,c.id));
      if (!others.length) return '';
      return '<section class="cb-separated">' + sectionHd('Other Printings of ' + c.name) + '<div class="cc-ledger">' +
        others.map(x => accordionLink('shop/' + enc(x.id),x.printing || 'Printing Unlisted',[x.set,x.number,language(x.language)].filter(Boolean).join(' · '),x.available ? (root.CardbitRetail?.amount(x) != null ? money(root.CardbitRetail.amount(x)) : 'Retail Price Pending') : 'Sold Out')).join('') + '</div></section>';
    }
    async function reveal(el) {
      if (ctx.busy()) return;
      const id = el.dataset.id;
      el.disabled = true; ctx.setBusy(true);
      try {
        const result = await root.CardbitStore.action({action:'reveal',id,requestId:ctx.requestId('reveal',id)});
        ctx.setState(result.state); ctx.requestId('reveal',id,true);
        ctx.go('openings/' + enc(id) + '/reveal');
      } catch (e) {ctx.error(e); el.disabled = false;}
      finally {ctx.setBusy(false);}
    }
    function click(el) {
      if (el.dataset.cbDo === 'reveal-held') {reveal(el); return true;}
      if (el.dataset.cbDo === 'clear-vault') {vaultSearch = ''; const input = ctx.root().querySelector('[data-vault-search]'); input.value=''; input.focus(); updateVault(); return true;}
      if (el.dataset.cbDo === 'inspect-single') {
        const c = byId(get().singles || [],el.dataset.id);
        if (c) {
          ctx.modal('<h2>' + esc(c.name) + '</h2><p>' + esc(metadata(c)) + '</p><div class="cc-zoom">' + cardViewer(c) + '</div>');
          ctx.dialog().setAttribute('aria-label', 'Inspect ' + c.name);
        }
        return true;
      }
      return false;
    }
    function input(el) {
      if (el.hasAttribute('data-vault-search')) {vaultSearch = el.value; updateVault(); return true;}
      if (el.hasAttribute('data-compare')) {
        const controls = [...ctx.root().querySelectorAll('[data-compare]')];
        const idx = Number(el.dataset.compare);
        const slugs = controls.map(control => control.value);
        if (slugs[0] === slugs[1]) slugs[1-idx] = el.dataset.previous || [...el.options].find(o => o.value !== el.value).value;
        ctx.go('packs/compare/' + slugs.map(enc).join('/'));
        ctx.root().querySelector('[data-compare="' + idx + '"]')?.focus({preventScroll:true});
        return true;
      }
      return false;
    }
    return {dashboard, sealedPage, reversedPage, vault, shipments, parcelState, orders, compare, compareLink, detailsForPack, guideBody, metadata, language,
      variantList, click, input, clearSearch:() => {vaultSearch = '';}, vaultLabel};
  }
  root.CardbitCollectorPages = Object.freeze({create});
})(window);


