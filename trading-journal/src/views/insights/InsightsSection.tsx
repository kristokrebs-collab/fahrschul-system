import { useId, type ReactNode } from "react";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import { SECTION_LEAD, SECTION_TITLE, TITLES } from "@/domain/insights";
import { IntroCell } from "@/intro/IntroCell";
import { useIntroFlown } from "@/intro/introStore";
import { cn } from "@/lib/cn";
import { Reveal } from "@/motion/Reveal";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { Segmented } from "@/primitives/Segmented";
import { useAccountView } from "@/store/journalStore";
import { useUi, type AccFilter } from "@/store/uiStore";
import { CalendarCard } from "./CalendarCard";
import { DisciplineCard } from "./DisciplineCard";
import { DrawdownCard } from "./DrawdownCard";
import { EdgeScoreCard } from "./EdgeScoreCard";
import { FindingsCard } from "./FindingsCard";
import { MistakesCard } from "./MistakesCard";
import { RDistributionCard } from "./RDistributionCard";
import { RecapCard } from "./RecapCard";
import { SignalStrengthCard } from "./SignalStrengthCard";
import { TimeCard } from "./TimeCard";
import { SEG_TOUCH } from "./ui";
import { WinLossCard } from "./WinLossCard";

const ACC_OPTIONS = (["all", "makro", "scalp"] as const).map((v) => ({ v, label: ACCOUNT_LABELS[v] }));

/** Same deferral as the overview's lower rows: skip rendering far off-screen, 12 px of room for the hover lift. */
const DEFER = "[content-visibility:auto] -my-3 py-3";
/** Cards of a row share its height: the stretched cell height plus the 24 px of hover room (border-box sizing). */
const FILL = "h-[calc(100%+1.5rem)]";

function Cell({ col, span, defer, children }: { col: number; span: string; defer: number; children: ReactNode }) {
  return (
    <IntroCell className={span} fly={false}>
      <CellReveal col={col} defer={defer}>
        {children}
      </CellReveal>
    </IntroCell>
  );
}

function CellReveal({ col, defer, children }: { col: number; defer: number; children: ReactNode }) {
  const flown = useIntroFlown();
  return (
    <Reveal index={col} settled={flown} className={cn(DEFER, FILL)} style={{ containIntrinsicBlockSize: `auto ${defer}px` }} data-defer="">
      {children}
    </Reveal>
  );
}

export const PREVIEW_TITLE = "Noch nichts auszuwerten";
export const PREVIEW_TEXT = "Sobald du Trades abschließt, erscheinen hier Rückblick, Erkenntnisse, Edge-Score, Disziplin, Fehler-Kosten, Signal-Stärke, Zeiten, R-Verteilung, Drawdown und der Vergleich deiner Gewinner und Verlierer. Den Kalender kannst du schon jetzt für Tagesnotizen nutzen.";
const PREVIEW_ITEMS = [TITLES.recap, TITLES.findings, TITLES.edge, TITLES.discipline, TITLES.mistakes, TITLES.signal, TITLES.time, TITLES.r, TITLES.drawdown, TITLES.winloss];

/** One calm card instead of ten empty ones while the account view has no trades at all. */
function PreviewCard() {
  return (
    <Card title={SECTION_TITLE} data-testid="insights-preview">
      <EmptyState
        title={PREVIEW_TITLE}
        text={PREVIEW_TEXT}
        line={false}
        action={
          <ul className="mt-2 flex max-w-[44ch] flex-wrap justify-center gap-1.5" aria-label="Kommende Auswertungen">
            {PREVIEW_ITEMS.map((t) => (
              <li key={t} className="rounded-full border border-line-2 px-2.5 py-0.5 text-[11px] text-mute">
                {t}
              </li>
            ))}
          </ul>
        }
      />
    </Card>
  );
}

/**
 * "Auswertung" on the Übersicht (Tradezella-style evaluations, see README.md). Mount it as a direct child of the
 * overview grid (`<InsightsSection />` – its root spans `lg:col-span-12` and lays out its own 12-column grid);
 * every card is a deferred, revealed cell, so nothing here needs a surrounding `Cell`/`Reveal`.
 * Rows: Rückblick (7) | Erkenntnisse (5) · P&L-Kalender (7) | Edge-Score (5) · Disziplin (12) ·
 * Fehler-Kosten (6) | Signal-Stärke (6) · Zeit & Session (7) | R-Verteilung (5) · Drawdown (7) | Gewinner vs. Verlierer (5).
 * The account switch mirrors the Hero's (same `uiStore.acc`), so the Auswertung can be switched where it is read.
 */
export function InsightsSection({ className }: { className?: string }) {
  const id = useId();
  const acc = useUi((s) => s.acc);
  const setAcc = useUi((s) => s.setAcc);
  const view = useAccountView(acc);
  const empty = view.list.length === 0;
  return (
    <section aria-labelledby={id} data-testid="insights" className={cn("grid grid-cols-1 gap-5 lg:col-span-12 lg:grid-cols-12", className)}>
      <Reveal className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-6 lg:col-span-12">
        <div className="grid min-w-0 gap-1.5">
          <div className="flex items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-signal" aria-hidden="true" />
            <h2 id={id} className="label !text-fg">
              {SECTION_TITLE}
            </h2>
          </div>
          <p className="max-w-[60ch] text-[13px] text-mute">{SECTION_LEAD}</p>
        </div>
        <Segmented<AccFilter> aria-label="Konto der Auswertung" options={ACC_OPTIONS} value={acc} onChange={setAcc} size="sm" className={SEG_TOUCH} />
      </Reveal>
      {empty ? (
        <>
          <Cell col={0} span="lg:col-span-7" defer={560}>
            <CalendarCard />
          </Cell>
          <Cell col={1} span="lg:col-span-5" defer={560}>
            <PreviewCard />
          </Cell>
        </>
      ) : (
        <>
          <Cell col={0} span="lg:col-span-7" defer={340}>
            <RecapCard />
          </Cell>
          <Cell col={1} span="lg:col-span-5" defer={340}>
            <FindingsCard />
          </Cell>
          <Cell col={0} span="lg:col-span-7" defer={560}>
            <CalendarCard />
          </Cell>
          <Cell col={1} span="lg:col-span-5" defer={560}>
            <EdgeScoreCard />
          </Cell>
          <Cell col={0} span="lg:col-span-12" defer={420}>
            <DisciplineCard />
          </Cell>
          <Cell col={0} span="lg:col-span-6" defer={440}>
            <MistakesCard />
          </Cell>
          <Cell col={1} span="lg:col-span-6" defer={440}>
            <SignalStrengthCard />
          </Cell>
          <Cell col={0} span="lg:col-span-7" defer={460}>
            <TimeCard />
          </Cell>
          <Cell col={1} span="lg:col-span-5" defer={460}>
            <RDistributionCard />
          </Cell>
          <Cell col={0} span="lg:col-span-7" defer={400}>
            <DrawdownCard />
          </Cell>
          <Cell col={1} span="lg:col-span-5" defer={400}>
            <WinLossCard />
          </Cell>
        </>
      )}
    </section>
  );
}
