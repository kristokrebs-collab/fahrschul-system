/**
 * The blade of the login card (Paket B, after the "Login & Signup" reference): switching between Anmelden and Registrieren
 * (and the link mode) is not a cut – one skewed band of glass sweeps ONCE across the whole card (brand strip + form), the
 * content changes BEHIND it, focus lands in the first field, nothing jumps (the card keeps one box; the band is a
 * transform-only overlay that leaves the layout alone).
 *
 * In our material: a dark glass band with a fine light edge on both sides instead of the reference's green/cream; the brand
 * strip carries OUR name in dot-matrix type and a one-line claim per mode. Red stays on the one primary button.
 *
 * - `BladeStage` wraps brand + card and offers `switchTo(view)`: it starts the blade, switches the view when the band covers
 *   the card (≈ 46 % of the sweep, `BLADE_MS` long in all), and ignores a second switch while one runs. Without motion
 *   (`useReducedFx`) there is no band: the view switches at once, the claim changes at once, nothing stays hidden.
 * - `useBlade()` is what the form calls (the mode switch and the "Neu hier? / Schon registriert?" link); `pending` is the mode
 *   the band is on its way to (the switch shows it at once, the content follows behind the band).
 * - Only `transform` moves (set per frame on one element). The band exists only during the sweep.
 */
import { animate } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useReducedFx } from "@/motion/useReducedFx";
import { setAuthView, useCloudSession } from "../session";
import type { AuthView } from "../types";
import { AUTH } from "./strings";

/** One sweep, start to end. */
export const BLADE_MS = 560;
/** The point of the sweep at which the card is covered and the view switches. */
export const BLADE_PEAK = 0.46;
/** The band's slant (deg) – the "schräge Kante" of the reference. */
const SKEW = -14;

export type BladeTarget = "signin" | "magic" | "signup";

interface BladeApi {
  switchTo: (view: BladeTarget, opts?: { focus?: boolean }) => void;
  /** The mode a running sweep is heading to, else `null`. */
  pending: BladeTarget | null;
}

const Ctx = createContext<BladeApi>({ switchTo: (v) => setAuthView(v), pending: null });
export const useBlade = (): BladeApi => useContext(Ctx);

export function BladeStage({ children }: { children: ReactNode }) {
  const reduced = useReducedFx();
  const root = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<BladeTarget | null>(null);
  const running = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controls = useRef<{ stop: () => void } | null>(null);

  // leaving the sheet mid-sweep: nothing keeps running
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (endTimer.current) clearTimeout(endTimer.current);
      controls.current?.stop();
    },
    [],
  );

  const focusFirst = useCallback(() => {
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('input[name="email"]')?.focus({ preventScroll: true }));
  }, []);

  const switchTo = useCallback(
    (view: BladeTarget, opts?: { focus?: boolean }) => {
      if (useCloudSession.getState().sheet.view === view) return;
      const stage = root.current;
      if (reduced || !stage || typeof requestAnimationFrame !== "function") {
        setAuthView(view);
        if (opts?.focus) focusFirst();
        return;
      }
      if (running.current) return; // one band at a time
      running.current = true;
      setPending(view);
      const w = stage.offsetWidth;
      const bw = w * 1.7;
      const from = -bw;
      const to = w + 260; // the slanted edge needs a margin to leave completely
      // the animation only draws; the TIMERS decide (a hidden tab pauses frames – the switch and the end must not wait for them)
      controls.current = animate(0, 1, {
        duration: BLADE_MS / 1000,
        ease: [0.65, 0, 0.35, 1],
        onUpdate: (p) => {
          if (band.current) band.current.style.transform = `translateX(${from + p * (to - from)}px) skewX(${SKEW}deg)`;
        },
      });
      timer.current = setTimeout(() => {
        setAuthView(view);
        if (opts?.focus) focusFirst();
      }, BLADE_MS * BLADE_PEAK);
      endTimer.current = setTimeout(() => {
        running.current = false;
        setPending(null);
      }, BLADE_MS + 40);
    },
    [reduced, focusFirst],
  );

  const api = useMemo<BladeApi>(() => ({ switchTo, pending }), [switchTo, pending]);
  return (
    <Ctx.Provider value={api}>
      {/* `-m-1 p-1`: the band is clipped sideways only, a focus ring at the edge stays whole */}
      <div ref={root} className="relative -m-1 grid gap-4 p-1" style={{ overflowX: "clip" }} data-testid="auth-stage" data-blade={pending ? "running" : undefined}>
        {children}
        {pending && (
          <div
            ref={band}
            aria-hidden="true"
            data-testid="auth-blade"
            className="pointer-events-none absolute inset-y-0 left-0 z-10"
            style={{
              width: "170%",
              // starts just off the card; the first frame of the sweep takes over
              transform: `translateX(-100%) skewX(${SKEW}deg)`,
              background:
                "linear-gradient(100deg, transparent 8%, color-mix(in srgb, var(--color-fg, #f2f2f2) 7%, transparent) 50%, transparent 92%), color-mix(in srgb, var(--color-ink-900, #0a0a0a) 95%, transparent)",
              boxShadow: "inset 2px 0 0 color-mix(in srgb, var(--color-fg, #f2f2f2) 38%, transparent), inset -2px 0 0 color-mix(in srgb, var(--color-fg, #f2f2f2) 20%, transparent)",
              // no `backdrop-filter`: at 95 % ink it would blur nothing anyone can see, but it makes the compositor re-render the card
              // under the band on every frame (costly without a GPU, and a stalled frame at the switch is exactly what must not happen)
              willChange: "transform",
            }}
          />
        )}
      </div>
    </Ctx.Provider>
  );
}

/**
 * The brand strip: our name in dot-matrix type and one line per step, on a glass strip whose lower edge is slanted (the
 * reference's diagonal, as a hint – the real diagonal is the blade). It stays on every step of the sheet (so the card never
 * changes its height by a strip that comes and goes) and is part of the card the blade covers: the claim changes behind the band.
 */
export function AuthBrand({ view }: { view: AuthView }) {
  const claim = AUTH.brand[view];
  if (!claim) return null;
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-line px-5 pb-9 pt-4"
      style={{
        clipPath: "polygon(0 0, 100% 0, 100% 74%, 0 100%)",
        // the slanted lower edge tucks under the form: 16 px of the former grid gap minus 22 px of overlap
        marginBottom: -6,
        background: "radial-gradient(circle, color-mix(in srgb, var(--color-fg, #f2f2f2) 9%, transparent) 1px, transparent 1.4px) 0 0 / 9px 9px, color-mix(in srgb, var(--color-ink-950, #040404) 70%, transparent)",
      }}
      data-testid="auth-brand"
      data-mode={view}
    >
      <span className="font-dot text-[12px] leading-none tracking-[0.12em] text-mute">{AUTH.brand.name}</span>
      <p className="mt-2 text-[22px] font-semibold leading-tight tracking-tight text-fg" data-testid="auth-brand-claim">
        {claim}
      </p>
    </div>
  );
}
