import { useRef, useState } from "react";

/**
 * Full-width search that updates the page as you type (after a short pause) or on Enter.
 * A plain GET form doesn't submit from Polaris' search field inside the Shopify admin, so this
 * drives the URL with the page's own setParams instead.
 */
export function SearchBox(props: {
  label: string;
  placeholder: string;
  value: string;
  onSearch: (q: string) => void;
}) {
  const [text, setText] = useState(props.value);
  // Follow the URL when it changes from elsewhere (back button, filter buttons).
  const [seen, setSeen] = useState(props.value);
  if (seen !== props.value) {
    setSeen(props.value);
    setText(props.value);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const run = (q: string) => {
    clearTimeout(timer.current);
    if (q.trim() !== props.value.trim()) props.onSearch(q.trim());
  };
  const onInput = (e: Event) => {
    const q = (e.currentTarget as HTMLInputElement).value;
    setText(q);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(q), 400);
  };
  return (
    <div style={{ width: "100%" }}>
      <s-search-field
        label={props.label}
        labelAccessibilityVisibility="exclusive"
        placeholder={props.placeholder}
        value={text}
        onInput={onInput}
        // Enter (and leaving the field) commits right away.
        onChange={(e: Event) =>
          run((e.currentTarget as HTMLInputElement).value)
        }
      />
    </div>
  );
}
