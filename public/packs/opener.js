// My Packs page: lists the customer's packs and plays the opening animation.
// The card is fetched only when a pack is opened, and was decided on the server at payment.
(function () {
  "use strict";

  var root = document.getElementById("mystery-packs");
  // Loaded without the My Packs page (e.g. the product page's demo button): only the opening
  // animation is used, through window.PCPackOpener.
  var standalone = !root;

  var api = (root && root.getAttribute("data-api")) || "/apps/packs/api";
  // Card back images sit next to this script (the app's own host, wherever the page is).
  var scriptSrc = (document.currentScript && document.currentScript.src) || "";
  var assetBase = window.PCPackAssetBase != null ? window.PCPackAssetBase : scriptSrc ? scriptSrc.replace(/opener\.js.*$/, "") : "/packs/";
  function backUrl(card) { return assetBase + (card && card.language === "japanese" ? "card-back-jp.jpg" : "card-back-en.jpg"); }
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
    vault: "Ready To Ship",
    awaiting_payment: "Awaiting Shipping Payment",
    preparing: "Preparing To Ship",
    shipped: "Shipped",
    pickup_preparing: "Preparing For Pickup",
    pickup_ready: "Ready For Pickup",
    picked_up: "Picked Up",
  };

  function shipBadge(pack) {
    if (pack.market) {
      return el("span", { class: "mp-ship", "data-state": "market", text: "Listed For " + (pack.market.sale && pack.market.trade ? "Sale & Trade" : pack.market.sale ? "Sale" : "Trade") });
    }
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

  function shortDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  }

  function cardTile(pack) {
    var card = pack.card;
    return el("div", { class: "mp-card" }, [
      card.imageUrl ? el("img", { src: card.imageUrl, alt: card.title, loading: "lazy" }) : null,
      el("div", { class: "mp-card-title", text: card.title }),
      el("div", { class: "mp-card-meta" }, [
        el("span", { class: "mp-tier", "data-tier": tierKey(card.tier), text: card.tier }),
        el("span", { text: pack.pulledAt ? shortDate(pack.pulledAt) : "Order " + pack.orderName }),
      ]),
      shipBadge(pack),
    ]);
  }

  // How the pulled card gets to the customer.
  function shippingInfo(vault) {
    var fee = vault ? vault.fee : 5;
    var freeAt = vault ? vault.freeAt : 25;
    var steps = [
      ["Cards Go To Your Vault", "Every card you pull is kept safe in your vault here. Open as many packs as you like and ship them together."],
      ["Ship When You're Ready", "Tap the cards in your vault you want, then Ship My Cards to send them in one package: $" + fee + " flat, or free on " + freeAt + "+ cards."],
      ["We Pack It With Care", "Every card is sleeved and top loaded before it goes out."],
      ["Track It Here", "Each card shows Preparing To Ship, then Shipped with a tracking link. You'll also get a shipping email from us."],
    ];
    return el("section", { class: "mp-info" }, [
      el("h2", { class: "mp-section-title", text: "How Your Cards Ship" }),
      el("div", { class: "mp-info-grid" }, steps.map(function (s, i) {
        return el("div", { class: "mp-info-item" }, [
          el("span", { class: "mp-info-num", text: String(i + 1) }),
          el("div", {}, [el("strong", { text: s[0] }), el("p", { text: s[1] })]),
        ]);
      })),
      el("p", { class: "mp-info-note", text: "Shipping is a one-time $" + fee + " per shipment, free when you ship " + freeAt + " or more cards at once. US addresses only. Local pickup is always free at 181 Hughes Road, Suite 5, Madison, AL: pick your cards, tap Pick Up In Store and we'll email you when they're ready." }),
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
      hint.textContent = "No shipping on packs. Your cards go to your vault.";
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
      el("p", { class: "mp-more-sub", text: "Grab Another Pack And Open It The Moment You Check Out." }),
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

  // Page header: title, what's going on, vault stats, and Ship My Cards, all in one banner.
  function hero(unopened, vault, listedCount) {
    var cards = vault ? vault.cards : 0;
    var pending = vault && vault.pending;
    var sub = unopened
      ? "You Have " + unopened + " Unopened Pack" + (unopened === 1 ? "" : "s") + ". Every Card You Pull Goes To Your Vault."
      : cards || pending
        ? "Your Pulls Wait Safely In Your Vault. Ship Them Together Whenever You're Ready."
        : "Open Packs Online. Every Card You Pull Lands In Your Vault Until You Ship It.";
    var stats = el("div", { class: "mp-hero-stats" }, [
      el("span", { class: "mp-hero-stat" }, [el("b", { text: String(cards) }), document.createTextNode((cards === 1 ? " Card" : " Cards") + " In Vault")]),
      el("span", { class: "mp-hero-stat" }, [el("b", { text: String(unopened) }), document.createTextNode(" Unopened")]),
      listedCount ? el("span", { class: "mp-hero-stat" }, [el("b", { text: String(listedCount) }), document.createTextNode(" On Vault Market")]) : null,
    ]);
    var text = el("div", { class: "mp-hero-text" }, [
      el("span", { class: "mp-hero-kicker", text: "Digital Mystery Packs · Your Vault" }),
      el("h1", { text: "My Packs" }),
      el("p", { class: "mp-hero-sub", text: sub }),
      stats,
      vault && vault.market ? el("a", { class: "mp-btn mp-btn-ghost mp-market-link", href: "/apps/packs/market", text: "Trade & Sell Vault Cards" }) : null,
    ]);
    shipVault = vault;
    shipEl = shipBox(vault);
    return el("section", { class: "mp-hero" }, [text, shipEl]);
  }

  // Vault cards the customer can pick to ship or pick up, and which ones are picked (by card id).
  var pickable = [];
  var listedCards = [];
  var picked = {};
  var pickSyncs = [];
  var shipEl = null;
  var shipVault = null;

  function pickedIds() {
    return pickable.filter(function (p) { return picked[p.id]; }).map(function (p) { return p.id; });
  }

  function cardsWord(n) {
    return n + (n === 1 ? " Card" : " Cards");
  }

  // Redraws the ship box and every tile's check after the picks change.
  function onPickChange() {
    pickSyncs.forEach(function (sync) { sync(); });
    if (!shipEl) return;
    var next = shipBox(shipVault);
    shipEl.replaceWith(next);
    shipEl = next;
  }

  // "Ship My Cards": the picked vault cards ship together for one flat fee.
  function shipBox(vault) {
    var fee = vault ? vault.fee : 5;
    var freeAt = vault ? vault.freeAt : 25;
    var all = pickable.length;
    var listedOut = listedCards.length;
    var ids = pickedIds();
    var n = ids.length;
    // Picked exactly the cards on the open invoice: just pay it.
    var onInvoice = pickable.filter(function (p) { return p.shipping && p.shipping.state === "awaiting_payment"; });
    var payOpen = vault && vault.pending && vault.pending.invoiceUrl && onInvoice.length === n && onInvoice.every(function (p) { return picked[p.id]; });
    if (payOpen) {
      var payNote = el("p", { text: "Finish checkout to pay shipping and we'll send them out." + (all > n ? " Tap your other vault cards to add them to this shipment." : "") });
      return el("div", { class: "mp-hero-ship" }, [
        el("strong", { class: "mp-hero-ship-title", text: cardsWord(n) + (n === 1 ? " Is" : " Are") + " Ready To Ship" }),
        payNote,
        el("a", { class: "mp-btn mp-vault-btn", href: vault.pending.invoiceUrl, text: "Pay Shipping" }),
        pickupButton(ids, payNote),
      ]);
    }
    var left = Math.max(0, freeAt - n);
    var bar = el("span", { class: "mp-hero-bar" }, [el("span", { style: "width:" + Math.min(100, (n / freeAt) * 100) + "%" })]);
    var note = el("p", {
      text: !all && listedOut
        ? "Every card in your vault is listed on Vault Market. Take a card off Vault Market (sale and trade) to ship or pick it up."
        : !all
        ? "Ship your vault for $" + fee + " flat, free on " + freeAt + "+ cards (US only)."
        : !n
          ? "Tap the cards in your vault you want to ship or pick up."
          : (left === 0
              ? (n === all ? "Your vault ships free!" : "These " + n + " cards ship free!")
              : "$" + fee + " flat shipping. " + left + " more card" + (left === 1 ? "" : "s") + " and it ships free.") +
            (vault && vault.pending ? " This replaces your open shipping invoice." : ""),
    });
    var label = !all ? "Ship My Cards" : !n ? "Ship Selected Cards" : n === all && all > 1 ? "Ship All " + all + " Cards" : "Ship " + cardsWord(n);
    return el("div", { class: "mp-hero-ship" }, [
      el("strong", { class: "mp-hero-ship-title", text: all && !n ? "Pick Cards To Ship" : left === 0 && n ? "Free Shipping Unlocked" : "Ship When You're Ready" }),
      bar,
      note,
      shipButton(label, note, ids),
      pickupButton(ids, note),
    ]);
  }

  // Starts (or replaces) the shipping invoice for the picked vault cards, then goes to checkout.
  function shipButton(label, note, ids) {
    var button = el("button", { class: "mp-btn mp-vault-btn", type: "button", text: label });
    if (!ids.length) button.disabled = true;
    button.addEventListener("click", function () {
      if (demo) { note.textContent = "Preview mode: shipping isn't available for sample cards."; return; }
      button.disabled = true;
      button.textContent = "Starting...";
      fetch(api + "/ship" + query, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pullIds: ids }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.invoiceUrl) { window.location.href = d.invoiceUrl; return; }
          throw new Error(d.error || "Couldn't start your shipment.");
        })
        .catch(function (err) {
          button.disabled = false;
          button.textContent = label;
          note.textContent = err.message;
        });
    });
    return button;
  }

  // "Pick Up In Store": sets the picked vault cards aside on a free local pickup order, no checkout.
  function pickupButton(ids, note) {
    var cards = ids.length;
    var button = el("button", { class: "mp-pickup-btn", type: "button", text: "Or Pick Up In Store (Free)" });
    if (!cards) button.disabled = true;
    button.addEventListener("click", function () {
      var say = function (text) { if (note) note.textContent = text; else button.textContent = text; };
      if (demo) { say("Preview mode: pickup isn't available for sample cards."); return; }
      if (!window.confirm("Set aside " + (cards === pickable.length && cards > 1 ? "all " : "") + cards + " card" + (cards === 1 ? "" : "s") + " from your vault for free local pickup?")) return;
      button.disabled = true;
      button.textContent = "Setting Aside...";
      fetch(api + "/ship" + query, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pickup: true, pullIds: ids }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.pickupOrder) throw new Error(d.error || "Couldn't set your cards aside.");
          window.alert(
            "Your cards are being set aside for pickup on order " + d.pickupOrder + ". We'll email you when they're ready.\n\n" +
            "Pick up at: " + (d.pickupAddress || "our store") + (d.pickupHours ? "\nHours: " + d.pickupHours : "") +
            "\n\nBring your order number when you come in."
          );
          window.location.reload();
        })
        .catch(function (err) {
          button.disabled = false;
          button.textContent = "Or Pick Up In Store (Free)";
          say(err.message);
        });
    });
    return button;
  }

  // A vault card the customer taps to add to (or leave out of) their shipment.
  function pickTile(pack) {
    var tile = cardTile(pack);
    tile.classList.add("mp-card-pick");
    tile.setAttribute("role", "checkbox");
    tile.setAttribute("tabindex", "0");
    tile.setAttribute("aria-label", "Ship " + pack.card.title);
    tile.insertBefore(el("span", { class: "mp-pick-check", "aria-hidden": "true" }), tile.firstChild);
    pickSyncs.push(function () { tile.setAttribute("aria-checked", picked[pack.id] ? "true" : "false"); });
    tile.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a")) return;
      if (picked[pack.id]) delete picked[pack.id];
      else picked[pack.id] = true;
      onPickChange();
    });
    tile.addEventListener("keydown", function (e) {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); tile.click(); }
    });
    return tile;
  }

  // A heading inside Your Vault: "Ready To Ship Or Pick Up (4)" or "Listed On Vault Market (2)".
  function vaultGroup(title, count, sub) {
    return el("div", { class: "mp-vault-group" }, [
      el("h3", { class: "mp-vault-group-title" }, [document.createTextNode(title + " "), el("span", { text: "(" + count + ")" })]),
      el("p", { class: "mp-vault-group-sub", text: sub + " " }),
    ]);
  }

  // "3 Of 5 Cards Selected · Select All · Clear" above the vault grid.
  function pickBar() {
    var count = el("span");
    var selectAll = el("button", { type: "button", text: "Select All" });
    var clear = el("button", { type: "button", text: "Clear" });
    selectAll.addEventListener("click", function () { pickable.forEach(function (p) { picked[p.id] = true; }); onPickChange(); });
    clear.addEventListener("click", function () { picked = {}; onPickChange(); });
    pickSyncs.push(function () {
      var n = pickedIds().length;
      count.textContent = n + " Of " + cardsWord(pickable.length) + " Selected To Ship";
      selectAll.disabled = n === pickable.length;
      clear.disabled = n === 0;
    });
    return el("div", { class: "mp-pick-bar" }, [count, selectAll, clear]);
  }

  function render(packs, available, signedIn, recommendFrom, recommendHandle, vault) {
    root.innerHTML = "";
    var unopened = packs.filter(function (p) { return !p.opened; });
    var opened = packs.filter(function (p) { return p.opened; });

    // The vault holds cards still with us; cards on their way or delivered move to the shipped history.
    var inVault = opened.filter(function (p) { return !p.shipping || p.shipping.state === "vault" || p.shipping.state === "awaiting_payment"; });
    var shipped = opened.filter(function (p) { return inVault.indexOf(p) === -1; });
    // Every vault card starts picked, unless an invoice is open: then just the cards on it.
    // Cards up on Vault Market can't ship until they're taken down: they're listed apart.
    listedCards = inVault.filter(function (p) { return p.market; });
    pickable = inVault.filter(function (p) { return !p.market; });
    picked = {};
    pickSyncs = [];
    var onInvoice = pickable.filter(function (p) { return p.shipping && p.shipping.state === "awaiting_payment"; });
    (onInvoice.length ? onInvoice : pickable).forEach(function (p) { picked[p.id] = true; });

    if (demo) root.appendChild(demoBanner());
    root.appendChild(hero(unopened.length, vault, listedCards.length));

    if (unopened.length) {
      root.appendChild(el("h2", { class: "mp-section-title", text: "Unopened" }));
      root.appendChild(el("div", { class: "mp-grid" }, unopened.map(function (p) { return packTile(p, openPack); })));
    }
    root.appendChild(el("h2", { class: "mp-section-title", text: "Your Vault" }));
    if (signedIn === false) {
      root.appendChild(el("p", { class: "mp-login-hint" }, [
        document.createTextNode("Showing this order only. "),
        // Keep the order link through login so this order's packs join the account's vault.
        el("a", { href: "/account/login?return_url=" + encodeURIComponent("/apps/packs" + (params.get("k") ? "?k=" + encodeURIComponent(params.get("k")) : "")), text: "Log In To Save These To Your Vault" }),
      ]));
    }
    if (!inVault.length) {
      root.appendChild(el("p", { class: "mp-empty", text: opened.length ? "Your Vault Is Empty. Every Card Has Shipped." : "Nothing Pulled Yet." }));
    }
    if (pickable.length) {
      root.appendChild(vaultGroup("Ready To Ship Or Pick Up", pickable.length, "Tap a card to add it to your shipment or leave it out."));
      if (pickable.length > 1) root.appendChild(pickBar());
      root.appendChild(el("div", { class: "mp-grid" }, pickable.map(pickTile)));
    }
    if (listedCards.length) {
      var group = vaultGroup("Listed On Vault Market", listedCards.length, "These cards are up for sale or trade, so they can't ship or be picked up. Take a card off Vault Market (sale and trade) to ship it.");
      group.querySelector(".mp-vault-group-sub").appendChild(el("a", { href: "/apps/packs/market", text: "Manage On Vault Market" }));
      root.appendChild(group);
      root.appendChild(el("div", { class: "mp-grid mp-grid-listed" }, listedCards.map(cardTile)));
    }
    if (shipped.length) {
      var onTheWay = shipped.filter(function (p) { return p.shipping.state === "preparing" || p.shipping.state === "pickup_ready"; }).length;
      var history = el("details", { class: "mp-history" }, [
        el("summary", { class: "mp-history-summary" }, [
          el("span", { class: "mp-section-title", text: "Shipped Cards" }),
          el("span", { class: "mp-history-count", text: shipped.length + (shipped.length === 1 ? " Card" : " Cards") + (onTheWay ? " · " + onTheWay + " On The Way" : "") }),
        ]),
        el("div", { class: "mp-grid" }, shipped.map(cardTile)),
      ]);
      // Open it while something is still on its way, so tracking is easy to find.
      if (onTheWay) history.open = true;
      root.appendChild(history);
    }
    pickSyncs.forEach(function (sync) { sync(); });
    var more = shelf(available);
    if (more) root.appendChild(more);
    root.appendChild(shippingInfo(vault));
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
        render(packs, data.available, data.signedIn, data.recommendFrom, data.recommendHandle, data.vault);
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

  // Red laser trace along the tear line, to match the pack's digital look. side: 1 = below (pack
  // body), -1 = above (strip). The glow comes from a CSS drop-shadow on the line.
  function tornEdge(points, side, shown) {
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "mp-edge");
    svg.setAttribute("viewBox", "0 0 1000 1000");
    svg.setAttribute("preserveAspectRatio", "none");
    var d = points.map(function (p, i) { return (i ? "L" : "M") + (p[0] * 1000).toFixed(1) + " " + (p[1] * 1000).toFixed(1); }).join(" ");
    // Scan-line pixels just off the cut, like the edge is still rendering.
    var bits = "";
    for (var i = 0; i < 40; i++) {
      var x = Math.random();
      var y = yAt(points, x) * 1000 + side * (3 + Math.random() * 6);
      bits += "M" + (x * 1000).toFixed(1) + " " + y.toFixed(1) + " h" + (3 + Math.random() * 9).toFixed(1) + " ";
    }
    var id = "mp-clip-" + ++uid;
    svg.innerHTML =
      '<defs><clipPath id="' + id + '"><rect x="0" y="0" width="' + (shown ? 1000 : 0) + '" height="1000"/></clipPath></defs>' +
      '<g clip-path="url(#' + id + ')">' +
      '<path d="' + d + '" fill="none" stroke="rgba(255,45,85,.45)" stroke-width="9" stroke-linejoin="miter"/>' +
      '<path d="' + d + '" fill="none" stroke="#ff2d55" stroke-width="4" stroke-linejoin="miter"/>' +
      '<path d="' + d + '" fill="none" stroke="#ffe3ea" stroke-width="1.2" stroke-linejoin="miter"/>' +
      '<path class="mp-edge-bits" d="' + bits + '" fill="none" stroke="#ff2d55" stroke-width="1.6"/>' +
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
      // Foil glare, moved by the tilt (the --mx/--my it sets on the pack).
      var sheen = el("div", { class: "mp-sheen" });
      sheen.style.width = width + "px";
      sheen.style.height = height + "px";
      node.appendChild(sheen);
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
    var laser = el("span", { class: "mp-laser" });
    group.appendChild(laser);

    return { group: group, laser: laser, body: body, bodyEdge: bodyEdge, shade: shade, slices: slices, root: slices[SLICES - 1].wrap, points: points };
  }

  function fleck(pack, x, y) {
    var piece = el("span", { class: "mp-fleck" });
    piece.style.left = x + "px";
    piece.style.top = y + "px";
    piece.style.setProperty("--dx", (Math.random() * 40 - 10).toFixed(1) + "px");
    piece.style.setProperty("--dy", (-10 - Math.random() * 30).toFixed(1) + "px");
    piece.style.setProperty("--r", (Math.random() * 540).toFixed(0) + "deg");
    piece.style.background = Math.random() < 0.65 ? "#ff2d55" : "#ffe3ea";
    pack.group.appendChild(piece);
    setTimeout(function () { piece.remove(); }, 900);
  }

  // Draws the tear run from the left edge to `front` (0 to 1), curling the strip up behind it.
  // Driven by the customer's finger, or by tear() when the pack opens on its own.
  function tearTo(pack, front, width, height) {
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
    var headY = yAt(pack.points, torn) * height;
    pack.laser.style.transform = "translate(" + (torn * width).toFixed(1) + "px, " + headY.toFixed(1) + "px)";
    pack.laser.classList.toggle("mp-on", front > 0.005 && front < 0.995);
    // The pack's 3D thickness is cut away above the tear too, so no shadow of the top stays behind.
    if (pack.layers) {
      var cut = pct(TEAR_Y + 0.016);
      var clip = front > 0.005 ? "polygon(0 " + cut + ", " + pct(torn) + " " + cut + ", " + pct(torn) + " 0, 100% 0, 100% 100%, 0 100%)" : "";
      pack.layers.forEach(function (node) { node.style.clipPath = clip; });
    }
    var now = performance.now();
    if (front > 0.02 && front < 0.99 && Math.abs(front - (pack.lastFront || 0)) > 0.004 && now - (pack.lastFleck || 0) > 28) {
      pack.lastFleck = now;
      fleck(pack, torn * width, yAt(pack.points, torn) * height);
    }
    pack.lastFront = front;
  }

  // Tears the rest of the strip off on its own, from wherever the finger left it.
  function tear(pack, width, height, from) {
    from = from || 0;
    if (navigator.vibrate) navigator.vibrate(from ? [18] : [12, 40, 12, 40, 18]);
    return tween(Math.max(250, 1150 * (1 - from)), function (k) {
      tearTo(pack, from + (1 - from) * k, width, height);
    }, from ? function (k) { return 1 - Math.pow(1 - k, 2); } : easeInOut);
  }

  // Makes the pack a tilting 3D object: it floats and sways on its own, leans toward the pointer
  // or finger, follows the phone's tilt where the browser allows it without asking, and moves a
  // foil glare across the artwork. Returns controls; stop() ends the loop.
  function tilter(node, floor) {
    var rx = 0, ry = 0, lift = 0, tx = 0, ty = 0, mode = "idle", running = true;
    var start = performance.now();
    var gyro = null, base = null;
    function onTilt(e) {
      if (e.beta == null || e.gamma == null) return;
      if (!base) base = { b: e.beta, g: e.gamma };
      gyro = {
        x: Math.max(-18, Math.min(18, (base.b - e.beta) * 0.7)),
        y: Math.max(-22, Math.min(22, (e.gamma - base.g) * 0.9)),
      };
    }
    window.addEventListener("deviceorientation", onTilt);
    function frame(now) {
      if (!running) return;
      requestAnimationFrame(frame);
      var t = (now - start) / 1000;
      var goalLift = 0;
      if (mode === "idle") {
        tx = Math.sin(t * 1.3) * 4 + (gyro ? gyro.x : 0);
        ty = Math.sin(t * 0.9) * 10 + (gyro ? gyro.y : 0);
        goalLift = Math.sin(t * 1.8) * 5;
      } else if (mode === "flat") {
        tx = 0; ty = 0;
      }
      rx += (tx - rx) * 0.12;
      ry += (ty - ry) * 0.12;
      lift += (goalLift - lift) * 0.1;
      node.style.transform = "translateX(-50%) translateY(" + lift.toFixed(2) + "px) rotateX(" + rx.toFixed(2) + "deg) rotateY(" + ry.toFixed(2) + "deg)";
      node.style.setProperty("--mx", (0.5 + ry / 36).toFixed(3));
      node.style.setProperty("--my", (0.5 - rx / 36).toFixed(3));
      if (floor) {
        floor.style.transform = "translateX(calc(-50% + " + (ry * 1.2).toFixed(1) + "px)) scale(" + (1 - lift / 60).toFixed(3) + ")";
        floor.style.opacity = (0.75 - lift / 30).toFixed(2);
      }
    }
    requestAnimationFrame(frame);
    return {
      aim: function (x, y) { mode = "aim"; tx = x; ty = y; },
      idle: function () { mode = "idle"; },
      flat: function () { mode = "flat"; return wait(380); },
      stop: function () { running = false; window.removeEventListener("deviceorientation", onTilt); },
    };
  }

  // Red-on-black "digital rain" behind the opening (katakana, digits and Poke-Collect glyphs).
  // Returns a stop function. Skipped for reduced motion.
  function matrixRain(stage) {
    var canvas = el("canvas", { class: "mp-matrix", "aria-hidden": "true" });
    stage.insertBefore(canvas, stage.firstChild);
    var ctx = canvas.getContext("2d");
    if (!ctx) return function () {};
    var GLYPHS = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789POKECOLLECT";
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var size, cols, drops, speeds, w, h;
    function resize() {
      w = stage.clientWidth; h = stage.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      size = w < 600 ? 14 : 16;
      cols = Math.ceil(w / size);
      drops = []; speeds = [];
      for (var i = 0; i < cols; i++) { drops.push(Math.random() * -h / size); speeds.push(0.35 + Math.random() * 0.65); }
      ctx.fillStyle = "#050306"; ctx.fillRect(0, 0, w, h);
    }
    resize();
    window.addEventListener("resize", resize);
    var running = true, last = 0;
    function frame(now) {
      if (!running) return;
      requestAnimationFrame(frame);
      if (now - last < 33) return; // ~30 fps is plenty and easy on phones
      last = now;
      ctx.fillStyle = "rgba(5, 3, 6, 0.16)"; // fade the old glyphs into trails
      ctx.fillRect(0, 0, w, h);
      ctx.font = "700 " + size + "px ui-monospace, Menlo, monospace";
      for (var i = 0; i < cols; i++) {
        var y = drops[i] * size;
        var ch = GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));
        // Bright head, deep red body.
        ctx.fillStyle = Math.random() < 0.08 ? "#ffd1dc" : "#ff2d55";
        ctx.globalAlpha = 0.85;
        ctx.fillText(ch, i * size, y);
        ctx.globalAlpha = 1;
        drops[i] += speeds[i];
        if (y > h && Math.random() > 0.975) drops[i] = Math.random() * -20;
      }
    }
    requestAnimationFrame(frame);
    return function () { running = false; window.removeEventListener("resize", resize); };
  }

  function openPack(pack) {
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var front = el("div", { class: "mp-reveal-card" });
    var glow = el("div", { class: "mp-glow" });
    var rays = el("div", { class: "mp-rays", "aria-hidden": "true" });
    var floor = el("div", { class: "mp-floor", "aria-hidden": "true" });
    var result = el("div", { class: "mp-result", "aria-live": "polite" });
    var inner = el("div", { class: "mp-stage-inner" }, [floor, rays, glow, front, result]);
    var skip = el("button", { class: "mp-btn mp-btn-ghost mp-skip", type: "button", text: "Close" });
    var stage = el("div", { class: "mp-stage", role: "dialog", "aria-modal": "true", "aria-label": "Opening pack" }, [inner, skip]);
    // Multi-card packs reveal their cards one at a time, so the result area needs room for a counter
    // and the strip of every card in the pack.
    var multi = (pack.cardsPerPack || (pack.demoCards ? pack.demoCards.length : 1)) > 1;
    if (multi) stage.classList.add("mp-multi");
    var stopRain = function () {};
    var tilt = null;
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      stopRain();
      if (tilt) tilt.stop();
      stage.remove();
      document.removeEventListener("keydown", onKey);
      if (pack.onClose) pack.onClose();
      if (!standalone) load();
    }
    var onKey = function (e) { if (e.key === "Escape") close(); };
    skip.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(stage);
    if (!reduced) stopRain = matrixRain(stage);

    // The pack is as tall as the card's final spot and as wide as the artwork's pack bag.
    var height = inner.getBoundingClientRect().height;
    var width = pack.packImageUrl ? height * (ART.width / ART.height) : height * 0.62;
    var opener = stagePack(pack.packImageUrl, width, height);
    // The 3D pack: the artwork in front, a few layers behind it for the pack's thickness, and a
    // back face, so its edges show as it tilts.
    var holder = el("div", { class: "mp-pack3d" });
    holder.style.width = width + "px";
    holder.style.height = height + "px";
    for (var layer = 1; layer <= 6; layer++) {
      var slab = el("div", { class: "mp-pack-layer" });
      slab.style.transform = "translateZ(" + (-layer * 1.1).toFixed(1) + "px)";
      holder.appendChild(slab);
    }
    holder.appendChild(el("div", { class: "mp-pack-back" }));
    opener.layers = Array.prototype.slice.call(holder.querySelectorAll(".mp-pack-layer, .mp-pack-back"));
    holder.appendChild(opener.group);
    inner.insertBefore(holder, result);
    if (!reduced) {
      tilt = tilter(holder, floor);
      // The pack drops in and settles before it can be opened.
      animate(opener.group, [
        { transform: "translateY(-60px) scale(.82) rotate(-6deg)", opacity: 0 },
        { transform: "translateY(6px) scale(1.02) rotate(1deg)", opacity: 1, offset: 0.7 },
        { transform: "none", opacity: 1 },
      ], { duration: 650, easing: "cubic-bezier(.2,.8,.3,1)" });
    }

    // Inside the pack the card sits small and low, hidden behind the wrapper.
    var cardScale = (width * 0.86) / inner.getBoundingClientRect().width;
    var inside = "translateY(" + ((0.56 - 0.5) * 100).toFixed(1) + "%) scale(" + cardScale.toFixed(3) + ")";
    var peek = "translateY(" + ((0.56 - 0.5 - 0.30) * 100).toFixed(1) + "%) scale(" + cardScale.toFixed(3) + ")";
    front.style.transform = inside;
    if (!reduced) front.style.visibility = "hidden";

    // Ask the server for the result while the pack drops in. Preview packs already carry their card.
    var reveal = pack.demoCards || pack.demoCard
      ? Promise.resolve(pack.demoCards || [pack.demoCard]).then(function (cards) {
          pack.opened = true;
          pack.cards = cards;
          pack.card = cards[cards.length - 1];
          pack.shipping = { state: "preparing" };
          return cards;
        })
      : fetch(api + "/open" + query, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packId: pack.id }),
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok || data.error) throw new Error(data.error || "Couldn't open this pack.");
        // Multi-card packs return every card, cheapest first, so the best one is revealed last.
        return data.cards && data.cards.length ? data.cards : [data.card];
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

    function colorOf(card) { return TIER_COLORS[tierKey(card.tier)] || TIER_COLORS.base; }
    function isBig(card) { return ["epic", "chase", "ultra", "master"].indexOf(tierKey(card.tier)) !== -1; }
    function showCard(card) {
      front.textContent = "";
      front.classList.remove("mp-back", "mp-charging");
      if (card.imageUrl) {
        // Never show a broken-image icon: swap to the card name if the image fails after all.
        var cardImg = el("img", { src: card.imageUrl, alt: "" });
        cardImg.onerror = function () { cardImg.replaceWith(el("strong", { text: card.title })); };
        front.appendChild(cardImg);
      }
      else front.appendChild(el("strong", { text: card.title }));
    }
    // A big hit comes out face down (an English or Japanese card back, matching the card), glowing
    // in its tier's color, and waits to be turned over.
    function showBack(card) {
      front.textContent = "";
      front.classList.remove("mp-holo");
      front.classList.add("mp-back");
      front.style.setProperty("--mp-c", colorOf(card));
      front.appendChild(el("img", { class: "mp-back-img", src: backUrl(card), alt: "" }));
    }
    // Clears finished animations off the card so it can be dragged and tilted by hand.
    function settleFront() {
      if (front.getAnimations) front.getAnimations().forEach(function (a) { a.cancel(); });
      front.style.transform = "none";
    }
    function flash(color) {
      var light = el("div", { class: "mp-flash" });
      light.style.background = "radial-gradient(circle at 50% 45%, #fff 0%, " + color + " 45%, transparent 75%)";
      stage.appendChild(light);
      animate(light, [{ opacity: 0 }, { opacity: 0.95, offset: 0.25 }, { opacity: 0 }], { duration: 750, easing: "ease-out" })
        .then(function () { light.remove(); });
    }

    // The big hit: the face-down card charges up (shaking, glowing, light rays behind it) until it's
    // tapped, then bursts into light and turns over.
    function hype(card, counter) {
      var color = colorOf(card);
      settleFront();
      rays.style.setProperty("--mp-c", color);
      glow.style.background = color;
      result.textContent = "";
      result.classList.remove("mp-show");
      if (counter) result.appendChild(counter);
      result.appendChild(el("span", { class: "mp-tap", text: "Tap To Reveal" }));
      result.classList.add("mp-show", "mp-quick");
      rays.classList.add("mp-on");
      glow.classList.add("mp-charge");
      front.classList.add("mp-charging");
      if (navigator.vibrate) navigator.vibrate([20, 80, 20, 80, 30]);
      return new Promise(function (resolve) {
        var done = false;
        function go() {
          if (done) return;
          done = true;
          front.removeEventListener("click", go);
          clearTimeout(timer);
          resolve();
        }
        front.addEventListener("click", go);
        var timer = setTimeout(go, 6000);
      }).then(function () {
        result.classList.remove("mp-show");
        front.classList.remove("mp-charging");
        glow.classList.remove("mp-charge");
        if (navigator.vibrate) navigator.vibrate([60]);
        return animate(front, [
          { transform: "none" },
          { transform: "rotateY(90deg) scale(1.08)" },
        ], { duration: 200, easing: "cubic-bezier(.5,0,.8,.4)" });
      }).then(function () {
        flash(color);
        showCard(card);
        rays.classList.add("mp-burst");
        return animate(front, [
          { transform: "rotateY(-90deg) scale(1.18)" },
          { transform: "rotateY(10deg) scale(1.08)", offset: 0.6 },
          { transform: "none" },
        ], { duration: 650, easing: "cubic-bezier(.2,.8,.3,1)" });
      });
    }

    // Swipe-to-open: a finger (or mouse) dragged across the top of the pack tears it open along
    // the dotted line. Resolves once it's open. Tapping "Tap To Open" or pressing Enter opens it too.
    function swipeToOpen() {
      var hint = el("div", { class: "mp-swipe-hint", "aria-hidden": "true" }, [el("span", { class: "mp-swipe-dot" })]);
      hint.style.top = (TEAR_Y * 100).toFixed(2) + "%";
      opener.group.appendChild(hint);
      var prompt = el("p", { class: "mp-swipe-text", text: "Swipe Across The Top To Open" });
      var button = el("button", { class: "mp-btn mp-btn-ghost mp-tap-open", type: "button", text: "Tap To Open" });
      result.textContent = "";
      result.appendChild(prompt);
      result.appendChild(button);
      result.classList.add("mp-show", "mp-quick");
      // The tap fallback shows only if a swipe hasn't worked after a while.
      var later = setTimeout(function () { button.classList.add("mp-on"); }, 5000);

      return new Promise(function (resolve) {
        var progress = 0, drag = null, finished = false;
        function done(from) {
          if (finished) return;
          finished = true;
          clearTimeout(later);
          stage.removeEventListener("pointerdown", down);
          stage.removeEventListener("pointermove", move);
          stage.removeEventListener("pointerup", up);
          stage.removeEventListener("pointercancel", up);
          stage.removeEventListener("pointerleave", leave);
          document.removeEventListener("keydown", key);
          hint.remove();
          result.classList.remove("mp-show");
          if (tilt) tilt.aim(6, 0);
          resolve(tear(opener, width, height, from));
        }
        function rect() { return holder.getBoundingClientRect(); }
        function down(e) {
          if (e.target.closest && e.target.closest("button")) return;
          var r = rect();
          var x = e.clientX, y = e.clientY;
          // Generous target: anywhere across the top third of the pack, a little past its sides.
          var onTop = y > r.top - r.height * 0.12 && y < r.top + r.height * 0.32 && x > r.left - r.width * 0.25 && x < r.right + r.width * 0.25;
          drag = { tear: onTop, x: x, y: y, id: e.pointerId };
          if (stage.setPointerCapture) { try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
          if (onTop) hint.classList.add("mp-off");
          move(e);
        }
        function move(e) {
          var r = rect();
          if (!drag) {
            // Mouse hover: the pack leans toward the pointer.
            if (e.pointerType === "mouse" && tilt) {
              var hx = (e.clientX - (r.left + r.width / 2)) / r.width;
              var hy = (e.clientY - (r.top + r.height / 2)) / r.height;
              tilt.aim(Math.max(-1, Math.min(1, -hy)) * 16, Math.max(-1, Math.min(1, hx)) * 22);
            }
            return;
          }
          if (e.pointerId !== drag.id) return;
          if (drag.tear) {
            // The tear follows the finger's sideways travel, whichever way it swipes.
            var run = Math.abs(e.clientX - drag.x) / (r.width * 0.8);
            var next = Math.min(1, Math.max(progress, run));
            if (next > progress) {
              if (navigator.vibrate && Math.floor(next * 8) > Math.floor(progress * 8)) navigator.vibrate(6);
              progress = next;
              tearTo(opener, progress, width, height);
            }
            if (tilt) tilt.aim(8, (progress - 0.5) * 14);
            if (progress >= 1) done(1);
          } else if (tilt) {
            // Dragging the rest of the pack turns it in the hand.
            var dx = (e.clientX - drag.x) / r.width;
            var dy = (e.clientY - drag.y) / r.height;
            tilt.aim(Math.max(-24, Math.min(24, -dy * 40)), Math.max(-32, Math.min(32, dx * 50)));
          }
        }
        function up(e) {
          if (!drag || e.pointerId !== drag.id) return;
          var wasTear = drag.tear;
          drag = null;
          if (wasTear && progress > 0.45) return done(progress);
          if (wasTear && progress > 0) {
            // Not far enough: the strip springs back down.
            var from = progress;
            progress = 0;
            tween(260, function (k) { tearTo(opener, from * (1 - k), width, height); });
            hint.classList.remove("mp-off");
          }
          if (tilt) tilt.idle();
        }
        function leave(e) { if (!drag && e.pointerType === "mouse" && tilt) tilt.idle(); }
        function key(e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); done(progress); } }
        button.addEventListener("click", function () { done(progress); });
        stage.addEventListener("pointerdown", down);
        stage.addEventListener("pointermove", move);
        stage.addEventListener("pointerup", up);
        stage.addEventListener("pointercancel", up);
        stage.addEventListener("pointerleave", leave);
        document.addEventListener("keydown", key);
      });
    }

    Promise.all([reveal.then(function (cards) {
      // Card backs load alongside the cards so a face-down hit never appears blank.
      cards.forEach(function (c) { if (isBig(c)) new Image().src = backUrl(c); });
      return Promise.all(cards.map(preload));
    }), wait(reduced ? 0 : 650)])
      .then(function (values) {
        var cards = values[0];
        var card = cards[0];
        if (isBig(card) && !reduced) showBack(card);
        else showCard(card);
        glow.style.background = colorOf(card);

        var sequence = reduced
          ? Promise.resolve().then(function () {
              holder.remove();
              front.style.transform = "none";
            })
          : swipeToOpen()
              // The pack turns to face the customer before the card comes out.
              .then(function () { return tilt.flat(); })
              .then(function () { front.style.visibility = ""; })
              // 1. The torn strip comes away completely and falls off.
              .then(function () {
                return animate(opener.root, [
                  { transform: getComputedStyle(opener.root).transform },
                  { transform: "translate(" + width * 0.35 + "px, " + -height * 0.16 + "px) rotate(16deg)", offset: 0.35 },
                  { transform: "translate(" + width * 0.9 + "px, " + (window.innerHeight * 1.1) + "px) rotate(70deg)", opacity: 0 },
                ], { duration: 900, easing: "cubic-bezier(.3,.1,.6,1)" });
              })
              // 2. The card rises out of the opening, showing its top.
              .then(function () {
                glow.classList.add("mp-peek");
                return animate(front, [{ transform: inside }, { transform: peek }], { duration: 650, easing: "cubic-bezier(.2,.8,.3,1)" });
              })
              .then(function () { return wait(300); })
              // 3. The rest of the pack slides down off the card.
              .then(function () {
                floor.classList.add("mp-off");
                var slide = animate(holder, [
                  { transform: holder.style.transform },
                  { transform: "translateX(-50%) translateY(" + (window.innerHeight + height) + "px) rotateX(18deg) rotate(-3deg)" },
                ], { duration: 900, easing: "cubic-bezier(.5,0,.75,.4)" });
                tilt.stop();
                // The card stays put while the pack slides off, then grows into place.
                var settle = wait(650).then(function () {
                  return animate(front, [{ transform: peek }, { transform: "translateY(-2%) scale(1.04)", offset: 0.7 }, { transform: "none" }], {
                    duration: 800,
                    easing: "cubic-bezier(.3,.7,.3,1)",
                  });
                });
                return Promise.all([slide, settle]);
              })
              .then(function () { holder.remove(); });

        function counterFor(i) {
          return multi ? el("span", { class: "mp-count", text: "Card " + (i + 1) + " Of " + cards.length }) : null;
        }
        // A face-down big hit charges up before the card's details show.
        function turnOver(i) {
          return front.classList.contains("mp-back") ? hype(cards[i], counterFor(i)) : Promise.resolve();
        }

        // Shows card i under the counter. Every card but the last waits for a tap or a swipe, then
        // the next card comes in; the last (best) card gets the full result with every card in the pack.
        function step(i) {
          var c = cards[i];
          var last = i === cards.length - 1;
          settleFront();
          front.classList.remove("mp-holo");
          front.classList.add("mp-revealed");
          if (isBig(c)) front.classList.add("mp-holo");
          if (isBig(c) && !reduced) confetti(stage, colorOf(c));
          glow.style.background = colorOf(c);

          result.textContent = "";
          var counter = counterFor(i);
          if (counter) result.appendChild(counter);
          var tierLabel = el("span", { class: "mp-tier", "data-tier": tierKey(c.tier), text: c.tier });
          var name = el("h2", { text: c.title });
          result.appendChild(tierLabel);
          result.appendChild(name);
          if (last) return finish(c, tierLabel, name);

          var next = el("button", { class: "mp-btn", type: "button", text: i === cards.length - 2 ? "Reveal Last Card" : "Next Card" });
          var all = el("button", { class: "mp-btn mp-btn-ghost", type: "button", text: "Reveal All" });
          result.appendChild(el("div", { class: "mp-actions" }, [next, all]));
          result.classList.add("mp-show", "mp-quick");
          next.focus();
          return new Promise(function (resolve) {
            var going = false;
            var drag = null, moved = false;
            function unbind() {
              front.removeEventListener("click", tapNext);
              front.removeEventListener("pointerdown", down);
              front.removeEventListener("pointermove", move);
              front.removeEventListener("pointerup", up);
              front.removeEventListener("pointercancel", up);
            }
            function advance(to, dir) {
              if (going) return;
              going = true;
              unbind();
              result.classList.remove("mp-show");
              rays.classList.remove("mp-on", "mp-burst");
              var nextCard = cards[to];
              var slow = to === cards.length - 1;
              var big = isBig(nextCard) && !reduced;
              var away = dir > 0 ? "translateX(80%) rotate(14deg) scale(.7)" : "translateX(-80%) rotate(-14deg) scale(.7)";
              var out = reduced ? Promise.resolve() : animate(front, [
                { transform: front.style.transform || "none", opacity: 1 },
                { transform: away, opacity: 0 },
              ], { duration: 320, easing: "cubic-bezier(.5,0,.8,.4)" });
              resolve(out.then(function () {
                settleFront();
                if (big) showBack(nextCard);
                else showCard(nextCard);
                front.classList.remove("mp-holo");
                if (reduced) return;
                if (big) {
                  // The hit slides in face down, then charges up.
                  return animate(front, [
                    { transform: "translateY(18%) scale(.85)", opacity: 0 },
                    { transform: "none", opacity: 1 },
                  ], { duration: 520, easing: "cubic-bezier(.2,.8,.3,1)" }).then(function () { return turnOver(to); });
                }
                // The best card turns over a little slower.
                return animate(front, [
                  { transform: "rotateY(90deg) scale(.92)", opacity: 1 },
                  { transform: "none", opacity: 1 },
                ], { duration: slow ? 700 : 420, easing: "cubic-bezier(.2,.8,.3,1)" });
              }).then(function () { return step(to); }));
            }
            function tapNext() { if (moved) { moved = false; return; } advance(i + 1, -1); }
            // Swiping the card sideways flicks it away, like dealing through a hand of cards.
            function down(e) {
              drag = { x: e.clientX, id: e.pointerId };
              moved = false;
              try { front.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            }
            function move(e) {
              if (!drag || e.pointerId !== drag.id) return;
              var dx = e.clientX - drag.x;
              if (Math.abs(dx) > 8) moved = true;
              front.style.transform = "translateX(" + dx + "px) rotate(" + (dx / 18).toFixed(2) + "deg)";
            }
            function up(e) {
              if (!drag || e.pointerId !== drag.id) return;
              var dx = e.clientX - drag.x;
              drag = null;
              if (Math.abs(dx) > 60) return advance(i + 1, dx > 0 ? 1 : -1);
              if (moved) animate(front, [{ transform: front.style.transform }, { transform: "none" }], { duration: 200, easing: "ease-out", fill: "none" })
                .then(function () { if (!going) front.style.transform = "none"; });
            }
            next.addEventListener("click", function () { advance(i + 1, -1); });
            front.addEventListener("click", tapNext);
            if (!reduced) {
              front.addEventListener("pointerdown", down);
              front.addEventListener("pointermove", move);
              front.addEventListener("pointerup", up);
              front.addEventListener("pointercancel", up);
            }
            all.addEventListener("click", function () { advance(cards.length - 1, -1); });
          });
        }

        // The finished card leans toward the finger or pointer, catching the light.
        function handTilt() {
          if (reduced) return;
          function lean(e) {
            var r = front.getBoundingClientRect();
            var x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
            var y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
            front.style.transform = "rotateX(" + (-y * 12).toFixed(1) + "deg) rotateY(" + (x * 14).toFixed(1) + "deg)";
            front.style.setProperty("--hx", ((x + 1) * 50).toFixed(1) + "%");
            front.style.setProperty("--hy", ((y + 1) * 50).toFixed(1) + "%");
            front.classList.add("mp-leaning");
          }
          function rest() {
            front.style.transform = "none";
            front.classList.remove("mp-leaning");
          }
          front.addEventListener("pointermove", lean);
          front.addEventListener("pointerdown", lean);
          front.addEventListener("pointerleave", rest);
          front.addEventListener("pointerup", function (e) { if (e.pointerType !== "mouse") rest(); });
        }

        function finish(best, tierLabel, name) {
          result.classList.remove("mp-quick");
          handTilt();
          result.appendChild(el("p", { text: pack.resultNote || (multi ? "All " + cards.length + " Cards Are In Your Vault" : "Added To Your Vault") }));
          if (multi) {
            // Every card in the pack, best last. Tapping one shows it big again.
            var strip = el("div", { class: "mp-fan" }, cards.map(function (c, k) {
              var thumb = el("button", { class: "mp-fan-card" + (k === cards.length - 1 ? " mp-on" : ""), type: "button", "aria-label": c.title, style: "--mp-c:" + colorOf(c) + ";--mp-k:" + (k - (cards.length - 1) / 2) },
                [c.imageUrl ? el("img", { src: c.imageUrl, alt: "" }) : el("span", { text: c.title })]);
              thumb.addEventListener("click", function () {
                strip.querySelectorAll(".mp-fan-card").forEach(function (t) { t.classList.remove("mp-on"); });
                thumb.classList.add("mp-on");
                showCard(c);
                front.classList.toggle("mp-holo", isBig(c));
                glow.style.background = colorOf(c);
                rays.style.setProperty("--mp-c", colorOf(c));
                rays.classList.toggle("mp-on", isBig(c));
                tierLabel.textContent = c.tier;
                tierLabel.setAttribute("data-tier", tierKey(c.tier));
                name.textContent = c.title;
              });
              return thumb;
            }));
            result.appendChild(strip);
          }
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
              navigator.share({ title: "My mystery pack pull", text: "I pulled " + best.title + "!", url: window.location.origin + "/apps/packs" }).catch(function () {});
            });
            actions.appendChild(share);
          }
          result.appendChild(actions);
          result.classList.add("mp-show");
          done.focus();
        }

        return sequence.then(function () {
          glow.classList.remove("mp-peek");
          glow.classList.add("mp-on");
          return turnOver(0);
        }).then(function () { return step(0); });
      })
      .catch(function (err) {
        result.textContent = "";
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
        // Multi-card demo: opts.cards, cheapest first.
        demoCards: opts.cards && opts.cards.length ? opts.cards : null,
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
