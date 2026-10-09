import { useId, useMemo, useRef, useState } from "react";
import { useIntroLanded } from "@/intro/introStore";
import { compoundLabel, type Projection } from "@/domain/account";
import { explain } from "@/domain/explain";
import { cn } from "@/lib/cn";
import { colorClass, n0, n1, pct } from "@/lib/format";
import { MotionNumber } from "@/motion/MotionNumber";
import { Reveal } from "@/motion/Reveal";
import { stagger, tween } from "@/motion/tokens";
import { useBoxSize } from "@/primitives/boxSize";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { Collapse, Expander } from "@/primitives/Expander";
import { useReducedFx } from "@/motion/useReducedFx";
import { useAccountView, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { ExplanationView } from "./explainer";
import { useMilestoneRail } from "./projectionTimeline";

export const PROJECTION_TITLE = "Hochrechnung aufs Jahr";
export const PROJECTION_EMPTY_TITLE = "Noch nichts hochzurechnen";
export const PROJECTION_EMPTY_TEXT = "Mit dem ersten abgeschlossenen Trade rechne ich deine Rendite auf 12 Monate hoch.";
export const PROJECTION_WEAK = "Wenig Daten. Belastbar ab etwa 30 Tagen und 10 Trades.";

/** The free height of the card (zero basis: never adds height); the path is drawn from 36 px up. */
const PATH_MIN_H = 36;
const PATH_PAD = 6;

export interface ProjectionGeometry {
  linear: string;
  compound: string;
  /** "heute": x / y in px */
  now: { x: number; y: number };
}

/**
 * Projection paths in a `w × h` box over 12 months from the start capital: linear (`start · (1 + linear · t)`) and
 * compounded (`start · (1 + comp)^t`), y from the lower of start / ends to the higher; `now` = the elapsed share of the
 * year at `start · (1 + r)`. `null` without room.
 */
export function projectionGeometry(p: Pick<Projection, "linear" | "comp" | "r" | "days">, w: number, h: number): ProjectionGeometry | null {
  if (w < 40 || h < PATH_MIN_H) return null;
  const N = 24;
  const lin = (t: number) => 1 + p.linear * t;
  const cmp = (t: number) => Math.max(0, Math.pow(Math.max(0, 1 + p.comp), t));
  const tNow = Math.min(1, p.days / 365);
  const vals = [1, lin(1), cmp(1), 1 + p.r];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (t: number) => t * (w - 2 * PATH_PAD) + PATH_PAD;
  const y = (v: number) => PATH_PAD + ((hi - v) / span) * (h - 2 * PATH_PAD);
  const path = (f: (t: number) => number) => Array.from({ length: N + 1 }, (_, i) => `${i ? "L" : "M"}${x(i / N).toFixed(1)},${y(f(i / N)).toFixed(1)}`).join("");
  return { linear: path(lin), compound: path(cmp), now: { x: x(tNow), y: y(1 + p.r) } };
}

/**
 * `Pfad` (design pass v3): the projection drawn in the card's FREE height — the straight linear line, the compounded
 * curve dashed, and "heute" where the account stands on it. A zero-basis flex item: it only takes height the grid
 * row gives the card beyond its content (next to the taller Backtest card), never adds any; under 36 px nothing.
 */
function ProjectionPath({ p }: { p: Projection }) {
  const box = useRef<HTMLDivElement>(null);
  const size = useBoxSize(box);
  const geo = useMemo(() => (size ? projectionGeometry(p, size.w, size.h - 16) : null), [p, size]);
  return (
    <div ref={box} className="relative mt-3 min-h-0 flex-1 basis-0" aria-hidden="true" data-testid="projection-path">
      {geo && size && (
        <>
          <svg width={size.w} height={size.h - 16} className="absolute inset-x-0 top-0 overflow-visible">
            {Math.abs(p.comp - p.linear) >= 0.02 && <path d={geo.compound} fill="none" stroke="#5f5f5f" strokeWidth="1.25" strokeDasharray="3 4" />}
            <path d={geo.linear} fill="none" stroke="#f2f2f2" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx={geo.now.x} cy={geo.now.y} r="3.5" className="fill-signal" />
          </svg>
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 font-mono text-[10px] text-faint">
            <span>Start</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="size-[5px] rounded-full bg-signal" />
                heute
              </span>
              {/* the compounded curve only when it parts visibly from the linear line */}
              {Math.abs(p.comp - p.linear) >= 0.02 && (
                <span className="flex items-center gap-1.5">
                  <svg width="12" height="2" className="overflow-visible">
                    <path d="M0 1H12" stroke="#5f5f5f" strokeWidth="1.25" strokeDasharray="3 2" />
                  </svg>
                  Zinseszins
                </span>
              )}
            </span>
            <span>12 Monate</span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * `Hochrechnung aufs Jahr` (Bundle `She`, Plan 6.1): linear `MotionNumber` % that counts up from 0 the first time
 * the card is in view, dl rows cascading in under it as milestones on a rail whose segments and dots draw with the
 * scroll (pulse `product-timeline`, after the intro cell landed), weak-data warning last, expander →
 * `explain("projection")`.
 */
export function ProjectionCard() {
  const settings = useJournal((s) => s.settings);
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const p = view.proj;
  const cur = settings.currency;
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const list = useRef<HTMLDListElement>(null);
  const landed = useIntroLanded();
  const reduced = useReducedFx();
  // reduced motion: the rail is drawn at once; otherwise it starts empty and draws with the scroll
  const railStatic = reduced ? 1 : 0;

  const rows: [string, string, string][] = p
    ? [
        ["Rendite bisher", pct(p.r), colorClass(p.r)],
        ["Ø pro Monat", pct(p.monthly), colorClass(p.monthly)],
        ["Konto in 12 Monaten", `${n0(p.endLin)} ${cur}`, "text-fg"],
        ["Mit Zinseszins", compoundLabel(p.comp, pct), colorClass(p.comp)],
        ["Trades pro Woche", n1(p.perWeek), "text-fg"],
      ]
    : [];
  useMilestoneRail(list, landed && !reduced && p != null, rows.length);

  return (
    <Card title={PROJECTION_TITLE} action={<Expander open={open} onToggle={() => setOpen((o) => !o)} label="Hochrechnung" controls={regionId} />}>
      {p ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn("font-mono text-[38px] font-medium leading-none tracking-tight", colorClass(p.linear))}>
            <MotionNumber value={p.linear * 100} decimals={1} signed countOnReveal transition={tween.gauge} />
            <span className="text-xl text-mute"> %</span>
          </div>
          <div className="mt-1.5 text-xs text-mute">in 12 Monaten bei gleicher Performance, linear</div>
          <dl ref={list} className="relative mt-4 grid pl-5 text-[13px]">
            {/* milestone rail (pulse `product-timeline`): placed and driven by `useMilestoneRail` */}
            <span aria-hidden="true" data-tl-rail="" className="pointer-events-none absolute left-[6px] top-0 h-0 w-px bg-line-2" />
            {rows.slice(1).map(([l]) => (
              <span key={l} aria-hidden="true" data-tl-stem="" className="pointer-events-none absolute left-[6px] top-0 h-0 w-px origin-top bg-signal/80" style={{ transform: `scaleY(${railStatic})` }} />
            ))}
            {rows.map(([l]) => (
              <span key={l} aria-hidden="true" data-tl-dot="" className="pointer-events-none absolute left-[3px] top-0 -mt-[3.5px] size-[7px] rounded-full border border-line-2 bg-ink-900">
                <span className="absolute -inset-px rounded-full bg-signal" style={{ transform: `scale(${railStatic})` }} />
              </span>
            ))}
            {rows.map(([l, v, cls], i) => (
              <Reveal key={l} index={i} delay={stagger.lead} data-tl-row="" className="flex justify-between gap-3 border-t border-line py-2">
                <dt className="text-mute">{l}</dt>
                <dd className={cn("num font-mono font-medium", cls)}>{v}</dd>
              </Reveal>
            ))}
          </dl>
          {p.weak && (
            <Reveal index={rows.length} delay={stagger.lead} className="mt-2 rounded-lg bg-warn/10 px-3 py-2 text-[11.5px] text-warn">
              {PROJECTION_WEAK}
            </Reveal>
          )}
          <ProjectionPath p={p} />
        </div>
      ) : (
        <EmptyState title={PROJECTION_EMPTY_TITLE} text={PROJECTION_EMPTY_TEXT} />
      )}
      <Collapse open={open} id={regionId}>
        <ExplanationView d={explain("projection", view, settings)} />
      </Collapse>
    </Card>
  );
}
