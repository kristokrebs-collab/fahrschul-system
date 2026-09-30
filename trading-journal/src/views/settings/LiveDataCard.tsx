import { useState } from "react";
import type { FeedId, HealthState, ProviderHealth, Source, StatusLabel } from "@/market/types";
import { cn } from "@/lib/cn";
import { time } from "@/lib/format";
import { StatusPill, type StatusTone } from "@/motion/StatusPill";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { CheckboxRow } from "@/primitives/CheckboxRow";
import { Segmented } from "@/primitives/Segmented";
import { useUi } from "@/store/uiStore";

export const LIVE_STRINGS = {
  title: "Live-Daten",
  note: "Binance ohne Key, direkt aus dem Browser. Jeder Status ist ehrlich gelabelt.",
  columns: { feed: "Feed", source: "Quelle", asOf: "Stand", status: "Status" } as const,
  refresh: "Jetzt aktualisieren",
  reconnect: "Jetzt neu verbinden",
  clearCache: "Cache leeren",
  topTraderBase: "Top-Trader-Basis",
  accounts: "Konten",
  positions: "Positionen",
  sparkline: "Sparkline",
  readings: "Ablesungen",
  live: "Live",
  proxy: "EU-Proxy verwenden",
  proxyHelp: "Nur wenn Binance die Region blockiert (451). Läuft über die Netlify-Function.",
  noHealth: "Noch keine Statusdaten. Der Provider startet mit der Übersicht.",
  reconnects: (n: number) => `WS-Reconnects: ${n}`,
  netlifyHint: "Auf Netlify laufen die Live-Daten ohne Key vom Browser zu Binance. Blockiert Binance die Region, springt der Provider auf Bybit/OKX oder den EU-Proxy und zeigt es an.",
  overall: "Gesamtstatus",
  online: "Online",
  offline: "Offline",
} as const;

export const FEED_LABELS: Record<FeedId, string> = {
  kline_1m: "Kerzen 1m",
  kline_1h: "Kerzen 1h",
  kline_4h: "Kerzen 4h",
  kline_1w: "Kerzen 1W",
  markPrice: "Mark-Preis",
  bookTop: "Orderbuch",
  aggTrade: "Trades",
  ticker24h: "24h-Ticker",
  openInterest: "Open Interest",
  openInterestHist: "OI-Verlauf",
  topPositionRatio: "Top-Trader Positionen",
  topAccountRatio: "Top-Trader Konten",
  globalAccountRatio: "Alle Konten",
  takerRatio: "Taker-Ratio",
  fundingHistory: "Funding",
};

const SOURCE_LABELS: Record<Source, string> = { binance: "Binance", bybit: "Bybit", okx: "OKX", proxy: "EU-Proxy", tradingview: "TradingView", cache: "Cache" };

export const STATE_LABELS: Record<HealthState, string> = { connecting: "Verbinde …", live: "Live", stale: "Veraltet", fallback: "Ersatzquelle", offline: "Offline" };

export function toneOfState(state: HealthState): StatusTone {
  switch (state) {
    case "live":
      return "live";
    case "stale":
    case "fallback":
      return "warn";
    case "offline":
      return "error";
    default:
      return "muted";
  }
}

export interface LiveDataCardProps {
  /** `provider.getHealth()` snapshot; wiring is done by the integrator. */
  health?: ProviderHealth | null;
  /** Optional per-feed labels from `provider.statusLabel(feed)`; falls back to `STATE_LABELS`. */
  statusLabels?: Partial<Record<FeedId, StatusLabel>>;
  onRefresh?: () => void | Promise<void>;
  onReconnect?: () => void | Promise<void>;
  onClearCache?: () => void | Promise<void>;
  className?: string;
}

/**
 * NEW `Live-Daten` card (Plan 6.4): feed table `Feed | Quelle | Stand | Status` from the health
 * snapshot, `Jetzt aktualisieren` / `Jetzt neu verbinden` / `Cache leeren`, and the `tj2-ui`
 * preferences `topTraderBase` (never `settings.hyblock.longEndpoint`, Plan 4.8), `sparkline`, `useProxy`.
 */
export function LiveDataCard({ health, statusLabels, onRefresh, onReconnect, onClearCache, className }: LiveDataCardProps) {
  const topTraderBase = useUi((s) => s.topTraderBase);
  const sparkline = useUi((s) => s.sparkline);
  const useProxy = useUi((s) => s.useProxy);
  const setPref = useUi((s) => s.setPref);
  const [refreshing, setRefreshing] = useState(false);

  async function run(fn?: () => void | Promise<void>) {
    if (!fn) return;
    setRefreshing(true);
    try {
      await fn();
    } finally {
      setRefreshing(false);
    }
  }

  const feeds = health ? (Object.values(health.feeds) as ProviderHealth["feeds"][FeedId][]) : [];

  return (
    <Card title={LIVE_STRINGS.title} note={LIVE_STRINGS.note} className={className}>
      {health ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-[12.5px] text-mute">
            <span className="inline-flex items-center gap-2">
              <StatusPill tone={toneOfState(health.overall)} label={STATE_LABELS[health.overall]} expanded />
              <span className="label !text-[9.5px]">{LIVE_STRINGS.overall}</span>
            </span>
            <span>{health.online ? LIVE_STRINGS.online : LIVE_STRINGS.offline}</span>
            <span className="font-mono text-[11.5px] text-faint">{LIVE_STRINGS.reconnects(health.ws.attempt)}</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-line">
                  {(["feed", "source", "asOf", "status"] as const).map((c) => (
                    <th key={c} scope="col" className="label !text-faint px-3 py-2 tracking-[0.1em]">
                      {LIVE_STRINGS.columns[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {feeds.map((f) => {
                  const label = statusLabels?.[f.feed];
                  return (
                    <tr key={f.feed} className="border-b border-line/60 last:border-b-0">
                      <td className="px-3 py-1.5 text-fg/90">{FEED_LABELS[f.feed]}</td>
                      <td className="px-3 py-1.5 text-mute">{SOURCE_LABELS[f.source]}</td>
                      <td className="num px-3 py-1.5 font-mono text-mute">{f.lastDataAt ? time(new Date(f.lastDataAt)) : "–"}</td>
                      <td className="px-3 py-1.5" title={label?.detail ?? f.detail}>
                        <StatusPill tone={label?.tone ?? toneOfState(f.state)} label={label?.text ?? STATE_LABELS[f.state]} expanded />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-line-2 p-4 text-[12.5px] text-mute">{LIVE_STRINGS.noHealth}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => run(onRefresh)} disabled={!onRefresh || refreshing} aria-busy={refreshing || undefined}>
          {LIVE_STRINGS.refresh}
        </Button>
        <Button size="sm" onClick={() => run(onReconnect)} disabled={!onReconnect}>
          {LIVE_STRINGS.reconnect}
        </Button>
        <Button size="sm" onClick={() => run(onClearCache)} disabled={!onClearCache}>
          {LIVE_STRINGS.clearCache}
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <span id="live-base-label" className="label">
            {LIVE_STRINGS.topTraderBase}
          </span>
          <Segmented
            aria-labelledby="live-base-label"
            size="sm"
            value={topTraderBase}
            onChange={(v) => setPref("topTraderBase", v)}
            options={[
              { v: "accounts", label: LIVE_STRINGS.accounts },
              { v: "positions", label: LIVE_STRINGS.positions },
            ]}
          />
        </div>
        <div className="grid gap-1.5">
          <span id="live-spark-label" className="label">
            {LIVE_STRINGS.sparkline}
          </span>
          <Segmented
            aria-labelledby="live-spark-label"
            size="sm"
            value={sparkline}
            onChange={(v) => setPref("sparkline", v)}
            options={[
              { v: "readings", label: LIVE_STRINGS.readings },
              { v: "live", label: LIVE_STRINGS.live },
            ]}
          />
        </div>
      </div>

      {health?.proxy.usable === true && (
        <div className={cn("mt-3")}>
          <CheckboxRow checked={useProxy} onToggle={() => setPref("useProxy", !useProxy)} sub={LIVE_STRINGS.proxyHelp}>
            {LIVE_STRINGS.proxy}
          </CheckboxRow>
        </div>
      )}

      <p className="mt-4 text-[12px] text-faint">{LIVE_STRINGS.netlifyHint}</p>
    </Card>
  );
}
