/**
 * „Lücken in den geladenen Reihen“ (F27) under the feed table of the Live-Daten card: for every series the app holds in memory
 * right now (candles per timeframe, open-interest history, the long / short ratios, funding history) how many points there are,
 * how far they reach and whether a stretch is missing – a running display, without a click and without a request. It checks what
 * the app has, not the exchange: a hole can come from a maintenance window, a failed request or a source that has no data there,
 * and the app cannot tell which. It fills nothing.
 *
 * Each row selects only the gap summary of its feed (`useFeedSelect` with an equality check), so a forming candle that ticks every
 * second re-renders nothing.
 */
import { memo, useMemo } from "react";
import { seriesGaps, type SeriesGaps } from "@/domain/missed";
import { cn } from "@/lib/cn";
import { useFeedSelect } from "@/market";
import { ddmmHHmm } from "@/market/format";
import type { FeedId } from "@/market/types";

const MIN = 60_000;
/** Series shown: the feed, and the step between two points when the feed has a fixed one (`undefined` = read from the series). */
export const GAP_SERIES: ReadonlyArray<{ feed: FeedId; step?: number; unit: "Kerzen" | "Punkte" }> = [
  { feed: "kline_1m", step: MIN, unit: "Kerzen" },
  { feed: "kline_15m", step: 15 * MIN, unit: "Kerzen" },
  { feed: "kline_1h", step: 60 * MIN, unit: "Kerzen" },
  { feed: "kline_4h", step: 240 * MIN, unit: "Kerzen" },
  { feed: "kline_1d", step: 1440 * MIN, unit: "Kerzen" },
  { feed: "kline_1w", step: 10080 * MIN, unit: "Kerzen" },
  { feed: "openInterestHist", unit: "Punkte" },
  { feed: "topPositionRatio", unit: "Punkte" },
  { feed: "topAccountRatio", unit: "Punkte" },
  { feed: "globalAccountRatio", unit: "Punkte" },
  { feed: "topPositionRatio5m", unit: "Punkte" },
  { feed: "topAccountRatio5m", unit: "Punkte" },
  { feed: "globalAccountRatio5m", unit: "Punkte" },
  { feed: "fundingHistory", unit: "Punkte" },
];

export const GAP_STRINGS = {
  title: "Lücken in den geladenen Reihen",
  lead: "Geprüft wird, was die App gerade im Speicher hält – nicht die Börse. Ob eine Lücke an der Börse (Wartung, kein Handel), am Abruf oder an der Quelle liegt, kann die App nicht unterscheiden. Sie füllt nichts auf.",
  none: "keine Daten geladen",
} as const;

const same = (a: SeriesGaps, b: SeriesGaps): boolean => a.points === b.points && a.last === b.last && a.first === b.first && a.missing === b.missing && a.gaps.length === b.gaps.length;

/** The summary of one series for the row. */
export function gapSummaryText(g: SeriesGaps, unit: string): string {
  if (g.points === 0) return GAP_STRINGS.none;
  const reach = `${g.points} ${unit} · bis ${g.last != null ? ddmmHHmm(g.last) : "–"}`;
  if (g.stepMs === null) return `${reach} · zu wenig Punkte, um Lücken zu prüfen`;
  if (g.gaps.length === 0) return `${reach} · lückenlos`;
  const newest = g.gaps[g.gaps.length - 1]!;
  return `${reach} · ${g.gaps.length} ${g.gaps.length === 1 ? "Lücke" : "Lücken"}, ${g.missing} ${g.missing === 1 ? "fehlender Eintrag" : "fehlende Einträge"}; jüngste ${ddmmHHmm(newest.from)} bis ${ddmmHHmm(newest.to)}`;
}

const Row = memo(function Row({ feed, label, step, unit }: { feed: FeedId; label: string; step?: number; unit: string }) {
  // each feed's value is an array of `{ time }` rows (candles or points); the selector keeps only the gap summary
  const select = useMemo(() => (v: { data: ReadonlyArray<{ time: number }> } | undefined): SeriesGaps => seriesGaps(v ? v.data.map((p) => p.time) : [], step), [step]);
  const g = useFeedSelect(feed, select as never, same as never) as SeriesGaps;
  const bad = g.gaps.length > 0;
  return (
    <li className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[11rem_1fr]" data-testid={`feed-gaps-${feed}`} data-points={g.points} data-gaps={g.gaps.length} data-missing={g.missing}>
      <span className="text-fg/90">{label}</span>
      <span className={cn("num text-[11.5px]", bad ? "text-warn" : "text-faint")}>{gapSummaryText(g, unit)}</span>
    </li>
  );
});

export function FeedGaps({ labels, className }: { labels: Readonly<Record<FeedId, string>>; className?: string }) {
  return (
    <section className={cn("grid gap-2", className)} aria-label={GAP_STRINGS.title} data-testid="feed-gaps">
      <h3 className="label">{GAP_STRINGS.title}</h3>
      <p className="text-[11.5px] leading-snug text-faint">{GAP_STRINGS.lead}</p>
      <ul className="grid gap-1.5 text-[12px]">
        {GAP_SERIES.map((s) => (
          <Row key={s.feed} feed={s.feed} label={labels[s.feed] ?? s.feed} step={s.step} unit={s.unit} />
        ))}
      </ul>
    </section>
  );
}
