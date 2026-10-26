/**
 * Verwaltung vergleichen (F65): der gezeigte Lauf mit anderen Stops nach dem Einstieg – Stop unverändert, Break-even nach 0,5 / 1 /
 * 1,5 R, Netto-Break-even, Trailing, Teilziel. Eigener lazy Chunk, erst beim Aufklappen; gerechnet wird erst nach dem Klick. Die Tabelle
 * zeigt, was passiert ist, nicht was zu wählen wäre: acht Varianten sind acht Versuche, und eine höhere Trefferquote ist kein Vorteil –
 * darum stehen Median, Drawdown, Kosten, Verlustserie und „Ausgestoppt vor dem Ziel“ daneben.
 */
import { Fragment } from "react";
import type { ManageRow } from "@/domain/lab/extras";
import { cn } from "@/lib/cn";
import { Badge } from "@/primitives/Badge";
import { Block, deltaTone, RunBar, ScrollTable, signedText, TH, THL } from "./ExtraParts";
import { cancelExtra, runManage, useExtras } from "./extrasStore";
import { useLabor } from "./laborStore";
import { LABOR } from "./strings";
import { moneyText, numText, pctText, rText } from "./ui";

const M = {
  title: "Verwaltung vergleichen",
  sub: "Derselbe Lauf – gleiche Signale, Kerzen, Stops, Ziele und Kosten –, nur der Stop nach dem Einstieg wechselt.",
  why: "Ein Break-even oder Trailing-Stop sichert Gewinne, kostet aber Trades, die später noch ans Ziel gelaufen wären. Eine höhere Trefferquote allein ist deshalb kein Vorteil: Neben der Summe stehen Median, Drawdown, Kosten, Verlustserie und die Zahl der Trades, die der verschobene Stop beendete, obwohl sie ohne ihn das Ziel erreichten.",
  run: "Verwaltung vergleichen",
  needRun: "Starte zuerst einen Lauf.",
  noTrades: "Der Lauf hat keine Trades – es gibt nichts zu vergleichen.",
  variant: "Variante",
  trades: "Trades",
  sumR: "Σ R",
  dSumR: "Δ Σ R",
  median: "Median R",
  avgR: "Ø R",
  dd: "Max. DD",
  net: "Netto",
  costs: "Kosten",
  held: "Ø Dauer",
  streak: "Längste Verlustserie",
  before: "Ausgestoppt vor dem Ziel",
  more: "Weitere Kennzahlen",
  main: "Ergebnis je Variante",
  thin: "wenig Trades",
  noAction: "Die Regel kam in keinem Trade zum Einsatz – dieselben Zahlen wie ohne Verwaltung.",
  beforeOf: (k: number, m: number) => `${k} von ${m}`,
  beforeHelp: "Von den Trades, die ein verschobener Stop beendete und die es auch ohne Verwaltung gab (gleiche Einstiegszeit und Richtung): wie viele erreichten dort das Ziel.",
  few: (n: number) => `Der Lauf hat nur ${n} Trades. Unter 30 Trades lassen sich die Unterschiede zwischen den Zeilen kaum vom Zufall trennen.`,
  trade: "Mit einer Verwaltung wird eine Position früher frei – damit können Signale handelbar werden, die ohne sie übersprungen worden wären. Die Trades sind darum nicht in jeder Zeile dieselben (die Spalte „Trades“ zeigt es).",
  foot: "Σ R und Netto stehen nach Gebühren, Slippage und Funding. Der Break-even-Auslöser wird am Kerzenschluss entschieden und gilt ab der nächsten Kerze; berühren Stop und Ziel dieselbe Kerze, gilt der Stop. Acht Varianten sind acht Versuche: Je mehr du ansiehst, desto leichter fällt eine schöne auf – wähle daraus nicht die „beste“ Einstellung, sondern frage, ob der Unterschied zur Zeile „Stop unverändert“ in beiden Testabschnitten und auf anderen Märkten bleibt.",
} as const;

const dec = (v: number, d: number): string => v.toFixed(d).replace(".", ",");

/** "2,3 Tage" / "14 Std." / "35 Min." from milliseconds. */
export function durText(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "–";
  const h = ms / 3_600_000;
  if (h >= 48) return `${dec(h / 24, 1)} Tage`;
  if (h >= 2) return `${dec(h, 0)} Std.`;
  return `${dec(ms / 60_000, 0)} Min.`;
}

function Name({ r, base }: { r: ManageRow; base: boolean }) {
  const s = r.stats;
  return (
    <th scope="row" className="min-w-40 py-2 pr-2 text-left align-top font-medium text-fg/90">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {r.label}
        {s && s.n > 0 && s.n < 10 && <Badge tone="warn">{M.thin}</Badge>}
      </span>
      <span className="block text-[11px] font-normal leading-snug text-faint">{r.detail}</span>
      {!base && s && s.n > 0 && s.acted === 0 && <span className="block text-[11px] font-normal leading-snug text-faint">{M.noAction}</span>}
    </th>
  );
}

function MainTable({ rows }: { rows: ManageRow[] }) {
  return (
    <ScrollTable label={M.main} min="46rem" testId="labor-manage-table">
      <thead>
        <tr>
          <th className={THL}>{M.variant}</th>
          <th className={TH}>{M.trades}</th>
          <th className={TH}>{M.sumR}</th>
          <th className={TH}>{M.dSumR}</th>
          <th className={TH}>{M.median}</th>
          <th className={TH}>{M.dd}</th>
          <th className={TH} title={M.beforeHelp}>
            {M.before}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const s = r.stats;
          const base = r.id === "none";
          return (
            <tr key={r.id} className={cn("border-t border-line", base && "bg-white/[0.03]")} data-testid="labor-manage-row" data-variant={r.id}>
              <Name r={r} base={base} />
              {s ? (
                <>
                  <td className="num py-2 text-right align-top font-mono">{s.n}</td>
                  <td className={cn("num py-2 text-right align-top font-mono", s.sumR > 0 ? "text-win" : s.sumR < 0 ? "text-loss" : "")}>{rText(s.sumR)}</td>
                  <td className={cn("num py-2 text-right align-top font-mono", deltaTone(r.dSumR, true, 0.005))}>{r.dSumR != null ? signedText(r.dSumR) : "–"}</td>
                  <td className="num py-2 text-right align-top font-mono">{rText(s.medianR)}</td>
                  <td className="num py-2 text-right align-top font-mono">{pctText(s.maxDD, 1, false)}</td>
                  <td className="num py-2 text-right align-top font-mono" data-testid="labor-manage-before">
                    {r.id === "none" || r.stoppedBeforeTarget == null ? "–" : s.movedOut === 0 ? "0" : M.beforeOf(r.stoppedBeforeTarget, r.movedTwins ?? 0)}
                  </td>
                </>
              ) : (
                <td colSpan={6} className="py-2 text-right text-faint">
                  –
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </ScrollTable>
  );
}

function MoreTable({ rows, barMs }: { rows: ManageRow[]; barMs: number }) {
  return (
    <ScrollTable label={M.more} min="36rem" testId="labor-manage-more">
      <thead>
        <tr>
          <th className={THL}>{M.variant}</th>
          <th className={TH}>{M.avgR}</th>
          <th className={TH}>{M.net}</th>
          <th className={TH}>{M.costs}</th>
          <th className={TH}>{M.held}</th>
          <th className={TH}>{M.streak}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const s = r.stats;
          return (
            <tr key={r.id} className="border-t border-line" data-testid="labor-manage-more-row" data-variant={r.id}>
              <th scope="row" className="py-1.5 pr-2 text-left font-medium text-fg/90">
                {r.label}
              </th>
              {s ? (
                <Fragment>
                  <td className="num py-1.5 text-right font-mono">{numText(s.avgR)}</td>
                  <td className={cn("num py-1.5 text-right font-mono", s.net > 0 ? "text-win" : s.net < 0 ? "text-loss" : "")}>{moneyText(s.net)}</td>
                  <td className="num py-1.5 text-right font-mono">{moneyText(s.costs, "USDT", false)}</td>
                  <td className="num py-1.5 text-right font-mono">{durText(s.avgBars != null ? s.avgBars * barMs : null)}</td>
                  <td className="num py-1.5 text-right font-mono">{s.longestLosing}</td>
                </Fragment>
              ) : (
                <td colSpan={5} className="py-1.5 text-right text-faint">
                  –
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </ScrollTable>
  );
}

export default function ManageBody() {
  const result = useLabor((s) => s.result);
  const slice = useExtras((s) => s.manage);
  if (!result) return <p className="text-[12.5px] text-mute">{M.needRun}</p>;
  const cmp = slice.result;
  const n = cmp?.rows.find((r) => r.id === "none")?.stats?.n ?? 0;
  return (
    <div className="grid gap-5" data-testid="labor-manage">
      <Block title={M.title} sub={M.sub} id="labor-manage-block">
        <p className="max-w-[72ch] text-[12.5px] leading-relaxed text-mute">{M.why}</p>
        <RunBar slice={slice} onRun={() => void runManage()} onCancel={() => cancelExtra("manage")} label={M.run} id="labor-manage" hint={LABOR.extras.prepNote} />
        {slice.status === "done" && cmp && (
          <>
            {n === 0 ? (
              <p className="text-[12.5px] text-mute" data-testid="labor-manage-empty">
                {M.noTrades}
              </p>
            ) : (
              <>
                <MainTable rows={cmp.rows} />
                <MoreTable rows={cmp.rows} barMs={cmp.barMs} />
                {n < 30 && (
                  <p className="text-[12px] leading-snug text-warn" data-testid="labor-manage-few">
                    {M.few(n)}
                  </p>
                )}
                <p className="max-w-[72ch] text-[11.5px] leading-snug text-faint">{M.trade}</p>
                <p className="max-w-[72ch] text-[11.5px] leading-snug text-faint" data-testid="labor-manage-foot">
                  {M.foot}
                </p>
              </>
            )}
          </>
        )}
      </Block>
    </div>
  );
}
