/**
 * Schritt 1 · Einstieg: market, candle length, session, range length and day – and the answer in words: the range, the signal
 * (the first closed candle outside it), or why there is none yet. Nothing here places anything.
 */
import { useState } from "react";
import { dateTimeIn, OR_CHOICES, PLAN_TFS, priceText, SESSIONS, sessionDef, TF_LABEL, TF_MS, MIN, type PlanTf, type SessionId } from "@/domain/plan";
import { num, signedPctText } from "@/domain/plan";
import { Button } from "@/primitives/Button";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { sourceOf } from "@/market/plan/sources";
import { useJournal } from "@/store/journalStore";
import { tvSymbolToBinance } from "@/market/symbol";
import { usePlanForm } from "./planStore";
import { ChipPick, FieldRow, Kpi, NumInput, StepCard, standLine } from "./ui";
import type { PlanVm } from "./usePlanModel";

const MARKETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const SIDES = [
  { v: "both" as const, label: "Beide" },
  { v: "long" as const, label: "Long" },
  { v: "short" as const, label: "Short" },
];

/** The card text for the status line of the candles ("Lädt …", the cache, a failure). */
export function candleLine(vm: PlanVm): { text: string; tone: "mute" | "warn" } {
  const c = vm.candles;
  if (c.status === "unavailable") return { text: c.error ?? "Für diesen Markt gibt es noch keine Kerzen.", tone: "warn" };
  if (c.status === "loading" || (vm.loading && !c.candles.length)) return { text: "Kerzen werden geladen …", tone: "mute" };
  if (c.status === "error") return { text: `${c.error ?? "Die Kerzen ließen sich nicht laden."} Es wird nichts geschätzt.`, tone: "warn" };
  if (c.error) return { text: `${c.error} Gezeigt wird der Stand aus dem Zwischenspeicher – nicht aktuell.`, tone: "warn" };
  return { text: c.fromCache ? "Kerzen aus dem Zwischenspeicher dieses Browsers." : vm.live ? "Live: die Kerzen werden alle 30 Sekunden nachgeladen." : "Rückblick: die Sitzung ist vorbei, die Kerzen sind vollständig.", tone: "mute" };
}

export function useStand(vm: PlanVm): string {
  const tz = vm.model.session.tz;
  return standLine({ sourceLabel: vm.candles.sourceLabel, until: vm.model.candlesUntil, fetchedAt: vm.candles.fetchedAt, fmt: (ms) => `${dateTimeIn(ms, tz)} Uhr` });
}

export function EntryStep({ vm }: { vm: PlanVm }) {
  const { form, model, candles } = vm;
  const set = usePlanForm((s) => s.set);
  const marketSymbol = useJournal((s) => tvSymbolToBinance(s.settings.market.symbol));
  const [custom, setCustom] = useState("");
  const [customBad, setCustomBad] = useState(false);
  const step = model.steps[0]!;
  const stand = useStand(vm);
  const s = model.session;
  const def = sessionDef(form.session);
  const stocksSource = sourceOf("stocks");
  const markets = [...new Set([...MARKETS, marketSymbol, form.symbol])];
  const tfMin = TF_MS[form.tf] / MIN;
  const candleLineState = candleLine(vm);

  const pickTf = (tf: PlanTf): void => {
    const m = TF_MS[tf] / MIN;
    const or = form.orMinutes % m === 0 ? form.orMinutes : Math.ceil(form.orMinutes / m) * m;
    set({ tf, orMinutes: or });
  };
  const addCustom = (): void => {
    const t = custom.trim().toUpperCase();
    if (!t) return;
    if (!/^[A-Z0-9]{3,20}$/.test(t)) {
      setCustomBad(true);
      return;
    }
    setCustomBad(false);
    setCustom("");
    set({ symbol: t });
  };

  // the headline: the answer in one sentence
  let headline: string;
  if (candles.status === "unavailable") headline = "Für diesen Markt gibt es noch keine Kerzen.";
  else if ((candles.status === "loading" || vm.loading) && !candles.candles.length && s.tradingDay) headline = "Kerzen werden geladen …";
  else if (!candles.candles.length && candles.error && s.tradingDay) headline = `Keine Kerzen geladen: ${candles.error}`;
  else if (model.entrySource === "manual" && model.entryPrice != null) headline = `Einstieg von dir festgelegt: ${model.side === "long" ? "Long" : "Short"} bei ${priceText(model.entryPrice, model.tick)}.`;
  else if (model.entrySource === "level" && model.entryPrice != null) headline = `Noch kein Signal – der Plan rechnet vorab mit einem ${model.side === "long" ? "Long" : "Short"}-Einstieg am Ausbruchsniveau ${priceText(model.entryPrice, model.tick)}.`;
  else headline = model.entry.headline;

  const e = model.entry;
  const r = e.range;
  const P = (x: number): string => priceText(x, model.tick);
  const sig = e.signal;
  const dayValue = form.day ?? s.dayKey;

  return (
    <StepCard id="entry" n={1} title="Einstieg" lead="Die Range der ersten Minuten und der erste Schluss außerhalb – oder warum noch keiner da ist." status={step.status} current={step.current} headline={headline} assumed={model.assumptions.entry} stand={stand}>
      <div className="grid gap-4" data-testid="hplan-entry-controls">
        <FieldRow label="Markt" hint={`Binance USDⓈ-M, Symbol wie ${marketSymbol}`}>
          <ChipPick id="plan-market" label="Markt" value={form.symbol} options={markets.map((m) => ({ v: m, label: m }))} onChange={(v) => set({ symbol: v })} />
          <div className="flex items-start gap-2">
            <Input
              aria-label="Anderes Symbol"
              placeholder="anderes Symbol"
              value={custom}
              invalid={customBad}
              onChange={(ev) => setCustom(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") addCustom();
              }}
              wrapperClassName="w-44"
              data-testid="hplan-symbol-input"
            />
            <Button size="sm" onClick={addCustom} data-testid="hplan-symbol-add">
              Übernehmen
            </Button>
          </div>
          {customBad && (
            <span role="alert" className="text-[11.5px] text-loss">
              Ein Symbol besteht aus 3 bis 20 Buchstaben oder Ziffern, zum Beispiel BTCUSDT.
            </span>
          )}
        </FieldRow>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Sitzung" hint={`${def.about} Beginn in Berlin: ${s.openBerlin} Uhr.`}>
            <ChipPick
              id="plan-session"
              label="Sitzung"
              value={form.session}
              options={SESSIONS.map((x) => ({ v: x.id as SessionId, label: x.label, disabled: x.market === "stocks" && !stocksSource.ready, title: x.market === "stocks" && !stocksSource.ready ? stocksSource.notReady : undefined }))}
              onChange={(v) => set({ session: v })}
              describedBy="hplan-stocks-note"
            />
            {!stocksSource.ready && (
              <span id="hplan-stocks-note" className="text-[11.5px] leading-snug text-mute" data-testid="hplan-stocks-note">
                US-Börse: {stocksSource.notReady}
              </span>
            )}
          </FieldRow>
          <FieldRow label="Kerzenlänge">
            <ChipPick
              id="plan-tf"
              label="Kerzenlänge"
              value={form.tf}
              options={PLAN_TFS.map((t) => {
                const bad = s.openMs % TF_MS[t] !== 0;
                return { v: t, label: TF_LABEL[t], disabled: bad, title: bad ? `Die Sitzung beginnt um ${def.open.replace(/^0/, "")} Uhr – ${TF_LABEL[t]}-Kerzen beginnen nicht zu dieser Uhrzeit.` : undefined };
              })}
              onChange={pickTf}
            />
          </FieldRow>
          <FieldRow label="Range = erste … Minuten">
            <ChipPick id="plan-or" label="Länge der Range in Minuten" value={form.orMinutes} options={OR_CHOICES.map((m) => ({ v: m, label: `${m} Min`, disabled: m % tfMin !== 0 }))} onChange={(v) => set({ orMinutes: v })} />
          </FieldRow>
          <FieldRow label="Richtung des Signals">
            <Segmented aria-label="Richtung des Signals" options={SIDES} value={form.sides} onChange={(v) => set({ sides: v })} />
          </FieldRow>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <FieldRow label="Tag der Sitzung" htmlFor="plan-day" className="w-44">
            <Input id="plan-day" type="date" value={dayValue} onChange={(ev) => set({ day: ev.target.value || null })} data-testid="hplan-day" />
          </FieldRow>
          <Button size="sm" onClick={() => set({ day: null })} disabled={form.day == null} data-testid="hplan-day-latest">
            Letzte Sitzung
          </Button>
          <Button size="sm" onClick={vm.reload} disabled={vm.loading || candles.status === "unavailable"} data-testid="hplan-reload">
            {vm.loading ? "Lädt …" : "Neu laden"}
          </Button>
        </div>

        <details className="group rounded-xl border border-line bg-ink-950/40 px-3 py-2" data-testid="hplan-entry-more">
          <summary className="cursor-pointer select-none text-[12.5px] font-medium text-mute marker:text-faint-line pointer-coarse:min-h-11 pointer-coarse:py-2">Mehr: Volumenfilter, letzter Einstieg, eigener Einstiegspreis</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <NumInput label="Volumenfilter" suffix="×" value={form.minVolumeX} onCommit={(v) => set({ minVolumeX: v })} min={0.1} max={100} placeholder="aus" help="Die Signal-Kerze braucht mindestens so viel Volumen wie der Durchschnitt der Range-Kerzen mal diese Zahl. Leer = aus." testId="hplan-volume" />
            <NumInput label="Letzter Einstieg" suffix="Min" value={form.cutoffMin} onCommit={(v) => set({ cutoffMin: v == null ? null : Math.round(v) })} min={5} max={1440} placeholder={String(Math.round((s.cutoffMs - s.openMs) / MIN))} format={(v) => String(v)} help="Minuten nach dem Beginn der Sitzung. Danach gibt es kein Signal mehr. Leer = Standard." testId="hplan-cutoff" />
            <NumInput label="Eigener Einstiegspreis" value={form.manualEntry} onCommit={(v) => set({ manualEntry: v })} min={0.0000001} placeholder="vom Signal" help="Ersetzt den Preis des Signals. Der Plan rechnet dann mit deinem Preis und deiner Richtung." testId="hplan-manual-entry" />
            <FieldRow label="Richtung bei eigenem Preis">
              <Segmented
                aria-label="Richtung bei eigenem Preis oder vorab geplantem Einstieg"
                options={[
                  { v: "long" as const, label: "Long" },
                  { v: "short" as const, label: "Short" },
                ]}
                value={form.manualSide}
                onChange={(v) => set({ manualSide: v })}
              />
            </FieldRow>
          </div>
        </details>
      </div>

      <div className="grid gap-3" data-testid="hplan-entry-result" data-status={e.status}>
        {r && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="hplan-range">
            <Kpi label="Range-Hoch">{P(r.high)}</Kpi>
            <Kpi label="Range-Tief">{P(r.low)}</Kpi>
            <Kpi label="Mitte" sub={`Höhe ${P(r.height)}`}>
              {P(r.mid)}
            </Kpi>
            <Kpi label="Kerzen der Range" sub={r.complete ? "fertig" : "entsteht"}>
              {r.bars} von {r.of}
            </Kpi>
          </div>
        )}
        {sig && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="hplan-signal">
            <Kpi label="Signal" tone={sig.side === "long" ? "text-win" : "text-loss"}>
              {sig.side === "long" ? "Long" : "Short"}
            </Kpi>
            <Kpi label="Zeit (Kerzenschluss)" sub={s.zone}>
              {dateTimeIn(sig.barClose, s.tz).slice(-5)} Uhr
            </Kpi>
            <Kpi label="Preis (Schluss)">{P(sig.price)}</Kpi>
            <Kpi label={sig.side === "long" ? "über dem Hoch" : "unter dem Tief"} sub={sig.volumeX != null ? `Volumen ${num(sig.volumeX, 2)}×` : undefined}>
              {signedPctText(sig.beyondPct)}
            </Kpi>
          </div>
        )}
        {e.reasons.length > 0 && (
          <ul className="grid gap-1.5" data-testid="hplan-entry-reasons">
            {e.reasons.map((t, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-fg/90">
                <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-faint-line" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{t}</span>
              </li>
            ))}
          </ul>
        )}
        <p className={candleLineState.tone === "warn" ? "text-[12.5px] text-warn" : "text-[12.5px] text-mute"} data-testid="hplan-candle-state" role={candleLineState.tone === "warn" ? "status" : undefined}>
          {candleLineState.text} Zeiten in Ortszeit der Sitzung ({s.zone}).
        </p>
      </div>
    </StepCard>
  );
}
