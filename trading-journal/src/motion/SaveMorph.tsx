import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { dwell, radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * Speicher-Morph (R11, A5 "Interaktionen") – for every save EXCEPT the trade editor's own flow (that keeps its form and
 * animation): settings, risk values, a day note, the account's privacy choices, the drawings of a trade.
 *
 * The rule it enforces: a ✓ is shown only after the PROMISE of the store / server resolved – never because a button was
 * clicked. A rejection (or `false`) shows an honest failed state with „Erneut versuchen“, which runs the same save again,
 * built fresh from the current state. The condensed „Speichert …“ stays at least `dwell.saveMin`, so a fast local write
 * does not flash.
 */

export type SavePhase = "idle" | "dirty" | "saving" | "saved" | "failed";

export interface SaveMorphState {
  phase: SavePhase;
  /** Why the last save failed (the message of the rejection), or `null`. */
  error: string | null;
  /**
   * Runs a save: `saving` while `factory()` works, `saved` when it resolved (not `false`), `failed` when it threw / resolved
   * `false`. `factory` is called again by `retry` – build the write from the CURRENT state inside it. Resolves `true` on success.
   */
  run: (factory: () => Promise<unknown> | unknown) => Promise<boolean>;
  /** Runs the last `factory` again (the badge's „Erneut versuchen“). */
  retry: () => Promise<boolean>;
  /** Back to `idle` (or `dirty`) without saving. */
  reset: (to?: "idle" | "dirty") => void;
  /** Marks unsaved edits (`dirty`); a running save keeps its `saving`. */
  markDirty: () => void;
}

export interface SaveMorphOptions {
  /** How long `saved` stays before it returns to `idle` (ms). `0`: stays until the next change. Default `dwell.done`. */
  hold?: number;
  /** Shortest time the `saving` state is shown (ms). Default `dwell.saveMin`. */
  min?: number;
}

export function useSaveMorph({ hold = dwell.done * 1000, min = dwell.saveMin * 1000 }: SaveMorphOptions = {}): SaveMorphState {
  const [phase, setPhase] = useState<SavePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const last = useRef<(() => Promise<unknown> | unknown) | null>(null);
  const seq = useRef(0);
  const alive = useRef(true);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(holdTimer.current);
    };
  }, []);

  const run = useCallback(
    async (factory: () => Promise<unknown> | unknown): Promise<boolean> => {
      last.current = factory;
      const mine = ++seq.current;
      clearTimeout(holdTimer.current);
      busy.current = true;
      setPhase("saving");
      setError(null);
      const t0 = Date.now();
      let ok = true;
      let message: string | null = null;
      try {
        ok = (await factory()) !== false;
      } catch (e) {
        ok = false;
        message = e instanceof Error && e.message ? e.message : null;
      }
      // the answer goes to the caller at once; only the picture waits, so a fast local write does not flash the condensed state
      const flip = (): void => {
        if (mine === seq.current) busy.current = false;
        // a newer save owns the state now; an unmounted host shows nothing
        if (!alive.current || mine !== seq.current) return;
        setPhase(ok ? "saved" : "failed");
        setError(ok ? null : message);
        if (ok && hold > 0) holdTimer.current = setTimeout(() => alive.current && mine === seq.current && setPhase("idle"), hold);
      };
      const rest = min - (Date.now() - t0);
      if (rest > 0) holdTimer.current = setTimeout(flip, rest);
      else flip();
      return ok;
    },
    [hold, min],
  );

  const retry = useCallback(async (): Promise<boolean> => (last.current ? run(last.current) : false), [run]);

  const reset = useCallback((to: "idle" | "dirty" = "idle") => {
    clearTimeout(holdTimer.current);
    seq.current += 1;
    busy.current = false;
    setError(null);
    setPhase(to);
  }, []);

  const markDirty = useCallback(() => {
    if (busy.current) return;
    clearTimeout(holdTimer.current);
    setPhase((p) => (p === "saving" ? p : "dirty"));
  }, []);

  return { phase, error, run, retry, reset, markDirty };
}

/* ------------------------------------------------------------------------------------------------ badge */

const TONE: Record<Exclude<SavePhase, "idle">, string> = {
  dirty: "border-line-2 bg-white/[0.04] text-mute",
  saving: "border-line-2 bg-white/[0.04] text-mute",
  saved: "border-win/25 bg-win/12 text-win",
  failed: "border-loss/30 bg-loss/12 text-(--color-danger-text)",
};

export interface SaveBadgeLabels {
  dirty?: string;
  saving?: string;
  saved?: string;
  failed?: string;
  retry?: string;
}
export const SAVE_LABELS_DE: Required<SaveBadgeLabels> = { dirty: "Ungespeichert …", saving: "Speichert …", saved: "Gespeichert", failed: "Nicht gespeichert", retry: "Erneut versuchen" };

/**
 * The sentence a screen reader gets for a phase (`failed` carries the reason when there is one). Deliberately NOT the words of
 * the visible pill: the pill is `aria-hidden`, the live region says the same thing once, in its own words.
 */
export function saveSentence(phase: SavePhase, error: string | null, labels: SaveBadgeLabels = {}): string {
  const retry = labels.retry ?? SAVE_LABELS_DE.retry;
  switch (phase) {
    case "dirty":
      return "Änderungen noch nicht übernommen.";
    case "saving":
      return "Speichern läuft.";
    case "saved":
      return "Speichern abgeschlossen.";
    case "failed":
      return `Speichern fehlgeschlagen${error ? `: ${error}` : ""}. ${retry} mit der Schaltfläche.`;
    default:
      return "";
  }
}

function Glyph({ phase }: { phase: Exclude<SavePhase, "idle" | "dirty"> }) {
  const reduced = useReducedFx();
  if (phase === "saving")
    return (
      <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 motion-safe:animate-spin" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="8" cy="8" r="6" strokeOpacity="0.25" />
        <path d="M8 2a6 6 0 0 1 6 6" strokeLinecap="round" />
      </svg>
    );
  if (phase === "saved")
    return (
      <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <motion.path d="M3.5 8.5l3 3 6-7" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={tween.check} />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3.5v5.2M8 11.6v.1" />
    </svg>
  );
}

export interface SaveBadgeProps extends SaveBadgeLabels {
  phase: SavePhase;
  error?: string | null;
  /** „Erneut versuchen“ – shown in the failed state only. */
  onRetry?: () => void;
  /** Test hook of the pill (the saved state keeps whatever id a spec already knows). */
  testId?: string;
  className?: string;
  /** Show the `dirty` state („Ungespeichert …“). Default false: dirty is quiet. */
  showDirty?: boolean;
}

/**
 * The state of a save as a small pill that grows out of nothing: `Speichert …` (condensed, spinner) → `Gespeichert` (a ✓ that
 * draws itself, green) → gone after `hold`; or `Nicht gespeichert` + „Erneut versuchen“ (red, stays). ONE layout spring
 * (`spring.pill`), the words cross-fade; the slot is a fixed 28 px high box, so the surroundings never move vertically. A
 * polite live region says each state once. Reduced motion: no growth, instant swaps.
 */
export function SaveBadge({ phase, error = null, onRetry, testId, className, showDirty = false, ...labels }: SaveBadgeProps) {
  const reduced = useReducedFx();
  const l = { ...SAVE_LABELS_DE, ...labels };
  const shown = phase === "idle" || (phase === "dirty" && !showDirty) ? null : phase;
  const text = shown === "dirty" ? l.dirty : shown === "saving" ? l.saving : shown === "saved" ? l.saved : shown === "failed" ? l.failed : "";
  return (
    <span className={cn("inline-flex h-7 min-w-0 items-center justify-end", className)} data-save-phase={phase} data-testid={testId ? `${testId}-slot` : undefined}>
      <span role="status" aria-live="polite" className="sr-only" data-testid={testId ? `${testId}-live` : undefined}>
        {saveSentence(phase === "dirty" && !showDirty ? "idle" : phase, error, labels)}
      </span>
      <AnimatePresence initial={false} mode="popLayout">
        {shown && (
          <motion.span
            key={shown === "failed" ? "failed" : "pill"}
            layout
            style={{ borderRadius: radius.pill }}
            data-save-pill={shown}
            data-testid={testId ? (shown === "saved" ? testId : shown === "failed" ? `${testId}-failed` : undefined) : undefined}
            className={cn("relative inline-flex h-7 max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap border pl-2.5 text-[11px] font-semibold", shown === "failed" ? "pr-1" : "pr-3", TONE[shown])}
            initial={reduced ? false : { opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1, transitionEnd: { transform: "none" } }}
            exit={{ opacity: 0, transition: tween.exit }}
            transition={{ layout: spring.pill, scale: spring.pop, opacity: tween.fade }}
          >
            {shown !== "dirty" && <Glyph phase={shown} />}
            <motion.span layout="position" aria-hidden="true" className="truncate" transition={{ layout: spring.pill }}>
              {text}
            </motion.span>
            {shown === "failed" && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                data-testid={testId ? `${testId}-retry` : undefined}
                className="touch-hit -my-1 min-h-7 shrink-0 rounded-full bg-white/[0.08] px-2.5 text-[11px] font-semibold text-fg transition-colors hover:bg-white/[0.14] focus-visible:outline-none focus-visible:shadow-(--ring-glow-btn)"
              >
                {l.retry}
              </button>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------ surface */

/**
 * The card around the saved values „verdichtet“ while the save runs (a hair smaller and quieter: `scale .994`, `opacity .9`) and
 * settles back with one small pop when it is saved – transform / opacity only. A failed save releases it at once. The content
 * stays interactive (no `inert`: the trader keeps the focus in the field he was in). Reduced motion: unchanged.
 */
export function SaveSurface({ phase, children, className }: { phase: SavePhase; children: ReactNode; className?: string }) {
  const reduced = useReducedFx();
  const saving = phase === "saving";
  return (
    <motion.div
      className={className}
      data-save-surface={saving ? "saving" : undefined}
      aria-busy={saving || undefined}
      initial={false}
      animate={reduced ? undefined : { scale: saving ? 0.994 : 1, opacity: saving ? 0.9 : 1, transitionEnd: saving ? undefined : { transform: "none" } }}
      transition={saving ? { scale: spring.smooth, opacity: tween.fade } : { scale: spring.pop, opacity: tween.fade }}
    >
      {children}
    </motion.div>
  );
}
