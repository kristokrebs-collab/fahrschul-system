import { motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { Reveal } from "@/motion/Reveal";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { AnalysisNote } from "@/ui/AnalysisNote";
import { fetchShared } from "@/social/api";
import { parseSharePayload, type SharedProof } from "@/social/contract";
import { fmtDd, fmtPct, fmtR, ORIGIN_LABEL } from "@/social/format";
import { ORIGIN_KINDS, type OriginKind } from "@/social/metrics";
import { BASIS_HINT, BASIS_LABEL, compareProofs, PROOF_MIN_SAMPLE, proofFigures, type ProofContinuity, type ProofFigures } from "@/social/proof";
import { ORIGIN_PHRASE, PROOF_PAGE as T } from "@/social/proofStrings";

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
const stamp = (iso: string) => new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const ORIGIN_SHORT: Readonly<Record<OriginKind, string>> = { api: "Börse", csv: "Import", manual: "Hand", auto: "Bot" };
const tone = (v: number | null): "win" | "loss" | "fg" => (v == null || v === 0 ? "fg" : v > 0 ? "win" : "loss");
const toneClass = (v: number | null) => (v == null || v === 0 ? "text-fg" : v > 0 ? "text-win" : "text-loss");
const matrix = (s: string) => s.replace("−", "-");

/** One fact cell: mono label over a value (and an optional line of context). */
function Fact({ label, value, sub, valueClass, testId }: { label: string; value: ReactNode; sub?: ReactNode; valueClass?: string; testId?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-ink-950/50 px-3 py-2" data-testid={testId}>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-mute">{label}</div>
      <div className={cn("num mt-0.5 truncate text-[14px] font-medium", valueClass)}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-mute">{sub}</div>}
    </div>
  );
}

function Block({ title, children, testId, className }: { title: string; children: ReactNode; testId?: string; className?: string }) {
  return (
    <section className={cn("grid gap-3 rounded-2xl border border-line-2 bg-ink-900 p-4 sm:p-5", className)} data-testid={testId}>
      <h3 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-mute">{title}</h3>
      {children}
    </section>
  );
}

/**
 * The running R sum as a line: zero line, the curve, the deepest drop in red. Plain SVG (no chart library), drawn with
 * `vector-effect: non-scaling-stroke` so it stays crisp at any width; it fades in (opacity only).
 */
export function RCurve({ f, className }: { f: ProofFigures; className?: string }) {
  const reduced = useReducedFx();
  const W = 600;
  const H = 180;
  const padY = 14;
  const c = f.curve;
  if (f.scored < 1) return <p className="rounded-xl border border-line bg-ink-950/40 px-4 py-6 text-center text-[13px] text-mute">{T.curveEmpty}</p>;
  const lo = Math.min(0, ...c);
  const hi = Math.max(0, ...c);
  const range = hi - lo || 1;
  const x = (i: number) => (i / (c.length - 1)) * W;
  const y = (v: number) => padY + (1 - (v - lo) / range) * (H - padY * 2);
  const line = c.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const span = f.drawdownSpan;
  const dd = span ? c.slice(span[0], span[1] + 1).map((v, i) => `${i === 0 ? "M" : "L"}${x(span[0] + i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ") : null;
  const peakAt = c.indexOf(hi);
  return (
    <motion.figure
      className={cn("grid gap-2", className)}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={tween.reveal}
      data-testid="proof-curve"
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[180px] w-full overflow-visible" role="img" aria-label={T.curveLabel(f.scored, fmtR(f.sumR), fmtDd(f.maxDrawdownR))}>
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} className="stroke-line-2" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        <path d={line} fill="none" className={cn("stroke-current", toneClass(f.sumR))} strokeWidth="1.75" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {dd && <path d={dd} fill="none" className="stroke-loss" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-mute">
        <span>Start 0R</span>
        <span>
          Höchster Stand {fmtR(hi)}
          {peakAt > 0 ? ` (nach Trade ${peakAt})` : ""}
        </span>
        <span>Ende {fmtR(f.sumR)}</span>
        {dd && <span className="text-loss">{T.drawdownMark} {fmtDd(f.maxDrawdownR)}</span>}
      </figcaption>
    </motion.figure>
  );
}

/** The earlier version this proof continues: fetched like any share, compared entry by entry. */
function Continuity({ proof }: { proof: SharedProof }) {
  const token = proof.prev ?? "";
  type S = { phase: "loading" } | { phase: "gone" } | { phase: "ok"; cmp: ProofContinuity; when: string };
  const [state, setState] = useState<S>({ phase: "loading" });
  useEffect(() => {
    let live = true;
    fetchShared(token)
      .then((d) => {
        if (!live) return;
        const prev = parseSharePayload(d.payload);
        setState(prev && prev.kind === "proof" ? { phase: "ok", cmp: compareProofs(prev, proof), when: dayLabel(d.createdAt.slice(0, 10)) } : { phase: "gone" });
      })
      .catch(() => {
        if (live) setState({ phase: "gone" });
      });
    return () => {
      live = false;
    };
  }, [token, proof]);
  return (
    <Block title={T.prevTitle} testId="proof-prev">
      {state.phase === "loading" ? (
        <p className="text-[13px] text-mute" aria-busy="true">
          {T.prevLoading}
        </p>
      ) : state.phase === "gone" ? (
        <p className="text-[13px] leading-relaxed text-warn">{T.prevGone}</p>
      ) : (
        <div className="grid gap-2 text-[13px] leading-relaxed">
          <p className={state.cmp.missing.length ? "text-loss" : "text-win"} data-testid="proof-prev-result">
            {state.cmp.missing.length ? T.prevMissing(state.cmp.missing.length, state.when) : T.prevIntact(state.cmp.kept, state.cmp.added, state.when)}
          </p>
          {state.cmp.missing.length > 0 && (
            <ul className="grid gap-0.5 font-mono text-[12px] text-mute">
              {state.cmp.missing.slice(0, 12).map((t, i) => (
                <li key={i}>{T.prevMissingRow(shortDay(t[0]), fmtR(t[1]))}</li>
              ))}
              {state.cmp.missing.length > 12 && <li>… +{state.cmp.missing.length - 12}</li>}
            </ul>
          )}
          {state.cmp.outside > 0 && <p className="text-mute">{T.prevOutside(state.cmp.outside)}</p>}
          {state.cmp.endsEarlier && <p className="text-warn">{T.prevEndsEarlier}</p>}
          {state.cmp.narrowed && <p className="text-warn">{T.prevNarrowed}</p>}
          <a href={`#share/${token}`} className="w-fit text-[12.5px] text-mute underline underline-offset-4 hover:text-fg">
            {T.prevOpen}
          </a>
        </div>
      )}
    </Block>
  );
}

export interface ProofPageProps {
  proof: SharedProof;
  /** ISO time the link was created – the proof's "Stand". */
  createdAt: string;
  className?: string;
}

/**
 * The public Ergebnisbeleg (F57), the body of `SharedView` for a proof: strategy, period, kind of results, the result AND its risk side by side, every
 * figure computed from the full list below it, how complete the list is, where the records came from, the costs, the
 * continuation check and what the proof does not show. Read-only; nothing here is stored or sent anywhere.
 */
export function ProofPage({ proof, createdAt, className }: ProofPageProps) {
  const f = useMemo(() => proofFigures(proof), [proof]);
  const [all, setAll] = useState(false);
  const rows = all ? proof.trades : proof.trades.slice(0, 40);
  const ok = f.dataClass ?? "manual";
  const originLines = ORIGIN_KINDS.filter((k) => f.origins[k] > 0);
  return (
    <div className={cn("grid gap-4", className)} data-testid="proof-page">
      <Reveal index={0}>
        <article className="grid gap-4 rounded-2xl border border-line-2 bg-[radial-gradient(120%_70%_at_0%_0%,var(--color-ink-750)_0%,var(--color-ink-850)_55%)] p-4 sm:p-6">
          <header className="grid gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
              {T.title} · {T.kicker}
            </span>
            <h2 className="text-[21px] font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-[24px]" data-testid="proof-strategy">
              {proof.strategy}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={proof.basis === "live" ? "steel" : proof.basis === "demo" ? "warn" : "mute"} title={BASIS_HINT[proof.basis]}>
                {BASIS_LABEL[proof.basis]}
              </Badge>
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-mute" data-testid="proof-period">
                {T.period(dayLabel(proof.from), dayLabel(proof.to))}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-mute">{T.stand(stamp(createdAt))}</span>
            </div>
            <p className="max-w-[62ch] text-[12.5px] leading-relaxed text-mute">{BASIS_HINT[proof.basis]}</p>
          </header>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid min-w-0 gap-1.5" data-testid="proof-sum">
              <DotMatrixText text={f.scored ? matrix(fmtR(f.sumR)) : "--"} tone={tone(f.scored ? f.sumR : null)} size={4} gap={1.5} label={`${T.sum} ${fmtR(f.sumR)}`} className="max-w-full" />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-mute">
                {T.sum} · {f.scored} {f.scored === 1 ? "Trade" : "Trades"}
              </span>
            </div>
            <div className="grid min-w-0 gap-1.5" data-testid="proof-drawdown">
              <DotMatrixText text={f.scored ? matrix(fmtDd(f.maxDrawdownR)) : "--"} tone={f.maxDrawdownR > 0 ? "loss" : "fg"} size={4} gap={1.5} label={`${T.drawdown} ${fmtDd(f.maxDrawdownR)}`} className="max-w-full" />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-mute">
                {T.drawdown} · {T.drawdownSub}
              </span>
            </div>
          </div>
          {f.scored > 0 && f.scored < PROOF_MIN_SAMPLE && (
            <p className="rounded-xl border border-warn/30 bg-warn/[0.06] px-3 py-2 text-[12.5px] leading-snug text-warn" data-testid="proof-sample">
              {T.sample(f.scored, PROOF_MIN_SAMPLE)}
            </p>
          )}
        </article>
      </Reveal>

      <Reveal index={1}>
        <Block title={T.facts}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Fact label={T.trades} value={f.n} sub={T.tradesSub(f.scored, f.noR)} testId="proof-n" />
            <Fact label={T.expectancy} value={fmtR(f.expectancyR)} valueClass={toneClass(f.expectancyR)} />
            <Fact label={T.winRate} value={fmtPct(f.winRate)} sub={T.winRateSub(f.wins, f.losses, f.flat)} />
            <Fact label={T.streak} value={f.longestLosing} sub={T.streakSub} />
            <Fact label={T.best} value={fmtR(f.best)} valueClass={toneClass(f.best)} />
            <Fact label={T.worst} value={fmtR(f.worst)} valueClass={toneClass(f.worst)} />
            <Fact label={T.withoutBest} value={fmtR(f.sumWithoutBest)} valueClass={toneClass(f.sumWithoutBest)} />
            <Fact label={T.profitFactor} value={f.profitFactor == null ? "–" : f.profitFactor.toLocaleString("de-DE", { maximumFractionDigits: 2 })} />
          </div>
        </Block>
      </Reveal>

      <Reveal index={2}>
        <Block title={T.curve}>
          <RCurve f={f} />
        </Block>
      </Reveal>

      <Reveal index={3}>
        <Block title={T.complete} testId="proof-complete">
          <p className="text-[13.5px] leading-relaxed" data-testid="proof-scope">
            {proof.scope.only == null ? T.completeAll(proof.trades.length) : T.completeOnly(proof.scope.only, proof.trades.length, proof.scope.inPeriod)}
          </p>
          <p className="text-[12.5px] leading-relaxed text-mute">{T.open(proof.scope.open)}</p>
          <p className="text-[12.5px] leading-relaxed text-mute">{T.later}</p>
        </Block>
      </Reveal>

      <Reveal index={4} className="grid gap-4 sm:grid-cols-2">
        <Block title={T.origin} testId="proof-origin">
          <ul className="grid gap-1 text-[13px]">
            {originLines.map((k) => (
              <li key={k} className="flex items-baseline justify-between gap-3">
                <span className="text-mute">{ORIGIN_LABEL[k]}</span>
                <span className="num font-mono text-[12.5px]">{T.originLine(f.origins[k], f.n, ORIGIN_PHRASE[k])}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12.5px] leading-relaxed text-mute">{T.originLevel[ok]}</p>
        </Block>
        <Block title={T.costs} testId="proof-costs">
          {f.costs.known > 0 ? (
            <>
              <p className="text-[13px] leading-relaxed">{T.costsKnown(f.costs.known, f.n)}</p>
              <p className="text-[12.5px] leading-relaxed text-mute">{T.costsSum(fmtR(f.costs.sumR), f.costs.avgR == null ? "–" : fmtR(f.costs.avgR, 3))}</p>
            </>
          ) : (
            <p className="text-[13px] leading-relaxed">{T.costsNone}</p>
          )}
          {f.costs.unknown > 0 && <p className="text-[12.5px] leading-relaxed text-warn">{T.costsUnknown(f.costs.unknown)}</p>}
        </Block>
      </Reveal>

      {proof.prev && (
        <Reveal index={5}>
          <Continuity proof={proof} />
        </Reveal>
      )}

      <Reveal index={6}>
        <Block title={`${T.history} · ${f.n}`} testId="proof-history">
          <p className="text-[12.5px] text-mute">{T.historyHint}</p>
          <div className="max-h-[460px] overflow-auto rounded-xl border border-line" role="region" aria-label={T.historyLabel} tabIndex={0}>
            <table className="w-full border-collapse text-left text-[12.5px]">
              <thead className="sticky top-0 bg-ink-900 font-mono text-[10px] uppercase tracking-[0.12em] text-mute">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">{T.col.n}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{T.col.day}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{T.col.r}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{T.col.cost}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{T.col.origin}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t, i) => (
                  <tr key={i} className="border-t border-line" data-testid="proof-row">
                    <td className="num px-3 py-1.5 text-mute">{i + 1}</td>
                    <td className="num px-3 py-1.5">{shortDay(t[0])}</td>
                    <td className={cn("num px-3 py-1.5 text-right font-medium", t[1] == null ? "text-mute" : toneClass(t[1]))}>{t[1] == null ? T.noR : fmtR(t[1])}</td>
                    <td className="num px-3 py-1.5 text-right text-mute">{t[2] == null ? T.unknown : fmtR(t[2], 3)}</td>
                    <td className="px-3 py-1.5 text-mute">{ORIGIN_SHORT[t[3]]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {proof.trades.length > rows.length && (
            <Button size="sm" onClick={() => setAll(true)} className="w-fit" data-testid="proof-all">
              Alle {proof.trades.length} Trades zeigen
            </Button>
          )}
        </Block>
      </Reveal>

      <Reveal index={7}>
        <Block title={T.limits} testId="proof-limits">
          <ul className="grid gap-1.5">
            {T.limitsList.map((t) => (
              <li key={t} className="flex gap-2 text-[13px] leading-snug">
                <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-mute" />
                {t}
              </li>
            ))}
          </ul>
          <AnalysisNote lead="Die Zahlen sind aus der Liste oben gerechnet." />
        </Block>
      </Reveal>

    </div>
  );
}
