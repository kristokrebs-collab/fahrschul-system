import { animate, motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { FeedId, HealthState, ProviderHealth, Source, StatusLabel } from "@/market/types";
import { IS_FILE_BUILD } from "@/edition";
import { cn } from "@/lib/cn";
import { time } from "@/lib/format";
import { canObserveInView, useFirstInView } from "@/motion/inView";
import { StatusPill, type StatusTone } from "@/motion/StatusPill";
import { Switch } from "@/motion/Switch";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { useUi } from "@/store/uiStore";
import { ActionButton, GlyphLink, GlyphRefresh, GlyphTrash } from "./fx";

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
  /** Single-file builds: no Netlify function, so no EU proxy. */
  fileHint: "In dieser Datei laufen die Live-Daten ohne Key direkt vom Browser zu Binance. Blockiert Binance die Region, springt der Provider auf Bybit/OKX.",
  overall: "Gesamtstatus",
  online: "Online",
  offline: "Offline",
} as const;

export const FEED_LABELS: Record<FeedId, string> = {
  kline_1m: "Kerzen 1m",
  kline_15m: "Kerzen 15m",
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
 * One `Stand` cell: whenever the feed delivers (`lastDataAt` moves) a soft white wash flashes behind the time and
 * decays on `tween.flash` – live feeds visibly tick about once a second. Opacity of a pre-rendered layer only;
 * off under reduced motion.
 */
function StandCell({ at }: { at?: number }) {
  const reduced = useReducedFx();
  const wash = useRef<HTMLSpanElement>(null);
  const last = useRef(at);
  useEffect(() => {
    if (last.current === at) return;
    last.current = at;
    if (reduced || at === undefined || !wash.current) return;
    const controls = animate(wash.current, { opacity: [1, 0] }, tween.flash);
    return () => controls.stop();
  }, [at, reduced]);
  return (
    <span className="relative inline-block">
      <span ref={wash} aria-hidden="true" className="pointer-events-none absolute -inset-x-1.5 -inset-y-0.5 rounded-md bg-white/[0.1] opacity-0" />
      <span className="relative">{at ? time(new Date(at)) : "–"}</span>
    </span>
  );
}

/**
 * NEW `Live-Daten` card (Plan 6.4): feed table `Feed | Quelle | Stand | Status` from the health
 * snapshot, `Jetzt aktualisieren` / `Jetzt neu verbinden` / `Cache leeren`, and the `tj2-ui`
 * preferences `topTraderBase` (never `settings.hyblock.longEndpoint`, Plan 4.8), `sparkline`, `useProxy`.
 *
 * Motion: the feed rows cascade in the first time the table is on screen (`stagger.rows`), every `Stand` cell
 * flashes when its feed delivers, the actions turn their icon into a spinner (refresh: the arrow itself spins)
 * and then a drawn ✓, and the proxy preference is an elastic `Switch`.
 */
export function LiveDataCard({ health, statusLabels, onRefresh, onReconnect, onClearCache, className }: LiveDataCardProps) {
  const topTraderBase = useUi((s) => s.topTraderBase);
  const sparkline = useUi((s) => s.sparkline);
  const useProxy = useUi((s) => s.useProxy);
  const setPref = useUi((s) => s.setPref);
  const reduced = useReducedFx();
  const reveal = !reduced && canObserveInView();
  const tableRef = useRef<HTMLDivElement>(null);
  const seen = useFirstInView(tableRef, reveal);

  const feeds = health ? (Object.values(health.feeds) as ProviderHealth["feeds"][FeedId][]) : [];

  return (
    <Card title={LIVE_STRINGS.title} note={LIVE_STRINGS.note} className={className}>
      {health ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-[12.5px] text-mute">
            <span className="inline-flex items-center gap-2">
              {/* reserves the longest overall label (`Ersatzquelle`), so the texts after it never jump when it changes */}
              <span className="inline-flex min-w-[7.25rem]">
                <StatusPill tone={toneOfState(health.overall)} label={STATE_LABELS[health.overall]} expanded />
              </span>
              <span className="label !text-[9.5px]">{LIVE_STRINGS.overall}</span>
            </span>
            <span>{health.online ? LIVE_STRINGS.online : LIVE_STRINGS.offline}</span>
            <span className="font-mono text-[11.5px] text-faint">{LIVE_STRINGS.reconnects(health.ws.attempt)}</span>
          </div>
          {/* below sm the rows stack (feed + status, then source · Stand) – no sideways scroll on phones */}
          <div ref={tableRef} className="rounded-xl border border-line sm:overflow-x-auto">
            <table className="w-full text-left text-[12.5px] max-sm:block">
              <thead className="max-sm:hidden">
                <tr className="border-b border-line">
                  {(["feed", "source", "asOf", "status"] as const).map((c) => (
                    // ST-02: the status column reserves the longest pill (`Zuletzt 01:39 · veraltet`), so a label that
                    // grows never re-flows the table mid-morph (the other columns stay put)
                    <th key={c} scope="col" className={cn("label !text-faint px-3 py-2 tracking-[0.1em]", c === "status" && "min-w-[12rem]")}>
                      {LIVE_STRINGS.columns[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="max-sm:block">
                {feeds.map((f, i) => {
                  const label = statusLabels?.[f.feed];
                  const delay = Math.min(i, stagger.max) * stagger.rows;
                  return (
                    <motion.tr
                      key={f.feed}
                      className="border-b border-line/60 last:border-b-0 max-sm:grid max-sm:grid-cols-[auto_minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-0.5 max-sm:px-3 max-sm:py-2"
                      initial={reveal ? { opacity: 0, y: 4 } : false}
                      animate={seen ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
                      transition={{ default: { ...tween.reveal, delay }, y: { ...spring.enter, delay } }}
                    >
                      <td className="px-3 py-1.5 text-fg/90 max-sm:col-span-2 max-sm:col-start-1 max-sm:row-start-1 max-sm:min-w-0 max-sm:p-0">{FEED_LABELS[f.feed]}</td>
                      <td className="px-3 py-1.5 text-mute max-sm:col-start-1 max-sm:row-start-2 max-sm:min-w-0 max-sm:p-0 max-sm:text-[11.5px]">{SOURCE_LABELS[f.source]}</td>
                      <td className="num px-3 py-1.5 font-mono text-mute max-sm:col-start-2 max-sm:row-start-2 max-sm:p-0 max-sm:text-[11.5px]">
                        <StandCell at={f.lastDataAt} />
                      </td>
                      <td className="px-3 py-1.5 max-sm:col-start-3 max-sm:row-span-2 max-sm:row-start-1 max-sm:justify-self-end max-sm:p-0" title={label?.detail ?? f.detail}>
                        <StatusPill tone={label?.tone ?? toneOfState(f.state)} label={label?.text ?? STATE_LABELS[f.state]} expanded />
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-line-2 p-4 text-[12.5px] text-mute">{LIVE_STRINGS.noHealth}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2 pointer-coarse:gap-3.5">
        <ActionButton size="sm" icon={<GlyphRefresh />} spinIcon onRun={onRefresh}>
          {LIVE_STRINGS.refresh}
        </ActionButton>
        <ActionButton size="sm" icon={<GlyphLink />} onRun={onReconnect}>
          {LIVE_STRINGS.reconnect}
        </ActionButton>
        <ActionButton size="sm" icon={<GlyphTrash />} onRun={onClearCache}>
          {LIVE_STRINGS.clearCache}
        </ActionButton>
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

      {!IS_FILE_BUILD && health?.proxy.usable === true && (
        <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5">
          <span className="grid gap-0.5">
            <label htmlFor="live-proxy" className="cursor-pointer text-[13px] text-fg">
              {LIVE_STRINGS.proxy}
            </label>
            <span id="live-proxy-help" className="text-[11px] text-faint">
              {LIVE_STRINGS.proxyHelp}
            </span>
          </span>
          <Switch id="live-proxy" className="touch-hit shrink-0" checked={useProxy} onCheckedChange={(on) => setPref("useProxy", on)} aria-describedby="live-proxy-help" />
        </div>
      )}

      <p className="mt-4 text-[12px] text-faint">{IS_FILE_BUILD ? LIVE_STRINGS.fileHint : LIVE_STRINGS.netlifyHint}</p>
    </Card>
  );
}
