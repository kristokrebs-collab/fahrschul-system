/**
 * 5-Minuten-Kerzen für die Eröffnungs-Range-Familie: Binance USDⓈ-M über die REST-Wege der Marktschicht (direkt, bei Sperre / Netzfehler derselbe
 * Weg über den EU-Proxy), geschlossene Kerzen, seitenweise (1.500 je Seite). Die Labor-Quelle `loadLabData` kennt 5 Minuten nicht (kleinste Kerze
 * 15 Minuten); dieser Lader nutzt dieselben Seiten-Abrufe wie der Handelsplan (`@/market/plan/candles`).
 *
 * Ohne Verbindung: ein ehrlicher Fehler mit Grund – es gibt KEINE Ersatzdaten (keine andere Börse, keine erfundenen Kerzen). Abbrechen beendet den
 * laufenden Abruf sofort.
 */
import type { Bar } from "@/domain/backtest/index";
import { defaultDeps, loadErrorText, PAGE_LIMIT, PLAN_INTERVAL_MS } from "@/market/plan/candles";
import { toRestError } from "@/market/sources/http";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";

export class OrbLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrbLoadError";
  }
}

const IV = PLAN_INTERVAL_MS["5m"];

export interface OrbLoadRequest {
  symbol: string;
  /** ms: Eröffnung der ersten gewünschten Kerze und Ende */
  from: number;
  to: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** Test-Hook: der Seiten-Abruf */
  fetchPage?: ReturnType<typeof defaultDeps>["fetchPage"];
}

const SWITCH = new Set(["blocked_451", "network", "cors"]);

export async function loadOrbCandles(req: OrbLoadRequest): Promise<Bar[]> {
  const fetchPage = req.fetchPage ?? defaultDeps().fetchPage;
  const proxyOk = !(IS_FILE_BUILD || isFileProtocol());
  const total = Math.max(1, Math.ceil((req.to - req.from) / IV / PAGE_LIMIT));
  const rows = new Map<number, Bar>();
  let via: "direct" | "proxy" = "direct";
  let start = req.from;
  let pages = 0;
  for (let guard = 0; guard < total + 6 && start <= req.to; guard++) {
    if (req.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    try {
      const page = await fetchPage({ symbol: req.symbol, interval: "5m", startTime: start, endTime: req.to + IV - 1, limit: PAGE_LIMIT, route: via, signal: req.signal });
      pages++;
      req.onProgress?.(Math.min(pages, total), total);
      for (const c of page) if (c.closed !== false) rows.set(c.time, { t: c.time / 1000, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume });
      const last = page[page.length - 1];
      if (!last || last.time < start) break;
      start = last.time + IV;
    } catch (e) {
      if (req.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      const err = toRestError(e);
      if (via === "direct" && SWITCH.has(err.kind) && proxyOk) {
        via = "proxy";
        guard--;
        continue;
      }
      throw new OrbLoadError(loadErrorText(e));
    }
  }
  const out = [...rows.values()].sort((a, b) => a.t - b.t);
  // die laufende Kerze ist nie dabei (nur geschlossene)
  while (out.length && out[out.length - 1]!.t * 1000 + IV > Date.now()) out.pop();
  return out;
}
