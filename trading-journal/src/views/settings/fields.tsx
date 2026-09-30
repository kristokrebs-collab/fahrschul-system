import type { ReactNode } from "react";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import type { DraftTextKey, SettingsDraft } from "./draft";

export interface DraftFieldProps {
  id: DraftTextKey;
  label: ReactNode;
  help?: ReactNode;
  /** Text inputs with `inputMode="decimal"` + mono (default true, as in the bundle helper `l`). */
  numeric?: boolean;
  draft: SettingsDraft;
  onChange: (key: DraftTextKey, value: string) => void;
  placeholder?: string;
}

/** Bundle `K$` field helper `l(field, label, help, numeric)`: `Field` + `Input#s-{field}`. */
export function DraftField({ id, label, help, numeric = true, draft, onChange, placeholder }: DraftFieldProps) {
  const htmlFor = `s-${id}`;
  return (
    <Field label={label} htmlFor={htmlFor} help={help}>
      <Input id={htmlFor} numeric={numeric} value={draft[id] ?? ""} onChange={(e) => onChange(id, e.target.value)} autoComplete="off" placeholder={placeholder} />
    </Field>
  );
}
