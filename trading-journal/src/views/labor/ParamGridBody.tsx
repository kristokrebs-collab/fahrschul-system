/**
 * Parameter-Raster (F11 / F16): "Wie stabil ist diese Idee gegen die Parameter?" – the shown run repeated on a 3 × 3 grid
 * around two rule parameters (±25 %). Own lazy chunk, mounted on the first opening of its card; nothing is computed before
 * the button. The table shows what happened in each neighbour – it names no best cell, because picking the best of nine
 * is exactly how an idea gets fitted to the past.
 */
import { useEffect, useMemo } from "react";
import { gridAxes, type GridAxisChoice, type GridCell, type GridResult } from "@/domain/lab/extras/paramGrid";
import { cn } from "@/lib/cn";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Block, RunBar } from "./ExtraParts";
import { cancelExtra, runParams, useExtras } from "./extrasStore";
import { useLabor } from "./laborStore";
import { LABOR } from "./strings";
import { FieldRow, numText, rText } from "./ui";

const G = {
  title: "Parameter-Raster",
  sub: "Dieselbe Idee, dieselben Daten und Kosten – nur zwei Zahlen der Regeln um ±25 % verschoben.",
  why: "Eine Idee, die nur bei genau einer Einstellung gut aussieht, ist meist an die Vergangenheit angepasst. Wechselt das Ergebnis zwischen Nachbarn sanft, ist sie stabiler.",
  x: "Erste Zahl (Spalten)",
  y: "Zweite Zahl (Zeilen)",
  none: "keine zweite Zahl",
  run: "Raster rechnen",
  needRun: "Starte zuerst einen Lauf mit „Eigene Idee“.",
  notCustom: "Das Raster gibt es für „Eigene Idee“: nur deren Regeln haben Zahlen, die sich verschieben lassen. Für die Vorlagen zeigt „Robustheit“ ein Raster aus Stop und Ziel.",
  table: "Ergebnis je Kombination",
  base: "Deine Einstellung",
  fewTrades: "wenig Trades",
  cellSum: (r: string) => `Σ ${r}`,
  cellMeta: (n: number, avg: string) => `${n} Trades · Ø ${avg}`,
  positive: (k: number, n: number) => `In ${k} von ${n} Kombinationen ist die Summe der Trades in R positiv.`,
  baseLine: (r: string, n: number) => `Deine Einstellung (Mitte): Σ ${r} aus ${n} Trades.`,
  spread: (lo: string, hi: string) => `Spanne der Summe R über das Raster: ${lo} bis ${hi}.`,
  foot: "Σ R ist die Summe aller Trades in R, nach Gebühren, Slippage und Funding. Neun Zellen sind neun Versuche: Je mehr Zellen du anschaust, desto leichter fällt eine schöne auf. Das Raster prüft die Nachbarschaft deiner Einstellung, nicht den besten Wert – wähle daraus keine „optimale“ Zahl.",
  few: "Zellen mit weniger als 10 Trades sind kaum aussagekräftig; ihre Unterschiede können reiner Zufall sein.",
  blockedFor: (why: string) => why,
} as const;

const MIN_TRADES = 10;

function axisValue(a: { values: number[]; unit?: string }, i: number): string {
  const v = String(a.values[i]).replace(".", ",");
  return a.unit ? `${v} ${a.unit}` : v;
}

function Table({ g }: { g: GridResult }) {
  const ys = g.y ? g.y.values : [0];
  const cell = (xi: number, yi: number): GridCell | undefined => g.cells.find((c) => c.xi === xi && c.yi === yi);
  return (
    <div className="overflow-x-auto" role="region" aria-label={G.table} tabIndex={0}>
      <table className="w-full border-separate border-spacing-1.5 text-[12px]" style={{ minWidth: `${6 + g.x.values.length * 7}rem` }} data-testid="labor-grid-table">
        <thead>
          <tr>
            <th className="text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
              <span className="block">{g.y ? g.y.label : ""}</span>
              <span className="block normal-case tracking-normal text-faint/80">{g.x.label} →</span>
            </th>
            {g.x.values.map((_, xi) => (
              <th key={xi} scope="col" className={cn("num font-mono text-[12px] font-medium", xi === g.baseXi ? "text-fg" : "text-mute")}>
                {axisValue(g.x, xi)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ys.map((_, yi) => (
            <tr key={yi}>
              <th scope="row" className={cn("num whitespace-nowrap pr-2 text-left font-mono text-[12px] font-medium", g.y && yi === g.baseYi ? "text-fg" : "text-mute")}>
                {g.y ? axisValue(g.y, yi) : "–"}
              </th>
              {g.x.values.map((_, xi) => {
                const c = cell(xi, yi);
                const s = c?.stats ?? null;
                const isBase = xi === g.baseXi && yi === g.baseYi;
                const few = s != null && s.n < MIN_TRADES;
                return (
                  <td
                    key={xi}
                    data-testid="labor-grid-cell"
                    data-xi={xi}
                    data-yi={yi}
                    data-base={isBase ? "true" : "false"}
                    data-n={s?.n ?? 0}
                    className={cn("rounded-lg border px-2.5 py-2 align-top", isBase ? "border-white/50 bg-white/[0.05]" : "border-line bg-ink-950/40", few && "opacity-70")}
                  >
                    {s ? (
                      <>
                        <span className={cn("num block font-mono text-[13px] font-medium", s.sumR > 0 ? "text-win" : s.sumR < 0 ? "text-loss" : "text-fg")}>{G.cellSum(rText(s.sumR))}</span>
                        <span className="num block font-mono text-[11px] text-mute">{G.cellMeta(s.n, numText(s.avgR))}</span>
                        {few && <span className="block text-[10.5px] text-faint">{G.fewTrades}</span>}
                        {isBase && <span className="block text-[10.5px] text-faint">{G.base}</span>}
                      </>
                    ) : (
                      <span className="text-faint">–</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Summary({ g }: { g: GridResult }) {
  const stats = g.cells.flatMap((c) => (c.stats ? [c.stats] : []));
  const positive = stats.filter((s) => s.sumR > 0).length;
  const base = g.cells.find((c) => c.xi === g.baseXi && c.yi === g.baseYi)?.stats ?? null;
  const sums = stats.map((s) => s.sumR);
  const few = stats.some((s) => s.n < MIN_TRADES);
  return (
    <div className="grid gap-1.5 rounded-xl border border-line-2 bg-white/[0.02] px-3.5 py-3 text-[12.5px] leading-relaxed" data-testid="labor-grid-summary">
      <p>{G.positive(positive, stats.length)}</p>
      {base && <p className="text-mute">{G.baseLine(rText(base.sumR), base.n)}</p>}
      {sums.length > 0 && <p className="text-mute">{G.spread(rText(Math.min(...sums)), rText(Math.max(...sums)))}</p>}
      {few && <p className="text-warn">{G.few}</p>}
    </div>
  );
}

export default function ParamGridBody() {
  const result = useLabor((s) => s.result);
  const runCfg = useLabor((s) => s.runCfg);
  const slice = useExtras((s) => s.params);
  const sel = useExtras((s) => s.gridSel);
  const setSel = useExtras((s) => s.setGridSel);
  const av = useMemo(() => (runCfg && result?.strategy === "custom" ? gridAxes(runCfg.custom) : null), [runCfg, result?.strategy]);
  const axes: GridAxisChoice[] = useMemo(() => av?.axes ?? [], [av]);

  // a sensible first choice: the first two numbers, preferably of different rules
  useEffect(() => {
    if (!axes.length) return;
    if (axes.some((a) => a.id === sel.x) && (sel.y === null || axes.some((a) => a.id === sel.y))) return;
    const x = axes[0]!;
    const y = axes.find((a) => a.leaf !== x.leaf) ?? axes.find((a) => a.id !== x.id) ?? null;
    setSel({ x: x.id, y: y?.id ?? null });
  }, [axes, sel.x, sel.y, setSel]);

  if (!result) return <p className="text-[12.5px] text-mute">{G.needRun}</p>;
  if (result.strategy !== "custom" || !av) return <p className="text-[12.5px] text-mute" data-testid="labor-grid-notcustom">{G.notCustom}</p>;
  const out = slice.result;
  const options = axes.map((a) => ({ value: a.id, label: a.label, hint: a.values.map((v) => String(v).replace(".", ",")).join(" · ") }));
  const yOptions = [{ value: "", label: G.none }, ...options.filter((o) => o.value !== sel.x)];
  return (
    <div className="grid gap-5" data-testid="labor-grid">
      <Block title={G.title} sub={G.sub} id="labor-grid-block">
        <p className="max-w-[72ch] text-[12.5px] leading-relaxed text-mute">{G.why}</p>
        {av.blocked ? (
          <p className="text-[12.5px] text-mute" data-testid="labor-grid-blocked">
            {G.blockedFor(av.blocked)}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldRow label={G.x}>
                <MorphSelect size="sm" aria-label={G.x} value={sel.x} onChange={(x) => setSel({ x, y: sel.y === x ? null : sel.y })} options={options} disabled={slice.status === "running"} />
              </FieldRow>
              <FieldRow label={G.y}>
                <MorphSelect size="sm" aria-label={G.y} value={sel.y ?? ""} onChange={(y) => setSel({ x: sel.x, y: y === "" ? null : y })} options={yOptions} disabled={slice.status === "running"} />
              </FieldRow>
            </div>
            <RunBar slice={slice} onRun={() => void runParams()} onCancel={() => cancelExtra("params")} label={G.run} id="labor-grid" hint={LABOR.extras.prepNote} />
          </>
        )}
        {slice.status === "done" && out?.note && <p className="text-[12.5px] text-mute">{out.note}</p>}
        {slice.status === "done" && out?.grid && (
          <>
            <Table g={out.grid} />
            <Summary g={out.grid} />
            <p className="text-[11.5px] leading-snug text-faint">{G.foot}</p>
          </>
        )}
      </Block>
    </div>
  );
}
