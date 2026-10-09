/**
 * Cell fragments shared by `TradesTable` and `TradesCards` – class strings 1:1 from the bundle (`H$`, `iT`, `oT`).
 */
import type { EnrichedTrade, Setup } from "@/domain/types";
import { RESULT_LABELS, RESULT_TONES } from "@/domain/defaults";
import { cn } from "@/lib/cn";
import { tradeTime } from "@/lib/dates";
import { colorClass, date, n1, price, signed, time } from "@/lib/format";
import { Badge, SetupChips } from "@/primitives";
import { StrengthBars } from "@/overlays/SignalSummary";
import { signalOf } from "./tradesModel";

export function sideLabel(t: Pick<EnrichedTrade, "side">): string {
  return t.side === "short" ? "▼ Short" : "▲ Long";
}

export function sideTone(t: Pick<EnrichedTrade, "side">): "text-win" | "text-loss" {
  return t.side === "short" ? "text-loss" : "text-win";
}

/** `Makro|Scalp[ · {lev}x]` – `V.n1(lev).replace(",0", "")`. */
export function accountLine(t: Pick<EnrichedTrade, "account" | "leverage">): string {
  return (t.account === "makro" ? "Makro" : "Scalp") + (t.leverage ? ` · ${n1(t.leverage).replace(",0", "")}x` : "");
}

/** `dd.MM.yy` and `HH:mm[ · tf]`. */
export function dateLines(t: EnrichedTrade): { day: string; clock: string } {
  const d = tradeTime(t);
  return { day: date(d), clock: time(d) + (t.timeframe ? " · " + t.timeframe : "") };
}

export function setupsOf(t: Pick<EnrichedTrade, "setups">, setups: readonly Setup[]): Setup[] {
  return (t.setups || []).map((id) => setups.find((s) => s.id === id)).filter((s): s is Setup => Boolean(s));
}

/** Direction tag `▲ Long` / `▼ Short` (`font-semibold uppercase tracking-wide`, Plan 2.5). */
export function SideTag({ t, className }: { t: Pick<EnrichedTrade, "side">; className?: string }) {
  return <div className={cn("text-xs font-semibold uppercase tracking-wide", sideTone(t), className)}>{sideLabel(t)}</div>;
}

/** Bundle `iT`: result badge. */
export function ResultBadge({ t }: { t: Pick<EnrichedTrade, "result"> }) {
  return <Badge tone={RESULT_TONES[t.result]}>{RESULT_LABELS[t.result]}</Badge>;
}

/** Bundle `oT` wrapper reading the setups from settings. */
export function TradeSetupChips({ t, setups, max }: { t: Pick<EnrichedTrade, "setups">; setups: readonly Setup[]; max?: number }) {
  return <SetupChips items={setupsOf(t, setups)} max={max} />;
}

/**
 * `V.price(entry) → V.price(exit)` | `offen`. With `stack` (table between `md` and `lg`) the exit goes onto its own
 * line below the entry, so the column stays narrow without cutting a price.
 */
export function EntryExit({ t, stack }: { t: Pick<EnrichedTrade, "entry" | "exit" | "result">; stack?: boolean }) {
  return (
    <>
      <span className="whitespace-nowrap">{price(t.entry)}</span>
      <span className={cn("whitespace-nowrap", stack && "max-lg:block")}>
        {" → "}
        {t.result === "open" ? <span className="text-faint">offen</span> : price(t.exit)}
      </span>
    </>
  );
}

/** `{checked}/{items}` – `text-win` when the checklist is complete. */
export function CheckCount({ t }: { t: Pick<EnrichedTrade, "checked" | "items" | "complete"> }) {
  return (
    <span className={t.complete ? "text-win" : "text-mute"}>{`${t.checked}/${t.items.length}`}</span>
  );
}

/** Strength bars of the stored Einstiegs-Check (`Signal-Stärke n von 4`, a dot without one) – table `Check` cell / cards. */
export function SignalBadge({ t, className }: { t: { signal?: unknown }; className?: string }) {
  return <StrengthBars snap={signalOf(t)} className={className} />;
}

/**
 * Signed two-decimal figure in its tone colour (`+12,50` win, `−3,20` loss, `–` for open trades). A trade's P&L and R
 * only change on an edit, so the table renders plain text: no MotionValue, observer or tone layers per cell, and
 * the text is its own accessible name.
 */
function SignedCell({ value, className }: { value: number | null; className?: string }) {
  return <span className={cn("tabular-nums", colorClass(value), className)}>{signed(value)}</span>;
}

/** Table/card P&L: `V.signed(pnl)` | `–`. */
export function PnlCell({ value, className }: { value: number | null; className?: string }) {
  return <SignedCell value={value} className={className} />;
}

/** Table/card R: `V.signed(r)` | `–`. */
export function RCell({ value, className }: { value: number | null; className?: string }) {
  return <SignedCell value={value} className={className} />;
}
