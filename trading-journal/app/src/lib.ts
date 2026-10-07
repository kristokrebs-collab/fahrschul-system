import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useEffect, useMemo, useRef, useState } from 'react';
import { rsi, tfSeconds, withLivePrice, DEFAULT_SIGNAL_CFG, type Bar, type SignalCfg, type SignalSnap } from './signals';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── Typen ───────────────────────────────────────────────
export type Account = 'makro' | 'scalp';
export type AccountFilter = Account | 'all';
export type CheckItem = { id: string; text: string };
export type Setup = { id: string; name: string; desc: string; color: string; account: Account | 'both'; checklist: CheckItem[] };
export type Trade = {
  id: string; account: Account; date: string; pair: string; timeframe: string;
  side: 'long' | 'short'; status: 'closed' | 'open';
  entry: number | null; stop: number | null; target: number | null; exit: number | null;
  size: number | null; leverage: number | null; fees: number | null; pnlManual: number | null;
  setups: string[]; checks: Record<string, boolean>; reason: string; conviction: number | null;
  followedPlan: boolean | null; emotion: string; notes: string; chart: string;
  pnl?: number | null; r?: number | null; createdAt?: string; updatedAt?: string;
  signal?: SignalSnap | null; // Signal-Check zum Zeitpunkt des Eintrags
  mistakes?: string[];         // Fehler-Tags (z. B. zu früh, Stop verschoben)
};
export type Market = {
  symbol: string; longTrigger: number; longStop: number; shortTrigger: number;
  lowerHigh: number; rsiWeekly: number; invalidation: number; zoneLow: number; zoneHigh: number;
};
export type HyblockCfg = { longEndpoint: string; longField: string; deltaEndpoint: string; deltaField: string; coin: string; exchange: string; timeframe: string };
export type Backtest = { winRate: number; avgWin: number; avgLoss: number; expectancy: number; label: string };
export type Settings = {
  currency: string; pair: string; startDate: string;
  capital: Record<Account, number>;
  setups: Setup[]; rules: CheckItem[]; backtest: Backtest; market: Market; hyblock: HyblockCfg; signals: SignalCfg;
  mistakes: string[];
};

// ── Deine Regeln als Startkonfiguration ────────────────
export const SETUP_COLORS = ['#6f9dc9', '#46a6a0', '#8c83cf', '#c9975b', '#c7768f', '#5fb0d6', '#9aa9bb', '#a0b56b'];
const ck = (...texts: string[]): CheckItem[] => texts.map((text, i) => ({ id: 'c' + (i + 1), text }));

export const MTF_SETUP: Setup = { id: 's_mtf', name: 'Multi-TF Signal (MCB + RSI + Discount)', account: 'both', color: '#9aa9bb',
  desc: 'Ab 30m: MCB zeigt Bottom/Einstieg (Short: Top), die nächst höhere Timeframe bestätigt, die dritte macht den Einstieg stärker. RSI nahe überverkauft/überkauft, Discount (Short: Premium) ist Bonus. Wird live geprüft.',
  checklist: [
    { id: 'mtf_base', text: 'MCB-Signal auf der Basis-Timeframe (mind. 30m)' },
    { id: 'mtf_next', text: 'Nächst höhere Timeframe bestätigt' },
    { id: 'mtf_third', text: 'Dritte Timeframe bestätigt (stärker)' },
    { id: 'mtf_rsi', text: 'RSI nahe überverkauft (Short: überkauft)' },
    { id: 'mtf_zone', text: 'Preis im Discount (Short: Premium)' },
  ] };

export const DEFAULT_SETUPS: Setup[] = [
  MTF_SETUP,
  { id: 's_p1', name: 'Früher Makro-Trendbruch', account: 'makro', color: '#6f9dc9',
    desc: 'Philosophie 1: Diagonale Downtrend-Linie und RSI-Trendlinie brechen. Höchstes Risiko, bester Preis.',
    checklist: ck('Diagonale Downtrend-Linie gebrochen', 'RSI-Trendlinie gebrochen', 'Top-down geprüft (W → 3D → D → 4H → 1H)') },
  { id: 's_p2', name: 'Lower-High-Bruch 82.829', account: 'makro', color: '#46a6a0',
    desc: 'Philosophie 2: Weekly Close über 82.829 UND Weekly RSI über 62,09. Beides nötig.',
    checklist: ck('Weekly Close über 82.829', 'Weekly RSI über 62,09') },
  { id: 's_p3', name: '4-Jahres-Zyklus-Bestätigung', account: 'makro', color: '#8c83cf',
    desc: 'Philosophie 3: Kein Zyklus-Bottom bis 21. Nov. Spätester Einstieg, höchste Bestätigung, schlechtester Preis.',
    checklist: ck('Kein neues Tief bis 21. Nov', 'Wochenschlüsse durchgehend über 82.829') },
  { id: 's_ml', name: 'Makro-Long Support-Zone', account: 'makro', color: '#5fb0d6',
    desc: 'Preis bei 81.500–82.200 plus Falling-Knife-Filter. Long-% allein ist kein Kaufsignal.',
    checklist: ck('Preis in Support-/Liquiditätszone (BSL/EQL)', 'Erster Higher Low oder BOS auf 1H/4H', 'Whale-vs-Retail-Delta positiv, 2–3 Kerzen in Folge', 'RSI: bullische Divergenz oder Trendlinienbruch') },
  { id: 's_ladder', name: 'Leg-Up-Ladder', account: 'makro', color: '#a0b56b',
    desc: 'Bestätigtes Measured-Move-Ziel mit Struktur nach oben durchbrochen: 15–25 % des verbleibenden Makro-Cash zukaufen.',
    checklist: ck('Ziel mit Struktur bestätigt, nicht nur Wick', 'Add höchstens 25 % des verbleibenden Makro-Cash') },
  { id: 's_bo', name: '4H-Breakout über 85.900', account: 'scalp', color: '#6f9dc9',
    desc: '4H-Schluss über 85.900: Ziel 87.200, dann 89.000–90.000. Invalidierung zurück unter 85.300.',
    checklist: ck('4H-Schluss über 85.900', 'Stop unter 85.300', 'S&P nicht in Ablehnung an 7.834–7.840') },
  { id: 's_short', name: '4H-Neckline-Short unter 84.500', account: 'scalp', color: '#c7768f',
    desc: '4H-Schluss unter 84.500: Ziel 82.000–81.500, Stop über 85.300.',
    checklist: ck('4H-Schluss unter 84.500', 'Stop über 85.300') },
  { id: 's_rej', name: 'Breakout-Ablehnung 85.700–85.900', account: 'scalp', color: '#c9975b',
    desc: 'Preis scheitert an der Ausbruchszone: Rückfall-Risiko bis zum BOS-Test bei 82.000.',
    checklist: ck('Ablehnung an 85.700–85.900 bestätigt', 'Stop über der Zone') },
  { id: 's_sweep', name: 'BSL/EQL Liquidity Sweep', account: 'both', color: '#46a6a0',
    desc: 'Preis fegt eine Liquiditätszone ab, bevor der eigentliche Move kommt.',
    checklist: ck('Liquidität klar abgeholt', 'Reclaim, Struktur dreht') },
  { id: 's_rsi', name: 'RSI-Trendlinienbruch', account: 'both', color: '#8c83cf',
    desc: 'Diagonale RSI-Trendlinie bricht: Momentum-Signal. Keine horizontalen RSI-Level.',
    checklist: ck('Diagonale RSI-Trendlinie gebrochen', 'Struktur bestätigt (BOS/CHoCH)') },
  { id: 's_bt', name: 'Backtest-Signal (214er)', account: 'scalp', color: '#5fb0d6',
    desc: 'Eigene Strategie: 62,15 % Winrate im Backtest. 4x Hebel, 250 USDT Margin isoliert, etwa 2 Trades pro Monat.',
    checklist: ck('4x Hebel, isoliert', 'Margin rund 250 USDT', 'Trailing-Stop ab +8–10 % geplant') },
];

export const DEFAULT_RULES: CheckItem[] = [
  { id: 'trigger', text: 'Trigger ausgelöst, nicht geraten' },
  { id: 'topdown', text: 'Top-down geprüft (W → 3D → D → 4H → 1H)' },
  { id: 'spx', text: 'S&P-500-Kontext geprüft' },
  { id: 'stop', text: 'Stop deutlich vor der Liquidation' },
  { id: 'lev', text: 'Hebel im Rahmen (Scalp 4x, Makro höchstens 5x)' },
];

export const DEFAULT_SETTINGS: Settings = {
  currency: 'USDT', pair: 'BTC/USDT', startDate: '',
  capital: { makro: 20000, scalp: 5000 },
  setups: DEFAULT_SETUPS, rules: DEFAULT_RULES,
  backtest: { winRate: 0.6215, avgWin: 0.1664, avgLoss: -0.0931, expectancy: 0.0682, label: '214 Signale' },
  hyblock: { longEndpoint: 'topTraderAccountsLongShort', longField: '', deltaEndpoint: 'whaleRetailDelta', deltaField: '', coin: 'BTC', exchange: 'binance_perp_stable', timeframe: '1h' },
  signals: DEFAULT_SIGNAL_CFG,
  mistakes: ['Zu früh rein', 'Kein Stop', 'Stop verschoben', 'Zu großer Hebel', 'FOMO-Einstieg', 'Gegen den Plan', 'Zu früh raus', 'Revenge-Trade'],
  market: { symbol: 'BITSTAMP:BTCUSD', longTrigger: 85900, longStop: 85300, shortTrigger: 84500, lowerHigh: 82829, rsiWeekly: 62.09, invalidation: 75500, zoneLow: 81500, zoneHigh: 82200 },
};

export function normalizeSettings(raw: any): Settings {
  const d = DEFAULT_SETTINGS, r = migrateSettings(raw) || {};
  return {
    currency: r.currency || d.currency, pair: r.pair || d.pair, startDate: r.startDate || '',
    capital: { makro: num(r.capital?.makro) ?? d.capital.makro, scalp: num(r.capital?.scalp) ?? d.capital.scalp },
    setups: Array.isArray(r.setups) ? r.setups.map((s: any) => ({ checklist: [], account: 'both', desc: '', ...s })) : d.setups,
    rules: Array.isArray(r.rules) ? r.rules : d.rules,
    backtest: { ...d.backtest, ...(r.backtest || {}) },
    market: { ...d.market, ...(r.market || {}) },
    hyblock: { ...d.hyblock, ...(r.hyblock || {}) },
    signals: { ...d.signals, ...(r.signals || {}) },
    mistakes: Array.isArray(r.mistakes) ? r.mistakes : d.mistakes,
  };
}
/** Einmalige Umstellung älterer Einstellungen: Signal-Check-Grundlage ergänzen, Chart-Symbol (Bitstamp) übernehmen. */
function migrateSettings(raw: any): any {
  if (!raw || raw.signals) return raw;
  const setups = Array.isArray(raw.setups) && !raw.setups.some((x: any) => x?.id === MTF_SETUP.id) ? [MTF_SETUP, ...raw.setups] : raw.setups;
  const market = raw.market?.symbol === 'BINANCE:BTCUSDT' ? { ...raw.market, symbol: 'BITSTAMP:BTCUSD' } : raw.market;
  return { ...raw, setups, market };
}

export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '45m', '1h', '2h', '4h', '1D', '3D', '1W'];
export const EMOTIONS = ['Ruhig', 'Fokussiert', 'Unsicher', 'FOMO', 'Gierig', 'Revenge'];
export const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const ACCOUNT_LABEL: Record<AccountFilter, string> = { all: 'Gesamt', makro: 'Makro', scalp: 'Scalp' };

// ── Formatierung ────────────────────────────────────────
const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const minus = (s: string) => s.replace('-', '−');
const ok = (v: any): v is number => v != null && isFinite(v);
export const fmt = {
  n0: (v: number | null | undefined) => ok(v) ? minus(nf0.format(v)) : '–',
  n1: (v: number | null | undefined) => ok(v) ? minus(nf1.format(v)) : '–',
  n2: (v: number | null | undefined) => ok(v) ? minus(nf2.format(v)) : '–',
  signed: (v: number | null | undefined, d = 2) => ok(v) ? minus((v > 0 ? '+' : '') + (d === 0 ? nf0 : d === 1 ? nf1 : nf2).format(v)) : '–',
  pct: (v: number | null | undefined, sign = true) => ok(v) ? minus((sign && v > 0 ? '+' : '') + nf1.format(v * 100)) + ' %' : '–',
  pct0: (v: number | null | undefined) => ok(v) ? nf0.format(v * 100) + ' %' : '–',
  r: (v: number | null | undefined) => ok(v) ? minus((v > 0 ? '+' : '') + nf2.format(v)) + ' R' : '–',
  price: (v: number | null | undefined) => ok(v) ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: v < 10 ? 4 : 2 }).format(v) : '–',
  date: (d: Date) => isNaN(+d) ? '–' : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }),
  time: (d: Date) => isNaN(+d) ? '' : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
};
export const tone = (v: number | null | undefined) => !ok(v) || v === 0 ? 'text-fg' : v > 0 ? 'text-win' : 'text-loss';
export function num(raw: any): number | null {
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;
  let s = String(raw ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : null;
}
export const toInput = (v: number | null | undefined) => v == null ? '' : String(v).replace('.', ',');
export const tDate = (t: Pick<Trade, 'date' | 'createdAt'>) => new Date(t.date || t.createdAt || 0);
export const uid = (p: string) => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
export const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
export const safeUrl = (u: string) => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '';

// ── Berechnung ──────────────────────────────────────────
export type Calc = { pnl: number | null; risk: number | null; r: number | null; rr: number | null; move: number | null; result: 'win' | 'loss' | 'be' | 'open' };
export type ETrade = Trade & Calc & { items: CheckItem[]; checked: number; complete: boolean | null };

export function calc(t: Partial<Trade>): Calc {
  const e = t.entry || 0, x = t.exit || 0, s = t.stop || 0, tp = t.target || 0, size = t.size || 0, fees = t.fees || 0;
  const dir = t.side === 'short' ? -1 : 1;
  const qty = e > 0 && size > 0 ? size / e : 0;
  const closed = t.status !== 'open';
  let pnl: number | null = null;
  if (ok(t.pnlManual)) pnl = t.pnlManual;
  else if (closed && e > 0 && x > 0 && qty) pnl = (x - e) * qty * dir - fees;
  const risk = e > 0 && s > 0 && qty ? Math.abs(e - s) * qty : null;
  const r = pnl != null && risk ? pnl / risk : null;
  const rr = e > 0 && s > 0 && tp > 0 && e !== s ? Math.abs(tp - e) / Math.abs(e - s) : null;
  const move = closed && e > 0 && x > 0 ? ((x - e) / e) * dir : null;
  const result = !closed || pnl == null ? 'open' : pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'be';
  return { pnl, risk, r, rr, move, result };
}

/** Alle Checklisten-Punkte eines Trades: allgemeine Regeln + Punkte der gewählten Grundlagen. */
export function checkItems(setupIds: string[], settings: Settings): CheckItem[] {
  const items: CheckItem[] = settings.rules.map((r) => ({ id: 'g:' + r.id, text: r.text }));
  for (const s of settings.setups) if (setupIds.includes(s.id)) for (const c of s.checklist) items.push({ id: s.id + ':' + c.id, text: c.text });
  return items;
}

export function enrich(t: Trade, settings: Settings): ETrade {
  const items = checkItems(t.setups || [], settings);
  const checked = items.filter((i) => t.checks?.[i.id]).length;
  return { ...t, ...calc(t), items, checked, complete: items.length ? checked === items.length : null };
}

export type Group = ReturnType<typeof group>;
export function group(list: ETrade[]) {
  const n = list.length;
  let wins = 0, losses = 0, net = 0, gw = 0, gl = 0, fees = 0, rs = 0, rn = 0, r2 = 0, mw = 0, mwn = 0, ml = 0, mln = 0, ms = 0, mn = 0;
  let best: ETrade | null = null, worst: ETrade | null = null, bestR: number | null = null, worstR: number | null = null;
  for (const t of list) {
    const p = t.pnl || 0;
    net += p; fees += t.fees || 0;
    if (p > 0) { wins++; gw += p; } else if (p < 0) { losses++; gl += p; }
    if (!best || p > (best.pnl || 0)) best = t;
    if (!worst || p < (worst.pnl || 0)) worst = t;
    if (ok(t.r)) { rs += t.r; rn++; if (t.r >= 2) r2++; bestR = bestR == null ? t.r : Math.max(bestR, t.r); worstR = worstR == null ? t.r : Math.min(worstR, t.r); }
    if (ok(t.move)) { ms += t.move; mn++; if (p > 0) { mw += t.move; mwn++; } else if (p < 0) { ml += t.move; mln++; } }
  }
  const avgWin = wins ? gw / wins : null, avgLoss = losses ? gl / losses : null;
  return {
    n, wins, losses, be: n - wins - losses, net, gw, gl, fees,
    winRate: n ? wins / n : null,
    pf: gl < 0 ? gw / -gl : gw > 0 ? Infinity : null,
    avgWin, avgLoss,
    /** Win-Rate, ab der das Verhältnis Ø Gewinn zu Ø Verlust profitabel ist */
    beWinRate: avgWin != null && avgLoss != null ? -avgLoss / (avgWin - avgLoss) : null,
    payoff: avgWin != null && avgLoss != null ? avgWin / -avgLoss : null,
    avgR: rn ? rs / rn : null, rN: rn, r2, bestR, worstR, exp: n ? net / n : null,
    best: n ? best : null, worst: n ? worst : null,
    moveWin: mwn ? mw / mwn : null, moveLoss: mln ? ml / mln : null, moveExp: mn ? ms / mn : null, moveN: mn,
  };
}

export function stats(all: ETrade[], settings: Settings, filter: AccountFilter) {
  const start = filter === 'all' ? settings.capital.makro + settings.capital.scalp : settings.capital[filter];
  const list = filter === 'all' ? all : all.filter((t) => (t.account || 'scalp') === filter);
  const closed = list.filter((t) => t.result !== 'open').sort((a, b) => +tDate(a) - +tDate(b));
  const open = list.filter((t) => t.result === 'open');
  const g = group(closed);

  const equity: { i: number; v: number; t: ETrade | null }[] = [{ i: 0, v: start, t: null }];
  let bal = start, peak = start, maxDD = 0, peakAt = 0;
  const dd = { peak: start, trough: start, peakI: 0, troughI: 0 };
  closed.forEach((t, i) => {
    bal += t.pnl || 0; equity.push({ i: i + 1, v: bal, t });
    if (bal > peak) { peak = bal; peakAt = i + 1; }
    const cur = peak > 0 ? (bal - peak) / peak : 0;
    if (cur < maxDD) { maxDD = cur; Object.assign(dd, { peak, trough: bal, peakI: peakAt, troughI: i + 1 }); }
  });
  const curDD = peak > 0 ? (bal - peak) / peak : 0;

  let streak = 0, streakType: string | null = null;
  for (let i = closed.length - 1; i >= 0; i--) { const ty = closed[i].result; if (!streakType) streakType = ty; if (ty !== streakType) break; streak++; }

  const mMap = new Map<string, ETrade[]>();
  for (const t of closed) { const d = tDate(t); const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); if (!mMap.has(k)) mMap.set(k, []); mMap.get(k)!.push(t); }
  const months = [...mMap.keys()].sort().slice(-12).map((k) => { const [y, m] = k.split('-'); return { key: k, label: MONTHS[+m - 1] + ' ' + y.slice(2), ...group(mMap.get(k)!) }; });

  let proj = null as null | { days: number; r: number; linear: number; comp: number; monthly: number; perWeek: number; endLin: number; weak: boolean };
  if (closed.length && start > 0) {
    const first = settings.startDate ? new Date(settings.startDate + 'T00:00') : tDate(closed[0]);
    const end = Math.max(Date.now(), +tDate(closed[closed.length - 1]));
    const days = Math.max(1, (end - +first) / 864e5);
    const r = g.net / start;
    const linear = (r * 365) / days;
    proj = { days, r, linear, comp: 1 + r > 0 ? Math.pow(1 + r, 365 / days) - 1 : -1, monthly: (r * 30.44) / days, perWeek: closed.length / (days / 7), endLin: start * (1 + linear), weak: closed.length < 10 || days < 30 };
  }

  const known = new Set(settings.setups.map((s) => s.id));
  const setups = settings.setups.map((s) => ({ setup: s, ...group(closed.filter((t) => (t.setups || []).includes(s.id))) }));
  const none = closed.filter((t) => !(t.setups || []).some((id) => known.has(id)));

  return { start, list, closed, open, g, equity, balance: bal, maxDD, dd, curDD, peak, streak, streakType, months, proj, setups, none: group(none) };
}
export type Stats = ReturnType<typeof stats>;

// ── Speicher: claude.ai-Datenbank, sonst Browser ───────
declare global { interface Window { claude?: { use: (n: string) => Promise<any> } } }
export const useCap = (name: string) => window.claude?.use ? window.claude.use(name).catch(() => null) : Promise.resolve(null);

export type Mode = 'connecting' | 'cloud' | 'local' | 'error';
/** Hyblock-Ablesung: Top-Trader Long-%, Whale-vs-Retail-Delta und die manuellen Filterpunkte. */
export type Hyblock = { id: string; at: string; longPct: number; delta: number; deltaCandles: number; structure: boolean; rsi: boolean; note: string };
export type Api = {
  saveTrade: (t: Trade) => Promise<void>;
  deleteTrade: (id: string) => Promise<void>;
  saveSettings: (s: Settings) => Promise<void>;
  saveHyblock: (h: Hyblock) => Promise<void>;
  deleteHyblock: (id: string) => Promise<void>;
};

export function useJournal() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [mode, setMode] = useState<Mode>('connecting');
  const [loaded, setLoaded] = useState({ t: false, s: false });
  const [hyblock, setHyblock] = useState<Hyblock[]>([]);
  const api = useRef<Api | null>(null);

  useEffect(() => {
    let unsubs: Array<() => void> = [];
    let alive = true;
    (async () => {
      const db = await useCap('db');
      if (!alive) return;
      if (!db) {
        const read = (k: string, d: any) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
        const write = (k: string, v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ohne Speicher */ } };
        let local: Trade[] = read('tj2-trades', []);
        let localS = normalizeSettings(read('tj2-settings', null));
        let localH: Hyblock[] = read('tj2-hyblock', []);
        setTrades(local); setSettings(localS); setHyblock(localH); setMode('local'); setLoaded({ t: true, s: true });
        api.current = {
          async saveTrade(t) { const id = t.id || uid('t_'); local = local.filter((x) => x.id !== id).concat([{ ...t, id }]); write('tj2-trades', local); setTrades(local); },
          async deleteTrade(id) { local = local.filter((x) => x.id !== id); write('tj2-trades', local); setTrades(local); },
          async saveSettings(s) { localS = s; write('tj2-settings', s); setSettings(s); },
          async saveHyblock(h) { const id = h.id || uid('h_'); localH = localH.filter((x) => x.id !== id).concat([{ ...h, id }]); write('tj2-hyblock', localH); setHyblock(localH); },
          async deleteHyblock(id) { localH = localH.filter((x) => x.id !== id); write('tj2-hyblock', localH); setHyblock(localH); },
        };
        return;
      }
      setMode('cloud');
      const fail = () => setMode('error');
      unsubs.push(db.collection('trades').onSnapshot((snap: any) => { setTrades(snap.docs.map((d: any) => ({ id: d.id, ...JSON.parse(JSON.stringify(d.data())) }))); setLoaded((l) => ({ ...l, t: true })); }, fail));
      unsubs.push(db.collection('hyblock').onSnapshot((snap: any) => { setHyblock(snap.docs.map((d: any) => ({ id: d.id, ...JSON.parse(JSON.stringify(d.data())) }))); }, fail));
      unsubs.push(db.doc('config/settings').onSnapshot((snap: any) => { setSettings(normalizeSettings(snap.exists ? JSON.parse(JSON.stringify(snap.data())) : null)); setLoaded((l) => ({ ...l, s: true })); }, fail));
      api.current = {
        async saveTrade(t) { const { id, ...data } = t; if (id) await db.collection('trades').doc(id).set(data); else await db.collection('trades').add(data); },
        async deleteTrade(id) { await db.collection('trades').doc(id).delete(); },
        async saveSettings(s) { await db.doc('config/settings').set(s); },
        async saveHyblock(h) { const { id, ...data } = h; if (id) await db.collection('hyblock').doc(id).set(data); else await db.collection('hyblock').add(data); },
        async deleteHyblock(id) { await db.collection('hyblock').doc(id).delete(); },
      };
    })();
    return () => { alive = false; unsubs.forEach((u) => u()); };
  }, []);

  const enriched = useMemo(() => trades.map((t) => enrich(t, settings)), [trades, settings]);
  const hyblockSorted = useMemo(() => [...hyblock].sort((a, b) => a.at.localeCompare(b.at)), [hyblock]);
  return { trades, enriched, settings, hyblock: hyblockSorted, mode, loaded: loaded.t && loaded.s, api };
}

// ── Live-Markt über den TradingView-Connector ──────────
export type MarketState = {
  status: 'connecting' | 'live' | 'unavailable' | 'error';
  message?: string;
  price?: number; change?: number; rsiW?: number;
  close4h?: number; close4hAt?: number; closeW?: number; closeWAt?: number;
  updatedAt?: number;      // letzter erfolgreicher Abruf
  quoteLive?: boolean;     // Kurs aus dem Echtzeit-Quote (sonst letzte Kerze, ggf. verzögert)
  bars?: Record<string, Bar[]>; // Kerzen je Timeframe, letzte Kerze mit Live-Kurs ergänzt
  refreshing?: boolean;
  refresh?: () => void;
};
const TV = 'TradingView';
const ERR_TEXT: Record<string, string> = {
  needs_reauth: 'TradingView neu verbinden: claude.ai → Einstellungen → Connectors.',
  server_not_connected: 'TradingView-Connector in claude.ai unter Einstellungen → Connectors hinzufügen.',
  selection_required: 'Mehrere TradingView-Verbindungen gefunden. Wähle eine in der Abfrage von claude.ai.',
  not_in_manifest: 'TradingView ist für diese Seite nicht freigegeben. Lade die Seite neu, um die Freigabe zu erteilen.',
  blocked_by_policy: 'TradingView ist durch eine Richtlinie deiner Organisation gesperrt.',
  approval_required: 'TradingView braucht eine Freigabe pro Abfrage, das geht in dieser Ansicht nicht.',
};
const payloadOf = (res: any) => res?.payload ?? res?.structuredContent ?? null;
function lastClosed(bars: Bar[] | undefined, sec: number) {
  const now = Date.now() / 1000;
  const done = (bars || []).filter((b) => b.t + sec <= now + 60);
  const b = done[done.length - 1];
  return b ? { c: b.c, t: (b.t + sec) * 1000 } : null;
}
const cleanBars = (raw: any): Bar[] => (Array.isArray(raw) ? raw : [])
  .filter((b) => b && ok(b.t) && ok(b.o) && ok(b.h) && ok(b.l) && ok(b.c))
  .map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));

export const PRICE_EVERY = 60_000;
const HARD_ERRORS = ['needs_reauth', 'server_not_connected', 'not_in_manifest', 'blocked_by_policy', 'approval_required', 'not_granted', 'capability_disabled', 'capability_removed', 'selection_required'];
/** Abrufintervall je Timeframe: kleine Kerzen öfter, Wochenkerze selten. */
const barsEvery = (sec: number) => (sec <= 1800 ? 60_000 : sec <= 3600 ? 90_000 : sec <= 14400 ? 180_000 : 900_000);

/**
 * Live-Markt über den TradingView-Connector. Alles wird aus Kerzen (get-ohlcv) berechnet, weil der
 * Screener-Abruf schnell ins Rate-Limit läuft. Zusätzlich holt ein seltener Quote-Abruf den echten
 * Live-Kurs; damit wird die laufende Kerze jedes Timeframes ergänzt, so wie der Chart sie zeigt.
 * Abrufe laufen nacheinander (kein Burst), pausieren im Hintergrund-Tab und weichen bei Fehlern aus.
 */
export function useMarket(symbol: string, tfs: string[]): MarketState {
  const [st, setSt] = useState<{ status: MarketState['status']; message?: string; quote?: { price: number; change?: number; at: number }; raw: Record<string, Bar[]>; updatedAt?: number; refreshing?: boolean }>({ status: 'connecting', raw: {} });
  const runRef = useRef<(force?: boolean) => void>(() => {});
  const tfKey = [...new Set([...tfs, '4h', '1W'])].filter((tf) => tfSeconds(tf)).join(',');
  useEffect(() => {
    let alive = true;
    let mcp: any = null;
    const next: Record<string, number> = {};
    const fails: Record<string, number> = {};
    let running = false;
    setSt({ status: 'connecting', raw: {} });
    type Job = { key: string; tool: string; input: any; every: number; apply: (p: any) => void };
    const jobs: Job[] = [
      ...tfKey.split(',').map((tf): Job => ({
        key: tf, tool: 'mcp-tv-get-ohlcv', input: { symbol, interval: tf, count: tf === '1W' ? 260 : 500 }, every: barsEvery(tfSeconds(tf)),
        apply: (p) => { const bars = cleanBars(p?.bars); if (bars.length) setSt((s) => ({ ...s, raw: { ...s.raw, [tf]: bars } })); },
      })),
      { key: 'quote', tool: 'mcp-tv-get-symbol-data', input: { symbol, columns: ['close', 'change'] }, every: PRICE_EVERY,
        apply: (p) => { const d = p?.data || p || {}; const price = num(d.close); if (price != null) setSt((s) => ({ ...s, quote: { price, change: num(d.change) ?? undefined, at: Date.now() } })); } },
    ];
    const run = async (force = false) => {
      if (!alive || !mcp || running || document.hidden) return;
      const now = Date.now();
      const due = jobs.filter((j) => force || !next[j.key] || now >= next[j.key]);
      if (!due.length) return;
      running = true;
      if (force) setSt((s) => ({ ...s, refreshing: true }));
      for (const j of due) {
        if (!alive) break;
        try {
          const res = await mcp.callTool(TV, j.tool, j.input, { cache: false });
          fails[j.key] = 0;
          next[j.key] = Date.now() + j.every;
          j.apply(payloadOf(res));
          if (alive) setSt((s) => ({ ...s, status: 'live', message: undefined, updatedAt: Date.now() }));
        } catch (e: any) {
          const code = e?.code || 'upstream_error';
          if (HARD_ERRORS.includes(code)) {
            if (alive) setSt((s) => ({ ...s, status: 'error', message: ERR_TEXT[code] || 'TradingView ist in dieser Ansicht nicht verfügbar.' }));
            running = false; return;
          }
          // Rate-Limit oder kurzer Ausfall: exponentiell länger warten (15 s, 30 s, 60 s … max. 5 min)
          fails[j.key] = (fails[j.key] || 0) + 1;
          next[j.key] = Date.now() + Math.min(300_000, 15_000 * 2 ** (fails[j.key] - 1));
          if (alive && j.key !== 'quote') setSt((s) => ({ ...s, status: Object.keys(s.raw).length ? s.status : 'error', message: 'TradingView antwortet gerade nicht, neuer Versuch gleich.' }));
        }
      }
      running = false;
      if (alive && force) setSt((s) => ({ ...s, refreshing: false }));
    };
    runRef.current = run;
    const tick = setInterval(() => run(), 5_000);
    const onVis = () => { if (!document.hidden) run(); };
    document.addEventListener('visibilitychange', onVis);
    (async () => {
      mcp = await useCap('mcp');
      if (!alive) return;
      if (!mcp) { setSt({ status: 'unavailable', raw: {}, message: 'Live-Kurs gibt es nur, wenn das Journal auf claude.ai geöffnet ist.' }); return; }
      run(true);
    })();
    return () => { alive = false; clearInterval(tick); document.removeEventListener('visibilitychange', onVis); };
  }, [symbol, tfKey]);

  const refresh = useMemo(() => () => runRef.current(true), []);
  return useMemo(() => {
    const q = st.quote && Date.now() - st.quote.at < 5 * 60_000 ? st.quote : undefined;
    const bars: Record<string, Bar[]> = {};
    for (const [tf, b] of Object.entries(st.raw) as [string, Bar[]][]) bars[tf] = q ? withLivePrice(b, tfSeconds(tf), q.price, q.at) : b;
    const base = bars['30m'] || bars[tfs[0]] || bars['1h'] || bars['4h'];
    const price = q?.price ?? base?.[base.length - 1]?.c;
    let change = q?.change;
    if (change == null && base?.length) {
      const sec = tfSeconds(base === bars['30m'] ? '30m' : tfs[0]) || 1800;
      const ref = base[base.length - 1 - Math.round(86400 / sec)];
      if (ref && price != null) change = (price / ref.c - 1) * 100;
    }
    const w = bars['1W'];
    const rw = w && w.length > 20 ? rsi(w.map((b) => b.c), 14) : null;
    const c4 = lastClosed(st.raw['4h'], 4 * 3600), cw = lastClosed(st.raw['1W'], 7 * 86400);
    return {
      status: st.status, message: st.message, updatedAt: st.updatedAt, refreshing: st.refreshing, refresh,
      price, change, quoteLive: !!q, bars,
      rsiW: rw ? rw[rw.length - 1] : undefined,
      close4h: c4?.c, close4hAt: c4?.t, closeW: cw?.c, closeWAt: cw?.t,
    } as MarketState;
  }, [st, refresh, tfs.join(',')]);
}

export type Scenario = { key: 'bear' | 'long' | 'short' | 'range'; title: string; detail: string; tone: 'win' | 'loss' | 'warn' | 'mute' };
export function scenario(c: number | undefined, m: Market): Scenario | null {
  if (c == null) return null;
  const p = fmt.n0;
  if (c < m.invalidation) return { key: 'bear', title: 'Volles Bär-Szenario', detail: `4H-Schluss unter ${p(m.invalidation)}. Ziel 66.000–70.000.`, tone: 'loss' };
  if (c > m.longTrigger) return { key: 'long', title: 'Long-Trigger aktiv', detail: `4H-Schluss über ${p(m.longTrigger)}. Ziel 87.200, dann 89.000–90.000. Invalidierung unter ${p(m.longStop)}.`, tone: 'win' };
  if (c < m.shortTrigger) return { key: 'short', title: 'Short-Trigger aktiv', detail: `4H-Schluss unter ${p(m.shortTrigger)}. Ziel 82.000–81.500, Stop über ${p(m.longStop)}.`, tone: 'loss' };
  return { key: 'range', title: 'Range, kein Trigger', detail: `4H-Schluss zwischen ${p(m.shortTrigger)} und ${p(m.longTrigger)}. Abwarten.`, tone: 'mute' };
}
