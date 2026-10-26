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
import { lazy, Suspense, useId, type ReactNode } from "react";
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
import { SectionNav, type SectionNavItem } from "@/primitives/SectionNav";
import { AnalysisNote } from "@/ui/AnalysisNote";
import { PendingCard } from "@/ui/PendingCard";
import { SectionTitle } from "@/views/analyse/ui";
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

/**
 * The five parts of the page for its "Inhalt" strip (`data-section` on each `SectionTitle`); the cards inside keep their own
 * `data-testid`, so the function register still finds every one of them.
 */
const NAV: readonly SectionNavItem[] = [
  { id: "now", label: "Jetzt" },
  { id: "context", label: "Einordnung" },
  { id: "levels", label: "Marken & Alarme" },
  { id: "calendar", label: "Termine" },
  { id: "watch", label: "Beobachten" },
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
const BAND = "flex h-[38px] flex-col justify-center overflow-hidden rounded-2xl border border-line bg-ink-950/40 py-2";

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
  const ids = { now: useId(), context: useId(), levels: useId(), calendar: useId(), watch: useId() };
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
      <section aria-labelledby={focus ? undefined : ids.now} className="contents">
        {!focus && <SectionTitle id={ids.now} section="now" title="Jetzt" sub="Die besten Setups, der Stand der Box und der Chart des gewählten Markts." className="lg:col-span-12" />}
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
      </section>
      {!focus && (
        <>
          <section aria-labelledby={ids.context} className="contents">
            <SectionTitle id={ids.context} section="context" title="Einordnung" sub="Squeeze, Preis- und RSI-Struktur und ähnliche Situationen – Beobachtungen aus Kerzen und Archiv, keine Signale." className="lg:col-span-12" />
            <Cell index={3} span="lg:col-span-12">
              <Suspense fallback={<PendingCard title="Squeeze-Beobachtung" testId="markt-squeeze-loading" size="min-h-[800px] lg:min-h-[470px]" />}>
                <SqueezeCard view={view} />
              </Suspense>
            </Cell>
            <Cell index={3} span="lg:col-span-12">
              <Suspense fallback={<PendingCard title={TREND.title} testId="markt-trend-loading" size="min-h-[2680px] lg:min-h-[1260px]" />}>
                <TrendStructureCard />
              </Suspense>
            </Cell>
            <Cell index={4} span="lg:col-span-12">
              <Suspense fallback={<PendingCard title="Ähnliche Situationen" testId="markt-similar-loading" size="min-h-[2150px] lg:min-h-[1260px]" />}>
                <SimilarCard />
              </Suspense>
            </Cell>
          </section>
          <section aria-labelledby={ids.levels} className="contents">
            <SectionTitle id={ids.levels} section="levels" title="Marken und Alarme" sub="Eigene Preisstufen, der Tagesplan daraus und die Meldungen dazu." className="lg:col-span-12" />
            <Cell index={6} span="lg:col-span-7">
              <KeyLevelsCard />
            </Cell>
            <Cell index={7} span="lg:col-span-5">
              <PlanCard />
            </Cell>
            <Cell index={8} span="lg:col-span-12">
              <AlertsCard />
            </Cell>
          </section>
          <section aria-labelledby={ids.calendar} className="contents">
            <SectionTitle id={ids.calendar} section="calendar" title="Termine" sub="Was heute und in den nächsten Tagen für den Handel zählt – mit Quelle, ohne Schätzung." className="lg:col-span-12" />
            {/* no `Cell` (Reveal) around the section: it is three cards tall (several thousand px on a phone), and a reveal waits for
                15 % of its element to be in view – an element that tall never gets there and would stay at opacity 0. The cards reveal themselves. */}
            <div className="min-w-0 lg:col-span-12">
              <Suspense fallback={<PendingCard title="Termine" testId="termine-loading" size="min-h-[5760px] lg:min-h-[2590px]" />}>
                <TermineSection />
              </Suspense>
            </div>
          </section>
          <section aria-labelledby={ids.watch} className="contents">
            <SectionTitle id={ids.watch} section="watch" title="Beobachten" sub="RSI-Linien, der Scanner über deine Watchlist und die Einstellungen der Boxen." className="lg:col-span-12" />
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
          </section>
        </>
      )}
      <AnalysisNote className="lg:col-span-12" />
    </div>
  );
}
