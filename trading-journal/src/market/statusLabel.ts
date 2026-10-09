/**
 * German status labels derived ONLY from the health snapshot (Plan 4.4). Views never invent "live"
 * from the presence of data.
 */
import type { FeedHealth, FeedId, FeedSpec, ProviderHealth, Source, Stamped, StatusLabel } from "./types";
import { cadenceLabel } from "./period";
import { effectiveSpec } from "./feeds";
import { hhmm } from "./format";

export const STRINGS = {
  connecting: "Verbinde …",
  offline: "Offline",
  standPrefix: "Stand",
  lastPrefix: "Zuletzt",
  staleSuffix: "veraltet",
  fallbackDetail: "Binance nicht erreichbar (451/CORS)",
  wsFallbackDetail: "WebSocket getrennt, REST-Abfrage",
  proxyDetail: "Binance über EU-Proxy",
  onlyBinance: "Nur mit Binance",
  otherCohort: "andere Kohorte",
  noPrice: "Kein Live-Kurs",
  loading: "Kurs wird geladen …",
  refreshing: "Aktualisiert …",
  refreshNow: "Jetzt aktualisieren",
  live: "Live",
  rateLimited: "Rate-Limit, Pause 60 s",
  proxyBlocked: "EU-Proxy: Region blockiert (451)",
  fallbackOnlyUsdt: "Fallback nur für USDT-Perps",
  retrying: (sec: number) => `Binance antwortet gerade nicht. Nächster Versuch in ${sec} Sekunden.`,
  /** market card pill while the socket is down and the last price arrives by REST poll (`Kurs per Abfrage · 5 s`) */
  pricePolled: (sec: number) => `Kurs per Abfrage · ${sec} s`,
} as const;

export const SOURCE_NAME: Record<Source, string> = {
  binance: "Binance",
  bybit: "Bybit",
  okx: "OKX",
  proxy: "EU-Proxy",
  tradingview: "TradingView",
  cache: "Cache",
};

/** Tooltip text for non-comparable ratio cohorts. */
export const COHORT_HINT: Partial<Record<Source, string>> = {
  okx: "OKX: Top 5 % nach offenem Positionswert. Binance: Top 20 % nach Margin-Guthaben. Nicht direkt vergleichbar.",
  bybit: "Bybit: alle Konten, keine Top-Trader-Kohorte.",
};

/** `Ersatzquelle Bybit` – header badge hint when a fallback source serves the price. */
export function fallbackBadge(source: Source): string {
  return `Ersatzquelle ${SOURCE_NAME[source]}`;
}

/** Cause of a soft REST failure, short (`Binance antwortet nicht (Netzwerk/CORS)`). */
export const SOFT_FAILURE_CAUSE: Partial<Record<NonNullable<FeedHealth["reason"]>, string>> = {
  network: "Netzwerk/CORS",
  timeout: "Zeitüberschreitung",
  http_5xx: "Serverfehler",
  rate_limited: "Rate-Limit",
  cors: "CORS",
};

/** Short German text of a soft REST failure (the feed stays on its source and is retried). */
export const SOFT_FAILURE_TEXT: Partial<Record<NonNullable<FeedHealth["reason"]>, string>> = {
  network: "Netzwerk/CORS-Fehler",
  timeout: "Zeitüberschreitung",
  http_5xx: "Serverfehler",
  rate_limited: "Rate-Limit",
  cors: "CORS-Fehler",
};

export interface LabelInput {
  health: FeedHealth;
  spec: FeedSpec;
  value?: Stamped<unknown> | undefined;
  now?: number;
  timeZone?: string;
}

export function statusLabel({ health, spec, value, timeZone }: LabelInput): StatusLabel {
  const asOf = value?.asOf ?? health.lastDataAt;
  const stand = asOf !== undefined ? hhmm(asOf, timeZone) : undefined;
  const stale = (): StatusLabel => ({
    tone: "warn",
    text: stand ? `${STRINGS.lastPrefix} ${stand} · ${STRINGS.staleSuffix}` : STRINGS.connecting,
    detail: health.detail,
  });

  if (health.reason === "bad_symbol") return { tone: "error", text: STRINGS.noPrice, detail: health.detail };
  if (health.reason === "unsupported") return { tone: "muted", text: STRINGS.onlyBinance, detail: health.detail ?? COHORT_HINT[health.source] };
  // a REST feed failing on its source (retried with backoff): say so instead of a cheerful "Live"
  const soft = health.reason ? SOFT_FAILURE_TEXT[health.reason] : undefined;
  if (soft && spec.transport === "rest" && health.consecutiveFailures > 0 && (health.state === "live" || health.state === "stale" || health.state === "connecting")) {
    return { tone: "warn", text: stand ? `${STRINGS.lastPrefix} ${stand} · ${soft}` : soft, detail: health.detail };
  }

  switch (health.state) {
    case "live": {
      const { cadenceMs } = effectiveSpec(spec, health.source);
      return { tone: "live", text: `${STRINGS.live} · ${cadenceLabel(cadenceMs)}`, detail: health.detail };
    }
    case "stale":
      return stale();
    case "fallback": {
      const { cadenceMs } = effectiveSpec(spec, health.source, "fallback");
      const name = SOURCE_NAME[health.source];
      const detail = health.detail ?? (health.source === "binance" ? STRINGS.wsFallbackDetail : health.source === "proxy" ? STRINGS.proxyDetail : STRINGS.fallbackDetail);
      return { tone: "warn", text: `${name}-Daten · ${cadenceLabel(cadenceMs)}`, detail };
    }
    case "offline":
      return { tone: "error", text: stand ? `${STRINGS.offline} · ${STRINGS.standPrefix} ${stand}` : STRINGS.offline, detail: health.detail };
    case "connecting":
      // first paint from the IndexedDB snapshot: never blank
      if (value) return stale();
      return { tone: "muted", text: STRINGS.connecting, detail: health.detail };
  }
}

export function statusLabelFor(h: ProviderHealth, feed: FeedId, specs: Record<FeedId, FeedSpec>, value?: Stamped<unknown>, now?: number, timeZone?: string): StatusLabel {
  return statusLabel({ health: h.feeds[feed], spec: specs[feed], value, now, timeZone });
}

/**
 * LivePill age label for 1-Hz price data (Plan 4.4): `age < 2 s → "Live"`, `2–59 s → "Live · vor {n}s"`,
 * `≥ 60 s → "vor {n} min"`; `warn` when older than 120 s.
 */
export function liveAgeLabel(receivedAt: number | undefined, now: number, refreshing = false): { text: string; warn: boolean; ageSec: number | null } {
  if (refreshing) return { text: STRINGS.refreshing, warn: false, ageSec: null };
  if (receivedAt === undefined) return { text: STRINGS.live, warn: false, ageSec: null };
  const age = Math.max(0, Math.round((now - receivedAt) / 1000));
  const warn = age > 120;
  if (age < 2) return { text: STRINGS.live, warn, ageSec: age };
  if (age < 60) return { text: `${STRINGS.live} · vor ${age}s`, warn, ageSec: age };
  return { text: `vor ${Math.round(age / 60)} min`, warn, ageSec: age };
}

/** Ring progress towards the next `ticker24h` refresh (30-s optics of the legacy pill). */
export function refreshRingProgress(nextRefreshAt: number | undefined, now: number, cadenceMs = 30_000): number {
  if (nextRefreshAt === undefined) return 0;
  return Math.min(1, Math.max(0, 1 - (nextRefreshAt - now) / cadenceMs));
}
