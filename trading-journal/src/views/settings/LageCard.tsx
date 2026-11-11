/**
 * Einstellungen → `Lage-Ampel` (decision 23): an / aus and the effect (`Sperre` = entry signals count only on green,
 * default; `nur Warnung`). Stored in `settings.signals.lage = { on, mode }` (additive: every other key of
 * `settings.signals` and unknown keys inside `lage` survive, see `withLageSettings`). Applied at once — a switch, like
 * the intro preference, never waits for the page's `Speichern`; the page's draft does not hold these keys, so its save
 * (merged over the stored `signals`) keeps them. The logic itself is fixed (no dial): the card says so and shows the
 * live state.
 */
import { memo, useState } from "react";
import { LAGE_MODE_TEXT, LAGE_SETTINGS_TITLE, LAGE_STATE_WORD, lageSettingsOf, withLageSettings, type LageSettings } from "@/domain/lage";
import { cn } from "@/lib/cn";
import { useLage } from "@/market";
import { Switch } from "@/motion/Switch";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";

export const LAGE_CARD_STRINGS = {
  title: LAGE_SETTINGS_TITLE,
  note: "Schutz vor dem fallenden Messer: Kaufsignale nur, wenn der Tagestrend steht. Feste Logik, kein Regler – an der BTC-Historie geprüft.",
  on: "Lage-Ampel verwenden",
  onHelp: "Rot nach 2 Tagesschlüssen unter der 1D-EMA 21, Gelb mit Umkehr-Zeichen auf 4H, Grün nach dem ersten Schluss darüber.",
  mode: "Wirkung",
  modeHelp: {
    block: "Bei Gelb und Rot zählt ein Kaufsignal nicht: es bleibt blass sichtbar („zählt nicht – fällt noch“), ohne Meldung.",
    warn: "Kaufsignale zählen immer; Panel und Einstiegs-Check zeigen die Lage nur als Warnung.",
  },
  offHelp: "Aus: Kaufsignale zählen ohne Tagestrend; das Lage-Panel bleibt als Information.",
  instant: "Wirkt sofort – ohne Speichern.",
  live: "Jetzt",
  failed: "Speichern fehlgeschlagen",
} as const;
const S = LAGE_CARD_STRINGS;

const MODE_OPTIONS: readonly { v: LageSettings["mode"]; label: string }[] = [
  { v: "block", label: "Sperre" },
  { v: "warn", label: "Nur Warnung" },
];

const TONE: Readonly<Record<string, string>> = { green: "text-win", amber: "text-warn", red: "text-loss", none: "text-mute" };

/** The stored Lage settings (primitives, so the card re-renders only when they change). */
function useStoredLage(): LageSettings {
  const on = useJournal((s) => lageSettingsOf(s.settings.signals).on);
  const mode = useJournal((s) => lageSettingsOf(s.settings.signals).mode);
  return { on, mode };
}

/** Writes `settings.signals.lage` at once (three-way merged by the store like every settings save). */
async function writeLage(patch: Partial<LageSettings>): Promise<boolean> {
  const { settings, saveSettings } = useJournal.getState();
  const signals = withLageSettings(settings.signals, patch);
  if (signals === settings.signals) return true;
  try {
    await saveSettings({ ...settings, signals });
    return true;
  } catch {
    return false;
  }
}

/** Live state line (reads the Lage feed: the overview keeps it running anyway). */
function LiveLine() {
  const { lage } = useLage();
  if (!lage) return null;
  return (
    <p className="text-[12px] text-mute" data-testid="lage-card-live">
      {S.live}: <span className={cn("font-semibold", TONE[lage.state])}>{LAGE_STATE_WORD[lage.state]}</span> · {lage.title}
    </p>
  );
}

export const LageCard = memo(function LageCard() {
  const stored = useStoredLage();
  const pushToast = useUi((s) => s.pushToast);
  // optimistic: the switch moves on the tap, the store write follows (and the stored value wins afterwards)
  const [pending, setPending] = useState<Partial<LageSettings> | null>(null);
  const cur: LageSettings = { ...stored, ...pending };
  const apply = (patch: Partial<LageSettings>) => {
    setPending((p) => ({ ...p, ...patch }));
    void writeLage(patch).then((ok) => {
      setPending(null);
      if (!ok) pushToast({ kind: "error", title: S.failed });
    });
  };
  return (
    <Card title={S.title} note={S.note}>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start" data-testid="settings-lage" data-on={cur.on ? "on" : "off"} data-mode={cur.mode}>
        <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5">
          <span className="grid min-w-0 gap-0.5">
            <label htmlFor="s-lageOn" className="cursor-pointer text-[13px] text-fg">
              {S.on}
            </label>
            <span id="s-lageOn-help" className="max-w-[80ch] text-[11px] text-faint">
              {S.onHelp}
            </span>
          </span>
          <Switch id="s-lageOn" checked={cur.on} onCheckedChange={(on) => apply({ on })} aria-describedby="s-lageOn-help" className="touch-hit mt-0.5 shrink-0" />
        </div>
        <div className={cn("grid content-start gap-1.5 transition-opacity duration-200", !cur.on && "opacity-50")}>
          <span id="s-lageMode-label" className="label">
            {S.mode}
          </span>
          <Segmented<LageSettings["mode"]>
            aria-labelledby="s-lageMode-label"
            size="sm"
            className="justify-self-start"
            value={cur.mode}
            onChange={(mode) => apply({ mode })}
            options={MODE_OPTIONS.map((o) => ({ ...o, disabled: !cur.on }))}
          />
          <span className="text-[11px] leading-snug text-faint" data-testid="settings-lage-help">
            {cur.on ? `${LAGE_MODE_TEXT[cur.mode]}: ${S.modeHelp[cur.mode]}` : S.offHelp}
          </span>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line pt-3">
        <LiveLine />
        <span className="text-[11px] text-faint">{S.instant}</span>
      </div>
    </Card>
  );
});
