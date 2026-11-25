/* Cardbit's opening player only presents an already assigned, ordered set of copies. */
(() => {
  'use strict';
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const ease = v => { v = clamp(v); return v * v * (3 - 2 * v); };
  const step = (a, b, x) => ease((x - a) / (b - a));
  const hex = v => /^#[a-f\d]{6}$/i.test(v || '') ? v : '#627bfa';

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function tierFor(card) {
    const label = typeof card?.tier === 'string' ? card.tier.trim() : '';
    if (!label) return null;
    const tiers = window.CardbitLatchScene?.tiers || {};
    const name = Object.keys(tiers).find(key => key.toLowerCase() === label.toLowerCase());
    return name ? { name, ...tiers[name] } : { name: label };
  }

  const tierPaths = Object.freeze({
    Legendary:'M3 7l4.5 3L12 4l4.5 6L21 7l-2 10H5z M6 20h12',
    Epic:'M4 12l8-9 8 9-8 9z M8.5 12l3.5-4 3.5 4-3.5 4z',
    Rare:'M3 9l4-5h10l4 5-9 12z M3 9h18 M9 9l3 12 3-12',
    Uncommon:'M5 13l7-6 7 6 M5 18l7-6 7 6',
    Common:'M12 5l7 7-7 7-7-7z'
  });

  function tierSymbol(name) {
    if (!Object.hasOwn(tierPaths,name)) return '';
    const color = window.CardbitLatchScene?.tiers?.[name]?.color;
    const style = /^#[0-9a-f]{6}$/i.test(color || '') ? ' style="color:'+color+'"' : '';
    return '<svg class="cg-rank" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"'+style+'><path d="'+
      tierPaths[name]+'"/></svg>';
  }
  function tierBadgeHtml(card) {
    const tier = tierFor(card);
    if (!tier) return '';
    const text = tier.name.replace(/[&<>]/g,ch => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]));
    const style = /^#[a-f0-9]{6}$/i.test(tier.color || '') ? ' style="--cb-tier-color:'+tier.color+'"' : '';
    return '<span class="cb-tier-badge"'+style+'>'+tierSymbol(tier.name)+text+'</span>';
  }

  function tierBadge(card) {
    const html = tierBadgeHtml(card);
    if (!html) return null;
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content.firstElementChild;
  }

  function getUrl(value) {
    if (typeof value !== 'string' || !value) return '';
    try {
      const parsed = new URL(value, document.baseURI);
      return ['https:', 'http:', 'file:', 'blob:'].includes(parsed.protocol) ||
        /^data:image\/(png|jpeg|webp|avif);base64,/i.test(value) ? parsed.href : '';
    } catch { return ''; }
  }

  const symbols = {
    sound: '<path d="M4 9h4l5-4v14l-5-4H4zM16 9a5 5 0 0 1 0 6m2-9a9 9 0 0 1 0 12"/>',
    mute: '<path d="M4 9h4l5-4v14l-5-4H4zM17 10l4 4m0-4-4 4"/>',
    skip: '<path d="m5 6 9 6-9 6zM18 6v12"/>',
    motion: '<path d="M3 8h9M2 12h7m-5 4h5m5-9 7 5-7 5z"/>',
    next: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    replay: '<path d="M4 10a8 8 0 1 1 2 8M4 4v6h6"/>'
  };
  function button(label, action, style, symbol) {
    const b = make('button', style);
    b.type = 'button';
    if (symbol) {
      const icon = make('span', 'cbop-icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + symbols[symbol] + '</svg>';
      b.append(icon);
    }
    if(label)b.append(document.createTextNode(label));
    b.addEventListener('click', action);
    return b;
  }

  /* Each face owns its own UV map. The cap and body share a ragged cut line, so a
     partially opened wrapper stays joined on the uncut side of the packet. */
  const vertexShader = `
    attribute vec2 uv;
    attribute vec3 panelInfo;
    uniform vec2 fit;
    uniform vec3 angle;
    uniform vec2 opening;
    uniform float aspect;
    varying vec2 map;
    varying vec3 n;
    varying vec3 pos;
    varying float inside;
    vec3 rotate(vec3 q) {
      float a = angle.x, b = angle.y, c = angle.z;
      q.yz = mat2(cos(a),sin(a),-sin(a),cos(a)) * q.yz;
      q.xz = mat2(cos(b),-sin(b),sin(b),cos(b)) * q.xz;
      q.xy = mat2(cos(c),sin(c),-sin(c),cos(c)) * q.xy;
      return q;
    }
    void main() {
      float u=uv.x, t=uv.y, cut=panelInfo.z;
      float side=sin(3.14159265*u);
      float bump=max(0.,side)*min(smoothstep(.016,.13,t),1.-smoothstep(.87,.985,t));
      float front=1.-2.*panelInfo.y;
      float fold=sin(u*24.+t*8.)*.007+sin(u*52.-t*23.)*.003;
      vec3 p=vec3((u*2.-1.)*aspect,1.-2.*t,front*(.003+bump*(.079+fold)));
      vec3 normal=vec3((u-.5)*.37+cos(u*24.+t*8.)*.14*bump,(.48-t)*.13,front);
      float tear=opening.x, dir=opening.y;
      if (tear>0.) {
        float along=dir<0.?1.-u:u, edge=1.-smoothstep(cut,.46,t);
        float wave=smoothstep(.028+along*.35,.18+along*.35,tear);
        float drop=smoothstep(.54,1.,tear), fly=smoothstep(.46,.96,tear);
        if (panelInfo.x>.5) {
          float bend=(wave*(.48+.59*(1.-along))+fly*1.70)*front;
          float hinge=2.*(cut-t);
          p.y=1.-2.*cut+hinge*cos(bend)+wave*(1.-along)*.17+fly*(.75+along*.17);
          p.z+=sin(bend)*hinge+front*wave*.12*(1.-along)+fly*.17;
          p.x-=dir*(wave*(1.-along)*.075+fly*(.83+.28*(1.-along)));
          normal+=vec3(-dir*fly*.58,sin(bend),front*(cos(bend)-1.));
        } else {
          float wrinkle=sin(u*19.+tear*10.)*.038*edge*wave;
          float lip=front*edge*wave*(side*.22+.048);
          p+=vec3(dir*drop*(.32+(1.-t)*.27)+wrinkle,
            -wave*(1.-along)*.07*edge-drop*(1.1+(1.-t)*.92),
            lip+drop*(edge*.37+cos(t*8.)*.1)+wrinkle*front);
          normal+=vec3(wave*edge*cos(u*15.+tear*12.)*.5,-lip*2.3,0.);
        }
      }
      vec3 q=rotate(p);
      gl_Position=vec4(q.x*fit.x,q.y*fit.y,-q.z*.035,1.-q.z*.082);
      n=rotate(normal); map=uv; pos=q; inside=panelInfo.y;
    }`;
  const fragmentShader = `
    precision mediump float;
    uniform sampler2D panel;
    uniform float sheen;
    uniform float fade;
    varying vec2 map;
    varying vec3 n;
    varying vec3 pos;
    varying float inside;
    void main() {
      vec3 norm = normalize(n);
      bool metallic = inside > 0.5 || !gl_FrontFacing;
      if (!gl_FrontFacing) norm = -norm;
      vec3 l = normalize(vec3(sheen + .25,.8,1.55));
      vec3 h = normalize(l + vec3(0.,0.,1.));
      vec3 tex = texture2D(panel,map).rgb;
      float light = max(dot(norm,l),0.);
      float spec = pow(max(dot(norm,h),0.),27.);
      float strip = pow(max(1.-abs(norm.x*.60 + pos.x*.20 - sheen*.73 + norm.y*.3),0.),20.);
      float ribs = smoothstep(.83,.944,abs(map.y*2.-1.));
      float grain = sin(map.y*1220.)*.5+.5;
      vec3 rgb = metallic ? mix(vec3(.22,.25,.31),vec3(.76,.80,.87),light*.65+spec*.35) :
        tex*(.84+.17*light) + vec3(.62,.80,.99)*strip*.12 + vec3(.88,.93,1.)*spec*.08;
      rgb += vec3(.46,.53,.62) * ribs * grain * .045;
      gl_FragColor = vec4(rgb,fade);
    }`;

  function foilSurface(canvas, url, onReady, onLost) {
    let gl;
    try { gl = canvas.getContext('webgl', {alpha:true, antialias:true, premultipliedAlpha:false, powerPreference:'low-power'}); } catch {}
    if (!gl || !url) return null;
    const shaders = [], buffers = [];
    let program, texture, disposed = false, ready = false, lastW = 0, lastH = 0;
    function release() {
      disposed = true;
      canvas.removeEventListener('webglcontextlost', lost);
      if (gl.isContextLost()) return;
      buffers.forEach(buffer => gl.deleteBuffer(buffer));
      if (texture) gl.deleteTexture(texture);
      if (program) gl.deleteProgram(program);
      shaders.forEach(shader => gl.deleteShader(shader));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    function lost(e) { e.preventDefault(); ready = false; if (!disposed) onLost(); }
    canvas.addEventListener('webglcontextlost', lost, {once:true});
    function compile(type, source) {
      const s = gl.createShader(type);
      shaders.push(s); gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error('Foil Material Unavailable');
      return s;
    }
    try {
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER,vertexShader));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER,fragmentShader));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error('Foil Material Unavailable');
    } catch { release(); return null; }
    gl.useProgram(program);
    const xs = 48, bodyRows = 30, capRows = 8, points = [], indices = [];
    let nverts = 0, aspect = .55;
    const seam = u => .178 + Math.sin(u*19.4)*.007 + Math.sin(u*63.+.6)*.003 + Math.sin(u*183.)*.004;
    function addPanel(cap, back) {
      const offset = nverts, ys = cap ? capRows : bodyRows;
      for (let j=0;j<=ys;j++) {
        const v=j/ys;
        for (let i=0;i<=xs;i++) {
          const u=i/xs;
          const cut=seam(u);
          const t=cap ? v*cut : cut+v*(1-cut);
          points.push(u, t, Number(cap), Number(back), cut);
          nverts++;
        }
      }
      for (let j=0;j<ys;j++) for(let i=0;i<xs;i++){
        const a=offset+j*(xs+1)+i,b=a+1,c=a+xs+1,d=c+1;
        if (back) indices.push(a,b,c,b,d,c);
        else indices.push(a,c,b,b,c,d);
      }
    }
    addPanel(false,true); addPanel(true,true); addPanel(false,false); addPanel(true,false);
    // One immutable mesh. Each frame changes only the tear and lighting uniforms.
    const vertices=gl.createBuffer(), triangles=gl.createBuffer();
    buffers.push(vertices,triangles);
    gl.bindBuffer(gl.ARRAY_BUFFER,vertices); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points),gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,triangles); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
    function attr(name,size,offset) {
      const location=gl.getAttribLocation(program,name);
      if (location < 0) return;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location,size,gl.FLOAT,false,5*4,offset*4);
    }
    attr('uv',2,0); attr('panelInfo',3,2);
    const uniform = name=>gl.getUniformLocation(program,name);
    const fit=uniform('fit'),angle=uniform('angle'),sheen=uniform('sheen'),fade=uniform('fade');
    const openUniform=uniform('opening'), aspectUniform=uniform('aspect');
    texture=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.uniform1i(uniform('panel'),0);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    const image=new Image(); image.crossOrigin='anonymous';
    image.onload=()=>{
      if(disposed||gl.isContextLost()) return;
      try {
        gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
        aspect=image.naturalWidth/image.naturalHeight; ready=true; onReady();
      } catch { onLost(); }
    };
    image.src=url;
    function render({tear,direction,tiltX,tiltY,time,width,height,opacity}){
      if(!ready||disposed||gl.isContextLost()||width<=0||height<=0) return;
      const ratio=Math.min(window.devicePixelRatio||1,1.65);
      const w=Math.round(width*ratio),h=Math.round(height*ratio);
      if(w!==lastW||h!==lastH){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);lastW=w;lastH=h;}
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      if(opacity<.01)return;
      gl.uniform2f(openUniform,tear,direction);
      gl.uniform1f(aspectUniform,aspect);
      const scale=width<650?.77:.81;
      gl.uniform2f(fit,scale*height/width,scale);
      gl.uniform3f(angle,-.045+tiltY*.13,-.10+tiltX*.28, .042+Math.sin(time*.65)*.009-tiltX*.028);
      gl.uniform1f(sheen,-.06+tiltX*.79+Math.sin(time*.9)*.35+tear*.5);
      gl.uniform1f(fade,opacity);
      gl.drawElements(gl.TRIANGLES,indices.length,gl.UNSIGNED_SHORT,0);
    }
    return {render,destroy:release};
  }

  function openingAudio(asset) {
    const names = ['foil', 'card', 'card-alt', 'settle'];
    const clips = new Map();
    const elements = new Map();
    const active = new Set();
    let context, resumed, disposed = false, unlocked = false, sequence = 0;
    let enabled = window.CardbitMedia?.soundChoice() !== 'off';
    const url = name => asset('sfx-' + name + '.wav');

    function preload() {
      if (disposed || !enabled || clips.size || elements.size || typeof window.Audio !== 'function') return;
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      let decoder;
      try { if (Offline) decoder = new Offline(1, 1, 44100); } catch {}
      for (const name of names) {
        const src = url(name);
        const element = new window.Audio();
        elements.set(name, element);
        // The media element also works when a browser disallows fetch on local files.
        element.preload = 'none';
        element.src = src;
        if (decoder && src && (location.protocol !== 'file:' || src.startsWith('data:'))) {
          clips.set(name, fetch(src).then(response => {
            if (!response.ok) throw Error('Audio Unavailable');
            return response.arrayBuffer();
          }).then(bytes => decoder.decodeAudioData(bytes)).catch(() => null));
        }
      }
    }
    function unlock() {
      if (!enabled || disposed) return;
      unlocked = true;
      preload();
      const AudioEngine = window.AudioContext || window.webkitAudioContext;
      try {
        if (!context && AudioEngine && clips.size) context = new AudioEngine({latencyHint:'interactive'});
        if (context && context.state !== 'running') resumed = context.resume().catch(() => {});
      } catch {}
    }
    function stop() {
      sequence++;
      for (const source of active) { try { source.stop(); } catch {} }
      active.clear();
      for (const element of elements.values()) element.pause();
    }
    function playElement(name, rate) {
      const el = elements.get(name);
      if (!el) return;
      el.currentTime = 0; el.playbackRate = rate;
      el.play().catch(() => {});
    }
    function play(name, index = 0) {
      if (!enabled || !unlocked || disposed || document.hidden) return;
      const rate = name === 'card' ? [1, 1.045, .985, 1.025, .97][index % 5] : 1;
      if (name === 'card' && index % 2 === 1) name = 'card-alt';
      if (!context || !clips.has(name)) { playElement(name, rate); return; }
      const token = sequence, requested = performance.now();
      Promise.all([clips.get(name), resumed]).then(([buffer]) => {
        if (disposed || token !== sequence || !enabled || document.hidden || performance.now()-requested > 350) return;
        if (!buffer || context.state !== 'running') { playElement(name, rate); return; }
        const source = context.createBufferSource();
        source.buffer = buffer; source.playbackRate.value = rate;
        source.connect(context.destination); active.add(source);
        source.onended = () => { active.delete(source); source.disconnect(); };
        source.start();
      });
    }
    preload();
    return {
      get enabled() { return enabled; },
      unlock, play, stop,
      set(on) {
        enabled = on; window.CardbitMedia?.setSound(on);
        if (on) { unlock(); play('card'); } else stop();
      },
      destroy() {
        disposed = true; stop(); context?.close().catch(() => {});
        for (const el of elements.values()) { el.removeAttribute('src'); el.load(); }
        clips.clear(); elements.clear();
      }
    };
  }

  const mounted=new WeakMap();
  function mount(root,options){
    mounted.get(root)?.destroy();
    if(options.edition?.presentation !== 'storefront' && window.CardbitLatchOpening?.recognized(options.edition)){
      const player=window.CardbitLatchOpening.mount(root,{...options,controls:false,sample:false,demo:options.sample===true || options.demo===true});
      mounted.set(root,player);
      return player;
    }
    const cards=Array.from(options.cards||[],card=>({...card})), edition=options.edition||{};
    const openingLabel=options.sample?'Demo — No Purchase':'Pack Opening';
    const demoNotice=options.demo===true?'No purchase required.':'';
    const player=make('section','cbop');root.replaceChildren(player);
    const color=hex(edition.color);
    player.style.setProperty('--cbop-accent',color);
    const asset=options.asset||((name)=>window.cardbitAssets?.[name]||'assets/'+name);
    const wrap=getUrl(edition.image||asset((edition.id||'cobalt')+'.webp'));
    const name=String(edition.name||'Cardbit');
    const finishLabel=options.finishLabel||'View My Binder';
    const mq=window.matchMedia('(prefers-reduced-motion: reduce)');
    const sound=openingAudio(asset);
    let idx=-1, mode='sealed', phaseStart=0, flipEnds=0, startTear=0, destroyed=false;
    let advanceTimer=0, hitBounds=null, displayedRip=0, previousTilt='';
    let foil=null, ro=null, frame=0, start=performance.now(), lastTime=start;
    let desiredX=0,desiredY=0,tx=0,ty=0,rip=0,direction=1,drag=null,preventClick=false;
    let width=0,height=0, stage,scene,stack,packet,screen,faceNodes=[],thumbNodes=[],track;
    let ctxReady=false, primary,pass, status, instruction,heading,soundBtn,jump,motionBtn,lowMotion=false;
    let sceneToken=0, intro=null;
    let effectCanvas, effectContext, effectTier, effectStart=0;
    const introSlug=edition.presentation==='storefront' && edition.slug;
    const localEvents=new AbortController();
    function closeIntro(){
      if(!intro)return;
      intro.destroy();
      intro=null;
    }
    function beginOpening(focus=false){
      closeIntro();
      if(!introSlug || !window.CardbitLatchOpening?.recognized(introSlug)){
        showStage(focus);
        if(focus)primary?.focus({preventScroll:true});
        return;
      }
      mode='intro';
      player.dataset.mode=mode;
      intro=window.CardbitLatchOpening.mount(player,{
        edition:introSlug,asset,cards,controls:false,demo:options.sample===true || options.demo===true,autoStart:true,reducedMotion:lowMotion,
        onRevealFirst(state){
          closeIntro();
          lowMotion=state.reducedMotion && !mq.matches;
          if(sound.enabled!==state.soundOn)sound.set(state.soundOn);
          showStage(false,true);
          primary?.focus({preventScroll:true});
        }
      });
      if(focus)player.querySelector('.lo-toolbar button')?.focus({preventScroll:true});
    }
    function destroyFoil(){if(foil){foil.destroy();foil=null;}ctxReady=false;}
    function destroy(){
      if(destroyed)return;destroyed=true;closeIntro();cancelAnimationFrame(frame);frame=0;

      clearTimeout(advanceTimer);clearTimeout(bitsTimer);chime?.destroy();destroyFoil();ro?.disconnect();sound.destroy();localEvents.abort();
      mq.removeEventListener?.('change',motionChanged);
      if(mounted.get(root)===api)mounted.delete(root);
    }
    function label(card){return String(card?.name||card?.title||'Card');}
    function back(card) {
      const design=window.CardbitMedia?.backFor(card);
      const node=make('span','cbop-back');
      node.setAttribute('aria-hidden','true');
      const url=design && getUrl(design.url || asset(design.file));
      if (url) {
        const picture=make('img');
        picture.alt=''; picture.draggable=false; picture.decoding='async';
        picture.addEventListener('error',()=>picture.remove(),{once:true});
        picture.src=url; node.append(picture);
      }
      return node;
    }
    function face(card) {
      const f=make('span','cbop-face');f.setAttribute('aria-hidden','true');
      const fallback=make('span','cbop-art-fallback',label(card));
      const detail=make('small','',String(card?.number||card?.set||'Artwork Unavailable'));
      fallback.append(detail); f.append(fallback);
      const url=getUrl(card?.image||card?.imageUrl||card?.art||card?.img);
      if(url){
        const im=make('img');im.alt='';im.draggable=false;im.decoding='async';im.src=url;
        im.addEventListener('error',()=>im.remove(),{once:true});f.append(im);
      }
      return f;
    }
    function clearTierEffect() {
      effectTier = null;
      if (effectCanvas) effectCanvas.remove();
    }
    function startTierEffect(holder, tier) {
      clearTierEffect();
      if (!tier?.length || mq.matches || lowMotion || !window.CardbitLatchScene?.tierEffect) return;
      if (!effectCanvas) {
        effectCanvas = make('canvas', 'cbop-tier-effect');
        effectCanvas.setAttribute('aria-hidden', 'true');
        try { effectContext = effectCanvas.getContext('2d'); } catch { /* Labels still work without canvas. */ }
      }
      if (!effectContext) return;
      effectTier = tier;
      // Light hits as the existing CSS flip turns the front toward the viewer.
      effectStart = performance.now() + 265;
      holder.append(effectCanvas);
      effectContext.clearRect(0, 0, effectCanvas.width, effectCanvas.height);
    }
    function paintTierEffect(now) {
      if (!effectTier) return false;
      const time = (now - effectStart) / 1000;
      if (time < 0) return true;
      if (time >= effectTier.length) { clearTierEffect(); return false; }
      const w = stack.offsetWidth, h = stack.offsetHeight;
      if (!w || !h) return true;
      const width = w * 3, height = h * 2, scale = Math.min(window.devicePixelRatio || 1, 2);
      const pixelsX = Math.round(width * scale), pixelsY = Math.round(height * scale);
      if (effectCanvas.width !== pixelsX || effectCanvas.height !== pixelsY) {
        effectCanvas.width = pixelsX;
        effectCanvas.height = pixelsY;
      }
      const g = effectContext;
      g.save();
      g.setTransform(pixelsX / width, 0, 0, pixelsY / height, 0, 0);
      g.clearRect(0, 0, width, height);
      // The effect follows the tilting card. Keep the printing clear and light its rim.
      g.beginPath();
      g.rect(0, 0, width, height);
      if (g.roundRect) g.roundRect(w + 2, h / 2 + 2, w - 4, h - 4, w * .045);
      else g.rect(w + 2, h / 2 + 2, w - 4, h - 4);
      g.clip('evenodd');
      window.CardbitLatchScene.tierEffect(g, { x: width / 2, y: height / 2, w, h }, effectTier.name, time);
      g.restore();
      return true;
    }
    function showStage(manualReplay=false,afterIntro=false){
      clearTierEffect();
      sceneToken++;destroyFoil();ro?.disconnect();
      clearTimeout(advanceTimer);advanceTimer=0;displayedRip=0;previousTilt='';hitBounds=null;
      mode='sealed';idx=-1;rip=0;direction=1;drag=null;preventClick=false;phaseStart=0;start=performance.now();lastTime=start;flipEnds=0;
      tx=ty=desiredX=desiredY=0;cancelAnimationFrame(frame);frame=0;
      const token=sceneToken;
      player.dataset.mode=mode;player.replaceChildren();
      const head=make('header','cbop-head');
      const hbox=make('div','cbop-title');
      hbox.append(make('span','cbop-kicker',openingLabel));
      if(demoNotice)hbox.append(make('small','lo-demo',demoNotice));
      heading=make('h2','',name+' Opening');hbox.append(heading);
      const util=make('div','cbop-util');
      soundBtn=button(sound.enabled?'Sound on':'Sound Off',toggleSound,'cbop-utility',sound.enabled?'sound':'mute');
      soundBtn.setAttribute('aria-pressed',String(sound.enabled));soundBtn.classList.add('cbop-sound');
      motionBtn=button('',toggleMotion,'cbop-utility cbop-motion','motion');
      motionBtn.setAttribute('aria-label','Reduce Motion');motionBtn.setAttribute('aria-pressed',String(lowMotion||mq.matches));
      motionBtn.title='Reduce Motion';motionBtn.hidden=mq.matches;
      player.classList.toggle('cbop-still',lowMotion||mq.matches);
      pass=button('Skip',()=>spread(true),'cbop-utility','skip');
      pass.setAttribute('aria-label','Skip Animation');
      jump=button('Final Card',holdFinal,'cbop-utility');jump.setAttribute('aria-label','Jump to Final Card');jump.hidden=true;util.append(soundBtn,motionBtn,jump,pass);head.append(hbox,util);
      stage=make('div','cbop-stage');
      const ambient=make('div','cbop-ambience');ambient.setAttribute('aria-hidden','true');
      ambient.append(make('i','cbop-glow'),make('i','cbop-floor'),make('i','cbop-shadow'));
      stage.append(ambient);
      scene=make('div','cbop-scene');
      stack=make('div','cbop-stack');stack.setAttribute('aria-hidden','true');
      faceNodes=cards.map((card,i)=>{
        const holder=make('div','cbop-card');holder.style.setProperty('--slot',i);
        const turn=make('div','cbop-turn');
        turn.append(back(card),face(card));holder.append(turn);stack.append(holder);
        return holder;
      });
      packet=make('div','cbop-packet');
      const fallback=make('div','cbop-packet-fallback');
      if(wrap)fallback.style.setProperty('--foil-image','url("'+wrap.replaceAll('"','%22')+'")');
      fallback.append(make('i','cbop-fallback-base'),make('i','cbop-fallback-cap'),make('i','cbop-cut-light'));packet.append(fallback);
      const canvas=make('canvas','cbop-foil');canvas.setAttribute('aria-hidden','true');
      packet.append(canvas);
      const flecks=make('div','cbop-flecks');
      for(let i=0;i<10;i++){
        const fl=make('i');
        fl.style.setProperty('--fx',(-1+(i/9)*2).toFixed(2));
        fl.style.setProperty('--fy',(-.13-(i*7%9)/8).toFixed(2));
        fl.style.setProperty('--fr',(-90+i*53)+'deg');
        fl.style.setProperty('--fd',(i%4*35)+'ms');
        flecks.append(fl);
      }
      scene.append(stack,packet,flecks);
      screen=make('button','cbop-hit');screen.type='button';screen.setAttribute('aria-label','Tear Open the '+name+' wrapper');
      scene.append(screen);stage.append(scene);
      const footer=make('div','cbop-console');
      const info=make('div','cbop-info');
      info.setAttribute('aria-live','polite');info.setAttribute('aria-atomic','true');
      status=make('span','cbop-counter',options.sample?'Demo Opening':'Sealed Pack');
      instruction=make('strong','cbop-instruction','Pull the Foil to Open');
      const sub=make('span','cbop-hint','Drag Across the Wrapper or Press Open Pack.');
      info.append(status,instruction,sub);
      primary=button('Open Pack',activate,'cbop-primary','next');
      footer.append(info,primary);
      track=make('ol','cbop-track');
      track.setAttribute('aria-label','Reveal Progress');
      thumbNodes=cards.map((card,i)=>{const item=make('li');item.setAttribute('aria-label','Card '+(i+1)+' sealed');item.append(back(card),face(card)); track.append(item);return item;});
      player.append(head,stage,footer,track);
      screen.addEventListener('pointerdown',pointerDown);
      screen.addEventListener('pointerenter',()=>{hitBounds=screen.getBoundingClientRect();});
      screen.addEventListener('pointermove',pointerMove);
      screen.addEventListener('pointerup',pointerUp);
      screen.addEventListener('pointercancel',cancelDrag);
      screen.addEventListener('pointerleave',()=>{if(!drag){desiredX=desiredY=0;request();}});
      screen.addEventListener('click',e=>{if(preventClick){preventClick=false;return;}activate(e);});
      screen.addEventListener('keydown',e=>{
        if(e.key==='ArrowRight'&&mode==='cards'){e.preventDefault();advance();}
        if(e.key==='ArrowLeft'&&mode==='cards'&&idx>0){e.preventDefault();reveal(idx-1);}
      });
      function measure(){
        if(!stage.isConnected)return;
        const bounds=scene.getBoundingClientRect();width=bounds.width;height=bounds.height;hitBounds=null;
        request();
      }
      if(window.ResizeObserver){ro=new ResizeObserver(measure);ro.observe(scene);}
      measure();
      if(afterIntro){reveal(0);return;}
      if(!mq.matches&&!lowMotion)foil=foilSurface(canvas,wrap,()=>{
        if(token!==sceneToken||destroyed)return;
        ctxReady=true;packet.classList.add('cbop-has-gl');request();
      },()=>{
        if(token!==sceneToken||destroyed)return;
        ctxReady=false;packet.classList.remove('cbop-has-gl');
      });
      if(mq.matches){if(manualReplay)reveal(0);else spread(false);}else if(lowMotion)reveal(0);else request();
    }
    function toggleMotion(){
      lowMotion=!lowMotion;player.classList.toggle('cbop-still',lowMotion);
      motionBtn.setAttribute('aria-pressed',String(lowMotion));motionBtn.title=lowMotion?'Use Full Motion':'Reduce Motion';
      if(lowMotion){
        clearTierEffect();
        clearTimeout(advanceTimer);advanceTimer=0;flipEnds=0;
        cancelAnimationFrame(frame);frame=0;desiredX=desiredY=tx=ty=0;
        scene.style.setProperty('--tx','0');scene.style.setProperty('--ty','0');
        if(mode==='sealed'||mode==='tearing'){destroyFoil();reveal(0);}
      }
    }
    function request(){
      if(!frame&&!destroyed&&!lowMotion&&!mq.matches&&mode!=='spread'&&document.visibilityState!=='hidden')frame=requestAnimationFrame(update);
    }
    function update(now){
      frame=0;if(destroyed||mode==='spread'||!player.isConnected)return;
      const delta=clamp((now-lastTime)/16.67,.2,3);lastTime=now;
      const beta=1-Math.pow(.77,delta);
      tx+=(desiredX-tx)*beta;ty+=(desiredY-ty)*beta;
      displayedRip+=(rip-displayedRip)*(drag ? 1 : beta);
      let tearValue=displayedRip,opacity=1;
      if(mode==='tearing'){
        const t=clamp((now-phaseStart)/(1420-startTear*620));
        const travel=.075*step(0,.15,t)+.925*step(.12,.97,t);
        tearValue=startTear+(1-startTear)*travel;
        opacity=1-step(.78,.98,tearValue);
        stack.style.setProperty('--extract',step(.30,.88,tearValue).toFixed(3));
        if(t>=1){reveal(0);return;}
      }
      if(mode==='sealed'||mode==='tearing'){
        if(ctxReady)foil?.render({tear:tearValue,direction,tiltX:tx,tiltY:ty,time:Math.min((now-start)/1000,4.6),width,height,opacity});
        if(!ctxReady){
          packet.style.setProperty('--rip',tearValue.toFixed(3));
          packet.style.setProperty('--fly',step(.42,.96,tearValue).toFixed(3));
          packet.style.setProperty('--open',step(.01,.46,tearValue).toFixed(3));
          packet.style.setProperty('--dir',direction);
          packet.style.setProperty('--foil-opacity',opacity.toFixed(3));
        }
      }
      const x=tx.toFixed(3), y=ty.toFixed(3);
      if(previousTilt!==x+','+y){
        previousTilt=x+','+y;scene.style.setProperty('--tx',x);scene.style.setProperty('--ty',y);
      }
      const animatingTier = paintTierEffect(now);
      if(animatingTier||mode==='tearing'||(mode==='sealed'&&(now-start<4800||Math.abs(displayedRip-rip)>.001))||Math.abs(desiredX-tx)+Math.abs(desiredY-ty)>.004)request();
    }
    function pointerDown(e){
      if(e.button!==0||mode==='tearing')return;
      sound.unlock();
      if(mode==='sealed'){
        hitBounds=screen.getBoundingClientRect();
        drag={id:e.pointerId,x:e.clientX,y:e.clientY};
        screen.setPointerCapture?.(e.pointerId);
        player.classList.add('cbop-grasp');
      }
    }
    function pointerMove(e){
      if(mode==='tearing'||mode==='spread'||lowMotion||mq.matches)return;
      const b=hitBounds || (hitBounds=screen.getBoundingClientRect());
      desiredX=clamp((e.clientX-b.left)/Math.max(1,b.width),0,1)*2-1;
      desiredY=clamp((e.clientY-b.top)/Math.max(1,b.height),0,1)*2-1;
      if(drag&&drag.id===e.pointerId){
        const distance=e.clientX-drag.x;
        if(Math.abs(distance)>4)direction=distance<0?-1:1;
        const length=Math.max(0,Math.abs(distance)-4);
        const amount=clamp(length/Math.min(110,b.width*.32));
        rip=amount*.38;
        if(amount>.96){preventClick=true;beginTear();}
      }
      request();
    }
    function cancelDrag(){
      drag=null;player.classList.remove('cbop-grasp');rip=0;
      desiredX=desiredY=0;request();
    }
    function pointerUp(e){
      if(!drag||e.pointerId!==drag.id)return;
      if(rip>.10){preventClick=true;beginTear();}else cancelDrag();
    }
    function beginTear(){
      if(mode!=='sealed')return;
      if(mq.matches||lowMotion){reveal(0);return;}
      mode='tearing';startTear=rip;drag=null;player.classList.remove('cbop-grasp');
      player.dataset.mode=mode;phaseStart=performance.now();sound.unlock();sound.play('foil');
      primary.setAttribute('aria-disabled','true');screen.setAttribute('aria-label','Opening the Wrapper');
      status.textContent='Opening Seal';instruction.textContent='Breaking the Crimp';
      player.querySelector('.cbop-hint').textContent='Your Cards Are Ready Inside.';
      desiredX=-.23;desiredY=.22;request();
    }
    function activate(){
      sound.unlock();
      if(mode==='sealed')beginTear();else if(mode==='last')reveal(cards.length-1);else if(mode==='cards')advance();
    }
    function advance(){
      sound.unlock();
      const remaining=flipEnds-performance.now();
      if(remaining>0){
        if(!advanceTimer)advanceTimer=setTimeout(()=>{advanceTimer=0;if(mode==='cards')advance();},Math.ceil(remaining));
        return;
      }
      if(idx===cards.length-1){spread(true);sound.play('settle');}
      else if(idx===cards.length-2){holdFinal();}
      else reveal(idx+1);
    }
    function holdFinal(){
      if(mode!=='cards'||idx>=cards.length-1)return;
      clearTierEffect();
      clearTimeout(advanceTimer);advanceTimer=0;
      idx=cards.length-1;mode='last';player.dataset.mode=mode;jump.hidden=true;
      faceNodes.forEach((node,j)=>{node.dataset.place=j===idx?'waiting':'aside';});
      thumbNodes.forEach((node,j)=>{node.dataset.state=j<idx?'seen':'waiting';node.setAttribute('aria-label','Card '+(j+1)+(j<idx?' Revealed, '+label(cards[j]):' sealed'));});
      status.textContent='Card '+cards.length+' of '+cards.length;
      instruction.textContent='Your Final Card';
      player.querySelector('.cbop-hint').textContent='Turn It Over When You’re Ready.';
      primary.replaceChildren(document.createTextNode('Turn Final Card'));primary.focus({preventScroll:true});
      screen.setAttribute('aria-label','Turn Final Card');request();
    }
    function reveal(i){
      if(mode==='spread'||destroyed)return;
      clearTimeout(advanceTimer);advanceTimer=0;
      mode='cards';idx=i;player.dataset.mode=mode;drag=null;desiredX=desiredY=0;
      stack.style.setProperty('--extract','1');
      faceNodes.forEach((node,j)=>{
        node.dataset.place=j<i?'aside':j===i?'front':'stack';
        node.style.setProperty('--depth',Math.max(0,j-i));
      });
      jump.hidden=i>=cards.length-2;
      thumbNodes.forEach((node,j)=>{
        node.dataset.state=j<i?'seen':j===i?'active':'waiting';
        node.setAttribute('aria-label','Card '+(j+1)+(j<=i?' Revealed, '+label(cards[j]):' sealed'));
      });
      const card=cards[i];
      status.textContent='Card '+(i+1)+' of '+cards.length;
      const badge=tierBadge(card);
      if(badge)status.append(' · ',badge);
      instruction.textContent=label(card);
      showBits(faceNodes[i],card);
      startTierEffect(faceNodes[i],tierFor(card));
      try{window.dispatchEvent(new CustomEvent('cardbit:card-revealed',{detail:{tier:card?.tier||'',host:faceNodes[i]?.closest('.cbop-stage, .cbop')||player}}));}catch{}
      player.querySelector('.cbop-hint').textContent=[card?.set,card?.number,card?.printing].filter(Boolean).join(' · ')||'Move Across the Card to Inspect It.';
      primary.replaceChildren(document.createTextNode(i+1===cards.length?(cards.length===1?'View Card':'View All Cards'):i+2===cards.length?'Show Final Card':'Reveal Next Card'));
      primary.removeAttribute('aria-disabled');screen.setAttribute('aria-label',primary.textContent);
      flipEnds=performance.now()+(mq.matches||lowMotion?0:330);
      sound.play('card',i);request();
    }
    // The card's Cardbits value lands on the card itself, with its own chime.
    let bitsTimer=0,chime=null;
    function cardbitsFor(card){
      return Number.isSafeInteger(card?.buybackBits)&&card.buybackBits>0?card.buybackBits:
        Number.isSafeInteger(card?.cardbitValue)&&card.cardbitValue>0?card.cardbitValue:null;
    }
    function playChime(){
      if(!sound.enabled||!window.CardbitLatchSound)return;
      try{chime=chime||window.CardbitLatchSound.sound();chime.set(true);chime.play('coins');}catch{}
    }
    function showBits(node,card){
      clearTimeout(bitsTimer);bitsTimer=0;
      player.querySelectorAll('.cbop-bits').forEach(b=>b.remove());
      const value=cardbitsFor(card);
      if(!value||!node)return;
      const badge=make('span','cbop-bits');badge.setAttribute('aria-hidden','true');
      if(window.cardbitValueIcon){const im=make('img');im.alt='';im.src=window.cardbitValueIcon;badge.append(im);}
      badge.append(make('strong','',value.toLocaleString('en-US')),make('small','','Cardbits'));
      node.append(badge);
      status.append(' · '+value.toLocaleString('en-US')+' Cardbits');
      if(mq.matches||lowMotion){badge.classList.add('is-in','is-still');return;}
      bitsTimer=setTimeout(()=>{badge.classList.add('is-in');playChime();},520);
    }
    function toggleSound(){
      if(!soundBtn)return;
      sound.set(!sound.enabled);
      const replacement=button(sound.enabled?'Sound on':'Sound Off',toggleSound,'cbop-utility',sound.enabled?'sound':'mute');
      replacement.setAttribute('aria-pressed',String(sound.enabled));replacement.classList.add('cbop-sound');
      const focus=document.activeElement===soundBtn;soundBtn.replaceWith(replacement);soundBtn=replacement;
      if(focus)replacement.focus({preventScroll:true});
    }
    function spread(moveFocus){
      if(mode==='spread'||destroyed)return;
      clearTierEffect();
      clearTimeout(advanceTimer);advanceTimer=0;sound.stop();
      closeIntro();
      mode='spread';sceneToken++;drag=null;cancelAnimationFrame(frame);frame=0;destroyFoil();ro?.disconnect();
      player.dataset.mode=mode;player.replaceChildren();
      const head=make('header','cbop-head');const title=make('div','cbop-title');
      title.append(make('span','cbop-kicker',openingLabel));
      if(demoNotice)title.append(make('small','lo-demo',demoNotice));
      const heading=make('h2','',name+' Pulls');heading.tabIndex=-1;title.append(heading);
      const replayBtn=button('Replay Opening',()=>replay(true),'cbop-utility','replay');
      head.append(title,replayBtn);player.append(head);
      const list=make('ol','cbop-results');list.setAttribute('aria-label','Cards in Reveal Order');
      cards.forEach((card,i)=>{
        const li=make('li','cbop-result');
        const wrapper=make(options.onInspect?'button':'div','cbop-result-card');
        if(options.onInspect){wrapper.type='button';wrapper.addEventListener('click',()=>options.onInspect(card,i));}
        wrapper.append(face(card),make('strong','',label(card)));
        const badge=tierBadge(card);
        if(badge)wrapper.append(badge);
        const value=cardbitsFor(card);
        if(value&&window.CardbitValueView)wrapper.append(window.CardbitValueView.badge(value,'Cardbits'));
        const details=[card.set,card.number].filter(Boolean).join(' · ');
        if(details)wrapper.append(make('small','',details));
        li.append(wrapper);list.append(li);
      });
      /* SITE */ if(typeof options.onSpread==='function'){const extra=options.onSpread();if(extra)player.append(extra);}
      player.append(list);
      const actions=make('div','cbop-result-actions');
      if(typeof options.onShare==='function')actions.append(button('Share This Pull',options.onShare,'cbop-utility'));
      if(typeof options.onFinish==='function')actions.append(button(finishLabel,()=>options.onFinish(),'cbop-primary','next'));
      player.append(actions);
      if(moveFocus)heading.focus({preventScroll:true});
    }
    function replay(focus=false){
      if(destroyed)return;
      beginOpening(focus);
    }
    function motionChanged(e){if(e.matches&&mode!=='spread'&&mode!=='intro')spread(true);}
    const api={destroy,skip:()=>mode==='intro'&&intro?intro.skip():spread(true),replay:()=>replay(true)};
    mounted.set(root,api);
    if(!cards.length){
      player.append(make('h2','','Opening Unavailable'),make('p','','Your Saved Result Could Not Be Loaded.'));
      if(options.onFinish)player.append(button(finishLabel,options.onFinish,'cbop-primary'));
      return api;
    }
    beginOpening();
    mq.addEventListener?.('change',motionChanged);
    window.addEventListener('scroll',()=>{hitBounds=null;},{passive:true,capture:true,signal:localEvents.signal});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')request();else sound.stop();},{signal:localEvents.signal});
    return api;
  }
  window.CardbitOpening=Object.freeze({mount,tierFor,tierBadge,tierBadgeHtml,tierSymbol});
})();

