import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useEffect, useMemo, useRef, useState } from 'react';

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
};
export type Market = {
  symbol: string; longTrigger: number; longStop: number; shortTrigger: number;
  lowerHigh: number; rsiWeekly: number; invalidation: number; zoneLow: number; zoneHigh: number;
};
export type Backtest = { winRate: number; avgWin: number; avgLoss: number; expectancy: number; label: string };
export type Settings = {
  currency: string; pair: string; startDate: string;
  capital: Record<Account, number>;
  setups: Setup[]; rules: CheckItem[]; backtest: Backtest; market: Market;
};

// ── Deine Regeln als Startkonfiguration ────────────────
export const SETUP_COLORS = ['#6f9dc9', '#46a6a0', '#8c83cf', '#c9975b', '#c7768f', '#5fb0d6', '#9aa9bb', '#a0b56b'];
const ck = (...texts: string[]): CheckItem[] => texts.map((text, i) => ({ id: 'c' + (i + 1), text }));

export const DEFAULT_SETUPS: Setup[] = [
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
  market: { symbol: 'BINANCE:BTCUSDT', longTrigger: 85900, longStop: 85300, shortTrigger: 84500, lowerHigh: 82829, rsiWeekly: 62.09, invalidation: 75500, zoneLow: 81500, zoneHigh: 82200 },
};

export function normalizeSettings(raw: any): Settings {
  const d = DEFAULT_SETTINGS, r = raw || {};
  return {
    currency: r.currency || d.currency, pair: r.pair || d.pair, startDate: r.startDate || '',
    capital: { makro: num(r.capital?.makro) ?? d.capital.makro, scalp: num(r.capital?.scalp) ?? d.capital.scalp },
    setups: Array.isArray(r.setups) ? r.setups.map((s: any) => ({ checklist: [], account: 'both', desc: '', ...s })) : d.setups,
    rules: Array.isArray(r.rules) ? r.rules : d.rules,
    backtest: { ...d.backtest, ...(r.backtest || {}) },
    market: { ...d.market, ...(r.market || {}) },
  };
}

export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1D', '3D', '1W'];
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
  let wins = 0, losses = 0, net = 0, gw = 0, gl = 0, rs = 0, rn = 0, mw = 0, mwn = 0, ml = 0, mln = 0, ms = 0, mn = 0;
  for (const t of list) {
    const p = t.pnl || 0;
    net += p;
    if (p > 0) { wins++; gw += p; } else if (p < 0) { losses++; gl += p; }
    if (ok(t.r)) { rs += t.r; rn++; }
    if (ok(t.move)) { ms += t.move; mn++; if (p > 0) { mw += t.move; mwn++; } else if (p < 0) { ml += t.move; mln++; } }
  }
  return {
    n, wins, losses, be: n - wins - losses, net,
    winRate: n ? wins / n : null,
    pf: gl < 0 ? gw / -gl : gw > 0 ? Infinity : null,
    avgWin: wins ? gw / wins : null, avgLoss: losses ? gl / losses : null,
    avgR: rn ? rs / rn : null, exp: n ? net / n : null,
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
  let bal = start, peak = start, maxDD = 0;
  closed.forEach((t, i) => { bal += t.pnl || 0; equity.push({ i: i + 1, v: bal, t }); peak = Math.max(peak, bal); if (peak > 0) maxDD = Math.min(maxDD, (bal - peak) / peak); });

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

  return { start, list, closed, open, g, equity, balance: bal, maxDD, streak, streakType, months, proj, setups, none: group(none) };
}
export type Stats = ReturnType<typeof stats>;

// ── Speicher: claude.ai-Datenbank, sonst Browser ───────
declare global { interface Window { claude?: { use: (n: string) => Promise<any> } } }
export const useCap = (name: string) => window.claude?.use ? window.claude.use(name).catch(() => null) : Promise.resolve(null);

export type Mode = 'connecting' | 'cloud' | 'local' | 'error';
export type Api = {
  saveTrade: (t: Trade) => Promise<void>;
  deleteTrade: (id: string) => Promise<void>;
  saveSettings: (s: Settings) => Promise<void>;
};

export function useJournal() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [mode, setMode] = useState<Mode>('connecting');
  const [loaded, setLoaded] = useState({ t: false, s: false });
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
        setTrades(local); setSettings(localS); setMode('local'); setLoaded({ t: true, s: true });
        api.current = {
          async saveTrade(t) { const id = t.id || uid('t_'); local = local.filter((x) => x.id !== id).concat([{ ...t, id }]); write('tj2-trades', local); setTrades(local); },
          async deleteTrade(id) { local = local.filter((x) => x.id !== id); write('tj2-trades', local); setTrades(local); },
          async saveSettings(s) { localS = s; write('tj2-settings', s); setSettings(s); },
        };
        return;
      }
      setMode('cloud');
      const fail = () => setMode('error');
      unsubs.push(db.collection('trades').onSnapshot((snap: any) => { setTrades(snap.docs.map((d: any) => ({ id: d.id, ...JSON.parse(JSON.stringify(d.data())) }))); setLoaded((l) => ({ ...l, t: true })); }, fail));
      unsubs.push(db.doc('config/settings').onSnapshot((snap: any) => { setSettings(normalizeSettings(snap.exists ? JSON.parse(JSON.stringify(snap.data())) : null)); setLoaded((l) => ({ ...l, s: true })); }, fail));
      api.current = {
        async saveTrade(t) { const { id, ...data } = t; if (id) await db.collection('trades').doc(id).set(data); else await db.collection('trades').add(data); },
        async deleteTrade(id) { await db.collection('trades').doc(id).delete(); },
        async saveSettings(s) { await db.doc('config/settings').set(s); },
      };
    })();
    return () => { alive = false; unsubs.forEach((u) => u()); };
  }, []);

  const enriched = useMemo(() => trades.map((t) => enrich(t, settings)), [trades, settings]);
  return { trades, enriched, settings, mode, loaded: loaded.t && loaded.s, api };
}

// ── Live-Markt über den TradingView-Connector ──────────
export type MarketState = {
  status: 'connecting' | 'live' | 'unavailable' | 'error';
  message?: string;
  price?: number; change?: number; rsiW?: number;
  close4h?: number; close4hAt?: number; closeW?: number; closeWAt?: number;
  updatedAt?: number;
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
function lastClosed(bars: any[], sec: number) {
  const now = Date.now() / 1000;
  const done = (bars || []).filter((b) => b && ok(b.c) && b.t + sec <= now + 60);
  const b = done[done.length - 1];
  return b ? { c: b.c as number, t: (b.t + sec) * 1000 } : null;
}

export function useMarket(symbol: string): MarketState {
  const [st, setSt] = useState<MarketState>({ status: 'connecting' });
  useEffect(() => {
    let alive = true;
    const offs: Array<() => void> = [];
    (async () => {
      const mcp = await useCap('mcp');
      if (!alive) return;
      if (!mcp) { setSt({ status: 'unavailable', message: 'Live-Kurs gibt es nur, wenn das Journal auf claude.ai geöffnet ist.' }); return; }
      const onErr = (e: any) => {
        const code = e?.code || 'upstream_error';
        const hard = ['needs_reauth', 'server_not_connected', 'not_in_manifest', 'blocked_by_policy', 'approval_required', 'not_granted', 'capability_disabled'].includes(code);
        setSt((s) => hard
          ? { status: 'error', message: ERR_TEXT[code] || 'TradingView ist in dieser Ansicht nicht verfügbar.' }
          : { ...s, status: s.price != null ? s.status : 'error', message: 'TradingView antwortet gerade nicht. Letzter Stand bleibt sichtbar.' });
      };
      const stamp = (res: any) => res?.cache?.storedAt ?? Date.now();
      const watch = (tool: string, input: any, every: number, apply: (p: any, res: any) => Partial<MarketState>) => {
        try {
          offs.push(mcp.watchTool(TV, tool, input, (ev: any) => {
            if (!alive) return;
            if (ev.type === 'error') return onErr(ev.error);
            const p = payloadOf(ev.result);
            if (!p) return;
            setSt((s) => ({ ...s, ...apply(p, ev.result), status: 'live', message: undefined, updatedAt: Math.max(s.updatedAt || 0, stamp(ev.result)) }));
          }, { refetchInterval: every, cache: { staleTime: every / 2 } }));
        } catch (e) { onErr(e); }
      };
      watch('mcp-tv-get-symbol-data', { symbol, columns: ['close', 'change', 'RSI|1W'] }, 60_000, (p) => {
        const d = p.data || p;
        return { price: num(d.close) ?? undefined, change: num(d.change) ?? undefined, rsiW: num(d['RSI|1W']) ?? undefined };
      });
      watch('mcp-tv-get-ohlcv', { symbol, interval: '4h', count: 4 }, 300_000, (p) => {
        const b = lastClosed(p.bars, 4 * 3600);
        return b ? { close4h: b.c, close4hAt: b.t } : {};
      });
      watch('mcp-tv-get-ohlcv', { symbol, interval: '1W', count: 3 }, 1_800_000, (p) => {
        const b = lastClosed(p.bars, 7 * 86400);
        return b ? { closeW: b.c, closeWAt: b.t } : {};
      });
    })();
    return () => { alive = false; offs.forEach((o) => { try { o(); } catch { /* egal */ } }); };
  }, [symbol]);
  return st;
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
