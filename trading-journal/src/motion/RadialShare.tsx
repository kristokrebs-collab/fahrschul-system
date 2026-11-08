import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { captionSide, fanLayout, RADIAL_ITEM, stepIndex, type RadialFan } from "@/motion/radialLayout";
import { spring, stagger, tween } from "@/motion/tokens";
import { TextRoll } from "@/motion/TextRoll";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button, type ButtonSize } from "@/primitives/Button";

export interface RadialTarget {
  id: string;
  /** Word of the target (German): the accessible name, and what the trigger shows while the target is active. */
  label: string;
  /** What choosing it does, in a few words (German): the caption under the trigger while the target is active („Kurzfassung kopieren“). Defaults to `label`. */
  detail?: string;
  icon: ReactNode;
  /** Runs when the target is chosen; the fan closes first. The target reports its own result (a toast, a sheet). */
  onSelect: () => void | Promise<void>;
  disabled?: boolean;
  /** Why it is off (shown as the title). */
  hint?: string;
}

export interface RadialShareProps {
  targets: readonly RadialTarget[];
  /** Resting label of the trigger (default „Teilen“). */
  label?: string;
  /** Symbol of the trigger (the callers pass the share glyph of `@/social/ui`); while the fan is open it turns into the cross. */
  icon?: ReactNode;
  /** The caption under the trigger while the fan is open and no target is active (default „Kanal wählen“). */
  prompt?: string;
  size?: ButtonSize;
  className?: string;
  testId?: string;
}

/** A mouse picks a chip by hovering only once the chips have settled (ms): they fly out from under the pointer that clicked the trigger. */
const HOVER_GRACE_MS = 360;

type OpenFan = RadialFan & { ox: number; oy: number; hubH: number; vw: number; vh: number };

/**
 * The caption under the trigger while the fan is open (the „Pick a channel“ of the reference): the prompt, or what the active target does.
 * A glass pill on the side AWAY from the fan, kept inside the screen; decorative (the trigger's `aria-label` carries the same words) and
 * never takes a pointer.
 */
function Caption({ fan, text, reduced }: { fan: OpenFan; text: string; reduced: boolean }) {
  const side = captionSide(fan, { y: fan.oy }, { h: fan.vh }, fan.hubH);
  if (!side) return null;
  // the pill is centred on the trigger and slides sideways only as far as the screen needs (it is at most 260 px wide)
  const dx = Math.min(fan.vw - 8 - 130, Math.max(8 + 130, fan.ox)) - fan.ox;
  const top = side === "below" ? fan.hubH / 2 + 10 : -(fan.hubH / 2 + 10);
  return (
    <div aria-hidden="true" data-testid="radial-caption" data-side={side} className="pointer-events-none absolute w-0" style={{ left: dx, top }}>
      <motion.span
        className={cn(
          "absolute left-0 w-max max-w-[260px] -translate-x-1/2 whitespace-nowrap rounded-full border border-[rgb(var(--gl-ink)/0.2)] bg-[color-mix(in_srgb,var(--color-ink-850)_86%,transparent)] px-3 py-1 text-[12px] font-medium leading-4 text-fg shadow-[inset_0_1px_0_rgb(var(--gl-hi)/0.14),0_8px_24px_rgb(0_0_0/0.35)] backdrop-blur-md",
          side === "above" && "bottom-0",
        )}
        initial={reduced ? false : { opacity: 0, y: side === "below" ? -6 : 6, scale: 0.92 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={reduced ? { duration: 0 } : { default: spring.pop, opacity: tween.fade, scale: spring.pop }}
      >
        <TextRoll text={text} />
      </motion.span>
    </div>
  );
}

const viewport = (): { w: number; h: number } => {
  const vv = typeof window === "undefined" ? null : window.visualViewport;
  return { w: vv?.width ?? (typeof window === "undefined" ? 390 : window.innerWidth), h: vv?.height ?? (typeof window === "undefined" ? 800 : window.innerHeight) };
};

/**
 * Radial share (R11, A5 "Interaktionen"): the trigger opens the targets (Kopieren, Bild, Link, Teilen – only what exists) on an
 * arc around it. Nothing new is invented here: every target calls the share logic that already exists (`@/social`,
 * `CopyButton`'s clipboard, the share picture, the system share sheet) – this file only lays them out and moves them.
 *
 * - Geometry (`radialLayout`): the fan opens upwards and turns / widens until every target is fully on screen and clear of
 *   the trigger – at the edge of a phone as well; targets are 48 px (≥ 44 px touch), never overlapping.
 * - Keyboard: the trigger opens with Enter / Space / ↑ / ↓; focus moves into the fan; ← ↑ / → ↓ step (wrapping), Home / End jump,
 *   Esc closes and returns the focus to the trigger (without closing the dialog under it), Tab closes. A focus ring glides to the
 *   active target; while one is active the trigger says its word.
 * - Motion: targets leave the trigger centre one after another (`spring.pop`, `stagger.cards`, a short turn), and return on `tween.exit`;
 *   transform / opacity only. Reduced motion: they are simply there.
 * - Runde 12 (the reference „Share Button Animation“, Instagram, Aufnahme des Nutzers – behaviour only, no source): the targets are glass
 *   chips, the trigger's symbol turns into the cross while the fan is open, and a caption pill on the side AWAY from the fan says „Kanal wählen“
 *   – or, once a target is active, what it does (`detail`). Nothing of the closing and scrolling rules changed.
 * - The fan is a fixed layer in `<body>` (a dialog's scroll box cannot clip it); it is exempt from the dialog's inert rule
 *   (`data-radial-share`, `INERT_EXEMPT_SELECTOR`). A pointer press anywhere else, a resize or a scroll that moves the trigger closes it.
 */
export function RadialShare({ targets, label = "Teilen", icon, prompt = "Kanal wählen", size = "sm", className, testId = "share-button" }: RadialShareProps) {
  const reduced = useReducedFx();
  const uid = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  /** the focus that moves into the fan by itself (no pick) and the moment it opened (the chips are still flying – no hover yet) */
  const movedIn = useRef(false);
  const openedAt = useRef(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [fan, setFan] = useState<OpenFan | null>(null);
  const disabled = targets.map((t) => !!t.disabled);
  const firstEnabled = disabled.findIndex((d) => !d);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setActive(-1);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  }, []);

  const openFan = useCallback(() => {
    const el = trigger.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const o = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const vp = viewport();
    const f = fanLayout({ n: targets.length, origin: o, viewport: vp, hub: { w: r.width, h: r.height } });
    setFan({ ...f, ox: o.x, oy: o.y, hubH: r.height, vw: vp.w, vh: vp.h });
    setActive(-1);
    openedAt.current = performance.now();
    setOpen(true);
  }, [targets.length]);

  // focus moves into the fan once it is mounted; the first enabled target is the roving tab stop
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useLayoutEffect(() => {
    if (!open || firstEnabled < 0) return;
    // the focus that lands in the fan by itself is no pick: the caption still asks „Kanal wählen“ until a key or the pointer chooses one
    movedIn.current = true;
    itemRefs.current[firstEnabled]?.focus({ preventScroll: true });
    movedIn.current = false;
  }, [open, firstEnabled]);

  // anything that moves the trigger closes the fan (its place was measured once). A scroll counts only when the trigger really
  // moved: the capture listener also hears scrolls that leave it where it is – the sticky section strip sliding its chip into view
  // a moment after the page scrolled – and those must not take the fan away from under a finger
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
      if (i < 0) return;
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

  const choose = (t: RadialTarget) => {
    if (t.disabled) return;
    close(true);
    // after the fan started to close: the target reports its own result
    void Promise.resolve()
      .then(() => t.onSelect())
      .catch(() => undefined);
  };

  const shown = open && active >= 0 ? (targets[active]?.label ?? label) : label;
  const widest = targets.reduce((w, t) => (t.label.length > w.length ? t.label : w), label);
  const menuId = `${uid}-menu`;

  return (
    <>
      <Button
        ref={trigger}
        size={size}
        className={cn("min-w-0", className)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={shown === label ? undefined : `${label}: ${shown}`}
        data-testid={testId}
        data-radial-open={open ? "" : undefined}
        onClick={() => (open ? close(false) : openFan())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            openFan();
          }
        }}
      >
        {/* the symbol turns into the cross while the fan is open (one grid cell: the button never changes its width) */}
        <span className="inline-grid shrink-0 place-items-center [&>*]:[grid-area:1/1]" data-radial-icon={open ? "close" : "share"}>
          <motion.span className="grid place-items-center" initial={false} animate={{ rotate: open ? 90 : 0, scale: open ? 0.5 : 1, opacity: open ? 0 : 1 }} transition={reduced ? { duration: 0 } : { default: spring.pop, opacity: tween.fade }}>
            {icon}
          </motion.span>
          <motion.span aria-hidden="true" className="grid size-4 place-items-center" initial={false} animate={{ rotate: open ? 0 : -90, scale: open ? 1 : 0.5, opacity: open ? 1 : 0 }} transition={reduced ? { duration: 0 } : { default: spring.pop, opacity: tween.fade }}>
            <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </motion.span>
        </span>
        <span className="fx-reserve" data-reserve={widest}>
          <TextRoll text={shown} className="[grid-area:1/1] justify-self-start" />
        </span>
      </Button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && fan && (
              <div key="layer" data-radial-share="" data-layer="Teilen-Fächer" className="fixed inset-0 z-[96]" onKeyDown={onMenuKey}>
                {/* a press anywhere else closes the fan; the layer itself takes no other input */}
                <div className="absolute inset-0" onPointerDown={() => close(false)} aria-hidden="true" />
                <div id={menuId} role="menu" aria-label={`${label} über`} aria-orientation="horizontal" className="pointer-events-none absolute size-px" style={{ left: fan.ox, top: fan.oy }} data-testid="radial-menu">
                  {active >= 0 && fan.offsets[active] && (
                    <motion.span
                      aria-hidden="true"
                      data-testid="radial-ring"
                      className="pointer-events-none absolute -ml-[28px] -mt-[28px] size-14 rounded-full border-2 border-fg/55"
                      initial={reduced ? false : { x: fan.offsets[active]!.x, y: fan.offsets[active]!.y, scale: 0.8, opacity: 0 }}
                      animate={{ x: fan.offsets[active]!.x, y: fan.offsets[active]!.y, scale: 1, opacity: 1 }}
                      transition={reduced ? { duration: 0 } : { default: spring.layout, scale: spring.pop, opacity: tween.fade }}
                    />
                  )}
                  <Caption fan={fan} text={active >= 0 ? (targets[active]?.detail ?? targets[active]?.label ?? prompt) : prompt} reduced={reduced} />
                  {targets.map((t, i) => {
                    const o = fan.offsets[i]!;
                    const tabStop = (active >= 0 ? active : firstEnabled) === i;
                    return (
                      <motion.button
                        key={t.id}
                        ref={(el) => {
                          itemRefs.current[i] = el;
                        }}
                        type="button"
                        role="menuitem"
                        aria-label={t.label}
                        aria-disabled={t.disabled || undefined}
                        title={t.disabled && t.hint ? `${t.label}: ${t.hint}` : t.label}
                        tabIndex={tabStop ? 0 : -1}
                        data-testid={`radial-${t.id}`}
                        data-active={active === i ? "" : undefined}
                        className={cn(
                          // a glass chip (Runde 12): the ink of the theme at 80 % over a soft blur, light from the top – small and short-lived, so the blur costs nothing
                          "pointer-events-auto absolute grid place-items-center rounded-full border border-[rgb(var(--gl-ink)/0.2)] bg-[color-mix(in_srgb,var(--color-ink-850)_80%,transparent)] text-fg shadow-[inset_0_1px_0_rgb(var(--gl-hi)/0.16),0_10px_30px_rgb(0_0_0/0.45)] backdrop-blur-md transition-colors",
                          "hover:bg-[color-mix(in_srgb,var(--color-ink-700)_88%,transparent)] focus-visible:outline-none focus-visible:border-fg/70 [&>svg]:size-5",
                          t.disabled && "cursor-not-allowed opacity-45",
                        )}
                        style={{ width: RADIAL_ITEM, height: RADIAL_ITEM, left: -RADIAL_ITEM / 2, top: -RADIAL_ITEM / 2 }}
                        initial={reduced ? { x: o.x, y: o.y } : { x: 0, y: 0, scale: 0.3, opacity: 0, rotate: -28 }}
                        animate={{ x: o.x, y: o.y, scale: 1, opacity: 1, rotate: 0 }}
                        exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { x: 0, y: 0, scale: 0.3, opacity: 0, rotate: -28, transition: tween.exit }}
                        transition={reduced ? { duration: 0 } : { default: { ...spring.pop, delay: i * stagger.cards }, opacity: { ...tween.fade, delay: i * stagger.cards } }}
                        // the chips fly out from under the pointer that clicked the trigger: that is no hover – a mouse picks only once they have settled
                        onPointerEnter={(e) => e.pointerType === "mouse" && !t.disabled && performance.now() - openedAt.current > HOVER_GRACE_MS && setActive(i)}
                        onFocus={() => !t.disabled && !movedIn.current && setActive(i)}
                        onClick={() => choose(t)}
                      >
                        {t.icon}
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
