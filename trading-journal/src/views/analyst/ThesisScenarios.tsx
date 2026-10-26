/**
 * Bär / Basis / Bulle of a thesis: the shared starting numbers (typed or taken from the SEC numbers on a click) and three DCF
 * scenarios with their value per share as a range, the distance to a typed price (only with a source) and "Was müsste stimmen?".
 * Fields are stored when they are left; no probabilities and no averaged target price.
 */
import { useMemo, useState } from "react";
import { dateDe, levelText } from "@/domain/analyst";
import { seedFromAnalyst } from "@/domain/dcf";
import { computeAll, SCENARIO_KEYS, SCENARIO_NAMES, versusPrice, whatMustHold, type Scenario, type ScenarioKey, type Thesis, type ThesisPatch } from "@/domain/thesis";
import { n2 } from "@/lib/format";
import { SecError, toSecError } from "@/market/sec";
import { Button } from "@/primitives/Button";
import { Segmented } from "@/primitives/Segmented";
import { loadAnalysis } from "./data";
import { NumField, SecErrorBox, Sub, TextField } from "./parts";
import { TH } from "./strings";

const PCT = 0.01;
const MIO = 1e6;
const TARGETS = [1.5, 2, 3] as const;
const TARGET_LABEL: Record<number, string> = { 1.5: "+50 %", 2: "×2", 3: "×3" };

interface Props {
  t: Thesis;
  commit: (patch: ThesisPatch) => void;
  now: () => number;
  fetchImpl?: typeof fetch;
}

export function ThesisScenarios({ t, commit, now, fetchImpl }: Props) {
  const [baseKey, setBaseKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SecError | null>(null);
  const [target, setTarget] = useState<number>(2);
  const values = useMemo(() => computeAll(t), [t]);
  const cur = t.base.currency;
  const priced = t.price != null && t.price.source.trim().length > 0;

  const fromSec = async (): Promise<void> => {
    if (!t.ticker) return;
    setLoading(true);
    setError(null);
    try {
      const a = await loadAnalysis(t.ticker, { ...(fetchImpl ? { fetchImpl } : {}), now: now() });
      const s = seedFromAnalyst(a.result);
      // only what the filings really carry replaces a value; the rest stays as the person left it
      commit({
        base: {
          revenue: s.baseRevenue ?? t.base.revenue,
          ebitMargin: s.ebitMargin ?? t.base.ebitMargin,
          taxRate: s.taxRate ?? t.base.taxRate,
          netDebt: s.netDebt ?? t.base.netDebt,
          shares: s.shares ?? t.base.shares,
          currency: s.currency,
          sourceNote: `${s.stamp.source}, Quartal bis ${s.asOf ? dateDe(s.asOf) : "unbekannt"}, abgerufen ${dateDe(new Date(s.stamp.fetchedAt).toISOString().slice(0, 10))}${[s.baseRevenue, s.ebitMargin, s.taxRate, s.netDebt, s.shares].some((v) => v == null) ? " – nicht alles ist gemeldet, Lücken bleiben leer" : ""}`,
        },
      });
      setBaseKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof SecError ? e : (toSecError(e) as SecError));
    } finally {
      setLoading(false);
    }
  };

  const setScenario = (key: ScenarioKey, patch: Partial<Scenario>): void => commit({ scenarios: { ...t.scenarios, [key]: { ...t.scenarios[key], ...patch } } });
  const setBase = (patch: Partial<Thesis["base"]>): void => commit({ base: { ...t.base, ...patch } });
  const mustHold = priced ? whatMustHold(t, "base", t.price!.value * target) : null;

  return (
    <section className="grid gap-4" aria-label={TH.scenariosTitle} data-section="thesis-scenarios" data-testid="thesis-scenarios">
      <Sub>{TH.scenariosTitle}</Sub>
      <p className="max-w-[78ch] text-[12.5px] leading-relaxed text-mute">{TH.scenariosLead}</p>

      <div className="grid gap-3 rounded-xl border border-line bg-ink-950/40 p-3.5" data-testid="thesis-base">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] font-semibold">{TH.baseTitle}</p>
          {t.ticker && (
            <Button size="sm" onClick={() => void fromSec()} disabled={loading} data-testid="thesis-base-sec">
              {loading ? "Lade …" : TH.baseFromSec}
            </Button>
          )}
        </div>
        {error && <SecErrorBox error={error} testId="thesis-sec-error" />}
        <div key={baseKey} className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <NumField label={`Umsatz Basisjahr (Mio. ${cur})`} value={t.base.revenue} factor={MIO} commit="blur" onCommit={(v) => setBase({ revenue: v })} testId="thesis-base-revenue" />
          <NumField label={TH.baseMargin} value={t.base.ebitMargin} factor={PCT} suffix="%" commit="blur" onCommit={(v) => setBase({ ebitMargin: v })} testId="thesis-base-margin" />
          <NumField label={TH.baseTax} value={t.base.taxRate} factor={PCT} suffix="%" commit="blur" onCommit={(v) => setBase({ taxRate: v })} testId="thesis-base-tax" />
          <NumField label={`Nettoverschuldung (Mio. ${cur})`} value={t.base.netDebt} factor={MIO} commit="blur" onCommit={(v) => setBase({ netDebt: v })} testId="thesis-base-netdebt" />
          <NumField label={TH.baseShares} value={t.base.shares} factor={MIO} commit="blur" onCommit={(v) => setBase({ shares: v })} testId="thesis-base-shares" />
        </div>
        {t.base.sourceNote && (
          <p className="text-[12px] leading-relaxed text-mute" data-testid="thesis-base-source">
            Quelle der Ausgangszahlen: {t.base.sourceNote}
          </p>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {SCENARIO_KEYS.map((k) => {
          const s = t.scenarios[k];
          const v = values[k];
          const vs = v.perShare != null ? versusPrice(v.perShare, t.price) : null;
          return (
            <div key={k} className="grid min-w-0 content-start gap-3 rounded-xl border border-line bg-ink-950/40 p-3.5" data-testid={`thesis-scenario-${k}`}>
              <p className="text-[13px] font-semibold">{SCENARIO_NAMES[k]}</p>
              <div className="grid grid-cols-2 gap-3">
                <NumField label={TH.growthStart} value={s.growthStart} factor={PCT} suffix="%" commit="blur" onCommit={(x) => setScenario(k, { growthStart: x })} testId={`thesis-${k}-g1`} />
                <NumField label={TH.growthEnd} value={s.growthEnd} factor={PCT} suffix="%" commit="blur" onCommit={(x) => setScenario(k, { growthEnd: x })} testId={`thesis-${k}-gn`} />
                <NumField label={TH.marginEnd} value={s.marginEnd} factor={PCT} suffix="%" commit="blur" onCommit={(x) => setScenario(k, { marginEnd: x })} testId={`thesis-${k}-mn`} />
                <NumField label={TH.reinvest} value={s.reinvest} factor={PCT} suffix="%" commit="blur" onCommit={(x) => setScenario(k, { reinvest: x })} testId={`thesis-${k}-r`} />
                <NumField label={TH.wacc} value={s.wacc} factor={PCT} suffix="%" commit="blur" onCommit={(x) => setScenario(k, { wacc: x })} testId={`thesis-${k}-wacc`} />
                <NumField label={TH.terminal} value={s.terminalGrowth} factor={PCT} suffix="%" commit="blur" onCommit={(x) => setScenario(k, { terminalGrowth: x })} testId={`thesis-${k}-tg`} />
              </div>
              <TextField label={TH.scenarioNote} value={s.note} onCommit={(x) => setScenario(k, { note: x })} testId={`thesis-${k}-note`} />
              <div className="grid gap-1 border-t border-line pt-3" data-testid={`thesis-value-${k}`} data-status={v.result ? v.result.status : "incomplete"}>
                <span className="label">{TH.valueLabel}</span>
                {v.missing.length > 0 ? (
                  <p className="text-[12.5px] leading-snug text-mute" data-testid={`thesis-missing-${k}`}>
                    {TH.scenarioMissing(v.missing)}
                  </p>
                ) : v.result && v.result.status !== "ok" ? (
                  <p className="text-[12.5px] leading-snug text-warn" role="alert">
                    {v.result.issues.find((i) => i.level === "error")?.text}
                  </p>
                ) : (
                  <>
                    <p className="num font-mono text-[20px] font-semibold leading-tight" data-testid={`thesis-range-${k}`} data-base={v.perShare ?? ""}>
                      {v.range ? (
                        <>
                          {n2(v.range.low)} <span className="text-mute">bis</span> {n2(v.range.high)}
                        </>
                      ) : (
                        n2(v.perShare)
                      )}{" "}
                      <span className="text-[13px] font-medium text-mute">{cur}</span>
                    </p>
                    <p className="text-[12px] text-mute">
                      Rechenwert <span className="num whitespace-nowrap font-mono">{n2(v.perShare)} {cur}</span>
                      {v.result?.value?.terminalShare != null ? <> · Endwert-Anteil <span className="num whitespace-nowrap font-mono">{levelText(v.result.value.terminalShare)}</span></> : null}
                    </p>
                    {vs != null && (
                      <p className="text-[12px] text-mute" data-testid={`thesis-vs-${k}`}>
                        {TH.versusPrice(`${vs > 0 ? "+" : ""}${n2(vs * 100)} %`)}
                      </p>
                    )}
                    {v.result?.value && v.result.value.equityValue <= 0 && <p className="text-[12px] text-warn">Die Schulden sind größer als der Unternehmenswert.</p>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {t.price && !priced && (
        <p className="text-[12px] text-warn" data-testid="thesis-price-nosource">
          {TH.priceNone}
        </p>
      )}

      <div className="grid gap-2 rounded-xl border border-line bg-ink-950/40 p-3.5" data-testid="thesis-mustHold">
        <p className="text-[13px] font-semibold">{TH.mustHold}</p>
        <p className="text-[12px] leading-relaxed text-mute">{TH.mustHoldLead}</p>
        {!priced ? (
          <p className="text-[12.5px] text-mute">{TH.mustHoldNeedPrice}</p>
        ) : (
          <>
            <Segmented aria-label="Zielwert gegenüber dem eingegebenen Kurs" options={TARGETS.map((x) => ({ v: String(x), label: TARGET_LABEL[x]! }))} value={String(target)} onChange={(x) => setTarget(Number(x))} />
            {mustHold && (
              <p className="text-[13px] leading-snug" data-testid="thesis-mustHold-result" data-reason={mustHold.reason}>
                {mustHold.reason === "ok"
                  ? `Für ${n2(t.price!.value * target)} ${cur} je Aktie (Kurs ${n2(t.price!.value)} ${cur}, ${TARGET_LABEL[target]}) bräuchte das Basis-Szenario ein gleichbleibendes Umsatzwachstum von ${levelText(mustHold.growth)} pro Jahr – bei sonst gleichen Annahmen.${t.risks.length + t.counter.length > 0 ? " Prüfe, ob das zu deinen Risiken und Gegenargumenten passt." : ""}`
                  : mustHold.reason === "missing"
                    ? TH.scenarioMissing(mustHold.missing)
                    : "Mit den übrigen Annahmen des Basis-Szenarios nicht erreichbar."}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
