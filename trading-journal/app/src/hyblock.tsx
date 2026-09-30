// Top-Trader-Panel (Hyblock) mit Falling-Knife-Filter aus den eigenen Regeln (Abschnitt 13).
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { cn, fmt, nowLocal, num, useCap, type Hyblock, type MarketState, type Settings } from './lib';
import { Btn, Card, CheckRow, Detail, Empty, Field, inputCls } from './ui';
import { Morph, useMorph } from './morph';

const HYBLOCK_URL = 'https://hyblockcapital.com/console?user=HBC&dashboard=default&shared=true';

export function filterState(h: Hyblock | undefined, prev: Hyblock | undefined, m: MarketState, s: Settings) {
  const price = m.price;
  const zone = price != null ? price >= s.market.zoneLow && price <= s.market.zoneHigh : null;
  const pts = [
    { k: 'zone', l: 'Preis in Support-/Liquiditätszone', ok: zone, src: price != null ? `TradingView ${fmt.n0(price)} · Zone ${fmt.n0(s.market.zoneLow)}–${fmt.n0(s.market.zoneHigh)}` : 'wartet auf Live-Kurs' },
    { k: 'struct', l: 'Erster Higher Low oder BOS auf 1H/4H', ok: h ? h.structure : null, src: 'deine Ablesung' },
    { k: 'delta', l: 'Whale-vs-Retail-Delta positiv, 2–3 Kerzen', ok: h ? h.delta > 0 && h.deltaCandles >= 2 : null, src: h ? `Delta ${fmt.signed(h.delta, 1)} · ${h.deltaCandles} Kerzen` : '–' },
    { k: 'rsi', l: 'RSI bullische Divergenz oder Trendlinienbruch', ok: h ? h.rsi : null, src: 'deine Ablesung' },
  ];
  const n = pts.filter((p) => p.ok).length;
  const rising = h && prev ? h.longPct > prev.longPct : null;
  const knife = !!(rising && h && h.delta <= 0 && !h.structure && !h.rsi);
  return { pts, n, rising, knife, all: n === 4 };
}

function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return <div className="h-12" />;
  const w = 220, h = 48, min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 8)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="hbf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f2f2f2" stopOpacity="0.35" /><stop offset="1" stopColor="#f2f2f2" stopOpacity="0" /></linearGradient></defs>
      <motion.path d={d + `L${w},${h}L0,${h}Z`} fill="url(#hbf)"  />
      <motion.path d={d} fill="none" stroke="#f2f2f2" strokeWidth="1.6" strokeLinejoin="round"  />
      <circle cx={last[0]} cy={last[1]} r="3" fill="#e5202e" />
    </svg>
  );
}

function HyblockForm({ onSave, last }: { onSave: (h: Hyblock) => Promise<void>; last?: Hyblock }) {
  const { close } = useMorph();
  const [v, setV] = useState({ at: nowLocal(), longPct: last ? String(last.longPct).replace('.', ',') : '', delta: '', deltaCandles: '0', note: '' });
  const [structure, setStructure] = useState(false);
  const [rsi, setRsi] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    const longPct = num(v.longPct), delta = num(v.delta), candles = num(v.deltaCandles);
    if (longPct == null || longPct < 0 || longPct > 100) return setErr('Long-% zwischen 0 und 100 eintragen.');
    if (delta == null) return setErr('Delta eintragen, positiv oder negativ.');
    try { await onSave({ id: '', at: v.at, longPct, delta, deltaCandles: Math.max(0, Math.round(candles || 0)), structure, rsi, note: v.note.trim() }); close(); }
    catch { setErr('Speichern fehlgeschlagen.'); }
  }
  return (
    <div className="grid gap-4">
      <p className="text-[13px] text-mute">Werte aus dem Hyblock-Dashboard ablesen und eintragen. Das Journal wertet sie zusammen mit dem Live-Kurs gegen deinen Falling-Knife-Filter aus.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Zeitpunkt" htmlFor="hb-at" className="col-span-2"><input id="hb-at" type="datetime-local" className={inputCls} value={v.at} onChange={set('at')} /></Field>
        <Field label="Top Trader Long %" htmlFor="hb-long"><input id="hb-long" className={cn(inputCls, 'font-mono')} inputMode="decimal" value={v.longPct} onChange={set('longPct')} placeholder="z. B. 58,4" /></Field>
        <Field label="Whale-vs-Retail-Delta" htmlFor="hb-delta"><input id="hb-delta" className={cn(inputCls, 'font-mono')} inputMode="decimal" value={v.delta} onChange={set('delta')} placeholder="z. B. 12,5 oder −4" /></Field>
        <Field label="Delta positiv seit Kerzen" htmlFor="hb-c" help="Aufeinanderfolgende Kerzen mit positivem Delta"><input id="hb-c" className={cn(inputCls, 'font-mono')} inputMode="numeric" value={v.deltaCandles} onChange={set('deltaCandles')} /></Field>
        <Field label="Notiz" htmlFor="hb-note"><input id="hb-note" className={inputCls} value={v.note} onChange={set('note')} placeholder="optional" /></Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <CheckRow checked={structure} onToggle={() => setStructure((x) => !x)} sub="Struktur dreht selbst">Higher Low oder BOS auf 1H/4H</CheckRow>
        <CheckRow checked={rsi} onToggle={() => setRsi((x) => !x)} sub="Momentum bestätigt">RSI-Divergenz oder Trendlinienbruch</CheckRow>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {err && <span role="alert" className="mr-auto text-[12.5px] text-loss">{err}</span>}
        <Btn onClick={close}>Abbrechen</Btn><Btn variant="primary" onClick={save}>Ablesung speichern</Btn>
      </div>
    </div>
  );
}

export function HyblockCard({ list, market, settings, onSave, onDelete }: { list: Hyblock[]; market: MarketState; settings: Settings; onSave: (h: Hyblock) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const live = useHyblockLive(settings.hyblock);
  const manual = list[list.length - 1], prevManual = list[list.length - 2];
  // Live-Werte (Long-%, Delta, Kerzen) + deine letzten manuellen Struktur-/RSI-Punkte
  const h: Hyblock | undefined = live.status === 'live' && live.longPct != null
    ? { id: manual?.id || '', at: new Date(live.at!).toISOString(), longPct: live.longPct, delta: live.delta ?? 0, deltaCandles: live.deltaCandles ?? 0, structure: !!manual?.structure, rsi: !!manual?.rsi, note: 'Live von Hyblock' }
    : manual;
  const prev = live.status === 'live' ? manual : prevManual;
  const f = filterState(h, prev, market, settings);
  const age = h ? (Date.now() - +new Date(h.at)) / 36e5 : null;
  const [armed, setArmed] = useState(false);
  return (
    <Card title="Top Trader · Hyblock" note={live.status === 'live' ? 'Live · alle 5 min' : undefined} action={
      <Morph id="hyblock-new" title="Hyblock-Ablesung" body={() => <HyblockForm onSave={onSave} last={h} />}
        className="!w-auto rounded-full border border-line-2 bg-white/[0.04] px-3 py-1 hover:bg-white/[0.08]"><span className="text-[12px] font-semibold text-fg">+ Ablesung</span></Morph>}>
      {!h ? (
        <Empty title="Noch keine Ablesung" text="Trag Top-Trader-Long-% und Whale-Delta aus Hyblock ein. Mit dem Live-Kurs prüft das Journal dann deinen Falling-Knife-Filter."
          action={<a href={HYBLOCK_URL} target="_blank" rel="noreferrer" className="label mt-2 !text-fg hover:underline">Hyblock öffnen ↗</a>} />
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-[auto_1fr] items-end gap-5">
            <div>
              <div className="label">Long %</div>
              <div className="dot-num mt-1 flex items-baseline gap-2 text-[38px] leading-none">
                {fmt.n1(h.longPct)}
                {f.rising != null && <motion.span initial={{ y: f.rising ? 6 : -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className={cn('font-mono text-sm', f.rising ? 'text-win' : 'text-loss')}>{f.rising ? '▲' : '▼'}</motion.span>}
              </div>
            </div>
            <Spark data={list.slice(-20).map((x) => x.longPct)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([['Delta', fmt.signed(h.delta, 1), h.delta > 0 ? 'text-win' : h.delta < 0 ? 'text-loss' : ''], ['Kerzen +', String(h.deltaCandles), ''], ['Stand', age != null && age < 48 ? `vor ${age < 1 ? Math.max(1, Math.round(age * 60)) + ' min' : Math.round(age) + ' h'}` : fmt.date(new Date(h.at)), age != null && age > 12 ? 'text-warn' : '']] as const).map(([l, v, c]) => (
              <div key={l} className="rounded-xl border border-line bg-ink-950/30 px-3 py-2"><div className="label !text-[9.5px]">{l}</div><div className={cn('num mt-0.5 font-mono text-[14px]', c)}>{v}</div></div>
            ))}
          </div>
          <Morph id="falling-knife" title="Falling-Knife-Filter" className="rounded-2xl border border-line-2 bg-ink-950/25 p-3.5 hover:border-white/30"
            body={() => <Detail bare d={{
              title: 'Falling-Knife-Filter',
              what: 'Ein steigender Top-Trader-Long-% allein ist kein Kaufsignal: Top-Trader akkumulieren oft gestaffelt, während der Preis noch fällt. Ein Makro-Long ist nur valide, wenn alle 4 Punkte erfüllt sind.',
              rows: f.pts.map((p) => [p.l, p.ok == null ? '–' : p.ok ? '✓ erfüllt' : '✕ offen', p.ok ? 'text-win' : p.ok === false ? 'text-loss' : undefined] as [string, string, string?]),
              verdict: f.all ? { tone: 'win', text: 'Alle 4 Punkte erfüllt: Makro-Long-Trigger ist valide (T3 prüfen).' } : f.knife ? { tone: 'loss', text: 'Anti-Muster: Long-% steigt, aber Delta ist nicht positiv und die Struktur dreht nicht. Messer fangen: beobachten statt handeln.' } : { tone: 'warn', text: `${f.n} von 4 erfüllt. Kein Kaufsignal, weiter beobachten.` },
            }} />}>
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <span className="label !text-fg">Falling-Knife-Filter</span>
              <span className={cn('dot-num text-[18px]', f.all ? 'text-win' : f.knife ? 'text-loss' : 'text-warn')}>{f.n}/4</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {f.pts.map((p, i) => (
                <motion.span key={p.k} className={cn('h-1.5 rounded-full', p.ok ? 'bg-win' : p.ok === false ? 'bg-loss/60' : 'bg-white/10')}
                  />
              ))}
            </div>
            <p className={cn('mt-2.5 text-[12px]', f.all ? 'text-win' : f.knife ? 'text-loss' : 'text-mute')}>
              {f.all ? 'Makro-Long-Trigger valide.' : f.knife ? 'Anti-Muster: Messer fangen. Beobachten.' : 'Kein Kaufsignal. Tippen für Details.'}
            </p>
          </Morph>
          <div className="flex items-center justify-between gap-2 text-[11.5px] text-faint">
            <span>{live.status === 'live' ? 'Live von Hyblock' : live.message ? live.message : `${list.length} Ablesung${list.length === 1 ? '' : 'en'}`}</span>
            <span className="flex gap-3">
              {armed
                ? <><button type="button" className="text-loss" onClick={() => { setArmed(false); onDelete(h.id); }}>Wirklich löschen</button><button type="button" onClick={() => setArmed(false)}>Nein</button></>
                : <button type="button" className="hover:text-loss" onClick={() => setArmed(true)}>Letzte löschen</button>}
              <a href={HYBLOCK_URL} target="_blank" rel="noreferrer" className="text-fg hover:underline">Hyblock ↗</a>
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Live-Abruf über den eigenen Hyblock-Connector (Netlify) ─────────────
export const HB_SERVER = 'Hyblock';
const HB_EVERY = 300_000;
type HbLive = { status: 'off' | 'connecting' | 'live' | 'error'; message?: string; longPct?: number; delta?: number; deltaCandles?: number; at?: number };

/** Findet die Zeitreihe in einer Hyblock-Antwort (Array direkt oder unter data/result/items). */
export function hbSeries(p: any): any[] {
  if (Array.isArray(p)) return p;
  for (const k of ['data', 'result', 'items', 'values']) if (Array.isArray(p?.[k])) return p[k];
  if (p?.data && typeof p.data === 'object') return hbSeries(p.data);
  return p && typeof p === 'object' ? [p] : [];
}
/** Liest den Wert aus einem Datenpunkt: konfiguriertes Feld, sonst übliche Namen, sonst erste Zahl. */
export function hbValue(row: any, field: string, guesses: string[]): number | null {
  if (!row || typeof row !== 'object') return null;
  if (field && num(row[field]) != null) return num(row[field]);
  for (const g of guesses) for (const k of Object.keys(row)) if (k.toLowerCase() === g.toLowerCase() && num(row[k]) != null) return num(row[k]);
  for (const [k, v] of Object.entries(row)) if (!/time|date|ts|open|close_?time/i.test(k) && typeof v === 'number') return v;
  return null;
}
const LONG_KEYS = ['longPercentage', 'longPct', 'long_percent', 'longAccount', 'longRatio', 'long', 'value'];
const DELTA_KEYS = ['delta', 'whaleRetailDelta', 'value'];

export function useHyblockLive(cfg: Settings['hyblock']): HbLive & { refresh: () => void } {
  const [st, setSt] = useState<HbLive>({ status: 'connecting' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true, mcp: any = null;
    const params = { coin: cfg.coin, exchange: cfg.exchange, timeframe: cfg.timeframe, limit: 50 };
    const load = async () => {
      if (!mcp || document.hidden) return;
      try {
        const call = (endpoint: string) => mcp.callTool(HB_SERVER, 'hyblock_get', { endpoint, params }, { cache: false }).then((r: any) => r?.payload ?? r?.structuredContent);
        const [lp, dp] = await Promise.all([call(cfg.longEndpoint), call(cfg.deltaEndpoint)]);
        const ls = hbSeries(lp), ds = hbSeries(dp);
        const longPct = hbValue(ls[ls.length - 1], cfg.longField, LONG_KEYS);
        const deltas = ds.map((r) => hbValue(r, cfg.deltaField, DELTA_KEYS)).filter((v): v is number => v != null);
        let candles = 0; for (let i = deltas.length - 1; i >= 0 && deltas[i] > 0; i--) candles++;
        if (alive) setSt({ status: 'live', longPct: longPct ?? undefined, delta: deltas[deltas.length - 1], deltaCandles: candles, at: Date.now() });
      } catch (e: any) {
        const code = e?.code;
        const msg = code === 'server_not_connected' ? `Connector „${HB_SERVER}“ ist noch nicht in claude.ai verbunden.`
          : code === 'not_in_manifest' ? 'Hyblock ist für diese Seite nicht freigegeben.'
          : code === 'tool_error' ? `Hyblock meldet einen Fehler: ${e?.message || ''}`.slice(0, 160) : 'Hyblock gerade nicht erreichbar.';
        if (alive) setSt((s) => ({ ...s, status: code === 'server_not_connected' || code === 'not_in_manifest' ? 'off' : 'error', message: msg }));
      }
    };
    const id = setInterval(load, HB_EVERY);
    (async () => { mcp = await useCap('mcp'); if (!alive) return; if (!mcp) { setSt({ status: 'off', message: 'Nur auf claude.ai verfügbar.' }); return; } load(); })();
    return () => { alive = false; clearInterval(id); };
  }, [cfg.longEndpoint, cfg.deltaEndpoint, cfg.longField, cfg.deltaField, cfg.coin, cfg.exchange, cfg.timeframe, nonce]);
  return { ...st, refresh: () => setNonce((n) => n + 1) };
}
