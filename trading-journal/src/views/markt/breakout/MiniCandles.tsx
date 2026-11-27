/**
 * Mini-Chart einer Scanner-Karte: die ECHTEN 5-Minuten-Kerzen (Docht und Körper je Kerze, nichts geglättet, nichts erfunden), die
 * Spanne als Band mit ihren zwei Kanten und – nach einem Ausbruch – der eine rote Punkt auf dem Schluss der Ausbruchskerze.
 * Reines SVG ohne eigene Bewegung; der Punkt ist ein HTML-Element darüber, damit er rund bleibt (das SVG wird in die Breite gezogen).
 */
import type { BreakoutRead } from "@/domain/breakout";
import { BREAKOUT_RULES } from "@/domain/breakout";
import { BREAKOUT } from "./strings";

const W = 240;
const H = 52;
const PAD = 3;

export function MiniCandles({ read }: { read: BreakoutRead }) {
  const bars = read.preview;
  const range = read.range;
  if (!bars.length || !range) return <span className="bo-chart" aria-hidden="true" />;
  const iv = BREAKOUT_RULES.intervalMs;
  let hi = Math.max(range.high, ...bars.map((b) => b.high));
  let lo = Math.min(range.low, ...bars.map((b) => b.low));
  if (!(hi > lo)) {
    hi += 1;
    lo -= 1;
  }
  const t0 = bars[0]!.time;
  const n = Math.max(1, Math.round((bars[bars.length - 1]!.time - t0) / iv) + 1);
  const slot = W / n;
  const body = Math.max(0.6, slot * 0.62);
  const X = (t: number): number => ((t - t0) / iv + 0.5) * slot;
  const Y = (p: number): number => PAD + ((hi - p) / (hi - lo)) * (H - 2 * PAD);
  const f = (x: number): string => x.toFixed(1);
  let wickUp = "";
  let wickDn = "";
  const bodies: { x: number; y: number; h: number; up: boolean; t: number }[] = [];
  for (const b of bars) {
    const up = b.close >= b.open;
    const x = X(b.time);
    const seg = `M${f(x)} ${f(Y(b.high))}V${f(Y(b.low))}`;
    if (up) wickUp += seg;
    else wickDn += seg;
    const top = Y(Math.max(b.open, b.close));
    bodies.push({ x: x - body / 2, y: top, h: Math.max(0.8, Y(Math.min(b.open, b.close)) - top), up, t: b.time });
  }
  const rx0 = Math.max(0, X(range.startMs) - slot / 2);
  const rx1 = Math.min(W, X(range.endMs) - slot / 2);
  const sig = read.signal;
  return (
    <span className="bo-chart bo-fill" role="img" aria-label={BREAKOUT.chartLabel(read.base, bars.length)} data-testid="breakout-chart" data-bars={bars.length}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <rect className="rg" x={f(rx0)} y={f(Y(range.high))} width={f(Math.max(0, rx1 - rx0))} height={f(Y(range.low) - Y(range.high))} />
        <line className="ed" x1={f(rx0)} x2={W} y1={f(Y(range.high))} y2={f(Y(range.high))} />
        <line className="ed" x1={f(rx0)} x2={W} y1={f(Y(range.low))} y2={f(Y(range.low))} />
        {wickUp && <path className="up" d={wickUp} />}
        {wickDn && <path className="dn" d={wickDn} />}
        {bodies.map((b) => (
          <rect key={b.t} className={b.up ? "up" : "dn"} x={f(b.x)} y={f(b.y)} width={f(body)} height={f(b.h)} />
        ))}
      </svg>
      {sig && <span className="bo-mark" aria-hidden="true" style={{ left: `${(X(sig.barOpen) / W) * 100}%`, top: `${(Y(sig.price) / H) * 100}%` }} />}
    </span>
  );
}
