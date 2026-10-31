/**
 * Keeps the editor's save bar above the on-screen keyboard. `--vv-bottom` (`installViewportInset`) deliberately ignores
 * keyboard-sized gaps (the dock stays behind the keyboard, as on iOS); a sheet with a footer must not: its `Speichern`
 * would sit under the keyboard while the trader types. While `active` this writes the gap between the layout viewport's
 * bottom and the visual viewport's bottom as `--kb-inset` on `<html>`; the editor's panel reads it as a bottom margin, so
 * the body shrinks (it scrolls anyway) and the footer rides on top of the keyboard. 0 without a keyboard – the sheet is
 * then laid out exactly as before.
 */
import { useEffect } from "react";
import { VV_KEYBOARD_MIN } from "@/app/pwa";

/** Pure: the keyboard's height as the visual viewport reports it, 0 below `VV_KEYBOARD_MIN` (browser toolbars), while pinch-zoomed, or without a visual viewport. */
export function keyboardInset(innerHeight: number, vv: { offsetTop: number; height: number; scale: number } | null | undefined): number {
  if (!vv || !Number.isFinite(innerHeight) || !Number.isFinite(vv.height)) return 0;
  if (vv.scale > 1.01) return 0;
  const raw = Math.round(innerHeight - (vv.offsetTop + vv.height));
  return raw >= VV_KEYBOARD_MIN ? raw : 0;
}

export const KEYBOARD_VAR = "--kb-inset";

/** Writes `--kb-inset` on `<html>` while `active` (one rAF-coalesced write per change, removed again on close). */
export function useKeyboardInset(active: boolean): void {
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let raf = 0;
    let last = -1;
    const apply = () => {
      raf = 0;
      const px = keyboardInset(window.innerHeight, vv);
      if (px === last) return;
      last = px;
      if (px > 0) root.style.setProperty(KEYBOARD_VAR, `${px}px`);
      else root.style.removeProperty(KEYBOARD_VAR);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const opts: AddEventListenerOptions = { passive: true };
    vv.addEventListener("resize", schedule, opts);
    vv.addEventListener("scroll", schedule, opts);
    schedule();
    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      if (raf) cancelAnimationFrame(raf);
      root.style.removeProperty(KEYBOARD_VAR);
    };
  }, [active]);
}
