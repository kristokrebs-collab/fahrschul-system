/**
 * `Korrelation` (P05): Pearson ρ of the daily returns between the traded pairs (`src/market/multiDaily.ts`: one fetch
 * per pair and UTC day) as a matrix that cascades in from the strongest pair (`HeatGridReveal`). Strong positive
 * coupling glows in the signal red (that is the risk: "three longs that are one trade"), negative is grey. Clusters
 * (ρ ≥ 0,7) are named below; open positions on the same side inside a cluster raise a warning on the page.
 */
import { useMemo } from "react";
import { CORR_CLUSTER, type CorrCluster, type CorrMatrix } from "@/domain/risk";
import { cn } from "@/lib/cn";
import { retryDaily, type MultiDailyView } from "@/market/multiDaily";
import { DotMatrixText, HeatGridReveal, heatColor } from "@/motion/fx";
import { Button } from "@/primitives/Button";
import { EmptyState } from "@/primitives/EmptyState";
import { SourceStand } from "@/ui/SourceStand";
import { RISIKO } from "./strings";
import { RiskCard } from "./ui";

const S = RISIKO.corr;
const DAY_MS = 86_400_000;
const short = (s: string) => s.replace(/(USDT|USDC|BUSD)$/, "");
const rhoText = (r: number) => r.toFixed(2).replace(".", ",").replace("-", "−");

function cellColor(r: number | null, diag: boolean): string {
  if (diag) return "var(--color-ink-750)";
  if (r == null) return "var(--color-ink-850)";
  return r >= 0 ? heatColor(r * r, "signal") : heatColor(Math.abs(r) * 0.6, "fg");
}

export function CorrelationCard({ symbols, view, cm, clusters }: { symbols: readonly string[]; view: MultiDailyView; cm: CorrMatrix; clusters: readonly CorrCluster[] }) {
  const k = cm.symbols.length;
  const origin = useMemo((): [number, number] => {
    let best: [number, number] = [1, 1];
    let bestR = -2;
    for (let i = 0; i < k; i++)
      for (let j = i + 1; j < k; j++) {
        const r = cm.rho[i]![j];
        if (r != null && r > bestR) {
          bestR = r;
          best = [i + 1, j + 1];
        }
      }
    return best;
  }, [cm, k]);
  const loading = view.state === "loading" || view.pending.length > 0;
  /** open time of the newest closed UTC day over all pairs read */
  const newestDay = useMemo(() => {
    let t: number | null = null;
    for (const rows of Object.values(view.series)) {
      const last = rows[rows.length - 1];
      if (last && (t == null || last.t > t)) t = last.t;
    }
    return t;
  }, [view.series]);
  const summary = useMemo(() => {
    const pairs: string[] = [];
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) if (cm.rho[i]![j] != null) pairs.push(`${short(cm.symbols[i]!)}·${short(cm.symbols[j]!)} ${rhoText(cm.rho[i]![j]!)}`);
    return `${S.matrix}: ${pairs.join(", ") || "zu wenig Daten"}`;
  }, [cm, k]);

  if (symbols.length < 2) {
    return (
      <RiskCard title={S.title} data-testid="risk-corr" data-state="few">
        <EmptyState title={S.empty} text={S.emptyText} line={false} />
      </RiskCard>
    );
  }

  const action = loading ? (
    <DotMatrixText text="1D" preset="wave" cycles={Infinity} size={3} gap={1} tone="mute" label={S.loading} />
  ) : view.failed.length ? (
    <Button size="sm" variant="secondary" onClick={() => void retryDaily()}>
      {S.retry}
    </Button>
  ) : undefined;

  return (
    <RiskCard title={S.title} note={S.note} action={action} data-testid="risk-corr" data-state={view.state} data-n={k}>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:items-start">
        {k >= 2 ? (
          <HeatGridReveal
            cols={k + 1}
            origin={origin}
            play={k}
            role="img"
            aria-label={summary}
            className="grid w-full max-w-[28rem] gap-1 xl:max-w-[24rem]"
            cellClassName="min-w-0"
          >
            {[
              <span key="corner" aria-hidden="true" />,
              ...cm.symbols.map((s) => (
                <span key={`h-${s}`} className="grid h-7 place-items-center truncate font-mono text-[10px] text-mute">
                  {short(s)}
                </span>
              )),
              ...cm.symbols.flatMap((row, i) => [
                <span key={`r-${row}`} className="grid h-9 items-center truncate pr-1 font-mono text-[10px] text-mute">
                  {short(row)}
                </span>,
                ...cm.symbols.map((col, j) => {
                  const r = cm.rho[i]![j] ?? null;
                  const diag = i === j;
                  const strong = !diag && r != null && r >= CORR_CLUSTER;
                  return (
                    <span
                      key={`${row}-${col}`}
                      title={diag ? row : `${short(row)} · ${short(col)}: ${r == null ? "zu wenig Daten" : rhoText(r)} (${cm.n[i]![j]} Tage)`}
                      className={cn("grid h-9 place-items-center rounded-md font-mono text-[10.5px]", diag ? "text-faint" : strong ? "text-white" : "text-fg/80")}
                      style={{ background: cellColor(r, diag) }}
                      data-rho={r == null ? "" : r.toFixed(3)}
                    >
                      {diag ? "·" : r == null ? "–" : rhoText(r)}
                    </span>
                  );
                }),
              ]),
            ]}
          </HeatGridReveal>
        ) : (
          // the matrix of the pairs that will be read keeps its room while the daily candles load (header 28 px + a 36 px row and 4 px gap per pair)
          <p className="text-[12.5px] text-mute" style={{ minHeight: 28 + symbols.length * 40 }}>
            {loading ? S.loading : (view.detail ?? S.empty)}
          </p>
        )}
        <div className="grid min-w-0 content-start gap-2">
          <div className="grid gap-1.5" data-testid="corr-clusters">
            {clusters.length ? (
              clusters.slice(0, 2).map((c) => (
                <div key={c.symbols.join("+")} className="flex min-w-0 items-start gap-2 rounded-xl border border-warn/25 bg-warn/[0.06] px-3 py-2 text-[12px] leading-snug text-warn">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />
                  <span className="min-w-0">
                    {S.cluster(c.symbols.length, c.avg.toFixed(2).replace(".", ","))} <span className="font-mono text-fg">{c.symbols.map(short).join(" · ")}</span>
                  </span>
                </div>
              ))
            ) : k >= 2 ? (
              <span className="text-[11.5px] text-faint">{S.noCluster}</span>
            ) : null}
            {view.detail && !loading && <span className="text-[11px] text-faint">{view.detail}</span>}
          </div>
          <p className="max-w-[46ch] text-[12px] leading-relaxed text-mute">{S.explain}</p>
          {/* source and the newest closed UTC day behind the matrix (`keine Daten` while nothing was read) */}
          <SourceStand source={newestDay != null ? `Binance USDⓈ-M, Tageskerzen${view.viaProxy ? " (EU-Proxy)" : ""}` : null} parts={[{ label: "letzter Tagesschluss", at: newestDay != null ? newestDay + DAY_MS : null }]} className="max-w-[46ch]" testId="corr-stand" />
        </div>
      </div>
    </RiskCard>
  );
}
