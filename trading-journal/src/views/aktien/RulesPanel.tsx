/**
 * "Regeln und Schwellen": the rules of the chosen setups in words, with every threshold as an input next to them. The
 * sentence is built from the numbers that are set (`describeRule`), so it is always the rule the scan will use. Changes are
 * kept per market and mode on this device; "Auf Standard zurücksetzen" brings the defaults back.
 */
import { useId } from "react";
import { describePrefilter, describeRule, defaultParamsFor, type MarketKind, type ScanMode, type ScanParams, type SetupId } from "@/domain/scanner";
import { Button } from "@/primitives/Button";
import { Segmented } from "@/primitives/Segmented";
import { SEG_TOUCH } from "@/views/insights/ui";
import { AKTIEN } from "./strings";
import { CheckChip, Mini, NumField } from "./ui";

interface Props {
  market: MarketKind;
  mode: ScanMode;
  setups: readonly SetupId[];
  params: ScanParams;
  interval: string;
  onChange: (p: ScanParams) => void;
  onReset: () => void;
  disabled?: boolean;
}

const OR_OPTIONS = [5, 10, 15, 30, 60, 90].map((v) => ({ v: String(v), label: `${v} Min.` }));

export function RulesPanel({ market, mode, setups, params, interval, onChange, onReset, disabled }: Props) {
  const uid = useId();
  const id = (k: string): string => `${uid}-${k}`;
  const orb = params.orb;
  const flag = params.flag;
  const rsi = params.rsi;
  const pre = params.pre;
  const set = <K extends keyof ScanParams>(k: K, patch: Partial<ScanParams[K]>): void => onChange({ ...params, [k]: { ...params[k], ...patch } });
  const intraday = mode === "orb";
  const orbOptions = OR_OPTIONS.some((o) => o.v === String(orb.orMinutes)) ? OR_OPTIONS : [...OR_OPTIONS, { v: String(orb.orMinutes), label: `${orb.orMinutes} Min.` }].sort((a, b) => Number(a.v) - Number(b.v));
  const defaults = defaultParamsFor(market, mode);
  const changed = JSON.stringify(params) !== JSON.stringify(defaults);

  return (
    <div className="grid gap-4" data-testid="aktien-rules">
      {setups.includes("orb") && (
        <fieldset className="grid gap-3 rounded-xl border border-line p-3" data-testid="aktien-rule-orb" disabled={disabled}>
          <legend className="px-1">
            <Mini>Eröffnungsspanne</Mini>
          </legend>
          <p className="max-w-[78ch] text-[12.5px] leading-relaxed text-mute">{describeRule("orb", params, market, interval)}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid content-start gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">Länge der Spanne</span>
              <Segmented aria-label="Länge der Eröffnungsspanne" size="sm" options={orbOptions} value={String(orb.orMinutes)} onChange={(v) => set("orb", { orMinutes: Number(v) })} className={SEG_TOUCH} />
            </div>
            <div className="grid content-start gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">Richtung</span>
              <Segmented
                aria-label="Richtung des Ausbruchs"
                size="sm"
                options={[
                  { v: "long", label: "Long" },
                  { v: "short", label: "Short" },
                  { v: "both", label: "Beide" },
                ]}
                value={orb.sides}
                onChange={(v) => set("orb", { sides: v })}
                className={SEG_TOUCH}
              />
            </div>
            <NumField id={id("brk")} label="Mindestabstand" suffix="%" scale={100} digits={2} value={orb.minBreak} onCommit={(v) => set("orb", { minBreak: v })} help="0 = jeder Schluss jenseits der Spanne" />
            <NumField id={id("rel")} label="Mindest-Volumen" suffix="×" digits={1} value={orb.minRelVolume} onCommit={(v) => set("orb", { minRelVolume: v })} help="der Ausbruchskerze im Vergleich zu den Spannen-Kerzen, 0 = aus" />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <NumField id={id("late")} label="Späteste Zeit" suffix="Min. nach Eröffnung" digits={0} value={orb.latestMinutes ?? 0} disabled={orb.latestMinutes == null} onCommit={(v) => set("orb", { latestMinutes: v })} />
            <CheckChip checked={orb.latestMinutes == null} onChange={(on) => set("orb", { latestMinutes: on ? null : market === "stock" ? 360 : 720 })}>
              bis zum Ende der Sitzung
            </CheckChip>
            <CheckChip checked={orb.stillBeyond} onChange={(on) => set("orb", { stillBeyond: on })}>
              letzte Kerze noch jenseits
            </CheckChip>
          </div>
        </fieldset>
      )}
      {setups.includes("flag") && (
        <fieldset className="grid gap-3 rounded-xl border border-line p-3" data-testid="aktien-rule-flag" disabled={disabled}>
          <legend className="px-1">
            <Mini>Flagge</Mini>
          </legend>
          <p className="max-w-[78ch] text-[12.5px] leading-relaxed text-mute">{describeRule("flag", params, market, interval)}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <NumField id={id("pole")} label="Anstieg über" suffix="Kerzen" value={flag.poleBars} onCommit={(v) => set("flag", { poleBars: v })} />
            <NumField id={id("gain")} label="mehr als" suffix="%" scale={100} digits={1} value={flag.poleMinGain} onCommit={(v) => set("flag", { poleMinGain: v })} />
            <NumField id={id("fbars")} label="Fahne aus" suffix="Schlusskursen" value={flag.flagBars} onCommit={(v) => set("flag", { flagBars: v })} />
            <NumField id={id("frange")} label="Spanne unter" suffix="%" scale={100} digits={1} value={flag.flagMaxRange} onCommit={(v) => set("flag", { flagMaxRange: v })} />
          </div>
        </fieldset>
      )}
      {setups.includes("rsi") && (
        <fieldset className="grid gap-3 rounded-xl border border-line p-3" data-testid="aktien-rule-rsi" disabled={disabled}>
          <legend className="px-1">
            <Mini>RSI-Erholung</Mini>
          </legend>
          <p className="max-w-[78ch] text-[12.5px] leading-relaxed text-mute">{describeRule("rsi", params, market, interval)}</p>
          <div className="flex flex-wrap items-end gap-3">
            <NumField id={id("rlen")} label="RSI-Länge" value={rsi.length} onCommit={(v) => set("rsi", { length: v })} />
            <NumField id={id("rlvl")} label="überverkauft unter" value={rsi.level} onCommit={(v) => set("rsi", { level: v })} />
            <CheckChip checked={rsi.requireBounce} onChange={(on) => set("rsi", { requireBounce: on })}>
              mit Aufwärtskerze (Erholung)
            </CheckChip>
          </div>
        </fieldset>
      )}
      <fieldset className="grid gap-3 rounded-xl border border-line p-3" data-testid="aktien-rule-pre" disabled={disabled}>
        <legend className="px-1">
          <Mini>Vorfilter</Mini>
        </legend>
        <p className="max-w-[78ch] text-[12.5px] leading-relaxed text-mute">{describePrefilter(params, market, intraday)}</p>
        <div className="flex flex-wrap items-end gap-3">
          <NumField id={id("pmin")} label="Mindest-Schlusskurs" digits={2} suffix={market === "stock" ? "$" : "USDT"} value={pre.minPrice} onCommit={(v) => set("pre", { minPrice: v })} help="0 = aus" />
          <NumField id={id("vmin")} label={intraday ? "Mindest-Volumen der Sitzung" : "Mindest-Volumen der Tageskerze"} value={pre.minVolume} onCommit={(v) => set("pre", { minVolume: v })} help="0 = aus" />
          {market === "stock" && (
            <CheckChip checked={pre.normalStatusOnly} onChange={(on) => set("pre", { normalStatusOnly: on })}>
              nur normaler Nasdaq-Finanzstatus
            </CheckChip>
          )}
        </div>
      </fieldset>
      <div>
        <Button size="sm" variant="ghost" onClick={onReset} disabled={disabled || !changed} data-testid="aktien-rules-reset">
          {AKTIEN.scanner.reset}
        </Button>
      </div>
    </div>
  );
}
