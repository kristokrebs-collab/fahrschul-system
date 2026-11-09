/**
 * Small building blocks of the extra cards (F20 / F18 / F17): the run bar (start, progress, cancel, error), a key-value row,
 * a sub-heading, a delta cell and a time-span formatter. Motion: the progress bar scales on a transform; nothing loops.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { date as fmtDate } from "@/lib/format";
import { Button } from "@/primitives/Button";
import type { ExtraSlice } from "./extrasStore";
import { LABOR } from "./strings";

const X = LABOR.extras;

/** "12.03.2026" from ms. */
export const dayText = (ms: number): string => fmtDate(new Date(ms));

const dec = (v: number, d: number): string => v.toFixed(d).replace(".", ",").replace("-", "−");
/** Percentage points: "+1,2 Pp." (fraction in). */
export const ppText = (v: number | null | undefined, d = 1): string => (v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${dec(v * 100, d)} Pp.`);
/** Signed plain number: "+0,12". */
export const signedText = (v: number | null | undefined, d = 2): string => (v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${dec(v, d)}`);
/** Signed integer: "+3" / "−6". */
export const countDelta = (v: number | null | undefined): string => (v == null ? "–" : `${v > 0 ? "+" : ""}${String(v).replace("-", "−")}`);

/** Tone of a change: higher is better (`up`) or lower is better. A change smaller than `eps` is neutral. */
export function deltaTone(v: number | null | undefined, higherIsBetter = true, eps = 1e-9): string {
  if (v == null || Math.abs(v) <= eps) return "text-fg";
  return (v > 0) === higherIsBetter ? "text-win" : "text-loss";
}

/** Start / progress / cancel / error of one extra run. */
export function RunBar({ slice, onRun, onCancel, label, id, disabled, disabledReason, hint }: { slice: ExtraSlice<unknown>; onRun: () => void; onCancel: () => void; label: string; id: string; disabled?: boolean; disabledReason?: string; hint?: ReactNode }) {
  const running = slice.status === "running";
  const done = slice.status === "done";
  const reasonId = `${id}-why`;
  return (
    <div className="grid gap-2" data-testid={`${id}-runbar`} data-status={slice.status}>
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button size="sm" onClick={onCancel} data-testid={`${id}-cancel`}>
            {X.cancel}
          </Button>
        ) : (
          <Button size="sm" variant={done ? "secondary" : "primary"} onClick={onRun} disabled={disabled} aria-describedby={disabled && disabledReason ? reasonId : undefined} data-testid={`${id}-run`}>
            {done ? X.again : label}
          </Button>
        )}
        {running && (
          <div className="flex min-w-0 flex-1 items-center gap-3" data-testid={`${id}-busy`}>
            <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(slice.progress * 100)} className="h-1 min-w-24 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
              <span className="block h-full origin-left rounded-full bg-fg/80 transition-transform duration-200 ease-out" style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, slice.progress))})` }} />
            </span>
            <span className="num shrink-0 font-mono text-[11.5px] text-mute">{X.running(Math.round(slice.progress * 100))}</span>
          </div>
        )}
      </div>
      {disabled && disabledReason && (
        <p id={reasonId} className="text-[12px] text-mute">
          {disabledReason}
        </p>
      )}
      {slice.error && (slice.status === "error" || slice.status === "cancelled") && (
        <p role="status" className={cn("text-[12.5px]", slice.status === "error" ? "text-warn" : "text-mute")} data-testid={`${id}-error`}>
          {slice.error}
        </p>
      )}
      {hint != null && !running && <p className="text-[11.5px] leading-snug text-faint">{hint}</p>}
    </div>
  );
}

/** Heading + content of one block inside an extra card. */
export function Block({ title, sub, children, id }: { title: string; sub?: string; children: ReactNode; id?: string }) {
  return (
    <section className="grid gap-2.5 border-t border-line pt-4 first:border-t-0 first:pt-0" data-testid={id}>
      <header className="grid gap-0.5">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {sub && <p className="text-[11.5px] text-faint">{sub}</p>}
      </header>
      {children}
    </section>
  );
}

/** One label / value line of a definition list. */
export function Kv({ k, v, tone }: { k: ReactNode; v: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-line py-1.5 text-[12.5px] first:border-t-0">
      <dt className="min-w-0 text-mute">{k}</dt>
      <dd className={cn("num shrink-0 text-right font-mono", tone)}>{v}</dd>
    </div>
  );
}

/** A table that scrolls on its own when it is wider than the card (never the page). */
export function ScrollTable({ label, min = "34rem", children, testId }: { label: string; min?: string; children: ReactNode; testId?: string }) {
  return (
    <div className="overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      <table className="w-full text-[12px]" style={{ minWidth: min }} data-testid={testId}>
        {children}
      </table>
    </div>
  );
}

export const TH = "pb-1.5 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-faint";
export const THL = "pb-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-faint";
