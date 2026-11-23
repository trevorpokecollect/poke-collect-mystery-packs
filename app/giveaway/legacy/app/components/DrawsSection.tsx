import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { ClaimState } from "../lib/winners";

// "Draw winners" section of the campaign page: the draw form, per-draw winner
// lists with claim status, winner emails, forfeit + redraw, thank-you codes,
// Klaviyo sync and the animated winner reveal.

export interface DrawWinner {
  id: string;
  position: number;
  email: string;
  name: string | null;
  notifiedAt: string | null;
  claimedAt: string | null;
  forfeited: boolean;
  claimData: Record<string, string> | null;
  /** Daily prizes only: the $0 Shopify order made when the winner claimed. */
  prizeOrder: { name: string | null; id: string | null } | null;
  state: ClaimState;
  deadline: string | null;
}

export interface DrawRow {
  id: string;
  createdAt: string;
  seed: string;
  totalEntries: number;
  eligibleCount: number;
  winners: DrawWinner[];
}

export interface DrawExtras {
  winnerEmailEnabled: boolean;
  consolation: { pending: number; sent: number; percentOff: number } | null;
  klaviyo: { synced: number } | null;
  revealNames: string[];
}

type Result = {
  ok?: boolean;
  error?: string;
  message?: string;
  drawId?: string;
};

const STATE_BADGE: Record<
  ClaimState,
  {
    label: string;
    tone: "neutral" | "info" | "success" | "warning" | "critical";
  }
> = {
  not_sent: { label: "not emailed", tone: "neutral" },
  open: { label: "awaiting claim", tone: "info" },
  expired: { label: "claim expired", tone: "warning" },
  claimed: { label: "claimed", tone: "success" },
  forfeited: { label: "forfeited", tone: "critical" },
};

const label = (w: { name: string | null; email: string }) =>
  w.name ? `${w.name} (${w.email})` : w.email;

export function DrawsSection({
  draws,
  extras,
}: {
  draws: DrawRow[];
  extras: DrawExtras;
}) {
  const fetcher = useFetcher<Result>();
  const busy = fetcher.state !== "idle";
  const submit = (data: Record<string, string>) =>
    fetcher.submit(data, { method: "post" });
  const [reveal, setReveal] = useState<DrawRow | null>(null);

  // A new draw (or a redraw) comes back with its id: reveal it once the loader has it.
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    const id = fetcher.state === "idle" ? fetcher.data?.drawId : undefined;
    const draw =
      id && id !== revealed.current && draws.find((d) => d.id === id);
    if (draw) {
      revealed.current = draw.id;
      setReveal(draw);
    }
  }, [fetcher.state, fetcher.data, draws]);

  return (
    <s-section heading="Draw winners">
      <s-stack gap="base">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="draw" />
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-number-field
              name="count"
              label="Number of winners"
              value="1"
              min={1}
              max={50}
            />
            <s-button
              type="submit"
              variant="primary"
              {...(busy ? { loading: true } : {})}
            >
              Draw
            </s-button>
          </s-stack>
        </fetcher.Form>
        <s-paragraph>
          Only verified entrants who are not held or disqualified can win. Each
          draw records its random seed so the result can be re-checked later.
        </s-paragraph>

        {fetcher.data?.error && (
          <s-banner tone="critical">{fetcher.data.error}</s-banner>
        )}
        {fetcher.data?.message && !fetcher.data.error && (
          <s-banner tone="success">{fetcher.data.message}</s-banner>
        )}

        {draws.length > 0 && (extras.consolation || extras.klaviyo) && (
          <s-stack direction="inline" gap="base" alignItems="center">
            {extras.consolation && (
              <s-button
                disabled={extras.consolation.pending === 0 || busy}
                onClick={() => submit({ intent: "consolation" })}
              >
                {extras.consolation.pending > 0
                  ? `Send ${extras.consolation.percentOff}% thank-you codes (${extras.consolation.pending})`
                  : `Thank-you codes sent (${extras.consolation.sent})`}
              </s-button>
            )}
            {extras.klaviyo && (
              <s-button
                disabled={busy}
                onClick={() => submit({ intent: "klaviyoSync" })}
              >
                Sync all to Klaviyo ({extras.klaviyo.synced} synced)
              </s-button>
            )}
          </s-stack>
        )}
        {draws.length === 0 && extras.klaviyo && (
          <s-button
            disabled={busy}
            onClick={() => submit({ intent: "klaviyoSync" })}
          >
            Sync all to Klaviyo ({extras.klaviyo.synced} synced)
          </s-button>
        )}

        {draws.map((d) => (
          <s-box
            key={d.id}
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-stack gap="base">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-text type="strong">
                  {new Date(d.createdAt).toLocaleString()}
                </s-text>
                <s-button variant="tertiary" onClick={() => setReveal(d)}>
                  Reveal
                </s-button>
                {extras.winnerEmailEnabled &&
                  d.winners.some((w) => !w.forfeited && !w.notifiedAt) && (
                    <s-button
                      disabled={busy}
                      onClick={() =>
                        submit({ intent: "emailDraw", drawId: d.id })
                      }
                    >
                      Email all winners
                    </s-button>
                  )}
              </s-stack>
              {d.winners.map((w) => (
                <WinnerRow
                  key={w.id}
                  winner={w}
                  emailEnabled={extras.winnerEmailEnabled}
                  busy={busy}
                  submit={submit}
                />
              ))}
              <s-text color="subdued">
                {d.eligibleCount} eligible entrants, {d.totalEntries} entries.
                Seed {d.seed.slice(0, 12)}…
              </s-text>
            </s-stack>
          </s-box>
        ))}
      </s-stack>
      <WinnerReveal
        draw={reveal}
        names={extras.revealNames}
        onClose={() => setReveal(null)}
      />
    </s-section>
  );
}

function WinnerRow({
  winner: w,
  emailEnabled,
  busy,
  submit,
}: {
  winner: DrawWinner;
  emailEnabled: boolean;
  busy: boolean;
  submit: (data: Record<string, string>) => void;
}) {
  const badge = STATE_BADGE[w.state];
  const open = !w.forfeited && !w.claimedAt;
  // Redo Order asks on the page (not a browser pop-up) so it works everywhere.
  const [confirmRedo, setConfirmRedo] = useState(false);
  const c = w.claimData;
  return (
    <s-stack gap="small-200">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-text>
          #{w.position}: {label(w)}
        </s-text>
        <s-badge tone={badge.tone}>{badge.label}</s-badge>
        {w.state === "open" && w.deadline && (
          <s-text color="subdued">
            until {new Date(w.deadline).toLocaleDateString()}
          </s-text>
        )}
      </s-stack>
      {c && (
        <s-text color="subdued">
          Ship to {c.name}, {c.address1}
          {c.address2 ? `, ${c.address2}` : ""}, {c.city}
          {c.province ? `, ${c.province}` : ""} {c.zip}, {c.country}. Phone{" "}
          {c.phone}
        </s-text>
      )}
      {w.prizeOrder && w.claimedAt && !w.forfeited && (
        <s-stack direction="inline" gap="small-200" alignItems="center">
          {w.prizeOrder.name ? (
            <>
              <s-link href={`shopify://admin/orders/${w.prizeOrder.id}`}>
                Order {w.prizeOrder.name}
              </s-link>
              {confirmRedo ? (
                <>
                  <s-text>
                    Cancel {w.prizeOrder.name} and make a new $0 order? Only if
                    it hasn&apos;t shipped.
                  </s-text>
                  <s-button
                    tone="critical"
                    disabled={busy}
                    onClick={() => {
                      setConfirmRedo(false);
                      submit({ intent: "redoPrizeOrder", winnerId: w.id });
                    }}
                  >
                    Yes, Redo Order
                  </s-button>
                  <s-button
                    variant="tertiary"
                    onClick={() => setConfirmRedo(false)}
                  >
                    Keep It
                  </s-button>
                </>
              ) : (
                <s-button
                  variant="tertiary"
                  disabled={busy}
                  onClick={() => setConfirmRedo(true)}
                >
                  Redo Order
                </s-button>
              )}
            </>
          ) : (
            <>
              <s-text color="subdued">No Shopify order yet.</s-text>
              <s-button
                disabled={busy}
                onClick={() => submit({ intent: "prizeOrder", winnerId: w.id })}
              >
                Create Order
              </s-button>
            </>
          )}
        </s-stack>
      )}
      {open && (
        <s-stack direction="inline" gap="small-200">
          {emailEnabled && (
            <s-button
              disabled={busy}
              onClick={() => submit({ intent: "emailWinner", winnerId: w.id })}
            >
              {w.notifiedAt ? "Resend email" : "Email winner"}
            </s-button>
          )}
          <s-button
            tone="critical"
            variant={w.state === "expired" ? "primary" : "secondary"}
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  `Forfeit ${label(w)} and draw one replacement? This can't be undone.`,
                )
              )
                submit({ intent: "forfeitRedraw", winnerId: w.id });
            }}
          >
            Forfeit and redraw
          </s-button>
        </s-stack>
      )}
    </s-stack>
  );
}

function WinnerReveal({
  draw,
  names,
  onClose,
}: {
  draw: DrawRow | null;
  names: string[];
  onClose: () => void;
}) {
  const modal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  useEffect(() => {
    if (draw) modal.current?.showOverlay();
  }, [draw]);

  return (
    <s-modal
      id="winner-reveal"
      ref={modal}
      heading="And the winner is…"
      onHide={onClose}
    >
      {draw && <Spinner key={draw.id} draw={draw} names={names} />}
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => modal.current?.hideOverlay()}
      >
        Close
      </s-button>
    </s-modal>
  );
}

const TICKS = 24;
const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const display = (w: DrawWinner) => w.name || w.email;

/**
 * Cycles entrant names, slowing down, and lands on each winner in turn.
 * With prefers-reduced-motion the winners are shown straight away.
 */
function Spinner({ draw, names }: { draw: DrawRow; names: string[] }) {
  const winners = draw.winners.filter((w) => !w.forfeited);
  const instant = reducedMotion() || winners.length === 0;
  const [shown, setShown] = useState(
    instant && winners[0] ? display(winners[0]) : "…",
  );
  const [landed, setLanded] = useState<DrawWinner[]>(instant ? winners : []);

  useEffect(() => {
    if (instant) return;
    const pool = names.length > 1 ? names : winners.map(display);
    let timer: ReturnType<typeof setTimeout>;
    const spin = (index: number, step: number) => {
      const w = winners[index];
      if (step < TICKS) {
        setShown(pool[Math.floor(Math.random() * pool.length)]);
        // Eases from 50ms to ~400ms between names.
        timer = setTimeout(() => spin(index, step + 1), 50 + step * step * 0.6);
        return;
      }
      setShown(display(w));
      setLanded((l) => [...l, w]);
      if (index + 1 < winners.length)
        timer = setTimeout(() => spin(index + 1, 0), 1400);
    };
    timer = setTimeout(() => spin(0, 0), 300);
    return () => clearTimeout(timer);
    // Mounted once per draw (keyed by draw id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = landed.length === winners.length;
  return (
    <s-stack gap="base" alignItems="center">
      <s-box padding="large">
        <s-heading>
          <span aria-live={done ? "polite" : "off"}>{shown}</span>
        </s-heading>
      </s-box>
      {landed.length > 0 && (
        <s-stack gap="small-200">
          {landed.map((w) => (
            <s-text key={w.id}>
              #{w.position}: {label(w)}
            </s-text>
          ))}
        </s-stack>
      )}
    </s-stack>
  );
}
