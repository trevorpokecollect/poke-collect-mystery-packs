/* Render only the edition art and the cards in the supplied result. */
(function install(root) {
  'use strict';
  const W = 1080, H = 1920;
  function photo(src) {
    if (!src) return Promise.resolve(null);
    /* SITE */ if (/^https:\/\/(product-images|tcgplayer-cdn)\.tcgplayer\.com\//.test(src)) src = '/api/card-image?u=' + encodeURIComponent(src);
    return new Promise(resolve => {
      const im = new Image();
      if (!/^(data:|blob:|file:)/i.test(src)) im.crossOrigin = 'anonymous';
      const settle = value => { clearTimeout(timer); im.onload = im.onerror = null; resolve(value); };
      const timer = setTimeout(() => settle(null), 7500);
      im.onload = () => settle(im); im.onerror = () => settle(null); im.src = src;
    });
  }
  function poster({edition, cards, faces, wrap, logo, index}) {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    if (!g) throw Error('Image Export Is Unavailable in This Browser.');
    const face = cards[index];
    function type(str,x,y,size,weight,color,max) {
      g.fillStyle=color; g.font=weight+' '+size+'px system-ui, sans-serif';
      while (size>17 && g.measureText(str).width>max) {size--;g.font=weight+' '+size+'px system-ui, sans-serif';}
      g.fillText(str,x,y,max);
    }
    function frame(x,y,w,h,r) {
      g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r);
      g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath();
    }
    function image(im,x,y,w,h,r=0) {
      if (!im) return;
      const scale=Math.min(w/im.naturalWidth,h/im.naturalHeight),iw=im.naturalWidth*scale,ih=im.naturalHeight*scale;
      const left=x+(w-iw)/2,top=y+(h-ih)/2;
      g.save();if(r){frame(left,top,iw,ih,r);g.clip();}g.drawImage(im,left,top,iw,ih);g.restore();
    }
    function card(im,c,x,y,w,h,large) {
      if(im){image(im,x,y,w,h,large?23:9);return;}
      const bg=g.createLinearGradient(x,y,x+w,y+h);bg.addColorStop(0,'#29374d');bg.addColorStop(1,'#101a28');
      g.fillStyle=bg;frame(x,y,w,h,large?24:10);g.fill();
      type(c.name,x+w*.08,y+h*.51,large?48:16,720,'#f6f8fa',w*.84);
      type(c.number||'',x+w*.08,y+h*.57,large?26:13,550,'#a7ced2',w*.84);
    }
    const bg=g.createLinearGradient(100,0,950,1700);bg.addColorStop(0,'#19283b');bg.addColorStop(.52,'#101424');bg.addColorStop(1,'#0a121b');g.fillStyle=bg;g.fillRect(0,0,W,H);
    const glow=g.createRadialGradient(675,755,50,675,755,740);glow.addColorStop(0,'rgba(100,90,193,.6)');glow.addColorStop(.57,'rgba(48,134,150,.16)');glow.addColorStop(1,'rgba(17,20,34,0)');g.fillStyle=glow;g.fillRect(0,130,W,1240);
    if(logo)image(logo,70,69,265,85);else type('cardbit',70,135,74,850,'#effcfc',300);
    type('PACK OPENING',630,126,24,750,'#92eee7',385);
    g.fillStyle='#38505c';g.fillRect(68,176,944,2);
    type(edition,70,282,72,750,'#f5f8f7',946);
    type('Featured Pull',72,340,31,550,'#91e3dd',450);
    if(wrap){g.save();g.translate(850,770);g.rotate(.19);image(wrap,-128,-290,256,580);g.restore();}
    g.save();g.shadowColor='rgba(0,0,0,.66)';g.shadowBlur=38;g.shadowOffsetY=24;
    card(faces[index],face,130,398,655,915,true);g.restore();
    type(face.name,70,1405,68,790,'#fbfcfa',940);
    type([face.set,face.number].filter(Boolean).join('  ·  '),72,1464,33,500,'#bcc9d1',940);
    g.fillStyle='#38505c';g.fillRect(68,1519,944,2);
    type('The Full Spread',70,1580,32,690,'#e1eeed',710);
    const gap=17, slot=(944-(cards.length-1)*gap)/cards.length, h=207, y=1610;
    cards.forEach((c,i)=>{const x=68+i*(slot+gap);card(faces[i],c,x,y,slot,h,false);
      if(i===index){g.fillStyle='#5ce6df';g.fillRect(x+slot*.25,y+h+11,slot*.5,5);}
    });
    type('Hosted by Poke-Collect',70,1886,25,550,'#9fadb9',760);
    return canvas;
  }
  function open(ctx, edition, input, wrapper) {
    const cards=input.map(c=>({name:c.name||c.title||'Card',number:c.number||'',set:c.set||c.setName||'',
      src:c.faceURL||(c.file?ctx.asset(c.file):ctx.artURL(c))}));
    if(!cards.length)return;
    ctx.modal('<h2>Share This Pull</h2><p class="cb-sub">Choose the Card to Feature in Your Image.</p>'+
      '<div class="cb-share-grid"><div class="cb-poster" data-poster aria-busy="true"></div><div><fieldset class="cb-picks"><legend>Featured Card</legend>'+
      cards.map((c,i)=>'<label><input type="radio" name="share-card" value="'+i+'" '+(i===0?'checked':'')+'><span>'+ctx.esc(c.name)+'</span></label>').join('')+
      '</fieldset><p data-export-note role="status">Preparing the Image…</p><div class="cb-actions"><button type="button" class="cb-primary" data-send hidden>Share Image</button><button type="button" class="cb-secondary" data-save disabled>Save PNG</button></div></div></div>');
    const dialog=ctx.dialog();dialog.classList.add('cb-share-dialog');dialog.setAttribute('aria-label','Share This Pull');
    const stage=dialog.querySelector('[data-poster]'),note=dialog.querySelector('[data-export-note]'),save=dialog.querySelector('[data-save]'),send=dialog.querySelector('[data-send]');
    let index=0,token=0,file=null,pictures=null;
    const fetchPictures=()=>Promise.all([Promise.all(cards.map(c=>photo(c.src))),photo(wrapper),photo(ctx.asset('brand-lockup.webp'))]);
    async function draw() {
      const id=++token;file=null;save.disabled=true;send.hidden=true;stage.setAttribute('aria-busy','true');
      try{
        const [faces,wrap,logo]=await pictures;
        if(!dialog.isConnected || id!==token)return;
        const canvas=poster({edition,cards,faces,wrap,logo,index});
        canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Share Image Featuring '+cards[index].name+' with '+cards.length+' pulls');stage.replaceChildren(canvas);
        const blob=await new Promise((ok,fail)=>canvas.toBlob(b=>b?ok(b):fail(Error('PNG Export Failed.')),'image/png'));
        if(!dialog.isConnected || id!==token)return;
        const slug=cards[index].name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase();
        file=new File([blob],'cardbit-'+slug+'-pull.png',{type:'image/png'});
        save.disabled=false;send.hidden=!(navigator.canShare && navigator.canShare({files:[file]}));
        const missing=faces.filter(im=>!im).length;
        note.textContent=missing?'Artwork Unavailable for '+missing+' of '+cards.length+'. The image includes their card details.':'1080 × 1920 PNG';
        if(missing){const retry=document.createElement('button');retry.type='button';retry.className='cb-textlink';retry.textContent='Retry Artwork';retry.onclick=()=>{note.textContent='Loading Artwork…';pictures=fetchPictures();draw();};note.append(' ',retry);}
      }catch{if(id===token)note.textContent='The Image Could Not Be Prepared. Close and Reopen to Try Again.';}
      finally{if(id===token)stage.setAttribute('aria-busy','false');}
    }
    dialog.addEventListener('change',e=>{if(e.target.name==='share-card'){index=Number(e.target.value);draw();}});
    save.onclick=()=>{if(!file)return;const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;dialog.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);};
    send.onclick=async()=>{if(!file)return;try{await navigator.share({files:[file],title:'My Cardbit Pull'});}catch(e){if(e.name!=='AbortError')note.textContent='Sharing Is Unavailable Here. Use Save PNG.';}};
    pictures=fetchPictures();draw();
  }
  root.CardbitSharePull=Object.freeze({open});
})(window);

