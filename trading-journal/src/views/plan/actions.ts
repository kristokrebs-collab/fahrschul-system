/**
 * Writes of the Handelsplan page. Everything goes through `settings.plan` (`withPlanCfg`: unknown keys and unreadable plans
 * survive) and, for the alarms, `settings.keyLevels` (`withKeyLevels`). Nothing is sent anywhere; a click is a click: saving,
 * creating the three alarms and drafting a journal trade each need their own button.
 */
import { keyLevelsOfSettings, MAX_KEY_LEVELS, withKeyLevels } from "@/domain/keylevels";
import { MAX_PLANS, pairOf, planAlarmLevels, planCfgOf, withPlanCfg, type MarketKind, type PlanForm, type PlanModel, type PlanPrefs, type SavedPlan } from "@/domain/plan";
import type { AccountId } from "@/domain/types";
import { nowLocalInput } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { useJournal } from "@/store/journalStore";
import { useUi, type TradeDraft } from "@/store/uiStore";

export type WriteResult = "ok" | "failed" | "limit" | "missing";

async function writeSettings(build: (s: ReturnType<typeof useJournal.getState>["settings"]) => Record<string, unknown> | null): Promise<boolean> {
  const { settings, saveSettings } = useJournal.getState();
  const patch = build(settings);
  if (!patch) return true;
  try {
    await saveSettings({ ...settings, ...patch });
    return true;
  } catch {
    return false;
  }
}

export async function savePrefs(patch: Partial<PlanPrefs>): Promise<WriteResult> {
  return (await writeSettings((s) => {
    const plan = withPlanCfg(s.plan, { prefs: patch });
    return plan === s.plan ? null : { plan };
  }))
    ? "ok"
    : "failed";
}

/** The saved plan a model + form make (id and time are the caller's). */
export function savedPlanOf(model: PlanModel, form: PlanForm, currency: string, id: string, now: number, prev?: SavedPlan | null): SavedPlan | null {
  const t = model.ticketPlan;
  const risk = model.risk;
  if (!t || !risk || !model.exit?.ok || !model.size?.ok) return null;
  return {
    id,
    savedAt: now,
    symbol: t.symbol,
    side: t.side,
    entry: t.entry,
    stop: t.stop,
    target: t.target,
    qty: t.qty,
    notional: t.notional,
    maxLoss: t.maxLoss,
    rr: t.rr,
    tick: model.tick,
    lot: model.lot,
    light: risk.light,
    currency,
    sourceLabel: t.sourceLabel,
    candlesUntil: t.candlesUntil,
    fetchedAt: t.fetchedAt,
    signalAt: t.signalAt,
    flatByMs: t.flatByMs,
    tz: t.tz,
    sessionLabel: t.sessionLabel,
    stopLabel: t.stopLabel,
    targetLabel: t.targetLabel,
    form,
    alarms: prev?.alarms ?? null,
    journalAt: prev?.journalAt ?? null,
  };
}

/** Saves the plan (a new entry at the front; at most `MAX_PLANS`, the oldest unsaved-alarm plan makes room). */
export async function savePlan(plan: SavedPlan): Promise<WriteResult> {
  const cfg = planCfgOf(useJournal.getState().settings.plan);
  if (!cfg.plans.some((p) => p.id === plan.id) && cfg.plans.length >= MAX_PLANS) return "limit";
  const plans = cfg.plans.some((p) => p.id === plan.id) ? cfg.plans.map((p) => (p.id === plan.id ? plan : p)) : [plan, ...cfg.plans];
  return (await writeSettings((s) => ({ plan: withPlanCfg(s.plan, { plans }) }))) ? "ok" : "failed";
}

/** Discards a plan – and, with it, the two key levels it created (the clock reminder goes with the plan). */
export async function discardPlan(id: string): Promise<WriteResult> {
  const cfg = planCfgOf(useJournal.getState().settings.plan);
  const plan = cfg.plans.find((p) => p.id === id);
  if (!plan) return "missing";
  const ok = await writeSettings((s) => {
    const next: Record<string, unknown> = { plan: withPlanCfg(s.plan, { plans: cfg.plans.filter((p) => p.id !== id) }) };
    if (plan.alarms) {
      const ids = new Set([plan.alarms.stopId, plan.alarms.targetId]);
      const kl = keyLevelsOfSettings(s);
      if (kl.levels.some((l) => ids.has(l.id))) next.keyLevels = withKeyLevels(s.keyLevels, { levels: kl.levels.filter((l) => !ids.has(l.id)) });
    }
    return next;
  });
  return ok ? "ok" : "failed";
}

/**
 * The three alarms of a plan: two key levels now, the clock reminder with the plan. The plan is saved by the same write.
 * `levels: false` (a stock plan) makes only the clock reminder: the key levels watch the live crypto market, a level for a stock
 * would never be evaluated.
 */
export async function createAlarms(plan: SavedPlan, tick: number, now: number = Date.now(), opts: { levels?: boolean } = {}): Promise<WriteResult> {
  const withLevels = opts.levels !== false;
  const kl0 = keyLevelsOfSettings(useJournal.getState().settings);
  if (withLevels && kl0.levels.length + 2 > MAX_KEY_LEVELS) return "limit";
  const ids = withLevels ? { stop: newId("k_"), target: newId("k_") } : { stop: "", target: "" };
  const levels = withLevels ? planAlarmLevels(plan, ids, tick, now) : null;
  const withAlarms: SavedPlan = {
    ...plan,
    alarms: { stopId: ids.stop, targetId: ids.target, createdAt: now, flatBy: plan.flatByMs != null && plan.flatByMs > now ? { at: plan.flatByMs, state: "pending", firedAt: null } : plan.flatByMs != null ? { at: plan.flatByMs, state: "missed", firedAt: null } : null },
  };
  const cfg = planCfgOf(useJournal.getState().settings.plan);
  const exists = cfg.plans.some((p) => p.id === plan.id);
  if (!exists && cfg.plans.length >= MAX_PLANS) return "limit";
  const plans = exists ? cfg.plans.map((p) => (p.id === plan.id ? withAlarms : p)) : [withAlarms, ...cfg.plans];
  const ok = await writeSettings((s) => ({
    plan: withPlanCfg(s.plan, { plans }),
    ...(levels ? { keyLevels: withKeyLevels(s.keyLevels, { levels: [...keyLevelsOfSettings(s).levels, levels.stop, levels.target] }) } : {}),
  }));
  return ok ? "ok" : "failed";
}

/** Removes the alarms of a plan again (the plan stays). */
export async function removeAlarms(plan: SavedPlan): Promise<WriteResult> {
  if (!plan.alarms) return "missing";
  const ids = new Set([plan.alarms.stopId, plan.alarms.targetId]);
  const cfg = planCfgOf(useJournal.getState().settings.plan);
  const plans = cfg.plans.map((p) => (p.id === plan.id ? { ...p, alarms: null } : p));
  const ok = await writeSettings((s) => ({
    plan: withPlanCfg(s.plan, { plans }),
    keyLevels: withKeyLevels(s.keyLevels, { levels: keyLevelsOfSettings(s).levels.filter((l) => !ids.has(l.id)) }),
  }));
  return ok ? "ok" : "failed";
}

/** What a journal draft needs from a plan (a ticket plan or a saved plan, plus the account). */
export interface DraftSource {
  symbol: string;
  side: SavedPlan["side"];
  entry: number;
  stop: number;
  target: number | null;
  qty: number;
  notional: number;
  leverage: number;
  account: AccountId;
  stopLabel: string;
  targetLabel: string;
  sessionLabel: string;
  /** where the entry came from (`ticketPlan.entrySource`): the Einstiegs-Timer's signal is a rule, the other two are the trader's own plan (F24) */
  entrySource?: "signal" | "level" | "manual";
  /** the market kind; absent = crypto */
  market?: MarketKind;
}

/** The journal draft of a plan: an OPEN trade the trader can edit; nothing is saved until the editor's own "Speichern". */
export function journalDraftOf(p: DraftSource, now: Date = new Date()): TradeDraft {
  return {
    account: p.account,
    side: p.side,
    status: "open",
    date: nowLocalInput(now),
    pair: pairOf(p.symbol, p.market),
    // a stock has neither funding nor leverage: the journal's "spot"
    ...(p.market === "stocks" ? { market: "spot" as const } : {}),
    entry: p.entry,
    stop: p.stop,
    target: p.target,
    size: Math.round(p.notional * 100) / 100,
    qty: Number(p.qty.toPrecision(8)),
    leverage: p.leverage,
    notes: `Aus dem Handelsplan: ${p.sessionLabel}. Stop: ${p.stopLabel}. Ziel: ${p.targetLabel}. Einstieg und Größe sind geplant, nicht ausgeführt.`,
    ...(p.entrySource ? { decision: { by: p.entrySource === "signal" ? ("rules" as const) : ("own" as const), via: "plan" as const } } : null),
  };
}

/** Opens the trade editor with the draft; if the plan is saved, it remembers that a draft was made. Nothing is saved as a trade. */
export async function planToJournal(p: DraftSource, savedId: string | null, now: Date = new Date()): Promise<void> {
  useUi.getState().openEditor({ draft: journalDraftOf(p, now) });
  if (!savedId) return;
  const cfg = planCfgOf(useJournal.getState().settings.plan);
  const plans = cfg.plans.map((x) => (x.id === savedId ? { ...x, journalAt: now.getTime() } : x));
  await writeSettings((s) => {
    const plan = withPlanCfg(s.plan, { plans });
    return plan === s.plan ? null : { plan };
  });
}
