// Signal-Engine: rechnet aus TradingView-Kerzen nach, was die Indikatoren im Chart zeigen.
// - RSI 14 (Wilder/RMA, wie ta.rsi) + gleitender Durchschnitt
// - WaveTrend wie MCB/VuManChu Cipher B (wt1/wt2, Kreuzungen, Bottom/Top)
// - Premium/Equilibrium/Discount wie LuxAlgo SMC (Lage im Swing-Bereich)
// Die privaten Indikatoren selbst sind über die API nicht lesbar; das hier ist eine Nachrechnung.

export type Bar = { t: number; o: number; h: number; l: number; c: number; v?: number };
export type Side = 'long' | 'short';

export type SignalCfg = {
  ladder: string[];          // Timeframes von klein nach groß, z. B. ['30m','45m','1h','4h']
  required: number;          // wie viele Stufen mindestens bestätigen müssen (Basis + nächst höhere)
  wtSource: 'hlc3' | 'close';
  wtChannel: number;         // n1
  wtAverage: number;         // n2
  wtSignal: number;          // SMA-Länge für wt2
  wtOb: number; wtObStrong: number; wtOs: number; wtOsStrong: number;
  signalLookback: number;    // wie viele Kerzen ein Signal „leuchtet“
  revRange: number;          // MCB „Potential Reversal Range“ für Bottom/Top (28)
  rsiLen: number; rsiMaLen: number;
  rsiOb: number; rsiOs: number; rsiNear: number; // „in der Nähe“: Abstand in RSI-Punkten
  swingLookback: number;     // Kerzen für den Premium/Discount-Bereich
  zoneTf: string;            // Timeframe, auf dem Premium/Discount bewertet wird
};

export const DEFAULT_SIGNAL_CFG: SignalCfg = {
  ladder: ['30m', '45m', '1h', '4h'],
  required: 2,
  // MCB {WeloTrades} laut Status-Zeile im Chart: close 9 21, Levels 60/53 und −60/−53, Reversal Range 28
  wtSource: 'close', wtChannel: 9, wtAverage: 21, wtSignal: 2,
  wtOb: 53, wtObStrong: 60, wtOs: -53, wtOsStrong: -60,
  signalLookback: 3, revRange: 28,
  rsiLen: 14, rsiMaLen: 14,
  rsiOb: 70, rsiOs: 30, rsiNear: 10,
  swingLookback: 50, zoneTf: '1h',
};

const TF_SEC: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '45m': 2700, '1h': 3600, '2h': 7200, '3h': 10800, '4h': 14400, '1D': 86400, '1W': 604800 };
export const tfSeconds = (tf: string) => TF_SEC[tf] || 0;
export const SIGNAL_TFS = ['30m', '45m', '1h', '2h', '3h', '4h', '1D'];

/** Ergänzt die laufende Kerze mit dem Live-Kurs (oder beginnt die nächste), so wie der Chart sie zeigt. */
export function withLivePrice(bars: Bar[], sec: number, price: number, atMs: number): Bar[] {
  if (!bars.length || !sec || !isFinite(price)) return bars;
  const now = atMs / 1000, last = bars[bars.length - 1];
  if (now < last.t) return bars;
  const k = Math.floor((now - last.t) / sec);
  if (k === 0) return [...bars.slice(0, -1), { ...last, c: price, h: Math.max(last.h, price), l: Math.min(last.l, price) }];
  if (k === 1) return [...bars, { t: last.t + sec, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price }];
  return bars; // Lücke zu groß: lieber nichts erfinden
}

// ── Grundbausteine ─────────────────────────────────────
export function ema(src: number[], len: number): number[] {
  const out: number[] = [];
  const a = 2 / (len + 1);
  let prev = NaN;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    if (!isFinite(x)) { out.push(prev); continue; }
    prev = isFinite(prev) ? a * x + (1 - a) * prev : x;
    out.push(prev);
  }
  return out;
}
export function sma(src: number[], len: number): number[] {
  const out: number[] = [];
  let sum = 0, n = 0;
  const q: number[] = [];
  for (const x of src) {
    q.push(x); if (isFinite(x)) { sum += x; n++; }
    if (q.length > len) { const y = q.shift()!; if (isFinite(y)) { sum -= y; n--; } }
    out.push(q.length === len && n === len ? sum / len : NaN);
  }
  return out;
}
/** Wilder-RMA, wie Pine ta.rma: Start mit SMA der ersten len Werte. */
export function rma(src: number[], len: number): number[] {
  const out: number[] = [];
  let prev = NaN, sum = 0, cnt = 0;
  for (const x of src) {
    if (!isFinite(prev)) {
      if (isFinite(x)) { sum += x; cnt++; }
      prev = cnt === len ? sum / len : NaN;
      out.push(prev);
    } else {
      prev = (prev * (len - 1) + x) / len;
      out.push(prev);
    }
  }
  return out;
}
/** RSI wie TradingView ta.rsi (RMA von Gewinnen/Verlusten). */
export function rsi(close: number[], len = 14): number[] {
  const up: number[] = [NaN], dn: number[] = [NaN];
  for (let i = 1; i < close.length; i++) { const d = close[i] - close[i - 1]; up.push(Math.max(d, 0)); dn.push(Math.max(-d, 0)); }
  const ru = rma(up.slice(1), len), rd = rma(dn.slice(1), len);
  const out: number[] = [NaN];
  for (let i = 0; i < ru.length; i++) {
    const u = ru[i], d = rd[i];
    out.push(!isFinite(u) || !isFinite(d) ? NaN : d === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / d));
  }
  return out;
}

/** WaveTrend (LazyBear / VuManChu Cipher B). */
export function waveTrend(bars: Bar[], cfg: Pick<SignalCfg, 'wtSource' | 'wtChannel' | 'wtAverage' | 'wtSignal'>) {
  const src = bars.map((b) => (cfg.wtSource === 'hlc3' ? (b.h + b.l + b.c) / 3 : b.c));
  const esa = ema(src, cfg.wtChannel);
  const de = ema(src.map((x, i) => Math.abs(x - esa[i])), cfg.wtChannel);
  const ci = src.map((x, i) => (de[i] ? (x - esa[i]) / (0.015 * de[i]) : 0));
  const wt1 = ema(ci, cfg.wtAverage);
  const wt2 = sma(wt1, cfg.wtSignal);
  return { wt1, wt2 };
}

export type WtKind = 'bottom' | 'buy' | 'bull' | 'top' | 'sell' | 'bear';
export type WtEvent = { kind: WtKind; barsAgo: number } | null;
export type WtSignal = {
  kind: WtKind | null; barsAgo: number | null; // jüngstes Ereignis (Anzeige)
  long: WtEvent; short: WtEvent;               // stärkstes Ereignis je Richtung im Fenster
  wt1: number; wt2: number;
};
const RANK: Record<WtKind, number> = { bottom: 3, buy: 2, bull: 1, top: 3, sell: 2, bear: 1 };
const lowest = (x: number[], i: number, n: number) => { let m = Infinity; for (let k = Math.max(0, i - n + 1); k <= i; k++) m = Math.min(m, x[k]); return m; };
const highest = (x: number[], i: number, n: number) => { let m = -Infinity; for (let k = Math.max(0, i - n + 1); k <= i; k++) m = Math.max(m, x[k]); return m; };
/**
 * MCB-Signale wie im Chart:
 * Bottom/Top = wt1 und Kurs drehen aus einem neuen 28-Kerzen-Tief/Hoch (Potential Reversal),
 * Buy/Sell = Kreuzung im überverkauften/überkauften Bereich (großer Punkt),
 * Einstieg/Ausstieg = normale Kreuzung unter/über null (kleiner Punkt).
 */
export function wtSignal(wt1: number[], wt2: number[], cfg: SignalCfg, close?: number[]): WtSignal {
  const n = wt1.length;
  const out: WtSignal = { kind: null, barsAgo: null, long: null, short: null, wt1: wt1[n - 1], wt2: wt2[n - 1] };
  const R = cfg.revRange || 28;
  for (let k = 0; k < Math.min(cfg.signalLookback, n - 2); k++) {
    const i = n - 1 - k;
    const ev: WtKind[] = [];
    if (close && i > R) {
      const bot = wt1[i] > lowest(wt1, i, R) && wt1[i - 1] <= lowest(wt1, i - 1, R) && close[i] > lowest(close, i, R) && close[i - 1] <= lowest(close, i - 1, R);
      const top = wt1[i] < highest(wt1, i, R) && wt1[i - 1] >= highest(wt1, i - 1, R) && close[i] < highest(close, i, R) && close[i - 1] >= highest(close, i - 1, R);
      if (bot) ev.push('bottom');
      if (top) ev.push('top');
    }
    const up = wt1[i - 1] <= wt2[i - 1] && wt1[i] > wt2[i];
    const dn = wt1[i - 1] >= wt2[i - 1] && wt1[i] < wt2[i];
    if (up) ev.push(wt1[i] <= cfg.wtOs ? 'buy' : wt1[i] < 0 ? 'bull' : 'bull');
    if (dn) ev.push(wt1[i] >= cfg.wtOb ? 'sell' : 'bear');
    for (const e of ev) {
      const isLong = e === 'bottom' || e === 'buy' || e === 'bull';
      // kleine Kreuzung zählt nur auf der richtigen Seite der Nulllinie
      if (e === 'bull' && wt1[i] >= 0) continue;
      if (e === 'bear' && wt1[i] <= 0) continue;
      if (out.kind == null) { out.kind = e; out.barsAgo = k; }
      const slot = isLong ? 'long' : 'short';
      if (!out[slot] || RANK[e] > RANK[out[slot]!.kind]) out[slot] = { kind: e, barsAgo: k };
    }
  }
  return out;
}

export type Zone = 'premium' | 'equilibrium' | 'discount';
export type ZoneInfo = { hi: number; lo: number; pos: number; zone: Zone; deep: boolean; eq: number; bias: -1 | 0 | 1; brk: { kind: 'BOS' | 'CHoCH'; dir: 1 | -1 } | null; lux: boolean };
const zoneOf = (pos: number): Zone => (pos > 0.525 ? 'premium' : pos >= 0.475 ? 'equilibrium' : 'discount');

/** Einfacher Bereich der letzten N Kerzen (Rückfall, wenn LuxAlgo noch keinen Swing hat). */
export function pdZone(bars: Bar[], lookback: number): ZoneInfo {
  const win = bars.slice(-lookback);
  const hi = Math.max(...win.map((b) => b.h)), lo = Math.min(...win.map((b) => b.l));
  const c = bars[bars.length - 1].c;
  const pos = hi > lo ? (c - lo) / (hi - lo) : 0.5;
  return { hi, lo, pos, zone: zoneOf(pos), deep: pos <= 0.05 || pos >= 0.95, eq: (hi + lo) / 2, bias: 0, brk: null, lux: false };
}

/**
 * Premium/Discount wie LuxAlgo Smart Money Concepts: Swing-Pivots (size 50, nur rechte Seite),
 * Trailing-Extreme seit dem letzten bestätigten Swing-Hoch/-Tief, Zonen-Boxen = obere/untere 5 %.
 */
export function luxZone(bars: Bar[], size = 50): ZoneInfo | null {
  let leg = 0, prevLeg = -1, shL = NaN, slL = NaN, shX = false, slX = false, pShL = NaN, pSlL = NaN;
  let top = NaN, bottom = NaN, bias: -1 | 0 | 1 = 0, brk: ZoneInfo['brk'] = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.h >= top) top = b.h;
    if (b.l <= bottom) bottom = b.l;
    if (i >= size) {
      let hh = -Infinity, ll = Infinity;
      for (let k = i - size + 1; k <= i; k++) { hh = Math.max(hh, bars[k].h); ll = Math.min(ll, bars[k].l); }
      const p = bars[i - size];
      if (p.h > hh) leg = 0; else if (p.l < ll) leg = 1;
    }
    if (prevLeg !== -1 && leg !== prevLeg) {
      const p = bars[i - size];
      if (leg === 1) { slL = p.l; slX = false; bottom = p.l; } else { shL = p.h; shX = false; top = p.h; }
    }
    prevLeg = leg;
    if (i > 0 && !shX && b.c > shL && bars[i - 1].c <= pShL) { brk = { kind: bias === -1 ? 'CHoCH' : 'BOS', dir: 1 }; bias = 1; shX = true; }
    if (i > 0 && !slX && b.c < slL && bars[i - 1].c >= pSlL) { brk = { kind: bias === 1 ? 'CHoCH' : 'BOS', dir: -1 }; bias = -1; slX = true; }
    pShL = shL; pSlL = slL;
  }
  if (!(top > bottom)) return null;
  const pos = Math.max(0, Math.min(1, (bars[bars.length - 1].c - bottom) / (top - bottom)));
  return { hi: top, lo: bottom, pos, zone: zoneOf(pos), deep: pos <= 0.05 || pos >= 0.95, eq: (top + bottom) / 2, bias, brk, lux: true };
}

// ── Auswertung pro Timeframe und über die Leiter ─────
export type TfCheck = {
  tf: string; ok: boolean; closeAt: number;
  rsi: number; rsiMa: number; wt: WtSignal; zone: ZoneInfo;
  longSignal: boolean; shortSignal: boolean; // MCB-Signal passend zur Richtung
  rsiLong: boolean; rsiShort: boolean;        // RSI nahe überverkauft / überkauft
};

export function checkTf(tf: string, bars: Bar[], cfg: SignalCfg): TfCheck | null {
  if (!bars || bars.length < 150) return null; // RSI braucht ~150 Kerzen Vorlauf, um auf 0,1 genau zu sein
  const close = bars.map((b) => b.c);
  const r = rsi(close, cfg.rsiLen);
  const rMa = sma(r, cfg.rsiMaLen);
  const { wt1, wt2 } = waveTrend(bars, cfg);
  const wt = wtSignal(wt1, wt2, cfg, close);
  const z = luxZone(bars, cfg.swingLookback) ?? pdZone(bars, 120);
  const rv = r[r.length - 1], rm = rMa[rMa.length - 1];
  return {
    tf, ok: true, closeAt: bars[bars.length - 1].t,
    rsi: rv, rsiMa: rm, wt, zone: z,
    longSignal: !!wt.long, shortSignal: !!wt.short,
    rsiLong: rv <= cfg.rsiOs + cfg.rsiNear,
    rsiShort: rv >= cfg.rsiOb - cfg.rsiNear,
  };
}

export type Verdict = {
  side: Side; tiers: number; strength: 0 | 1 | 2 | 3 | 4; label: string; valid: boolean;
  rsiOk: boolean; zoneOk: boolean; strongSignal: boolean; score: number; // 0..100
  reasons: { text: string; ok: boolean }[];
};

/** Bewertet eine Richtung: Signal-Leiter + RSI + Zone. */
export function verdict(side: Side, checks: (TfCheck | null)[], cfg: SignalCfg, zoneCheck?: TfCheck | null): Verdict {
  const sig = (c: TfCheck | null) => !!c && (side === 'long' ? c.longSignal : c.shortSignal);
  let tiers = 0;
  for (const c of checks) { if (sig(c)) tiers++; else break; } // Leiter muss von unten durchgehend bestätigen
  const base = checks[0];
  const rsiOk = checks.slice(0, Math.max(1, tiers)).some((c) => !!c && (side === 'long' ? c.rsiLong : c.rsiShort));
  const zoneRef = (zoneCheck !== undefined ? zoneCheck : checks.find((c) => c?.tf === cfg.zoneTf)) || base;
  const zoneOk = !!zoneRef && (side === 'long' ? zoneRef.zone.zone === 'discount' : zoneRef.zone.zone === 'premium');
  const strongSignal = checks.slice(0, Math.max(1, tiers)).some((c) => { const e = side === 'long' ? c?.wt.long : c?.wt.short; return !!e && e.kind !== 'bull' && e.kind !== 'bear'; });
  const valid = tiers >= cfg.required && rsiOk;
  const strength = (valid ? Math.min(4, 1 + Math.min(2, tiers - cfg.required) + (zoneOk ? 1 : 0)) : 0) as Verdict['strength'];
  const score = Math.round(Math.min(100, (tiers / Math.max(1, checks.length)) * 55 + (rsiOk ? 20 : 0) + (zoneOk ? 15 : 0) + (strongSignal ? 10 : 0)));
  const sideWord = side === 'long' ? 'Long' : 'Short';
  const label = valid ? (strength >= 3 ? `Sehr starker ${sideWord}-Einstieg` : strength === 2 ? `Starker ${sideWord}-Einstieg` : `${sideWord}-Einstieg`)
    : tiers >= cfg.required ? `${sideWord}-Signal, RSI noch nicht ${side === 'long' ? 'überverkauft' : 'überkauft'}`
    : tiers === 1 ? `${sideWord}: nur ${checks[0]?.tf} bestätigt` : `Kein ${sideWord}-Signal`;
  const sigWord = side === 'long' ? 'Bottom/Einstieg' : 'Top/Verkauf';
  const reasons = [
    ...checks.map((c, i) => ({ text: `${c?.tf ?? cfg.ladder[i]}: MCB ${sigWord}${i === 0 ? ' (Basis)' : i < cfg.required ? ' (Bestätigung)' : ' (stärker)'}`, ok: sig(c) && i < tiers })),
    { text: side === 'long' ? `RSI nahe überverkauft (≤ ${cfg.rsiOs + cfg.rsiNear})` : `RSI nahe überkauft (≥ ${cfg.rsiOb - cfg.rsiNear})`, ok: rsiOk },
    { text: `${side === 'long' ? 'Preis im Discount' : 'Preis im Premium'}${zoneRef ? ` (${zoneRef.tf})` : ''}`, ok: zoneOk },
  ];
  return { side, tiers, strength, label, valid, rsiOk, zoneOk, strongSignal, score, reasons };
}

export function bestVerdict(checks: (TfCheck | null)[], cfg: SignalCfg, zoneCheck?: TfCheck | null) {
  const l = verdict('long', checks, cfg, zoneCheck), s = verdict('short', checks, cfg, zoneCheck);
  return { long: l, short: s, best: l.score >= s.score ? l : s };
}

export type Signals = ReturnType<typeof bestVerdict> & { checks: (TfCheck | null)[]; zone: TfCheck | null; at: number };
/** Alle Prüfungen aus den Live-Kerzen. null, solange noch keine Kerzen da sind. */
export function computeSignals(bars: Record<string, Bar[]> | undefined, cfg: SignalCfg): Signals | null {
  if (!bars) return null;
  const checks = cfg.ladder.map((tf) => checkTf(tf, bars[tf] || [], cfg));
  if (!checks.some(Boolean)) return null;
  const zone = checks.find((c) => c?.tf === cfg.zoneTf) ?? checkTf(cfg.zoneTf, bars[cfg.zoneTf] || [], cfg);
  return { checks, zone, at: Date.now(), ...bestVerdict(checks, cfg, zone) };
}

/** Prüfung zu einem früheren Zeitpunkt (nachgetragener Trade): nur Kerzen, die da schon geschlossen waren. */
export function signalsAt(bars: Record<string, Bar[]> | undefined, cfg: SignalCfg, atMs: number): Signals | null {
  if (!bars || !isFinite(atMs)) return null;
  if (atMs >= Date.now() - 5 * 60_000) return computeSignals(bars, cfg);
  const cut: Record<string, Bar[]> = {};
  for (const [tf, b] of Object.entries(bars)) { const sec = tfSeconds(tf); cut[tf] = b.filter((x) => (x.t + sec) * 1000 <= atMs); }
  const base = cut[cfg.ladder[0]], sec0 = tfSeconds(cfg.ladder[0]);
  if (!base?.length || atMs - (base[base.length - 1].t + sec0) * 1000 > sec0 * 1000) return null; // Zeitpunkt nicht abgedeckt
  const s = computeSignals(cut, cfg);
  return s && { ...s, at: atMs };
}

/** Schnappschuss, der beim Eintragen eines Trades gespeichert wird. */
export type SignalSnap = {
  at: string; side: Side; score: number; strength: number; tiers: number; label: string; valid: boolean;
  rsiOk: boolean; zoneOk: boolean; zone: Zone | null; deep?: boolean;
  tfs: { tf: string; kind: WtKind | null; wt: number; rsi: number }[];
};
export function snapshot(sig: Signals, side: Side): SignalSnap {
  const v = side === 'long' ? sig.long : sig.short;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    at: new Date(sig.at).toISOString(), side, score: v.score, strength: v.strength, tiers: v.tiers, label: v.label, valid: v.valid,
    rsiOk: v.rsiOk, zoneOk: v.zoneOk, zone: sig.zone?.zone.zone ?? null, deep: !!sig.zone?.zone.deep,
    tfs: sig.checks.filter(Boolean).map((c) => ({ tf: c!.tf, kind: (side === 'long' ? c!.wt.long : c!.wt.short)?.kind ?? null, wt: r1(c!.wt.wt1), rsi: r1(c!.rsi) })),
  };
}
export const STRENGTH_LABEL = ['Kein Signal', 'Einstieg', 'Stark', 'Sehr stark', 'Maximal'];
