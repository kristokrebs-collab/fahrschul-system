/**
 * Hero of a report (P04): which report, the period as split-flap tiles (they roll down to an older period, up to a
 * newer one), finished or running, the one-sentence summary, the net result as a `NumberCascade`, six key figures and
 * the equity curve of the period. A period switch peels the OLD curve away in ten strips (`playStripWipe` with a
 * painted canvas snapshot – one layout read per switch) over the new one, which stands fully drawn beneath. The three
 * strongest lines ("trade the best") cascade in under it.
 */
import { motion, type Variants } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { KIND_REPORT, type Report } from "@/domain/reports";
import { cn } from "@/lib/cn";
import { pct, pct0, pf as fmtPf, r as fmtR } from "@/lib/format";
import { EquityDraw } from "@/motion/fx/EquityDraw";
import { NumberCascade } from "@/motion/fx/NumberCascade";
import { SplitFlap } from "@/motion/fx/SplitFlap";
import { playStripWipe } from "@/motion/pulse/StripWipe";
import { STAGGER_HIDDEN, STAGGER_SHOWN, StaggerItem, withSectionStagger } from "@/motion/Stagger";
import { stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Card } from "@/primitives/Card";
import type { FlapDir } from "./berichteStore";
import { paintEquity } from "./paint";

/** Minimum curve height; next to a taller archive the well takes the card's free height (row rule, P1-08). */
export const HERO_CURVE_HEIGHT = 132;

const HL_DOT: Readonly<Record<Report["highlights"][number]["tone"], string>> = { win: "bg-win", loss: "bg-loss", fg: "bg-fg/70" };
/** Stagger parent of the highlights: `stagger.sections` apart, after `stagger.lead`; replays per period. */
const HL_PARENT: Variants = { [STAGGER_HIDDEN]: {}, [STAGGER_SHOWN]: { transition: withSectionStagger(tween.reveal, stagger.lead) } };

function Fact({ label, value, tone = "text-fg" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="grid min-w-0 gap-0.5 rounded-xl border border-line bg-ink-950/50 px-2.5 py-2">
      <dt className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">{label}</dt>
      <dd className={cn("num truncate font-mono text-[14px]", tone)}>{value}</dd>
    </div>
  );
}

/** The curve well: the strip wipe host (opaque, so the painted snapshot matches it). */
function CurveWell({ report, dir }: { report: Report; dir: FlapDir }) {
  const reduced = useReducedFx();
  const hostRef = useRef<HTMLDivElement>(null);
  const last = useRef<{ key: string; values: readonly number[] } | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const values = report.performance.equity;
  const key = report.period.key;

  // after every commit: remember the curve; on a period switch peel the previous one away
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = { key, values };
    if (!prev || prev.key === key || reduced || prev.values.length < 2) return;
    const host = hostRef.current;
    if (!host) return;
    const w = host.clientWidth;
    const h = host.clientHeight;
    const snap = paintEquity(prev.values, w, h, Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1));
    if (!snap) return;
    cancel.current?.();
    cancel.current = playStripWipe(host, snap, { direction: dir === "down" ? "rtl" : "ltr", onDone: () => (cancel.current = null) });
  }, [key, values, reduced, dir]);
  useLayoutEffect(() => () => cancel.current?.(), []);

  // the well grows with the card (flex-1, at least HERO_CURVE_HEIGHT); the drawing sits absolutely inside, so it never
  // holds the row open – one ResizeObserver, a render only when the whole-pixel height changes
  const [height, setHeight] = useState(HERO_CURVE_HEIGHT);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => setHeight(Math.max(HERO_CURVE_HEIGHT, Math.round(host.clientHeight))));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={hostRef} className="relative flex-1 overflow-hidden rounded-xl bg-ink-950" style={{ minHeight: HERO_CURVE_HEIGHT }} data-testid="report-curve">
      {values.length >= 2 ? (
        <div className="absolute inset-x-0 top-0">
          <EquityDraw values={values} height={height} label={`Kumuliertes P&L ${report.period.label}`} />
        </div>
      ) : (
        <p className="absolute inset-0 grid place-items-center px-4 text-center text-[12px] text-faint">{report.empty ? "Keine Kurve – keine abgeschlossenen Trades." : "Eine Kurve braucht mindestens einen Trade."}</p>
      )}
    </div>
  );
}

export function ReportHero({ report, dir, className }: { report: Report; dir: FlapDir; className?: string }) {
  const reduced = useReducedFx();
  const p = report.performance;
  const cur = report.currency;
  const net = p.g.net;
  return (
    <Card
      title={KIND_REPORT[report.period.kind]}
      action={report.complete ? <Badge tone="mute">abgeschlossen</Badge> : <Badge tone="warn" dot ping>läuft noch</Badge>}
      className={className}
      innerClassName="flex flex-col gap-4"
      data-testid="report-hero"
      data-key={report.period.key}
    >
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid min-w-0 gap-1.5">
          <SplitFlap text={report.period.short} tiles direction={dir} className="text-[26px] sm:text-[32px]" tileClassName="dot-num" />
          <span className="text-[12px] text-mute">
            {report.period.label} · {report.period.range}
          </span>
        </div>
        <div className="grid justify-items-start gap-0.5 sm:justify-items-end">
          <span className="label">Netto</span>
          <span className={cn("dot-num text-[34px] leading-none sm:text-[40px]", net > 0 ? "text-win" : net < 0 ? "text-loss" : "text-fg")} data-testid="report-net">
            <NumberCascade value={Math.round(net)} signed suffix={` ${cur}`} />
          </span>
        </div>
      </div>
      <p className="max-w-[70ch] text-[14px] leading-relaxed text-fg" data-testid="report-summary">
        {report.summary}
      </p>
      {!report.empty && (
        <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Fact label="Trades" value={`${p.g.n}`} />
          <Fact label="Win-Rate" value={pct0(p.g.winRate)} />
          <Fact label="Ø R" value={fmtR(p.g.avgR)} tone={p.g.avgR == null ? "text-mute" : p.g.avgR > 0 ? "text-win" : p.g.avgR < 0 ? "text-loss" : "text-fg"} />
          <Fact label="Profit-F." value={p.g.pf == null ? "–" : fmtPf(p.g.pf)} />
          <Fact label="Max. DD" value={pct(p.maxDD)} tone={p.maxDD < 0 ? "text-loss" : "text-fg"} />
          <Fact label="Rendite" value={pct(p.returnPct)} tone={p.returnPct == null ? "text-mute" : p.returnPct > 0 ? "text-win" : p.returnPct < 0 ? "text-loss" : "text-fg"} />
        </dl>
      )}
      <CurveWell report={report} dir={dir} />
      {report.highlights.length > 0 && (
        <motion.ul key={report.period.key} className="grid gap-1.5" aria-label="Das Wichtigste" initial={reduced ? false : STAGGER_HIDDEN} animate={STAGGER_SHOWN} variants={HL_PARENT}>
          {report.highlights.map((h) => (
            <StaggerItem key={h.text} as="li" className="flex items-start gap-2.5 text-[13px] leading-snug text-fg">
              <span aria-hidden="true" className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", HL_DOT[h.tone])} />
              {h.text}
            </StaggerItem>
          ))}
        </motion.ul>
      )}
    </Card>
  );
}
