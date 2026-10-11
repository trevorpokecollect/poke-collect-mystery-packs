// Fills the mystery pack details block: packs left, tiers with logos, counts and live odds.
(function () {
  "use strict";

  // Ball-style logos for the Poke-Collect tiers; other tier names get a plain colored ball.
  var BALLS = {
    poke: { top: "#e3350d", extra: "" },
    great: { top: "#2f6fe0", extra: '<path d="M7 11 L11 7 L11 13 Z M33 11 L29 7 L29 13 Z" fill="#e3350d"/>' },
    ultra: { top: "#1d1d24", extra: '<rect x="12" y="5" width="4" height="10" fill="#ffd400"/><rect x="24" y="5" width="4" height="10" fill="#ffd400"/>' },
    master: { top: "#7b3fe4", extra: '<circle cx="13" cy="11" r="2.6" fill="#ff5fae"/><circle cx="27" cy="11" r="2.6" fill="#ff5fae"/>' },
  };
  var FALLBACK = ["#2fa36b", "#8b46e0", "#d49a00", "#6b6b76"];

  function ball(name, index) {
    var b = BALLS[String(name).trim().toLowerCase()] || { top: FALLBACK[index % FALLBACK.length], extra: "" };
    return (
      '<svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true">' +
      '<circle cx="20" cy="20" r="18" fill="#f4f4f6" stroke="#14141a" stroke-width="2.5"/>' +
      '<path d="M2 20 A18 18 0 0 1 38 20 Z" fill="' + b.top + '" stroke="#14141a" stroke-width="2.5"/>' +
      b.extra +
      '<rect x="2" y="18.3" width="36" height="3.4" fill="#14141a"/>' +
      '<circle cx="20" cy="20" r="5.6" fill="#f4f4f6" stroke="#14141a" stroke-width="2.6"/>' +
      "</svg>"
    );
  }
  function pct(v) { return v === 0 ? "0%" : v < 0.001 ? "<0.1%" : (v * 100).toFixed(1) + "%"; }
  function esc(s) { var d = document.createElement("div"); d.textContent = String(s); return d.innerHTML; }

  // "Try A Demo Pack": a pretend opening with a card picked from what's left in the pool,
  // weighted by copies remaining (the live odds). Uses the same opener as My Packs.
  var openerLoading = null;
  function loadOpener(app, version) {
    if (window.PCPackOpener) return Promise.resolve();
    if (openerLoading) return openerLoading;
    var v = version || Math.floor(Date.now() / 3600000);
    // Wait for the stylesheet too: the opener measures the stage when it starts.
    function add(el) {
      return new Promise(function (resolve, reject) { el.onload = resolve; el.onerror = reject; document.head.appendChild(el); });
    }
    var css = document.createElement("link");
    css.rel = "stylesheet"; css.href = app + "/packs/opener.css?v=" + v;
    var js = document.createElement("script");
    js.src = app + "/packs/opener.js?v=" + v;
    openerLoading = Promise.all([add(css), add(js)]);
    return openerLoading;
  }
  function pickCard(cards) {
    var total = cards.reduce(function (n, c) { return n + (c.remaining || 0); }, 0);
    var r = Math.random() * total;
    for (var i = 0; i < cards.length; i++) {
      r -= cards[i].remaining || 0;
      if (r < 0) return cards[i];
    }
    return cards[cards.length - 1];
  }
  function setupDemo(root, data) {
    var btn = root.querySelector("[data-mp-demo]");
    var note = root.querySelector("[data-mp-demo-note]");
    var cards = (data.cards || []).filter(function (c) { return c.remaining > 0; });
    if (!btn || !cards.length || data.status === "CLOSED") return;
    btn.hidden = false;
    if (note) note.hidden = false;
    var app = btn.getAttribute("data-app").replace(/\/$/, "");
    function run() {
      btn.disabled = true;
      loadOpener(app, data.openerVersion).then(function () {
        var c = pickCard(cards);
        window.PCPackOpener.open({
          packImageUrl: btn.getAttribute("data-pack-image") || null,
          series: btn.getAttribute("data-series"),
          card: { title: c.title, tier: c.tier, imageUrl: c.imageUrl },
          note: "Demo pull. Buy a pack to open one for real!",
          doneLabel: "Done",
          again: run,
          onClose: function () { btn.disabled = false; },
        });
      }).catch(function () { btn.disabled = false; });
    }
    btn.addEventListener("click", run);
  }

  document.querySelectorAll("[data-mp-odds]").forEach(function (root) {
    var left = root.querySelector("[data-mp-left]");
    var bar = root.querySelector("[data-mp-bar]");
    var list = root.querySelector("[data-mp-tiers]");
    var fair = root.querySelector("[data-mp-fair]");

    fetch(root.getAttribute("data-endpoint"), { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || data.error) { root.hidden = true; return; }
        var closed = data.status === "CLOSED";
        left.innerHTML = closed
          ? "<strong>Sold out.</strong> This series is complete."
          : "<strong>" + data.packsRemaining + " of " + data.totalPacks + "</strong> packs left · " + data.cards.length + " different cards";
        bar.style.width = (data.totalPacks ? (data.packsRemaining / data.totalPacks) * 100 : 0) + "%";

        list.innerHTML = (data.tiers || []).map(function (tier, i) {
          return (
            '<li class="mpd__tier" data-tier="' + esc(String(tier.name).toLowerCase()) + '">' +
            ball(tier.name, i) +
            '<span class="mpd__tier-name">' + esc(tier.name) + "</span>" +
            '<span class="mpd__tier-odds">' + (closed ? "&nbsp;" : pct(tier.currentOdds) + " chance") + "</span>" +
            '<span class="mpd__tier-count">' + tier.remaining + " of " + tier.total + " left</span>" +
            "</li>"
          );
        }).join("");

        setupDemo(root, data);

        // The "Provably fair" link only makes sense once the pool order is committed.
        if (fair && data.commitHash) fair.hidden = false;
      })
      .catch(function () { root.hidden = true; });
  });
})();
