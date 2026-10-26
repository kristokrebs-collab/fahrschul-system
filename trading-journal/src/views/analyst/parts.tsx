/**
 * Small building blocks of the analyst panels: number and text fields that keep what is typed until it is valid, a list editor,
 * the error box with the typed reason, the source line, and a heading with a disclosure. Nothing here knows about SEC or DCF.
 */
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { parseNumber, toInputString } from "@/lib/parse";
import { Button } from "@/primitives/Button";
import { Collapse, Expander } from "@/primitives/Expander";
import { Field } from "@/primitives/Field";
import { Input, Textarea } from "@/primitives/Input";
import { SourceStand } from "@/ui/SourceStand";
import type { SecError, SecStamped } from "@/market/sec";
import { dateDe } from "@/domain/analyst/fmt";
import { ERROR_HINT } from "./strings";

/** The number as typed: no float noise (`0.1 * 100`), at most four decimals, comma as the decimal sign. */
export function numText(value: number | null, factor: number): string {
  if (value == null || !Number.isFinite(value)) return "";
  return toInputString(+(value / factor).toFixed(4));
}

export interface NumFieldProps {
  label: ReactNode;
  /** the stored value in its real unit (fraction, currency units …); `null` = empty */
  value: number | null;
  /** real value = typed value × factor (percent: 0.01, millions: 1e6) */
  factor?: number;
  /** `change`: every valid keystroke is passed on (live results); `blur`: only when the field is left (stored data) */
  commit?: "change" | "blur";
  onCommit: (v: number | null) => void;
  suffix?: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  testId?: string;
  className?: string;
}

/**
 * A number field for German input ("1,5" and "1.5" both work). It keeps the TEXT while typing and passes on a number only when
 * the text is a number (or empty = no value); a text that is not a number shows the field as invalid and passes nothing on.
 * Re-mount it with a `key` to show a value that changed from outside.
 */
export function NumField({ label, value, factor = 1, commit = "change", onCommit, suffix, help, error, disabled, testId, className }: NumFieldProps) {
  const id = useId();
  const [text, setText] = useState(() => numText(value, factor));
  const bad = text.trim() !== "" && parseNumber(text) === null;
  const pass = (t: string): void => {
    const n = parseNumber(t);
    if (t.trim() === "") onCommit(null);
    else if (n !== null) onCommit(n * factor);
  };
  return (
    <Field label={label} htmlFor={id} suffix={suffix} help={help} error={bad ? "Das ist keine Zahl." : error} className={className}>
      <Input
        id={id}
        numeric
        value={text}
        invalid={bad || Boolean(error)}
        disabled={disabled}
        data-testid={testId}
        aria-describedby={bad || error ? `${id}-error` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          if (commit === "change") pass(e.target.value);
        }}
        onBlur={() => {
          if (commit === "blur") pass(text);
        }}
      />
    </Field>
  );
}

export interface TextFieldProps {
  label: ReactNode;
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  maxLength?: number;
  help?: ReactNode;
  placeholder?: string;
  type?: "text" | "date";
  testId?: string;
  className?: string;
  rows?: number;
}

/** A text field that keeps its draft and stores it when it is left (a Textarea saved per keystroke would write the journal for every letter). */
export function TextField({ label, value, onCommit, multiline, maxLength, help, placeholder, type = "text", testId, className, rows = 5 }: TextFieldProps) {
  const id = useId();
  const [text, setText] = useState(value);
  return (
    <Field label={label} htmlFor={id} help={help} className={className}>
      {multiline ? (
        <Textarea id={id} rows={rows} value={text} maxLength={maxLength} placeholder={placeholder} data-testid={testId} onChange={(e) => setText(e.target.value)} onBlur={() => onCommit(text)} />
      ) : (
        <Input id={id} type={type} value={text} maxLength={maxLength} placeholder={placeholder} data-testid={testId} onChange={(e) => setText(e.target.value)} onBlur={() => onCommit(text)} />
      )}
    </Field>
  );
}

export interface ListEditorProps {
  label: string;
  items: readonly string[];
  onChange: (items: string[]) => void;
  max?: number;
  placeholder?: string;
  addLabel?: string;
  removeLabel?: string;
  testId?: string;
}

/** A short list of sentences (catalysts, risks, counter-arguments): add one, remove one – stored at once. */
export function ListEditor({ label, items, onChange, max = 12, placeholder, addLabel = "Hinzufügen", removeLabel = "Entfernen", testId }: ListEditorProps) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const add = (): void => {
    const t = draft.trim();
    if (!t || items.length >= max) return;
    onChange([...items, t]);
    setDraft("");
  };
  return (
    <div className="grid gap-2" data-testid={testId}>
      <span className="label" id={`${id}-l`}>
        {label}
      </span>
      {items.length > 0 && (
        <ul className="grid gap-1.5" aria-labelledby={`${id}-l`}>
          {items.map((it, i) => (
            <li key={`${i}-${it}`} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-ink-950/40 px-3 py-2 text-[13px] leading-snug">
              <span className="min-w-0 break-words">{it}</span>
              <button type="button" className="touch-hit shrink-0 text-[12px] text-mute underline-offset-2 hover:text-fg hover:underline" aria-label={`${removeLabel}: ${it}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                {removeLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length < max && (
        <div className="flex items-start gap-2">
          <Input
            id={id}
            aria-label={`${label}: neuer Punkt`}
            value={draft}
            placeholder={placeholder}
            maxLength={280}
            wrapperClassName="min-w-0 flex-1"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button size="sm" onClick={add} disabled={!draft.trim()}>
            {addLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A typed failure: the server's own German message, then what it means for the person. */
export function SecErrorBox({ error, title = "Keine Zahlen", testId = "sec-error" }: { error: SecError; title?: string; testId?: string }) {
  const hint = ERROR_HINT[error.kind];
  return (
    <div role="alert" className="grid gap-1.5 rounded-xl border border-warn/30 bg-warn/[0.06] p-3.5" data-testid={testId} data-kind={error.kind}>
      <p className="text-[13px] font-semibold text-warn">{error.kind === "setup_required" ? "Einrichtung nötig" : title}</p>
      <p className="text-[13px] leading-snug">{error.message}</p>
      {hint && <p className="text-[12px] leading-snug text-mute">{hint}</p>}
    </div>
  );
}

/** "Quelle: SEC EDGAR (XBRL) · Abruf 25.10. 14:02", the date the numbers refer to and the link to the SEC document. */
export function SecStamp({ stamp, asOfLabel = "Zahlen bis", extra, testId = "sec-stamp" }: { stamp: Pick<SecStamped<unknown>, "sourceLabel" | "sourceUrl" | "receivedAt" | "stale" | "cached">; asOfLabel?: string; extra?: string | null; testId?: string }) {
  return (
    <div className="grid gap-0.5" data-testid={testId}>
      <SourceStand source={stamp.sourceLabel} parts={[{ label: "Abruf", at: stamp.receivedAt }]} />
      <p className="text-[12px] leading-relaxed text-mute">
        {extra ? <span>{asOfLabel} {extra} · </span> : null}
        {stamp.stale ? <span className="text-warn">letzte gute Kopie, die SEC war nicht erreichbar · </span> : null}
        <a href={stamp.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg">
          Quelle bei der SEC
        </a>
      </p>
    </div>
  );
}

/** A heading with a disclosure: the content is only in the page while it is open. */
export function Disclosure({ title, count, defaultOpen = false, children, testId }: { title: string; count?: number; defaultOpen?: boolean; children: ReactNode; testId?: string }) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="grid gap-2" data-testid={testId} data-open={open ? "1" : "0"}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">
          {title}
          {count != null ? <span className="num ml-1.5 font-mono text-faint">{count}</span> : null}
        </h3>
        <Expander open={open} onToggle={() => setOpen((o) => !o)} label={title} controls={id} />
      </div>
      <Collapse open={open} id={id}>
        {children}
      </Collapse>
    </section>
  );
}

/** A section heading inside a panel (the `Card` title is the panel's own). */
export function Sub({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn("text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute", className)}>{children}</h3>;
}

/** "keine Daten" in the calm tone used for a missing figure. */
export function NoData({ children = "keine Daten" }: { children?: ReactNode }) {
  return <span className="text-faint">{children}</span>;
}

export { dateDe };
