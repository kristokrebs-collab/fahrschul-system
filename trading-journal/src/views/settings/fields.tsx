import { memo, type ReactNode } from "react";
import { parseNumber, thousandsReading, toInputString } from "@/lib/parse";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import type { DraftTextKey, SettingsDraft } from "./draft";
import { ChangedDot } from "./fx";

export interface DraftFieldProps {
  id: DraftTextKey;
  label: ReactNode;
  help?: ReactNode;
  /** Text inputs with `inputMode="decimal"` + mono (default true, as in the bundle helper `l`). */
  numeric?: boolean;
  draft: SettingsDraft;
  onChange: (key: DraftTextKey, value: string) => void;
  placeholder?: string;
  /** The value differs from the saved settings → signal dot after the label. */
  changed?: boolean;
  /** The last save was refused because of this field → loss border + `aria-invalid` until it is edited. */
  invalid?: boolean;
}

/**
 * Bundle `K$` field helper `l(field, label, help, numeric)`: `Field` + `Input#s-{field}`. Memoised: a draft change
 * re-renders only the fields whose value or marks changed.
 */
export const DraftField = memo(function DraftField({ id, label, help, numeric = true, draft, onChange, placeholder, changed = false, invalid = false }: DraftFieldProps) {
  const htmlFor = `s-${id}`;
  // „30.000“ is read as 30 (one dot = the decimal point, as everywhere in the journal). Someone who means thirty thousand is ASKED,
  // exactly like in the trade form – a Startkapital of 30 was saved without a word and the overview then read „+2.590 %“
  // (Funktionsprüfung Runde 18). One tap takes the other reading; nothing is re-read silently.
  const alt = numeric ? thousandsReading(draft[id]) : null;
  const read = alt == null ? null : parseNumber(draft[id]);
  const dotHint =
    alt == null ? null : (
      <span data-testid={`dot-hint-${id}`} className="text-mute">
        {read == null ? "So nicht lesbar." : `Gelesen als ${toInputString(read)} – der Punkt gilt als Komma.`}{" "}
        <button type="button" className="touch-hit font-medium text-fg underline underline-offset-2" onClick={() => onChange(id, String(alt))}>
          {alt} gemeint
        </button>
      </span>
    );
  return (
    <Field
      label={
        <>
          {label}
          <ChangedDot show={changed} />
        </>
      }
      htmlFor={htmlFor}
      help={dotHint ?? help}
    >
      <Input id={htmlFor} numeric={numeric} value={draft[id] ?? ""} onChange={(e) => onChange(id, e.target.value)} autoComplete="off" placeholder={placeholder} invalid={invalid} />
    </Field>
  );
}, sameField);

/** Only the field's own value and marks matter (the rest of the draft is irrelevant to it). */
function sameField(a: DraftFieldProps, b: DraftFieldProps): boolean {
  return (
    a.id === b.id &&
    a.label === b.label &&
    a.help === b.help &&
    a.numeric === b.numeric &&
    a.onChange === b.onChange &&
    a.placeholder === b.placeholder &&
    a.changed === b.changed &&
    a.invalid === b.invalid &&
    a.draft[a.id] === b.draft[b.id]
  );
}
