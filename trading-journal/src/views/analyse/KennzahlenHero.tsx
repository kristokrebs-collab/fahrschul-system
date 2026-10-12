/**
 * Kennzahlen hero (P03): the annualised Sharpe as the headline (Doto digits, `TextPrism` lens on hover devices, counts
 * up on first view), its 80 % interval as a growing whisker with the sample, the edge test (Ø R with p and the
 * trades still needed), strengths / weak spots as chips ("trade the best": the strongest first, the key one marked
 * by `TactileHighlight`) and one `MorphCard` tile per ratio (`fact-ana-{key}` → explainer dialog with formula,
 * sample, interval and verdict). Tiles count up (`MotionNumber countOnReveal`) and roll their sample size
 * (`RollingDigits`).
 */
import { memo } from "react";
import { EDGE_CLEAR_P, explainRatio, metricText, pText, RATIO_LABELS, ratioVerdict, SIG_LABEL, type Metric, type RatioKey, type RatioReport, type Significance } from "@/domain/analytics";
import { cn } from "@/lib/cn";
import { n0, n1 } from "@/lib/format";
import { MorphCard, MorphTitle } from "@/motion/MorphCard";
import { TactileHighlight } from "@/motion/pulse/TactileHighlight";
import { TextPrism } from "@/motion/pulse/TextPrism";
import { RollingDigits } from "@/motion/RollingDigits";
import { radius } from "@/motion/tokens";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { GlyphPlus } from "@/primitives/icons";
import { ExplanationView } from "@/views/overview/explainer";
import { CiWhisker, CountValue, SigBadge, ciText, whiskerDomain } from "./ui";

/** Tiles next to the headline (Sharpe per day is the headline itself). */
export const HERO_TILES: readonly RatioKey[] = ["sortino", "calmar", "sqn", "halfKelly", "gainToPain", "omega", "ulcer", "tailRatio", "sharpeTrade"];

/** Which ratios speak first when several are strong (edge and its stability before the cosmetics). */
const STRENGTH_ORDER: readonly RatioKey[] = ["edge", "sqn", "sharpe", "calmar", "sortino", "gainToPain", "tailRatio", "omega", "ulcer", "halfKelly", "sharpeTrade", "sortinoTrade"];

const TONE_TEXT = { win: "text-win", loss: "text-loss", warn: "text-warn", mute: "text-mute" } as const;
const unitWord = (m: Metric) => (m.unit === "days" ? (m.n === 1 ? "Tag" : "Tage") : m.unit === "months" ? (m.n === 1 ? "Monat" : "Monate") : m.n === 1 ? "Trade" : "Trades");

function valueNode(m: Metric, rep: RatioReport, cur: string, revealKey: string, className?: string) {
  if (m.value == null || !Number.isFinite(m.value)) return <span className={className}>{metricText(m, rep.edgeUnit, cur)}</span>;
  if (m.key === "kelly" || m.key === "halfKelly") return <CountValue value={m.value} format={(v) => `${n1(v * 100)} %`} revealKey={revealKey} className={className} />;
  if (m.key === "ulcer") return <CountValue value={m.value} decimals={1} suffix=" %" revealKey={revealKey} className={className} />;
  if (m.key === "edge" && rep.edgeUnit === "money") return <CountValue value={m.value} decimals={0} signed suffix={` ${cur}`} revealKey={revealKey} className={className} />;
  if (m.key === "edge") return <CountValue value={m.value} decimals={2} signed suffix=" R" revealKey={revealKey} className={className} />;
  return <CountValue value={m.value} decimals={2} revealKey={revealKey} className={className} />;
}

/** Explainer body of a ratio dialog. */
function RatioBody({ m, rep, cur }: { m: Metric; rep: RatioReport; cur: string }) {
  const v = ratioVerdict(m);
  return (
    <div className="grid gap-4">
      <div className={cn("dot-num text-[40px] leading-none", TONE_TEXT[v.tone])}>{metricText(m, rep.edgeUnit, cur)}</div>
      <ExplanationView bare d={explainRatio(m, rep, cur)} />
    </div>
  );
}

const RatioTile = memo(function RatioTile({ m, rep, cur, index }: { m: Metric; rep: RatioReport; cur: string; index: number }) {
  const L = RATIO_LABELS[m.key];
  const v = ratioVerdict(m);
  const id = `fact-ana-${m.key}`;
  const domain = whiskerDomain([m.ci], [m.value]);
  return (
    <li className="@container min-w-0" data-testid={`ana-tile-${m.key}`} data-tone={v.tone}>
      <MorphCard id={id} title={L.label} body={() => <RatioBody m={m} rep={rep} cur={cur} />} className="group h-full overflow-hidden rounded-2xl border border-white/[0.06] bg-ink-800 px-3 py-2.5 text-left hover:border-white/25">
        <div className="relative grid gap-1.5">
          <MorphTitle id={id} as="span" className="label flex items-center justify-between gap-1 whitespace-nowrap max-sm:tracking-[0.08em]">
            <span className="truncate">{L.label}</span>
            <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full border border-line-2 text-mute transition-transform duration-300 group-hover:rotate-90 group-hover:text-fg">
              <GlyphPlus className="size-3" />
            </span>
          </MorphTitle>
          {valueNode(m, rep, cur, `ana-${m.key}`, cn("num truncate font-mono text-[18px] font-medium leading-tight", TONE_TEXT[v.tone] === "text-mute" ? "text-fg" : TONE_TEXT[v.tone]))}
          <CiWhisker ci={m.ci} value={m.value != null && Number.isFinite(m.value) ? m.value : null} domain={domain} index={index} tone={v.tone === "win" ? "win" : v.tone === "loss" ? "loss" : "fg"} />
          <span className="flex items-center justify-between gap-2 text-[10.5px] text-faint">
            <span className="num inline-flex items-baseline gap-1 font-mono">
              n <RollingDigits value={m.n} aria-label={`${m.n} ${unitWord(m)}`} /> <span className="font-sans">{unitWord(m)}</span>
            </span>
            {m.value == null && <span>zu wenig</span>}
          </span>
        </div>
      </MorphCard>
    </li>
  );
});

function edgeVerdict(m: Metric): Significance {
  if (m.value == null) return "wenig";
  const p = m.p ?? 1;
  return m.value > 0 && p < EDGE_CLEAR_P ? "klar" : m.value > 0 && p < 0.2 ? "tendenz" : "offen";
}

export function KennzahlenHero({ rep, cur, n }: { rep: RatioReport; cur: string; n: number }) {
  const sharpe = rep.metrics.sharpe;
  const sv = ratioVerdict(sharpe);
  const edge = rep.metrics.edge;
  const ev = edgeVerdict(edge);
  // trade the best: the strongest few first (priority order), the weak spots after
  const strengths = STRENGTH_ORDER.map((k) => rep.metrics[k]).filter((m) => ratioVerdict(m).tone === "win").slice(0, 4);
  const weak = STRENGTH_ORDER.map((k) => rep.metrics[k]).filter((m) => m.value != null && ["loss", "warn"].includes(ratioVerdict(m).tone)).slice(0, 4);
  const sharpeDomain = whiskerDomain([sharpe.ci], [sharpe.value, 2]);
  return (
    <Card data-testid="ana-hero" innerClassName="gap-5">
      {n < 5 ? (
        <EmptyState title="Noch zu wenig Trades" text="Die Profi-Kennzahlen brauchen mindestens 5 abgeschlossene Trades. Bis dahin wäre jede Zahl Zufall." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8">
          <div className="grid min-w-0 content-start gap-3">
            <div className="flex items-center gap-3">
              <span className="label">Sharpe · aufs Jahr</span>
              <MorphCard
                id="fact-ana-sharpe"
                title={RATIO_LABELS.sharpe.label}
                borderRadius={radius.pill}
                className="touch-hit !w-auto rounded-full border border-line-2 px-2.5 py-0.5 hover:border-white/50"
                body={() => <RatioBody m={sharpe} rep={rep} cur={cur} />}
              >
                <span className="label !text-[9.5px]">Details +</span>
              </MorphCard>
            </div>
            <div className={cn("dot-num w-fit text-[clamp(56px,13vw,96px)] leading-none pointer-coarse:pointer-events-none", TONE_TEXT[sv.tone] === "text-mute" ? "text-fg" : TONE_TEXT[sv.tone])} data-testid="ana-sharpe">
              <TextPrism className="-my-[0.12em] py-[0.12em]">{valueNode(sharpe, rep, cur, "ana-sharpe-hero")}</TextPrism>
            </div>
            <CiWhisker ci={sharpe.ci} value={sharpe.value} domain={sharpeDomain} className="max-w-[420px]" />
            <p className="num text-[12px] text-mute">
              80-%-Intervall {ciText(sharpe.ci, "ratio")} · {n0(sharpe.n)} {unitWord(sharpe)}
            </p>
            <p className={cn("text-[13.5px] leading-snug", TONE_TEXT[sv.tone] === "text-mute" ? "text-fg" : TONE_TEXT[sv.tone])}>{sv.text}</p>
            <div className="mt-1 grid gap-2 rounded-2xl border border-line bg-ink-950/50 px-3.5 py-3" data-testid="ana-edge">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="label">Edge-Test</span>
                <SigBadge verdict={ev} />
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className={cn("num font-mono text-[20px] font-medium", edge.value == null ? "text-mute" : edge.value <= 0 ? "text-loss" : ev === "klar" ? "text-win" : "text-fg")}>{valueNode(edge, rep, cur, "ana-edge")}</span>
                <span className="text-[12px] text-mute">pro Trade · p {edge.p != null && edge.p < 0.01 ? pText(edge.p) : `= ${pText(edge.p)}`} · {edge.n} Trades</span>
              </div>
              <p className="text-[12px] leading-snug text-mute">
                {ev === "klar"
                  ? "Deine Edge ist statistisch klar größer als null."
                  : rep.tradesNeeded
                    ? `Noch nicht sicher (${SIG_LABEL[ev]}). Bei gleichem Schnitt reichen etwa ${n0(rep.tradesNeeded)} Trades für „klar“.`
                    : "Im Schnitt noch kein positiver Trade – erst Edge finden, dann Größe."}
              </p>
            </div>
            {(strengths.length > 0 || weak.length > 0) && (
              <div className="grid gap-2 text-[12px]" data-testid="ana-strengths">
                {strengths.length > 0 && (
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className="text-mute">Stärken:</span>
                    {strengths.map((m, i) => (
                      <span key={m.key} className="rounded-full border border-win/25 bg-win/10 px-2 py-0.5 text-win">
                        {i === 0 ? (
                          <TactileHighlight playOnView tab={false} padX={0}>
                            {RATIO_LABELS[m.key].short}
                          </TactileHighlight>
                        ) : (
                          RATIO_LABELS[m.key].short
                        )}
                      </span>
                    ))}
                  </p>
                )}
                {weak.length > 0 && (
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className="text-mute">Baustellen:</span>
                    {weak.map((m) => (
                      <span key={m.key} className="rounded-full border border-line-2 px-2 py-0.5 text-mute">
                        {RATIO_LABELS[m.key].short}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            )}
          </div>
          <ul className="grid min-w-0 grid-cols-2 content-start gap-2 sm:grid-cols-3" aria-label="Kennzahlen">
            {HERO_TILES.map((k, i) => (
              <RatioTile key={k} m={rep.metrics[k]} rep={rep} cur={cur} index={i} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
