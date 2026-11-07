import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { fanLayout, RADIAL_ITEM, stepIndex, type RadialFan } from "@/motion/radialLayout";
import { spring, stagger, tween } from "@/motion/tokens";
import { TextRoll } from "@/motion/TextRoll";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button, type ButtonSize } from "@/primitives/Button";

export interface RadialTarget {
  id: string;
  /** Word of the target (German): the accessible name, and what the trigger shows while the target is active. */
  label: string;
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
  /** Symbol of the trigger (the callers pass the share glyph of `@/social/ui`). */
  icon?: ReactNode;
  size?: ButtonSize;
  className?: string;
  testId?: string;
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
 * - Motion: targets leave the trigger centre one after another (`spring.pop`, `stagger.cards`), and return on `tween.exit`;
 *   transform / opacity only. Reduced motion: they are simply there.
 * - The fan is a fixed layer in `<body>` (a dialog's scroll box cannot clip it); it is exempt from the dialog's inert rule
 *   (`data-radial-share`, `INERT_EXEMPT_SELECTOR`). A pointer press anywhere else, a resize or a scroll that moves the trigger closes it.
 */
export function RadialShare({ targets, label = "Teilen", icon, size = "sm", className, testId = "share-button" }: RadialShareProps) {
  const reduced = useReducedFx();
  const uid = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [fan, setFan] = useState<(RadialFan & { ox: number; oy: number }) | null>(null);
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
    const f = fanLayout({ n: targets.length, origin: o, viewport: viewport(), hub: { w: r.width, h: r.height } });
    setFan({ ...f, ox: o.x, oy: o.y });
    setActive(-1);
    setOpen(true);
  }, [targets.length]);

  // focus moves into the fan once it is mounted; the first enabled target is the roving tab stop
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useLayoutEffect(() => {
    if (open && firstEnabled >= 0) itemRefs.current[firstEnabled]?.focus({ preventScroll: true });
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
        {icon}
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
                          "pointer-events-auto absolute grid place-items-center rounded-full border border-line-2 bg-ink-800 text-fg shadow-[0_10px_30px_rgb(0_0_0/0.45)] transition-colors",
                          "hover:bg-ink-700 focus-visible:outline-none focus-visible:border-fg/70 [&>svg]:size-5",
                          t.disabled && "cursor-not-allowed opacity-45",
                        )}
                        style={{ width: RADIAL_ITEM, height: RADIAL_ITEM, left: -RADIAL_ITEM / 2, top: -RADIAL_ITEM / 2 }}
                        initial={reduced ? { x: o.x, y: o.y } : { x: 0, y: 0, scale: 0.3, opacity: 0 }}
                        animate={{ x: o.x, y: o.y, scale: 1, opacity: 1 }}
                        exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { x: 0, y: 0, scale: 0.3, opacity: 0, transition: tween.exit }}
                        transition={reduced ? { duration: 0 } : { default: { ...spring.pop, delay: i * stagger.cards }, opacity: { ...tween.fade, delay: i * stagger.cards } }}
                        onPointerEnter={(e) => e.pointerType === "mouse" && !t.disabled && setActive(i)}
                        onFocus={() => !t.disabled && setActive(i)}
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
