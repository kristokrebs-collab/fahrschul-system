/**
 * Small building blocks of the Strategie-Studio: the trader's text with the understood and the unclear words marked, the
 * disclaimer every result card ends with, a progress bar and the formatting of dates.
 */
import { useMemo, type ReactNode } from "react";
import type { Understood, Unclear } from "@/domain/strategytext";
import { cn } from "@/lib/cn";
import { PAST_NOT_FORECAST } from "./strings";

/** The last line of a backtest card: the one calm sentence about the past (the page carries the one „Keine professionelle Finanzberatung.“ at its end). */
export function Disclaimer({ past = false, className }: { past?: boolean; className?: string }) {
  if (!past) return null;
  return (
    <p className={cn("text-[11.5px] leading-relaxed text-mute", className)} data-testid="studio-disclaimer">
      {PAST_NOT_FORECAST}
    </p>
  );
}

export const dateText = (ms: number): string => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(ms));
export const dateTimeText = (ms: number): string => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));

interface Mark {
  start: number;
  end: number;
  kind: "ok" | "no";
  title: string;
  n: number | null;
}

/** The trader's text; the words that became a rule are marked (and numbered like the list), the ones that did not are marked differently. */
export function MarkedText({ text, understood, unclear, className }: { text: string; understood: readonly Understood[]; unclear: readonly Unclear[]; className?: string }) {
  const parts = useMemo(() => {
    const marks: Mark[] = [
      ...understood.map((u, i) => ({ start: u.span.start, end: u.span.end, kind: "ok" as const, title: u.meaning, n: i + 1 })),
      ...unclear.flatMap((u) => (u.span ? [{ start: u.span.start, end: u.span.end, kind: "no" as const, title: u.why, n: null }] : [])),
    ]
      .filter((m) => m.end > m.start && m.end <= text.length)
      .sort((a, b) => a.start - b.start || b.end - a.end);
    const out: { text: string; mark?: Mark }[] = [];
    let pos = 0;
    for (const m of marks) {
      if (m.start < pos) continue;
      if (m.start > pos) out.push({ text: text.slice(pos, m.start) });
      out.push({ text: text.slice(m.start, m.end), mark: m });
      pos = m.end;
    }
    if (pos < text.length) out.push({ text: text.slice(pos) });
    return out;
  }, [text, understood, unclear]);
  return (
    <p className={cn("whitespace-pre-wrap break-words text-[14px] leading-[1.9] text-fg/90", className)} data-testid="studio-marked">
      {parts.map((p, i) =>
        p.mark ? (
          <mark key={i} title={p.mark.title} data-kind={p.mark.kind} className={cn("rounded-md px-1 py-0.5 text-fg [box-decoration-break:clone]", p.mark.kind === "ok" ? "bg-win/15 shadow-[inset_0_-2px_0_var(--color-win)]" : "bg-warn/15 shadow-[inset_0_-2px_0_var(--color-warn)]")}>
            {p.text}
            {p.mark.n != null && (
              <sup aria-hidden="true" className="ml-0.5 font-mono text-[9.5px] text-faint">
                {p.mark.n}
              </sup>
            )}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

/** A thin progress bar (`role=progressbar`), never a live region. */
export function Bar({ fraction, label, testId }: { fraction: number; label: string; testId?: string }) {
  const pct = Math.max(0, Math.min(99, Math.floor(fraction * 100)));
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct} %`} aria-label={label} data-testid={testId} className="grid gap-1.5">
      <span className="text-[12px] text-mute">{label}</span>
      <span aria-hidden="true" className="h-[3px] w-full overflow-hidden rounded-full bg-white/[0.06]">
        <span className="block h-full origin-left rounded-full bg-fg transition-transform duration-200" style={{ transform: `scaleX(${Math.max(0.02, fraction)})` }} />
      </span>
    </div>
  );
}

/** Heading of a list inside a card. */
export function Mini({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn("text-[10px] font-semibold uppercase tracking-[0.1em] text-faint", className)}>{children}</h3>;
}
