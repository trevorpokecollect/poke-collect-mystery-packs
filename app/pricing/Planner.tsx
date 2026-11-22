import { useEffect, useState, useRef } from "react";
import { useFetcher, useLocation } from "react-router";
import type { action } from "../routes/app.pricing-desk";
import Pricing, { type Catalog, type Draft } from "./calculator.mjs";
import { bits, usd, percent, buying } from "./display";
import { CardEditor, PoolSettings } from "./editors";
type Saved = {
  draft: Draft;
  digest: string | null;
  date: string | null;
  warning: string;
};
export function Planner({
  catalog,
  saved,
  onDirty,
}: {
  catalog: Catalog;
  saved: Saved;
  onDirty: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(saved.draft),
    [lastSaved, setLastSaved] = useState(JSON.stringify(saved.draft));
  const [digest, setDigest] = useState(saved.digest),
    [message, setMessage] = useState(saved.warning);
  const [poolId, setPoolId] = useState(catalog.pools[0].id),
    [view, setView] = useState("pool"),
    [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null),
    [page, setPage] = useState(0),
    [epoch, setEpoch] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    [submitted, setSubmitted] = useState(""),
    save = useFetcher<typeof action>();
  const location = useLocation();
  const pool = catalog.pools.find((p) => p.id === poolId)!;
  const summary = Pricing.poolSummary(pool, catalog.cards, draft);
  const dirty = JSON.stringify(draft) !== lastSaved;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const [handled, setHandled] = useState<typeof save.data>(undefined);
  if (save.data && save.data !== handled) {
    setHandled(save.data);
    if (save.data.ok) {
      setDigest(save.data.digest);
      setLastSaved(submitted);
      setMessage("Staff draft saved.");
    } else setMessage(save.data.message);
  }
  function edit(change: (d: Draft) => void) {
    const next = structuredClone(draft);
    change(next);
    if (!Pricing.validate(next, catalog)) {
      setMessage(
        "Check the rule limits. An upper price must be greater than its minimum.",
      );
      return;
    }
    setDraft(next);
    setMessage("Preview updated. Save staff draft to keep these settings.");
  }
  const rows =
    view === "pool"
      ? summary.rows
      : catalog.cards.map((card, i) => ({
          i,
          card,
          qty: null,
          tier: "",
          ...Pricing.cardQuote(card, draft),
        }));
  const needle = query.trim().toLowerCase();
  const filtered = rows.filter(({ card }) =>
    [card.name, card.no, card.set, card.id]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
  const maxPage = Math.max(0, Math.ceil(filtered.length / 20) - 1),
    currentPage = Math.min(page, maxPage);
  const picked = active ? catalog.cards.find((c) => c.key === active) : null;
  const initialQty =
    picked && view === "pool"
      ? pool.rows.find((r) => catalog.cards[r.i].key === picked.key)?.qty
      : undefined;
  const missing = summary.rows
    .filter((r) => !buying(r.card))
    .reduce((n, r) => n + r.qty, 0);
  return (
    <fieldset className="pd-work" disabled={save.state !== "idle"}>
      <legend className="pd-sr">Pricing scenario</legend>
      <div className="pd-bar">
        <label>
          Pack pool
          <select
            value={pool.id}
            onChange={(e) => {
              setPoolId(e.target.value);
              setActive(null);
              setPage(0);
            }}
          >
            {catalog.pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <div className="pd-actions">
          <button
            className="pd-primary"
            disabled={!dirty}
            onClick={() => {
              const serialized = JSON.stringify(draft);
              setSubmitted(serialized);
              save.submit(
                { draft: serialized, digest: digest ?? "" },
                { method: "post", action: location.pathname + location.search },
              );
            }}
          >
            {save.state === "idle" ? "Save staff draft" : "Saving…"}
          </button>
          <button
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(draft, null, 2)], {
                  type: "application/json",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "Cardbit-Pricing-Scenario.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Export
          </button>
          <button onClick={() => input.current?.click()}>Import</button>
          <input
            className="pd-sr"
            ref={input}
            type="file"
            accept=".json,application/json"
            aria-label="Import scenario"
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (!file) return;
              try {
                if (file.size > 250000) throw Error();
                const loaded: unknown = JSON.parse(await file.text());
                if (!Pricing.validate(loaded, catalog)) throw Error();
                setDraft(loaded);
                setEpoch((n) => n + 1);
                setActive(null);
                setMessage(
                  "Imported into the preview. Save staff draft to share it.",
                );
              } catch {
                setMessage(
                  "Choose a scenario exported for this pricing catalog.",
                );
              }
            }}
          />
        </div>
      </div>
      <p role="status" className="pd-status">
        {message ||
          (saved.date
            ? "Shared draft last saved " + new Date(saved.date).toLocaleString()
            : "Using the original pricing assumptions.")}
      </p>
      <div className="pd-metrics">
        {[
          [
            "Poke-Collect retail return",
            percent(summary.ev.market, summary.price),
            usd(summary.ev.market) + " per pack",
          ],
          [
            "Displayed Cardbit return",
            percent(summary.ev.value, summary.price),
            bits(summary.ev.value) + " Cardbits per pack",
          ],
          [
            "Sell-back return",
            percent(summary.ev.offer, summary.price),
            bits(summary.ev.offer) + " Cardbits per pack",
          ],
          ["Cash buylist cost", usd(summary.total.cash), "Across the pool"],
          [
            "Store-credit buylist cost",
            usd(summary.total.credit),
            "Across the pool",
          ],
        ].map(([label, value, detail]) => (
          <div key={label}>
            <p>{label}</p>
            <strong>{value}</strong>
            <small>{detail}</small>
          </div>
        ))}
      </div>
      <p>
        {bits(summary.packs)} complete packs · {bits(summary.price)} Cardbits
        per pack · {bits(summary.target / 100)}% retail return target ·{" "}
        {bits(summary.eligible)} of {bits(summary.count)} copies offered buyback
        {missing > 0
          ? " · " + bits(missing) + " copies need an eligible buylist quote"
          : ""}
      </p>
      <PoolSettings
        key={pool.id + "/" + epoch}
        pool={pool}
        draft={draft}
        edit={edit}
        sets={[
          ...new Set(
            pool.rows.map((r) => catalog.cards[r.i].set).filter(Boolean),
          ),
        ].sort()}
      />
      <div className="pd-bar">
        <div className="pd-switch">
          <button
            aria-pressed={view === "pool"}
            onClick={() => {
              setView("pool");
              setActive(null);
              setPage(0);
            }}
          >
            Pool cards
          </button>
          <button
            aria-pressed={view === "all"}
            onClick={() => {
              setView("all");
              setActive(null);
              setPage(0);
            }}
          >
            Card values
          </button>
        </div>
        <label>
          Find a card
          <input
            type="search"
            placeholder="Name, set, number or ID"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
      </div>
      {view === "all" && (
        <p>Catalog values show the offer before pool-specific rules.</p>
      )}
      {picked && (
        <CardEditor
          key={picked.key}
          card={picked}
          pool={pool}
          initialQty={initialQty}
          draft={draft}
          edit={edit}
          done={() => setActive(null)}
        />
      )}
      <div className="pd-scroll">
        <table>
          <caption className="pd-sr">Pricing by exact printing</caption>
          <thead>
            <tr>
              {[
                "Printing",
                ...(view === "pool" ? ["Copies"] : []),
                "Retail",
                "Cardbit value",
                "Buyback",
                "% of retail",
              ].map((t) => (
                <th key={t} scope="col">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered
              .slice(currentPage * 20, currentPage * 20 + 20)
              .map((r) => (
                <tr key={r.card.key}>
                  <td>
                    <button onClick={() => setActive(r.card.key)}>
                      {r.card.name} {r.card.no}
                    </button>
                    <small>
                      {[r.card.set, r.card.finish, r.card.condition, r.tier]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </td>
                  {view === "pool" && <td>{bits(r.qty)}</td>}
                  <td>{usd(r.card.retail)}</td>
                  <td>{bits(r.value)}</td>
                  <td>{r.offer == null ? "No offer" : bits(r.offer)}</td>
                  <td>{percent(r.offer, r.card.retail ?? 0)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <p>No matching cards.</p>}
      <div className="pd-bar">
        <span>
          {bits(filtered.length)} printings · Page {currentPage + 1} of{" "}
          {maxPage + 1}
        </span>
        <div className="pd-actions">
          <button
            disabled={!currentPage}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </button>
          <button
            disabled={currentPage >= maxPage}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </fieldset>
  );
}
