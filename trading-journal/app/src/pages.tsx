import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { useIsland } from './island';
import { HB_SERVER, hbSeries } from './hyblock';
import {
  ACCOUNT_LABEL, cn, fmt, group, num, tDate, tone, toInput,
  useCap, type AccountFilter, type ETrade, type Settings, type Setup, type Stats,
} from './lib';
import { BlurFade, Btn, Card, Empty, Field, Icon, MagicCard, Pill, Segmented, Tilt, inputCls } from './ui';
import { ResultPill, SORT_OPTS, SetupChips, sortSetups } from './overview';
import { SIGNAL_TFS } from './signals';

export type Filters = { q: string; setup: string; result: 'all' | 'win' | 'loss' | 'open'; side: 'all' | 'long' | 'short'; acc: AccountFilter };
export const NO_FILTER: Filters = { q: '', setup: 'all', result: 'all', side: 'all', acc: 'all' };

function PageHead({ title, lead, action }: { title: string; lead: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight [text-wrap:balance]"><span className="mr-2 inline-block size-2 -translate-y-1 rounded-full bg-signal align-middle" aria-hidden="true" />{title}</h1>
        <p className="mt-1 max-w-[62ch] text-[13.5px] text-mute">{lead}</p>
      </div>
      {action}
    </div>
  );
}

// ── Trades ─────────────────────────────────────────────
export function TradesView({ all, settings, f, setF, onEdit, onNew }: { all: ETrade[]; settings: Settings; f: Filters; setF: (f: Filters) => void; onEdit: (t: ETrade) => void; onNew: () => void }) {
  const [sort, setSort] = useState<{ k: 'date' | 'pnl' | 'r' | 'setup'; dir: 1 | -1 }>({ k: 'date', dir: -1 });
  const [q, setQ] = useState(f.q);
  useEffect(() => { const id = setTimeout(() => setF({ ...f, q }), 150); return () => clearTimeout(id); }, [q]);
  const known = new Set(settings.setups.map((s) => s.id));
  const name = (t: ETrade) => settings.setups.find((s) => (t.setups || []).includes(s.id))?.name || '~';
  const list = useMemo(() => {
    const ql = f.q.trim().toLowerCase();
    const out = all.filter((t) => {
      if (f.acc !== 'all' && (t.account || 'scalp') !== f.acc) return false;
      if (f.setup === '__none' ? (t.setups || []).some((id) => known.has(id)) : f.setup !== 'all' && !(t.setups || []).includes(f.setup)) return false;
      if (f.result !== 'all' && t.result !== f.result) return false;
      if (f.side !== 'all' && (t.side === 'short' ? 'short' : 'long') !== f.side) return false;
      if (ql && ![t.pair, t.reason, t.notes, t.emotion, t.timeframe].join(' ').toLowerCase().includes(ql)) return false;
      return true;
    });
    const val: Record<string, (t: ETrade) => number | string> = { date: (t) => +tDate(t), pnl: (t) => t.pnl ?? -Infinity, r: (t) => t.r ?? -Infinity, setup: name };
    return out.sort((a, b) => { const x = val[sort.k](a), y = val[sort.k](b); return (typeof x === 'string' ? x.localeCompare(y as string, 'de') : (x as number) - (y as number)) * sort.dir; });
  }, [all, f, sort, settings]);
  const g = group(list.filter((t) => t.result !== 'open'));
  const th = (k: typeof sort.k, l: string, right = false) => (
    <th className={cn('px-3 pb-3 font-semibold', right && 'text-right')}>
      <button type="button" onClick={() => setSort((s) => (s.k === k ? { k, dir: (s.dir * -1) as 1 | -1 } : { k, dir: k === 'setup' ? 1 : -1 }))}
        className={cn('inline-flex items-center gap-1 uppercase tracking-[0.1em] transition-colors hover:text-fg', sort.k === k && 'text-signal')}>
        {l}{sort.k === k && (sort.dir === 1 ? ' ↑' : ' ↓')}
      </button>
    </th>
  );
  return (
    <div className="grid gap-5">
      <PageHead title="Alle Trades" lead="Filtere nach Konto, Entscheidungsgrundlage, Ergebnis oder Richtung. Ein Klick auf eine Zeile öffnet den Trade." />
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <label className="relative min-w-[200px] flex-1 sm:max-w-[280px]">
            <span className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint [&>svg]:size-full">{Icon.search}</span>
            <input className={cn(inputCls, 'pl-9')} type="search" placeholder="Notizen, Begründung …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Trades durchsuchen" />
          </label>
          <select className={cn(inputCls, 'w-auto min-w-[190px]')} value={f.setup} onChange={(e) => setF({ ...f, setup: e.target.value })} aria-label="Entscheidungsgrundlage">
            <option value="all">Alle Grundlagen</option>
            {settings.setups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="__none">Ohne Grundlage</option>
          </select>
          <Segmented size="sm" value={f.acc} onChange={(v) => setF({ ...f, acc: v })} options={(['all', 'makro', 'scalp'] as const).map((v) => ({ v, label: ACCOUNT_LABEL[v] }))} />
          <Segmented size="sm" value={f.result} onChange={(v) => setF({ ...f, result: v })} options={[{ v: 'all', label: 'Alle' }, { v: 'win', label: 'Gewinner' }, { v: 'loss', label: 'Verlierer' }, { v: 'open', label: 'Offen' }]} />
          <Segmented size="sm" value={f.side} onChange={(v) => setF({ ...f, side: v })} options={[{ v: 'all', label: 'Beide' }, { v: 'long', label: 'Long' }, { v: 'short', label: 'Short' }]} />
          <span className="ml-auto rounded-full border border-line px-3 py-1 text-xs text-mute">
            {list.length} Trade{list.length === 1 ? '' : 's'}{g.n ? <> · <span className={tone(g.net)}>{fmt.signed(g.net, 0)}</span> · {fmt.pct0(g.winRate)}</> : null}
          </span>
        </div>
        {!all.length ? <Empty title="Noch keine Trades" text="Klick auf „Trade eintragen“, um loszulegen." action={<Btn variant="primary" size="sm" className="mt-2" onClick={onNew}>Trade eintragen</Btn>} />
          : !list.length ? <Empty title="Keine Treffer" text="Kein Trade passt zu diesen Filtern." action={<Btn size="sm" className="mt-2" onClick={() => { setQ(''); setF(NO_FILTER); }}>Filter zurücksetzen</Btn>} />
          : (
            <div className="-mx-2 overflow-x-auto px-2">
              <table className="w-full min-w-[900px] border-collapse text-[13px]">
                <thead className="text-left text-[10.5px] text-faint">
                  <tr>{th('date', 'Datum')}<th className="px-3 pb-3 font-semibold uppercase tracking-[0.1em]">Richtung</th>{th('setup', 'Grundlage')}<th className="px-3 pb-3 font-semibold uppercase tracking-[0.1em]">Einstieg → Ausstieg</th><th className="px-3 pb-3 text-right font-semibold uppercase tracking-[0.1em]">Check</th>{th('pnl', 'P&L', true)}{th('r', 'R', true)}<th className="px-3 pb-3 font-semibold uppercase tracking-[0.1em]">Ergebnis</th></tr>
                </thead>
                <tbody>
                  {list.map((t, i) => (
                    <motion.tr key={t.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 12) * 0.02 }}
                      tabIndex={0} onClick={() => onEdit(t)} onKeyDown={(e) => { if (e.key === 'Enter') onEdit(t); }}
                      className="cursor-pointer border-t border-line transition-colors hover:bg-white/[0.03]">
                      <td className="px-3 py-3"><div className="num font-mono text-[12.5px]">{fmt.date(tDate(t))}</div><div className="text-[11.5px] text-faint">{fmt.time(tDate(t))}{t.timeframe ? ' · ' + t.timeframe : ''}</div></td>
                      <td className="px-3 py-3"><div className={cn('text-xs font-semibold uppercase tracking-wide', t.side === 'short' ? 'text-loss' : 'text-win')}>{t.side === 'short' ? '▼ Short' : '▲ Long'}</div><div className="text-[11.5px] text-faint">{t.account === 'makro' ? 'Makro' : 'Scalp'}{t.leverage ? ` · ${fmt.n1(t.leverage).replace(',0', '')}x` : ''}</div></td>
                      <td className="max-w-[260px] px-3 py-3"><SetupChips ids={t.setups} settings={settings} /></td>
                      <td className="num px-3 py-3 font-mono text-[12.5px]">{fmt.price(t.entry)} → {t.result === 'open' ? <span className="text-faint">offen</span> : fmt.price(t.exit)}</td>
                      <td className="num px-3 py-3 text-right font-mono text-xs"><span className={t.complete ? 'text-win' : 'text-mute'}>{t.checked}/{t.items.length}</span></td>
                      <td className={cn('num px-3 py-3 text-right font-mono font-medium', tone(t.pnl))}>{t.pnl == null ? '–' : fmt.signed(t.pnl)}</td>
                      <td className={cn('num px-3 py-3 text-right font-mono', tone(t.r))}>{t.r == null ? '–' : fmt.signed(t.r)}</td>
                      <td className="px-3 py-3"><ResultPill t={t} /></td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
    </div>
  );
}

// ── Entscheidungsgrundlagen ────────────────────────────
export function SetupsView({ st, settings, onEdit, onNew, onTrades }: { st: Stats; settings: Settings; onEdit: (s: Setup) => void; onNew: () => void; onTrades: (id: string) => void }) {
  const [key, setKey] = useState<'winRate' | 'net' | 'n' | 'avgR'>('winRate');
  const [acc, setAcc] = useState<'all' | 'makro' | 'scalp'>('all');
  const list = sortSetups(st.setups.map((s) => ({ ...s, id: s.setup.id })), key).filter((s) => acc === 'all' || s.setup.account === acc || s.setup.account === 'both');
  return (
    <div className="grid gap-5">
      <PageHead title="Entscheidungsgrundlagen" lead="Deine Setups aus der MegaWhale-Methodik und deinen eigenen Regeln. Jede Karte zeigt, wie oft die Grundlage funktioniert hat."
        action={<div className="flex flex-wrap gap-2"><Segmented size="sm" value={acc} onChange={setAcc} options={(['all', 'makro', 'scalp'] as const).map((v) => ({ v, label: ACCOUNT_LABEL[v] }))} /><Segmented size="sm" value={key} onChange={setKey} options={SORT_OPTS} /></div>} />
      <motion.div layout className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))]">
        {list.map((s, i) => (
          <motion.div layout layoutId={`setup-card-${s.id}`} style={{ borderRadius: 16 }} key={s.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, type: 'spring', stiffness: 300, damping: 30 }}>
            <Tilt className="h-full" factor={4}><MagicCard className="h-full" gradientFrom={s.setup.color}>
              <article className="flex h-full flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="flex items-center gap-2.5 text-[15px] font-semibold leading-snug"><span className="size-2.5 shrink-0 rounded-full" style={{ background: s.setup.color }} />{s.setup.name}</h3>
                  <Pill tone={s.setup.account === 'makro' ? 'steel' : s.setup.account === 'scalp' ? 'teal' : 'mute'}>{s.setup.account === 'both' ? 'Beide' : ACCOUNT_LABEL[s.setup.account]}</Pill>
                </div>
                <p className="text-[12.5px] leading-relaxed text-mute">{s.setup.desc || 'Noch keine Regeln hinterlegt.'}</p>
                {s.setup.checklist.length > 0 && (
                  <ul className="grid gap-1.5">
                    {s.setup.checklist.map((c) => <li key={c.id} className="flex gap-2 text-[12px] text-fg/80"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-aqua/70" />{c.text}</li>)}
                  </ul>
                )}
                <div className="mt-auto grid grid-cols-4 gap-2">
                  {([['Trades', String(s.n), ''], ['Win-Rate', fmt.pct0(s.winRate), ''], ['P&L', s.n ? fmt.signed(s.net, 0) : '–', tone(s.net)], ['Ø R', s.avgR == null ? '–' : fmt.signed(s.avgR), tone(s.avgR)]] as const).map(([l, v, c]) => (
                    <div key={l} className="rounded-xl border border-line bg-ink-950/50 px-2.5 py-2">
                      <div className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">{l}</div>
                      <div className={cn('num mt-0.5 truncate font-mono text-[13.5px] font-medium', c)}>{v}</div>
                    </div>
                  ))}
                </div>
                {s.n > 0 && <div className="h-1.5 overflow-hidden rounded-full bg-loss/25"><motion.div className="h-full rounded-full bg-win" initial={{ width: 0 }} animate={{ width: `${(s.winRate || 0) * 100}%` }} transition={{ duration: 0.8 }} /></div>}
                <div className="flex gap-2">
                  <Btn size="sm" onClick={() => onEdit(s.setup)}>Bearbeiten</Btn>
                  <Btn size="sm" disabled={!s.n} onClick={() => onTrades(s.id)}>Trades ansehen</Btn>
                </div>
              </article>
            </MagicCard></Tilt>
          </motion.div>
        ))}
        <motion.button layout type="button" onClick={onNew}
          className="grid min-h-[220px] place-items-center rounded-2xl border border-dashed border-line-2 text-mute transition-colors hover:border-white/40 hover:bg-white/[0.03] hover:text-fg">
          <span className="grid justify-items-center gap-2 text-[13.5px] font-semibold"><span className="grid size-10 place-items-center rounded-full border border-line-2 [&>svg]:size-4">{Icon.plus}</span>Neue Entscheidungsgrundlage</span>
        </motion.button>
      </motion.div>
    </div>
  );
}

// ── Einstellungen ──────────────────────────────────────
export function SettingsView({ settings, trades, onSave, downloads, onImport }: { settings: Settings; trades: ETrade[]; onSave: (s: Settings) => Promise<void>; downloads: any; onImport: (list: any[]) => Promise<number> }) {
  const notify = useIsland();
  const [v, setV] = useState<Record<string, string>>({});
  useEffect(() => {
    const m = settings.market, b = settings.backtest;
    setV({
      makro: toInput(settings.capital.makro), scalp: toInput(settings.capital.scalp), currency: settings.currency, pair: settings.pair, startDate: settings.startDate,
      symbol: m.symbol, longTrigger: toInput(m.longTrigger), longStop: toInput(m.longStop), shortTrigger: toInput(m.shortTrigger), lowerHigh: toInput(m.lowerHigh),
      rsiWeekly: toInput(m.rsiWeekly), invalidation: toInput(m.invalidation), zoneLow: toInput(m.zoneLow), zoneHigh: toInput(m.zoneHigh),
      hbLong: settings.hyblock.longEndpoint, hbLongField: settings.hyblock.longField, hbDelta: settings.hyblock.deltaEndpoint, hbDeltaField: settings.hyblock.deltaField,
      hbCoin: settings.hyblock.coin, hbExchange: settings.hyblock.exchange, hbTf: settings.hyblock.timeframe,
      ...Object.fromEntries(settings.signals.ladder.map((tf, i) => ['sgL' + i, tf])),
      sgReq: String(settings.signals.required), sgRsiOs: toInput(settings.signals.rsiOs), sgRsiOb: toInput(settings.signals.rsiOb), sgRsiNear: toInput(settings.signals.rsiNear),
      sgWtOs: toInput(settings.signals.wtOs), sgWtOb: toInput(settings.signals.wtOb), sgLook: toInput(settings.signals.signalLookback),
      sgCh: toInput(settings.signals.wtChannel), sgAvg: toInput(settings.signals.wtAverage), sgSig: toInput(settings.signals.wtSignal),
      sgZoneTf: settings.signals.zoneTf, sgSwing: toInput(settings.signals.swingLookback), mistakes: settings.mistakes.join('\n'),
      winRate: toInput(+(b.winRate * 100).toFixed(2)), avgWin: toInput(+(b.avgWin * 100).toFixed(2)), avgLoss: toInput(+(b.avgLoss * 100).toFixed(2)), expectancy: toInput(+(b.expectancy * 100).toFixed(2)), label: b.label,
    });
  }, [settings]);
  const set = (k: string) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const inp = (k: string, l: string, help?: string, mono = true) => (
    <Field label={l} htmlFor={'s-' + k} help={help}><input id={'s-' + k} className={cn(inputCls, mono && 'font-mono')} inputMode={mono ? 'decimal' : undefined} value={v[k] ?? ''} onChange={set(k)} autoComplete="off" /></Field>
  );
  async function save() {
    const n = (k: string) => num(v[k]);
    const req = ['makro', 'scalp', 'longTrigger', 'longStop', 'shortTrigger', 'lowerHigh', 'rsiWeekly', 'invalidation', 'zoneLow', 'zoneHigh', 'winRate', 'avgWin', 'avgLoss', 'expectancy'];
    const bad = req.find((k) => n(k) == null);
    if (bad) return notify({ kind: 'error', title: 'Bitte alle Zahlenfelder ausfüllen' });
    const next: Settings = {
      ...settings, currency: v.currency || 'USDT', pair: (v.pair || '').trim() || 'BTC/USDT', startDate: v.startDate || '',
      capital: { makro: n('makro')!, scalp: n('scalp')! },
      market: { symbol: (v.symbol || '').trim() || 'BITSTAMP:BTCUSD', longTrigger: n('longTrigger')!, longStop: n('longStop')!, shortTrigger: n('shortTrigger')!, lowerHigh: n('lowerHigh')!, rsiWeekly: n('rsiWeekly')!, invalidation: n('invalidation')!, zoneLow: n('zoneLow')!, zoneHigh: n('zoneHigh')! },
      hyblock: { longEndpoint: (v.hbLong || '').trim(), longField: (v.hbLongField || '').trim(), deltaEndpoint: (v.hbDelta || '').trim(), deltaField: (v.hbDeltaField || '').trim(), coin: (v.hbCoin || 'BTC').trim(), exchange: (v.hbExchange || '').trim(), timeframe: (v.hbTf || '1h').trim() },
      signals: {
        ...settings.signals,
        ladder: [0, 1, 2, 3].map((i) => v['sgL' + i]).filter((tf, i, a) => tf && SIGNAL_TFS.includes(tf) && a.indexOf(tf) === i) as string[],
        required: Math.max(1, Math.min(3, Math.round(n('sgReq') ?? 2))),
        rsiOs: n('sgRsiOs') ?? 30, rsiOb: n('sgRsiOb') ?? 70, rsiNear: n('sgRsiNear') ?? 10,
        wtOs: n('sgWtOs') ?? -53, wtOb: n('sgWtOb') ?? 53, signalLookback: Math.max(1, Math.round(n('sgLook') ?? 3)),
        wtChannel: Math.max(2, Math.round(n('sgCh') ?? 10)), wtAverage: Math.max(2, Math.round(n('sgAvg') ?? 21)), wtSignal: Math.max(1, Math.round(n('sgSig') ?? 4)),
        zoneTf: SIGNAL_TFS.includes(v.sgZoneTf) ? v.sgZoneTf : '1h', swingLookback: Math.max(20, Math.round(n('sgSwing') ?? 120)),
      },
      mistakes: (v.mistakes || '').split('\n').map((x) => x.trim()).filter(Boolean),
      backtest: { winRate: n('winRate')! / 100, avgWin: n('avgWin')! / 100, avgLoss: n('avgLoss')! / 100, expectancy: n('expectancy')! / 100, label: (v.label || '').trim() || 'Backtest' },
    };
    try { await onSave(next); notify({ kind: 'success', title: 'Einstellungen gespeichert' }); } catch { notify({ kind: 'error', title: 'Speichern fehlgeschlagen' }); }
  }
  async function exportFile(kind: 'csv' | 'json') {
    if (!downloads) return;
    const day = new Date().toISOString().slice(0, 10);
    let data: string;
    if (kind === 'json') data = JSON.stringify({ exportedAt: new Date().toISOString(), settings, trades: trades.map(({ items, checked, complete, move, risk, rr, result, ...t }) => t) }, null, 2);
    else {
      const names = new Map(settings.setups.map((s) => [s.id, s.name]));
      const q = (x: any) => { const s = x == null ? '' : typeof x === 'number' ? String(x).replace('.', ',') : String(x); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const head = ['Datum', 'Konto', 'Paar', 'Richtung', 'Status', 'Einstieg', 'Stop', 'Ziel', 'Ausstieg', 'Größe', 'Hebel', 'Gebühren', 'P&L', 'R', 'Kursbewegung %', 'Ergebnis', 'Grundlagen', 'Checkliste', 'Überzeugung', 'Plan befolgt', 'Gefühl', 'Timeframe', 'Begründung', 'Notizen', 'Chart'];
      const rows = [...trades].sort((a, b) => +tDate(a) - +tDate(b)).map((t) => [t.date, t.account === 'makro' ? 'Makro' : 'Scalp', t.pair, t.side, t.status, t.entry, t.stop, t.target, t.exit, t.size, t.leverage, t.fees, t.pnl != null ? +t.pnl.toFixed(2) : '', t.r != null ? +t.r.toFixed(2) : '', t.move != null ? +(t.move * 100).toFixed(2) : '', { win: 'Gewinn', loss: 'Verlust', be: 'Break-even', open: 'Offen' }[t.result], (t.setups || []).map((id) => names.get(id)).filter(Boolean).join(' | '), `${t.checked}/${t.items.length}`, t.conviction, t.followedPlan == null ? '' : t.followedPlan ? 'Ja' : 'Nein', t.emotion, t.timeframe, t.reason, t.notes, t.chart].map(q).join(';'));
      data = '﻿' + [head.join(';'), ...rows].join('\n');
    }
    try { await downloads.save({ filename: `trade-journal-${day}.${kind}`, data }); } catch (e: any) { if (e?.code !== 'declined') notify({ kind: 'error', title: 'Export fehlgeschlagen' }); }
  }
  return (
    <div className="grid gap-5">
      <PageHead title="Einstellungen" lead="Startkapital, Trigger-Level für den Live-Status und die Backtest-Werte, mit denen deine Trades verglichen werden."
        action={<Btn variant="primary" onClick={save}>Speichern</Btn>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <BlurFade><Card title="Konten">
          <div className="grid grid-cols-2 gap-3.5">
            {inp('makro', `Startkapital Makro`, 'Reagiert nur auf Wochenschlüsse')}
            {inp('scalp', `Startkapital Scalp`, 'Tägliches Trading, eigene Regeln')}
            <Field label="Währung" htmlFor="s-currency"><select id="s-currency" className={inputCls} value={v.currency || 'USDT'} onChange={set('currency')}><option>USDT</option><option>USD</option><option>EUR</option></select></Field>
            {inp('pair', 'Standard-Paar', undefined, false)}
            <Field label="Journal-Start" htmlFor="s-start" help="Leer = Datum des ersten Trades"><input id="s-start" type="date" className={inputCls} value={v.startDate || ''} onChange={set('startDate')} /></Field>
          </div>
        </Card></BlurFade>
        <BlurFade delay={0.05}><Card title="Backtest-Referenz">
          <div className="grid grid-cols-2 gap-3.5">
            {inp('winRate', 'Win-Rate %')}{inp('expectancy', 'Erwartung pro Trade %')}
            {inp('avgWin', 'Ø Gewinner %')}{inp('avgLoss', 'Ø Verlierer %', 'negativ eintragen, z. B. −9,31')}
            {inp('label', 'Bezeichnung', undefined, false)}
          </div>
        </Card></BlurFade>
        <BlurFade delay={0.1}><Card title="Live-Status · Trigger-Level">
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
            {inp('symbol', 'TradingView-Symbol', undefined, false)}
            {inp('longTrigger', 'Long-Trigger (4H über)')}{inp('longStop', 'Long-Invalidierung')}
            {inp('shortTrigger', 'Short-Trigger (4H unter)')}{inp('invalidation', 'Harte Invalidierung')}
            {inp('lowerHigh', 'Lower High (Weekly)')}{inp('rsiWeekly', 'Weekly-RSI-Schwelle')}
            {inp('zoneLow', 'Makro-Zone von')}{inp('zoneHigh', 'Makro-Zone bis')}
          </div>
        </Card></BlurFade>
        <BlurFade delay={0.11} className="lg:col-span-2"><Card title="Einstiegs-Check">
          <p className="mb-4 max-w-[80ch] text-[13px] text-mute">Timeframe-Leiter von klein nach groß (ab 30m). Die ersten Stufen sind Pflicht, jede weitere macht den Einstieg stärker. Die Standardwerte sind auf deinen Chart (Bitstamp, MCB, RSI 14) abgeglichen.</p>
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Field key={i} label={`Stufe ${i + 1}${i === 0 ? ' (Basis)' : ''}`} htmlFor={'s-sgL' + i}>
                <select id={'s-sgL' + i} className={inputCls} value={v['sgL' + i] || ''} onChange={set('sgL' + i)}>
                  {i > 0 && <option value="">–</option>}{SIGNAL_TFS.map((tf) => <option key={tf}>{tf}</option>)}
                </select>
              </Field>
            ))}
            {inp('sgReq', 'Pflicht-Stufen', '2 = Basis + nächst höhere')}{inp('sgLook', 'Signal gilt (Kerzen)')}
            {inp('sgRsiOs', 'RSI überverkauft')}{inp('sgRsiOb', 'RSI überkauft')}
            {inp('sgRsiNear', 'RSI-Nähe (Punkte)', 'z. B. 10 → Long ab ≤ 40')}{inp('sgWtOs', 'MCB Bottom-Zone')}
            {inp('sgWtOb', 'MCB Top-Zone')}
            <Field label="Zone auf" htmlFor="s-sgZoneTf">
              <select id="s-sgZoneTf" className={inputCls} value={v.sgZoneTf || '1h'} onChange={set('sgZoneTf')}>{SIGNAL_TFS.map((tf) => <option key={tf}>{tf}</option>)}</select>
            </Field>
            {inp('sgSwing', 'Kerzen für Zone')}{inp('sgCh', 'WaveTrend Kanal')}{inp('sgAvg', 'WaveTrend Schnitt')}{inp('sgSig', 'WaveTrend Signal')}
          </div>
          <Field label="Fehler-Tags (eine Zeile pro Tag)" htmlFor="s-mistakes" className="mt-4">
            <textarea id="s-mistakes" rows={4} className={cn(inputCls, 'resize-y leading-relaxed')} value={v.mistakes || ''} onChange={set('mistakes')} />
          </Field>
        </Card></BlurFade>
        <BlurFade delay={0.12} className="lg:col-span-2"><Card title="Hyblock-Connector">
          <p className="mb-4 max-w-[80ch] text-[13px] text-mute">Endpunkte und Feldnamen aus der Hyblock-API-Doku (v2, ohne <span className="font-mono">/v2</span>). Leeres Feld = automatisch erkennen. „Testen“ zeigt, welche Felder die Antwort enthält.</p>
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
            {inp('hbLong', 'Endpunkt Top-Trader Long', undefined, false)}{inp('hbLongField', 'Feld Long %', 'z. B. longPercentage', false)}
            {inp('hbDelta', 'Endpunkt Whale-Delta', undefined, false)}{inp('hbDeltaField', 'Feld Delta', 'z. B. delta', false)}
            {inp('hbCoin', 'Coin', undefined, false)}{inp('hbExchange', 'Exchange', undefined, false)}{inp('hbTf', 'Timeframe', undefined, false)}
          </div>
          <HyblockTest endpoints={[v.hbLong, v.hbDelta]} params={{ coin: v.hbCoin, exchange: v.hbExchange, timeframe: v.hbTf, limit: 3 }} />
        </Card></BlurFade>
        <BlurFade delay={0.15}><Card title="Daten">
          <p className="mb-4 text-[13px] text-mute">Sichere dein Journal als Datei. CSV öffnet sich direkt in Excel oder Numbers.</p>
          {downloads ? (
            <div className="flex flex-wrap gap-2"><Btn onClick={() => exportFile('csv')}>CSV exportieren</Btn><Btn onClick={() => exportFile('json')}>Backup (JSON)</Btn></div>
          ) : <p className="text-[12.5px] text-faint">Export gibt es nur, wenn das Journal auf claude.ai geöffnet ist.</p>}
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line-2 px-3.5 py-2 text-[12.5px] text-mute transition-colors hover:text-fg">
            Backup einspielen (JSON)
            <input type="file" accept="application/json,.json" className="sr-only" onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = '';
              if (!f) return;
              try {
                const j = JSON.parse(await f.text());
                const list = Array.isArray(j) ? j : j?.trades;
                if (!Array.isArray(list)) throw new Error('format');
                const added = await onImport(list);
                notify({ kind: 'success', title: added ? `${added} Trades übernommen` : 'Alles schon vorhanden' });
              } catch { notify({ kind: 'error', title: 'Datei nicht lesbar' }); }
            }} />
          </label>
          <div className="mt-5 grid gap-1 border-t border-line pt-4 text-[12.5px] text-mute">
            <span>{trades.length} Trades gespeichert · {settings.setups.length} Grundlagen · {settings.rules.length} Grundregeln</span>
          </div>
        </Card></BlurFade>
      </div>
    </div>
  );
}

function HyblockTest({ endpoints, params }: { endpoints: string[]; params: Record<string, any> }) {
  const [out, setOut] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const mcp = await useCap('mcp');
    if (!mcp) { setOut(['Nur auf claude.ai verfügbar.']); setBusy(false); return; }
    const lines: string[] = [];
    for (const ep of endpoints.filter(Boolean)) {
      try {
        const r = await mcp.callTool(HB_SERVER, 'hyblock_get', { endpoint: ep.trim(), params: Object.fromEntries(Object.entries(params).filter(([, x]) => x !== '' && x != null)) }, { cache: false });
        const series = hbSeries(r?.payload ?? r?.structuredContent);
        const last = series[series.length - 1];
        lines.push(`${ep}: ${series.length} Werte · Felder: ${last && typeof last === 'object' ? Object.entries(last).map(([k, x]) => `${k}=${typeof x === 'number' ? x : String(x).slice(0, 16)}`).join(', ') : '–'}`);
      } catch (e: any) {
        lines.push(`${ep}: ${e?.code === 'server_not_connected' ? `Connector „${HB_SERVER}“ nicht verbunden` : e?.code === 'tool_error' ? String(e?.message || 'Fehler').slice(0, 200) : e?.code || 'Fehler'}`);
      }
    }
    setOut(lines); setBusy(false);
  }
  return (
    <div className="mt-4 grid gap-2">
      <Btn size="sm" className="justify-self-start" onClick={run} disabled={busy}>{busy ? 'Teste …' : 'Verbindung testen'}</Btn>
      {out && <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-line bg-ink-950/60 p-3 font-mono text-[11.5px] text-mute">{out.join('\n')}</pre>}
    </div>
  );
}
