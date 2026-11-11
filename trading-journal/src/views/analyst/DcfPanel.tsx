/**
 * DCF-Rechner (`/dcf`): free-cash-flow projection with every assumption on the table, net debt and share count from the SEC
 * numbers or typed, the value as a RANGE (WACC × terminal growth sensitivity), the share of the value that sits in the terminal
 * value, and a reverse view ("Was müsste stimmen?"). The arithmetic is `src/domain/dcf` (the skill's `dcf.py`, deterministic).
 *
 * Honesty rules: nothing about the future is pre-filled (growth, WACC and terminal growth are the person's; the two example
 * rates are offered on a click and labelled as the skill's example); while an input is missing the panel names it and does not
 * compute; WACC ≤ terminal growth and a negative last-year free cash flow are caught with the reason; a comparison with a price
 * needs a price WITH a source that the person typed. No recommendation, no order. Lazy-ready.
 */
import { useMemo, useState } from "react";
import { dateDe, levelText, money, pctText } from "@/domain/analyst";
import { buildAssumptions, EMPTY_SIMPLE, EXAMPLE_RATES, impliedGrowth, rangeOf, runDcf, seedFromAnalyst, sensitivity, simpleFromSeed, type DcfSeed, type SimpleAssumptions } from "@/domain/dcf";
import { cn } from "@/lib/cn";
import { n1, n2 } from "@/lib/format";
import { normalizeTicker, SecError, toSecError } from "@/market/sec";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { Segmented } from "@/primitives/Segmented";
import { SecErrorBox, NumField, PanelNote, Sub, TextField, Disclosure } from "./parts";
import { loadAnalysis } from "./data";
import { DCF } from "./strings";
import type { DcfPanelProps } from "./types";

const MIO = 1e6;
const PCT = 0.01;
const YEARS = [3, 5, 7, 10] as const;
const TARGETS = [1.25, 1.5, 2, 3] as const;
const TARGET_LABEL: Record<number, string> = { 1.25: "+25 %", 1.5: "+50 %", 2: "×2", 3: "×3" };

function assumptionLines(f: SimpleAssumptions, cur: string): string[] {
  const p = (v: number | null): string => (v == null ? "–" : levelText(v));
  const m = (v: number | null): string => (v == null ? "–" : money(v, cur));
  return [
    `Zeitraum ${f.years} Jahre`,
    `Umsatz im Basisjahr ${m(f.baseRevenue)}`,
    `Umsatzwachstum ${p(f.growthStart)} im Jahr 1, ${p(f.growthEnd)} im letzten Jahr`,
    `EBIT-Marge ${p(f.marginStart)} im Jahr 1, ${p(f.marginEnd)} im letzten Jahr`,
    `Reinvestitionsquote ${p(f.reinvestStart)} im Jahr 1, ${p(f.reinvestEnd)} im letzten Jahr`,
    `Steuersatz ${p(f.taxRate)}`,
    `WACC ${p(f.wacc)}, Endwachstum ${p(f.terminalGrowth)}`,
    `Nettoverschuldung ${m(f.netDebt)}, Aktien ${f.shares == null ? "–" : `${n1(f.shares / MIO)} Mio.`}`,
    "Jahresendwerte: Die Cashflows fallen am Ende jedes Jahres an.",
  ];
}

export function DcfPanel({ ticker: tickerProp = "", seed = null, className, bare, hosted, fetchImpl, now }: DcfPanelProps) {
  const [form, setForm] = useState<SimpleAssumptions>(() => (seed ? simpleFromSeed(seed) : EMPTY_SIMPLE));
  const [seedInfo, setSeedInfo] = useState<DcfSeed | null>(seed);
  const [applied, setApplied] = useState<DcfSeed | null>(seed);
  const [fieldsKey, setFieldsKey] = useState(0);
  const [ticker, setTicker] = useState(tickerProp);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SecError | null>(null);
  const [priceText, setPriceText] = useState<number | null>(null);
  const [priceSource, setPriceSource] = useState("");
  const [target, setTarget] = useState<number>(1.5);
  // the year-by-year projection is a table from md up (open by default there) and long cards on a phone (closed)
  const wide = useMediaQuery("(min-width: 768px)");

  // a seed from the host (the analyst's "In den DCF-Rechner übernehmen") fills the form once per new seed
  if (seed && seed !== applied) {
    setApplied(seed);
    setSeedInfo(seed);
    setForm((f) => ({ ...simpleFromSeed(seed, f.years), growthStart: f.growthStart, growthEnd: f.growthEnd, wacc: f.wacc, terminalGrowth: f.terminalGrowth }));
    setFieldsKey((k) => k + 1);
    setError(null);
  }

  const cur = seedInfo?.currency ?? "USD";
  const set = <K extends keyof SimpleAssumptions>(k: K, v: SimpleAssumptions[K]): void => setForm((f) => ({ ...f, [k]: v }));

  const loadSec = async (): Promise<void> => {
    const t = normalizeTicker(ticker);
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      const a = await loadAnalysis(t, { ...(fetchImpl ? { fetchImpl } : {}), ...(now ? { now: now() } : {}) });
      const s = seedFromAnalyst(a.result);
      setSeedInfo(s);
      setForm((f) => ({ ...simpleFromSeed(s, f.years), growthStart: f.growthStart, growthEnd: f.growthEnd, wacc: f.wacc, terminalGrowth: f.terminalGrowth }));
      setFieldsKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof SecError ? e : (toSecError(e) as SecError));
    } finally {
      setLoading(false);
    }
  };

  const built = useMemo(() => buildAssumptions(form), [form]);
  const result = useMemo(() => (built.assumptions ? runDcf(built.assumptions) : null), [built]);
  const sens = useMemo(() => (built.assumptions && result && result.status !== "invalid" ? sensitivity(built.assumptions) : null), [built, result]);
  const range = useMemo(() => (sens ? rangeOf(sens) : null), [sens]);
  const value = result?.status === "ok" ? result.value : null;
  const priced = priceText != null && priceText > 0 && priceSource.trim().length > 0;
  const reverse = useMemo(() => (priced && value ? impliedGrowth(form, priceText! * target) : null), [priced, value, form, priceText, target]);
  const errors = result?.issues.filter((i) => i.level === "error") ?? [];
  const warns = result?.issues.filter((i) => i.level === "warn") ?? [];

  const body = (
    <div className={cn("grid min-w-0 gap-5", className)} data-testid="dcf-panel" data-status={result ? result.status : "incomplete"}>
      <p className="max-w-[78ch] text-[13px] leading-relaxed text-mute">{DCF.lead}</p>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* ------------------------------------------------------------------ inputs */}
        <div className="grid min-w-0 content-start gap-5">
          <section className="grid gap-3" aria-label={DCF.startTitle}>
            <Sub>{DCF.startTitle}</Sub>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Börsenkürzel" htmlFor="dcf-ticker" className="w-full max-w-[180px]">
                <Input id="dcf-ticker" value={ticker} autoCapitalize="characters" spellCheck={false} maxLength={10} placeholder="AAPL" data-testid="dcf-ticker" onChange={(e) => setTicker(e.target.value.toUpperCase())} />
              </Field>
              <Button size="sm" onClick={() => void loadSec()} disabled={!normalizeTicker(ticker) || loading} data-testid="dcf-load-sec">
                {loading ? DCF.loadingSec : DCF.loadSec}
              </Button>
            </div>
            {error ? <SecErrorBox error={error} testId="dcf-sec-error" /> : <p className="text-[12px] leading-relaxed text-mute">{seedInfo ? DCF.secLoaded(seedInfo.stamp.source, seedInfo.asOf ? dateDe(seedInfo.asOf) : "unbekannt") : DCF.secHelp}</p>}

            <div key={fieldsKey} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <NumField label={`Umsatz im Basisjahr (Mio. ${cur})`} value={form.baseRevenue} factor={MIO} onCommit={(v) => set("baseRevenue", v)} testId="dcf-in-revenue" help={seedInfo?.sources.baseRevenue} />
              <NumField label={`Nettoverschuldung (Mio. ${cur})`} value={form.netDebt} factor={MIO} onCommit={(v) => set("netDebt", v)} testId="dcf-in-netdebt" help={seedInfo?.sources.netDebt ?? "Schulden minus Kasse; bei Nettoguthaben negativ"} />
              <NumField label="Verwässerte Aktien (Mio.)" value={form.shares} factor={MIO} onCommit={(v) => set("shares", v)} testId="dcf-in-shares" help={seedInfo?.sources.shares} />
              <NumField label="Steuersatz" value={form.taxRate} factor={PCT} suffix="%" onCommit={(v) => set("taxRate", v)} testId="dcf-in-tax" help={seedInfo?.sources.taxRate} />
            </div>
          </section>

          <section className="grid gap-3" aria-label={DCF.assumptionsTitle}>
            <Sub>{DCF.assumptionsTitle}</Sub>
            <p className="text-[12px] leading-relaxed text-mute">{DCF.assumptionsNote}</p>
            <div className="grid gap-1.5">
              <span className="label">Zeitraum (Jahre)</span>
              <Segmented aria-label="Zeitraum in Jahren" options={YEARS.map((y) => ({ v: String(y), label: `${y}` }))} value={String(form.years)} onChange={(v) => set("years", Number(v))} />
            </div>
            <div key={`a${fieldsKey}`} className="grid grid-cols-2 gap-3">
              <NumField label="Wachstum Jahr 1" value={form.growthStart} factor={PCT} suffix="%" onCommit={(v) => set("growthStart", v)} testId="dcf-in-g1" />
              <NumField label="Wachstum letztes Jahr" value={form.growthEnd} factor={PCT} suffix="%" onCommit={(v) => set("growthEnd", v)} testId="dcf-in-gn" />
              <NumField label="EBIT-Marge Jahr 1" value={form.marginStart} factor={PCT} suffix="%" onCommit={(v) => set("marginStart", v)} testId="dcf-in-m1" help={seedInfo?.ebitMargin != null ? undefined : seedInfo?.sources.ebitMargin} />
              <NumField label="EBIT-Marge letztes Jahr" value={form.marginEnd} factor={PCT} suffix="%" onCommit={(v) => set("marginEnd", v)} testId="dcf-in-mn" />
              <NumField label="Reinvestition Jahr 1" value={form.reinvestStart} factor={PCT} suffix="%" onCommit={(v) => set("reinvestStart", v)} testId="dcf-in-r1" help="Anteil des Gewinns nach Steuern, der wieder investiert wird" />
              <NumField label="Reinvestition letztes Jahr" value={form.reinvestEnd} factor={PCT} suffix="%" onCommit={(v) => set("reinvestEnd", v)} testId="dcf-in-rn" />
              <NumField label="WACC" value={form.wacc} factor={PCT} suffix="%" onCommit={(v) => set("wacc", v)} testId="dcf-in-wacc" help="Kapitalkostensatz, mit dem abgezinst wird" />
              <NumField label="Endwachstum" value={form.terminalGrowth} factor={PCT} suffix="%" onCommit={(v) => set("terminalGrowth", v)} testId="dcf-in-tg" help="Wachstum nach dem letzten Jahr, unter dem WACC" />
            </div>
            {seedInfo?.growthHint != null && (
              <p className="text-[12px] leading-relaxed text-mute" data-testid="dcf-growth-hint">
                Zuletzt gemeldet: Umsatz {pctText(seedInfo.growthHint)} zum Vorjahresquartal – ein Hinweis, keine Annahme.
              </p>
            )}
            <div className="grid gap-1.5">
              <Button
                size="sm"
                onClick={() => {
                  setForm((f) => ({ ...f, wacc: EXAMPLE_RATES.wacc, terminalGrowth: EXAMPLE_RATES.terminalGrowth }));
                  setFieldsKey((k) => k + 1);
                }}
                data-testid="dcf-example"
              >
                {DCF.example}
              </Button>
              <p className="text-[11.5px] leading-relaxed text-mute">{DCF.exampleNote}</p>
            </div>
          </section>
        </div>

        {/* ------------------------------------------------------------------ result */}
        <div className="grid min-w-0 content-start gap-5">
          <section className="grid gap-3" aria-label={DCF.resultTitle} data-testid="dcf-result">
            <Sub>{DCF.resultTitle}</Sub>
            {!built.assumptions ? (
              <p className="rounded-xl border border-line bg-ink-950/40 p-3.5 text-[13px] leading-snug text-mute" role="status" data-testid="dcf-missing">
                {DCF.missing(built.missing)}
              </p>
            ) : (
              <>
                {errors.length > 0 && (
                  <ul className="grid gap-2" role="alert" data-testid="dcf-errors">
                    {errors.map((i, k) => (
                      <li key={k} className="rounded-xl border border-warn/30 bg-warn/[0.06] p-3 text-[13px] leading-snug" data-field={i.field}>
                        {i.text}
                      </li>
                    ))}
                  </ul>
                )}
                {value && (
                  <div className="grid gap-3 rounded-xl border border-line bg-ink-950/40 p-4" data-testid="dcf-value" data-terminal-share={value.terminalShare ?? ""}>
                    <div className="grid gap-1">
                      <span className="label">{DCF.rangeLead}</span>
                      {range ? (
                        <p className="num font-mono text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]" data-testid="dcf-range" data-low={range.low} data-high={range.high}>
                          {n2(range.low)} <span className="text-mute">bis</span> {n2(range.high)} <span className="text-[15px] font-medium text-mute">{cur}</span>
                        </p>
                      ) : (
                        <p className="num font-mono text-[26px] font-semibold" data-testid="dcf-range">
                          {n2(value.perShare)} <span className="text-[15px] font-medium text-mute">{cur}</span>
                        </p>
                      )}
                      {range && <p className="text-[12px] leading-relaxed text-mute">{DCF.rangeSub(`${n2(range.low)} ${cur}`, `${n2(range.high)} ${cur}`, `${n1(range.waccSpan[0] * 100)} – ${n1(range.waccSpan[1] * 100)} %`, `${n1(range.growthSpan[0] * 100)} – ${n1(range.growthSpan[1] * 100)} %`)}</p>}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                      <div>
                        <dt className="text-[11px] text-mute">{DCF.baseCase}</dt>
                        <dd className="num font-mono" data-testid="dcf-base-value">
                          {n2(value.perShare)} {cur}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-mute">{DCF.ev}</dt>
                        <dd className="num font-mono">{money(value.enterpriseValue, cur)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-mute">{DCF.equity}</dt>
                        <dd className="num font-mono">{money(value.equityValue, cur)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-mute">Endwert-Anteil</dt>
                        <dd className="num font-mono" data-testid="dcf-tv-share">
                          {value.terminalShare != null ? levelText(value.terminalShare) : "–"}
                        </dd>
                      </div>
                    </dl>
                    {value.terminalShare != null && (
                      <div className="grid gap-1.5">
                        <span role="img" aria-label={`Endwert-Anteil ${levelText(value.terminalShare)}`} className="block h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                          <span className="block h-full origin-left rounded-full bg-fg/80" style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, value.terminalShare))})` }} />
                        </span>
                        <p className="text-[12px] leading-relaxed text-mute" data-testid="dcf-tv-note">
                          {DCF.tvShare(levelText(value.terminalShare))}
                        </p>
                      </div>
                    )}
                  </div>
                )}
                {warns.length > 0 && (
                  <ul className="grid gap-1.5" data-testid="dcf-warnings">
                    {warns.map((i, k) => (
                      <li key={k} className="flex gap-2 text-[12.5px] leading-snug text-warn" data-field={i.field}>
                        <span aria-hidden="true">!</span>
                        <span>{i.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          {sens && (
            <section className="grid gap-2" aria-label={DCF.sensitivityTitle} data-testid="dcf-sensitivity">
              <Sub>{DCF.sensitivityTitle}</Sub>
              <div className="overflow-hidden rounded-xl border border-line">
                <table className="w-full table-fixed border-collapse text-center text-[12px]">
                  <caption className="sr-only">{DCF.sensitivityCaption(cur)}</caption>
                  <thead>
                    <tr className="text-[10.5px] text-mute">
                      <th scope="col" className="w-[18%] border-b border-line px-1 py-1.5 text-left font-semibold">
                        WACC \ g
                      </th>
                      {sens.growths.map((g) => (
                        <th key={g} scope="col" className="border-b border-line px-1 py-1.5 font-semibold">
                          <span className="num font-mono">{n1(g * 100)} %</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sens.cells.map((row, i) => (
                      <tr key={sens.waccs[i]}>
                        <th scope="row" className="border-b border-line/60 px-1 py-1.5 text-left font-semibold text-mute">
                          <span className="num font-mono">{n1(sens.waccs[i]! * 100)} %</span>
                        </th>
                        {row.map((c, j) => {
                          const center = i === sens.center.row && j === sens.center.col;
                          const inner = Math.abs(i - sens.center.row) <= 1 && Math.abs(j - sens.center.col) <= 1;
                          return (
                            <td key={c.terminalGrowth} data-center={center ? "1" : undefined} data-inner={inner ? "1" : undefined} className={cn("border-b border-line/60 px-1 py-1.5", center && "bg-white/[0.08] font-semibold", !center && inner && "bg-white/[0.03]")}>
                              {c.perShare == null ? (
                                <span className="text-faint" title="WACC nicht größer als Endwachstum – kein Wert">
                                  –
                                </span>
                              ) : (
                                <span className={cn("num font-mono", c.perShare <= 0 && "text-loss")}>{n2(c.perShare)}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11.5px] leading-relaxed text-mute">{DCF.sensitivityCaption(cur)}</p>
            </section>
          )}

          {result && result.years.length > 0 && (
            <Disclosure title={DCF.projectionTitle} count={result.years.length} defaultOpen={wide} testId="dcf-projection">
              <div className="hidden md:block">
                <table className="w-full border-collapse text-right text-[12px]">
                  <thead>
                    <tr className="text-[10.5px] text-mute">
                      {["Jahr", "Umsatz", "Wachstum", "EBIT-Marge", "NOPAT", "Reinvestition", "Freier Cashflow", "Barwert"].map((h, i) => (
                        <th key={h} scope="col" className={cn("border-b border-line px-1.5 py-1.5 font-semibold", i === 0 && "text-left")}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.years.map((y) => (
                      <tr key={y.year} data-testid="dcf-year" data-year={y.year}>
                        <th scope="row" className="border-b border-line/60 px-1.5 py-1.5 text-left font-normal">
                          {y.year}
                        </th>
                        <td className="num border-b border-line/60 px-1.5 py-1.5 font-mono">{money(y.revenue, cur)}</td>
                        <td className="num border-b border-line/60 px-1.5 py-1.5 font-mono">{pctText(y.growth)}</td>
                        <td className="num border-b border-line/60 px-1.5 py-1.5 font-mono">{levelText(y.margin)}</td>
                        <td className="num border-b border-line/60 px-1.5 py-1.5 font-mono">{money(y.nopat, cur)}</td>
                        <td className="num border-b border-line/60 px-1.5 py-1.5 font-mono">{levelText(y.reinvestmentRate)}</td>
                        <td className={cn("num border-b border-line/60 px-1.5 py-1.5 font-mono", y.fcf < 0 && "text-loss")}>{money(y.fcf, cur)}</td>
                        <td className="num border-b border-line/60 px-1.5 py-1.5 font-mono">{money(y.presentValue, cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="grid gap-2 md:hidden">
                {result.years.map((y) => (
                  <li key={y.year} className="grid gap-1 rounded-xl border border-line bg-ink-950/40 p-3 text-[12.5px]" data-testid="dcf-year-card" data-year={y.year}>
                    <p className="font-semibold">Jahr {y.year}</p>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                      {(
                        [
                          ["Umsatz", money(y.revenue, cur)],
                          ["Wachstum", pctText(y.growth)],
                          ["EBIT-Marge", levelText(y.margin)],
                          ["NOPAT", money(y.nopat, cur)],
                          ["Reinvestition", levelText(y.reinvestmentRate)],
                          ["Freier Cashflow", money(y.fcf, cur)],
                          ["Barwert", money(y.presentValue, cur)],
                        ] as const
                      ).map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-[11px] text-mute">{k}</dt>
                          <dd className="num font-mono">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}

          {value && (
            <section className="grid gap-3" aria-label={DCF.priceTitle} data-testid="dcf-price">
              <Sub>{DCF.priceTitle}</Sub>
              <p className="text-[12px] leading-relaxed text-mute">{DCF.priceHelp}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <NumField label={`Kurs (${cur})`} value={priceText} onCommit={setPriceText} testId="dcf-in-price" />
                <TextField label="Quelle des Kurses" value={priceSource} onCommit={setPriceSource} placeholder="z. B. Broker-Kurs vom 24.10." testId="dcf-in-price-source" />
              </div>
              {priceText != null && priceText > 0 && !priced && (
                <p className="text-[12px] text-warn" data-testid="dcf-price-nosource">
                  {DCF.priceNoSource}
                </p>
              )}
              {priced && (
                <div className="grid gap-3">
                  <p className="text-[13px] leading-snug" data-testid="dcf-vs-price">
                    Der Rechenwert ({n2(value.perShare)} {cur}) liegt {pctText(value.perShare / priceText! - 1)} {value.perShare >= priceText! ? "über" : "unter"} dem eingegebenen Kurs ({n2(priceText!)} {cur}, Quelle: {priceSource.trim()}). Das ist ein Ergebnis deiner Annahmen, keine Aussage darüber, ob der Kurs „richtig“ ist.
                  </p>
                  <div className="grid gap-2" data-testid="dcf-reverse">
                    <Sub>{DCF.reverseTitle}</Sub>
                    <p className="text-[12px] leading-relaxed text-mute">{DCF.reverseLead}</p>
                    <Segmented aria-label="Zielwert gegenüber dem Kurs" options={TARGETS.map((t) => ({ v: String(t), label: TARGET_LABEL[t]! }))} value={String(target)} onChange={(v) => setTarget(Number(v))} />
                    {reverse && (
                      <p className="text-[13px] leading-snug" data-testid="dcf-reverse-result" data-reason={reverse.reason}>
                        {reverse.reason === "ok"
                          ? `Für ${n2(priceText! * target)} ${cur} je Aktie bräuchte das Modell ein gleichbleibendes Umsatzwachstum von ${levelText(reverse.growth)} pro Jahr (deine Annahme: ${levelText(form.growthStart)} im Jahr 1, ${levelText(form.growthEnd)} im letzten Jahr).`
                          : reverse.reason === "missing"
                            ? DCF.missing(reverse.missing)
                            : DCF.notReached}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          <Disclosure title={DCF.assumptionsListTitle} defaultOpen={false} testId="dcf-assumption-list">
            <ul className="grid gap-1 text-[12.5px] leading-relaxed text-mute" data-testid="dcf-assumptions">
              {assumptionLines(form, cur).map((l) => (
                <li key={l}>{l}</li>
              ))}
              {seedInfo && <li>Ausgangszahlen: {seedInfo.stamp.source}, Abruf {dateDe(new Date(seedInfo.stamp.fetchedAt).toISOString().slice(0, 10))}, Quartal bis {seedInfo.asOf ? dateDe(seedInfo.asOf) : "unbekannt"}.</li>}
            </ul>
          </Disclosure>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="mute">Modellrechnung</Badge>
        <span className="text-[12px] text-mute">Keine Kaufempfehlung.</span>
      </div>
      <div data-testid="dcf-note">
        <PanelNote lead={DCF.disclaimer} hosted={hosted} />
      </div>
    </div>
  );
  return bare ? body : <Card title={DCF.title}>{body}</Card>;
}

export default DcfPanel;
