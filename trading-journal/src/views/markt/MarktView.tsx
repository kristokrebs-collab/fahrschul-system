/**
 * Markt page (P02): Box zu Box live on 4h / 1D / 1W for the journal's symbol – the best setups (A+ / A only), the
 * phase of every box, the chart with boxes, targets and the RSI pane, the RSI trendlines, the watchlist scanner and the
 * settings. One store subscription (`useBoxes`) feeds the cards; the scanner runs its own.
 *
 * `h1 Markt` with the lead fill; a marquee band of the active box messages (phases, A-setups, alerts of this session);
 * the cells blur-fade in one after another (`Reveal`, ends at `transform: none` – the chart's morph-free, so no
 * containing-block trap). Registered by the integrator (P14) as page `markt` (see `README.md`).
 */
import { Gate } from "@/billing/entitlements";
import { UpgradeTeaser } from "@/billing/ui/UpgradeTeaser";
import { type ReactNode } from "react";
import { biasText, BOX_TF_LABEL, PHASE_LABEL, type BoxTf } from "@/domain/boxes";
import { cn } from "@/lib/cn";
import { useRecentBoxAlerts } from "@/market/boxes/alerts";
import { useBoxes, type BoxesView } from "@/market/boxes/store";
import { useCloseMorphDialogOnUnmount } from "@/motion/MorphDialog";
import { Marquee } from "@/motion/pulse/Marquee";
import { Reveal } from "@/motion/Reveal";
import { StatusPill } from "@/motion/StatusPill";
import { storageKey } from "@/store/storage";
import { PageHeader } from "@/views/setups/PageHeader";
import { BestSetupsCard } from "./BestSetupsCard";
import { BoxChartCard } from "./BoxChartCard";
import { BoxSettingsCard } from "./BoxSettingsCard";
import { BoxStateCard } from "./BoxStateCard";
import { RsiLinesCard } from "./RsiLinesCard";
import { ScannerCard } from "./ScannerCard";
import { MARKT } from "./strings";

export const MARKT_LEAD_FILL = { storageKey: storageKey("fill-markt"), highlight: MARKT.leadHighlight } as const;

function Cell({ index, span, children }: { index: number; span: string; children: ReactNode }) {
  return (
    <Reveal index={index} className={cn("min-w-0", span)}>
      {children}
    </Reveal>
  );
}

type Tone = "win" | "loss" | "warn" | "mute";
const DOT: Record<Tone, string> = { win: "bg-win", loss: "bg-loss", warn: "bg-warn", mute: "bg-faint" };

/** The band's messages: each timeframe's phase (and a pending close), the A-setups, this session's alerts. */
export function bandItems(view: BoxesView, recent: readonly { id: string; title: string; tone: "win" | "loss" | "fg" }[]): Array<{ id: string; text: string; tone: Tone }> {
  const out: Array<{ id: string; text: string; tone: Tone }> = [];
  for (const tf of ["4h", "1d", "1w"] as BoxTf[]) {
    const st = view.tfs[tf].analysis?.box;
    if (!st?.box) continue;
    const pending = st.pending !== 0 && (st.phase === "inside" || st.phase === "failed");
    const back = !!st.pendingBack && st.phase !== "target";
    const tone: Tone = pending || back ? "warn" : st.dir > 0 && st.phase !== "failed" ? "win" : st.dir < 0 && st.phase !== "failed" ? "loss" : "mute";
    const label = pending ? MARKT.state.pending : back ? MARKT.state.pendingBack : PHASE_LABEL[st.phase];
    out.push({ id: `p:${tf}`, text: `${BOX_TF_LABEL[tf]} · ${label}${st.dir !== 0 && st.phase !== "failed" ? (st.dir > 0 ? " ↑" : " ↓") : ""}`, tone });
  }
  for (const b of view.best) out.push({ id: `s:${b.id}`, text: `${b.setup.grade} · ${b.setup.title} · ${BOX_TF_LABEL[b.tf]}`, tone: b.setup.side === "long" ? "win" : "loss" });
  for (const r of recent) out.push({ id: `a:${r.id}`, text: r.title, tone: r.tone === "fg" ? "mute" : r.tone });
  return out;
}

function AlertBand({ view, className }: { view: BoxesView; className?: string }) {
  const recent = useRecentBoxAlerts();
  const items = bandItems(view, recent);
  if (!items.length) return null;
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-line bg-ink-950/40 py-2", className)} data-testid="markt-band">
      <Marquee aria-label={MARKT.alerts.band} speed={36} gap={40}>
        <span className="flex items-center gap-8 pr-8">
          {items.map((it) => (
            <span key={it.id} className="inline-flex items-center gap-2 whitespace-nowrap text-[12px] text-mute">
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT[it.tone])} />
              {it.text}
            </span>
          ))}
        </span>
      </Marquee>
    </div>
  );
}

function HeaderStatus({ view }: { view: BoxesView }) {
  const tone = view.state === "ok" ? "live" : view.state === "error" ? "error" : view.state === "off" ? "muted" : "warn";
  const label = view.state === "ok" ? `${view.symbol ?? ""} · ${biasText(view.bias)}` : (view.detail ?? MARKT.best.loading);
  return (
    <span data-testid="markt-status" data-state={view.state}>
      <StatusPill tone={tone} expanded label={label} layoutKey={label} />
    </span>
  );
}

export function MarktView({ className }: { className?: string }) {
  const view = useBoxes();
  useCloseMorphDialogOnUnmount();
  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)} data-testid="markt-view" data-state={view.state}>
      <PageHeader className="lg:col-span-12" title={MARKT.title} lead={MARKT.lead} leadFill={MARKT_LEAD_FILL} action={<HeaderStatus view={view} />} />
      <AlertBand view={view} className="lg:col-span-12" />
      <Cell index={0} span="lg:col-span-7">
        <BestSetupsCard view={view} />
      </Cell>
      <Cell index={1} span="lg:col-span-5">
        <BoxStateCard view={view} />
      </Cell>
      <Cell index={2} span="lg:col-span-12">
        <BoxChartCard view={view} />
      </Cell>
      <Cell index={3} span="lg:col-span-5">
        <RsiLinesCard view={view} />
      </Cell>
      <Cell index={4} span="lg:col-span-7">
        {/* plan gate `boxScanner` (P10 / P14): the watchlist scan + alarms; the box chart itself stays free */}
        <Gate feature="boxScanner" fallback={<UpgradeTeaser feature="boxScanner" className="h-full" />}>
          <ScannerCard />
        </Gate>
      </Cell>
      <Cell index={5} span="lg:col-span-12">
        <BoxSettingsCard />
      </Cell>
    </div>
  );
}
