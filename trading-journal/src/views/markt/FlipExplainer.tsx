/**
 * "Was ist ein Flip?" – the explainer on top of the Top-Trader card (Markt page, Runde 12 / Paket W). Lazy chunk (loaded by the card).
 *
 * Two things, side by side in one panel:
 *  (a) the REAL data of the card – the net of the Top-Trader (oberste 20 % nach Einsatz, Binance) of the last days as an area around
 *      the zero line (green above with a +, red and hatched below with a −), the price as a thin line on its own scale, the last flip
 *      with an arrow, a ring and the label "Flip 28.10. · netto Short" – only when the history gives one; else the sentence says
 *      "Kein Flip …". Gaps stay gaps (a band, the line breaks). Colour is never the only signal: sign, hatching and words.
 *  (b) a SCHEMA in three steps, labelled "Schema, keine Daten" (invented curves): netto long → Positionierung kippt → netto short.
 * Under them: the hint (never a forecast, never advice), Quelle · Kohorte · Messzeit as the card shows them, "Wie lese ich das?",
 * and a calm link to Einstellungen › Alarme (`openFeature("vier-alarme")`) – nothing is switched on from here.
 *
 * Motion (once, when first on screen; `transform` / `opacity` / `stroke-dashoffset` only, WAAPI, no loop): the lines draw themselves,
 * the areas fill from the zero line, the marker fades in and its ring pulses ONCE; the schema plays its three panels one after the
 * other. Reduced motion = the finished picture, nothing waits and nothing is hidden.
 *
 * Fixed boxes: the chart box has a fixed height and every text block a reserved one, so nothing moves when the data arrives (the
 * card's `PendingCard` reserve counts this panel).
 */
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PLAN_LIMITS } from "@/billing/plans";
import { useLimit, usePlan } from "@/billing/entitlements";
import { cloudEnabled } from "@/cloud/env";
import { useCloudSession } from "@/cloud/session";
import { hasClaudeRuntime } from "@/store/capability";
import { netGeometry, type NetGeometry } from "@/views/overview/traderNetChart";
import type { NetPoint, TraderNetView } from "@/domain/signals";
import { NET_SERIES, type NetGap, type NetSeriesId } from "@/domain/signals/netSeries";
import { cn } from "@/lib/cn";
import { playWaapi } from "@/motion/fx/shared";
import { useFirstInView } from "@/motion/inView";
import { ease, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { alarmNote, flipModel, pillWidth, SCHEMA_BOX, SCHEMA_CURVES, SCHEMA_FLIP, schemaArea, smoothPath, type FlipModel } from "./flipExplainerModel";
import { FLIP } from "./flipExplainerStrings";
import { netTicks, pillPlacement, splitRuns, timeTicks } from "./traderNetCardModel";
import type { ProvenanceLine, WalState } from "./traderNetWal";

const FONT = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
const PLAN_NAME = { free: "Free", pro: "Pro", premium: "Premium", team: "Team" } as const;

/** Room around the plot box (CSS px): net axis left, the pill above, the time axis below. */
const padOf = (w: number) => (w < 480 ? { l: 34, r: 10, t: 30, b: 24 } : { l: 40, r: 12, t: 32, b: 26 });

/** `M x y L …` of a run of the net curve. */
const linePath = (g: NetGeometry, pts: readonly NetPoint[], key: (p: NetPoint) => number): string => pts.map((p, i) => `${i ? "L" : "M"}${g.x(p.t).toFixed(1)} ${key(p).toFixed(1)}`).join(" ");
/** The area between a run and the zero line. */
const areaPath = (g: NetGeometry, pts: readonly NetPoint[]): string => `${linePath(g, pts, (p) => g.y(p.net))} L${g.x(pts[pts.length - 1]!.t).toFixed(1)} ${g.zeroY.toFixed(1)} L${g.x(pts[0]!.t).toFixed(1)} ${g.zeroY.toFixed(1)} Z`;
/** The price line: pen up where a point has no price. */
function pricePath(g: NetGeometry, runs: readonly (readonly NetPoint[])[]): string {
  let d = "";
  for (const run of runs) {
    let pen = false;
    for (const p of run) {
      if (p.price === null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${g.x(p.t).toFixed(1)} ${g.yPrice(p.price).toFixed(1)} `;
      pen = true;
    }
  }
  return d.trim();
}

/** The resting style of what the reveal will play: hidden while it waits, otherwise nothing (the finished picture). */
const HIDDEN_LINE = { strokeDasharray: 1, strokeDashoffset: 1 } as const;
const HIDDEN_AREA = { opacity: 0 } as const;

/** Defs shared by a plot: clips for the two halves, the soft gradients and the hatching of the short side. */
function PlotDefs({ id, g, w, h }: { id: string; g: { zeroY: number; top: number; bottom: number }; w: number; h: number }) {
  return (
    <defs>
      <clipPath id={`${id}-up`}>
        <rect x={0} y={0} width={w} height={g.zeroY} />
      </clipPath>
      <clipPath id={`${id}-dn`}>
        <rect x={0} y={g.zeroY} width={w} height={h - g.zeroY} />
      </clipPath>
      <linearGradient id={`${id}-gu`} gradientUnits="userSpaceOnUse" x1={0} y1={g.zeroY} x2={0} y2={g.top}>
        <stop offset="0" style={{ stopColor: "var(--color-win)", stopOpacity: 0.04 }} />
        <stop offset="1" style={{ stopColor: "var(--color-win)", stopOpacity: 0.42 }} />
      </linearGradient>
      <linearGradient id={`${id}-gd`} gradientUnits="userSpaceOnUse" x1={0} y1={g.zeroY} x2={0} y2={g.bottom}>
        <stop offset="0" style={{ stopColor: "var(--color-loss)", stopOpacity: 0.04 }} />
        <stop offset="1" style={{ stopColor: "var(--color-loss)", stopOpacity: 0.42 }} />
      </linearGradient>
      <pattern id={`${id}-hatch`} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
        <line x1={0} y1={0} x2={0} y2={6} style={{ stroke: "var(--color-loss)", strokeOpacity: 0.55, strokeWidth: 1.4 }} />
      </pattern>
    </defs>
  );
}

/* ------------------------------------------------------------------------------------------------ real chart */

interface RealChartProps {
  model: FlipModel;
  /** the reveal has not started: the lines and areas wait (hidden); false = the finished picture */
  hold: boolean;
  size: { w: number; h: number };
  svgRef: React.RefObject<SVGSVGElement | null>;
}

function RealChart({ model, hold, size, svgRef }: RealChartProps) {
  const uid = useId().replace(/:/g, "");
  const g = useMemo(() => netGeometry(model.points, size.w, size.h, padOf(size.w)), [model.points, size.w, size.h]);
  if (!g) return null;
  const runs = splitRuns(model.points, model.gaps);
  const flip = model.flip;
  const fx = flip ? g.x(flip.at) : 0;
  const color = flip ? (flip.to === "long" ? "var(--color-win)" : "var(--color-loss)") : "var(--color-fg)";
  const pill = model.pill;
  const pw = pill ? pillWidth(pill) : 0;
  const bx = pill && flip ? pillPlacement(g, model.points, fx, pw) : 0;
  const py = 4;
  const ph = 20;
  const ax = Math.min(Math.max(fx, bx + 10), bx + pw - 10);
  const ringY = g.zeroY;
  const nticks = netTicks(g);
  const price = g.pMin !== null ? pricePath(g, runs) : "";
  const text = { fontFamily: FONT, fontSize: 10 } as const;
  const halo = { paintOrder: "stroke", stroke: "var(--color-ink-950)", strokeWidth: 3, strokeLinejoin: "round" } as const;
  const line = (stroke: string, extra: object = {}) => ({ fill: "none", stroke, strokeWidth: 1.8, strokeLinejoin: "round", ...extra }) as const;
  return (
    <svg ref={svgRef} width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} role="img" aria-label={model.label} className="block" data-testid="flip-explainer-svg">
      <PlotDefs id={uid} g={g} w={size.w} h={size.h} />
      {/* grid and axes: + above, 0, − below */}
      {nticks.map((t) =>
        t.v === 0 ? null : <line key={t.v} x1={g.left} x2={g.right} y1={Math.round(t.y) + 0.5} y2={Math.round(t.y) + 0.5} style={{ stroke: "var(--color-line)" }} />,
      )}
      {nticks.map((t) => (
        <text key={`l${t.v}`} x={g.left - 6} y={t.y + 3.5} textAnchor="end" style={{ ...text, fill: "var(--color-mute)" }}>
          {t.label}
        </text>
      ))}
      <text x={g.left - 6} y={g.top - 9} textAnchor="end" style={{ ...text, fill: "var(--color-mute)" }}>
        Pkt.
      </text>
      {timeTicks(g).map((t) => (
        <g key={t.t}>
          <line x1={Math.round(t.x) + 0.5} x2={Math.round(t.x) + 0.5} y1={g.bottom} y2={g.bottom + 4} style={{ stroke: "var(--color-line-2)" }} />
          <text x={t.x} y={size.h - 7} textAnchor="middle" style={{ ...text, fill: "var(--color-mute)" }}>
            {t.label}
          </text>
        </g>
      ))}
      {/* gaps: a faint band with dashed edges – nothing is drawn inside, nothing bridges it */}
      {model.gaps.map((gap) => {
        const x0 = g.x(gap.from);
        const x1 = g.x(gap.to);
        if (x1 - x0 < 1) return null;
        return (
          <g key={gap.from} data-testid="flip-explainer-gap">
            <rect x={x0} y={g.top} width={x1 - x0} height={g.bottom - g.top} style={{ fill: "var(--color-fg)", fillOpacity: 0.06 }} />
            <line x1={Math.round(x0) + 0.5} x2={Math.round(x0) + 0.5} y1={g.top} y2={g.bottom} strokeDasharray="2 4" style={{ stroke: "var(--color-mute)", strokeOpacity: 0.7 }} />
            <line x1={Math.round(x1) + 0.5} x2={Math.round(x1) + 0.5} y1={g.top} y2={g.bottom} strokeDasharray="2 4" style={{ stroke: "var(--color-mute)", strokeOpacity: 0.7 }} />
            {x1 - x0 >= 64 && (
              <text x={(x0 + x1) / 2} y={g.bottom - 10} textAnchor="middle" style={{ ...text, fill: "var(--color-mute)" }}>
                {FLIP.gapLabel}
              </text>
            )}
          </g>
        );
      })}
      {/* the areas: green above, red + hatched below – they fill from the zero line */}
      <g data-fill="" style={{ transformOrigin: `0px ${g.zeroY}px`, ...(hold ? HIDDEN_AREA : {}) }}>
        <g clipPath={`url(#${uid}-up)`}>
          {runs.map((r, i) => (r.length > 1 ? <path key={i} d={areaPath(g, r)} style={{ fill: `url(#${uid}-gu)` }} /> : null))}
        </g>
        <g clipPath={`url(#${uid}-dn)`}>
          {runs.map((r, i) =>
            r.length > 1 ? (
              <g key={i}>
                <path d={areaPath(g, r)} style={{ fill: `url(#${uid}-gd)` }} />
                <path d={areaPath(g, r)} style={{ fill: `url(#${uid}-hatch)` }} />
              </g>
            ) : null,
          )}
        </g>
      </g>
      <line x1={g.left} x2={g.right} y1={Math.round(g.zeroY) + 0.5} y2={Math.round(g.zeroY) + 0.5} style={{ stroke: "var(--color-fg)", strokeOpacity: 0.45 }} />
      {/* the price on its own scale */}
      {price && <path d={price} pathLength={1} data-draw="" style={{ ...line("var(--color-fg)", { strokeWidth: 1.2, strokeOpacity: 0.78 }), ...(hold ? HIDDEN_LINE : {}) }} />}
      {/* the net curve, green above the zero line and red below it (two clipped copies of the same path) */}
      {runs.map((r, i) =>
        r.length > 1 ? (
          <g key={i}>
            <path d={linePath(g, r, (p) => g.y(p.net))} pathLength={1} data-draw="" clipPath={`url(#${uid}-up)`} style={{ ...line("var(--color-win)"), ...(hold ? HIDDEN_LINE : {}) }} />
            <path d={linePath(g, r, (p) => g.y(p.net))} pathLength={1} data-draw="" clipPath={`url(#${uid}-dn)`} style={{ ...line("var(--color-loss)"), ...(hold ? HIDDEN_LINE : {}) }} />
          </g>
        ) : (
          <circle key={i} cx={g.x(r[0]!.t)} cy={g.y(r[0]!.net)} r={2.2} style={{ fill: r[0]!.net >= 0 ? "var(--color-win)" : "var(--color-loss)" }} />
        ),
      )}
      {/* the zones, in words and signs */}
      <text x={g.left + 6} y={g.top + 11} style={{ ...text, ...halo, fill: "var(--color-win)", fontWeight: 600 }}>
        {FLIP.zoneLong}
      </text>
      <text x={g.left + 6} y={g.bottom - 6} style={{ ...text, ...halo, fill: "var(--color-loss)", fontWeight: 600 }}>
        {FLIP.zoneShort}
      </text>
      {/* the flip: dashed guide, arrow from the label to the crossing, ring on the zero line */}
      {flip && pill && (
        <g data-marker="" data-testid="flip-explainer-marker" style={hold ? HIDDEN_AREA : undefined}>
          <line x1={fx} x2={fx} y1={g.zeroY} y2={g.bottom} strokeDasharray="3 4" style={{ stroke: color, strokeOpacity: 0.6 }} />
          <rect x={bx} y={py} width={pw} height={ph} rx={ph / 2} style={{ fill: "var(--color-ink-950)", stroke: color, strokeOpacity: 0.8 }} />
          <text x={bx + 8} y={py + ph / 2 + 3.5} style={{ ...text, fontSize: 10.5, fontWeight: 600, fill: color }} data-testid="flip-explainer-pill">
            {pill}
          </text>
          <path d={`M${ax} ${py + ph} ${ax !== fx ? `L${fx} ${py + ph + 6}` : ""} L${fx} ${ringY - 15}`} style={{ fill: "none", stroke: color, strokeWidth: 1.6 }} />
          <path d={`M${fx - 4.5} ${ringY - 16} L${fx + 4.5} ${ringY - 16} L${fx} ${ringY - 9} Z`} style={{ fill: color }} />
          <circle cx={fx} cy={ringY} r={5} style={{ fill: "var(--color-ink-950)", stroke: color, strokeWidth: 2 }} />
          <circle data-ring="" data-testid="flip-explainer-ring" cx={fx} cy={ringY} r={9} style={{ fill: "none", stroke: color, strokeWidth: 2, opacity: 0, transformBox: "fill-box", transformOrigin: "center" }} />
        </g>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------------------------------------ schema */

function SchemaPanel({ step, id, hold }: { step: 1 | 2 | 3; id: string; hold: boolean }) {
  const { w, h, zero } = SCHEMA_BOX;
  const curve = smoothPath(SCHEMA_CURVES[step]);
  const area = schemaArea(step);
  const up = step === 1;
  const dn = step === 3;
  const both = step === 2;
  const text = { fontFamily: FONT, fontSize: 8 } as const;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="block w-full" data-testid={`flip-schema-svg-${step}`} data-step={step}>
      <PlotDefs id={id} g={{ zeroY: zero, top: 4, bottom: h - 4 }} w={w} h={h} />
      <line x1={0} x2={w} y1={zero} y2={zero} strokeDasharray="3 3" style={{ stroke: "var(--color-fg)", strokeOpacity: 0.4 }} />
      <text x={3} y={zero - 3} style={{ ...text, fill: "var(--color-mute)" }}>
        0
      </text>
      <text x={w - 3} y={11} textAnchor="end" style={{ ...text, fill: "var(--color-win)", fontWeight: 700 }}>
        +
      </text>
      <text x={w - 3} y={h - 4} textAnchor="end" style={{ ...text, fill: "var(--color-loss)", fontWeight: 700 }}>
        −
      </text>
      <g data-fill="" style={{ transformOrigin: `0px ${zero}px`, ...(hold ? HIDDEN_AREA : {}) }}>
        {(up || both) && (
          <g clipPath={`url(#${id}-up)`}>
            <path d={area} style={{ fill: `url(#${id}-gu)` }} />
          </g>
        )}
        {(dn || both) && (
          <g clipPath={`url(#${id}-dn)`}>
            <path d={area} style={{ fill: `url(#${id}-gd)` }} />
            <path d={area} style={{ fill: `url(#${id}-hatch)` }} />
          </g>
        )}
      </g>
      <path d={curve} pathLength={1} data-draw="" clipPath={`url(#${id}-up)`} style={{ fill: "none", stroke: "var(--color-win)", strokeWidth: 2, strokeLinecap: "round", ...(hold ? HIDDEN_LINE : {}) }} />
      <path d={curve} pathLength={1} data-draw="" clipPath={`url(#${id}-dn)`} style={{ fill: "none", stroke: "var(--color-loss)", strokeWidth: 2, strokeLinecap: "round", ...(hold ? HIDDEN_LINE : {}) }} />
      {both && (
        <g data-marker="" style={hold ? HIDDEN_AREA : undefined}>
          <circle cx={SCHEMA_FLIP.x} cy={SCHEMA_FLIP.y} r={4.5} style={{ fill: "var(--color-ink-950)", stroke: "var(--color-fg)", strokeWidth: 1.8 }} />
          <circle data-ring="" data-testid="flip-schema-ring" cx={SCHEMA_FLIP.x} cy={SCHEMA_FLIP.y} r={8} style={{ fill: "none", stroke: "var(--color-fg)", strokeWidth: 1.6, opacity: 0, transformBox: "fill-box", transformOrigin: "center" }} />
        </g>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------------------------------------ component */

export interface FlipExplainerProps {
  state: WalState;
  /** every point of the card (stored history + live); empty without data */
  points: readonly NetPoint[];
  gaps: readonly NetGap[];
  view: TraderNetView | null;
  /** Quelle · Kohorte · Messzeit – the card's own three lines */
  prov: readonly ProvenanceLine[];
  series: NetSeriesId;
  /** `BTC` */
  priceName: string;
  /** why there is no series (the card's reason line) */
  reason?: string;
}

/**
 * The reserved room of the text blocks (lines × line height, per breakpoint: `sm` from 640 px, `lg` from 1024 px), as a style of
 * this lazy panel – not part of the app's stylesheet (its budget is full).
 */
const RESERVE_CSS = `
.flip-x-head{min-height:88.3px}
.flip-x-chips{min-height:44px}
.flip-x-caption{min-height:67.2px}
.flip-x-legend{min-height:30.8px}
.flip-x-hint{min-height:100.8px}
.flip-x-note{min-height:62.1px}
@media (min-width:640px){.flip-x-head{min-height:72.1px}.flip-x-chips{min-height:24px}.flip-x-caption{min-height:50.4px}.flip-x-legend{min-height:15.4px}.flip-x-step{min-height:79px}.flip-x-hint{min-height:67.2px}.flip-x-note{min-height:31px}}
@media (min-width:1024px){.flip-x-caption{min-height:33.6px}.flip-x-step{min-height:0}.flip-x-hint{min-height:50.4px}}
`;

const CHART_BOX ="relative h-[176px] w-full overflow-hidden rounded-xl border border-line bg-ink-950/40 lg:h-[208px]";

export default function FlipExplainer({ state, points, gaps, view, prov, series, priceName, reason }: FlipExplainerProps) {
  const reduced = useReducedFx();
  const model = useMemo(() => flipModel({ state, points, gaps, view, reason }), [state, points, gaps, view, reason]);
  const chart = model.points.length > 1;
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const seen = useFirstInView(box, !reduced);
  const [started, setStarted] = useState(false);
  const [drawn, setDrawn] = useState(false);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.w === Math.round(el.clientWidth) && s.h === Math.round(el.clientHeight) ? s : { w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) }));
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the reveal of the real chart: once, the first time it is on screen with data (a later change of series just swaps the picture)
  useLayoutEffect(() => {
    if (started || reduced || !seen || !chart || !svg.current) return;
    setStarted(true);
    const root = svg.current;
    const anims: (Animation | null)[] = [];
    for (const el of root.querySelectorAll("[data-draw]")) {
      anims.push(playWaapi(el, [{ strokeDasharray: "1", strokeDashoffset: 1 }, { strokeDasharray: "1", strokeDashoffset: 0 }], { ...tween.draw, fill: "both" }));
    }
    for (const el of root.querySelectorAll("[data-fill]")) {
      anims.push(playWaapi(el, [{ opacity: 0, transform: "scaleY(0.1)" }, { opacity: 1, transform: "scaleY(1)" }], { duration: 0.7, ease: ease.out, delay: 0.5, fill: "both" }));
    }
    for (const el of root.querySelectorAll("[data-marker]")) {
      anims.push(playWaapi(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 0.3, ease: ease.out, delay: 0.95, fill: "both" }));
    }
    // the ring pulses ONCE
    for (const el of root.querySelectorAll("[data-ring]")) {
      anims.push(playWaapi(el, [{ transform: "scale(0.6)", opacity: 0.85 }, { transform: "scale(2.6)", opacity: 0 }], { duration: 1.1, ease: ease.out, delay: 1.15 }));
    }
    const live = anims.filter((a): a is Animation => !!a);
    void Promise.all(live.map((a) => a.finished.catch(() => undefined))).then(() => {
      for (const a of live) {
        a.cancel();
      }
      setDrawn(true);
    });
  }, [started, reduced, seen, chart, size.w]);

  // the schema plays its three panels one after the other
  const schemaBox = useRef<HTMLOListElement>(null);
  const schemaSeen = useFirstInView(schemaBox, !reduced);
  const [schemaStarted, setSchemaStarted] = useState(false);
  useLayoutEffect(() => {
    if (schemaStarted || reduced || !schemaSeen || !schemaBox.current) return;
    setSchemaStarted(true);
    const panels = schemaBox.current.querySelectorAll("[data-step]");
    panels.forEach((p, i) => {
      const d = i * 0.5;
      for (const el of p.querySelectorAll("[data-draw]")) playWaapi(el, [{ strokeDasharray: "1", strokeDashoffset: 1 }, { strokeDasharray: "1", strokeDashoffset: 0 }], { duration: 0.7, ease: ease.out, delay: d, fill: "both" });
      for (const el of p.querySelectorAll("[data-fill]")) playWaapi(el, [{ opacity: 0, transform: "scaleY(0.1)" }, { opacity: 1, transform: "scaleY(1)" }], { duration: 0.5, ease: ease.out, delay: d + 0.35, fill: "both" });
      for (const el of p.querySelectorAll("[data-marker]")) playWaapi(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 0.25, ease: ease.out, delay: d + 0.5, fill: "both" });
      for (const el of p.querySelectorAll("[data-ring]")) playWaapi(el, [{ transform: "scale(0.6)", opacity: 0.8 }, { transform: "scale(2.4)", opacity: 0 }], { duration: 1, ease: ease.out, delay: d + 0.75 });
    });
  }, [schemaStarted, reduced, schemaSeen]);
  const schemaId = useId().replace(/:/g, "");

  // the alarm link: what the plan really has
  const cloud = cloudEnabled() && !hasClaudeRuntime();
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const plan = usePlan();
  const channels = useLimit("alertChannels");
  const phoneCalls = Number.isFinite(channels) ? PLAN_LIMITS[plan.plan].phoneCallsPerMonth : 0;
  const note = alarmNote({ cloud, signedIn, channels, phoneCalls, planLabel: PLAN_NAME[plan.plan] });
  const openAlarm = () => void import("@/app/featureOpen").then((m) => m.openFeature("vier-alarme"));

  // the reserved texts keep their room: a phone shows up to four lines of the sentence
  const hold = !reduced && !started;
  const info = NET_SERIES[series];

  return (
    <section className="grid gap-4 rounded-2xl border border-line bg-white/[0.015] p-4 sm:p-5" aria-labelledby={`${schemaId}-t`} data-testid="flip-explainer" data-kind={model.kind} data-series={series}>
      <style>{RESERVE_CSS}</style>
      <header className="flip-x-head grid content-start gap-1">
        <h3 id={`${schemaId}-t`} className="text-[15px] font-medium leading-[1.3] text-fg">
          {FLIP.title}
        </h3>
        <p className="text-[12px] leading-[1.35] text-mute" data-testid="flip-explainer-lead">
          {FLIP.lead}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        {/* (a) the real data */}
        <div className="grid min-w-0 gap-2" data-testid="flip-explainer-real">
          <div className="flip-x-chips flex flex-col items-start justify-between gap-x-3 gap-y-1 sm:flex-row sm:items-center">
            <span className="inline-flex items-center gap-2 text-[11px] text-mute">
              <span className="rounded-full border border-line-2 bg-white/[0.04] px-2 py-0.5 text-[10.5px] font-semibold text-fg">{FLIP.realBadge}</span>
              <span data-testid="flip-explainer-window">
                {info.label} · {chart ? model.windowLabel : "–"}
              </span>
            </span>
            <span className="font-mono text-[12px] tabular-nums text-fg" data-testid="flip-explainer-net">
              {model.netNow ? `Aktuell ${model.netNow}${model.side ? ` · netto ${model.side === "long" ? "Long" : "Short"}` : ""}` : ""}
            </span>
          </div>
          <div ref={box} className={CHART_BOX} data-testid="flip-explainer-chart" data-kind={model.kind} data-points={model.points.length} data-gaps={model.gaps.length} data-flip={model.flip ? String(Math.round(model.flip.at)) : "none"} data-drawn={reduced || drawn || !chart ? "true" : "false"}>
            {chart && size.w > 0 ? (
              <RealChart model={model} hold={hold} size={size} svgRef={svg} />
            ) : chart ? null : (
              <p className="grid h-full place-items-center px-6 text-center text-[12.5px] leading-snug text-mute" data-testid="flip-explainer-empty">
                {model.caption}
              </p>
            )}
          </div>
          <p className="flip-x-caption text-[12px] leading-[1.4] text-fg" data-testid="flip-explainer-caption">
            {chart ? model.caption : ""}
          </p>
          <p className="flip-x-legend flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] leading-[1.4] text-mute" data-testid="flip-explainer-legend">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm bg-win/70" />
              {FLIP.legendLong}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm border border-loss/70" style={{ backgroundImage: "repeating-linear-gradient(45deg, var(--color-loss) 0 1.4px, transparent 1.4px 4px)" }} />
              {FLIP.legendShort}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-px w-3 shrink-0 bg-fg/70" />
              {priceName}-{FLIP.legendPrice}
            </span>
          </p>
          <dl className="grid gap-1 text-[11px] leading-[1.3]" data-testid="flip-explainer-provenance">
            {prov.map((p) => (
              <div key={p.id} className="flex gap-3">
                <dt className="w-14 shrink-0 text-mute">{p.label}</dt>
                <dd className="min-h-[2.75em] min-w-0 flex-1 text-fg/90 sm:min-h-[1.3em]" data-testid={`flip-explainer-prov-${p.id}`}>
                  {p.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* (b) the schema */}
        <div className="grid min-w-0 gap-2 rounded-xl border border-dashed border-line-2 p-3" data-testid="flip-explainer-schema">
          <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="rounded-full border border-dashed border-line-2 px-2 py-0.5 text-[10.5px] font-semibold text-fg" data-testid="flip-explainer-schema-badge">
              {FLIP.schemaBadge}
            </span>
            <span className="text-[11px] text-mute">{FLIP.schemaTitle}</span>
          </div>
          <ol ref={schemaBox} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1" data-testid="flip-explainer-steps">
            {FLIP.steps.map((s) => (
              <li key={s.n} className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-1 sm:content-start sm:items-start sm:gap-2 lg:grid-cols-[104px_minmax(0,1fr)] lg:items-center lg:gap-3" data-testid={`flip-explainer-step-${s.n}`}>
                <SchemaPanel step={s.n as 1 | 2 | 3} id={`${schemaId}${s.n}`} hold={!reduced && !schemaStarted} />
                <div className="flip-x-step grid min-w-0 gap-0.5 sm:content-start">
                  <span className="text-[13px] font-medium leading-[1.3] text-fg">
                    <span className="mr-1.5 font-mono text-mute">{s.n}</span>
                    {s.title}
                  </span>
                  <span className="text-[11.5px] leading-[1.35] text-mute">{s.text}</span>
                </div>
              </li>
            ))}
          </ol>
          <p className="text-[11px] leading-[1.35] text-faint">{FLIP.schemaNote}</p>
        </div>
      </div>

      <p className="flip-x-hint text-[12px] leading-[1.4] text-mute" data-testid="flip-explainer-hint">
        {FLIP.hint}
      </p>

      <details className="group rounded-xl border border-line" data-testid="flip-explainer-how">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3.5 text-[13px] font-medium text-fg focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
          {FLIP.howTitle}
          <span aria-hidden="true" className="text-mute transition-transform duration-200 group-open:rotate-90">
            ›
          </span>
        </summary>
        <dl className="grid gap-2.5 border-t border-line px-3.5 py-3 text-[12px] leading-[1.45]">
          {FLIP.how.map((h) => (
            <div key={h.id} className="grid gap-0.5 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-3">
              <dt className="font-medium text-fg">{h.term}</dt>
              <dd className="text-mute">{h.text}</dd>
            </div>
          ))}
        </dl>
      </details>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="flip-explainer-alarm">
        <Button variant="secondary" fx={false} className={cn("min-h-11")} onClick={openAlarm} data-testid="flip-explainer-alarm-button">
          {FLIP.alarmButton}
        </Button>
        <p className="flip-x-note min-w-0 flex-1 basis-60 text-[11.5px] leading-[1.35] text-mute" data-testid="flip-explainer-alarm-note">
          {FLIP.alarmOpens}
          {note ? ` ${note}` : ""}
        </p>
      </div>
    </section>
  );
}
