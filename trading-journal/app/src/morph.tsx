// Morph-Detailkarten (Prinzip: 21st.dev · ibelick Morphing Dialog). Ein Auslöser und die große Karte
// teilen sich eine layoutId; beim Öffnen fließt die Form von der Kachel in die Bildmitte und zurück.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { cn } from './lib';

type Open = { id: string; title: string; body: ReactNode } | null;
const Ctx = createContext<{ open: Open; show: (o: NonNullable<Open>) => void; close: () => void }>({ open: null, show: () => {}, close: () => {} });
export const useMorph = () => useContext(Ctx);
const T = { type: 'spring' as const, stiffness: 340, damping: 34, mass: 0.9 };

export function MorphProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open>(null);
  const close = useCallback(() => setOpen(null), []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [open, close]);
  return (
    <Ctx.Provider value={{ open, show: setOpen, close }}>
      <MotionConfig transition={T}>
        {children}
        <AnimatePresence>
          {open && (
            <>
              <motion.div key="bg" className="fixed inset-0 z-[70] bg-ink-950/55 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
              <div key="wrap" className="pointer-events-none fixed inset-0 z-[71] grid place-items-center p-4">
                <motion.div layoutId={`morph-${open.id}`} role="dialog" aria-modal="true" aria-label={open.title}
                  className="pointer-events-auto relative max-h-[86vh] w-full max-w-[620px] overflow-y-auto border border-line-2 bg-gradient-to-b from-ink-750 to-ink-800 shadow-[0_40px_90px_rgb(0_0_0/0.45)]"
                  style={{ borderRadius: 28 }}>
                  <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-gradient-to-b from-ink-750 via-ink-750/95 to-transparent px-6 pb-3 pt-5">
                    <motion.h2 layoutId={`morph-title-${open.id}`} className="label !text-fg flex items-center gap-2"><span className="size-1.5 rounded-full bg-signal" />{open.title}</motion.h2>
                    <button type="button" onClick={close} aria-label="Schließen" className="grid size-8 place-items-center rounded-full border border-line-2 text-mute transition-colors hover:text-fg">
                      <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 2l8 8M10 2 2 10" /></svg>
                    </button>
                  </div>
                  <motion.div className="px-6 pb-6" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ delay: 0.12, duration: 0.25 }}>
                    {open.body}
                  </motion.div>
                </motion.div>
              </div>
            </>
          )}
        </AnimatePresence>
      </MotionConfig>
    </Ctx.Provider>
  );
}

/** Auslöser: Kachel/Zeile, die beim Klick in die Detailkarte morpht. */
export function Morph({ id, title, body, children, className, as = 'button' }: { id: string; title: string; body: () => ReactNode; children: ReactNode; className?: string; as?: 'button' | 'div' }) {
  const { open, show } = useMorph();
  const active = open?.id === id;
  const C = as === 'button' ? motion.button : motion.div;
  return (
    <C layoutId={`morph-${id}`} layoutDependency={active} {...(as === 'button' ? { type: 'button' } : { role: 'button', tabIndex: 0 })}
      onClick={() => show({ id, title, body: body() })}
      onKeyDown={as === 'div' ? (e: any) => { if (e.key === 'Enter') show({ id, title, body: body() }); } : undefined}
      aria-haspopup="dialog"
      className={cn('group relative block w-full text-left', active && 'opacity-0', className)} style={{ borderRadius: 16 }}>
      {children}
    </C>
  );
}
