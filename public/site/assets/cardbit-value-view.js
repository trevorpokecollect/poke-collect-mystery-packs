(function installCardbits(root){
  'use strict';
  const src=root.cardbitValueIcon || root.cardbitAssets?.['bits-card-emblem.png'];
  if(!src)return;
  function badge(amount,label='Cardbit value'){
    const node=document.createElement('span');
    node.className='cb-reference';
    const icon=document.createElement('img'); icon.src=src;icon.alt='';icon.width=18;icon.height=20;
    const valid=Number.isSafeInteger(amount)&&amount>=0;
    node.append(icon,document.createTextNode(valid?amount.toLocaleString('en-US'):'Pending'));
    const description=valid?label+' · '+amount.toLocaleString('en-US')+' Cardbits':label+' pending pricing from Cardbroker';
    node.setAttribute('aria-label',description);node.title=description;
    return node;
  }
  function cardNumber(card){return typeof card?.cardbitValue==='object'&&card.cardbitValue!==null?card.cardbitValue.amount:card?.cardbitValue;}
  function row(card) {
    if (card?.valueSource === 'unlisted') {
      const unavailable=document.createElement('small');unavailable.textContent='No Buyback Offer';return unavailable;
    }
    if (card?.valueSource !== 'poke-collect-retail') return badge(cardNumber(card));
    // Retail dollars stay off the storefront. Only the Cardbits offer is shown here.
    const row = document.createElement('span');
    row.className = 'cb-retail-quote';
    const offer = card.buybackBits > 0 ? badge(card.buybackBits, 'Buyback') : document.createElement('small');
    if (card.buybackBits > 0) offer.prepend(document.createTextNode('Buyback '));
    else offer.textContent = 'No Buyback Offer';
    row.append(offer);
    return row;
  }
  // Some existing templates render balance, ask, or confirmation as a text node.
  // Add the same currency mark without inserting markup into button labels or option values.
  // The portfolio owns its chart and table text through React.
  const skipDecoration = "cardbit-vault-portfolio,.cb-reference,script,style,textarea,select,noscript";
  function decorate(node) {
    if(node.nodeType===3) {
      const parent=node.parentElement, text=node.nodeValue;
      if(!parent || !text.includes('Cardbits') || parent.closest(skipDecoration))return;
      const matches=[...text.matchAll(/(?:[+−-]?\d[\d,]*) (?:test )?Cardbits\b/g)];
      if(!matches.length)return;
      const fragment=document.createDocumentFragment();let position=0;
      for(const m of matches){
        fragment.append(text.slice(position,m.index));
        const span=document.createElement('span');span.className='cb-reference';const img=document.createElement('img');img.src=src;img.alt='';
        span.append(img,document.createTextNode(m[0]));fragment.append(span);position=m.index+m[0].length;
      }
      fragment.append(text.slice(position));node.replaceWith(fragment);return;
    }
    if(node.nodeType!==1 || node.closest(skipDecoration))return;
    const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);const pending=[];
    while(walker.nextNode())if(walker.currentNode.nodeValue.includes('Cardbits'))pending.push(walker.currentNode);
    pending.forEach(decorate);
  }
  function observe(){if(!document.body)return;decorate(document.body);
    new MutationObserver(changes=>{for(const c of changes){if(c.type==='characterData')decorate(c.target);else c.addedNodes.forEach(decorate);}})
      .observe(document.body,{childList:true,characterData:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true});else observe();
  function statusIcon(state,label) {
    const icons={
      vault:'M5 3h14v18H5z M8 3v18 M11 7h5v5h-5z',
      box:'m3 8 9-5 9 5-9 5-9-5zm0 0v9l9 5 9-5V8m-9 5v9',
      sold:'m9 5-6 6 6 6 M3 11h12a5 5 0 0 1 5 5',
      done:'m4 12 5 5L20 6',
      waiting:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 6v6l4 2'
    };
    const glyph=({vault:'vault',held:'vault',shipping:'box',preparing:'box',shipped:'box',pickup_preparing:'box',pickup_ready:'done',picked_up:'done',returned:'sold',sold:'sold'})[state] || 'waiting';
    const node=document.createElement('span');
    node.className='cb-vault-status cb-chip'; node.setAttribute('role','img');
    node.setAttribute('aria-label',label); node.title=label;
    const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg'), path=document.createElementNS(ns,'path');
    for(const [name,value] of Object.entries({width:'17',height:'17',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(name,value);
    path.setAttribute('d',icons[glyph]); svg.append(path); node.append(svg); return node;
  }
  root.CardbitValueView={badge,row,statusIcon,html:card=>row(card).outerHTML,amount:n=>badge(n,'Cardbits').outerHTML};
})(globalThis);
