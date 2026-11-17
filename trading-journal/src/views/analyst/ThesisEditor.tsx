/**
 * The editor of ONE thesis: the person's own text and lists (reason, horizon, catalysts, risks, counter-arguments), the buy zone,
 * a typed price with its source, the next report date and the review date; then the scenarios, the refutation conditions with
 * the check, and the versions. Everything is stored when a field is left or a button is pressed (`commit`); nothing is rewritten
 * by the app. The company's report date is NOT known to the app: the person enters it and names the source.
 */
import { useState } from "react";
import { isIsoDate, isoOfMs } from "@/market/sec/days";
import { dateDe } from "@/domain/analyst";
import { saveVersion, type Thesis, type ThesisPatch } from "@/domain/thesis";
import { Badge } from "@/primitives/Badge";
import { Segmented } from "@/primitives/Segmented";
import type { SecError } from "@/market/sec";
import { ListEditor, NumField, Sub, TextField } from "./parts";
import { ThesisChecks } from "./ThesisChecks";
import { ThesisScenarios } from "./ThesisScenarios";
import { ThesisVersions } from "./ThesisVersions";
import { markSeen, writeTheses } from "./thesisStore";
import { TH } from "./strings";

const HORIZONS = [3, 5, 7, 10] as const;

interface Props {
  t: Thesis;
  commit: (patch: ThesisPatch) => void;
  now: () => number;
  fetchImpl?: typeof fetch;
  checking: boolean;
  checkError: SecError | null;
  onCheck: () => void;
}

/** Price, its date and its source are stored together – only a complete price counts. */
function PriceBlock({ t, commit, now }: Pick<Props, "t" | "commit" | "now">) {
  const [value, setValue] = useState<number | null>(t.price?.value ?? null);
  const [date, setDate] = useState(t.price?.date ?? "");
  const [source, setSource] = useState(t.price?.source ?? "");
  const store = (v: number | null, d: string, s: string): void => {
    if (v == null || !(v > 0)) {
      if (t.price) commit({ price: null });
      return;
    }
    commit({ price: { value: v, date: isIsoDate(d) ? d : isoOfMs(now()), source: s.trim() } });
  };
  return (
    <div className="grid gap-3 rounded-xl border border-line bg-ink-950/40 p-3.5" data-testid="thesis-price">
      <p className="text-[13px] font-semibold">{TH.priceTitle}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <NumField label={`${TH.priceValue} (${t.base.currency})`} value={value} commit="blur" onCommit={(v) => { setValue(v); store(v, date, source); }} testId="thesis-price-value" />
        <TextField label={TH.priceDate} type="date" value={date} onCommit={(d) => { setDate(d); store(value, d, source); }} testId="thesis-price-date" />
        <TextField label={TH.priceSource} value={source} placeholder="z. B. Broker-Kurs" onCommit={(s) => { setSource(s); store(value, date, s); }} testId="thesis-price-source" />
      </div>
      {t.price && !t.price.source.trim() && <p className="text-[12px] text-warn">{TH.priceNone}</p>}
    </div>
  );
}

export function ThesisEditor({ t, commit, now, fetchImpl, checking, checkError, onCheck }: Props) {
  const today = isoOfMs(now());
  const reviewDue = t.reviewAt != null && t.reviewAt <= today;
  const zone = t.buyZone;

  const saveNow = (note: string, force = false): "saved" | "same" => {
    const at = now();
    if (saveVersion(t, note, at, undefined, force) === t) return "same";
    void writeTheses((list) => list.map((x) => (x.id === t.id ? saveVersion(x, note, at, undefined, force) : x)));
    return "saved";
  };
  const saveWithCheck = (): void => {
    const q = t.check?.quarterEnd ? dateDe(t.check.quarterEnd) : "unbekannt";
    saveNow(`Prüfung zum Quartal bis ${q}: ${(t.check?.results ?? []).filter((r) => r.status === "triggered").length} Bedingung(en) ausgelöst`, true);
  };

  return (
    <div className="grid min-w-0 gap-6" data-testid="thesis-editor" data-id={t.id}>
      <section className="grid gap-4" aria-label={TH.textTitle} data-section="thesis-text" data-testid="thesis-text">
        <Sub>{TH.textTitle}</Sub>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <TextField label={TH.nameLabel} value={t.name} maxLength={60} onCommit={(v) => commit({ name: v })} testId="thesis-name" />
          <TextField label="Börsenkürzel" value={t.ticker} maxLength={10} onCommit={(v) => commit({ ticker: v })} help="Für die SEC-Zahlen; leer lassen geht auch" testId="thesis-ticker" />
        </div>
        <TextField label={TH.textLabel} value={t.text} multiline rows={6} maxLength={4000} help={TH.textHelp} onCommit={(v) => commit({ text: v })} testId="thesis-text-input" />
        <div className="grid gap-1.5">
          <span className="label">{TH.horizonLabel}</span>
          <Segmented aria-label="Anlagehorizont in Jahren" options={HORIZONS.map((y) => ({ v: String(y), label: `${y}` }))} value={String(t.horizonYears)} onChange={(v) => commit({ horizonYears: Number(v) })} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <ListEditor label={TH.catalysts} items={t.catalysts} onChange={(items) => commit({ catalysts: items })} placeholder={TH.itemPlaceholder} addLabel={TH.addItem} removeLabel={TH.removeItem} testId="thesis-catalysts" />
          <ListEditor label={TH.risks} items={t.risks} onChange={(items) => commit({ risks: items })} placeholder={TH.itemPlaceholder} addLabel={TH.addItem} removeLabel={TH.removeItem} testId="thesis-risks" />
          <ListEditor label={TH.counter} items={t.counter} onChange={(items) => commit({ counter: items })} placeholder={TH.itemPlaceholder} addLabel={TH.addItem} removeLabel={TH.removeItem} testId="thesis-counter" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2 rounded-xl border border-line bg-ink-950/40 p-3.5" data-testid="thesis-zone">
            <p className="text-[13px] font-semibold">{TH.buyZone}</p>
            <div className="grid grid-cols-2 gap-3">
              <NumField label={`${TH.zoneFrom} (${t.base.currency})`} value={zone?.low ?? null} commit="blur" onCommit={(v) => commit({ buyZone: v == null && zone?.high == null ? null : { low: v, high: zone?.high ?? null } })} testId="thesis-zone-low" />
              <NumField label={`${TH.zoneTo} (${t.base.currency})`} value={zone?.high ?? null} commit="blur" onCommit={(v) => commit({ buyZone: v == null && zone?.low == null ? null : { low: zone?.low ?? null, high: v } })} testId="thesis-zone-high" />
            </div>
            <p className="text-[11.5px] leading-relaxed text-mute">Deine Zone, kein Vorschlag der App. Ein Kursrückgang allein ist keine Begründung.</p>
          </div>
          <PriceBlock t={t} commit={commit} now={now} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2 rounded-xl border border-line bg-ink-950/40 p-3.5" data-testid="thesis-nextreport">
            <p className="text-[13px] font-semibold">{TH.nextReport}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={TH.nextReportDate} type="date" value={t.nextReport?.date ?? ""} onCommit={(d) => commit({ nextReport: isIsoDate(d) ? { date: d, source: t.nextReport?.source ?? "" } : null })} testId="thesis-nextreport-date" />
              <TextField label={TH.nextReportSource} value={t.nextReport?.source ?? ""} placeholder="z. B. Investor-Relations-Seite" onCommit={(s) => commit({ nextReport: t.nextReport ? { date: t.nextReport.date, source: s } : null })} testId="thesis-nextreport-source" />
            </div>
            <p className="text-[11.5px] leading-relaxed text-mute">{TH.nextReportNote}</p>
            {t.nextReport && (
              <p className="text-[12.5px]" data-testid="thesis-nextreport-text">
                Nächster Bericht: <span className="num font-mono">{dateDe(t.nextReport.date)}</span> – {t.nextReport.source.trim() ? `Quelle: ${t.nextReport.source.trim()} (deine Eingabe)` : "ohne Quelle (deine Eingabe)"}
              </p>
            )}
          </div>
          <div className="grid content-start gap-2 rounded-xl border border-line bg-ink-950/40 p-3.5" data-testid="thesis-review">
            <p className="text-[13px] font-semibold">{TH.reviewAt}</p>
            <TextField label="Datum" type="date" value={t.reviewAt ?? ""} onCommit={(d) => commit({ reviewAt: isIsoDate(d) ? d : null })} testId="thesis-review-date" />
            {reviewDue && (
              <Badge tone="warn" dot>
                Wiedervorlage fällig
              </Badge>
            )}
          </div>
        </div>
      </section>

      <ThesisScenarios t={t} commit={commit} now={now} {...(fetchImpl ? { fetchImpl } : {})} />
      <ThesisChecks t={t} commit={commit} checking={checking} error={checkError} onCheck={onCheck} onSeen={() => void markSeen(t.id, now())} onSaveWithCheck={saveWithCheck} />
      <ThesisVersions t={t} onSave={saveNow} />
    </div>
  );
}
