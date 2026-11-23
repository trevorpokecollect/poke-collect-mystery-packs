import { useState } from "react";
import type { ActionType } from "@prisma/client";
import {
  ACTION_META,
  ADDABLE_ACTION_TYPES,
  DAILY_TASK_TYPES,
  newAction,
  type ActionConfigForm,
  type ActionForm,
} from "../lib/campaign-form";
import { DEFAULT_SMS_DISCLOSURE } from "../lib/phone";
import {
  Check,
  NumberInput,
  RowCard,
  Select,
  TextArea,
  TextInput,
  list,
} from "./fields";

export function ActionsEditor(props: {
  actions: ActionForm[];
  onChange: (actions: ActionForm[]) => void;
  archivedCount?: number;
}) {
  const { actions, onChange } = props;
  const available = ADDABLE_ACTION_TYPES.filter(
    (t) => !ACTION_META[t].single || !actions.some((a) => a.type === t),
  );
  const [adding, setAdding] = useState<ActionType>("VISIT_URL");
  const addType = available.includes(adding) ? adding : available[0];

  return (
    <s-section heading="Ways to enter">
      <s-stack gap="base">
        {actions.map((a, i) => (
          <ActionRow
            key={a.key}
            action={a}
            first={i === 0}
            last={i === actions.length - 1}
            onChange={(patch) => onChange(list.set(actions, i, patch))}
            onMove={(by) => onChange(list.move(actions, i, by))}
            onRemove={() => onChange(list.remove(actions, i))}
          />
        ))}
        {addType && (
          <s-stack direction="inline" gap="base" alignItems="end">
            <Select
              label="Add a way to enter"
              value={addType}
              options={available.map((t) => ({
                value: t,
                label: ACTION_META[t].name,
              }))}
              onChange={setAdding}
            />
            <s-button
              icon="plus"
              onClick={() => onChange([...actions, newAction(addType)])}
            >
              Add
            </s-button>
          </s-stack>
        )}
        {!!props.archivedCount && (
          <s-text color="subdued">
            {props.archivedCount} removed{" "}
            {props.archivedCount === 1 ? "action is" : "actions are"} kept
            (archived, 0 entries) because entrants already earned entries from
            them.
          </s-text>
        )}
      </s-stack>
    </s-section>
  );
}

function ActionRow(props: {
  action: ActionForm;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<ActionForm>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const { action: a, onChange } = props;
  const meta = ACTION_META[a.type];
  const setConfig = (patch: Partial<ActionConfigForm>) =>
    onChange({ config: { ...a.config, ...patch } });

  return (
    <RowCard
      heading={meta.name}
      actions={
        <>
          <s-button
            icon="arrow-up"
            accessibilityLabel="Move up"
            variant="tertiary"
            disabled={props.first || undefined}
            onClick={() => props.onMove(-1)}
          />
          <s-button
            icon="arrow-down"
            accessibilityLabel="Move down"
            variant="tertiary"
            disabled={props.last || undefined}
            onClick={() => props.onMove(1)}
          />
          {a.type !== "SIGNUP" && (
            <s-button
              icon="delete"
              tone="critical"
              variant="tertiary"
              accessibilityLabel={a.hasEvents ? "Archive" : "Remove"}
              onClick={props.onRemove}
            />
          )}
        </>
      }
    >
      {meta.help && <s-text color="subdued">{meta.help}</s-text>}
      <s-grid gridTemplateColumns="2fr 1fr" gap="base">
        <TextInput
          label="Label"
          value={a.label}
          onChange={(label) => onChange({ label })}
        />
        <NumberInput
          label={a.type === "REFERRAL" ? "Entries per referral" : "Entries"}
          value={a.entries}
          min={0}
          onChange={(entries) => onChange({ entries })}
        />
      </s-grid>
      <ConfigFields action={a} setConfig={setConfig} />
      {DAILY_TASK_TYPES.includes(a.type) && (
        <DailyTaskFields action={a} setConfig={setConfig} />
      )}
      <s-stack direction="inline" gap="large">
        <Check
          label="Required"
          details={
            a.type === "SIGNUP"
              ? "Everyone signs up first."
              : "Entrants must complete this to enter."
          }
          checked={a.type === "SIGNUP" || a.mandatory}
          disabled={a.type === "SIGNUP"}
          onChange={(mandatory) => onChange({ mandatory })}
        />
        {meta.repeatable && !a.config.daily && (
          <Check
            label="Repeatable daily"
            details="Earn the entries again each day."
            checked={a.repeatable}
            onChange={(repeatable) => onChange({ repeatable })}
          />
        )}
      </s-stack>
      {a.hasEvents && (
        <s-text color="subdued">
          Entrants have earned entries from this. Removing it archives it so
          their entries stay intact.
        </s-text>
      )}
    </RowCard>
  );
}

function ConfigFields({
  action: a,
  setConfig,
}: {
  action: ActionForm;
  setConfig: (patch: Partial<ActionConfigForm>) => void;
}) {
  const c = a.config;
  switch (a.type) {
    case "SOCIAL_FOLLOW":
    case "VISIT_URL":
      return (
        <TextInput
          url
          label={a.type === "SOCIAL_FOLLOW" ? "Profile link" : "Page link"}
          placeholder="https://"
          value={c.url ?? ""}
          onChange={(url) => setConfig({ url })}
        />
      );
    case "WATCH_VIDEO":
      return (
        <s-grid gridTemplateColumns="2fr 1fr" gap="base">
          <TextInput
            url
            label="Video link"
            placeholder="https://www.youtube.com/watch?v=…"
            value={c.url ?? ""}
            onChange={(url) => setConfig({ url })}
          />
          <NumberInput
            label="Seconds to watch"
            value={c.seconds ?? 0}
            min={0}
            details="0 = award on open"
            onChange={(seconds) => setConfig({ seconds })}
          />
        </s-grid>
      );
    case "SOCIAL_SHARE":
      return (
        <Select
          label="Network"
          value={c.network ?? "any"}
          options={[
            { value: "any", label: "Any (system share sheet)" },
            { value: "x", label: "X" },
            { value: "facebook", label: "Facebook" },
          ]}
          onChange={(network) => setConfig({ network })}
        />
      );
    case "SECRET_CODE":
      return (
        <TextInput
          label="Secret code"
          value={c.code ?? ""}
          onChange={(code) => setConfig({ code })}
        />
      );
    case "POLL": {
      const options = c.options ?? ["", ""];
      return (
        <s-stack gap="small-200">
          <TextInput
            label="Question"
            value={c.question ?? ""}
            onChange={(question) => setConfig({ question })}
          />
          {options.map((o, i) => (
            <s-stack
              key={i}
              direction="inline"
              gap="small-200"
              alignItems="end"
            >
              <TextInput
                label={`Option ${i + 1}`}
                value={o}
                onChange={(v) =>
                  setConfig({
                    options: options.map((x, j) => (j === i ? v : x)),
                  })
                }
              />
              {options.length > 2 && (
                <s-button
                  icon="x"
                  variant="tertiary"
                  accessibilityLabel={`Remove option ${i + 1}`}
                  onClick={() =>
                    setConfig({ options: list.remove(options, i) })
                  }
                />
              )}
            </s-stack>
          ))}
          {options.length < 10 && (
            <s-button
              icon="plus"
              variant="tertiary"
              onClick={() => setConfig({ options: [...options, ""] })}
            >
              Add option
            </s-button>
          )}
        </s-stack>
      );
    }
    case "QUESTION":
      return (
        <s-grid gridTemplateColumns="2fr 1fr" gap="base">
          <TextInput
            label="Question"
            value={c.question ?? ""}
            onChange={(question) => setConfig({ question })}
          />
          <TextInput
            label="Correct answer (optional)"
            details="Set to make it a quiz. Not case-sensitive."
            value={c.answer ?? ""}
            onChange={(answer) => setConfig({ answer })}
          />
        </s-grid>
      );
    case "ALTERNATE_ENTRY":
      return (
        <TextArea
          label="How to enter for free"
          rows={2}
          details="Quoted in the official rules, e.g. a mail-in address or a free form."
          value={c.instructions ?? ""}
          onChange={(instructions) => setConfig({ instructions })}
        />
      );
    case "SMS_OPTIN":
      return (
        <TextArea
          label="Consent wording"
          rows={3}
          details="Shown next to the unchecked opt-in box, with links to your terms and privacy policy. Leave blank to use the standard wording."
          placeholder={DEFAULT_SMS_DISCLOSURE}
          value={c.disclosure ?? ""}
          onChange={(disclosure) => setConfig({ disclosure })}
        />
      );
    default:
      return null;
  }
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Daily Tasks: shown in their own section once the follow tasks are done, claimable once per
// day. Optional extras: rotating links, a "tap after you do it" button, a weekly window.
function DailyTaskFields({
  action: a,
  setConfig,
}: {
  action: ActionForm;
  setConfig: (patch: Partial<ActionConfigForm>) => void;
}) {
  const c = a.config;
  const schedule = c.schedule;
  const hasUrl = a.type === "VISIT_URL";
  return (
    <s-stack gap="small-200">
      <Check
        label="Daily Task"
        details="Shows under Daily Tasks, unlocks after all the follow tasks are done, and can be claimed once per day."
        checked={!!c.daily}
        onChange={(daily) => setConfig({ daily })}
      />
      {c.daily && hasUrl && (
        <>
          <TextArea
            label="More links to rotate (optional)"
            rows={2}
            details="One link per line. Each day shows the next link in turn, starting with the page link above. Use it to feature a different Instagram post every day."
            value={(c.urls ?? []).join("\n")}
            onChange={(v) => setConfig({ urls: v.split(/\s*\n\s*/) })}
          />
          <Check
            label="Always open our newest Instagram post"
            details="Checks the Cardbit Instagram every 10 minutes and opens the newest post, so a new daily post is picked up automatically. Needs INSTAGRAM_ACCESS_TOKEN set in Railway; until then (or if Instagram is down) it opens the page link above."
            checked={!!c.latestInstagram}
            onChange={(latestInstagram) => setConfig({ latestInstagram })}
          />
          <Check
            label="Only count approved buylists"
            details="Entries are given only when the buylist app has a buylist from the entrant's email that staff approved since the task last reset. Needs BUYLIST_VERIFY_URL and BUYLIST_VERIFY_SECRET in Railway; until then claims are refused."
            checked={!!c.verifyBuylist}
            onChange={(verifyBuylist) => setConfig({ verifyBuylist })}
          />
          <Check
            label="Only count real Vault Market listings"
            details="Entries are given only when Vault Market (Mystery Packs app) has a card listed by the entrant (matched by email or store account) since the task last reset. Needs MARKET_VERIFY_URL and MARKET_VERIFY_SECRET in Railway; until then claims are refused."
            checked={!!c.verifyMarketListing}
            onChange={(verifyMarketListing) =>
              setConfig({ verifyMarketListing })
            }
          />
          <TextInput
            label="Claim button (optional)"
            details={
              'Set this (e.g. "I Liked & Commented") for tasks done off the site: the button opens the link first, then claims after a few seconds. This is on the honor system, not verified.'
            }
            value={c.confirm ?? ""}
            onChange={(confirm) => setConfig({ confirm })}
          />
        </>
      )}
      {c.daily && (
        <Check
          label="Only at set times"
          details="Shown and claimable only in a weekly window, in Central Time (e.g. Fridays 5–8pm while the Whatnot show is live). Once per window."
          checked={!!schedule}
          onChange={(on) =>
            setConfig({
              schedule: on
                ? { days: [5], start: "17:00", end: "20:00" }
                : undefined,
              live: on ? c.live : undefined,
              paused: on ? c.paused : undefined,
            })
          }
        />
      )}
      {c.daily && schedule && (
        <>
          <s-stack direction="inline" gap="base">
            {DAYS.map((d, i) => (
              <Check
                key={d}
                label={d}
                checked={schedule.days.includes(i)}
                onChange={(on) =>
                  setConfig({
                    schedule: {
                      ...schedule,
                      days: on
                        ? [...schedule.days, i].sort()
                        : schedule.days.filter((x) => x !== i),
                    },
                  })
                }
              />
            ))}
          </s-stack>
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <TextInput
              label="Starts (Central, 24h)"
              placeholder="17:00"
              value={schedule.start}
              onChange={(start) =>
                setConfig({ schedule: { ...schedule, start } })
              }
            />
            <TextInput
              label="Ends (Central, 24h)"
              placeholder="20:00"
              value={schedule.end}
              onChange={(end) => setConfig({ schedule: { ...schedule, end } })}
            />
          </s-grid>
          <Check
            label="Show as a live show button"
            details="Red 🔴 LIVE ON WHATNOT — JOIN NOW button while it's open. Whatnot can't tell us if the show is really live, so turn the task off below if a show is canceled."
            checked={!!c.live}
            onChange={(live) => setConfig({ live })}
          />
          <Check
            label="Turned off (show canceled or ended early)"
            details="Hides the task and stops claims until you untick this and save."
            checked={!!c.paused}
            onChange={(paused) => setConfig({ paused })}
          />
        </>
      )}
    </s-stack>
  );
}
