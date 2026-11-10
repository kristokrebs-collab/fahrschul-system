/**
 * „Warum so schwach?“ (F73): the card under every finished run. It shows `diagnoseRun` (deterministic, no LLM): the ranked
 * findings (each an observation with its numbers), the rule funnel from the examined candles to the closed trades, gross
 * vs net, exits by reason, long vs short, hour / weekday, average vs median and the "ohne Filter / ohne Kosten"
 * comparison. Findings first and always open; the details fold open one by one.
 */
import { motion } from "motion/react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { feePreset } from "@/domain/backtest/index";
import { diagnoseRun, type CompareRow, type Diagnosis, type Finding, type FunnelStageView, type Severity } from "@/domain/lab";
import { cn } from "@/lib/cn";
import { n0 } from "@/lib/format";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Collapse } from "@/primitives/Expander";
import { useLabor } from "./laborStore";
import { LABOR } from "./strings";
import { moneyText, numText, pctText, rText } from "./ui";

const D = LABOR.diagnosis;
const SEV_TONE: Record<Severity, BadgeTone> = { high: "warn", medium: "mute", info: "mute" };
const FIRST_FINDINGS = 5;

/** The diagnosis of the shown run (null before a result). */
export function useDiagnosis(): Diagnosis | null {
  const result = useLabor((s) => s.result);
  const runCfg = useLabor((s) => s.runCfg);
  const bars = useLabor((s) => s.bars);
  const funding = useLabor((s) => s.fundingUsed);
  return useMemo(() => {
    if (!result || !runCfg) return null;
    const fee = feePreset(runCfg.exchange);
    return diagnoseRun(
      result,
      {
        strategy: result.strategy,
        costs: { exchange: fee.exchange, makerBps: fee.makerBps, takerBps: fee.takerBps, slippage: runCfg.slippage, funding: funding ?? "flat" },
        capital: runCfg.capital,
        riskPct: runCfg.riskPct,
        maxLeverage: runCfg.maxLeverage,
        custom: result.strategy === "custom" ? runCfg.custom : null,
      },
      { bars },
    );
  }, [result, runCfg, bars, funding]);
}

export function DiagnosisCard({ className }: { className?: string }) {
  const d = useDiagnosis();
  const [all, setAll] = useState(false);
  if (!d) return null;
  const shown = all ? d.findings : d.findings.slice(0, FIRST_FINDINGS);
  return (
    <Card
      title={D.title}
      note={D.note}
      className={className}
      data-testid="labor-diagnosis"
      action={
        <Badge tone={d.sample.level === "none" || d.sample.level === "tiny" ? "warn" : "mute"} title={d.sample.warnings.join(" ")}>
          {D.sample[d.sample.level](d.n)}
        </Badge>
      }
    >
      <div className="grid gap-5">
        {d.findings.length ? (
          <ol className="grid gap-3" aria-label={D.findings} data-testid="labor-findings">
            {shown.map((f, i) => (
              <FindingRow key={f.id} f={f} rank={i + 1} />
            ))}
          </ol>
        ) : (
          <p className="text-[13px] text-mute" data-testid="labor-findings-empty">
            {D.noFindings}
          </p>
        )}
        {d.findings.length > FIRST_FINDINGS && (
          <Button size="sm" className="justify-self-start" onClick={() => setAll((a) => !a)} aria-expanded={all}>
            {all ? D.fewer : D.more(d.findings.length - FIRST_FINDINGS)}
          </Button>
        )}
        {d.sample.warnings.length > 0 && (
          <ul className="grid gap-1" aria-label={D.sampleTitle}>
            {d.sample.warnings.map((w) => (
              <li key={w} className="text-[11.5px] leading-snug text-faint">
                {w}
              </li>
            ))}
          </ul>
        )}

        <Fold title={D.funnel.title} sub={D.funnel.sub} open id="funnel">
          <Funnel rows={d.funnel} />
        </Fold>
        <Fold title={D.compare.title} sub={D.compare.sub} open={d.compare.length > 1} id="compare">
          <Compare rows={d.compare} />
        </Fold>
        <Fold title={D.costs.title} sub={D.costs.sub} id="costs">
          <Costs d={d} />
        </Fold>
        <Fold title={D.exits.title} sub={D.exits.sub} id="exits">
          <Exits d={d} />
        </Fold>
        <Fold title={D.shape.title} sub={D.shape.sub} id="shape">
          <Shape d={d} />
        </Fold>
        <Fold title={D.data.title} sub={D.data.sub} id="data">
          <DataCoverage d={d} />
        </Fold>
      </div>
    </Card>
  );
}

// ── pieces ────────────────────────────────────────────────────────────────────────────────────────────────────

function FindingRow({ f, rank }: { f: Finding; rank: number }) {
  const reduced = useReducedFx();
  return (
    <motion.li
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={tween.fade}
      className="grid gap-1.5 rounded-xl border border-line bg-ink-950/50 p-3.5"
      data-testid="labor-finding"
      data-severity={f.severity}
      data-finding={f.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="num font-mono text-[11px] text-faint" aria-hidden="true">
          {String(rank).padStart(2, "0")}
        </span>
        <h3 className="min-w-0 flex-1 text-[13.5px] font-semibold">{f.title}</h3>
        <Badge tone={SEV_TONE[f.severity]}>{D.severity[f.severity]}</Badge>
      </div>
      <p className="text-[12.5px] leading-relaxed text-fg/90">{f.text}</p>
      <dl className="flex flex-wrap gap-x-4 gap-y-1">
        {f.evidence.map((e) => (
          <div key={e.label} className="flex items-baseline gap-1.5 text-[11.5px]">
            <dt className="text-faint">{e.label}</dt>
            <dd className="num font-mono text-fg/90">{e.value}</dd>
          </div>
        ))}
      </dl>
    </motion.li>
  );
}

function Fold({ title, sub, children, open: initial = false, id }: { title: string; sub: string; children: ReactNode; open?: boolean; id: string }) {
  const [open, setOpen] = useState(initial);
  const uid = useId();
  const region = `${uid}-${id}`;
  return (
    <section className="grid gap-2" data-testid={`labor-diag-${id}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={region}
        className="touch-hit flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-2 text-left transition-colors hover:border-white/25"
      >
        <span className="grid min-w-0 gap-0.5">
          <span className="text-[13px] font-semibold">{title}</span>
          <span className="text-[11.5px] text-faint">{sub}</span>
        </span>
        <span aria-hidden="true" className={cn("font-mono text-[14px] text-mute transition-transform duration-200", open && "rotate-45")}>
          +
        </span>
      </button>
      <Collapse open={open} id={region}>
        <div className="pb-1 pt-2">{children}</div>
      </Collapse>
    </section>
  );
}

function Funnel({ rows }: { rows: FunnelStageView[] }) {
  const top = Math.max(1, rows[0]?.count ?? 1);
  return (
    <ul className="grid gap-1.5" aria-label={D.funnel.title}>
      {rows.map((r) => (
        <li key={r.id} className="grid gap-1" data-testid="labor-funnel-row" data-kind={r.kind}>
          <div className="flex items-baseline justify-between gap-3 text-[12px]" style={{ paddingLeft: `${(r.depth ?? 0) * 12}px` }}>
            <span className={cn("min-w-0", r.kind === "loss" ? "text-faint" : r.kind === "leaf" || r.kind === "group" ? "text-mute" : "font-medium text-fg/90")}>{r.label}</span>
            <span className="num shrink-0 font-mono text-fg/90">
              {n0(r.count)}
              {r.unknown ? <span className="text-faint"> · {n0(r.unknown)} unbekannt</span> : null}
            </span>
          </div>
          <span aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-white/[0.05]" style={{ marginLeft: `${(r.depth ?? 0) * 12}px` }}>
            <span className={cn("block h-full origin-left rounded-full", r.kind === "loss" ? "bg-white/20" : "bg-fg/70")} style={{ width: `${Math.max(r.count > 0 ? 1.5 : 0, Math.min(100, (r.count / top) * 100))}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

const DELTA_TONE = (v: number | null): string => (v == null ? "text-faint" : v > 0.02 ? "text-win" : v < -0.02 ? "text-loss" : "text-fg");

function Compare({ rows }: { rows: CompareRow[] }) {
  if (rows.length < 2) return <p className="text-[12.5px] text-mute">{D.compare.none}</p>;
  return (
    <div className="overflow-x-auto" role="region" aria-label={D.compare.title} tabIndex={0}>
      <table className="w-full min-w-[34rem] text-[12px]" data-testid="labor-compare-table">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.1em] text-faint">
            <th className="pb-1.5 text-left font-semibold">{D.compare.variant}</th>
            <th className="pb-1.5 text-right font-semibold">Trades</th>
            <th className="pb-1.5 text-right font-semibold">Ø R</th>
            <th className="pb-1.5 text-right font-semibold">Δ Ø R</th>
            <th className="pb-1.5 text-right font-semibold">Win-Rate</th>
            <th className="pb-1.5 text-right font-semibold">Netto</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={cn("border-t border-line", r.kind === "base" && "bg-white/[0.03]")}>
              <th scope="row" className="py-1.5 pr-2 text-left font-medium text-fg/90">
                {r.label}
              </th>
              <td className="num py-1.5 text-right font-mono">{r.n}</td>
              <td className="num py-1.5 text-right font-mono">{rText(r.avgR)}</td>
              <td className={cn("num py-1.5 text-right font-mono", DELTA_TONE(r.deltaAvgR))}>{r.deltaAvgR == null ? "–" : rText(r.deltaAvgR)}</td>
              <td className="num py-1.5 text-right font-mono">{pctText(r.winRate, 0, false)}</td>
              <td className="num py-1.5 text-right font-mono">{moneyText(r.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pt-2 text-[11.5px] leading-snug text-faint">{D.compare.note}</p>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-line py-1.5 text-[12.5px] first:border-t-0">
      <dt className="text-mute">{k}</dt>
      <dd className={cn("num font-mono", tone)}>{v}</dd>
    </div>
  );
}

function Costs({ d }: { d: Diagnosis }) {
  const c = d.costs;
  if (!d.n) return <p className="text-[12.5px] text-mute">{D.noTrades}</p>;
  return (
    <dl className="grid gap-0">
      <Row k="Brutto (ohne Kosten)" v={`${moneyText(c.gross)} · ${rText(c.grossR)}`} />
      <Row k="Gebühren" v={moneyText(-c.fees, "USDT", false)} />
      <Row k="Slippage" v={moneyText(-c.slippage, "USDT", false)} />
      <Row k="Funding" v={c.funding >= 0 ? moneyText(-c.funding, "USDT", false) : `${moneyText(-c.funding)} (erhalten)`} />
      <Row k="Netto" v={`${moneyText(c.net)} · ${rText(c.netR)}`} tone={c.net > 0 ? "text-win" : c.net < 0 ? "text-loss" : undefined} />
      <Row k="Kostenanteil am Brutto" v={c.costShare == null ? "–" : pctText(c.costShare, 0, false)} />
      <Row k="Ø Kosten pro Trade" v={rText(c.avgCostR)} />
    </dl>
  );
}

function Exits({ d }: { d: Diagnosis }) {
  if (!d.n) return <p className="text-[12.5px] text-mute">{D.noTrades}</p>;
  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto" role="region" aria-label={D.exits.title} tabIndex={0}>
        <table className="w-full min-w-[26rem] text-[12px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.1em] text-faint">
              <th className="pb-1.5 text-left font-semibold">Ausstieg</th>
              <th className="pb-1.5 text-right font-semibold">Trades</th>
              <th className="pb-1.5 text-right font-semibold">Anteil</th>
              <th className="pb-1.5 text-right font-semibold">Ø R</th>
              <th className="pb-1.5 text-right font-semibold">Σ R</th>
            </tr>
          </thead>
          <tbody>
            {d.exits.map((e) => (
              <tr key={e.reason} className="border-t border-line">
                <th scope="row" className="py-1.5 text-left font-medium text-fg/90">
                  {e.label}
                </th>
                <td className="num py-1.5 text-right font-mono">{e.n}</td>
                <td className="num py-1.5 text-right font-mono">{pctText(e.share, 0, false)}</td>
                <td className={cn("num py-1.5 text-right font-mono", (e.avgR ?? 0) > 0 ? "text-win" : (e.avgR ?? 0) < 0 ? "text-loss" : "")}>{rText(e.avgR)}</td>
                <td className="num py-1.5 text-right font-mono">{rText(e.sumR)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid gap-0">
        <Row k="Ø Gewinner / Ø Verlierer" v={`${rText(d.payoff.avgWinR)} / ${rText(d.payoff.avgLossR)}`} />
        <Row k="Median Gewinner / Verlierer" v={`${rText(d.payoff.medWinR)} / ${rText(d.payoff.medLossR)}`} />
        <Row k="Ø R / Median R" v={`${rText(d.payoff.avgR)} / ${rText(d.payoff.medR)}`} />
        <Row k="Win-Rate / Break-even-Win-Rate" v={`${pctText(d.payoff.winRate, 0, false)} / ${pctText(d.payoff.breakEvenWinRate, 0, false)}`} />
        <Row k="Stop in ATR / in % (Median)" v={`${numText(d.excursion.stopAtrMed)} / ${d.excursion.stopPctMed == null ? "–" : pctText(d.excursion.stopPctMed, 2, false)}`} />
        <Row k="Bester / schlechtester Zwischenstand (Median)" v={`${rText(d.excursion.mfeMed)} / ${rText(d.excursion.maeMed == null ? null : -d.excursion.maeMed)}`} />
        <Row k="Stop und Ziel in einer Kerze" v={d.ambiguous.share == null ? "–" : `${d.ambiguous.n} (${pctText(d.ambiguous.share, 0, false)})`} />
      </dl>
    </div>
  );
}

function Shape({ d }: { d: Diagnosis }) {
  if (!d.n) return <p className="text-[12.5px] text-mute">{D.noTrades}</p>;
  const enough = d.n >= 60;
  return (
    <div className="grid gap-4">
      <dl className="grid gap-0">
        {d.sides.map((s) => (
          <Row key={s.side} k={`${s.side === "long" ? "Long" : "Short"} · ${s.n} Trades`} v={`Ø ${rText(s.avgR)} · Win-Rate ${pctText(s.winRate, 0, false)} · ${moneyText(s.net)}`} />
        ))}
      </dl>
      {!enough && <p className="text-[12px] text-mute">{D.shape.few}</p>}
      <div className={cn("grid gap-4 sm:grid-cols-2", !enough && "opacity-60")}>
        <BucketTable title={D.shape.hours} rows={d.byHour} />
        <BucketTable title={D.shape.weekdays} rows={d.byWeekday} />
      </div>
    </div>
  );
}

function BucketTable({ title, rows }: { title: string; rows: Diagnosis["byHour"] }) {
  return (
    <table className="w-full text-[12px]">
      <caption className="pb-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{title}</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-line">
            <th scope="row" className="py-1 text-left font-medium text-mute">
              {r.label}
            </th>
            <td className="num py-1 text-right font-mono">{r.n}</td>
            <td className={cn("num py-1 text-right font-mono", (r.avgR ?? 0) > 0 ? "text-win" : (r.avgR ?? 0) < 0 ? "text-loss" : "text-faint")}>{r.n ? rText(r.avgR) : "–"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DataCoverage({ d }: { d: Diagnosis }) {
  const c = d.coverage;
  return (
    <div className="grid gap-3">
      <dl className="grid gap-0">
        <Row k="Kerzen im Zeitraum (erwartet / vorhanden)" v={`${n0(c.expected)} / ${n0(c.received)}${c.receivedShare != null ? ` · ${pctText(c.receivedShare, 0, false)}` : ""}`} />
        <Row k="Lücken" v={c.gaps ? `${c.gaps} (${n0(c.missing)} Kerzen fehlen)` : "keine"} tone={c.gaps ? "text-warn" : undefined} />
        <Row k="Vorlauf für Indikatoren (gewünscht / gefunden)" v={`${n0(c.warmupWanted)} / ${n0(c.warmupGot)}`} tone={c.warmupOk ? undefined : "text-warn"} />
      </dl>
      <div className="overflow-x-auto" role="region" aria-label={D.data.title} tabIndex={0}>
        <table className="w-full min-w-[24rem] text-[12px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.1em] text-faint">
              <th className="pb-1.5 text-left font-semibold">Zeitebene</th>
              <th className="pb-1.5 text-right font-semibold">Kerzen geladen</th>
              <th className="pb-1.5 text-right font-semibold">Lücken</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.interval} className="border-t border-line">
                <th scope="row" className="py-1.5 text-left font-medium text-fg/90">
                  {r.interval === "1d" ? "1D" : r.interval}
                  {r.role === "exec" && <span className="pl-1.5 text-[11px] font-normal text-faint">Ausführung</span>}
                </th>
                <td className="num py-1.5 text-right font-mono">{n0(r.bars)}</td>
                <td className="num py-1.5 text-right font-mono">{r.gaps ? `${r.gaps} (${n0(r.missing)})` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
