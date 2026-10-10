import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const series = await db.series.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { slots: true, pulls: true } } },
  });
  const unopened = await db.pull.count({ where: { shop: session.shop, status: "UNOPENED" } });
  return {
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

const tone = { DRAFT: "neutral", LIVE: "success", CLOSED: "info" } as const;

export default function Index() {
  const { series, unopened } = useLoaderData<typeof loader>();

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
