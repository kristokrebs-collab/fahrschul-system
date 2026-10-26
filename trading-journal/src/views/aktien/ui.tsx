/**
 * Small building blocks of the Aktien page: a number field that commits on blur / Enter, a check chip, a labelled figure,
 * the "Quelle · Abruf · Stand" line of a stamp, and the fixed sentence every result card ends with.
 */
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Input } from "@/primitives/Input";
import { SourceStand, type StandPart } from "@/ui/SourceStand";
import { SOURCE_NAME, type Stamp } from "@/market/stocks/types";
import { NO_ADVICE_TEXT } from "@/ui/AnalysisNote";

/** The label of a source id as the trader knows it. */
export const sourceName = (id: string): string => SOURCE_NAME[id] ?? (id === "binance" ? "Binance USDⓈ-M" : id === "proxy" ? "Binance USDⓈ-M (EU-Proxy)" : id);

/** "Quelle: Yahoo Finance (inoffiziell) · Abruf 25.10. 22:55 · letzte Kerze 23.10. 21:55" – from a stamp and the time of the newest candle. */
export function StampLine({ stamp, lastBar, lastLabel = "letzte Kerze", className, testId }: { stamp: Pick<Stamp, "source" | "receivedAt" | "fetchedAt"> | null; lastBar?: number | null; lastLabel?: string; className?: string; testId?: string }) {
  if (!stamp) return <SourceStand source={null} className={className} {...(testId ? { testId } : {})} />;
  const parts: StandPart[] = [{ label: "Abruf", at: stamp.fetchedAt ?? stamp.receivedAt }];
  if (lastBar !== undefined) parts.push({ label: lastLabel, at: lastBar });
  return <SourceStand source={sourceName(stamp.source)} parts={parts} className={className} {...(testId ? { testId } : {})} />;
}

/** A number that is typed freely and committed on blur or Enter (the thresholds are bounded and rounded by `sanitizeParams`, not here). */
export function NumField({ id, label, value, onCommit, suffix, scale = 1, digits = 0, help, disabled }: { id: string; label: string; value: number; onCommit: (v: number) => void; suffix?: string; scale?: number; digits?: number; help?: ReactNode; disabled?: boolean }) {
  const shown = (v: number): string => (v * scale).toLocaleString("de-DE", { maximumFractionDigits: digits, useGrouping: false });
  const [text, setText] = useState(() => shown(value));
  const [seen, setSeen] = useState(value);
  // the value changed from outside (a reset): show it – adjusted while rendering, not in an effect
  if (seen !== value) {
    setSeen(value);
    setText(shown(value));
  }
  const commit = (): void => {
    const n = Number(text.replace(",", ".").trim());
    if (text.trim() && Number.isFinite(n)) onCommit(n / scale);
    else setText(shown(value));
  };
  return (
    <div className="grid min-w-0 content-start gap-1">
      <label htmlFor={id} className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          numeric
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          wrapperClassName="max-w-[7.5rem]"
          aria-describedby={help ? `${id}-help` : undefined}
        />
        {suffix && <span className="text-[12px] text-faint">{suffix}</span>}
      </div>
      {help && (
        <span id={`${id}-help`} className="text-[11px] text-faint">
          {help}
        </span>
      )}
    </div>
  );
}

/** A switch the size of a chip: `role="checkbox"`, ≥ 44 px on touch. */
export function CheckChip({ checked, onChange, children, testId, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; testId?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      data-testid={testId}
      className={cn(
        "inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-[12px] font-medium outline-none transition-colors duration-200 focus-visible:border-white/50 pointer-coarse:min-h-11 disabled:opacity-40",
        checked ? "border-white/40 bg-ink-750 text-fg" : "border-line-2 text-mute hover:border-white/30 hover:text-fg",
      )}
    >
      <span aria-hidden="true" className={cn("grid size-3.5 place-items-center rounded-[4px] border text-[10px] leading-none", checked ? "border-fg bg-fg text-ink-950" : "border-line-2")}>
        {checked ? "✓" : ""}
      </span>
      {children}
    </button>
  );
}

/** A labelled figure of the run summary. */
export function Figure({ label, value, sub, testId }: { label: string; value: ReactNode; sub?: ReactNode; testId?: string }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2" data-testid={testId}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</dt>
      <dd className="num font-mono text-[15px] font-medium leading-tight text-fg">{value}</dd>
      {sub != null && <dd className="num text-[11px] text-faint">{sub}</dd>}
    </div>
  );
}

/** "Keine professionelle Finanzberatung." – the last line of a result card, with what the card says first. */
export function CardNote({ lead, className }: { lead: string; className?: string }) {
  return (
    <p className={cn("text-[11.5px] leading-relaxed text-mute", className)} data-testid="aktien-note">
      {lead} {NO_ADVICE_TEXT}
    </p>
  );
}

/** Heading of a list inside a card. */
export function Mini({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn("text-[10px] font-semibold uppercase tracking-[0.1em] text-faint", className)}>{children}</h3>;
}
