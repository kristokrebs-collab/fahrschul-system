/**
 * "Was ist ein Flip?" – the explainer on top of the Top-Trader card (Markt page, Runde 12 / Paket W). Lazy chunk (loaded by the card).
 *
 * Text only (the Rücknahme took out the explainer's own chart and the three-panel schema – the card's own chart, `TraderNetPlot`, is the
 * picture): the title and the definition, the flip sentence from what the history gives ("Flip am … erstmals netto Short, Preis seit dem
 * Flip …", else "Kein Flip …" or the honest empty state), Quelle · Kohorte · Messzeit as the card shows them, the classification (never a
 * forecast, never advice), "Wie lese ich das?" and a calm link to Einstellungen › Alarme (`openFeature("vier-alarme")`) – nothing is
 * switched on from here. No motion of its own.
 *
 * Fixed boxes: every text block has a reserved height, so nothing moves when the data arrives (the card's `PendingCard` reserve counts
 * this panel, `flipExplainerReserve.ts`).
 */
import { useId, useMemo } from "react";
import { PLAN_LIMITS } from "@/billing/plans";
import { useLimit, usePlan } from "@/billing/entitlements";
import { cloudEnabled } from "@/cloud/env";
import { useCloudSession } from "@/cloud/session";
import { hasClaudeRuntime } from "@/store/capability";
import type { NetPoint, TraderNetView } from "@/domain/signals";
import type { NetGap, NetSeriesId } from "@/domain/signals/netSeries";
import { cn } from "@/lib/cn";
import { Button } from "@/primitives/Button";
import { alarmNote, flipModel } from "./flipExplainerModel";
import { FLIP } from "./flipExplainerStrings";
import type { ProvenanceLine, WalState } from "./traderNetWal";

const PLAN_NAME = { free: "Free", pro: "Pro", premium: "Premium", team: "Team" } as const;

export interface FlipExplainerProps {
  state: WalState;
  /** every point of the card (stored history + live); empty without data */
  points: readonly NetPoint[];
  gaps: readonly NetGap[];
  view: TraderNetView | null;
  /** Quelle · Kohorte · Messzeit – the card's own three lines */
  prov: readonly ProvenanceLine[];
  series: NetSeriesId;
  /** why there is no series (the card's reason line) */
  reason?: string;
}

/**
 * The reserved room of the text blocks (lines × line height, per breakpoint: `sm` from 640 px, `lg` from 1024 px), as a style of
 * this lazy panel – not part of the app's stylesheet (its budget is full).
 */
const RESERVE_CSS = `
.flip-x-head{min-height:88.3px}
.flip-x-caption{min-height:67.2px}
.flip-x-hint{min-height:100.8px}
.flip-x-note{min-height:62.1px}
@media (min-width:640px){.flip-x-head{min-height:72.1px}.flip-x-caption{min-height:50.4px}.flip-x-hint{min-height:67.2px}.flip-x-note{min-height:31px}}
@media (min-width:1024px){.flip-x-caption{min-height:33.6px}.flip-x-hint{min-height:50.4px}}
`;

export default function FlipExplainer({ state, points, gaps, view, prov, series, reason }: FlipExplainerProps) {
  const model = useMemo(() => flipModel({ state, points, gaps, view, reason }), [state, points, gaps, view, reason]);
  const id = useId().replace(/:/g, "");

  // the alarm link: what the plan really has
  const cloud = cloudEnabled() && !hasClaudeRuntime();
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const plan = usePlan();
  const channels = useLimit("alertChannels");
  const phoneCalls = Number.isFinite(channels) ? PLAN_LIMITS[plan.plan].phoneCallsPerMonth : 0;
  const note = alarmNote({ cloud, signedIn, channels, phoneCalls, planLabel: PLAN_NAME[plan.plan] });
  const openAlarm = () => void import("@/app/featureOpen").then((m) => m.openFeature("vier-alarme"));

  return (
    <section
      className="grid gap-4 rounded-2xl border border-line bg-white/[0.015] p-4 sm:p-5"
      aria-labelledby={`${id}-t`}
      data-testid="flip-explainer"
      data-kind={model.kind}
      data-series={series}
      data-points={model.points.length}
      data-gaps={model.gaps.length}
      data-flip={model.flip ? String(Math.round(model.flip.at)) : "none"}
    >
      <style>{RESERVE_CSS}</style>
      <header className="flip-x-head grid content-start gap-1">
        <h3 id={`${id}-t`} className="text-[15px] font-medium leading-[1.3] text-fg">
          {FLIP.title}
        </h3>
        <p className="text-[12px] leading-[1.35] text-mute" data-testid="flip-explainer-lead">
          {FLIP.lead}
        </p>
      </header>

      <div className="grid min-w-0 gap-2">
        <p className={cn("flip-x-caption text-[12px] leading-[1.4]", model.points.length > 1 ? "text-fg" : "text-mute")} data-testid="flip-explainer-caption">
          {model.caption}
        </p>
        <dl className="grid gap-1 text-[11px] leading-[1.3]" data-testid="flip-explainer-provenance">
          {prov.map((p) => (
            <div key={p.id} className="flex gap-3">
              <dt className="w-14 shrink-0 text-mute">{p.label}</dt>
              <dd className="min-h-[2.75em] min-w-0 flex-1 text-fg/90 sm:min-h-[1.3em]" data-testid={`flip-explainer-prov-${p.id}`}>
                {p.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="flip-x-hint text-[12px] leading-[1.4] text-mute" data-testid="flip-explainer-hint">
        {FLIP.hint}
      </p>

      <details className="group rounded-xl border border-line" data-testid="flip-explainer-how">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3.5 text-[13px] font-medium text-fg focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
          {FLIP.howTitle}
          <span aria-hidden="true" className="text-mute transition-transform duration-200 group-open:rotate-90">
            ›
          </span>
        </summary>
        <dl className="grid gap-2.5 border-t border-line px-3.5 py-3 text-[12px] leading-[1.45]">
          {FLIP.how.map((h) => (
            <div key={h.id} className="grid gap-0.5 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-3">
              <dt className="font-medium text-fg">{h.term}</dt>
              <dd className="text-mute">{h.text}</dd>
            </div>
          ))}
        </dl>
      </details>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="flip-explainer-alarm">
        <Button variant="secondary" fx={false} className="min-h-11" onClick={openAlarm} data-testid="flip-explainer-alarm-button">
          {FLIP.alarmButton}
        </Button>
        <p className="flip-x-note min-w-0 flex-1 basis-60 text-[11.5px] leading-[1.35] text-mute" data-testid="flip-explainer-alarm-note">
          {FLIP.alarmOpens}
          {note ? ` ${note}` : ""}
        </p>
      </div>
    </section>
  );
}
