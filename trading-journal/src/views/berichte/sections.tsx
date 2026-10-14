/**
 * The sections of a report (P04): Performance (bars of the period), Vergleich mit der Vorperiode, Strategie, Risiko,
 * Psychologie, Fehler and Zielerreichung. Every number comes from `buildReport` (`@/domain/reports`), nothing is
 * estimated here; a section without data says so. Bars grow on first view (`AnswerBars`), the discipline streak of the
 * goals bursts once per report and session (`celebrateStreak`, kind `streak`) when 3+ good days end the period.
 */
import { motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import type { ChartRow } from "@/domain/coach/nlq";
import type { GroupRow, Report } from "@/domain/reports";
import { cn } from "@/lib/cn";
import { pct0, pf as fmtPf, r as fmtR, signed } from "@/lib/format";
import { celebrateStreak } from "@/motion/fx/celebrate";
import { useFirstInView } from "@/motion/inView";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Card } from "@/primitives/Card";
import { AnswerBars, KV } from "@/views/coach/ui";
import { openTrade } from "@/views/insights/ui";

const money = (v: number | null | undefined, cur: string) => (v == null || !Number.isFinite(v) ? "–" : `${signed(v, 0)} ${cur}`);
const dec = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "–" : v.toFixed(d).replace(".", ","));
const toneOf = (v: number | null | undefined): "win" | "loss" | "fg" | "mute" => (v == null || !Number.isFinite(v) ? "mute" : v > 0 ? "win" : v < 0 ? "loss" : "fg");
const dayLabel = (key: string) => {
  const d = new Date(`${key}T12:00`);
  return Number.isNaN(+d) ? key : d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
};

/** Compact table of grouped rows (setups, sides, sessions, emotions). */
export function GroupTable({ rows, cur, label, unit = "money", mark }: { rows: readonly GroupRow[]; cur: string; label: string; unit?: "R" | "money"; mark?: Readonly<Record<string, "win" | "loss">> }) {
  if (!rows.length) return null;
  return (
    <div role="table" aria-label={label} className="grid content-start text-[12px]">
      <div role="row" className="grid grid-cols-[minmax(0,1fr)_2.5rem_3.5rem_5.5rem] gap-2 border-b border-line pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
        <span role="columnheader">{label}</span>
        <span role="columnheader" className="text-right">n</span>
        <span role="columnheader" className="text-right">Win</span>
        <span role="columnheader" className="text-right">{unit === "R" ? "Ø R" : "Netto"}</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} role="row" className="grid grid-cols-[minmax(0,1fr)_2.5rem_3.5rem_5.5rem] items-baseline gap-2 border-b border-line/60 py-1.5 last:border-b-0">
          <span role="cell" className="flex min-w-0 items-center gap-1.5 text-fg">
            {/* long setup names wrap to a second line instead of „BSL/EQL Liquidity Sw…“ (P2-15) */}
            <span className={cn("line-clamp-2 min-w-0 [overflow-wrap:anywhere]", mark?.[r.key] === "win" ? "text-win" : mark?.[r.key] === "loss" ? "text-loss" : undefined)}>{r.label}</span>
            {mark?.[r.key] && (
              <Badge tone={mark[r.key]} className="hidden shrink-0 sm:inline-flex">
                {mark[r.key] === "win" ? "stärkstes" : "schwächstes"}
              </Badge>
            )}
            {mark?.[r.key] && <span className="sr-only sm:hidden">{mark[r.key] === "win" ? "(stärkstes)" : "(schwächstes)"}</span>}
          </span>
          <span role="cell" className="num text-right font-mono text-mute">
            {r.n}
          </span>
          <span role="cell" className="num text-right font-mono text-mute">
            {pct0(r.winRate)}
          </span>
          <span role="cell" className={cn("num truncate text-right font-mono", unit === "R" ? (r.avgR == null ? "text-mute" : r.avgR >= 0 ? "text-win" : "text-loss") : r.net >= 0 ? "text-win" : "text-loss")}>
            {unit === "R" ? fmtR(r.avgR) : money(r.net, cur)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-[12.5px] leading-relaxed text-mute">{text}</p>;
}

const COL_TONE: Readonly<Record<ChartRow["tone"], string>> = { win: "bg-win/75", loss: "bg-loss/75", fg: "bg-white/55", mute: "bg-white/20" };

/**
 * Net per bucket as columns from the zero line (wins up, losses down), growing on first view (`scaleY`,
 * `spring.enter`, staggered `stagger.rows`, capped) and again for a new period. Every column has a `title`; the whole
 * chart is one `role="img"` with the values in its label.
 */
export function PeriodColumns({ rows, cur, label, play, className }: { rows: readonly ChartRow[]; cur: string; label: string; play: string; className?: string }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useFirstInView(ref, !reduced);
  const on = seen || reduced;
  const maxPos = Math.max(0, ...rows.map((r) => r.value));
  const maxNeg = Math.max(0, ...rows.map((r) => -r.value));
  const span = maxPos + maxNeg || 1;
  const zero = (maxPos / span) * 100;
  const desc = rows.map((r) => `${r.label} ${money(r.value, cur)}`).join(", ");
  return (
    <div ref={ref} className={cn("grid gap-1.5", className)}>
      <div role="img" aria-label={`${label}: ${desc}`} className="relative flex h-36 items-stretch gap-[3px]" data-testid="report-columns">
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 h-px bg-white/15" style={{ top: `${zero}%` }} />
        {rows.map((r, i) => {
          const h = (Math.abs(r.value) / span) * 100;
          const up = r.value >= 0;
          return (
            <span key={`${play}-${r.label}-${i}`} aria-hidden="true" title={`${r.label}: ${money(r.value, cur)} · ${r.n} Trade${r.n === 1 ? "" : "s"}`} className="relative min-w-0 flex-1">
              <motion.span
                className={cn("absolute inset-x-0", up ? "rounded-t-[3px]" : "rounded-b-[3px]", COL_TONE[r.tone])}
                style={{ top: up ? `${zero - h}%` : `${zero}%`, height: `${Math.max(h, 0.8)}%`, originY: up ? 1 : 0 }}
                initial={reduced ? false : { scaleY: 0 }}
                animate={{ scaleY: on ? 1 : 0 }}
                transition={{ ...spring.enter, delay: reduced ? 0 : Math.min(i, stagger.max) * stagger.rows + stagger.lead }}
              />
            </span>
          );
        })}
      </div>
      {rows.length > 0 && (
        <div aria-hidden="true" className="flex justify-between gap-2 font-mono text-[10px] text-faint">
          <span className="truncate">{rows[0]!.label}</span>
          {rows.length > 1 && <span className="truncate">{rows[rows.length - 1]!.label}</span>}
        </div>
      )}
    </div>
  );
}

export function PerformanceCard({ report, bars, className }: { report: Report; bars: ChartRow[]; className?: string }) {
  const p = report.performance;
  const cur = report.currency;
  const per = report.period.kind === "day" ? "pro Trade" : report.period.kind === "quarter" ? "pro Woche" : report.period.kind === "year" ? "pro Monat" : "pro Tag";
  // a handful of buckets reads best as labelled bars, a month of days as columns
  const columns = bars.length > 8;
  return (
    <Card title="Performance" note={`Netto ${per}`} className={className} data-testid="report-performance" innerClassName="grid content-start gap-4">
      {!bars.length ? (
        <Empty text="Keine abgeschlossenen Trades." />
      ) : columns ? (
        <PeriodColumns rows={bars} cur={cur} label={`Netto ${per} · ${report.period.label}`} play={report.period.key} />
      ) : (
        <AnswerBars key={report.period.key} spec={{ type: "bars", unit: "money", rows: bars }} cur={cur} label={`Netto ${per} · ${report.period.label}`} />
      )}
      <div className="grid gap-x-6 sm:grid-cols-2">
        <KV label="Brutto vor Kosten" value={money(p.g.gross, cur)} tone={toneOf(p.g.gross)} />
        <KV label="Gebühren · Funding" value={`${money(-p.g.fees || 0, cur)} · ${money(-p.g.funding || 0, cur)}`} tone={p.g.fees + p.g.funding > 0 ? "loss" : "mute"} />
        <KV label="Summe R" value={fmtR(p.sumR)} tone={toneOf(p.sumR)} />
        <KV label="Handelstage" value={`${p.tradingDays} · ${pct0(p.dayWinRate)} grün`} />
        <KV
          label="Bester Tag"
          value={p.bestDay ? `${dayLabel(p.bestDay.key)} · ${money(p.bestDay.net, cur)}` : "–"}
          tone={p.bestDay ? "win" : "mute"}
        />
        <KV label="Schwächster Tag" value={p.worstDay ? `${dayLabel(p.worstDay.key)} · ${money(p.worstDay.net, cur)}` : "–"} tone={p.worstDay ? "loss" : "mute"} />
      </div>
      {(p.bestId || p.worstId) && (
        <div className="flex flex-wrap gap-2">
          {p.bestId && (
            <button type="button" onClick={() => openTrade(p.bestId!)} className="touch-hit rounded-full border border-win/30 px-3 py-1 text-[11.5px] text-win hover:bg-win/10">
              Bester Trade öffnen
            </button>
          )}
          {p.worstId && p.worstId !== p.bestId && (
            <button type="button" onClick={() => openTrade(p.worstId!)} className="touch-hit rounded-full border border-loss/30 px-3 py-1 text-[11.5px] text-loss hover:bg-loss/10">
              Schwächsten Trade öffnen
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

function Delta({ cur, prev, kind }: { cur: number | null; prev: number | null; kind: "money" | "pct" | "R" | "n" | "pf" | "score" }) {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return <span className="text-faint">–</span>;
  const d = cur - prev;
  const txt = kind === "pct" ? `${signed(Math.round(d * 100), 0)} Pp.` : kind === "R" ? fmtR(d) : kind === "pf" ? signed(d, 2) : signed(d, 0);
  return <span className={d > 0 ? "text-win" : d < 0 ? "text-loss" : "text-mute"}>{d === 0 ? "±0" : txt}</span>;
}

/** Label wide enough for "Profit-Faktor" on a phone; the two periods share the rest; Δ narrow. */
const CMP_COLS = "grid grid-cols-[minmax(5.75rem,1.15fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,3.75rem)] gap-2";

export function CompareCard({ report, className }: { report: Report; className?: string }) {
  const { cur, prev } = report.compare;
  const c = report.currency;
  const rows: { label: string; a: string; b: string; d: ReactNode }[] = [
    { label: "Trades", a: `${cur.n}`, b: `${prev.n}`, d: <Delta cur={cur.n} prev={prev.n} kind="n" /> },
    { label: "Netto", a: money(cur.net, c), b: money(prev.net, c), d: <Delta cur={cur.net} prev={prev.net} kind="money" /> },
    { label: "Win-Rate", a: pct0(cur.winRate), b: pct0(prev.winRate), d: <Delta cur={cur.winRate} prev={prev.winRate} kind="pct" /> },
    { label: "Ø R", a: fmtR(cur.avgR), b: fmtR(prev.avgR), d: <Delta cur={cur.avgR} prev={prev.avgR} kind="R" /> },
    { label: "Profit-Faktor", a: cur.pf == null ? "–" : fmtPf(cur.pf), b: prev.pf == null ? "–" : fmtPf(prev.pf), d: <Delta cur={cur.pf} prev={prev.pf} kind="pf" /> },
    { label: "Disziplin", a: cur.discipline == null ? "–" : `${Math.round(cur.discipline)}`, b: prev.discipline == null ? "–" : `${Math.round(prev.discipline)}`, d: <Delta cur={cur.discipline} prev={prev.discipline} kind="score" /> },
  ];
  return (
    <Card title="Vergleich mit der Vorperiode" note={`${report.period.short} gegen ${report.prevPeriod.short}`} className={className} data-testid="report-compare">
      <div role="table" aria-label="Vergleich mit der Vorperiode" className="grid text-[12.5px]">
        <div role="row" className={cn(CMP_COLS, "border-b border-line pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint")}>
          <span role="columnheader">Kennzahl</span>
          <span role="columnheader" className="truncate text-right">{report.period.short}</span>
          <span role="columnheader" className="truncate text-right">{report.prevPeriod.short}</span>
          <span role="columnheader" className="text-right">Δ</span>
        </div>
        {rows.map((r) => (
          <div key={r.label} role="row" className={cn(CMP_COLS, "items-baseline border-b border-line/60 py-1.5 last:border-b-0")}>
            <span role="cell" className="truncate text-mute">
              {r.label}
            </span>
            <span role="cell" className="num truncate text-right font-mono text-fg">
              {r.a}
            </span>
            <span role="cell" className="num truncate text-right font-mono text-mute">
              {r.b}
            </span>
            <span role="cell" className="num truncate text-right font-mono">
              {r.d}
            </span>
          </div>
        ))}
      </div>
      {prev.n === 0 && <p className="mt-3 text-[11.5px] text-faint">In der Vorperiode gab es keine abgeschlossenen Trades.</p>}
    </Card>
  );
}

export function StrategyCard({ report, className }: { report: Report; className?: string }) {
  const s = report.strategy;
  const cur = report.currency;
  const mark: Record<string, "win" | "loss"> = {};
  if (s.best) mark[s.best.key] = "win";
  if (s.worst) mark[s.worst.key] = "loss";
  return (
    <Card title="Strategie" note="Setups, Richtung und Session – Trade the best, fuck the rest." className={className} data-testid="report-strategy" innerClassName="gap-4">
      {s.setups.length ? <GroupTable rows={s.setups} cur={cur} label="Setup" mark={mark} /> : <Empty text="Keine Setups in diesem Zeitraum." />}
      <div className="grid gap-4 sm:grid-cols-2">
        <GroupTable rows={s.sides} cur={cur} label="Richtung" />
        <GroupTable rows={s.sessions} cur={cur} label="Session" />
      </div>
      {/* the verdict on the card floor – the Risiko card beside it is taller (Reihen-Regel, P2-14) */}
      {(s.best || (s.bestSession && s.bestSession.net > 0)) && (
        <div className="mt-auto grid gap-1 border-t border-line pt-3 text-[12px] text-mute" data-testid="report-strategy-verdict">
          {s.best && (
            <p>
              Stärkstes Setup: <span className="text-win">{s.best.label}</span> ({money(s.best.net, cur)})
              {s.worst && s.worst.key !== s.best.key && (
                <>
                  {" · "}Schwächstes: <span className="text-loss">{s.worst.label}</span> ({money(s.worst.net, cur)})
                </>
              )}
            </p>
          )}
          {s.bestSession && s.bestSession.net > 0 && (
            <p>
              Beste Session: <span className="text-fg">{s.bestSession.label}</span> ({money(s.bestSession.net, cur)}, {s.bestSession.n} Trades)
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

export function ReportRiskCard({ report, className }: { report: Report; className?: string }) {
  const k = report.risk;
  return (
    <Card title="Risiko" note="Pro Trade in % des Kontokapitals." className={className} data-testid="report-risk">
      <div className="grid">
        <KV label="Ø Risiko pro Trade" value={k.avgRiskPct == null ? "–" : `${dec(k.avgRiskPct * 100, 2)} %`} />
        <KV label="Max. Risiko pro Trade" value={k.maxRiskPct == null ? "–" : `${dec(k.maxRiskPct * 100, 2)} %`} />
        <KV label="Risikokonstanz" value={k.consistency == null ? "–" : pct0(k.consistency)} />
        <KV label="Über der Grenze" value={`${k.overLimit}`} tone={k.overLimit ? "loss" : "win"} />
        <KV label="Ø / max. Hebel" value={`${k.avgLeverage == null ? "–" : `${dec(k.avgLeverage)}×`} / ${k.maxLeverage == null ? "–" : `${dec(k.maxLeverage)}×`}`} />
        <KV label="Schlechtester Trade" value={fmtR(k.worstR)} tone={toneOf(k.worstR)} />
        <KV label="Verluste über 1 R" value={`${k.bigLosses}`} tone={k.bigLosses ? "loss" : "win"} />
        <KV label="Tage über dem Tageslimit" value={`${k.dayBreaches}`} tone={k.dayBreaches ? "loss" : "win"} />
        <KV label="Längste Verlustserie" value={`${k.longestLosing}`} />
        <KV
          label="Funding gezahlt / erhalten"
          value={`${money(-report.performance.g.fundingPaid || 0, report.currency)} / ${money(report.performance.g.fundingReceived, report.currency)}`}
          tone={report.performance.g.funding > 0 ? "loss" : report.performance.g.funding < 0 ? "win" : "mute"}
        />
      </div>
    </Card>
  );
}

export function PsychCard({ report, className }: { report: Report; className?: string }) {
  const s = report.psychology;
  const cur = report.currency;
  return (
    <Card title="Psychologie" note="Muster aus deinen Trades – keine Diagnose, nur Belege." className={className} data-testid="report-psych" innerClassName="grid content-start gap-4">
      {s.behaviors.length ? (
        <ul className="grid" aria-label="Muster im Zeitraum">
          {s.behaviors.map((b) => (
            <li key={b.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-line/60 py-1.5 text-[12.5px] last:border-b-0">
              <span className="min-w-0 truncate text-fg">
                {b.label} <span className="num font-mono text-faint">× {b.count}</span>
              </span>
              <span className={cn("num font-mono", b.excess < 0 ? "text-loss" : "text-mute")} title="gegenüber sauberen Trades">
                {money(b.excess, cur)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty text="Keine auffälligen Muster in diesem Zeitraum." />
      )}
      <div className="grid gap-x-6 sm:grid-cols-2">
        <KV label="Trades mit Muster" value={pct0(s.flaggedShare)} tone={s.flaggedShare ? "loss" : "mute"} />
        <KV label="Plan befolgt" value={pct0(s.planRate)} />
        <KV label="Ø Stimmung (1–5)" value={dec(s.mood)} />
        <KV label="Ø Stress / Zuversicht" value={`${dec(s.stress)} / ${dec(s.confidence)}`} />
      </div>
      {s.emotions.length > 0 && <GroupTable rows={s.emotions.slice(0, 5)} cur={cur} label="Emotion" />}
    </Card>
  );
}

export function MistakesCard({ report, className }: { report: Report; className?: string }) {
  const m = report.mistakes;
  const cur = report.currency;
  return (
    <Card title="Fehler" note="Was die Fehler gegenüber sauberen Trades gekostet haben." className={className} data-testid="report-mistakes" innerClassName="grid content-start gap-3">
      {m.rows.length ? (
        <ul className="grid" aria-label="Fehler im Zeitraum">
          {m.rows.map((x) => (
            <li key={x.tag} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-line/60 py-1.5 text-[12.5px] last:border-b-0">
              <span className="flex min-w-0 items-center gap-1.5 text-fg">
                <span className="truncate">{x.tag}</span>
                <span className="num font-mono text-faint">× {x.n}</span>
                {x.auto && <Badge tone="mute">erkannt</Badge>}
              </span>
              <span className={cn("num font-mono", x.excess < 0 ? "text-loss" : "text-mute")}>{money(x.excess, cur)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty text="Keine Fehler markiert oder erkannt." />
      )}
      <KV label="Saubere Trades" value={pct0(m.cleanShare)} tone={m.cleanShare == null ? "mute" : m.cleanShare >= 0.7 ? "win" : "fg"} />
      {m.leak && (
        <p className="text-[12px] text-mute">
          Größtes Leck: <span className="text-loss">{m.leak.tag}</span> ({money(m.leak.excess, cur)})
        </p>
      )}
    </Card>
  );
}

export const GOAL_HINT = "Noch keine Ziele. Übernimm den Plan des Coachs – dann misst jeder Bericht, wie du ihn hältst.";

/** Reports whose streak already burst this session (once per report). */
const celebrated = new Set<string>();

export function GoalsCard({ report, className }: { report: Report; className?: string }) {
  const g = report.goals;
  const reduced = useReducedFx();
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useFirstInView(ref, true);
  const key = report.period.key;
  useEffect(() => {
    if (!seen || reduced || g.streak < 3 || celebrated.has(key) || !ref.current) return;
    celebrated.add(key);
    celebrateStreak(ref.current, { streak: g.streak });
  }, [seen, reduced, g.streak, key]);
  return (
    <Card title="Zielerreichung" note="Gemessen aus deinem Journal – nie von Hand abgehakt." className={className} data-testid="report-goals" innerClassName="grid content-start gap-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ["Disziplin Ø", g.discipline == null ? "–" : `${Math.round(g.discipline)}`, g.discipline == null ? "text-mute" : g.discipline >= 70 ? "text-win" : g.discipline >= 50 ? "text-fg" : "text-loss"],
          ["Serie", `${g.streak} ${g.streak === 1 ? "Tag" : "Tage"}`, g.streak >= 3 ? "text-win" : "text-fg"],
          ["Journaling", pct0(g.journalRate), "text-fg"],
          ["Checkliste", pct0(g.checklistRate), "text-fg"],
          ["Regelverstöße", `${g.ruleBreaks}`, g.ruleBreaks ? "text-loss" : "text-win"],
        ].map(([k, v, c]) => (
          <div key={k} className="grid min-w-0 gap-0.5 rounded-xl border border-line bg-ink-950/50 px-2.5 py-2">
            <dt className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">{k}</dt>
            <dd className={cn("num truncate font-mono text-[14px]", c)}>{k === "Serie" ? <span ref={ref}>{v}</span> : v}</dd>
          </div>
        ))}
      </dl>
      {g.rows.length ? (
        <ul className="grid" aria-label="Ziele">
          {g.rows.map((x) => (
            <li key={x.title} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line/60 py-2 last:border-b-0">
              <span className="grid min-w-0 gap-0.5">
                <span className="text-[13px] text-fg">{x.title}</span>
                <span className="text-[11px] text-faint">
                  {x.source === "coach" ? "Coach-Plan" : "Ziel"} · Ziel {x.targetText} · Ist {x.actualText}
                </span>
              </span>
              {x.met == null ? <Badge tone="mute">keine Daten</Badge> : x.met ? <Badge tone="win" dot>gehalten</Badge> : <Badge tone="loss">verfehlt</Badge>}
            </li>
          ))}
        </ul>
      ) : (
        <Empty text={GOAL_HINT} />
      )}
    </Card>
  );
}
