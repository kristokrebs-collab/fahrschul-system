/**
 * Cell fragments shared by `TradesTable` and `TradesCards` – class strings 1:1 from the bundle (`H$`, `iT`, `oT`).
 */
import type { EnrichedTrade, Setup } from "@/domain/types";
import { RESULT_LABELS, RESULT_TONES } from "@/domain/defaults";
import { cn } from "@/lib/cn";
import { tradeTime } from "@/lib/dates";
import { date, n1, price, signed, time } from "@/lib/format";
import { MotionNumber } from "@/motion/MotionNumber";
import { Badge, SetupChips } from "@/primitives";

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

/** `V.price(entry) → V.price(exit)` | `offen`. */
export function EntryExit({ t }: { t: Pick<EnrichedTrade, "entry" | "exit" | "result"> }) {
  return (
    <>
      {price(t.entry)}
      {" → "}
      {t.result === "open" ? <span className="text-faint">offen</span> : price(t.exit)}
    </>
  );
}

/** `{checked}/{items}` – `text-win` when the checklist is complete. */
export function CheckCount({ t }: { t: Pick<EnrichedTrade, "checked" | "items" | "complete"> }) {
  return (
    <span className={t.complete ? "text-win" : "text-mute"}>{`${t.checked}/${t.items.length}`}</span>
  );
}

/** Table P&L: `MotionNumber` (animates only while visible) or `–`; `aria-label` keeps the exact bundle string. */
export function PnlCell({ value, gate = true, className }: { value: number | null; gate?: boolean; className?: string }) {
  if (value == null) return <span className={cn("text-fg", className)}>–</span>;
  return <MotionNumber value={value} decimals={2} signed tone="auto" gate={gate} aria-label={signed(value)} className={className} />;
}

/** Table R: `V.signed(r)` | `–`. */
export function RCell({ value, gate = true }: { value: number | null; gate?: boolean }) {
  if (value == null) return <span className="text-fg">–</span>;
  return <MotionNumber value={value} decimals={2} signed tone="auto" gate={gate} aria-label={signed(value)} />;
}
