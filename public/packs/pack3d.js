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
  // tex.paint(source, width, height) redraws it, for each frame of an animated pack.
  function packTexture(img, art, aspect) {
    var h = 900, w = Math.round(h * aspect);
    var c = canvas(w, h), ctx = c.getContext("2d");
    function paint(src, iw, ih) {
      ctx.save();
      ctx.clearRect(0, 0, w, h);
      rounded(ctx, w, h, w * 0.06, h * 0.034);
      ctx.clip();
      if (src) {
        ctx.drawImage(src, art.left * iw, art.top * ih, art.width * iw, art.height * ih, 0, 0, w, h);
      } else {
        var g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, "#2a0f4f"); g.addColorStop(0.5, "#120a2e"); g.addColorStop(1, "#3b0d1c");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
      ctx.restore();
    }
    paint(img, img && img.naturalWidth, img && img.naturalHeight);
    var t = texture(c);
    t.paint = function (src, iw, ih) { paint(src, iw, ih); t.needsUpdate = true; };
    return t;
  }

  // Plays an animated GIF (how Shopify serves the packs' animated art) frame by frame into a canvas,
  // so the 3D pack keeps its scan line and glow. Rejects for anything that isn't an animated GIF.
  function gifPlayer(url) {
    return fetch(url, { mode: "cors", credentials: "omit" }).then(function (r) {
      if (!r.ok) throw new Error("Pack art failed");
      return r.arrayBuffer();
    }).then(function (buf) {
      var bytes = new Uint8Array(buf);
      if (!window.GifReader || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) throw new Error("Not a GIF");
      var gif = new window.GifReader(bytes);
      var n = gif.numFrames();
      if (n < 2) throw new Error("Not animated");
      var w = gif.width, h = gif.height;
      var c = canvas(w, h), ctx = c.getContext("2d");
      var img = ctx.createImageData(w, h), px = img.data;
      var i = -1, saved = null, elapsed = 0;
      function step() {
        if (i >= 0) {
          var f = gif.frameInfo(i);
          if (f.disposal === 2) {
            for (var y = f.y; y < f.y + f.height; y++) px.fill(0, (y * w + f.x) * 4, (y * w + f.x + f.width) * 4);
          } else if (f.disposal === 3 && saved) px.set(saved);
        }
        i = (i + 1) % n;
        if (i === 0) px.fill(0);
        if (gif.frameInfo(i).disposal === 3) saved = new Uint8ClampedArray(px);
        gif.decodeAndBlitFrameRGBA(i, px);
        ctx.putImageData(img, 0, 0);
      }
      step();
      return {
        canvas: c, width: w, height: h,
        // Moves on by ms; true when a new frame was drawn.
        tick: function (ms) {
          elapsed += ms;
          var delay = Math.max(20, (gif.frameInfo(i).delay || 8) * 10);
          if (elapsed < delay) return false;
          elapsed = Math.min(elapsed - delay, delay);
          step();
          return true;
        },
      };
    });
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
  // A column of the code rain's glyphs (katakana, digits, POKECOLLECT), tiling vertically.
  var GLYPHS = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789POKECOLLECT";
  function glyphTexture() {
    var c = canvas(64, 1024), ctx = c.getContext("2d");
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "700 46px ui-monospace, Menlo, monospace";
    for (var y = 0; y < 16; y++) {
      var a = Math.random();
      ctx.fillStyle = "rgba(255,255,255," + (a < 0.15 ? 1 : 0.25 + a * 0.55).toFixed(2) + ")";
      ctx.fillText(GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length)), 32, y * 64 + 32);
    }
    var t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
  }
  // A small square pixel with a soft edge, for the digital sparks and the pack breaking into pixels.
  function squareTexture() {
    var c = canvas(32, 32), ctx = c.getContext("2d");
    ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(2, 2, 28, 28);
    ctx.fillStyle = "#fff"; ctx.fillRect(7, 7, 18, 18);
    return texture(c);
  }
  // A thin glowing rectangle outline: the hologram frame that ripples out of the opening.
  function frameTexture() {
    var c = canvas(512, 128), ctx = c.getContext("2d");
    ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 14; ctx.strokeRect(16, 16, 480, 96);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.strokeRect(16, 16, 480, 96);
    // Corner brackets, like the pack's HUD corners.
    ctx.lineWidth = 8;
    [[16, 16, 1, 1], [496, 16, -1, 1], [16, 112, 1, -1], [496, 112, -1, -1]].forEach(function (k) {
      ctx.beginPath(); ctx.moveTo(k[0], k[1] + 30 * k[3]); ctx.lineTo(k[0], k[1]); ctx.lineTo(k[0] + 40 * k[2], k[1]); ctx.stroke();
    });
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
    var glow = keep(glowTexture()), lineTex = keep(lineTexture());
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

    // The digital burst, made up front (invisible) so its shaders are ready before the moment it's
    // needed: the pack's top breaking into pixels, columns of code streaming up out of the opening,
    // hologram frames rippling outward and a scan line sweeping across.
    var squareTex = keep(squareTexture());
    var pixelMat = keep(new T.SpriteMaterial({ map: squareTex, color: 0xffffff, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    var glyphTexs = [keep(glyphTexture()), keep(glyphTexture()), keep(glyphTexture())];
    var streamGeo = keep(new T.PlaneGeometry(1, 1));
    streamGeo.translate(0, 0.5, 0); // grows upward from its base
    var streams = [];
    var streamColors = [0xff2d55, 0x4da3ff, 0xffffff, 0xff2d55, 0x7fd0ff, 0xff5c7a, 0x4da3ff, 0xffffff, 0xff2d55];
    for (var si = 0; si < streamColors.length; si++) {
      var sm = keep(new T.ShaderMaterial({
        uniforms: { map: { value: glyphTexs[si % 3] }, color: { value: new T.Color(streamColors[si]) }, time: { value: 0 }, opacity: { value: 0 }, rep: { value: 1 }, speed: { value: 1 } },
        vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: [
          "uniform sampler2D map; uniform vec3 color; uniform float time, opacity, rep, speed; varying vec2 vUv;",
          "void main() {",
          "  float g = texture2D(map, vec2(vUv.x, vUv.y * rep - time * speed)).r;",
          "  float side = smoothstep(0.0, 0.5, 1.0 - abs(vUv.x * 2.0 - 1.0));",
          "  float fade = pow(1.0 - vUv.y, 1.3);",
          "  gl_FragColor = vec4(color, (g * 0.95 + 0.08) * side * fade * opacity);",
          "}",
        ].join("\n"),
        transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      }));
      var stream = new T.Mesh(streamGeo, sm);
      var spread = (si / (streamColors.length - 1) - 0.5) * 2;
      var sw = W * (0.055 + Math.random() * 0.035), sh = H * (0.9 + Math.random() * 0.8);
      stream.position.set(spread * W * 0.4 + (Math.random() - 0.5) * W * 0.04, cutY - H * 0.01, -0.005);
      stream.rotation.z = -spread * 0.12;
      stream.userData = { w: sw, h: sh, d: Math.random() * 0.18, speed: 0.6 + Math.random() * 0.9 };
      sm.uniforms.rep.value = sh / (sw * 16) * 1.0; // glyphs stay square whatever the column's height
      sm.uniforms.speed.value = stream.userData.speed;
      stream.scale.set(0.0001, 0.0001, 1);
      packG.add(stream);
      streams.push(stream);
    }
    var frameTex = keep(frameTexture());
    var holos = [0x4da3ff, 0xff2d55, 0x9fe0ff].map(function (color) {
      var m = new T.Mesh(keep(new T.PlaneGeometry(1, 1)), keep(new T.MeshBasicMaterial({ map: frameTex, color: color, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 })));
      m.position.set(0, cutY + H * 0.03, 0.04);
      m.scale.set(0.0001, 0.0001, 1);
      packG.add(m);
      return m;
    });
    var scanMat = keep(new T.MeshBasicMaterial({ map: lineTex, color: 0x9fe0ff, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 }));
    var scan = new T.Mesh(keep(new T.PlaneGeometry(1, 1)), scanMat);
    scan.position.set(0, cutY, 0.05);
    scan.scale.set(0.0001, 0.0001, 1);
    packG.add(scan);
    // The pack's top, cut into pixels that scatter when it breaks apart.
    var COLS = 16, ROWS = 3;
    var bits = [];
    var packTex = null, player = null;

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

      if (player && packTex && player.tick(dt * 1000)) packTex.paint(player.canvas, player.width, player.height);
      streams.forEach(function (s) { s.material.uniforms.time.value = t; });

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
      for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < COLS; c++) {
          var u0 = c / COLS, u1 = (c + 1) / COLS, v0 = vt + (1 - vt) * (r / ROWS), v1 = vt + (1 - vt) * ((r + 1) / ROWS);
          var g = keep(new T.PlaneGeometry(W / COLS, H * (v1 - v0)));
          var uvs = g.attributes.uv;
          for (var q = 0; q < uvs.count; q++) uvs.setXY(q, uvs.getX(q) ? u1 : u0, uvs.getY(q) ? v1 : v0);
          var bm = keep(new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, toneMapped: false }));
          var bit = new T.Mesh(g, bm);
          var ux = (u0 + u1) / 2, vy = (v0 + v1) / 2;
          bit.position.set((ux - 0.5) * W, (vy - 0.5) * H, puff(ux, vy) + 0.003);
          bit.userData = { x: bit.position.x, y: bit.position.y, u: ux, row: r, col: c };
          packG.add(bit);
          bits.push(bit);
        }
      }
      packTex = tex;
      renderer.compile(scene, camera);
      // The pack's own animation (its scan line and glow) plays on the 3D pack when the art is a GIF.
      if (opts.packImageUrl) gifPlayer(opts.packImageUrl).then(function (p) { if (running) player = p; }, function () {});
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
        // The top breaks into pixels that glitch, then scatter up and out, tinting red and blue.
        topG.visible = false;
        var tintR = new T.Color(0xff2d55), tintB = new T.Color(0x4da3ff), white = new T.Color(0xffffff);
        bits.forEach(function (bit) {
          var d = bit.userData;
          d.delay = d.u * 0.16 + Math.random() * 0.06;
          d.vx = (d.u - 0.5) * W * (0.9 + Math.random() * 0.8) + (Math.random() - 0.5) * W * 0.3;
          d.vy = H * (0.35 + Math.random() * 0.9) * (1 + d.row * 0.15);
          d.spin = (Math.random() - 0.5) * 9;
          d.tint = Math.random() < 0.5 ? tintR : tintB;
          bit.material.opacity = 1;
        });
        tween(1.25, function (k) {
          var time = k * 1.25;
          bits.forEach(function (bit) {
            var d = bit.userData;
            var s = Math.max(0, time - d.delay);
            // A short digital glitch before it lets go: jumps sideways a few pixels.
            var glitch = s < 0.12 ? (Math.random() - 0.5) * W * 0.03 : 0;
            bit.position.x = d.x + d.vx * s + glitch;
            bit.position.y = d.y + d.vy * s - H * 0.5 * s * s;
            bit.rotation.z = d.spin * s * 0.3;
            var shrink = 1 - 0.7 * smooth(s / 0.9);
            bit.scale.set(shrink, shrink, 1);
            bit.material.color.copy(white).lerp(d.tint, smooth(s / 0.35));
            bit.material.opacity = s <= 0 ? 1 : 1 - smooth((s - 0.25) / 0.7);
          });
        }).then(function () { bits.forEach(function (bit) { bit.visible = false; }); });
        backTopMat.opacity = 0;

        // A scan line sweeps out across the cut.
        tween(0.55, function (k) {
          scan.scale.set(W * (0.9 + 1.4 * easeOut(k)), H * 0.035 * (1 - k * 0.6), 1);
          scanMat.opacity = 1 - easeIn(k);
        }).then(function () { scan.visible = false; });
        // Hologram frames ripple out of the opening, one after another.
        holos.forEach(function (m, i) {
          tween(0.85, function (k) {
            var e = easeOut(k);
            m.scale.set(W * (0.95 + 0.9 * e), H * (0.06 + 0.22 * e), 1);
            m.position.y = cutY + H * (0.03 + 0.12 * e);
            m.material.opacity = (k < 0.15 ? k / 0.15 : 1 - smooth((k - 0.15) / 0.85)) * 0.9;
          }, 0.08 + i * 0.13).then(function () { m.visible = false; });
        });
        // Columns of code stream up out of the pack.
        tween(1.9, function (k) {
          streams.forEach(function (st) {
            var kk = clamp((k * 1.9 - st.userData.d) / 1.6, 0, 1);
            var grow = easeOut(kk / 0.3);
            st.scale.set(st.userData.w, st.userData.h * grow, 1);
            st.material.uniforms.opacity.value = (kk < 0.15 ? kk / 0.15 : 1 - smooth((kk - 0.35) / 0.65)) * 0.8;
          });
        }).then(function () { streams.forEach(function (st) { st.visible = false; }); });
        // Square pixel sparks.
        for (var i = 0; i < 30; i++) {
          var m = pixelMat.clone();
          m.color.set([0xff2d55, 0x4da3ff, 0xffffff][i % 3]);
          spark((Math.random() - 0.5) * W * 0.95, cutY, 0.06, (Math.random() - 0.5) * W * 0.7, H * (0.4 + Math.random() * 0.8), 0.9 + Math.random() * 0.7, W * (0.02 + Math.random() * 0.03), m);
          m.dispose();
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
