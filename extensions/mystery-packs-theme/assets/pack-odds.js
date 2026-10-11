// Fills the "Potential Pulls" block with live per-tier odds. Hidden if the product isn't a live pack.
(function () {
  "use strict";
  var COLORS = { poke: "#e3350d", great: "#2f6fe0", ultra: "#d49a00", master: "#8b46e0" };
  function pct(v) { return v === 0 ? "0%" : v < 0.001 ? "<0.1%" : (v * 100).toFixed(1) + "%"; }

  document.querySelectorAll("[data-mp-odds]").forEach(function (root) {
    var summary = root.querySelector("[data-mp-summary]");
    var list = root.querySelector("[data-mp-tiers]");
    fetch(root.getAttribute("data-endpoint"), { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || data.error) return;
        summary.textContent = data.status === "CLOSED"
          ? "This series is sold out."
          : data.packsRemaining + " of " + data.totalPacks + " packs left · " + data.cards.length + " different cards";
        (data.tiers || []).forEach(function (tier) {
          var item = document.createElement("li");
          var dot = document.createElement("span");
          dot.className = "mp-odds__dot";
          dot.style.background = COLORS[String(tier.name).toLowerCase()] || "#6b6b76";
          var name = document.createElement("strong");
          name.textContent = tier.name;
          var odds = document.createElement("span");
          odds.textContent = data.status === "CLOSED" ? "" : pct(tier.currentOdds);
          item.append(dot, name, odds);
          list.appendChild(item);
        });
        root.hidden = false;
      })
      .catch(function () {});
  });
})();
