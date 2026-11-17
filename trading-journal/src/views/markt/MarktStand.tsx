/**
 * Source and freshness of the Markt page (trading-desk rule: every market figure names its source and its time):
 * which provider served the candles that the boxes, the key levels and the RSI lines are read from, when they were
 * fetched, and the close of the newest CLOSED candle per timeframe. Missing = "keine Daten", never an estimate.
 * The fetch time is rounded to the minute, so the line re-renders once a minute, not with every forming-candle tick.
 */
import { BOX_TF_LABEL, BOX_TF_MS, type BoxTf } from "@/domain/boxes";
import { useFeedSelect } from "@/market";
import { BOX_FEED, type BoxesView } from "@/market/boxes";
import type { Source } from "@/market/types";
import { SOURCE_LABEL, SourceStand, type StandPart } from "@/ui/SourceStand";

interface Picked {
  source: Source;
  /** fetch time, rounded down to the minute */
  at: number;
}
const MINUTE = 60_000;
const pick = (v: { source: Source; receivedAt: number } | undefined): Picked | null => (v ? { source: v.source, at: Math.floor(v.receivedAt / MINUTE) * MINUTE } : null);
const same = (a: Picked | null, b: Picked | null): boolean => a === b || (!!a && !!b && a.source === b.source && a.at === b.at);

const TFS: readonly BoxTf[] = ["4h", "1d", "1w"];

export function MarktStand({ view, className }: { view: BoxesView; className?: string }) {
  const h4 = useFeedSelect(BOX_FEED["4h"], pick, same);
  const d1 = useFeedSelect(BOX_FEED["1d"], pick, same);
  const w1 = useFeedSelect(BOX_FEED["1w"], pick, same);
  if (view.state === "off") return null;
  const stamps = [h4, d1, w1].filter((p): p is Picked => p != null);
  // the newest fetch names the source; with several sources in play (a fallback served one timeframe) say so
  const sources = [...new Set(stamps.map((s) => SOURCE_LABEL[s.source]))];
  const fetched = stamps.length ? Math.max(...stamps.map((s) => s.at)) : null;
  const parts: StandPart[] = [
    { label: "Abruf", at: fetched },
    ...TFS.map((tf) => {
      const closed = view.tfs[tf].closedAt;
      return { label: `letzter Schluss ${BOX_TF_LABEL[tf]}`, at: closed != null ? closed + BOX_TF_MS[tf] : null };
    }),
  ];
  return <SourceStand source={sources.length ? sources.join(" + ") : null} parts={parts} className={className} testId="markt-stand" />;
}
