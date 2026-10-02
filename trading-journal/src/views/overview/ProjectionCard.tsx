import { useId, useRef, useState } from "react";
import { useIntroLanded } from "@/intro/introStore";
import { compoundLabel } from "@/domain/account";
import { explain } from "@/domain/explain";
import { cn } from "@/lib/cn";
import { colorClass, n0, n1, pct } from "@/lib/format";
import { MotionNumber } from "@/motion/MotionNumber";
import { Reveal } from "@/motion/Reveal";
import { stagger, tween } from "@/motion/tokens";
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
        <div className="flex h-full flex-col">
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
