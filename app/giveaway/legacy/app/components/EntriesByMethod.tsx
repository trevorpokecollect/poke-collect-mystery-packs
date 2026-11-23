import type { MethodRow } from "../lib/entries/methods";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Table of entries earned per entry method. `people` is hidden for a single entrant. */
export function EntriesByMethodTable(props: {
  rows: MethodRow[];
  showPeople?: boolean;
}) {
  const showPeople = props.showPeople ?? true;
  if (props.rows.every((r) => r.times === 0 && r.entries === 0))
    return <s-paragraph>No entries yet.</s-paragraph>;
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">Method</s-table-header>
        {showPeople && <s-table-header format="numeric">People</s-table-header>}
        <s-table-header format="numeric">Times Earned</s-table-header>
        <s-table-header format="numeric">Entries</s-table-header>
        <s-table-header format="numeric">Share</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {props.rows.map((r) => (
          <s-table-row key={r.key}>
            <s-table-cell>{r.label}</s-table-cell>
            {showPeople && (
              <s-table-cell>{r.people.toLocaleString()}</s-table-cell>
            )}
            <s-table-cell>{r.times.toLocaleString()}</s-table-cell>
            <s-table-cell>{r.entries.toLocaleString()}</s-table-cell>
            <s-table-cell>{r.share ? pct(r.share) : "—"}</s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}
