import { useState } from "react";
import { useFetcher, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

// The daily draw on the giveaway page: today's prize and the recent daily prizes,
// with controls to pick or swap the prize, draw early, release it or mark it sent.

export interface DailyPrizeRow {
  id: string;
  periodKey: string;
  title: string;
  imageUrl: string | null;
  value: number;
  status: "RESERVED" | "DRAWN" | "SENT" | "RELEASED";
  drawAt: string;
  winner: string | null;
  note: string | null;
  fromSafetyStock: boolean;
}

export interface QueueRow {
  id: string;
  title: string;
  imageUrl: string | null;
  pinnedDate: string | null;
  note: string | null;
  /** The draw date it's planned for, within the next 7 days. */
  plannedFor: string | null;
  /** Several products, or several of one, as one prize. */
  bundle: boolean;
  /** A bundle's product pictures. */
  images: string[];
}

interface BundleDraftPart {
  productId: string;
  title: string;
  imageUrl: string | null;
  quantity: number;
}

export interface DailyData {
  drawTime: string;
  timezone: string;
  currentId: string | null;
  prizes: DailyPrizeRow[];
  queue: QueueRow[];
}

const STATUS: Record<
  DailyPrizeRow["status"],
  { label: string; tone: "info" | "success" | "neutral" | "warning" }
> = {
  RESERVED: { label: "Reserved", tone: "info" },
  DRAWN: { label: "Won, to send", tone: "warning" },
  SENT: { label: "Sent", tone: "success" },
  RELEASED: { label: "Back in stock", tone: "neutral" },
};

const money = (n: number) => `$${n.toFixed(2)}`;

export function DailySection({ daily }: { daily: DailyData }) {
  const shopify = useAppBridge();
  const fetcher = useFetcher<{
    ok?: boolean;
    error?: string;
    message?: string;
  }>();
  const busy = fetcher.state !== "idle";
  // Set when the prize chosen on the new giveaway form couldn't be reserved.
  const [params] = useSearchParams();
  const createError = fetcher.data ? null : params.get("prizeError");
  const submit = (data: Record<string, string>) =>
    fetcher.submit(data, { method: "post" });
  const current = daily.prizes.find((p) => p.id === daily.currentId) ?? null;
  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: daily.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));

  return (
    <s-section heading="Daily draw">
      <s-stack gap="base">
        {createError && (
          <s-banner tone="critical">
            Today&apos;s prize wasn&apos;t set: {createError}
          </s-banner>
        )}
        {fetcher.data?.error && (
          <s-banner tone="critical">{fetcher.data.error}</s-banner>
        )}
        {fetcher.data?.message && (
          <s-banner tone="success">{fetcher.data.message}</s-banner>
        )}
        {current ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              {current.imageUrl && (
                <s-thumbnail
                  src={current.imageUrl}
                  alt={current.title}
                  size="large"
                />
              )}
              <s-stack gap="small-200">
                <s-text color="subdued">Today&apos;s prize</s-text>
                <s-heading>{current.title}</s-heading>
                <s-text>
                  {money(current.value)} · drawn {when(current.drawAt)}
                </s-text>
                <s-stack direction="inline" gap="small-200">
                  <s-badge tone={STATUS[current.status].tone}>
                    {STATUS[current.status].label}
                  </s-badge>
                  {current.fromSafetyStock && (
                    <s-badge>From Safety Stock</s-badge>
                  )}
                  {current.winner && <s-text>Winner: {current.winner}</s-text>}
                </s-stack>
              </s-stack>
            </s-stack>
          </s-box>
        ) : (
          <s-paragraph>
            No prize picked for today yet. The app picks one automatically
            within a minute of the giveaway going live, or pick one now.
          </s-paragraph>
        )}
        <s-stack direction="inline" gap="base">
          {(!current || current.status === "RESERVED") && (
            <s-button
              disabled={busy}
              onClick={async () => {
                // Any product, outside the price range too; 1 unit is reserved as usual,
                // and the automatic pick takes over from the next day.
                const selected = await shopify.resourcePicker({
                  type: "product",
                  action: "select",
                  multiple: false,
                });
                const id = selected?.[0]?.id;
                if (id) submit({ intent: "dailyChoose", productId: id });
              }}
            >
              Choose product
            </s-button>
          )}
          {!current && (
            <s-button
              disabled={busy}
              onClick={() => submit({ intent: "dailyPick" })}
            >
              Pick today&apos;s prize
            </s-button>
          )}
          {current?.status === "RESERVED" && (
            <>
              <s-button
                disabled={busy}
                onClick={() => submit({ intent: "dailySwap" })}
              >
                Swap for another product
              </s-button>
              <s-button
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Draw today's winner now from the entries so far?",
                    )
                  )
                    submit({ intent: "dailyDrawNow" });
                }}
              >
                Draw now
              </s-button>
            </>
          )}
        </s-stack>
        <s-text color="subdued">
          Drawn every day at {daily.drawTime} ({daily.timezone}) from the
          entries earned since the previous draw.
        </s-text>

        <UpcomingPrizes
          queue={daily.queue}
          busy={busy}
          submit={submit}
          pickProducts={async () => {
            const selected = await shopify.resourcePicker({
              type: "product",
              action: "select",
              multiple: true,
            });
            if (!selected?.length) return;
            submit({
              intent: "dailyQueueAdd",
              products: JSON.stringify(
                selected.map((p) => ({
                  productId: p.id,
                  title: p.title,
                  imageUrl: p.images?.[0]?.originalSrc ?? null,
                })),
              ),
            });
          }}
          pickBundle={async () => {
            const selected = await shopify.resourcePicker({
              type: "product",
              action: "select",
              multiple: 6,
            });
            if (!selected?.length) return null;
            return selected.map((p) => ({
              productId: p.id,
              title: p.title,
              imageUrl: p.images?.[0]?.originalSrc ?? null,
              // One product: default to 3 of it; several: 1 of each.
              quantity: selected.length === 1 ? 3 : 1,
            }));
          }}
        />

        {daily.prizes.length > 0 && (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Prize</s-table-header>
              <s-table-header>Day</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header>Winner</s-table-header>
              <s-table-header />
            </s-table-header-row>
            <s-table-body>
              {daily.prizes.map((p) => (
                <s-table-row key={p.id}>
                  <s-table-cell>
                    {p.title} ({money(p.value)})
                  </s-table-cell>
                  <s-table-cell>{p.periodKey}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS[p.status].tone}>
                      {STATUS[p.status].label}
                    </s-badge>
                    {p.note && p.status === "RELEASED" && (
                      <s-text color="subdued"> {p.note}</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>{p.winner ?? "—"}</s-table-cell>
                  <s-table-cell>
                    {p.status === "DRAWN" && (
                      <s-stack direction="inline" gap="small-200">
                        <s-button
                          variant="tertiary"
                          disabled={busy}
                          onClick={() =>
                            submit({ intent: "dailySent", prizeId: p.id })
                          }
                        >
                          Mark sent
                        </s-button>
                        <s-button
                          variant="tertiary"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Put this prize back in stock? The winner keeps their win on record.",
                              )
                            )
                              submit({ intent: "dailyRelease", prizeId: p.id });
                          }}
                        >
                          Release
                        </s-button>
                      </s-stack>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-stack>
    </s-section>
  );
}

const dayLabel = (ymd: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${ymd}T12:00:00Z`));

/** The merchant's lineup of upcoming prizes, used ahead of the automatic pick. */
function UpcomingPrizes(props: {
  queue: QueueRow[];
  busy: boolean;
  submit: (data: Record<string, string>) => void;
  pickProducts: () => void;
  pickBundle: () => Promise<BundleDraftPart[] | null>;
}) {
  const { queue, busy, submit } = props;
  const [draft, setDraft] = useState<BundleDraftPart[] | null>(null);
  const total = draft?.reduce((n, p) => n + p.quantity, 0) ?? 0;
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack gap="base">
        <s-stack
          direction="inline"
          gap="base"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-heading>Upcoming Prizes</s-heading>
          <s-stack direction="inline" gap="small-200">
            <s-button disabled={busy} onClick={props.pickProducts}>
              Add Products
            </s-button>
            <s-button
              disabled={busy}
              onClick={async () => setDraft(await props.pickBundle())}
            >
              Add Bundle
            </s-button>
          </s-stack>
        </s-stack>
        {draft && (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack gap="small-200">
              <s-heading>New Bundle</s-heading>
              <s-text color="subdued">
                One day&apos;s prize made of these products. Set how many of
                each (pick one product and set 3 for &quot;3x&quot;). Every unit
                is reserved together, so the bundle is skipped on a day any
                product is short.
              </s-text>
              {draft.map((p, i) => (
                <s-stack
                  key={p.productId}
                  direction="inline"
                  gap="small-200"
                  alignItems="center"
                >
                  {p.imageUrl && (
                    <s-thumbnail src={p.imageUrl} alt={p.title} size="small" />
                  )}
                  <s-text>{p.title}</s-text>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    aria-label={`How many ${p.title}`}
                    value={p.quantity}
                    style={{ width: 64 }}
                    onChange={(e) => {
                      const quantity = Math.min(
                        10,
                        Math.max(
                          1,
                          Math.floor(Number(e.currentTarget.value)) || 1,
                        ),
                      );
                      setDraft(
                        draft.map((x, j) => (j === i ? { ...x, quantity } : x)),
                      );
                    }}
                  />
                  <s-button
                    variant="tertiary"
                    tone="critical"
                    onClick={() =>
                      setDraft(
                        draft.length > 1
                          ? draft.filter((_, j) => j !== i)
                          : null,
                      )
                    }
                  >
                    Remove
                  </s-button>
                </s-stack>
              ))}
              {total < 2 && (
                <s-text tone="critical">
                  A bundle needs 2 or more items in all.
                </s-text>
              )}
              <s-stack direction="inline" gap="small-200">
                <s-button
                  variant="primary"
                  disabled={busy || total < 2}
                  onClick={() => {
                    submit({
                      intent: "dailyQueueBundle",
                      parts: JSON.stringify(draft),
                    });
                    setDraft(null);
                  }}
                >
                  Add Bundle To Upcoming Prizes
                </s-button>
                <s-button variant="tertiary" onClick={() => setDraft(null)}>
                  Cancel
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        )}
        <s-text color="subdued">
          Each night the next product here that&apos;s in stock becomes the next
          day&apos;s prize (or the one pinned to that day). When the list is
          empty, the app picks automatically from your daily rules. The next few
          also show on the giveaway as &quot;Upcoming Prizes&quot;.
        </s-text>
        {queue.length > 0 && queue.length <= 2 && (
          <s-banner tone="warning">
            Only {queue.length} upcoming{" "}
            {queue.length === 1 ? "prize" : "prizes"} left. Add more, or the app
            goes back to picking automatically.
          </s-banner>
        )}
        {queue.length === 0 ? (
          <s-paragraph>
            Nothing lined up. Prizes are picked automatically.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header>Planned For</s-table-header>
              <s-table-header>Pin To Date</s-table-header>
              <s-table-header />
            </s-table-header-row>
            <s-table-body>
              {queue.map((q, i) => (
                <s-table-row key={q.id}>
                  <s-table-cell>
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                    >
                      {(q.images.length
                        ? q.images
                        : q.imageUrl
                          ? [q.imageUrl]
                          : []
                      ).map((src, n) => (
                        <s-thumbnail
                          key={n}
                          src={src}
                          alt={q.title}
                          size="small"
                        />
                      ))}
                      <s-stack gap="none">
                        <s-text>{q.title}</s-text>
                        {q.bundle && <s-badge tone="info">Bundle</s-badge>}
                        {q.note && <s-text tone="critical">{q.note}</s-text>}
                      </s-stack>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {q.plannedFor ? dayLabel(q.plannedFor) : "Later"}
                  </s-table-cell>
                  <s-table-cell>
                    <input
                      type="date"
                      aria-label={`Pin ${q.title} to a date`}
                      defaultValue={q.pinnedDate ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        submit({
                          intent: "dailyQueuePin",
                          itemId: q.id,
                          date: e.currentTarget.value,
                        })
                      }
                    />
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200">
                      <s-button
                        variant="tertiary"
                        disabled={busy || i === 0}
                        accessibilityLabel="Move up"
                        onClick={() =>
                          submit({
                            intent: "dailyQueueMove",
                            itemId: q.id,
                            dir: "up",
                          })
                        }
                      >
                        ↑
                      </s-button>
                      <s-button
                        variant="tertiary"
                        disabled={busy || i === queue.length - 1}
                        accessibilityLabel="Move down"
                        onClick={() =>
                          submit({
                            intent: "dailyQueueMove",
                            itemId: q.id,
                            dir: "down",
                          })
                        }
                      >
                        ↓
                      </s-button>
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        disabled={busy}
                        onClick={() =>
                          submit({ intent: "dailyQueueRemove", itemId: q.id })
                        }
                      >
                        Remove
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-stack>
    </s-box>
  );
}
