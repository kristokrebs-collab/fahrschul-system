/**
 * Karte „Alarme & Zustellprotokoll“ (F22): the channels that exist today (toast, system notification), active hours, the
 * „Vorbereitung“ distance, the cooldown against duplicates – and the visible log of what was sent, what was held back
 * and why (`Zustellprotokoll`, stored in this browser, the last 200). The per-level stages and the one-shot / recurring
 * choice live in the level's editor. The card says plainly that these alerts only run while the app is open; the section
 * „E-Mail-Alarm bei geschlossener App“ (F21, `EmailAlertSection`) is the optional server-side counterpart for accounts.
 */
import { memo, useState } from "react";
import { keyLevelsOfSettings, OUTCOME_LABEL, STAGE_LABEL, type AlertSettings, type DeliveryRecord, type DistanceMode } from "@/domain/keylevels";
import { cn } from "@/lib/cn";
import { parseNumber, toInputString } from "@/lib/parse";
import { clearDeliveryLog, useDeliveryLog } from "@/market/keylevels";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { EmailAlertSection } from "./EmailAlertSection";
import { BASIS_LABEL, ALERTS as A, OUTCOME_TONE } from "./strings";
import { SwitchRow } from "./SwitchRow";
import { saveAlertSettings } from "./writes";

const COOLDOWNS = [0, 10, 30, 60, 120, 240].map((m) => ({ value: String(m), label: A.cooldownOpt(m) }));
const SHOWN = 40;

function useAlertSettings(): AlertSettings {
  const raw = useJournal((s) => s.settings.keyLevels);
  return keyLevelsOfSettings({ keyLevels: raw } as { keyLevels?: unknown }).alerts;
}

const stamp = (t: number): string => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function LogRow({ r }: { r: DeliveryRecord }) {
  const tone = OUTCOME_TONE[r.outcome];
  return (
    <li className="grid gap-1 rounded-xl border border-line bg-ink-950/40 px-3 py-2" data-testid="delivery-row" data-outcome={r.outcome}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="num font-mono text-[11.5px] text-faint">{stamp(r.at)}</span>
        <Badge tone={tone}>{OUTCOME_LABEL[r.outcome]}</Badge>
        <Badge tone="mute">{A.source[r.source]}</Badge>
        {r.stage && <Badge tone="mute">{STAGE_LABEL[r.stage]}</Badge>}
        {r.basis && <Badge tone={r.basis === "intrabar" ? "warn" : "mute"}>{BASIS_LABEL[r.basis]}</Badge>}
        <span className="ml-auto text-[11px] text-faint">{r.channels.length ? r.channels.map((c) => A.channelWord[c]).join(" + ") : A.noChannel}</span>
      </div>
      <p className="text-[12.5px] leading-snug text-fg">{r.title}</p>
      {r.detail && <p className="text-[11.5px] leading-snug text-mute">{r.detail}</p>}
    </li>
  );
}

export const AlertsCard = memo(function AlertsCard() {
  const cfg = useAlertSettings();
  const log = useDeliveryLog();
  const pushToast = useUi((s) => s.pushToast);
  const [hint, setHint] = useState<string | null>(null);
  const [prep, setPrep] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const apply = async (patch: Partial<AlertSettings>) => {
    if ((await saveAlertSettings(patch)) !== "ok") pushToast({ kind: "error", title: "Speichern fehlgeschlagen" });
  };
  const onSystem = async (on: boolean) => {
    if (!on) return apply({ channels: { ...cfg.channels, system: false } });
    if (typeof window === "undefined" || !("Notification" in window)) return setHint(A.systemUnsupported);
    const perm = Notification.permission === "default" ? await Notification.requestPermission().catch(() => "denied" as NotificationPermission) : Notification.permission;
    if (perm !== "granted") return setHint(A.systemDenied);
    setHint(null);
    return apply({ channels: { ...cfg.channels, system: true } });
  };
  const commitPrepare = () => {
    if (prep == null) return;
    const v = parseNumber(prep);
    setPrep(null);
    if (v != null && v >= 0 && v <= 1000) void apply({ prepare: { ...cfg.prepare, value: v } });
  };
  const shown = all ? log : log.slice(0, SHOWN);

  return (
    <Card title={A.title} note={A.note} data-testid="alerts-card">
      <div className="grid gap-5">
        <p className="rounded-xl border border-line-2 bg-white/[0.03] px-3 py-2 text-[12.5px] leading-snug text-mute" role="note" data-testid="alerts-honest">
          {A.honest}
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid content-start gap-2">
            <span className="label">{A.channels}</span>
            <SwitchRow id="kla-toast" label={A.toast} help={A.toastHelp} checked={cfg.channels.toast} onChange={(toast) => void apply({ channels: { ...cfg.channels, toast } })} />
            <SwitchRow id="kla-system" label={A.system} help={hint ?? A.systemHelp} checked={cfg.channels.system} onChange={(v) => void onSystem(v)} />
          </div>

          <div className="grid content-start gap-3">
            <SwitchRow id="kla-hours" label={A.hours} help={A.hoursHelp} checked={cfg.hours.on} onChange={(on) => void apply({ hours: { ...cfg.hours, on } })} />
            <div className={cn("grid grid-cols-2 gap-3 transition-opacity duration-200", !cfg.hours.on && "opacity-50")}>
              <Field label={A.from} htmlFor="kla-from">
                <Input id="kla-from" type="time" value={cfg.hours.from} disabled={!cfg.hours.on} onChange={(e) => e.target.value && void apply({ hours: { ...cfg.hours, from: e.target.value } })} />
              </Field>
              <Field label={A.to} htmlFor="kla-to">
                <Input id="kla-to" type="time" value={cfg.hours.to} disabled={!cfg.hours.on} onChange={(e) => e.target.value && void apply({ hours: { ...cfg.hours, to: e.target.value } })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={A.prepare} htmlFor="kla-prep" help={A.prepareHelp}>
                <Input id="kla-prep" numeric value={prep ?? toInputString(cfg.prepare.value)} onChange={(e) => setPrep(e.target.value)} onBlur={commitPrepare} onKeyDown={(e) => e.key === "Enter" && commitPrepare()} autoComplete="off" />
              </Field>
              <div className="grid content-start gap-1.5">
                <span id="kla-unit-l" className="label">
                  Einheit
                </span>
                <Segmented<DistanceMode> aria-labelledby="kla-unit-l" size="md" className="justify-self-start" value={cfg.prepare.mode} onChange={(mode) => void apply({ prepare: { ...cfg.prepare, mode } })} options={[{ v: "pct", label: "%" }, { v: "atr", label: "× ATR" }]} />
              </div>
            </div>
            <Field label={A.cooldown} htmlFor="kla-cd" help={A.cooldownHelp}>
              <MorphSelect id="kla-cd" value={String(cfg.cooldownMin)} onChange={(v) => void apply({ cooldownMin: Number(v) })} options={COOLDOWNS} />
            </Field>
          </div>
        </div>

        <EmailAlertSection />

        <div className="grid gap-2 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="grid gap-0.5">
              <h3 className="label">{A.log}</h3>
              <p className="text-[11px] text-faint">{A.logNote}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={log.length === 0}
              onClick={() => {
                clearDeliveryLog();
                pushToast({ kind: "info", title: A.logCleared });
              }}
            >
              {A.logClear}
            </Button>
          </div>
          {log.length === 0 ? (
            <p className="text-[12.5px] text-mute" data-testid="delivery-empty">
              {A.logEmpty}
            </p>
          ) : (
            <ul className="grid gap-1.5" aria-label={A.log} data-testid="delivery-log">
              {shown.map((r) => (
                <LogRow key={r.id} r={r} />
              ))}
            </ul>
          )}
          {log.length > SHOWN && !all && (
            <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setAll(true)}>
              Alle {log.length} anzeigen
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
});
