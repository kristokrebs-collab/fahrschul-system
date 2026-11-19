/**
 * The crosshair of the rich Monte-Carlo fan: a hairline, three dots (P95 / Median / P05 of ALL runs after the chosen trade)
 * and one small readout. Pointer, touch (horizontal drag, a vertical swipe still scrolls) and keyboard (← → one trade,
 * Shift or PageUp / PageDown ten, Home / End, Esc) drive the same `place()`; it only writes transforms, opacity and text to
 * a handful of DOM nodes (one rAF per pointer move) – the canvas is never redrawn for a hover. At rest the dots sit on the
 * last trade (the end of the fan) and fade in once the fan has been drawn.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import type { MonteCarloResult } from "@/domain/analytics";
import { fanFrame, stepAtX, stepStats } from "./fanDraw";
import type { FanGeometry } from "./MonteCarloCard";
import { unitText } from "./ui";

const TIP_W = 148;
const DOT = 7;
/** a glide that follows the pointer softly and never lags it (≈ 90 ms, ease-out) */
const GLIDE = "transform 90ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease-out";

type Writer = { geo: FanGeometry; res: MonteCarloResult; unit: "R" | "money"; cur: string };

export function useFanCursor({ wrap, res, geo, unit, cur, ready }: { wrap: RefObject<HTMLDivElement | null>; res: MonteCarloResult; geo: FanGeometry | null; unit: "R" | "money"; cur: string; ready: boolean }) {
  const line = useRef<HTMLDivElement>(null);
  const dots = useRef<(HTMLSpanElement | null)[]>([null, null, null]);
  const tip = useRef<HTMLDivElement>(null);
  const cells = useRef<Record<string, HTMLElement | null>>({});
  const step = useRef<number | null>(null);
  const active = useRef(false);
  const raf = useRef(0);
  const px = useRef(0);
  const latest = useRef<Writer | null>(null);
  // before the rest-position effect below (layout effects run in order)
  useLayoutEffect(() => {
    latest.current = geo ? { geo, res, unit, cur } : null;
  });

  const place = useCallback(
    (i: number, on: boolean) => {
      const w = latest.current;
      if (!w) return;
      const st = stepStats(w.res, i);
      if (!st) return;
      const f = fanFrame(w.geo, w.res);
      const x = f.x(i);
      if (line.current) {
        line.current.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
        line.current.style.opacity = on ? "1" : "0";
      }
      [st.p95, st.p50, st.p5].forEach((v, k) => {
        const d = dots.current[k];
        if (d) d.style.transform = `translate3d(${(x - DOT / 2).toFixed(1)}px,${(f.y(v) - DOT / 2).toFixed(1)}px,0)`;
      });
      const money = (v: number) => unitText(v, w.unit, w.cur);
      const set = (k: string, t: string) => {
        const c = cells.current[k];
        if (c && c.textContent !== t) c.textContent = t;
      };
      set("step", i === 0 ? "Start" : `Nach ${i} ${i === 1 ? "Trade" : "Trades"}`);
      set("p95", money(st.p95));
      set("p50", money(st.p50));
      set("p5", money(st.p5));
      if (tip.current) {
        const left = x > f.w / 2 ? x - 12 - TIP_W : x + 12;
        tip.current.style.transform = `translate3d(${Math.max(4, Math.min(f.w - TIP_W - 4, left)).toFixed(1)}px,8px,0)`;
        tip.current.style.opacity = on ? "1" : "0";
      }
      const el = wrap.current;
      if (el) {
        el.setAttribute("aria-valuenow", String(i));
        el.setAttribute("aria-valuetext", `Nach ${i} Trades: P95 ${money(st.p95)}, Median ${money(st.p50)}, P05 ${money(st.p5)}`);
      }
    },
    [wrap],
  );

  // rest position (the end of the fan) after every new picture / resize; keeps an active cursor where it is
  useLayoutEffect(() => {
    if (!geo) return;
    const n = res.horizon;
    if (!active.current) step.current = null;
    place(active.current ? Math.min(step.current ?? n, n) : n, active.current);
  }, [geo, res, unit, cur, place]);

  const rest = useCallback(() => {
    active.current = false;
    step.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    const w = latest.current;
    if (w) place(w.res.horizon, false);
  }, [place]);
  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    [],
  );

  const move = useCallback(
    (i: number) => {
      active.current = true;
      step.current = i;
      place(i, true);
    },
    [place],
  );

  const props = {
    role: "slider" as const,
    tabIndex: 0,
    "aria-label": "Verlauf der Perzentile, Trade für Trade ablesen",
    "aria-valuemin": 0,
    "aria-valuemax": res.horizon,
    "aria-valuenow": res.horizon,
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      const w = latest.current;
      if (!w || !ready) return;
      const r = e.currentTarget.getBoundingClientRect();
      px.current = e.clientX - r.left - e.currentTarget.clientLeft;
      if (raf.current) return;
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        const cur2 = latest.current;
        if (cur2) move(stepAtX(fanFrame(cur2.geo, cur2.res), px.current));
      });
    },
    onPointerLeave: rest,
    onPointerCancel: rest,
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      const w = latest.current;
      if (!w || !ready) return;
      const n = w.res.horizon;
      const at = step.current ?? n;
      let next: number;
      if (e.key === "ArrowLeft") next = at - (e.shiftKey ? 10 : 1);
      else if (e.key === "ArrowRight") next = at + (e.shiftKey ? 10 : 1);
      else if (e.key === "PageDown") next = at - 10;
      else if (e.key === "PageUp") next = at + 10;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = n;
      else if (e.key === "Escape") {
        rest();
        return;
      } else return;
      e.preventDefault();
      move(Math.max(0, Math.min(n, next)));
    },
    onFocus: (e: FocusEvent<HTMLDivElement>) => {
      let visible: boolean;
      try {
        visible = e.currentTarget.matches(":focus-visible");
      } catch {
        visible = false;
      }
      const w = latest.current;
      if (visible && w && ready) move(step.current ?? w.res.horizon);
    },
    onBlur: rest,
  };

  const layer: ReactNode = (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div ref={line} className="absolute inset-y-0 left-0 w-px bg-fg/30 opacity-0 motion-reduce:transition-none" style={{ transition: GLIDE }} />
      <div className="absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none" style={{ opacity: ready ? 1 : 0 }}>
        {(
          [
            ["bg-win", "P95"],
            ["bg-fg", "Median"],
            ["bg-loss", "P05"],
          ] as const
        ).map(([tone, label], k) => (
          <span
            key={label}
            ref={(el) => {
              dots.current[k] = el;
            }}
            className={`absolute left-0 top-0 rounded-full ring-2 ring-ink-950 ${tone} motion-reduce:transition-none`}
            style={{ width: DOT, height: DOT, transition: GLIDE }}
          />
        ))}
      </div>
      <div
        ref={tip}
        className="absolute left-0 top-0 rounded-lg border border-line-2 bg-ink-850/95 px-2.5 py-1.5 font-mono text-[11px] leading-[1.5] opacity-0 shadow-[0_10px_28px_rgb(0_0_0/calc(0.4*var(--shade,1)))] motion-reduce:transition-none"
        style={{ width: TIP_W, transition: GLIDE }}
      >
        <div ref={(el) => void (cells.current.step = el)} className="text-faint" />
        {(
          [
            ["p95", "P95"],
            ["p50", "Median"],
            ["p5", "P05"],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="flex justify-between gap-2">
            <span className="text-mute">{label}</span>
            <span ref={(el) => void (cells.current[k] = el)} className="num text-fg" />
          </div>
        ))}
      </div>
    </div>
  );

  return { layer, props };
}
