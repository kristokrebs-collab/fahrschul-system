/**
 * `RSI-Trendlinien` (P02): per timeframe (4h, 1D, 1W) the diagonal RSI lines of `rsiLines` – active resistance /
 * support, a fresh break – as a German verdict (`rsiLineText`) and a small RSI chart with the lines and the break.
 *
 * Motion: each mini chart draws in left → right once in view (`clip-path` wipe on `tween.draw`); a fresh break breathes
 * three times (`GlowBreak`, `tween.glow` + finite sonar rings) and rests as a soft glow. Reduced motion: drawn, static.
 */
import { themePaint } from "@/lib/themePaint";
import { motion } from "motion/react";
import { memo, useRef } from "react";
import { DEFAULT_RSI_LINE_CFG, lineAt, rsiLineText, type BoxTf, type RsiLine, type RsiLineState } from "@/domain/boxes";
import { cn } from "@/lib/cn";
import type { BoxesView } from "@/market/boxes/store";
import { GlowBreak } from "@/motion/fx/GlowBreak";
import { useFirstInView } from "@/motion/inView";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { fmt } from "@/chart/format";
import { MARKT } from "./strings";
import { TfChip } from "./ui";

const S = MARKT.rsi;
const W = 168;
const H = 52;
/** RSI bars shown in the mini chart. */
const SPAN = 90;
const TONE_TEXT = { win: "text-win", loss: "text-loss", warn: "text-warn", mute: "text-mute" } as const;

export interface MiniGeo {
  path: string;
  lines: Array<{ d: string; tone: "res" | "sup" | "up" | "down" }>;
  brk: { x: number; y: number; dir: 1 | -1 } | null;
  levels: { y70: number; y30: number };
}

/** Geometry of the mini RSI chart: the last `SPAN` values, the lines that reach into the window, the fresh break. */
export function miniGeo(s: RsiLineState, w = W, h = H, span = SPAN): MiniGeo {
  const n = s.rsi.length;
  const from = Math.max(0, n - span);
  const xs = (i: number) => ((i - from) / Math.max(1, n - 1 - from)) * w;
  const ys = (v: number) => h - (Math.max(0, Math.min(100, v)) / 100) * h;
  let path = "";
  for (let i = from; i < n; i++) {
    const v = s.rsi[i];
    if (v == null || !Number.isFinite(v)) continue;
    path += `${path ? "L" : "M"}${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`;
  }
  const lines: MiniGeo["lines"] = [];
  const add = (l: RsiLine | null, tone: MiniGeo["lines"][number]["tone"]) => {
    if (!l) return;
    const a = Math.max(from, l.a.i);
    const b = l.brokeAt != null ? Math.min(n - 1, l.brokeAt + 1) : n - 1;
    if (b <= a) return;
    lines.push({ d: `M${xs(a).toFixed(1)} ${ys(lineAt(l, a)).toFixed(1)}L${xs(b).toFixed(1)} ${ys(lineAt(l, b)).toFixed(1)}`, tone });
  };
  add(s.res, "res");
  add(s.sup, "sup");
  add(s.breakUp, "up");
  add(s.breakDown, "down");
  const up = s.breakUp && s.ageUp != null && s.ageUp <= DEFAULT_RSI_LINE_CFG.maxAge ? s.breakUp : null;
  const down = s.breakDown && s.ageDown != null && s.ageDown <= DEFAULT_RSI_LINE_CFG.maxAge ? s.breakDown : null;
  const l = up && down ? ((s.ageUp ?? 99) <= (s.ageDown ?? 99) ? up : down) : (up ?? down);
  const bi = l?.brokeAt ?? null;
  const brk = l && bi != null && bi >= from ? { x: xs(bi), y: ys(s.rsi[bi] ?? lineAt(l, bi)), dir: (l === up ? 1 : -1) as 1 | -1 } : null;
  return { path, lines, brk, levels: { y70: ys(70), y30: ys(30) } };
}

/** Left → right draw-in of the mini chart (clip-path wipe), ends unclipped. */
const DRAW = { hidden: { clipPath: "inset(0 100% 0 0)" }, shown: { clipPath: "inset(0 0% 0 0)", transitionEnd: { clipPath: "none" } } };

const LINE_TONE: Record<MiniGeo["lines"][number]["tone"], string> = { res: themePaint("#9b9b9b"), sup: themePaint("#9b9b9b"), up: themePaint("#3ddc84"), down: themePaint("#ff4d4f") };

const Mini = memo(function Mini({ s, label }: { s: RsiLineState; label: string }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useFirstInView(ref, !reduced);
  const g = miniGeo(s);
  return (
    // the (unclipped) wrapper is observed (shared observer, intro-gated); the chart draws in once it is seen
    <motion.div ref={ref} className="relative shrink-0" style={{ width: W, height: H }} role="img" aria-label={label} initial={reduced ? false : "hidden"} animate={reduced || seen ? "shown" : "hidden"}>
      <motion.svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible" variants={DRAW} transition={tween.draw} aria-hidden="true">
        <line x1="0" x2={W} y1={g.levels.y70} y2={g.levels.y70} stroke={themePaint("#3a3a3a")} strokeDasharray="1 3" />
        <line x1="0" x2={W} y1={g.levels.y30} y2={g.levels.y30} stroke={themePaint("#3a3a3a")} strokeDasharray="1 3" />
        <path d={g.path} fill="none" stroke={themePaint("#f2f2f2")} strokeWidth="1.25" strokeLinejoin="round" />
        {g.lines.map((l, i) => (
          <path key={i} d={l.d} fill="none" stroke={LINE_TONE[l.tone]} strokeWidth="1" strokeDasharray={l.tone === "res" || l.tone === "sup" ? "3 2" : undefined} />
        ))}
        {g.brk && <circle cx={g.brk.x} cy={g.brk.y} r="3" fill={g.brk.dir === 1 ? themePaint("#3ddc84") : themePaint("#ff4d4f")} />}
      </motion.svg>
      {g.brk && <GlowBreak x={g.brk.x} y={g.brk.y} tone={g.brk.dir === 1 ? "win" : "loss"} size={22} rings={1} play={g.brk.x} />}
    </motion.div>
  );
});

function Row({ tf, s }: { tf: BoxTf; s: RsiLineState | null }) {
  const t = rsiLineText(s);
  return (
    <li className="grid gap-3 rounded-xl border border-line bg-ink-950/30 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid="rsi-row" data-tf={tf} data-tone={t.tone}>
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <TfChip tf={tf} />
          <span className={cn("text-[13px] font-semibold leading-snug", TONE_TEXT[t.tone])}>{t.title}</span>
        </div>
        <p className="text-[12px] leading-snug text-mute">{t.detail}</p>
      </div>
      {s ? (
        <div className="flex items-center gap-3">
          <span className="grid justify-items-end">
            <span className="label !text-[9px]">RSI</span>
            <span className="dot-num text-[20px] leading-none">{fmt.n1(s.last)}</span>
          </span>
          <Mini s={s} label={`RSI ${tf}: ${t.title}`} />
        </div>
      ) : null}
    </li>
  );
}

export function RsiLinesCard({ view }: { view: BoxesView }) {
  return (
    <Card title={S.title} note={S.note} className="h-full" data-testid="markt-rsi">
      <ul className="grid gap-2">
        {(["4h", "1d", "1w"] as const).map((tf) => (
          <Row key={tf} tf={tf} s={view.tfs[tf].analysis?.rsi ?? null} />
        ))}
      </ul>
    </Card>
  );
}
