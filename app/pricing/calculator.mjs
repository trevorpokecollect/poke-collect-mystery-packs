const Pricing = (() => {
  const defaultValue = { mode: "current" };
  const defaultBuyback = { mode: "current" };
  const whole = (n) => Number.isSafeInteger(n) && n >= 0;
  const portion = (amount, bps) =>
    amount == null ? null : Math.floor((amount * bps + 5000) / 10000);
  function properties(pool, draft) {
    const rule = draft.pools[pool.id] || {};
    return {
      price: rule.price ?? pool.price,
      target: rule.target ?? pool.pricing?.targetBps ?? 10000,
      snapshotBps: pool.pricing?.buybackBps,
      buyback: rule.buyback,
      bands: rule.bands || [],
      quantities: rule.quantities || {},
    };
  }
  function cardQuote(card, draft, poolRules) {
    const override = draft.cards[card.key] || {};
    const valueRule = override.value || draft.defaults.value || defaultValue;
    let value = card.value;
    if (valueRule.mode === "market")
      value = portion(card.market, valueRule.bps);
    if (valueRule.mode === "fixed") value = valueRule.amount;
    const band =
      card.retail == null
        ? null
        : poolRules?.bands?.find(
            (b) =>
              (!b.set || b.set === card.set) &&
              card.retail >= b.min &&
              (b.max == null || card.retail < b.max),
          );
    const matched = band && {
      mode: "retail",
      bps: band.bps,
      coverage: "quoted",
    };
    const rule =
      override.buyback ||
      matched ||
      poolRules?.buyback ||
      draft.defaults.buyback ||
      defaultBuyback;
    let offer = null,
      unknown = false;
    const eligible = card.retail > 0 && card.cash > 0 && card.credit > 0;
    if (eligible && rule.mode === "current") {
      offer =
        poolRules?.snapshotBps == null
          ? card.buyback
          : portion(card.retail, poolRules.snapshotBps);
    }
    if (eligible && ["market", "retail", "value"].includes(rule.mode)) {
      offer = portion(
        rule.mode === "retail"
          ? card.retail
          : rule.mode === "market"
            ? card.market
            : value,
        rule.bps,
      );
      unknown = offer == null;
    }
    if (offer === 0) offer = null;
    return { value, offer, unknown, valueRule, buybackRule: rule };
  }
  function poolSummary(pool, cards, draft) {
    const rules = properties(pool, draft);
    const total = { market: 0, value: 0, offer: 0, cash: 0, credit: 0 };
    let count = 0,
      eligible = 0;
    const rows = pool.rows.map((row) => {
      const card = cards[row.i],
        qty = rules.quantities[card.key] ?? row.qty;
      const quote = cardQuote(card, draft, rules);
      count += qty;
      if (quote.offer != null) eligible += qty;
      if (qty > 0) {
        for (const [name, amount] of [
          [
            "market",
            pool.pricing?.basis === "poke-collect-retail"
              ? card.retail
              : card.market,
          ],
          ["cash", card.cash],
          ["credit", card.credit],
          ["value", quote.value],
          ["offer", quote.unknown ? null : (quote.offer ?? 0)],
        ]) {
          total[name] =
            amount == null || total[name] == null
              ? null
              : total[name] + amount * qty;
        }
      }
      return { ...row, card, qty, ...quote };
    });
    const ev = {};
    for (const name of Object.keys(total))
      ev[name] =
        total[name] == null || count < pool.draws
          ? null
          : (total[name] * pool.draws) / count;
    return {
      rows,
      ev,
      total,
      count,
      eligible,
      price: rules.price,
      target: rules.target,
      targetValue: (rules.price * rules.target) / 10000,
      packs: Math.floor(count / pool.draws),
      remainder: count % pool.draws,
    };
  }
  function empty(version) {
    return { version, defaults: {}, pools: {}, cards: {} };
  }
  function validate(data, catalog) {
    const plain = (o) =>
      o != null && typeof o === "object" && !Array.isArray(o);
    const keys = (o, allowed) =>
      plain(o) && Object.keys(o).every((k) => allowed.includes(k));
    const within = (n, hi, lo = 0) => whole(n) && n >= lo && n <= hi;
    const isValue = (r) =>
      (keys(r, ["mode"]) && r.mode === "current") ||
      (keys(r, ["mode", "amount"]) &&
        r.mode === "fixed" &&
        within(r.amount, 2147483647)) ||
      (keys(r, ["mode", "bps"]) &&
        r.mode === "market" &&
        within(r.bps, 100000));
    const isBuyback = (r) =>
      (keys(r, ["mode"]) && ["current", "off"].includes(r.mode)) ||
      (keys(r, ["mode", "bps", "coverage"]) &&
        ["market", "retail", "value"].includes(r.mode) &&
        within(r.bps, 10000) &&
        r.coverage === "quoted");
    const policy = (o) =>
      keys(o, ["value", "buyback"]) &&
      (!("value" in o) || isValue(o.value)) &&
      (!("buyback" in o) || isBuyback(o.buyback));
    if (
      !keys(data, ["version", "defaults", "pools", "cards"]) ||
      data.version !== catalog.version ||
      !policy(data.defaults) ||
      data.defaults.value?.mode === "fixed" ||
      !plain(data.cards) ||
      !plain(data.pools)
    )
      return false;
    const known = new Set(catalog.cards.map((c) => c.key));
    if (
      !Object.entries(data.cards).every(([k, v]) => known.has(k) && policy(v))
    )
      return false;
    return Object.entries(data.pools).every(([id, v]) => {
      const p = catalog.pools.find((x) => x.id === id);
      if (!p || !keys(v, ["price", "target", "quantities", "buyback", "bands"]))
        return false;
      const members = new Set(p.rows.map((row) => catalog.cards[row.i].key));
      const sets = new Set(p.rows.map((row) => catalog.cards[row.i].set));
      if (
        "bands" in v &&
        (!p.pricing?.basis ||
          !Array.isArray(v.bands) ||
          v.bands.length > 30 ||
          !v.bands.every(
            (b) =>
              keys(b, ["set", "min", "max", "bps"]) &&
              (b.set === "" || sets.has(b.set)) &&
              within(b.min, 2147483647) &&
              (b.max === null || within(b.max, 2147483647, b.min + 1)) &&
              within(b.bps, 10000),
          ))
      )
        return false;
      return (
        (!("price" in v) || within(v.price, 2147483647, 1)) &&
        (!("target" in v) || within(v.target, 100000)) &&
        (!("buyback" in v) || isBuyback(v.buyback)) &&
        (!("quantities" in v) ||
          (plain(v.quantities) &&
            Object.entries(v.quantities).every(
              ([k, n]) => members.has(k) && within(n, 100000),
            )))
      );
    });
  }
  return { empty, properties, cardQuote, poolSummary, validate, portion };
})();

export default Pricing;
