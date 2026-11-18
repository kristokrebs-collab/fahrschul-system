/**
 * One look of the four alarms (scheduled every 5 minutes, `alerts-cron.mts`): who watches what → read the sources that are due → the engine
 * (`stepAlerts`, pure) → events, deliveries and jobs, written in ONE database call per event (`alert_enqueue`) → the engine's memory.
 *
 * Exactly once: the events are written BEFORE the memory. A run that dies in between is repeated by the next one with the old memory; it
 * decides the same events with the same dedupe keys, and the database refuses the second row (`duplicates` in the summary). Nothing is
 * mailed or dialed here – deliveries are queued as jobs; `deliver.ts` takes them.
 *
 * Quiet by construction: an account without a source on is never read; a source is read at most as often as its `everyMs` (the industry file
 * every 6 hours, Binance every 5 minutes); a run in which nothing changes writes nothing but the one-row bookkeeping. Logs: counts and codes.
 */
import { alertPrefsOf, limitPrefsToPlan, sourcesOn } from "../../../../src/domain/alerts/config";
import { planDeliveries } from "../../../../src/domain/alerts/delivery";
import { parseMemoryMap, stepAlerts } from "../../../../src/domain/alerts/engine";
import { isQuiet, safeZone } from "../../../../src/domain/alerts/quiet";
import { ALERT_SOURCE_KINDS, type AlertReading, type AlertSource, type AlertSourceKind, type SourceParams } from "../../../../src/domain/alerts/types";
import type { PlanId } from "../../../../src/billing/types";
import { mailConfig } from "../alertWatch/mail";
import { recipientOf, type Recipient } from "../alertWatch/recipient";
import { alertLimits, plansOf } from "./limits";
import { industrySource, keylevelSource, whaleSource, type RunLoaders } from "./sources";
import { AlertsMigrationMissing, type AlertStore } from "./store";
import { twilioConfig } from "./twilio";

export const RUN_BUDGET_MS = 24_000;
export const RUN_INTERVAL_MS = 5 * 60_000;
export const ACCOUNTS_MAX = 200;
/** a cron that fires a few seconds early must not skip a source whose period has "almost" passed */
const GRACE_MS = 60_000;

export interface RunDeps {
  store: AlertStore;
  loaders: RunLoaders;
  now?: number;
  plans?: (ids: string[]) => Promise<Map<string, PlanId>>;
  /** Twilio and Resend configured (default: read from the env) */
  twilioReady?: boolean;
  mailReady?: boolean;
  recipient?: (userId: string) => Promise<Recipient | null>;
  budgetMs?: number;
}

export interface RunSummary {
  enabled: boolean;
  /** accounts with a source on that the run read */
  users: number;
  /** accounts that had something to look at in this run */
  watched: number;
  /** readings per source this run */
  readings: Record<AlertSourceKind, number>;
  fires: number;
  /** events the engine held back (cooldown) */
  suppressed: number;
  /** deliveries queued / skipped (with a reason) */
  queued: number;
  skipped: number;
  /** events the database already had (a repeated run) */
  duplicates: number;
  /** markets whose reading was too old to use */
  stale: number;
  /** accounts left for the next run (time) */
  deferred: number;
  errors: number;
  /** `migration` | `db` | null */
  code: string | null;
}

export const emptyRunSummary = (): RunSummary => ({ enabled: true, users: 0, watched: 0, readings: { industry: 0, whale: 0, keylevel: 0 }, fires: 0, suppressed: 0, queued: 0, skipped: 0, duplicates: 0, stale: 0, deferred: 0, errors: 0, code: null });

export async function runAlerts(deps: RunDeps): Promise<RunSummary> {
  const started = Date.now();
  const now = deps.now ?? started;
  const deadline = started + (deps.budgetMs ?? RUN_BUDGET_MS);
  const { store } = deps;
  const tally = emptyRunSummary();

  let candidates;
  try {
    candidates = await store.candidates(ACCOUNTS_MAX, String(Math.floor(now / RUN_INTERVAL_MS)));
  } catch (e) {
    tally.code = e instanceof AlertsMigrationMissing ? "migration" : "db";
    console.error("[fn] alerts candidates failed", tally.code);
    await store.saveRunState({ at: now, ok: false, code: tally.code });
    return tally;
  }
  tally.users = candidates.length;
  if (!candidates.length) return tally;

  const state = (await store.runState()) ?? {};
  const lastRead = typeof state.read === "object" && state.read !== null ? (state.read as Record<string, number>) : {};
  const sources: Record<AlertSourceKind, AlertSource> = {
    industry: industrySource(deps.loaders.industry),
    whale: whaleSource(deps.loaders.ratio),
    keylevel: keylevelSource(deps.loaders.keyLevels, (u) => store.userKeyLevels(u)),
  };
  const due = new Set<AlertSourceKind>(ALERT_SOURCE_KINDS.filter((k) => now - (Number(lastRead[k]) || 0) >= sources[k].everyMs - GRACE_MS));
  const readOk = new Set<AlertSourceKind>();
  const maxAgeMs = Object.fromEntries(ALERT_SOURCE_KINDS.map((k) => [k, sources[k].maxAgeMs]));

  const plans = await (deps.plans ?? plansOf)(candidates.map((c) => c.userId));
  const twilioReady = deps.twilioReady ?? twilioConfig() !== null;
  const mailReady = deps.mailReady ?? mailConfig() !== null;
  const recipient = deps.recipient ?? recipientOf;

  for (const c of candidates) {
    if (Date.now() >= deadline) {
      tally.deferred += 1;
      continue;
    }
    try {
      await lookAt(c, { now, tally, sources, due, readOk, maxAgeMs, plans, twilioReady, mailReady, recipient, store });
    } catch (e) {
      tally.errors += 1;
      if (e instanceof AlertsMigrationMissing) tally.code ??= "migration";
      console.error("[fn] alerts account failed", e instanceof Error ? e.name : typeof e);
    }
  }

  const read = { ...lastRead };
  for (const k of readOk) read[k] = now;
  await store.saveRunState({ at: now, ok: tally.code == null && tally.errors === 0, code: tally.code, read, users: tally.users, fires: tally.fires, queued: tally.queued });
  return tally;
}

interface Ctx {
  now: number;
  tally: RunSummary;
  sources: Record<AlertSourceKind, AlertSource>;
  due: Set<AlertSourceKind>;
  readOk: Set<AlertSourceKind>;
  maxAgeMs: Record<string, number>;
  plans: Map<string, PlanId>;
  twilioReady: boolean;
  mailReady: boolean;
  recipient: (userId: string) => Promise<Recipient | null>;
  store: AlertStore;
}

async function lookAt(c: { userId: string; prefs: unknown; tz: string }, x: Ctx): Promise<void> {
  const { now, tally, store } = x;
  const prefs = alertPrefsOf(c.prefs);
  const tz = safeZone(c.tz);
  const eff = limitPrefsToPlan(prefs, alertLimits(x.plans.get(c.userId) ?? "free"));

  const readings: AlertReading[] = [];
  for (const kind of sourcesOn(prefs)) {
    if (!x.due.has(kind)) continue;
    const sp = prefs.sources[kind];
    if ((kind === "industry" || kind === "whale") && sp.markets.length === 0) continue;
    const rs = await x.sources[kind].read({ now, markets: sp.markets, params: sp.params, userId: c.userId });
    x.readOk.add(kind);
    tally.readings[kind] += rs.length;
    readings.push(...rs);
  }
  if (!readings.length) return;
  tally.watched += 1;

  const before = parseMemoryMap(await store.loadMemory(c.userId));
  const params: Record<string, SourceParams> = { industry: prefs.sources.industry.params, whale: prefs.sources.whale.params, keylevel: prefs.sources.keylevel.params };
  const step = stepAlerts(before, readings, { now, userId: c.userId, params, cooldownMs: prefs.cooldownMin * 60_000, maxAgeMs: x.maxAgeMs, quiet: (ms) => isQuiet(prefs.quiet, ms, tz) });
  tally.stale += step.skipped.length;

  // readiness of the channels is looked up only when an event wants them
  let phoneReady: boolean | null = null;
  let emailReady: boolean | null = null;
  for (const f of step.fires) {
    tally.fires += 1;
    if (f.suppressed) tally.suppressed += 1;
    if (!f.suppressed && eff.channels.phone[f.event] && phoneReady === null) phoneReady = x.twilioReady && (await store.phoneSecret(c.userId))?.verified === true;
    if (!f.suppressed && eff.channels.email[f.event] && emailReady === null) emailReady = x.mailReady && ((await x.recipient(c.userId))?.confirmed ?? false);
    const deliveries = planDeliveries(f, { now, tz, prefs: eff, phoneReady: phoneReady === true, emailReady: emailReady === true });
    const id = await store.enqueue({
      userId: c.userId,
      dedupKey: f.dedupKey,
      source: f.source,
      marketKey: f.key,
      market: f.market,
      event: f.event,
      value: f.value,
      detail: f.detail,
      suppressed: f.suppressed,
      occurredAt: f.at,
      deliveries: deliveries.map((d) => ({ channel: d.channel, status: d.status, reason: d.reason, runAt: d.runAt })),
    });
    if (id === null) tally.duplicates += 1;
    else {
      tally.queued += deliveries.filter((d) => d.status === "queued").length;
      tally.skipped += deliveries.filter((d) => d.status === "skipped").length;
    }
  }

  // the memory last: a run that died before this line is repeated with the old memory and the same dedupe keys
  const kinds = new Set(sourcesOn(prefs));
  const next = Object.fromEntries(Object.entries(step.memory).filter(([k]) => kinds.has(k.split(":")[0] as AlertSourceKind)));
  if (JSON.stringify(next) !== JSON.stringify(before)) await store.saveMemory(c.userId, next);
}
