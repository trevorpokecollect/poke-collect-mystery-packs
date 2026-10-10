// My Packs page: lists the customer's packs and plays the opening animation.
// The card is fetched only when a pack is opened, and was decided on the server at payment.
(function () {
  "use strict";

  var root = document.getElementById("mystery-packs");
  if (!root) return;

  var api = root.getAttribute("data-api") || "/apps/packs/api";
  var query = window.location.search; // keeps the ?k= order link token for guests
  var TIER_COLORS = {
    base: "#9aa0a6",
    uncommon: "#2fa36b",
    rare: "#2f6fe0",
    epic: "#8b46e0",
    chase: "#e0a21a",
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
          el("span", { class: "mp-pack-label", text: "Tap to open" }),
        ]
      : [
          el("span", { class: "mp-pack-foil", "aria-hidden": "true" }),
          el("span", { class: "mp-pack-brand", text: "Poke-Collect" }),
          el("span", { class: "mp-pack-emblem", "aria-hidden": "true" }),
          el("span", { class: "mp-pack-series", text: pack.series }),
          el("span", { class: "mp-pack-label", text: "Tap to open" }),
        ]);
    if (onOpen) button.addEventListener("click", function () { onOpen(pack); });
    return button;
  }

  function cardTile(pack) {
    var card = pack.card;
    return el("div", { class: "mp-card" }, [
      card.imageUrl ? el("img", { src: card.imageUrl, alt: card.title, loading: "lazy" }) : null,
      el("div", { class: "mp-card-title", text: card.title }),
      el("div", { class: "mp-card-meta" }, [
        el("span", { class: "mp-tier", "data-tier": tierKey(card.tier), text: card.tier }),
        el("span", { text: pack.shipped ? "Shipping" : "Ships with order " + pack.orderName }),
      ]),
    ]);
  }

  function render(packs) {
    root.innerHTML = "";
    var unopened = packs.filter(function (p) { return !p.opened; });
    var opened = packs.filter(function (p) { return p.opened; });

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
    root.appendChild(
      opened.length
        ? el("div", { class: "mp-grid" }, opened.map(cardTile))
        : el("p", { class: "mp-empty", text: "Nothing pulled yet." }),
    );
  }

  function load() {
    return fetch(api + "/pulls" + query, { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        render(data.packs || []);
      })
      .catch(function (err) {
        root.innerHTML = "";
        root.appendChild(el("p", { class: "mp-error", text: err.message || "Couldn't load your packs." }));
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

  function openPack(pack) {
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var stagePack = packTile(pack, null);
    stagePack.disabled = true;
    stagePack.appendChild(el("span", { class: "mp-tear", "aria-hidden": "true" }));

    var front = el("div", { class: "mp-face mp-face-front" });
    var flip = el("div", { class: "mp-flip" }, [front, el("div", { class: "mp-face mp-face-back" })]);
    var glow = el("div", { class: "mp-glow" });
    var result = el("div", { class: "mp-result", "aria-live": "polite" });
    var inner = el("div", { class: "mp-stage-inner" }, [glow, flip, stagePack, result]);
    var skip = el("button", { class: "mp-btn mp-btn-ghost mp-skip", type: "button", text: "Close" });
    var stage = el("div", { class: "mp-stage", role: "dialog", "aria-modal": "true", "aria-label": "Opening pack" }, [inner, skip]);
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      stage.remove();
      document.removeEventListener("keydown", onKey);
      load();
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    skip.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(stage);

    // Ask the server for the result while the pack shakes.
    var reveal = fetch(api + "/open" + query, {
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

    Promise.all([reveal, wait(reduced ? 0 : 1200)])
      .then(function (values) {
        var card = values[0];
        var color = TIER_COLORS[tierKey(card.tier)] || TIER_COLORS.base;
        if (card.imageUrl) front.appendChild(el("img", { src: card.imageUrl, alt: card.title }));
        else front.appendChild(el("strong", { text: card.title }));
        glow.style.background = color;

        stagePack.classList.add("mp-tearing");
        flip.classList.add("mp-rise");
        return wait(reduced ? 0 : 1300).then(function () {
          flip.classList.remove("mp-rise");
          flip.classList.add("mp-flipped");
          glow.classList.add("mp-on");
          var big = ["epic", "chase"].indexOf(tierKey(card.tier)) !== -1;
          if (big && !reduced) confetti(stage, color);

          result.appendChild(el("span", { class: "mp-tier", "data-tier": tierKey(card.tier), text: card.tier }));
          result.appendChild(el("h2", { text: card.title }));
          result.appendChild(el("p", { text: "Ships with your order" }));
          var done = el("button", { class: "mp-btn", type: "button", text: "Done" });
          done.addEventListener("click", close);
          var actions = el("div", { class: "mp-actions" }, [done]);
          if (navigator.share) {
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
        result.appendChild(el("p", { text: err.message }));
        result.classList.add("mp-show");
      });
  }

  load();
})();
