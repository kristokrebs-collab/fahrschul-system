/**
 * Muster-Entdecker im Labor (Auftrag B): the host of `DiscoveryPanel` at the end of the page. It chooses what the panel looks at –
 * the trades of the SHOWN backtest (with the candles it ran on and the user's key levels that existed before each entry) or the
 * real journal trades – and wires "Mit diesem Filter testen" to the Labor's filter comparison: the confirmed pattern becomes the
 * pattern filter of `useExtras`, the comparison runs the same set-up with and without it. Nothing is adopted: the base run, the
 * rules and the saved drafts stay as they are.
 *
 * Own lazy chunk of `LaborView` (the whole search domain loads with it, not with the page).
 */
import { useMemo, useState } from "react";
import { HIST_MS, type HistInterval } from "@/domain/backtest/index";
import { fromBacktest, fromJournal } from "@/domain/discovery/adapters";
import { pctText, rText } from "@/domain/discovery/text";
import type { DiscoveryLevel, Finding } from "@/domain/discovery/types";
import type { PatternFilterSpec } from "@/domain/discovery/spec";
import type { FilterCompare } from "@/domain/lab/filters";
import { keyLevelsOfSettings } from "@/domain/keylevels/config";
import { Segmented } from "@/primitives/Segmented";
import { useEnriched, useJournal } from "@/store/journalStore";
import { DiscoveryPanel, type FilterTestState } from "@/views/discovery/DiscoveryPanel";
import { runFilters, useExtras } from "./extrasStore";
import { useLabor } from "./laborStore";
import { SEG_TOUCH } from "./ui";

type Source = "backtest" | "journal";

const SOURCES = [
  { v: "backtest" as const, label: "Letzter Backtest" },
  { v: "journal" as const, label: "Journal-Trades" },
];

const CAVEAT = "Das Muster stammt aus genau diesen Trades – der Test auf denselben Daten kann es nur bestätigen, nicht beweisen. Aussagekräftig wird es erst auf einem anderen Zeitraum oder einem anderen Markt. Keine professionelle Finanzberatung.";

/** The sentence under a finding after "Mit diesem Filter testen": the base run against the same run with the pattern. */
function compareText(cmp: FilterCompare): string {
  const base = cmp.rows.find((r) => r.id === "base");
  const only = cmp.rows.find((r) => r.id === "only:pattern");
  if (!base?.stats || !only?.stats) return `Der Vergleich konnte nicht gerechnet werden. ${CAVEAT}`;
  const line = (n: number, sumR: number, win: number | null): string => `${n} Trades, Σ R ${rText(sumR)}, Trefferquote ${pctText(win)}`;
  const rej = only.asked > 0 ? ` (${only.blocked} von ${only.asked} Signalen abgelehnt${only.unknown ? `, ${only.unknown} nicht beurteilbar` : ""})` : "";
  return `Ohne Filter: ${line(base.stats.n, base.stats.sumR, base.stats.winRate)}. Mit dem Muster: ${line(only.stats.n, only.stats.sumR, only.stats.winRate)}${rej}. ${CAVEAT}`;
}

export default function DiscoverySection() {
  const result = useLabor((s) => s.result);
  const bars = useLabor((s) => s.bars);
  const enriched = useEnriched();
  const settings = useJournal((s) => s.settings);
  const [pick, setPick] = useState<Source>(result ? "backtest" : "journal");
  const hasRun = result != null && bars.length > 0;
  const source: Source = pick === "backtest" && !hasRun ? "journal" : pick;

  const backtest = useMemo(() => {
    if (!result || bars.length === 0) return null;
    const ms = HIST_MS[result.interval as HistInterval];
    if (!ms) return null;
    const levels: DiscoveryLevel[] = keyLevelsOfSettings(settings)
      .levels.filter((l) => l.symbol === result.symbol && l.since != null)
      .map((l) => ({ price: l.price, sinceMs: l.since }));
    return fromBacktest(result.trades, bars, ms / 1000, { label: `${result.symbol} ${result.interval} · ${result.name ?? "Backtest"}`, ...(levels.length ? { levels } : {}) });
  }, [result, bars, settings]);

  const journal = useMemo(() => {
    const names = new Map(settings.setups.map((s) => [s.id, s.name] as const));
    return fromJournal(enriched, { setupName: (id) => names.get(id) ?? null, label: "Journal" });
  }, [enriched, settings.setups]);

  const input = source === "backtest" && backtest ? backtest : journal;

  const [testId, setTestId] = useState<string | null>(null);
  const slice = useExtras((s) => s.filters);
  const onTest = (spec: PatternFilterSpec, f: Finding): void => {
    setTestId(f.id);
    useExtras.getState().setPattern(spec);
    void runFilters();
  };
  const filterTest: FilterTestState | null =
    testId && slice.status !== "idle"
      ? slice.status === "running"
        ? { id: testId, status: "running", text: "Der Backtest läuft mit und ohne Muster …" }
        : slice.status === "done" && slice.result
          ? { id: testId, status: "done", text: compareText(slice.result) }
          : { id: testId, status: "error", text: slice.error ?? "Der Vergleich ist nicht fertig geworden." }
      : null;

  return (
    <div className="grid gap-3" data-testid="labor-discovery" data-source={source}>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented size="sm" className={SEG_TOUCH} aria-label="Woher die Trades kommen" value={source} onChange={setPick} options={SOURCES.map((o) => ({ ...o, disabled: o.v === "backtest" && !hasRun }))} />
        {!hasRun && <p className="text-[12px] text-faint">Für „Letzter Backtest“ oben einen Lauf starten.</p>}
      </div>
      <DiscoveryPanel
        trades={input.trades}
        {...(input.markets ? { markets: input.markets } : {})}
        source={source}
        {...(input.label ? { label: input.label } : {})}
        {...(source === "backtest" ? { onTestFilter: onTest, filterTest } : {})}
      />
    </div>
  );
}
