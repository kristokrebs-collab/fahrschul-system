/**
 * SourceStand – the one calm line that names where a card's market figures come from and how fresh they are
 * ("Quelle: Binance USDⓈ-M · Abruf 25.10. 01:35 · letzter Schluss 4h 24.10. 23:59"). A missing time is said as
 * "keine Daten" – never estimated, never filled in. Pure presentation: the caller passes the label of the source and
 * the timestamps it really has (`Stamped.source` / `asOf` / `receivedAt` of the feed, `from` / `to` of a lab run).
 */
import { cn } from "@/lib/cn";
import { date, time } from "@/lib/format";
import { ddmmHHmm } from "@/market/format";
import type { Source } from "@/market/types";

export interface StandPart {
  /** "Abruf", "letzter Schluss 4h", "Zeitraum bis" … */
  label: string;
  /** epoch ms, or `null` / `undefined` = no data */
  at: number | null | undefined;
  /** `long` adds the year (`dd.MM.yy HH:mm`, for periods that span months or years); default = `dd.MM. HH:mm` */
  long?: boolean;
}

interface Props {
  /** name of the data source; `null` = there is none yet ("keine Daten") */
  source: string | null;
  parts?: readonly StandPart[];
  className?: string;
  testId?: string;
}

export const NO_DATA = "keine Daten";

/** Name of a feed's source as the trader knows it (`Stamped.source` says who really served the data). */
export const SOURCE_LABEL: Readonly<Record<Source, string>> = {
  binance: "Binance USDⓈ-M",
  proxy: "Binance USDⓈ-M (EU-Proxy)",
  bybit: "Bybit (Ersatzquelle)",
  okx: "OKX (Ersatzquelle)",
  tradingview: "TradingView",
  cache: "Zwischenspeicher dieses Browsers",
};

/** The text of the line (exported for tests and for places that need the bare string). */
export function standText(source: string | null, parts: readonly StandPart[] = []): string {
  const bits = [`Quelle: ${source ?? NO_DATA}`, ...parts.map((p) => `${p.label} ${p.at != null && Number.isFinite(p.at) ? (p.long ? `${date(new Date(p.at))} ${time(new Date(p.at))}` : ddmmHHmm(p.at)) : NO_DATA}`)];
  return bits.join(" · ");
}

export function SourceStand({ source, parts, className, testId = "source-stand" }: Props) {
  return (
    <p className={cn("num text-[12px] leading-relaxed text-mute", className)} data-testid={testId}>
      {standText(source, parts)}
    </p>
  );
}
