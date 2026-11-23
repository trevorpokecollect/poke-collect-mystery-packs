import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useEffect, useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { parseImport, previewImport, runImport } from "../lib/import.server";
import { backfillOrders } from "../lib/backfill.server";
import { parseLocalDateTime, toLocalInput } from "../lib/time";

// Migration tools: import entrants from a GiveawayNinja (or similar) CSV, and
// replay past orders through the purchase-entry rules. Named with "$id_" so it
// renders as its own page at /staff/cardbit-campaigns/campaigns/:id/import.

const MAX_CSV_BYTES = 10 * 1024 * 1024;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const campaign = await db.campaign.findFirst({
    where: { id: params.id, shop: session.shop },
  });
  if (!campaign) throw new Response("Not found", { status: 404 });
  const tz = campaign.timezone;
  const day = (d: Date | null) => (d ? toLocalInput(d, tz).slice(0, 10) : "");
  return {
    campaign: {
      id: campaign.id,
      title: campaign.title,
      status: campaign.status,
      hasPurchaseRules: !!campaign.purchaseRules,
    },
    defaultFrom: day(campaign.startsAt ?? campaign.createdAt),
    defaultTo: day(
      campaign.endsAt && campaign.endsAt < new Date()
        ? campaign.endsAt
        : new Date(),
    ),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const campaign = await db.campaign.findFirst({
    where: { id: params.id, shop: session.shop },
  });
  if (!campaign) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "preview" || intent === "import") {
    const csv = String(form.get("csv") ?? "");
    if (!csv.trim()) return { intent, error: "Choose a CSV file first." };
    if (csv.length > MAX_CSV_BYTES)
      return { intent, error: "That file is over 10 MB." };
    const parsed = parseImport(csv);
    if (intent === "preview") {
      return {
        intent,
        summary: await previewImport(campaign.id, parsed),
        errors: parsed.errors.slice(0, 20),
        errorCount: parsed.errors.length,
        duplicates: parsed.duplicates,
        sample: parsed.rows.slice(0, 10),
      };
    }
    const result = await runImport(campaign.id, parsed);
    await db.auditLog.create({
      data: {
        shop: session.shop,
        action: "entrant.import",
        target: campaign.id,
        data: { ...result, rows: parsed.rows.length },
      },
    });
    return { intent, result };
  }

  if (intent === "backfill") {
    const tz = campaign.timezone;
    const from = parseLocalDateTime(`${form.get("from")}T00:00`, tz);
    const to = parseLocalDateTime(`${form.get("to")}T23:59`, tz);
    try {
      const run = await backfillOrders(admin, session.shop, {
        from,
        to: to ? new Date(to.getTime() + 59_999) : to,
        cursor: form.get("cursor") ? String(form.get("cursor")) : null,
      });
      if (!run.cursor) {
        await db.auditLog.create({
          data: {
            shop: session.shop,
            action: "orders.backfill",
            target: campaign.id,
            data: {
              from: String(form.get("from")),
              to: String(form.get("to")),
            },
          },
        });
      }
      return {
        intent,
        cursor: run.cursor,
        processed: run.processed + (Number(form.get("processed")) || 0),
      };
    } catch (err) {
      return { intent, error: (err as Error).message };
    }
  }
  return { intent, error: "Unknown action" };
};

export default function CampaignImport() {
  const { campaign, defaultFrom, defaultTo } = useLoaderData<typeof loader>();
  const base = `/staff/cardbit-campaigns/campaigns/${campaign.id}`;

  return (
    <s-page heading={`${campaign.title}: import and backfill`}>
      <s-link slot="breadcrumb-actions" href={base}>
        Back to giveaway
      </s-link>
      <ImportSection />
      <BackfillSection
        status={campaign.status}
        hasPurchaseRules={campaign.hasPurchaseRules}
        defaultFrom={defaultFrom}
        defaultTo={defaultTo}
      />
    </s-page>
  );
}

function ImportSection() {
  const fetcher = useFetcher<typeof action>();
  const [csv, setCsv] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";
  const data = fetcher.data;
  const submit = (intent: string) =>
    fetcher.submit({ intent, csv }, { method: "post" });

  return (
    <s-section heading="Import entrants from CSV">
      <s-stack gap="base">
        <s-paragraph>
          Bring entrants over from GiveawayNinja or a spreadsheet. The file
          needs an Email column; Name and Entries (or Points / Total Entries)
          are picked up when present. Imported people are marked verified and
          get their entries once, so running the same file again changes
          nothing.
        </s-paragraph>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const f = e.currentTarget.files?.[0];
            setFileError(null);
            setCsv("");
            if (!f) return;
            if (f.size > MAX_CSV_BYTES) {
              setFileError("That file is over 10 MB.");
              return;
            }
            setCsv(await f.text());
          }}
        />
        {fileError && <s-banner tone="critical">{fileError}</s-banner>}
        {data && "error" in data && data.intent !== "backfill" && (
          <s-banner tone="critical">{data.error}</s-banner>
        )}
        <s-button-group>
          <s-button
            slot="secondary-actions"
            disabled={!csv || busy}
            onClick={() => submit("preview")}
          >
            Preview
          </s-button>
        </s-button-group>

        {data && "summary" in data && data.summary && (
          <s-stack gap="base">
            <s-banner tone={data.errorCount ? "warning" : "info"}>
              {data.summary.rows} entrants found: {data.summary.newEntrants}{" "}
              new, {data.summary.existingEntrants} already in this giveaway (
              {data.summary.alreadyImported} already imported).{" "}
              {data.summary.entriesToAdd.toLocaleString()} entries will be
              added.
              {data.duplicates > 0 &&
                ` ${data.duplicates} duplicate rows were merged.`}
              {data.errorCount > 0 &&
                ` ${data.errorCount} rows will be skipped.`}
            </s-banner>
            {data.errors.length > 0 && (
              <s-unordered-list>
                {data.errors.map((e) => (
                  <s-list-item key={e.line}>
                    Line {e.line}: {e.message}
                  </s-list-item>
                ))}
              </s-unordered-list>
            )}
            {data.sample.length > 0 && (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Email</s-table-header>
                  <s-table-header>Name</s-table-header>
                  <s-table-header format="numeric">Entries</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {data.sample.map((r) => (
                    <s-table-row key={r.emailNormalized}>
                      <s-table-cell>{r.email}</s-table-cell>
                      <s-table-cell>{r.name ?? "—"}</s-table-cell>
                      <s-table-cell>{r.entries}</s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
            <s-button
              variant="primary"
              disabled={busy || data.summary.rows === 0}
              {...(busy ? { loading: true } : {})}
              onClick={() => submit("import")}
            >
              Import {data.summary.rows.toLocaleString()} entrants
            </s-button>
          </s-stack>
        )}

        {data && "result" in data && data.result && (
          <s-banner tone="success">
            Imported: {data.result.created} new entrants,{" "}
            {data.result.entries.toLocaleString()} entries added across{" "}
            {data.result.awarded} people.
          </s-banner>
        )}
      </s-stack>
    </s-section>
  );
}

function BackfillSection({
  status,
  hasPurchaseRules,
  defaultFrom,
  defaultTo,
}: {
  status: string;
  hasPurchaseRules: boolean;
  defaultFrom: string;
  defaultTo: string;
}) {
  const fetcher = useFetcher<typeof action>();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const data = fetcher.data;
  const idle = fetcher.state === "idle";
  const page = data && "processed" in data ? data : null;
  // The server returns a running total, so the client keeps no counters.
  const processed = page?.processed ?? 0;
  const running = !idle || !!page?.cursor;
  const done = idle && !!page && !page.cursor;

  // Each request handles a slice of orders; keep going until Shopify runs out.
  useEffect(() => {
    if (idle && page?.cursor) {
      fetcher.submit(
        {
          intent: "backfill",
          from,
          to,
          cursor: page.cursor,
          processed: page.processed,
        },
        { method: "post" },
      );
    }
    // Only react to a finished request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idle, page]);

  const start = () =>
    fetcher.submit({ intent: "backfill", from, to }, { method: "post" });

  return (
    <s-section heading="Backfill past orders">
      <s-stack gap="base">
        <s-paragraph>
          Give entries for orders placed before the app was installed, or while
          it was offline. Orders go through the same rules as live orders, and
          an order that already has entries is never counted twice.
        </s-paragraph>
        {status !== "ACTIVE" && (
          <s-banner tone="warning">
            Only live giveaways earn order entries. Set this giveaway live
            before backfilling.
          </s-banner>
        )}
        {!hasPurchaseRules && (
          <s-banner tone="warning">
            This giveaway has no purchase rules, so orders won&apos;t earn
            entries.
          </s-banner>
        )}
        <s-banner tone="info">
          Shopify only shares the last 60 days of orders with this app. Older
          orders need the read_all_orders permission, which this app does not
          request. Orders outside the giveaway&apos;s start and end dates never
          earn entries. Backfilling also credits any other live giveaway those
          orders qualify for.
        </s-banner>
        <s-stack direction="inline" gap="base">
          <s-date-field
            label="From"
            value={from}
            onChange={(e) => setFrom(e.currentTarget.value)}
          />
          <s-date-field
            label="To"
            value={to}
            onChange={(e) => setTo(e.currentTarget.value)}
          />
        </s-stack>
        <s-button
          variant="primary"
          disabled={running || !from || !to}
          {...(running ? { loading: true } : {})}
          onClick={start}
        >
          Backfill orders
        </s-button>
        {running && (
          <s-text color="subdued">
            {processed.toLocaleString()} orders checked so far…
          </s-text>
        )}
        {done && (
          <s-banner tone="success">
            Done: {processed.toLocaleString()} orders checked. See the order log
            on the giveaway page for results.
          </s-banner>
        )}
        {data && data.intent === "backfill" && "error" in data && (
          <s-banner tone="critical">{data.error}</s-banner>
        )}
      </s-stack>
    </s-section>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
