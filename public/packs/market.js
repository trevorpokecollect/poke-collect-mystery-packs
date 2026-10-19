// Vault Market: players trade vault cards with each other, sell them to each other, and browse
// each other's binders. Cards never leave the vault here; a trade or sale only changes the owner.
// A small hash router: #/ (market), #/collectors, #/u/<name>, #/matches, #/wishlist, #/binder, #/offers, #/wallet.
(function () {
  "use strict";

  var root = document.getElementById("vault-market");
  if (!root) return;
  var base = root.getAttribute("data-api") || "/apps/packs/api/market";
  // Staff preview link (?demo=<token>): sample cards, and buttons only show what would happen.
  var demo = root.getAttribute("data-demo");
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var state = null; // main payload: me, cards (my vault), board, offers, rules
  var collectorsCache = null;
  var collectionCache = {};
  var filters = { q: "", kind: "all", sort: "new" };
  var binderFilter = "all";
  var binderPage = 0;
  var flash = null;
  var modal = null; // { type: "card", card } | { type: "offer", ... } | { type: "name" }
  var showcaseEdit = null; // Set of pull ids while editing the showcase
  var matchesCache = null;
  var catalogQuery = "";
  var catalogResults = null;
  var walletCache = null;
  var newCode = null; // the code just made, shown until the page changes
  var armedBuy = null; // listing id awaiting a second tap to buy with Vault Credit
  var guides = {}; // pull id -> Price Guide ({ market, printing }), "loading" while fetched

  // ---------- Helpers ----------

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var v = attrs[key];
      if (v === false || v == null) return;
      if (key === "text") node.textContent = v;
      else if (key === "class") node.className = v;
      else if (key.indexOf("on") === 0 && typeof v === "function") node.addEventListener(key.slice(2), v);
      else node.setAttribute(key, v === true ? "" : v);
    });
    (children || []).forEach(function (child) {
      if (child == null || child === false) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function url(params) {
    var q = [];
    if (demo) q.push("demo=" + encodeURIComponent(demo));
    Object.keys(params || {}).forEach(function (k) {
      if (params[k]) q.push(k + "=" + encodeURIComponent(params[k]));
    });
    return base + (q.length ? "?" + q.join("&") : "");
  }

  function getJSON(params) {
    return fetch(url(params), { credentials: "same-origin" }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.error || "Something went wrong.");
        return data;
      });
    });
  }

  function money(n) {
    return "$" + Number(n).toFixed(2);
  }

  function since(d) {
    return new Date(d).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }

  function route() {
    var h = (window.location.hash || "#/").replace(/^#/, "");
    var parts = h.split("/").filter(Boolean);
    if (parts[0] === "u" && parts[1]) return { name: "collection", who: decodeURIComponent(parts[1]) };
    if (parts[0] === "collectors") return { name: "collectors" };
    if (parts[0] === "binder") return { name: "binder" };
    if (parts[0] === "offers") return { name: "offers" };
    if (parts[0] === "matches") return { name: "matches" };
    if (parts[0] === "wishlist") return { name: "wishlist" };
    if (parts[0] === "wallet") return { name: "wallet" };
    return { name: "market" };
  }

  function go(hash) {
    if (window.location.hash === hash) render();
    else window.location.hash = hash;
  }

  function profileHash(name) {
    return "#/u/" + encodeURIComponent(name);
  }

  // ---------- Data ----------

  function load() {
    return getJSON({}).then(function (data) {
      state = data;
      state.wishlist = state.wishlist || [];
      state.feed = state.feed || [];
      matchesCache = null;
      walletCache = null;
      state.credit = Number(state.credit || 0);
      collectorsCache = null;
      collectionCache = {};
      render();
    }).catch(function (error) {
      root.innerHTML = "";
      root.appendChild(el("p", { class: "vm-error vm-pad", text: error.message || "Couldn't load the market. Please refresh the page." }));
    });
  }

  var NEEDS_TERMS = ["list", "buy", "buyCredit", "offer", "accept"];

  function post(body, button) {
    // Selling, buying and trading need the Vault Market Terms agreed to first (the server checks too).
    if (!demo && state && !state.termsAccepted && NEEDS_TERMS.indexOf(body.action) !== -1) {
      modal = state.tradeName ? { type: "terms" } : { type: "name" };
      render();
      return Promise.reject(new Error("terms"));
    }
    if (demo) {
      flash = { text: "Preview Only: Nothing Was Saved. On The Live Site This " + (body.action === "buy" ? "Opens Checkout." : "Would Go Through.") };
      modal = null;
      showcaseEdit = null;
      render();
      return Promise.reject(new Error("demo"));
    }
    if (button) button.disabled = true;
    return fetch(url({}), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.data.error || "Something went wrong. Please try again.");
        return res.data;
      })
      .catch(function (error) {
        if (button) button.disabled = false;
        flash = { error: true, text: error.message };
        render();
        throw error;
      });
  }

  function act(body, button, message) {
    return post(body, button).then(function () {
      flash = message ? { text: message } : null;
      modal = null;
      return load();
    }).catch(function () {});
  }

  function wished(cardKey) {
    return state.wishlist.some(function (w) { return w.cardKey === cardKey; });
  }

  function wishButton(card) {
    if (!card.cardKey) return null;
    var on = wished(card.cardKey);
    return el("button", {
      class: "vm-btn vm-btn-ghost vm-btn-wide" + (on ? " vm-wish-on" : ""),
      type: "button",
      "aria-pressed": on ? "true" : "false",
      text: on ? "★ On Your Wishlist" : "☆ Add To Wishlist",
      onclick: function (e) {
        if (!state.tradeName) return needName();
        act({ action: on ? "unwish" : "wish", cardKey: card.cardKey }, e.currentTarget, on ? "Removed From Your Wishlist." : "Added To Your Wishlist. We'll Email You When One Goes Up.");
      },
    });
  }

  function ago(d) {
    var mins = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 60000));
    if (mins < 60) return mins + "m Ago";
    var hours = Math.round(mins / 60);
    if (hours < 48) return hours + "h Ago";
    return Math.round(hours / 24) + "d Ago";
  }

  function needName() {
    modal = { type: "name" };
    render();
  }

  // ---------- Card art with holo tilt ----------

  function art(card, size) {
    var img = card.imageUrl
      ? el("img", { src: card.imageUrl, alt: card.title, loading: size ? "eager" : "lazy", draggable: "false" })
      : el("span", { class: "vm-art-blank", text: card.title });
    var glare = el("span", { class: "vm-glare", "aria-hidden": "true" });
    var node = el("div", { class: "vm-art" + (size ? " vm-art-" + size : "") }, [img, glare]);
    if (!reduceMotion) {
      node.addEventListener("pointermove", function (e) {
        var r = node.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width;
        var y = (e.clientY - r.top) / r.height;
        node.style.setProperty("--rx", ((0.5 - y) * 14).toFixed(2) + "deg");
        node.style.setProperty("--ry", ((x - 0.5) * 16).toFixed(2) + "deg");
        node.style.setProperty("--gx", (x * 100).toFixed(1) + "%");
        node.style.setProperty("--gy", (y * 100).toFixed(1) + "%");
        node.classList.add("vm-art-live");
      });
      node.addEventListener("pointerleave", function () {
        node.classList.remove("vm-art-live");
        node.style.removeProperty("--rx");
        node.style.removeProperty("--ry");
      });
    }
    return node;
  }

  function tags(card) {
    return el("div", { class: "vm-tags" }, [
      card.listing && state.selling ? el("span", { class: "vm-tag vm-tag-sale", text: money(card.listing.price) }) : null,
      card.openToTrade ? el("span", { class: "vm-tag vm-tag-trade", text: "For Trade" }) : null,
      card.wantedBy ? el("span", { class: "vm-tag vm-tag-wanted", text: "Wanted By " + card.wantedBy }) : null,
      card.cardKey && card.trader && wished(card.cardKey) ? el("span", { class: "vm-tag vm-tag-wish", text: "★ On Your Wishlist" }) : null,
    ]);
  }

  // A card in a grid: big art, then name, set, owner and what it's up for. Clicking opens the card view.
  function tile(card, opts) {
    opts = opts || {};
    var open = function () {
      modal = { type: "card", card: card };
      render();
    };
    return el("article", { class: "vm-tile" }, [
      el("button", { class: "vm-tile-hit", type: "button", "aria-label": "View " + card.title, onclick: open }, [art(card)]),
      el("div", { class: "vm-tile-body" }, [
        el("h3", { class: "vm-tile-title", text: card.title }),
        el("div", { class: "vm-tile-meta" }, [
          card.trader && !opts.hideOwner
            ? el("a", { class: "vm-owner", href: profileHash(card.trader), text: "@" + card.trader })
            : null,
        ]),
        tags(card),
      ]),
    ]);
  }

  // ---------- Top bar ----------

  function topBar(current) {
    var incoming = state.offers.filter(function (o) { return o.incoming; }).length;
    var links = [
      ["market", "#/", "Market"],
      ["collectors", "#/collectors", "Collectors"],
      ["matches", "#/matches", "Matches"],
      ["wishlist", "#/wishlist", "Wishlist"],
      ["binder", "#/binder", "My Binder"],
      ["offers", "#/offers", "Offers"],
    ];
    var storeBar = el("div", { class: "vm-store-bar" }, [
      el("a", { class: "vm-store-back", href: "/" }, [el("span", { "aria-hidden": "true", text: "←" }), " Back To Poke-Collect"]),
      el("div", { class: "vm-store-links" }, [
        el("a", { href: "/apps/packs", text: "My Packs" }),
        el("a", { href: "/collections/all", text: "Shop" }),
        el("a", { href: "/account", text: "Account" }),
      ]),
    ]);
    return el("div", { class: "vm-top-wrap" }, [storeBar, el("header", { class: "vm-top" }, [
      el("a", { class: "vm-logo", href: "#/" }, [
        el("span", { class: "vm-logo-mark", text: "Vault Market" }),
        el("span", { class: "vm-logo-by", text: "By Poke-Collect" }),
      ]),
      el("nav", { class: "vm-nav", "aria-label": "Vault Market" }, links.map(function (l) {
        return el("a", { class: "vm-nav-link" + (current === l[0] ? " vm-nav-on" : ""), href: l[1], "aria-current": current === l[0] ? "page" : false }, [
          l[2],
          l[0] === "offers" && incoming ? el("span", { class: "vm-count", text: String(incoming) }) : null,
        ]);
      })),
      el("div", { class: "vm-top-right" }, [
        el("a", { class: "vm-credit-chip" + (current === "wallet" ? " vm-credit-chip-on" : ""), href: "#/wallet", title: "Vault Credit" }, [
          el("span", { class: "vm-credit-label", text: "Vault Credit" }),
          el("b", { text: money(state.credit) }),
        ]),
        state.tradeName
          ? el("a", { class: "vm-me", href: profileHash(state.tradeName) }, [el("span", { class: "vm-monogram", text: state.tradeName.charAt(0).toUpperCase() }), el("span", { class: "vm-me-name", text: "@" + state.tradeName })])
          : el("button", { class: "vm-btn vm-btn-small", type: "button", text: "Pick A Trade Name", onclick: needName }),
      ]),
    ])]);
  }

  // ---------- Market ----------

  function marketView() {
    var board = state.board.slice();
    var q = filters.q.toLowerCase();
    var shown = board.filter(function (c) {
      if (q && c.title.toLowerCase().indexOf(q) < 0 && String(c.trader).toLowerCase().indexOf(q) < 0) return false;
      if (filters.kind === "trade" && !c.openToTrade) return false;
      if (filters.kind === "sale" && !c.listing) return false;
      return true;
    });
    if (filters.sort === "priceUp" || filters.sort === "priceDown") {
      shown = shown.filter(function (c) { return c.listing; });
      shown.sort(function (a, b) { return filters.sort === "priceUp" ? a.listing.price - b.listing.price : b.listing.price - a.listing.price; });
    } else if (filters.sort === "name") {
      shown.sort(function (a, b) { return a.title.localeCompare(b.title); });
    }
    var collectorCount = {};
    board.forEach(function (c) { collectorCount[c.trader] = 1; });

    var search = el("input", { id: "vm-search", class: "vm-input vm-search", type: "search", placeholder: "Search Cards Or Collectors", value: filters.q, "aria-label": "Search cards or collectors" });
    search.addEventListener("input", function () {
      filters.q = search.value;
      var pos = search.selectionStart;
      render();
      var again = document.getElementById("vm-search");
      if (again) {
        again.focus();
        try { again.setSelectionRange(pos, pos); } catch (e) { /* some inputs refuse a selection */ }
      }
    });

    function chip(group, value, label) {
      var on = filters[group] === value;
      return el("button", {
        class: "vm-chip" + (on ? " vm-chip-on" : ""),
        type: "button",
        "aria-pressed": on ? "true" : "false",
        text: label,
        onclick: function () { filters[group] = value; render(); },
      });
    }
    var sort = el("select", { id: "vm-sort", class: "vm-input vm-select", "aria-label": "Sort" }, [
      ["new", "Newest"],
      ["name", "Name A–Z"],
    ].concat(state.selling ? [["priceUp", "Price: Low To High"], ["priceDown", "Price: High To Low"]] : []).map(function (o) {
      return el("option", { value: o[0], text: o[1], selected: filters.sort === o[0] });
    }));
    sort.addEventListener("change", function () { filters.sort = sort.value; render(); });

    return el("main", { class: "vm-main" }, [
      el("section", { class: "vm-hero" }, [
        el("div", { class: "vm-hero-copy" }, [
          el("p", { class: "vm-eyebrow", text: "Player To Player" }),
          el("h1", { class: "vm-hero-title" }, ["Every Card Here Is ", el("em", { text: "In A Real Vault." })]),
          el("p", { class: "vm-hero-text", text: state.selling
            ? "Trade With Other Collectors Or Buy Straight From Their Binders. Cards Change Hands Inside The Poke-Collect Vault, So Nothing Gets Lost In The Mail."
            : "Trade With Other Collectors. Cards Change Hands Inside The Poke-Collect Vault, So Nothing Gets Lost In The Mail." }),
          el("dl", { class: "vm-hero-stats" }, [
            stat(board.length, "Cards Up"),
            stat(Object.keys(collectorCount).length, "Collectors"),
            stat(board.filter(function (c) { return c.openToTrade; }).length, "Open To Trade"),
          ]),
        ]),
        heroFan(board),
      ]),
      !state.tradeName ? welcome() : null,
      feedStrip(),
      el("div", { class: "vm-filters" }, [
        search,
        el("div", { class: "vm-chips", role: "group", "aria-label": "Show" }, [
          chip("kind", "all", "All"),
          chip("kind", "trade", "For Trade"),
          state.selling ? chip("kind", "sale", "For Sale") : null,
        ]),
        sort,
      ]),
      el("p", { class: "vm-result-count", text: shown.length + (shown.length === 1 ? " Card" : " Cards") }),
      shown.length
        ? el("div", { class: "vm-grid" }, shown.map(function (c) { return tile(c); }))
        : el("p", { class: "vm-empty", text: board.length ? "No Cards Match These Filters." : "Nothing Is Up Yet. Mark Cards In Your Binder Open To Trade To Get Things Started." }),
    ]);
  }

  // Live From The Vault: the latest listings, sales and trades. Never prices.
  function feedStrip() {
    if (!state.feed.length) return null;
    return el("section", { class: "vm-feed", "aria-label": "Latest activity" }, [
      el("div", { class: "vm-feed-head" }, [el("span", { class: "vm-live", "aria-hidden": "true" }), el("span", { class: "vm-label", text: "Live From The Vault" })]),
      el("div", { class: "vm-feed-row" }, state.feed.map(function (ev) {
        var line = ev.type === "trade"
          ? [el("a", { href: profileHash(ev.who), text: "@" + ev.who }), " Traded With ", el("a", { href: profileHash(ev.from), text: "@" + ev.from })]
          : ev.type === "sold"
            ? [el("a", { href: profileHash(ev.who), text: "@" + ev.who }), " Bought From ", el("a", { href: profileHash(ev.from), text: "@" + ev.from })]
            : [el("a", { href: profileHash(ev.who), text: "@" + ev.who }), " Listed A Card"];
        return el("div", { class: "vm-feed-item" }, [
          el("div", { class: "vm-feed-cards" }, ev.cards.slice(0, 2).map(function (c) {
            return c.imageUrl ? el("img", { src: c.imageUrl, alt: "", loading: "lazy" }) : null;
          })),
          el("div", { class: "vm-feed-text" }, [
            el("p", {}, line),
            el("p", { class: "vm-fine", text: ev.cards[0].title }),
            el("p", { class: "vm-fine", text: ago(ev.at) }),
          ]),
        ]);
      })),
    ]);
  }

  function stat(n, label) {
    return el("div", { class: "vm-stat" }, [el("dt", { text: label }), el("dd", { text: String(n) })]);
  }

  // Three cards fanned in the hero: the board's newest art.
  function heroFan(board) {
    var picks = board.filter(function (c) { return c.imageUrl; }).slice(0, 3);
    if (!picks.length) return null;
    return el("div", { class: "vm-fan", "aria-hidden": "true" }, picks.map(function (c, i) {
      return el("img", { class: "vm-fan-card vm-fan-" + i, src: c.imageUrl, alt: "" });
    }));
  }

  function welcome() {
    return el("section", { class: "vm-welcome" }, [
      el("div", {}, [
        el("h2", { text: "Pick A Trade Name To Start" }),
        el("p", { text: "Other Collectors See Your Trade Name, Never Your Real Name Or Email. You Need One To Trade, Buy Or Share Your Binder." }),
      ]),
      el("button", { class: "vm-btn vm-btn-signal", type: "button", text: "Pick A Trade Name", onclick: needName }),
    ]);
  }

  // ---------- Collectors ----------

  function collectorsView() {
    if (!collectorsCache) {
      getJSON({ view: "collectors" }).then(function (list) {
        collectorsCache = list;
        render();
      }).catch(function () { collectorsCache = []; render(); });
      return el("main", { class: "vm-main" }, [el("p", { class: "vm-empty", text: "Loading Collectors…" })]);
    }
    return el("main", { class: "vm-main" }, [
      el("div", { class: "vm-page-head" }, [
        el("p", { class: "vm-eyebrow", text: "Collectors" }),
        el("h1", { class: "vm-page-title", text: "Browse Binders" }),
        el("p", { class: "vm-page-text", text: "Open A Collector's Binder To See What They Have. Some Share Their Whole Vault; Others Only Show The Cards They've Put Up." }),
      ]),
      collectorsCache.length
        ? el("div", { class: "vm-collectors" }, collectorsCache.map(function (c) {
            return el("a", { class: "vm-collector", href: profileHash(c.name) }, [
              el("div", { class: "vm-collector-fan" }, c.preview.map(function (p, i) {
                return p.imageUrl ? el("img", { class: "vm-mini-fan vm-mini-fan-" + i, src: p.imageUrl, alt: "", loading: "lazy" }) : null;
              })),
              el("div", { class: "vm-collector-body" }, [
                el("div", { class: "vm-collector-name" }, [el("span", { class: "vm-monogram", text: c.name.charAt(0).toUpperCase() }), "@" + c.name]),
                el("div", { class: "vm-collector-stats" }, [
                  el("span", {}, [el("b", { text: String(c.cards) }), c.shared ? " In Binder" : " Up For Trade Or Sale"]),
                  el("span", {}, [el("b", { text: String(c.trades) }), c.trades === 1 ? " Trade" : " Trades"]),
                ]),
                el("div", { class: "vm-collector-foot" }, [
                  c.shared ? el("span", { class: "vm-tag vm-tag-shared", text: "Full Binder" }) : null,
                  el("span", { class: "vm-fine", text: "Since " + since(c.since) }),
                ]),
              ]),
            ]);
          }))
        : el("p", { class: "vm-empty", text: "No Collectors Yet." }),
    ]);
  }

  // ---------- One collection (binder) ----------

  function collectionView(who) {
    var key = who.toLowerCase();
    var data = collectionCache[key];
    if (!data) {
      getJSON({ view: "collection", name: who }).then(function (d) {
        collectionCache[key] = d;
        render();
      }).catch(function (error) {
        collectionCache[key] = { error: error.message };
        render();
      });
      return el("main", { class: "vm-main" }, [el("p", { class: "vm-empty", text: "Opening Binder…" })]);
    }
    if (data.error) return el("main", { class: "vm-main" }, [el("p", { class: "vm-empty", text: data.error })]);

    var cards = data.cards.filter(function (c) {
      if (binderFilter === "trade") return c.openToTrade;
      if (binderFilter === "sale") return c.listing;
      return true;
    });
    var perPage = window.matchMedia && window.matchMedia("(min-width: 980px)").matches ? 18 : 9;
    var pages = Math.max(1, Math.ceil(cards.length / perPage));
    if (binderPage >= pages) binderPage = pages - 1;
    var slice = cards.slice(binderPage * perPage, binderPage * perPage + perPage);
    var sheets = [];
    for (var s = 0; s < perPage / 9; s++) sheets.push(slice.slice(s * 9, s * 9 + 9));

    function binderChip(value, label) {
      return el("button", {
        class: "vm-chip" + (binderFilter === value ? " vm-chip-on" : ""),
        type: "button",
        "aria-pressed": binderFilter === value ? "true" : "false",
        text: label,
        onclick: function () { binderFilter = value; binderPage = 0; render(); },
      });
    }

    var canOffer = !data.own && data.cards.some(function (c) { return c.openToTrade; });
    var owned = function (c) { return Object.assign({}, c, { trader: data.own ? null : data.name }); };
    return el("main", { class: "vm-main" }, [
      el("section", { class: "vm-profile" }, [
        el("span", { class: "vm-monogram vm-monogram-big", text: data.name.charAt(0).toUpperCase() }),
        el("div", { class: "vm-profile-copy" }, [
          el("p", { class: "vm-eyebrow", text: data.own ? "Your Binder" : data.shared ? "Full Binder" : "Cards Up For Trade Or Sale" }),
          el("h1", { class: "vm-page-title", text: "@" + data.name }),
          el("p", { class: "vm-page-text", text: "Collecting Since " + since(data.since) + " · " + data.trades + (data.trades === 1 ? " Completed Trade" : " Completed Trades") }),
        ]),
        el("dl", { class: "vm-profile-stats" }, [
          stat(data.stats.cards, "Cards"),
          stat(data.stats.forTrade, "For Trade"),
          state.selling ? stat(data.stats.forSale, "For Sale") : null,
          stat(data.stats.sets, data.stats.sets === 1 ? "Set" : "Sets"),
        ]),
        canOffer
          ? el("button", { class: "vm-btn vm-btn-signal vm-profile-cta", type: "button", text: "Offer A Trade", onclick: function () {
              if (!state.tradeName) return needName();
              openOffer({ trader: data.name, get: [] });
            } })
          : null,
      ]),
      data.own ? ownBinderSettings() : null,
      data.showcase.length
        ? el("section", { class: "vm-showcase" }, [
            el("h2", { class: "vm-section-title", text: "Showcase" }),
            el("div", { class: "vm-showcase-row" }, data.showcase.map(function (c) { return tile(owned(c), { hideOwner: true }); })),
          ])
        : null,
      el("section", { class: "vm-binder-wrap" }, [
        el("div", { class: "vm-binder-head" }, [
          el("h2", { class: "vm-section-title", text: "Binder" }),
          el("div", { class: "vm-chips" }, [binderChip("all", "Everything"), binderChip("trade", "For Trade"), state.selling ? binderChip("sale", "For Sale") : null]),
        ]),
        cards.length
          ? el("div", { class: "vm-binder" }, sheets.filter(function (sheet, i) { return i === 0 || sheet.length; }).map(function (sheet) {
              var pockets = [];
              for (var i = 0; i < 9; i++) {
                var c = sheet[i];
                pockets.push(c
                  ? el("div", { class: "vm-pocket" }, [tile(owned(c), { hideOwner: true })])
                  : el("div", { class: "vm-pocket vm-pocket-empty", "aria-hidden": "true" }));
              }
              return el("div", { class: "vm-sheet" }, pockets);
            }))
          : el("p", { class: "vm-empty", text: "No Cards Here Yet." }),
        pages > 1
          ? el("div", { class: "vm-pager" }, [
              el("button", { class: "vm-btn vm-btn-ghost", type: "button", text: "Previous Page", disabled: binderPage === 0, onclick: function () { binderPage--; render(); } }),
              el("span", { class: "vm-pager-n", text: "Page " + (binderPage + 1) + " Of " + pages }),
              el("button", { class: "vm-btn vm-btn-ghost", type: "button", text: "Next Page", disabled: binderPage >= pages - 1, onclick: function () { binderPage++; render(); } }),
            ])
          : null,
      ]),
    ]);
  }

  function ownBinderSettings() {
    var me = state.me || {};
    var share = el("input", { id: "vm-share", type: "checkbox", checked: !!me.showCollection });
    share.addEventListener("change", function () {
      act({ action: "collection", showCollection: share.checked }, share, share.checked ? "Your Whole Binder Is Now Visible To Other Collectors." : "Only Cards You Put Up Are Visible Now.");
    });
    return el("section", { class: "vm-own" }, [
      el("label", { class: "vm-switch", for: "vm-share" }, [share, el("span", { class: "vm-switch-ui", "aria-hidden": "true" }), el("span", {}, [
        el("strong", { text: "Share My Whole Binder" }),
        el("span", { class: "vm-muted", text: " When Off, Other Collectors Only See Cards You Put Up For Trade Or Sale." }),
      ])]),
      el("div", { class: "vm-own-actions" }, [
        el("button", { class: "vm-btn vm-btn-ghost vm-btn-small", type: "button", text: "Edit Showcase", onclick: function () {
          showcaseEdit = new Set(me.showcase || []);
          go("#/binder");
        } }),
        el("a", { class: "vm-link", href: "#/binder", text: "Manage Trades And Listings" }),
      ]),
    ]);
  }

  // ---------- My Binder (manage) ----------

  function binderView() {
    if (!state.tradeName) return el("main", { class: "vm-main" }, [welcome()]);
    var editing = !!showcaseEdit;
    return el("main", { class: "vm-main" }, [
      el("div", { class: "vm-page-head vm-page-head-row" }, [
        el("div", {}, [
          el("p", { class: "vm-eyebrow", text: "My Binder" }),
          el("h1", { class: "vm-page-title", text: editing ? "Pick Your Showcase" : "Put Cards Up" }),
          el("p", { class: "vm-page-text", text: editing
            ? "Tap Up To " + state.rules.maxShowcase + " Cards To Pin Them At The Top Of Your Binder Page."
            : "Mark Cards Open To Trade" + (state.selling ? " Or Set A Price To Sell Them" : "") + "." + (state.rules.waitDays ? " Cards Can Change Hands " + state.rules.waitDays + " Days After Their Pack Order." : "") }),
        ]),
        editing
          ? el("div", { class: "vm-own-actions" }, [
              el("button", { class: "vm-btn vm-btn-signal", type: "button", text: "Save Showcase (" + showcaseEdit.size + ")", onclick: function (e) {
                var picked = Array.from(showcaseEdit);
                act({ action: "collection", showcase: picked }, e.currentTarget, "Showcase Saved.").then(function () { showcaseEdit = null; });
              } }),
              el("button", { class: "vm-link", type: "button", text: "Cancel", onclick: function () { showcaseEdit = null; render(); } }),
            ])
          : el("div", { class: "vm-own-actions" }, [
              el("button", { class: "vm-btn vm-btn-ghost", type: "button", text: "Edit Showcase", onclick: function () { showcaseEdit = new Set((state.me && state.me.showcase) || []); render(); } }),
              el("a", { class: "vm-btn vm-btn-ghost", href: profileHash(state.tradeName), text: "View My Binder Page" }),
            ]),
      ]),
      state.cards.length
        ? el("div", { class: "vm-grid vm-grid-manage" }, state.cards.map(function (c) { return editing ? pickTile(c) : manageTile(c); }))
        : el("p", { class: "vm-empty", text: "Your Vault Is Empty. Cards You Pull From Mystery Packs Show Up Here." }),
    ]);
  }

  function pickTile(c) {
    var on = showcaseEdit.has(c.pullId);
    return el("button", {
      class: "vm-pick" + (on ? " vm-pick-on" : ""),
      type: "button",
      "aria-pressed": on ? "true" : "false",
      onclick: function () {
        if (on) showcaseEdit.delete(c.pullId);
        else if (showcaseEdit.size < state.rules.maxShowcase) showcaseEdit.add(c.pullId);
        render();
      },
    }, [art(c), el("span", { class: "vm-pick-title", text: c.title })]);
  }

  function manageTile(c) {
    var controls = [];
    if (c.locked) {
      controls.push(el("span", { class: "vm-tag vm-tag-locked", text: c.locked }));
    } else {
      var toggle = el("input", { id: "vm-trade-" + c.pullId, type: "checkbox", checked: c.openToTrade });
      toggle.addEventListener("change", function () {
        act({ action: "openToTrade", pullId: c.pullId, on: toggle.checked }, toggle);
      });
      controls.push(el("label", { class: "vm-switch vm-switch-small", for: "vm-trade-" + c.pullId }, [toggle, el("span", { class: "vm-switch-ui", "aria-hidden": "true" }), el("strong", { text: "Open To Trade" })]));
      if (c.inOffer) controls.push(el("span", { class: "vm-tag vm-tag-locked", text: "In Your Offer" }));
      if (state.selling) controls.push(sellForm(c));
    }
    return el("article", { class: "vm-tile vm-tile-manage" }, [
      el("button", { class: "vm-tile-hit", type: "button", "aria-label": "View " + c.title, onclick: function () { modal = { type: "card", card: c, mine: true }; render(); } }, [art(c)]),
      el("div", { class: "vm-tile-body" }, [
        el("h3", { class: "vm-tile-title", text: c.title }),
        el("div", { class: "vm-manage" }, controls),
      ]),
    ]);
  }

  // Price Guide: how a price compares with the TCGplayer market price. Only a suggestion, and only the owner sees it.
  var PRICE_BANDS = [
    { upTo: 0.6, key: "steal", label: "Great Price", note: "Well Under Market. It Should Sell Fast, But You Could Ask More." },
    { upTo: 0.9, key: "great", label: "Great Price", note: "Under Market. Likely To Sell Fast." },
    { upTo: 1.02, key: "good", label: "Good Price", note: "Right At Market. Should Sell Quickly." },
    { upTo: 1.15, key: "fair", label: "Fair Price", note: "A Little Over Market. May Take A Few Days." },
    { upTo: 1.4, key: "high", label: "High Price", note: "Over Market. Could Take A While To Sell." },
    { upTo: Infinity, key: "over", label: "Overpriced", note: "Well Over Market. Unlikely To Sell Soon." },
  ];

  function priceBand(price, market) {
    var ratio = price / market;
    for (var i = 0; i < PRICE_BANDS.length; i++) if (ratio <= PRICE_BANDS[i].upTo) return PRICE_BANDS[i];
    return PRICE_BANDS[PRICE_BANDS.length - 1];
  }

  function loadGuide(pullId) {
    if (guides[pullId]) return;
    guides[pullId] = "loading";
    getJSON({ view: "priceGuide", pull: pullId })
      .then(function (g) { guides[pullId] = g && g.market ? g : { market: null }; })
      .catch(function () { guides[pullId] = { market: null }; })
      .then(function () { if (route().name === "binder") render(); });
  }

  function sellForm(c) {
    var r = state.rules;
    var price = el("input", { id: "vm-price-" + c.pullId, class: "vm-input vm-price", type: "number", min: String(r.minPrice), max: String(r.maxPrice), step: "0.01", placeholder: "0.00", value: c.listing ? Number(c.listing.price).toFixed(2) : "", "aria-label": "Price for " + c.title });
    var list = el("button", { class: "vm-btn vm-btn-small", type: "button", text: c.listing ? "Update" : "Sell" });
    list.addEventListener("click", function () {
      act({ action: "list", pullId: c.pullId, price: Number(price.value) }, list, "Listed In The Market.");
    });
    return el("div", { class: "vm-sell" }, [
      priceGuide(c, price),
      el("div", { class: "vm-sell-row" }, [el("span", { class: "vm-dollar", text: "$" }), price, list]),
      c.listing
        ? el("button", { class: "vm-link", type: "button", text: "Stop Selling", onclick: function (e) { act({ action: "unlist", listingId: c.listing.id }, e.currentTarget, "Listing Removed."); } })
        : null,
      el("span", { class: "vm-fine", text: "You Get " + (100 - state.feePercent) + "% As Vault Credit" + (r.payoutDays ? " (Right Away When The Buyer Pays With Vault Credit, " + r.payoutDays + " Days After A Card Payment)." : " As Soon As It Sells.") }),
    ]);
  }

  function priceGuide(c, price) {
    loadGuide(c.pullId);
    var g = guides[c.pullId];
    if (g === "loading") return el("p", { class: "vm-guide-wait", text: "Checking The Market Price…" });
    if (!g || !g.market) return el("p", { class: "vm-guide-wait", text: "No Price Guide For This Card Yet. You Can Still Set Any Price." });
    var r = state.rules;
    var market = g.market;
    // The slider spans half to double the market price; typing can still go anywhere from the minimum to the maximum.
    var lo = Math.max(r.minPrice, Math.floor(market * 0.5 * 100) / 100);
    var hi = Math.min(r.maxPrice, Math.max(lo + 1, Math.ceil(market * 2)));
    var step = market < 20 ? "0.25" : market < 200 ? "1" : "5";
    var slider = el("input", { class: "vm-guide-slider", type: "range", min: String(lo), max: String(hi), step: step, value: String(price.value ? Number(price.value) : market), "aria-label": "Slide to set a price for " + c.title });
    var pill = el("span", { class: "vm-guide-pill" });
    var note = el("span", { class: "vm-guide-note" });
    var marker = el("span", { class: "vm-guide-mark", "aria-hidden": "true" });
    marker.style.left = ((market - lo) / (hi - lo)) * 100 + "%";

    function show(value) {
      if (!(value > 0)) {
        pill.className = "vm-guide-pill";
        pill.textContent = "Slide To Set A Price";
        note.textContent = "";
        return;
      }
      var band = priceBand(value, market);
      pill.className = "vm-guide-pill vm-guide-" + band.key;
      pill.textContent = band.label;
      note.textContent = band.note;
    }
    slider.addEventListener("input", function () {
      price.value = Number(slider.value).toFixed(2);
      show(Number(slider.value));
    });
    price.addEventListener("input", function () {
      var v = Number(price.value);
      if (v > 0) slider.value = String(Math.min(hi, Math.max(lo, v)));
      show(v);
    });
    show(price.value ? Number(price.value) : 0);

    return el("div", { class: "vm-guide" }, [
      el("div", { class: "vm-guide-head" }, [
        el("span", { class: "vm-guide-label", text: "Price Guide" }),
        el("span", { class: "vm-guide-market", text: "TCGplayer Market " + money(market) + (g.printing ? " · " + g.printing : "") }),
      ]),
      el("div", { class: "vm-guide-track" }, [slider, marker]),
      el("div", { class: "vm-guide-verdict", role: "status" }, [pill, note]),
      el("span", { class: "vm-fine", text: "Just A Suggestion. You Set The Price." }),
    ]);
  }

  // ---------- Trade Matches ----------

  function matchesView() {
    if (!state.tradeName) return el("main", { class: "vm-main" }, [welcome()]);
    if (!matchesCache) {
      getJSON({ view: "matches" }).then(function (list) { matchesCache = list; render(); }).catch(function () { matchesCache = []; render(); });
      return el("main", { class: "vm-main" }, [el("p", { class: "vm-empty", text: "Finding Matches…" })]);
    }
    return el("main", { class: "vm-main" }, [
      el("div", { class: "vm-page-head" }, [
        el("p", { class: "vm-eyebrow", text: "Trade Matches" }),
        el("h1", { class: "vm-page-title", text: "Collectors You Should Trade With" }),
        el("p", { class: "vm-page-text", text: "Built From Wishlists. A Perfect Match Has A Card You Want And Wants A Card You Have." }),
      ]),
      matchesCache.length
        ? el("div", { class: "vm-matches" }, matchesCache.map(matchCard))
        : el("div", { class: "vm-empty-box" }, [
            el("p", { text: state.wishlist.length ? "No Matches Yet. New Cards Go Up All The Time, So Check Back Soon." : "Add Cards To Your Wishlist And Matches Show Up Here." }),
            el("a", { class: "vm-btn vm-btn-ghost", href: "#/wishlist", text: "Build Your Wishlist" }),
          ]),
    ]);
  }

  function matchCard(m) {
    function strip(label, cards, empty) {
      return el("div", { class: "vm-match-side" }, [
        el("div", { class: "vm-label", text: label }),
        cards.length
          ? el("div", { class: "vm-offer-cards" }, cards.map(function (c) {
              return el("button", { class: "vm-offer-card", type: "button", onclick: function () { modal = { type: "card", card: c }; render(); } }, [art(c, "small"), el("span", { text: c.title })]);
            }))
          : el("p", { class: "vm-fine", text: empty }),
      ]);
    }
    return el("article", { class: "vm-offer vm-match" + (m.perfect ? " vm-match-perfect" : "") }, [
      el("header", { class: "vm-offer-head" }, [
        el("a", { class: "vm-owner vm-owner-big", href: profileHash(m.trader), text: "@" + m.trader }),
        m.perfect ? el("span", { class: "vm-tag vm-tag-perfect", text: "Perfect Match" }) : null,
      ]),
      el("div", { class: "vm-offer-sides" }, [
        strip("They Have From Your Wishlist", m.theyHave, "Nothing From Your Wishlist Is Up Yet."),
        el("span", { class: "vm-swap", "aria-hidden": "true", text: "⇄" }),
        strip("They Want From Your Binder", m.theyWant, "None Of Your Tradable Cards Are On Their Wishlist."),
      ]),
      el("div", { class: "vm-offer-actions" }, [
        m.theyHave.length
          ? el("button", { class: "vm-btn vm-btn-signal", type: "button", text: "Propose This Trade", onclick: function () {
              openOffer({ trader: m.trader, get: m.theyHave.map(function (c) { return c.pullId; }), give: m.theyWant.map(function (c) { return c.pullId; }) });
            } })
          : null,
        el("a", { class: "vm-link", href: profileHash(m.trader), text: "Open Their Binder" }),
      ]),
    ]);
  }

  // ---------- Wishlist ----------

  function wishlistView() {
    if (!state.tradeName) return el("main", { class: "vm-main" }, [welcome()]);
    var input = el("input", { id: "vm-catalog", class: "vm-input vm-search", type: "search", placeholder: "Search Every Card That's Been In A Pack", value: catalogQuery, "aria-label": "Search cards to add" });
    var timer = null;
    input.addEventListener("input", function () {
      catalogQuery = input.value;
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (!catalogQuery.trim()) { catalogResults = null; render(); focusCatalog(); return; }
        getJSON({ view: "catalog", name: catalogQuery.trim(), q: catalogQuery.trim() }).then(function (list) {
          catalogResults = list;
          render();
          focusCatalog();
        }).catch(function () {});
      }, 250);
    });
    return el("main", { class: "vm-main" }, [
      el("div", { class: "vm-page-head" }, [
        el("p", { class: "vm-eyebrow", text: "Wishlist" }),
        el("h1", { class: "vm-page-title", text: "Cards You're Looking For" }),
        el("p", { class: "vm-page-text", text: "We'll Email You When A Card On Your Wishlist Goes Up For Trade Or Sale, And Collectors See That It's Wanted." }),
      ]),
      el("div", { class: "vm-filters" }, [input]),
      catalogResults
        ? el("section", { class: "vm-catalog" }, [
            el("div", { class: "vm-label", text: catalogResults.length ? "Add To Your Wishlist" : "No Cards Match" }),
            el("div", { class: "vm-pick-grid vm-catalog-grid" }, catalogResults.map(function (c) {
              var on = wished(c.cardKey);
              return el("button", {
                class: "vm-pick" + (on ? " vm-pick-on" : ""),
                type: "button",
                "aria-pressed": on ? "true" : "false",
                onclick: function (e) { act({ action: on ? "unwish" : "wish", cardKey: c.cardKey }, e.currentTarget, on ? "Removed From Your Wishlist." : "Added To Your Wishlist."); },
              }, [art(c, "small"), el("span", { class: "vm-pick-title", text: (on ? "★ " : "+ ") + c.title })]);
            })),
          ])
        : null,
      el("h2", { class: "vm-section-title vm-gap", text: "Your Wishlist (" + state.wishlist.length + ")" }),
      state.wishlist.length
        ? el("div", { class: "vm-grid" }, state.wishlist.map(function (w) {
            return el("article", { class: "vm-tile" }, [
              art(w),
              el("div", { class: "vm-tile-body" }, [
                el("h3", { class: "vm-tile-title", text: w.title }),
                w.available
                  ? el("button", { class: "vm-btn vm-btn-small vm-btn-signal", type: "button", text: w.available + " Up Now", onclick: function () {
                      filters.q = w.title;
                      filters.kind = "all";
                      go("#/");
                    } })
                  : el("span", { class: "vm-tag vm-tag-locked", text: "None Up Yet" }),
                el("button", { class: "vm-link", type: "button", text: "Remove", onclick: function (e) { act({ action: "unwish", cardKey: w.cardKey }, e.currentTarget, "Removed From Your Wishlist."); } }),
              ]),
            ]);
          }))
        : el("p", { class: "vm-empty", text: "Search Above, Or Tap Add To Wishlist On Any Card In The Market." }),
    ]);
  }

  function focusCatalog() {
    var again = document.getElementById("vm-catalog");
    if (again) {
      again.focus();
      try { again.setSelectionRange(again.value.length, again.value.length); } catch (e) { /* some inputs refuse a selection */ }
    }
  }

  // ---------- Wallet (Vault Credit) ----------

  var KIND_LABEL = { SALE: "Card Sold", PURCHASE: "Card Bought", CODE: "Store Code Made", CODE_RETURN: "Returned To Balance", ADJUST: "Adjustment" };

  function walletView() {
    if (!walletCache) {
      getJSON({ view: "wallet" }).then(function (w) { walletCache = w; render(); }).catch(function () { walletCache = { balance: state.credit, history: [], codes: [], codesEnabled: false }; render(); });
      return el("main", { class: "vm-main" }, [el("p", { class: "vm-empty", text: "Opening Your Wallet…" })]);
    }
    var w = walletCache;
    var amount = el("input", { id: "vm-code-amount", class: "vm-input vm-price", type: "number", min: "1", max: String(w.balance), step: "0.01", value: w.balance >= 1 ? w.balance.toFixed(2) : "", "aria-label": "Amount for the code" });
    var make = el("button", { class: "vm-btn vm-btn-signal", type: "button", text: "Make A Store Code", disabled: !w.codesEnabled || w.balance < 1 });
    make.addEventListener("click", function () {
      post({ action: "useCredit", amount: Number(amount.value) }, make).then(function (res) {
        newCode = res;
        flash = { text: "Your Code Is Ready. Use It At Checkout On The Main Store." };
        return load();
      }).catch(function () {});
    });
    var active = w.codes.filter(function (c) { return c.status === "ACTIVE"; });
    return el("main", { class: "vm-main" }, [
      el("section", { class: "vm-wallet-hero" }, [
        el("div", {}, [
          el("p", { class: "vm-eyebrow", text: "Vault Credit" }),
          el("p", { class: "vm-wallet-balance", text: money(w.balance) }),
          el("p", { class: "vm-page-text", text: "Earned From Selling Cards. Spend It On Other Collectors' Cards Here, Or Turn It Into A Code For Singles, Sealed And Accessories On The Main Store. Vault Credit Can't Be Used On Mystery Packs." }),
        ]),
        el("div", { class: "vm-wallet-use" }, [
          el("div", { class: "vm-label", text: "Use Credit In The Store" }),
          w.codesEnabled
            ? el("div", { class: "vm-sell-row" }, [el("span", { class: "vm-dollar", text: "$" }), amount, make])
            : el("p", { class: "vm-fine", text: "Store Codes Are Coming Soon." }),
          el("p", { class: "vm-fine", text: "One-Time Code For Your Account, Good For " + (w.codeDays || 30) + " Days. Anything The Order Doesn't Use Comes Back To Your Balance." }),
          newCode ? codeBox(newCode.code, newCode.amount) : null,
        ]),
      ]),
      active.length
        ? el("section", { class: "vm-wallet-section" }, [
            el("h2", { class: "vm-section-title", text: "Open Codes" }),
            el("div", { class: "vm-codes" }, active.map(function (c) {
              return el("div", { class: "vm-code-row" }, [
                codeBox(c.code, c.amount),
                el("span", { class: "vm-fine", text: "Expires " + new Date(c.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) }),
                el("button", { class: "vm-link", type: "button", text: "Return To Balance", onclick: function (e) {
                  act({ action: "returnCode", codeId: c.id }, e.currentTarget, money(c.amount) + " Is Back In Your Balance.");
                } }),
              ]);
            })),
          ])
        : null,
      el("section", { class: "vm-wallet-section" }, [
        el("h2", { class: "vm-section-title", text: "History" }),
        w.history.length
          ? el("div", { class: "vm-ledger", role: "table", "aria-label": "Vault Credit history" }, w.history.map(function (h) {
              return el("div", { class: "vm-ledger-row", role: "row" }, [
                el("span", { role: "cell", class: "vm-fine", text: new Date(h.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) }),
                el("span", { role: "cell" }, [el("strong", { text: KIND_LABEL[h.kind] || h.kind }), h.note ? el("span", { class: "vm-muted", text: " · " + h.note }) : null]),
                el("span", { role: "cell", class: "vm-ledger-amt" + (h.amount < 0 ? " vm-neg" : ""), text: (h.amount < 0 ? "−" : "+") + money(Math.abs(h.amount)) }),
              ]);
            }))
          : el("p", { class: "vm-empty", text: "No Vault Credit Yet. Sell A Card In My Binder To Earn Some." }),
      ]),
    ]);
  }

  function codeBox(code, amount) {
    var copy = el("button", { class: "vm-btn vm-btn-small", type: "button", text: "Copy" });
    copy.addEventListener("click", function () {
      var done = function () { copy.textContent = "Copied"; };
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(done).catch(function () {});
    });
    return el("div", { class: "vm-code" }, [
      el("span", { class: "vm-code-text", text: code }),
      el("span", { class: "vm-code-amt", text: money(amount) }),
      copy,
    ]);
  }

  // ---------- Offers ----------

  function offersView() {
    var incoming = state.offers.filter(function (o) { return o.incoming; });
    var outgoing = state.offers.filter(function (o) { return !o.incoming; });
    return el("main", { class: "vm-main" }, [
      el("div", { class: "vm-page-head" }, [
        el("p", { class: "vm-eyebrow", text: "Offers" }),
        el("h1", { class: "vm-page-title", text: "Trade Offers" }),
        el("p", { class: "vm-page-text", text: "Offers Last " + state.rules.offerDays + " Days. A Trade Happens The Moment It's Accepted, And It's Final." }),
      ]),
      el("h2", { class: "vm-section-title", text: "Sent To You" }),
      incoming.length ? el("div", { class: "vm-offers" }, incoming.map(offerCard)) : el("p", { class: "vm-empty", text: "No Offers Right Now." }),
      el("h2", { class: "vm-section-title", text: "Sent By You" }),
      outgoing.length ? el("div", { class: "vm-offers" }, outgoing.map(offerCard)) : el("p", { class: "vm-empty", text: "You Haven't Sent Any Offers." }),
    ]);
  }

  function offerCard(o) {
    var buttons = o.incoming
      ? [
          el("button", { class: "vm-btn vm-btn-signal", type: "button", text: "Accept Trade", onclick: function (e) { act({ action: "accept", tradeId: o.id }, e.currentTarget, "Trade Done! The Cards Are In Your Binder."); } }),
          el("button", { class: "vm-btn vm-btn-ghost", type: "button", text: "Counter Offer", onclick: function () {
            openOffer({
              trader: o.with,
              get: o.youGet.map(function (c) { return c.pullId; }),
              give: o.youGive.map(function (c) { return c.pullId; }),
              counterOfId: o.id,
              counterCards: o.youGet,
            });
          } }),
          el("button", { class: "vm-link", type: "button", text: "Decline", onclick: function (e) { act({ action: "decline", tradeId: o.id }, e.currentTarget, "Offer Declined."); } }),
        ]
      : [el("button", { class: "vm-link", type: "button", text: "Cancel Offer", onclick: function (e) { act({ action: "cancel", tradeId: o.id }, e.currentTarget, "Offer Cancelled."); } })];
    return el("article", { class: "vm-offer" }, [
      el("header", { class: "vm-offer-head" }, [
        el("a", { class: "vm-owner vm-owner-big", href: profileHash(o.with), text: "@" + o.with }),
        o.note ? el("span", { class: "vm-note", text: "“" + o.note + "”" }) : null,
        el("span", { class: "vm-fine", text: "Expires " + new Date(o.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) }),
      ]),
      el("div", { class: "vm-offer-sides" }, [
        offerSide("You Give", o.youGive),
        el("span", { class: "vm-swap", "aria-hidden": "true", text: "⇄" }),
        offerSide("You Get", o.youGet),
      ]),
      el("div", { class: "vm-offer-actions" }, buttons),
    ]);
  }

  function offerSide(label, cards) {
    return el("div", { class: "vm-offer-side" }, [
      el("div", { class: "vm-label", text: label }),
      el("div", { class: "vm-offer-cards" }, cards.map(function (c) {
        return el("button", { class: "vm-offer-card", type: "button", onclick: function () { modal = { type: "card", card: c }; render(); } }, [
          art(c, "small"),
          el("span", { text: c.title }),
        ]);
      })),
    ]);
  }

  // ---------- Card view (lightbox) ----------

  function cardModal(card, mine) {
    var actions = [];
    if (!mine && card.listing && state.selling) {
      actions.push(el("button", { class: "vm-btn vm-btn-signal vm-btn-wide", type: "button", text: "Buy For " + money(card.listing.price), onclick: function (e) {
        if (!state.tradeName) return needName();
        post({ action: "buy", listingId: card.listing.id }, e.currentTarget).then(function (data) {
          window.location.href = data.invoiceUrl;
        }).catch(function () {});
      } }));
    }
    if (!mine && card.listing && state.selling && state.credit >= card.listing.price) {
      var armed = armedBuy === card.listing.id;
      actions.push(el("button", { class: "vm-btn vm-btn-wide vm-btn-credit", type: "button", text: armed ? "Tap Again To Pay " + money(card.listing.price) + " In Vault Credit" : "Buy With Vault Credit", onclick: function (e) {
        if (!state.tradeName) return needName();
        if (!armed) { armedBuy = card.listing.id; render(); return; }
        armedBuy = null;
        act({ action: "buyCredit", listingId: card.listing.id }, e.currentTarget, "It's Yours! The Card Is In Your Binder.");
      } }));
    }
    if (!mine && card.openToTrade && card.trader) {
      actions.push(el("button", { class: "vm-btn vm-btn-wide", type: "button", text: "Offer A Trade", onclick: function () {
        if (!state.tradeName) return needName();
        openOffer({ trader: card.trader, get: [card.pullId] });
      } }));
    }
    var more = card.trader
      ? state.board.filter(function (c) { return c.trader === card.trader && c.pullId !== card.pullId; }).slice(0, 4)
      : [];
    return el("div", { class: "vm-lightbox-body" }, [
      el("div", { class: "vm-lightbox-art" }, [art(card, "large")]),
      el("div", { class: "vm-lightbox-info" }, [
        el("div", { class: "vm-tile-meta" }, [el("span", { class: "vm-muted", text: card.series || "" })]),
        el("h2", { class: "vm-lightbox-title", text: card.title }),
        card.trader ? el("p", { class: "vm-muted" }, ["In ", el("a", { class: "vm-owner vm-owner-big", href: profileHash(card.trader), text: "@" + card.trader }), "'s Binder"]) : null,
        tags(card),
        actions.length ? el("div", { class: "vm-lightbox-actions" }, actions) : null,
        !mine ? wishButton(card) : null,
        card.wantedBy ? el("p", { class: "vm-fine", text: card.wantedBy + (card.wantedBy === 1 ? " Collector Has" : " Collectors Have") + " This On Their Wishlist." }) : null,
        state.selling && card.listing && !mine
          ? el("p", { class: "vm-fine", text: "Buying Moves The Card Into Your Vault. Nothing Ships Until You Ship Your Vault." })
          : null,
        more.length
          ? el("div", { class: "vm-more" }, [
              el("div", { class: "vm-label", text: "More From @" + card.trader }),
              el("div", { class: "vm-more-row" }, more.map(function (c) {
                return el("button", { class: "vm-more-card", type: "button", "aria-label": c.title, onclick: function () { modal = { type: "card", card: c }; render(); } }, [art(c, "small")]);
              })),
            ])
          : null,
      ]),
    ]);
  }

  // ---------- Offer builder ----------

  function openOffer(opts) {
    modal = {
      type: "offer",
      trader: opts.trader,
      get: new Set(opts.get || []),
      give: new Set(opts.give || []),
      counterOfId: opts.counterOfId || null,
      counterCards: opts.counterCards || [],
      note: "",
      theirs: null,
    };
    render();
    // Everything they have open to trade, not just what's showing in the market.
    getJSON({ view: "collection", name: opts.trader }).then(function (d) {
      if (modal && modal.type === "offer") {
        modal.theirs = d.cards.filter(function (c) { return c.openToTrade; });
        render();
      }
    }).catch(function () {
      if (modal && modal.type === "offer") { modal.theirs = []; render(); }
    });
  }

  function offerModal(m) {
    var r = state.rules;
    var theirs = (m.theirs || state.board.filter(function (c) { return c.trader === m.trader && c.openToTrade; })).slice();
    m.counterCards.forEach(function (c) {
      if (!theirs.some(function (t) { return t.pullId === c.pullId; })) theirs.push(c);
    });
    var mine = state.cards.filter(function (c) { return !c.locked && (!c.inOffer || m.give.has(c.pullId)); });

    function picks(cards, set) {
      if (!cards.length) return el("p", { class: "vm-empty", text: "No Cards Available." });
      return el("div", { class: "vm-pick-grid" }, cards.map(function (c) {
        var on = set.has(c.pullId);
        return el("button", {
          class: "vm-pick" + (on ? " vm-pick-on" : ""),
          type: "button",
          "aria-pressed": on ? "true" : "false",
          onclick: function () {
            if (set.has(c.pullId)) set.delete(c.pullId);
            else if (set.size < r.maxCards) set.add(c.pullId);
            render();
          },
        }, [art(c, "small"), el("span", { class: "vm-pick-title", text: c.title })]);
      }));
    }

    var note = el("select", { id: "vm-note", class: "vm-input vm-select", "aria-label": "Add a note" }, [el("option", { value: "", text: "No Note" })].concat(state.notes.map(function (n) {
      return el("option", { value: n, text: n, selected: m.note === n });
    })));
    note.addEventListener("change", function () { m.note = note.value; });
    var send = el("button", { class: "vm-btn vm-btn-signal", type: "button", text: m.counterOfId ? "Send Counter Offer" : "Send Offer", disabled: !m.give.size || !m.get.size });
    send.addEventListener("click", function () {
      var to = m.trader;
      post({ action: "offer", give: Array.from(m.give), get: Array.from(m.get), note: m.note || null, counterOfId: m.counterOfId }, send).then(function () {
        modal = null;
        flash = { text: "Offer Sent To @" + to + "." };
        window.location.hash = "#/offers";
        return load();
      }).catch(function () {});
    });

    return el("div", { class: "vm-builder" }, [
      el("h2", { class: "vm-builder-title", text: (m.counterOfId ? "Counter Offer To @" : "Offer A Trade To @") + m.trader }),
      el("div", { class: "vm-builder-cols" }, [
        el("section", {}, [
          el("div", { class: "vm-label", text: "You Get (" + m.get.size + ")" }),
          m.theirs === null && !theirs.length ? el("p", { class: "vm-empty", text: "Loading Their Cards…" }) : picks(theirs, m.get),
        ]),
        el("section", {}, [
          el("div", { class: "vm-label", text: "You Give (" + m.give.size + ")" }),
          picks(mine, m.give),
        ]),
      ]),
      el("div", { class: "vm-builder-foot" }, [note, send]),
      el("p", { class: "vm-fine", text: "Up To " + r.maxCards + " Cards On Each Side. The Trade Happens The Moment They Accept, And It's Final." }),
    ]);
  }

  function nameModal() {
    var input = el("input", { id: "vm-name", class: "vm-input", type: "text", maxlength: "20", placeholder: "Trade Name", value: state.tradeName || "", "aria-label": "Trade name" });
    var save = el("button", { class: "vm-btn vm-btn-signal", type: "button", text: "Save Trade Name" });
    save.addEventListener("click", function () { act({ action: "setName", name: input.value }, save, "Welcome To The Vault Market, @" + input.value.trim() + "."); });
    setTimeout(function () { input.focus(); }, 0);
    return el("div", { class: "vm-name-box" }, [
      el("h2", { class: "vm-builder-title", text: state.tradeName ? "Change Your Trade Name" : "Pick A Trade Name" }),
      el("p", { class: "vm-muted", text: "3 To 20 Letters, Numbers, Spaces, Dashes Or Underscores. Other Collectors See This, Never Your Real Name Or Email." }),
      input,
      save,
    ]);
  }

  function termsModal() {
    var box = el("input", { id: "vm-agree", type: "checkbox" });
    var agree = el("button", { class: "vm-btn vm-btn-signal", type: "button", text: "Agree And Continue", disabled: true });
    box.addEventListener("change", function () { agree.disabled = !box.checked; });
    agree.addEventListener("click", function () {
      post({ action: "acceptTerms" }, agree).then(function () {
        state.termsAccepted = true;
        modal = null;
        flash = { text: "Thanks! You're All Set. Tap Again To Continue." };
        render();
      }).catch(function () {});
    });
    return el("div", { class: "vm-name-box" }, [
      el("h2", { class: "vm-builder-title", text: "Vault Market Terms" }),
      el("p", { class: "vm-muted", text: "Before You Sell, Buy Or Trade: Sales Are On Consignment, Sellers Set Their Own Prices And Get 90% As Vault Credit, Vault Credit Has No Cash Value And Can't Buy Mystery Packs, And Completed Trades And Sales Are Final." }),
      el("a", { class: "vm-link", href: state.termsUrl || "/pages/vault-market-terms", target: "_blank", rel: "noopener", text: "Read The Full Vault Market Terms" }),
      el("label", { class: "vm-agree", for: "vm-agree" }, [box, el("span", { text: "I'm 18 Or Older And Agree To The Vault Market Terms." })]),
      agree,
    ]);
  }

  function modalLayer() {
    if (!modal) return null;
    var body = modal.type === "card" ? cardModal(modal.card, modal.mine) : modal.type === "offer" ? offerModal(modal) : modal.type === "terms" ? termsModal() : nameModal();
    var layer = el("div", { class: "vm-modal", role: "dialog", "aria-modal": "true" }, [
      el("div", { class: "vm-modal-panel vm-modal-" + modal.type }, [
        el("button", { class: "vm-close", type: "button", "aria-label": "Close", text: "×", onclick: function () { modal = null; render(); } }),
        body,
      ]),
    ]);
    layer.addEventListener("click", function (e) {
      if (e.target === layer) { modal = null; render(); }
    });
    return layer;
  }

  // ---------- Page ----------

  function render() {
    var scroll = window.scrollY;
    var r = route();
    root.innerHTML = "";
    if (!state || !state.enabled) {
      root.appendChild(el("p", { class: "vm-empty vm-pad", text: "The Vault Market Is Coming Soon." }));
      return;
    }
    var ownPage = r.name === "collection" && state.tradeName && r.who.toLowerCase() === state.tradeName.toLowerCase();
    root.appendChild(topBar(ownPage ? "binder" : r.name === "collection" ? "collectors" : r.name));
    if (demo) root.appendChild(el("p", { class: "vm-banner", role: "note", text: "Staff Preview With Sample Cards. Customers Can't See The Vault Market Until You Turn Trading On." }));
    if (flash) {
      root.appendChild(el("p", { class: "vm-flash" + (flash.error ? " vm-flash-error" : ""), role: "status" }, [
        el("span", { text: flash.text }),
        el("button", { class: "vm-link", type: "button", text: "Dismiss", onclick: function () { flash = null; render(); } }),
      ]));
    }
    root.appendChild(
      r.name === "collectors" ? collectorsView()
        : r.name === "collection" ? collectionView(r.who)
          : r.name === "matches" ? matchesView()
          : r.name === "wishlist" ? wishlistView()
          : r.name === "wallet" ? walletView()
          : r.name === "binder" ? binderView()
            : r.name === "offers" ? offersView()
              : marketView(),
    );
    root.appendChild(el("footer", { class: "vm-foot" }, [
      el("p", {}, ["Trades And Sales Are Between Collectors Only. Poke-Collect Doesn't Buy Cards Back Or Set Prices. Sellers Choose Their Own Price, And The Price Guide Is Only A Suggestion. ", el("a", { class: "vm-link", href: (state && state.termsUrl) || "/pages/vault-market-terms", target: "_blank", rel: "noopener", text: "Vault Market Terms" })]),
      el("a", { class: "vm-link", href: "/", text: "Back To Poke-Collect" }),
    ]));
    var layer = modalLayer();
    if (layer) root.appendChild(layer);
    document.body.classList.toggle("vm-locked", !!layer);
    window.scrollTo(0, scroll);
  }

  window.addEventListener("hashchange", function () {
    modal = null;
    binderPage = 0;
    binderFilter = "all";
    if (route().name !== "binder") showcaseEdit = null;
    if (route().name !== "wallet") newCode = null;
    armedBuy = null;
    render();
    window.scrollTo(0, 0);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal) { modal = null; render(); }
  });

  root.appendChild(el("p", { class: "vm-empty vm-pad", text: "Opening The Vault…" }));
  load();
})();
