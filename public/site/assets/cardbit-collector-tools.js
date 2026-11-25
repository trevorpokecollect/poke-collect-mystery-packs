/* Shared filters for the singles catalog and Chase printing index. */
(function(root) {
  'use strict';
  const normalize = root.CardbitCollectorRules.normalize;
  const fields = {availability:'Availability', edition:'Pack edition', tier:'Pool tier', set:'Set',
    rarity:'Printed rarity', language:'Language', finish:'Finish', condition:'Condition', kind:'Format'};
  const languages = {en:'English',ja:'Japanese',jp:'Japanese'};
  const tierOrder = ['Legendary','Epic','Rare','Uncommon','Common'];
  const bands = [['Under 500','','499'],['500–2,499','500','2499'],['2,500–9,999','2500','9999'],['10,000+','10000','']];
  const isBound = n => /^\d+$/.test(n) && Number.isSafeInteger(Number(n));
  const defaults = () => ({q:'',min:'',max:'',selected:{},sort:'featured',page:1,wanted:false});

  function listing(card,price,extra={}) {
    const values = {set:card.set || card.setName, rarity:card.rarity, language:languages[card.language] || card.language,
      finish:card.printing, condition:card.condition, kind:card.kind==='slab'?'Graded slabs':'Singles', ...extra};
    return {card,price:Number.isSafeInteger(price) && price>=0 ? price : null,values,
      text:normalize([card.name,card.title,card.number,card.language,...Object.values(values)].filter(Boolean).join(' '))};
  }

  function search(rows,state,keys) {
    const terms=normalize(state.q).replace(/#(?=\d)/g,'').split(/\s+/).filter(Boolean);
    const selections=Object.entries(state.selected).filter(([k,v])=>keys.includes(k) && v.length);
    const options=Object.fromEntries(keys.map(key=>[key,new Map()]));
    const invalid=(state.min!==''&&!isBound(state.min)) || (state.max!==''&&!isBound(state.max)) ||
      (state.min!=='' && state.max!=='' && Number(state.min)>Number(state.max));
    const hits=[];
    for(const row of rows) {
      const variants=[];
      for(const item of row.variants) {
        for(const key of keys) {
          const value=item.values[key];
          if(value && !options[key].has(value)) options[key].set(value,new Set());
        }
        if(invalid || (state.wanted&&!row.wanted) || !terms.every(term=>item.text.includes(term)))continue;
        if((state.min!=='' || state.max!=='') && (item.price==null ||
          (state.min!=='' && item.price<Number(state.min)) || (state.max!=='' && item.price>Number(state.max))))continue;
        const misses=selections.filter(([key,values])=>!values.includes(item.values[key]));
        if(!misses.length)variants.push(item);
        // An option count includes all other selected groups and counts a printing once.
        if(misses.length<=1) for(const key of misses.length ? [misses[0][0]] : keys) {
          options[key].get(item.values[key])?.add(row.key);
        }
      }
      if(variants.length) {
        const amounts=variants.map(v=>v.price).filter(v=>v!=null);
        hits.push({row,variants,price:amounts.length ? Math.min(...amounts) : null});
      }
    }
    if(state.sort==='az')hits.sort((a,b)=>a.row.name.localeCompare(b.row.name));
    if(state.sort==='low'||state.sort==='high') hits.sort((a,b)=>
      a.price==null || b.price==null ? Number(a.price==null)-Number(b.price==null) :
        (state.sort==='low' ? a.price-b.price : b.price-a.price));
    return {hits,options,invalid};
  }

  function create(ctx,mode,getRows,tile) {
    const {esc,icon}=ctx, chase=mode==='chase', key='cardbit:catalog-filters:v2:'+mode;
    const keys=Object.keys(fields).filter(k=>chase ? k!=='kind' : !['edition','tier'].includes(k));
    const state=defaults(), size=chase?12:20;
    let expanded=false;
    function persist(){try{sessionStorage.setItem(key,JSON.stringify(state));}catch{}}
    try {
      let saved=JSON.parse(sessionStorage.getItem(key) || 'null');
      if(!saved && !chase) {
        const old=JSON.parse(sessionStorage.getItem('cardbit:singles-search:v1') || 'null')?.filters;
        if(old) {
          saved={...old,selected:{}};
          for(const k of ['set','finish','language'])if(old[k])saved.selected[k]=[k==='language' ? languages[old[k]]||old[k] : old[k]];
          if(old.kind==='slab'||old.kind==='single')saved.selected.kind=[old.kind==='slab'?'Graded slabs':'Singles'];
          if(old.stock)saved.selected.availability=['In stock'];
        }
      }
      if(saved) {
        for(const k of ['q','min','max'])if(typeof saved[k]==='string')state[k]=saved[k];
        if(['featured','low','high','az'].includes(saved.sort))state.sort=saved.sort;
        if(Number.isSafeInteger(saved.page)&&saved.page>0)state.page=saved.page;
        for(const k of keys)if(Array.isArray(saved.selected?.[k]))state.selected[k]=saved.selected[k].filter(v=>typeof v==='string');
        state.wanted=chase && saved.wanted===true;
      }
    }catch{}
    const attr=(k,v)=>' data-'+k+'="'+esc(v)+'"';
    const cmd=(k,label,attrs='',cls='')=>'<button type="button" class="'+cls+'" data-cb-do="cf-'+k+'"'+attrs+'>'+label+'</button>';
    const panel=()=>ctx.root()?.querySelector('[data-catalog="'+mode+'"]');
    const priceLabel=chase?'Sell-back value':'Purchase price';
    function entries(){return Object.entries(state.selected).flatMap(([k,values])=>values.map(value=>[k,value]));}
    function activeCount(){return entries().length+Number(!!(state.min||state.max))+Number(state.wanted);}
    function chips(){
      const out=entries().map(([k,v])=>cmd('remove',esc(v)+' ×',attr('group',k)+attr('value',v)+' aria-label="Remove '+esc(fields[k]+' '+v)+'"','cf-chip'));
      if(state.min||state.max)out.push(cmd('unprice',esc((state.min||'0')+'–'+(state.max||'any')+' Cardbits')+' ×','','cf-chip'));
      if(state.wanted)out.push(cmd('unwant','My want list ×','','cf-chip'));
      if(out.length||state.q)out.push(cmd('clear','Clear all','','cf-clear'));
      return out.join('');
    }
    function group(k,options) {
      const values=[...new Set([...options.keys(),...(state.selected[k]||[])])].sort((a,b)=>
        k==='tier' && tierOrder.includes(a) && tierOrder.includes(b) ? tierOrder.indexOf(a)-tierOrder.indexOf(b) : a.localeCompare(b));
      if(!values.length && k!=='availability')return '';
      const selected=state.selected[k]||[], title=fields[k];
      return '<details class="cf-group"'+(['availability','set','edition'].includes(k)||selected.length?' open':'')+'><summary>'+title+'</summary>'+
        (['set','rarity'].includes(k)?'<input class="cf-find" type="search" data-cf-find="'+k+'" aria-label="Search '+title.toLowerCase()+' options" placeholder="Search '+title.toLowerCase()+'">':'')+
        '<div class="cf-options">'+values.map(v=>'<label><input type="checkbox" data-cf-group="'+k+'" value="'+esc(v)+'"'+
          (selected.includes(v)?' checked':'')+'><span>'+esc(v)+'</span><small aria-hidden="true">'+(options.get(v)?.size||0)+'</small></label>').join('')+'</div>'+
        (k==='availability'&&chase?'<label class="cf-wanted"><input type="checkbox" data-cf-wanted'+(state.wanted?' checked':'')+'>My want list</label>':'')+
        '</details>';
    }
    function results(model) {
      const n=model.hits.length,last=Math.max(1,Math.ceil(n/size));state.page=Math.min(state.page,last);
      if(!n)return '<p role="status" class="cf-count">0 results</p><section class="cf-empty"><h2>No matching cards</h2><p>'+
        (model.invalid?'Enter a valid Cardbits range. The minimum must be less than or equal to the maximum.':'Try another search or clear a filter.')+
        '</p>'+cmd('clear','Clear filters','','cb-secondary')+'</section>';
      const start=chase?0:(state.page-1)*size, end=Math.min(n,state.page*size);
      const unit=chase?'printing':'card';
      return '<p class="cf-count" role="status">'+(start+1)+'–'+end+' of '+n.toLocaleString('en-US')+' '+unit+(n===1?'':'s')+'</p><div class="'+
        (chase?'ct-chase-grid':'cb-card-grid')+'">'+model.hits.slice(start,end).map(tile).join('')+'</div>'+
        (chase ? end<n?cmd('more','Show more printings','','cb-secondary ct-more'):'' : last>1?'<div class="cb-pager">'+
        cmd('prev','Previous',state.page===1?' disabled':'','cb-secondary')+'<span>Page '+state.page+' of '+last+'</span>'+
        cmd('next','Next',state.page===last?' disabled':'','cb-secondary')+'</div>':'');
    }
    function page() {
      const model=search(getRows(),state,keys), count=activeCount(), title=chase?'Chase':'Shop Singles';
      const range='<details class="cf-group" open><summary>'+priceLabel+' <small>Cardbits</small></summary><div class="cf-range">'+
        ['min','max'].map((k,i)=>'<label>'+(i?'Maximum':'Minimum')+'<input inputmode="numeric" type="text" data-cf-bound="'+k+'" value="'+esc(state[k])+'" placeholder="'+(i?'Any':'0')+'"></label>').join('')+
        '</div><div class="cf-bands">'+bands.map(([label,min,max])=>cmd('band',label,attr('min',min)+attr('max',max)+' aria-pressed="'+(state.min===min&&state.max===max)+'"')).join('')+'</div></details>';
      return '<div class="cb-wrap cb-page cf-page" data-catalog="'+mode+'"><h1>'+title+'</h1><div class="cf-toolbar"><label class="cf-search">'+icon('search',19)+
        '<input type="search" data-cf-query aria-label="Search cards" placeholder="Search cards, numbers, or sets" value="'+esc(state.q)+'"></label>'+
        cmd('toggle','Filters'+(count?' ('+count+')':''),' aria-controls="cf-sidebar" aria-expanded="'+expanded+'"','cf-toggle')+
        '<label class="cf-sort">Sort<select data-cf-sort>'+[['featured','Featured'],['az','Name A–Z'],['low',chase?'Value: low to high':'Price: low to high'],['high',chase?'Value: high to low':'Price: high to low']].map(([k,v])=>'<option value="'+k+'"'+(state.sort===k?' selected':'')+'>'+v+'</option>').join('')+'</select></label></div>'+
        '<div class="cf-layout"><aside id="cf-sidebar" class="cf-sidebar" data-expanded="'+expanded+'" aria-label="'+title+' filters"><h2>Filters</h2>'+range+
        keys.map(k=>group(k,model.options[k])).join('')+cmd('done','Show results','','cb-primary cf-done')+'</aside>'+
        '<section class="cf-list" aria-label="Card results"><div class="cf-chips" data-cf-chips>'+chips()+'</div><div data-cf-results>'+results(model)+'</div></section></div></div>';
    }
    function update() {
      const box=panel();if(!box)return;
      const model=search(getRows(),state,keys);
      box.querySelector('[data-cf-results]').innerHTML=results(model);
      box.querySelector('[data-cf-chips]').innerHTML=chips();
      box.querySelectorAll('[data-cf-group]').forEach(el=>{
        const k=el.dataset.cfGroup;el.checked=!!state.selected[k]?.includes(el.value);
        el.parentElement.querySelector('small').textContent=model.options[k]?.get(el.value)?.size || 0;
      });
      box.querySelectorAll('[data-cf-bound]').forEach(el=>{if(el.value!==state[el.dataset.cfBound])el.value=state[el.dataset.cfBound];el.setAttribute('aria-invalid',String(model.invalid));});
      box.querySelectorAll('[data-cb-do="cf-band"]').forEach(el=>el.setAttribute('aria-pressed',String(state.min===el.dataset.min&&state.max===el.dataset.max)));
      const toggle=box.querySelector('.cf-toggle');toggle.textContent='Filters'+(activeCount()?' ('+activeCount()+')':'');
      const wanted=box.querySelector('[data-cf-wanted]');if(wanted)wanted.checked=state.wanted;
      box.querySelector('[data-cf-query]').value=state.q;
      box.querySelector('[data-cf-sort]').value=state.sort;
      persist();
    }
    function input(el) {
      if(!el.closest('[data-catalog="'+mode+'"]'))return false;
      if(el.hasAttribute('data-cf-find')){
        const needle=normalize(el.value);
        el.parentElement.querySelectorAll('.cf-options label').forEach(label=>label.hidden=!normalize(label.querySelector('input').value).includes(needle));
        return true;
      }
      if(el.dataset.cfGroup){
        const k=el.dataset.cfGroup,values=new Set(state.selected[k]);
        if(el.checked)values.add(el.value);else values.delete(el.value);
        state.selected[k]=[...values];
      }else if(el.dataset.cfBound)state[el.dataset.cfBound]=el.value.trim();
      else if(el.hasAttribute('data-cf-query'))state.q=el.value;
      else if(el.hasAttribute('data-cf-sort'))state.sort=el.value;
      else if(el.hasAttribute('data-cf-wanted'))state.wanted=el.checked;
      else return false;
      state.page=1;update();return true;
    }
    function click(el) {
      const box=panel();if(!box||!box.contains(el)||!el.dataset.cbDo.startsWith('cf-'))return false;
      const action=el.dataset.cbDo.slice(3),toggle=box.querySelector('.cf-toggle');
      if(action==='toggle'||action==='done'){
        expanded=action==='toggle'&&!expanded;box.querySelector('.cf-sidebar').dataset.expanded=String(expanded);
        toggle.setAttribute('aria-expanded',String(expanded));if(!expanded)toggle.focus();return true;
      }
      if(action==='prev'||action==='next'||action==='more')state.page=Math.max(1,state.page+(action==='prev'?-1:1));
      else{
        state.page=1;
        if(action==='clear'){
          Object.assign(state,defaults());
          box.querySelectorAll('[data-cf-find]').forEach(el=>{el.value='';input(el);});
        }
        if(action==='remove')state.selected[el.dataset.group]=state.selected[el.dataset.group].filter(v=>v!==el.dataset.value);
        if(action==='unwant')state.wanted=false;
        if(action==='unprice'||action==='band'){state.min=el.dataset.min||'';state.max=el.dataset.max||'';}
      }
      const firstNew=(state.page-1)*size;
      update();
      if(!el.isConnected){
        const focus=action==='more'?box.querySelectorAll('.ct-chase-card')[firstNew]:
          ['prev','next'].includes(action)?box.querySelector('.cf-list .cb-card-tile'):box.querySelector('[data-cf-query]');
        focus?.focus();
      }
      return true;
    }
    return {page,click,input};
  }
  root.CardbitCatalogFilters={listing,search,create};
})(window);

(function install(root) {
  'use strict';
  const rules=root.CardbitCollectorRules;
  const language=c=>({en:'English',ja:'Japanese',jp:'Japanese'})[c.language]||c.language||'Language Unlisted';
  const metadata=c=>[c.set,c.number,c.printing,language(c)].filter(Boolean).join(' · ');
  function buildIndex(state) {
    const index=new Map();
    function row(card) {
      const key=rules.printingKey(card);
      if(!index.has(key)) index.set(key,{key,card,packs:[],singles:[],recorded:false,samples:[],tiersByPack:new Map(),filterSources:new Map()});
      return index.get(key);
    }
    for(const pack of state.packs||[]) for(const card of pack.cards||[]){
      const item=row(card);
      if(pack.remaining>0 && card.remaining>0) {
        if(!item.tiersByPack.has(pack.id)) { item.tiersByPack.set(pack.id,new Set()); item.packs.push(pack); }
        item.tiersByPack.get(pack.id).add(typeof card.tier === 'string' ? card.tier.trim() : '');
        const signature=JSON.stringify([pack.id,card.tier,card.buybackBits,card.canBuyback,card.condition,card.rarity]);
        if(!item.filterSources.has(signature))item.filterSources.set(signature,{card,pack});
      }
    }
    for(const card of state.singles||[]){const item=row(card);if(card.available>0){item.singles.push(card);item.filterSources.set('single:'+card.id,{card});}}
    return index;
  }
  function create(ctx) {
    const {esc,enc,link,btn,art,asset,icon,bread,empty,packTitle}=ctx;
    const get=ctx.state;
    let cached=null,rows=null,selected=new Set(),scope='',destination='madison';
    const guestKey='cardbit:guest-want-list:v1';
    function index(){if(cached!==get()){cached=get();rows=buildIndex(cached);}return rows;}
    function wants(){if(get()?.account)return get().wants||[];try{return JSON.parse(localStorage.getItem(guestKey)||'[]');}catch{return [];}}
    function pageStart(title,lead,parent='packs',parentLabel='Packs'){
      return '<div class="cb-wrap cb-page cb-collector">'+bread(parent,parentLabel)+'<h1>'+title+'</h1>'+ (lead?'<p class="cb-lead">'+lead+'</p>':'');
    }
    
    const catalog=root.CardbitCatalogFilters;
    let sourceIndex, searchRows;
    function chaseRows(){
      const current=index(), saved=new Set(wants());
      if(sourceIndex!==current){
        sourceIndex=current;
        searchRows=[...current.values()].map(row=>{
          const sources=[...row.filterSources.values()];
          const variants=(sources.length?sources:[{card:row.card}]).map(({card,pack})=>{
            const available=sources.length>0;
            return catalog.listing(card,available ? ctx.cardBuyback(card).amount : null,{
              availability:available ? pack?'In a pack':'Available single' : 'Unavailable',
              edition:pack?packTitle(pack):'',tier:pack?card.tier:''
            });
          });
          return {key:row.key,name:row.card.name || row.card.title,row,variants};
        }).sort((a,b)=>Number(Boolean(b.row.card.localImage))-Number(Boolean(a.row.card.localImage)) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
      }
      for(const r of searchRows)r.wanted=saved.has(r.key);
      return searchRows;
    }
    function chaseTile({row,variants},index){
      const c=variants[0].card;
      const tiers=new Set(variants.filter(v=>v.values.edition).map(v=>v.values.tier||''));
      const badge=tiers.size===1 ? ctx.tierMarkup({tier:[...tiers][0]}) : '';
      const places=[...new Set(variants.map(v=>v.values.edition || v.values.availability))].join(' · ');
      return link('chase/'+enc(row.key),art(c,/* SITE */ index<15)+'<div><strong>'+esc(c.name || c.title)+'</strong>'+badge+
        '<small>'+esc([c.set,c.number].filter(Boolean).join(' · '))+'</small><small>'+esc([c.printing,language(c)].filter(Boolean).join(' · '))+'</small>'+
        '<span>'+esc(places)+'</span>'+(row.wanted?'<b class="ct-saved">Saved</b>':'')+'</div>','ct-chase-card');
    }
    const filters=catalog.create(ctx,'chase',chaseRows,chaseTile);
    function chasePage(key){return key?chaseDetail(key):filters.page();}
    function chaseDetail(key){
      const r=index().get(key);
      if(!r)return pageStart('Printing Unavailable','')+link('chase','Find Another Printing','cb-secondary')+'</div>';
      const c=r.card, saved=wants().includes(key);
      const samples=r.samples.filter(s=>s.id!=='mystery'||!r.recorded).map(ed=>link('latch/'+enc(ed.id),'Try '+esc(ed.name)+' Opening '+icon('arrow',15),'cb-textlink')).join(' ');
      const active=r.packs.map(p=>link('packs/'+enc(p.id),'<b>'+esc(packTitle(p))+'</b>'+[...r.tiersByPack.get(p.id)].map(tier=>ctx.tierMarkup({tier})).join('')+'<span>View Pack '+icon('arrow',15)+'</span>','ct-option')).join('');
      const singles=r.singles.map(s=>link('shop/'+enc(s.id),'<b>Buy This Printing as a Single</b><span>View Single '+icon('arrow',15)+'</span>','ct-option')).join('');
      return '<div class="cb-wrap cb-page cb-collector">'+bread('chase','Chase')+'<div class="ct-print"><div class="ct-print-art">'+art(c,true)+'</div><div><p class="cb-kicker">Exact Printing</p><h1>'+esc(c.name)+'</h1><p class="cb-lead">'+esc(metadata(c))+'</p>'+
        btn('chase-save',saved?'Remove from Want List':'Save to Want List','cb-secondary','data-key="'+esc(key)+'" aria-pressed="'+saved+'"')+'<p data-want-status role="status" class="cb-sub"></p><h2>Where to Find It</h2>'+
        (active+singles||'<p class="cb-sub">This Printing Has No Pack or Single Listing.</p>')+
        (r.recorded?'<div class="ct-reference"><strong>Mystery Edition Reference Pool</strong><p>This Printing Appears in the Archived Mystery Edition Pool.</p>'+link('latch/mystery','Try Mystery Edition '+icon('arrow',15),'cb-textlink')+'</div>':'')+(samples?'<div class="ct-reference"><strong>Demo Opening</strong><p>See This Printing in the Opening Sequence.</p>'+samples+'</div>':'')+'</div></div></div>';
    }
    function shipLink(){return link('ship-together',icon('ship',18)+'Ship Together','cb-primary');}
    function shipments(){return get().shipments||[];}
    function parcelList(){
      const list=shipments();return !list.length?'':'<section class="cb-separated"><h2>Your Shipments</h2><div class="cb-history">'+list.map(s=>link('ship-together/'+enc(s.id),'<div>'+icon('ship',21)+'<span><b>'+s.copyIds.length+' '+(s.copyIds.length===1?'card':'cards')+' Together</b><small>'+esc(ctx.date(s.at))+' · '+esc(get().mode==='shopper-test' ? ctx.shipmentStatus(s) : 'Requested')+'</small></span></div><span>View Parcel '+icon('arrow',15)+'</span>','cb-history-row')).join('')+'</div></section>';
    }
    function shipPage(id,copy){
      const opening=pageStart('Ship Together','Choose Held Cards from Any of Your Openings or Singles for One Parcel.','vault','My Vault');
      if(!get().account)return opening+ctx.loginForm('Sign In to Select Your Cards')+'</div>';
      const who=get().mode+'/'+(get().account.id || get().account.name);
      if(who!==scope){scope=who;selected=new Set();destination='madison';}
      if(id&&id!=='select')return parcelPage(id);
      const held=(get().binder||[]).filter(c=>c.status==='held'), heldIds=new Set(held.map(c=>c.id));
      selected=new Set([...selected].filter(k=>heldIds.has(k)));
      if(id==='select'&&heldIds.has(copy))selected.add(copy);
      if(!held.length)return opening+empty('No Held Cards to Ship','Open a Pack or Add a Single to Your Vault. Your Held Cards Will Appear Here.','Browse Packs','packs')+parcelList()+'</div>';
      /* SITE */ if(siteShip())return siteShipPage(opening,held);
      return opening+'<div class="ct-ship-layout"><fieldset class="ct-holdings"><legend>Held Cards</legend>'+held.map(c=>{
        const o=(get().openings||[]).find(o=>o.id===c.openingId),origin=o?(packTitle({id:o.packId})+' Opening'):'Card Shop';
        return '<label class="ct-copy"><input type="checkbox" data-parcel-copy value="'+esc(c.id)+'" '+(selected.has(c.id)?'checked':'')+'>'+art(c)+'<span><strong>'+esc(c.name)+'</strong><small>'+esc([c.number,c.printing].filter(Boolean).join(' · '))+'</small><small>'+esc(origin)+'</small></span></label>';
      }).join('')+'</fieldset><aside class="ct-quote"><h2>Plan a Shipment</h2><label>Destination<select data-parcel-destination>'+Object.entries(rules.destinations).map(([k,v])=>'<option value="'+k+'" '+(destination===k?'selected':'')+'>'+esc(v.label)+'</option>').join('')+'</select></label><div data-parcel-summary>'+summary()+'</div><p class="cb-sub">You Can Save These Cards Together. Postage Is Calculated at Shipping Checkout.</p></aside></div>'+parcelList()+'</div>';
    }
    function summary(){/* SITE */ if(siteShip())return siteSummary();return '<p class="ct-price"><span aria-live="polite">'+selected.size+' Selected</span><strong>'+(selected.size?'Postage Pending':'—')+'</strong></p>'+btn('parcel-review','Review Selection','cb-primary',selected.size?'':'disabled');}
    function updateSummary(){const node=ctx.root().querySelector('[data-parcel-summary]');if(node)node.innerHTML=summary();}
    function parcelPage(id) {
      const s=shipments().find(p=>p.id===id);
      if(!s)return pageStart('Shipment Unavailable','','vault','My Vault')+link('ship-together','Back to Shipments','cb-secondary')+'</div>';
      const cards=(get().binder||[]).filter(c=>s.copyIds.includes(c.id));
      return pageStart('Saved Parcel','Your Selected Cards Are Grouped Together.','ship-together','Ship Together')+
        '<div class="ct-parcel-status">'+icon('ship',27)+'<div><strong>Awaiting Tracking</strong><p>Tracking Appears When a Carrier Issues a Shipping Label.</p></div></div>'+
        ctx.facts([['Parcel Reference',s.id],['Requested',ctx.date(s.at)],['Selected Cards',s.copyIds.length],['Destination',rules.destinations[s.destination]?.label],['Postage','Calculated at Shipping Checkout']])+
        '<div class="ct-parcel-cards">'+cards.map(c=>link('binder/'+enc(c.id),art(c)+'<span>'+esc(c.name)+'<small>'+esc(c.number||'')+'</small></span>','ct-parcel-copy')).join('')+'</div>'+
        '<details class="ct-timeline"><summary>How Tracking Works</summary><ol><li>Request Received</li><li>Label Created</li><li>In Transit</li><li>Delivered</li></ol></details>'+
        '<div class="cb-actions"><a class="cb-secondary cc-contact" href="mailto:Support@cardbit.com?subject='+enc('Cardbit Parcel '+s.id)+'">Contact Customer Service</a></div></div>';
    }
    /* SITE: Ship Together on the standalone site. Real US delivery address, fee in Cardbits
       (600, free at 30 cards or 10,000 Cardbits of card value), excluded states blocked. The server re-checks all of it. */
    const siteShip = () => root.CardbitStore?.site === true;
    const SHIP_FEE_BITS = 600, FREE_CARDS = 30, FREE_VALUE = 10000;
    const EXCLUDED = ['AL','HI','ID','MN','NV','NY','UT','WA'];
    const STATES = [['AK','Alaska'],['AL','Alabama'],['AR','Arkansas'],['AZ','Arizona'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DC','District of Columbia'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['IA','Iowa'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['MA','Massachusetts'],['MD','Maryland'],['ME','Maine'],['MI','Michigan'],['MN','Minnesota'],['MO','Missouri'],['MS','Mississippi'],['MT','Montana'],['NC','North Carolina'],['ND','North Dakota'],['NE','Nebraska'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NV','Nevada'],['NY','New York'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VA','Virginia'],['VT','Vermont'],['WA','Washington'],['WI','Wisconsin'],['WV','West Virginia'],['WY','Wyoming']];
    const ADDRESS_FIELDS = [['name','Full Name','name',80,true],['street1','Street Address','address-line1',120,true],['street2','Apt, Suite or Unit (Optional)','address-line2',120,false],['city','City','address-level2',60,true],['zip','ZIP Code','postal-code',10,true],['phone','Phone (Optional)','tel',20,false]];
    const addressKey = 'cardbit:ship-address:v1';
    let address = (() => { try { return JSON.parse(sessionStorage.getItem(addressKey)) || {}; } catch { return {}; } })();
    const saveAddress = () => { try { sessionStorage.setItem(addressKey, JSON.stringify(address)); } catch {} };
    // Card value for the free-shipping bar: retail value in Cardbits, else the buyback offer.
    const valueOf = c => Math.max(0, Number(c?.retailBits ?? c?.buybackBits ?? 0) || 0);
    const valueOfIds = ids => (get().binder || []).filter(c => ids.includes(c.id)).reduce((sum, c) => sum + valueOf(c), 0);
    const freeShip = (n, v) => n >= FREE_CARDS || v >= FREE_VALUE;
    const fee = (n, v) => freeShip(n, v) ? 0 : SHIP_FEE_BITS;
    let barWas = {cards:0, value:0};
    function freeBars(n, v) {
      const free = n > 0 && freeShip(n, v);
      const bar = (key, label, now, goal, text) => {
        const to = Math.min(100, now / goal * 100), from = barWas[key]; barWas[key] = to;
        return '<div class="ct-bar'+(now >= goal ? ' is-full' : '')+'"><div class="ct-bar-top"><span>'+label+'</span><span>'+text+'</span></div>'+
          '<div class="ct-bar-track" role="progressbar" aria-label="'+label+'" aria-valuemin="0" aria-valuemax="'+goal+'" aria-valuenow="'+Math.min(now, goal)+'"><i style="width:'+from.toFixed(1)+'%" data-to="'+to.toFixed(1)+'%"></i></div></div>';
      };
      requestAnimationFrame(() => ctx.root().querySelectorAll('.ct-bar-track i[data-to]').forEach(i => { i.style.width = i.dataset.to; i.removeAttribute('data-to'); }));
      return '<div class="ct-free'+(free ? ' is-free' : '')+'"><p class="ct-free-head">'+(free ? icon('check',16)+'Free Shipping Unlocked' : 'Free Shipping at '+FREE_CARDS+'+ Cards or '+FREE_VALUE.toLocaleString('en-US')+' Cardbits in Card Value')+'</p>'+
        bar('cards', 'Cards', n, FREE_CARDS, Math.min(n, FREE_CARDS)+' of '+FREE_CARDS)+
        bar('value', 'Card Value', v, FREE_VALUE, (v >= FREE_VALUE ? FREE_VALUE : v).toLocaleString('en-US')+' of '+FREE_VALUE.toLocaleString('en-US'))+
        (free ? '' : '<p class="cb-micro">Fill Either Bar to Ship Free.</p>')+'</div>';
    }
    const bits = n => Number(n).toLocaleString('en-US') + ' Cardbits';
    function addressProblems() {
      const a = address, out = [];
      if (!String(a.name||'').trim()) out.push("Enter the recipient's name.");
      if (!String(a.street1||'').trim()) out.push('Enter the street address.');
      if (!String(a.city||'').trim()) out.push('Enter the city.');
      if (!STATES.some(([c]) => c === a.state)) out.push('Pick a state.');
      else if (EXCLUDED.includes(a.state)) out.push('Cardbit Can’t Ship to ' + STATES.find(([c]) => c === a.state)[1] + '.');
      if (!/^\d{5}(-\d{4})?$/.test(String(a.zip||'').trim())) out.push('Enter a 5-digit ZIP code.');
      return out;
    }
    function addressForm() {
      const field = ([k,label,auto,max,req]) => '<label>'+esc(label)+'<input data-parcel-field="'+k+'" name="'+k+'" autocomplete="shipping '+auto+'" maxlength="'+max+'"'+(req?' required':'')+(k==='zip'?' inputmode="numeric"':'')+(k==='phone'?' type="tel"':'')+' value="'+esc(address[k]||'')+'"></label>';
      const state = '<label>State<select data-parcel-field="state" name="state" autocomplete="shipping address-level1" required><option value="">Choose a State</option>'+
        STATES.map(([c,n]) => EXCLUDED.includes(c) ? '<option value="'+c+'" disabled>'+esc(n)+' (Not Available)</option>' : '<option value="'+c+'"'+(address.state===c?' selected':'')+'>'+esc(n)+'</option>').join('')+'</select></label>';
      return '<fieldset class="ct-address"><legend>Ship To</legend>'+ADDRESS_FIELDS.slice(0,4).map(field).join('')+state+ADDRESS_FIELDS.slice(4).map(field).join('')+
        '<p class="cb-micro">U.S. Addresses Only. Not Available in Alabama, Hawaii, Idaho, Minnesota, Nevada, New York, Utah or Washington.</p></fieldset>';
    }
    function siteSummary() {
      const n = selected.size, v = valueOfIds([...selected]), cost = fee(n, v), balance = get().account?.bits ?? 0;
      const line = !n ? '—' : cost ? bits(cost) : 'Free Shipping';
      const short = n && cost > balance;
      return '<p class="ct-price"><span aria-live="polite">'+n+' Selected</span><strong>'+line+'</strong></p>'+
        freeBars(n, v)+
        (short ? '<p class="cb-micro cb-error">You Need '+bits(cost - balance)+' More.</p>'+link('cardbits','Buy Cardbits','cb-secondary') : '')+
        btn('parcel-review','Review Shipment','cb-primary',n && !short ? '' : 'disabled');
    }
    function siteShipPage(opening, held) {
      return opening+'<div class="ct-ship-layout"><fieldset class="ct-holdings"><legend>Held Cards</legend>'+held.map(c=>{
        const o=(get().openings||[]).find(o=>o.id===c.openingId),origin=o?(packTitle({id:o.packId})+' Opening'):'Card Shop';
        return '<label class="ct-copy"><input type="checkbox" data-parcel-copy value="'+esc(c.id)+'" '+(selected.has(c.id)?'checked':'')+'>'+art(c)+'<span><strong>'+esc(c.name)+'</strong><small>'+esc([c.number,c.printing].filter(Boolean).join(' · '))+'</small><small>'+esc(origin)+'</small></span></label>';
      }).join('')+'</fieldset><aside class="ct-quote"><h2>Plan a Shipment</h2>'+addressForm()+'<div data-parcel-summary>'+siteSummary()+'</div>'+
        '<p class="cb-sub">'+bits(SHIP_FEE_BITS)+' per Shipment, Free at '+FREE_CARDS+'+ Cards or '+FREE_VALUE.toLocaleString('en-US')+' Cardbits in Card Value. Processed Within 48 Hours.</p></aside></div>'+parcelList()+'</div>';
    }
    function siteReview() {
      if(!selected.size)return;
      const problems = addressProblems();
      const summaryNode = ctx.root().querySelector('[data-parcel-summary]');
      if (problems.length) {
        updateSummary();
        summaryNode?.insertAdjacentHTML('afterbegin','<div class="cb-note cb-error" role="alert"><ul>'+problems.map(p=>'<li>'+esc(p)+'</li>').join('')+'</ul></div>');
        ctx.root().querySelector('[data-parcel-field]:invalid, [data-parcel-field="'+(problems[0].includes('state')||problems[0].includes('Ship to')?'state':'name')+'"]')?.focus();
        return;
      }
      const ids=[...selected].sort(), a={...address}, cost=fee(ids.length, valueOfIds(ids)), balance=get().account?.bits ?? 0;
      review={copyIds:ids,address:a,key:JSON.stringify([ids,a.name,a.street1,a.street2,a.city,a.state,a.zip])};
      const cards=get().binder.filter(c=>ids.includes(c.id));
      ctx.modal('<h2>Review Your Shipment</h2><p>'+ids.length+' '+(ids.length===1?'Card':'Cards')+' in One Parcel.</p>'+
        '<address class="ct-review-address">'+[a.name,a.street1,a.street2,(a.city||'')+', '+a.state+' '+a.zip].filter(Boolean).map(esc).join('<br>')+'</address>'+
        '<ul class="ct-review-cards">'+cards.map(c=>'<li>'+esc(c.name)+' <small>'+esc(c.number||'')+'</small></li>').join('')+'</ul>'+
        ctx.facts([['Shipping',cost?bits(cost):'Free'],['Current Balance',bits(balance)],['Balance After',bits(balance-cost)]])+
        '<p class="cb-sub">These Cards Leave Your Vault and Can No Longer Be Sold Back. We Process Shipments Within 48 Hours.</p>'+
        '<div data-dialog-error role="status"></div><div class="cb-dialog-actions">'+btn('cancel','Back','cb-secondary')+btn('parcel-confirm','Confirm Shipment','cb-primary')+'</div>');
      ctx.dialog().setAttribute('aria-label','Review Your Shipment');
    }
    async function siteCommit() {
      if(!review||ctx.busy())return;
      const item=review;ctx.setBusy(true);const confirm=ctx.dialog()?.querySelector('[data-cb-do="parcel-confirm"]');if(confirm){confirm.disabled=true;confirm.textContent='Processing…';}
      try{
        const result=await root.CardbitStore.action({action:'ship-group',copyIds:item.copyIds,address:item.address,method:'CARDBITS',requestId:ctx.requestId('ship-group',item.key)});
        ctx.setState(result.state);ctx.requestId('ship-group',item.key,true);selected.clear();review=null;ctx.setBusy(false);
        ctx.go('shipments/'+enc(result.shipmentId));
      }catch(e){
        ctx.setBusy(false);
        if(confirm){confirm.disabled=false;confirm.textContent='Confirm Shipment';}
        if(e.code==='unavailable'||e.code==='not_found'){ctx.close();await ctx.refresh();ctx.error(e);return;}
        // The request was refused, not lost: the next attempt is a new request.
        if(e.code && e.code!=='CONNECTION')ctx.requestId('ship-group',item.key,true);
        const detail=e.code==='address_invalid'&&Array.isArray(e.fields)&&e.fields.length?Error(e.fields.join(' ')):e;
        ctx.error(detail);
        if(e.code==='insufficient_bits'){const box=ctx.dialog()?.querySelector('[data-dialog-error]');if(box)box.insertAdjacentHTML('beforeend',' '+link('cardbits','Buy Cardbits','cb-textlink'));}
      }
    }
    let review=null;
    function reviewParcel(){
      /* SITE */ if(siteShip())return siteReview();
      if(!selected.size)return;
      const ids=[...selected].sort(),quote=rules.destinations[destination];
      review={copyIds:ids,destination,key:JSON.stringify([destination,ids])};
      const cards=get().binder.filter(c=>ids.includes(c.id));
      ctx.modal('<h2>Review Your Shipment</h2><p>'+ids.length+' '+(ids.length===1?'card':'cards')+' Together for '+esc(quote.label)+'.</p><ul class="ct-review-cards">'+cards.map(c=>'<li>'+esc(c.name)+' <small>'+esc(c.number||'')+'</small></li>').join('')+'</ul><p class="cb-sub">Save These Cards Together in Your Vault. No Postage Will Be Purchased.</p><div data-dialog-error role="status"></div><div class="cb-dialog-actions">'+btn('cancel','Back','cb-secondary')+btn('parcel-confirm','Save Selection','cb-primary')+'</div>');
      ctx.dialog().setAttribute('aria-label','Review Your Shipment');
    }
    async function commitParcel(){
      /* SITE */ if(siteShip())return siteCommit();
      if(!review||ctx.busy())return;
      const item=review;ctx.setBusy(true);const confirm=ctx.dialog()?.querySelector('[data-cb-do="parcel-confirm"]');if(confirm)confirm.disabled=true;
      try{
        const result=await root.CardbitStore.action({action:'ship-group',copyIds:item.copyIds,destination:item.destination,requestId:ctx.requestId('ship-group',item.key)});
        ctx.setState(result.state);ctx.requestId('ship-group',item.key,true);selected.clear();review=null;ctx.setBusy(false);
        ctx.go('shipments/'+enc(result.shipmentId));
      }catch(e){
        ctx.setBusy(false);
        if(['UNAVAILABLE','NOT_FOUND','unavailable','not_found'].includes(e.code)){ctx.close();await ctx.refresh();ctx.error(e);}
        else{if(confirm)confirm.disabled=false;ctx.error(e);}
      }
    }
    async function saveWant(el){
      const key=el.dataset.key, saved=wants().includes(key);
      if(!index().has(key)||ctx.busy())return;
      ctx.setBusy(true);el.disabled=true;
      try{
        if(get().account){const action=saved?'want-remove':'want-add';const result=await root.CardbitStore.action({action,id:key,requestId:ctx.requestId(action,key)});ctx.setState(result.state);ctx.requestId(action,key,true);}
        else{const list=new Set(wants());if(saved)list.delete(key);else list.add(key);localStorage.setItem(guestKey,JSON.stringify([...list]));}
        el.textContent=saved?'Save to Want List':'Remove from Want List';el.setAttribute('aria-pressed',String(!saved));
        const status=ctx.root().querySelector('[data-want-status]');if(status)status.textContent=saved?'Printing Removed.':get().account?'Saved to Your Want List.':'Saved to the Want List on This Browser.';
      }catch(e){ctx.error(e?.name==='SecurityError'?Error('Browser Storage Is Unavailable. Your Want List Could Not Be Saved.'):e);}
      finally{el.disabled=false;ctx.setBusy(false);}
    }
    function click(el){
      if(filters.click(el))return true;
      switch(el.dataset.cbDo){
        case 'chase-save':saveWant(el);break;
        case 'parcel-review':reviewParcel();break;
        case 'parcel-confirm':commitParcel();break;
        default:return false;
      }
      return true;
    }
    function input(el){
      if(filters.input(el))return true;
      /* SITE */ if(el.hasAttribute('data-parcel-field')){address[el.dataset.parcelField]=el.value;saveAddress();if(ctx.root().querySelector('[data-parcel-summary] [role=alert]'))updateSummary();return true;}
      if(el.hasAttribute('data-parcel-copy')){if(el.checked)selected.add(el.value);else selected.delete(el.value);updateSummary();return true;}
      if(el.hasAttribute('data-parcel-destination')){if(Object.hasOwn(rules.destinations,el.value))destination=el.value;updateSummary();return true;}
      return false;
    }
    function share(edition,cards,wrapper){root.CardbitSharePull.open(ctx,edition,cards,wrapper);}
    return {chasePage,shipLink,shipPage,parcelList,share,click,input};
  }
  root.CardbitCollectors=Object.freeze({create,buildIndex});
})(window);

