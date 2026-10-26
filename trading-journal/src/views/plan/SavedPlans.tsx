/**
 * Gespeicherte Pläne: what was saved in `settings.plan`, newest first. "Öffnen" puts the plan's own assumptions back into the
 * form (the numbers are recomputed from the candles, never copied); "Verwerfen" removes the plan – and the two key levels it
 * created. The section ends with the same line as every step.
 */
import { useMemo } from "react";
import { clockIn, dateTimeIn, formMarket, moneyText, planOfSettings, priceText, qtyText, unitOf, type Light } from "@/domain/plan";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { useJournal } from "@/store/journalStore";
import { NO_ADVICE_TEXT } from "@/ui/AnalysisNote";
import { discardPlan } from "./actions";
import { usePlanForm } from "./planStore";

const LIGHT: Record<Light, [string, string]> = { green: ["Grün", "bg-win"], amber: ["Gelb", "bg-warn"], red: ["Rot", "bg-loss"] };

export function SavedPlans({ className }: { className?: string }) {
  const raw = useJournal((s) => s.settings.plan);
  const plans = useMemo(() => planOfSettings({ plan: raw }).plans, [raw]);
  const planId = usePlanForm((s) => s.planId);
  const replace = usePlanForm((s) => s.replace);
  const setPlanId = usePlanForm((s) => s.setPlanId);
  return (
    <Card className={className} innerClassName="gap-4 p-4 sm:p-5" data-testid="hplan-saved" aria-labelledby="hplan-saved-h">
      <header>
        <h2 id="hplan-saved-h" className="text-[17px] font-semibold tracking-tight">
          Gespeicherte Pläne
        </h2>
        <p className="text-[12.5px] leading-snug text-mute">Deine Pläne aus den Einstellungen (höchstens 20). Öffnen holt die Annahmen zurück; die Zahlen werden neu aus den Kerzen gerechnet.</p>
      </header>
      {plans.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-2 bg-ink-950/40 px-4 py-6 text-center text-[13px] text-mute" data-testid="hplan-saved-empty">
          Noch kein Plan gespeichert. Sobald das Ticket steht, legt „Plan speichern“ ihn hier ab.
        </p>
      ) : (
        <ul className="grid gap-2" data-testid="hplan-saved-list">
          {plans.map((p) => {
            const P = (x: number): string => priceText(x, p.tick);
            const [word, dot] = LIGHT[p.light];
            return (
              <li key={p.id} className="grid gap-2 rounded-xl border border-line bg-ink-950/50 p-3" data-testid={`hplan-saved-${p.id}`} data-active={p.id === planId ? "true" : undefined}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[14px] font-medium text-fg">
                    {p.side === "long" ? "Long" : "Short"} {p.symbol} <span className="font-normal text-mute">· {p.sessionLabel}</span>
                  </p>
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-mute">
                    <span aria-hidden="true" className={`size-2 rounded-full ${dot}`} />
                    Ampel {word}
                  </span>
                </div>
                <p className="num text-[12.5px] leading-snug text-fg/90">
                  Einstieg {P(p.entry)} · Stop {P(p.stop)} · Ziel {p.target != null ? P(p.target) : "–"} · {qtyText(p.qty, p.lot)} {unitOf(formMarket(p.form), p.symbol)} · höchstens {moneyText(p.maxLoss)} {p.currency} Verlust
                </p>
                <p className="num text-[11.5px] leading-snug text-mute">
                  Gespeichert {dateTimeIn(p.savedAt, p.tz)} Uhr · Quelle: {p.sourceLabel} · Kerzen bis {p.candlesUntil != null ? `${dateTimeIn(p.candlesUntil, p.tz)} Uhr` : "keine Daten"}
                  {p.alarms ? (p.alarms.stopId ? ` · 3 Alarme${p.alarms.flatBy ? ` (flat by ${clockIn(p.alarms.flatBy.at, p.tz)} Uhr)` : ""}` : ` · Erinnerung flat by${p.alarms.flatBy ? ` ${clockIn(p.alarms.flatBy.at, p.tz)} Uhr` : ""}`) : ""}
                  {p.journalAt ? " · Journal-Entwurf geöffnet" : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => replace(p.form, p.id)} data-testid={`hplan-open-${p.id}`}>
                    Öffnen
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      void discardPlan(p.id).then(() => {
                        if (p.id === planId) setPlanId(null);
                      });
                    }}
                    data-testid={`hplan-discard-${p.id}`}
                  >
                    Verwerfen
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="num border-t border-line pt-3 text-[11.5px] leading-relaxed text-mute" data-testid="hplan-saved-note">
        {NO_ADVICE_TEXT} Quelle und Stand der Kerzen stehen bei jedem Plan.
      </p>
    </Card>
  );
}
