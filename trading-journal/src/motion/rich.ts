import { Component, createContext, useContext, type ReactNode } from "react";
import { stagger } from "@/motion/tokens";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import "@/motion/rich/core.css";

/**
 * Runde 10 – "rich" pages. Every page layer except the Übersicht and the Cockpit carries `data-rich` (`PageHost`); the
 * same pages also provide `RichContext`, so a component can switch its richer behaviour on in code (a React context
 * crosses portals, a `closest("[data-rich]")` lookup does not) while the CSS side uses `[data-rich] …`. Outside a rich
 * page – the Übersicht, the Cockpit, the app chrome, a bare unit test – nothing here is on, and the component renders
 * exactly as before.
 *
 * Heavy rich parts (page aura, empty-state art, …) live in lazy chunks (`@/motion/rich/*`); this file stays tiny
 * because it is part of the first load.
 */
export const RichContext = createContext(false);

/** Pages that keep their exact picture (Startseite, Cockpit). Mirrors the `data-rich` attribute of the page layer. */
export const isRichPage = (page: string): boolean => page !== "overview" && page !== "cockpit";

/** `true` inside a rich page layer. */
export function useRich(): boolean {
  return useContext(RichContext);
}

/** Rich page AND motion allowed (`prefers-reduced-motion` off): the condition of every decorative rich effect. */
export function useRichFx(): boolean {
  const rich = useContext(RichContext);
  const reduced = useReducedFx();
  return rich && !reduced;
}

/**
 * Silent boundary around a decorative lazy part (page aura, empty-state art): when its chunk cannot be loaded (offline, an old tab
 * after a deploy) the decoration is simply absent – the page, its text and its actions are never taken down by it.
 */
export class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** A diagonal wave never waits for more than this many steps (a 6 × 6 grid lands in < 0.4 s). */
export const WAVE_MAX = 8;

/**
 * Diagonal wave: tiles on the same anti-diagonal (`col + row`) enter together, each diagonal `stagger.reveal` after the
 * last one, capped at `WAVE_MAX` steps. `base` is a delay in seconds before the first diagonal.
 */
export function waveDelay(col: number, row: number, base = 0): number {
  return base + Math.min(Math.max(0, col) + Math.max(0, row), WAVE_MAX) * stagger.reveal;
}

/** Columns of a responsive tile grid with Tailwind's breakpoints: 1 below `md` (768 px), `md` columns, `xl` (1280 px) columns. */
export function useGridCols(md: number, xl: number): number {
  const isXl = useMediaQuery("(min-width: 1280px)", true);
  const isMd = useMediaQuery("(min-width: 768px)", true);
  return isXl ? xl : isMd ? md : 1;
}

/** Column and row of the `i`-th tile of a grid with `cols` columns (row-major) – the input of `waveDelay`. */
export function gridCell(i: number, cols: number): { col: number; row: number } {
  const c = Math.max(1, Math.floor(cols));
  return { col: i % c, row: Math.floor(i / c) };
}
