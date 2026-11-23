import { useState, type ReactNode } from "react";

// Small controlled wrappers around Polaris fields. React 18 only delivers
// `input` events from custom elements reliably, so each wrapper listens to
// both input and change. Boolean props are omitted rather than passed as
// false, since React 18 writes false as the attribute string "false".

export const flag = (b: boolean | undefined) => (b ? true : undefined);

export function TextInput(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  details?: string;
  placeholder?: string;
  required?: boolean;
  url?: boolean;
}) {
  const handle = (e: Event) =>
    props.onChange((e.currentTarget as HTMLInputElement).value);
  const common = {
    label: props.label,
    value: props.value,
    details: props.details,
    placeholder: props.placeholder,
    required: flag(props.required),
    onInput: handle,
    onChange: handle,
  };
  return props.url ? <s-url-field {...common} /> : <s-text-field {...common} />;
}

export function TextArea(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  details?: string;
  placeholder?: string;
}) {
  const handle = (e: Event) =>
    props.onChange((e.currentTarget as HTMLTextAreaElement).value);
  return (
    <s-text-area
      label={props.label}
      value={props.value}
      rows={props.rows ?? 3}
      details={props.details}
      placeholder={props.placeholder}
      onInput={handle}
      onChange={handle}
    />
  );
}

/** Number field that lets the merchant clear it while typing. */
export function NumberInput(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  details?: string;
  prefix?: string;
  suffix?: string;
}) {
  const [text, setText] = useState(String(props.value));
  const [seen, setSeen] = useState(props.value);
  if (seen !== props.value) {
    setSeen(props.value);
    if (Number(text) !== props.value) setText(String(props.value));
  }
  const handle = (e: Event) => {
    const t = (e.currentTarget as HTMLInputElement).value;
    setText(t);
    const n = Number(t);
    if (t.trim() !== "" && Number.isFinite(n)) props.onChange(n);
  };
  return (
    <s-number-field
      label={props.label}
      value={text}
      min={props.min}
      max={props.max}
      step={props.step}
      details={props.details}
      prefix={props.prefix}
      suffix={props.suffix}
      onInput={handle}
      onChange={handle}
    />
  );
}

export function Check(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  details?: string;
  disabled?: boolean;
}) {
  const handle = (e: Event) =>
    props.onChange((e.currentTarget as HTMLInputElement).checked);
  return (
    <s-checkbox
      label={props.label}
      details={props.details}
      checked={flag(props.checked)}
      disabled={flag(props.disabled)}
      onInput={handle}
      onChange={handle}
    />
  );
}

export function Select<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  details?: string;
}) {
  const handle = (e: Event) =>
    props.onChange((e.currentTarget as HTMLSelectElement).value as T);
  return (
    <s-select
      label={props.label}
      value={props.value}
      details={props.details}
      onInput={handle}
      onChange={handle}
    >
      {props.options.map((o) => (
        <s-option key={o.value} value={o.value}>
          {o.label}
        </s-option>
      ))}
    </s-select>
  );
}

/** Native datetime-local (Polaris has no date-time field); wall-clock in `zoneLabel`. */
export function DateTimeInput(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  zoneLabel?: string;
}) {
  return (
    <label className="pcg-field">
      <s-text>
        {props.label}
        {props.zoneLabel ? ` (${props.zoneLabel})` : ""}
      </s-text>
      <input
        type="datetime-local"
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value)}
      />
    </label>
  );
}

/** Bordered card for one row of a repeating list. */
export function RowCard(props: {
  heading: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack gap="base">
        <s-stack
          direction="inline"
          justifyContent="space-between"
          alignItems="center"
          gap="base"
        >
          <s-text type="strong">{props.heading}</s-text>
          {props.actions && (
            <s-stack direction="inline" gap="small-200">
              {props.actions}
            </s-stack>
          )}
        </s-stack>
        {props.children}
      </s-stack>
    </s-box>
  );
}

/** Immutable list helpers for repeating editor rows. */
export const list = {
  set: <T,>(items: T[], i: number, patch: Partial<T>) =>
    items.map((x, j) => (j === i ? { ...x, ...patch } : x)),
  remove: <T,>(items: T[], i: number) => items.filter((_, j) => j !== i),
  move: <T,>(items: T[], i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= items.length) return items;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  },
};
