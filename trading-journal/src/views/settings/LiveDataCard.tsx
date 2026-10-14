import { animate, motion, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import type { FeedHealth, FeedId, HealthState, ProviderHealth, Source, StatusLabel } from "@/market/types";
import { BINANCE_FAMILY_FEEDS, WS_FEEDS } from "@/market/feeds";
import { mmss } from "@/market/mapping";
import { skewText } from "@/market/clock";
import { SOFT_FAILURE_TEXT } from "@/market/statusLabel";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { cn } from "@/lib/cn";
import { time } from "@/lib/format";
import { useNowMv } from "@/motion/clock";
import { canObserveInView, useFirstInView } from "@/motion/inView";
import { StatusPill, type StatusTone } from "@/motion/StatusPill";
import { Switch } from "@/motion/Switch";
import { spring, stagger, tween } from "@/motion/tokens";
import { useMediaQuery } from "@/motion/useMediaQuery";
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
  proxyHelp: "Holt die Binance-Top-Trader-Daten über diese Seite (Netlify-Proxy) statt direkt – hilft, wenn der Browser Binance nicht lesen darf (CORS) oder die Region blockiert ist.",
  noHealth: "Noch keine Statusdaten. Der Provider startet mit der Übersicht.",
  reconnects: (n: number) => `WS-Reconnects: ${n}`,
  netlifyHint: "Auf Netlify laufen die Live-Daten ohne Key vom Browser zu Binance. Blockiert Binance die Region, springt der Provider auf Bybit/OKX oder den EU-Proxy und zeigt es an.",
  /** Single-file builds: no Netlify function, so no EU proxy. */
  fileHint: "In dieser Datei laufen die Live-Daten ohne Key direkt vom Browser zu Binance. Blockiert Binance die Region, springt der Provider auf Bybit/OKX.",
  overall: "Gesamtstatus",
  online: "Online",
  offline: "Offline",
  binanceOk: "Binance erreichbar",
  binanceUnknown: "Binance: wird geprüft",
  binanceBlocked: (next?: string) => `Binance blockiert (Region)${next ? ` · neuer Versuch ${next}` : ""}`,
  binanceDown: "Binance antwortet nicht",
  proxyOk: "EU-Proxy bereit",
  proxyOff: "EU-Proxy nicht erreichbar",
  proxyBlocked: "EU-Proxy: Region blockiert (451)",
  proxyFile: "Kein EU-Proxy in der Datei-Version",
  nextData: "nächste Daten",
  nextRetry: "neuer Versuch",
  running: "läuft …",
  loading: "lädt …",
  connecting: "Verbinde …",
  stream: "Stream",
  streamStale: "Stream stockt",
  streamDown: "Stream getrennt",
  lastData: "Daten",
  fromCache: "aus dem Cache",
  viaRest: "per REST (Stream aus)",
  via: "über",
  onlyBinance: "Nur mit Binance",
  bookTopOptIn: "Nur solange die Bid/Ask-Kachel sichtbar ist",
  failures: (n: number) => `${n}× in Folge`,
  /** single-file build opened from disk: the browser may not read Binance's futures data there */
  fileCors: "Datei-Version: liest der Browser die Binance-Top-Trader-Daten nicht (CORS), den Web-Link öffnen – dort läuft der EU-Proxy.",
} as const;

export const FEED_LABELS: Record<FeedId, string> = {
  kline_1m: "Kerzen 1m",
  kline_15m: "Kerzen 15m",
  kline_1h: "Kerzen 1h",
  kline_4h: "Kerzen 4h",
  kline_1w: "Kerzen 1W",
  kline_1d: "Kerzen 1D",
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
  topPositionRatio5m: "Top-Trader Positionen · 5 min",
  topAccountRatio5m: "Top-Trader Konten · 5 min",
  globalAccountRatio5m: "Alle Konten · 5 min",
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

const at = (ms?: number): string => (ms ? time(new Date(ms)) : "");

/**
 * Per-feed freshness under the feed name (decision 14), next to the row's `Stand` (time of the newest data): when the
 * next data comes — `nächste Daten in 3:12` (REST), `Stream · Daten vor 2 s` (WebSocket), the cause while a poll fails
 * (`Netzwerk/CORS-Fehler (…) · 2× in Folge · neuer Versuch in 0:28`), `Stream getrennt · neuer Versuch in 0:04`, `Offline`.
 * The countdown / age is a separate segment rendered on the shared second clock (fixed width, no React render per
 * second, no column re-flow); the static part changes only with the health.
 */
export type FeedLineDynamic =
  /** `{label} in m:ss` until `to` (device clock); `expired` once it ran out */
  | { kind: "countdown"; to: number; label: string; expired: string }
  /** age of the data at `from` (exchange clock; `skewMs` = server − device) */
  | { kind: "age"; from: number; skewMs: number };

export interface FeedLine {
  /** text before the dynamic segment */
  lead: string;
  dynamic?: FeedLineDynamic;
  tone: "faint" | "warn" | "error";
}

export interface FeedLineCtx {
  transport: "ws" | "rest";
  online: boolean;
  ws?: Partial<ProviderHealth["ws"]>;
  primary?: Partial<ProviderHealth["primary"]>;
  skewMs?: number;
}

const SEP = " · ";
const join = (...parts: (string | null | undefined | false)[]): string => parts.filter(Boolean).join(SEP);

/** The changing number: `3:12` (countdown), `2 s` / `3 min` / `2 h` (age); `""` once a countdown ran out. */
export function dynamicValue(d: FeedLineDynamic, now: number): string {
  if (d.kind === "countdown") {
    const left = d.to - now;
    if (left <= 0) return "";
    // funding (8 h) and other long waits: `5 h 59 min` instead of `359:59`
    if (left >= 3_600_000) {
      const min = Math.ceil(left / 60_000);
      return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
    }
    return mmss(left);
  }
  const age = Math.max(0, Math.round((now + d.skewMs - d.from) / 1000));
  if (age < 60) return `${age} s`;
  if (age < 3600) return `${Math.floor(age / 60)} min`;
  return `${Math.floor(age / 3600)} h`;
}

/** The words before the number: `nächste Daten in ` / `vor `; a countdown that ran out reads `lädt …` / `läuft …`. */
export function dynamicLabel(d: FeedLineDynamic, now: number): string {
  if (d.kind === "age") return "vor ";
  return d.to - now > 0 ? `${d.label} in ` : d.expired;
}

/** `nächste Daten in 3:12` / `lädt …` / `vor 2 s`. */
export function dynamicText(d: FeedLineDynamic, now: number): string {
  return `${dynamicLabel(d, now)}${dynamicValue(d, now)}`;
}

/** Whole line as plain text (tests, title attribute). */
export function feedLineText(l: FeedLine, now: number): string {
  return l.dynamic ? `${l.lead}${dynamicText(l.dynamic, now)}` : l.lead;
}

const countdown = (to: number | undefined, lead: string, label: string, expired: string): Pick<FeedLine, "lead" | "dynamic"> =>
  to === undefined ? { lead } : { lead: lead ? `${lead}${SEP}` : "", dynamic: { kind: "countdown", to, label, expired } };
const nextData = (to: number | undefined, lead: string) => countdown(to, lead, LIVE_STRINGS.nextData, LIVE_STRINGS.loading);
const retryAt = (to: number | undefined, lead: string) => countdown(to, lead, LIVE_STRINGS.nextRetry, `${LIVE_STRINGS.nextRetry} ${LIVE_STRINGS.running}`);

/**
 * The freshness line of one feed. REST feeds: newest point (`Stand`) and the next poll; WebSocket feeds: the stream's
 * age, or the REST fallback / reconnect countdown; any failing feed: cause, count, retry.
 */
export function feedLine(f: FeedHealth, ctx: FeedLineCtx): FeedLine {
  // the row's `Stand` column already shows the time of the newest data: the line says what comes next / what is wrong
  if (!ctx.online) return { lead: LIVE_STRINGS.offline, tone: "error" };
  const soft = f.reason ? SOFT_FAILURE_TEXT[f.reason] : undefined;
  if (f.consecutiveFailures > 0 && soft) {
    return { ...retryAt(f.nextRefreshAt, join(`${soft}${f.detail ? ` (${f.detail})` : ""}`, LIVE_STRINGS.failures(f.consecutiveFailures))), tone: "warn" };
  }
  if (f.reason === "unsupported") return { ...retryAt(ctx.primary?.nextProbeAt, f.detail ?? LIVE_STRINGS.onlyBinance), tone: "faint" };
  if (f.reason === "bad_period" || f.reason === "bad_symbol" || f.reason === "beyond_retention") return { lead: f.detail ?? STATE_LABELS[f.state], tone: "warn" };
  if (f.reason === "blocked_451") return { ...retryAt(ctx.primary?.nextProbeAt, LIVE_STRINGS.binanceBlocked()), tone: "warn" };
  const stale = f.state === "stale";
  const streamed = ctx.transport === "ws" && f.state !== "fallback" && f.source === "binance";
  if (streamed) {
    if (f.lastDataAt === undefined) {
      if (f.feed === "bookTop") return { lead: LIVE_STRINGS.bookTopOptIn, tone: "faint" };
      return ctx.ws?.nextRetryAt !== undefined && ctx.ws.state !== "live" ? { ...retryAt(ctx.ws.nextRetryAt, LIVE_STRINGS.streamDown), tone: "warn" } : { lead: LIVE_STRINGS.connecting, tone: "faint" };
    }
    if (ctx.ws?.state !== "live" && ctx.ws?.nextRetryAt !== undefined) return { ...retryAt(ctx.ws.nextRetryAt, LIVE_STRINGS.streamDown), tone: "warn" };
    return { lead: `${join(stale ? LIVE_STRINGS.streamStale : LIVE_STRINGS.stream, LIVE_STRINGS.lastData)} `, dynamic: { kind: "age", from: f.lastDataAt, skewMs: ctx.skewMs ?? 0 }, tone: stale ? "warn" : "faint" };
  }
  // polled (REST feeds, a WebSocket feed in its REST fallback, a fallback source)
  const via = ctx.transport === "ws" && f.source === "binance" ? LIVE_STRINGS.viaRest : f.source !== "binance" && f.source !== "cache" ? `${LIVE_STRINGS.via} ${SOURCE_LABELS[f.source]}` : null;
  if (f.lastDataAt === undefined) return { ...nextData(f.nextRefreshAt, join(LIVE_STRINGS.loading, via)), tone: "faint" };
  if (f.source === "cache") return { lead: join(LIVE_STRINGS.fromCache, stale && STATE_LABELS.stale.toLowerCase()), tone: stale ? "warn" : "faint" };
  return { ...nextData(f.nextRefreshAt, join(stale && STATE_LABELS.stale.toLowerCase(), via)), tone: stale ? "warn" : "faint" };
}

const LINE_TONE: Record<FeedLine["tone"], string> = { faint: "text-faint", warn: "text-warn", error: "text-loss" };

/**
 * The dynamic segment, driven by `nowMv` (no React render per second): the words change only when a countdown runs
 * out, the number sits in a fixed-width tabular slot so the line (and the table column) never re-flows per second.
 */
function DynamicSegment({ d }: { d: FeedLineDynamic }) {
  const now = useNowMv();
  const label = useTransform(now, (n) => dynamicLabel(d, n));
  const value = useTransform(now, (n) => dynamicValue(d, n));
  return (
    <>
      <motion.span>{label}</motion.span>
      <motion.span className="inline-block min-w-[4.5ch] tabular-nums">{value}</motion.span>
    </>
  );
}

function FeedLineView({ line }: { line: FeedLine }) {
  return (
    <span data-feed-detail className={cn("block text-[11px] leading-snug transition-colors duration-300", LINE_TONE[line.tone])}>
      {line.lead}
      {line.dynamic && <DynamicSegment d={line.dynamic} />}
    </span>
  );
}

/** `Binance erreichbar` / `Binance blockiert (Region) · neuer Versuch 14:35` / proxy state — one line above the table. */
export function routeLine(health: ProviderHealth): string[] {
  const out: string[] = [];
  const p = health.primary;
  if (p?.blocked) out.push(LIVE_STRINGS.binanceBlocked(at(p.nextProbeAt) || undefined));
  else if (p?.reachable === false) out.push(LIVE_STRINGS.binanceDown);
  else if (p?.reachable === true || health.ws?.state === "live") out.push(LIVE_STRINGS.binanceOk);
  else out.push(LIVE_STRINGS.binanceUnknown);
  const fromDisk = IS_FILE_BUILD || isFileProtocol();
  if (fromDisk) out.push(LIVE_STRINGS.proxyFile);
  else if (health.proxy?.blocked) out.push(LIVE_STRINGS.proxyBlocked);
  else if (health.proxy?.usable === true) out.push(LIVE_STRINGS.proxyOk);
  else if (health.proxy?.usable === false) out.push(LIVE_STRINGS.proxyOff);
  // opened from disk the browser may refuse Binance's /futures/data (CORS) and there is no proxy: say what helps
  if (fromDisk && Object.values(health.feeds ?? {}).some((f) => f && BINANCE_FAMILY_FEEDS.includes(f.feed) && f.consecutiveFailures > 0 && (f.reason === "network" || f.reason === "cors"))) {
    out.push(LIVE_STRINGS.fileCors);
  }
  const skew = skewText(health.clockSkewMs ?? 0);
  if (skew) out.push(skew);
  return out;
}

/** xl and up: the feeds in two tables side by side (the card spans the settings page there). */
export const SPLIT_QUERY = "(min-width: 1280px)";

/** The feed table (`Feed | Quelle | Stand | Status`) for `feeds`; `offset` = index of the first row (reveal stagger). */
function FeedTable({ feeds, offset, health, statusLabels, reveal, seen }: { feeds: FeedHealth[]; offset: number; health: ProviderHealth; statusLabels: LiveDataCardProps["statusLabels"]; reveal: boolean; seen: boolean }) {
  return (
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
        {feeds.map((f, j) => {
          const i = offset + j;
          const label = statusLabels?.[f.feed];
          const line = f.consecutiveFailures === undefined ? null : feedLine(f, { transport: WS_FEEDS.includes(f.feed) ? "ws" : "rest", online: health.online, ws: health.ws, primary: health.primary, skewMs: health.clockSkewMs });
          const delay = Math.min(i, stagger.max) * stagger.rows;
          return (
            <motion.tr
              key={f.feed}
              className="border-b border-line/60 last:border-b-0 max-sm:grid max-sm:grid-cols-[auto_minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-0.5 max-sm:px-3 max-sm:py-2"
              initial={reveal ? { opacity: 0, y: 4 } : false}
              animate={seen ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
              transition={{ default: { ...tween.reveal, delay }, y: { ...spring.enter, delay } }}
            >
              <td className="px-3 py-1.5 text-fg/90 max-sm:col-span-2 max-sm:col-start-1 max-sm:row-start-1 max-sm:min-w-0 max-sm:p-0">
                {FEED_LABELS[f.feed] ?? f.feed}
                {line && <FeedLineView line={line} />}
              </td>
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
  // xl: the card spans the page (SettingsView) – two tables side by side; the first takes the extra row of an odd count
  const split = useMediaQuery(SPLIT_QUERY, false) && feeds.length > 6;
  const half = Math.ceil(feeds.length / 2);

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
            <span className="font-mono text-[11.5px] text-faint">{LIVE_STRINGS.reconnects(health.ws?.attempt ?? 0)}</span>
            {routeLine(health).map((t) => (
              <span key={t} data-route className={cn("text-[11.5px]", (health.primary?.blocked && t.startsWith("Binance")) || t === LIVE_STRINGS.fileCors ? "text-warn" : "text-faint")}>
                {t}
              </span>
            ))}
          </div>
          {/* below sm the rows stack (feed + status, then source · Stand) – no sideways scroll on phones; from xl (the card
              spans the settings page) the feeds run in two tables side by side, so the card is half as tall */}
          <div ref={tableRef} className={cn("grid gap-3", split && "grid-cols-2 items-start")}>
            {(split ? [feeds.slice(0, half), feeds.slice(half)] : [feeds]).map((part, k) => (
              <div key={k} className="min-w-0 rounded-xl border border-line sm:overflow-x-auto">
                <FeedTable feeds={part} offset={k === 0 ? 0 : half} health={health} statusLabels={statusLabels} reveal={reveal} seen={seen} />
              </div>
            ))}
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
