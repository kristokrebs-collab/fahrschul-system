import { motion, type Variants } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useIntroLanded } from "@/intro/introStore";
import { cn } from "@/lib/cn";
import { canObserveInView, observeInView } from "@/motion/inView";
import { TactileHighlight } from "@/motion/pulse/TactileHighlight";
import { StaggerItem, STAGGER_HIDDEN, STAGGER_SHOWN, withSectionStagger } from "@/motion/Stagger";
import { stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { FormulaBlock, FormulaRows, type FormulaRow } from "@/primitives/FormulaBlock";

export type VerdictTone = "win" | "loss" | "warn" | "mute";

export const verdictTone: Record<VerdictTone, string> = {
  win: "border-win/30 bg-win/[0.07] text-win",
  loss: "border-loss/30 bg-loss/[0.07] text-loss",
  warn: "border-warn/30 bg-warn/[0.07] text-warn",
  mute: "border-line-2 bg-white/[0.03] text-mute",
};

/** Light band of the tone sweep (transparent → tone → transparent). */
const SWEEP_BAND: Record<VerdictTone, string> = {
  win: "via-win/25",
  loss: "via-loss/25",
  warn: "via-warn/25",
  mute: "via-white/10",
};

/**
 * The sweep starts once the verdict has faded in: it is the 4th section of an explainer cascade (what → formula →
 * rows → verdict) after the overlay body's own delay, plus the verdict beat.
 */
const SWEEP = { ...tween.draw, delay: tween.body.delay + 3 * stagger.sections + tween.verdict.delay };

export interface VerdictPanelProps {
  tone: VerdictTone;
  children: ReactNode;
  className?: string;
}

/**
 * Plan 2.5 "Verdict-Panel": `rounded-xl border px-3 py-2 text-[13px]` + tone. When it first scrolls into view (and
 * whenever its tone changes) a band in the tone colour sweeps across it once – transform only, clipped by the panel.
 * Reduced motion: no sweep.
 */
export function VerdictPanel({ tone, children, className }: VerdictPanelProps) {
  const reduced = useReducedFx();
  return (
    <p className={cn("relative isolate overflow-hidden rounded-xl border px-3 py-2 text-[13px]", verdictTone[tone], className)}>
      {!reduced && (
        <motion.span
          key={tone}
          aria-hidden="true"
          className={cn("pointer-events-none absolute inset-y-0 left-0 -z-10 w-2/3 bg-gradient-to-r from-transparent to-transparent", SWEEP_BAND[tone])}
          initial={{ x: "-100%" }}
          whileInView={{ x: "160%" }}
          viewport={{ once: true }}
          transition={SWEEP}
        />
      )}
      {children}
    </p>
  );
}

/** A verdict lead longer than this is a sentence, not a key word – no marker then. */
const KEY_MAX_CHARS = 26;
const KEY_MAX_WORDS = 4;

/**
 * Key word of a verdict: its lead up to the first `:` or `.` when that lead is short (`Im Plus`, `Unter 1`,
 * `Zwischen 1,5 und 2`, `Kein Warnsignal`); `null` for sentence verdicts (`Du liegst …`) and for leads ending in a
 * number's decimal point. `sep` keeps the punctuation outside the marker.
 */
export function verdictKey(text: string): { key: string; sep: string; rest: string } | null {
  const m = /^([^.:]+?)([.:])(\s|$)/.exec(text);
  if (!m) return null;
  const key = m[1]!.trim();
  if (!key || key.length > KEY_MAX_CHARS || key.split(/\s+/).length > KEY_MAX_WORDS) return null;
  return { key, sep: m[2]!, rest: text.slice(m[0].length - m[3]!.length) };
}

/**
 * The key word's marker (pulse `tactile-highlight`) wipes in once the verdict is in view and the intro cell has
 * landed, after the verdict's own entrance beat (`SWEEP.delay`), so it never wipes over text that is still fading in.
 */
function VerdictKey({ children }: { children: string }) {
  const landed = useIntroLanded();
  const reduced = useReducedFx();
  const ref = useRef<HTMLSpanElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (on || !landed || !el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      if (timer !== undefined) return;
      timer = setTimeout(() => setOn(true), reduced ? 0 : SWEEP.delay * 1000);
    };
    const stop = canObserveInView()
      ? observeInView(el, (inView) => {
          if (inView) start();
        })
      : (start(), () => {});
    return () => {
      stop();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [on, landed, reduced]);
  return (
    // no tab: its ~90 ms pop 1.38 em to the left would cross the panel's padding and border
    <span ref={ref} className="inline-block">
      <TactileHighlight active={on} tab={false}>
        {children}
      </TactileHighlight>
    </span>
  );
}

/** Verdict text with its key word marked (string verdicts with a short lead); anything else renders as given. */
export function VerdictText({ text }: { text: ReactNode }) {
  if (typeof text !== "string") return <>{text}</>;
  const k = verdictKey(text);
  if (!k) return <>{text}</>;
  return (
    <>
      <VerdictKey>{k.key}</VerdictKey>
      {k.sep}
      {k.rest}
    </>
  );
}

export interface ExplainerData {
  title?: string;
  /** Plain-language description (`max-w-[70ch] text-[13px] leading-relaxed text-mute`). */
  what: ReactNode;
  formula?: ReactNode;
  rows?: readonly FormulaRow[];
  verdict?: { tone: VerdictTone; text: ReactNode } | null;
}

/** A framed (card) explainer cascades its own sections when it mounts – e.g. when its `Collapse` opens. */
const FRAMED: Variants = {
  [STAGGER_HIDDEN]: {},
  [STAGGER_SHOWN]: { transition: withSectionStagger(tween.reveal) },
};

/**
 * Bundle `vi`: fact explainer (what · formula · rows · verdict). The four sections cascade in (`StaggerItem`,
 * `stagger.sections`): `bare` (inside a MorphDialog / Sheet) inherits the overlay body's stagger, the framed variant
 * runs its own when it mounts. `bare` skips the framed card and title.
 */
export function Explainer({ d, bare = false, className }: { d: ExplainerData; bare?: boolean; className?: string }) {
  const sections = (
    <>
      {!bare && d.title && (
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
          <span className="label !text-fg">{d.title}</span>
        </div>
      )}
      <StaggerItem>
        <p className="max-w-[70ch] text-[13px] leading-relaxed text-mute">{d.what}</p>
      </StaggerItem>
      {d.formula && (
        <StaggerItem>
          <FormulaBlock>{d.formula}</FormulaBlock>
        </StaggerItem>
      )}
      {d.rows && d.rows.length > 0 && (
        <StaggerItem>
          <FormulaRows rows={d.rows} />
        </StaggerItem>
      )}
      {d.verdict && (
        <StaggerItem>
          <VerdictPanel tone={d.verdict.tone} className="text-[12.5px]">
            <VerdictText text={d.verdict.text} />
          </VerdictPanel>
        </StaggerItem>
      )}
    </>
  );
  if (bare) return <div className={cn("grid gap-3", className)}>{sections}</div>;
  return (
    <motion.div
      className={cn("mt-3 grid gap-3 rounded-2xl border border-line-2 bg-gradient-to-b from-ink-750 to-ink-850 p-4", className)}
      variants={FRAMED}
      initial={STAGGER_HIDDEN}
      animate={STAGGER_SHOWN}
    >
      {sections}
    </motion.div>
  );
}
