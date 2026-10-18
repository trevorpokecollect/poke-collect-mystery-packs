// Vault Marketplace page: players trade vault cards with each other, or sell them to each other.
// Cards never leave the vault here; a trade or sale only changes which player owns them.
(function () {
  "use strict";

  var root = document.getElementById("vault-market");
  if (!root) return;
  var api = root.getAttribute("data-api") || "/apps/packs/api/market";
  // Staff preview link (?demo=<token>): sample cards, and buttons only show what would happen.
  var demo = root.getAttribute("data-demo");
  if (demo) api += "?demo=" + encodeURIComponent(demo);
  var state = null;
  var tab = "board";
  var search = "";
  var flash = null;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === "text") node.textContent = attrs[key];
      else if (key === "class") node.className = attrs[key];
      else if (key.indexOf("on") === 0 && typeof attrs[key] === "function") node.addEventListener(key.slice(2), attrs[key]);
      else if (attrs[key] !== false && attrs[key] != null) node.setAttribute(key, attrs[key] === true ? "" : attrs[key]);
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function money(n) {
    return "$" + Number(n).toFixed(2);
  }

  function tierKey(tier) {
    return String(tier || "").trim().toLowerCase();
  }

  function load() {
    return fetch(api + (search ? (demo ? "&" : "?") + "q=" + encodeURIComponent(search) : ""), { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state = data;
        render();
      })
      .catch(function () {
        root.innerHTML = "";
        root.appendChild(el("p", { class: "mp-error", text: "Couldn't load the marketplace. Please refresh the page." }));
      });
  }

  function post(body, button) {
    if (demo) {
      flash = { text: "Preview Only: Nothing Was Saved. On The Live Page This " + (body.action === "buy" ? "Opens Checkout." : "Would Go Through.") };
      builder = null;
      render();
      return Promise.reject(new Error("demo"));
    }
    if (button) button.disabled = true;
    return fetch(api, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
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
      return load();
    }).catch(function () {});
  }

  // ---------- Header ----------

  function hero() {
    var r = state.rules;
    var sub = state.selling
      ? "Trade Cards With Other Players, Or Sell Them For Store Credit. Cards Stay Safe In The Vault The Whole Time."
      : "Trade Cards With Other Players. Cards Stay Safe In The Vault The Whole Time.";
    var text = el("div", { class: "mp-hero-text" }, [
      el("span", { class: "mp-hero-kicker", text: "Digital Mystery Packs · Vault Marketplace" }),
      el("h1", { text: "Trade & Sell Vault Cards" }),
      el("p", { class: "mp-hero-sub", text: sub }),
      el("a", { class: "mp-btn mp-btn-ghost mk-back", href: "/apps/packs", text: "Back To My Packs" }),
    ]);
    var box = el("div", { class: "mp-hero-ship" }, [
      el("strong", { class: "mp-hero-ship-title", text: state.tradeName ? "Trading As " + state.tradeName : "Pick A Trade Name" }),
      el("p", { text: state.tradeName ? "Other Players See This Name, Never Your Real Name Or Email." : "Other Players See Your Trade Name, Never Your Real Name Or Email." }),
      nameForm(),
      el("p", { class: "mk-fine", text: "Cards can be traded " + r.waitDays + " days after their pack order. Offers last " + r.offerDays + " days." }),
    ]);
    return el("section", { class: "mp-hero" }, [text, box]);
  }

  function nameForm() {
    var input = el("input", { class: "mk-input", type: "text", maxlength: "20", placeholder: "Trade Name", value: state.tradeName || "" });
    var button = el("button", { class: "mp-btn mp-vault-btn", type: "button", text: state.tradeName ? "Change Name" : "Save Name" });
    button.addEventListener("click", function () {
      act({ action: "setName", name: input.value }, button, "Trade Name Saved.");
    });
    return el("div", { class: "mk-name" }, [input, button]);
  }

  function tabs() {
    var incoming = state.offers.filter(function (o) { return o.incoming; }).length;
    var items = [
      ["board", "Trade Board"],
      ["mine", "My Cards"],
      ["offers", "Offers" + (incoming ? " (" + incoming + ")" : "")],
    ];
    return el("div", { class: "mk-tabs", role: "tablist" }, items.map(function (t) {
      return el("button", {
        class: "mk-tab" + (tab === t[0] ? " mk-tab-on" : ""),
        type: "button",
        role: "tab",
        "aria-selected": tab === t[0] ? "true" : "false",
        text: t[1],
        onclick: function () { tab = t[0]; flash = null; render(); },
      });
    }));
  }

  function cardFace(card, extra) {
    return el("div", { class: "mp-card mk-card" }, [
      card.imageUrl ? el("img", { src: card.imageUrl, alt: card.title, loading: "lazy" }) : null,
      el("div", { class: "mp-card-title", text: card.title }),
      el("div", { class: "mp-card-meta" }, [
        el("span", { class: "mp-tier", "data-tier": tierKey(card.tier), text: card.tier }),
        el("span", { text: card.series || "" }),
      ]),
    ].concat(extra || []));
  }

  // ---------- Trade Board ----------

  function board() {
    var input = el("input", { class: "mk-input mk-search", type: "search", placeholder: "Search Cards", value: search });
    input.addEventListener("change", function () { search = input.value.trim(); load(); });
    var cards = state.board;
    var grid = cards.length
      ? el("div", { class: "mp-grid" }, cards.map(function (c) {
          var actions = [el("div", { class: "mk-from", text: "From " + c.trader })];
          if (c.listing) {
            actions.push(el("button", {
              class: "mp-btn mk-buy",
              type: "button",
              text: "Buy For " + money(c.listing.price),
              onclick: function (e) {
                if (!state.tradeName) return needName();
                post({ action: "buy", listingId: c.listing.id }, e.currentTarget).then(function (data) {
                  window.location.href = data.invoiceUrl;
                }).catch(function () {});
              },
            }));
          }
          if (c.openToTrade) {
            actions.push(el("button", {
              class: "mp-btn mk-secondary",
              type: "button",
              text: "Offer A Trade",
              onclick: function () {
                if (!state.tradeName) return needName();
                openBuilder({ trader: c.trader, get: [c.pullId] });
              },
            }));
          }
          return cardFace(c, actions);
        }))
      : el("p", { class: "mp-empty", text: search ? "No Cards Match Your Search." : "No Cards On The Trade Board Yet. Mark Your Own Cards Open To Trade To Get Things Started." });
    return el("div", {}, [el("div", { class: "mk-toolbar" }, [input]), grid]);
  }

  function needName() {
    flash = { error: true, text: "Pick a trade name first." };
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- My Cards ----------

  function mine() {
    if (!state.cards.length) return el("p", { class: "mp-empty", text: "Your Vault Is Empty. Cards You Pull Show Up Here." });
    return el("div", { class: "mp-grid" }, state.cards.map(function (c) {
      var extra = [];
      if (c.locked) {
        extra.push(el("span", { class: "mk-badge", text: c.locked }));
        if (c.listing && c.listing.status === "CHECKOUT") extra.push(el("div", { class: "mk-from", text: "Listed For " + money(c.listing.price) }));
        return cardFace(c, extra);
      }
      var toggle = el("input", { type: "checkbox", checked: c.openToTrade });
      toggle.addEventListener("change", function () {
        if (!state.tradeName && toggle.checked) { toggle.checked = false; return needName(); }
        act({ action: "openToTrade", pullId: c.pullId, on: toggle.checked }, toggle);
      });
      extra.push(el("label", { class: "mk-toggle" }, [toggle, " Open To Trade"]));
      if (c.inOffer) extra.push(el("span", { class: "mk-badge mk-badge-soft", text: "In Your Offer" }));
      if (state.selling) extra.push(sellForm(c));
      return cardFace(c, extra);
    }));
  }

  function sellForm(c) {
    var r = state.rules;
    var price = el("input", { class: "mk-input mk-price", type: "number", min: String(r.minPrice), max: String(r.maxPrice), step: "0.01", placeholder: "Price", value: c.listing ? c.listing.price.toFixed(2) : "" });
    var list = el("button", { class: "mp-btn mk-secondary", type: "button", text: c.listing ? "Update Price" : "List For Sale" });
    list.addEventListener("click", function () {
      if (!state.tradeName) return needName();
      act({ action: "list", pullId: c.pullId, price: Number(price.value) }, list, "Listed On The Trade Board.");
    });
    var parts = [
      el("div", { class: "mk-sell" }, [el("span", { class: "mk-dollar", text: "$" }), price, list]),
    ];
    if (c.listing) {
      parts.unshift(el("span", { class: "mk-badge mk-badge-soft", text: "For Sale" }));
      parts.push(el("button", {
        class: "mk-link",
        type: "button",
        text: "Remove Listing",
        onclick: function (e) { act({ action: "unlist", listingId: c.listing.id }, e.currentTarget, "Listing Removed."); },
      }));
    }
    var fee = state.feePercent;
    parts.push(el("p", { class: "mk-fine-dark", text: "You get " + (100 - fee) + "% as store credit, " + state.rules.payoutDays + " days after it sells." }));
    return el("div", { class: "mk-sell-wrap" }, parts);
  }

  // ---------- Offers ----------

  function offers() {
    if (!state.offers.length) return el("p", { class: "mp-empty", text: "No Open Offers." });
    return el("div", { class: "mk-offers" }, state.offers.map(function (o) {
      var buttons = o.incoming
        ? [
            el("button", { class: "mp-btn mk-buy", type: "button", text: "Accept Trade", onclick: function (e) { act({ action: "accept", tradeId: o.id }, e.currentTarget, "Trade Done! The Cards Are In Your Vault."); } }),
            el("button", { class: "mp-btn mk-secondary", type: "button", text: "Counter Offer", onclick: function () {
              openBuilder({ trader: o.with, get: o.youGet.map(function (c) { return c.pullId; }), give: o.youGive.map(function (c) { return c.pullId; }), counterOfId: o.id, counterCards: o.youGet });
            } }),
            el("button", { class: "mk-link", type: "button", text: "Decline", onclick: function (e) { act({ action: "decline", tradeId: o.id }, e.currentTarget, "Offer Declined."); } }),
          ]
        : [el("button", { class: "mk-link", type: "button", text: "Cancel Offer", onclick: function (e) { act({ action: "cancel", tradeId: o.id }, e.currentTarget, "Offer Cancelled."); } })];
      return el("div", { class: "mk-offer" }, [
        el("div", { class: "mk-offer-head" }, [
          el("strong", { text: o.incoming ? "Offer From " + o.with : "Your Offer To " + o.with }),
          o.note ? el("span", { class: "mk-note", text: "“" + o.note + "”" }) : null,
          el("span", { class: "mk-fine-dark", text: "Expires " + new Date(o.expiresAt).toLocaleDateString() }),
        ]),
        el("div", { class: "mk-offer-sides" }, [side("You Give", o.youGive), side("You Get", o.youGet)]),
        el("div", { class: "mk-offer-actions" }, buttons),
      ]);
    }));
  }

  function side(label, cards) {
    return el("div", { class: "mk-side" }, [
      el("div", { class: "mk-side-label", text: label }),
      el("div", { class: "mk-mini-row" }, cards.map(function (c) {
        return el("div", { class: "mk-mini" }, [
          c.imageUrl ? el("img", { src: c.imageUrl, alt: "", loading: "lazy" }) : null,
          el("span", { text: c.title }),
        ]);
      })),
    ]);
  }

  // ---------- Offer builder ----------

  var builder = null;

  function openBuilder(opts) {
    builder = {
      trader: opts.trader,
      get: new Set(opts.get || []),
      give: new Set(opts.give || []),
      counterOfId: opts.counterOfId || null,
      counterCards: opts.counterCards || [],
      note: "",
    };
    render();
  }

  function builderPanel() {
    var r = state.rules;
    // Their cards: everything this player has open to trade, plus the cards from the offer being countered.
    var theirs = state.board.filter(function (c) { return c.trader === builder.trader && c.openToTrade; });
    builder.counterCards.forEach(function (c) {
      if (!theirs.some(function (t) { return t.pullId === c.pullId; })) theirs.push(c);
    });
    var mine = state.cards.filter(function (c) { return !c.locked && (!c.inOffer || builder.give.has(c.pullId)); });

    function pickGrid(cards, set) {
      if (!cards.length) return el("p", { class: "mp-empty", text: "No Cards Available." });
      return el("div", { class: "mk-pick-grid" }, cards.map(function (c) {
        var on = set.has(c.pullId);
        return el("button", {
          class: "mk-pick" + (on ? " mk-pick-on" : ""),
          type: "button",
          "aria-pressed": on ? "true" : "false",
          onclick: function () {
            if (set.has(c.pullId)) set.delete(c.pullId);
            else if (set.size < r.maxCards) set.add(c.pullId);
            render();
          },
        }, [c.imageUrl ? el("img", { src: c.imageUrl, alt: "" }) : null, el("span", { text: c.title })]);
      }));
    }

    var note = el("select", { class: "mk-input" }, [el("option", { value: "", text: "No Note" })].concat(state.notes.map(function (n) {
      return el("option", { value: n, text: n, selected: builder.note === n });
    })));
    note.addEventListener("change", function () { builder.note = note.value; });
    var thisTrader = builder.trader;
    var send = el("button", { class: "mp-btn mp-vault-btn", type: "button", text: builder.counterOfId ? "Send Counter Offer" : "Send Offer", disabled: !builder.give.size || !builder.get.size });
    send.addEventListener("click", function () {
      post({
        action: "offer",
        give: Array.from(builder.give),
        get: Array.from(builder.get),
        note: builder.note || null,
        counterOfId: builder.counterOfId,
      }, send).then(function () {
        builder = null;
        tab = "offers";
        flash = { text: "Offer Sent To " + thisTrader + "." };
        return load();
      }).catch(function () {});
    });

    return el("div", { class: "mk-modal", role: "dialog", "aria-modal": "true", "aria-label": "Offer A Trade" }, [
      el("div", { class: "mk-modal-body" }, [
        el("div", { class: "mk-modal-head" }, [
          el("h2", { text: (builder.counterOfId ? "Counter Offer To " : "Offer A Trade To ") + builder.trader }),
          el("button", { class: "mk-link", type: "button", text: "Close", onclick: function () { builder = null; render(); } }),
        ]),
        el("h3", { class: "mk-pick-title", text: "You Get (" + builder.get.size + ")" }),
        pickGrid(theirs, builder.get),
        el("h3", { class: "mk-pick-title", text: "You Give (" + builder.give.size + ")" }),
        pickGrid(mine, builder.give),
        el("div", { class: "mk-modal-foot" }, [note, send]),
        el("p", { class: "mk-fine-dark", text: "Up to " + r.maxCards + " cards on each side. The trade happens the moment they accept, and it's final." }),
      ]),
    ]);
  }

  // ---------- Page ----------

  function render() {
    root.innerHTML = "";
    if (!state || !state.enabled) {
      root.appendChild(el("p", { class: "mp-empty", text: "The Vault Marketplace Is Coming Soon." }));
      return;
    }
    if (!state.signedIn) {
      root.appendChild(el("p", { class: "mp-empty", text: "Log In To Trade." }));
      return;
    }
    if (demo) root.appendChild(el("p", { class: "mk-flash mk-demo", role: "note", text: "Staff Preview With Sample Cards. Customers Can't See This Page Until You Turn Trading On." }));
    root.appendChild(hero());
    if (flash) root.appendChild(el("p", { class: flash.error ? "mp-error mk-flash" : "mk-flash mk-flash-ok", role: "status", text: flash.text }));
    root.appendChild(tabs());
    root.appendChild(tab === "board" ? board() : tab === "mine" ? mine() : offers());
    root.appendChild(el("p", { class: "mk-fine-dark mk-rules", text: "Trades and sales are between players only. Poke-Collect doesn't buy cards back. Card values are never shown, so agree on what feels fair to you." }));
    if (builder) root.appendChild(builderPanel());
  }

  root.appendChild(el("p", { class: "mp-empty", text: "Loading The Marketplace…" }));
  load();
})();
