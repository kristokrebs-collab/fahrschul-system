/**
 * Handelsplan (`h1 Handelsplan`): the chain Einstieg → Ausstieg → Größe → Risiko-Check → Ticket as ONE guided flow – five big
 * step cards, the state on top as a progress bar, every step with "Angenommen", Quelle + Stand of the candles and the line
 * „Keine professionelle Finanzberatung.“. Crypto candles today (Binance, cache first, live while the session runs); the rules
 * take symbol + candles, so stocks join as soon as their data contract delivers candles. The app calculates and copies – it
 * never sends an order.
 *   Bild            the candles of the session with range, signal, entry, stop and target (right on a wide screen)
 *   1 – 5           EntryStep · ExitStep · SizeStep · RiskStep · TicketStep
 *   Zeitmaschine    the slot of the replay (another agent builds it)
 *   Gespeichert     the saved plans (`settings.plan`)
 */
import { Suspense, useEffect, type ReactNode } from "react";
import { clockIn, dateTimeIn } from "@/domain/plan";
import { cn } from "@/lib/cn";
import { tvSymbolToBinance } from "@/market/symbol";
import { Card } from "@/primitives/Card";
import { SectionNav } from "@/primitives/SectionNav";
import { useJournal } from "@/store/journalStore";
import { storageKey } from "@/store/storage";
import { useUi } from "@/store/uiStore";
import { AnalysisNote, NO_ADVICE_TEXT } from "@/ui/AnalysisNote";
import { Cell } from "@/views/labor/ui";
import { PageHeader } from "@/views/setups/PageHeader";
import { EntryStep, useStand } from "./EntryStep";
import { ExitStep } from "./ExitStep";
import { PlanChart } from "./PlanChart";
import { usePlanForm } from "./planStore";
import { Progress } from "./Progress";
import { RiskStep } from "./RiskStep";
import { SavedPlans } from "./SavedPlans";
import { SizeStep } from "./SizeStep";
import { TimeMachineSlot } from "./Slots";
import { TicketStep } from "./TicketStep";
import { usePlanModel, type PlanVm } from "./usePlanModel";

export const PLAN_LEAD_FILL = { storageKey: storageKey("fill-plan"), highlight: "fünf Schritten" } as const;

const NAV = [
  { id: "hplan-entry", label: "1 Einstieg" },
  { id: "hplan-exit", label: "2 Ausstieg" },
  { id: "hplan-size", label: "3 Größe" },
  { id: "hplan-risk", label: "4 Risiko-Check" },
  { id: "hplan-ticket", label: "5 Ticket" },
  { id: "hplan-saved", label: "Gespeichert" },
] as const;

/** First visit: take the app's market and the account of the header switch (a stored form is left alone). */
function usePlanDefaults(): void {
  const restored = usePlanForm((s) => s.restored);
  const market = useJournal((s) => tvSymbolToBinance(s.settings.market.symbol));
  const acc = useUi((s) => s.acc);
  useEffect(() => {
    if (!restored) usePlanForm.getState().set({ symbol: market, account: acc === "makro" ? "makro" : "scalp" });
    // only when the page opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function ChartCard({ vm }: { vm: PlanVm }) {
  const { model, candles } = vm;
  const s = model.session;
  const exit = model.exit?.ok ? model.exit : null;
  const stand = useStand(vm);
  return (
    <Card className="min-w-0" innerClassName="gap-3 p-4 sm:p-5" data-testid="hplan-picture" aria-labelledby="hplan-picture-h">
      <header>
        <h2 id="hplan-picture-h" className="text-[17px] font-semibold tracking-tight">
          Bild zum Plan
        </h2>
        <p className="text-[12.5px] leading-snug text-mute">
          {vm.form.symbol} · {s.label} · Beginn in Berlin {s.openBerlin} Uhr
        </p>
      </header>
      <PlanChart
        candles={candles.candles}
        intervalMs={model.intervalMs}
        openMs={s.openMs}
        closeMs={s.closeMs}
        tz={s.tz}
        range={model.entry.range}
        signal={model.entry.signal}
        side={model.side}
        entry={model.entryPrice}
        stop={exit?.stop ?? null}
        target={exit?.target ?? null}
        flatByMs={exit ? model.flatByMs : null}
        tick={model.tick}
        past={model.entry.past}
      />
      <p className="num border-t border-line pt-3 text-[11.5px] leading-relaxed text-mute" data-testid="hplan-picture-note">
        {NO_ADVICE_TEXT} {stand}
      </p>
    </Card>
  );
}

function TimeMachineCard({ vm }: { vm: PlanVm }) {
  const { model, form, currency, candles } = vm;
  const exit = model.exit?.ok ? model.exit : null;
  const s = model.session;
  const stand = useStand(vm);
  return (
    <Card className="min-w-0" innerClassName="gap-4 p-4 sm:p-5" data-testid="hplan-timemachine" aria-labelledby="hplan-tm-h">
      <header>
        <h2 id="hplan-tm-h" className="text-[17px] font-semibold tracking-tight">
          Zeitmaschine
        </h2>
        <p className="text-[12.5px] leading-snug text-mute">Den Plan an den echten Kerzen durchspielen – ohne die Zukunft zu zeigen.</p>
      </header>
      {exit ? (
        <Suspense fallback={<p className="text-[12.5px] text-mute">Wird geladen …</p>}>
          <TimeMachineSlot
            symbol={form.symbol}
            side={exit.side}
            entry={exit.entry}
            stop={exit.stop}
            target={exit.target}
            qty={model.size?.ok ? model.size.qty : null}
            candles={candles.candles}
            intervalMs={model.intervalMs}
            sessionOpenMs={s.openMs}
            sessionCloseMs={s.closeMs}
            tz={s.tz}
            entryAt={model.entry.signal?.barClose ?? null}
            flatByMs={model.flatByMs}
            tick={model.tick}
            currency={currency}
            source={{ label: candles.sourceLabel, fetchedAt: candles.fetchedAt }}
          />
        </Suspense>
      ) : (
        <p className="rounded-xl border border-dashed border-line-2 bg-ink-950/40 px-4 py-5 text-[13px] text-mute" data-testid="hplan-timemachine-wait">
          Wartet auf einen Plan mit Einstieg, Stop und Ziel (Schritte 1 und 2).
        </p>
      )}
      <p className="num border-t border-line pt-3 text-[11.5px] leading-relaxed text-mute" data-testid="hplan-timemachine-note">
        {NO_ADVICE_TEXT} {stand} · Zeiten {s.zone}: {clockIn(s.openMs, s.tz)} Uhr Beginn, Stand {dateTimeIn(vm.now, s.tz)} Uhr.
      </p>
    </Card>
  );
}

function Section({ children, index = 0, className }: { children: ReactNode; index?: number; className?: string }) {
  return (
    <Cell index={index} span="" className={className}>
      {children}
    </Cell>
  );
}

export function PlanView({ className }: { className?: string }) {
  usePlanDefaults();
  const vm = usePlanModel();
  return (
    <div className={cn("grid grid-cols-1 gap-5", className)} data-testid="plan-view" data-live={vm.live ? "true" : "false"}>
      <PageHeader title="Handelsplan" lead="Vom Einstiegssignal bis zum Ticket – in fünf Schritten, mit deinen Limits. Die App rechnet und kopiert; sie sendet nie eine Order." leadFill={PLAN_LEAD_FILL} />
      <Progress steps={vm.model.steps} progress={vm.model.progress} />
      <SectionNav items={NAV} />
      <div className="grid min-w-0 gap-5 lg:grid-cols-12 lg:items-start">
        <aside className="min-w-0 lg:sticky lg:top-[132px] lg:order-2 lg:col-span-5" aria-label="Bild zum Plan">
          <ChartCard vm={vm} />
        </aside>
        <div className="grid min-w-0 gap-5 lg:order-1 lg:col-span-7">
          <Section index={0}>
            <EntryStep vm={vm} />
          </Section>
          <Section index={1}>
            <ExitStep vm={vm} />
          </Section>
          <Section index={2}>
            <SizeStep vm={vm} />
          </Section>
          <Section index={3}>
            <RiskStep vm={vm} />
          </Section>
          <Section index={4}>
            <TicketStep vm={vm} />
          </Section>
          <Section index={5}>
            <TimeMachineCard vm={vm} />
          </Section>
          <Section index={6}>
            <SavedPlans />
          </Section>
        </div>
      </div>
      <AnalysisNote lead="Die Zahlen rechnet die App aus Kerzen und deinen Grenzen – eine Rechnung und ein Rückblick, keine Prognose." />
    </div>
  );
}
