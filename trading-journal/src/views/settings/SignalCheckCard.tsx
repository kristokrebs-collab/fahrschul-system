import { motion } from "motion/react";
import { memo, useState, type ReactNode } from "react";
import { roleText, SIGNAL_TFS, STRENGTH_LABEL, STRONG_CLOSES_MAX, TRADERS_SIDE_TITLE, WHALE_RETAIL_PERIODS, WHALE_WEIGHTS } from "@/domain/signals";
import { IS_SHARE } from "@/edition";
import { cn } from "@/lib/cn";
import { parseNumber } from "@/lib/parse";
import { requestSignalNotifyPermission, signalNotifyPermission, type NotifyPermission } from "@/market";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Switch } from "@/motion/Switch";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Field } from "@/primitives/Field";
import { Segmented } from "@/primitives/Segmented";
import { defaultSignalDraft, parseLadder, type DraftKey, type DraftTextKey, type SettingsDraft } from "./draft";
import { DraftField } from "./fields";
import { ChangedDot } from "./fx";
import { PARTS_DRAFT_KEYS } from "./signalPartsDraft";

export const SIGNAL_STRINGS = {
  title: "Einstiegs-Check",
  note: "Automatischer Multi-Timeframe-Check aus Binance-Kerzen. Gespeichert mit „Speichern“.",
  intro: `Timeframe-Leiter von klein nach groß (ab 30m). Die ersten Stufen sind Pflicht, jede weitere macht den Einstieg stärker. ${
    IS_SHARE ? "Standardwerte: MCB close 9/21/2, RSI 14" : "Die Standardwerte sind auf deinen Chart (MCB close 9/21/2, RSI 14) abgestimmt"
  }, gerechnet wird mit Binance-Kerzen.`,
  ladder: "Timeframe-Leiter",
  ladderHelp: "Antippen schaltet eine Stufe an oder aus. Mindestens eine bleibt aktiv.",
  tfToggle: (tf: string) => `Stufe ${tf}`,
  required: "Pflicht-Stufen",
  requiredHelp: "2 = Basis + nächst höhere",
  rsi: "RSI",
  rsiOs: "RSI überverkauft",
  rsiOb: "RSI überkauft",
  rsiNear: "RSI-Nähe (Punkte)",
  rsiNearHelp: (long: string, short: string) => `Long ab ≤ ${long}, Short ab ≥ ${short}`,
  mcb: "MCB / WaveTrend",
  wtOs: "MCB Bottom-Zone",
  wtOb: "MCB Top-Zone",
  look: "Signal gilt",
  lookHelp: "Kerzen, inklusive der laufenden",
  ch: "WaveTrend Kanal",
  avg: "WaveTrend Schnitt",
  sig: "WaveTrend Signal",
  zone: "Premium / Discount",
  zoneTf: "Zone auf",
  swing: "Kerzen für Zone",
  swingHelp: "Swing-Länge nach LuxAlgo, mind. 20",
  alerts: "Hinweise",
  notify: "Systembenachrichtigung",
  minStrength: "Hinweis ab Stärke",
  minStrengthHelp: (label: string) => `Ab „${label}“ meldet das Journal einen neuen Einstieg (einmal pro Kerze).`,
  perm: {
    granted: "Erlaubt. Erscheint, wenn das Journal im Hintergrund ist; im Vordergrund zeigt die Insel den Hinweis.",
    denied: "Im Browser blockiert. Erlaube Benachrichtigungen für diese Seite in den Browser-Einstellungen, der Hinweis in der App bleibt.",
    unsupported: "Dieser Browser kann hier keine Systembenachrichtigungen zeigen (z. B. als Datei geöffnet). Der Hinweis in der App bleibt.",
    default: "Fragt beim Einschalten nach der Erlaubnis des Browsers.",
  } satisfies Record<NotifyPermission, string>,
  confirm: "Bestätigung (Kerzenschluss)",
  confirmIntro:
    "Ein Signal auf der laufenden Kerze ist vorläufig (⚠ vorläufig · schließt in mm:ss) und zählt im Score nur halb. Bestätigt ist es erst, wenn seine Kerze damit schließt; der Einstieg zählt, sobald die Basis-Kerze bestätigt hat. Hinweise kommen nur für bestätigte Einstiege.",
  strong: "Stark bestätigt nach",
  strongHelp: (n: number) => `${n} ${n === 1 ? "Schluss" : "Schlüssen"} (inkl. der Signalkerze), ohne dass der Kurs die Signalkerze bricht`,
  whale: "Top-Trader-Kombi",
  whaleSwitch: `Check „${TRADERS_SIDE_TITLE.long}“`,
  whaleHelp:
    "Vier Teile, je mehr erfüllt, desto stärker: Binance-Top-Trader über der Schwelle Long nach Positionen und nach Konten, Retail rot (Long-Anteil aller Konten fällt) und Preis im Discount. Short spiegelbildlich (Top-Trader Short, Retail grün, Premium). Binance-5-min-Daten, ~30 Tage zurück; ohne Daten „keine Daten“, nie ein Fehler.",
  whaleTop: "Top-Trader-Schwelle (% Long)",
  whaleTopHelp: (x: string, y: string) => `Long: über ${x} % Long · Short: über ${x} % Short (Long ≤ ${y} %)`,
  whaleRetail: "Retail-Vergleich",
  whaleRetailHelp: "Long-Anteil aller Konten jetzt gegen so lange vorher",
  whaleBonus: "+1 Stärke ab",
  whaleBonusHelp: (n: number) => `${n} von 4 Teilen erfüllt (mit Gewicht über 0)`,
  whaleWeight: "Gewicht (Score)",
  whaleWeightHelp: (w: number) => (w > 0 ? `bis +${w} Score, anteilig (je erfüllter Teil ¼)` : "0 = nur anzeigen und speichern, zählt nicht"),
  div: "Divergenzen",
  divSwitch: "Check „Bullische / Bärische Divergenz“",
  divHelp: "RSI und WaveTrend wt1 gegen den Kurs an Pivots, je Timeframe der Leiter. Regulär = Umkehr (Kurs tieferes Tief, Oszillator höheres Tief), versteckt = Fortsetzung. Zählt bei einer regulären auf geschlossener Kerze voll.",
  divOsc: "Oszillatoren und Filter",
  divOscHelp: "Mindestens ein Oszillator bleibt aktiv. Mittellinie: bullische Pivots nur unter 50 (RSI) / 0 (WT).",
  divRsi: "RSI",
  divWt: "WaveTrend",
  divHidden: "versteckte",
  divMid: "Mittellinie",
  divLeft: "Pivot links",
  divLeftHelp: "Kerzen vor dem Pivot",
  divRight: "Pivot rechts",
  divRightHelp: "Kerzen danach = Bestätigung",
  divMin: "Abstand min",
  divMinHelp: "Kerzen zwischen den Pivots",
  divMax: "Abstand max",
  divMaxHelp: "Kerzen zwischen den Pivots",
  divAge: "Gilt (Kerzen)",
  divAgeHelp: "nach der Bestätigung",
  sr: "Support / Widerstand",
  srSwitch: "Check „Support + Platz“",
  srHelp: "LuxAlgo-Struktur auf dem Zonen-Timeframe: Swing-Hochs/-Tiefs, BOS/CHoCH, Order-Blocks, EQH/EQL. Long: nah am Support/Demand und genug Platz bis zum nächsten Widerstand (in R, Stop knapp unter dem Level); Short spiegelbildlich.",
  srNear: "Level-Nähe (ATR)",
  srNearHelp: "Abstand zum Support in ATR 14",
  srMinR: "Mindest-Platz (R)",
  srMinRHelp: "Chance/Risiko bis zum nächsten Level",
  srInt: "Intern (Kerzen)",
  srIntHelp: "interne Struktur (LuxAlgo)",
  srEqLen: "EQH/EQL Pivot",
  srEqLenHelp: "Kerzen",
  srEqThr: "EQH/EQL Toleranz",
  srEqThrHelp: "× ATR 200",
  partWeight: "Gewicht (Score)",
  partWeightHelp: (w: number) => (w > 0 ? `bis +${w} Score anteilig, voll erfüllt +1 Stärke` : "0 = nur anzeigen, zählt nicht"),
  defaults: "Standardwerte setzen",
  defaultsHelp: "Setzt die Check-Werte auf die Standardwerte der Datei-Version zurück (erst mit „Speichern“ übernommen).",
} as const;

const S = SIGNAL_STRINGS;
const TF_OPTIONS = SIGNAL_TFS.map((tf) => ({ value: tf, label: tf }));
const STRENGTH_OPTIONS = [1, 2, 3, 4].map((n) => ({
  v: String(n),
  label: String(n),
}));

export interface SignalCheckCardProps {
  draft: SettingsDraft;
  onChange: (key: DraftTextKey, value: string) => void;
  /** Several keys at once (`Standardwerte setzen`). */
  onPatch: (patch: Partial<SettingsDraft>) => void;
  changed: ReadonlySet<DraftKey>;
  invalid: DraftTextKey | null;
  className?: string;
}

/**
 * NEW `Einstiegs-Check` card (`settings.signals`, the other journal's `SignalCfg` 1:1 + `notify` / `notifyMinStrength`):
 * ladder toggles per timeframe (sorted small → large, ≥ 30m), `Pflicht-Stufen` (1 … ladder length), RSI thresholds +
 * nearness, MCB zones, signal window, WaveTrend lengths, zone timeframe + swing length, the system-notification switch
 * (asks the browser for permission in the same click) and the minimum strength for a notice, plus the v2 thresholds
 * (decisions 5, 6, 9, 10): closes until "stark bestätigt", the Top-Trader-Kombi (switch, % threshold, retail period,
 * parts for +1 strength, weight), divergences (switch, oscillators / hidden / midline, pivot lookbacks, distance, age,
 * weight) and support / resistance (switch, ATR nearness, R room, internal length, EQH/EQL, weight). Values shown are the
 * ones the engine runs with (`sanitizeSignalCfg`); the part is written only when changed (see `draft.ts` /
 * `signalPartsDraft.ts`), merged over the stored object so unknown keys of either app survive (the legacy run-rule
 * values `whale.periods` / `minRun` stay as stored). `Standardwerte setzen` = the defaults.
 */
export const SignalCheckCard = memo(function SignalCheckCard({ draft, onChange, onPatch, changed, invalid, className }: SignalCheckCardProps) {
  const ladder = parseLadder(draft.sgLadder);
  const req = Math.min(ladder.length, Math.max(1, Math.round(parseNumber(draft.sgReq) ?? 1)));
  const os = parseNumber(draft.sgRsiOs);
  const ob = parseNumber(draft.sgRsiOb);
  const near = parseNumber(draft.sgRsiNear);
  const nearHelp = os != null && ob != null && near != null ? S.rsiNearHelp(fmt(os + near), fmt(ob - near)) : undefined;
  const minStrength = Math.min(4, Math.max(1, Math.round(parseNumber(draft.sgNotifyMin) ?? 1)));

  const toggleTf = (tf: string) => {
    const on = ladder.includes(tf);
    if (on && ladder.length <= 1) return;
    const next = on ? ladder.filter((x) => x !== tf) : [...ladder, tf];
    const sorted = parseLadder(next.join(","));
    const patch: Partial<SettingsDraft> = { sgLadder: sorted.join(",") };
    // keep `Pflicht-Stufen` inside the ladder (the save clamps as well)
    if (req > sorted.length) patch.sgReq = String(sorted.length);
    onPatch(patch);
  };

  const field = (id: DraftTextKey, label: string, help?: string) => <DraftField id={id} label={label} help={help} draft={draft} onChange={onChange} changed={changed.has(id)} invalid={invalid === id} />;

  return (
    <Card
      title={
        <>
          {S.title}
          <ChangedDot show={SIGNAL_DIRTY_KEYS.some((k) => changed.has(k))} />
        </>
      }
      note={S.note}
      className={className}
      data-testid="settings-signal-card"
    >
      <p className="mb-4 max-w-[80ch] text-[13px] text-mute">{S.intro}</p>

      <Group title={S.ladder} showTitle={false}>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="grid gap-1.5">
            <span id="s-sgLadder-label" className="label">
              {S.ladder}
              <ChangedDot show={changed.has("sgLadder")} />
            </span>
            <div
              id="s-sgLadder"
              tabIndex={-1}
              role="group"
              aria-labelledby="s-sgLadder-label"
              aria-describedby="s-sgLadder-help"
              className={cn("flex flex-wrap gap-2 rounded-xl outline-none", invalid === "sgLadder" && "ring-1 ring-loss/60")}
            >
              {SIGNAL_TFS.map((tf) => (
                <TfChip key={tf} tf={tf} on={ladder.includes(tf)} last={ladder.length <= 1 && ladder.includes(tf)} onToggle={() => toggleTf(tf)} />
              ))}
            </div>
            <span id="s-sgLadder-help" className="text-[11px] text-faint">
              {S.ladderHelp}
            </span>
          </div>
          <div className="grid gap-1.5">
            <span id="s-sgReq-label" className="label">
              {S.required}
              <ChangedDot show={changed.has("sgReq")} />
            </span>
            <Segmented
              aria-labelledby="s-sgReq-label"
              size="sm"
              className="justify-self-start"
              value={String(req)}
              onChange={(v) => onChange("sgReq", v)}
              options={ladder.map((_, i) => ({
                v: String(i + 1),
                label: String(i + 1),
              }))}
            />
            <span className="text-[11px] text-faint">{S.requiredHelp}</span>
          </div>
        </div>
        {/* the resulting ladder with each rung's role (Basis / Bestätigung / stärker) – wraps, never truncates */}
        <ol className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]" aria-label="Leiter">
          {ladder.map((tf, i) => (
            <li key={tf} className="flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden="true" className="text-faint">
                  →
                </span>
              )}
              <span className={cn("num font-mono", i < req ? "text-fg" : "text-mute")}>{tf}</span>
              <span className="text-[10px] uppercase tracking-[0.08em] text-faint">{roleText(i, req)}</span>
            </li>
          ))}
        </ol>
      </Group>

      <Group title={S.rsi}>
        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3">
          {field("sgRsiOs", S.rsiOs)}
          {field("sgRsiOb", S.rsiOb)}
          {field("sgRsiNear", S.rsiNear, nearHelp)}
        </div>
      </Group>

      <Group title={S.mcb}>
        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3">
          {field("sgWtOs", S.wtOs)}
          {field("sgWtOb", S.wtOb)}
          {field("sgLook", S.look, S.lookHelp)}
          {field("sgCh", S.ch)}
          {field("sgAvg", S.avg)}
          {field("sgSig", S.sig)}
        </div>
      </Group>

      <Group title={S.zone}>
        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3">
          <Field
            label={
              <>
                {S.zoneTf}
                <ChangedDot show={changed.has("sgZoneTf")} />
              </>
            }
            htmlFor="s-sgZoneTf"
          >
            <MorphSelect id="s-sgZoneTf" value={draft.sgZoneTf || "1h"} onChange={(v) => onChange("sgZoneTf", v)} options={TF_OPTIONS} />
          </Field>
          {field("sgSwing", S.swing, S.swingHelp)}
        </div>
      </Group>

      <ConfirmGroup draft={draft} onChange={onChange} changed={changed} />

      <WhaleGroup draft={draft} onChange={onChange} changed={changed} field={field} />

      <DivGroup draft={draft} onChange={onChange} changed={changed} field={field} />

      <SrGroup draft={draft} onChange={onChange} changed={changed} field={field} />

      <Group title={S.alerts}>
        <div className="grid gap-3.5 md:grid-cols-2">
          <NotifyRow on={draft.sgNotify === "on"} changed={changed.has("sgNotify")} onChange={(on) => onChange("sgNotify", on ? "on" : "")} />
          <div className="grid content-start gap-1.5">
            <span id="s-sgNotifyMin-label" className="label">
              {S.minStrength}
              <ChangedDot show={changed.has("sgNotifyMin")} />
            </span>
            <Segmented aria-labelledby="s-sgNotifyMin-label" size="sm" value={String(minStrength)} onChange={(v) => onChange("sgNotifyMin", v)} options={STRENGTH_OPTIONS} className="justify-self-start" />
            <span className="text-[11px] text-faint">{S.minStrengthHelp(STRENGTH_LABEL[minStrength] ?? "")}</span>
          </div>
        </div>
      </Group>

      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-4">
        <Button size="sm" onClick={() => onPatch(defaultSignalDraft(draft))}>
          {S.defaults}
        </Button>
        <span className="min-w-0 flex-1 basis-[16rem] text-[11px] text-faint">{S.defaultsHelp}</span>
      </div>
    </Card>
  );
});

/** Draft keys of this card (title dot). */
const SIGNAL_DIRTY_KEYS: readonly DraftKey[] = [
  "sgLadder",
  "sgReq",
  "sgLook",
  "sgRsiOs",
  "sgRsiOb",
  "sgRsiNear",
  "sgWtOs",
  "sgWtOb",
  "sgZoneTf",
  "sgSwing",
  "sgCh",
  "sgAvg",
  "sgSig",
  "sgNotify",
  "sgNotifyMin",
  "sgWhale",
  "sgWhalePeriods",
  "sgWhaleMin",
  "sgWhaleWeight",
  ...PARTS_DRAFT_KEYS,
];

const WEIGHT_OPTIONS = WHALE_WEIGHTS.map((w) => ({
  v: String(w),
  label: String(w),
}));
const STRONG_OPTIONS = Array.from({ length: STRONG_CLOSES_MAX }, (_, i) => ({
  v: String(i + 1),
  label: String(i + 1),
}));
const BONUS_OPTIONS = [1, 2, 3, 4].map((n) => ({
  v: String(n),
  label: String(n),
}));
const RETAIL_OPTIONS = WHALE_RETAIL_PERIODS.map((p) => ({ v: p, label: p }));
const weightOptions = (w: number) => (WHALE_WEIGHTS.includes(w) ? WEIGHT_OPTIONS : [...WHALE_WEIGHTS, w].sort((a, b) => a - b).map((x) => ({ v: String(x), label: String(x) })));
const intOf = (v: string, d: number): number => Math.round(parseNumber(v) ?? d);

interface GroupProps {
  draft: SettingsDraft;
  onChange: (key: DraftTextKey, value: string) => void;
  changed: ReadonlySet<DraftKey>;
}
type FieldFn = (id: DraftTextKey, label: string, help?: string) => ReactNode;

/** A labelled segmented choice (`aria-labelledby`), with the changed dot and a help line. */
function Choice({ id, label, help, value, options, onChange, changed }: { id: DraftTextKey; label: string; help: string; value: string; options: readonly { v: string; label: string }[]; onChange: (v: string) => void; changed: boolean }) {
  return (
    <div className="grid content-start gap-1.5">
      <span id={`s-${id}-label`} className="label">
        {label}
        <ChangedDot show={changed} />
      </span>
      <Segmented aria-labelledby={`s-${id}-label`} size="sm" className="justify-self-start" value={value} onChange={onChange} options={options} />
      <span className="text-[11px] text-faint">{help}</span>
    </div>
  );
}

/** Switch row of a condition (label, help, `Switch`), as the notification row. */
function SwitchRow({ id, label, help, on, changed, onChange }: { id: DraftTextKey; label: string; help: string; on: boolean; changed: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5">
      <span className="grid min-w-0 gap-0.5">
        <label htmlFor={`s-${id}`} className="cursor-pointer text-[13px] text-fg">
          {label}
          <ChangedDot show={changed} />
        </label>
        <span id={`s-${id}-help`} className="max-w-[80ch] text-[11px] text-faint">
          {help}
        </span>
      </span>
      <Switch id={`s-${id}`} checked={on} onCheckedChange={onChange} aria-describedby={`s-${id}-help`} className="touch-hit mt-0.5 shrink-0" />
    </div>
  );
}

/** `Bestätigung (Kerzenschluss)`: what provisional / confirmed means and the closes until "stark bestätigt". */
function ConfirmGroup({ draft, onChange, changed }: GroupProps) {
  const n = Math.min(STRONG_CLOSES_MAX, Math.max(1, intOf(draft.sgStrong, 2)));
  return (
    <Group title={S.confirm}>
      <div className="grid gap-3.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start" data-testid="settings-confirm">
        <p className="max-w-[80ch] text-[12px] leading-relaxed text-mute">{S.confirmIntro}</p>
        <Choice id="sgStrong" label={S.strong} help={S.strongHelp(n)} value={String(n)} options={STRONG_OPTIONS} onChange={(v) => onChange("sgStrong", v)} changed={changed.has("sgStrong")} />
      </div>
    </Group>
  );
}

/**
 * `Top-Trader-Kombi` group: switch, top-trader threshold (% long), retail comparison period, parts for +1 strength and
 * the weight. The former run-rule values (periods / in a row) are no longer graded; they stay stored untouched.
 */
function WhaleGroup({ draft, onChange, changed, field }: GroupProps & { field: FieldFn }) {
  const on = draft.sgWhale === "on";
  const top = parseNumber(draft.sgWhaleTop);
  const bonus = Math.min(4, Math.max(1, intOf(draft.sgWhaleBonus, 3)));
  const weight = Math.max(0, intOf(draft.sgWhaleWeight, 10));
  const topHelp = top != null ? S.whaleTopHelp(fmt(top), fmt(100 - top)) : undefined;
  return (
    <Group title={S.whale}>
      <div className="grid gap-3.5" data-testid="settings-whale">
        <SwitchRow id="sgWhale" label={S.whaleSwitch} help={S.whaleHelp} on={on} changed={changed.has("sgWhale")} onChange={(v) => onChange("sgWhale", v ? "on" : "")} />
        <div className={cn("grid gap-3.5 transition-opacity duration-300 sm:grid-cols-2 lg:grid-cols-4", !on && "opacity-60")}>
          {field("sgWhaleTop", S.whaleTop, topHelp)}
          <Choice id="sgWhaleRetail" label={S.whaleRetail} help={S.whaleRetailHelp} value={draft.sgWhaleRetail || "5m"} options={RETAIL_OPTIONS} onChange={(v) => onChange("sgWhaleRetail", v)} changed={changed.has("sgWhaleRetail")} />
          <Choice id="sgWhaleBonus" label={S.whaleBonus} help={S.whaleBonusHelp(bonus)} value={String(bonus)} options={BONUS_OPTIONS} onChange={(v) => onChange("sgWhaleBonus", v)} changed={changed.has("sgWhaleBonus")} />
          <Choice id="sgWhaleWeight" label={S.whaleWeight} help={S.whaleWeightHelp(weight)} value={String(weight)} options={weightOptions(weight)} onChange={(v) => onChange("sgWhaleWeight", v)} changed={changed.has("sgWhaleWeight")} />
        </div>
      </div>
    </Group>
  );
}

/** `Divergenzen` group: switch, oscillator / filter toggles, pivot lookbacks, distance, age, weight. */
function DivGroup({ draft, onChange, changed, field }: GroupProps & { field: FieldFn }) {
  const on = draft.sgDiv === "on";
  const weight = Math.max(0, intOf(draft.sgDivWeight, 10));
  const rsi = draft.sgDivRsi === "on";
  const wt = draft.sgDivWt === "on";
  const toggles: {
    key: DraftTextKey;
    label: string;
    on: boolean;
    last?: boolean;
  }[] = [
    { key: "sgDivRsi", label: S.divRsi, on: rsi, last: rsi && !wt },
    { key: "sgDivWt", label: S.divWt, on: wt, last: wt && !rsi },
    { key: "sgDivHidden", label: S.divHidden, on: draft.sgDivHidden === "on" },
    { key: "sgDivMid", label: S.divMid, on: draft.sgDivMid === "on" },
  ];
  const oscChanged = toggles.some((t) => changed.has(t.key));
  return (
    <Group title={S.div}>
      <div className="grid gap-3.5" data-testid="settings-div">
        <SwitchRow id="sgDiv" label={S.divSwitch} help={S.divHelp} on={on} changed={changed.has("sgDiv")} onChange={(v) => onChange("sgDiv", v ? "on" : "")} />
        <div className={cn("grid gap-3.5 transition-opacity duration-300", !on && "opacity-60")}>
          <div className="grid gap-3.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
            <div className="grid gap-1.5">
              <span id="s-sgDivOsc-label" className="label">
                {S.divOsc}
                <ChangedDot show={oscChanged} />
              </span>
              <div role="group" aria-labelledby="s-sgDivOsc-label" className="flex flex-wrap gap-2">
                {toggles.map((t) => (
                  <TfChip
                    key={t.key}
                    tf={t.label}
                    label={t.label}
                    on={t.on}
                    last={!!t.last}
                    onToggle={() => {
                      if (!t.last) onChange(t.key, t.on ? "" : "on");
                    }}
                  />
                ))}
              </div>
              <span className="text-[11px] text-faint">{S.divOscHelp}</span>
            </div>
            <Choice id="sgDivWeight" label={S.partWeight} help={S.partWeightHelp(weight)} value={String(weight)} options={weightOptions(weight)} onChange={(v) => onChange("sgDivWeight", v)} changed={changed.has("sgDivWeight")} />
          </div>
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-5">
            {field("sgDivLeft", S.divLeft, S.divLeftHelp)}
            {field("sgDivRight", S.divRight, S.divRightHelp)}
            {field("sgDivMin", S.divMin, S.divMinHelp)}
            {field("sgDivMax", S.divMax, S.divMaxHelp)}
            {field("sgDivAge", S.divAge, S.divAgeHelp)}
          </div>
        </div>
      </div>
    </Group>
  );
}

/** `Support / Widerstand` group: switch, ATR nearness, R room, internal structure, EQH/EQL, weight. */
function SrGroup({ draft, onChange, changed, field }: GroupProps & { field: FieldFn }) {
  const on = draft.sgSr === "on";
  const weight = Math.max(0, intOf(draft.sgSrWeight, 10));
  return (
    <Group title={S.sr}>
      <div className="grid gap-3.5" data-testid="settings-sr">
        <SwitchRow id="sgSr" label={S.srSwitch} help={S.srHelp} on={on} changed={changed.has("sgSr")} onChange={(v) => onChange("sgSr", v ? "on" : "")} />
        <div className={cn("grid gap-3.5 transition-opacity duration-300", !on && "opacity-60")}>
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            {field("sgSrNear", S.srNear, S.srNearHelp)}
            {field("sgSrMinR", S.srMinR, S.srMinRHelp)}
            <div className="col-span-2 md:col-span-1">
              <Choice id="sgSrWeight" label={S.partWeight} help={S.partWeightHelp(weight)} value={String(weight)} options={weightOptions(weight)} onChange={(v) => onChange("sgSrWeight", v)} changed={changed.has("sgSrWeight")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3">
            {field("sgSrInt", S.srInt, S.srIntHelp)}
            {field("sgSrEqLen", S.srEqLen, S.srEqLenHelp)}
            {field("sgSrEqThr", S.srEqThr, S.srEqThrHelp)}
          </div>
        </div>
      </div>
    </Group>
  );
}

const fmt = (v: number): string => String(Math.round(v * 10) / 10).replace(".", ",");

function Group({ title, showTitle = true, children }: { title: string; showTitle?: boolean; children: ReactNode }) {
  return (
    <section className="mt-4 border-t border-line pt-4 first-of-type:mt-0 first-of-type:border-t-0 first-of-type:pt-0" aria-label={title}>
      {showTitle && <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-mute">{title}</h3>}
      {children}
    </section>
  );
}

/**
 * One ladder rung toggle (`aria-pressed`): mono label, white when on; ≥ 44 px tall on coarse pointers. The last
 * active rung cannot be switched off (aria-disabled, a short shake-free no-op).
 */
function TfChip({ tf, on, last, onToggle, label }: { tf: string; on: boolean; last: boolean; onToggle: () => void; label?: string }) {
  const reduced = useReducedFx();
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      aria-label={label ?? S.tfToggle(tf)}
      aria-disabled={last || undefined}
      onClick={onToggle}
      whileTap={reduced || last ? undefined : { scale: 0.94 }}
      transition={spring.press}
      className={cn(
        "num min-w-[3.25rem] rounded-xl border px-3 py-1.5 font-mono text-[12.5px] transition-colors duration-200 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        on ? "border-white/40 bg-white/[0.09] text-fg" : "border-line-2 bg-transparent text-mute hover:text-fg",
        last && "cursor-not-allowed",
      )}
    >
      {tf}
    </motion.button>
  );
}

/**
 * `Systembenachrichtigung` switch: switching on asks the browser for the Notification permission inside the same click
 * (`requestSignalNotifyPermission`); only a granted permission turns it on. The line below says what will happen.
 */
function NotifyRow({ on, changed, onChange }: { on: boolean; changed: boolean; onChange: (on: boolean) => void }) {
  const [perm, setPerm] = useState<NotifyPermission>(() => signalNotifyPermission());
  const toggle = async (next: boolean) => {
    if (!next) return onChange(false);
    const p = await requestSignalNotifyPermission();
    setPerm(p);
    onChange(p === "granted");
  };
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5">
      <span className="grid min-w-0 gap-0.5">
        <label htmlFor="s-sgNotify" className="cursor-pointer text-[13px] text-fg">
          {S.notify}
          <ChangedDot show={changed} />
        </label>
        <span id="s-sgNotify-help" className="text-[11px] text-faint" data-permission={perm}>
          {S.perm[perm]}
        </span>
      </span>
      <Switch id="s-sgNotify" checked={on} onCheckedChange={(v) => void toggle(v)} aria-describedby="s-sgNotify-help" className="touch-hit mt-0.5 shrink-0" />
    </div>
  );
}
