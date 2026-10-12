/**
 * `Rechner` (P05): position size from the risk (capital × risk %, stop, taker fees, slippage) → quantity, the journal's
 * size (notional), the needed leverage and the margin; stop helpers (%, ATR, box edge, structure – box / structure /
 * ATR only for the live pair, from the Box-zu-Box store's 4h bars), targets (1 / 2 / 3 R and the box targets), R:R
 * before and after fees with the breakeven. "In Trade übernehmen" opens the editor pre-filled (`openEditor({ draft })`).
 *
 * Effects: results count in with `NumberCascade` (a settled change cascades again), the live price is `LiveText`
 * (smooth glide + tick flash, zero renders per tick), the R multiple flashes on change (`ValueFlash`), and a position
 * above the leverage rule or the capital shakes the result block (`useShake`) the moment it tips over.
 */
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { boxTargetsFor, liquidationPrice, positionSize, rrCalc, rTargets, stopCandidates, symbolOf, type RiskLimits, type SizingResult } from "@/domain/risk";
import { LAGE_STRUCTURE } from "@/domain/lage/compute";
import { marketStructure } from "@/domain/signals/structure";
import type { AccountId, Side } from "@/domain/types";
import { cn } from "@/lib/cn";
import { nowLocalInput } from "@/lib/dates";
import { priceMv, useProvider } from "@/market";
import { getBoxBars, useBoxes } from "@/market/boxes";
import { NumberCascade } from "@/motion/fx";
import { LiveText } from "@/motion/LiveText";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { ValueFlash } from "@/motion/ValueFlash";
import { Button } from "@/primitives/Button";
import { useShake } from "@/primitives/fieldFx";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { useUi } from "@/store/uiStore";
import type { RiskBase } from "./hooks";
import { parseInput, toInput, useRiskUi, type CalcInputs } from "./riskStore";
import { RISIKO } from "./strings";
import { Metric, RiskCard, SEG_TOUCH, money, pct, priceText, qtyText } from "./ui";

const S = RISIKO.calc;
const ACC_OPTS = [
  { v: "scalp" as const, label: "Scalp" },
  { v: "makro" as const, label: "Makro" },
];
const SIDE_OPTS = [
  { v: "long" as const, label: "Long" },
  { v: "short" as const, label: "Short" },
];
const SIDE_TONES = { long: "bg-win/15 border-win/30", short: "bg-loss/15 border-loss/30" };
const RISK_CHIPS = [0.5, 1, 2];

/** The value after it stopped changing for `tween.debounce` (typing does not cascade per key). */
function useSettled<T>(value: T): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), tween.debounce.duration * 1000);
    return () => clearTimeout(t);
  }, [value]);
  return v;
}

export interface CalcModel {
  account: AccountId;
  side: Side;
  pair: string;
  capital: number;
  riskPct: number;
  entry: number;
  stop: number;
  target: number;
  leverage: number | null;
  sizing: SizingResult;
}

/** Parsed calculator inputs with the defaults (account / capital / risk / pair) and the sizing. */
export function calcModel(calc: CalcInputs, d: { account: AccountId; capital: number; riskPct: number; pair: string }, limits: RiskLimits): CalcModel {
  const account = calc.account ?? d.account;
  const capital = calc.capital.trim() ? parseInput(calc.capital) : d.capital;
  const riskPct = (calc.riskPct.trim() ? parseInput(calc.riskPct) : d.riskPct * 100) / 100;
  const entry = parseInput(calc.entry);
  const stop = parseInput(calc.stop);
  const target = parseInput(calc.target);
  const lev = parseInput(calc.leverage);
  const leverage = Number.isFinite(lev) && lev > 0 ? lev : null;
  const sizing = positionSize({ capital, riskPct, entry, stop, side: calc.side, feePct: limits.feePct, slippagePct: limits.slippagePct, leverage, maxLeverage: limits.leverageRule[account] });
  return { account, side: calc.side, pair: calc.pair.trim() || d.pair, capital, riskPct, entry, stop, target, leverage, sizing };
}

/** The calculator's planned position (shared with the liquidation card). */
export function useCalcModel(base: RiskBase): CalcModel {
  const calc = useRiskUi((s) => s.calc);
  const provider = useProvider();
  const account: AccountId = base.acc === "all" ? "scalp" : base.acc;
  const acc = calc.account ?? account;
  const live = provider?.symbolInfo.binance ?? null;
  // the journal's own spelling ("BTC/USDT") when it is the live symbol, else the live symbol / the journal pair
  const pair = live && symbolOf(base.settings.pair) !== live ? live : base.settings.pair;
  return useMemo(() => calcModel(calc, { account, capital: base.settings.capital[acc] ?? 0, riskPct: base.limits.riskPerTradePct, pair }, base.limits), [calc, account, acc, base.settings.capital, base.limits, pair]);
}

function Chip({ active, onClick, children, sub, testId }: { active: boolean; onClick: () => void; children: ReactNode; sub?: string; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      className={cn(
        "touch-hit inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-[background-color,border-color,color] duration-200",
        active ? "border-white/40 bg-white/[0.09] text-fg" : "border-line-2 text-mute hover:border-white/25 hover:text-fg",
      )}
    >
      <span>{children}</span>
      {sub && <span className="num font-mono text-[10.5px] text-faint">{sub}</span>}
    </button>
  );
}

const near = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-6);

export function CalculatorCard({ base }: { base: RiskBase }) {
  const reduced = useReducedFx();
  const calc = useRiskUi((s) => s.calc);
  const fillSeq = useRiskUi((s) => s.fillSeq);
  const setCalc = useRiskUi((s) => s.setCalc);
  const resetCalc = useRiskUi((s) => s.resetCalc);
  const openEditor = useUi((s) => s.openEditor);
  const provider = useProvider();
  const m = useCalcModel(base);
  const liveSym = provider?.symbolInfo.binance ?? null;
  const isLive = !!liveSym && symbolOf(m.pair) === liveSym;
  const boxes = useBoxes({ enabled: isLive });
  const box4h = isLive ? (boxes.tfs["4h"]?.analysis?.box ?? null) : null;
  const boxKey = isLive ? (boxes.tfs["4h"]?.key ?? "") : "";
  const structure = useMemo(() => {
    if (!boxKey) return null;
    const bars = getBoxBars("4h");
    return bars.length >= 120 ? marketStructure(bars.slice(-500), LAGE_STRUCTURE) : null;
  }, [boxKey]);
  const atrV = box4h?.atr && box4h.atr > 0 ? box4h.atr : (structure?.atr ?? null);
  const { limits } = base;
  const cur = base.cur;
  const s = m.sizing;

  const stops = useMemo(
    () => (Number.isFinite(m.entry) && m.entry > 0 ? stopCandidates({ entry: m.entry, side: m.side, pct: 0.02, atr: atrV, atrMult: limits.atrMult, box: box4h, structure }) : []),
    [m.entry, m.side, atrV, limits.atrMult, box4h, structure],
  );
  const targets = useMemo(() => {
    if (!s.ok) return [];
    const r = rTargets(m.entry, m.stop);
    const b = boxTargetsFor(m.side, m.entry, m.stop, box4h ? (m.side === "long" ? box4h.up : box4h.down) : null);
    return [...r, ...b];
  }, [s.ok, m.entry, m.stop, m.side, box4h]);
  const rr = s.ok && Number.isFinite(m.target) ? rrCalc({ entry: m.entry, stop: m.stop, target: m.target, side: m.side, feePct: limits.feePct, slippagePct: limits.slippagePct }) : null;
  const liq = s.ok ? liquidationPrice({ side: m.side, entry: m.entry, qty: s.qty, leverage: s.leverage, mode: "isolated", tiers: limits.tiers, atr: atrV }) : null;

  // results settle before they cascade; a programmatic fill (chip, live) cascades again
  const settled = useSettled(s.ok ? { qty: s.qty, notional: s.notional, risk: s.riskAmount, margin: s.margin, lev: s.neededLeverage } : null);
  const tooBig = s.ok && (s.overRule || s.marginOver);
  const { ref: shakeRef, shake } = useShake<HTMLDivElement>();
  const wasBig = useRef(false);
  useEffect(() => {
    if (tooBig && !wasBig.current) shake();
    wasBig.current = !!tooBig;
  }, [tooBig, shake]);

  const set = (patch: Partial<CalcInputs>, programmatic = false) => setCalc(patch, programmatic);
  const takeLive = () => {
    const p = priceMv.get();
    if (p > 0) set({ entry: toInput(p), pair: m.pair }, true);
  };
  const error = !s.ok && (calc.entry.trim() || calc.stop.trim()) ? S.errors[s.error] : null;

  const adopt = () => {
    if (!s.ok) return;
    const target = rr ? m.target : null;
    openEditor({
      draft: {
        account: m.account,
        side: m.side,
        status: "open",
        date: nowLocalInput(),
        pair: m.pair,
        entry: m.entry,
        stop: m.stop,
        target,
        size: Math.round(s.notional * 100) / 100,
        qty: Number(s.qty.toPrecision(8)),
        leverage: s.leverage,
        marginMode: "isolated",
        margin: Math.round(s.margin * 100) / 100,
        ...(liq?.price != null ? { liqPrice: Number(liq.price.toPrecision(8)) } : {}),
      },
    });
  };

  const fieldIds = { pair: "rk-pair", capital: "rk-capital", risk: "rk-risk", entry: "rk-entry", stop: "rk-stop", target: "rk-target", lev: "rk-lev" };
  return (
    <RiskCard
      title={S.title}
      note={S.note}
      data-testid="risk-calc"
      action={
        <Button size="sm" variant="ghost" onClick={resetCalc}>
          {S.reset}
        </Button>
      }
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<AccountId> aria-label={S.account} options={ACC_OPTS} value={m.account} onChange={(account) => set({ account, capital: "" })} size="sm" className={SEG_TOUCH} />
          <Segmented<Side> aria-label={S.side} options={SIDE_OPTS} value={m.side} onChange={(side) => set({ side })} tones={SIDE_TONES} size="sm" className={SEG_TOUCH} />
          {isLive && (
            <span className="ml-auto flex items-center gap-2 rounded-full border border-line-2 px-2.5 py-1 text-[11px] text-mute" data-testid="risk-live-price">
              <span className="size-1.5 rounded-full bg-win" aria-hidden="true" />
              {liveSym}
              <LiveText source={priceMv} smooth flash format={priceText} className="font-mono text-fg" aria-label={`Live-Preis ${liveSym}`} />
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={S.pair} htmlFor={fieldIds.pair}>
            <Input id={fieldIds.pair} value={calc.pair} placeholder={m.pair} onChange={(e) => set({ pair: e.target.value })} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label={S.capital} htmlFor={fieldIds.capital} suffix={cur}>
            <Input id={fieldIds.capital} numeric value={calc.capital} placeholder={toInput(base.settings.capital[m.account] ?? 0, 0)} onChange={(e) => set({ capital: e.target.value })} />
          </Field>
          <Field label={S.risk} htmlFor={fieldIds.risk} suffix="%">
            <Input id={fieldIds.risk} numeric value={calc.riskPct} placeholder={toInput(limits.riskPerTradePct * 100, 2)} onChange={(e) => set({ riskPct: e.target.value })} />
          </Field>
          <Field label={S.leverage} htmlFor={fieldIds.lev} suffix="×">
            <Input id={fieldIds.lev} numeric value={calc.leverage} placeholder="auto" onChange={(e) => set({ leverage: e.target.value })} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Risiko schnell wählen">
          {RISK_CHIPS.map((r) => (
            <Chip key={r} active={near(m.riskPct * 100, r)} onClick={() => set({ riskPct: toInput(r, 2) }, true)} testId={`risk-chip-${r}`}>
              {String(r).replace(".", ",")} %
            </Chip>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label={S.entry} htmlFor={fieldIds.entry}>
            <div className="flex gap-1.5">
              <Input id={fieldIds.entry} numeric value={calc.entry} onChange={(e) => set({ entry: e.target.value })} wrapperClassName="min-w-0 flex-1" />
              {isLive && (
                <Button size="sm" variant="ghost" onClick={takeLive} title={S.liveTitle} aria-label={S.liveTitle} className="shrink-0 !px-2.5">
                  {S.live}
                </Button>
              )}
            </div>
          </Field>
          <Field label={S.stop} htmlFor={fieldIds.stop} error={error ?? undefined}>
            <Input id={fieldIds.stop} numeric value={calc.stop} invalid={!!error} onChange={(e) => set({ stop: e.target.value })} aria-describedby={error ? `${fieldIds.stop}-error` : undefined} />
          </Field>
          <Field label={S.target} htmlFor={fieldIds.target} className="col-span-2 sm:col-span-1">
            <Input id={fieldIds.target} numeric value={calc.target} onChange={(e) => set({ target: e.target.value })} />
          </Field>
        </div>

        {stops.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="risk-stop-chips">
            <span className="label mr-1 !text-[9.5px]">{S.stopChips}</span>
            {stops.map((c) => (
              <Chip key={c.kind} active={near(m.stop, c.price)} onClick={() => set({ stop: toInput(c.price) }, true)} sub={c.distAtr != null ? `${pct(c.distPct)} · ${c.distAtr.toFixed(1).replace(".", ",")} ATR` : pct(c.distPct)} testId={`stop-${c.kind}`}>
                {c.label}
              </Chip>
            ))}
            {!isLive && <span className="text-[10.5px] text-faint">{S.noBox}</span>}
          </div>
        )}
        {targets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="risk-target-chips">
            <span className="label mr-1 !text-[9.5px]">{S.targetChips}</span>
            {targets.map((t) => (
              <Chip key={`${t.kind}:${t.label}:${t.price}`} active={near(m.target, t.price)} onClick={() => set({ target: toInput(t.price) }, true)} sub={`${t.r.toFixed(1).replace(".", ",")} R`} testId={`target-${t.kind}`}>
                {t.kind === "r" ? t.label : `Box ${priceText(t.price)}`}
              </Chip>
            ))}
          </div>
        )}

        <div ref={shakeRef} className={cn("relative rounded-2xl border p-3.5 transition-colors duration-300", tooBig ? "border-loss/40 bg-loss/[0.05]" : "border-line bg-ink-950/40")} data-testid="risk-calc-result" data-ok={s.ok ? "1" : "0"}>
          {s.ok && settled ? (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Metric label={S.qty}>
                  <NumberCascade value={settled.qty} play={fillSeq} format={qtyText} />
                </Metric>
                <Metric label={S.notional} sub={cur}>
                  <NumberCascade value={settled.notional} play={fillSeq} format={(v) => priceText(v)} />
                </Metric>
                <Metric label={S.riskAmount} sub={pct(m.riskPct, 2)} tone="text-loss">
                  <NumberCascade value={settled.risk} play={fillSeq} format={(v) => money(-v, cur)} />
                </Metric>
                <Metric label={S.margin} sub={`bei ${s.leverage}×`}>
                  <NumberCascade value={settled.margin} play={fillSeq} format={(v) => money(v, cur)} />
                </Metric>
                <Metric label={S.needed} tone={s.overRule ? "text-loss" : undefined} sub={`Regel ${limits.leverageRule[m.account]}×`}>
                  <NumberCascade value={settled.lev} play={fillSeq} format={(v) => `${v.toFixed(2).replace(".", ",")}×`} />
                </Metric>
              </div>
              <AnimatePresence initial={false}>
                {tooBig && (
                  <motion.p
                    key="big"
                    role="alert"
                    className="text-[12px] text-danger-text"
                    initial={reduced ? false : { opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
                    exit={{ opacity: 0, transition: tween.exit }}
                    transition={spring.enter}
                    data-testid="risk-calc-toobig"
                  >
                    {s.overRule && s.capped ? S.overRule(limits.leverageRule[m.account], `${money(s.capped.notional, cur)} (Risiko ${pct(s.capped.riskPct, 2)})`) : S.marginOver}
                  </motion.p>
                )}
              </AnimatePresence>
              <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-line pt-3">
                <div className="grid gap-1" data-testid="risk-rr">
                  <span className="label !text-[10px]">{S.rr}</span>
                  <ValueFlash value={rr?.rr ?? null}>
                    <span className={cn("dot-num text-[30px] leading-none", rr ? (rr.rrNet >= 2 ? "text-win" : rr.rrNet >= 1 ? "text-fg" : "text-loss") : "text-faint")}>{rr ? `1:${rr.rr.toFixed(1).replace(".", ",")}` : "–"}</span>
                  </ValueFlash>
                  <span className="num font-mono text-[11px] text-mute">{rr ? `${S.rrNet} 1:${rr.rrNet.toFixed(2).replace(".", ",")}` : "Ziel eintragen"}</span>
                </div>
                <Metric label={S.breakeven} sub={rr ? `${S.beWin} ${pct(rr.beWinRate, 0)}` : undefined}>
                  {rr ? priceText(rr.breakeven) : "–"}
                </Metric>
                <Metric label="Liquidation" sub={RISIKO.liq.approx} tone={liq?.price != null && (m.side === "long" ? liq.price >= m.stop : liq.price <= m.stop) ? "text-loss" : undefined}>
                  {liq?.price != null ? `${priceText(liq.price)} · ${pct(liq.distPct)}` : RISIKO.liq.none}
                </Metric>
                <Button variant="primary" className="ml-auto" onClick={adopt} data-testid="risk-adopt">
                  {S.adopt}
                </Button>
              </div>
            </div>
          ) : (
            <motion.p className="py-2 text-[12.5px] text-mute" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...tween.fade, delay: reduced ? 0 : stagger.lead }}>
              {S.empty}
            </motion.p>
          )}
        </div>
      </div>
    </RiskCard>
  );
}
