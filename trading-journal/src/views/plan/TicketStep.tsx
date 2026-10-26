/**
 * Schritt 5 · Ticket: the finished plan as text and CSV to copy – direction, entry, stop, target, size, maximum loss, source
 * and stand of the candles. NOTHING is sent: the app has no broker connection and builds no way to place an order. Next to it,
 * the plan's own actions, each behind its own click: save / discard the plan, "Plan → 3 Alarme" (stop and target as key
 * levels, "flat by" as a clock reminder) and "Plan ins Journal" (an open trade draft in the editor, saved only when the trader
 * saves it there).
 */
import { useMemo, useState } from "react";
import { dateTimeIn, planOfSettings, priceText, clockIn, type SavedPlan } from "@/domain/plan";
import { newId } from "@/lib/ids";
import { tvSymbolToBinance } from "@/market/symbol";
import { Button } from "@/primitives/Button";
import { copyText } from "@/social/ui/copy";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { createAlarms, discardPlan, planToJournal, removeAlarms, savedPlanOf, savePlan, type WriteResult } from "./actions";
import { usePlanForm } from "./planStore";
import { StepCard } from "./ui";
import { useStand } from "./EntryStep";
import { ExecutionCheck } from "./ExecutionCheck";
import type { PlanVm } from "./usePlanModel";

const FLAT_STATE = { pending: "wartet auf die Uhrzeit", fired: "hat sich gemeldet", missed: "war schon vorbei" } as const;

const RESULT_TEXT: Record<WriteResult, string> = { ok: "", failed: "Das Speichern hat nicht geklappt – versuch es noch einmal.", limit: "Das Limit ist erreicht (höchstens 20 Pläne, 40 Schlüsselmarken). Verwirf einen Plan oder eine Marke.", missing: "Der Plan ist nicht mehr da." };

export function TicketStep({ vm }: { vm: PlanVm }) {
  const { form, model, currency } = vm;
  const planId = usePlanForm((s) => s.planId);
  const setPlanId = usePlanForm((s) => s.setPlanId);
  const clear = usePlanForm((s) => s.clear);
  const planRaw = useJournal((s) => s.settings.plan);
  const marketSymbol = useJournal((s) => tvSymbolToBinance(s.settings.market.symbol));
  const saved = useMemo(() => planOfSettings({ plan: planRaw }).plans.find((p) => p.id === planId) ?? null, [planRaw, planId]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const step = model.steps[4]!;
  const stand = useStand(vm);
  const t = model.ticketPlan;
  const ticket = model.ticket;
  const P = (x: number): string => priceText(x, model.tick);

  const current = (id: string): SavedPlan | null => savedPlanOf(model, form, currency, id, Date.now(), saved);
  const dirty = !!saved && !!t && (saved.entry !== t.entry || saved.stop !== t.stop || saved.target !== t.target || saved.qty !== t.qty || saved.side !== t.side || saved.symbol !== t.symbol);

  const run = async (fn: () => Promise<WriteResult>, ok: string): Promise<boolean> => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fn();
      if (r === "ok") {
        pushToast({ kind: "success", title: ok });
        return true;
      }
      setNote(RESULT_TEXT[r]);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const doSave = async (): Promise<void> => {
    const id = saved?.id ?? newId("p_");
    const p = current(id);
    if (!p) return;
    if (await run(() => savePlan(p), saved ? "Plan aktualisiert" : "Plan gespeichert")) setPlanId(id);
  };
  const doAlarms = async (): Promise<void> => {
    const id = saved?.id ?? newId("p_");
    const p = current(id);
    if (!p) return;
    if (await run(() => createAlarms(p, model.tick), "3 Alarme angelegt")) setPlanId(id);
  };
  const doJournal = async (): Promise<void> => {
    if (!t) return;
    await planToJournal({ symbol: t.symbol, side: t.side, entry: t.entry, stop: t.stop, target: t.target, qty: t.qty, notional: t.notional, leverage: t.leverage, account: form.account, stopLabel: t.stopLabel, targetLabel: t.targetLabel, sessionLabel: t.sessionLabel, entrySource: t.entrySource }, saved?.id ?? null);
    pushToast({ kind: "success", title: "Entwurf im Trade-Editor", detail: "Gespeichert wird erst, wenn du dort speicherst." });
  };
  const copy = async (what: "text" | "csv"): Promise<void> => {
    if (!ticket) return;
    const ok = await copyText(what === "text" ? ticket.text : ticket.csv);
    pushToast({ kind: ok ? "success" : "error", title: ok ? (what === "text" ? "Ticket als Text kopiert" : "Ticket als CSV kopiert") : "Kopieren nicht möglich", detail: ok ? "Nichts wurde gesendet." : "Markiere den Text unten und kopiere ihn von Hand." });
  };
  const doDiscard = async (): Promise<void> => {
    if (!saved) {
      clear();
      return;
    }
    if (await run(() => discardPlan(saved.id), "Plan verworfen")) setPlanId(null);
  };

  let headline: string;
  if (!ticket || !t) headline = model.risk?.blocked ? "Gesperrt: Der Risiko-Check ist rot – es gibt kein Ticket für diesen Plan." : "Wartet: das Ticket entsteht, sobald Einstieg, Ausstieg, Größe und Risiko-Check stehen.";
  else headline = `${t.side === "long" ? "Long" : "Short"} ${t.symbol}: Einstieg ${P(t.entry)}, Stop ${P(t.stop)}, Ziel ${t.target != null ? P(t.target) : "keins"} – zum Kopieren, nicht zum Senden.`;

  const alarms = saved?.alarms ?? null;
  const symbolMismatch = !!t && t.symbol !== marketSymbol;
  return (
    <StepCard id="ticket" n={5} title="Ticket" lead="Der fertige Plan als Text oder CSV zum Kopieren. Die App sendet nichts und hat keinen Weg zu einer Börse." status={step.status} current={step.current} headline={headline} assumed={model.assumptions.ticket} stand={stand}>
      {ticket && t && (
        <div className="grid gap-4" data-testid="hplan-ticket-body">
          <dl className="grid gap-px overflow-hidden rounded-xl border border-line bg-line" data-testid="hplan-ticket-rows">
            {ticket.rows.map(([k, v]) => (
              <div key={k} className="grid gap-0.5 bg-ink-950/70 px-3 py-2 sm:grid-cols-[11rem_1fr] sm:gap-3">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mute">{k}</dt>
                <dd className="num text-[13px] text-fg [overflow-wrap:anywhere]">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap gap-2" data-testid="hplan-copy">
            <Button onClick={() => void copy("text")} data-testid="hplan-copy-text">
              Text kopieren
            </Button>
            <Button onClick={() => void copy("csv")} data-testid="hplan-copy-csv">
              CSV kopieren
            </Button>
          </div>

          <ExecutionCheck plan={t} slippagePct={vm.limits.slippagePct} crypto={model.session.market === "crypto"} />

          <details className="rounded-xl border border-line bg-ink-950/40 px-3 py-2" data-testid="hplan-ticket-preview">
            <summary className="cursor-pointer select-none text-[12.5px] font-medium text-mute pointer-coarse:min-h-11 pointer-coarse:py-2">Text und CSV ansehen</summary>
            <pre className="num mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-ink-950/70 p-3 font-mono text-[11.5px] leading-relaxed text-fg/90" data-testid="hplan-ticket-text">
              {ticket.text}
            </pre>
            <pre className="num mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-ink-950/70 p-3 font-mono text-[11.5px] leading-relaxed text-fg/90" data-testid="hplan-ticket-csv">
              {ticket.csv}
            </pre>
          </details>

          <section className="grid gap-3 rounded-xl border border-line bg-ink-950/40 p-3" aria-label="Was du mit dem Plan tun kannst" data-testid="hplan-actions">
            <p className="text-[12px] leading-snug text-mute">
              Jede Aktion braucht ihren eigenen Klick. Speichern legt den Plan in deinen Einstellungen ab; die Alarme melden sich nur bei geöffneter App; der Journal-Entwurf wird erst ein Trade, wenn du ihn im Editor speicherst.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => void doSave()} disabled={busy} data-testid="hplan-save">
                {saved ? (dirty ? "Plan aktualisieren" : "Plan gespeichert") : "Plan speichern"}
              </Button>
              {!alarms ? (
                <Button onClick={() => void doAlarms()} disabled={busy} data-testid="hplan-alarms">
                  Plan → 3 Alarme
                </Button>
              ) : (
                <Button onClick={() => saved && void run(() => removeAlarms(saved), "Alarme entfernt")} disabled={busy} data-testid="hplan-alarms-remove">
                  Alarme entfernen
                </Button>
              )}
              <Button onClick={() => void doJournal()} data-testid="hplan-journal">
                Plan ins Journal
              </Button>
              <Button variant="danger" onClick={() => void doDiscard()} disabled={busy} data-testid="hplan-discard">
                {saved ? "Plan verwerfen" : "Formular zurücksetzen"}
              </Button>
            </div>
            {!alarms && <p className="text-[12px] leading-snug text-mute">„Plan → 3 Alarme“ legt an: einen Alarm beim Stop ({P(t.stop)}), einen beim Ziel ({t.target != null ? P(t.target) : "–"}) und die Erinnerung „flat by close“ um {clockIn(t.flatByMs ?? model.flatByMs, t.tz)} Uhr. Der Plan wird dabei mitgespeichert.</p>}
            {saved && (
              <p className="num text-[12px] leading-snug text-mute" data-testid="hplan-saved-state">
                Gespeichert am {dateTimeIn(saved.savedAt, t.tz)} Uhr{dirty ? " – der Plan oben weicht davon ab; „Plan aktualisieren“ übernimmt ihn" : ""}.{saved.journalAt ? " Ein Journal-Entwurf wurde geöffnet." : ""}
              </p>
            )}
            {alarms && (
              <p className="num text-[12px] leading-snug text-fg/90" data-testid="hplan-alarms-state">
                3 Alarme: Stop {P(saved!.stop)} und Ziel {saved!.target != null ? P(saved!.target) : "–"} als Schlüsselmarken (Markt › Schlüsselmarken), „flat by close“ {alarms.flatBy ? `um ${clockIn(alarms.flatBy.at, saved!.tz)} Uhr – ${FLAT_STATE[alarms.flatBy.state]}` : "ist nicht gesetzt"}.
              </p>
            )}
            {(alarms || symbolMismatch) && symbolMismatch && (
              <p className="text-[12px] leading-snug text-warn" role="status" data-testid="hplan-alarm-symbol">
                Dein Live-Markt zeigt {marketSymbol}. Die Marken-Alarme für {t.symbol} werden erst bewertet, wenn du den Markt in den Einstellungen (Live-Daten) auf {t.symbol} stellst.
              </p>
            )}
            {model.entry.past && (
              <p className="text-[12px] leading-snug text-mute" data-testid="hplan-past-note">
                Rückblick: Die Preise stammen aus einer vergangenen Sitzung. Alarme dafür sind nur sinnvoll, wenn der Kurs heute noch dort liegt.
              </p>
            )}
            {note && (
              <p className="text-[12px] text-loss" role="alert" data-testid="hplan-action-error">
                {note}
              </p>
            )}
          </section>
        </div>
      )}
    </StepCard>
  );
}
