import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TextRoll } from "@/motion/TextRoll";
import { dwell, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button, type ButtonProps } from "@/primitives/Button";

/**
 * Feedback building blocks of the settings page: an action's `idle → busy → done` phase, the glyph that shows it
 * (icon → spinner → drawn ✓), the morphing save button and the "changed" dot. Everything is transform/opacity.
 */

/** How long a finished action keeps showing its ✓ before returning to idle (`dwell.done`, in ms for the timers). */
export const DONE_HOLD_MS = dwell.done * 1000;

export type ActionPhase = "idle" | "busy" | "done";

/**
 * `run(fn)`: `busy` while `fn` runs, then `done` for `DONE_HOLD_MS` and back to `idle`. Resolves `true` on success;
 * a throw or an explicit `false` from `fn` (e.g. a download that could not start) returns straight to `idle` and
 * resolves `false`. Safe against unmounting mid-run.
 */
export function useActionPhase(holdMs = DONE_HOLD_MS): { phase: ActionPhase; run: (fn: () => unknown) => Promise<boolean> } {
  const [phase, setPhase] = useState<ActionPhase>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const run = useCallback(
    async (fn: () => unknown) => {
      clearTimeout(timer.current);
      setPhase("busy");
      let ok: boolean;
      try {
        ok = (await fn()) !== false;
      } catch {
        ok = false;
      }
      if (!alive.current) return ok;
      setPhase(ok ? "done" : "idle");
      if (ok) timer.current = setTimeout(() => alive.current && setPhase("idle"), holdMs);
      return ok;
    },
    [holdMs],
  );
  return { phase, run };
}

const GLYPH_IN = { opacity: 0, scale: 0.6 };
const GLYPH_SHOWN = { opacity: 1, scale: 1 };

/** 14 px spinner: a faint track and a quarter arc, rotated by the CSS `animate-spin` loop (compositor). */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-3.5 animate-spin", className)} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="8" cy="8" r="6" strokeOpacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" strokeLinecap="round" />
    </svg>
  );
}

/** 14 px check, drawn on `tween.check`. */
export function DrawnCheck({ className }: { className?: string }) {
  const reduced = useReducedFx();
  return (
    <svg viewBox="0 0 16 16" className={cn("size-3.5", className)} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <motion.path d="M3.5 8.5l3 3 6-7" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={tween.check} />
    </svg>
  );
}

/**
 * The phase as a 14 px glyph: `icon` (or nothing) while idle, a spinner while busy (`spinIcon`: the icon itself
 * spins instead), a drawn ✓ when done. Glyphs swap in place with a pop (`spring.pop`), so the label never moves.
 */
export function PhaseGlyph({ phase, icon, spinIcon = false, className }: { phase: ActionPhase; icon?: ReactNode; spinIcon?: boolean; className?: string }) {
  const reduced = useReducedFx();
  let glyph: ReactNode = null;
  if (phase === "done") glyph = <DrawnCheck />;
  else if (phase === "busy") glyph = spinIcon && icon ? <span className="grid size-3.5 animate-spin place-items-center [&>svg]:size-full">{icon}</span> : <Spinner />;
  else if (icon) glyph = <span className="grid size-3.5 place-items-center [&>svg]:size-full">{icon}</span>;
  return (
    <span aria-hidden="true" className={cn("relative grid size-3.5 shrink-0 place-items-center", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        {glyph && (
          <motion.span
            key={phase === "busy" && spinIcon ? "idle" : phase}
            className="col-start-1 row-start-1 grid place-items-center"
            initial={reduced ? false : GLYPH_IN}
            animate={GLYPH_SHOWN}
            exit={{ ...GLYPH_IN, transition: tween.exit }}
            transition={{ default: tween.fade, scale: spring.pop }}
          >
            {glyph}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

export interface ActionButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  children: ReactNode;
  /** Leading icon (16 px viewBox, `currentColor`). */
  icon?: ReactNode;
  /** The icon itself spins while busy (refresh) instead of being swapped for the spinner. */
  spinIcon?: boolean;
  /** The action; its promise drives the phase (`false` = could not run → no ✓). */
  onRun?: () => unknown;
}

/** Button with a phase glyph: icon → spinner → ✓ (`DONE_HOLD_MS`), label unchanged (stable accessible name). */
export function ActionButton({ children, icon, spinIcon, onRun, disabled, ...rest }: ActionButtonProps) {
  const { phase, run } = useActionPhase();
  return (
    <Button {...rest} disabled={disabled || !onRun || phase === "busy"} aria-busy={phase === "busy" || undefined} onClick={() => onRun && void run(onRun)}>
      <PhaseGlyph phase={phase} icon={icon} spinIcon={spinIcon} className={cn(phase === "done" && "text-win")} />
      {children}
    </Button>
  );
}

export const SAVE_LABELS: Record<ActionPhase, string> = { idle: "Speichern", busy: "Speichert …", done: "Gespeichert" };

export interface SaveButtonProps extends Omit<ButtonProps, "children" | "variant"> {
  phase: ActionPhase;
}

/**
 * Save button (21st.dev "Interactive Hover Button" state morph): `Speichern` → spinner + `Speichert …` → drawn ✓ +
 * `Gespeichert` on a win wash for `DONE_HOLD_MS` → back. Letters morph (`TextRoll`), the glyph sits left of the
 * centred label so nothing shifts, and the width is fixed to the longest state – no layout animation needed.
 * The accessible name is exactly the current label (`Speichern` when idle).
 */
export function SaveButton({ phase, className, disabled, ...rest }: SaveButtonProps) {
  const reduced = useReducedFx();
  return (
    <Button {...rest} variant="primary" disabled={disabled || phase === "busy"} aria-busy={phase === "busy" || undefined} className={cn("min-w-[9.5rem]", className)}>
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] bg-win"
        initial={false}
        animate={{ opacity: phase === "done" ? 1 : 0 }}
        transition={reduced ? { duration: 0 } : tween.crossfade}
      />
      <span className="relative inline-flex items-center">
        <PhaseGlyph phase={phase} className="absolute right-full mr-2" />
        <TextRoll text={SAVE_LABELS[phase]} />
      </span>
    </Button>
  );
}

/** Small signal dot that pops in next to a label whose value differs from the saved settings. */
export function ChangedDot({ show }: { show: boolean }) {
  const reduced = useReducedFx();
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span
          key="dot"
          aria-hidden="true"
          title="Ungespeichert"
          className="ml-1.5 inline-block size-1.5 rounded-full bg-signal align-middle"
          initial={reduced ? false : { scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0, transition: tween.exit }}
          transition={spring.pop}
        />
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ icons (16 px, currentColor) */

const ICON = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export function GlyphRefresh() {
  return (
    <svg {...ICON}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2.5v3h-3" />
    </svg>
  );
}

export function GlyphLink() {
  return (
    <svg {...ICON}>
      <path d="M6.5 9.5l3-3" />
      <path d="M7.2 4.3l.9-.9a2.8 2.8 0 0 1 4 4l-.9.9" />
      <path d="M8.8 11.7l-.9.9a2.8 2.8 0 0 1-4-4l.9-.9" />
    </svg>
  );
}

export function GlyphTrash() {
  return (
    <svg {...ICON}>
      <path d="M3 4.5h10" />
      <path d="M6.5 4.5V3h3v1.5" />
      <path d="M4.5 4.5l.6 8.5h5.8l.6-8.5" />
    </svg>
  );
}

export function GlyphDownload() {
  return (
    <svg {...ICON}>
      <path d="M8 2.5v7.5" />
      <path d="M5 7l3 3 3-3" />
      <path d="M3 12.5h10" />
    </svg>
  );
}
