/**
 * Versuchsaufbau (P07): strategy tiles ("Eigene Idee" first and widest, then the templates Box-zu-Box · MCB-Leiter ·
 * Regel-Baukasten), market, period, the strategy's own choices (the rule builder of the custom idea / timeframe / check
 * interval / the template's rule builder), its parameters as chips, the cost model (exchange fees, slippage, funding),
 * capital / risk / leverage and the start button with an honest estimate of the Binance pages.
 * Everything writes the per-viewer set-up (`useLabor().setCfg`) at once.
 */
import { AnimatePresence, motion } from "motion/react";
import { useId, useMemo, useState, type CSSProperties } from "react";
import { validateCustom } from "@/domain/lab";
import { condText, FEE_PRESETS, RULE_DEFAULTS, RULE_LABEL, sanitizeCond, strategyCfg, strategyOf, type LabStrategyId, type RuleCond, type RuleKind, type SlippageModel } from "@/domain/backtest/index";
import { boxesCfgOf, normalizeWatchSymbol } from "@/domain/boxes";
import type { SignalCfg } from "@/domain/signals";
import { cn } from "@/lib/cn";
import { Autocomplete } from "@/motion/pulse/Autocomplete";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Collapse, Expander } from "@/primitives/Expander";
import { Icon } from "@/primitives/icons";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { cancelLab, pagesEstimate, planOf, startLab, useLabor, type LabConfig } from "./laborStore";
import { RuleBuilder } from "./RuleBuilder";
import { LABOR, type LaborPeriod } from "./strings";
import { ChipPick, FieldRow, SEG_TOUCH } from "./ui";

/** "Eigene Idee" is the first and widest choice; the three templates stay as ready-made starting points. */
const STRATS: readonly LabStrategyId[] = ["custom", "box", "mcb", "rules"];
const PERIODS = (Object.keys(LABOR.periods) as LaborPeriod[]).map((v) => ({ v, label: LABOR.periods[v] }));
const SLIPS: readonly { v: string; label: string; model: SlippageModel }[] = [
  { v: "fixed", label: "Fix 2 bp", model: { kind: "fixed", bps: 2 } },
  { v: "spread", label: "Spread 4 bp", model: { kind: "spread", bps: 4 } },
  { v: "atr", label: "5 % ATR", model: { kind: "atr", frac: 0.05 } },
  { v: "none", label: "Keine", model: { kind: "none" } },
];
const RULE_KINDS = Object.keys(RULE_LABEL) as RuleKind[];

export function ConfigCard({ signal, className }: { signal: SignalCfg; className?: string }) {
  const cfg = useLabor((s) => s.cfg);
  const status = useLabor((s) => s.status);
  const setCfg = useLabor((s) => s.setCfg);
  const setParam = useLabor((s) => s.setParam);
  const boxesRaw = useJournal((s) => (s.settings as unknown as { boxes?: unknown }).boxes);
  const watch = useMemo(() => boxesCfgOf(boxesRaw).watchlist, [boxesRaw]);
  const busy = status === "loading" || status === "running";
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [symDraft, setSymDraft] = useState<string | null>(null);
  const [costsOpen, setCostsOpen] = useState(false);
  const symValid = symDraft == null || normalizeWatchSymbol(symDraft) != null;
  const plan = useMemo(() => planOf(cfg, signal), [cfg, signal]);
  const specs = useMemo(() => strategyOf(cfg.strategy).specs(strategyCfg(plan.input)), [cfg.strategy, plan.input]);
  const pages = useMemo(() => pagesEstimate(cfg, signal), [cfg, signal]);
  const reduced = useReducedFx();
  const ideaErrors = useMemo(() => (cfg.strategy === "custom" ? validateCustom(cfg.custom, { funding: cfg.funding === "history" }).filter((i) => i.level === "error").length : 0), [cfg.strategy, cfg.custom, cfg.funding]);

  const commitSymbol = (raw: string) => {
    const s = normalizeWatchSymbol(raw);
    if (s) {
      setCfg({ symbol: s });
      setSymDraft(null);
    }
  };

  return (
    <Card title={LABOR.configTitle} className={className} data-testid="labor-config">
      <div className="grid gap-5">
        {/* strategy tiles */}
        <div role="radiogroup" aria-label="Strategie" className="grid gap-2 sm:grid-cols-3">
          {STRATS.map((id) => {
            const on = cfg.strategy === id;
            const t = LABOR.strategies[id];
            const hero = id === "custom";
            return (
              <motion.button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                data-testid={`labor-strategy-${id}`}
                disabled={busy}
                onClick={() => setCfg({ strategy: id })}
                whileTap={reduced ? undefined : { scale: 0.98 }}
                transition={spring.press}
                className={cn("relative isolate grid min-h-[76px] content-start gap-1 overflow-hidden rounded-2xl border px-3.5 py-3 text-left outline-none transition-colors duration-200 disabled:opacity-60", hero && "sm:col-span-3 sm:min-h-[84px]", on ? "border-white/40 bg-white/[0.04]" : "border-line hover:border-white/20 focus-visible:border-white/40")}
                style={{ borderRadius: radius.card }}
              >
                {on && <motion.span layoutId={`labor-strat-${uid}`} aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(120%_120%_at_0%_0%,rgb(var(--veil-rgb,255_255_255)/0.09),transparent_60%)]" style={{ borderRadius: radius.card }} transition={reduced ? { duration: 0 } : spring.layout} />}
                <span className={cn("flex items-center gap-2 font-semibold", hero ? "text-[15.5px]" : "text-[14px]")}>
                  <span className={cn("size-1.5 rounded-full transition-colors", on ? "bg-signal" : "bg-line-2")} aria-hidden="true" />
                  {t.title}
                </span>
                <span className="text-[12px] leading-snug text-mute">{t.sub}</span>
              </motion.button>
            );
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label={LABOR.symbol} htmlFor={`labor-sym-${uid}`} hint={!symValid ? <span className="text-(--color-danger-text)">{LABOR.symbolInvalid}</span> : LABOR.symbolHint}>
            <Autocomplete
              id={`labor-sym-${uid}`}
              value={symDraft ?? cfg.symbol}
              onChange={(v) => setSymDraft(v.toUpperCase())}
              onSelect={(item) => commitSymbol(item.value)}
              onBlur={() => symDraft != null && commitSymbol(symDraft)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && symDraft != null) commitSymbol(symDraft);
              }}
              suggestions={watch}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              inputClassName="font-mono uppercase"
            />
          </FieldRow>
          <FieldRow label={LABOR.period}>
            <ChipPick id={`period-${uid}`} label={LABOR.period} value={cfg.period} options={PERIODS} onChange={(period) => setCfg({ period })} />
          </FieldRow>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={cfg.strategy}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
            exit={{ opacity: 0, transition: tween.exit }}
            transition={{ opacity: tween.fade, y: spring.enter }}
            className="grid gap-4"
          >
            {cfg.strategy === "box" && (
              <FieldRow label={LABOR.tf}>
                <ChipPick id={`boxtf-${uid}`} label={LABOR.tf} value={cfg.boxTf} options={[{ v: "4h", label: "4h · HTF 1D" }, { v: "1d", label: "1D · HTF 1W" }]} onChange={(boxTf) => setCfg({ boxTf })} />
              </FieldRow>
            )}
            {cfg.strategy === "mcb" && (
              <FieldRow label={LABOR.checkEvery} hint={`Leiter ${signal.ladder.join(" → ")} · Zone ${signal.zoneTf}. Aus deinem Einstiegs-Check.`}>
                <ChipPick id={`mcbstep-${uid}`} label={LABOR.checkEvery} value={cfg.mcbStep} options={[{ v: "4h", label: "Alle 4h" }, { v: "1h", label: "Jede Stunde (gründlicher)" }]} onChange={(mcbStep) => setCfg({ mcbStep })} />
              </FieldRow>
            )}
            {cfg.strategy === "rules" && <RulesEditor cfg={cfg} uid={uid} />}
            {cfg.strategy === "custom" && <RuleBuilder uid={uid} />}
            {cfg.strategy === "custom" && <p className="text-[11.5px] leading-snug text-faint">Die Robustheitsprüfung testet deinen Stop und dein Ziel plus je zwei Nachbarwerte (Out-of-Sample, Walk-forward, Heatmap).</p>}

            <div className="grid gap-3 sm:grid-cols-2">
              {(cfg.strategy === "custom" ? [] : specs).map((s) => (
                <FieldRow key={s.key} label={s.label}>
                  <ChipPick
                    id={`p-${s.key}-${uid}`}
                    label={s.label}
                    value={(cfg.params[cfg.strategy]?.[s.key] ?? plan.input.params[s.key] ?? s.options[0]) as string | number}
                    options={s.options.map((v) => ({ v, label: s.format(v) }))}
                    onChange={(v) => setParam(cfg.strategy, s.key, v)}
                  />
                </FieldRow>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="rounded-2xl border border-line bg-ink-950/40">
          <div className="flex min-h-11 items-center justify-between gap-3 pl-4 pr-2">
            <span className="min-w-0 text-[12.5px] font-medium text-fg/90">
              {LABOR.costs} · <span className="text-mute">{FEE_PRESETS.find((p) => p.exchange === cfg.exchange)?.label} · {SLIPS.find((s) => s.v === cfg.slippage.kind)?.label} · {LABOR.fundingModes[cfg.funding]}</span>
            </span>
            <Expander open={costsOpen} onToggle={() => setCostsOpen((o) => !o)} label={LABOR.costs} controls={`labor-costs-${uid}`} className="touch-hit" />
          </div>
          <Collapse open={costsOpen} id={`labor-costs-${uid}`}>
            <div className="grid gap-4 px-4 pb-4 pt-1 sm:grid-cols-2">
              <FieldRow label={LABOR.exchange} hint="Basis-Stufe ohne Rabatte (Maker / Taker).">
                <ChipPick id={`fee-${uid}`} label={LABOR.exchange} value={cfg.exchange} options={FEE_PRESETS.map((p) => ({ v: p.exchange, label: `${p.label} ${String(p.makerBps).replace(".", ",")}/${String(p.takerBps).replace(".", ",")} bp` }))} onChange={(exchange) => setCfg({ exchange })} />
              </FieldRow>
              <FieldRow label={LABOR.slippage} hint="Gegen dich bei jedem Market- und Stop-Fill.">
                <ChipPick id={`slip-${uid}`} label={LABOR.slippage} value={cfg.slippage.kind} options={SLIPS.map((s) => ({ v: s.v, label: s.label }))} onChange={(v) => setCfg({ slippage: SLIPS.find((s) => s.v === v)!.model })} />
              </FieldRow>
              <FieldRow label={LABOR.funding} hint="Alle 8 h auf das Notional. Long zahlt positive Sätze.">
                <ChipPick id={`fund-${uid}`} label={LABOR.funding} value={cfg.funding} options={(["history", "flat", "none"] as const).map((v) => ({ v, label: LABOR.fundingModes[v] }))} onChange={(funding) => setCfg({ funding })} />
              </FieldRow>
              <div className="grid grid-cols-3 gap-2">
                <NumField label={LABOR.capital} value={cfg.capital} onCommit={(capital) => setCfg({ capital })} suffix="USDT" />
                <NumField label={LABOR.risk} value={cfg.riskPct} onCommit={(riskPct) => setCfg({ riskPct })} suffix="%" />
                <NumField label={LABOR.leverage} value={cfg.maxLeverage} onCommit={(maxLeverage) => setCfg({ maxLeverage })} suffix="×" />
              </div>
            </div>
          </Collapse>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] text-faint" data-testid="labor-estimate">
            {cfg.symbol} · {LABOR.estimate(pages, false)}
          </p>
          {busy ? (
            <Button onClick={cancelLab} data-testid="labor-cancel">
              {LABOR.cancel}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void startLab(signal)} disabled={!symValid || (cfg.strategy === "rules" && !cfg.rules.conds.length) || ideaErrors > 0} aria-describedby={ideaErrors > 0 ? `${uid}-check` : undefined} data-testid="labor-start">
              {status === "done" ? LABOR.again : LABOR.start}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function NumField({ label, value, onCommit, suffix }: { label: string; value: number; onCommit: (v: number) => void; suffix: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();
  const commit = () => {
    if (draft == null) return;
    const v = Number(draft.replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(v) && v > 0) onCommit(v);
    setDraft(null);
  };
  return (
    <FieldRow label={label} htmlFor={id}>
      <span className="relative grid">
        <Input
          id={id}
          numeric
          value={draft ?? String(value).replace(".", ",")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="pr-9 text-[13px]"
        />
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-[11px] text-faint">
          {suffix}
        </span>
      </span>
    </FieldRow>
  );
}

/** The rule builder: side, interval and up to 6 AND-conditions. */
function RulesEditor({ cfg, uid }: { cfg: LabConfig; uid: string }) {
  const setCfg = useLabor((s) => s.setCfg);
  const reduced = useReducedFx();
  const rules = cfg.rules;
  const set = (conds: RuleCond[]) => setCfg({ rules: { ...rules, conds } });
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <FieldRow label={LABOR.side}>
          <Segmented size="sm" aria-label={LABOR.side} className={SEG_TOUCH} value={rules.side} onChange={(side) => setCfg({ rules: { ...rules, side } })} options={[{ v: "long", label: "Long" }, { v: "short", label: "Short" }]} tones={{ long: "bg-win/15 border-win/30", short: "bg-loss/15 border-loss/30" }} />
        </FieldRow>
        <FieldRow label={LABOR.tf}>
          <ChipPick id={`rtf-${uid}`} label={LABOR.tf} value={rules.interval} options={[{ v: "1h", label: "1h" }, { v: "4h", label: "4h" }, { v: "1d", label: "1D" }]} onChange={(interval) => setCfg({ rules: { ...rules, interval } })} />
        </FieldRow>
      </div>
      <FieldRow label={LABOR.conds}>
        <ul className="grid gap-2" aria-label={LABOR.conds}>
          <AnimatePresence initial={false}>
            {rules.conds.map((c, i) => (
              <motion.li
                key={`${i}-${c.kind}`}
                layout
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, transition: tween.exit }}
                transition={{ ...spring.enter, layout: spring.layout }}
                style={{ borderRadius: radius.input } as CSSProperties}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-ink-950/50 p-2"
              >
                <MorphSelect<RuleKind> size="sm" aria-label={`Bedingung ${i + 1}`} value={c.kind} onChange={(kind) => set(rules.conds.map((x, k) => (k === i ? { ...RULE_DEFAULTS[kind] } : x)))} options={RULE_KINDS.map((k) => ({ value: k, label: RULE_LABEL[k] }))} className="min-w-[13rem]" />
                <CondNumber value={c.a} label={c.kind.startsWith("rsi") ? "Wert" : c.kind.startsWith("ema") ? "EMA schnell" : c.kind.endsWith("Ema") ? "EMA" : "Kerzen"} onCommit={(a) => set(rules.conds.map((x, k) => (k === i ? sanitizeCond({ ...x, a }) : x)))} />
                {(c.kind === "emaCrossUp" || c.kind === "emaCrossDown") && <CondNumber value={c.b ?? 55} label="EMA langsam" onCommit={(b) => set(rules.conds.map((x, k) => (k === i ? sanitizeCond({ ...x, b }) : x)))} />}
                <span className="min-w-0 flex-1 text-[11.5px] text-faint">{condText(sanitizeCond(c))}</span>
                <button type="button" aria-label={`${LABOR.removeCond} ${i + 1}`} onClick={() => set(rules.conds.filter((_, k) => k !== i))} className="touch-hit grid size-9 place-items-center rounded-lg border border-line-2 text-mute hover:text-loss pointer-coarse:size-11 [&>svg]:size-3.5">
                  <Icon name="x" />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        {!rules.conds.length && <p className="text-[12px] text-(--color-danger-text)">{LABOR.noConds}</p>}
        {rules.conds.length < 6 && (
          <Button size="sm" className="justify-self-start" onClick={() => set([...rules.conds, { ...RULE_DEFAULTS.closeAboveEma }])}>
            {LABOR.addCond}
          </Button>
        )}
      </FieldRow>
    </div>
  );
}

function CondNumber({ value, label, onCommit }: { value: number; label: string; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const v = Number(draft.replace(",", "."));
    if (Number.isFinite(v)) onCommit(v);
    setDraft(null);
  };
  return (
    <Input aria-label={label} numeric value={draft ?? String(value).replace(".", ",")} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} wrapperClassName="w-20" className="text-[13px]" />
  );
}
