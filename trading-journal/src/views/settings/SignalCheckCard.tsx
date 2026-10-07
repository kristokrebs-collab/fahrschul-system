import { motion } from "motion/react";
import { memo, useState, type ReactNode } from "react";
import { parseWhalePeriods, roleText, SIGNAL_TFS, STRENGTH_LABEL, WHALE_MIN_RUN_MAX, WHALE_PERIODS, WHALE_TITLE, WHALE_WEIGHTS, whaleToDraft, type WhaleDraft, type WhaleDraftKey } from "@/domain/signals";
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
import { useJournal } from "@/store/journalStore";
import { defaultSignalDraft, parseLadder, type DraftKey, type DraftTextKey, type SettingsDraft } from "./draft";
import { DraftField } from "./fields";
import { ChangedDot } from "./fx";

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
  whale: "Top-Trader · Retail",
  whaleSwitch: `Check „${WHALE_TITLE.long}“`,
  whaleHelp: "Binance-Top-Trader kaufen (Long-Anteil ihrer Positionen steigt), während Retail rot ist (Long-Anteil aller Konten fällt) – über abgeschlossene Perioden in Folge. Short spiegelbildlich: Top-Trader verkaufen, Retail grün. Nur mit Binance-Futures-Daten, die ~30 Tage zurückreichen; ältere Trades zeigen „keine Daten“.",
  whalePeriods: "Perioden",
  whalePeriodsHelp: "Gilt, wenn eine der Perioden passt. Mindestens eine bleibt aktiv.",
  whalePeriodToggle: (p: string) => `Periode ${p}`,
  whaleMin: "In Folge (mind.)",
  whaleMinHelp: (n: number) => `${n} abgeschlossene ${n === 1 ? "Periode" : "Perioden"} hintereinander`,
  whaleWeight: "Gewicht (Score)",
  whaleWeightHelp: (w: number) => (w > 0 ? `+${w} Score, ein gültiger Einstieg wird eine Stärke höher (bis ${STRENGTH_LABEL[4]})` : "0 = nur anzeigen und speichern, zählt nicht"),
  defaults: "Standardwerte setzen",
  defaultsHelp: "Setzt die Check-Werte auf die Standardwerte der Datei-Version zurück (erst mit „Speichern“ übernommen).",
} as const;

const S = SIGNAL_STRINGS;
const TF_OPTIONS = SIGNAL_TFS.map((tf) => ({ value: tf, label: tf }));
const STRENGTH_OPTIONS = [1, 2, 3, 4].map((n) => ({ v: String(n), label: String(n) }));

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
 * (asks the browser for permission in the same click) and the minimum strength for a notice, plus the "Top-Trader
 * kaufen · Retail rot" condition (`settings.signals.whale`: switch, periods, consecutive periods, weight). Values shown are the ones
 * the engine runs with (`sanitizeSignalCfg`); the part is written only when changed (see `draft.ts`), merged over the
 * stored object so unknown keys of either app survive. `Standardwerte setzen` = the other journal's defaults.
 */
export const SignalCheckCard = memo(function SignalCheckCard({ draft, onChange, onPatch, changed, invalid, className }: SignalCheckCardProps) {
  const ladder = parseLadder(draft.sgLadder);
  const req = Math.min(ladder.length, Math.max(1, Math.round(parseNumber(draft.sgReq) ?? 1)));
  const os = parseNumber(draft.sgRsiOs);
  const ob = parseNumber(draft.sgRsiOb);
  const near = parseNumber(draft.sgRsiNear);
  const nearHelp = os != null && ob != null && near != null ? S.rsiNearHelp(fmt(os + near), fmt(ob - near)) : undefined;
  const minStrength = Math.min(4, Math.max(1, Math.round(parseNumber(draft.sgNotifyMin) ?? 1)));
  // "Top-Trader kaufen · Retail rot": draft strings when the draft carries them, else what is stored (see WhaleGroup)
  const storedSignals = useJournal((st) => st.settings.signals);

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
            <div id="s-sgLadder" tabIndex={-1} role="group" aria-labelledby="s-sgLadder-label" aria-describedby="s-sgLadder-help" className={cn("flex flex-wrap gap-2 rounded-xl outline-none", invalid === "sgLadder" && "ring-1 ring-loss/60")}>
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
            <Segmented aria-labelledby="s-sgReq-label" size="sm" className="justify-self-start" value={String(req)} onChange={(v) => onChange("sgReq", v)} options={ladder.map((_, i) => ({ v: String(i + 1), label: String(i + 1) }))} />
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

      <WhaleGroup draft={draft} stored={storedSignals} onChange={onChange} changed={changed} invalid={invalid} />

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
  ...(["sgWhale", "sgWhalePeriods", "sgWhaleMin", "sgWhaleWeight"] as unknown as DraftKey[]),
];

/**
 * The whale draft keys (`sgWhale`, `sgWhalePeriods`, `sgWhaleMin`, `sgWhaleWeight`, see `@/domain/signals`
 * `whaleDraft.ts`) go through the same `onChange` / `changed` / `invalid` channel as the other `sg*` strings; the
 * casts keep this card compiling whether or not `SettingsDraft` lists them yet.
 */
const asDraftKey = (k: WhaleDraftKey): DraftTextKey => k as unknown as DraftTextKey;
const WEIGHT_OPTIONS = WHALE_WEIGHTS.map((w) => ({ v: String(w), label: String(w) }));
const MIN_OPTIONS = Array.from({ length: WHALE_MIN_RUN_MAX }, (_, i) => ({ v: String(i + 1), label: String(i + 1) }));

/**
 * `Top-Trader · Retail` group: switch, period chips (≥ 1 stays on), consecutive periods (1 … 6) and the weight in score
 * points (0 = shown only). All choices are segmented / toggles, so a value can never be invalid.
 */
function WhaleGroup({
  draft,
  stored,
  onChange,
  changed,
  invalid,
}: {
  draft: SettingsDraft;
  stored: unknown;
  onChange: (key: DraftTextKey, value: string) => void;
  changed: ReadonlySet<DraftKey>;
  invalid: DraftTextKey | null;
}) {
  const base = whaleToDraft(stored);
  const d = draft as SettingsDraft & Partial<WhaleDraft>;
  const val = (k: WhaleDraftKey): string => d[k] ?? base[k];
  const isChanged = (k: WhaleDraftKey): boolean => changed.has(asDraftKey(k) as DraftKey);
  const on = val("sgWhale") === "on";
  const periods = parseWhalePeriods(val("sgWhalePeriods"));
  const min = Math.min(WHALE_MIN_RUN_MAX, Math.max(1, Math.round(parseNumber(val("sgWhaleMin")) ?? 2)));
  const weight = Math.max(0, Math.round(parseNumber(val("sgWhaleWeight")) ?? 10));
  const togglePeriod = (p: string) => {
    const has = periods.includes(p);
    if (has && periods.length <= 1) return;
    const next = parseWhalePeriods((has ? periods.filter((x) => x !== p) : [...periods, p]).join(","));
    onChange(asDraftKey("sgWhalePeriods"), next.join(","));
  };
  return (
    <Group title={S.whale}>
      <div className="grid gap-3.5" data-testid="settings-whale">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5">
          <span className="grid min-w-0 gap-0.5">
            <label htmlFor="s-sgWhale" className="cursor-pointer text-[13px] text-fg">
              {S.whaleSwitch}
              <ChangedDot show={isChanged("sgWhale")} />
            </label>
            <span id="s-sgWhale-help" className="max-w-[80ch] text-[11px] text-faint">
              {S.whaleHelp}
            </span>
          </span>
          <Switch id="s-sgWhale" checked={on} onCheckedChange={(v) => onChange(asDraftKey("sgWhale"), v ? "on" : "")} aria-describedby="s-sgWhale-help" className="touch-hit mt-0.5 shrink-0" />
        </div>
        <div className={cn("grid gap-3.5 transition-opacity duration-300 md:grid-cols-3", !on && "opacity-60")}>
          <div className="grid content-start gap-1.5">
            <span id="s-sgWhalePeriods-label" className="label">
              {S.whalePeriods}
              <ChangedDot show={isChanged("sgWhalePeriods")} />
            </span>
            <div
              id="s-sgWhalePeriods"
              tabIndex={-1}
              role="group"
              aria-labelledby="s-sgWhalePeriods-label"
              aria-describedby="s-sgWhalePeriods-help"
              className={cn("flex flex-wrap gap-2 rounded-xl outline-none", invalid === asDraftKey("sgWhalePeriods") && "ring-1 ring-loss/60")}
            >
              {WHALE_PERIODS.map((p) => (
                <TfChip key={p} tf={p} label={S.whalePeriodToggle(p)} on={periods.includes(p)} last={periods.length <= 1 && periods.includes(p)} onToggle={() => togglePeriod(p)} />
              ))}
            </div>
            <span id="s-sgWhalePeriods-help" className="text-[11px] text-faint">
              {S.whalePeriodsHelp}
            </span>
          </div>
          <div className="grid content-start gap-1.5">
            <span id="s-sgWhaleMin-label" className="label">
              {S.whaleMin}
              <ChangedDot show={isChanged("sgWhaleMin")} />
            </span>
            <Segmented aria-labelledby="s-sgWhaleMin-label" size="sm" className="justify-self-start" value={String(min)} onChange={(v) => onChange(asDraftKey("sgWhaleMin"), v)} options={MIN_OPTIONS} />
            <span className="text-[11px] text-faint">{S.whaleMinHelp(min)}</span>
          </div>
          <div className="grid content-start gap-1.5">
            <span id="s-sgWhaleWeight-label" className="label">
              {S.whaleWeight}
              <ChangedDot show={isChanged("sgWhaleWeight")} />
            </span>
            <Segmented
              aria-labelledby="s-sgWhaleWeight-label"
              size="sm"
              className="justify-self-start"
              value={String(weight)}
              onChange={(v) => onChange(asDraftKey("sgWhaleWeight"), v)}
              options={WHALE_WEIGHTS.includes(weight) ? WEIGHT_OPTIONS : [...WHALE_WEIGHTS, weight].sort((a, b) => a - b).map((w) => ({ v: String(w), label: String(w) }))}
            />
            <span className="text-[11px] text-faint">{S.whaleWeightHelp(weight)}</span>
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
