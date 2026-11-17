import { motion, useTransform } from "motion/react";
import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { springCurve } from "@/app/cssEasing";
import { cn } from "@/lib/cn";
import { useHoldPress } from "@/motion/HoldButton";
import { HOLD_CONFIRM_TITLE } from "@/motion/HoldConfirm";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { binEat as B, binFullAt } from "@/motion/vorbild2";

/** Where a run of the delete pill stands: at rest, eating the word, spinning while the real deletion runs, closing the ring (done), going back to the pill. */
export type BinPhase = "idle" | "eat" | "spin" | "done" | "back";

export const BIN_STRINGS = { busy: "Wird gelöscht …", done: "Gelöscht", failed: "Löschen fehlgeschlagen" } as const;

export interface BinDeleteControl {
  /** Starts the run – call it ONLY once the deletion was confirmed (a completed hold, „Ja, löschen“). */
  start: () => void;
  /** Runs since the hook was created (a new start bumps it; the pill plays when it sees a new one). */
  run: number;
  /** The real deletion, at most once per run; the pill calls it when its spinner starts (or at once, should it be gone). */
  perform: () => Promise<unknown>;
  /** After the ring closed (the caller closes the dialog, says „gelöscht“ …). */
  finish: () => void;
  /** The deletion threw: the pill went back, the caller says why. */
  fail: (e: unknown) => void;
  /** A run is going on (confirmed, not yet answered). */
  busy: boolean;
  /** What the last run threw (cleared by the next start). */
  error: unknown;
}

/**
 * The run of a delete pill (Runde 13, reference „The Bin Eats The Label“): owns the REAL deletion, so it happens even when the pill is gone
 * before its spinner (the dialog was closed meanwhile). `remove` is the caller's deletion (its promise is what the spinner shows – never a
 * fake success); `done` runs after the ring closed, `failed` when `remove` threw (the pill is back by then; `error` holds it until the next
 * start, the caller shows the message). One run at a time; `finish` / `fail` count once per run.
 */
export function useBinDelete(remove: () => Promise<unknown>, { done, failed }: { done?: () => void; failed?: (e: unknown) => void } = {}): BinDeleteControl {
  const [run, setRun] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fns = useRef({ remove, done, failed });
  const st = useRef({ on: false, running: null as Promise<unknown> | null });
  useEffect(() => {
    fns.current = { remove, done, failed };
  }, [remove, done, failed]);
  const start = useCallback(() => {
    if (st.current.on) return;
    st.current.on = true;
    setError(null);
    setBusy(true);
    setRun((r) => r + 1);
  }, []);
  const perform = useCallback(() => {
    // only inside a confirmed run (a pill that leaves after its run ended must not delete again)
    if (!st.current.on) return Promise.resolve();
    st.current.running ??= Promise.resolve().then(() => fns.current.remove());
    return st.current.running;
  }, []);
  const end = useCallback((e?: unknown) => {
    if (!st.current.on) return;
    st.current = { on: false, running: null };
    setBusy(false);
    if (e === undefined) fns.current.done?.();
    else {
      setError(e ?? new Error("failed"));
      fns.current.failed?.(e);
    }
  }, []);
  const finish = useCallback(() => end(), [end]);
  const fail = useCallback((e: unknown) => end(e ?? new Error("failed")), [end]);
  return { start, run, perform, finish, fail, busy, error };
}

/**
 * Keeps showing the item a delete pill is removing while its run goes on: the store drops it at the spinner, the pill still has its ring to
 * close. `value` is what the store has now; `keep` = a run is going on for THIS item.
 */
export function useKept<T>(value: T | undefined, keep: boolean): T | undefined {
  const [kept, setKept] = useState(value);
  if (value !== undefined && value !== kept) setKept(value);
  return value ?? (keep ? kept : undefined);
}

export interface BinDeleteProps {
  /** The word („Löschen“): the visible label, split into letters for the bin, and the accessible name. */
  children: string;
  bin: BinDeleteControl;
  /** A tap, a quick key press or an activation without a hold: ask first (the caller's inline confirmation). */
  onAsk: () => void;
  /** A completed hold (the hold IS the confirmation): default `bin.start`. A caller that must still ask (a setup in use) passes its own. */
  onHold?: () => void;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  title?: string;
  ref?: Ref<HTMLButtonElement>;
  "data-testid"?: string;
}

const PAD = { md: { h: 36, l: 13, gap: 9, r: 15, icon: 15, text: "text-[13px]" }, sm: { h: 30, l: 11, gap: 7, r: 12, icon: 13, text: "text-xs" } } as const;
const FACE = "linear-gradient(135deg, color-mix(in srgb, var(--color-danger) 92%, #000), color-mix(in srgb, var(--color-danger) 60%, #000))";
const lidCurve = springCurve({ stiffness: B.lid.stiffness, damping: B.lid.damping, mass: B.lid.mass });
const css = (c: readonly number[]) => `cubic-bezier(${c.join(", ")})`;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** the bin's inside (its open top and the narrower foot) in the icon's 20 × 24 box */
const BODY = "M4 8.5l1.4 12.6a1.6 1.6 0 0 0 1.6 1.4h6a1.6 1.6 0 0 0 1.6-1.4L16 8.5";
const INSIDE_TOP = 9;
const INSIDE_H = 13;

/**
 * The delete pill of the reference „Delete Button – The Bin Eats The Label“, rebuilt 1:1 (timings, curves and proportions measured frame by
 * frame, `motion/vorbild2.ts`), with OUR safety rule in front of it: the pill is a `HoldConfirm` – holding it confirms, a tap asks inline – and
 * the bin eats only AFTER the confirmation (`bin.start`).
 *
 * The run: the pill dips (0.973 → 1.02 → 1); the lid opens 40°, the bin tilts 14° towards the word; the letters jiggle, then leave one every
 * 85 ms on an arc (cut at the pill's top edge) and fall into the bin, which fills one step per letter; the pill turns into a disc about its
 * centre (250 ms, strong ease-out), the lid shuts, the shadow stays behind and fades; a spinner arc (100°, Ø 1.17 × the disc, 800 ms a turn)
 * runs while the REAL deletion runs (at least 415 ms, never a fake success). Done: the bin empties and the arc's head sprints round until the
 * ring is closed – then the caller closes its dialog. Failure: the disc grows back into the pill, the ring fades, the word fades in where it
 * was; the caller says why.
 *
 * Every step is a Web Animation (transform / opacity / clip-path; the arc's dash on a small SVG) – `document.getAnimations()` lists them. The
 * button never changes its box (the disc is a clip of the face). Reduced motion: the word fades, the spinner shows without the eating, the
 * result is the closed ring or the word back.
 */
export function BinDelete({ children, bin, onAsk, onHold, size = "md", disabled, className, title = HOLD_CONFIRM_TITLE, ref, ...rest }: BinDeleteProps) {
  const reducedFx = useReducedFx();
  // without Web Animations nothing of the run would show: it plays as under reduced motion (no waiting for moves nobody sees)
  const reduced = reducedFx || typeof Element === "undefined" || typeof Element.prototype.animate !== "function";
  const btn = useRef<HTMLButtonElement>(null);
  const face = useRef<HTMLSpanElement>(null);
  const body = useRef<HTMLSpanElement>(null);
  const icon = useRef<HTMLSpanElement>(null);
  const lid = useRef<SVGGElement>(null);
  const can = useRef<SVGGElement>(null);
  const fill = useRef<SVGRectElement>(null);
  const shadow = useRef<HTMLSpanElement>(null);
  const word = useRef<HTMLSpanElement>(null);
  const ring = useRef<SVGSVGElement>(null);
  const arc = useRef<SVGCircleElement>(null);
  const [phase, setPhase] = useState<BinPhase>("idle");
  const [said, setSaid] = useState("");
  useImperativeHandle(ref, () => btn.current as HTMLButtonElement, []);
  const busy = phase !== "idle";
  const hold = useHoldPress({
    onConfirm: () => (onHold ?? bin.start)(),
    onRelease: (completed) => {
      if (!completed) onAsk();
    },
    disabled: disabled || busy,
    duration: tween.hold.duration,
    fallback: false,
    reduced,
    btnRef: btn,
    doneFor: 0,
  });
  const scale = useTransform(hold.progress, [0, 1], [1, 0.97]);
  const letters = Array.from(children);
  const dim = PAD[size];
  const clipId = `bin-in${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  // the disc is as tall as the pill really is (44 px on a touch screen): the ring is sized from the measured height
  const [ph, setPh] = useState<number>(dim.h);
  useLayoutEffect(() => {
    const h = btn.current?.offsetHeight;
    if (h) setPh(h);
  }, [size]);

  // a new run: play it (the pill may mount a moment after the confirmation – the inline question leaves first, so a pill that mounts while a
  // run is going on plays it too)
  const played = useRef(bin.busy ? bin.run - 1 : bin.run);
  // a pill that mounts while its run is pending (it comes back after the inline question left) first finishes its own entrance (`tween.fade`)
  const entering = useRef(bin.busy);
  const ctl = useRef(bin);
  useEffect(() => {
    ctl.current = bin;
  });
  useEffect(() => {
    if (bin.run === played.current) return;
    played.current = bin.run;
    let alive = true;
    const anims: Animation[] = [];
    const timers: number[] = [];
    const a = (el: Element | null | undefined, k: Keyframe[], o: KeyframeAnimationOptions) => {
      if (!el || typeof el.animate !== "function") return null;
      const x = el.animate(k, { fill: "forwards", ...o });
      anims.push(x);
      return x;
    };
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const perform = () => ctl.current.perform();

    const playRun = async () => {
      if (entering.current && !reduced) await wait(tween.fade.duration * 1000);
      entering.current = false;
      if (!alive) return;
      const f = face.current;
      const W = f?.offsetWidth ?? 0;
      const H = f?.offsetHeight ?? dim.h;
      const d = Math.max(0, (W - H) / 2);
      const ic = icon.current;
      const binX = ic ? ic.offsetLeft + ic.offsetWidth / 2 : 0;
      const binTop = ic ? ic.offsetTop : 0;
      const ih = ic?.offsetHeight ?? dim.icon;
      const n = letters.length;
      const spans = Array.from(word.current?.children ?? []) as HTMLElement[];
      setPhase("eat");
      setSaid(BIN_STRINGS.busy);
      let spinAt = 0;
      if (reduced) {
        a(word.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 120 });
      } else {
        // press: dip and spring back over 1.02
        a(body.current, B.press.keys.map((s) => ({ transform: `scale(${s})` })), { duration: B.press.duration, easing: "ease-out" });
        // lid opens 40° counter-clockwise about its left end, the bin tilts 14° towards the word
        a(lid.current, [{ transform: "rotate(0deg)" }, { transform: `rotate(${B.lidDeg}deg)` }], { duration: lidCurve.ms, delay: B.lidAt, easing: lidCurve.easing });
        a(can.current, [{ transform: "rotate(0deg)" }, { transform: `rotate(${B.tiltDeg}deg)` }], { duration: lidCurve.ms, delay: B.lidAt, easing: lidCurve.easing });
        // the letters: a jiggle each with its own phase, then the flight into the bin (one every 85 ms), one fill step per landing
        spans.forEach((sp, k) => {
          const sx = (k % 2 ? -1 : 1) * B.jiggle.x;
          const jig = a(
            sp,
            [
              { transform: "translate(0px, 0px) rotate(0deg)" },
              { transform: `translate(${sx}px, ${-B.jiggle.y}px) rotate(${(k % 2 ? 1 : -1) * B.jiggle.deg}deg)` },
              { transform: `translate(${-sx}px, ${B.jiggle.y * 0.6}px) rotate(${(k % 2 ? -1 : 1) * B.jiggle.deg * 0.7}deg)` },
              { transform: "translate(0px, 0px) rotate(0deg)" },
            ],
            { duration: B.jiggle.period, delay: B.lidAt, iterations: Infinity, iterationStart: (k * 0.37) % 1, fill: "none" },
          );
          const leave = B.flyAt + k * B.flyStagger;
          later(leave, () => {
            jig?.cancel();
            const cx = sp.offsetLeft + sp.offsetWidth / 2;
            const cy = sp.offsetTop + sp.offsetHeight / 2;
            const dx = binX - cx;
            const open = binTop + (ih * INSIDE_TOP) / 24 - cy;
            const level = binTop + ih * ((INSIDE_TOP + INSIDE_H * (1 - (k + 1) / n)) / 24) - cy;
            a(
              sp,
              [
                { transform: "translate(0px, 0px) rotate(0deg) scale(1)", opacity: 1, easing: "cubic-bezier(0.2, 0.7, 0.4, 1)" },
                { transform: `translate(${dx * 0.42}px, ${-H * 0.62}px) rotate(-24deg) scale(0.92)`, opacity: 1, offset: 0.34, easing: "cubic-bezier(0.5, 0, 0.75, 0.6)" },
                { transform: `translate(${dx}px, ${open - 2}px) rotate(-38deg) scale(0.78)`, opacity: 1, offset: 0.55, easing: "cubic-bezier(0.3, 0, 0.6, 1)" },
                { transform: `translate(${dx}px, ${level}px) rotate(-30deg) scale(${B.landScale})`, opacity: 1, offset: 0.92 },
                { transform: `translate(${dx}px, ${level}px) rotate(-30deg) scale(${B.landScale})`, opacity: 0 },
              ],
              { duration: B.flight },
            );
            later(B.flight, () => {
              const p = (k + 1) / n;
              a(fill.current, [{ transform: `translateY(${INSIDE_H * (1 - k / n)}px)` }, { transform: `translateY(${INSIDE_H * (1 - p)}px)` }], { duration: B.fillStep, easing: "ease-out" });
              a(fill.current?.parentElement, [{ transform: "rotate(-7deg)" }, { transform: "rotate(4deg)" }, { transform: "rotate(0deg)" }], { duration: 320, easing: "ease-out", fill: "none" });
            });
          });
        });
        const morphAt = binFullAt(n) + B.morphAfterFull;
        await wait(morphAt);
        if (!alive) return;
        // the pill turns into a disc about its centre; the bin rides with the left edge to the middle, the lid shuts, the shadow fades
        const ease = css(B.morph.ease);
        a(face.current, [{ clipPath: "inset(0px 0px 0px 0px round 999px)" }, { clipPath: `inset(0px ${d}px 0px ${d}px round 999px)` }], { duration: B.morph.duration, easing: ease });
        a(icon.current, [{ transform: "translateX(0px)" }, { transform: `translateX(${W / 2 - binX}px)` }], { duration: B.morph.duration, easing: ease });
        a(lid.current, [{ transform: `rotate(${B.lidDeg}deg)` }, { transform: "rotate(0deg)" }], { duration: B.lidShut, delay: 30, easing: "ease-in" });
        a(can.current, [{ transform: `rotate(${B.tiltDeg}deg)` }, { transform: "rotate(0deg)" }], { duration: B.morph.duration, easing: ease });
        a(shadow.current, [{ opacity: 1 }, { opacity: 0 }], { duration: B.shadowOut, easing: "linear" });
        spinAt = B.spinAfterMorph;
      }
      await wait(spinAt);
      if (!alive) return;
      // the spinner: a 100° arc from „1 o'clock“, clockwise, 0.45°/ms – it runs while the REAL deletion runs
      setPhase("spin");
      a(ring.current, [{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 0 : B.spinFade });
      const spin = reduced ? null : a(arc.current?.parentElement, [{ transform: "rotate(-60deg)" }, { transform: "rotate(300deg)" }], { duration: B.turnMs, iterations: Infinity, easing: "linear", fill: "none" });
      let ok = true;
      let error: unknown;
      const answer = perform().catch((e: unknown) => {
        ok = false;
        error = e;
      });
      await Promise.all([answer, wait(reduced ? 0 : B.spinMin)]);
      if (!alive) return;
      const C = arc.current ? 2 * Math.PI * Number(arc.current.getAttribute("r")) : 0;
      if (ok) {
        // done: the bin empties, the arc's head sprints round until the ring is closed
        setPhase("done");
        setSaid(BIN_STRINGS.done);
        a(fill.current, [{ transform: "translateY(0px)" }, { transform: `translateY(${INSIDE_H}px)` }], { duration: reduced ? 0 : B.empty, easing: "ease-in" });
        a(arc.current, [{ strokeDasharray: `${(C * B.arcDeg) / 360} ${C}` }, { strokeDasharray: `${C} ${C}` }], { duration: reduced ? 0 : B.close.duration, easing: css(B.close.ease) });
        await wait(reduced ? 0 : B.close.duration + B.hold);
        if (!alive) return;
        spin?.pause();
        ctl.current.finish();
        // the caller normally closes its dialog now; should the pill stay, it goes back after a beat
        await wait(700);
        if (!alive) return;
      } else {
        setSaid(BIN_STRINGS.failed);
      }
      // back to the pill: the disc grows about its centre, the ring stays and fades, the word fades in where it was
      setPhase("back");
      const back = { duration: reduced ? 0 : B.back.duration, easing: css(B.back.ease) };
      a(face.current, [{ clipPath: `inset(0px ${d}px 0px ${d}px round 999px)` }, { clipPath: "inset(0px 0px 0px 0px round 999px)" }], back);
      a(icon.current, [{ transform: `translateX(${W / 2 - binX}px)` }, { transform: "translateX(0px)" }], back);
      a(ring.current, [{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 0 : B.ringOut });
      a(shadow.current, [{ opacity: 0 }, { opacity: 1 }], back);
      a(fill.current, [{ transform: `translateY(${INSIDE_H}px)` }], { duration: 0 });
      for (const sp of spans) a(sp, [{ transform: "none", opacity: 1 }], { duration: 0 });
      a(word.current, [{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 0 : B.labelBack, delay: reduced ? 0 : B.labelBackAt, fill: "both" });
      await wait(reduced ? 0 : B.back.duration);
      if (!alive) return;
      for (const x of anims) x.cancel();
      anims.length = 0;
      setPhase("idle");
      if (!ok) ctl.current.fail(error);
    };
    void playRun();
    return () => {
      alive = false;
      for (const t of timers) clearTimeout(t);
      for (const x of anims) x.cancel();
      // confirmed is confirmed: a pill that leaves before its run ended (the dialog closed meanwhile) still deletes – or waits for the
      // deletion it already started – and the caller still hears the answer (`finish` / `fail` count once per run)
      void perform().then(
        () => ctl.current.finish(),
        (e: unknown) => ctl.current.fail(e),
      );
    };
    // `letters`, `dim` and `reduced` are read at the start of a run; a run is started by `bin.run` only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bin.run]);

  const ringD = Math.round(ph * B.ringRatio);
  const stroke = Math.max(1.5, ph * B.strokeRatio);
  const box = ringD + Math.ceil(stroke) + 2;
  const r = ringD / 2;
  const C = 2 * Math.PI * r;
  return (
    <>
      <motion.button
        ref={btn}
        type="button"
        disabled={disabled}
        title={title}
        aria-label={children}
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        data-state={hold.phase}
        data-bin={phase}
        className={cn(
          "relative isolate inline-flex shrink-0 touch-manipulation select-none items-center justify-center rounded-full font-semibold text-(--color-on-fill) [-webkit-touch-callout:none] focus-visible:outline-none! focus-visible:shadow-(--ring-glow-btn-danger) disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11",
          dim.text,
          className,
        )}
        style={reduced ? { minHeight: dim.h } : { minHeight: dim.h, scale }}
        {...hold.handlers}
        onClick={(e) => {
          if (busy) return e.preventDefault();
          hold.handlers.onClick(e);
        }}
        {...rest}
      >
        <span ref={body} aria-hidden="true" className="absolute inset-0 rounded-full">
          {/* the shadow is tinted in the face's red; when the pill becomes a disc it stays on the old outline and fades */}
          <span ref={shadow} className="absolute inset-0 rounded-full shadow-[0_8px_22px_-7px_rgb(229_32_46/0.5)]" />
          <span ref={face} className="absolute inset-0 overflow-hidden rounded-full" style={{ background: FACE }}>
            <motion.span className="absolute inset-0 origin-left bg-white/20" style={{ scaleX: hold.progress }} />
            <span ref={icon} className="absolute top-1/2 -translate-y-1/2" style={{ left: dim.l, width: (dim.icon * 20) / 24, height: dim.icon }}>
              <svg viewBox="0 0 20 24" className="size-full overflow-visible" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                <defs>
                  <clipPath id={clipId}>
                    <path d={`${BODY}z`} />
                  </clipPath>
                </defs>
                <g ref={can} style={{ transformBox: "view-box", transformOrigin: "10px 22px" }}>
                  <g clipPath={`url(#${clipId})`}>
                    <g style={{ transformBox: "view-box", transformOrigin: "10px 15px" }}>
                      <rect ref={fill} x="2" y={INSIDE_TOP} width="16" height={INSIDE_H + 2} fill="currentColor" stroke="none" style={{ transform: `translateY(${INSIDE_H}px)` }} />
                    </g>
                  </g>
                  <path d={BODY} />
                </g>
                <g ref={lid} style={{ transformBox: "view-box", transformOrigin: "2px 5.5px" }}>
                  <path d="M2 5.5h16M7.5 5.5V3.6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.9" />
                </g>
              </svg>
            </span>
          </span>
        </span>
        {/* the word: one span per letter (each flies on its own), laid out where the label sits; the button's name is the whole word */}
        <span aria-hidden="true" className="relative inline-flex items-center self-stretch" style={{ paddingLeft: dim.l + (dim.icon * 20) / 24 + dim.gap, paddingRight: dim.r, clipPath: "inset(0 round 999px)" }}>
          <span ref={word} className="inline-flex whitespace-pre">
            {letters.map((ch, k) => (
              <span key={k} className="inline-block">
                {ch}
              </span>
            ))}
          </span>
        </span>
        <svg ref={ring} aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible text-(--color-danger) opacity-0" width={box} height={box} viewBox={`${-box / 2} ${-box / 2} ${box} ${box}`} data-bin-ring="">
          <g style={{ transform: "rotate(-60deg)" }}>
            <circle ref={arc} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(C * B.arcDeg) / 360} ${C}`} />
          </g>
        </svg>
      </motion.button>
      <span role="status" aria-live="polite" className="sr-only">
        {said}
      </span>
    </>
  );
}
