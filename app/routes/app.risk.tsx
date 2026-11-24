import { data, Form, useLoaderData } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isCardbit } from "../lib/cardbit.server";
import { guardMode, type RiskReason } from "../lib/cardbit-guard";
import { reviewQueue, setRiskStatus } from "../lib/cardbit-guard.server";

// Cardbit Security Review: accounts the fraud guard paused, and what it refused this week.
async function staff(request: Request) {
  const ctx = await authenticate.admin(request);
  if (!isCardbit(ctx.session.shop)) throw new Response("Page unavailable", { status: 404 });
  return ctx;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await staff(request);
  const { profiles, events } = await reviewQueue(db, session.shop);
  return data(
    {
      mode: guardMode(),
      profiles: profiles.map((p) => ({
        customerId: p.customerId,
        status: p.status,
        reasons: (Array.isArray(p.reasons) ? p.reasons : []) as RiskReason[],
        accountCreatedAt: p.accountCreatedAt?.toISOString() ?? null,
        reviewedBy: p.reviewedBy,
        reviewedAt: p.reviewedAt?.toISOString() ?? null,
        note: p.note,
      })),
      events: events.map((e) => ({ rule: e.rule, enforced: e.enforced, count: e._count._all })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await staff(request);
  const form = await request.formData();
  const customerId = String(form.get("customerId") ?? "");
  const status = String(form.get("status") ?? "");
  const note = String(form.get("note") ?? "").slice(0, 500);
  if (!/^gid:\/\/shopify\/Customer\/\d+$/.test(customerId) || !["ok", "review", "blocked", "trusted"].includes(status))
    return { ok: false, message: "Choose an account and a status." };
  const staffName =
    (session.onlineAccessInfo?.associated_user?.email as string | undefined) ?? session.onlineAccessInfo?.associated_user?.id?.toString() ?? "staff";
  await setRiskStatus(db, session.shop, customerId, status as "ok", staffName, note || undefined);
  return { ok: true, message: "Saved." };
}

const STATUS_LABEL: Record<string, string> = {
  ok: "Released",
  review: "In Review",
  blocked: "Blocked",
  trusted: "Trusted",
};

export default function SecurityReview() {
  const { mode, profiles, events } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Security Review">
      <s-section heading="Guard Mode">
        <s-paragraph>
          {mode === "on"
            ? "On: the guard refuses requests that break a rule."
            : mode === "log"
              ? "Log only: the guard records what it would refuse but lets every request through."
              : "Off."}{" "}
          Accounts In Review can open packs and browse, but shipping, buybacks, top-ups and free rewards wait for a
          decision here. Trusted accounts skip the new-account holds and limits.
        </s-paragraph>
      </s-section>
      <s-section heading="Last 7 Days">
        {events.length ? (
          <s-unordered-list>
            {events.map((e) => (
              <s-list-item key={e.rule + e.enforced}>
                {e.rule}: {e.count} {e.enforced ? "refused" : "would have been refused"}
              </s-list-item>
            ))}
          </s-unordered-list>
        ) : (
          <s-paragraph>Nothing refused.</s-paragraph>
        )}
      </s-section>
      <s-section heading="Accounts">
        {profiles.length === 0 && <s-paragraph>No accounts need review.</s-paragraph>}
        {profiles.map((p) => (
          <s-box key={p.customerId} padding="base" borderWidth="base" borderRadius="base">
            <s-stack gap="small-200">
              <s-heading>
                <s-link href={`shopify://admin/customers/${p.customerId.split("/").pop()}`} target="_blank">
                  Customer {p.customerId.split("/").pop()}
                </s-link>{" "}
                · {STATUS_LABEL[p.status] ?? p.status}
              </s-heading>
              {p.accountCreatedAt && (
                <s-text color="subdued">Account created {new Date(p.accountCreatedAt).toLocaleString()}</s-text>
              )}
              <s-unordered-list>
                {p.reasons.slice(-5).map((r, i) => (
                  <s-list-item key={i}>
                    {new Date(r.at).toLocaleString()}: {r.code}
                    {r.detail ? ` (${r.detail})` : ""}
                  </s-list-item>
                ))}
              </s-unordered-list>
              {p.reviewedAt && (
                <s-text color="subdued">
                  {STATUS_LABEL[p.status]} by {p.reviewedBy} on {new Date(p.reviewedAt).toLocaleString()}
                  {p.note ? `: ${p.note}` : ""}
                </s-text>
              )}
              <Form method="post">
                <input type="hidden" name="customerId" value={p.customerId} />
                <s-stack direction="inline" gap="small-200">
                  <s-text-field name="note" label="Note" labelAccessibilityVisibility="exclusive" placeholder="Note" />
                  <s-select name="status" label="Decision" labelAccessibilityVisibility="exclusive" value="ok">
                    <s-option value="ok">Release</s-option>
                    <s-option value="trusted">Trust</s-option>
                    <s-option value="review">Keep In Review</s-option>
                    <s-option value="blocked">Block</s-option>
                  </s-select>
                  <s-button type="submit">Save</s-button>
                </s-stack>
              </Form>
            </s-stack>
          </s-box>
        ))}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
