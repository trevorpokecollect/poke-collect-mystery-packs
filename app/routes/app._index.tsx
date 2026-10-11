import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getFreeShipping, saveFreeShipping } from "../lib/free-shipping.server";
import { demoToken } from "../lib/demo.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const freeShipping = await getFreeShipping(admin).catch(() => ({ enabled: false, threshold: 5, discountId: null }));
  const series = await db.series.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { slots: true, pulls: true } } },
  });
  const unopened = await db.pull.count({ where: { shop: session.shop, status: "UNOPENED" } });
  return {
    // Opens the storefront My Packs page with sample packs to open (link works for 30 days).
    previewUrl: `https://${session.shop}/apps/packs?demo=${demoToken(session.shop)}`,
    freeShipping: { enabled: freeShipping.enabled, threshold: freeShipping.threshold },
    unopened,
    series: series.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      price: s.packPrice.toString(),
      packs: s._count.slots,
      sold: s._count.pulls,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  try {
    await saveFreeShipping(admin, {
      enabled: form.get("enabled") === "true",
      threshold: Number(form.get("threshold")),
    });
    return { ok: "Free shipping settings saved." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't save free shipping." };
  }
};

const tone = { DRAFT: "neutral", LIVE: "success", CLOSED: "info" } as const;

export default function Index() {
  const { series, unopened, freeShipping, previewUrl } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const submit = useSubmit();
  const busy = useNavigation().state === "submitting";

  function saveShipping(section: HTMLElement, enabled: boolean) {
    const field = section.querySelector("[data-threshold]") as HTMLInputElement | null;
    submit({ enabled: String(enabled), threshold: field?.value ?? String(freeShipping.threshold) }, { method: "post" });
  }

  return (
    <s-page heading="Mystery pack series">
      <s-button slot="primary-action" variant="primary" href="/app/series/new">
        New series
      </s-button>

      <s-section>
        {series.length === 0 ? (
          <s-paragraph>
            No series yet. Create one, add the cards in its pool, then launch it to put packs on sale.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Series</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header format="currency">Pack price</s-table-header>
              <s-table-header format="numeric">Packs sold</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {series.map((s) => (
                <s-table-row key={s.id}>
                  <s-table-cell>
                    <s-link href={`/app/series/${s.id}`}>{s.title}</s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={tone[s.status]}>{s.status.toLowerCase()}</s-badge>
                  </s-table-cell>
                  <s-table-cell>${s.price}</s-table-cell>
                  <s-table-cell>
                    {s.status === "DRAFT" ? "Not launched" : `${s.sold} of ${s.packs}`}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Free shipping on packs">
        <s-stack gap="base">
          {result && "error" in result ? <s-banner tone="critical">{result.error}</s-banner> : null}
          {result && "ok" in result ? <s-banner tone="success">{result.ok}</s-banner> : null}
          <s-paragraph>
            {freeShipping.enabled
              ? `On: orders with ${freeShipping.threshold} or more mystery packs ship free.`
              : "Off."}{" "}
            Only mystery packs count toward the total, not other items in the cart.
          </s-paragraph>
          <s-number-field label="Packs needed" min={1} max={100} value={String(freeShipping.threshold)} data-threshold />
          <s-stack direction="inline" gap="small">
            <s-button
              variant="primary"
              {...(busy ? { loading: true } : {})}
              onClick={(e) => saveShipping((e.currentTarget as HTMLElement).closest("s-section")!, true)}
            >
              {freeShipping.enabled ? "Save" : "Turn on"}
            </s-button>
            {freeShipping.enabled ? (
              <s-button onClick={(e) => saveShipping((e.currentTarget as HTMLElement).closest("s-section")!, false)}>
                Turn off
              </s-button>
            ) : null}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Preview My Packs">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            See My Packs the way customers do, with sample packs from the live pool to open. Nothing
            is ordered or drawn. Bookmark the link to come back to it.
          </s-paragraph>
          <s-button href={previewUrl} target="_blank">
            Open Preview
          </s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Waiting to be opened">
        <s-paragraph>
          {unopened} unopened pack{unopened === 1 ? "" : "s"}. Orders with unopened packs stay on
          hold, and open automatically after each series&apos; auto-open window.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
