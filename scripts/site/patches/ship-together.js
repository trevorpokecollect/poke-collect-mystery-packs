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
    // Pack Pass: Pro ships one shipment free each month, Ultimate every shipment (server re-checks).
    const passShip = () => get().account?.passFreeShip || null;
    const passShipNote = () => { const p = passShip(); return p ? (p.kind === 'unlimited' ? 'Free With Pack Pass Ultimate' : 'Free With Pack Pass Pro (1 Free Shipment a Month)') : ''; };
    const fee = (n, v) => freeShip(n, v) || passShip() ? 0 : SHIP_FEE_BITS;
    let barWas = {cards:0, value:0};
    function freeBars(n, v) {
      const free = n > 0 && freeShip(n, v);
      if (!free && passShip()) return '<div class="ct-free is-free"><p class="ct-free-head">'+icon('check',16)+esc(passShipNote())+'</p></div>';
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
      const line = !n ? '—' : cost ? bits(cost) : (passShip() && !freeShip(n, v) ? 'Free With Pack Pass' : 'Free Shipping');
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
