/* Daily giveaway popup: floating launcher + dialog around the giveaway widget (giveaway.js). */
(function () {
  "use strict";

  function store(k, v) {
    try {
      if (v === undefined) return window.localStorage.getItem(k);
      window.localStorage.setItem(k, v);
    } catch (e) {
      return null;
    }
  }

  var PV_KEY = "pcg:pop:views";
  function isPhone() { return window.matchMedia("(max-width: 749px)").matches; }

  function left(drawAt) {
    var s = Math.max(0, Math.floor((new Date(drawAt).getTime() - Date.now()) / 1000));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    return h > 0 ? h + "h " + m + "m" : m > 0 ? m + "m" : "under a minute";
  }

  var GIFT =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" class="icon" aria-hidden="true" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8"/><path d="M12 8v13"/>' +
    '<path d="M12 8C11 5 7.5 3.5 6.5 5.5S8.5 8 12 8ZM12 8c1-3 4.5-4.5 5.5-2.5S15.5 8 12 8Z"/></svg>';

  function setup(pop) {
    if (pop.__pcgPop) return;
    pop.__pcgPop = true;
    var launcher = pop.querySelector(".pcg-pop__launcher");
    var icons = [];
    var thumb = pop.querySelector(".pcg-pop__thumb");
    var sub = pop.querySelector("[data-pcg-pop-sub]");
    var dialog = pop.querySelector(".pcg-pop__dialog");
    var widget = pop.querySelector("[data-pcg]");
    var slug = (widget.getAttribute("data-slug") || "").trim();
    var data = null;
    var timer = null;
    // Store style: every word capitalized on buttons and links, including text saved in the theme.
    pop.querySelectorAll(".pcg-pop__text b, .pcg-pop__text small, .pcg-pop__monthly").forEach(function (n) {
      n.textContent = n.textContent.replace(/(^|[\s(/-])([a-z])/g, function (m, sep, c) { return sep + c.toUpperCase(); });
    });
    var autoTimer = null;
    var seenKey = function () {
      return "pcg:pop:" + slug + ":" + (data && data.daily ? data.daily.drawAt : new Date().toDateString());
    };

    function open() {
      window.clearTimeout(autoTimer);
      if (dialog.open) return;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      store(seenKey(), "1");
    }
    function close() {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }

    // Phones: a gift icon among the theme's header icons (search, account, cart), drawn like them,
    // with a red dot until the visitor has entered today. Without header icons to join, the
    // phone gets the floating button instead.
    function addHeaderIcons() {
      if (icons.length) return;
      document.querySelectorAll(".header__icons").forEach(function (bar) {
        if (bar.querySelector(".pcg-hicon")) return;
        var a = document.createElement("a");
        a.href = "#daily-giveaway";
        a.className = "header__icon link header__button-icon flex justify-center align-center por pcg-hicon";
        a.setAttribute("aria-label", launcher.querySelector(".pcg-pop__text b").textContent);
        a.innerHTML = GIFT + '<span class="pcg-hicon__dot" aria-hidden="true"></span>';
        bar.insertBefore(a, bar.querySelector("#cart-icon-bubble, .header__icon--cart"));
        icons.push(a);
      });
      pop.classList.toggle("pcg-pop--no-hicon", icons.length === 0);
    }

    function updateSub() {
      var d = data && data.daily;
      var entries = d && d.yourEntries;
      if (d) {
        sub.textContent = entries ? "You're In · Drawn In " + left(d.drawAt) : "Drawn In " + left(d.drawAt);
      }
    }

    function onLoaded(d) {
      data = d || {};
      var p = data.daily && data.daily.prize;
      if (p && p.imageUrl) {
        thumb.src = p.imageUrl;
        thumb.hidden = false;
      }
      launcher.hidden = false;
      if (pop.classList.contains("pcg-pop--mobile-tab")) addHeaderIcons();
      updateSub();
      window.clearInterval(timer);
      timer = window.setInterval(updateSub, 30000);

      var designMode = window.Shopify && window.Shopify.designMode;
      // Signing up only counts on the day, so returning players show as not entered until they enter today.
      var day = data.daily;
      var enteredToday = day ? (day.enteredToday != null ? day.enteredToday : day.yourEntries > 0) : !!data.entrant;
      pop.classList.toggle("pcg-pop--entered", enteredToday);
      icons.forEach(function (i) { i.classList.toggle("pcg-hicon--entered", enteredToday); });
      setBadgeWording(!!data.entrant || enteredToday);
      if (pop.getAttribute("data-auto") === "true" && !designMode && !enteredToday && !store(seenKey()) && !autoTimer) {
        var delay = Number(pop.getAttribute("data-delay") || 6) * 1000;
        if (!isPhone() || pageViews >= 2) autoTimer = window.setTimeout(open, delay);
        else whenScrolledHalfway(function () { if (!store(seenKey())) autoTimer = window.setTimeout(open, 800); });
      }
    }

    // Phones: wait for real interest (a second page view this visit, or reading half a page) before
    // opening by itself, since the screen is already shared with other widgets.
    var pageViews = 1;
    try {
      pageViews = Number(window.sessionStorage.getItem(PV_KEY) || 0) + 1;
      window.sessionStorage.setItem(PV_KEY, String(pageViews));
    } catch (e) { /* storage blocked: treat as a first view */ }
    function whenScrolledHalfway(fn) {
      var onScroll = function () {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        if (max > 0 && window.scrollY / max < 0.5) return;
        window.removeEventListener("scroll", onScroll);
        fn();
      };
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    // The product and cart lines open the giveaway too, anywhere on the bar.
    document.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".pcg-badge--auto")) { e.preventDefault(); open(); }
    });
    document.addEventListener("keydown", function (e) {
      if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("pcg-badge--auto")) { e.preventDefault(); open(); }
    });
    // After entering, the lines switch to "This Earns +N Entries In Today's Draw".
    document.addEventListener("pcg:entered", function () { setBadgeWording(true); });

    // Any link to #daily-giveaway (announcement bar, menu, header icon) opens the popup.
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href$="#daily-giveaway"]');
      if (!a) return;
      e.preventDefault();
      open();
    });
    if (window.location.hash === "#daily-giveaway") window.setTimeout(open, 300);
    widget.addEventListener("pcg:loaded", function (e) { onLoaded(e.detail); });
    // The widget may have loaded before this script ran.
    if (widget.__pcg && widget.__pcg.data && widget.__pcg.data.campaign) onLoaded(widget.__pcg.data);

    // A small digital rain behind the button, like the popup's prize backdrop.
    var rain = launcher.querySelector(".pcg-pop__rain");
    if (rain && window.pcgMatrixRain) window.pcgMatrixRain(rain, launcher, { size: 9 });
    launcher.addEventListener("click", open);
    pop.querySelectorAll(".pcg-pop__close, .pcg-pop__done").forEach(function (b) { b.addEventListener("click", close); });
    // A click on the backdrop (outside the dialog box) closes it.
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog) close();
    });
  }

  // Not entered yet: "Enter Today's Giveaway Free To Earn +N Entries…" with an "Enter Free" link.
  // Entered: "This Earns +N Entries In Today's Draw" with "See Today's Prize".
  function setBadgeWording(entered) {
    document.querySelectorAll(".pcg-badge--auto").forEach(function (b) {
      if (b.__entered === entered) return;
      b.__entered = entered;
      ["text", "text-one"].forEach(function (k) {
        var key = "data-" + k, alt = "data-entered-" + k, other = "data-waiting-" + k;
        if (!b.hasAttribute(other)) b.setAttribute(other, b.getAttribute(key));
        b.setAttribute(key, b.getAttribute(entered ? alt : other));
      });
      var link = b.querySelector(".pcg-badge__link");
      if (link) {
        if (!link.hasAttribute("data-waiting-label")) link.setAttribute("data-waiting-label", link.textContent);
        link.textContent = link.getAttribute(entered ? "data-entered-label" : "data-waiting-label");
      }
      b.__key = null;
    });
    if (window.__pcgBadges) window.__pcgBadges.boot();
  }

  // The embed's "earns +N entries" lines: under the product page's buy buttons, and at the top of
  // the cart drawer's footer (put back whenever the theme re-renders the drawer; it stays hidden
  // until there's a drawer). Each is dropped where the theme already has the app's own block.
  function placeBadges() {
    var product = document.querySelector('[data-pcg-auto="product"]');
    if (product && !product.__placed) {
      product.__placed = true;
      var own = document.querySelector('[data-pcg-badge="product"]:not([data-pcg-auto])');
      var form = document.querySelector('main form[action*="/cart/add"]');
      var buttons = form && (form.querySelector(".product-form__buttons") || form);
      if (own || !buttons) product.remove();
      else {
        buttons.parentNode.insertBefore(product, buttons.nextSibling);
        product.classList.add("pcg-badge--placed");
      }
    }
    var cart = document.querySelector('[data-pcg-auto="cart"]');
    if (cart && !cart.__placed) {
      cart.__placed = true;
      var ownCart = document.querySelector('[data-pcg-badge="cart"]:not([data-pcg-auto])');
      var place = function () {
        var spot = document.querySelector("#CartDrawer .drawer__footer__inner, cart-drawer .drawer__footer, #CartDrawer .drawer__footer");
        if (spot && cart.parentNode !== spot) spot.insertBefore(cart, spot.firstChild);
        cart.classList.toggle("pcg-badge--placed", !!spot);
      };
      if (ownCart) cart.remove();
      else {
        place();
        new MutationObserver(function () { if (!cart.isConnected || !cart.closest("#CartDrawer, cart-drawer")) place(); })
          .observe(document.body, { childList: true, subtree: true });
      }
    }
    if (window.__pcgBadges) window.__pcgBadges.boot();
  }

  function boot() {
    placeBadges();
    document.querySelectorAll("[data-pcg-pop]").forEach(setup);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  document.addEventListener("shopify:section:load", boot);
})();
