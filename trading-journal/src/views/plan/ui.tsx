/**
 * Building blocks of the Handelsplan: the step card (number, state, the result in one big sentence, "Angenommen", and the line
 * every section ends with – source and stand of the candles; the one "Keine professionelle Finanzberatung." stands at the end of the page), a number field that
 * commits on leaving it, and the state marks.
 */
import { useId, useState, type ReactNode } from "react";
import type { StepId, StepStatus } from "@/domain/plan";
import { parseNumber } from "@/lib/parse";
import { cn } from "@/lib/cn";
import { Input } from "@/primitives/Input";
import { Card } from "@/primitives/Card";

export { ChipPick, FieldRow, Kpi } from "@/views/labor/ui";

/** Room the sticky progress bar takes under the app header (px): a step card that is scrolled to keeps this much clear above it. */
export const PROGRESS_SCROLL_MARGIN = "scroll-mt-[168px]";

export const STATUS_WORD: Record<StepStatus, string> = { done: "Fertig", warn: "Achtung", blocked: "Gesperrt", todo: "Wartet" };
const STATUS_TONE: Record<StepStatus, string> = {
  done: "border-win/30 bg-win/10 text-win",
  warn: "border-warn/30 bg-warn/10 text-warn",
  blocked: "border-loss/30 bg-loss/10 text-loss",
  todo: "border-line-2 bg-white/[0.03] text-mute",
};
const DOT_TONE: Record<StepStatus, string> = { done: "bg-win", warn: "bg-warn", blocked: "bg-loss", todo: "bg-faint-line" };

/** The state as a word with a dot (never colour alone). */
export function StatePill({ status, className, testId }: { status: StepStatus; className?: string; testId?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", STATUS_TONE[status], className)} data-testid={testId} data-status={status}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT_TONE[status])} />
      {STATUS_WORD[status]}
    </span>
  );
}

/** The number of a step, or a check once it is done. */
export function StepBadge({ n, status }: { n: number; status: StepStatus }) {
  return (
    <span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center rounded-xl border font-mono text-[13px] font-semibold", status === "done" ? "border-win/40 bg-win/10 text-win" : status === "blocked" ? "border-loss/40 bg-loss/10 text-loss" : status === "warn" ? "border-warn/40 bg-warn/10 text-warn" : "border-line-2 bg-ink-950/60 text-mute")}>
      {status === "done" ? (
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5l3 3 6-6.5" />
        </svg>
      ) : (
        n
      )}
    </span>
  );
}

export interface StandProps {
  sourceLabel: string;
  /** end of the newest closed candle that was used (ms), `null` = none */
  until: number | null;
  /** when the candles were loaded (ms), `null` = from the cache / not loaded */
  fetchedAt: number | null;
  /** formatter for a time (zone of the session) */
  fmt: (ms: number) => string;
}

/** "Quelle: Binance USDⓈ-M · Kerzen bis 19.10. 09:55 · abgerufen 25.10. 10:00". */
export function standLine({ sourceLabel, until, fetchedAt, fmt }: StandProps): string {
  return `Quelle: ${sourceLabel} · Kerzen bis ${until != null ? fmt(until) : "keine Daten"} · ${fetchedAt != null ? `abgerufen ${fmt(fetchedAt)}` : "nicht neu abgerufen"}`;
}

/** The line every step ends with: where the candles come from and how fresh they are. */
export function StepNote({ stand, testId }: { stand: string; testId: string }) {
  return (
    <p className="num border-t border-line pt-3 text-[11.5px] leading-relaxed text-mute" data-testid={testId}>
      {stand}
    </p>
  );
}

/**
 * "Was wurde angenommen": the assumptions of a step. A fold (`details`, closed): the card stays calm, the list is one tap away and
 * stays in the document either way.
 */
export function Assumed({ items, testId }: { items: readonly string[]; testId: string }) {
  if (!items.length) return null;
  return (
    <details className="group rounded-xl border border-line bg-ink-950/40" data-testid={testId}>
      <summary className="flex min-h-10 cursor-pointer select-none list-none items-center gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-mute transition-colors hover:text-fg pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform duration-200 group-open:rotate-90">
          ›
        </span>
        Angenommen
        <span className="num font-mono font-normal normal-case tracking-normal text-faint">({items.length})</span>
      </summary>
      <ul className="grid gap-1 px-3 pb-2.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2 text-[12px] leading-snug text-mute">
            <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-faint-line" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{t}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export interface StepCardProps {
  id: StepId;
  n: number;
  title: string;
  lead: string;
  status: StepStatus;
  current: boolean;
  /** the result in one sentence */
  headline: ReactNode;
  assumed: readonly string[];
  stand: string;
  children?: ReactNode;
}

/** One big, clear step of the plan. */
export function StepCard({ id, n, title, lead, status, current, headline, assumed, stand, children }: StepCardProps) {
  const uid = useId();
  return (
    <Card className={cn("min-w-0", PROGRESS_SCROLL_MARGIN)} innerClassName="gap-4 p-4 sm:p-5" data-testid={`hplan-${id}`} data-status={status} data-current={current ? "true" : undefined} aria-labelledby={`${uid}-h`}>
      <header className="flex items-start gap-3">
        <StepBadge n={n} status={status} />
        <div className="min-w-0 flex-1">
          <h2 id={`${uid}-h`} className="text-[17px] font-semibold tracking-tight">
            <span className="sr-only">Schritt {n}: </span>
            {title}
          </h2>
          <p className="text-[12.5px] leading-snug text-mute">{lead}</p>
        </div>
        <StatePill status={status} testId={`hplan-${id}-state`} />
      </header>
      <p className="text-[clamp(16px,4.4vw,19px)] font-medium leading-snug text-fg [overflow-wrap:anywhere]" data-testid={`hplan-${id}-headline`}>
        {headline}
      </p>
      {children}
      <Assumed items={assumed} testId={`hplan-${id}-assumed`} />
      <StepNote stand={stand} testId={`hplan-${id}-note`} />
    </Card>
  );
}

export interface NumInputProps {
  label: string;
  value: number | null;
  onCommit: (v: number | null) => void;
  /** the unit shown inside the field */
  suffix?: string;
  placeholder?: string;
  /** shown value for a number (default: German decimal comma, no grouping) */
  format?: (v: number) => string;
  min?: number;
  max?: number;
  testId?: string;
  help?: ReactNode;
  className?: string;
}

const plainText = (v: number): string => String(v).replace(".", ",");

/**
 * A number field that keeps what is being typed and commits on leaving it (or Enter). An empty field commits `null`; text that is
 * not a number or lies outside `min` / `max` is not committed – the field shows the problem and keeps the old value.
 */
export function NumInput({ label, value, onCommit, suffix, placeholder, format = plainText, min, max, testId, help, className }: NumInputProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  // a new committed value (or a reset from outside) drops what was typed - state adjusted while rendering, not in an effect
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(null);
    setBad(false);
  }
  const shown = draft ?? (value == null ? "" : format(value));
  const commit = (): void => {
    if (draft == null) return;
    const t = draft.trim();
    if (!t) {
      setDraft(null);
      setBad(false);
      onCommit(null);
      return;
    }
    const n = parseNumber(t);
    if (n == null || (min != null && n < min) || (max != null && n > max)) {
      setBad(true);
      return;
    }
    setBad(false);
    setDraft(null);
    onCommit(n);
  };
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <label htmlFor={id} className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          numeric
          value={shown}
          placeholder={placeholder}
          invalid={bad}
          aria-invalid={bad || undefined}
          aria-describedby={bad ? `${id}-err` : help ? `${id}-help` : undefined}
          data-testid={testId}
          className={suffix ? "pr-12" : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
        {suffix && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center font-mono text-[12px] text-mute">
            {suffix}
          </span>
        )}
      </div>
      {bad && (
        <span id={`${id}-err`} role="alert" className="text-[11.5px] text-loss">
          {min != null && max != null ? `Bitte eine Zahl von ${plainText(min)} bis ${plainText(max)}.` : "Bitte eine Zahl eingeben."}
        </span>
      )}
      {!bad && help != null && (
        <span id={`${id}-help`} className="text-[11.5px] leading-snug text-mute">
          {help}
        </span>
      )}
    </div>
  );
}
