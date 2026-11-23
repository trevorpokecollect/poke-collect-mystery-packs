import { useState } from "react";
import { publicName } from "../lib/names";
import { flag, TextInput } from "./fields";

export interface ActivityItem {
  id: string;
  at: string;
  entrant?: { id: string; email: string; name: string | null; status: string };
  what: string;
  entries: number;
  canVoid: boolean;
  voided: string | null;
}

function statusBadge(i: ActivityItem) {
  if (i.voided !== null)
    return (
      <s-badge tone="critical">
        {i.voided === "no reason given"
          ? "Disqualified"
          : `Disqualified: ${i.voided}`}
      </s-badge>
    );
  if (i.entrant?.status === "DISQUALIFIED")
    return <s-badge tone="critical">Entrant Disqualified</s-badge>;
  if (i.entrant && i.entrant.status !== "ACTIVE")
    return <s-badge tone="warning">Pending</s-badge>;
  return null;
}

/**
 * Every entry, newest first: who, how, how many and when, with Disqualify / Restore for a single
 * entry. `submit` posts { intent, eventId, reason } to the page's action. `compact` drops the
 * buttons and reason box (for the overview).
 */
export function EntryActivityTable(props: {
  items: ActivityItem[];
  campaignId: string;
  submit: (data: Record<string, string>) => void;
  busy?: boolean;
  /** Off on an entrant's own page. */
  showEntrant?: boolean;
  compact?: boolean;
}) {
  const [reason, setReason] = useState("");
  if (props.items.length === 0)
    return <s-paragraph>No entries yet.</s-paragraph>;
  const showEntrant = props.showEntrant ?? true;
  const actions = !props.compact;
  return (
    <s-stack gap="base">
      {actions && (
        <s-box maxInlineSize="420px">
          <TextInput
            label="Reason when disqualifying (optional)"
            placeholder="e.g. duplicate account, fake follow"
            value={reason}
            onChange={setReason}
          />
        </s-box>
      )}
      <s-table>
        <s-table-header-row>
          {showEntrant && (
            <s-table-header listSlot="primary">Entrant</s-table-header>
          )}
          <s-table-header listSlot={showEntrant ? "secondary" : "primary"}>
            How
          </s-table-header>
          <s-table-header format="numeric">Entries</s-table-header>
          <s-table-header>When</s-table-header>
          {actions && <s-table-header />}
        </s-table-header-row>
        <s-table-body>
          {props.items.map((i) => (
            <s-table-row key={i.id}>
              {showEntrant && (
                <s-table-cell>
                  {i.entrant ? (
                    <s-stack gap="none">
                      <s-link
                        href={`/staff/cardbit-campaigns/campaigns/${props.campaignId}/entrants/${i.entrant.id}`}
                      >
                        {publicName(i.entrant.name, i.entrant.email)}
                      </s-link>
                      <s-text color="subdued">{i.entrant.email}</s-text>
                    </s-stack>
                  ) : (
                    "—"
                  )}
                </s-table-cell>
              )}
              <s-table-cell>
                <s-stack gap="small-200" direction="inline" alignItems="center">
                  <s-text>{i.what}</s-text>
                  {statusBadge(i)}
                </s-stack>
              </s-table-cell>
              <s-table-cell>
                {i.entries > 0
                  ? `+${i.entries.toLocaleString()}`
                  : i.entries.toLocaleString()}
              </s-table-cell>
              <s-table-cell>
                <s-text color="subdued">{i.at}</s-text>
              </s-table-cell>
              {actions && (
                <s-table-cell>
                  {i.voided !== null ? (
                    <s-button
                      variant="tertiary"
                      disabled={flag(props.busy)}
                      onClick={() =>
                        props.submit({ intent: "restoreEvent", eventId: i.id })
                      }
                    >
                      Restore
                    </s-button>
                  ) : i.canVoid ? (
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      disabled={flag(props.busy)}
                      onClick={() =>
                        props.submit({
                          intent: "voidEvent",
                          eventId: i.id,
                          reason,
                        })
                      }
                    >
                      Disqualify
                    </s-button>
                  ) : null}
                </s-table-cell>
              )}
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
    </s-stack>
  );
}
