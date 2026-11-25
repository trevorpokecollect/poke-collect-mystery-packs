/* Cardbit site analytics beacon (first-party; read only by Cardbit staff in Card Broker).
   Sends a "view" for each page (including in-page navigation) and a "ping" every 60 s while the
   tab is visible, so staff can see how many people are on the site right now. */
(function () {
  "use strict";
  if (window.__cardbitPulse) return;
  window.__cardbitPulse = true;
  var url = "/api/pulse";
  var last = "";
  var firstReferrer = document.referrer || "";
  function send(kind) {
    var body = JSON.stringify({ k: kind, p: location.pathname + location.search, r: kind === "view" && !last ? firstReferrer : "" });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }))) return;
    } catch (e) {}
    try {
      fetch(url, { method: "POST", body: body, credentials: "same-origin", keepalive: true, headers: { "Content-Type": "text/plain" } });
    } catch (e) {}
  }
  function view() {
    var here = location.pathname;
    if (here === last) return;
    send("view");
    last = here;
  }
  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    if (typeof original !== "function") return;
    history[name] = function () {
      var out = original.apply(this, arguments);
      setTimeout(view, 0);
      return out;
    };
  });
  window.addEventListener("popstate", function () { setTimeout(view, 0); });
  setInterval(function () {
    if (document.visibilityState === "visible") send("ping");
  }, 60000);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") send("ping");
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", view);
  else view();
})();
