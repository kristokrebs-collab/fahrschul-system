import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { createFrameLoop, latestPointer } from "@/motion/pulse/engine";
import { stepSpring, springRests } from "@/motion/pulse/springStep";
import { canHoverNow } from "@/motion/pulse/textKit";
import { isScrolling } from "@/motion/scrollGate";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `dock` magnification remix as a generic row (group switcher, shortcut keys, tool bar) – the same model
 * as the app dock (`src/app/Dock.tsx`, untouched): a windowed Gaussian bell `e^(−d²/2σ²)` around the pointer scales
 * each item by up to `1 + magnify`, the row widens symmetrically about its centre (neighbours shift by transform –
 * the layout box never changes), the pointer is followed on `spring.dock`, the magnification amount on the pack's
 * 400 / 20 spring. Labels rise above the item under the pointer (pack: opacity τ ≈ 38 ms, 6 px rise).
 *
 * 120 Hz: item centres come from the props (fixed slots), the row rect is read once per pointer entry; pointer
 * events only store the latest coalesced x, one frame loop writes item transforms and sleeps when settled. Keyboard:
 * arrows / Home / End move a roving focus, the focused item magnifies like a hover. Hover devices only (touch: a
 * press dip); reduced motion: no magnification.
 */
export const CONFIG = {
  size: 44,
  gap: 6,
  magnify: 0.8,
  sigma: 48,
  distance: 140,
  amountSpring: { stiffness: 400, damping: 20, mass: 1 },
  /** label rise (px) and fade (ms) – pack tooltip */
  labelRise: 6,
  labelMs: 120,
  /** row padding (p-1.5) – slot centres are measured from the content box */
  pad: 6,
} as const;

/** Windowed Gaussian bell: 1 under the pointer, exactly 0 at `distance`. */
export function magnifyBell(d: number, distance: number = CONFIG.distance, sigma: number = CONFIG.sigma): number {
  const ad = Math.abs(d);
  if (!(ad < distance)) return 0;
  const g = (x: number) => Math.exp(-(x * x) / (2 * sigma * sigma));
  const floor = g(distance);
  return Math.max(0, (g(ad) - floor) / (1 - floor));
}

/**
 * Magnified geometry of `count` slots (`size` px, `gap` px apart, row-local centres) for a pointer at `pointer` px and
 * an `amount` 0..1: per slot the scale and the x shift that keeps the grown row centred on the original one.
 */
export function magnifyLayout(count: number, pointer: number, amount: number, size: number = CONFIG.size, gap: number = CONFIG.gap, magnify: number = CONFIG.magnify, sigma: number = CONFIG.sigma, distance: number = CONFIG.distance): { scale: number[]; shift: number[] } {
  const a = Math.max(0, Math.min(1, amount));
  const extra = Array.from({ length: count }, (_, i) => size * magnify * a * magnifyBell(pointer - (i * (size + gap) + size / 2), distance, sigma));
  const total = extra.reduce((s, e) => s + e, 0);
  const shift: number[] = [];
  let acc = -total / 2;
  for (let i = 0; i < count; i++) {
    const e = extra[i] ?? 0;
    shift.push(acc + e / 2);
    acc += e;
  }
  return { scale: extra.map((e) => 1 + e / size), shift };
}

export interface MagnifyItem {
  id: string;
  /** Accessible name and the floating label. */
  label: string;
  icon: ReactNode;
  onSelect?: () => void;
  active?: boolean;
  disabled?: boolean;
}

export interface MagnifyRowProps {
  items: readonly MagnifyItem[];
  /** Accessible name of the toolbar. */
  label: string;
  size?: number;
  gap?: number;
  magnify?: number;
  showLabels?: boolean;
  className?: string;
}

export function MagnifyRow({ items, label, size = CONFIG.size, gap = CONFIG.gap, magnify = CONFIG.magnify, showLabels = true, className }: MagnifyRowProps) {
  const reduced = useReducedFx();
  const rowRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [hot, setHot] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState(Math.max(0, items.findIndex((i) => i.active)));
  const st = useRef({ left: 0, pointer: { x: 0, v: 0 }, pointerTarget: 0, amount: { x: 0, v: 0 }, amountTarget: 0, n: items.length, size, gap, magnify, written: "" });
  useLayoutEffect(() => {
    Object.assign(st.current, { n: items.length, size, gap, magnify });
  });
  const loopRef = useRef<ReturnType<typeof createFrameLoop> | null>(null);

  useEffect(() => {
    const s = st.current;
    const write = () => {
      const { scale, shift } = magnifyLayout(s.n, s.pointer.x, s.amount.x, s.size, s.gap, s.magnify);
      const off = s.amount.x < 0.001;
      for (let i = 0; i < s.n; i++) {
        const sc = scale[i] ?? 1;
        const dx = (shift[i] ?? 0).toFixed(2);
        const el = itemRefs.current[i];
        if (el) el.style.transform = off ? "" : `translate3d(${dx}px,0,0) scale(${sc.toFixed(4)})`;
        const lb = labelRefs.current[i];
        if (lb) lb.style.transform = off ? "" : `translate3d(${dx}px,${(-(sc - 1) * s.size).toFixed(2)}px,0)`;
      }
    };
    const loop = createFrameLoop((dt) => {
      stepSpring(s.pointer, s.pointerTarget, spring.dock, dt);
      stepSpring(s.amount, s.amountTarget, CONFIG.amountSpring, dt);
      const rest = springRests(s.pointer, s.pointerTarget, 0.3, 2) && springRests(s.amount, s.amountTarget, 0.002, 0.02);
      if (rest) {
        s.pointer.x = s.pointerTarget;
        s.amount.x = s.amountTarget;
      }
      write();
      return !rest;
    });
    loopRef.current = loop;
    return () => loop.stop();
  }, []);

  const magnifyOn = !reduced;
  const aim = (x: number, jump: boolean) => {
    const s = st.current;
    s.pointerTarget = x;
    if (jump) {
      s.pointer.x = x;
      s.pointer.v = 0;
    }
    s.amountTarget = 1;
    loopRef.current?.wake();
  };
  const release = () => {
    const s = st.current;
    s.amountTarget = 0;
    loopRef.current?.wake();
  };
  const slotCenter = (i: number) => i * (size + gap) + size / 2;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = items.length;
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? (focusIdx + 1) % n : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (focusIdx - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    setFocusIdx(next);
    rowRef.current?.querySelectorAll<HTMLButtonElement>("[data-magnify-item]")[next]?.focus();
  };

  return (
    <div
      ref={rowRef}
      role="toolbar"
      aria-label={label}
      data-pulse="magnify-row"
      onKeyDown={onKeyDown}
      onPointerEnter={(e) => {
        if (!magnifyOn || e.pointerType !== "mouse" || isScrolling() || !canHoverNow()) return;
        st.current.left = e.currentTarget.getBoundingClientRect().left + CONFIG.pad;
        aim(e.clientX - st.current.left, st.current.amount.x < 0.01);
      }}
      onPointerMove={(e) => {
        if (!magnifyOn || e.pointerType !== "mouse") return;
        if (st.current.amountTarget === 0) st.current.left = e.currentTarget.getBoundingClientRect().left + CONFIG.pad;
        aim(latestPointer(e.nativeEvent).x - st.current.left, st.current.amount.x < 0.01);
      }}
      onPointerLeave={() => {
        setHot(null);
        release();
      }}
      className={cn("relative inline-flex items-end rounded-2xl border border-line bg-ink-900/80 p-1.5", className)}
      style={{ gap }}
    >
      {items.map((it, i) => (
        <span
          key={it.id}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          className="relative block origin-bottom"
          style={{ width: size, height: size }}
        >
          <button
            type="button"
            data-magnify-item=""
            aria-label={it.label}
            aria-pressed={it.active === undefined ? undefined : it.active}
            disabled={it.disabled}
            tabIndex={i === focusIdx ? 0 : -1}
            onClick={it.onSelect}
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse" && !isScrolling()) setHot(i);
            }}
            onFocus={(e) => {
              setFocusIdx(i);
              setHot(i);
              let keyboard: boolean;
              try {
                keyboard = e.currentTarget.matches(":focus-visible");
              } catch {
                keyboard = false; // engines without :focus-visible: no focus magnification
              }
              if (magnifyOn && keyboard) aim(slotCenter(i), st.current.amount.x < 0.01);
            }}
            onBlur={() => {
              setHot((h) => (h === i ? null : h));
              release();
            }}
            className={cn(
              "grid size-full place-items-center rounded-xl text-mute outline-none transition-[color,background-color] duration-150 hover:text-fg focus-visible:ring-2 focus-visible:ring-steel/60 active:scale-[0.94] disabled:opacity-40",
              it.active && "bg-ink-700 text-fg",
            )}
          >
            <span aria-hidden="true" className="grid place-items-center [&>svg]:size-[46%]">
              {it.icon}
            </span>
            {it.active && <span aria-hidden="true" className="absolute -bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-signal" />}
          </button>
        </span>
      ))}
      {showLabels && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0">
          {items.map((it, i) => (
            <span
              key={it.id}
              ref={(el) => {
                labelRefs.current[i] = el;
              }}
              className="absolute bottom-full block"
              style={{ left: CONFIG.pad + slotCenter(i) }}
            >
              <span
                className="mb-1.5 block -translate-x-1/2 whitespace-nowrap rounded-md border border-line-2 bg-ink-800 px-2 py-0.5 text-[11px] font-medium text-fg"
                style={{
                  opacity: hot === i ? 1 : 0,
                  translate: `0 ${hot === i ? 0 : CONFIG.labelRise}px`,
                  transition: reduced ? "none" : `opacity ${CONFIG.labelMs}ms cubic-bezier(0.22,1,0.36,1), translate ${CONFIG.labelMs * 2}ms cubic-bezier(0.22,1,0.36,1)`,
                }}
              >
                {it.label}
              </span>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
