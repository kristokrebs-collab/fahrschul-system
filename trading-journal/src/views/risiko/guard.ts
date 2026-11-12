/**
 * Risk guard (P05): watches the journal store and, after a save, says what the save did to the limits – one toast
 * (worst warning first) and the pause (cooldown) after a breached day or a losing streak. It NEVER blocks: the user
 * can override the pause with a hold ("Limit überschreiben", logged with time), and every check is only a warning.
 *
 * State per device (`localStorage` `storageKey("risk-guard")`, try/catch – a private window simply starts empty):
 * - `marks`: trade id → the moment the guard saw the trade close (stands in for a missing `exitDate`, so a loss saved
 *   now starts its pause now – an old trade edited later never restarts one; only records whose `updatedAt` is fresh
 *   count, and a bulk change of more than `BULK_CHANGE` records – import, restore, a sync snapshot – is ignored);
 * - `override`: `{ at, until }` of the last "Limit überschreiben".
 * Mounted once by `RiskGuardHost` (P14: App.tsx leaf with `data-layer`, after SetupEditor, before Celebrate).
 */
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { limitStatus, riskLimits, riskWarnings, type LimitReport, type RiskScope, type RiskWarning } from "@/domain/risk";
import type { AccountId, Settings, Trade } from "@/domain/types";
import { useExchangePositions, type ExchangePosition } from "@/exchanges/positions";
import { getEnriched, useJournal } from "@/store/journalStore";
import { readJsonDetailed, storageKey, writeJson } from "@/store/storage";
import { pushToast } from "@/store/uiStore";

export const GUARD_KEY = storageKey("risk-guard");
/** Marks kept at most (newest first) and their age limit. */
export const MARKS_MAX = 200;
export const MARKS_TTL_MS = 14 * 86_400_000;

export interface GuardOverride {
  at: number;
  until: number;
}

interface GuardPersisted {
  marks: Record<string, number>;
  override: GuardOverride | null;
}

interface GuardState extends GuardPersisted {
  mark(ids: readonly string[], at: number): void;
  overrideUntil(until: number, at?: number): void;
  clearOverride(): void;
}

function load(): GuardPersisted {
  const r = readJsonDetailed<Partial<GuardPersisted>>(GUARD_KEY);
  if (r.status !== "ok" || !r.value || typeof r.value !== "object") return { marks: {}, override: null };
  const marks: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.value.marks ?? {})) if (typeof v === "number" && Number.isFinite(v)) marks[k] = v;
  const o = r.value.override;
  const override = o && typeof o.at === "number" && typeof o.until === "number" ? { at: o.at, until: o.until } : null;
  return { marks, override };
}

const save = (s: GuardPersisted): void => {
  writeJson(GUARD_KEY, { marks: s.marks, override: s.override });
};

/** Keeps the newest `MARKS_MAX` marks younger than `MARKS_TTL_MS`. */
export function pruneMarks(marks: Record<string, number>, now: number): Record<string, number> {
  const kept = Object.entries(marks)
    .filter(([, t]) => now - t <= MARKS_TTL_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MARKS_MAX);
  return Object.fromEntries(kept);
}

export const useRiskGuardStore = create<GuardState>()((set, get) => ({
  ...load(),
  mark: (ids, at) => {
    if (!ids.length) return;
    const marks = pruneMarks({ ...get().marks, ...Object.fromEntries(ids.map((id) => [id, at])) }, at);
    set({ marks });
    save({ marks, override: get().override });
  },
  overrideUntil: (until, at = Date.now()) => {
    const override = { at, until };
    set({ override });
    save({ marks: get().marks, override });
  },
  clearOverride: () => {
    set({ override: null });
    save({ marks: get().marks, override: null });
  },
}));

/** More trades changed at once than this = a bulk change (import, restore, sync snapshot), not a save. */
export const BULK_CHANGE = 3;
/** A record saved within this window counts as "just saved" (its `updatedAt`). */
export const FRESH_SAVE_MS = 5 * 60_000;

/** Was the record saved just now (not an imported / synced old one)? */
export function freshSave(t: Pick<Trade, "updatedAt">, now: number): boolean {
  const u = Date.parse(t.updatedAt);
  return Number.isFinite(u) && Math.abs(now - u) <= FRESH_SAVE_MS;
}

/** Is an override active at `now`? */
export const overrideActive = (o: GuardOverride | null, now: number): boolean => !!o && o.until > now;

/** Trades that closed between two snapshots (new closed records or open → closed). */
export function newlyClosed(prev: readonly Trade[], next: readonly Trade[]): Trade[] {
  const before = new Map(prev.map((t) => [t.id, t]));
  return next.filter((t) => t.status === "closed" && (!before.has(t.id) || before.get(t.id)!.status !== "closed"));
}

/** The fields of a record the limits read (an adapter re-reads every record on a save: new objects, same content). */
const riskKey = (t: Trade): string => [t.updatedAt, t.status, t.account, t.pnl, t.pnlManual, t.exit, t.exitDate, t.entry, t.stop, t.size, t.qty, t.leverage, t.date].join("|");

/** Trades added or changed between two snapshots (by the fields the limits read, not by reference). */
export function changedTrades(prev: readonly Trade[], next: readonly Trade[]): Trade[] {
  const before = new Map(prev.map((t) => [t.id, t]));
  return next.filter((t) => {
    const b = before.get(t.id);
    return b !== t && (!b || riskKey(b) !== riskKey(t));
  });
}

const toneRank = (w: RiskWarning): number => (w.tone === "breach" ? 0 : 1);

/** Warnings a "Limit überschreiben" silences while it lasts: the pause and the day / week / trades limits. */
export const OVERRIDDEN_BY_HOLD = (w: Pick<RiskWarning, "key" | "source">): boolean => w.source === "cooldown" || w.key === "limit:day" || w.key === "limit:week" || w.key === "limit:trades";

/**
 * What to toast after a save: warnings that are new compared with the state BEFORE the save (key + tone), worst first.
 * Pure; `seen` are the keys already toasted this session.
 */
export function guardToasts(before: readonly RiskWarning[], after: readonly RiskWarning[], seen: ReadonlySet<string>): RiskWarning[] {
  const had = new Set(before.map((w) => `${w.key}|${w.tone}`));
  return after.filter((w) => !had.has(`${w.key}|${w.tone}`) && !seen.has(`${w.key}|${w.tone}`)).sort((a, b) => toneRank(a) - toneRank(b));
}

/** Limit report of an account after / before a save (shared by the guard and the tests). */
export function reportFor(trades: Trade[], settings: Settings, scope: RiskScope, now: number, marks: Readonly<Record<string, number>>, positions: readonly ExchangePosition[]): LimitReport {
  return limitStatus({ trades: getEnriched(trades, settings), settings, scope, now, marks, positions });
}

/**
 * The guard (see the module comment). Re-entrant: one subscription per mount, the baseline is the store state at
 * mount (nothing is toasted for what was there before).
 */
export function useRiskGuard(): void {
  const positions = useExchangePositions();
  const posRef = useRef(positions);
  useEffect(() => {
    posRef.current = positions;
  }, [positions]);

  useEffect(() => {
    // toasted warnings, per local day (a limit breached again tomorrow is news again)
    const seen = new Set<string>();
    let seenDay = "";
    let prev = useJournal.getState();
    return useJournal.subscribe((state) => {
      const before = prev;
      prev = state;
      if (!state.loaded || !before.loaded || state.trades === before.trades) return;
      const now = Date.now();
      const day = new Date(now).toDateString();
      if (day !== seenDay) {
        seen.clear();
        seenDay = day;
      }
      const guard = useRiskGuardStore.getState();
      const changed = changedTrades(before.trades, state.trades);
      // a bulk change (backup import / restore, first cloud snapshot) is not a save: no marks, no toasts
      if (!changed.length || changed.length > BULK_CHANGE) return;
      // only a FRESH close starts its pause now (an imported or synced old record keeps its own time)
      const closedNow = newlyClosed(before.trades, state.trades).filter((t) => freshSave(t, now));
      if (closedNow.length) guard.mark(closedNow.map((t) => t.id), now);
      if (!riskLimits(state.settings).guard) return;
      const marks = useRiskGuardStore.getState().marks;
      const accounts = [...new Set(changed.map((t) => (t.account ?? "scalp") as AccountId))];
      const fresh: RiskWarning[] = [];
      for (const acc of accounts) {
        const after = riskWarnings({ report: reportFor(state.trades, state.settings, acc, now, marks, posRef.current), now });
        const prior = riskWarnings({ report: reportFor(before.trades, before.settings, acc, now, guard.marks, posRef.current), now });
        fresh.push(...guardToasts(prior, after, seen));
      }
      for (const w of fresh) seen.add(`${w.key}|${w.tone}`);
      // a conscious override silences what it overrides (the pause and the day / week / trades limits) until it ends
      const overridden = overrideActive(useRiskGuardStore.getState().override, now);
      const shown = overridden ? fresh.filter((w) => !OVERRIDDEN_BY_HOLD(w)) : fresh;
      if (!shown.length) return;
      const first = shown.sort((a, b) => toneRank(a) - toneRank(b))[0]!;
      const more = shown.length > 1 ? ` · +${shown.length - 1} weitere` : "";
      pushToast({ kind: first.tone === "breach" ? "error" : "signal", title: first.title, detail: `${first.detail}${more}` });
    });
  }, []);
}

/** Leaf host for App.tsx (P14): runs the guard, renders nothing. */
export function RiskGuardHost() {
  useRiskGuard();
  return null;
}
