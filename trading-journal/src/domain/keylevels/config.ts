/**
 * `settings.keyLevels` – the versioned passthrough key of the Schlüsselmarken (F09) – and the migration of the five
 * fixed levels of `settings.market` into the model.
 *
 * Migration without a migration step: the five fixed levels are NOT copied into the new key. `legacyKeyLevels(market)`
 * derives read-only `KeyLevel`s from `settings.market` on every read, so the stored values stay where they always were
 * (the Einstellungen card, the chart lines, the exports, the other journal version) and cannot drift apart or get lost.
 * `settings.keyLevels` holds only what the user adds. A level that is edited in Einstellungen shows up edited here.
 * The derived levels carry `since: null` (stateless: the latest closed 4H candle decides – what `scenario()` always did)
 * and no alerts, so nothing about today's behaviour changes until the user opts in.
 *
 * Reading is lenient (`keyLevelsCfgOf` sanitises anything); writing keeps every unknown key of the root object and every
 * entry this version cannot read (`rejected`), so a newer version's data survives a round trip.
 */
import { tvSymbolToBinance } from "@/market/symbol";
import { parseNumber } from "@/lib/parse";
import type { MarketLevels } from "../types";
import {
  isKeyTf,
  isTriggerKind,
  LEVEL_DIRECTIONS,
  PLAN_ROLES,
  PRECEDENCES,
  type ActiveHours,
  type AlertSettings,
  type Distance,
  type KeyLevel,
  type KeyLevelsCfg,
  type LegacyKey,
  type LevelAlertRule,
  type PlanRole,
  type Precedence,
} from "./types";

export const KEY_LEVELS_VERSION = 1 as const;
export const MAX_KEY_LEVELS = 40;
export const MAX_NAME = 60;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export const DEFAULT_DISTANCE: Distance = { mode: "pct", value: 0.2 };
export const DEFAULT_LEVEL_ALERTS: LevelAlertRule = { on: false, prepare: true, confirm: true, retest: true, invalid: true, recurring: false };
export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  channels: { toast: true, system: false },
  hours: { on: false, from: "08:00", to: "22:00" },
  prepare: { mode: "pct", value: 0.5 },
  cooldownMin: 30,
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function distanceOf(raw: unknown, d: Distance): Distance {
  const r = isObj(raw) ? raw : {};
  const value = parseNumber(r.value);
  return { mode: r.mode === "atr" ? "atr" : r.mode === "pct" ? "pct" : d.mode, value: value != null && value >= 0 && value <= 1000 ? value : d.value };
}

export function alertRuleOf(raw: unknown): LevelAlertRule {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_LEVEL_ALERTS;
  return { on: bool(r.on, d.on), prepare: bool(r.prepare, d.prepare), confirm: bool(r.confirm, d.confirm), retest: bool(r.retest, d.retest), invalid: bool(r.invalid, d.invalid), recurring: bool(r.recurring, d.recurring) };
}

export function alertSettingsOf(raw: unknown): AlertSettings {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_ALERT_SETTINGS;
  const ch = isObj(r.channels) ? r.channels : {};
  const h = isObj(r.hours) ? r.hours : {};
  const cd = parseNumber(r.cooldownMin);
  const hours: ActiveHours = {
    on: bool(h.on, d.hours.on),
    from: typeof h.from === "string" && HHMM.test(h.from) ? h.from : d.hours.from,
    to: typeof h.to === "string" && HHMM.test(h.to) ? h.to : d.hours.to,
  };
  return {
    channels: { toast: bool(ch.toast, d.channels.toast), system: bool(ch.system, d.channels.system) },
    hours,
    prepare: distanceOf(r.prepare, d.prepare),
    cooldownMin: cd != null ? clamp(Math.round(cd), 0, 24 * 60) : d.cooldownMin,
  };
}

/** One stored level → `KeyLevel`, or `null` when it cannot be read (kept aside by the caller, never repaired silently). */
export function normalizeKeyLevel(raw: unknown): KeyLevel | null {
  if (!isObj(raw)) return null;
  const price = parseNumber(raw.price);
  if (typeof raw.id !== "string" || !raw.id || price == null || !(price > 0)) return null;
  // a timeframe / rule this version does not know is NOT replaced by a default – the entry stays unreadable
  if (!isKeyTf(raw.tf) || !isTriggerKind(raw.kind)) return null;
  const direction = raw.direction === "below" ? "below" : (LEVEL_DIRECTIONS as readonly unknown[]).includes(raw.direction) ? "above" : null;
  if (!direction) return null;
  const closes = parseNumber(raw.closes);
  const prio = parseNumber(raw.priority);
  const inv = parseNumber(raw.invalidation);
  const since = parseNumber(raw.since);
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, MAX_NAME) : "";
  return {
    id: raw.id,
    name: name || "Schlüsselmarke",
    symbol: typeof raw.symbol === "string" && raw.symbol ? raw.symbol.toUpperCase() : "BTCUSDT",
    price,
    tf: raw.tf,
    direction,
    kind: raw.kind,
    closes: closes != null ? clamp(Math.round(closes), 1, 10) : 2,
    distance: distanceOf(raw.distance, DEFAULT_DISTANCE),
    invalidation: inv != null && inv > 0 ? inv : null,
    priority: prio != null ? clamp(Math.round(prio), 1, 9) : 5,
    role: (PLAN_ROLES as readonly unknown[]).includes(raw.role) ? (raw.role as PlanRole) : "auto",
    enabled: bool(raw.enabled, true),
    since: since != null && since >= 0 ? since : null,
    alerts: alertRuleOf(raw.alerts),
    note: typeof raw.note === "string" ? raw.note.slice(0, 280) : "",
  };
}

export interface ParsedKeyLevels extends KeyLevelsCfg {
  /** stored entries this version could not read – written back untouched */
  rejected: unknown[];
}

export const EMPTY_KEY_LEVELS: ParsedKeyLevels = Object.freeze({
  v: KEY_LEVELS_VERSION,
  levels: [],
  precedence: "higher" as Precedence,
  alerts: DEFAULT_ALERT_SETTINGS,
  planToast: null,
  rejected: [],
}) as ParsedKeyLevels;

/** `settings.keyLevels` (anything) → a full config. Duplicated ids keep the first entry. */
export function keyLevelsCfgOf(raw: unknown): ParsedKeyLevels {
  if (!isObj(raw)) return EMPTY_KEY_LEVELS;
  const levels: KeyLevel[] = [];
  const rejected: unknown[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(raw.levels) ? raw.levels : []) {
    const l = normalizeKeyLevel(entry);
    if (!l) rejected.push(entry);
    else if (!seen.has(l.id) && levels.length < MAX_KEY_LEVELS) {
      seen.add(l.id);
      levels.push(l);
    }
  }
  return {
    v: KEY_LEVELS_VERSION,
    levels,
    precedence: (PRECEDENCES as readonly unknown[]).includes(raw.precedence) ? (raw.precedence as Precedence) : "higher",
    alerts: alertSettingsOf(raw.alerts),
    planToast: typeof raw.planToast === "boolean" ? raw.planToast : null,
    rejected,
  };
}

/** `settings.keyLevels` of a settings object. */
export const keyLevelsOfSettings = (s: { keyLevels?: unknown } | null | undefined): ParsedKeyLevels => keyLevelsCfgOf(s?.keyLevels);

/**
 * `settings.keyLevels` with `patch` applied – the unknown keys of the root and the `rejected` entries survive. Returns
 * the SAME object when nothing changes (the caller skips the save).
 */
export function withKeyLevels(raw: unknown, patch: Partial<KeyLevelsCfg>): Record<string, unknown> {
  const prev = isObj(raw) ? raw : {};
  const cur = keyLevelsCfgOf(raw);
  const next: Record<string, unknown> = { ...prev };
  next.v = KEY_LEVELS_VERSION;
  const levels = patch.levels ?? cur.levels;
  next.levels = [...levels, ...cur.rejected];
  next.precedence = patch.precedence ?? cur.precedence;
  next.alerts = patch.alerts ?? cur.alerts;
  const planToast = "planToast" in patch ? patch.planToast : cur.planToast;
  if (planToast === null || planToast === undefined) delete next.planToast;
  else next.planToast = planToast;
  const same = isObj(raw) && canon(prev) === canon(next);
  return same ? (raw as Record<string, unknown>) : next;
}

/** JSON with every object's keys sorted – two writes of the same data compare equal whatever the key order. */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}

/** Plan-change toast switch: explicit value, else on as soon as the user has an own enabled level. */
export const planToastOn = (c: Pick<KeyLevelsCfg, "planToast" | "levels">): boolean => c.planToast ?? c.levels.some((l) => l.enabled);

// ---------------------------------------------------------------- migration of the five fixed levels

export const LEGACY_PREFIX = "legacy:";
export const legacyId = (k: LegacyKey): string => `${LEGACY_PREFIX}${k}`;
export const isLegacyId = (id: string): boolean => id.startsWith(LEGACY_PREFIX);

const LEGACY_ALERTS: LevelAlertRule = { on: false, prepare: false, confirm: false, retest: false, invalid: false, recurring: false };

interface LegacySpec {
  key: LegacyKey;
  name: string;
  tf: KeyLevel["tf"];
  direction: KeyLevel["direction"];
  role: PlanRole;
  priority: number;
  note: string;
}

const LEGACY: readonly LegacySpec[] = [
  { key: "longTrigger", name: "Long-Trigger", tf: "4h", direction: "above", role: "long", priority: 2, note: "4H-Schluss über dem Level (Einstellungen › Trigger-Level)." },
  { key: "longStop", name: "Long-Invalidierung", tf: "4h", direction: "below", role: "stop", priority: 3, note: "Fällt der Kurs darunter, ist der Long-Trigger ungültig." },
  { key: "shortTrigger", name: "Short-Trigger", tf: "4h", direction: "below", role: "short", priority: 2, note: "4H-Schluss unter dem Level." },
  { key: "invalidation", name: "Harte Invalidierung", tf: "4h", direction: "below", role: "stop", priority: 1, note: "4H-Schluss darunter: volles Bär-Szenario." },
  { key: "lowerHigh", name: "Lower High (Weekly)", tf: "1W", direction: "above", role: "info", priority: 4, note: "Wochenschluss über dem Level bestätigt das Ende des Bärenmarkts." },
];

/**
 * The five fixed levels as read-only `KeyLevel`s (set ones only – a `0` is "nicht gesetzt" and stays out, like its chart
 * line). Behaviour parity: a 4H `close` level evaluated on the latest closed candle is exactly `scenario()`'s strict
 * `>` / `<`.
 */
export function legacyKeyLevels(market: Partial<MarketLevels> | null | undefined): KeyLevel[] {
  if (!market) return [];
  const symbol = tvSymbolToBinance(market.symbol);
  const out: KeyLevel[] = [];
  for (const spec of LEGACY) {
    const price = market[spec.key];
    if (typeof price !== "number" || !Number.isFinite(price) || !(price > 0)) continue;
    // the Long-Trigger and the Short-Trigger both end at the Long-Invalidierung (`scenario()` copy: „Stop über …“)
    const inv = spec.key === "longTrigger" || spec.key === "shortTrigger" ? (market.longStop ?? 0) : 0;
    out.push({
      id: legacyId(spec.key),
      name: spec.name,
      symbol,
      price,
      tf: spec.tf,
      direction: spec.direction,
      kind: "close",
      closes: 1,
      distance: DEFAULT_DISTANCE,
      invalidation: inv > 0 ? inv : null,
      priority: spec.priority,
      role: spec.role,
      enabled: true,
      since: null,
      alerts: LEGACY_ALERTS,
      note: spec.note,
      legacy: spec.key,
    });
  }
  return out;
}

/** The levels the app watches: the five fixed ones (derived) followed by the user's own. */
export function allKeyLevels(settings: { market?: Partial<MarketLevels>; keyLevels?: unknown } | null | undefined): KeyLevel[] {
  if (!settings) return [];
  return [...legacyKeyLevels(settings.market), ...keyLevelsCfgOf(settings.keyLevels).levels];
}

/** A new own level with every field defaulted (the editor starts from it). */
export function blankKeyLevel(over: Partial<KeyLevel> & Pick<KeyLevel, "id" | "symbol" | "price">, now: number): KeyLevel {
  return {
    name: "",
    tf: "4h",
    direction: "above",
    kind: "close",
    closes: 2,
    distance: DEFAULT_DISTANCE,
    invalidation: null,
    priority: 5,
    role: "auto",
    enabled: true,
    since: now,
    alerts: DEFAULT_LEVEL_ALERTS,
    note: "",
    ...over,
  };
}

/** Copy for "Duplizieren": own level, fresh id and `since`, alerts off, name marked. Works for the fixed levels too. */
export function duplicateKeyLevel(l: KeyLevel, id: string, now: number): KeyLevel {
  const { legacy: _legacy, ...rest } = l;
  return { ...rest, id, name: `${l.name} (Kopie)`.slice(0, MAX_NAME), since: now, alerts: { ...DEFAULT_LEVEL_ALERTS }, enabled: true };
}
