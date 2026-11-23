/* Cardbit Giveaways "Earn X entries" badges for product and cart pages. No dependencies. */
(function () {
  "use strict";
  if (window.__pcgBadges) return window.__pcgBadges.boot();

  function debounce(fn, ms) {
    var t;
    return function () { window.clearTimeout(t); t = window.setTimeout(fn, ms); };
  }

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    }).then(function (r) { return r.ok ? r.json() : null; });
  }

  function show(badge, res) {
    var n = res && res.entries ? res.entries : 0;
    if (!n) { badge.hidden = true; return; }
    var template = (n === 1 && badge.getAttribute("data-text-one")) || badge.getAttribute("data-text") || "Earn [entries] giveaway entries with this purchase";
    var text = template
      .replace(/\[entries\]/g, n.toLocaleString())
      .replace(/\[giveaway\]/g, res.giveaway ? res.giveaway.title : "our giveaway");
    badge.querySelector(".pcg-badge__text").textContent = text;
    badge.hidden = false;
  }

  // Product page: the theme's add-to-cart form holds the chosen variant and quantity.
  function productForm(badge) {
    var section = badge.closest("section, .shopify-section, main") || document;
    return section.querySelector('form[action*="/cart/add"]') || document.querySelector('form[action*="/cart/add"]');
  }

  function productState(badge) {
    var form = productForm(badge);
    var idInput = form && form.querySelector('[name="id"]');
    var qtyInput = (form && form.querySelector('[name="quantity"]')) || document.querySelector('input[name="quantity"]');
    var urlVariant = new URLSearchParams(window.location.search).get("variant");
    var variant = (idInput && idInput.value) || urlVariant || badge.getAttribute("data-variant");
    var quantity = Math.max(1, parseInt(qtyInput && qtyInput.value, 10) || 1);
    return { variant: String(variant), quantity: quantity };
  }

  function updateProduct(badge) {
    var variants = badge.__variants;
    if (!variants) {
      try { variants = JSON.parse(badge.querySelector("[data-pcg-variants]").textContent); } catch (e) { variants = []; }
      badge.__variants = variants;
    }
    var state = productState(badge);
    var match = variants.filter(function (v) { return String(v.id) === state.variant; })[0] || variants[0];
    if (!match) return;
    var key = match.id + ":" + state.quantity;
    if (badge.__key === key) return;
    badge.__key = key;
    var q = new URLSearchParams({
      product: badge.getAttribute("data-product"),
      variant: String(match.id),
      price: String(match.price),
      quantity: String(state.quantity),
      format: "json",
    });
    var giveaway = badge.getAttribute("data-giveaway");
    if (giveaway) q.set("giveaway", giveaway);
    fetch(badge.getAttribute("data-proxy") + "/estimate?" + q.toString(), { headers: { Accept: "application/json" }, credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (res) { if (badge.__key === key) show(badge, res); })
      .catch(function () { badge.hidden = true; });
  }

  // Cart: estimate from /cart.js, which already applies line discounts (final_price).
  function updateCart(badge) {
    fetch("/cart.js", { headers: { Accept: "application/json" }, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var key = cart.token + ":" + cart.total_price + ":" + cart.item_count;
        if (badge.__key === key) return null;
        badge.__key = key;
        if (!cart.item_count) { badge.hidden = true; return null; }
        return post(badge.getAttribute("data-proxy") + "/estimate?format=json", {
          giveaway: badge.getAttribute("data-giveaway") || undefined,
          items: cart.items.map(function (i) {
            return { product_id: i.product_id, variant_id: i.variant_id, quantity: i.quantity, final_price: i.final_price, gift_card: i.gift_card };
          }),
        }).then(function (res) { show(badge, res); });
      })
      .catch(function () { badge.hidden = true; });
  }

  function badges(kind) {
    return Array.prototype.slice.call(document.querySelectorAll('[data-pcg-badge="' + kind + '"]'));
  }
  var refreshProduct = debounce(function () { badges("product").forEach(updateProduct); }, 150);
  var refreshCart = debounce(function () { badges("cart").forEach(updateCart); }, 400);

  function boot() {
    badges("product").forEach(updateProduct);
    badges("cart").forEach(function (b) { b.__key = null; updateCart(b); });
  }

  // Variant pickers and quantity inputs fire change/input; some themes only update the hidden id
  // input from script, so read it a moment later.
  document.addEventListener("change", refreshProduct, true);
  document.addEventListener("input", refreshProduct, true);
  document.addEventListener("click", function (e) {
    if (e.target && e.target.closest && e.target.closest("quantity-input, .quantity, [name=\"plus\"], [name=\"minus\"]")) refreshProduct();
  }, true);
  ["variant:change", "variant:changed", "product:variant-change"].forEach(function (ev) { document.addEventListener(ev, refreshProduct); });

  // Cart changes: theme events, the cart form's quantity inputs, and Ajax cart requests.
  ["cart:updated", "cart:refresh", "cart:change", "cart-drawer:open", "theme:cart:change"].forEach(function (ev) { document.addEventListener(ev, refreshCart); });
  document.addEventListener("change", function (e) { if (e.target && /^updates/.test(e.target.name || "")) refreshCart(); }, true);
  if (window.fetch && badges("cart").length) {
    var origFetch = window.fetch;
    window.fetch = function (input) {
      var p = origFetch.apply(this, arguments);
      var url = String((input && input.url) || input || "");
      if (/\/cart\/(add|change|update|clear)/.test(url)) p.then(refreshCart, function () {});
      return p;
    };
  }
  window.addEventListener("pageshow", function (e) { if (e.persisted) boot(); });

  window.__pcgBadges = { boot: boot };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  document.addEventListener("shopify:section:load", boot);
})();
