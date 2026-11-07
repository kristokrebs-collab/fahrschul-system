/**
 * „Flat by close“ – der dritte Alarm eines Plans (Plan → 3 Alarme): eine Erinnerung zur Uhrzeit, die der Nutzer gesetzt hat.
 * Stop und Ziel sind Schlüsselmarken (`src/market/keylevels`); eine Uhrzeit ist kein Preis, das Marken-Modell kennt nur Preise.
 * Darum läuft die Erinnerung hier, über dieselben Wege wie die Marken-Alarme: Toast und – wenn erlaubt und die Seite nicht
 * vorn ist – Systemmitteilung, aktive Zeiten und Kanäle aus den Alarm-Einstellungen, jede Zustellung (auch eine unterdrückte)
 * als Zeile im Zustellprotokoll.
 *
 * Nur bei geöffneter App; ein Timer auf die nächste Zeit (nie ein Takt), neu geprüft beim Zurückkehren in den Tab. Eine
 * Erinnerung, die erst Stunden später gefunden wird (App war zu), meldet sich nicht mehr, sondern gilt still als verpasst.
 * Eine Erinnerung ist eine Nachricht – die App schließt nichts.
 */
import { useEffect } from "react";
import { keyLevelsOfSettings, quietOutcome, type DeliveryChannel } from "@/domain/keylevels";
import { dueFlatBy, flatByMessage, nextFlatBy } from "@/domain/plan/alarms";
import { planCfgOf, withPlanCfg, type SavedPlan } from "@/domain/plan/config";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { recordDelivery } from "../keylevels/deliveryLog";

/** Timers beyond ~24 days overflow; a sleeping laptop wakes late anyway, so look again at least this often. */
const MAX_WAIT_MS = 6 * 3_600_000;
const TOAST_MS = 9_000;

const inFlight = new Set<string>();

function systemNotification(title: string, body: string, tag: string): boolean {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
    const inFront = typeof document !== "undefined" && !document.hidden && (typeof document.hasFocus !== "function" || document.hasFocus());
    if (inFront) return false;
    new Notification(title, { body, tag });
    return true;
  } catch {
    return false;
  }
}

/** Announces the due reminders and writes their state back (`fired`, or `missed` when found too late). */
export async function runFlatBy(now: number = Date.now()): Promise<number> {
  const { settings, saveSettings } = useJournal.getState();
  const cfg = planCfgOf(settings.plan);
  const due = dueFlatBy(cfg.plans, now).filter((d) => !inFlight.has(d.plan.id));
  if (!due.length) return 0;
  const alerts = keyLevelsOfSettings(settings).alerts;
  const changed = new Map<string, SavedPlan>();
  for (const d of due) {
    inFlight.add(d.plan.id);
    const flat = d.plan.alarms!.flatBy!;
    if (d.stale) {
      changed.set(d.plan.id, { ...d.plan, alarms: { ...d.plan.alarms!, flatBy: { ...flat, state: "missed", firedAt: null } } });
      continue;
    }
    const msg = flatByMessage(d.plan, d.lateMin);
    const quiet = quietOutcome(alerts, now);
    const used: DeliveryChannel[] = [];
    if (!quiet) {
      if (alerts.channels.toast) {
        pushToast({ kind: "signal", title: msg.title, detail: msg.detail, duration: TOAST_MS });
        used.push("toast");
      }
      if (alerts.channels.system && systemNotification(msg.title, msg.detail, `plan-flat|${d.plan.id}`)) used.push("system");
    }
    recordDelivery({
      source: "key",
      levelId: null,
      title: msg.title,
      detail: msg.detail,
      stage: null,
      basis: "close",
      channels: used,
      outcome: quiet ? quiet.outcome : used.length ? "sent" : "channels",
      dedupeKey: `plan-flat|${d.plan.id}|${flat.at}`,
      at: now,
    });
    changed.set(d.plan.id, { ...d.plan, alarms: { ...d.plan.alarms!, flatBy: { ...flat, state: "fired", firedAt: now } } });
  }
  try {
    const latest = useJournal.getState().settings;
    const plans = planCfgOf(latest.plan).plans.map((p) => changed.get(p.id) ?? p);
    const plan = withPlanCfg(latest.plan, { plans });
    if (plan !== latest.plan) await saveSettings({ ...latest, plan });
  } finally {
    for (const id of changed.keys()) inFlight.delete(id);
  }
  return changed.size;
}

/** Keeps the next "flat by" reminder armed while the app is open. Renders nothing. */
export function PlanClockHost(): null {
  const raw = useJournal((s) => s.settings.plan);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const arm = (): void => {
      if (timer) clearTimeout(timer);
      if (!alive) return;
      const now = Date.now();
      const next = nextFlatBy(planCfgOf(useJournal.getState().settings.plan).plans, now);
      if (next != null) timer = setTimeout(() => void run(), Math.min(MAX_WAIT_MS, Math.max(250, next - now + 50)));
    };
    const run = async (): Promise<void> => {
      await runFlatBy().catch(() => 0);
      arm();
    };
    const onVisible = (): void => {
      if (typeof document === "undefined" || !document.hidden) void run();
    };
    void run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [raw]);
  return null;
}
