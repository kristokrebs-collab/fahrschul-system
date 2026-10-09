import { useEffect, useState, type RefObject } from "react";

export interface BoxSize {
  w: number;
  h: number;
}

/**
 * Content-box size of `ref` from its own ResizeObserver (rounded px) — never a layout read in render or per frame. A
 * 0 × 0 report (the element sits on a hidden keep-alive page) is ignored, so a re-show never redraws from zero.
 * `null` until the first report (and where ResizeObserver is missing).
 */
export function useBoxSize(ref: RefObject<HTMLElement | null>): BoxSize | null {
  const [size, setSize] = useState<BoxSize | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1]?.contentRect;
      if (!r || r.width < 1 || r.height < 1) return;
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
