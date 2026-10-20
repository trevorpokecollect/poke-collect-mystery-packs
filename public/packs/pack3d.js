// 3D pack opening (WebGL with three.js), in the style of Pokémon TCG Pocket: a lit, glossy foil
// pack that floats and tilts, a glowing cut traced across the top with a finger, then a burst of
// light as the top flies off and the card rises out. opener.js drives it through window.PCPack3D
// and falls back to its CSS pack when WebGL or this file isn't available.
(function () {
  "use strict";
  var T = window.THREE;
  if (!T) return;

  var PX = 100; // CSS pixels per world unit at the card's depth, so the scene lines up with the page

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(k) { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); }
  function easeOut(k) { k = clamp(k, 0, 1); return 1 - Math.pow(1 - k, 3); }
  function easeIn(k) { k = clamp(k, 0, 1); return k * k * k; }
  function easeInOut(k) { k = clamp(k, 0, 1); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }

  // Images for WebGL must load with CORS. If the page already loaded the same URL without CORS, the
  // browser may hand back that cached copy and refuse it, so a failure retries with a fresh URL.
  function loadImage(url) {
    return loadOnce(url).catch(function () {
      return loadOnce(url + (url.indexOf("?") === -1 ? "?" : "&") + "pc3d=1");
    });
  }
  function loadOnce(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      var timer = setTimeout(function () { reject(new Error("Image timed out")); }, 8000);
      img.onload = function () { clearTimeout(timer); resolve(img); };
      img.onerror = function () { clearTimeout(timer); reject(new Error("Image failed")); };
      img.src = url;
    });
  }

  function canvas(w, h) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }
  // Rounded rectangle with separate x and y corner radii (the pack's and card's corner shape).
  function rounded(ctx, w, h, rx, ry) {
    ctx.beginPath();
    ctx.moveTo(rx, 0);
    ctx.lineTo(w - rx, 0);
    ctx.quadraticCurveTo(w, 0, w, ry);
    ctx.lineTo(w, h - ry);
    ctx.quadraticCurveTo(w, h, w - rx, h);
    ctx.lineTo(rx, h);
    ctx.quadraticCurveTo(0, h, 0, h - ry);
    ctx.lineTo(0, ry);
    ctx.quadraticCurveTo(0, 0, rx, 0);
    ctx.closePath();
  }
  function texture(c) {
    var t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }

  // The pack bag cut out of the square product art, with rounded corners.
  function packTexture(img, art, aspect) {
    var h = 1024, w = Math.round(h * aspect);
    var c = canvas(w, h), ctx = c.getContext("2d");
    rounded(ctx, w, h, w * 0.06, h * 0.034);
    ctx.clip();
    if (img) {
      var iw = img.naturalWidth, ih = img.naturalHeight;
      ctx.drawImage(img, art.left * iw, art.top * ih, art.width * iw, art.height * ih, 0, 0, w, h);
    } else {
      var g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#2a0f4f"); g.addColorStop(0.5, "#120a2e"); g.addColorStop(1, "#3b0d1c");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    return texture(c);
  }

  function cardTexture(img, title) {
    var w = 500, h = 700;
    var c = canvas(w, h), ctx = c.getContext("2d");
    rounded(ctx, w, h, w * 0.045, h * 0.032);
    ctx.clip();
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    if (img) {
      // Same as the page's card: the whole image fitted inside the card.
      var s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      var dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = "#14141a"; ctx.font = "700 36px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(title || "", w / 2, h / 2, w - 40);
    }
    return texture(c);
  }

  // Soft round glow, for the light point, sparks and the burst.
  function glowTexture() {
    var c = canvas(128, 128), ctx = c.getContext("2d");
    var g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.2, "rgba(255,255,255,.85)");
    g.addColorStop(0.45, "rgba(255,255,255,.25)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    return texture(c);
  }
  // The cut line: a white-hot core in a red glow.
  function lineTexture() {
    var c = canvas(8, 64), ctx = c.getContext("2d");
    var g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, "rgba(255,45,85,0)");
    g.addColorStop(0.3, "rgba(255,45,85,.35)");
    g.addColorStop(0.44, "rgba(255,90,120,.9)");
    g.addColorStop(0.5, "rgba(255,240,245,1)");
    g.addColorStop(0.56, "rgba(255,90,120,.9)");
    g.addColorStop(0.7, "rgba(255,45,85,.35)");
    g.addColorStop(1, "rgba(255,45,85,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 8, 64);
    return texture(c);
  }
  // A light beam: bright at its base, fading upward and to its sides.
  function beamTexture() {
    var c = canvas(64, 256), ctx = c.getContext("2d");
    var gx = ctx.createLinearGradient(0, 0, 64, 0);
    gx.addColorStop(0, "rgba(255,255,255,0)");
    gx.addColorStop(0.5, "rgba(255,255,255,1)");
    gx.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gx; ctx.fillRect(0, 0, 64, 256);
    ctx.globalCompositeOperation = "destination-in";
    var gy = ctx.createLinearGradient(0, 0, 0, 256);
    gy.addColorStop(0, "rgba(0,0,0,0)");
    gy.addColorStop(0.6, "rgba(0,0,0,.55)");
    gy.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = gy; ctx.fillRect(0, 0, 64, 256);
    return texture(c);
  }
  function dashTexture() {
    var c = canvas(256, 8), ctx = c.getContext("2d");
    ctx.fillStyle = "rgba(255,255,255,.9)";
    for (var x = 0; x < 256; x += 16) ctx.fillRect(x, 2, 9, 4);
    return texture(c);
  }
  function shadowTexture() {
    var c = canvas(128, 64), ctx = c.getContext("2d");
    var g = ctx.createRadialGradient(64, 32, 0, 64, 32, 64);
    g.addColorStop(0, "rgba(0,0,0,.75)");
    g.addColorStop(0.6, "rgba(0,0,0,.25)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save(); ctx.scale(1, 0.5); ctx.translate(0, 32); ctx.restore();
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 64);
    return texture(c);
  }

  // A studio around the pack (soft white key, red and blue neon strips) for the foil to reflect.
  function studio(renderer) {
    var w = 512, h = 256;
    var c = canvas(w, h), ctx = c.getContext("2d");
    var bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#1b1530"); bg.addColorStop(0.5, "#0b0912"); bg.addColorStop(1, "#05040a");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    function box(x, y, rw, rh, color) {
      var g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rw, rh));
      g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.save(); ctx.translate(x, y); ctx.scale(rw / Math.max(rw, rh), rh / Math.max(rw, rh)); ctx.translate(-x, -y);
      ctx.fillStyle = g; ctx.fillRect(x - Math.max(rw, rh), y - Math.max(rw, rh), Math.max(rw, rh) * 2, Math.max(rw, rh) * 2);
      ctx.restore();
    }
    box(256, 70, 120, 34, "rgba(255,255,255,.95)"); // key light above, in front
    box(120, 120, 26, 90, "rgba(255,45,85,.9)"); // red neon, left
    box(392, 120, 26, 90, "rgba(70,140,255,.9)"); // blue neon, right
    box(256, 200, 160, 20, "rgba(255,255,255,.18)"); // floor bounce
    var tex = new T.CanvasTexture(c);
    tex.mapping = T.EquirectangularReflectionMapping;
    tex.encoding = T.sRGBEncoding;
    var pm = new T.PMREMGenerator(renderer);
    var env = pm.fromEquirectangular(tex).texture;
    tex.dispose();
    pm.dispose();
    return env;
  }

  function supported() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
    } catch (e) { return false; }
  }

  /**
   * opts: stage (element), rect (the card's spot on the page, a DOMRect), packWidth (px),
   * packImageUrl, art ({ left, top, width, height } of the pack in the square art), tearY (fraction
   * from the top), before (element the canvas goes in front of).
   */
  function create(opts) {
    var stage = opts.stage;
    var vw = stage.clientWidth, vh = stage.clientHeight;
    var renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(vw, vh);
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.setClearColor(0x000000, 0);
    var cv = renderer.domElement;
    cv.className = "mp-gl";
    cv.setAttribute("aria-hidden", "true");
    stage.insertBefore(cv, opts.before || null);

    var scene = new T.Scene();
    var fov = 30;
    var camera = new T.PerspectiveCamera(fov, vw / vh, 0.1, 100);
    camera.position.z = (vh / PX / 2) / Math.tan((fov / 2) * Math.PI / 180);
    function wx(px) { return (px - vw / 2) / PX; }
    function wy(py) { return -(py - vh / 2) / PX; }

    var rect = opts.rect;
    var W = opts.packWidth / PX, H = rect.height / PX;
    var CW = rect.width / PX, CH = rect.height / PX;
    var vt = 1 - opts.tearY; // tear line, from the bottom
    var B = 0.07 * W; // how far the pack puffs out

    var root = new T.Group(); // at the card's spot
    root.position.set(wx(rect.left + rect.width / 2), wy(rect.top + rect.height / 2), 0);
    scene.add(root);
    var tiltG = new T.Group();
    root.add(tiltG);
    var packG = new T.Group();
    tiltG.add(packG);
    var bodyG = new T.Group();
    packG.add(bodyG);
    var topG = new T.Group();
    packG.add(topG);

    scene.add(new T.AmbientLight(0xffffff, 0.45));
    var key = new T.DirectionalLight(0xffffff, 0.75);
    key.position.set(-2, 3, 5);
    scene.add(key);
    var sweep = new T.PointLight(0xffffff, 0.45, 0, 1);
    scene.add(sweep);
    var rimR = new T.PointLight(0xff2d55, 1.4, 0, 1);
    rimR.position.set(-W * 1.6, H * 0.2, 0.6);
    root.add(rimR);
    var rimB = new T.PointLight(0x4d8dff, 1.3, 0, 1);
    rimB.position.set(W * 1.6, -H * 0.1, 0.6);
    root.add(rimB);

    function puff(u, v) {
      var sx = 1 - Math.pow(Math.abs(2 * u - 1), 4);
      var sy = smooth((v - 0.03) / 0.1) * smooth((vt - 0.012 - v) / 0.07);
      return B * sx * sy;
    }
    // One piece of the pack between heights v0 and v1 (0 = bottom), puffed out on its side.
    function piece(v0, v1, segY, side) {
      var segX = 28, pos = [], uv = [], idx = [];
      for (var j = 0; j <= segY; j++) {
        var v = v0 + (v1 - v0) * (j / segY);
        for (var i = 0; i <= segX; i++) {
          var u = i / segX;
          pos.push((u - 0.5) * W, (v - 0.5) * H, side * puff(u, v) * (side > 0 ? 1 : 0.45));
          uv.push(u, v);
        }
      }
      for (j = 0; j < segY; j++) {
        for (i = 0; i < segX; i++) {
          var a = j * (segX + 1) + i, b = a + 1, c = a + segX + 1, d = c + 1;
          if (side > 0) idx.push(a, b, c, b, d, c);
          else idx.push(a, c, b, b, c, d);
        }
      }
      var g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }

    var disposables = [];
    function keep(x) { disposables.push(x); return x; }
    var glow = keep(glowTexture()), lineTex = keep(lineTexture()), beamTex = keep(beamTexture());
    var env = keep(studio(renderer));
    scene.environment = env;

    var frontMat = null, topMat = null;
    var backMat = keep(new T.MeshStandardMaterial({ color: 0x141a33, metalness: 0.7, roughness: 0.35 }));
    var backTopMat = backMat.clone();
    keep(backTopMat);
    backTopMat.transparent = true;

    function add(group, geo, mat) {
      keep(geo);
      var m = new T.Mesh(geo, mat);
      group.add(m);
      return m;
    }

    var shadow = new T.Mesh(keep(new T.PlaneGeometry(W * 1.2, W * 0.3)), keep(new T.MeshBasicMaterial({ map: keep(shadowTexture()), transparent: true, depthWrite: false })));
    shadow.position.set(0, -H * 0.56, -0.4);
    root.add(shadow);

    // Swipe hint: a dashed cut line with a light running along it.
    var dashes = new T.Mesh(keep(new T.PlaneGeometry(W * 0.9, H * 0.006)), keep(new T.MeshBasicMaterial({ map: keep(dashTexture()), transparent: true, depthWrite: false, blending: T.AdditiveBlending })));
    var cutY = (vt - 0.5) * H, cutZ = 0.02;
    dashes.position.set(0, cutY, cutZ);
    packG.add(dashes);
    var hintDot = new T.Sprite(keep(new T.SpriteMaterial({ map: glow, color: 0xbfe0ff, transparent: true, depthWrite: false, blending: T.AdditiveBlending })));
    hintDot.scale.set(W * 0.12, W * 0.12, 1);
    hintDot.position.set(0, cutY, cutZ + 0.01);
    packG.add(hintDot);
    var hintOn = 1, hintShown = 1;

    // The cut: a glowing line from the left edge to the finger, a bright point at the finger, sparks.
    var trailMat = keep(new T.MeshBasicMaterial({ map: lineTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    var trail = new T.Mesh(keep(new T.PlaneGeometry(1, 1)), trailMat);
    trail.position.set(-W / 2, cutY, cutZ + 0.005);
    trail.scale.set(0.0001, H * 0.05, 1);
    packG.add(trail);
    var head = new T.Sprite(keep(new T.SpriteMaterial({ map: glow, color: 0xff6a88, transparent: true, depthWrite: false, blending: T.AdditiveBlending })));
    head.scale.set(W * 0.22, W * 0.22, 1);
    head.material.opacity = 0;
    head.position.set(-W / 2, cutY, cutZ + 0.02);
    packG.add(head);

    var sparkMat = keep(new T.SpriteMaterial({ map: glow, color: 0xff4d6d, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    var sparks = [];
    function spark(x, y, z, vx, vy, life, size, mat, parent) {
      var s = new T.Sprite(mat || sparkMat);
      if (mat) s.material = mat.clone();
      s.position.set(x, y, z);
      s.scale.set(size, size, 1);
      (parent || packG).add(s);
      sparks.push({ s: s, vx: vx, vy: vy, life: life, age: 0, size: size, own: !!mat });
    }

    // Burst pieces, made up front (invisible) so their shaders are ready before the moment they're needed.
    var beams = [];
    var beamColors = [0xffffff, 0xffc2d1, 0xa9d4ff, 0xffffff, 0xff8fa8, 0xc7b8ff, 0xffffff];
    for (var bi = 0; bi < beamColors.length; bi++) {
      var bm = keep(new T.MeshBasicMaterial({ map: beamTex, color: beamColors[bi], transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 }));
      var bg = keep(new T.PlaneGeometry(1, 1));
      bg.translate(0, 0.5, 0); // grows upward from its base
      var beam = new T.Mesh(bg, bm);
      var spread = (bi / (beamColors.length - 1) - 0.5) * 2;
      beam.position.set(spread * W * 0.32, cutY - H * 0.02, -0.005);
      beam.rotation.z = -spread * 0.32 + (Math.random() - 0.5) * 0.12;
      beam.userData = { w: W * (0.12 + Math.random() * 0.14), h: H * (1.1 + Math.random() * 0.7), d: Math.random() * 0.12 };
      beam.scale.set(0.0001, 0.0001, 1);
      packG.add(beam);
      beams.push(beam);
    }
    var flare = new T.Sprite(keep(new T.SpriteMaterial({ map: glow, color: 0xffe3ea, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 })));
    flare.position.set(0, cutY, 0.05);
    packG.add(flare);
    var twinkle = keep(new T.SpriteMaterial({ map: glow, color: 0xffffff, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));

    var card = null, cardMat = null;
    var progress = 0, shownCut = 0;
    var tilt = { rx: 0, ry: 0, tx: 0, ty: 0, lift: 0, mode: "idle" };
    var gyro = null, base = null;
    function onTilt(e) {
      if (e.beta == null || e.gamma == null) return;
      if (!base) base = { b: e.beta, g: e.gamma };
      gyro = { x: clamp((base.b - e.beta) * 0.7, -18, 18), y: clamp((e.gamma - base.g) * 0.9, -22, 22) };
    }
    window.addEventListener("deviceorientation", onTilt);

    var tweens = [];
    function tween(dur, fn, delay) {
      return new Promise(function (resolve) { tweens.push({ dur: dur, fn: fn, t: -(delay || 0), done: resolve }); });
    }

    var running = true, last = performance.now(), start = last;
    var enter = 0;
    function frame(now) {
      if (!running) return;
      requestAnimationFrame(frame);
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      var t = (now - start) / 1000;

      // Tilt: floats and sways on its own, leans to the finger or pointer, follows the phone.
      var goalLift = 0;
      if (tilt.mode === "idle") {
        tilt.tx = Math.sin(t * 1.3) * 4 + (gyro ? gyro.x : 0);
        tilt.ty = Math.sin(t * 0.9) * 10 + (gyro ? gyro.y : 0);
        goalLift = Math.sin(t * 1.8) * 0.05 * H;
      } else if (tilt.mode === "flat") {
        tilt.tx = 0; tilt.ty = 0;
      }
      var k = 1 - Math.pow(0.001, dt); // frame-rate independent easing
      tilt.rx += (tilt.tx - tilt.rx) * k * 1.1;
      tilt.ry += (tilt.ty - tilt.ry) * k * 1.1;
      tilt.lift += (goalLift - tilt.lift) * k;
      tiltG.rotation.set(tilt.rx * Math.PI / 180, tilt.ry * Math.PI / 180, 0);
      tiltG.position.y = tilt.lift;
      // The glint slides across the foil opposite the tilt, from off to one side so it never sits
      // as a hot spot in the middle of the pack.
      sweep.position.set(root.position.x - W * 0.9 - tilt.ry * 0.12, root.position.y + H * 0.45 + tilt.rx * 0.1, 2.2);
      shadow.scale.set(1 - tilt.lift / H, 1, 1);
      shadow.material.opacity = 0.8 - tilt.lift / H;

      // Drop-in entrance.
      if (enter < 1) {
        enter = Math.min(1, enter + dt / 0.7);
        var e1 = easeOut(enter);
        packG.position.y = (1 - e1) * H * 0.5;
        packG.rotation.z = (1 - e1) * -0.2;
        var sc = 0.82 + 0.18 * e1 + Math.sin(e1 * Math.PI) * 0.04;
        packG.scale.set(sc, sc, sc);
      }

      // Hint fades out while a finger is cutting.
      hintShown += (hintOn - hintShown) * k * 1.5;
      dashes.material.opacity = 0.55 * hintShown;
      var loop = (t % 1.6) / 1.6;
      hintDot.position.x = (-0.45 + 0.9 * easeInOut(loop)) * W;
      hintDot.material.opacity = hintShown * Math.sin(loop * Math.PI);

      // The cut glides after the finger.
      var gap = progress - shownCut;
      if (Math.abs(gap) > 0.001) {
        var before = shownCut;
        // opener.js already eases the finger's position, so this only smooths between frames.
        shownCut += gap * (1 - Math.pow(gap > 0 ? 0.000001 : 0.0001, dt));
        if (shownCut > before && Math.random() < 0.8) {
          var hx = -W / 2 + W * shownCut;
          spark(hx, cutY, cutZ + 0.03, (Math.random() - 0.3) * W * 0.6, (0.2 + Math.random()) * H * 0.35, 0.5 + Math.random() * 0.4, W * (0.025 + Math.random() * 0.03));
        }
      } else shownCut = progress;
      trail.scale.x = Math.max(0.0001, W * shownCut);
      trail.position.x = -W / 2 + (W * shownCut) / 2;
      head.position.x = -W / 2 + W * shownCut;
      var headGoal = shownCut > 0.003 && shownCut < 0.999 ? 1 : 0;
      head.material.opacity += (headGoal - head.material.opacity) * k * 2;
      var pulse = 1 + Math.sin(t * 22) * 0.08;
      head.scale.set(W * 0.22 * pulse, W * 0.22 * pulse, 1);

      for (var i = sparks.length - 1; i >= 0; i--) {
        var p = sparks[i];
        p.age += dt;
        p.vy -= H * 0.9 * dt * (p.own ? 0.15 : 1);
        p.s.position.x += p.vx * dt;
        p.s.position.y += p.vy * dt;
        var life = p.age / p.life;
        p.s.material.opacity = (p.own ? 0.9 : 1) * (1 - life) * (p.own ? 0.6 + 0.4 * Math.sin(p.age * 18 + i) : 1);
        if (life >= 1) {
          p.s.parent.remove(p.s);
          if (p.own) p.s.material.dispose();
          sparks.splice(i, 1);
        }
      }

      for (i = tweens.length - 1; i >= 0; i--) {
        var tw = tweens[i];
        tw.t += dt;
        if (tw.t < 0) continue;
        var kk = Math.min(1, tw.t / tw.dur);
        tw.fn(kk);
        if (kk >= 1) { tweens.splice(i, 1); tw.done(); }
      }

      renderer.render(scene, camera);
    }

    var ready = (opts.packImageUrl ? loadImage(opts.packImageUrl) : Promise.resolve(null)).then(function (img) {
      var tex = keep(packTexture(img, opts.art, W / H));
      frontMat = keep(new T.MeshPhysicalMaterial({
        map: tex, alphaTest: 0.5,
        emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.32,
        roughness: 0.36, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.28,
        iridescence: 0.55, iridescenceIOR: 1.3, iridescenceThicknessRange: [200, 650], envMapIntensity: 1.15,
      }));
      topMat = frontMat.clone();
      keep(topMat);
      topMat.transparent = true;
      add(bodyG, piece(0, vt, 56, 1), frontMat);
      add(bodyG, piece(0, vt, 28, -1), backMat);
      add(topG, piece(vt, 1, 6, 1), topMat);
      add(topG, piece(vt, 1, 3, -1), backTopMat);
      renderer.compile(scene, camera);
      requestAnimationFrame(frame);
    });

    function setCard(url, title) {
      return (url ? loadImage(url) : Promise.reject()).catch(function () { return null; }).then(function (img) {
        if (!running) return;
        cardMat = keep(new T.MeshBasicMaterial({ map: keep(cardTexture(img, title)), transparent: true, alphaTest: 0.4, toneMapped: false }));
        card = new T.Mesh(keep(new T.PlaneGeometry(CW, CH)), cardMat);
        var s = (W * 0.86) / CW;
        card.position.set(0, -0.06 * CH, -0.01);
        card.scale.set(s, s, 1);
        tiltG.add(card); // sits inside the pack, hidden behind its front, until it rises out
      });
    }

    // Finishes the cut from wherever the finger left it.
    function finish() {
      var from = shownCut;
      progress = 1;
      tilt.mode = "aim"; tilt.tx = 6; tilt.ty = 0;
      return tween(Math.max(0.22, 0.9 * (1 - from)), function (k) {
        shownCut = from + (1 - from) * easeOut(k);
        progress = shownCut;
      });
    }

    // The top flies off in a burst of light and the card rises out; the pack drops away and the card
    // grows into its spot on the page. Resolves when the card sits exactly where the page's card is.
    function open() {
      tilt.mode = "flat";
      var flat = tween(0.3, function () {});
      return flat.then(function () {
        if (navigator.vibrate) navigator.vibrate([30, 40, 60]);
        // Cut flash, then the line fades.
        tween(0.5, function (k) {
          trail.scale.y = H * (0.05 + 0.08 * Math.sin(k * Math.PI));
          trailMat.opacity = 1 - easeIn(k);
        });
        // Top piece: thrown up and to the right, spinning, fading.
        var vx = W * 0.9, vy = H * 1.15;
        tween(1.1, function (k) {
          var s = k * 1.1;
          topG.position.set(vx * s, vy * s - 0.5 * H * 2.4 * s * s, 0.3 * s);
          topG.rotation.set(0.9 * s, 0.4 * s, -1.6 * s);
          var fade = 1 - smooth((k - 0.45) / 0.55);
          topMat.opacity = fade; backTopMat.opacity = fade;
        }).then(function () { topG.visible = false; });

        tween(1.9, function (k) {
          beams.forEach(function (b) {
            var kk = clamp((k * 1.9 - b.userData.d) / 1.7, 0, 1);
            var grow = easeOut(kk / 0.25);
            b.scale.set(b.userData.w * (0.6 + 0.4 * grow), b.userData.h * grow, 1);
            b.material.opacity = (kk < 0.2 ? kk / 0.2 : 1 - smooth((kk - 0.2) / 0.8)) * 0.85;
          });
        }).then(function () { beams.forEach(function (b) { b.visible = false; }); });
        tween(0.9, function (k) {
          var s = W * (0.4 + 1.8 * easeOut(k));
          flare.scale.set(s, s * 0.55, 1);
          flare.material.opacity = 1 - easeIn(k);
        }).then(function () { flare.visible = false; });
        for (var i = 0; i < 26; i++) {
          spark((Math.random() - 0.5) * W * 0.9, cutY, 0.06, (Math.random() - 0.5) * W * 0.5, H * (0.35 + Math.random() * 0.75), 1 + Math.random() * 0.8, W * (0.03 + Math.random() * 0.05), twinkle);
        }

        // The card rises out of the opening.
        if (!card) return null;
        var s0 = (W * 0.86) / CW;
        var y0 = -0.06 * CH, y1 = 0.24 * CH;
        return tween(0.7, function (k) { card.position.y = y0 + (y1 - y0) * easeOut(k); }, 0.12).then(function () {
          // The pack drops away while the card grows into place.
          tween(0.95, function (k) {
            bodyG.position.y = -easeIn(k) * (H * 2.3);
            bodyG.rotation.x = easeIn(k) * 0.35;
            shadow.material.opacity = 0.8 * (1 - k);
          }).then(function () { bodyG.visible = false; });
          return tween(0.85, function (k) {
            var e = easeOut(k);
            var over = Math.sin(clamp(k / 0.85, 0, 1) * Math.PI) * 0.04;
            var s = s0 + (1 - s0) * e + over;
            card.scale.set(s, s, 1);
            card.position.y = y1 + (0 - y1) * e;
            card.position.z = -0.01 + 0.01 * e;
          }, 0.45);
        });
      });
    }

    function destroy() {
      if (!running) return;
      running = false;
      window.removeEventListener("deviceorientation", onTilt);
      sparks.forEach(function (p) { if (p.own) p.s.material.dispose(); });
      disposables.forEach(function (d) { if (d && d.dispose) d.dispose(); });
      renderer.dispose();
      if (renderer.forceContextLoss) renderer.forceContextLoss();
      cv.remove();
    }

    return {
      ready: ready,
      canvas: cv,
      setCard: setCard,
      // The pack's box on screen, for where a swipe counts as cutting.
      rect: function () {
        return { left: rect.left + rect.width / 2 - opts.packWidth / 2, top: rect.top, width: opts.packWidth, height: rect.height, right: rect.left + rect.width / 2 + opts.packWidth / 2 };
      },
      draw: function (p) { progress = clamp(p, 0, 1); },
      hint: function (on) { hintOn = on ? 1 : 0; },
      aim: function (x, y) { tilt.mode = "aim"; tilt.tx = x; tilt.ty = y; },
      idle: function () { tilt.mode = "idle"; },
      finish: finish,
      open: open,
      destroy: destroy,
    };
  }

  window.PCPack3D = { supported: supported, create: create };
})();
