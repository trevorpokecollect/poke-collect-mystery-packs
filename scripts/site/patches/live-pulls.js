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
