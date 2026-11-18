/**
 * Mehrstufige Alarme and Plan-Wechsel for the key levels (F22 / F08), the browser-side runtime.
 *
 * `KeyLevelHost` (mounted once next to the other hosts) keeps the evaluation running while the user has an own level and
 * steps the pure stage machine (`stepStages`) for every own level whose alerts are on. A stage that fires goes through
 * `decideDelivery` (channels → active hours → dedupe/cooldown) and is ALWAYS written to the Zustellprotokoll, delivered
 * or held back, with the reason. Channels are the ones that exist today: the toast island (`pushToast`, kind `signal`)
 * and – permission granted, page not in front – a system notification.
 *
 * Honest limit: this runs only while the app is open in a browser tab. A closed tab, a closed browser or a sleeping
 * phone gets nothing; there is no server-side monitoring.
 *
 * Quiet by construction: the first look at a level only remembers where it stands (nothing already true is announced,
 * also after a reload – the stage memory is stored); editing a level's price, timeframe, rule or distance starts it
 * over; the five fixed levels never alert (their behaviour is unchanged); a level that is switched off forgets.
 */
import { useEffect } from "react";
import {
  dedupeKey,
  decideDelivery,
  keyLevelsOfSettings,
  levelFingerprint,
  parseWatchMems,
  planChange,
  planToastOn,
  quietOutcome,
  stageMessage,
  stepWatch,
  type AlertStage,
  type AlertSettings,
  type DeliveryChannel,
  type KeyLevel,
  type LevelEvaluation,
  KEY_TF_MS,
  type PlanMemory,
  type WatchMems,
} from "@/domain/keylevels";
import { useJournal } from "@/store/journalStore";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { pushToast } from "@/store/uiStore";
import { recordKeySignal } from "../signalRecord";
import { getDeliveryLog, recordDelivery } from "./deliveryLog";
import { getKeyLevels, retainKeyLevels, subscribeKeyLevels, type KeyLevelsView } from "./store";

export const KEYLEVEL_MEM_KEY = storageKey("keylevel-mem");
export const KEYLEVEL_PLAN_KEY = storageKey("keylevel-plan");
export const KEYLEVEL_TOAST_MS = 5200;

interface PlanStored {
  mem: PlanMemory | null;
  last: { from: PlanMemory["active"]; to: PlanMemory["active"]; at: number } | null;
}

let mems: WatchMems | null = null;
let planStored: PlanStored | null = null;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function loadMems(): WatchMems {
  mems ??= parseWatchMems(readJson<unknown>(KEYLEVEL_MEM_KEY, {}));
  return mems;
}

function loadPlan(): PlanStored {
  if (!planStored) {
    const raw = readJson<unknown>(KEYLEVEL_PLAN_KEY, null);
    planStored = isObj(raw) ? { mem: (raw.mem as PlanMemory | null) ?? null, last: (raw.last as PlanStored["last"]) ?? null } : { mem: null, last: null };
  }
  return planStored;
}

/** What a stored stage memory is valid for: any change of these starts the level over (shared with the server watch). */
export { levelFingerprint };

/** System notification while the page is not in front (the toast already shows it otherwise). `true` = shown. */
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

function deliver(level: KeyLevel, stage: AlertStage, ev: LevelEvaluation, cycle: number, settings: AlertSettings, now: number): void {
  const key = dedupeKey(level.id, cycle, stage);
  const msg = stageMessage(level, stage, ev);
  const decision = decideDelivery({ levelId: level.id, stage, cycle, now }, settings, getDeliveryLog());
  const used: DeliveryChannel[] = [];
  if (decision.send) {
    if (decision.channels.includes("toast")) {
      pushToast({ kind: "signal", title: msg.title, detail: msg.detail, duration: KEYLEVEL_TOAST_MS });
      used.push("toast");
    }
    if (decision.channels.includes("system") && systemNotification(msg.title, msg.detail, key)) used.push("system");
  }
  const outcome = decision.send && !used.length ? "channels" : decision.outcome;
  recordDelivery({ source: "key", levelId: level.id, title: msg.title, detail: msg.detail, stage, basis: msg.basis, channels: used, outcome, dedupeKey: key, at: now });
  // F32: a confirmation / retest of an own level is a hit with a time (the stage fired whether or not the message was held back)
  if ((stage === "confirm" || stage === "retest") && decision.outcome !== "duplicate") {
    const side = level.role === "long" || level.role === "short" ? level.role : level.role === "auto" ? (level.direction === "above" ? "long" : "short") : null;
    recordKeySignal({ key: `key|${key}`, at: now, source: "key", kind: stage, entry: side != null, symbol: level.symbol, side, tf: level.tf, label: msg.title, detail: msg.detail, strength: null, score: null, ref: level.id, stop: level.invalidation, barClose: ev.basis === "close" && ev.asOf != null ? ev.asOf + KEY_TF_MS[level.tf] : null }, level, stage, ev);
  }
}

/**
 * Steps every own level of a published view (`stepWatch`, the core the e-mail alarm on the server shares) and delivers
 * what fired. Pure given the stores; exported for tests.
 */
export function processKeyLevelView(view: KeyLevelsView, now: number = Date.now()): void {
  if (view.state !== "ok") return;
  const res = stepWatch(loadMems(), view.entries, now);
  if (res.dirty) {
    mems = res.mems;
    writeJson(KEYLEVEL_MEM_KEY, res.mems);
  }
  for (const f of res.fires) deliver(f.level, f.stage, f.evaluation, f.cycle, view.alerts, now);
}

/** Announces a relevant change of the day plan (once, quiet, never on the first plan or a data hiccup). */
export function processPlanView(view: KeyLevelsView, now: number = Date.now()): void {
  if (view.state !== "ok" || view.plan.reason === "data") return;
  const cfg = keyLevelsOfSettings(useJournal.getState().settings);
  const st = loadPlan();
  const plan = view.plan;
  const change = planChange(st.mem, plan, now, st.last);
  if (st.mem && st.mem.key === plan.key) return;
  if (change && st.mem && planToastOn(cfg)) {
    const quiet = quietOutcome(view.alerts, now);
    const key = `plan|${st.mem.active}>${plan.active}`;
    const used: DeliveryChannel[] = [];
    if (!quiet) {
      if (view.alerts.channels.toast) {
        pushToast({ kind: "signal", title: change.title, detail: change.detail, duration: KEYLEVEL_TOAST_MS });
        used.push("toast");
      }
      if (view.alerts.channels.system && systemNotification(change.title, change.detail, key)) used.push("system");
    }
    recordDelivery({ source: "key", levelId: null, title: change.title, detail: change.detail, stage: null, basis: "close", channels: used, outcome: quiet ? quiet.outcome : used.length ? "sent" : "channels", dedupeKey: key, at: now });
    st.last = { from: st.mem.active, to: plan.active, at: now };
  }
  st.mem = { key: plan.key, active: plan.active, reason: plan.reason, at: now };
  writeJson(KEYLEVEL_PLAN_KEY, st);
}

/** Runs the alerts and the plan watcher while the evaluation runs. Returns the stop. */
export function startKeyLevelAlerts(): () => void {
  const release = retainKeyLevels();
  const run = (): void => {
    const view = getKeyLevels();
    processKeyLevelView(view);
    processPlanView(view);
  };
  const off = subscribeKeyLevels(run);
  run();
  return () => {
    off();
    release();
  };
}

/** Leaf host: keeps the key-level alerts running while the user has an own, enabled level. Renders nothing. */
export function KeyLevelHost(): null {
  const wanted = useJournal((s) => keyLevelsOfSettings(s.settings).levels.some((l) => l.enabled));
  useEffect(() => (wanted ? startKeyLevelAlerts() : undefined), [wanted]);
  return null;
}

/** "Erneut scharf stellen": a one-shot level gets a fresh memory (next first look is silent again). */
export function rearmKeyLevel(id: string): void {
  const store = loadMems();
  if (!store[id]) return;
  delete store[id];
  writeJson(KEYLEVEL_MEM_KEY, store);
}

/** Tests: forget the in-memory copies (the stored keys are the caller's business). */
export function __resetKeyLevelAlerts(): void {
  mems = null;
  planStored = null;
}
