import { useState } from "react";
import { data, useLoaderData, useSearchParams } from "react-router";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isCardbit } from "../lib/cardbit.server";
import { deskSeries, loadCatalog } from "../pricing/catalog.server";
import { loadScenario, saveScenario } from "../pricing/scenario.server";
import { Planner } from "../pricing/Planner";
import "../pricing/desk.css";

async function staff(request: Request) {
  const ctx = await authenticate.admin(request);
  if (!isCardbit(ctx.session.shop))
    throw new Response("Page unavailable", { status: 404 });
  return ctx;
}
const seriesFrom = (request: Request) =>
  new URL(request.url).searchParams.get("series") || null;
export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await staff(request);
  const source = seriesFrom(request);
  const [series, result] = await Promise.all([
    deskSeries(db, session.shop),
    loadCatalog(db, admin, session.shop, source),
  ]);
  const saved = result.catalog
    ? await loadScenario(admin, result.catalog)
    : null;
  return data(
    {
      source,
      series,
      ...result,
      saved: saved && {
        draft: saved.draft,
        digest: saved.digest,
        date: saved.date,
        warning: saved.warning,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await staff(request);
  const form = await request.formData();
  const body = form.get("draft"),
    digest = form.get("digest");
  if (
    request.method !== "POST" ||
    typeof body !== "string" ||
    body.length > 250000 ||
    typeof digest !== "string" ||
    (digest && !/^[a-f0-9]{64}$/i.test(digest))
  )
    return { ok: false as const, message: "Invalid pricing draft." };
  let draft: unknown;
  try {
    draft = JSON.parse(body);
  } catch {
    return { ok: false as const, message: "Invalid pricing draft." };
  }
  const { catalog } = await loadCatalog(
    db,
    admin,
    session.shop,
    seriesFrom(request),
  );
  if (!catalog) throw new Response("Catalog unavailable", { status: 404 });
  return saveScenario(admin, catalog, draft, digest || null);
}
export const headers: HeadersFunction = (args) => {
  const headers = new Headers(boundary.headers(args));
  headers.set("Cache-Control", "private, no-store");
  return headers;
};

export default function PricingDesk() {
  const result = useLoaderData<typeof loader>(),
    [search, setSearch] = useSearchParams(),
    [dirty, setDirty] = useState(false),
    [pendingSource, setPendingSource] = useState<string | null>(null);
  function changeSource(source: string) {
    const next = new URLSearchParams(search);
    if (source) next.set("series", source);
    else next.delete("series");
    setPendingSource(null);
    setSearch(next);
  }
  return (
    <s-page heading="Pricing desk">
      <div className="pd">
        <div className="pd-bar">
          <label>
            Data source
            <select
              value={result.source ?? ""}
              onChange={(e) => {
                if (dirty) setPendingSource(e.target.value);
                else changeSource(e.target.value);
              }}
            >
              <option value="">Saved planning pools</option>
              {result.series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {s.status.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          {result.source && (
            <a href={"/app/series/" + encodeURIComponent(result.source)}>
              Open pack series
            </a>
          )}
        </div>
        {pendingSource !== null && (
          <section className="pd-editor" aria-label="Unsaved preview">
            <p>Switching sources will discard the unsaved preview.</p>
            <div className="pd-actions">
              <button onClick={() => setPendingSource(null)}>
                Keep editing
              </button>
              <button onClick={() => changeSource(pendingSource)}>
                Discard preview and switch
              </button>
            </div>
          </section>
        )}
        <p>
          {result.notice}{" "}
          {result.catalog && "Quote date " + result.catalog.date + "."} Saved
          scenarios are for staff planning.
        </p>
        {result.catalog && result.saved && (
          <Planner
            key={result.catalog.version}
            catalog={result.catalog}
            saved={result.saved}
            onDirty={setDirty}
          />
        )}
      </div>
    </s-page>
  );
}
