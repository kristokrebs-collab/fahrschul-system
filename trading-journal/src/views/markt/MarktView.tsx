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
import { lazy, Suspense, type ReactNode } from "react";
import { biasText, BOX_TF_LABEL, normalizeWatchSymbol, PHASE_LABEL, type BoxTf } from "@/domain/boxes";
import { cn } from "@/lib/cn";
import { useRecentBoxAlerts } from "@/market/boxes/alerts";
import { useBoxes, type BoxesView } from "@/market/boxes/store";
import { useCloseMorphDialogOnUnmount } from "@/motion/MorphDialog";
import { DotMatrix } from "@/motion/DotMatrix";
import { Marquee } from "@/motion/pulse/Marquee";
import { Reveal } from "@/motion/Reveal";
import { StatusPill } from "@/motion/StatusPill";
import { useJournal } from "@/store/journalStore";
import { storageKey } from "@/store/storage";
import { Card } from "@/primitives/Card";
import { SectionNav, type SectionNavItem } from "@/primitives/SectionNav";
import { Skeleton } from "@/primitives/Skeleton";
import { AnalysisNote } from "@/ui/AnalysisNote";
import { PageHeader } from "@/views/setups/PageHeader";
import { useMirrorState } from "@/views/biasTest";
import { BIAS } from "@/views/biasTest/strings";
import { AlertsCard, KeyLevelsCard, PlanCard } from "@/views/schluesselmarken";
import { BestSetupsCard } from "./BestSetupsCard";
import { BoxChartCard } from "./BoxChartCard";
import { BoxSettingsCard } from "./BoxSettingsCard";
import { BoxStateCard } from "./BoxStateCard";
import { RsiLinesCard } from "./RsiLinesCard";
import { ScannerCard } from "./ScannerCard";
import { MarktStand } from "./MarktStand";
import { MARKT } from "./strings";
import { TREND } from "./trendStrings";

// F05: the structure card (store, analysis, texts) is its own chunk – loaded when the page is opened, never with the app
const TrendStructureCard = lazy(() => import("./TrendStructureCard").then((m) => ({ default: m.TrendStructureCard })));

// F19: „Ähnliche Situationen“ – own chunk too (domain search, market hook, texts), the hit sheet is a third one
const SimilarCard = lazy(() => import("./SimilarCard").then((m) => ({ default: m.SimilarCard })));

// F07: „Squeeze-Beobachtung“ (reads the data archive) – own chunk, loaded with the page
const SqueezeCard = lazy(() => import("./SqueezeCard"));

// F43: „Heute wichtig“ (Morgenbriefing), „Termine“ (Kalender) and „Ereignisphasen“ – own chunk, loaded with the page
const TermineSection = lazy(() => import("@/views/termine/TermineSection"));

/** The cards of the page in reading order, for its "Inhalt" strip (each card is found by its `data-testid`). */
const NAV: readonly SectionNavItem[] = [
  { id: "markt-best", label: "Beste Setups" },
  { id: "markt-state", label: "Box-Status" },
  { id: "markt-chart", label: "Chart" },
  { id: "markt-squeeze", label: "Squeeze" },
  { id: "markt-trend", label: "Struktur" },
  { id: "markt-similar", label: "Ähnliche Situationen" },
  { id: "keylevels-card", label: "Marken" },
  { id: "plan-card", label: "Tagesplan" },
  { id: "briefing-card", label: "Heute wichtig" },
  { id: "termine-card", label: "Termine" },
  { id: "phasen-card", label: "Ereignisphasen" },
  { id: "markt-rsi", label: "RSI-Linien" },
  { id: "markt-scanner", label: "Scanner" },
  { id: "markt-settings", label: "Einstellungen" },
  { id: "alerts-card", label: "Alarme" },
];

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

/** Band height (border + `py-2` + one 12 px line, rounded up): the loading shell and the running band share it. */
const BAND = "flex min-h-[38px] flex-col justify-center overflow-hidden rounded-2xl border border-line bg-ink-950/40 py-2";

function BandItem({ text, tone }: { text: string; tone: Tone }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-[12px] text-mute">
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT[tone])} />
      {text}
    </span>
  );
}

function AlertBand({ view, className }: { view: BoxesView; className?: string }) {
  const recent = useRecentBoxAlerts();
  const items = bandItems(view, recent);
  if (!items.length) {
    // the band keeps its place while the candles load (and when no box exists yet): nothing below jumps when the
    // first messages arrive (P1-02); off / error have no band at all. Loading shows only the dot-matrix loader – the
    // sentence „Lade Kerzen …“ is said once, in Beste Setups (P2-09); screen readers still get it here
    const loading = view.state === "loading" || view.state === "idle";
    const text = loading ? (view.detail ?? MARKT.best.loading) : view.state === "ok" ? MARKT.state.none : null;
    if (!text) return null;
    return (
      <div className={cn(BAND, "px-4", className)} data-testid="markt-band" data-waiting="">
        <span className="flex items-center">
          {loading ? (
            <>
              <DotMatrix preset="loader" size={2} gap={1.5} tone="mute" />
              <span className="sr-only">{text}</span>
            </>
          ) : (
            <BandItem text={text} tone="mute" />
          )}
        </span>
      </div>
    );
  }
  return (
    <div className={cn(BAND, className)} data-testid="markt-band">
      <Marquee aria-label={MARKT.alerts.band} speed={36} gap={40}>
        <span className="flex items-center gap-8 pr-8">
          {items.map((it) => (
            <BandItem key={it.id} text={it.text} tone={it.tone} />
          ))}
        </span>
      </Marquee>
    </div>
  );
}

function HeaderStatus({ view, maskName = false }: { view: BoxesView; maskName?: boolean }) {
  const pair = useJournal((s) => s.settings.pair);
  const tone = view.state === "ok" ? "live" : view.state === "error" ? "error" : view.state === "off" ? "muted" : "warn";
  const loading = view.state === "loading" || view.state === "idle";
  // while loading: the symbol beside the pending (warn) dot – the sentence stands once, in Beste Setups (P2-09)
  // blind bias test (F62): the market name stays covered until the original view is uncovered
  const symbol = maskName ? BIAS.blindName : (view.symbol ?? normalizeWatchSymbol(pair) ?? "");
  const text = maskName ? BIAS.blindName : view.state === "ok" ? `${view.symbol ?? ""} · ${biasText(view.bias)}` : loading ? symbol : (view.detail ?? MARKT.best.loading);
  const label = loading ? (
    <>
      {symbol}
      <span className="sr-only"> · {view.detail ?? MARKT.best.loading}</span>
    </>
  ) : (
    text
  );
  return (
    <span data-testid="markt-status" data-state={view.state} title={loading ? (view.detail ?? MARKT.best.loading) : undefined}>
      <StatusPill tone={tone} expanded label={label} layoutKey={text} />
    </span>
  );
}

export function MarktView({ className }: { className?: string }) {
  const view = useBoxes();
  useCloseMorphDialogOnUnmount();
  // a running bias test (F62) shows only the chart: the setups, box status and alerts would tell the direction
  const test = useMirrorState("markt");
  const focus = test.frozen;
  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)} data-testid="markt-view" data-state={view.state}>
      <PageHeader className="lg:col-span-12" title={MARKT.title} lead={MARKT.lead} leadFill={MARKT_LEAD_FILL} action={<HeaderStatus view={view} maskName={focus && test.blind.hideName} />} />
      {!focus && <SectionNav items={NAV} className="lg:col-span-12" />}
      {focus ? (
        <p className="text-[12px] text-faint lg:col-span-12" data-testid="bias-focus-note">
          {BIAS.blindFocus}
        </p>
      ) : (
        <AlertBand view={view} className="lg:col-span-12" />
      )}
      {!focus && <MarktStand view={view} className="lg:col-span-12" />}
      {!focus && (
        <>
          <Cell index={0} span="lg:col-span-7">
            <BestSetupsCard view={view} />
          </Cell>
          <Cell index={1} span="lg:col-span-5">
            <BoxStateCard view={view} />
          </Cell>
        </>
      )}
      <Cell index={2} span="lg:col-span-12">
        <BoxChartCard view={view} />
      </Cell>
      {!focus && (
        <>
          <Cell index={3} span="lg:col-span-12">
            <Suspense
              fallback={
                <Card title="Squeeze-Beobachtung" data-testid="markt-squeeze-loading">
                  <Skeleton height={160} />
                </Card>
              }
            >
              <SqueezeCard view={view} />
            </Suspense>
          </Cell>
          <Cell index={3} span="lg:col-span-12">
            <Suspense
              fallback={
                <Card title={TREND.title} data-testid="markt-trend-loading">
                  <Skeleton height={180} />
                </Card>
              }
            >
              <TrendStructureCard />
            </Suspense>
          </Cell>
          <Cell index={4} span="lg:col-span-12">
            <Suspense
              fallback={
                <Card title="Ähnliche Situationen" data-testid="markt-similar-loading">
                  <Skeleton height={140} />
                </Card>
              }
            >
              <SimilarCard />
            </Suspense>
          </Cell>
          <Cell index={6} span="lg:col-span-7">
            <KeyLevelsCard />
          </Cell>
          <Cell index={7} span="lg:col-span-5">
            <PlanCard />
          </Cell>
          {/* no `Cell` (Reveal) around the section: it is three cards tall (several thousand px on a phone), and a reveal waits for
              15 % of its element to be in view – an element that tall never gets there and would stay at opacity 0. The cards reveal themselves. */}
          <div className="min-w-0 lg:col-span-12">
            <Suspense
              fallback={
                <Card title="Termine" data-testid="termine-loading">
                  <Skeleton height={200} />
                </Card>
              }
            >
              <TermineSection />
            </Suspense>
          </div>
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
          <Cell index={8} span="lg:col-span-12">
            <AlertsCard />
          </Cell>
        </>
      )}
      <AnalysisNote className="lg:col-span-12" />
    </div>
  );
}
