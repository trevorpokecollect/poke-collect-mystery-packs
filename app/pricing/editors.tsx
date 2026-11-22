import { useState, useRef } from "react";
import Pricing, {
  type Pool,
  type Draft,
  type Band,
  type PriceCard,
} from "./calculator.mjs";
import { usd, type Edit } from "./display";
export function PoolSettings({
  pool,
  draft,
  edit,
  sets,
}: {
  pool: Pool;
  draft: Draft;
  edit: Edit;
  sets: string[];
}) {
  const r = Pricing.properties(pool, draft);
  const rule = r.buyback;
  const defaultRate =
    rule && "bps" in rule
      ? rule.bps
      : rule?.mode === "off"
        ? 0
        : pool.pricing.buybackBps;
  const [bands, setBands] = useState<(Band & { key: number })[]>(
    r.bands.map((b, key) => ({ ...b, key })),
  );
  const nextKey = useRef(bands.length);
  function setBand(key: number, v: Partial<Band>) {
    setBands((b) => b.map((row) => (row.key === key ? { ...row, ...v } : row)));
  }
  return (
    <details className="pd-controls">
      <summary>Pool price, return target and buyback rules</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          edit((next) => {
            const old = next.pools[pool.id] ?? {};
            next.pools[pool.id] = {
              ...old,
              price: Number(f.get("price")),
              target: Math.round(Number(f.get("target")) * 100),
              buyback: {
                mode: "retail",
                bps: Math.round(Number(f.get("rate")) * 100),
                coverage: "quoted",
              },
              bands: bands.map((b) => ({
                set: b.set,
                min: b.min,
                max: b.max,
                bps: b.bps,
              })),
            };
          });
        }}
      >
        <div className="pd-grid">
          <label>
            Pack price (Cardbits)
            <input
              name="price"
              type="number"
              required
              min="1"
              max="2147483647"
              step="1"
              defaultValue={r.price}
            />
          </label>
          <label>
            Retail return target (%)
            <input
              name="target"
              type="number"
              required
              min="0"
              max="1000"
              step=".01"
              defaultValue={r.target / 100}
            />
          </label>
          <label>
            Default buyback (% of retail)
            <input
              name="rate"
              type="number"
              required
              min="0"
              max="100"
              step=".01"
              defaultValue={defaultRate / 100}
            />
          </label>
        </div>
        <h3>Set and price exceptions</h3>
        <p>
          The first matching rule applies. An individual printing override takes
          priority. Only cards with a positive cash and store-credit buylist
          quote receive an offer.
        </p>
        {bands.map((b, index) => (
          <fieldset className="pd-band" key={b.key}>
            <legend>Rule {index + 1}</legend>
            <label>
              Set
              <select
                value={b.set}
                onChange={(e) => setBand(b.key, { set: e.target.value })}
              >
                <option value="">All sets</option>
                {sets.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Minimum retail ($)
              <input
                type="number"
                required
                min="0"
                step=".01"
                defaultValue={b.min / 100}
                onChange={(e) =>
                  setBand(b.key, {
                    min: Math.round(e.target.valueAsNumber * 100),
                  })
                }
              />
            </label>
            <label>
              Below ($)
              <input
                type="number"
                min="0.01"
                step=".01"
                defaultValue={b.max == null ? "" : b.max / 100}
                onChange={(e) =>
                  setBand(b.key, {
                    max:
                      e.target.value === ""
                        ? null
                        : Math.round(e.target.valueAsNumber * 100),
                  })
                }
              />
            </label>
            <label>
              Buyback (%)
              <input
                type="number"
                required
                min="0"
                max="100"
                step=".01"
                defaultValue={b.bps / 100}
                onChange={(e) =>
                  setBand(b.key, {
                    bps: Math.round(e.target.valueAsNumber * 100),
                  })
                }
              />
            </label>
            <button
              type="button"
              disabled={!index}
              onClick={() =>
                setBands((all) => {
                  const copy = [...all];
                  [copy[index - 1], copy[index]] = [
                    copy[index],
                    copy[index - 1],
                  ];
                  return copy;
                })
              }
            >
              Move up
            </button>
            <button
              type="button"
              onClick={() =>
                setBands((all) => all.filter((row) => row.key !== b.key))
              }
            >
              Remove
            </button>
          </fieldset>
        ))}
        <div className="pd-actions">
          <button
            type="button"
            disabled={bands.length >= 30}
            onClick={() =>
              setBands((all) => [
                ...all,
                {
                  key: nextKey.current++,
                  set: "",
                  min: 0,
                  max: null,
                  bps: defaultRate,
                },
              ])
            }
          >
            Add exception
          </button>
          <button type="submit">Apply to preview</button>
        </div>
      </form>
    </details>
  );
}

export function CardEditor({
  card,
  pool,
  initialQty,
  draft,
  edit,
  done,
}: {
  card: PriceCard;
  pool: Pool;
  initialQty?: number;
  draft: Draft;
  edit: Edit;
  done: () => void;
}) {
  const rule = draft.cards[card.key] ?? {},
    buy = rule.buyback;
  const [valueMode, setValueMode] = useState(rule.value?.mode ?? "current");
  const [buyMode, setBuyMode] = useState(buy?.mode ?? "inherit");
  return (
    <form
      className="pd-editor"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        edit((next) => {
          const value = Number(f.get("value")),
            bps = Math.round(Number(f.get("offer")) * 100);
          const cardRule: Draft["cards"][string] = {};
          if (valueMode === "fixed")
            cardRule.value = { mode: "fixed", amount: value };
          if (valueMode === "market")
            cardRule.value = { mode: "market", bps: Math.round(value * 100) };
          if (buyMode === "off" || buyMode === "current")
            cardRule.buyback = { mode: buyMode };
          if (
            buyMode === "retail" ||
            buyMode === "market" ||
            buyMode === "value"
          )
            cardRule.buyback = { mode: buyMode, bps, coverage: "quoted" };
          if (Object.keys(cardRule).length) next.cards[card.key] = cardRule;
          else delete next.cards[card.key];
          if (initialQty !== undefined) {
            const p = next.pools[pool.id] ?? {},
              quantities = { ...p.quantities },
              n = Number(f.get("qty"));
            if (n === initialQty) delete quantities[card.key];
            else quantities[card.key] = n;
            next.pools[pool.id] = { ...p, quantities };
          }
        });
        done();
      }}
    >
      <h3>
        {card.name}
        {card.no ? " · " + card.no : ""}
      </h3>
      <p>
        {[card.set, card.finish, card.condition].filter(Boolean).join(" · ")}
      </p>
      <p>
        Poke-Collect retail <b>{usd(card.retail)}</b> · Cash buylist{" "}
        <b>{usd(card.cash)}</b> · Store-credit buylist <b>{usd(card.credit)}</b>
        {card.market != null ? " · Cardbroker market " + usd(card.market) : ""}
      </p>
      <div className="pd-grid">
        <label>
          Displayed Cardbit value
          <select
            value={valueMode}
            onChange={(e) => setValueMode(e.target.value as typeof valueMode)}
          >
            <option value="current">Use catalog value</option>
            <option value="fixed">Fixed Cardbits</option>
            <option value="market">Percentage of market</option>
          </select>
        </label>
        {valueMode !== "current" && (
          <label>
            {valueMode === "fixed" ? "Cardbits" : "Market (%)"}
            <input
              key={valueMode}
              type="number"
              name="value"
              min="0"
              required
              max={valueMode === "fixed" ? 2147483647 : 1000}
              step={valueMode === "fixed" ? 1 : ".01"}
              defaultValue={
                rule.value?.mode === "fixed" && valueMode === "fixed"
                  ? rule.value.amount
                  : rule.value?.mode === "market" && valueMode === "market"
                    ? rule.value.bps / 100
                    : valueMode === "fixed"
                      ? (card.value ?? 0)
                      : 100
              }
            />
          </label>
        )}
        <label>
          Printing buyback
          <select
            value={buyMode}
            onChange={(e) => setBuyMode(e.target.value as typeof buyMode)}
          >
            <option value="inherit">Use pool rules</option>
            <option value="retail">Percentage of Poke-Collect retail</option>
            <option value="off">Disable offer</option>
            {buy?.mode === "market" && (
              <option value="market">Percentage of market</option>
            )}
            {buy?.mode === "value" && (
              <option value="value">Percentage of displayed value</option>
            )}
            {buy?.mode === "current" && (
              <option value="current">Catalog offer</option>
            )}
          </select>
        </label>
        {["retail", "market", "value"].includes(buyMode) && (
          <label>
            Buyback (%)
            <input
              type="number"
              name="offer"
              min="0"
              max="100"
              step=".01"
              required
              defaultValue={
                buy && "bps" in buy
                  ? buy.bps / 100
                  : pool.pricing.buybackBps / 100
              }
            />
          </label>
        )}
        {initialQty !== undefined && (
          <label>
            Modeled copies in this pool
            <input
              type="number"
              name="qty"
              min="0"
              max="100000"
              step="1"
              required
              defaultValue={
                draft.pools[pool.id]?.quantities?.[card.key] ?? initialQty
              }
            />
          </label>
        )}
      </div>
      <div className="pd-actions">
        <button type="submit">Apply to preview</button>
        <button type="button" onClick={done}>
          Cancel
        </button>
      </div>
    </form>
  );
}
