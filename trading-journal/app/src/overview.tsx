import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  ACCOUNT_LABEL, WEEKDAYS, cn, fmt, group, scenario, tDate, tone,
  type AccountFilter, type ETrade, type Hyblock, type MarketState, type Settings, type Stats,
} from './lib';
import { BlurFade, BorderBeam, Btn, Card, CircularProgress, Detail, Empty, Expand, InfoToggle, MeshBackdrop, NumberTicker, Pill, Segmented, SlidingNumber } from './ui';
import { backtestDetail, metricDetail, setupDetail, type MetricKey } from './explain';
import { Morph, useMorph } from './morph';
import { HyblockCard } from './hyblock';
import { EquityChart, MonthlyChart } from './charts';

type Props = {
  st: Stats; settings: Settings; acc: AccountFilter; setAcc: (a: AccountFilter) => void; market: MarketState;
  loaded: boolean; onNew: () => void; onEdit: (t: ETrade) => void; onSetup: (id: string) => void; goTrades: () => void;
  hyblock: Hyblock[]; onSaveHyblock: (h: Hyblock) => Promise<void>; onDeleteHyblock: (id: string) => Promise<void>;
};

export function Overview(p: Props) {
  const { st, settings } = p;
  const cur = settings.currency;
  return (
    <div className="grid gap-5">
      <Hero {...p} />
      <div className="grid gap-5 lg:grid-cols-12">
        <BlurFade delay={0.1} className="lg:col-span-5"><BacktestCard all={st.closed} settings={settings} /></BlurFade>
        <BlurFade delay={0.15} className="lg:col-span-3"><WinRateCard st={st} settings={settings} /></BlurFade>
        <BlurFade delay={0.2} className="lg:col-span-4"><ProjectionCard st={st} cur={cur} settings={settings} /></BlurFade>
      </div>
      <div className="grid gap-5 lg:grid-cols-12">
        <BlurFade delay={0.25} className="lg:col-span-7">
          <Card title="Kontostand" note={st.closed.length ? `${st.closed.length} Trades · jetzt ${fmt.n0(st.balance)} ${cur}` : undefined}><EquityChart st={st} cur={cur} /></Card>
        </BlurFade>
        <BlurFade delay={0.3} className="lg:col-span-5"><HyblockCard list={p.hyblock} market={p.market} settings={settings} onSave={p.onSaveHyblock} onDelete={p.onDeleteHyblock} /></BlurFade>
      </div>
      <div className="grid gap-5 lg:grid-cols-12">
        <BlurFade delay={0.35} className="lg:col-span-7"><Ranking st={st} onSetup={p.onSetup} cur={cur} /></BlurFade>
        <BlurFade delay={0.4} className="lg:col-span-5"><ChecklistCard st={st} /></BlurFade>
      </div>
      <div className="grid gap-5 lg:grid-cols-12">
        <BlurFade delay={0.45} className="lg:col-span-5"><Card title="P&L pro Monat"><MonthlyChart st={st} cur={cur} /></Card></BlurFade>
        <BlurFade delay={0.5} className="lg:col-span-7"><Recent st={st} settings={settings} onEdit={p.onEdit} onNew={p.onNew} goTrades={p.goTrades} /></BlurFade>
      </div>
      <BlurFade delay={0.55}><Patterns st={st} /></BlurFade>
    </div>
  );
}

// ── Hero: Netto-P&L + Live-Markt ───────────────────────
function Hero({ st, settings, acc, setAcc, market, loaded }: Props) {
  const g = st.g, cur = settings.currency;
  const ret = st.start ? g.net / st.start : null;
  const facts: [string, ReactNode, MetricKey][] = [
    ['Trades', <>{g.n}{st.open.length ? <span className="text-faint"> +{st.open.length} offen</span> : null}</>, 'trades'],
    ['Win-Rate', fmt.pct0(g.winRate), 'winRate'],
    ['Profit-Faktor', g.pf == null ? '–' : g.pf === Infinity ? '∞' : fmt.n2(g.pf), 'pf'],
    ['Ø R', fmt.r(g.avgR), 'avgR'],
    ['Max. Drawdown', g.n ? fmt.pct(st.maxDD) : '–', 'maxDD'],
  ];
  return (
    <BlurFade>
      <section className="relative overflow-hidden rounded-[28px] border border-line">
        <MeshBackdrop />
        <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.3fr_1fr] lg:gap-8 lg:p-8">
          <div className="flex min-w-0 flex-col justify-between gap-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented value={acc} onChange={setAcc} options={(['all', 'makro', 'scalp'] as const).map((v) => ({ v, label: ACCOUNT_LABEL[v] }))} />
              <span className="text-xs text-mute">Startkapital {fmt.n0(st.start)} {cur}</span>
            </div>
            <div>
              <div className="mb-3 flex items-center gap-3"><span className="label">Netto-P&L · {ACCOUNT_LABEL[acc]}</span>
                <Morph id="fact-net" title="Netto-P&L" body={() => <Detail bare d={metricDetail('net', st, settings)} />} className="!w-auto rounded-full border border-line-2 px-2.5 py-0.5 hover:border-steel/60"><span className="label !text-[9.5px] group-hover:!text-steel">Details +</span></Morph></div>
              <div className={cn('dot-num flex flex-wrap items-baseline gap-x-3 text-[clamp(44px,8vw,78px)] leading-none', tone(g.net))}>
                {loaded ? <NumberTicker key={acc} value={g.net} decimals={2} signed /> : <span className="text-faint">0,00</span>}
                <span className="font-sans text-lg font-medium text-mute">{cur}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-mute">
                {ret != null && g.n > 0 && <Pill tone={ret >= 0 ? 'win' : 'loss'}>{fmt.pct(ret)}</Pill>}
                <span>{g.n ? `${g.wins} gewonnen · ${g.losses} verloren${g.be ? ` · ${g.be} Break-even` : ''}` : 'Noch keine abgeschlossenen Trades. Alle Werte starten bei null.'}</span>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2 border-t border-white/10 pt-5 sm:grid-cols-5">
              {facts.map(([l, v, k], i) => (
                <Morph key={l} id={`fact-${k}`} title={l} body={() => <Detail bare d={metricDetail(k, st, settings)} />}
                  className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 transition-colors hover:border-steel/40 hover:bg-steel/[0.07]">
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.05 }}>
                    <dt className="label flex items-center justify-between gap-1">{l}<span className="font-mono text-[13px] leading-none text-faint transition-all duration-300 group-hover:rotate-90 group-hover:text-steel">+</span></dt>
                    <dd className="num mt-1.5 font-mono text-[17px] font-medium text-fg">{v}</dd>
                  </motion.div>
                </Morph>
              ))}
            </dl>
          </div>
          <MarketPanel market={market} settings={settings} />
        </div>
      </section>
    </BlurFade>
  );
}

function MarketPanel({ market: m, settings }: { market: MarketState; settings: Settings }) {
  const cfg = settings.market;
  const sc = scenario(m.close4h, cfg);
  const inZone = m.price != null && m.price >= cfg.zoneLow && m.price <= cfg.zoneHigh;
  const wOk = m.closeW != null ? m.closeW > cfg.lowerHigh : null;
  const rOk = m.rsiW != null ? m.rsiW > cfg.rsiWeekly : null;
  const tm = (ms?: number) => ms ? new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
  const dm = (ms?: number) => ms ? new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div className="relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-2xl border border-white/10 bg-ink-900/55 p-5 backdrop-blur-md">
      {m.status === 'live' && <BorderBeam size={110} duration={10} />}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mute">{settings.pair} · TradingView</span>
        {m.status === 'live'
          ? <Pill tone="teal"><span className="relative flex size-1.5"><span className="absolute inset-0 animate-ping rounded-full bg-signal/70" /><span className="relative size-1.5 rounded-full bg-signal" /></span>Live · {tm(m.updatedAt)}</Pill>
          : m.status === 'connecting' ? <Pill>Verbinde …</Pill> : <Pill tone="warn">Kein Live-Kurs</Pill>}
      </div>

      {m.price != null ? (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
          <span className="dot-num text-[42px] leading-none text-fg"><SlidingNumber value={Math.round(m.price)} /></span>
          {m.change != null && <span className={cn('pb-1 font-mono text-sm', tone(m.change))}>{fmt.signed(m.change, 2)} % 24h</span>}
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-mute">{m.message || 'Kurs wird geladen …'}</p>
      )}

      {sc && (
        <motion.div key={sc.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className={cn('rounded-xl border p-3.5', { win: 'border-win/30 bg-win/[0.07]', loss: 'border-loss/30 bg-loss/[0.07]', warn: 'border-warn/30 bg-warn/[0.07]', mute: 'border-line-2 bg-white/[0.03]' }[sc.tone])}>
          <div className="flex items-center justify-between gap-2">
            <strong className={cn('text-[14px] font-semibold', { win: 'text-win', loss: 'text-loss', warn: 'text-warn', mute: 'text-fg' }[sc.tone])}>{sc.title}</strong>
            <span className="num font-mono text-xs text-mute">4H {fmt.n0(m.close4h)}</span>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-mute">{sc.detail}</p>
          <p className="mt-1 text-[11px] text-faint">Letzter geschlossener 4H-Schluss · {dm(m.close4hAt)}</p>
        </motion.div>
      )}

      {(m.rsiW != null || m.closeW != null) && (
        <div className="grid gap-2">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mute">Bärenmarkt-Ende bestätigt?</div>
          <AutoCheck ok={wOk} label={`Weekly Close über ${fmt.n0(cfg.lowerHigh)}`} value={m.closeW != null ? fmt.n0(m.closeW) : '–'} />
          <AutoCheck ok={rOk} label={`Weekly RSI über ${fmt.n2(cfg.rsiWeekly)}`} value={m.rsiW != null ? fmt.n1(m.rsiW) : '–'} />
          {m.rsiW != null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <motion.div className="h-full rounded-full bg-gradient-to-r from-denim via-steel to-teal" initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (m.rsiW / cfg.rsiWeekly) * 100)}%` }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} />
            </div>
          )}
        </div>
      )}
      {inZone && <p className="rounded-xl border border-warn/30 bg-warn/[0.07] p-3 text-[12.5px] text-warn">Preis liegt in der Makro-Long-Zone {fmt.n0(cfg.zoneLow)}–{fmt.n0(cfg.zoneHigh)}. Falling-Knife-Filter prüfen, bevor du kaufst.</p>}
      {m.status === 'error' && m.price != null && m.message && <p className="text-[11.5px] text-warn">{m.message}</p>}
    </div>
  );
}

function AutoCheck({ ok, label, value }: { ok: boolean | null; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="flex items-center gap-2">
        <span className={cn('grid size-4 place-items-center rounded-full text-[10px] font-bold', ok == null ? 'bg-white/10 text-mute' : ok ? 'bg-win/20 text-win' : 'bg-loss/15 text-loss')}>{ok == null ? '·' : ok ? '✓' : '✕'}</span>
        <span className={ok ? 'text-fg' : 'text-mute'}>{label}</span>
      </span>
      <span className="num font-mono text-xs text-mute">{value}</span>
    </div>
  );
}

/** Karte mit Plus-Knopf oben rechts, der eine Detail-Erklärung unter dem Inhalt aufklappt. */
function useToggle() { const [o, setO] = useState(false); return [o, () => setO((x) => !x)] as const; }

// ── Backtest-Vergleich ─────────────────────────────────
function BacktestCard({ all, settings }: { all: ETrade[]; settings: Settings }) {
  const [only, setOnly] = useState<'all' | 'bt'>('all');
  const bt = settings.backtest;
  const list = only === 'bt' ? all.filter((t) => (t.setups || []).includes('s_bt')) : all;
  const g = group(list);
  const rows: { l: string; k: 'winRate' | 'avgWin' | 'avgLoss' | 'exp'; you: number | null; ref: number; better: (d: number) => boolean; kind: 'pct' | 'pp' }[] = [
    { l: 'Win-Rate', k: 'winRate', you: g.winRate, ref: bt.winRate, better: (d) => d >= 0, kind: 'pp' },
    { l: 'Ø Gewinner', k: 'avgWin', you: g.moveWin, ref: bt.avgWin, better: (d) => d >= 0, kind: 'pct' },
    { l: 'Ø Verlierer', k: 'avgLoss', you: g.moveLoss, ref: bt.avgLoss, better: (d) => d >= 0, kind: 'pct' },
    { l: 'Erwartung pro Trade', k: 'exp', you: g.moveExp, ref: bt.expectancy, better: (d) => d >= 0, kind: 'pct' },
  ];
  const diff = g.moveExp != null ? g.moveExp - bt.expectancy : null;
  const verdict = diff == null ? null : diff >= 0 ? 'over' : 'under';
  return (
    <Card title="Backtest-Vergleich" action={<Segmented size="sm" value={only} onChange={setOnly} options={[{ v: 'all', label: 'Alle Trades' }, { v: 'bt', label: 'Nur Backtest-Signal' }]} />}>
      <div className={cn('mb-4 flex items-center justify-between gap-3 rounded-xl border p-3.5',
        verdict === 'over' ? 'border-win/30 bg-win/[0.07]' : verdict === 'under' ? 'border-loss/30 bg-loss/[0.07]' : 'border-line bg-white/[0.02]')}>
        <div>
          <div className={cn('text-[15px] font-semibold', verdict === 'over' ? 'text-win' : verdict === 'under' ? 'text-loss' : 'text-fg')}>
            {verdict === 'over' ? 'Du überperformst den Backtest' : verdict === 'under' ? 'Du liegst unter dem Backtest' : 'Noch kein Vergleich möglich'}
          </div>
          <div className="mt-0.5 text-xs text-mute">
            {g.moveN ? `Erwartung ${fmt.signed(diff != null ? diff * 100 : null, 1)} %-Punkte gegenüber Backtest · ${g.moveN} Trade${g.moveN === 1 ? '' : 's'} mit Ein- und Ausstieg` : `Sobald du Trades mit Ein- und Ausstieg abschließt, vergleiche ich sie mit dem Backtest (${bt.label}).`}
          </div>
        </div>
        {g.moveN > 0 && g.moveN < 30 && <Pill tone="warn">ab 30 Trades belastbar</Pill>}
      </div>
      <div className="grid">
        <div className="label grid grid-cols-[1fr_auto_auto_auto] gap-x-5 pb-2 !text-faint">
          <span>Kennzahl</span><span className="text-right">Du</span><span className="text-right">Backtest</span><span className="w-16 text-right">Δ</span>
        </div>
        {rows.map((r) => {
          const d = r.you == null ? null : r.you - r.ref;
          const good = d != null && r.better(d);
          return (
            <div key={r.l} className="border-t border-line py-1">
            <Morph id={`bt-${r.k}-${only}`} title={`Backtest · ${r.l}`} body={() => <Detail bare d={backtestDetail(r.k, g, settings)} />}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-5 px-2 py-2 text-[13px] transition-colors hover:bg-steel/[0.07]">
              <span className="flex items-center gap-2 text-mute"><span className="font-mono text-[13px] leading-none text-faint transition-all duration-300 group-hover:rotate-90 group-hover:text-steel">+</span>{r.l}</span>
              <span className={cn('num text-right font-mono font-medium', r.you == null ? 'text-faint' : r.kind === 'pp' ? 'text-fg' : tone(r.you))}>{r.kind === 'pp' ? fmt.pct0(r.you) : fmt.pct(r.you)}</span>
              <span className="num text-right font-mono text-mute">{r.kind === 'pp' ? fmt.n2(r.ref * 100) + ' %' : fmt.pct(r.ref)}</span>
              <span className="w-16 text-right">{d == null ? <span className="text-faint">–</span> : <Pill tone={good ? 'win' : 'loss'} className="px-2">{good ? '▲' : '▼'} {fmt.n1(Math.abs(d * 100))}</Pill>}</span>
            </Morph>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-faint">Gewinner, Verlierer und Erwartung als Kursbewegung vom Einstieg zum Ausstieg, ohne Hebel, wie im Backtest.</p>
    </Card>
  );
}

function WinRateCard({ st, settings }: { st: Stats; settings: Settings }) {
  const [o, t] = useToggle();
  const g = st.g, tot = g.n || 1;
  const bt = settings.backtest.winRate;
  return (
    <Card title="Win-Rate" action={<InfoToggle open={o} onClick={t} label="Win-Rate" />}>
      <div className="flex h-full flex-col items-center justify-between gap-4">
        <CircularProgress value={g.winRate} marker={bt} color={g.winRate != null && g.winRate >= bt ? '#6fd39b' : '#8fb3c9'} track="#434d58">
          <div>
            <div className="dot-num text-[34px] leading-none">{g.winRate == null ? '0' : Math.round(g.winRate * 100)}<span className="text-base text-mute"> %</span></div>
            <div className="mt-1 text-[11px] text-mute">Marke = Backtest {fmt.pct0(bt)}</div>
          </div>
        </CircularProgress>
        <div className="grid w-full gap-2">
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-white/[0.06]">
            {g.n > 0 && <>
              <motion.span className="h-full bg-win" initial={{ width: 0 }} animate={{ width: `${(g.wins / tot) * 100}%` }} transition={{ duration: 0.8 }} />
              <motion.span className="h-full bg-loss" initial={{ width: 0 }} animate={{ width: `${(g.losses / tot) * 100}%` }} transition={{ duration: 0.8, delay: 0.1 }} />
              {g.be > 0 && <span className="h-full bg-faint" style={{ width: `${(g.be / tot) * 100}%` }} />}
            </>}
          </div>
          <div className="flex justify-between text-xs text-mute">
            <span><b className="font-mono text-win">{g.wins}</b> gut gegangen</span>
            <span><b className="font-mono text-loss">{g.losses}</b> nicht</span>
          </div>
          <div className="text-center text-[11.5px] text-faint">{st.streak ? `Aktuelle Serie: ${st.streak}× ${st.streakType === 'win' ? 'Gewinn' : st.streakType === 'loss' ? 'Verlust' : 'Break-even'}` : 'Noch keine Serie'}</div>
        </div>
      </div>
      <Expand open={o}><Detail d={metricDetail('winRate', st, settings)} /></Expand>
    </Card>
  );
}

function ProjectionCard({ st, cur, settings }: { st: Stats; cur: string; settings: Settings }) {
  const [o, t] = useToggle();
  const p = st.proj;
  return (
    <Card title="Hochrechnung aufs Jahr" action={<InfoToggle open={o} onClick={t} label="Hochrechnung" />}>
      {!p ? <Empty title="Noch nichts hochzurechnen" text="Mit dem ersten abgeschlossenen Trade rechne ich deine Rendite auf 12 Monate hoch." /> : (
        <div className="flex h-full flex-col">
          <div className={cn('font-mono text-[38px] font-medium leading-none tracking-tight', tone(p.linear))}><NumberTicker value={p.linear * 100} decimals={1} signed /><span className="text-xl text-mute"> %</span></div>
          <div className="mt-1.5 text-xs text-mute">in 12 Monaten bei gleicher Performance, linear</div>
          <dl className="mt-4 grid text-[13px]">
            {([
              ['Rendite bisher', fmt.pct(p.r), tone(p.r)],
              ['Ø pro Monat', fmt.pct(p.monthly), tone(p.monthly)],
              ['Konto in 12 Monaten', `${fmt.n0(p.endLin)} ${cur}`, 'text-fg'],
              ['Mit Zinseszins', Math.abs(p.comp) > 99 ? (p.comp > 0 ? '> +9.900 %' : '−100 %') : fmt.pct(p.comp), tone(p.comp)],
              ['Trades pro Woche', fmt.n1(p.perWeek), 'text-fg'],
            ] as const).map(([l, v, c]) => (
              <div key={l} className="flex justify-between gap-3 border-t border-line py-2"><dt className="text-mute">{l}</dt><dd className={cn('num font-mono font-medium', c)}>{v}</dd></div>
            ))}
          </dl>
          {p.weak && <p className="mt-2 rounded-lg bg-warn/10 px-3 py-2 text-[11.5px] text-warn">Wenig Daten. Belastbar ab etwa 30 Tagen und 10 Trades.</p>}
        </div>
      )}
      <Expand open={o}><Detail d={metricDetail('projection', st, settings)} /></Expand>
    </Card>
  );
}

// ── Checklisten-Auswertung ─────────────────────────────
function ChecklistCard({ st }: { st: Stats }) {
  const [o, t] = useToggle();
  const c = st.closed.filter((t) => t.items.length);
  const full = group(c.filter((t) => t.complete)), part = group(c.filter((t) => !t.complete));
  const misses = useMemo(() => {
    const m = new Map<string, { text: string; n: number; loss: number }>();
    for (const t of c) for (const it of t.items) if (!t.checks?.[it.id]) {
      const e = m.get(it.text) || { text: it.text, n: 0, loss: 0 };
      e.n++; if (t.result === 'loss') e.loss++;
      m.set(it.text, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 3);
  }, [c]);
  return (
    <Card title="Checkliste" action={<InfoToggle open={o} onClick={t} label="Checkliste" />}>
      <Expand open={o}><div className="mb-4"><Detail d={{
        title: 'Checklisten-Auswertung',
        what: 'Vergleicht Trades, bei denen du alle Punkte (Grundregeln plus Punkte der gewählten Grundlagen) abgehakt hast, mit Trades, bei denen etwas gefehlt hat. So siehst du schwarz auf weiß, ob sich Disziplin auszahlt.',
        rows: [['Trades mit Checkliste', String(c.length)], ['Alles erfüllt', `${full.n} · ${fmt.pct0(full.winRate)} Win-Rate`], ['Mit Lücken', `${part.n} · ${fmt.pct0(part.winRate)} Win-Rate`], ['Differenz', full.n && part.n ? `${fmt.signed(((full.winRate || 0) - (part.winRate || 0)) * 100, 0)} Prozentpunkte` : '–']],
        verdict: !full.n || !part.n ? { tone: 'mute', text: 'Für einen Vergleich brauchst du Trades mit und ohne vollständige Checkliste.' } : (full.winRate || 0) >= (part.winRate || 0) ? { tone: 'win', text: 'Mit voller Checkliste gewinnst du öfter. Die Regeln wirken.' } : { tone: 'warn', text: 'Mit Lücken läuft es bisher besser. Prüfe, ob die Checklisten-Punkte zu deinem Stil passen.' },
      }} /></div></Expand>
      {!c.length ? <Empty title="Noch keine Auswertung" text="Hake beim Eintragen ab, welche Regeln erfüllt waren. Hier siehst du dann, ob sich Disziplin auszahlt." /> : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            {([['Alles erfüllt', full, 'win'], ['Lücken', part, 'loss']] as const).map(([l, g, t]) => (
              <div key={l} className="rounded-xl border border-line bg-ink-950/50 p-3">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{l}</div>
                <div className={cn('num mt-1 font-mono text-2xl font-medium', g.n ? (t === 'win' ? 'text-win' : 'text-loss') : 'text-faint')}>{fmt.pct0(g.winRate)}</div>
                <div className="num mt-0.5 text-[11.5px] text-mute">{g.n} Trades · <span className={tone(g.net)}>{fmt.signed(g.net, 0)}</span></div>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">Am häufigsten ausgelassen</div>
            {misses.length ? misses.map((m) => (
              <div key={m.text} className="flex items-center justify-between gap-3 border-t border-line py-2 text-[12.5px]">
                <span className="min-w-0 truncate text-fg">{m.text}</span>
                <span className="num shrink-0 font-mono text-xs text-mute">{m.n}× · {Math.round((m.loss / m.n) * 100)} % Verlust</span>
              </div>
            )) : <p className="text-[12.5px] text-win">Bisher alles abgehakt.</p>}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Ranking der Grundlagen ─────────────────────────────
type SortKey = 'winRate' | 'net' | 'n' | 'avgR';
export function sortSetups<T extends { n: number; winRate: number | null; net: number; avgR: number | null }>(list: T[], key: SortKey) {
  const v = (s: T) => (s[key] == null ? -Infinity : (s[key] as number));
  return [...list].sort((a, b) => v(b) - v(a) || b.n - a.n);
}
export const SORT_OPTS: { v: SortKey; label: string }[] = [{ v: 'winRate', label: 'Win-Rate' }, { v: 'net', label: 'P&L' }, { v: 'n', label: 'Trades' }, { v: 'avgR', label: 'Ø R' }];

function Ranking({ st, onSetup, cur }: { st: Stats; onSetup: (id: string) => void; cur: string }) {
  const [key, setKey] = useState<SortKey>('winRate');
  const { close } = useMorph();
  const list = sortSetups(st.setups.map((s) => ({ ...s, id: s.setup.id })), key);
  const used = list.filter((s) => s.n > 0), unused = list.filter((s) => !s.n);
  return (
    <Card title="Entscheidungsgrundlagen" action={<Segmented size="sm" value={key} onChange={setKey} options={SORT_OPTS} />}>
      {!used.length && <p className="mb-3 text-[13px] text-mute">Noch keine Trades zugeordnet. Sobald du Trades mit Grundlage einträgst, erscheint hier das Ranking.</p>}
      <div className="grid">
        {used.length > 0 && (
          <div className="label grid grid-cols-[minmax(0,1.6fr)_52px_minmax(90px,1.2fr)_minmax(0,0.9fr)] gap-3 px-2 pb-2 !text-faint sm:grid-cols-[minmax(0,1.6fr)_52px_minmax(90px,1.2fr)_minmax(0,0.9fr)_56px]">
            <span>Grundlage</span><span>Trades</span><span>Win-Rate</span><span className="text-right">P&L</span><span className="hidden text-right sm:block">Ø R</span>
          </div>
        )}
        {used.map((s, i) => (
          <motion.div layout key={s.id} transition={{ type: 'spring', stiffness: 380, damping: 34 }} className="border-t border-line">
          <Morph id={`setup-rank-${s.id}`} title={s.setup.name} body={() => <><Detail bare d={setupDetail(s, st.closed, cur)} /><Btn size="sm" className="mt-3" onClick={() => { close(); onSetup(s.id); }}>Alle Trades mit dieser Grundlage →</Btn></>}
            className="grid w-full grid-cols-[minmax(0,1.6fr)_52px_minmax(90px,1.2fr)_minmax(0,0.9fr)] items-center gap-3 px-2 py-2.5 transition-colors hover:bg-steel/[0.07] sm:grid-cols-[minmax(0,1.6fr)_52px_minmax(90px,1.2fr)_minmax(0,0.9fr)_56px]">
            <span className="flex min-w-0 items-center gap-2.5 text-[13px] font-medium">
              <span className={cn('num w-4 shrink-0 font-mono text-[11px] transition-colors', 'text-faint group-hover:text-steel')}>{String(i + 1).padStart(2, '0')}</span>
              <span className="size-2 shrink-0 rounded-full" style={{ background: s.setup.color }} />
              <span className="truncate">{s.setup.name}</span>
            </span>
            <span className="num font-mono text-[13px] text-mute">{s.n}</span>
            <span className="grid gap-1">
              <span className="flex justify-between text-xs"><b className="num font-mono font-medium">{fmt.pct0(s.winRate)}</b><span className="num font-mono text-faint">{s.wins}/{s.losses}</span></span>
              <span className="h-1.5 overflow-hidden rounded-full bg-loss/25"><motion.span className="block h-full rounded-full bg-win" initial={{ width: 0 }} animate={{ width: `${(s.winRate || 0) * 100}%` }} transition={{ duration: 0.8 }} /></span>
            </span>
            <span className={cn('num text-right font-mono text-[13px] font-medium', tone(s.net))}>{fmt.signed(s.net, 0)}</span>
            <span className={cn('num hidden text-right font-mono text-[13px] sm:block', tone(s.avgR))}>{s.avgR == null ? '–' : fmt.signed(s.avgR)}</span>
          </Morph>
          </motion.div>
        ))}
      </div>
      {unused.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {unused.map((s) => <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-faint"><span className="size-1.5 rounded-full" style={{ background: s.setup.color }} />{s.setup.name}</span>)}
        </div>
      )}
    </Card>
  );
}

// ── Muster ─────────────────────────────────────────────
function Side({ label, g }: { label: string; g: ReturnType<typeof group> }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex justify-between gap-2 text-[13px]"><span className="truncate font-medium">{label}</span><span className="num font-mono">{g.n ? fmt.pct0(g.winRate) : '–'}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: g.n ? 'rgb(212 108 106 / 0.25)' : 'rgb(255 255 255 / 0.06)' }}>
        <motion.div className="h-full rounded-full bg-win" initial={{ width: 0 }} animate={{ width: `${(g.winRate || 0) * 100}%` }} transition={{ duration: 0.8 }} />
      </div>
      <div className="num text-[11px] text-faint">{g.n ? <>{g.n} Trades · <span className={tone(g.net)}>{fmt.signed(g.net, 0)}</span></> : 'keine Trades'}</div>
    </div>
  );
}

function Patterns({ st }: { st: Stats }) {
  const c = st.closed;
  if (!c.length) return <Card title="Muster in deinen Trades"><Empty title="Noch keine Muster" text="Plan befolgt oder nicht, Long gegen Short, Überzeugung, Gefühl und Wochentag. Das füllt sich mit deinen Trades." /></Card>;
  const g = (f: (t: ETrade) => boolean) => group(c.filter(f));
  const verdict = (a: any, b: any, la: string, lb: string) => (!a.n || !b.n ? '' : a.winRate === b.winRate ? 'gleich' : `${a.winRate > b.winRate ? la : lb} besser`);
  const byKey = (fn: (t: ETrade) => string | null) => {
    const m = new Map<string, ETrade[]>();
    for (const t of c) { const k = fn(t); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k)!.push(t); }
    return [...m].map(([k, l]) => ({ k, ...group(l) })).sort((a, b) => b.net - a.net);
  };
  const rows: [string, string, ReactNode, ReactNode][] = [];
  const plan = [g((t) => t.followedPlan === true), g((t) => t.followedPlan === false)];
  rows.push(['Plan befolgt?', verdict(plan[0], plan[1], 'Mit Plan', 'Ohne Plan'), <Side label="Ja" g={plan[0]} />, <Side label="Nein" g={plan[1]} />]);
  const side = [g((t) => t.side !== 'short'), g((t) => t.side === 'short')];
  rows.push(['Richtung', verdict(side[0], side[1], 'Long', 'Short'), <Side label="Long" g={side[0]} />, <Side label="Short" g={side[1]} />]);
  const acc = [g((t) => t.account === 'makro'), g((t) => t.account !== 'makro')];
  if (acc[0].n && acc[1].n) rows.push(['Konto', verdict(acc[0], acc[1], 'Makro', 'Scalp'), <Side label="Makro" g={acc[0]} />, <Side label="Scalp" g={acc[1]} />]);
  const conv = [g((t) => (t.conviction || 0) >= 4), g((t) => !!t.conviction && t.conviction <= 3)];
  rows.push(['Überzeugung', verdict(conv[0], conv[1], 'Hohe', 'Niedrige'), <Side label="Hoch (4–5)" g={conv[0]} />, <Side label="Niedrig (1–3)" g={conv[1]} />]);
  const em = byKey((t) => t.emotion || null);
  if (em.length >= 2) rows.push(['Gefühl beim Einstieg', 'bestes / schlechtestes', <Side label={em[0].k} g={em[0]} />, <Side label={em[em.length - 1].k} g={em[em.length - 1]} />]);
  const wd = byKey((t) => WEEKDAYS[tDate(t).getDay()]);
  if (wd.length >= 2) rows.push(['Wochentag', 'bester / schlechtester', <Side label={wd[0].k} g={wd[0]} />, <Side label={wd[wd.length - 1].k} g={wd[wd.length - 1]} />]);
  return (
    <Card title="Muster in deinen Trades">
      <div className="grid gap-x-10 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(([l, v, a, b], i) => (
          <motion.div key={l} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.05 }} className="grid grid-cols-2 gap-x-5 gap-y-2.5 border-t border-line py-3.5">
            <div className="col-span-2 flex justify-between gap-2 text-xs font-semibold text-mute"><span>{l}</span><span className="text-fg">{v}</span></div>
            {a}{b}
          </motion.div>
        ))}
      </div>
    </Card>
  );
}

// ── Letzte Trades ──────────────────────────────────────
export function ResultPill({ t }: { t: ETrade }) {
  const m = { win: ['win', 'Gewinn'], loss: ['loss', 'Verlust'], be: ['mute', 'Break-even'], open: ['warn', 'Offen'] }[t.result] as ['win' | 'loss' | 'mute' | 'warn', string];
  return <Pill tone={m[0]}>{m[1]}</Pill>;
}
export function SetupChips({ ids, settings, max = 2 }: { ids: string[]; settings: Settings; max?: number }) {
  const list = (ids || []).map((id) => settings.setups.find((s) => s.id === id)).filter(Boolean) as Settings['setups'];
  if (!list.length) return <span className="text-xs text-faint">ohne Grundlage</span>;
  return (
    <span className="flex min-w-0 flex-nowrap gap-1.5 overflow-hidden">
      {list.slice(0, max).map((s) => <span key={s.id} className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-line-2 bg-white/[0.03] px-2 py-0.5 text-[11.5px]"><span className="size-1.5 shrink-0 rounded-full" style={{ background: s.color }} /><span className="truncate">{s.name}</span></span>)}
      {list.length > max && <span className="rounded-full border border-line-2 px-2 py-0.5 text-[11.5px] text-mute">+{list.length - max}</span>}
    </span>
  );
}

function Recent({ st, settings, onEdit, onNew, goTrades }: { st: Stats; settings: Settings; onEdit: (t: ETrade) => void; onNew: () => void; goTrades: () => void }) {
  const list = [...st.list].sort((a, b) => +tDate(b) - +tDate(a)).slice(0, 6);
  return (
    <Card title="Letzte Trades" action={list.length ? <button type="button" onClick={goTrades} className="label !text-fg hover:!text-signal">Alle ansehen →</button> : undefined}>
      {!list.length ? <Empty title="Noch keine Trades" text="Trag deinen ersten Trade ein. Alle Zahlen im Journal rechnen sich dann automatisch." action={<Btn variant="primary" size="sm" onClick={onNew} className="mt-2">Ersten Trade eintragen</Btn>} /> : (
        <div className="grid">
          {list.map((t, i) => (
            <motion.button key={t.id} layoutId={`trade-${t.id}`} type="button" onClick={() => onEdit(t)} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05, layout: { type: 'spring', bounce: 0.08, duration: 0.45 } }} whileTap={{ scale: 0.985 }}
              className={cn('grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-white/[0.03]', i && 'border-t border-line')}>
              <span className="num font-mono text-[11px] leading-tight text-mute">{fmt.date(tDate(t))}<br />{fmt.time(tDate(t))}</span>
              <span className="grid min-w-0 gap-1">
                <span className="flex items-center gap-2 text-xs">
                  <span className={cn('font-semibold uppercase tracking-wide', t.side === 'short' ? 'text-loss' : 'text-win')}>{t.side === 'short' ? '▼ Short' : '▲ Long'}</span>
                  <span className="text-faint">{t.account === 'makro' ? 'Makro' : 'Scalp'}</span>
                </span>
                <SetupChips ids={t.setups} settings={settings} />
              </span>
              <span className="grid justify-items-end gap-1">
                <motion.span layoutId={`trade-pnl-${t.id}`} className={cn('num font-mono text-[13.5px] font-medium', tone(t.pnl))}>{t.pnl == null ? '–' : fmt.signed(t.pnl)}</motion.span>
                <ResultPill t={t} />
              </span>
            </motion.button>
          ))}
        </div>
      )}
    </Card>
  );
}
