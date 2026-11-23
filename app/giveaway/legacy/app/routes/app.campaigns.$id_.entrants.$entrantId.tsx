import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { entriesByMethod } from "../lib/entries/methods.server";
import { orderPlacedAt } from "../lib/entries/orders.server";
import {
  describeEvent,
  restoreEvent,
  voidEvent,
  voidedEvents,
} from "../lib/entries/void.server";
import { activate, clawBackReferrals } from "../lib/entries/signup.server";
import { riskTone, statusTone } from "../lib/ui";
import { EntriesByMethodTable } from "../components/EntriesByMethod";
import { EntryActivityTable } from "../components/EntryActivity";
import { flag, TextInput } from "../components/fields";
import { AddEntriesForm } from "../components/AddEntries";
import { addEntries } from "../lib/entries/adjust.server";

// One entrant: entries per method, every entry with Disqualify / Restore, and disqualifying
// or reinstating the whole entrant. Named with "$id_" so it renders as its own page.
// URL: /staff/cardbit-campaigns/campaigns/:id/entrants/:entrantId.

async function findEntrant(request: Request, campaignId?: string, id?: string) {
  const { session } = await authenticate.admin(request);
  const entrant = await db.entrant.findFirst({
    where: { id, campaignId, campaign: { shop: session.shop } },
    include: {
      campaign: { select: { id: true, title: true, timezone: true } },
    },
  });
  if (!entrant) throw new Response("Not found", { status: 404 });
  return { entrant, shop: session.shop };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { entrant } = await findEntrant(request, params.id, params.entrantId);
  const [methods, events, lastDisqualify] = await Promise.all([
    entriesByMethod(entrant.campaignId, { entrantId: entrant.id }),
    db.entryEvent.findMany({
      where: { entrantId: entrant.id },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { orderLog: { select: { orderName: true, breakdown: true } } },
    }),
    db.auditLog.findFirst({
      where: {
        action: "entrant.disqualify",
        target: entrant.campaignId,
        data: { path: ["entrantId"], equals: entrant.id },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const voided = await voidedEvents(
    entrant.campaignId,
    events.map((e) => e.id),
  );
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: entrant.campaign.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  return {
    campaign: entrant.campaign,
    entrant: {
      email: entrant.email,
      name: entrant.name,
      phone: entrant.phone,
      status: entrant.status,
      riskScore: entrant.riskScore,
      createdAt: when.format(entrant.createdAt),
      disqualifiedReason:
        entrant.status === "DISQUALIFIED"
          ? ((lastDisqualify?.data as { reason?: string } | null)?.reason ??
            null)
          : null,
    },
    total: Math.max(
      0,
      methods.rows.reduce((s, r) => s + r.entries, 0),
    ),
    rows: methods.rows.filter((r) => r.times > 0 || r.entries !== 0),
    events: events.map((e) => {
      const placed = e.orderLog ? orderPlacedAt(e.orderLog.breakdown) : null;
      return {
        id: e.id,
        at: when.format(e.createdAt),
        what:
          describeEvent(e, methods.actions) +
          (placed ? ` (placed ${when.format(placed)})` : ""),
        entries: e.entries,
        canVoid: e.entries > 0 && !e.dedupeKey?.startsWith("void:"),
        voided: voided.has(e.id) ? voided.get(e.id) || "no reason given" : null,
        entrant: {
          id: entrant.id,
          email: entrant.email,
          name: entrant.name,
          status: entrant.status,
        },
      };
    }),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { entrant, shop } = await findEntrant(
    request,
    params.id,
    params.entrantId,
  );
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const reason = String(form.get("reason") ?? "")
    .trim()
    .slice(0, 200);
  const audit = (action: string, data: object) =>
    db.auditLog.create({
      data: { shop, action, target: entrant.campaignId, data },
    });
  switch (intent) {
    case "voidEvent":
    case "restoreEvent": {
      const eventId = String(form.get("eventId") ?? "");
      const r =
        intent === "voidEvent"
          ? await voidEvent(entrant.campaignId, eventId, reason)
          : await restoreEvent(entrant.campaignId, eventId);
      if ("ok" in r) await audit(`entry.${intent}`, { eventId });
      return r;
    }
    case "disqualify": {
      await db.entrant.update({
        where: { id: entrant.id },
        data: { status: "DISQUALIFIED" },
      });
      await clawBackReferrals(entrant.id);
      await audit("entrant.disqualify", { entrantId: entrant.id, reason });
      return { ok: true };
    }
    case "addEntries": {
      const r = await addEntries({
        campaignId: entrant.campaignId,
        entrantId: entrant.id,
        entries: form.get("entries"),
        note: String(form.get("note") ?? ""),
      });
      if ("error" in r) return r;
      await audit("entry.add", { entrantId: entrant.id, entries: r.entries });
      return { ok: true };
    }
    case "reinstate": {
      await activate(entrant.id);
      await audit("entrant.approve", { entrantIds: [entrant.id] });
      return { ok: true };
    }
  }
  return { error: "Unknown action." };
};

export default function EntrantEntries() {
  const { campaign, entrant, total, rows, events } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const submit = (data: Record<string, string>) =>
    fetcher.submit(data, { method: "post" });
  const busy = fetcher.state !== "idle";
  const [reason, setReason] = useState("");
  const disqualified = entrant.status === "DISQUALIFIED";
  return (
    <s-page heading={entrant.name || entrant.email} inlineSize="large">
      <s-link slot="breadcrumb-actions" href={`/staff/cardbit-campaigns/campaigns/${campaign.id}`}>
        {campaign.title}
      </s-link>
      {fetcher.data && "error" in fetcher.data && (
        <s-banner tone="critical">{fetcher.data.error}</s-banner>
      )}
      <s-section padding="base">
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
          gap="base"
          alignItems="start"
        >
          <s-stack gap="small-200">
            <s-stack direction="inline" gap="small-200">
              <s-badge tone={statusTone(entrant.status)}>
                {entrant.status === "PENDING_VERIFICATION"
                  ? "unverified"
                  : entrant.status === "HELD"
                    ? "needs review"
                    : entrant.status.toLowerCase()}
              </s-badge>
              <s-badge tone={riskTone(entrant.riskScore, entrant.status)}>
                Risk {entrant.riskScore}
              </s-badge>
            </s-stack>
            <s-text>{entrant.email}</s-text>
            {entrant.phone && <s-text>{entrant.phone}</s-text>}
            <s-text color="subdued">Entered {entrant.createdAt}</s-text>
          </s-stack>
          <s-stack gap="small-200">
            <s-text color="subdued">Total Entries</s-text>
            <s-heading>{total.toLocaleString()}</s-heading>
            {disqualified && (
              <s-text tone="critical">
                Disqualified
                {entrant.disqualifiedReason
                  ? `: ${entrant.disqualifiedReason}`
                  : ""}
                . No entries count.
              </s-text>
            )}
          </s-stack>
          <s-stack gap="small-200">
            {disqualified ? (
              <s-button
                disabled={flag(busy)}
                onClick={() => submit({ intent: "reinstate" })}
              >
                Reinstate Entrant
              </s-button>
            ) : (
              <>
                <TextInput
                  label="Reason (optional)"
                  placeholder="e.g. duplicate account"
                  value={reason}
                  onChange={setReason}
                />
                {entrant.status !== "ACTIVE" && (
                  <s-button
                    variant="primary"
                    disabled={flag(busy)}
                    onClick={() => submit({ intent: "reinstate" })}
                  >
                    Approve Entrant
                  </s-button>
                )}
                <s-button
                  tone="critical"
                  disabled={flag(busy)}
                  onClick={() => submit({ intent: "disqualify", reason })}
                >
                  Disqualify Entrant
                </s-button>
              </>
            )}
          </s-stack>
        </s-grid>
      </s-section>

      {!disqualified && (
        <s-section heading="Add Entries">
          <AddEntriesForm submit={submit} busy={busy} />
        </s-section>
      )}

      <s-section heading="Entries By Method">
        <EntriesByMethodTable rows={rows} showPeople={false} />
      </s-section>

      <s-section heading="Entry History">
        <EntryActivityTable
          items={events}
          campaignId={campaign.id}
          submit={submit}
          busy={busy}
          showEntrant={false}
        />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
