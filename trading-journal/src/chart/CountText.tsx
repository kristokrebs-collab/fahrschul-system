import { animate } from "motion/react";
import { useLayoutEffect, useRef } from "react";
import { useIntroGate } from "@/intro/introStore";
import { observeInView } from "@/motion/inView";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { isRich } from "./rich";

/**
 * A figure that is already text ("+0,42 R", "−140 USDT", "45 %", "1.232,00") counts up on the rich pages (Runde 10): from 0 to
 * its value the first time it is seen, and from the old to the new value when it changes (a short green / red wash marks
 * the direction). The number inside the text is found by a pattern – exactly ONE number token, otherwise (dates, ranges,
 * "11 / 20") the text stays as it is. The DOM text is the final text at every moment it is not counting; the Übersicht and
 * the Cockpit (no `data-rich` above) and reduced motion never count. Text is written to one node per frame, no React render.
 */
export interface CountParts {
  pre: string;
  post: string;
  /** the signed value ("−0,42" → −0.42) */
  value: number;
  decimals: number;
  grouped: boolean;
  /** the text carries a "+" sign for positive values */
  plus: boolean;
  /** the glyph used for negatives ("−" or "-") */
  minus: string;
}

const TOKEN = /([+−-]?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?/g;

/** Splits a German formatted text into prefix, the one number and suffix; `null` when there is no or more than one number. */
export function parseCount(text: string): CountParts | null {
  const hits = [...text.matchAll(TOKEN)];
  if (hits.length !== 1) return null;
  const m = hits[0]!;
  const sign = m[1] ?? "";
  const int = m[2] ?? "";
  const frac = m[3] ?? "";
  const value = Number(`${int.replace(/\./g, "")}${frac ? `.${frac}` : ""}`) * (sign === "+" || sign === "" ? 1 : -1);
  if (!Number.isFinite(value)) return null;
  const at = m.index ?? 0;
  return { pre: text.slice(0, at), post: text.slice(at + m[0].length), value, decimals: frac.length, grouped: int.includes("."), plus: sign === "+", minus: sign === "-" ? "-" : "−" };
}

/** The text of a parsed figure at the value `v` (same decimals, grouping and sign style). */
export function countText(p: CountParts, v: number): string {
  const body = Math.abs(v).toLocaleString("de-DE", { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals, useGrouping: p.grouped });
  const shown = Number(Math.abs(v).toFixed(p.decimals));
  const sign = v < 0 && shown !== 0 ? p.minus : p.plus && v >= 0 ? "+" : "";
  return `${p.pre}${sign}${body}${p.post}`;
}

/** Keys that counted up once this session (a page that remounts shows its figures at once the second time). */
const COUNTED = new Set<string>();

const WASH = { up: "color-mix(in srgb, var(--color-win, #3ddc84) 20%, transparent)", down: "color-mix(in srgb, var(--color-loss, #ff4d4f) 20%, transparent)" } as const;

export interface CountTextProps {
  text: string;
  className?: string;
  /** count only the first time this key is seen in the session (later mounts show the value at once) */
  revealKey?: string;
  /** keep the width of the final text while counting (inline figures in a row) */
  reserve?: boolean;
}

export function CountText({ text, className, revealKey, reserve }: CountTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedFx();
  const gate = useIntroGate();
  /** the value the text settled on after the last effect */
  const settled = useRef<number | null>(null);
  /** the first count-up has started (or was skipped): later changes roll from the old value */
  const firstDone = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parts = parseCount(text);
    const before = settled.current;
    settled.current = parts ? parts.value : null;
    el.textContent = text;
    if (!parts || reduced || !gate || !isRich(el)) return;
    let run: { stop: () => void } | null = null;
    let off = () => {};
    const finish = () => {
      el.textContent = text;
      el.style.minWidth = "";
      if (reserve) el.style.display = "";
    };
    const count = (from: number, to: number, wash: boolean) => {
      const dir = to >= from ? "up" : "down";
      if (reserve) {
        el.style.display = "inline-block";
        el.style.minWidth = `${text.length}ch`;
      }
      run = animate(from, to, {
        duration: tween.draw.duration,
        ease: tween.draw.ease,
        onUpdate: (v) => {
          el.textContent = countText(parts, v);
        },
        onComplete: finish,
      });
      if (wash && typeof el.animate === "function" && to !== from) el.animate([{ backgroundColor: WASH[dir], borderRadius: "4px" }, { backgroundColor: "transparent", borderRadius: "4px" }], { duration: tween.flash.duration * 1000, easing: "ease-out" });
    };
    if (firstDone.current) {
      // a later change: roll from what was there
      if (before !== null && before !== parts.value) count(before, parts.value, true);
    } else if (revealKey && COUNTED.has(revealKey)) {
      firstDone.current = true;
    } else {
      // first time: rest at 0 until the figure is on screen, then count up
      el.textContent = countText(parts, 0);
      off = observeInView(el, (inView) => {
        if (!inView) return;
        off();
        firstDone.current = true;
        if (revealKey) COUNTED.add(revealKey);
        count(0, parts.value, false);
      });
    }
    return () => {
      off();
      run?.stop();
      el.textContent = text;
      el.style.minWidth = "";
    };
  }, [text, reduced, gate, revealKey, reserve]);

  return <span ref={ref} className={className} />;
}
