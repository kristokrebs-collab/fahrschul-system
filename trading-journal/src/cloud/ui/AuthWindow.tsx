/**
 * The login window of Paket V as a 1:1 rebuild of the reference recording (`docs/audit/V-VORBILD.md` § 1): ONE landscape card
 * (1030 : 621) with a paper form half and a dark, slanted band that carries the brand text. Anmelden = form left, band right;
 * Registrieren = band left, form right. The switch runs the band once across the card (`authBand.ts`): under the fully dark card the
 * content swaps hard, the new brand text rises in, the form rows follow 45 ms apart, field 1 takes the focus at the swap, the button
 * comes last; the card keeps its height. Every other step (Passwort vergessen, Postfach, 2FA, …) shows in the form half of the side the
 * card is on, its rows coming in with the same stagger.
 *
 * Not in the recording (our own choices, quiet and short): the window's enter / exit (fade + 1.5 % scale, 200 / 140 ms), the round close
 * button above the card's corner (Escape and a click on the dim close too), the upright card on phones (band runs top → bottom).
 */
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useDialogBehaviour } from "@/motion/a11y";
import { useReducedFx } from "@/motion/useReducedFx";
import { cancelAll, settled } from "@/motion/waapi";
import type { AuthView } from "../types";
import { bandGeometry, enterBrand, enterColumn, runSwitch, sideOf, stepOf, type Orientation, type Side } from "./authBand";
import { AUTH } from "./strings";
import "@/styles/islands.css";
import "./authWindow.css";

/** True while the band runs: a second click on the switch link is ignored (the band runs exactly once). */
let running = false;
export const bandRunning = (): boolean => running;

const PORTRAIT_QUERY = "(max-width: 639px)";
function subscribeOrientation(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const mq = window.matchMedia(PORTRAIT_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const orientationNow = (): Orientation => (typeof window !== "undefined" && window.matchMedia?.(PORTRAIT_QUERY).matches ? "portrait" : "landscape");
export const useOrientation = (): Orientation => useSyncExternalStore(subscribeOrientation, orientationNow, () => "landscape");

interface Layout {
  open: boolean;
  view: AuthView;
  side: Side;
  /** The view each half shows (the half that is not on screen keeps its last view only while it leaves). */
  views: Record<Side, AuthView | null>;
  /** The half that is leaving during a band run (rendered until the run ends). */
  leaving: Side | null;
  /** The run has passed its swap: the leaving half is gone from sight and becomes inert. */
  swapped: boolean;
  /** Counts band runs and in-half step changes (the effects key on them). */
  runs: number;
  steps: number;
}

function fresh(view: AuthView): Layout {
  const side = sideOf(view, "a");
  return { open: true, view, side, views: { a: side === "a" ? view : null, b: side === "b" ? view : null }, leaving: null, swapped: false, runs: 0, steps: 0 };
}

export interface AuthWindowProps {
  open: boolean;
  view: AuthView;
  onClose: () => void;
  /** The form half's content for a view; `titleId` goes on its heading (the dialog's name). */
  renderView: (view: AuthView, titleId: string) => ReactNode;
  /**
   * Konto-Pflicht (`src/cloud/gate.ts`): the window IS the page in front of the app – no dim, no close button, Escape and the Android
   * back do nothing, no focus trap (the page's own links below the card stay reachable), not `aria-modal`. The card, the band and every
   * animation are the same.
   */
  gate?: boolean;
  /** Below the card (gate only): the page's links (Rechtliches, Verträge, Preise). */
  footer?: ReactNode;
  /** Above the card (gate only): the page's heading. */
  header?: ReactNode;
}

const focusFirst = (root: HTMLElement | null): void => {
  const el = root?.querySelector<HTMLElement>("[data-aw-first], input:not([type='hidden']):not([type='checkbox']):not([disabled]), button:not([disabled])");
  el?.focus({ preventScroll: true });
};

export function AuthWindow({ open, view, onClose, renderView, gate = false, footer, header }: AuthWindowProps) {
  const [l, setL] = useState<Layout>(() => fresh(view));
  // state from props: a new opening starts fresh; a view change either stays in its half (a step) or runs the band (a side change)
  if (open && !l.open) setL(fresh(view));
  else if (!open && l.open) setL({ ...l, open: false });
  else if (open && l.view !== view) {
    const side = sideOf(view, l.side);
    if (side !== l.side) setL({ ...l, view, side, views: { ...l.views, [side]: view }, leaving: l.side, swapped: false, runs: l.runs + 1 });
    else {
      const before = l.views[side];
      const step = before && stepOf(before) === stepOf(view) ? 0 : 1;
      setL({ ...l, view, views: { ...l.views, [side]: view }, steps: l.steps + step });
    }
  }

  const uid = useId();
  const titleId = useCallback((s: Side) => `${uid}-title-${s}`, [uid]);
  const reduced = useReducedFx();
  const orient = useOrientation();
  const g = bandGeometry(orient);
  const frame = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const cols = { a: useRef<HTMLDivElement>(null), b: useRef<HTMLDivElement>(null) };
  const brands = { a: useRef<HTMLDivElement>(null), b: useRef<HTMLDivElement>(null) };
  const anims = useRef<Animation[]>([]);

  useDialogBehaviour(frame, open && !gate, onClose);
  // the gate has no dialog session: field 1 takes the focus once at the opening (a dialog's session does that itself)
  useLayoutEffect(() => {
    if (open && gate) focusFirst(cols[l.side].current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only at the opening
  }, [open, gate]);

  // the band run (A ↔ B): started in the layout effect of the commit that changed the side, so the first painted frame already moves
  useLayoutEffect(() => {
    if (l.runs === 0 || !l.leaving) return;
    const to = l.side;
    const from = l.leaving;
    cancelAll(anims.current);
    running = true;
    const run = runSwitch(
      { band: band.current, inner: inner.current, oldBrand: brands[from].current, oldColumn: cols[from].current, newBrand: brands[to].current, newColumn: cols[to].current, height: card.current?.clientHeight ?? 621 },
      to,
      orient,
      reduced,
    );
    anims.current = run.anims;
    // field 1 takes the focus AT the swap (the caret already blinks while the band still covers the card); only then the old half turns
    // inert – earlier, the dialog's focus trap would pull the focus into the new half at the click already
    const runs0 = l.runs;
    const focusT = setTimeout(() => {
      focusFirst(cols[to].current);
      setL((s) => (s.runs === runs0 ? { ...s, swapped: true } : s));
    }, run.swap);
    const runs = l.runs;
    let alive = true;
    void settled(run.anims).then(() => {
      if (!alive) return;
      running = false;
      setL((s) => (s.runs === runs ? { ...s, leaving: null, views: { ...s.views, [from]: null } } : s));
    });
    return () => {
      alive = false;
      running = false;
      clearTimeout(focusT);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one run per side change (`runs`); refs and the rest are read at that moment
  }, [l.runs]);

  // a step inside the half (Passwort vergessen, Postfach, 2FA …): its rows come in with the switch's row stagger
  useLayoutEffect(() => {
    if (l.steps === 0) return;
    const col = cols[l.side].current;
    anims.current = [...anims.current, ...enterColumn(col, 0, card.current?.clientHeight ?? 621, reduced, "step")];
    if (!col?.contains(document.activeElement)) focusFirst(col);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one entrance per step change
  }, [l.steps]);

  // the window opens: the rows and the brand text come in once (not in the recording – the same stagger, quiet)
  useLayoutEffect(() => {
    if (!open) return;
    const h = card.current?.clientHeight ?? 621;
    anims.current = [...enterColumn(cols[l.side].current, 90, h, reduced, "open"), ...enterBrand(brands[l.side].current, 60, h, reduced)];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only at the opening
  }, [open]);

  const sides: Side[] = ["a", "b"];
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="aw"
          className="aw-overlay"
          data-layer="Anmelden"
          data-gate={gate ? "" : undefined}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.14 } }}
          transition={{ duration: reduced ? 0 : 0.2 }}
        >
          {!gate && <div className="aw-dim" aria-hidden="true" onClick={onClose} />}
          {gate && header}
          <motion.div
            ref={frame}
            role="dialog"
            aria-modal={gate ? undefined : "true"}
            aria-labelledby={titleId(l.side)}
            className="aw-frame"
            data-orient={orient}
            data-auth-view={l.view}
            initial={reduced ? false : { opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
            transition={{ duration: reduced ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div ref={card} className="aw-card tj-paper" data-orient={orient} data-side={l.side} data-testid="auth-card">
              {sides.map((s) => {
                const v = l.views[s];
                if (!v || (s !== l.side && l.leaving !== s)) return null;
                const leaving = s !== l.side;
                const gone = leaving && l.swapped;
                return (
                  <div key={s} ref={cols[s]} className="aw-col" data-side={s} data-leaving={leaving ? "" : undefined} inert={gone || undefined} aria-hidden={leaving || undefined}>
                    <div key={stepOf(v)} className="contents">
                      {renderView(v, titleId(s))}
                    </div>
                  </div>
                );
              })}
              <div ref={band} className="aw-band" data-testid="auth-band" style={{ ...g.band, transform: g.bandTransform[l.side] }}>
                <div className="aw-band-clip">
                  <div ref={inner} className="aw-band-inner tj-ink" data-theme-scope="dark" style={{ ...g.inner, transform: g.innerTransform[l.side] }}>
                    {sides.map((s) => {
                      const b = AUTH.card.brand[s];
                      const active = s === l.side;
                      return (
                        <div key={s} ref={brands[s]} className="aw-brand" data-side={s} data-active={active ? "true" : "false"} aria-hidden={active ? undefined : true} data-testid={`auth-brand-${s}`}>
                          <p className="aw-eyebrow" data-aw-brand-row="">
                            {b.eyebrow}
                          </p>
                          <p className="aw-headline" data-aw-brand-row="">
                            <span>{b.line1}</span>
                            <em>{b.line2}</em>
                          </p>
                          <p className="aw-brand-text" data-aw-brand-row="">
                            {b.text}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            {!gate && (
              <button type="button" className="aw-close" onClick={onClose} aria-label={AUTH.card.close}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </motion.div>
          {gate && footer}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
