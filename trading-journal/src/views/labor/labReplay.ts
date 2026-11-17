/**
 * Pure replay model of a backtest trade (P07): the bars of the run around the trade (entry − N … exit + N, the same
 * padding rule as the journal replay), its indices in that window, the running excursion (`replaySteps`) and the
 * timeline spans – fed to the journal's `ReplayChart` + `ScrubTimeline`.
 */
import type { ReplayBar, ReplayTrade } from "@/chart/ReplayChart";
import type { Bar, BtTrade } from "@/domain/backtest/index";
import { replaySteps, type ReplayStep } from "@/domain/excursion";
import type { ScrubMarker, ScrubSpan } from "@/motion/pulse/ScrubTimeline";
import { padBars } from "@/views/trades/replay/replayModel";

export interface LabReplayModel {
  bars: ReplayBar[];
  trade: ReplayTrade;
  steps: ReplayStep[];
  spans: ScrubSpan[];
  markers: ScrubMarker[];
  total: number;
}

export function labReplayModel(t: BtTrade, bars: readonly Bar[], intervalMs: number): LabReplayModel | null {
  if (!bars.length || t.entryIndex < 0 || t.exitIndex >= bars.length || t.exitIndex < t.entryIndex) return null;
  const pad = padBars(t.exitIndex - t.entryIndex + 1);
  const from = Math.max(0, t.entryIndex - pad);
  const to = Math.min(bars.length - 1, t.exitIndex + pad);
  const win: ReplayBar[] = bars.slice(from, to + 1).map((b) => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c }));
  const entryIndex = t.entryIndex - from;
  const exitIndex = t.exitIndex - from;
  const result = t.pnl > 0 ? "win" : t.pnl < 0 ? "loss" : "be";
  const steps = replaySteps(win, { side: t.side, entry: t.entry, stop: t.stop, exit: t.exit, from: t.entryTime, to: t.exitTime - 1, intervalMs });
  const total = win.length;
  const tone = result === "win" ? "win" : result === "loss" ? "loss" : "fg";
  const spans: ScrubSpan[] = [
    { id: "before", label: "Vorlauf", start: 0, duration: entryIndex + 1, tone: "mute" },
    { id: "trade", label: "Im Trade", start: entryIndex + 1, duration: Math.max(1, exitIndex - entryIndex), tone, meta: `${t.r > 0 ? "+" : ""}${t.r.toFixed(2).replace(".", ",")} R` },
  ];
  if (exitIndex < total - 1) spans.push({ id: "after", label: "Danach", start: exitIndex + 1, duration: total - exitIndex - 1, tone: "mute" });
  const markers: ScrubMarker[] = [
    { at: entryIndex + 1, label: "Einstieg", tone: "fg" },
    { at: exitIndex + 1, label: "Ausstieg", tone: tone === "fg" ? "mute" : tone },
  ];
  return { bars: win, trade: { side: t.side, entry: t.entry, stop: t.stop, target: t.target, exit: t.exit, entryIndex, exitIndex, result }, steps, spans, markers, total };
}
