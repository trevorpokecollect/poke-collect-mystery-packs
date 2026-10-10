(function () {
  "use strict";
  function money(v) { return "$" + Number(v).toFixed(2); }
  function pct(v) { return (v * 100).toFixed(1) + "%"; }

  document.querySelectorAll("[data-mp-odds]").forEach(function (root) {
    var summary = root.querySelector("[data-mp-summary]");
    var table = root.querySelector("[data-mp-table]");
    var fair = root.querySelector("[data-mp-fair]");

    fetch(root.getAttribute("data-endpoint"), { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        summary.textContent = data.status === "CLOSED"
          ? "This series is sold out."
          : data.packsRemaining + " of " + data.totalPacks + " packs left.";

        var body = table.querySelector("tbody");
        data.cards.forEach(function (card) {
          var row = document.createElement("tr");
          [card.title, card.tier, money(card.marketValue), card.remaining + " / " + card.quantity,
            data.status === "CLOSED" ? "—" : pct(card.currentOdds)].forEach(function (text) {
            var cell = document.createElement("td");
            cell.textContent = text;
            row.appendChild(cell);
          });
          body.appendChild(row);
        });
        table.hidden = false;

        if (fair && data.commitHash) {
          fair.textContent = data.reveal
            ? "Fairness check: sha256(\"" + data.reveal.salt + ":\" + the published card order) = " + data.commitHash
            : "Pack order committed before launch. Fingerprint: " + data.commitHash;
          fair.hidden = false;
        }
      })
      .catch(function () { summary.textContent = "Odds are unavailable right now."; });
  });
})();
