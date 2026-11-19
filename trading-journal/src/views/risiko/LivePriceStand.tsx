/**
 * Source and time of the calculator's live price (F27): „Quelle: Binance USDⓈ-M · letzter Kurs 26.10. 14:03“. The live price is
 * the last trade of the provider's feed (`aggTrade`, the 24h ticker as fallback – the same two feeds that drive `priceMv`), so the
 * line reads the newest of the two. The time is rounded down to the minute: the line re-renders once a minute, not with every
 * trade. When no price has arrived it says „keine Daten“ – the price pill above is then empty as well, nothing is estimated.
 */
import { useFeedSelect } from "@/market";
import type { Source } from "@/market/types";
import { SOURCE_LABEL, SourceStand } from "@/ui/SourceStand";

interface Picked {
  source: Source;
  at: number;
}
const MINUTE = 60_000;
const pick = (v: { source: Source; receivedAt: number } | undefined): Picked | null => (v ? { source: v.source, at: Math.floor(v.receivedAt / MINUTE) * MINUTE } : null);
const same = (a: Picked | null, b: Picked | null): boolean => a === b || (!!a && !!b && a.source === b.source && a.at === b.at);

export function LivePriceStand({ className }: { className?: string }) {
  const trade = useFeedSelect("aggTrade", pick, same);
  const ticker = useFeedSelect("ticker24h", pick, same);
  const newest = trade && ticker ? (ticker.at > trade.at ? ticker : trade) : (trade ?? ticker);
  return <SourceStand source={newest ? SOURCE_LABEL[newest.source] : null} parts={[{ label: "letzter Kurs", at: newest?.at ?? null }]} className={className} testId="risk-live-stand" />;
}
