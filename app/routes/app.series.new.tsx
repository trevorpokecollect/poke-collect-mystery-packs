import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { autoBuildPool, createSeries } from "../lib/series.server";

// Prefilled from a link, e.g. /app/series/new?title=…&variant=<gid>&copyFrom=<seriesId>&productType=…&language=
// creates a series for another pack with the same tiers and pool rules as an existing one
// (rule overrides in the query), then builds its pool, as a draft to review before launch.
const OVERRIDES = ["productType", "language", "condition", "count", "minValue", "maxValue", "targetAverage", "minHits", "hitValue", "minBigHits", "bigHitValue", "minTopHits", "topHitValue", "fillerMax"] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const copyFromId = url.searchParams.get("copyFrom");
  const copyFrom = copyFromId
    ? await db.series.findFirst({ where: { id: copyFromId, shop: session.shop }, select: { id: true, title: true } })
    : null;
  return {
    prefill: {
      title: url.searchParams.get("title") ?? "",
      cardsPerPack: url.searchParams.get("cardsPerPack") ?? "1",
      variant: url.searchParams.get("variant") ?? "",
      copyFrom,
      overrides: Object.fromEntries(OVERRIDES.filter((k) => url.searchParams.has(k)).map((k) => [k, url.searchParams.get(k) ?? ""])),
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const title = String(form.get("title") || "").trim();
  const packVariantId = String(form.get("packVariantId") || "");
  const autoOpenDays = Number(form.get("autoOpenDays") || 1);
  const cardsPerPack = Number(form.get("cardsPerPack") || 1);
  if (!title || !packVariantId) return { error: "Give the series a name and pick its pack product." };

  try {
    const series = await createSeries(admin, session.shop, { title, packVariantId, autoOpenDays, cardsPerPack });
    const copyFromId = String(form.get("copyFrom") || "");
    const source = copyFromId ? await db.series.findFirst({ where: { id: copyFromId, shop: session.shop } }) : null;
    if (source) {
      if (source.tierRules) await db.series.update({ where: { id: series.id }, data: { tierRules: source.tierRules as object } });
      if (source.buildRules) {
        const rules = { ...(source.buildRules as Record<string, unknown>) };
        const NUMERIC = new Set(["count", "minValue", "maxValue", "targetAverage", "minHits", "hitValue", "minBigHits", "bigHitValue", "minTopHits", "topHitValue", "fillerMax"]);
        for (const k of OVERRIDES) {
          if (!form.has(k)) continue;
          rules[k] = NUMERIC.has(k) ? Number(form.get(k)) : String(form.get(k) ?? "");
        }
        try {
          await autoBuildPool(admin, session.shop, series.id, rules as unknown as Parameters<typeof autoBuildPool>[3]);
        } catch (error) {
          // Don't leave an empty draft behind; it would block the next try for this pack.
          await db.series.delete({ where: { id: series.id } });
          throw error;
        }
      }
    }
    return redirect(`/app/series/${series.id}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't create the series." };
  }
};

export default function NewSeries() {
  const shopify = useAppBridge();
  const submit = useSubmit();
  const navigation = useNavigation();
  const result = useActionData<typeof action>();
  const { prefill } = useLoaderData<typeof loader>();
  const [title, setTitle] = useState(prefill.title);
  const [days, setDays] = useState("1");
  const [pack, setPack] = useState<{ id: string; label: string } | null>(
    prefill.variant ? { id: prefill.variant, label: prefill.variant } : null,
  );
  const create = () =>
    submit(
      {
        title,
        packVariantId: pack?.id ?? "",
        autoOpenDays: days,
        cardsPerPack: prefill.cardsPerPack,
        ...(prefill.copyFrom ? { copyFrom: prefill.copyFrom.id, ...prefill.overrides } : {}),
      },
      { method: "post" },
    );

  async function pickPack() {
    const selection = await shopify.resourcePicker({ type: "variant", multiple: false });
    const variant = selection?.[0] as { id: string; displayName?: string; title?: string } | undefined;
    if (variant) setPack({ id: variant.id, label: variant.displayName ?? variant.title ?? variant.id });
  }

  return (
    <s-page heading="New mystery pack series" inlineSize="small">
      <s-button slot="primary-action" variant="primary" disabled={!title || !pack || navigation.state !== "idle"} onClick={create}>
        Create series
      </s-button>
      {prefill.copyFrom ? (
        <s-banner tone="info" heading={`Copying ${prefill.copyFrom.title}`}>
          Same tiers and pool rules{Object.keys(prefill.overrides).length
            ? `, with ${Object.entries(prefill.overrides).map(([k, v]) => `${k}: ${v || "any"}`).join(", ")}`
            : ""}. The pool is built from your inventory as a draft for you to review.
        </s-banner>
      ) : null}
      <s-section>
        <s-stack gap="base">
          {result?.error ? <s-banner tone="critical">{result.error}</s-banner> : null}
          <s-text-field
            label="Series name"
            placeholder="Series 1"
            value={title}
            onInput={(e) => setTitle((e.currentTarget).value)}
          />
          <s-stack gap="small-200">
            <s-text>Pack product</s-text>
            <s-paragraph>
              The product customers buy, e.g. &quot;Mystery Pack: Series 1&quot; at $10. Its inventory is set to the
              number of packs when you launch.
            </s-paragraph>
            <s-button onClick={pickPack}>{pack ? pack.label : "Choose pack product"}</s-button>
          </s-stack>
          <s-number-field
            label="Auto-open unopened packs after (days)"
            min={1}
            max={60}
            value={days}
            onInput={(e) => setDays((e.currentTarget).value)}
          />
          <s-button
            variant="primary"
            {...(navigation.state === "submitting" ? { loading: true } : {})}
            onClick={create}
          >
            Create series
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
