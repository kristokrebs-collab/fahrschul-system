/**
 * Benchmark card (P03): the account against buying the live market on the day of the first trade and holding it –
 * from the market provider's daily candles (`kline_1d`, cached ≈ 3 years). The two equity lines RACE: one
 * MotionValue (0 → 1, `tween.draw` × 1.6, on first view) uncovers both lines by `clip-path` and moves their glowing
 * heads by transform – the same mechanics as `EquityDraw`, but on ONE shared scale (two separate `EquityDraw`s would
 * each scale to their own range and lie about who is ahead). Below: the adaptive benchmark – the last 90 days as a
 * percentile of the trader's own history. Without candles: an honest hint, never a made-up line.
 */
import { themePaint } from "@/lib/themePaint";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { adaptiveBenchmark, ANA_EMPTY, benchmark, CARD_TITLES, explainBenchmark, type BenchmarkReport } from "@/domain/analytics";
import type { AccountView } from "@/domain/account";
import { useFeedSelect, useProvider, type Candle, type Stamped } from "@/market";
import type { Source } from "@/market/types";
import { cn } from "@/lib/cn";
import { date as fmtDate, n2, pct, pct0 } from "@/lib/format";
import { pointAt, type EquityPoint } from "@/motion/fx/EquityDraw";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { isSafeFx } from "@/motion/safeFx";
import { EMPTY_LINE_CLOSED, EmptyState } from "@/primitives/EmptyState";
import { useSeenOnce } from "@/primitives/revealValue";
import { SOURCE_LABEL, SourceStand } from "@/ui/SourceStand";
import { memoClosed } from "./hooks";
import { AnaCard, Stat } from "./ui";

const H = 170;
const PAD = 8;
const RACE_S = tween.draw.duration * 1.6;
const EMPTY: Candle[] = [];
const selectDaily = (v: Stamped<Candle[]> | undefined): Candle[] => v?.data ?? EMPTY;
/** who served the daily candles and when (to the minute: the card re-renders once a minute, not with every tick) */
type Stamp = { source: Source; at: number } | null;
const selectStamp = (v: Stamped<Candle[]> | undefined): Stamp => (v ? { source: v.source, at: Math.floor(v.receivedAt / 60_000) * 60_000 } : null);
const sameStamp = (a: Stamp, b: Stamp): boolean => a === b || (!!a && !!b && a.source === b.source && a.at === b.at);

function Race({ rep, symbol }: { rep: BenchmarkReport; symbol: string }) {
  const reduced = useReducedFx();
  const root = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(root);
  const [w, setW] = useState(0);
  const [safe] = useState(isSafeFx);
  const p = useMotionValue(reduced ? 1 : 0);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setW(Math.round(el.clientWidth));
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (reduced) {
      p.set(1);
      return;
    }
    if (!seen) return;
    p.set(0);
    const a = animate(p, 1, { duration: RACE_S, ease: tween.draw.ease });
    return () => a.stop();
  }, [seen, reduced, p, rep]);

  const geo = useMemo(() => {
    const n = rep.points.length;
    let lo = 0;
    let hi = 0;
    for (const q of rep.points) {
      lo = Math.min(lo, q.own, q.bh);
      hi = Math.max(hi, q.own, q.bh);
    }
    if (hi - lo < 1e-9) hi += 0.01;
    const x = (i: number) => PAD + (n > 1 ? i / (n - 1) : 1) * Math.max(1, w - PAD * 2);
    const y = (v: number) => PAD + (1 - (v - lo) / (hi - lo)) * (H - PAD * 2);
    const own: EquityPoint[] = rep.points.map((q, i) => ({ x: x(i), y: y(q.own) }));
    const bh: EquityPoint[] = rep.points.map((q, i) => ({ x: x(i), y: y(q.bh) }));
    const d = (pts: EquityPoint[]) => pts.map((pt, i) => `${i ? "L" : "M"}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join("");
    return { own, bh, ownD: d(own), bhD: d(bh), zeroY: y(0) };
  }, [rep, w]);

  const clip = useTransform(p, (v) => `inset(0 ${((1 - v) * 100).toFixed(2)}% 0 0)`);
  const headX = (v: number) => PAD + v * Math.max(1, w - PAD * 2);
  const ownHead = useTransform(p, (v) => {
    const pt = pointAt(geo.own, headX(v));
    return `translate(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px)`;
  });
  const bhHead = useTransform(p, (v) => {
    const pt = pointAt(geo.bh, headX(v));
    return `translate(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px)`;
  });
  const ownTone = rep.own >= rep.bh ? themePaint("#3ddc84") : themePaint("#f2f2f2");
  return (
    <div className="grid gap-2">
      <div ref={root} className="relative overflow-hidden rounded-xl border border-line bg-ink-950/60" style={{ height: H }} role="img" aria-label={`Du ${pct(rep.own)} gegen Buy & Hold ${symbol} ${pct(rep.bh)} seit ${fmtDate(new Date(rep.from))}`} data-testid="bench-race">
        {w > 0 && (
          <>
            <motion.svg aria-hidden="true" viewBox={`0 0 ${w} ${H}`} className="absolute inset-0 h-full w-full" style={{ clipPath: clip }}>
              <line x1={0} x2={w} y1={geo.zeroY} y2={geo.zeroY} stroke={themePaint("#2c2c2c")} strokeDasharray="3 4" />
              <path d={geo.bhD} fill="none" stroke={themePaint("#9b9b9b")} strokeWidth={1.4} strokeLinejoin="round" strokeDasharray="1 0" />
              <path d={geo.ownD} fill="none" stroke={ownTone} strokeWidth={2} strokeLinejoin="round" />
            </motion.svg>
            <motion.span aria-hidden="true" className="absolute left-0 top-0 -ml-[4px] -mt-[4px] size-2 rounded-full bg-mute" style={{ transform: bhHead }} />
            <motion.span
              aria-hidden="true"
              className={cn("absolute left-0 top-0 -ml-[5px] -mt-[5px] size-2.5 rounded-full", rep.own >= rep.bh ? "bg-win" : "bg-fg")}
              style={{ transform: ownHead, boxShadow: safe ? undefined : `0 0 12px ${ownTone}` }}
            />
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("h-0.5 w-4 rounded-full", rep.own >= rep.bh ? "bg-win" : "bg-fg")} /> Du <span className="num font-mono text-fg">{pct(rep.own)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-0.5 w-4 rounded-full bg-mute" /> Buy & Hold {symbol} <span className="num font-mono text-fg">{pct(rep.bh)}</span>
        </span>
        <span className="text-faint">
          seit {fmtDate(new Date(rep.from))} · {rep.points.length} Tage
          {rep.clipped ? " (ab der ersten Tageskerze)" : ""}
        </span>
      </div>
    </div>
  );
}

export function BenchmarkCard({ view }: { view: AccountView }) {
  const provider = useProvider();
  const candles = useFeedSelect("kline_1d", selectDaily);
  const stamp = useFeedSelect("kline_1d", selectStamp, sameStamp);
  const symbol = provider?.symbol ?? "BTCUSDT";
  const daily = useMemo(() => candles.filter((c) => c.closed !== false).map((c) => ({ time: c.time, open: c.open, close: c.close })), [candles]);
  const rep = useMemo(() => (daily.length ? benchmark(view.closed, view.start, daily) : null), [view.closed, view.start, daily]);
  const [now] = useState(() => Date.now());
  const adaptive = useMemo(() => memoClosed(view.closed, `adaptive:${view.start}`, () => adaptiveBenchmark(view.closed, view.start, now)), [view.closed, view.start, now]);
  return (
    <AnaCard title={CARD_TITLES.benchmark} explain={() => explainBenchmark(rep, adaptive, symbol)} data-testid="ana-bench" note={rep ? `Konto gegen ${ANA_EMPTY.benchmarkSymbol(symbol)} · Tageskerzen des Live-Markts` : undefined}>
      <div className="grid gap-4">
        {!view.closed.length ? (
          <EmptyState title="Noch keine Trades" text="Sobald du Trades abschließt, siehst du hier, ob du den Markt schlägst." line={EMPTY_LINE_CLOSED} />
        ) : rep ? (
          <>
            <Race rep={rep} symbol={symbol} />
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Differenz" value={pct(rep.alpha)} tone={rep.alpha >= 0 ? "text-win" : "text-loss"} sub={rep.alpha >= 0 ? "vor Buy & Hold" : "hinter Buy & Hold"} />
              <Stat label="Korrelation" value={rep.corr == null ? "–" : n2(rep.corr)} sub="Tagesrenditen" />
            </div>
            <SourceStand source={stamp ? SOURCE_LABEL[stamp.source] : null} parts={[{ label: "Tageskerzen abgerufen", at: stamp?.at ?? null }]} testId="bench-stand" />
          </>
        ) : (
          <EmptyState title={ANA_EMPTY.benchmark.title} text={ANA_EMPTY.benchmark.text} line={false} />
        )}
        <div className="grid gap-2 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5" data-testid="bench-adaptive">
          <span className="label">Du gegen dich selbst · 90 Tage</span>
          {adaptive ? (
            <>
              <div className="relative h-2 rounded-full bg-gradient-to-r from-loss/40 via-white/10 to-win/40" aria-hidden="true">
                <motion.span className="absolute top-1/2 size-3 rounded-full bg-fg ring-2 ring-ink-850" style={{ left: `${(adaptive.percentile * 100).toFixed(1)}%`, x: "-50%", y: "-50%" }} initial={false} />
              </div>
              <p className="text-[12.5px] leading-snug text-mute">
                Deine letzten 90 Tage: <span className={cn("font-semibold", adaptive.current >= 0 ? "text-win" : "text-loss")}>{pct(adaptive.current)}</span> – besser als <span className="font-semibold text-fg">{pct0(adaptive.percentile)}</span> deiner {adaptive.windows} früheren 90-Tage-Fenster.
              </p>
            </>
          ) : (
            <p className="text-[12px] text-faint">Braucht etwa vier Monate Historie – dann vergleichst du dich mit deinen eigenen Quartalen.</p>
          )}
        </div>
      </div>
    </AnaCard>
  );
}
