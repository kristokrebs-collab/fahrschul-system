/**
 * Where the evaluation tools get their inputs: the app's own stores, read when the question is asked – each source is
 * imported on demand (a question about the Forward-Test never loads the signal archive), and NOTHING is computed, fetched
 * or started here: a result that does not exist yet stays missing, and the tool says where the trader starts it.
 * `ToolEnv.insight` (tests) replaces any of them.
 */
import type { ToolEnv } from "../tools";
import type { ExtraInput, ForwardInput, LabRunInput, SignalsInput, SimilarInput } from "./types";
import type { StressRows } from "@/domain/lab/stress/types";
import type { FilterCompare } from "@/domain/lab/filters";
import type { TrendView } from "@/market/trendlines/store";
import { isKeyTf, KEY_TIMEFRAMES, type KeyTf } from "@/domain/keylevels";

type Env = Pick<ToolEnv, "insight" | "data">;

/** The last finished Labor run, or `null`. */
export async function labRun(env: Env): Promise<LabRunInput | null> {
  if (env.insight && "lab" in env.insight) return env.insight.lab ?? null;
  const { useLabor } = await import("@/views/labor/laborStore");
  const s = useLabor.getState();
  return s.result ? { result: s.result, bars: s.bars, riskPct: s.runCfg?.riskPct ?? null } : null;
}

/** The stress scenarios the trader has computed for the shown run (`idle` when none). */
export async function stressRows(env: Env): Promise<ExtraInput<StressRows>> {
  if (env.insight?.stress) return env.insight.stress;
  const { useExtras } = await import("@/views/labor/extrasStore");
  const s = useExtras.getState().stress;
  return { status: s.status, result: s.result };
}

/** The filter comparison the trader has computed for the shown run (`idle` when none). */
export async function filterCompare(env: Env): Promise<ExtraInput<FilterCompare>> {
  if (env.insight?.filters) return env.insight.filters;
  const { useExtras } = await import("@/views/labor/extrasStore");
  const s = useExtras.getState().filters;
  return { status: s.status, result: s.result };
}

/** The virtual accounts of `settings.forward` and the comparisons with the backtest the trader started. */
export async function forwardAccounts(env: Env): Promise<ForwardInput> {
  if (env.insight?.forward) return env.insight.forward;
  const [{ forwardOfSettings }, { useForwardRuntime }] = await Promise.all([import("@/domain/forward"), import("@/views/labor/forward/forwardStore")]);
  return { accounts: forwardOfSettings(env.data.settings).accounts, compare: useForwardRuntime.getState().compare };
}

/** The trendlines per timeframe as the Markt page shows them (the evaluation is retained for the moment of reading only). */
export async function trendView(env: Env): Promise<TrendView> {
  if (env.insight?.trend) return env.insight.trend;
  const { retainTrendlines, getTrendlines } = await import("@/market/trendlines/store");
  const release = retainTrendlines();
  try {
    return getTrendlines();
  } finally {
    release();
  }
}

/** The signal archive, the outcomes that are already known (cache of final results + this session's), the delivery log and the presence trace. */
export async function signalsSource(env: Env): Promise<SignalsInput> {
  if (env.insight?.signals) return env.insight.signals;
  const [{ getSignalArchive }, { getDeliveryLog }, { presenceSegments }, outcomes] = await Promise.all([import("@/market/signalArchive"), import("@/market/keylevels/deliveryLog"), import("@/market/presence"), import("@/views/coach/signalOutcomes")]);
  const events = getSignalArchive();
  const known = new Map(outcomes.cachedOutcomes(outcomes.outcomeEvents(events)));
  for (const [id, o] of outcomes.getOutcomeState().outcomes) known.set(id, o);
  return { events, outcomes: known, log: getDeliveryLog(), presence: presenceSegments() };
}

/** The word-boundary timeframe the question names (`4h`, `1d` …), else `null`. */
export function tfOfQuestion(norm: string): KeyTf | null {
  const m = /\b(30m|1h|2h|3h|4h|1d|1w)\b/.exec(norm);
  if (!m) return null;
  const hit = KEY_TIMEFRAMES.find((t) => t.toLowerCase() === m[1]);
  return hit && isKeyTf(hit) ? hit : null;
}

/** „Ähnliche Situationen“ with the card's own choices (timeframe, horizon, unit, features), computed from the closed candles of the live feed. */
export async function similarSource(env: Env, norm: string): Promise<SimilarInput> {
  if (env.insight?.similar) return env.insight.similar;
  const [{ getProvider }, { feedAvailability, levelCandles }, { timeframeAvailability }, { readPrefs }, { findSimilar }] = await Promise.all([
    import("@/market/marketStore"),
    import("@/market/keylevels/candles"),
    import("@/domain/keylevels"),
    import("@/views/markt/similarPrefs"),
    import("@/domain/similar"),
  ]);
  const prefs = readPrefs();
  const tf = tfOfQuestion(norm) ?? prefs.tf;
  const base = { tf, horizon: prefs.horizon, unit: prefs.unit };
  const provider = getProvider();
  if (!provider) return { ...base, state: "idle", reason: null, result: null };
  const avail = timeframeAvailability(feedAvailability(provider)).find((a) => a.tf === tf);
  const candles = avail?.ok ? levelCandles(provider, tf) : null;
  if (!candles) return { ...base, state: "waiting", reason: avail && !avail.ok ? avail.reason : null, result: null };
  return { ...base, state: "ok", reason: null, result: findSimilar(candles, tf, provider.serverNow(), { features: prefs.features, horizon: prefs.horizon, unit: prefs.unit, minGap: prefs.horizon }) };
}

/** `settings.evolve` (the optimiser's proposals, counters and learning) as the journal holds it. */
export function evolveSource(env: Env): unknown {
  if (env.insight && "evolve" in env.insight) return env.insight.evolve;
  return (env.data.settings as { evolve?: unknown }).evolve;
}
