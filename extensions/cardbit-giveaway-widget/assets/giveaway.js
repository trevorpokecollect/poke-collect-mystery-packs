/* Cardbit Giveaways storefront widget. No dependencies; talks to /apps/packs/campaigns/<slug>. */
(function () {
  "use strict";

  var TOKEN_KEY = "pcg:token:";
  var DEVICE_KEY = "pcg:device";
  var VIDEO_KEY = "pcg:video:";
  // Completed from elsewhere in the widget, never from the action list.
  var NOT_LISTED = { REFERRAL: 1, ALTERNATE_ENTRY: 1, SIGNUP: 1 };

  function store(k, v) {
    try {
      if (v === undefined) return window.localStorage.getItem(k);
      if (v === null) window.localStorage.removeItem(k);
      else window.localStorage.setItem(k, v);
    } catch (e) {
      return null;
    }
  }

  // A persistent random device id (also mirrored in a cookie) used only for duplicate detection.
  function deviceId() {
    var id = store(DEVICE_KEY);
    var m = document.cookie.match(/(?:^|; )pcg_device=([^;]+)/);
    if (!id && m) id = m[1];
    if (!id) {
      var bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      id = Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    }
    store(DEVICE_KEY, id);
    document.cookie = "pcg_device=" + id + "; path=/; max-age=31536000; SameSite=Lax";
    return id;
  }

  function utm() {
    var p = new URLSearchParams(window.location.search);
    var out = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (k) {
      if (p.get(k)) out[k] = p.get(k);
    });
    if (document.referrer) out.referrer = document.referrer.slice(0, 200);
    return out;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "text") node.textContent = v;
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    });
    (children || []).forEach(function (c) {
      if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function plural(n, one, many) { return n === 1 ? one : many; }
  // Store style: buttons, titles, headers and sub text capitalize every word ("Shop & Earn").
  // Full sentences (notes, errors, consent wording) stay as written.
  function tc(s) { return String(s || "").replace(/(^|[\s(/-])([a-z])/g, function (m, sep, c) { return sep + c.toUpperCase(); }); }

  var uid = 0;
  function nextId(prefix) { uid += 1; return "pcg-" + prefix + "-" + uid; }

  function copyText(text, input) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    if (input) { input.select(); try { document.execCommand("copy"); return Promise.resolve(); } catch (e) { /* fall through */ } }
    return Promise.reject(new Error("copy"));
  }

  // Share targets for referral links and SOCIAL_SHARE actions.
  var NETWORKS = [
    { id: "x", label: "X", url: function (link, text) { return "https://x.com/intent/post?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(link); } },
    { id: "facebook", label: "Facebook", url: function (link) { return "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(link); } },
    { id: "whatsapp", label: "WhatsApp", url: function (link, text) { return "https://wa.me/?text=" + encodeURIComponent(text + " " + link); } },
    { id: "copy", label: "Copy Link" },
  ];

  // Brand icons for follow/join buttons (same shapes as the storefront's Social Follow Band).
  var ICONS = {
    whatnot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="13.5" rx="3"/><path d="M10 9.2v5.1l4.4-2.55z" fill="currentColor"/><path d="M8 21.5h8"/></svg>',
    discord: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.6 5.3A17 17 0 0 0 15.4 4l-.5 1.1a15.6 15.6 0 0 0-5.8 0L8.6 4a17 17 0 0 0-4.2 1.3C1.8 9.2 1.1 13 1.4 16.7a17 17 0 0 0 5.2 2.6l1.1-1.8c-.6-.2-1.2-.5-1.7-.9l.4-.3a12.2 12.2 0 0 0 11.2 0l.4.3c-.5.4-1.1.7-1.7.9l1.1 1.8a17 17 0 0 0 5.2-2.6c.4-4.3-.7-8-3-11.4zM8.7 14.5c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1zm6.6 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.5 7.2a3 3 0 0 0-2.1-2.1C18.5 4.6 12 4.6 12 4.6s-6.5 0-8.4.5a3 3 0 0 0-2.1 2.1C1 9.1 1 12 1 12s0 2.9.5 4.8a3 3 0 0 0 2.1 2.1c1.9.5 8.4.5 8.4.5s6.5 0 8.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-4.8.5-4.8s0-2.9-.5-4.8zM9.8 15.1V8.9l5.4 3.1z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><rect x="3" y="3" width="18" height="18" rx="5.2"/><circle cx="12" cy="12" r="4.1"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.6 21.9v-7.7h2.6l.4-3h-3V9.3c0-.9.3-1.5 1.5-1.5h1.6V5.1c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.9v3h2.6v7.7z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 2.5h-3.3v12.7a2.8 2.8 0 1 1-2-2.7V9.1a6.1 6.1 0 1 0 5.3 6V8.6a7.6 7.6 0 0 0 4.4 1.4V6.7a4.4 4.4 0 0 1-4.4-4.2z"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.9zm-1.1 16.2h1.7L7.4 4.7H5.6z"/></svg>',
    other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1-1"/></svg>',
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  };
  var PLATFORMS = [
    ["whatnot", /(^|\.)whatnot\.com$/], ["discord", /(^|\.)discord\.(gg|com)$/], ["youtube", /(^|\.)(youtube\.com|youtu\.be)$/],
    ["instagram", /(^|\.)instagram\.com$/], ["facebook", /(^|\.)(facebook\.com|fb\.com)$/], ["tiktok", /(^|\.)tiktok\.com$/],
    ["x", /(^|\.)(x\.com|twitter\.com)$/],
  ];
  function icon(name) {
    var span = el("span", { class: "pcg__ic", "aria-hidden": "true" });
    span.innerHTML = ICONS[name] || ICONS.other;
    return span;
  }
  // "whatnot", "discord", ... for follow/visit actions pointing at a social site; null otherwise.
  function platformOf(a) {
    if (a.type !== "SOCIAL_FOLLOW" && a.type !== "VISIT_URL") return null;
    var url = (a.config && a.config.url) || a.url;
    var host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return a.type === "SOCIAL_FOLLOW" ? "other" : null; }
    for (var i = 0; i < PLATFORMS.length; i++) if (PLATFORMS[i][1].test(host)) return PLATFORMS[i][0];
    return a.type === "SOCIAL_FOLLOW" ? "other" : null;
  }
  // iPhone/iPad: a new tab for Instagram, Whatnot or Discord is left blank (about:blank) when the
  // phone hands the link to the app, and getting back to the giveaway is awkward. There we open
  // the link in this tab instead: the app opens and the giveaway stays put, or Back returns to it.
  var IOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function openExternal(url, features) {
    if (IOS) { window.setTimeout(function () { window.location.href = url; }, 50); return; }
    window.open(url, "_blank", features || "noopener");
  }
  function entriesText(n) { return "+" + n + plural(n, " entry", " entries"); }

  function otherTokens(own) {
    var out = [];
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k !== own && k.indexOf(TOKEN_KEY) === 0) out.push(window.localStorage.getItem(k));
      }
    } catch (e) { /* storage blocked */ }
    return out.filter(Boolean).slice(0, 5);
  }

  function Widget(root) {
    this.root = root;
    // A blank link name means the newest open giveaway.
    this.slug = (root.getAttribute("data-slug") || "").trim() || "latest";
    this.proxy = root.getAttribute("data-proxy") || "/apps/packs/campaigns";
    this.base = this.proxy + "/" + encodeURIComponent(this.slug);
    this.tokenKey = TOKEN_KEY + this.slug;
    this.ref = new URLSearchParams(window.location.search).get("ref") || "";
    this.renderedAt = Date.now();
    // Edge-to-edge layout: 100vw includes the scrollbar, so measure it to avoid a sideways scroll.
    if (root.classList.contains("pcg--bleed")) {
      var sbw = function () { root.style.setProperty("--pcg-sbw", (window.innerWidth - document.documentElement.clientWidth) + "px"); };
      sbw();
      window.addEventListener("resize", sbw);
    }
  }

  Widget.prototype.request = function (method, body) {
    // format=json (and the Accept header) tell the server this isn't a page view.
    var headers = { "Content-Type": "application/json", Accept: "application/json" };
    var token = store(this.tokenKey);
    if (token) headers["x-entrant-token"] = token;
    else {
      // Entered in a linked giveaway: the server counts them in this one too, no second form.
      var linked = otherTokens(this.tokenKey);
      if (linked.length) headers["x-linked-tokens"] = linked.join(",");
    }
    return fetch(this.base + "?format=json", {
      method: method,
      headers: headers,
      credentials: "same-origin",
      // Finishes even if the page moves on to the link the shopper tapped (iPhone, see openExternal).
      keepalive: method === "POST",
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "Something went wrong. Please try again.");
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  };

  Widget.prototype.load = function () {
    var self = this;
    return this.request("GET")
      .then(function (data) {
        self.data = data;
        if (data.linkedToken) store(self.tokenKey, data.linkedToken);
        // Lets the daily popup launcher show the prize and countdown without a second request.
        self.root.dispatchEvent(new CustomEvent("pcg:loaded", { bubbles: true, detail: data }));
        var entrant = data.entrant;
        if (entrant && entrant.state === "active") self.renderEntrant(entrant);
        else if (entrant && entrant.state === "held") self.renderHeld();
        else if (data.customer && !self.useEmailForm) self.renderCustomerEntry();
        else self.renderSignup();
      })
      .catch(function (err) {
        // An ended giveaway answers "not open" along with its public winners.
        var d = err.data || {};
        if (d.winners && d.winners.length) return self.renderClosed(d, err.message);
        self.message(err.message);
      });
  };

  Widget.prototype.renderClosed = function (data, text) {
    this.data = { campaign: data.campaign || null, winners: data.winners };
    var c = data.campaign;
    this.show([
      c && c.title ? el("div", { class: "pcg__hero" }, [
        el("span", { class: "pcg__badge pcg__badge--ended", text: "Ended" }),
        el("h2", { class: "pcg__title", text: c.title }),
        c.prize ? el("p", { class: "pcg__prize", text: c.prize }) : null,
      ]) : el("div", { class: "pcg__hero" }, [el("span", { class: "pcg__badge pcg__badge--ended", text: "Ended" })]),
      el("p", { class: "pcg__note", text: text || "This giveaway has ended." }),
      this.winners(),
    ]);
  };

  Widget.prototype.message = function (text) {
    this.root.replaceChildren(el("p", { class: "pcg__note pcg__note--solo", text: text }));
  };

  // Three groups: the header (image, title, prize, clock), the main part (the sign-up form or
  // your entries) and the ways to enter. They stack in a narrow box, sit in two columns in a wide
  // one (tasks under the main part) and in three in a very wide one (see .pcg__wrap in the CSS).
  // Phones, inside the daily popup: a shorter sign-up (no bonus-task preview, texts behind a
  // button) with the Enter button pinned to the bottom of the sheet.
  Widget.prototype.compact = function () {
    return !!(this.root.closest && this.root.closest(".pcg-pop__dialog")) &&
      !!window.matchMedia && window.matchMedia("(max-width: 749px)").matches;
  };

  // The pinned Enter button lives at the end of the sheet (outside the widget) so it can stick.
  Widget.prototype.setCta = function (node) {
    var dialog = this.root.closest && this.root.closest(".pcg-pop__dialog");
    if (this.cta) { this.cta.remove(); this.cta = null; }
    this.root.classList.toggle("pcg--compact", !!node);
    if (!node || !dialog) return;
    this.cta = el("div", { class: "pcg-pop__cta" }, [node]);
    dialog.appendChild(this.cta);
  };

  Widget.prototype.show = function (nodes) {
    this.setCta(null);
    nodes = nodes.filter(Boolean);
    var side = nodes.filter(function (n) { return n.__pcg === "head"; });
    var main = nodes.filter(function (n) { return !n.__pcg; });
    var rest = nodes.filter(function (n) { return n.__pcg === "tasks"; });
    this.root.replaceChildren(el("div", { class: "pcg__wrap" + (side.length ? "" : " pcg__wrap--single") + (rest.length ? "" : " pcg__wrap--no-tasks") }, [
      side.length ? el("div", { class: "pcg__side" }, side) : null,
      el("div", { class: "pcg__main" }, main),
      rest.length ? el("div", { class: "pcg__tasks" }, rest) : null,
    ]));
  };

  function mark(group) {
    return function (nodes) {
      nodes.forEach(function (n) { if (n) n.__pcg = group; });
      return nodes;
    };
  }
  var head = mark("head");
  var tasks = mark("tasks");

  // Today's prize on a red "digital rain" backdrop (the Mystery Packs opener's effect), floating
  // with a soft glow. Only once a prize is picked; the rain pauses while off-screen or hidden.
  // Product photos are often square with wide empty margins, so side by side they look tiny and
  // uneven. trimImage finds the picture's visible area (not transparent, not plain white) on a
  // small canvas and, for Shopify CDN images, swaps in Shopify's own crop of just that area.
  var trimCache = {};
  function trimImage(img, url) {
    if (!url || !/^https:\/\/cdn\.shopify\.com\//.test(url)) return;
    var done = function (crop) { if (crop) img.src = crop; };
    if (url in trimCache) { done(trimCache[url]); return; }
    var probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = function () {
      var crop = null;
      try {
        var w = probe.naturalWidth, h = probe.naturalHeight, n = 120;
        var c = document.createElement("canvas");
        c.width = n; c.height = n;
        var ctx = c.getContext("2d");
        ctx.drawImage(probe, 0, 0, n, n);
        var px = ctx.getImageData(0, 0, n, n).data;
        var x0 = n, y0 = n, x1 = -1, y1 = -1;
        for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
          var i = (y * n + x) * 4;
          var empty = px[i + 3] < 40 || (px[i] > 244 && px[i + 1] > 244 && px[i + 2] > 244);
          if (empty) continue;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        if (x1 > x0 && y1 > y0) {
          var pad = 2;
          x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(n - 1, x1 + pad); y1 = Math.min(n - 1, y1 + pad);
          var area = ((x1 - x0 + 1) * (y1 - y0 + 1)) / (n * n);
          if (area < 0.9) {
            var u = new URL(url);
            u.searchParams.set("crop", "region");
            u.searchParams.set("crop_left", String(Math.floor((x0 / n) * w)));
            u.searchParams.set("crop_top", String(Math.floor((y0 / n) * h)));
            u.searchParams.set("crop_width", String(Math.ceil(((x1 - x0 + 1) / n) * w)));
            u.searchParams.set("crop_height", String(Math.ceil(((y1 - y0 + 1) / n) * h)));
            crop = u.toString();
          }
        }
      } catch (e) { /* canvas blocked: keep the original picture */ }
      trimCache[url] = crop;
      done(crop);
    };
    probe.src = url;
  }

  // Bundle pictures: every product, trimmed, with "3x" above repeated ones.
  function bundleArt(items, cls) {
    return items.map(function (i) {
      var img = i.imageUrl ? el("img", { src: i.imageUrl, alt: "", loading: "lazy" }) : null;
      if (img) trimImage(img, i.imageUrl);
      return el("div", { class: cls }, [
        // Every product keeps the badge's space, so pictures line up.
        el("span", { class: "pcg__qty" + (i.quantity > 1 ? "" : " pcg__qty--none"), "aria-hidden": "true", text: i.quantity > 1 ? i.quantity + "x" : "1x" }),
        img || el("span", { class: "pcg__stage-ph", "aria-hidden": "true", text: "🎁" }),
      ]);
    });
  }

  function prizeStage(p) {
    var canvas = el("canvas", { class: "pcg__matrix", "aria-hidden": "true" });
    // Bundles: every product side by side, with "3x" above any that come more than once.
    var items = p.items && p.items.length ? p.items : null;
    var bundle = items && (items.length > 1 || items[0].quantity > 1);
    var art = bundle
      ? el("div", { class: "pcg__stage-items pcg__stage-items--" + Math.min(items.length, 4), role: "img", "aria-label": p.title }, bundleArt(items, "pcg__stage-item"))
      : el("img", { class: "pcg__stage-img", src: p.imageUrl, alt: p.title, loading: "lazy" });
    var stage = el("div", { class: "pcg__image pcg__stage" }, [
      canvas,
      el("span", { class: "pcg__spot", "aria-hidden": "true" }),
      art,
    ]);
    matrixRain(canvas, stage);
    return stage;
  }

  var GLYPHS = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789POKECOLLECT";
  function matrixRain(canvas, stage, opts) {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx || typeof ResizeObserver === "undefined") return;
    var size = (opts && opts.size) || 14, drops = [], w = 0, h = 0, visible = false, frame = 0, last = 0;
    function glyph() { return GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length)); }
    function resize() {
      var r = stage.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#050306"; ctx.fillRect(0, 0, w, h);
      var cols = Math.ceil(w / size);
      drops = [];
      for (var i = 0; i < cols; i++) drops.push(Math.random() * h / size);
      if (reduce) still();
    }
    // Reduced motion: one quiet frame of glyphs, no movement.
    function still() {
      ctx.font = "700 " + size + "px monospace";
      for (var i = 0; i < drops.length; i++)
        for (var y = 0; y < h; y += size * 2) if (Math.random() < 0.35) {
          ctx.fillStyle = "rgba(226, 47, 57, " + (0.25 + Math.random() * 0.4) + ")";
          ctx.fillText(glyph(), i * size, y);
        }
    }
    function step(t) {
      if (!canvas.isConnected) { stop(); return; }
      if (!visible || document.hidden) { frame = 0; return; }
      frame = window.requestAnimationFrame(step);
      if (t - last < 55) return;
      last = t;
      ctx.fillStyle = "rgba(5, 3, 6, 0.16)"; ctx.fillRect(0, 0, w, h);
      ctx.font = "700 " + size + "px monospace";
      for (var i = 0; i < drops.length; i++) {
        var y = drops[i] * size;
        ctx.fillStyle = "#ff8a90"; ctx.fillText(glyph(), i * size, y);
        ctx.fillStyle = "#4057f5"; ctx.fillText(glyph(), i * size, y - size);
        if (y > h && Math.random() > 0.975) drops[i] = 0;
        drops[i] += 1;
      }
    }
    function stop() {
      ro.disconnect(); if (io) io.disconnect();
      document.removeEventListener("visibilitychange", run);
    }
    function run() {
      if (!canvas.isConnected) { stop(); return; }
      if (!reduce && visible && !frame && !document.hidden) frame = window.requestAnimationFrame(step);
    }
    var ro = new ResizeObserver(resize);
    ro.observe(stage);
    var io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(function (e) {
      visible = e[0].isIntersecting; run();
    }) : null;
    if (io) io.observe(stage); else { visible = true; run(); }
    document.addEventListener("visibilitychange", run);
  }

  // Shared with the daily popup's launcher button (daily-popup.js).
  window.pcgMatrixRain = matrixRain;

  Widget.prototype.header = function () {
    var c = this.data.campaign;
    var daily = this.data.daily;
    var nodes = [];
    if (daily) {
      // Daily draw: today's product is the prize, and the clock runs to tonight's draw.
      var p = daily.prize;
      if (p && p.imageUrl) nodes.push(prizeStage(p));
      nodes.push(el("div", { class: "pcg__hero" }, [
        el("span", { class: "pcg__badge", text: "Daily Giveaway" }),
        el("h2", { class: "pcg__title", text: p ? p.title : c.title }),
        p ? el("p", { class: "pcg__prize" }, [
          document.createTextNode("Today's Prize"),
          p.url ? el("a", { class: "pcg__prize-link", href: p.url, text: "View" }) : null,
        ]) : el("p", { class: "pcg__prize", text: "Today's prize is being picked. Check back in a minute." }),
        el("p", { class: "pcg__timer-label", text: "Drawn Tonight In" }),
        (function (t) { t.classList.add("pcg__timer--daily"); return t; })(this.countdown(new Date(daily.drawAt))),
      ]));
      if (c.description) nodes.push(el("p", { class: "pcg__meta", text: c.description }));
      return head(nodes);
    }
    // "rain": the same stage as the daily prize (red digital rain, glow, floating image).
    if (c.imageUrl) nodes.push(c.imageBackdrop === "rain"
      ? prizeStage({ imageUrl: c.imageUrl, title: c.prize || c.title })
      : el("img", { class: "pcg__image", src: c.imageUrl, alt: c.prize || c.title, loading: "lazy" }));
    nodes.push(el("div", { class: "pcg__hero" }, [
      el("span", { class: "pcg__badge", text: "Giveaway" }),
      el("h2", { class: "pcg__title", text: c.title }),
      c.prize ? el("p", { class: "pcg__prize", text: c.prize }) : null,
      c.endsAt ? this.countdown(new Date(c.endsAt)) : null,
    ]));
    if (c.description) nodes.push(el("p", { class: "pcg__meta", text: c.description }));
    return head(nodes);
  };

  // Days / hours / minutes / seconds until the giveaway ends, ticking once a second.
  Widget.prototype.countdown = function (endsAt) {
    var units = [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]];
    var labels = { d: "Days", h: "Hours", m: "Mins", s: "Secs" };
    var cells = {};
    var box = el("div", { class: "pcg__timer", role: "timer", "aria-label": "Ends " + endsAt.toLocaleString() }, units.map(function (u) {
      cells[u[0]] = el("b", { text: "0", "aria-hidden": "true" });
      return el("div", {}, [cells[u[0]], el("span", { text: labels[u[0]], "aria-hidden": "true" })]);
    }));
    var self = this;
    var reloaded = false;
    function tick() {
      var left = Math.max(0, Math.floor((endsAt.getTime() - Date.now()) / 1000));
      // A daily draw just happened: fetch the next day's prize (and the new winner).
      if (left === 0 && self.data && self.data.daily && !reloaded) {
        reloaded = true;
        window.setTimeout(function () { self.load(); }, 90000);
      }
      units.forEach(function (u) {
        var v = Math.floor(left / u[1]);
        left -= v * u[1];
        cells[u[0]].textContent = u[0] === "d" ? String(v) : ("0" + v).slice(-2);
      });
    }
    tick();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(tick, 1000);
    return box;
  };

  // Sections every view shows: leaderboard, winners, rules and the free-entry link.
  Widget.prototype.extras = function (signup) {
    // The last daily winner sits under the prize in the wide layout, and after the tasks when
    // stacked; both copies are rendered and the CSS shows one.
    return head([this.upcoming(signup), this.lastDailyWinner("pcg__last-winner--side")])
      .concat(tasks([this.lastDailyWinner() || this.winnersLink(), this.winners(), this.leaderboard(), this.footer()]));
  };

  // The next few prizes the store has lined up (daily giveaways), under today's prize. A row of
  // small cards: "Tomorrow", then weekday dates. Left out of the short phone sign-up screen.
  Widget.prototype.upcoming = function (signup) {
    var list = this.data.daily && this.data.daily.upcoming;
    if (!list || !list.length || (signup && this.compact())) return null;
    var tomorrowKey = this.data.daily.tomorrow;
    var label = function (ymd) {
      if (ymd === tomorrowKey) return "Tomorrow";
      var d = new Date(ymd + "T12:00:00Z");
      return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
    };
    return el("div", { class: "pcg__upcoming" }, [
      el("h3", { class: "pcg__subheading", text: "Upcoming Prizes" }),
      el("ul", { class: "pcg__upcoming-list", role: "list" }, list.map(function (u) {
        var parts = u.items && u.items.length ? u.items : null;
        return el("li", { class: "pcg__upcoming-item" }, [
          parts
            ? el("span", { class: "pcg__upcoming-bundle", role: "img", "aria-label": u.title }, bundleArt(parts, "pcg__upcoming-part"))
            : u.imageUrl ? el("img", { src: u.imageUrl, alt: "", loading: "lazy" }) : el("span", { class: "pcg__upcoming-ph", "aria-hidden": "true", text: "🎁" }),
          el("span", { class: "pcg__upcoming-day", text: label(u.date) }),
          el("span", { class: "pcg__upcoming-title", text: u.title }),
        ]);
      })),
    ]);
  };

  Widget.prototype.lastDailyWinner = function (extraClass) {
    var w = this.data.daily && this.data.daily.lastWinner;
    if (!w) return null;
    return el("p", { class: "pcg__last-winner" + (extraClass ? " " + extraClass : "") }, [
      el("span", { text: "🏆 Last Winner: " }),
      el("b", { text: w.name }),
      document.createTextNode(" won " + w.prize),
      this.winnersLink(),
    ]);
  };

  // "See All Winners" button: opens the store's Giveaway Winners page (campaign.winnersPage).
  // Inside the last-winner box, or on its own when nobody has won yet.
  Widget.prototype.winnersLink = function () {
    var url = this.data.campaign && this.data.campaign.winnersPage;
    if (!url) return null;
    return el("a", { class: "pcg__btn pcg__btn--ghost pcg__btn--small pcg__winners-link", href: url, text: "🏆 See All Winners" });
  };

  Widget.prototype.leaderboard = function () {
    var rows = this.data.leaderboard;
    if (!rows || !rows.length) return null;
    var headingId = nextId("lb");
    return el("section", { class: "pcg__board", "aria-labelledby": headingId }, [
      el("h3", { class: "pcg__subheading", id: headingId, text: "Leaderboard" }),
      el("ol", { class: "pcg__board-list" }, rows.map(function (r) {
        return el("li", { class: "pcg__board-row" + (r.you ? " pcg__board-row--you" : "") }, [
          el("span", { class: "pcg__board-rank", text: String(r.rank) }),
          el("span", { class: "pcg__board-name", text: r.name + (r.you ? " (you)" : "") }),
          el("b", { class: "pcg__board-entries", text: String(r.entries) }),
          el("span", { class: "pcg__sr", text: plural(r.entries, " entry", " entries") }),
        ]);
      })),
    ]);
  };

  // Rendered whenever the server includes `winners`: [{ position, name }] after a draw, if the
  // merchant shows them. Ended giveaways send them with the "not open" error (see renderClosed).
  Widget.prototype.winners = function () {
    var list = this.data.winners;
    if (!list || !list.length) return null;
    var headingId = nextId("win");
    return el("section", { class: "pcg__winners", "aria-labelledby": headingId }, [
      el("h3", { class: "pcg__subheading", id: headingId, text: list.length === 1 ? "Winner" : "Winners" }),
      el("ol", { class: "pcg__winners-list" }, list.slice().sort(function (a, b) { return (a.position || 0) - (b.position || 0); }).map(function (w) {
        var name = typeof w === "string" ? w : w.name || "Winner";
        var prize = typeof w === "object" && w ? w.prize : null;
        return el("li", {}, [
          w.position ? el("span", { class: "pcg__winner-pos", text: "#" + w.position }) : null,
          el("span", { class: "pcg__winner-name", text: name }),
          prize ? el("span", { class: "pcg__winner-prize", text: prize }) : null,
        ]);
      })),
    ]);
  };

  // Signing up is free, so that is the free method of entry; the rules spell out the details.
  Widget.prototype.footer = function () {
    var c = this.data.campaign;
    if (!c.rulesText) return el("p", { class: "pcg__footer pcg__free", text: "No Purchase Necessary To Enter Or Win" });
    return el("details", { class: "pcg__footer pcg__rules" }, [
      el("summary", {}, [el("span", { text: "No Purchase Necessary" }), el("span", { "aria-hidden": "true", text: " · " }), el("u", { text: "Official Rules" })]),
      el("p", { text: c.rulesText }),
    ]);
  };

  // Counts a follow-button click for the daily click report (Whatnot follows stand in for
  // Whatnot sign-ups in the ad report). Fire-and-forget, once per button per browser per day;
  // runs after the link has opened and never throws.
  Widget.prototype.followClick = function (a) {
    try {
      if (!platformOf(a)) return;
      var key = "pcg:fc:" + this.slug + ":" + a.id;
      var today = new Date().toDateString();
      if (store(key) === today) return;
      store(key, today);
      var url = this.proxy + "/follow-click";
      var body = JSON.stringify({ giveaway: this.slug, action: a.id });
      var sent = false;
      if (navigator.sendBeacon) sent = navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }));
      if (!sent && window.fetch) {
        fetch(url, { method: "POST", body: body, keepalive: true, credentials: "same-origin", headers: { "Content-Type": "text/plain" } }).catch(function () {});
      }
    } catch (e) { /* never get in the way of the link */ }
  };

  Widget.prototype.smsAction = function () {
    return this.data.campaign.actions.filter(function (a) { return a.type === "SMS_OPTIN"; })[0] || null;
  };

  // Follow / join buttons in the brand's colors, with the entries on the button. Before sign-up
  // they're a preview: clicking one points the visitor at the email box.
  Widget.prototype.socialGrid = function (actions, entrant, done, locked) {
    var self = this;
    // Required ones (e.g. the Whatnot follow) come first, full width, and are never locked.
    actions = actions.filter(function (a) { return a.mandatory; }).concat(actions.filter(function (a) { return !a.mandatory; }));
    return el("ul", { class: "pcg__socials", role: "list" }, actions.map(function (a) {
      var platform = platformOf(a);
      var finished = !!done[a.id];
      var isLocked = locked && !a.mandatory;
      var error = el("p", { class: "pcg__error", role: "alert" });
      var pts = el("span", { class: "pcg__soc-pts" }, finished ? [icon("check"), document.createTextNode(" +" + a.entries)] : [document.createTextNode("+" + a.entries)]);
      var btn = el("button", {
        class: "pcg__soc pcg__soc--" + platform + (finished ? " pcg__soc--done" : "") + (a.mandatory ? " pcg__soc--req" : ""),
        type: "button",
        "aria-label": a.label + ", " + (finished ? "done, " : "") + entriesText(a.entries),
        onclick: function () {
          var url = (a.config && a.config.url) || a.url;
          if (!entrant) { self.focusEmail("Enter your email first, then tap to earn " + entriesText(a.entries) + "."); return; }
          if (url) { openExternal(url); self.followClick(a); }
          if (finished) return;
          if (isLocked) { error.textContent = "Complete the required step first to unlock this one."; return; }
          self.submitAction(a, {}, { error: error, button: btn }).catch(function () {});
        },
      }, [icon(platform), el("span", { class: "pcg__soc-name" }, [
        tc(a.label),
        a.mandatory && !finished ? el("small", { class: "pcg__soc-req", text: "Required To Enter" }) : null,
      ]), pts]);
      return el("li", { class: a.mandatory ? "pcg__socials-req" : null }, [btn, error]);
    }));
  };

  Widget.prototype.focusEmail = function (text) {
    var input = this.root.querySelector("input[type=email]");
    var err = this.root.querySelector(".pcg__form > .pcg__error");
    if (err) err.textContent = text;
    if (input) { input.focus(); input.scrollIntoView({ block: "center", behavior: "smooth" }); }
  };

  Widget.prototype.mountTurnstile = function (box, onToken) {
    var siteKey = this.data.turnstileSiteKey;
    if (!siteKey) return;
    var tries = 0;
    var mount = function () {
      if (!window.turnstile) { tries += 1; if (tries < 50) window.setTimeout(mount, 200); return; }
      box.__tsId = window.turnstile.render(box, {
        sitekey: siteKey,
        appearance: "interaction-only",
        callback: function (t) { onToken(t); },
        "expired-callback": function () { onToken(""); },
      });
    };
    mount();
  };

  // US-only giveaways: a required "I live in the US" box on both sign-up forms (checked on the server too).
  Widget.prototype.usBox = function () {
    if (this.data.campaign.usOnly === false) return { box: null, input: null };
    var input = el("input", { type: "checkbox", name: "us-resident", required: true });
    return {
      input: input,
      box: el("label", { class: "pcg__check" }, [input, el("span", {}, [
        "I live in the US and have a US shipping address.",
        el("span", { class: "pcg__req", text: " Required To Enter" }),
      ])]),
    };
  };
  var US_ERROR = "This giveaway is only open to people who live in the US. Tick the box to confirm you have a US shipping address.";

  Widget.prototype.signup = function (fields) {
    var self = this;
    this.email = fields.email;
    return this.request("POST", {
      intent: "signup",
      email: fields.email,
      name: fields.name,
      website: fields.website,
      consent: fields.consent,
      usResident: fields.usResident,
      phone: fields.phone,
      smsConsent: fields.smsConsent,
      ref: this.ref,
      turnstileToken: fields.turnstileToken,
      elapsedMs: Date.now() - this.renderedAt,
      deviceId: deviceId(),
      utm: utm(),
    }).then(function (res) { self.handleResult(res); });
  };

  // Texts: an optional number plus an unchecked consent box, worth the SMS action's entries.
  // Compact: the text sign-up opens from a button, so the first screen stays short.
  Widget.prototype.smsFields = function (compact) {
    var sms = this.smsAction();
    var phone = null, smsConsent = null, smsBox = null;
    if (sms) {
      var phoneId = nextId("tel");
      var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
      phone = el("input", { class: "pcg__input", id: phoneId, type: "tel", name: "phone", inputmode: "tel", autocomplete: "tel-national", placeholder: "(555) 234-5678", maxlength: "20" });
      smsConsent = el("input", { type: "checkbox", name: "sms-consent" });
      smsBox = el("div", { class: "pcg__sms" }, [
        el("label", { class: "pcg__label", for: phoneId }, [el("span", { text: "Mobile Number (Optional)" }), el("span", { class: "pcg__pts", text: tc(entriesText(sms.entries)) })]),
        phone,
        el("label", { class: "pcg__check pcg__check--fine" }, [smsConsent, el("span", {}, [
          (sms.config && sms.config.disclosure) || "",
          " ",
          el("a", { href: root + "policies/terms-of-service", target: "_blank", rel: "noopener", text: "Terms" }),
          " · ",
          el("a", { href: root + "policies/privacy-policy", target: "_blank", rel: "noopener", text: "Privacy" }),
        ])]),
      ]);
    }

    var smsToggle = null;
    if (smsBox && compact) {
      smsBox.hidden = true;
      smsToggle = el("button", {
        class: "pcg__more", type: "button", text: "+ Add Your Phone For " + tc(entriesText(sms.entries)),
        onclick: function () { smsBox.hidden = false; smsToggle.remove(); phone.focus(); },
      });
    }

    return { sms: sms, phone: phone, smsConsent: smsConsent, smsBox: smsBox, smsToggle: smsToggle };
  };

  // Signed in to a store account: one button instead of the email and name form (the server
  // takes both from the account). Asks for a name or the email opt-in only if the account lacks them.
  Widget.prototype.renderCustomerEntry = function (error) {
    var self = this;
    var c = this.data.customer;
    var nameId = nextId("name");
    var name = c.needsName ? el("input", { class: "pcg__input", id: nameId, type: "text", name: "name", autocomplete: "name", placeholder: "Ash Ketchum", required: true, maxlength: "80" }) : null;
    var consent = c.needsConsent ? el("input", { type: "checkbox", name: "consent", required: true }) : null;
    var us = this.usBox();
    var err = el("p", { class: "pcg__error", role: "alert", text: error || "" });
    var compact = this.compact();
    var formId = nextId("form");
    var button = el("button", { class: "pcg__btn pcg__btn--block", type: "submit", form: formId, text: this.data.daily ? "Enter Today's Giveaway" : "Enter Giveaway" });
    var smsF = this.smsFields(compact);
    var phone = smsF.phone, smsConsent = smsF.smsConsent;
    var form = el("form", {
      class: "pcg__form",
      id: formId,
      novalidate: true,
      onsubmit: function (e) {
        e.preventDefault();
        if (name && name.value.trim().split(/\s+/).filter(function (w) { return /[^\s\d\W_]/.test(w); }).length < 2) { err.textContent = "Enter your first and last name."; name.focus(); return; }
        if (consent && !consent.checked) { err.textContent = "Tick the email box to enter."; consent.focus(); return; }
        if (us.input && !us.input.checked) { err.textContent = US_ERROR; us.input.focus(); return; }
        if (phone && phone.value.trim() && !smsConsent.checked) { err.textContent = "Check the box to agree to texts, or leave the number blank."; smsConsent.focus(); return; }
        button.disabled = true;
        self.request("POST", {
          intent: "customer-signup",
          phone: phone && smsConsent.checked ? phone.value : undefined,
          smsConsent: !!(smsConsent && smsConsent.checked && phone.value.trim()),
          name: name ? name.value : undefined,
          consent: consent ? consent.checked : undefined,
          usResident: us.input ? us.input.checked : undefined,
          ref: self.ref,
          deviceId: deviceId(),
          utm: utm(),
        })
          .then(function (res) { self.handleResult(res); })
          .catch(function (e2) { err.textContent = e2.message; button.disabled = false; });
      },
    }, [
      el("p", { class: "pcg__signed-in", text: c.firstName ? "Signed In As " + c.firstName : "You're Signed In" }),
      name ? el("label", { class: "pcg__label", for: nameId, text: "First And Last Name" }) : null,
      name,
      consent ? el("label", { class: "pcg__check" }, [consent, el("span", {}, [
        "Email me deals, drops and stream alerts.",
        el("span", { class: "pcg__req", text: " Required To Enter" }),
      ])]) : null,
      us.box,
      smsF.smsBox,
      smsF.smsToggle,
      err,
      compact ? null : button,
      el("button", {
        class: "pcg__more", type: "button", text: "Use A Different Email",
        onclick: function () { self.useEmailForm = true; self.renderSignup(); },
      }),
    ]);

    var socials = this.data.campaign.actions.filter(function (a) { return platformOf(a) && !(a.config && a.config.daily); });
    var shop = this.shopBox();
    var preview = !compact && (socials.length || shop) ? tasks([
      el("h3", { class: "pcg__subheading", text: "Then Earn Bonus Entries" }),
      socials.length ? this.socialGrid(socials, null, {}, true) : null,
      shop,
    ]) : [];

    this.show(this.header().concat([el("div", { class: "pcg__box" }, [form])], preview, this.extras(true)));
    if (compact) this.setCta(button);
  };

  Widget.prototype.renderSignup = function (error) {
    var self = this;
    var emailId = nextId("email");
    var nameId = nextId("name");
    var email = el("input", { class: "pcg__input", id: emailId, type: "email", name: "email", required: true, autocomplete: "email", placeholder: "you@example.com" });
    var nameRequired = this.data.campaign.requireName !== false;
    var name = el("input", { class: "pcg__input", id: nameId, type: "text", name: "name", autocomplete: "name", placeholder: "Ash Ketchum", required: nameRequired, maxlength: "80" });
    // A field only bots fill. Its name matches no autofill category, so browsers and password
    // managers leave it empty.
    var honeypot = el("input", { type: "text", name: "pcg_hp_" + uid, tabindex: "-1", autocomplete: "off", "data-1p-ignore": "true", "data-lpignore": "true", "aria-hidden": "true" });
    var emailRequired = !!this.data.campaign.requireEmailConsent;
    var consent = el("input", { type: "checkbox", name: "consent", required: emailRequired });
    var us = this.usBox();
    var turnstileBox = el("div");
    var err = el("p", { class: "pcg__error", role: "alert", text: error || "" });
    var compact = this.compact();
    var formId = nextId("form");
    var button = el("button", { class: "pcg__btn pcg__btn--block", type: "submit", form: formId, text: compact ? "Enter Free" : this.data.daily ? "Enter Today's Giveaway" : "Enter Giveaway" });
    var turnstileToken = "";

    var smsF = this.smsFields(compact);
    var phone = smsF.phone, smsConsent = smsF.smsConsent, smsBox = smsF.smsBox, smsToggle = smsF.smsToggle;

    var form = el("form", {
      class: "pcg__form",
      id: formId,
      novalidate: true,
      onsubmit: function (e) {
        e.preventDefault();
        if (!email.value) { err.textContent = "Please enter your email."; email.focus(); return; }
        // First and last name, so a winner can be shown as "Emily S.".
        if (nameRequired && name.value.trim().split(/\s+/).filter(function (w) { return /[^\s\d\W_]/.test(w); }).length < 2) { err.textContent = "Enter your first and last name."; name.focus(); return; }
        if (emailRequired && !consent.checked) { err.textContent = "Tick the email box to enter."; consent.focus(); return; }
        if (us.input && !us.input.checked) { err.textContent = US_ERROR; us.input.focus(); return; }
        if (phone && phone.value.trim() && !smsConsent.checked) { err.textContent = "Check the box to agree to texts, or leave the number blank."; smsConsent.focus(); return; }
        button.disabled = true;
        // The bot check runs in the background; wait for it (up to 8s) rather than sending the
        // entry without its token, which would be refused.
        if (self.data.turnstileSiteKey && window.turnstile && !turnstileToken && !e.__waited) {
          var waited = 0, label = button.textContent;
          button.textContent = "One Moment…";
          var again = function () {
            if (turnstileToken || waited >= 8000) {
              button.textContent = label;
              var ev = new Event("submit", { cancelable: true });
              ev.__waited = true;
              form.dispatchEvent(ev);
              return;
            }
            waited += 250;
            window.setTimeout(again, 250);
          };
          again();
          return;
        }
        self.signup({
          email: email.value, name: name.value, website: honeypot.value, consent: consent.checked, usResident: us.input ? us.input.checked : undefined, turnstileToken: turnstileToken,
          phone: phone && smsConsent.checked ? phone.value : undefined, smsConsent: !!(smsConsent && smsConsent.checked && phone.value.trim()),
        })
          .catch(function (e2) {
            err.textContent = e2.message;
            button.disabled = false;
            if (window.turnstile && turnstileBox.__tsId !== undefined) window.turnstile.reset(turnstileBox.__tsId);
          });
      },
    }, [
      el("label", { class: "pcg__label", for: emailId, text: "Email" }),
      email,
      el("label", { class: "pcg__label", for: nameId, text: nameRequired ? "First And Last Name" : "Name (Optional)" }),
      name,
      el("div", { class: "pcg__hp", "aria-hidden": "true" }, [honeypot]),
      el("label", { class: "pcg__check" }, [consent, el("span", {}, [
        "Email me deals, drops and stream alerts.",
        emailRequired ? el("span", { class: "pcg__req", text: " Required To Enter" }) : null,
      ])]),
      us.box,
      smsToggle,
      smsBox,
      turnstileBox,
      err,
      compact ? null : button,
    ]);

    // A preview of the follow/join buttons, so visitors see what else they can earn.
    var socials = this.data.campaign.actions.filter(function (a) { return platformOf(a) && !(a.config && a.config.daily); });
    var shop = this.shopBox();
    var preview = !compact && (socials.length || shop) ? tasks([
      el("h3", { class: "pcg__subheading", text: "Then Earn Bonus Entries" }),
      socials.length ? this.socialGrid(socials, null, {}, true) : null,
      shop,
    ]) : [];

    this.show(this.header().concat([el("div", { class: "pcg__box" }, [form])], preview, this.extras(true)));
    if (compact) this.setCta(button);
    this.mountTurnstile(turnstileBox, function (t) { turnstileToken = t; });
  };

  // Ad conversions for a new entry (block settings): a Google Ads conversion and a Meta Pixel
  // "Lead", once per giveaway per browser, like the old GiveawayNinja tracking snippet did.
  Widget.prototype.trackEntry = function () {
    var sendTo = (this.root.getAttribute("data-gads") || "").trim();
    var pixel = (this.root.getAttribute("data-pixel") || "").trim();
    var key = "pcg:tracked:" + this.slug;
    if ((!sendTo && !pixel) || store(key)) return;
    store(key, "1");
    if (sendTo) {
      var aw = sendTo.split("/")[0];
      window.dataLayer = window.dataLayer || [];
      if (typeof window.gtag !== "function") {
        window.gtag = function () { window.dataLayer.push(arguments); };
        window.gtag("js", new Date());
        var s = document.createElement("script");
        s.async = true;
        s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(aw);
        document.head.appendChild(s);
      }
      try { window.gtag("config", aw); window.gtag("event", "conversion", { send_to: sendTo }); } catch (e) { /* ignore */ }
    }
    if (pixel) {
      if (typeof window.fbq !== "function") {
        /* eslint-disable */
        !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
        n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
        document,'script','https://connect.facebook.net/en_US/fbevents.js');
        /* eslint-enable */
      }
      try {
        window.fbq("init", pixel);
        window.fbq("trackSingle", pixel, "Lead", { content_name: "Giveaway Entry", content_category: "Giveaway" },
          { eventID: "pcg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10) });
      } catch (e) { /* ignore */ }
    }
  };

  Widget.prototype.handleResult = function (res) {
    if (res.token) store(this.tokenKey, res.token);
    if (res.state === "active") {
      this.trackEntry();
      // The bonus tasks slide in on the first view after entering (see giveaway.css).
      var root = this.root;
      root.classList.add("pcg--just-entered");
      window.setTimeout(function () { root.classList.remove("pcg--just-entered"); }, 1500);
      // Other widgets on the page (the popup, or the giveaway page's box) pick up the entry too.
      document.dispatchEvent(new CustomEvent("pcg:entered", { detail: { root: this.root } }));
      return this.load();
    }
    if (res.state === "held") return this.renderHeld();
    this.renderVerify();
  };

  Widget.prototype.renderVerify = function (error) {
    var self = this;
    var codeId = nextId("code");
    var code = el("input", { class: "pcg__input", id: codeId, inputmode: "numeric", autocomplete: "one-time-code", maxlength: "6", placeholder: "6-digit code" });
    var err = el("p", { class: "pcg__error", role: "alert", text: error || "" });
    var button = el("button", { class: "pcg__btn", type: "submit", text: "Confirm Entry" });
    var form = el("form", {
      class: "pcg__form",
      onsubmit: function (e) {
        e.preventDefault();
        button.disabled = true;
        self.request("POST", { intent: "verify", email: self.email, code: code.value })
          .then(function (res) { self.handleResult(res); })
          .catch(function (e2) { err.textContent = e2.message; button.disabled = false; });
      },
    }, [
      el("label", { class: "pcg__note", for: codeId, text: "We sent a code to " + (self.email || "your email") + ". Enter it to confirm your entry." }),
      code,
      err,
      button,
      el("button", { class: "pcg__btn pcg__btn--ghost", type: "button", text: "Use A Different Email", onclick: function () { self.renderSignup(); } }),
    ]);
    this.show(this.header().concat([form]));
    code.focus();
  };

  Widget.prototype.renderHeld = function () {
    this.show(this.header().concat([
      el("p", { class: "pcg__note", role: "status", text: "Thanks! Your entry is being reviewed and will count once it's approved." }),
    ], this.extras()));
  };

  Widget.prototype.referralLink = function () {
    var code = this.data.entrant && this.data.entrant.referralCode;
    // In the popup the page underneath is wherever the shopper happened to be (a product, a
    // collection), so friends get the giveaway's own page instead.
    var inPopup = !!(this.root.closest && this.root.closest(".pcg-pop"));
    var url;
    try {
      url = new URL(inPopup ? this.base : window.location.href, window.location.href);
    } catch (e) {
      // No usable page address (e.g. the admin's sandboxed preview).
      url = new URL("https://example.com" + this.base);
    }
    url.hash = "";
    ["ref", "format"].forEach(function (k) { url.searchParams.delete(k); });
    if (code) url.searchParams.set("ref", code);
    return url.toString();
  };

  Widget.prototype.shareText = function () {
    var c = this.data.campaign;
    return "Enter " + c.title + (c.prize ? " for a chance to win " + c.prize : "") + "!";
  };

  // Share buttons. onShare(networkId) runs after the share window opens (or the link is copied).
  Widget.prototype.shareButtons = function (only, onShare) {
    var link = this.referralLink();
    var text = this.shareText();
    // "share": every network but Copy Link (for boxes that already have their own Copy button).
    var networks = NETWORKS.filter(function (n) { return !only || only === "any" || (only === "share" ? n.id !== "copy" : n.id === only); });
    return el("div", { class: "pcg__share", role: "group", "aria-label": "Share" }, networks.map(function (n) {
      var btn = el("button", {
        class: "pcg__share-btn pcg__share-btn--" + n.id,
        type: "button",
        text: n.label,
        onclick: function () {
          if (n.id === "copy") {
            copyText(link).then(
              function () { btn.textContent = "Copied"; if (onShare) onShare(n.id); },
              function () { window.prompt("Copy Your Link", link); if (onShare) onShare(n.id); }
            );
            return;
          }
          openExternal(n.url(link, text), "noopener,width=600,height=540");
          if (onShare) onShare(n.id);
        },
      });
      return btn;
    }));
  };

  Widget.prototype.renderEntrant = function (entrant) {
    var self = this;
    var done = {};
    (entrant.completedActionIds || []).forEach(function (id) { done[id] = true; });
    var listed = this.data.campaign.actions.filter(function (a) { return !NOT_LISTED[a.type]; });
    // Daily Tasks get their own section (when the server sends their state).
    var dailyList = listed.filter(function (a) { return a.config && a.config.daily; });
    var all = listed.filter(function (a) { return dailyList.indexOf(a) === -1; });
    var requiredLeft = all.filter(function (a) { return a.mandatory && !done[a.id]; });
    var socials = all.filter(function (a) { return platformOf(a); });
    var actions = all.filter(function (a) { return socials.indexOf(a) === -1; });

    var nodes = this.header().concat([
      el("div", { class: "pcg__count", role: "status", "aria-live": "polite" }, [
        el("span", { text: this.data.daily ? "Your Entries Today" : plural(entrant.entries, "Your Entry", "Your Entries") }),
        el("b", { text: String(this.data.daily && this.data.daily.yourEntries !== null ? this.data.daily.yourEntries : entrant.entries) }),
      ]),
      this.enterTodayBox(),
      this.breakdown(entrant),
      this.linkedNote(),
    ]);

    // The referral box goes last, after the tasks and Shop & Earn (last in the tasks column when wide).
    var referral = this.data.campaign.actions.filter(function (a) { return a.type === "REFERRAL"; })[0];
    var refBox = referral && entrant.referralCode ? this.referralBox(referral) : null;

    var shop = this.shopBox();
    if (all.length || (dailyList.length && entrant.dailyTasks) || shop) {
      nodes = nodes.concat(tasks([
        el("h3", { class: "pcg__subheading", text: "Earn More Entries" }),
        requiredLeft.length
          ? el("p", { class: "pcg__note pcg__note--nudge", text: "Almost in: " + requiredLeft.map(function (a) { return a.label; }).join(" and ") + " to finish entering. Your entries count once " + plural(requiredLeft.length, "it's", "they're") + " done, and the other tasks unlock." })
          : null,
        socials.length ? this.socialGrid(socials, entrant, done, requiredLeft.length > 0) : null,
        this.dailyTasksBox(dailyList, entrant),
        actions.length ? el("ul", { class: "pcg__actions" }, actions.map(function (a) {
          return self.actionItem(a, entrant, !!done[a.id], !a.mandatory && requiredLeft.length > 0);
        })) : null,
        shop,
        refBox,
      ]));
    } else if (refBox) nodes.push(refBox);

    this.show(nodes.concat(this.extras()));
  };

  // "3h 12m" until `iso`, or "" once it has passed.
  function untilText(iso) {
    var ms = new Date(iso).getTime() - Date.now();
    if (!(ms > 0)) return "";
    var m = Math.ceil(ms / 60000), h = Math.floor(m / 60);
    return h ? h + "h " + (m % 60) + "m" : m + "m";
  }
  // "5:00 PM" in Central Time, for scheduled tasks.
  function centralTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }) + " CT";
    } catch (e) { return ""; }
  }
  // "Fri 5:00 PM CT", for when a scheduled task opens next.
  function centralDayTime(iso) {
    try {
      return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" }) + " CT";
    } catch (e) { return ""; }
  }
  // Keeps a text node counting down each minute while it's on the page.
  function ticking(node, fn) {
    node.textContent = fn();
    var id = window.setInterval(function () {
      if (!node.isConnected) { window.clearInterval(id); return; }
      node.textContent = fn();
    }, 30000);
    return node;
  }

  // Daily Tasks: locked until the follow tasks are done, then claimable once per day (the
  // server decides, see app/lib/daily-tasks.ts). Scheduled tasks only show while open.
  Widget.prototype.dailyTasksBox = function (list, entrant) {
    var self = this;
    var dt = entrant.dailyTasks;
    if (!dt || !list.length) return null;
    var rows = list.filter(function (a) {
      var st = dt.tasks[a.id];
      // Scheduled tasks show while open, and as "Opens Fri 5:00 PM CT" until then (not when switched off).
      return st && (!a.config.schedule || st.open || st.nextAt);
    });
    if (!rows.length) return null;
    var reset = ticking(el("span", { class: "pcg__daily-reset" }), function () {
      var t = untilText(dt.resetsAt);
      return t ? "Resets In " + t : "Resetting Now";
    });
    var head = el("div", { class: "pcg__daily-head" }, [
      el("div", {}, [
        el("h3", { class: "pcg__subheading", text: "Daily Tasks" }),
        el("p", { class: "pcg__daily-sub", text: "Come Back Every Day To Earn More Entries!" }),
      ]),
      dt.unlocked ? reset : null,
    ]);
    var lockNote = null;
    if (!dt.unlocked) {
      var doneCount = dt.needCount - dt.needed.length;
      lockNote = el("div", { class: "pcg__daily-lock" }, [
        el("p", { class: "pcg__lock", text: "Complete All " + dt.needCount + " Social Tasks To Unlock Daily Entries!" }),
        el("div", { class: "pcg__daily-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(dt.needCount), "aria-valuenow": String(doneCount) }, [
          el("span", { style: "width:" + Math.round((doneCount / Math.max(1, dt.needCount)) * 100) + "%" }),
        ]),
        el("small", { class: "pcg__daily-left", text: doneCount + " Of " + dt.needCount + " Done" + (dt.needed.length ? " · Still To Do: " + dt.needed.map(tc).join(", ") : "") }),
      ]);
    }
    return el("div", { class: "pcg__daily" + (dt.unlocked ? "" : " pcg__daily--locked") }, [
      head,
      lockNote,
      el("ul", { class: "pcg__daily-list", role: "list" }, rows.map(function (a) {
        return self.dailyTaskItem(a, dt.tasks[a.id], dt);
      })),
    ]);
  };

  Widget.prototype.dailyTaskItem = function (a, st, dt) {
    var self = this;
    var cfg = a.config || {};
    // A scheduled task between its windows: shown so people know when to come back.
    var upcoming = !!(cfg.schedule && !st.open && st.nextAt);
    var locked = !dt.unlocked || upcoming;
    var error = el("p", { class: "pcg__error", role: "alert" });
    var label = cfg.live ? "Join Our Live Whatnot Show" : tc(a.label);
    var status;
    if (st.done) {
      status = cfg.schedule
        ? el("small", { class: "pcg__daily-when", text: "Done For This Show" })
        : ticking(el("small", { class: "pcg__daily-when" }), function () {
            var t = untilText(dt.resetsAt);
            return t ? "Done Today. Back In " + t : "Done Today";
          });
    } else if (upcoming) {
      status = ticking(el("small", { class: "pcg__daily-when" }), function () {
        var t = untilText(st.nextAt);
        return t && new Date(st.nextAt).getTime() - Date.now() < 86400000 ? "Opens In " + t : "Opens " + centralDayTime(st.nextAt);
      });
      // Reopen the widget's data when the window starts, so the button turns on by itself.
      var wait = new Date(st.nextAt).getTime() - Date.now() + 2000;
      if (wait > 0 && wait < 86400000) window.setTimeout(function () { if (btn.isConnected) self.load(); }, wait);
    } else if (cfg.schedule && st.closesAt) {
      status = el("small", { class: "pcg__daily-when", text: "Open Until " + centralTime(st.closesAt) });
    }
    var btnText = cfg.live ? "🔴 LIVE ON WHATNOT — JOIN NOW" : cfg.confirm ? (st.url ? "Open" : tc(cfg.confirm)) : st.url ? "Go" : "Claim";
    var started = null;
    var btn = el("button", {
      class: "pcg__btn pcg__btn--small pcg__daily-btn" + (cfg.live ? " pcg__daily-btn--live" : ""),
      type: "button",
      disabled: st.done || locked ? true : null,
      text: st.done ? "Done ✓" : upcoming ? "Opens Soon" : locked ? "Locked" : btnText,
      onclick: function () {
        if (st.done || locked) return;
        // Open the link inside the click so popup blockers allow it.
        if (st.url && !started) openExternal(st.url);
        if (st.url && !started) self.followClick(a);
        if (cfg.confirm && !started) {
          // Step 1 opened the link; step 2 ("I Liked & Commented") claims a few seconds later.
          self.submitAction(a, { step: "start" }, { error: error, button: btn }).then(function (res) {
            started = res.started;
            btn.disabled = false;
            btn.textContent = tc(cfg.confirm);
            hint.hidden = false;
          }).catch(function () {});
          return;
        }
        self.submitAction(a, started ? { step: "done", started: started } : {}, { error: error, button: btn }).catch(function () {});
      },
    });
    var hint = el("small", { class: "pcg__daily-hint", hidden: true, text: cfg.verified ? "Tap once it's done. We check this one." : "Tap after you like and comment. It's on the honor system." });
    var cls = "pcg__daily-task" + (st.done ? " pcg__daily-task--done" : "") + (cfg.live ? " pcg__daily-task--live" : "") + (locked ? " pcg__daily-task--locked" : "");
    return el("li", { class: cls }, [
      el("div", { class: "pcg__daily-info" }, [
        el("span", { class: "pcg__daily-label", text: label }),
        cfg.live ? el("small", { class: "pcg__daily-sub", text: "Join Our Friday Live Show And Earn " + a.entries + " Giveaway Entries!" }) : null,
        status,
        hint,
      ]),
      el("span", { class: "pcg__pill", text: "+" + a.entries }),
      btn,
      error,
    ]);
  };

  // Daily draws only count the day's entries, so returning players enter again each day.
  Widget.prototype.enterTodayBox = function () {
    var self = this;
    var d = this.data.daily;
    if (!d || d.enteredToday !== false) return null;
    var error = el("p", { class: "pcg__error", role: "alert" });
    var btn = el("button", {
      type: "button",
      class: "pcg__btn pcg__btn--block",
      text: "Enter Today's Giveaway",
      onclick: function () {
        btn.disabled = true;
        error.textContent = "";
        self.request("POST", { intent: "enter-today" })
          .then(function () { self.load(); })
          .catch(function (e) { error.textContent = e.message; btn.disabled = false; });
      },
    });
    return el("div", { class: "pcg__enter-today" }, [
      el("p", { class: "pcg__note pcg__note--nudge", text: "You're not in today's draw yet. Tap below to enter. It's a new draw every day." }),
      btn,
      error,
    ]);
  };

  // "Shop & earn": the purchase-entry rate, a Shop now link and example products with the
  // entries each one earns. Orders are entered automatically, so there's nothing to tap here.
  Widget.prototype.shopBox = function () {
    var shop = this.data.shop;
    if (!shop || !shop.rate) return null;
    var price = function (n) { return "$" + (Math.round(n * 100) % 100 ? n.toFixed(2) : String(Math.round(n))); };
    var items = (shop.items || []).filter(function (p) { return p.entries > 0; });
    return el("div", { class: "pcg__shop" }, [
      el("div", { class: "pcg__shop-head" }, [
        icon("bag"),
        el("span", { class: "pcg__shop-text" }, [el("b", { text: "Shop & Earn" }), el("small", { text: tc(shop.rate) })]),
        el("a", { class: "pcg__shop-btn", href: shop.url || "/collections/all", text: "Shop Now" }),
      ]),
      items.length ? el("ul", { class: "pcg__shop-items", role: "list" }, items.map(function (p) {
        return el("li", {}, [el("a", { class: "pcg__shop-item", href: p.url, "aria-label": p.title + ", " + price(p.price) + ", " + entriesText(p.entries) }, [
          el("span", { class: "pcg__shop-img" }, [p.imageUrl ? el("img", { src: p.imageUrl, alt: "", loading: "lazy" }) : null]),
          el("span", { class: "pcg__shop-name", text: p.title }),
          el("span", { class: "pcg__shop-row" }, [
            el("span", { class: "pcg__shop-price", text: price(p.price) }),
            el("span", { class: "pcg__shop-pts", text: "+" + p.entries }),
          ]),
        ])]);
      })) : null,
      el("p", { class: "pcg__shop-note", text: "Check out with the email you entered with and your entries are added automatically." }),
    ]);
  };

  // One sign-up enters both linked giveaways; say so, with a way to the other one.
  Widget.prototype.linkedNote = function () {
    var l = this.data.linked;
    if (!l) return null;
    var text = l.daily
      ? "You're also in today's daily draw" + (l.prize ? " for " + l.prize : "") + "."
      : "You're also entered in " + l.title + ".";
    var href = l.daily ? "#daily-giveaway" : "/apps/packs/campaigns/" + encodeURIComponent(l.slug);
    return el("p", { class: "pcg__linked" }, [
      el("span", { text: text + " " }),
      el("a", { href: href, text: l.daily ? "See Today's Prize" : "View" }),
    ]);
  };

  // "My Entries": where the total came from.
  Widget.prototype.breakdown = function (entrant) {
    var b = entrant.breakdown;
    if (!b) return null;
    var rows = [["Signing Up", b.signup], ["Actions", b.actions], ["Purchases", b.purchases], ["Referrals", b.referrals], ["Adjustments", b.other]]
      .filter(function (r) { return r[1]; });
    if (!rows.length) return null;
    return el("details", { class: "pcg__mine" }, [
      el("summary", { text: "My Entries" }),
      el("dl", { class: "pcg__mine-list" }, rows.reduce(function (out, r) {
        return out.concat([el("dt", { text: r[0] }), el("dd", { text: (r[1] > 0 ? "+" : "") + r[1] })]);
      }, [])),
    ]);
  };

  // Runs an action request with shared busy / error / success handling.
  Widget.prototype.submitAction = function (a, extra, ctx) {
    var self = this;
    var body = { intent: "action", actionId: a.id };
    Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
    if (ctx.button) ctx.button.disabled = true;
    ctx.error.textContent = "";
    return this.request("POST", body)
      .then(function (res) {
        if (res.awarded === false && (a.type === "DAILY_CHECKIN" || a.repeatable || (a.config && a.config.daily))) {
          ctx.error.textContent = a.config && a.config.schedule ? "Already counted for this show." : "Already counted today. Come back tomorrow.";
          if (ctx.button) ctx.button.disabled = false;
          return res;
        }
        if (body.step !== "start") self.load();
        return res;
      })
      .catch(function (e2) {
        ctx.error.textContent = e2.message;
        if (ctx.button) ctx.button.disabled = false;
        throw e2;
      });
  };

  Widget.prototype.actionItem = function (a, entrant, isDone, locked) {
    var cfg = a.config || {};
    var repeats = a.type === "DAILY_CHECKIN" || a.repeatable;
    var finished = isDone && !repeats;
    var error = el("p", { class: "pcg__error", role: "alert" });
    var labelId = nextId("act");
    var head = el("div", { class: "pcg__action-head" }, [
      el("span", { class: "pcg__action-label", id: labelId }, [
        tc(a.label),
        a.mandatory ? el("span", { class: "pcg__req", text: "Required" }) : null,
      ]),
      el("span", { class: "pcg__pill", text: finished ? "Done +" + a.entries : "+" + a.entries }),
    ]);
    var body = finished ? this.doneBody(a, entrant) : locked ? null : this.actionBody(a, entrant, cfg, error);
    var cls = "pcg__action" + (finished ? " pcg__action--done" : "") + (locked && !finished ? " pcg__action--locked" : "") + (a.mandatory ? " pcg__action--required" : "");
    return el("li", { class: cls, "aria-labelledby": labelId }, [head, body, locked && !finished ? el("p", { class: "pcg__lock", text: "Locked" }) : null, error]);
  };

  // What a completed action still shows: poll results or the entrant's answer.
  Widget.prototype.doneBody = function (a, entrant) {
    var answer = entrant.answers && entrant.answers[a.id];
    if (a.type === "POLL") return this.pollResults(a, entrant);
    if (a.type === "QUESTION" && answer) return el("p", { class: "pcg__answered", text: "Your Answer: " + answer });
    return null;
  };

  Widget.prototype.pollResults = function (a, entrant) {
    var counts = (entrant.pollResults && entrant.pollResults[a.id]) || {};
    var mine = entrant.answers && entrant.answers[a.id];
    var total = Object.keys(counts).reduce(function (s, k) { return s + counts[k]; }, 0) || 1;
    return el("div", { class: "pcg__poll" }, [
      a.config.question ? el("p", { class: "pcg__question", text: a.config.question }) : null,
      el("ul", { class: "pcg__results" }, (a.config.options || []).map(function (o) {
        var pct = Math.round(((counts[o] || 0) / total) * 100);
        return el("li", { class: "pcg__result" + (o === mine ? " pcg__result--mine" : "") }, [
          el("span", { class: "pcg__result-bar", style: "width:" + pct + "%", "aria-hidden": "true" }),
          el("span", { class: "pcg__result-label", text: o + (o === mine ? " (your vote)" : "") }),
          el("b", { text: pct + "%" }),
        ]);
      })),
    ]);
  };

  Widget.prototype.actionBody = function (a, entrant, cfg, error) {
    var self = this;
    var ctx = { error: error };
    var btn = function (text, onclick, extraClass) {
      var b = el("button", { class: "pcg__btn pcg__btn--small" + (extraClass || ""), type: "button", text: text, onclick: onclick });
      return b;
    };

    switch (a.type) {
      case "POLL": {
        var question = cfg.question ? el("p", { class: "pcg__question", text: cfg.question }) : null;
        var group = el("div", { class: "pcg__options", role: "group", "aria-label": cfg.question || a.label });
        (cfg.options || []).forEach(function (o) {
          var b = btn(o, function () {
            Array.prototype.forEach.call(group.children, function (c) { c.disabled = true; });
            ctx.button = null;
            self.submitAction(a, { answer: o }, ctx).catch(function () {
              Array.prototype.forEach.call(group.children, function (c) { c.disabled = false; });
            });
          }, " pcg__btn--option");
          group.appendChild(b);
        });
        return el("div", { class: "pcg__action-body" }, [question, group]);
      }

      case "QUESTION": {
        var inputId = nextId("q");
        var left = entrant.quizAttemptsLeft ? entrant.quizAttemptsLeft[a.id] : undefined;
        var input = el("input", { class: "pcg__input", id: inputId, type: "text", maxlength: "500", autocomplete: "off", placeholder: "Your Answer" });
        var submit = el("button", { class: "pcg__btn pcg__btn--small", type: "submit", text: "Submit" });
        var hint = cfg.quiz ? el("p", { class: "pcg__hint", text: left === 0 ? "No tries left today." : (left === undefined ? 3 : left) + plural(left === undefined ? 3 : left, " try", " tries") + " left today." }) : null;
        if (left === 0) { input.disabled = true; submit.disabled = true; }
        ctx.button = submit;
        var form = el("form", {
          class: "pcg__inline-form",
          onsubmit: function (e) {
            e.preventDefault();
            if (!input.value.trim()) { error.textContent = "Please type an answer."; input.focus(); return; }
            self.submitAction(a, { answer: input.value }, ctx).catch(function (e2) {
              var d = e2.data || {};
              if (hint && typeof d.attemptsLeft === "number") hint.textContent = d.attemptsLeft + plural(d.attemptsLeft, " try", " tries") + " left today.";
              if (d.attemptsLeft === 0) { input.disabled = true; submit.disabled = true; }
            });
          },
        }, [el("label", { class: "pcg__question", for: inputId, text: cfg.question || a.label }), el("div", { class: "pcg__row" }, [input, submit])]);
        return el("div", { class: "pcg__action-body" }, [form, hint]);
      }

      case "SECRET_CODE": {
        var codeId = nextId("sc");
        var code = el("input", { class: "pcg__input", id: codeId, type: "text", autocomplete: "off", placeholder: "Code" });
        var go = el("button", { class: "pcg__btn pcg__btn--small", type: "submit", text: "Submit" });
        ctx.button = go;
        return el("form", {
          class: "pcg__inline-form pcg__action-body",
          onsubmit: function (e) { e.preventDefault(); self.submitAction(a, { code: code.value }, ctx).catch(function () {}); },
        }, [el("label", { class: "pcg__sr", for: codeId, text: "Secret Code" }), el("div", { class: "pcg__row" }, [code, go])]);
      }

      case "SMS_OPTIN": {
        // The box starts unchecked and the server refuses the entries without it.
        var telId = nextId("tel");
        var tel = el("input", { class: "pcg__input", id: telId, type: "tel", inputmode: "tel", autocomplete: "tel-national", placeholder: "(555) 234-5678", maxlength: "20" });
        var agree = el("input", { type: "checkbox", name: "sms-consent" });
        var send = el("button", { class: "pcg__btn pcg__btn--small", type: "submit", text: "Sign Up" });
        var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
        ctx.button = send;
        return el("form", {
          class: "pcg__inline-form pcg__action-body",
          onsubmit: function (e) {
            e.preventDefault();
            if (!tel.value.trim()) { error.textContent = "Enter your mobile number."; tel.focus(); return; }
            if (!agree.checked) { error.textContent = "Check the box to agree to text messages."; agree.focus(); return; }
            self.submitAction(a, { phone: tel.value, consent: true }, ctx).catch(function () {});
          },
        }, [
          el("label", { class: "pcg__sr", for: telId, text: "Mobile Number" }),
          el("div", { class: "pcg__row" }, [tel, send]),
          el("label", { class: "pcg__check" }, [agree, el("span", { class: "pcg__hint", text: cfg.disclosure || "" })]),
          el("p", { class: "pcg__hint" }, [
            el("a", { href: root + "policies/terms-of-service", target: "_blank", rel: "noopener", text: "Terms" }),
            " · ",
            el("a", { href: root + "policies/privacy-policy", target: "_blank", rel: "noopener", text: "Privacy Policy" }),
          ]),
        ]);
      }

      case "WATCH_VIDEO":
        return this.videoBody(a, cfg, ctx);

      case "SOCIAL_SHARE":
        return el("div", { class: "pcg__action-body" }, [
          el("p", { class: "pcg__hint", text: "Share your entry link" + (cfg.network === "x" ? " on X" : cfg.network === "facebook" ? " on Facebook" : "") + "." }),
          this.shareButtons(cfg.network || "any", function (network) {
            if (ctx.sent) return;
            ctx.sent = true;
            self.submitAction(a, { network: network }, ctx).catch(function () { ctx.sent = false; });
          }),
        ]);

      default: {
        // VISIT_URL, SOCIAL_FOLLOW, DAILY_CHECKIN, CUSTOM.
        var url = cfg.url || a.url;
        var b = btn(a.type === "DAILY_CHECKIN" ? "Check In" : a.type === "SOCIAL_FOLLOW" ? "Follow" : url ? "Visit" : "Done", function () {
          if (url) { openExternal(url); self.followClick(a); }
          self.submitAction(a, {}, ctx).catch(function () {});
        });
        ctx.button = b;
        return el("div", { class: "pcg__action-body pcg__action-body--end" }, [b]);
      }
    }
  };

  // Video: opening it asks the server for a signed start time; the claim button unlocks after
  // config.seconds and the server checks the elapsed time again.
  Widget.prototype.videoBody = function (a, cfg, ctx) {
    var self = this;
    var key = VIDEO_KEY + a.id;
    var seconds = cfg.seconds || 0;
    var saved = null;
    try { saved = JSON.parse(store(key) || "null"); } catch (e) { saved = null; }
    var status = el("p", { class: "pcg__hint", "aria-live": "polite" });
    var claim = el("button", { class: "pcg__btn pcg__btn--small", type: "button", text: "Claim Entries", disabled: true });
    var watch = el("a", { class: "pcg__btn pcg__btn--small pcg__btn--ghost", href: cfg.url || "#", target: "_blank", rel: "noopener", text: saved ? "Watch Again" : "Watch Video" });
    var tick;
    ctx.button = claim;

    function run(started) {
      window.clearInterval(tick);
      var update = function () {
        var left = Math.max(0, Math.ceil((started.at + seconds * 1000 - Date.now()) / 1000));
        if (left > 0) {
          status.textContent = "Keep the video open: " + left + "s to go.";
          claim.disabled = true;
        } else {
          window.clearInterval(tick);
          status.textContent = "Thanks for watching!";
          claim.disabled = false;
        }
      };
      update();
      tick = window.setInterval(update, 1000);
    }

    watch.addEventListener("click", function () {
      self.submitAction(a, { step: "start" }, { error: ctx.error }).then(function (res) {
        var started = { token: res.started, at: Date.now() };
        store(key, JSON.stringify(started));
        saved = started;
        run(started);
      }).catch(function () {});
    });
    claim.addEventListener("click", function () {
      if (!saved) return;
      self.submitAction(a, { started: saved.token }, ctx).then(function () { store(key, null); }).catch(function () {});
    });
    if (saved) run(saved);
    else status.textContent = seconds ? "Watch for " + seconds + " seconds to earn " + plural(a.entries, "this entry.", "these entries.") : "Open the video to earn " + plural(a.entries, "this entry.", "these entries.");
    return el("div", { class: "pcg__action-body" }, [status, el("div", { class: "pcg__row" }, [watch, claim])]);
  };

  Widget.prototype.referralBox = function (referral) {
    var link = this.referralLink();
    var inputId = nextId("ref");
    var input = el("input", { class: "pcg__input", id: inputId, readonly: true, value: link });
    var copy = el("button", {
      class: "pcg__btn pcg__btn--small", type: "button", text: "Copy",
      onclick: function () {
        copyText(link, input).then(function () { copy.textContent = "Copied"; }, function () { input.select(); });
      },
    });
    return el("div", { class: "pcg__ref" }, [
      el("label", { class: "pcg__note", for: inputId, text: "Get +" + referral.entries + plural(referral.entries, " Entry", " Entries") + " For Every Friend Who Enters With Your Link" }),
      el("div", { class: "pcg__row" }, [input, copy]),
    ]);
  };

  function boot() {
    document.querySelectorAll("[data-pcg]").forEach(function (root) {
      if (root.__pcg) return;
      root.__pcg = new Widget(root);
      root.__pcg.load();
      document.addEventListener("pcg:entered", function (e) {
        var w = root.__pcg;
        if (e.detail && e.detail.root !== root && w && !(w.data && w.data.entrant)) w.load();
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  // Re-run when the block is added in the theme editor.
  document.addEventListener("shopify:section:load", boot);
})();
