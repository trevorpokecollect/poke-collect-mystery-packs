import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { statusTone } from "../lib/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const campaigns = await db.campaign.findMany({
    where: { shop: session.shop, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { entrants: true } } },
  });
  const held = await db.entrant.groupBy({
    by: ["campaignId"],
    where: { status: "HELD", campaign: { shop: session.shop } },
    _count: true,
  });
  const heldBy = Object.fromEntries(held.map((h) => [h.campaignId, h._count]));
  return {
    campaigns: campaigns.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      startsAt: c.startsAt?.toISOString() ?? null,
      endsAt: c.endsAt?.toISOString() ?? null,
      entrants: c._count.entrants,
      held: heldBy[c.id] ?? 0,
    })),
  };
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : "—";

export default function Index() {
  const { campaigns } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Giveaways">
      <s-button
        slot="primary-action"
        variant="primary"
        href="/staff/cardbit-campaigns/campaigns/new"
      >
        New giveaway
      </s-button>
      <s-button slot="secondary-actions" href="/staff/cardbit-campaigns/campaigns/new?type=monthly">
        New monthly campaign
      </s-button>
      <s-button slot="secondary-actions" href="/staff/cardbit-campaigns/campaigns/new?type=daily">
        New daily giveaway
      </s-button>

      {campaigns.length === 0 ? (
        <s-section>
          <s-stack gap="base" alignItems="center">
            <s-heading>Run your first giveaway</s-heading>
            <s-paragraph>
              Every entry is checked for bots automatically, and purchases earn
              entries based on rules you set.
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              <s-button variant="primary" href="/staff/cardbit-campaigns/campaigns/new">
                Create a giveaway
              </s-button>
              <s-button href="/staff/cardbit-campaigns/campaigns/new?type=daily">
                Create a daily giveaway
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Giveaway</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header format="numeric">Entrants</s-table-header>
              <s-table-header format="numeric">Needs review</s-table-header>
              <s-table-header>Runs</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {campaigns.map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>
                    <s-link href={`/staff/cardbit-campaigns/campaigns/${c.id}`}>{c.title}</s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={statusTone(c.status)}>
                      {c.status.toLowerCase()}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{c.entrants}</s-table-cell>
                  <s-table-cell>
                    {c.held > 0 ? (
                      <s-badge tone="warning">{c.held}</s-badge>
                    ) : (
                      0
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    {fmt(c.startsAt)} – {fmt(c.endsAt)}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
