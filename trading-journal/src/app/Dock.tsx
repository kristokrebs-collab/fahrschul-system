import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { createContext, useContext, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { radius, spring, tween } from "@/motion/tokens";
import { usePressable } from "@/motion/usePressable";
import { useReducedFx } from "@/motion/useReducedFx";
import { Icon, type IconName } from "@/primitives/icons";
import { Magnetic } from "@/primitives/Magnetic";
import { navigate } from "@/store/router";
import { PAGES, useUi, type Page } from "@/store/uiStore";

/** Bundle `Dhe`. */
export const PAGE_LABELS: Record<Page, string> = { overview: "Übersicht", trades: "Trades", setups: "Entscheidungsgrundlagen", settings: "Einstellungen" };
export const FAB_LABEL = "Trade eintragen";
const PAGE_ICON: Record<Page, IconName> = { overview: "grid", trades: "list", setups: "target", settings: "sliders" };

/** Bundle `i2` defaults. */
export const DOCK = { magnification: 64, distance: 140, panelHeight: 60, base: 44 } as const;

interface DockCtx {
  mouseX: MotionValue<number>;
  enabled: boolean;
}
const Ctx = createContext<DockCtx>({ mouseX: null as unknown as MotionValue<number>, enabled: false });

export interface DockItemProps {
  label: string;
  onClick: () => void;
  active?: boolean;
  /** Renders the `dock-bg` / `dock-dot` shared-layout markers when active. */
  tab?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Bundle `Kw`: 44 → 64 px magnification from the mouse distance (`useTransform` + `useSpring(spring.dock)`),
 * tooltip above, `aria-current="page"`, NEW `dock-bg` pill and `whileTap {scale:.94}`.
 */
export function DockItem({ label, onClick, active = false, tab = false, className, children }: DockItemProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const { mouseX, enabled } = useContext(Ctx);
  const [hovered, setHovered] = useState(false);
  const press = usePressable({ scale: 0.94 });

  // motion-exception: dock-magnify — width/height follow the mouse (Plan 3.2 rule 1, declared in Plan 3.3);
  // mouse pointers only and off under reduced motion (`enabled`).
  const dist = useTransform(mouseX, (x) => {
    if (!enabled) return Infinity;
    const r = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return x - r.x - r.width / 2;
  });
  const target = useTransform(dist, [-DOCK.distance, 0, DOCK.distance], [DOCK.base, DOCK.magnification, DOCK.base] as number[]);
  const size = useSpring(target, spring.dock);
  const iconSize = useTransform(size, (s) => s / 2.2);

  return (
    <motion.button
      ref={ref}
      type="button"
      style={{ width: size, height: size }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      // keyboard focus only: a tap / click also focuses the button, and on touch devices nothing would ever hide the tooltip
      onFocus={(e) => setHovered(e.currentTarget.matches(":focus-visible"))}
      onBlur={() => setHovered(false)}
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      whileTap={press.whileTap}
      transition={press.transition}
      className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-200", className)}
    >
      <AnimatePresence>
        {hovered && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, y: 0 }}
            animate={{ opacity: 1, y: -10 }}
            exit={{ opacity: 0, y: 0 }}
            transition={tween.tooltipIn}
            className="pointer-events-none absolute -top-7 left-1/2 w-fit whitespace-pre rounded-md border border-line-2 bg-ink-800 px-2 py-0.5 text-xs text-fg"
            style={{ x: "-50%" }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
      {tab && (
        <AnimatePresence initial={false}>
          {active && (
            <motion.span
              key="bg"
              layoutId="dock-bg"
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-white"
              style={{ borderRadius: radius.pill }}
              transition={spring.layout}
            />
          )}
        </AnimatePresence>
      )}
      <motion.span style={{ width: iconSize }} className="relative z-10 flex items-center justify-center">
        <Magnetic intensity={0.5} range={60} className="size-full items-center justify-center [&_svg]:size-full">
          {children}
        </Magnetic>
      </motion.span>
      {tab && (
        <AnimatePresence initial={false}>
          {active && (
            <motion.span
              key="dot"
              layoutId="dock-dot"
              aria-hidden="true"
              className="absolute -bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-signal"
              style={{ borderRadius: radius.pill }}
              transition={spring.layout}
            />
          )}
        </AnimatePresence>
      )}
    </motion.button>
  );
}

/**
 * macOS-style dock (Bundle `i2`, Plan 2.5 "Dock", 6.6): four tabs + divider + FAB. `role="toolbar"
 * aria-label="Navigation"`. Magnification runs only for `pointerType === "mouse"` and never under reduced motion.
 */
export function Dock() {
  const page = useUi((s) => s.page);
  const editor = useUi((s) => s.editor);
  const openEditor = useUi((s) => s.openEditor);
  const reduced = useReducedFx();
  const [mouse, setMouse] = useState(false);
  const enabled = mouse && !reduced;

  const mouseX = useMotionValue(Infinity);
  const hover = useMotionValue(0);
  const panelMax = Math.max(96, DOCK.magnification + DOCK.magnification / 2 + 4);
  const heightTarget = useTransform(hover, [0, 1], [DOCK.panelHeight, panelMax]);
  const height = useSpring(heightTarget, spring.dock);

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || reduced) return;
    if (!mouse) setMouse(true);
    hover.set(1);
    mouseX.set(e.clientX);
  };
  const onPointerLeave = () => {
    hover.set(0);
    mouseX.set(Infinity);
  };

  const fabVisible = !(editor.open && editor.fromFab);

  return (
    <nav className="fixed inset-x-0 bottom-[calc(12px+env(safe-area-inset-bottom,0px))] z-50 flex justify-center" aria-label="Navigation">
      {/* motion-exception: dock-magnify — the panel height follows the magnified items (Bundle i2). */}
      <motion.div style={{ height, scrollbarWidth: "none" }} className="mx-2 flex max-w-full items-end">
        <motion.div
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          role="toolbar"
          aria-label="Navigation"
          style={{ height: DOCK.panelHeight }}
          className="mx-auto flex w-fit items-end gap-3 rounded-2xl border border-line-2 bg-ink-850/[0.97] px-3 pb-2 shadow-[0_18px_40px_rgb(0_0_0/0.5)]"
        >
          <Ctx.Provider value={{ mouseX, enabled }}>
            {PAGES.map((p) => (
              <DockItem key={p} tab label={PAGE_LABELS[p]} active={page === p} onClick={() => navigate(p)} className={page === p ? "text-ink-950" : "bg-white/[0.05] text-mute hover:text-fg"}>
                <Icon name={PAGE_ICON[p]} />
              </DockItem>
            ))}
            <span className="mb-2.5 h-7 w-px self-end bg-line-2" aria-hidden="true" />
            <DockItem label={FAB_LABEL} onClick={() => openEditor({ fromFab: true })} className="text-ink-950">
              {fabVisible && (
                <motion.span
                  layoutId="new-trade"
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-gradient-to-br from-[#ff3b47] to-signal"
                  style={{ borderRadius: radius.fab }}
                  transition={{ layout: spring.sheet }}
                />
              )}
              <Icon name="plus" className="relative z-10" />
            </DockItem>
          </Ctx.Provider>
        </motion.div>
      </motion.div>
    </nav>
  );
}
