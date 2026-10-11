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

        if (fair && data.commitHash) {
          fair.textContent = data.reveal
            ? "Fairness check: sha256(\"" + data.reveal.salt + ":\" + the published card order) = " + data.commitHash
            : "Every card's place in this pool was locked before the first pack was sold. Fingerprint: " + data.commitHash.slice(0, 16) + "…";
          fair.hidden = false;
        }
      })
      .catch(function () { root.hidden = true; });
  });
})();
