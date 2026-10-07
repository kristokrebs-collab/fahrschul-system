// Auswertungen nach Tradezella-Vorbild, auf ein BTC-Journal zugeschnitten:
// Signal-Stärke (zahlt sich mehr Bestätigung aus?), Fehler-Kosten, Edge-Score (Radar), P&L-Kalender.
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts';
import { MONTHS, cn, fmt, group, tDate, tone, type ETrade, type Stats } from './lib';
import { STRENGTH_LABEL } from './signals';
import { Card, Detail, Empty, Expand, HoverSlide, InfoToggle, Pill, useHoverSlide } from './ui';
import { contextSpring, spring } from './physics';
import { ResultPill } from './overview';

// ── Ergebnis nach Signal-Stärke ─────────────────────────
export function SignalStrengthCard({ st }: { st: Stats }) {
  const [info, setInfo] = useState(false);
  const hs = useHoverSlide();
  const rows = useMemo(() => {
    const by = new Map<number | 'none', ETrade[]>();
    for (const t of st.closed) { const k = t.signal ? t.signal.strength : 'none'; if (!by.has(k)) by.set(k, []); by.get(k)!.push(t); }
    return ([4, 3, 2, 1, 0, 'none'] as const).map((k) => ({ k, g: group(by.get(k) || []) }));
  }, [st.closed]);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.g.net)));
  const withSig = st.closed.filter((t) => t.signal).length;
  return (
    <Card title="Ergebnis nach Signal-Stärke" note={withSig ? `${withSig} Trades mit Check` : undefined}
      action={<InfoToggle open={info} onClick={() => setInfo((o) => !o)} label="Signal-Stärke" />}>
      {!withSig ? (
        <Empty title="Noch keine Trades mit Einstiegs-Check" text="Ab jetzt speichert jeder neue Trade automatisch, wie stark das Signal beim Einstieg war. Hier siehst du dann, ob stärkere Signale wirklich mehr bringen." />
      ) : (
        <div onMouseLeave={() => hs.bind(-1).onMouseLeave()}>
          <div className="label grid grid-cols-[minmax(0,1.3fr)_44px_56px_minmax(80px,1fr)] gap-3 px-2 pb-2 !text-faint"><span>Stärke</span><span className="text-right">n</span><span className="text-right">Win</span><span className="text-right">P&L</span></div>
          {rows.filter((r) => r.g.n).map((r, i) => (
            <div key={String(r.k)} className="relative grid grid-cols-[minmax(0,1.3fr)_44px_56px_minmax(80px,1fr)] items-center gap-3 border-t border-line px-2 py-2.5 text-[13px]" {...hs.bind(i)}>
              <HoverSlide show={hs.hovered === i} group="strength" />
              <span className="relative z-10 flex items-center gap-2">
                <span className="flex gap-0.5">{[1, 2, 3, 4].map((d) => <span key={d} className={cn('size-1.5 rounded-full', r.k !== 'none' && d <= r.k ? 'bg-fg' : 'bg-line-2')} />)}</span>
                <span className="truncate">{r.k === 'none' ? 'Ohne Check' : STRENGTH_LABEL[r.k]}</span>
              </span>
              <span className="num relative z-10 text-right font-mono text-mute">{r.g.n}</span>
              <span className="num relative z-10 text-right font-mono">{fmt.pct0(r.g.winRate)}</span>
              <span className="relative z-10 flex items-center justify-end gap-2">
                <span className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.04] sm:block">
                  <motion.span className={cn('block h-full rounded-full', r.g.net >= 0 ? 'bg-win/70' : 'bg-loss/70')} initial={{ width: 0 }} animate={{ width: `${(Math.abs(r.g.net) / max) * 100}%` }} transition={spring('soft')} />
                </span>
                <span className={cn('num font-mono', tone(r.g.net))}>{fmt.signed(r.g.net, 0)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      <Expand open={info}>
        <Detail d={{
          title: 'Zahlt sich Bestätigung aus?',
          what: 'Jeder Trade speichert beim Eintragen den Einstiegs-Check (MCB-Leiter, RSI, Zone). Hier wird nach der Stärke gruppiert. Steigen Win-Rate und P&L mit der Stärke, lohnt sich Warten auf mehr Bestätigung. Liegen schwache Signale vorne, steigst du vielleicht zu spät ein.',
          verdict: { tone: 'mute', text: 'Aussagekräftig ab etwa 10 Trades pro Stufe.' },
        }} />
      </Expand>
    </Card>
  );
}

// ── Fehler-Kosten ───────────────────────────────────────
export function MistakesCard({ st, cur }: { st: Stats; cur: string }) {
  const [info, setInfo] = useState(false);
  const data = useMemo(() => {
    const clean = st.closed.filter((t) => !(t.mistakes || []).length);
    const cg = group(clean);
    const map = new Map<string, ETrade[]>();
    for (const t of st.closed) for (const m of t.mistakes || []) { if (!map.has(m)) map.set(m, []); map.get(m)!.push(t); }
    const list = [...map.entries()].map(([m, ts]) => {
      const g = group(ts);
      // Mehrkosten: was die Trades gegenüber dem Schnitt sauberer Trades gekostet haben
      const excess = cg.n && cg.exp != null ? g.net - g.n * cg.exp : g.net;
      return { m, g, excess };
    }).sort((a, b) => a.excess - b.excess);
    return { list, clean: cg };
  }, [st.closed]);
  const worst = data.list[0];
  const max = Math.max(1, ...data.list.map((x) => Math.abs(x.excess)));
  return (
    <Card title="Fehler-Kosten" action={<InfoToggle open={info} onClick={() => setInfo((o) => !o)} label="Fehler-Kosten" />}>
      {!data.list.length ? (
        <Empty title="Keine Fehler markiert" text="Markiere im Trade unter „Fehler“, was schiefging. Hier siehst du dann, welcher Fehler dich am meisten kostet." />
      ) : (
        <div className="grid gap-3">
          {worst && worst.excess < 0 && (
            <div className="rounded-xl border border-loss/30 bg-loss/[0.07] px-3.5 py-2.5 text-[12.5px] text-[#ff8a90]">
              Größtes Leck: <strong className="font-semibold">{worst.m}</strong> · {fmt.signed(worst.excess, 0)} {cur} gegenüber sauberen Trades
            </div>
          )}
          <ul className="grid gap-2">
            {data.list.map((x) => (
              <li key={x.m} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[13px]">
                <span className="truncate">{x.m} <span className="text-faint">· {x.g.n}×</span></span>
                <span className={cn('num font-mono', tone(x.excess))}>{fmt.signed(x.excess, 0)}</span>
                <span className="col-span-2 h-1 overflow-hidden rounded-full bg-white/[0.04]">
                  <motion.span className={cn('block h-full rounded-full', x.excess < 0 ? 'bg-loss/70' : 'bg-win/60')} initial={{ width: 0 }} animate={{ width: `${(Math.abs(x.excess) / max) * 100}%` }} transition={spring('soft')} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Expand open={info}>
        <Detail d={{
          title: 'So wird gerechnet',
          what: 'Mehrkosten = P&L der Trades mit diesem Fehler minus (Anzahl × Ø P&L deiner sauberen Trades ohne Fehler). So siehst du, was der Fehler dich wirklich kostet, nicht nur den Verlust des Trades.',
          rows: [['Saubere Trades', `${data.clean.n}`], ['Ø P&L sauber', `${fmt.signed(data.clean.exp, 0)} ${cur}`]],
        }} />
      </Expand>
    </Card>
  );
}

// ── Edge-Score (Zella-Score-Logik, 6 Achsen) ────────────
const lerp = (x: number, lo: number, hi: number, a: number, b: number) => a + ((b - a) * (x - lo)) / (hi - lo);
function bandPF(x: number | null) {
  if (x == null) return 0;
  if (x >= 2.6) return 100;
  for (const [lo, hi, a, b] of [[2.4, 2.6, 90, 99], [2.2, 2.4, 80, 89], [2.0, 2.2, 70, 79], [1.9, 2.0, 60, 69], [1.8, 1.9, 50, 59]]) if (x >= lo && x < hi) return lerp(x, lo, hi, a, b);
  return x >= 1 ? lerp(Math.min(x, 1.8), 1, 1.8, 20, 50) : 20 * Math.max(0, x);
}
function bandRF(x: number | null) {
  if (x == null) return 0;
  if (x >= 3.5) return 100;
  for (const [lo, hi, a, b] of [[3.0, 3.5, 70, 89], [2.5, 3.0, 60, 69], [2.0, 2.5, 50, 59], [1.5, 2.0, 30, 49], [1.0, 1.5, 1, 29]]) if (x >= lo && x < hi) return lerp(x, lo, hi, a, b);
  return 0;
}
export function edgeScore(st: Stats) {
  const g = st.g;
  const days = new Map<string, number>();
  for (const t of st.closed) { const k = tDate(t).toDateString(); days.set(k, (days.get(k) || 0) + (t.pnl || 0)); }
  const d = [...days.values()];
  const sum = d.reduce((a, b) => a + b, 0), mean = d.length ? sum / d.length : 0;
  const sd = d.length > 1 ? Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / (d.length - 1)) : 0;
  const maxDDAbs = Math.abs(st.dd.peak - st.dd.trough);
  const axes = [
    { k: 'Profit-Faktor', v: bandPF(g.pf === Infinity ? 3 : g.pf), w: 0.25, raw: g.pf === Infinity ? '∞' : fmt.n2(g.pf) },
    { k: 'Gewinn/Verlust', v: bandPF(g.payoff), w: 0.2, raw: fmt.n2(g.payoff) },
    { k: 'Drawdown', v: Math.max(0, Math.min(100, 100 + st.maxDD * 100 * 5)), w: 0.2, raw: fmt.pct(st.maxDD) },
    { k: 'Win-Rate', v: Math.min(100, ((g.winRate || 0) / 0.6) * 100), w: 0.15, raw: fmt.pct0(g.winRate) },
    { k: 'Erholung', v: g.net <= 0 ? 0 : maxDDAbs ? bandRF(g.net / maxDDAbs) : 100, w: 0.1, raw: maxDDAbs ? fmt.n2(g.net / maxDDAbs) : '–' },
    { k: 'Konstanz', v: mean < 0 || !sum ? 0 : Math.max(0, Math.min(100, 100 - (sd / Math.abs(sum)) * 100)), w: 0.1, raw: d.length ? `${d.length} Tage` : '–' },
  ];
  const score = axes.reduce((a, x) => a + x.v * x.w, 0);
  return { axes, score: g.n ? Math.round(score) : null };
}

export function EdgeScoreCard({ st }: { st: Stats }) {
  const [info, setInfo] = useState(false);
  const e = useMemo(() => edgeScore(st), [st]);
  const data = e.axes.map((a) => ({ k: a.k, v: Math.round(a.v) }));
  return (
    <Card title="Edge-Score" note={st.g.n && st.g.n < 20 ? `aussagekräftig ab 20 Trades (${st.g.n})` : undefined}
      action={<InfoToggle open={info} onClick={() => setInfo((o) => !o)} label="Edge-Score" />}>
      {!st.g.n ? <Empty title="Noch keine Trades" text="Der Score bewertet sechs Kennzahlen deiner abgeschlossenen Trades von 0 bis 100." /> : (
        <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto]">
          <div className="h-[210px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={data} outerRadius="72%">
                <PolarGrid stroke="#2c2c2c" />
                <PolarAngleAxis dataKey="k" tick={{ fill: '#9b9b9b', fontSize: 10.5 }} />
                <Radar dataKey="v" stroke="#f2f2f2" strokeWidth={1.5} fill="#f2f2f2" fillOpacity={0.12} isAnimationActive animationDuration={900} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-center sm:pr-2">
            <div className="dot-num text-[54px] leading-none text-fg">{e.score}</div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-faint">von 100</div>
          </div>
        </div>
      )}
      <Expand open={info}>
        <Detail d={{
          title: 'Sechs Kennzahlen, gewichtet',
          what: 'Nach dem Prinzip des Zella-Scores: jede Kennzahl wird auf 0–100 abgebildet und gewichtet. Profit-Faktor 25 %, Ø Gewinn/Ø Verlust 20 %, Drawdown 20 %, Win-Rate 15 % (60 % = volle Punkte), Erholung (Netto ÷ max. Drawdown) 10 %, Konstanz der Tages-P&L 10 %.',
          rows: e.axes.map((a) => [a.k, `${a.raw} → ${Math.round(a.v)}`] as [string, string]),
        }} />
      </Expand>
    </Card>
  );
}

// ── P&L-Kalender mit Tagesansicht ───────────────────────
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function CalendarCard({ st, cur, onEdit }: { st: Stats; cur: string; onEdit: (t: ETrade) => void }) {
  const last = st.closed.length ? tDate(st.closed[st.closed.length - 1]) : new Date();
  const [month, setMonth] = useState(() => new Date(last.getFullYear(), last.getMonth(), 1));
  const [sel, setSel] = useState<string | null>(null);
  const [dir, setDir] = useState(0);
  const byDay = useMemo(() => {
    const m = new Map<string, ETrade[]>();
    for (const t of st.closed) { const k = dayKey(tDate(t)); if (!m.has(k)) m.set(k, []); m.get(k)!.push(t); }
    return m;
  }, [st.closed]);
  const y = month.getFullYear(), mo = month.getMonth();
  const first = (new Date(y, mo, 1).getDay() + 6) % 7;
  const nDays = new Date(y, mo + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array(first).fill(null), ...Array.from({ length: nDays }, (_, i) => new Date(y, mo, i + 1))];
  while (cells.length % 7) cells.push(null);
  const vals = cells.map((d) => (d ? group(byDay.get(dayKey(d)) || []) : null));
  const p90 = (() => { const a = vals.filter((v) => v && v.n).map((v) => Math.abs(v!.net)).sort((a, b) => a - b); return a.length ? a[Math.floor(a.length * 0.9)] || a[a.length - 1] : 1; })();
  const monthG = group(cells.flatMap((d) => (d ? byDay.get(dayKey(d)) || [] : [])));
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => {
    const ts = cells.slice(w * 7, w * 7 + 7).flatMap((d) => (d ? byDay.get(dayKey(d)) || [] : []));
    return { g: group(ts), days: new Set(ts.map((t) => dayKey(tDate(t)))).size };
  });
  const go = (k: number) => { setDir(k); setSel(null); setMonth(new Date(y, mo + k, 1)); };
  const selTrades = sel ? byDay.get(sel) || [] : [];
  const selG = group(selTrades);

  return (
    <Card title="P&L-Kalender"
      action={<div className="flex items-center gap-2">
        <span className={cn('num font-mono text-[12.5px]', tone(monthG.net))}>{monthG.n ? `${fmt.signed(monthG.net, 0)} ${cur}` : ''}</span>
        <button type="button" onClick={() => go(-1)} aria-label="Vorheriger Monat" className="grid size-7 place-items-center rounded-lg border border-line-2 text-mute hover:text-fg">‹</button>
        <span className="min-w-[78px] text-center text-[12.5px] font-semibold">{MONTHS[mo]} {y}</span>
        <button type="button" onClick={() => go(1)} aria-label="Nächster Monat" className="grid size-7 place-items-center rounded-lg border border-line-2 text-mute hover:text-fg">›</button>
      </div>}>
      <div className="overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div key={`${y}-${mo}`} custom={dir}
            variants={{ a: (d: number) => ({ opacity: 0, x: d * 40 }), b: { opacity: 1, x: 0 }, c: (d: number) => ({ opacity: 0, x: d * -30 }) }}
            initial="a" animate="b" exit="c" transition={{ ...spring('snappy'), opacity: { duration: 0.18 } }}
            className="grid grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.15fr)] gap-1">
            {WD.map((w) => <div key={w} className="pb-1 text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{w}</div>)}
            <div className="pb-1 text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Woche</div>
            {cells.map((d, i) => {
              const v = vals[i];
              const k = d ? dayKey(d) : '';
              const has = !!v?.n;
              const a = has ? Math.min(1, Math.abs(v!.net) / (p90 || 1)) : 0;
              const bg = !has ? undefined : v!.net > 0 ? `rgb(61 220 132 / ${0.08 + a * 0.3})` : v!.net < 0 ? `rgb(255 77 79 / ${0.08 + a * 0.3})` : 'rgb(255 255 255 / 0.06)';
              const end = i % 7 === 6;
              return [
                <motion.button key={i} type="button" disabled={!has} onClick={() => setSel(sel === k ? null : k)}
                  whileHover={has ? { scale: 1.06, transition: contextSpring() } : undefined} whileTap={has ? { scale: 0.95, transition: spring('interactive') } : undefined}
                  className={cn('relative flex aspect-square min-h-0 flex-col justify-between rounded-lg border p-1 text-left sm:p-1.5', !d ? 'border-transparent' : sel === k ? 'border-white/60' : 'border-line', has ? 'cursor-pointer' : 'cursor-default')}
                  style={{ background: bg }}>
                  {d && <span className="text-[10px] leading-none text-faint">{d.getDate()}</span>}
                  {has && <span className={cn('num truncate font-mono text-[10px] leading-none sm:text-[11px]', tone(v!.net))}>{fmt.signed(v!.net, 0)}</span>}
                </motion.button>,
                end && (
                  <div key={'w' + i} className="flex flex-col justify-center rounded-lg border border-line bg-ink-950/40 px-1.5 text-right">
                    {weeks[Math.floor(i / 7)].g.n ? <>
                      <span className={cn('num truncate font-mono text-[10.5px]', tone(weeks[Math.floor(i / 7)].g.net))}>{fmt.signed(weeks[Math.floor(i / 7)].g.net, 0)}</span>
                      <span className="text-[9.5px] text-faint">{weeks[Math.floor(i / 7)].days} T</span>
                    </> : <span className="text-[10px] text-faint">–</span>}
                  </div>
                ),
              ];
            })}
          </motion.div>
        </AnimatePresence>
      </div>
      <AnimatePresence initial={false}>
        {sel && selTrades.length > 0 && (
          <motion.div key={sel} className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring('smooth')}>
            <div className="mt-4 rounded-2xl border border-line-2 bg-ink-950/50 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-[13px]">{new Date(sel + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}</strong>
                <span className="flex gap-1.5">
                  <Pill tone={selG.net >= 0 ? 'win' : 'loss'}>{fmt.signed(selG.net, 0)} {cur}</Pill>
                  <Pill>{selG.n} Trades · {fmt.pct0(selG.winRate)}</Pill>
                </span>
              </div>
              <ul className="mt-2.5 grid gap-1">
                {selTrades.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => onEdit(t)} className="grid w-full grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-white/[0.04]">
                      <ResultPill t={t} />
                      <span className="truncate text-mute">{fmt.time(tDate(t))} · {t.side === 'long' ? 'Long' : 'Short'}{t.signal ? ` · Score ${t.signal.score}` : ''}</span>
                      <span className={cn('num font-mono', tone(t.pnl))}>{fmt.signed(t.pnl, 0)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
