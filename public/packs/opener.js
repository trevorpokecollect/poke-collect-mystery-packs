// My Packs page: lists the customer's packs and plays the opening animation.
// The card is fetched only when a pack is opened, and was decided on the server at payment.
(function () {
  "use strict";

  var root = document.getElementById("mystery-packs");
  // Loaded without the My Packs page (e.g. the product page's demo button): only the opening
  // animation is used, through window.PCPackOpener.
  var standalone = !root;

  var api = (root && root.getAttribute("data-api")) || "/apps/packs/api";
  // Merchant preview (?demo=<signed token>): sample packs from the live pool, opened locally.
  var demo = !!root && root.getAttribute("data-demo") === "1";
  var demoData = null;
  var params = new URLSearchParams(window.location.search);
  // Arriving from the thank-you page button (?open=1) starts opening right away, once.
  var autoOpen = params.get("open") === "1";
  params.delete("open");
  var query = params.toString() ? "?" + params.toString() : ""; // keeps the ?k= order link token for guests
  if (autoOpen && window.history.replaceState) {
    window.history.replaceState(null, "", window.location.pathname + query + window.location.hash);
  }
  var TIER_COLORS = {
    base: "#9aa0a6",
    uncommon: "#2fa36b",
    rare: "#2f6fe0",
    epic: "#8b46e0",
    chase: "#e0a21a",
    // Value tiers used by auto-built pools, colored like their Poké Balls.
    poke: "#e3350d",
    great: "#2f6fe0",
    ultra: "#e0a21a",
    master: "#8b46e0",
  };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === "text") node.textContent = attrs[key];
      else if (key === "class") node.className = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  function tierKey(tier) {
    return String(tier || "").trim().toLowerCase();
  }

  function packTile(pack, onOpen) {
    // Use the pack product's own artwork when it has one; otherwise draw the CSS foil pack.
    var art = pack.packImageUrl;
    var button = el("button", { class: "mp-pack" + (art ? " mp-pack-art" : ""), type: "button", "aria-label": "Open " + pack.series }, art
      ? [
          el("img", { class: "mp-pack-img", src: art, alt: "" }),
          el("span", { class: "mp-pack-foil", "aria-hidden": "true" }),
          el("span", { class: "mp-pack-label", text: "Tap To Open" }),
        ]
      : [
          el("span", { class: "mp-pack-foil", "aria-hidden": "true" }),
          el("span", { class: "mp-pack-brand", text: "Poke-Collect" }),
          el("span", { class: "mp-pack-emblem", "aria-hidden": "true" }),
          el("span", { class: "mp-pack-series", text: pack.series }),
          el("span", { class: "mp-pack-label", text: "Tap To Open" }),
        ]);
    if (onOpen) button.addEventListener("click", function () { onOpen(pack); });
    return button;
  }

  var SHIP_LABELS = {
    preparing: "Preparing to ship",
    shipped: "Shipped",
    pickup_ready: "Ready for pickup",
    picked_up: "Picked up",
  };

  function shipBadge(pack) {
    var ship = pack.shipping || { state: "preparing" };
    var badge = el("span", { class: "mp-ship", "data-state": ship.state, text: SHIP_LABELS[ship.state] || SHIP_LABELS.preparing });
    if (ship.state === "shipped" && ship.tracking && ship.tracking.url) {
      return el("span", { class: "mp-ship-wrap" }, [
        badge,
        el("a", { class: "mp-track", href: ship.tracking.url, target: "_blank", rel: "noopener", text: "Track" }),
      ]);
    }
    return badge;
  }

  function cardTile(pack) {
    var card = pack.card;
    return el("div", { class: "mp-card" }, [
      card.imageUrl ? el("img", { src: card.imageUrl, alt: card.title, loading: "lazy" }) : null,
      el("div", { class: "mp-card-title", text: card.title }),
      el("div", { class: "mp-card-meta" }, [
        el("span", { class: "mp-tier", "data-tier": tierKey(card.tier), text: card.tier }),
        el("span", { text: "Order " + pack.orderName }),
      ]),
      shipBadge(pack),
    ]);
  }

  // How the pulled card gets to the customer.
  function shippingInfo() {
    var steps = [
      ["Open every pack", "Your cards ship together with the rest of your order once every pack on it is opened. Packs you don't open within 24 hours are opened for you, so nothing gets held up."],
      ["We pack it with care", "Every card is sleeved and top loaded before it goes out."],
      ["Track it here", "Each card above shows Preparing to ship, then Shipped with a tracking link. You'll also get a shipping email from us."],
      ["Local pickup", "Chose pickup at checkout? Your card is ready for pickup as soon as you open your pack."],
    ];
    return el("section", { class: "mp-info" }, [
      el("h2", { class: "mp-section-title", text: "How your card ships" }),
      el("div", { class: "mp-info-grid" }, steps.map(function (s, i) {
        return el("div", { class: "mp-info-item" }, [
          el("span", { class: "mp-info-num", text: String(i + 1) }),
          el("div", {}, [el("strong", { text: s[0] }), el("p", { text: s[1] })]),
        ]);
      })),
      el("p", { class: "mp-info-note", text: "Free shipping when you buy 5 or more packs." }),
    ]);
  }

  // The theme's own "You Might Also Like" row (its pc-product-rows section, rendered for the pack), so it
  // matches the rest of the store. Falls back to a simple grid if the theme doesn't have it.
  var THEME_SECTION = "pc-product-rows";
  function themeRecommendations(handle, productId) {
    var holder = el("div", { class: "mp-theme-recs" });
    if (!handle) {
      holder.appendChild(recommendations(productId));
      return holder;
    }
    fetch("/products/" + encodeURIComponent(handle) + "?section_id=" + THEME_SECTION, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (html) {
        if (!html || html.indexOf("data-pr") === -1) throw new Error("no section");
        var tpl = document.createElement("template");
        tpl.innerHTML = html;
        // Scripts parsed from HTML don't run; recreate them so the row fills itself in.
        tpl.content.querySelectorAll("script").forEach(function (old) {
          var s = document.createElement("script");
          s.textContent = old.textContent;
          old.replaceWith(s);
        });
        holder.appendChild(tpl.content);
      })
      .catch(function () { holder.appendChild(recommendations(productId)); });
    return holder;
  }

  // "You Might Also Like": Shopify's storefront recommendations, minus mystery packs and sold-out items.
  function recommendations(productId) {
    var section = el("section", { class: "mp-recs", hidden: "" }, [
      el("h2", { class: "mp-section-title", text: "You Might Also Like" }),
    ]);
    var grid = el("div", { class: "mp-recs-grid" });
    section.appendChild(grid);

    function cents(p) {
      if (p.price == null && p.variants && p.variants[0]) return Math.round(Number(p.variants[0].price) * 100);
      return typeof p.price === "number" ? p.price : Math.round(Number(p.price) * 100);
    }
    function image(p) {
      var src = p.featured_image || (p.images && p.images[0] && (p.images[0].src || p.images[0])) || null;
      if (src && typeof src === "object") src = src.src || src.url;
      if (!src) return null;
      if (src.indexOf("//") === 0) src = "https:" + src;
      return src + (src.indexOf("?") === -1 ? "?" : "&") + "width=400";
    }
    function show(products) {
      var items = (products || []).filter(function (p) {
        var type = String(p.type || p.product_type || "").toLowerCase();
        var available = p.available !== undefined ? p.available : (p.variants || []).some(function (v) { return v.available; });
        return type !== "mystery pack" && available !== false;
      }).slice(0, 8);
      if (!items.length) return false;
      items.forEach(function (p) {
        var url = p.url || "/products/" + p.handle;
        var src = image(p);
        grid.appendChild(el("a", { class: "mp-rec", href: url }, [
          el("span", { class: "mp-rec-img" }, [src ? el("img", { src: src, alt: "", loading: "lazy" }) : null]),
          el("span", { class: "mp-rec-title", text: p.title }),
          el("span", { class: "mp-rec-price", text: money(cents(p) / 100) }),
        ]));
      });
      section.hidden = false;
      return true;
    }
    function getJson(url) {
      return fetch(url, { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; });
    }
    var first = productId
      ? getJson("/recommendations/products.json?product_id=" + encodeURIComponent(productId) + "&limit=12&intent=related")
      : Promise.resolve(null);
    first
      .then(function (data) {
        if (data && show(data.products)) return;
        return getJson("/products.json?limit=24").then(function (d) { if (d) show(d.products); });
      })
      .catch(function () {});
    return section;
  }

  function money(amount) {
    var n = Number(amount);
    return isNaN(n) ? "" : "$" + n.toFixed(2);
  }

  // Quantity stepper + "Buy & Open", which goes straight to checkout with that many packs.
  function buyControls(a) {
    var max = Math.max(1, Math.min(20, a.packsLeft));
    var qty = 1;
    var count = el("span", { class: "mp-qty-n", "aria-live": "polite", text: "1" });
    var minus = el("button", { class: "mp-qty-btn", type: "button", "aria-label": "Fewer packs", text: "\u2212" });
    var plus = el("button", { class: "mp-qty-btn", type: "button", "aria-label": "More packs", text: "+" });
    var buy = el("a", { class: "mp-btn mp-btn-dark", href: a.buyUrl });
    var hint = el("span", { class: "mp-qty-hint" });
    function update() {
      count.textContent = String(qty);
      buy.textContent = qty > 1 ? "Buy & Open " + qty + " Packs" : "Buy & Open";
      buy.href = a.buyUrl.replace(/:\d+$/, ":" + qty);
      minus.disabled = qty <= 1;
      plus.disabled = qty >= max;
      hint.textContent = qty >= 5 ? "Free shipping unlocked!" : "Add " + (5 - qty) + " more for free shipping";
      hint.classList.toggle("mp-qty-hint-on", qty >= 5);
    }
    minus.addEventListener("click", function () { if (qty > 1) { qty--; update(); } });
    plus.addEventListener("click", function () { if (qty < max) { qty++; update(); } });
    update();
    return el("div", { class: "mp-more-buy" }, [
      el("div", { class: "mp-more-actions" }, [
        el("div", { class: "mp-qty", role: "group", "aria-label": "Number of packs" }, [minus, count, plus]),
        buy,
      ]),
      hint,
    ]);
  }

  // "Open More Packs?": every pack on sale right now, linking to its page or straight to checkout.
  function shelf(available) {
    if (!available || !available.length) return null;
    return el("section", { class: "mp-more" }, [
      el("h2", { class: "mp-more-title", text: "Open More Packs?" }),
      el("p", { class: "mp-more-sub", text: "Grab another pack and open it the moment you check out." }),
      el("div", { class: "mp-more-grid" }, available.map(function (a) {
        return el("div", { class: "mp-more-item" }, [
          el("a", { class: "mp-more-art", href: a.url, "aria-label": a.title }, [
            a.imageUrl ? el("img", { src: a.imageUrl, alt: "", loading: "lazy" }) : null,
          ]),
          el("div", { class: "mp-more-info" }, [
            el("a", { class: "mp-more-name", href: a.url, text: a.title }),
            el("div", { class: "mp-more-meta", text: money(a.price) + " · " + a.packsLeft + " pack" + (a.packsLeft === 1 ? "" : "s") + " left" }),
            buyControls(a),
            el("a", { class: "mp-more-link", href: a.url, text: "View Potential Pulls" }),
          ]),
        ]);
      })),
    ]);
  }

  function render(packs, available, signedIn, recommendFrom, recommendHandle) {
    root.innerHTML = "";
    var unopened = packs.filter(function (p) { return !p.opened; });
    var opened = packs.filter(function (p) { return p.opened; });

    if (demo) root.appendChild(demoBanner());
    root.appendChild(el("h1", { text: "My Packs" }));
    root.appendChild(el("p", {
      class: "mp-sub",
      text: unopened.length
        ? "You have " + unopened.length + " unopened pack" + (unopened.length === 1 ? "" : "s") + ". Your cards ship once every pack on the order is opened."
        : "All your packs are open. Your cards ship with your order.",
    }));

    if (unopened.length) {
      root.appendChild(el("h2", { class: "mp-section-title", text: "Unopened" }));
      root.appendChild(el("div", { class: "mp-grid" }, unopened.map(function (p) { return packTile(p, openPack); })));
    }
    root.appendChild(el("h2", { class: "mp-section-title", text: "Your pulls" }));
    if (signedIn === false) {
      root.appendChild(el("p", { class: "mp-login-hint" }, [
        document.createTextNode("Showing this order only. "),
        el("a", { href: "/account/login?return_url=" + encodeURIComponent("/apps/packs"), text: "Log In To See All Your Pulls" }),
      ]));
    }
    root.appendChild(
      opened.length
        ? el("div", { class: "mp-grid" }, opened.map(cardTile))
        : el("p", { class: "mp-empty", text: "Nothing pulled yet." }),
    );
    var more = shelf(available);
    if (more) root.appendChild(more);
    root.appendChild(shippingInfo());
    root.appendChild(themeRecommendations(recommendHandle, recommendFrom));
  }

  // Coming from checkout, a cover hides the page until the opening stage is up, so the
  // list (and any card already pulled on the order) never flashes before the animation.
  function uncover() {
    var cover = document.getElementById("mp-cover");
    if (cover) cover.remove();
  }

  function demoBanner() {
    var reset = el("button", { class: "mp-btn", type: "button", text: "New Sample Packs" });
    reset.addEventListener("click", function () { demoData = null; load(); });
    return el("div", { class: "mp-demo" }, [
      el("p", { text: "Preview mode: these are sample packs and pulls from the live pool. Opening them changes nothing, and customers never see this page." }),
      reset,
    ]);
  }

  function fetchPacks() {
    if (demo && demoData) return Promise.resolve(demoData);
    return fetch(api + (demo ? "/demo" : "/pulls") + query, { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (demo && !data.error) demoData = data;
        return data;
      });
  }

  function load() {
    return fetchPacks()
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        var packs = data.packs || [];
        if (autoOpen) {
          autoOpen = false;
          var first = packs.filter(function (p) { return !p.opened; })[0];
          if (first) {
            // The list is drawn when the stage closes (close() reloads it).
            openPack(first);
            uncover();
            return;
          }
        }
        render(packs, data.available, data.signedIn, data.recommendFrom, data.recommendHandle);
        uncover();
      })
      .catch(function (err) {
        root.innerHTML = "";
        root.appendChild(el("p", { class: "mp-error", text: err.message || "Couldn't load your packs." }));
        uncover();
      });
  }

  function confetti(stage, color) {
    var colors = [color, "#ffffff", "#f2c94c", "#e3350d"];
    for (var i = 0; i < 80; i++) {
      var piece = el("span", { class: "mp-confetti" });
      piece.style.left = Math.random() * 100 + "vw";
      piece.style.background = colors[i % colors.length];
      piece.style.animationDuration = 1.8 + Math.random() * 1.6 + "s";
      piece.style.animationDelay = Math.random() * 0.4 + "s";
      stage.appendChild(piece);
    }
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // Runs fn(progress) on every frame for ms milliseconds.
  function tween(ms, fn, ease) {
    return new Promise(function (resolve) {
      var start = performance.now();
      function step(now) {
        var k = Math.min(1, (now - start) / ms);
        fn(ease ? ease(k) : k);
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }
  function easeInOut(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
  function animate(node, frames, options) {
    var anim = node.animate(frames, Object.assign({ fill: "forwards" }, options));
    return anim.finished || wait(options.duration + (options.delay || 0));
  }

  // The pack bag inside the product artwork (a square image with the pack centered), as fractions.
  var ART = { left: 0.261, top: 0.042, width: 0.478, height: 0.916 };
  var TEAR_Y = 0.075; // tear line, just under the top seal, as a fraction of the pack height
  var SLICES = 16; // the torn-off strip is a chain of slices so it can curl as it peels
  var SVGNS = "http://www.w3.org/2000/svg";
  var uid = 0;

  // A ragged tear line across the pack: a random walk with small zigzag teeth.
  function tearLine() {
    var points = [];
    var drift = 0;
    for (var i = 0; i <= 64; i++) {
      drift = Math.max(-0.012, Math.min(0.012, drift + (Math.random() - 0.5) * 0.006));
      var tooth = (i % 2 ? 1 : -1) * (0.001 + Math.random() * 0.004) + (Math.random() - 0.5) * 0.003;
      var x = i / 64 + (i > 0 && i < 64 ? (Math.random() - 0.5) * 0.008 : 0);
      points.push([x, TEAR_Y + drift + tooth]);
    }
    return points;
  }
  function yAt(points, x) {
    for (var i = 1; i < points.length; i++) {
      if (points[i][0] >= x) {
        var a = points[i - 1], b = points[i];
        return a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0] || 1));
      }
    }
    return points[points.length - 1][1];
  }
  function pct(v) { return (v * 100).toFixed(3) + "%"; }

  // Paper-white torn edge with fibers, drawn along the tear line. side: 1 = below (pack body), -1 = above (strip).
  function tornEdge(points, side, shown) {
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "mp-edge");
    svg.setAttribute("viewBox", "0 0 1000 1000");
    svg.setAttribute("preserveAspectRatio", "none");
    var d = points.map(function (p, i) { return (i ? "L" : "M") + (p[0] * 1000).toFixed(1) + " " + (p[1] * 1000).toFixed(1); }).join(" ");
    var fibers = "";
    for (var i = 0; i < 70; i++) {
      var x = Math.random();
      var y = yAt(points, x) * 1000;
      var len = 2 + Math.random() * 7;
      fibers += "M" + (x * 1000).toFixed(1) + " " + y.toFixed(1) + " l" + ((Math.random() - 0.5) * 6).toFixed(1) + " " + (side * len).toFixed(1) + " ";
    }
    var id = "mp-clip-" + ++uid;
    svg.innerHTML =
      '<defs><clipPath id="' + id + '"><rect x="0" y="0" width="' + (shown ? 1000 : 0) + '" height="1000"/></clipPath></defs>' +
      '<g clip-path="url(#' + id + ')">' +
      '<path d="' + d + '" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="7" transform="translate(0 ' + side * 3 + ')"/>' +
      '<path d="' + d + '" fill="none" stroke="#f5f1e8" stroke-width="5"/>' +
      '<path d="' + d + '" fill="none" stroke="#c9ccd6" stroke-width="1.6" transform="translate(0 ' + side * 2.4 + ')"/>' +
      '<path d="' + fibers + '" fill="none" stroke="#eeeae0" stroke-width="1.1" stroke-linecap="round"/>' +
      "</g>";
    svg.reveal = svg.querySelector("rect");
    return svg;
  }

  // Builds the pack for the opening stage: the body, and the top strip that tears off.
  function stagePack(art, width, height) {
    var points = tearLine();
    var group = el("div", { class: "mp-open-pack" });
    group.style.width = width + "px";
    group.style.height = height + "px";
    var paint = art
      ? "url(\"" + art.replace(/"/g, "%22") + "\") center / " + pct(1 / ART.width) + " " + pct(1 / ART.height) + " no-repeat"
      : "";

    function face(polygon) {
      var node = el("div", { class: "mp-open-face" + (art ? "" : " mp-open-plain") });
      node.style.width = width + "px";
      node.style.height = height + "px";
      if (paint) node.style.background = paint;
      node.style.clipPath = "polygon(" + polygon.map(function (p) { return pct(p[0]) + " " + pct(p[1]); }).join(",") + ")";
      return node;
    }

    // Body: everything under the tear line.
    var body = el("div", { class: "mp-open-body" });
    var bodyGlow = el("div", { class: "mp-open-glow" });
    bodyGlow.style.top = (TEAR_Y * 100).toFixed(2) + "%";
    body.appendChild(bodyGlow);
    var bodyFace = face([[0, 1]].concat(points, [[1, 1]]));
    var bodyEdge = tornEdge(points, 1, false);
    bodyFace.appendChild(bodyEdge);
    body.appendChild(bodyFace);
    var shade = el("div", { class: "mp-open-shade" });
    bodyFace.appendChild(shade);

    // Strip: a chain of slices, rightmost first, each nested in the one to its right so their
    // rotations add up and the strip curls from its free left end.
    var sliceW = width / SLICES;
    var slices = [];
    var parent = null;
    for (var k = SLICES - 1; k >= 0; k--) {
      var x0 = k / SLICES, x1 = (k + 1) / SLICES;
      var pad = 0.6 / width; // a hairline overlap hides seams between slices
      var lo = Math.max(0, x0 - pad), hi = Math.min(1, x1 + pad);
      var inner = points.filter(function (p) { return p[0] > lo && p[0] < hi; }).reverse();
      var polygon = [[lo, 0], [hi, 0], [hi, yAt(points, hi)]].concat(inner, [[lo, yAt(points, lo)]]);
      var wrap = el("div", { class: "mp-open-slice" });
      wrap.style.width = sliceW + "px";
      wrap.style.height = height + "px";
      wrap.style.left = (parent ? -sliceW : k * sliceW) + "px";
      wrap.style.transformOrigin = "100% " + yAt(points, x1) * height + "px";
      var sliceFace = face(polygon);
      sliceFace.style.left = -k * sliceW + "px";
      var edge = tornEdge(points, -1, true);
      sliceFace.appendChild(edge);
      wrap.appendChild(sliceFace);
      (parent || group).appendChild(wrap);
      slices[k] = { wrap: wrap, edge: edge, joint: x1 };
      parent = wrap;
    }
    group.insertBefore(body, group.firstChild);

    return { group: group, body: body, bodyEdge: bodyEdge, shade: shade, slices: slices, root: slices[SLICES - 1].wrap, points: points };
  }

  function fleck(pack, x, y) {
    var piece = el("span", { class: "mp-fleck" });
    piece.style.left = x + "px";
    piece.style.top = y + "px";
    piece.style.setProperty("--dx", (Math.random() * 40 - 10).toFixed(1) + "px");
    piece.style.setProperty("--dy", (-10 - Math.random() * 30).toFixed(1) + "px");
    piece.style.setProperty("--r", (Math.random() * 540).toFixed(0) + "deg");
    piece.style.background = Math.random() < 0.6 ? "#f5f1e8" : "#c9ccd6";
    pack.group.appendChild(piece);
    setTimeout(function () { piece.remove(); }, 900);
  }

  // Tears the strip off from left to right, curling it up as it goes.
  function tear(pack, width, height) {
    if (navigator.vibrate) navigator.vibrate([12, 40, 12, 40, 18]);
    var lastFleck = 0;
    return tween(1150, function (front) {
      pack.slices.forEach(function (slice, k) {
        // How far the tear has run past this slice's right joint, in slices.
        var past = Math.max(0, Math.min(1.6, (front * 1.04 - slice.joint) * SLICES + 1));
        var bend = k === 0 ? past * 5 : past * 1.7;
        slice.wrap.style.transform = "translateY(" + (-past * 0.9).toFixed(2) + "px) rotate(" + bend.toFixed(2) + "deg)";
        slice.edge.style.opacity = past > 0 ? 1 : 0;
      });
      var torn = Math.min(1, front * 1.04);
      pack.bodyEdge.reveal.setAttribute("width", (torn * 1000).toFixed(1));
      pack.shade.style.width = torn * 100 + "%";
      var now = performance.now();
      if (front > 0.02 && front < 0.99 && now - lastFleck > 28) {
        lastFleck = now;
        fleck(pack, torn * width, yAt(pack.points, torn) * height);
      }
    }, easeInOut);
  }

  function openPack(pack) {
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var front = el("div", { class: "mp-reveal-card" });
    var glow = el("div", { class: "mp-glow" });
    var result = el("div", { class: "mp-result", "aria-live": "polite" });
    var inner = el("div", { class: "mp-stage-inner" }, [glow, front, result]);
    var skip = el("button", { class: "mp-btn mp-btn-ghost mp-skip", type: "button", text: "Close" });
    var stage = el("div", { class: "mp-stage", role: "dialog", "aria-modal": "true", "aria-label": "Opening pack" }, [inner, skip]);
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      stage.remove();
      document.removeEventListener("keydown", onKey);
      if (pack.onClose) pack.onClose();
      if (!standalone) load();
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    skip.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(stage);

    // The pack is as tall as the card's final spot and as wide as the artwork's pack bag.
    var height = inner.getBoundingClientRect().height;
    var width = pack.packImageUrl ? height * (ART.width / ART.height) : height * 0.62;
    var opener = stagePack(pack.packImageUrl, width, height);
    opener.group.classList.add("mp-shaking");
    inner.insertBefore(opener.group, result);

    // Inside the pack the card sits small and low, hidden behind the wrapper.
    var cardScale = (width * 0.86) / inner.getBoundingClientRect().width;
    var inside = "translateY(" + ((0.56 - 0.5) * 100).toFixed(1) + "%) scale(" + cardScale.toFixed(3) + ")";
    var peek = "translateY(" + ((0.56 - 0.5 - 0.30) * 100).toFixed(1) + "%) scale(" + cardScale.toFixed(3) + ")";
    front.style.transform = inside;

    // Ask the server for the result while the pack shakes. Preview packs already carry their card.
    var reveal = pack.demoCard
      ? Promise.resolve(pack.demoCard).then(function (card) {
          pack.opened = true;
          pack.card = card;
          pack.shipping = { state: "preparing" };
          return card;
        })
      : fetch(api + "/open" + query, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packId: pack.id }),
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok || data.error) throw new Error(data.error || "Couldn't open this pack.");
        return data.card;
      });
    });

    // Load the card image before the pack tears, so a half-loaded or broken image never flashes
    // in the opening. Gives up after a few seconds and shows the card name instead.
    function preload(card) {
      if (!card.imageUrl) return Promise.resolve(card);
      return new Promise(function (resolve) {
        var img = new Image();
        var done = false;
        function finish(ok) {
          if (done) return;
          done = true;
          if (!ok) card = Object.assign({}, card, { imageUrl: null });
          resolve(card);
        }
        img.onload = function () { (img.decode ? img.decode() : Promise.resolve()).then(function () { finish(true); }, function () { finish(true); }); };
        img.onerror = function () { finish(false); };
        img.src = card.imageUrl;
        setTimeout(function () { finish(img.complete && img.naturalWidth > 0); }, 6000);
      });
    }

    Promise.all([reveal.then(preload), wait(reduced ? 0 : 900)])
      .then(function (values) {
        var card = values[0];
        var color = TIER_COLORS[tierKey(card.tier)] || TIER_COLORS.base;
        var big = ["epic", "chase", "ultra", "master"].indexOf(tierKey(card.tier)) !== -1;
        if (card.imageUrl) front.appendChild(el("img", { src: card.imageUrl, alt: card.title }));
        else front.appendChild(el("strong", { text: card.title }));
        glow.style.background = color;
        opener.group.classList.remove("mp-shaking");

        var sequence = reduced
          ? Promise.resolve().then(function () {
              opener.group.remove();
              front.style.transform = "none";
            })
          : tear(opener, width, height)
              // 1. The torn strip comes away completely and falls off.
              .then(function () {
                return animate(opener.root, [
                  { transform: getComputedStyle(opener.root).transform },
                  { transform: "translate(" + width * 0.35 + "px, " + -height * 0.16 + "px) rotate(16deg)", offset: 0.35 },
                  { transform: "translate(" + width * 0.9 + "px, " + (window.innerHeight * 1.1) + "px) rotate(70deg)", opacity: 0 },
                ], { duration: 1000, easing: "cubic-bezier(.3,.1,.6,1)" });
              })
              // 2. The card rises out of the opening, showing its top.
              .then(function () {
                glow.classList.add("mp-peek");
                return animate(front, [{ transform: inside }, { transform: peek }], { duration: 650, easing: "cubic-bezier(.2,.8,.3,1)" });
              })
              .then(function () { return wait(350); })
              // 3. The rest of the pack slides down off the card.
              .then(function () {
                var slide = animate(opener.body, [
                  { transform: "none" },
                  { transform: "translateY(" + (window.innerHeight + height) + "px) rotate(-3deg)" },
                ], { duration: 900, easing: "cubic-bezier(.5,0,.75,.4)" });
                // The card stays put while the pack slides off, then grows into place.
                var settle = wait(650).then(function () {
                  return animate(front, [{ transform: peek }, { transform: "translateY(-2%) scale(1.04)", offset: 0.7 }, { transform: "none" }], {
                    duration: 800,
                    easing: "cubic-bezier(.3,.7,.3,1)",
                  });
                });
                return Promise.all([slide, settle]);
              })
              .then(function () { opener.group.remove(); });

        return sequence.then(function () {
          glow.classList.remove("mp-peek");
          glow.classList.add("mp-on");
          front.classList.add("mp-revealed");
          if (big) front.classList.add("mp-holo");
          if (big && !reduced) confetti(stage, color);

          result.appendChild(el("span", { class: "mp-tier", "data-tier": tierKey(card.tier), text: card.tier }));
          result.appendChild(el("h2", { text: card.title }));
          result.appendChild(el("p", { text: pack.resultNote || "Ships with your order" }));
          var done = el("button", { class: "mp-btn", type: "button", text: pack.doneLabel || "Done" });
          done.addEventListener("click", close);
          var actions = el("div", { class: "mp-actions" }, [done]);
          if (pack.again) {
            var again = el("button", { class: "mp-btn mp-btn-ghost", type: "button", text: "Try Again" });
            again.addEventListener("click", function () { close(); pack.again(); });
            actions.appendChild(again);
          }
          if (navigator.share && !pack.noShare) {
            var share = el("button", { class: "mp-btn mp-btn-ghost", type: "button", text: "Share" });
            share.addEventListener("click", function () {
              navigator.share({ title: "My mystery pack pull", text: "I pulled " + card.title + "!", url: window.location.origin + "/apps/packs" }).catch(function () {});
            });
            actions.appendChild(share);
          }
          result.appendChild(actions);
          result.classList.add("mp-show");
          done.focus();
        });
      })
      .catch(function (err) {
        opener.group.classList.remove("mp-shaking");
        result.appendChild(el("p", { text: err.message }));
        result.classList.add("mp-show");
      });
  }

  // Demo opening for any page: PCPackOpener.open({ packImageUrl, card: { title, tier, imageUrl }, ... }).
  window.PCPackOpener = {
    open: function (opts) {
      openPack({
        id: "demo",
        series: opts.series || "Mystery Pack",
        packImageUrl: opts.packImageUrl || null,
        demoCard: opts.card,
        resultNote: opts.note,
        doneLabel: opts.doneLabel,
        again: opts.again,
        noShare: true,
        onClose: opts.onClose,
      });
    },
  };

  if (!standalone) load();
})();
