import { useState } from "react";
import { flag, NumberInput, TextInput } from "./fields";

/**
 * "Add Entries": a manual adjustment for an entrant (the entrant page passes no email; the
 * giveaway's Entrants tab asks for one). Submits intent "addEntries".
 */
export function AddEntriesForm(props: {
  submit: (data: Record<string, string>) => void;
  busy: boolean;
  askEmail?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [entries, setEntries] = useState(50);
  const [note, setNote] = useState("");
  return (
    <s-stack gap="small-200">
      {props.askEmail && (
        <TextInput
          label="Entrant Email"
          value={email}
          placeholder="ash@example.com"
          onChange={setEmail}
        />
      )}
      <NumberInput
        label="Entries"
        value={entries}
        step={1}
        onChange={setEntries}
        details="Use a minus sign to take entries away. Counts in today's daily draw."
      />
      <TextInput
        label="Reason (optional)"
        value={note}
        placeholder="e.g. Order #258400 placed with another email"
        onChange={setNote}
      />
      <s-stack direction="inline">
        <s-button
          variant="primary"
          disabled={flag(props.busy || (props.askEmail && !email.trim()))}
          onClick={() =>
            props.submit({
              intent: "addEntries",
              entries: String(entries),
              note,
              ...(props.askEmail ? { email } : {}),
            })
          }
        >
          Add Entries
        </s-button>
      </s-stack>
    </s-stack>
  );
}
