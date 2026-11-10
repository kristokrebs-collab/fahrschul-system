/**
 * One hit of „Ähnliche Situationen“ (F19) in a sheet: the situation on the real candles, the course after it played on by
 * the shared replay chart (`ReplayChart`, lazy) and `ScrubTimeline` (it opens on the situation – the candles after the hit
 * appear when you play or drag; nothing is drawn that was not known then until you ask), the features of the hit next to
 * the current situation, and what happened after (numbers from `outcome`). Nothing is written anywhere.
 */
import { motionValue } from "motion/react";
import { lazy, Suspense, useMemo } from "react";
import { FEATURES, featureValueText, firstTouchText, moveText, outcomeText, type FeatureId, type QueryInfo, type SimCandle, type SimilarHit, type SimUnit } from "@/domain/similar";
import { cn } from "@/lib/cn";
import { dateTime } from "@/lib/format";
import { ScrubTimeline } from "@/motion/pulse/ScrubTimeline";
import { Sheet, StaggerItem } from "@/motion/Sheet";
import { Skeleton } from "@/primitives/Skeleton";
import { hitModel } from "./similarModel";
import { SIM } from "./similarStrings";

const ReplayChart = lazy(() => import("@/chart/ReplayChart"));
const CHART_H = 280;
const FLAT = { side: "long", entry: 0, stop: null, target: null, exit: null, entryIndex: Number.MAX_SAFE_INTEGER, exitIndex: null, result: "open" } as const;

export interface SimilarHitSheetProps {
  hit: SimilarHit | null;
  onClose: () => void;
  closed: readonly SimCandle[];
  horizon: number;
  unit: SimUnit;
  features: readonly FeatureId[];
  query: QueryInfo | null;
}

export default function SimilarHitSheet({ hit, onClose, closed, horizon, unit, features, query }: SimilarHitSheetProps) {
  return (
    <Sheet open={hit != null} onClose={onClose} title={SIM.sheet.title} size="lg" dismissGuard={false}>
      {hit ? <Body key={hit.index} hit={hit} closed={closed} horizon={horizon} unit={unit} features={features} query={query} /> : null}
    </Sheet>
  );
}

function Body({ hit, closed, horizon, unit, features, query }: Omit<SimilarHitSheetProps, "hit" | "onClose"> & { hit: SimilarHit }) {
  const model = useMemo(() => hitModel(closed, hit, horizon, unit, SIM.sheet.ref), [closed, hit, horizon, unit]);
  const step = useMemo(() => motionValue(model?.situation ?? 0), [model]);
  const o = hit.outcome;
  const flat = useMemo(() => ({ ...FLAT, entry: o.ref }), [o.ref]);
  if (!model) {
    return (
      <StaggerItem>
        <p className="text-[13px] text-mute" data-testid="similar-sheet-empty">
          Für diese Fundstelle liegen die Kerzen nicht mehr vor.
        </p>
      </StaggerItem>
    );
  }
  const barLabel = (t: number): string => {
    const b = model.bars[Math.max(0, Math.min(model.bars.length - 1, Math.ceil(t) - 1))];
    return b ? dateTime(new Date(b.time)) : "–";
  };
  return (
    <div className="grid gap-4" data-testid="similar-sheet">
      <StaggerItem className="grid gap-1">
        <span className="text-[13px] font-medium text-fg">{dateTime(new Date(hit.time))}</span>
        <span className="text-[12.5px] text-mute" data-testid="similar-sheet-outcome">
          {outcomeText(o, unit)} · {firstTouchText(o, unit)}
        </span>
      </StaggerItem>
      <StaggerItem>
        <Suspense fallback={<Skeleton height={CHART_H} />}>
          <ReplayChart bars={model.bars} trade={flat} steps={[]} step={step} wipeKey={hit.index} showTrade={false} lines={model.lines} height={CHART_H} />
        </Suspense>
      </StaggerItem>
      <StaggerItem>
        <ScrubTimeline
          label={SIM.sheet.chart}
          title={`${model.total} Kerzen`}
          total={model.total}
          spans={model.spans}
          markers={model.markers}
          time={step}
          defaultTime={model.situation}
          step={1}
          bigStep={6}
          playSeconds={Math.max(5, Math.min(14, horizon / 2))}
          formatTime={barLabel}
        />
      </StaggerItem>
      <StaggerItem className="grid grid-cols-3 gap-2" role="group" aria-label={SIM.sheet.outcome}>
        <Readout label={SIM.stats.maxUp} value={moveText(o.up, unit)} tone="text-win" />
        <Readout label={SIM.stats.maxDown} value={moveText(-o.down, unit)} tone="text-loss" />
        <Readout label={SIM.stats.median} value={moveText(o.change, unit)} tone={o.change > 0 ? "text-win" : o.change < 0 ? "text-loss" : "text-fg"} />
      </StaggerItem>
      <StaggerItem>
        <table className="w-full text-left text-[12.5px]" data-testid="similar-sheet-values">
          <caption className="label pb-1 text-left">{SIM.sheet.values}</caption>
          <thead>
            <tr className="text-faint">
              <th scope="col" className="py-1 pr-3 font-medium">
                {SIM.sheet.feature}
              </th>
              <th scope="col" className="num py-1 pr-3 text-right font-mono font-medium">
                {SIM.sheet.then}
              </th>
              <th scope="col" className="num py-1 text-right font-mono font-medium">
                {SIM.sheet.now}
              </th>
            </tr>
          </thead>
          <tbody>
            {features.map((id) => (
              <tr key={id} className="border-t border-line">
                <th scope="row" className="py-1 pr-3 font-normal text-mute">
                  {FEATURES[id].label}
                </th>
                <td className="num py-1 pr-3 text-right font-mono">{featureValueText(id, hit.values[id])}</td>
                <td className="num py-1 text-right font-mono">{featureValueText(id, query?.values[id])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </StaggerItem>
      <StaggerItem>
        <p className="text-[11.5px] leading-snug text-faint">{SIM.sheet.play}</p>
      </StaggerItem>
    </div>
  );
}

function Readout({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-line bg-ink-950/50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</div>
      <div className={cn("num mt-0.5 font-mono text-[15px] font-medium", tone)}>{value}</div>
    </div>
  );
}
