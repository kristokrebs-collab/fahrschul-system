import { AnimatePresence, motion, type Transition } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { captionSide, fanLayout, RADIAL_HUB, RADIAL_ITEM, stepIndex, type RadialFan } from "@/motion/radialLayout";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { shareFan as A, shareFanOwn } from "@/motion/vorbild2";
import { Button, type ButtonSize } from "@/primitives/Button";

export interface RadialTarget {
  id: string;
  /** Word of the target (German): the accessible name, and what the trigger says while the target is active. */
  label: string;
  /** What choosing it does, in a few words (German): the caption under the hub while the target is active („Kurzfassung kopieren“). Defaults to `label`. */
  detail?: string;
  icon: ReactNode;
  /**
   * Runs when the target is chosen. With `done` it runs at once and its answer decides the end of the fan: `false` (or a throw) is a failure –
   * the target says why itself (a toast) – anything else a success. Without `done` the fan closes first and the target reports its own result
   * (a sheet, a dialog, the print window).
   */
  onSelect: () => void | boolean | Promise<void | boolean>;
  /** The channel's colour (its symbol on the disc, its flood): a CSS colour from our palette. Default `var(--palette-1)`. */
  color?: string;
  /** The caption while the target runs („Kopiere …“, the reference's „Copying…“). */
  busy?: string;
  /** With it, the choice plays to its end inside the fan (the reference's „Link copied“ and the ✓): the caption once the target succeeded. */
  done?: string;
  disabled?: boolean;
  /** Why it is off (shown as the title). */
  hint?: string;
}

export interface RadialShareProps {
  targets: readonly RadialTarget[];
  /** Resting label of the trigger (default „Teilen“). */
  label?: string;
  /** Symbol of the trigger (the callers pass the share glyph of `@/social/ui`). */
  icon?: ReactNode;
  /** The caption under the hub while the fan is open and no target is active (default „Kanal wählen“). */
  prompt?: string;
  size?: ButtonSize;
  className?: string;
  testId?: string;
}

/**
 * The channels' colours (Runde 13): the reference gives every channel its brand colour – ours are no brands, so they come from our palette
 * (`--palette-*`); the flood is the same tone darkened for the white symbol.
 */
export const RADIAL_CHANNEL = { copy: "var(--palette-1)", image: "var(--palette-2)", link: "var(--palette-3)", native: "var(--palette-4)", file: "var(--palette-2)", pdf: "var(--palette-5)" } as const;

/** A mouse picks a disc by hovering only once the discs have left the hub (ms). */
const HOVER_GRACE_MS = 360;
/** The caption of a target that answered `false` (it told the reader why itself). */
export const RADIAL_FAILED = "Hat nicht geklappt";

type OpenFan = RadialFan & { ox: number; oy: number; tw: number; th: number; vw: number; vh: number };
/** The life of a choice: pressed + flooded → collected to the centre → the hub → the result is said → the flood withdraws → the ✓ draws. */
type Phase = "press" | "collect" | "hub" | "result" | "retract" | "check";
interface Pick {
  i: number;
  /** the click point inside the disc (0–1), where the flood grows from and withdraws to */
  px: number;
  py: number;
  phase: Phase;
  /** the busy word is up (+63 ms) */
  said: boolean;
  ok: boolean | null;
  /** the target plays to its end inside the fan (`done`) */
  full: boolean;
}
const AFTER: Readonly<Record<Phase, number>> = { press: 0, collect: 1, hub: 2, result: 3, retract: 4, check: 5 };
const at = (p: Pick | null, ph: Phase): boolean => !!p && AFTER[p.phase] >= AFTER[ph];

const ms = (n: number) => n / 1000;
const pressTimes = A.press.keys.map((_, k) => k / (A.press.keys.length - 1));
const pressTransition: Transition = { duration: ms(A.press.step * (A.press.keys.length - 1)), times: pressTimes, delay: ms(A.press.delay), ease: "easeInOut" };

const viewport = (): { w: number; h: number } => {
  const vv = typeof window === "undefined" ? null : window.visualViewport;
  return { w: vv?.width ?? (typeof window === "undefined" ? 390 : window.innerWidth), h: vv?.height ?? (typeof window === "undefined" ? 800 : window.innerHeight) };
};

/**
 * The caption under the hub (the reference's „Pick a channel“): plain text in the quiet grey, 12 px under the hub, on the side AWAY from the
 * fan and kept inside the screen; its words change HARD (as in the recording). Decorative – the live region next to the trigger and the trigger's
 * `aria-label` carry the same words – and it never takes a pointer.
 */
function Caption({ fan, text }: { fan: OpenFan; text: string }) {
  const side = captionSide(fan, { y: fan.oy }, { h: fan.vh }, RADIAL_HUB);
  if (!side) return null;
  const dx = Math.min(fan.vw - 8 - 130, Math.max(8 + 130, fan.ox)) - fan.ox;
  const top = side === "below" ? RADIAL_HUB / 2 + 12 : -(RADIAL_HUB / 2 + 12);
  return (
    <div aria-hidden="true" data-testid="radial-caption" data-side={side} className="pointer-events-none absolute w-0" style={{ left: dx, top }}>
      <span className={cn("absolute left-0 w-max max-w-[260px] -translate-x-1/2 whitespace-nowrap text-[12px] font-medium leading-4 text-mute", side === "above" && "bottom-0")}>{text}</span>
    </div>
  );
}

/**
 * Radial share (R11 · Runde 13: the reference „Share Button Animation“ rebuilt 1:1 – geometry, springs, times, curves measured frame by frame,
 * `motion/vorbild2.ts`). Nothing new is invented about WHAT is shared: every target calls the share logic that already exists (`@/social`,
 * the clipboard helper, the share picture, the system share sheet) – this file lays them out and moves them.
 *
 * - Open: the pill itself shrinks about its centre into a recessed hub (spring k 670 / c 44, ≈ 220 ms; its word fades, the face cross-fades),
 *   a „+“ draws itself and turns 45° clockwise into the ✕; the discs (0.92 × the hub, 48 px ≥ 44 px touch) leave the hub's centre one after
 *   another (50 ms apart, spring k 245 / c 23, 3.5 % overshoot, scale 0.3 → 1, no turn) onto a half circle (46° apart, r = 1.92 discs,
 *   `radialLayout`); the caption says „Kanal wählen“ under the hub. At a screen edge the fan turns until every disc is on screen.
 * - Choose: the disc dips to 0.83 and springs back, a ring leaves its edge, the target's word shows for a moment under it, the caption swaps to
 *   the busy word and the disc floods in the channel's colour FROM THE CLICK POINT (symbol in white). A target with `done` plays to its end:
 *   the chosen disc rides into the centre, the others are collected under it, it grows into the hub; once the target answered (no earlier
 *   than +763 ms) the caption says the result, the flood withdraws to the click point and a ✓ draws – then the fan gives the trigger back.
 *   A target without `done` (a sheet, the print window) closes the fan right after the flood and runs.
 * - Close (✕ on the hub, a press outside, Esc, Tab – not in the recording): the short reverse of the fan-out, then the pill is back.
 * - Keyboard: the trigger opens with Enter / Space / ↑ / ↓; focus moves into the fan; ← ↑ / → ↓ step (wrapping), Home / End jump, Esc closes
 *   and returns the focus to the trigger (without closing the dialog under it), Tab closes. A focus ring glides to the active disc and the
 *   caption says what it does. The live region next to the trigger says the busy word and the result.
 * - Reduced motion: no move – the hub and the discs are simply there, a choice says its result and the fan closes.
 * - The fan is a fixed layer in `<body>` (a dialog's scroll box cannot clip it), exempt from the dialog's inert rule (`data-radial-share`). A
 *   resize or a scroll that moves the trigger closes it.
 */
export function RadialShare({ targets, label = "Teilen", icon, prompt = "Kanal wählen", size = "sm", className, testId = "share-button" }: RadialShareProps) {
  const reduced = useReducedFx();
  const uid = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  /** the focus that moves into the fan by itself (no pick) and the moment it opened (the discs are still flying – no hover yet) */
  const movedIn = useRef(false);
  const openedAt = useRef(0);
  const [open, setOpen] = useState(false);
  /** the layer is up (open, or still playing its close): the trigger stays hidden meanwhile, the hub stands in its place */
  const [layer, setLayer] = useState(false);
  const [active, setActive] = useState(-1);
  const [fan, setFan] = useState<OpenFan | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [said, setSaid] = useState("");
  const timers = useRef<number[]>([]);
  const seq = useRef(0);
  const disabled = targets.map((t) => !!t.disabled);
  const firstEnabled = disabled.findIndex((d) => !d);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);
  const after = useCallback((wait: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, wait));
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const close = useCallback(
    (returnFocus: boolean) => {
      clearTimers();
      seq.current++;
      setOpen(false);
      setActive(-1);
      if (returnFocus) trigger.current?.focus({ preventScroll: true });
    },
    [clearTimers],
  );

  const openFan = useCallback(() => {
    const el = trigger.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const o = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const vp = viewport();
    const f = fanLayout({ n: targets.length, origin: o, viewport: vp, hub: { w: RADIAL_HUB, h: RADIAL_HUB } });
    clearTimers();
    setFan({ ...f, ox: o.x, oy: o.y, tw: r.width, th: r.height, vw: vp.w, vh: vp.h });
    setActive(-1);
    setPick(null);
    setSaid("");
    openedAt.current = performance.now();
    setLayer(true);
    setOpen(true);
  }, [targets.length, clearTimers]);

  // focus moves into the fan once it is mounted; the first enabled target is the roving tab stop
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useLayoutEffect(() => {
    if (!open || firstEnabled < 0) return;
    // the focus that lands in the fan by itself is no pick: the caption still asks „Kanal wählen“ until a key or the pointer chooses one
    movedIn.current = true;
    itemRefs.current[firstEnabled]?.focus({ preventScroll: true });
    movedIn.current = false;
  }, [open, firstEnabled]);

  // anything that moves the trigger closes the fan (its place was measured once). A scroll counts only when the trigger really moved: the
  // capture listener also hears scrolls that leave it where it is (the sticky section strip sliding its chip into view)
  const ox = fan?.ox;
  const oy = fan?.oy;
  useEffect(() => {
    if (!open) return;
    const away = () => close(false);
    const moved = () => {
      const r = trigger.current?.getBoundingClientRect();
      if (!r || ox === undefined || oy === undefined) return close(false);
      if (Math.abs(r.left + r.width / 2 - ox) > 1 || Math.abs(r.top + r.height / 2 - oy) > 1) close(false);
    };
    window.addEventListener("resize", away);
    window.addEventListener("scroll", moved, true);
    return () => {
      window.removeEventListener("resize", away);
      window.removeEventListener("scroll", moved, true);
    };
  }, [open, close, ox, oy]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = active >= 0 ? active : firstEnabled;
    const go = (i: number) => {
      if (i < 0 || pick) return;
      e.preventDefault();
      setActive(i);
      itemRefs.current[i]?.focus({ preventScroll: true });
    };
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        return go(stepIndex(cur, 1, disabled));
      case "ArrowLeft":
      case "ArrowUp":
        return go(stepIndex(cur, -1, disabled));
      case "Home":
        return go(firstEnabled);
      case "End":
        return go(disabled.lastIndexOf(false));
      case "Escape":
        // only the fan closes – the dialog under it stays (its own Esc listener sits on the document)
        e.preventDefault();
        e.stopPropagation();
        return close(true);
      case "Tab":
        e.preventDefault();
        return close(true);
    }
  };

  const choose = (i: number, e: MouseEvent<HTMLButtonElement>) => {
    const t = targets[i];
    if (!t || t.disabled || pick) return;
    const r = e.currentTarget.getBoundingClientRect();
    // the flood grows from where the finger / pointer pressed (a key: from the centre)
    const point = e.detail === 0 || !r.width ? { px: 0.5, py: 0.5 } : { px: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), py: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    const full = !!t.done;
    const token = ++seq.current;
    setActive(i);
    setPick({ i, ...point, phase: "press", said: reduced, ok: null, full });
    const run = () =>
      Promise.resolve()
        .then(() => t.onSelect())
        .then(
          (r) => r !== false,
          () => false,
        );
    if (!full) {
      // a target that opens something of its own: the flood answers the press, then the fan makes room and the target runs
      if (!reduced) after(A.busyAt, () => setPick((p) => (p ? { ...p, said: true } : p)));
      after(reduced ? 0 : A.flood.delay + A.flood.duration, () => {
        close(true);
        void run();
      });
      return;
    }
    setSaid(t.busy ?? t.label);
    if (!reduced) {
      after(A.busyAt, () => setPick((p) => (p ? { ...p, said: true } : p)));
      after(A.collectAt, () => setPick((p) => (p ? { ...p, phase: "collect" } : p)));
      after(A.becomeHubAt, () => setPick((p) => (p ? { ...p, phase: "hub" } : p)));
    }
    // the result is said once the target answered AND no earlier than +763 ms (the reference's „Copying…“ stays at least that long)
    let answer: boolean | null = null;
    let due = reduced;
    const show = (ok: boolean) => {
      if (seq.current !== token) return;
      setPick((p) => (p ? { ...p, phase: "result", ok } : p));
      setSaid(ok ? (t.done ?? "") : RADIAL_FAILED);
      if (reduced) return after(shareFanOwn.hold, () => close(true));
      after(A.retractAfter, () => setPick((p) => (p ? { ...p, phase: "retract" } : p)));
      after(A.retractAfter + A.retract, () => setPick((p) => (p ? { ...p, phase: ok ? "check" : "retract" } : p)));
      after(A.retractAfter + A.retract + (ok ? A.check : 0) + shareFanOwn.hold, () => close(true));
    };
    if (!reduced)
      after(A.doneAt, () => {
        due = true;
        if (answer !== null) show(answer);
      });
    void run().then((ok) => {
      answer = ok;
      if (due) show(ok);
    });
  };

  const chosen = pick ? targets[pick.i] : undefined;
  const caption = chosen
    ? at(pick, "result")
      ? pick!.ok
        ? (chosen.done ?? chosen.label)
        : RADIAL_FAILED
      : pick!.said
        ? (chosen.busy ?? chosen.detail ?? chosen.label)
        : prompt
    : active >= 0
      ? (targets[active]?.detail ?? targets[active]?.label ?? prompt)
      : prompt;
  const shown = open && active >= 0 ? (targets[active]?.label ?? label) : label;
  const menuId = `${uid}-menu`;
  const n = targets.length;
  const grow = RADIAL_HUB / RADIAL_ITEM;

  return (
    <>
      <Button
        ref={trigger}
        size={size}
        className={cn("min-w-0 rounded-full", className)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={shown === label ? undefined : `${label}: ${shown}`}
        data-testid={testId}
        data-radial-open={open ? "" : undefined}
        // the hub stands in the trigger's place while the layer is up: the pill itself is what turned into it
        style={layer ? { opacity: 0 } : undefined}
        onClick={() => (open ? close(false) : openFan())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            openFan();
          }
        }}
      >
        <span className="inline-grid shrink-0 place-items-center" data-radial-icon={open ? "close" : "share"}>
          {icon}
        </span>
        {label}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {said}
      </span>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence
            onExitComplete={() => {
              setLayer(false);
              setPick(null);
            }}
          >
            {open && fan && (
              <div key="layer" data-radial-share="" data-layer="Teilen-Fächer" className="fixed inset-0 z-[96]" onKeyDown={onMenuKey}>
                {/* a press anywhere else closes the fan; the layer itself takes no other input */}
                <div className="absolute inset-0" onPointerDown={() => close(false)} aria-hidden="true" />
                <div id={menuId} role="menu" aria-label={`${label} über`} aria-orientation="horizontal" className="pointer-events-none absolute size-px" style={{ left: fan.ox, top: fan.oy }} data-testid="radial-menu">
                  {active >= 0 && !pick && fan.offsets[active] && (
                    <motion.span
                      aria-hidden="true"
                      data-testid="radial-ring"
                      className="pointer-events-none absolute -ml-[28px] -mt-[28px] size-14 rounded-full border-2 border-fg/55"
                      initial={reduced ? false : { x: fan.offsets[active]!.x, y: fan.offsets[active]!.y, scale: 0.8, opacity: 0 }}
                      animate={{ x: fan.offsets[active]!.x, y: fan.offsets[active]!.y, scale: 1, opacity: 1 }}
                      transition={reduced ? { duration: 0 } : { default: spring.layout, scale: spring.pop, opacity: tween.fade }}
                    />
                  )}
                  {/* a soft pool of the ground under the fan (not in the recording, whose stage is empty): our fan opens over a page – the
                      caption and the discs stay readable over its text */}
                  <motion.span
                    aria-hidden="true"
                    data-radial-pool=""
                    className="pointer-events-none absolute rounded-full"
                    style={{ zIndex: -1, width: 2 * (fan.radius + 64), height: 2 * (fan.radius + 64), left: -(fan.radius + 64), top: -(fan.radius + 64), background: "radial-gradient(closest-side, color-mix(in srgb, var(--color-ink-950) 86%, transparent) 50%, transparent)" }}
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: reduced ? { duration: 0 } : { duration: ms(shareFanOwn.closeDuration), delay: ms(shareFanOwn.closeDuration * 0.5) } }}
                    transition={{ duration: reduced ? 0 : 0.2, ease: "easeOut" }}
                  />
                  <Caption fan={fan} text={caption} />
                  {targets.map((t, i) => (
                    <Disc
                      key={t.id}
                      t={t}
                      i={i}
                      n={n}
                      fan={fan}
                      pick={pick}
                      grow={grow}
                      reduced={reduced}
                      tabStop={(active >= 0 ? active : firstEnabled) === i}
                      active={active === i}
                      refFn={(el) => {
                        itemRefs.current[i] = el;
                      }}
                      onHover={(e) => e.pointerType === "mouse" && !t.disabled && !pick && performance.now() - openedAt.current > HOVER_GRACE_MS && setActive(i)}
                      onFocus={() => !t.disabled && !movedIn.current && !pick && setActive(i)}
                      onChoose={(e) => choose(i, e)}
                    />
                  ))}
                </div>
                {/* the hub is no menu item (a menu holds only its items): it sits in its own anchor at the same centre, above the discs */}
                <div className="pointer-events-none absolute z-[3] size-px" style={{ left: fan.ox, top: fan.oy }}>
                  <Hub fan={fan} label={label} icon={icon} pick={pick} reduced={reduced} onClose={() => close(true)} />
                </div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

/** The trigger turned into a disc: the pill shrinks about its centre, its word fades, its face gives way to the recessed hub, „+“ draws and turns into the ✕. */
function Hub({ fan, label, icon, pick, reduced, onClose }: { fan: OpenFan; label: string; icon: ReactNode; pick: Pick | null; reduced: boolean; onClose: () => void }) {
  const gone = at(pick, "collect") || (!!pick && reduced && pick.full);
  const pill = { width: fan.tw, height: fan.th };
  return (
    <motion.button
      type="button"
      tabIndex={-1}
      aria-label={`${label} schließen`}
      data-testid="radial-hub"
      className={cn("absolute left-0 top-0 z-[3] grid -translate-x-1/2 -translate-y-1/2 place-items-center overflow-hidden rounded-full", gone ? "pointer-events-none" : "pointer-events-auto")}
      initial={reduced ? false : pill}
      animate={{ width: RADIAL_HUB, height: RADIAL_HUB, opacity: gone ? 0 : 1 }}
      exit={reduced ? { opacity: 0, transition: { duration: 0 } } : gone ? { opacity: 0 } : { ...pill, transition: { ...A.morph, delay: ms(shareFanOwn.closeDuration * 0.4) } }}
      transition={reduced ? { duration: 0 } : { width: A.morph, height: A.morph, opacity: { duration: ms(A.hubOut), ease: "linear" } }}
      onClick={onClose}
    >
      {/* the recessed hub: the ground a step deeper, a soft shade from the top edge */}
      <span aria-hidden="true" className="absolute inset-0 rounded-full bg-[color-mix(in_srgb,var(--color-ink-950)_60%,transparent)] shadow-[inset_0_3px_7px_rgb(0_0_0/calc(0.4*var(--shade,1)))]" />
      {/* the pill's glass face and its word fade as it shrinks (and come back when it closes) */}
      <motion.span
        aria-hidden="true"
        className="glass absolute inset-0 rounded-full bg-white/[0.02]"
        initial={reduced ? false : { opacity: 1 }}
        animate={{ opacity: 0 }}
        exit={{ opacity: 1 }}
        transition={reduced ? { duration: 0 } : { delay: ms(A.faceFade.delay), duration: ms(A.faceFade.duration), ease: "easeOut" }}
      />
      <motion.span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center gap-2 whitespace-nowrap text-xs font-semibold text-fg"
        initial={reduced ? false : { opacity: 1 }}
        animate={{ opacity: 0 }}
        exit={{ opacity: 1 }}
        transition={reduced ? { duration: 0 } : { duration: ms(A.labelOut), ease: "easeOut" }}
      >
        {icon}
        {label}
      </motion.span>
      <motion.svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="relative size-5 text-fg"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        initial={reduced ? false : { scale: 0, opacity: 0, rotate: 0 }}
        animate={{ scale: 1, opacity: 1, rotate: gone ? 0 : 45 }}
        exit={{ scale: 0, opacity: 0, rotate: 0, transition: { duration: ms(shareFanOwn.closeDuration), ease: "easeIn" } }}
        transition={
          reduced
            ? { duration: 0 }
            : gone
              ? { duration: ms(A.hubOut) }
              : {
                  scale: { delay: ms(A.plusIn.delay), duration: ms(A.plusIn.duration), ease: "easeOut" },
                  opacity: { delay: ms(A.plusIn.delay), duration: ms(A.plusIn.duration), ease: "easeOut" },
                  rotate: { delay: ms(A.plusTurn.delay), duration: ms(A.plusTurn.duration), ease: A.plusTurn.ease },
                }
        }
      >
        <path d="M10 3v14M3 10h14" />
      </motion.svg>
    </motion.button>
  );
}

interface DiscProps {
  t: RadialTarget;
  i: number;
  n: number;
  fan: OpenFan;
  pick: Pick | null;
  grow: number;
  reduced: boolean;
  tabStop: boolean;
  active: boolean;
  refFn: (el: HTMLButtonElement | null) => void;
  onHover: (e: PointerEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
  onChoose: (e: MouseEvent<HTMLButtonElement>) => void;
}

/** One channel: an opaque disc (our glass rim on it, so it reads on the dark ground) with the symbol in the channel's colour. */
function Disc({ t, i, n, fan, pick, grow, reduced, tabStop, active, refFn, onHover, onFocus, onChoose }: DiscProps) {
  const o = fan.offsets[i]!;
  const chosen = pick?.i === i;
  const color = t.color ?? "var(--palette-1)";
  const delay = ms(A.fanStart + i * A.fanStagger);
  // the others are collected left → right, one every 17 ms, once the chosen disc starts for the centre
  const rank = pick ? (i < pick.i ? i : i - 1) : 0;
  const collected = !!pick && !chosen && at(pick, "collect");
  const toHub = chosen && at(pick, "collect");
  const target = collected
    ? { x: 0, y: 0, scale: 0.4, opacity: 0 }
    : toHub
      ? { x: 0, y: 0, scale: at(pick, "hub") ? grow : 1, opacity: 1 }
      : { x: o.x, y: o.y, scale: 1, opacity: 1 };
  const transition: Transition = reduced
    ? { duration: 0 }
    : collected
      ? { duration: ms(A.othersDuration), ease: "easeIn", delay: ms(A.othersAt - A.collectAt + rank * A.othersStagger) }
      : toHub
        ? { x: A.collect, y: A.collect, scale: A.becomeHub }
        : { x: { ...A.fan, delay }, y: { ...A.fan, delay }, scale: { ...A.fan, delay }, opacity: { duration: ms(A.fanFade), ease: "linear", delay } };
  // closing: the reverse of the fan-out (the last disc first); a confirmed disc just fades where it stands
  const exit = reduced
    ? { opacity: 0, transition: { duration: 0 } }
    : chosen && pick?.full
      ? { scale: 0.85, opacity: 0, transition: { duration: 0.15, ease: "easeIn" as const } }
      : { x: 0, y: 0, scale: A.fanFrom, opacity: 0, transition: { duration: ms(shareFanOwn.closeDuration), ease: "easeIn" as const, delay: ms((n - 1 - i) * shareFanOwn.closeStagger) } };
  const flooded = chosen && !at(pick, "retract");
  const clip = (r: string) => `circle(${r} at ${Math.round((pick?.px ?? 0.5) * 100)}% ${Math.round((pick?.py ?? 0.5) * 100)}%)`;
  return (
    <motion.button
      ref={refFn}
      type="button"
      role="menuitem"
      aria-label={t.label}
      aria-disabled={t.disabled || undefined}
      title={t.disabled && t.hint ? `${t.label}: ${t.hint}` : t.label}
      tabIndex={tabStop ? 0 : -1}
      data-testid={`radial-${t.id}`}
      data-active={active ? "" : undefined}
      data-picked={chosen ? pick!.phase : undefined}
      className={cn("pointer-events-auto absolute rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg", chosen ? "z-[4]" : "z-[2]", t.disabled && "cursor-not-allowed opacity-45", pick && "pointer-events-none")}
      style={{ width: RADIAL_ITEM, height: RADIAL_ITEM, left: -RADIAL_ITEM / 2, top: -RADIAL_ITEM / 2 }}
      initial={reduced ? { x: o.x, y: o.y } : { x: 0, y: 0, scale: A.fanFrom, opacity: 0 }}
      animate={target}
      exit={exit}
      transition={transition}
      onPointerEnter={onHover}
      onFocus={onFocus}
      onClick={onChoose}
    >
      {/* the press: swell, a deep dip, back (on its own layer, so the ride to the centre is not disturbed) */}
      <motion.span
        aria-hidden="true"
        className="glass absolute inset-0 grid place-items-center rounded-full bg-ink-700 shadow-[var(--gl-in),0_5px_22px_rgb(0_0_0/calc(0.35*var(--shade,1)))] [&_svg]:size-5"
        initial={false}
        animate={{ scale: chosen && !reduced ? [...A.press.keys] : 1 }}
        transition={chosen && !reduced ? pressTransition : { duration: 0 }}
      >
        <motion.span className="grid place-items-center" style={{ color }} initial={false} animate={{ opacity: chosen ? 0 : 1 }} transition={{ duration: 0, delay: chosen && !reduced ? ms(A.flood.delay + A.flood.duration) : 0 }}>
          {t.icon}
        </motion.span>
        {chosen && (
          <motion.span
            className="absolute inset-0 grid place-items-center rounded-full text-(--color-on-fill)"
            style={{ background: `color-mix(in srgb, ${color} 72%, #000)` }}
            initial={reduced ? false : { clipPath: clip("0%") }}
            animate={{ clipPath: clip(flooded ? "150%" : "0%") }}
            transition={reduced ? { duration: 0 } : flooded ? { delay: ms(A.flood.delay), duration: ms(A.flood.duration), ease: "easeOut" } : { duration: ms(A.retract), ease: "easeIn" }}
          >
            {t.icon}
          </motion.span>
        )}
        {chosen && pick!.phase === "check" && (
          <svg viewBox="0 0 20 20" className="absolute" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <motion.path d="M5 10.5l3.4 3.4L15 7" stroke="var(--color-fg)" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: ms(A.check), ease: "easeOut" }} />
            <motion.path d="M5 10.5l3.4 3.4L15 7" stroke={color} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: ms(A.check - 33), duration: 0.033 }} />
          </svg>
        )}
      </motion.span>
      {/* the ring wave and the target's word for a moment, only right after the press */}
      {chosen && !reduced && pick!.phase === "press" && (
        <>
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full border-[2.5px] border-fg/30"
            initial={{ scale: 1, opacity: 0 }}
            animate={{ scale: A.ring.to, opacity: [0, 0.8, 0] }}
            transition={{ delay: ms(A.ring.delay), duration: ms(A.ring.duration), ease: "easeOut" }}
          />
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-[color-mix(in_srgb,var(--color-ink-950)_82%,transparent)] px-2 py-0.5 text-[11px] font-medium text-fg"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0] }}
            transition={{ delay: ms(A.tip.delay), duration: ms(A.tip.duration + 33), times: [0, 0.25, 0.75, 1] }}
          >
            {t.label}
          </motion.span>
        </>
      )}
    </motion.button>
  );
}
