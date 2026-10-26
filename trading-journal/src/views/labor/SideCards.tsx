/**
 * Labor side cards (P07): the assumptions (prominent – what the numbers rest on), the backtest reference (a
 * `HoldButton` writes `settings.backtest` with the SAME meaning `BacktestCompare` reads – it runs unchanged – and
 * celebrates with the `record` preset) and the comparison of the last runs, dealt as cards (`CardSpread`, best first).
 */
import { useRef } from "react";
import { feePreset, referenceLabel, slippageText, STRATEGY_TITLE, toBacktestReference, VERDICT_TEXT, type LabResult } from "@/domain/backtest/index";
import { cn } from "@/lib/cn";
import { date as fmtDate, n0 } from "@/lib/format";
import { celebrateRecord, EquityDraw } from "@/motion/fx";
import { HoldButton } from "@/motion/HoldButton";
import { CardSpread } from "@/motion/pulse/CardSpread";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { useLabor, type LabConfig, type RunSummary } from "./laborStore";
import { LABOR } from "./strings";
import { numText, pctText, rText } from "./ui";

/* ------------------------------------------------------------------ assumptions */

export function assumptionLines(r: LabResult, cfg: LabConfig, funding: "history" | "flat" | "none" | null): string[] {
  const tf = r.interval === "1d" ? "1D" : r.interval;
  const fee = feePreset(cfg.exchange);
  const lines = [
    `${n0(r.bars)} geschlossene ${tf}-Kerzen ${r.symbol} von Binance-Futures, ${fmtDate(new Date(r.from))} bis ${fmtDate(new Date(r.to))}${r.gaps.gaps ? `, ${r.gaps.gaps} Datenlücke${r.gaps.gaps === 1 ? "" : "n"} (${r.gaps.missing} Kerzen fehlen)` : ""}.`,
    "Kein Blick in die Zukunft: Entscheidung zum Kerzenschluss, Ausführung zur nächsten Eröffnung.",
    "Liegen Stop und Ziel in derselben Kerze, zählt der Stop. Ein Gap über den Stop füllt zur Eröffnung.",
    `Gebühren ${fee.label}: ${String(fee.makerBps).replace(".", ",")} bp Maker (Ziele als Limit), ${String(fee.takerBps).replace(".", ",")} bp Taker (Einstieg, Stop, Zeit-Stop).`,
    `Slippage: ${slippageText(cfg.slippage)}.`,
    funding === "history" ? "Funding: echte Historie von Binance, alle 8 h aufs Notional." : funding === "flat" ? "Funding: Annahme 0,01 % je 8 h (keine Historie verfügbar oder gewählt)." : "Funding: nicht gerechnet.",
    `${String(cfg.riskPct).replace(".", ",")} % Risiko pro Trade, höchstens ${cfg.maxLeverage}× Hebel, Start ${n0(cfg.capital)} USDT, mit Zinseszins.`,
    "Optimiert auf den ersten 70 %, geprüft auf den letzten 30 %. Walk-forward mit 5 Fenstern.",
  ];
  if (r.strategy === "box") lines.push("Box-Engine wie live. Top-Trader-Bias gibt es historisch nicht: zählt als „keine Daten“. Vorbereitete Ausbrüche werden nie gehandelt.");
  if (r.strategy === "mcb") lines.push("Einstiegs-Check wie live, aber ohne Top-Trader-Teil und Lage-Ampel (keine Historie). Einstieg nur bei einem neuen Signal.");
  if (r.strategy === "rules") lines.push("Einstieg nur, wenn alle Bedingungen neu zutreffen. Stop und Ziel über die ATR(14).");
  if (r.strategy === "custom") {
    lines.push("Eigene Idee: Einstieg nur bei einem NEUEN Signal (die Regel war an der Kerze davor nicht erfüllt). Höhere Zeitebenen zählen erst nach ihrem Kerzenschluss.");
    lines.push("Fehlen Daten für eine Bedingung (zu wenig Vorlauf, Lücke, kein Volumen), gilt sie als unbekannt und ist nie erfüllt.");
    lines.push("Break-even, Trailing und Teilverkauf werden zum Kerzenschluss entschieden und gelten ab der nächsten Kerze. Der Stop wird nie gelockert, R misst am ursprünglichen Stop.");
  }
  return lines;
}

/** Before the first run: how the lab computes (with the current set-up's costs). */
export function principleLines(cfg: LabConfig): string[] {
  const fee = feePreset(cfg.exchange);
  return [
    "Echte Kerzen von Binance-Futures, nur geschlossene. Einmal geladen liegen sie im Cache.",
    "Kein Blick in die Zukunft: Entscheidung zum Kerzenschluss, Ausführung zur nächsten Eröffnung.",
    "Liegen Stop und Ziel in derselben Kerze, zählt der Stop.",
    `Gebühren ${fee.label} ${String(fee.makerBps).replace(".", ",")} / ${String(fee.takerBps).replace(".", ",")} bp, Slippage ${slippageText(cfg.slippage)}, Funding ${LABOR.fundingModes[cfg.funding]}.`,
    "Danach der Härtetest: Out-of-Sample, Walk-forward, Deflated Sharpe und PBO.",
  ];
}

export function AssumptionsCard({ className }: { className?: string }) {
  const result = useLabor((s) => s.result);
  const runCfg = useLabor((s) => s.runCfg);
  const cfg = useLabor((s) => s.cfg);
  const funding = useLabor((s) => s.fundingUsed);
  const lines = result && runCfg ? assumptionLines(result, runCfg, funding) : principleLines(cfg);
  return (
    <Card title={LABOR.assumptions} note={result ? undefined : "So rechnet das Labor."} className={className} data-testid="labor-assumptions">
      <ul className="grid gap-2">
        {lines.map((l) => (
          <li key={l} className="flex gap-2.5 text-[12.5px] leading-relaxed text-fg/85">
            <span aria-hidden="true" className="mt-[8px] size-1 shrink-0 rounded-full bg-signal" />
            {l}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ reference */

export function ReferenceCard({ className }: { className?: string }) {
  const result = useLabor((s) => s.result);
  const settings = useJournal((s) => s.settings);
  const saveSettings = useJournal((s) => s.saveSettings);
  const pushToast = useUi((s) => s.pushToast);
  const btnRef = useRef<HTMLButtonElement>(null);
  if (!result) return null;
  const ref = toBacktestReference(result.stats, referenceLabel({ strategy: result.strategy, interval: result.interval, symbol: result.symbol, n: result.stats.n }));
  const cur = settings.backtest;
  const same = !!ref && cur.label === ref.label && cur.winRate === ref.winRate && cur.expectancy === ref.expectancy;
  const adopt = async () => {
    if (!ref) return;
    try {
      await saveSettings({ ...useJournal.getState().settings, backtest: ref });
      celebrateRecord(btnRef.current);
      pushToast({ kind: "success", title: LABOR.referenceDone, detail: ref.label });
    } catch {
      pushToast({ kind: "error", title: "Speichern fehlgeschlagen" });
    }
  };
  const rows: [string, string, string][] = [
    ["Win-Rate", pctText(cur.winRate, 1, false), ref ? pctText(ref.winRate, 1, false) : "–"],
    ["Ø Gewinner", pctText(cur.avgWin, 2), ref ? pctText(ref.avgWin, 2) : "–"],
    ["Ø Verlierer", pctText(cur.avgLoss, 2), ref ? pctText(ref.avgLoss, 2) : "–"],
    ["Erwartung", pctText(cur.expectancy, 2), ref ? pctText(ref.expectancy, 2) : "–"],
  ];
  return (
    <Card title={LABOR.reference} note={LABOR.referenceNote} className={className} data-testid="labor-reference">
      <div className="grid gap-4">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.1em] text-faint">
              <th className="pb-1.5 text-left font-semibold">Kennzahl</th>
              <th className="pb-1.5 text-right font-semibold">{LABOR.referenceCurrent}</th>
              <th className="pb-1.5 text-right font-semibold">Dieser Lauf</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([l, a, b]) => (
              <tr key={l} className="border-t border-line">
                <td className="py-1.5 text-mute">{l}</td>
                <td className="num py-1.5 text-right font-mono">{a}</td>
                <td className="num py-1.5 text-right font-mono text-fg">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11.5px] text-faint">
          {LABOR.referenceCurrent}: {cur.label}. Kursbewegung vom Einstieg zum Ausstieg ohne Hebel, wie in der Übersicht.
        </p>
        {ref ? (
          same ? (
            <Badge tone="win" dot className="justify-self-start">
              {LABOR.referenceDone}
            </Badge>
          ) : (
            <HoldButton ref={btnRef} variant="primary" onConfirm={() => void adopt()} holdLabel={LABOR.referenceHolding} armedLabel={LABOR.referenceArmed} className="justify-self-start" data-testid="labor-adopt">
              {LABOR.referenceHold}
            </HoldButton>
          )
        ) : (
          <p className="text-[12px] text-mute">{LABOR.referenceMissing}</p>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ compare runs */

const VERDICT_TONE = { robust: "win", fraglich: "warn", overfit: "loss", wenig: "mute" } as const;

export function CompareRunsCard({ className }: { className?: string }) {
  const runs = useLabor((s) => s.runs);
  const runSeq = useLabor((s) => s.runSeq);
  const clearRuns = useLabor((s) => s.clearRuns);
  // trade the best: the run with the highest Ø R (enough trades first) leads
  const sorted = [...runs].sort((a, b) => Number(b.n >= 20) - Number(a.n >= 20) || (b.avgR ?? -Infinity) - (a.avgR ?? -Infinity));
  return (
    <Card
      title={LABOR.compareTitle}
      className={className}
      data-testid="labor-compare"
      action={
        runs.length ? (
          <Button size="sm" onClick={clearRuns}>
            {LABOR.clearRuns}
          </Button>
        ) : undefined
      }
    >
      {!runs.length ? (
        <p className="text-[13px] text-mute">{LABOR.compareEmpty}</p>
      ) : (
        <CardSpread variant="deal" play={runSeq} label="Letzte Läufe" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((r, i) => (
            <RunCardFace key={r.id} run={r} best={i === 0 && sorted.length > 1} />
          ))}
        </CardSpread>
      )}
    </Card>
  );
}

function RunCardFace({ run, best }: { run: RunSummary; best: boolean }) {
  return (
    <article className={cn("grid h-full content-start gap-2 rounded-2xl border p-3.5", best ? "border-white/35 bg-white/[0.04]" : "border-line bg-ink-950/50")} aria-label={`${run.name || STRATEGY_TITLE[run.strategy]} ${run.symbol}`} data-testid="labor-run-card">
      <div className="flex items-start justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-[13.5px] font-semibold">{run.name || STRATEGY_TITLE[run.strategy]}</span>
          <span className="truncate font-mono text-[10.5px] text-faint">
            {run.symbol} · {run.interval === "1d" ? "1D" : run.interval} · {LABOR.periods[run.period]}
          </span>
        </div>
        {best ? (
          <Badge tone="win" dot>
            {LABOR.compareBest}
          </Badge>
        ) : (
          <Badge tone={VERDICT_TONE[run.verdict]}>{VERDICT_TEXT[run.verdict]}</Badge>
        )}
      </div>
      {run.curve.length > 1 && <EquityDraw values={run.curve} baseline={0} height={44} label={`Equity ${pctText(run.netPct)}`} />}
      <dl className="grid grid-cols-3 gap-1.5 text-[11px]">
        <div>
          <dt className="text-faint">Trades</dt>
          <dd className="num font-mono text-fg">{run.n}</dd>
        </div>
        <div>
          <dt className="text-faint">Ø R</dt>
          <dd className={cn("num font-mono", (run.avgR ?? 0) > 0 ? "text-win" : (run.avgR ?? 0) < 0 ? "text-loss" : "text-fg")}>{rText(run.avgR)}</dd>
        </div>
        <div>
          <dt className="text-faint">Netto</dt>
          <dd className={cn("num font-mono", run.netPct > 0 ? "text-win" : run.netPct < 0 ? "text-loss" : "text-fg")}>{pctText(run.netPct, 0)}</dd>
        </div>
        <div>
          <dt className="text-faint">Win-Rate</dt>
          <dd className="num font-mono text-fg">{pctText(run.winRate, 0, false)}</dd>
        </div>
        <div>
          <dt className="text-faint">Max DD</dt>
          <dd className="num font-mono text-fg">{pctText(-run.maxDD, 0, false)}</dd>
        </div>
        <div>
          <dt className="text-faint">PF</dt>
          <dd className="num font-mono text-fg">{numText(run.pf)}</dd>
        </div>
      </dl>
      <p className="truncate text-[10.5px] text-faint">{run.specs.map((s) => s.value).join(" · ")}</p>
    </article>
  );
}
