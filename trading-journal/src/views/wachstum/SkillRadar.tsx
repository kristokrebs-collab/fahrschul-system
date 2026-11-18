/**
 * Skill radar (P08): six process axes (Disziplin, Risiko, Journaling, Geduld, Emotionen, Planung) as an inline SVG
 * radar – the polygon grows from the centre on first view (`spring.smooth`), the corners pop one after another
 * (`spring.pop`), the profile of 30 days ago is a dashed ghost behind it. Each axis has a level 1–5 (Einstieg …
 * Meister) with its change against 30 days ago. A level-up this device has not seen yet runs one `SpotlightSweep`
 * across the card (first visit: initialised silently). No P&L axis – skills are how you trade.
 */
import { themePaint } from "@/lib/themePaint";
import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { LEVEL_NAMES, type SkillProfile } from "@/domain/growth";
import { cn } from "@/lib/cn";
import { SpotlightSweep } from "@/motion/fx";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { useSeenOnce } from "@/primitives/revealValue";
import { useGrowthUi } from "./growthStore";
import { WACHSTUM } from "./strings";
import { signedInt } from "./ui";

const W = 340;
const H = 290;
const CX = W / 2;
const CY = H / 2 + 4;
const R = 92;

function vertex(i: number, v: number): [number, number] {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / 6;
  const r = (Math.max(0, Math.min(100, v)) / 100) * R;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}
const ring = (v: number) => Array.from({ length: 6 }, (_, i) => vertex(i, v).join(",")).join(" ");
/** Label anchor of axis `i` outside the 100 ring (top / bottom labels centred, the sides pushed out). */
function labelPos(i: number): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / 6;
  const r = R + 16;
  const x = CX + r * Math.cos(a);
  const y = CY + r * Math.sin(a);
  if (i === 0) return { x, y: y - 14, anchor: "middle" };
  if (i === 3) return { x, y: y + 4, anchor: "middle" };
  return { x: x + (x > CX ? 4 : -4), y: y - 4, anchor: x > CX ? "start" : "end" };
}
const poly = (vals: readonly (number | null)[]) => vals.map((v, i) => vertex(i, v ?? 0).map((x) => x.toFixed(1)).join(",")).join(" ");

export function SkillRadar({ now, before, className }: { now: SkillProfile; before: SkillProfile; className?: string }) {
  const reduced = useReducedFx();
  const svgRef = useRef<SVGSVGElement>(null);
  const seen = useSeenOnce(svgRef);
  const grow = seen || reduced;
  const seenStore = useGrowthUi((s) => s.seen);
  const markSeen = useGrowthUi((s) => s.markSeen);
  const levelUp = useGrowthUi((s) => s.levelUp);
  const noteLevelUp = useGrowthUi((s) => s.noteLevelUp);
  const sweep = levelUp?.n ?? 0;
  const upAxis = levelUp?.label ?? null;

  useEffect(() => {
    const levels = Object.fromEntries(now.axes.map((a) => [a.key, a.level]));
    const changed = now.axes.some((a) => seenStore.skills[a.key] !== a.level);
    if (!changed) return;
    // a device's first look (no level stored yet) only remembers – it never celebrates history
    const up = now.axes.filter((a) => a.level > 0 && seenStore.skills[a.key] != null && a.level > seenStore.skills[a.key]!);
    markSeen({ skills: levels });
    if (up.length) noteLevelUp(up[0]!.label);
  }, [now, seenStore, markSeen, noteLevelUp]);

  const vals = now.axes.map((a) => a.value);
  const ghost = before.axes.map((a) => a.value);
  const hasGhost = ghost.some((v) => v != null);
  return (
    <Card title={WACHSTUM.progress.skills} note={now.value != null ? `Gesamt ${now.value} · Stufe ${now.level} ${LEVEL_NAMES[now.level]}` : "Ab einigen Trades und Handelstagen."} className={cn("relative", className)} data-testid="growth-skills" data-level={now.level}>
      {sweep > 0 && <SpotlightSweep play={sweep} playOnView={false} tone="win" />}
      <div className="grid gap-4">
        {upAxis && (
          <p className="text-[12px] font-medium text-win" data-testid="skill-levelup">
            {WACHSTUM.progress.levelUp}: {upAxis}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <DotMatrixText text={now.level ? `L${now.level}` : "--"} tone={now.level >= 4 ? "win" : "fg"} size={5} gap={2} label={`Stufe ${now.level}: ${LEVEL_NAMES[now.level]}`} />
          <span className="text-right text-[12px] text-mute">
            {now.strongest ? `Stark: ${now.strongest.label}` : ""}
            {now.weakest && now.weakest !== now.strongest ? <span className="block text-faint">Größter Hebel: {now.weakest.label}</span> : null}
          </span>
        </div>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="mx-auto block w-full max-w-[360px] overflow-visible" role="img" aria-label={now.axes.map((a) => `${a.label} ${a.value ?? "keine Daten"}`).join(", ")}>
          {[25, 50, 75, 100].map((v) => (
            <polygon key={v} points={ring(v)} fill="none" stroke={v === 100 ? themePaint("#2c2c2c") : themePaint("#1f1f1f")} strokeWidth="1" />
          ))}
          {now.axes.map((a, i) => {
            const [x, y] = vertex(i, 100);
            return <line key={a.key} x1={CX} y1={CY} x2={x} y2={y} stroke={themePaint("#1f1f1f")} strokeWidth="1" />;
          })}
          {hasGhost && <polygon points={poly(ghost)} fill="none" stroke={themePaint("#5f5f5f")} strokeWidth="1" strokeDasharray="3 3" />}
          <motion.g style={{ transformOrigin: `${CX}px ${CY}px`, transformBox: "view-box" }} initial={reduced ? false : { opacity: 0, scale: 0 }} animate={grow ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }} transition={{ scale: spring.smooth, opacity: tween.fade }}>
            <polygon points={poly(vals)} fill="rgb(61 220 132 / 0.12)" stroke={themePaint("#3ddc84")} strokeWidth="1.5" strokeLinejoin="round" />
            {vals.map((v, i) => {
              const [x, y] = vertex(i, v ?? 0);
              return (
                <motion.circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={3}
                  fill={v == null ? themePaint("#5f5f5f") : themePaint("#f2f2f2")}
                  style={{ transformOrigin: `${x}px ${y}px`, transformBox: "view-box" }}
                  initial={reduced ? false : { scale: 0 }}
                  animate={grow ? { scale: 1 } : { scale: 0 }}
                  transition={{ ...spring.pop, delay: reduced ? 0 : 0.18 + i * stagger.reveal }}
                />
              );
            })}
          </motion.g>
          {now.axes.map((a, i) => {
            const { x, y, anchor } = labelPos(i);
            return (
              <g key={a.key}>
                <text x={x} y={y - 2} textAnchor={anchor} className="fill-mute text-[10.5px] font-medium">
                  {a.label}
                </text>
                <text x={x} y={y + 10} textAnchor={anchor} className="num fill-faint font-mono text-[10px]">
                  {a.value ?? "–"}
                </text>
              </g>
            );
          })}
        </svg>
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" data-testid="skill-axes">
          {now.axes.map((a, i) => {
            const b = before.axes[i];
            const d = a.value != null && b?.value != null ? a.value - b.value : null;
            return (
              <li key={a.key} className="grid gap-0.5 rounded-xl border border-line px-2.5 py-2" title={a.hint} data-axis={a.key} data-level={a.level}>
                <span className="truncate text-[11.5px] font-medium">{a.label}</span>
                <span className={cn("text-[10.5px]", a.level ? "text-mute" : "text-faint")}>{a.level ? `Stufe ${a.level} · ${LEVEL_NAMES[a.level]}` : LEVEL_NAMES[0]}</span>
                <span className={cn("num font-mono text-[10px]", d == null ? "text-faint" : d > 0 ? "text-win" : d < 0 ? "text-loss" : "text-faint")}>{d == null ? a.sample : `${signedInt(d)} in 30 Tagen`}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
