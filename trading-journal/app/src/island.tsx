// Dynamic Island (21st.dev · cult-ui) und Morphing Dialog (21st.dev · ibelick / motion-primitives),
// nach dem Original-Prinzip: eine schwarze Form federt zwischen Größen, der Inhalt blendet mit Scale + Blur über.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'motion/react';
import { cn, fmt, scenario, tDate, tone, type ETrade, type MarketState, type Settings } from './lib';
import { Btn } from './ui';

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 };

// ── Benachrichtigungen, die in der Island erscheinen ───
export type IslandNote = { id: number; kind: 'success' | 'error' | 'info' | 'signal'; title: string; value?: string; valueTone?: 'win' | 'loss' };
const NoteCtx = createContext<(n: Omit<IslandNote, 'id'>) => void>(() => {});
export const useIsland = () => useContext(NoteCtx);

export function IslandProvider({ children, market, settings, onNew, bind }: { children: ReactNode; market: MarketState; settings: Settings; onNew: () => void; bind?: (fn: (n: Omit<IslandNote, 'id'>) => void) => void }) {
  const [note, setNote] = useState<IslandNote | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const notify = useCallback((n: Omit<IslandNote, 'id'>) => {
    clearTimeout(timer.current);
    setNote({ ...n, id: Date.now() });
    timer.current = setTimeout(() => setNote(null), n.kind === 'signal' ? 5200 : 2800);
  }, []);
  useEffect(() => { bind?.(notify); }, [notify]);

  // Szenario-Wechsel melden (nicht beim ersten Laden)
  const sc = scenario(market.close4h, settings.market);
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!sc) return;
    if (lastKey.current && lastKey.current !== sc.key) notify({ kind: 'signal', title: `Neues Szenario: ${sc.title}`, value: `4H ${fmt.n0(market.close4h)}` });
    lastKey.current = sc.key;
  }, [sc?.key]);

  return (
    <NoteCtx.Provider value={notify}>
      {children}
      <Island market={market} settings={settings} note={note} onNew={onNew} dismiss={() => setNote(null)} />
    </NoteCtx.Provider>
  );
}

/** Meldungs-Pille: federt über dem Dock aus einem Punkt auf (Dynamic-Island-Prinzip), statt oben Platz zu belegen. */
function Island({ note, dismiss }: { market: MarketState; settings: Settings; note: IslandNote | null; onNew: () => void; dismiss: () => void }) {
  const reduce = useReducedMotion();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(92px+env(safe-area-inset-bottom,0px))] z-[56] flex justify-center px-4" aria-live="polite">
      <AnimatePresence>
        {note && (
          <motion.button key={note.id} type="button" onClick={dismiss}
            className="pointer-events-auto flex items-center gap-3 overflow-hidden border border-line-2 bg-ink-750/95 pl-2 pr-4 text-left shadow-[0_18px_40px_rgb(0_0_0/0.35)] backdrop-blur-xl"
            style={{ maxWidth: 'calc(100vw - 32px)' }}
            initial={{ width: 44, height: 44, borderRadius: 22, opacity: 0, y: 24, scale: 0.6 }}
            animate={{ width: 'auto', height: 50, borderRadius: 25, opacity: 1, y: 0, scale: 1 }}
            exit={{ width: 44, opacity: 0, y: 16, scale: 0.7, transition: { duration: 0.22 } }}
            transition={reduce ? { duration: 0 } : SPRING}>
            <span className={cn('grid size-8 shrink-0 place-items-center rounded-full',
              note.kind === 'success' ? 'bg-win/20 text-win' : note.kind === 'error' ? 'bg-loss/20 text-loss' : note.kind === 'signal' ? 'bg-steel/25 text-steel' : 'bg-white/10 text-fg')}>
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                {note.kind === 'success' ? <motion.path d="M3.5 8.5l3 3 6-7" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.15 }} />
                  : note.kind === 'error' ? <path d="M4 4l8 8M12 4l-8 8" /> : <path d="M8 3v6M8 12.5v.5" />}
              </svg>
            </span>
            <motion.span className="flex items-center gap-3 whitespace-nowrap" initial={{ opacity: 0, filter: 'blur(6px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ delay: 0.12 }}>
              <span className="text-[13px] font-medium text-fg">{note.title}</span>
              {note.value && <span className={cn('dot-num text-[15px]', note.valueTone === 'win' ? 'text-win' : note.valueTone === 'loss' ? 'text-loss' : 'text-mute')}>{note.value}</span>}
            </motion.span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Morphing Dialog: Trade-Schnellansicht ──────────────
export function TradeQuickView({ trade, settings, onClose, onEdit }: { trade: ETrade | null; settings: Settings; onClose: () => void; onEdit: (t: ETrade) => void }) {
  useEffect(() => {
    if (!trade) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [trade, onClose]);
  const setups = trade ? settings.setups.filter((s) => (trade.setups || []).includes(s.id)) : [];
  return (
    <MotionConfig transition={{ type: 'spring', bounce: 0.08, duration: 0.45 }}>{/* shared layout */}
      <AnimatePresence>
        {trade && (
          <>
            <motion.div key="bg" className="fixed inset-0 z-[58] bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
            <div key="wrap" className="pointer-events-none fixed inset-0 z-[59] grid place-items-center p-4">
              <motion.div layoutId={`trade-${trade.id}`} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} role="dialog" aria-modal="true" aria-label="Trade-Details"
                className="pointer-events-auto w-full max-w-[460px] overflow-hidden rounded-[28px] border border-line-2 bg-gradient-to-b from-ink-750 to-ink-850 shadow-[0_30px_80px_rgb(0_0_0/0.6)]">
                <div className="flex items-start justify-between gap-3 p-5 pb-3">
                  <div>
                    <motion.div layoutId={`trade-side-${trade.id}`} className={cn('font-mono text-xs font-semibold uppercase tracking-[0.12em]', trade.side === 'short' ? 'text-loss' : 'text-win')}>
                      {trade.side === 'short' ? '▼ Short' : '▲ Long'} · {trade.account === 'makro' ? 'Makro' : 'Scalp'}
                    </motion.div>
                    <div className="mt-1 text-[12px] text-mute">{fmt.date(tDate(trade))} {fmt.time(tDate(trade))}{trade.timeframe ? ` · ${trade.timeframe}` : ''} · {trade.pair}</div>
                  </div>
                  <motion.div layoutId={`trade-pnl-${trade.id}`} className={cn('dot-num text-[30px] leading-none', tone(trade.pnl))}>{trade.pnl == null ? 'offen' : fmt.signed(trade.pnl)}</motion.div>
                </div>
                <motion.div className="grid gap-4 px-5 pb-5" initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ delay: 0.12 }}>
                  <div className="grid grid-cols-4 gap-2">
                    {([['Einstieg', fmt.price(trade.entry)], ['Ausstieg', trade.result === 'open' ? '–' : fmt.price(trade.exit)], ['R', fmt.r(trade.r)], ['Bewegung', fmt.pct(trade.move)]] as const).map(([l, v]) => (
                      <div key={l} className="rounded-xl border border-line bg-ink-950/60 px-2.5 py-2"><div className="label !text-[9.5px]">{l}</div><div className="num mt-0.5 truncate font-mono text-[12.5px]">{v}</div></div>
                    ))}
                  </div>
                  {setups.length > 0 && <div className="flex flex-wrap gap-1.5">{setups.map((s) => <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-line-2 px-2.5 py-1 text-[11.5px]"><span className="size-1.5 rounded-full" style={{ background: s.color }} />{s.name}</span>)}</div>}
                  <div>
                    <div className="mb-1.5 flex justify-between text-[11.5px]"><span className="label">Checkliste</span><span className="font-mono text-mute">{trade.checked}/{trade.items.length}</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><motion.div className={cn('h-full rounded-full', trade.complete ? 'bg-win' : 'bg-white')} initial={{ width: 0 }} animate={{ width: `${trade.items.length ? (trade.checked / trade.items.length) * 100 : 0}%` }} transition={{ delay: 0.2, duration: 0.6 }} /></div>
                  </div>
                  {(trade.reason || trade.notes) && (
                    <div className="grid gap-2 text-[12.5px] leading-relaxed">
                      {trade.reason && <p><span className="label mr-2">Warum</span><span className="text-fg/85">{trade.reason}</span></p>}
                      {trade.notes && <p><span className="label mr-2">Learning</span><span className="text-fg/85">{trade.notes}</span></p>}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    {trade.chart ? <a href={trade.chart} target="_blank" rel="noreferrer" className="label !text-fg underline-offset-4 hover:underline">Chart öffnen ↗</a> : <span />}
                    <div className="flex gap-2"><Btn size="sm" onClick={onClose}>Schließen</Btn><Btn size="sm" variant="primary" onClick={() => onEdit(trade)}>Bearbeiten</Btn></div>
                  </div>
                </motion.div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

/** Progressive Blur (21st.dev · ibelick): gestaffelte Blur-Ebenen mit Masken, hinter dem Dock. */
export function ProgressiveBlur({ className }: { className?: string }) {
  const layers = 6;
  return (
    <div className={cn('pointer-events-none fixed inset-x-0 bottom-0 z-[45] h-32', className)} aria-hidden="true">
      {Array.from({ length: layers }, (_, i) => {
        const a = (i / layers) * 100, b = ((i + 1) / layers) * 100;
        return <div key={i} className="absolute inset-0" style={{
          backdropFilter: `blur(${i * 1.4}px)`, WebkitBackdropFilter: `blur(${i * 1.4}px)`,
          maskImage: `linear-gradient(to bottom, transparent ${Math.max(0, a - 16)}%, black ${a}%, black ${b}%, transparent ${Math.min(100, b + 16)}%)`,
          WebkitMaskImage: `linear-gradient(to bottom, transparent ${Math.max(0, a - 16)}%, black ${a}%, black ${b}%, transparent ${Math.min(100, b + 16)}%)`,
        }} />;
      })}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-ink-900/70" />
    </div>
  );
}
