/** Gemeinsame Testdaten der Strategiesuche: synthetische 4h-Märkte mit bekannter Wahrheit (Zufallspfad / eingebautes Muster) und die echten BTCUSDT-4h-Kerzen der Fixture. Nur Testdaten. */
import { readFileSync } from "node:fs";
import { rng } from "@/domain/analytics/stats";
import { DEFAULT_FEES, type Bar, type EngineCfg } from "@/domain/backtest/index";
import { SEARCH_WARMUP_BARS, type SearchJobInput } from "@/domain/lab/search";

export const ENGINE: EngineCfg = { capital: 10_000, riskPct: 0.01, maxLeverage: 5, compounding: true, costs: { fees: DEFAULT_FEES, slippage: { kind: "fixed", bps: 2 }, funding: { kind: "flat", ratePer8h: 0.0001 } } };

export const BTC_4H: Bar[] = (JSON.parse(readFileSync("tests/unit/fixtures/binance-btcusdt-4h.json", "utf8")) as { bars: number[][] }).bars.map(([t, o, h, l, c, v]) => ({ t: t!, o: o!, h: h!, l: l!, c: c!, ...(v != null ? { v } : {}) }));

const T0 = Date.UTC(2024, 0, 1) / 1000;
const STEP = 4 * 3600;

export interface MarketOpts {
  /**
   * Länge des eingebauten Musters (Kerzen) und Stärke (Drift je Kerze als Anteil der Streuung); 0 = reiner Zufallspfad. Mit `random` dauert
   * jeder Impuls zufällig lang (exponentiell, Mittel `hold` Kerzen, höchstens 4 × `hold`), stürzt danach in 2 Kerzen bis 4 σ UNTER den
   * Ausbruch ab und erholt sich über `2 × hold` Kerzen wieder auf den Zufallspfad (ohne Netto-Drift) – ein Lauf unbekannter Länge mit
   * jähem Ende: ein fester Stop gibt alles zurück (und mehr), ein nachgezogener behält den größten Teil.
   */
  edge?: { lookback: number; hold: number; drift: number; random?: boolean };
  sigma?: number;
  /** wechselnde Schwankung (Regime): σ × (1 + 0,8 · sin) mit Periode 500 Kerzen, ohne Drift */
  volCycle?: boolean;
}

/**
 * 4h-Kerzen aus einem gesetzten Pfad mit 12 Teilschritten je Kerze (echte Dochte). Ohne `edge` ein Random Walk ohne Drift. Mit `edge`
 * ein wiederholbarer Impuls mit bekanntem wahren Parameter (`lookback`): auf jeden Schluss über dem Hoch der letzten `lookback` Kerzen
 * (nur aus Kerzen bis dahin erkannt) steigt der Preis `hold` Kerzen lang um `drift` σ je Kerze und fällt danach über `2 × hold` Kerzen
 * wieder auf den Zufallspfad zurück – ohne Netto-Drift, damit weder „Kaufen und Halten“ noch jede Long-Variante von selbst gewinnt: nur
 * wer nach dem Ausbruch einsteigt und innerhalb des Impulses aussteigt, verdient daran.
 */
export function market(n: number, seed: number, o: MarketOpts = {}): Bar[] {
  const r = rng(seed);
  const sigma = o.sigma ?? 0.01;
  const g = (): number => {
    let s = 0;
    for (let i = 0; i < 12; i++) s += r();
    return s - 6;
  };
  const SUB = 12;
  const out: Bar[] = [];
  let x = 0; // Zufallspfad (log)
  let pulse = 0; // Impuls (log)
  let up = 0;
  let down = 0;
  let downLen = 1;
  let peak = 0;
  /** Abschnitte nach einem zufälligen Lauf: Absturz, dann Erholung (Kerzen, Änderung je Kerze) */
  const segs: { left: number; dp: number }[] = [];
  for (let i = 0; i < n; i++) {
    const open = 30_000 * Math.exp(x + pulse);
    let dp = 0;
    if (o.edge && up > 0) {
      dp = o.edge.drift * sigma;
      up--;
      if (up === 0) {
        peak = pulse + dp;
        if (o.edge.random) {
          const low = -4 * sigma;
          segs.push({ left: 2, dp: (low - peak) / 2 }, { left: 2 * o.edge.hold, dp: -low / (2 * o.edge.hold) });
        } else {
          down = 2 * o.edge.hold;
          downLen = down;
        }
      }
    } else if (segs.length) {
      dp = segs[0]!.dp;
      if (--segs[0]!.left === 0) segs.shift();
    } else if (o.edge && down > 0) {
      dp = -peak / downLen;
      down--;
    }
    const pulseEnd = down === 0 && up === 0 && segs.length === 0 && dp !== 0 ? 0 : pulse + dp;
    let hi = open;
    let lo = open;
    for (let k = 0; k < SUB; k++) {
      x += ((o.volCycle ? sigma * (1 + 0.8 * Math.sin((2 * Math.PI * i) / 500)) : sigma) / Math.sqrt(SUB)) * g();
      const v = 30_000 * Math.exp(x + pulse + ((k + 1) / SUB) * (pulseEnd - pulse));
      hi = Math.max(hi, v);
      lo = Math.min(lo, v);
    }
    pulse = pulseEnd;
    const bar: Bar = { t: T0 + i * STEP, o: open, h: hi, l: lo, c: 30_000 * Math.exp(x + pulse), v: 100 };
    out.push(bar);
    if (o.edge && up === 0 && down === 0 && segs.length === 0 && i >= o.edge.lookback) {
      let top = -Infinity;
      for (let k = i - o.edge.lookback; k < i; k++) top = Math.max(top, out[k]!.h);
      if (bar.c > top) {
        up = o.edge.random ? Math.min(4 * o.edge.hold, 1 + Math.floor(-Math.log(1 - r()) * o.edge.hold)) : o.edge.hold;
      }
    }
  }
  return out;
}

/** Eingabe der Suche über `bars` (4h); das Handelsfenster beginnt nach dem Vorlauf. */
export function searchInput(bars: Bar[], seed = 7, over: Partial<SearchJobInput> = {}, fromIdx = SEARCH_WARMUP_BARS): SearchJobInput {
  return { engine: ENGINE, seed, trend: { bars, interval: "4h", fromMs: bars[fromIdx]!.t * 1000, meta: { symbol: "TESTUSDT", interval: "4h", source: "fixture", fixture: true } }, ...over };
}

// ── 5-Minuten-Märkte für die Eröffnungs-Range-Familie ─────────────────────────────────────────────────────────────

const D0 = Date.UTC(2025, 0, 6) / 1000; // Montag 06.01.2025, 00:00 UTC
const DAY_S = 86_400;

/**
 * 5-Minuten-Kerzen über `days` Kalendertage (Werktage und Wochenenden, 288 Kerzen je Tag), Random Walk (σ 0,1 % je Kerze, Volumen 70–130).
 * Mit `pattern`: an jedem Werktag (mit der Wahrscheinlichkeit `share`) bricht der Kurs in New York genau auf der Kerze nach der 60-Minuten-Range
 * mit Volumen 300 (3×) in eine zufällige Richtung aus und läuft 16 Kerzen weiter – ein wiederholbares Volumen-Ausbruch-Muster, wahre Parameter:
 * Sitzung New York, Range 60, Volumen-Schwelle ≤ 3. Ohne `pattern` reines Rauschen.
 */
export function orbMarket(days: number, seed: number, o: { pattern?: boolean; share?: number } = {}): Bar[] {
  const r = rng(seed);
  const g = (): number => {
    let s = 0;
    for (let i = 0; i < 12; i++) s += r();
    return s - 6;
  };
  const out: Bar[] = [];
  let x = 0;
  let drift = 0;
  let driftLeft = 0;
  for (let d = 0; d < days; d++) {
    const wd = (d % 7) + 1; // 1 = Montag … 7 = Sonntag (06.01.2025 ist ein Montag)
    const patternDay = !!o.pattern && wd <= 5 && r() < (o.share ?? 0.8);
    const dir = r() < 0.5 ? 1 : -1;
    for (let k = 0; k < 288; k++) {
      const t = D0 + d * DAY_S + k * 300;
      const open = 30_000 * Math.exp(x);
      let vol = 70 + 60 * r();
      let step = 0.001 * g() * 0.6;
      const isBreak = patternDay && k === 162 + 12; // 13:30 UTC = Kerze 162; Range 60 min = 12 Kerzen; Ausbruch auf der 13.
      if (isBreak) {
        let hi = -Infinity;
        let lo = Infinity;
        for (let q = out.length - 12; q < out.length; q++) {
          hi = Math.max(hi, out[q]!.h);
          lo = Math.min(lo, out[q]!.l);
        }
        const target = dir > 0 ? hi * 1.004 : lo * 0.996;
        step = Math.log(target / open);
        vol = 300;
        drift = dir * 0.002;
        driftLeft = 16;
      } else if (driftLeft > 0) {
        step += drift;
        driftLeft--;
      }
      const nx = x + step;
      const close = 30_000 * Math.exp(nx);
      const wick = Math.abs(0.0004 * g());
      out.push({ t, o: open, h: Math.max(open, close) * (1 + wick), l: Math.min(open, close) * (1 - wick), c: close, v: vol });
      x = nx;
    }
  }
  return out;
}

/** Eingabe der Suche über 5-Minuten-Kerzen allein (Eröffnungs-Range-Familie); die ersten 2 Tage sind Vorlauf. */
export function orbInput(bars: Bar[], seed = 7, over: Partial<SearchJobInput> = {}): SearchJobInput {
  return { engine: ENGINE, seed, orb: { bars, fromMs: (D0 + 2 * DAY_S) * 1000, meta: { symbol: "TESTUSDT", interval: "5m", source: "fixture", fixture: true } }, ...over };
}
