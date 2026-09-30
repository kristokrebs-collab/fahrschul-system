import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  EMOTIONS, SETUP_COLORS, TIMEFRAMES, calc, checkItems, cn, fmt, nowLocal, num, safeUrl, toInput, tone, uid,
  type Account, type CheckItem, type Settings, type Setup, type Trade,
} from './lib';
import { Btn, CheckRow, Field, GradientSelector, Icon, Pill, Segmented, inputCls, type GradOption } from './ui';

// ── Modal / Bottom-Sheet ───────────────────────────────
export function Sheet({ open, onClose, title, children, footer, wide = true, layoutId }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer: ReactNode; wide?: boolean; layoutId?: string }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] grid items-end justify-items-center bg-ink-950/75 backdrop-blur-sm sm:place-items-center sm:p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
          onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div role="dialog" aria-modal="true" aria-label={title} layoutId={layoutId} style={{ borderRadius: 28 }}
            className={cn('flex max-h-[94%] w-full flex-col overflow-hidden rounded-t-3xl border border-line-2 bg-ink-850 shadow-[0_30px_80px_rgb(0_0_0/0.6)] sm:max-h-[calc(100%-16px)] sm:rounded-3xl', wide ? 'sm:max-w-[860px]' : 'sm:max-w-[540px]')}
            initial={layoutId ? undefined : { y: 40, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={layoutId ? undefined : { y: 30, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32, bounce: 0.1 }}>
            <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
              <h2 className="text-[17px] font-semibold">{title}</h2>
              <button type="button" onClick={onClose} aria-label="Schließen" className="grid size-9 place-items-center rounded-xl border border-line-2 text-mute transition-colors hover:text-fg [&>svg]:size-4">{Icon.x}</button>
            </div>
            <SheetBody morph={!!layoutId}>{children}</SheetBody>
            <div className="flex flex-wrap items-center gap-2.5 border-t border-line bg-ink-900/60 px-6 py-3.5 pb-[calc(14px+env(safe-area-inset-bottom,0px))]">{footer}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Beim Morph erst nach der Formänderung einblenden, damit innere Layout-Animationen nicht mitfliegen. */
function SheetBody({ children, morph }: { children: ReactNode; morph: boolean }) {
  const [ready, setReady] = useState(!morph);
  useEffect(() => { if (!morph) return; const id = setTimeout(() => setReady(true), 380); return () => clearTimeout(id); }, [morph]);
  return (
    <div className="min-h-[40vh] overflow-y-auto px-6 py-5">
      {ready && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>{children}</motion.div>}
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3.5 border-t border-line py-5 first:border-t-0 first:pt-0">
      <h3 className="flex items-baseline gap-2 text-[13.5px] font-semibold">{title}{sub && <span className="text-xs font-normal text-faint">{sub}</span>}</h3>
      {children}
    </section>
  );
}

const CONVICTION: GradOption[] = [
  { v: 1, label: 'Schwach', color: '#4a4a4a' }, { v: 2, label: 'Gering', color: '#767676' },
  { v: 3, label: 'Mittel', color: '#a8a8a8' }, { v: 4, label: 'Hoch', color: '#dedede' }, { v: 5, label: 'Top', color: '#ffffff' },
];

type Draft = Record<string, string>;
const blank = (s: Settings, acc: Account): { d: Draft; t: Partial<Trade> } => ({
  d: { date: nowLocal(), pair: s.pair, timeframe: '', entry: '', stop: '', target: '', exit: '', size: '', leverage: acc === 'scalp' ? '4' : '', fees: '', pnlManual: '', reason: '', notes: '', chart: '' },
  t: { account: acc, side: 'long', status: 'closed', setups: [], checks: {}, conviction: null, followedPlan: null, emotion: '' },
});

export function TradeSheet({ open, trade, settings, defaultAccount, onClose, onSave, onDelete, onNewSetup, layoutId }:
  { layoutId?: string; open: boolean; trade: Trade | null; settings: Settings; defaultAccount: Account; onClose: () => void; onSave: (t: Trade) => Promise<void>; onDelete: (id: string) => Promise<void>; onNewSetup: () => void }) {
  const [d, setD] = useState<Draft>({});
  const [t, setT] = useState<Partial<Trade>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErr(''); setArmed(false); setBusy(false);
    if (trade) {
      setD({ date: (trade.date || '').slice(0, 16), pair: trade.pair || '', timeframe: trade.timeframe || '', entry: toInput(trade.entry), stop: toInput(trade.stop), target: toInput(trade.target), exit: toInput(trade.exit), size: toInput(trade.size), leverage: toInput(trade.leverage), fees: toInput(trade.fees), pnlManual: toInput(trade.pnlManual), reason: trade.reason || '', notes: trade.notes || '', chart: trade.chart || '' });
      setT({ account: trade.account || 'scalp', side: trade.side, status: trade.status, setups: [...(trade.setups || [])], checks: { ...(trade.checks || {}) }, conviction: trade.conviction, followedPlan: trade.followedPlan, emotion: trade.emotion });
    } else {
      const b = blank(settings, defaultAccount); setD(b.d); setT(b.t);
    }
  }, [open, trade]);

  const set = (k: string) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));
  const merged: Partial<Trade> = useMemo(() => ({
    ...t, date: d.date, pair: d.pair, timeframe: d.timeframe,
    entry: num(d.entry), stop: num(d.stop), target: num(d.target), exit: t.status === 'open' ? null : num(d.exit),
    size: num(d.size), leverage: num(d.leverage), fees: num(d.fees), pnlManual: num(d.pnlManual),
    reason: (d.reason || '').trim(), notes: (d.notes || '').trim(), chart: safeUrl(d.chart || ''),
  }), [d, t]);
  const c = calc(merged);
  const acc = (t.account || 'scalp') as Account;
  const cap = settings.capital[acc] || 0;
  const items: CheckItem[] = checkItems(t.setups || [], settings);
  const done = items.filter((i) => t.checks?.[i.id]).length;
  const lev = merged.leverage;
  const levWarn = lev != null && (acc === 'scalp' ? lev > 4 : lev > 5);
  const setups = [...settings.setups].sort((a, b) => Number(b.account === acc || b.account === 'both') - Number(a.account === acc || a.account === 'both'));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const m = merged;
    if (!m.date) return setErr('Bitte Datum angeben.');
    if (!(m.entry! > 0)) return setErr('Bitte einen Einstiegspreis angeben.');
    if (m.status !== 'open' && m.pnlManual == null) {
      if (!(m.exit! > 0)) return setErr('Bitte Ausstieg angeben oder P&L manuell eintragen.');
      if (!(m.size! > 0)) return setErr('Bitte Positionsgröße angeben oder P&L manuell eintragen.');
    }
    if ((d.chart || '').trim() && !m.chart) return setErr('Der Chart-Link muss mit https:// beginnen.');
    const known = new Set(items.map((i) => i.id));
    const checks = Object.fromEntries(Object.entries(t.checks || {}).filter(([k, v]) => v && known.has(k)));
    const now = new Date().toISOString();
    const doc = { ...(m as Trade), checks, pnl: c.pnl, r: c.r, updatedAt: now, createdAt: trade?.createdAt || now, id: trade?.id || '' };
    if (!doc.id) delete (doc as any).id;
    setErr(''); setBusy(true);
    try { await onSave(doc as Trade); onClose(); }
    catch { setErr('Speichern fehlgeschlagen. Prüfe die Verbindung und versuch es erneut.'); }
    finally { setBusy(false); }
  }

  const preview: [string, ReactNode][] = [
    ['P&L', c.pnl == null ? '–' : <span className={tone(c.pnl)}>{fmt.signed(c.pnl)} {settings.currency}</span>],
    ['R-Multiple', c.r == null ? '–' : <span className={tone(c.r)}>{fmt.r(c.r)}</span>],
    ['Kursbewegung', c.move == null ? '–' : <span className={tone(c.move)}>{fmt.pct(c.move)}</span>],
    ['Risiko', c.risk == null ? '–' : <>{fmt.n0(c.risk)} <span className="text-xs text-mute">{cap ? `(${fmt.n1((c.risk / cap) * 100)} %)` : ''}</span></>],
    ['Geplantes CRV', c.rr == null ? '–' : `1 : ${fmt.n2(c.rr)}`],
  ];

  return (
    <Sheet layoutId={layoutId} open={open} onClose={onClose} title={trade ? 'Trade bearbeiten' : 'Trade eintragen'}
      footer={<>
        {trade && (armed
          ? <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#ff8a90]">Wirklich löschen?<Btn size="sm" variant="danger" onClick={async () => { try { await onDelete(trade.id); onClose(); } catch { setErr('Löschen fehlgeschlagen.'); } }}>Ja, löschen</Btn><Btn size="sm" onClick={() => setArmed(false)}>Nein</Btn></span>
          : <Btn variant="danger" onClick={() => setArmed(true)}>Löschen</Btn>)}
        <span className="flex-1" />
        {err && <span role="alert" className="text-[12.5px] font-medium text-[#ff8a90]">{err}</span>}
        <Btn onClick={onClose}>Abbrechen</Btn>
        <Btn variant="primary" disabled={busy} className="min-w-[110px]" onClick={() => (document.getElementById('trade-form') as HTMLFormElement)?.requestSubmit()}>{busy ? 'Speichert …' : 'Speichern'}</Btn>
      </>}>
      <form id="trade-form" onSubmit={submit} noValidate>
        <Section title="Eckdaten">
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
            <Field label="Konto" className="col-span-2">
              <Segmented value={acc} onChange={(v) => setT((x) => ({ ...x, account: v }))} options={[{ v: 'makro', label: 'Makro' }, { v: 'scalp', label: 'Scalp' }]} />
            </Field>
            <Field label="Richtung" className="col-span-2">
              <Segmented value={t.side as 'long' | 'short'} onChange={(v) => setT((x) => ({ ...x, side: v }))} tones={{ long: '!border-win/40 !bg-win/15', short: '!border-loss/40 !bg-loss/15' }}
                options={[{ v: 'long', label: '▲ Long' }, { v: 'short', label: '▼ Short' }]} />
            </Field>
            <Field label="Datum & Uhrzeit" htmlFor="f-date" className="col-span-2"><input id="f-date" type="datetime-local" className={inputCls} value={d.date || ''} onChange={set('date')} /></Field>
            <Field label="Paar" htmlFor="f-pair"><input id="f-pair" className={inputCls} value={d.pair || ''} onChange={set('pair')} autoComplete="off" /></Field>
            <Field label="Timeframe" htmlFor="f-tf">
              <select id="f-tf" className={inputCls} value={d.timeframe || ''} onChange={set('timeframe')}>
                <option value="">–</option>{TIMEFRAMES.map((x) => <option key={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="Status" className="col-span-2">
              <Segmented value={t.status as 'closed' | 'open'} onChange={(v) => setT((x) => ({ ...x, status: v }))} options={[{ v: 'closed', label: 'Geschlossen' }, { v: 'open', label: 'Noch offen' }]} />
            </Field>
          </div>
        </Section>

        <Section title="Preise & Größe" sub="Komma oder Punkt, beides geht">
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
            {([['entry', 'Einstieg'], ['stop', 'Stop-Loss'], ['target', 'Take-Profit'], ['exit', 'Ausstieg']] as const).map(([k, l]) => (
              <Field key={k} label={l} htmlFor={'f-' + k}><input id={'f-' + k} className={cn(inputCls, 'font-mono')} inputMode="decimal" autoComplete="off" value={d[k] || ''} onChange={set(k)} disabled={k === 'exit' && t.status === 'open'} /></Field>
            ))}
            <Field label={`Größe (${settings.currency})`} htmlFor="f-size" help="Positionswert inkl. Hebel"><input id="f-size" className={cn(inputCls, 'font-mono')} inputMode="decimal" autoComplete="off" value={d.size || ''} onChange={set('size')} /></Field>
            <Field label="Hebel" htmlFor="f-lev" help={levWarn ? undefined : acc === 'scalp' ? 'Regel: 4x' : 'Regel: 2–5x'}>
              <input id="f-lev" className={cn(inputCls, 'font-mono', levWarn && 'border-warn/60')} inputMode="decimal" autoComplete="off" value={d.leverage || ''} onChange={set('leverage')} placeholder="z. B. 4" />
              {levWarn && <span className="text-[11px] font-medium text-warn">Über deiner Regel ({acc === 'scalp' ? '4x' : 'max. 5x'})</span>}
            </Field>
            <Field label={`Gebühren (${settings.currency})`} htmlFor="f-fees"><input id="f-fees" className={cn(inputCls, 'font-mono')} inputMode="decimal" autoComplete="off" value={d.fees || ''} onChange={set('fees')} placeholder="0" /></Field>
            <Field label={`P&L manuell`} htmlFor="f-pnl" help="Leer = wird berechnet"><input id="f-pnl" className={cn(inputCls, 'font-mono')} inputMode="decimal" autoComplete="off" value={d.pnlManual || ''} onChange={set('pnlManual')} placeholder="automatisch" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {preview.map(([l, v]) => (
              <div key={l} className="rounded-xl border border-line bg-ink-950/50 px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{l}</div>
                <div className="num mt-0.5 font-mono text-[14px] font-medium">{v}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Entscheidungsgrundlage" sub="Warum bist du eingestiegen?">
          <div className="flex flex-wrap gap-2">
            {setups.map((s) => {
              const on = (t.setups || []).includes(s.id);
              const fits = s.account === acc || s.account === 'both';
              return (
                <button key={s.id} type="button" aria-pressed={on}
                  onClick={() => setT((x) => ({ ...x, setups: on ? (x.setups || []).filter((i) => i !== s.id) : [...(x.setups || []), s.id] }))}
                  className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-all duration-200',
                    on ? 'text-fg' : fits ? 'border-line-2 text-fg/85 hover:border-white/40' : 'border-line text-faint hover:text-mute')}
                  style={on ? { borderColor: s.color + 'aa', background: s.color + '22' } : undefined}>
                  <span className="size-2 rounded-full" style={{ background: s.color }} />{s.name}
                </button>
              );
            })}
            <button type="button" onClick={onNewSetup} className="rounded-full border border-dashed border-line-2 px-3 py-1.5 text-[12.5px] text-mute hover:text-fg">+ Neue Grundlage</button>
          </div>
          <Field label="Begründung" htmlFor="f-reason"><textarea id="f-reason" rows={3} className={cn(inputCls, 'resize-y leading-relaxed')} value={d.reason || ''} onChange={set('reason')} placeholder="z. B. 4H-Schluss unter 84.500, Delta rot, S&P lehnt ab" /></Field>
        </Section>

        <Section title="Checkliste" sub={items.length ? `${done} von ${items.length} erfüllt` : undefined}>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div className="h-full rounded-full bg-gradient-to-r from-[#5f5f5f] to-white" animate={{ width: items.length ? `${(done / items.length) * 100}%` : '0%' }} transition={{ type: 'spring', stiffness: 200, damping: 26 }} />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {items.map((it) => {
              const src = it.id.startsWith('g:') ? 'Grundregel' : settings.setups.find((s) => it.id.startsWith(s.id + ':'))?.name;
              return <CheckRow key={it.id} checked={!!t.checks?.[it.id]} sub={src} onToggle={() => setT((x) => ({ ...x, checks: { ...(x.checks || {}), [it.id]: !x.checks?.[it.id] } }))}>{it.text}</CheckRow>;
            })}
          </div>
        </Section>

        <Section title="Überzeugung & Disziplin">
          <Field label="Wie sicher warst du beim Einstieg?"><GradientSelector options={CONVICTION} value={t.conviction ?? null} onChange={(v) => setT((x) => ({ ...x, conviction: v }))} /></Field>
          <div className="grid gap-3.5 md:grid-cols-[auto_1fr]">
            <Field label="Plan befolgt?">
              <Segmented value={t.followedPlan == null ? null : t.followedPlan ? 'yes' : 'no'}
                onChange={(v) => setT((x) => ({ ...x, followedPlan: (x.followedPlan === true && v === 'yes') || (x.followedPlan === false && v === 'no') ? null : v === 'yes' }))}
                options={[{ v: 'yes', label: 'Ja' }, { v: 'no', label: 'Nein' }]} />
            </Field>
            <Field label="Gefühl beim Einstieg">
              <div className="flex flex-wrap gap-1.5">
                {EMOTIONS.map((e) => (
                  <button key={e} type="button" aria-pressed={t.emotion === e} onClick={() => setT((x) => ({ ...x, emotion: x.emotion === e ? '' : e }))}
                    className={cn('rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors', t.emotion === e ? 'border-white/60 bg-white/10 text-fg' : 'border-line-2 text-mute hover:text-fg')}>{e}</button>
                ))}
              </div>
            </Field>
          </div>
        </Section>

        <Section title="Review">
          <Field label="Learnings & Notizen" htmlFor="f-notes"><textarea id="f-notes" rows={3} className={cn(inputCls, 'resize-y leading-relaxed')} value={d.notes || ''} onChange={set('notes')} placeholder="Was lief gut, was mache ich nächstes Mal anders?" /></Field>
          <Field label="Chart-Link (TradingView)" htmlFor="f-chart"><input id="f-chart" type="url" className={inputCls} value={d.chart || ''} onChange={set('chart')} placeholder="https://www.tradingview.com/x/…" autoComplete="off" /></Field>
        </Section>
      </form>
    </Sheet>
  );
}

export function SetupSheet({ open, setup, settings, onClose, onSave, onDelete, usedBy, layoutId }:
  { layoutId?: string; open: boolean; setup: Setup | null; settings: Settings; onClose: () => void; onSave: (s: Setup) => Promise<void>; onDelete: (id: string) => Promise<void>; usedBy: number }) {
  const [s, setS] = useState<Setup>({ id: '', name: '', desc: '', color: SETUP_COLORS[0], account: 'both', checklist: [] });
  const [err, setErr] = useState('');
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErr(''); setArmed(false);
    if (setup) setS(JSON.parse(JSON.stringify(setup)));
    else {
      const used = new Set(settings.setups.map((x) => x.color));
      setS({ id: '', name: '', desc: '', color: SETUP_COLORS.find((c) => !used.has(c)) || SETUP_COLORS[0], account: 'both', checklist: [] });
    }
  }, [open, setup]);
  const upd = (patch: Partial<Setup>) => setS((x) => ({ ...x, ...patch }));
  async function submit() {
    if (!s.name.trim()) return setErr('Bitte einen Namen angeben.');
    const clean = { ...s, name: s.name.trim(), desc: s.desc.trim(), id: s.id || uid('s_'), checklist: s.checklist.filter((c) => c.text.trim()).map((c) => ({ ...c, text: c.text.trim() })) };
    try { await onSave(clean); onClose(); } catch { setErr('Speichern fehlgeschlagen.'); }
  }
  return (
    <Sheet layoutId={layoutId} open={open} onClose={onClose} wide={false} title={setup ? 'Grundlage bearbeiten' : 'Neue Entscheidungsgrundlage'}
      footer={<>
        {setup && (armed
          ? <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#ff8a90]">{usedBy ? `${usedBy} Trades verlieren die Zuordnung.` : 'Löschen?'}<Btn size="sm" variant="danger" onClick={async () => { try { await onDelete(setup.id); onClose(); } catch { setErr('Löschen fehlgeschlagen.'); } }}>Ja</Btn><Btn size="sm" onClick={() => setArmed(false)}>Nein</Btn></span>
          : <Btn variant="danger" onClick={() => setArmed(true)}>Löschen</Btn>)}
        <span className="flex-1" />
        {err && <span role="alert" className="text-[12.5px] font-medium text-[#ff8a90]">{err}</span>}
        <Btn onClick={onClose}>Abbrechen</Btn>
        <Btn variant="primary" onClick={submit}>Speichern</Btn>
      </>}>
      <div className="grid gap-4">
        <Field label="Name" htmlFor="sf-name"><input id="sf-name" className={inputCls} value={s.name} onChange={(e) => upd({ name: e.target.value })} placeholder="z. B. 4H-Breakout über 85.900" autoComplete="off" /></Field>
        <Field label="Konto"><Segmented value={s.account} onChange={(v) => upd({ account: v })} options={[{ v: 'makro', label: 'Makro' }, { v: 'scalp', label: 'Scalp' }, { v: 'both', label: 'Beide' }]} /></Field>
        <Field label="Regeln" htmlFor="sf-desc"><textarea id="sf-desc" rows={3} className={cn(inputCls, 'resize-y leading-relaxed')} value={s.desc} onChange={(e) => upd({ desc: e.target.value })} placeholder="Woran erkenne ich das Setup? Wo liegt der Stop? Was ist das Ziel?" /></Field>
        <Field label="Checkliste" help="Diese Punkte hakst du beim Eintragen eines Trades ab.">
          <div className="grid gap-2">
            {s.checklist.map((c, i) => (
              <div key={c.id} className="flex gap-2">
                <input className={inputCls} value={c.text} aria-label={`Punkt ${i + 1}`} onChange={(e) => upd({ checklist: s.checklist.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)) })} />
                <button type="button" aria-label="Punkt entfernen" onClick={() => upd({ checklist: s.checklist.filter((x) => x.id !== c.id) })} className="grid size-10 shrink-0 place-items-center rounded-xl border border-line-2 text-mute hover:text-loss [&>svg]:size-4">{Icon.x}</button>
              </div>
            ))}
            <Btn size="sm" className="justify-self-start" onClick={() => upd({ checklist: [...s.checklist, { id: uid('c'), text: '' }] })}>+ Punkt hinzufügen</Btn>
          </div>
        </Field>
        <Field label="Farbe">
          <div className="flex flex-wrap gap-2">
            {SETUP_COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Farbe ${c}`} aria-pressed={s.color === c} onClick={() => upd({ color: c })}
                className={cn('size-8 rounded-full border-2 transition-transform hover:scale-110', s.color === c ? 'border-fg' : 'border-transparent')} style={{ background: c, boxShadow: 'inset 0 0 0 2px #0d151f' }} />
            ))}
          </div>
        </Field>
        {setup && <Pill tone="mute" className="justify-self-start">In {usedBy} Trades verwendet</Pill>}
      </div>
    </Sheet>
  );
}
