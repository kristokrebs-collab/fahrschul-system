/**
 * 5-Minuten-Kerzen für den Markt-Scanner „Wer bricht aus?“: eine Seite je Markt (499 Kerzen ≈ 41 Stunden), öffentliche
 * Marktdaten ohne Schlüssel, über die REST-Bausteine der Marktschicht (`fetchJson`, die Kline-Schemata der Quellen).
 *
 * Weg (fest, bester zuerst) – wer wirklich geliefert hat, steht in jeder Antwort (`source`) und so auf der Seite:
 *   1. `binance` Binance USDⓈ-M, direkt aus dem Browser
 *   2. `proxy`   dieselbe Reihe über den EU-Proxy der App (`/api/binance`; nie in der Einzeldatei-Version)
 *   3. `bybit`   Bybit USDT-Perp – eine andere Börse: nah, nicht gleich (so wird es auch genannt)
 * Sperre, CORS- oder Netzfehler, eine gebremste, zu langsame oder unlesbare Quelle schalten den Rest des Laufs auf die nächste
 * Quelle (eine gesperrte Börse wird nicht zwölfmal gefragt; der nächste Lauf beginnt wieder vorn); ein unbekanntes Symbol beendet die Kette für diesen Markt (ein Tippfehler ist kein Grund, die
 * Börse zu wechseln). Fällt alles aus, gibt es den Grund in Worten – nie Ersatz- oder Beispielkerzen.
 *
 * Eigenes Budget (höchstens 60 Gewicht je Minute, eine Seite wiegt 2), getrennt von den Live-Feeds: ein Scan bremst nie den Kurs.
 */
import { BREAKOUT_RULES } from "@/domain/breakout";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { klineWeight, TokenBucket } from "../budget";
import { BINANCE_REST, klinesSchema, mapKline } from "../sources/binance";
import { BYBIT_REST, bybitKlineSchema } from "../sources/bybit";
import { fetchJson, RestError, toRestError, type FetchLike } from "../sources/http";
import { PROXY_BASE } from "../sources/proxy";
import type { Candle, FailureReason } from "../types";

export type BreakoutSource = "binance" | "proxy" | "bybit";
export const BREAKOUT_CHAIN: readonly BreakoutSource[] = ["binance", "proxy", "bybit"];
export const BREAKOUT_BUDGET = { capacity: 60, windowMs: 60_000 } as const;

export type BreakoutLoad =
  | { ok: true; symbol: string; candles: Candle[]; source: BreakoutSource; fetchedAt: number }
  | { ok: false; symbol: string; kind: FailureReason | "aborted"; message: string };

export interface BreakoutDeps {
  fetch?: FetchLike;
  /** the same-origin proxy exists (not in the single-file build) */
  proxy?: () => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

/** After these the next source is asked for the rest of the run. */
const SWITCH: ReadonlySet<string> = new Set(["blocked_451", "network", "cors", "rate_limited", "timeout", "http_5xx"]);

/** The reason in words. */
export function loadFailText(kind: FailureReason | "aborted"): string {
  switch (kind) {
    case "offline":
      return "Du bist offline.";
    case "bad_symbol":
      return "Die Börse kennt dieses Symbol nicht.";
    case "rate_limited":
      return "Die Börse hat die Anfragen gebremst.";
    case "blocked_451":
      return "Die Börse ist von hier aus gesperrt.";
    case "timeout":
      return "Die Börse antwortet zu langsam.";
    case "aborted":
      return "Abgebrochen.";
    default:
      return "Die Börse ist gerade nicht erreichbar.";
  }
}

const isAbort = (signal: AbortSignal | undefined): boolean => !!signal?.aborted;

export interface BreakoutLoader {
  /** one market; never throws */
  load(symbol: string, signal?: AbortSignal): Promise<BreakoutLoad>;
  /** the source the next request starts with */
  route(): BreakoutSource;
  /** a new run asks the best source first again */
  reset(): void;
}

export function createBreakoutLoader(deps: BreakoutDeps = {}): BreakoutLoader {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const hasProxy = deps.proxy ?? (() => !(IS_FILE_BUILD || isFileProtocol()));
  const timeoutMs = deps.timeoutMs ?? 12_000;
  const iv = BREAKOUT_RULES.intervalMs;
  const limit = BREAKOUT_RULES.bars;
  const bucket = new TokenBucket(BREAKOUT_BUDGET, now());
  let start = 0;

  const chain = (): BreakoutSource[] => BREAKOUT_CHAIN.filter((s) => s !== "proxy" || hasProxy());

  async function take(units: number, signal?: AbortSignal): Promise<boolean> {
    for (;;) {
      if (isAbort(signal)) return false;
      const t = now();
      if (bucket.take(units, t, "price")) return true;
      await sleep(Math.max(250, Math.min(2_000, bucket.waitFor(units, t, "price"))));
    }
  }

  async function page(source: BreakoutSource, symbol: string, signal?: AbortSignal): Promise<Candle[]> {
    const io = { fetch: deps.fetch, timeoutMs, ...(signal ? { signal } : {}) };
    if (source === "bybit") {
      const url = `${BYBIT_REST}/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=5&limit=${limit}`;
      const r = await fetchJson(url, bybitKlineSchema, io);
      const t = now();
      return r.result.list
        .map(([time, open, high, low, close, volume, quoteVolume]) => ({ time, open, high, low, close, volume, quoteVolume, closeTime: time + iv - 1, closed: time + iv <= t }))
        .sort((a, b) => a.time - b.time);
    }
    const base = source === "proxy" ? PROXY_BASE : BINANCE_REST;
    const rows = await fetchJson(`${base}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${BREAKOUT_RULES.interval}&limit=${limit}`, klinesSchema, io);
    const t = now();
    return rows.map((r) => mapKline(r, t));
  }

  return {
    route: () => chain()[Math.min(start, chain().length - 1)]!,
    reset: () => {
      start = 0;
    },
    async load(symbol, signal) {
      const sources = chain();
      let last: RestError = new RestError("network", "keine Quelle");
      for (let k = Math.min(start, sources.length - 1); k < sources.length; k++) {
        const source = sources[k]!;
        if (!(await take(klineWeight(limit), signal))) return { ok: false, symbol, kind: "aborted", message: loadFailText("aborted") };
        try {
          const candles = await page(source, symbol, signal);
          if (!candles.length) throw new RestError("http_5xx", "leere Antwort");
          return { ok: true, symbol, candles, source, fetchedAt: now() };
        } catch (err) {
          if (isAbort(signal)) return { ok: false, symbol, kind: "aborted", message: loadFailText("aborted") };
          last = toRestError(err);
          if (last.kind === "offline" || last.kind === "bad_symbol" || !SWITCH.has(last.kind)) break;
          // sticky: the rest of the run starts at the next source (a blocked host is not asked twelve times)
          if (k + 1 < sources.length && start <= k) start = k + 1;
        }
      }
      return { ok: false, symbol, kind: last.kind, message: loadFailText(last.kind) };
    },
  };
}

let shared: BreakoutLoader | null = null;
export function breakoutLoader(): BreakoutLoader {
  shared ??= createBreakoutLoader();
  return shared;
}
/** Tests: a loader with injected deps (or the real one again with `null`). */
export function __setBreakoutLoader(l: BreakoutLoader | null): void {
  shared = l;
}
