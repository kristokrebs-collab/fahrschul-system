/**
 * `Szenario` (P05): a price shock of ±30 % on every open position. The P&L curve over the whole range is drawn once
 * (`EquityDraw`, glowing head) – its kinks are the liquidations, marked red. The slider drives ONE MotionValue: a
 * marker rides the curve (transform), a band opens from 0 % to the shock (clip-path), the readouts are MotionValue
 * text – zero React renders while dragging. Only when the shock crosses a liquidation does React render: that row
 * dissolves (`DissolveOut`) and comes back when the slider returns. Presets glide the value (`spring.smooth`).
 */
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform, type MotionValue } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { liquidationShock, scenarioAt, scenarioCurve, SCENARIO_MAX, shockLeg, type ScenarioLeg } from "@/domain/risk";
import { cn } from "@/lib/cn";
import { EquityDraw, EQUITY_DRAW, DissolveOut, equityPoints, pointAt } from "@/motion/fx";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { EmptyState } from "@/primitives/EmptyState";
import { RISIKO } from "./strings";
import { RiskCard, money, pct } from "./ui";

const S = RISIKO.scenario;
const H = 150;
const PRESETS = [-0.2, -0.1, 0, 0.1, 0.2];
const shockText = (s: number) => `${s > 0 ? "+" : s < 0 ? "−" : "±"}${(Math.abs(s) * 100).toFixed(1).replace(".", ",")} %`;

function LegPnl({ leg, shock, cur }: { leg: ScenarioLeg; shock: MotionValue<number>; cur: string }) {
  const text = useTransform(shock, (s) => money(shockLeg(leg, s).pnl, cur, true));
  return <motion.span className="num font-mono text-[12px] text-fg">{text}</motion.span>;
}

function liquidatedKey(legs: readonly ScenarioLeg[], s: number): string {
  return legs
    .filter((l) => shockLeg(l, s).liquidated)
    .map((l) => l.id)
    .join("|");
}

export function ScenarioCard({ legs, equity, cur }: { legs: readonly ScenarioLeg[]; equity: number; cur: string }) {
  const reduced = useReducedFx();
  const shock = useMotionValue(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState<number>(EQUITY_DRAW.width);
  const [liqKey, setLiqKey] = useState("");
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const curve = useMemo(() => scenarioCurve(legs), [legs]);
  const pts = useMemo(() => equityPoints(curve.pnl, width, H, EQUITY_DRAW.pad, 0), [curve, width]);
  const xOf = (s: number) => EQUITY_DRAW.pad + ((s + SCENARIO_MAX) / (2 * SCENARIO_MAX)) * Math.max(1, width - 2 * EQUITY_DRAW.pad);
  const kinks = useMemo(
    () =>
      legs
        .map((l) => ({ id: l.id, s: liquidationShock(l) }))
        .filter((k): k is { id: string; s: number } => k.s != null && Math.abs(k.s) <= SCENARIO_MAX),
    [legs],
  );

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => {
      const w = Math.round(el.clientWidth);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // marker + band from the one MotionValue (geometry changes only on resize / new legs)
  const marker = useTransform(shock, (s) => {
    const x = xOf(s);
    const y = pointAt(pts, x).y;
    return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
  });
  const guide = useTransform(shock, (s) => `translateX(${xOf(s).toFixed(2)}px)`);
  const band = useTransform(shock, (s) => {
    const a = xOf(0);
    const b = xOf(s);
    const left = Math.min(a, b);
    const right = Math.max(0, width - Math.max(a, b));
    return `inset(0 ${right.toFixed(2)}px 0 ${left.toFixed(2)}px)`;
  });
  const pnlText = useTransform(shock, (s) => money(scenarioAt(legs, s, equity).pnl, cur, true));
  const eqText = useTransform(shock, (s) => money(scenarioAt(legs, s, equity).equityAfter, cur));
  const sText = useTransform(shock, shockText);

  useMotionValueEvent(shock, "change", (s) => {
    const el = input.current;
    if (el) {
      const v = String(Math.round(s * 1000) / 10);
      if (el.value !== v) el.value = v;
      el.setAttribute("aria-valuetext", shockText(s));
    }
    const k = liquidatedKey(legs, s);
    if (k !== liqKey) {
      setLiqKey(k);
      if (!k) setGone(new Set());
      else setGone((g) => new Set([...g].filter((id) => k.split("|").includes(id))));
    }
  });

  if (!legs.length) {
    return (
      <RiskCard title={S.title} data-testid="risk-scenario">
        <EmptyState title={S.empty} text={S.emptyText} line={false} />
      </RiskCard>
    );
  }
  const liquidated = new Set(liqKey ? liqKey.split("|") : []);
  const go = (to: number) => {
    if (reduced) shock.set(to);
    else animate(shock, to, spring.smooth);
  };

  return (
    <RiskCard title={S.title} note={S.note} data-testid="risk-scenario" data-liquidated={liquidated.size}>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <span className="label !text-[10px]">{S.slider}</span>
            <motion.span className="dot-num text-[30px] leading-none" data-testid="scenario-shock">
              {sText}
            </motion.span>
          </div>
          <div className="grid gap-1 text-right">
            <span className="label !text-[10px]">{S.pnl}</span>
            <motion.span className="num font-mono text-[18px] text-fg" data-testid="scenario-pnl">
              {pnlText}
            </motion.span>
            <span className="num font-mono text-[11px] text-faint">
              {S.equity} <motion.span>{eqText}</motion.span>
            </span>
          </div>
        </div>

        <div ref={wrap} className="relative w-full" style={{ height: H }}>
          <motion.div aria-hidden="true" className="absolute inset-0 rounded-lg bg-white/[0.04]" style={{ clipPath: band }} />
          <EquityDraw values={curve.pnl} height={H} tone="fg" baseline={0} label={S.curve} />
          <motion.span aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-white/30" style={{ transform: guide }} />
          {kinks.map((k) => {
            const x = xOf(k.s);
            const y = pointAt(pts, x).y;
            return <span key={k.id} aria-hidden="true" className="absolute left-0 top-0 -ml-1 -mt-1 size-2 rounded-full bg-signal ring-2 ring-ink-850" style={{ transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)` }} />;
          })}
          <motion.span aria-hidden="true" className="absolute left-0 top-0 -ml-[7px] -mt-[7px] size-3.5 rounded-full border-2 border-fg bg-ink-900 shadow-[0_0_12px_rgb(255_255_255/0.35)]" style={{ transform: marker }} />
        </div>

        <div className="grid gap-2">
          <input
            ref={input}
            type="range"
            min={-SCENARIO_MAX * 100}
            max={SCENARIO_MAX * 100}
            step={0.5}
            defaultValue={0}
            aria-label={S.slider}
            aria-valuetext={shockText(0)}
            onInput={(e) => shock.set(Number((e.target as HTMLInputElement).value) / 100)}
            className={cn(
              "h-11 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none",
              "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/12",
              "[&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-signal [&::-webkit-slider-thumb]:bg-fg [&::-webkit-slider-thumb]:shadow-[0_0_12px_rgb(229_32_46/0.55)]",
              "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-white/12",
              "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-signal [&::-moz-range-thumb]:bg-fg",
              "focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-white/60",
            )}
            data-testid="scenario-slider"
          />
          <div className="flex justify-between gap-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => go(p)}
                className="touch-hit min-h-8 rounded-full border border-line-2 px-2 py-1 font-mono text-[11px] text-mute sm:px-2.5 transition-colors duration-200 hover:border-white/30 hover:text-fg"
                data-testid={`scenario-preset-${Math.round(p * 100)}`}
              >
                {p === 0 ? "0 %" : `${p > 0 ? "+" : "−"}${Math.round(Math.abs(p) * 100)} %`}
              </button>
            ))}
          </div>
        </div>

        <ul className="grid gap-1.5" aria-label="Positionen im Szenario">
          {legs.map((l) => {
            const isLiq = liquidated.has(l.id);
            const row = (
              <>
                <span className="min-w-0 truncate text-[12.5px] text-fg">{l.label}</span>
                <LegPnl leg={l} shock={shock} cur={cur} />
              </>
            );
            const cls = "flex items-center justify-between gap-3 rounded-xl border border-line bg-ink-950/40 px-3 py-2";
            if (isLiq && gone.has(l.id))
              return (
                <motion.li key={`${l.id}:gone`} className={cn(cls, "border-loss/30 bg-loss/[0.06]")} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={tween.fade} data-testid="scenario-liquidated">
                  <span className="min-w-0 truncate text-[12.5px] text-loss">{l.label}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-loss">{S.liquidated}</span>
                </motion.li>
              );
            if (isLiq)
              return (
                <DissolveOut key={`${l.id}:dissolve`} as="li" active className={cls} onDone={() => setGone((g) => new Set(g).add(l.id))}>
                  {row}
                </DissolveOut>
              );
            return (
              <motion.li key={l.id} className={cls} initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }} transition={spring.enter} data-testid="scenario-leg">
                {row}
              </motion.li>
            );
          })}
        </ul>
        <p className="text-[11px] text-faint">
          {kinks.length
            ? `Liquidation bei ${kinks.map((k) => `${shockText(k.s)} (${legs.find((l) => l.id === k.id)?.label ?? ""})`).join(", ")} – rote Punkte auf der Kurve.`
            : "Keine Liquidation bis ±30 %."}{" "}
          Bei −30 %: {equity > 0 && curve.pnl[0]! > 0 ? "+" : ""}
          {pct(equity > 0 ? curve.pnl[0]! / equity : null)} aufs Konto.
        </p>
      </div>
    </RiskCard>
  );
}
