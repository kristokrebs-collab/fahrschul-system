/**
 * Robustheit (P07): in-sample vs. out-of-sample, the walk-forward windows, the overfitting verdict and the parameter
 * heat map.
 * - OOS: the optimised winner's R curve in-sample (grey) and out-of-sample (its own tone) draw one after the other
 *   (`EquityDraw`, one shared progress).
 * - Walk-forward: every window as a sliding segment pair on the period's time axis – train grey, test white – that glides
 *   in from the left window by window (`spring.enter`, capped stagger), the test result at the row end.
 * - Overfitting: the verdict word under a signal-red `TactileHighlight`, Deflated Sharpe as a `ConfidenceMeter`, PBO with
 *   the logit distribution of the 70 splits (bars grow `scaleY`), the reasons.
 * - Heat map: `HeatGridReveal` cascading from the best cell; thin cells (< 5 trades) dim, the chosen set outlined.
 * Reduced motion: end states.
 */
import { animate, motion, useMotionValue } from "motion/react";
import { useMemo, useRef } from "react";
import { VERDICT_TEXT, type LabResult } from "@/domain/backtest/index";
import { cn } from "@/lib/cn";
import { date as fmtDate } from "@/lib/format";
import { ConfidenceMeter, EquityDraw, heatColor, HeatGridReveal, useFxPlay } from "@/motion/fx";
import { TactileHighlight } from "@/motion/pulse/TactileHighlight";
import { ease, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { useLabor } from "./laborStore";
import { LABOR } from "./strings";
import { numText, pctText, pfText, rText } from "./ui";

function useResult(): { result: LabResult | null; runSeq: number } {
  const result = useLabor((s) => s.result);
  const runSeq = useLabor((s) => s.runSeq);
  return { result, runSeq };
}

/* ------------------------------------------------------------------ OOS */

export function OosCard({ className }: { className?: string }) {
  const { result, runSeq } = useResult();
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const pIs = useMotionValue(reduced ? 1 : 0);
  const pOos = useMotionValue(reduced ? 1 : 0);
  useFxPlay(ref, runSeq, true, !reduced, () => {
    pIs.set(0);
    pOos.set(0);
    void animate(pIs, 1, { duration: tween.draw.duration, ease: ease.out }).then(() => animate(pOos, 1, { duration: tween.draw.duration, ease: ease.out }));
  });
  if (!result) return null;
  const sp = result.split;
  return (
    <Card title={LABOR.oos} note={LABOR.oosNote} className={className} data-testid="labor-oos">
      <div ref={ref} className="grid gap-4">
        {!sp.params ? (
          <p className="text-[13px] text-mute">Kein Parametersatz hatte In-Sample genug Trades (mindestens 5). Längerer Zeitraum oder lockerere Parameter helfen.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5" aria-label="Optimierte Parameter">
              {result.specs.map((s) => (
                <span key={s.key} className="rounded-full border border-line-2 px-2.5 py-1 text-[11px] text-mute">
                  {s.label}: <span className="text-fg">{formatParam(s.key, sp.params![s.key])}</span>
                </span>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Side title={LABOR.is} stats={sp.is} curve={sp.isCurveR} progress={pIs} tone="mute" />
              <Side title={LABOR.oosShort} stats={sp.oos} curve={sp.oosCurveR} progress={pOos} tone="auto" highlight />
            </div>
            {sp.cutTime != null && <p className="text-[11.5px] text-faint">Schnitt am {fmtDate(new Date(sp.cutTime))}. Die Optimierung hat nichts danach gesehen.</p>}
          </>
        )}
      </div>
    </Card>
  );
}

function formatParam(key: string, v: unknown): string {
  if (key === "target") return `T${String(v)}`;
  if (key === "targetR") return `${String(v).replace(".", ",")} R`;
  if (key === "stopAtr") return `${String(v).replace(".", ",")} × ATR`;
  if (key === "minStrength") return `≥ ${String(v)}`;
  if (key === "maxBars") return `${String(v)} Kerzen`;
  if (key === "minGrade") return v === "A+" ? "nur A+" : "A und A+";
  if (key === "kinds") return v === "ausbruch" ? "Ausbruch + Retest" : v === "range" ? "Range + Fehlausbruch" : "Alle";
  return String(v);
}

function Side({ title, stats, curve, progress, tone, highlight }: { title: string; stats: LabResult["split"]["is"]; curve: number[]; progress: ReturnType<typeof useMotionValue<number>>; tone: "mute" | "auto"; highlight?: boolean }) {
  return (
    <div className={cn("grid min-w-0 content-start gap-2 rounded-xl border px-3 py-2.5", highlight ? "border-white/25 bg-white/[0.03]" : "border-line bg-ink-950/50")}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{title}</span>
      <span className={cn("num font-mono text-[18px] font-semibold", (stats?.avgR ?? 0) > 0 ? "text-win" : (stats?.avgR ?? 0) < 0 ? "text-loss" : "text-fg")}>{rText(stats?.avgR)}</span>
      <span className="num text-[11px] text-faint">
        {stats ? `${stats.n} Trades · WR ${pctText(stats.winRate, 0, false)} · PF ${pfText(stats.pf)}` : "–"}
      </span>
      {curve.length > 1 && <EquityDraw values={curve} baseline={0} height={56} tone={tone} progress={progress} label={`${title}: Summe ${rText(curve[curve.length - 1])}`} />}
    </div>
  );
}

/* ------------------------------------------------------------------ walk-forward */

export function WalkForwardCard({ className }: { className?: string }) {
  const { result, runSeq } = useResult();
  const reduced = useReducedFx();
  if (!result) return null;
  const wf = result.wf;
  return (
    <Card title={LABOR.wf} note={LABOR.wfNote} className={className} data-testid="labor-wf">
      {!wf ? (
        <p className="text-[13px] text-mute">Der Zeitraum ist zu kurz für fünf Fenster. Wähle einen längeren Zeitraum.</p>
      ) : (
        <div className="grid gap-3">
          <ol className="grid gap-2" aria-label={LABOR.wf}>
            {wf.windows.map((w, i) => {
              const span = Math.max(1, result.to - result.from);
              const pos = (t: number) => Math.min(100, Math.max(0, ((t - result.from) / span) * 100));
              const a = pos(w.trainFrom);
              const b = pos(w.testFrom);
              const c = pos(w.testTo);
              const tone = w.testN === 0 ? "text-faint" : w.testSumR > 0 ? "text-win" : w.testSumR < 0 ? "text-loss" : "text-mute";
              return (
                <li key={`${runSeq}-${i}`} className="grid grid-cols-[4.2rem_1fr_6.2rem] items-center gap-2 text-[12px]">
                  <span className="text-mute">{LABOR.wfWindow(i + 1)}</span>
                  <span className="relative h-3 overflow-hidden rounded-full bg-white/[0.04]" aria-hidden="true">
                    <motion.span
                      className="absolute inset-y-0 flex"
                      style={{ left: `${a}%`, width: `${c - a}%` }}
                      initial={reduced ? false : { x: "-40%", opacity: 0 }}
                      animate={{ x: 0, opacity: 1, transitionEnd: { transform: "none" } }}
                      transition={{ x: { ...spring.enter, delay: Math.min(i, stagger.max) * stagger.lead }, opacity: { ...tween.fade, delay: Math.min(i, stagger.max) * stagger.lead } }}
                    >
                      <span className="h-full rounded-l-full bg-white/20" style={{ width: `${((b - a) / Math.max(0.001, c - a)) * 100}%` }} />
                      <span className="h-full flex-1 rounded-r-full bg-fg" />
                    </motion.span>
                  </span>
                  <span className={cn("num text-right font-mono", tone)}>
                    {w.testN ? `${rText(w.testSumR, 1)} · ${w.testN}` : "keine Trades"}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-mute">
            <span>
              Ungesehen gehandelt: <span className="num font-mono text-fg">{wf.oosN}</span> Trades, Ø <span className={cn("num font-mono", (wf.oosMeanR ?? 0) > 0 ? "text-win" : (wf.oosMeanR ?? 0) < 0 ? "text-loss" : "text-fg")}>{rText(wf.oosMeanR)}</span>
            </span>
            <span>
              Effizienz: <span className="num font-mono text-fg">{wf.efficiency == null ? "–" : wf.efficiency < 0 ? "negativ" : pctText(Math.min(wf.efficiency, 9.99), 0, false)}</span>
            </span>
            {wf.positiveShare != null && (
              <span>
                Fenster im Plus: <span className="num font-mono text-fg">{pctText(wf.positiveShare, 0, false)}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ overfitting */

export function OverfitCard({ className }: { className?: string }) {
  const { result, runSeq } = useResult();
  const reduced = useReducedFx();
  const hist = useHist(result?.pbo?.logits);
  if (!result) return null;
  const { robust, dsr, pbo } = result;
  return (
    <Card title={LABOR.overfit} note={LABOR.overfitNote} className={className} data-testid="labor-overfit" data-verdict={robust.verdict}>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <span className="text-[22px] font-semibold leading-tight tracking-tight" data-testid="labor-verdict">
            <TactileHighlight key={runSeq} tone={robust.verdict === "robust" ? "invert" : "signal"} playOnView tab={false}>
              {VERDICT_TEXT[robust.verdict]}
            </TactileHighlight>
          </span>
          <p className="text-[13px] text-mute">{robust.text}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid content-start gap-1.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Deflated Sharpe</span>
            {dsr ? <ConfidenceMeter value={Math.round(dsr.dsr * 100)} label="Deflated Sharpe" hideLabel cols={14} /> : <span className="text-[12px] text-faint">ab 10 Trades</span>}
            {dsr && <span className="num text-[11px] text-faint">Sharpe {numText(dsr.sr)} vs. Glück {numText(dsr.sr0)} ({dsr.trials} Sätze)</span>}
          </div>
          <div className="grid content-start gap-1.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">PBO</span>
            {pbo ? (
              <>
                <span className={cn("num font-mono text-[18px] font-semibold", pbo.pbo < 0.25 ? "text-win" : pbo.pbo > 0.5 ? "text-loss" : "text-fg")}>{pctText(pbo.pbo, 0, false)}</span>
                <span aria-hidden="true" className="flex h-8 items-end gap-[2px]">
                  {hist.map((h, i) => (
                    <motion.span
                      key={`${runSeq}-${i}`}
                      className={cn("flex-1 origin-bottom rounded-[1px]", i < hist.length / 2 ? "bg-loss/70" : "bg-win/70")}
                      style={{ height: `${Math.max(4, h * 100)}%` }}
                      initial={reduced ? false : { scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ ...spring.enter, delay: reduced ? 0 : Math.min(i, stagger.max) * stagger.rows }}
                    />
                  ))}
                </span>
                <span className="num text-[11px] text-faint">{pbo.splits} Aufteilungen</span>
              </>
            ) : (
              <span className="text-[12px] text-faint">ab 16 Trades</span>
            )}
          </div>
        </div>
        <ul className="grid gap-1.5" aria-label="Begründung">
          {robust.reasons.map((r) => (
            <li key={r.text} className="flex gap-2 text-[12.5px]">
              <span aria-hidden="true" className={cn("mt-[3px] grid size-4 shrink-0 place-items-center rounded-full text-[10px]", r.ok ? "bg-win/15 text-win" : "bg-loss/15 text-loss")}>
                {r.ok ? "✓" : "✗"}
              </span>
              <span className="text-fg/85">{r.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/** Logits in 10 bins over [−3, 3] (share of the tallest). */
function useHist(logits: readonly number[] | undefined): number[] {
  return useMemo(() => {
    const bins = new Array<number>(10).fill(0);
    for (const l of logits ?? []) bins[Math.max(0, Math.min(9, Math.floor(((Math.max(-3, Math.min(2.999, l)) + 3) / 6) * 10)))]! += 1;
    const max = Math.max(1, ...bins);
    return bins.map((b) => b / max);
  }, [logits]);
}

/* ------------------------------------------------------------------ heat map */

export function HeatmapCard({ className }: { className?: string }) {
  const { result, runSeq } = useResult();
  if (!result) return null;
  const heat = result.heat;
  return (
    <Card title={LABOR.heat} note={LABOR.heatNote} className={className} data-testid="labor-heat">
      {!heat ? (
        <p className="text-[13px] text-mute">Diese Strategie hat zu wenige Parameter für eine Heatmap.</p>
      ) : (
        <HeatBody heat={heat} runSeq={runSeq} />
      )}
    </Card>
  );
}

function HeatBody({ heat, runSeq }: { heat: NonNullable<LabResult["heat"]>; runSeq: number }) {
  const cols = heat.cols.options.length;
  const maxAbs = Math.max(0.05, ...heat.cells.map((c) => Math.abs(c.meanR ?? 0)));
  const origin = heat.best ? heat.best.row * cols + heat.best.col : 0;
  return (
    <div className="grid gap-2">
      <p className="text-[11px] text-faint" aria-hidden="true">
        Zeilen: <span className="text-mute">{heat.rows.label}</span> · Spalten: <span className="text-mute">{heat.cols.label}</span>
      </p>
      <div className="grid items-end gap-1.5" style={{ gridTemplateColumns: `4.5rem repeat(${cols}, minmax(0, 1fr))` }} aria-hidden="true">
        <span />
        {heat.cols.labels.map((l) => (
          <span key={l} className="text-center font-mono text-[10.5px] text-mute">
            {l}
          </span>
        ))}
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: "4.5rem minmax(0, 1fr)" }}>
        <div className="grid gap-1.5" style={{ gridTemplateRows: `repeat(${heat.rows.options.length}, minmax(0, 1fr))` }} aria-hidden="true">
          {heat.rows.labels.map((l) => (
            <span key={l} className="flex items-center font-mono text-[10.5px] text-mute">
              {l}
            </span>
          ))}
        </div>
        <HeatGridReveal cols={cols} origin={origin} play={runSeq} className="gap-1.5" cellClassName="rounded-lg" role="grid" aria-label={`${LABOR.heat}: Ø R je ${heat.rows.label} und ${heat.cols.label}`}>
          {heat.cells.map((c) => (
            <div
              key={`${c.row}:${c.col}`}
              role="gridcell"
              aria-label={`${heat.rows.label} ${heat.rows.labels[c.row]}, ${heat.cols.label} ${heat.cols.labels[c.col]}: ${c.meanR == null ? "keine Trades" : `${rText(c.meanR)} aus ${c.n} Trades`}${c.chosen ? ", dein Satz" : ""}`}
              className={cn("relative grid h-12 place-items-center rounded-lg border text-center", c.chosen ? "border-fg" : "border-transparent", c.thin && "opacity-55")}
              style={{ background: c.meanR == null ? "var(--color-ink-850)" : heatColor(c.meanR / maxAbs, "diverging") }}
            >
              <span className="num font-mono text-[12px] font-semibold text-fg">{c.meanR == null ? "–" : numText(c.meanR)}</span>
              <span className="num absolute bottom-0.5 right-1.5 font-mono text-[9.5px] text-fg/60">{c.thin ? LABOR.heatThin : c.n}</span>
            </div>
          ))}
        </HeatGridReveal>
      </div>
      <p className="text-[11.5px] text-faint">
        {heat.stability == null ? "Stabilität erst mit genug Trades je Feld." : heat.stability >= 0.6 ? `Plateau: die Nachbarn halten ${pctText(heat.stability, 0, false)} des besten Felds.` : `Spitze: die Nachbarn halten nur ${pctText(Math.max(0, heat.stability), 0, false)} des besten Felds.`} Weißer Rand = dein Satz.
      </p>
    </div>
  );
}
