/**
 * Vier Alarme (C2): the account's settings (`AlertPrefs`), their defaults and a tolerant, bounded reader.
 *
 * Everything is OFF until the user switches it on (an alert never starts by itself). The reader is the ONE place that decides
 * what a stored or submitted document means: unknown keys are dropped, numbers are clamped, markets are checked against their
 * alphabet, so the server can store whatever `alertPrefsOf` returns and the browser can render whatever it gets.
 */
import { INDUSTRY_NAMES } from "../industryTrend/config";
import { ALERT_EVENTS, ALERT_SOURCE_KINDS, type AlertEvent, type AlertLang, type AlertSourceKind, type SourceParams } from "./types";

export const ALERT_CHANNELS = ["browser", "email", "phone"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];
export const isAlertChannel = (v: unknown): v is AlertChannel => typeof v === "string" && (ALERT_CHANNELS as readonly string[]).includes(v);

export const ALERT_CHANNEL_LABEL: Readonly<Record<AlertChannel, string>> = { browser: "Browser", email: "E-Mail", phone: "Telefon" };

export type EventSet = Readonly<Record<AlertEvent, boolean>>;

export interface QuietHours {
  on: boolean;
  /** `HH:MM`, the user's time zone: quiet FROM here … */
  from: string;
  /** … UNTIL here (`from > to` wraps over midnight) */
  to: string;
}

export interface SourcePrefs {
  on: boolean;
  /** industry codes (`Softw`) / futures symbols (`BTCUSDT`); the key-level source takes none */
  markets: string[];
  params: SourceParams;
}

export interface AlertPrefs {
  v: 1;
  /** language of the call and the mail */
  lang: AlertLang;
  channels: Readonly<Record<AlertChannel, EventSet>>;
  quiet: QuietHours;
  /** the same event of the same market is not delivered twice within this time (minutes) */
  cooldownMin: number;
  sources: Readonly<Record<AlertSourceKind, SourcePrefs>>;
}

export const COOLDOWN_MIN = { min: 10, max: 1440, def: 360 } as const;
export const MARKETS_MAX: Readonly<Record<AlertSourceKind, number>> = { industry: 12, whale: 5, keylevel: 0 };
export const SYMBOL_RE = /^[A-Z0-9]{2,24}$/;
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Bounds and defaults of the thresholds (the source's own units: industry = % of price, whale = percentage points). */
export const PARAM_RANGE: Readonly<Record<AlertSourceKind, Readonly<Record<keyof SourceParams, { min: number; max: number; def: number; step: number }>>>> = {
  industry: { warn: { min: 0.2, max: 10, def: 2, step: 0.1 }, confirm: { min: 0, max: 0, def: 0, step: 0.1 }, hyst: { min: 0.1, max: 5, def: 0.5, step: 0.1 } },
  whale: { warn: { min: 0.5, max: 20, def: 3, step: 0.5 }, confirm: { min: 0.5, max: 30, def: 2, step: 0.5 }, hyst: { min: 0.2, max: 10, def: 1, step: 0.1 } },
  keylevel: { warn: { min: 0, max: 0, def: 0, step: 1 }, confirm: { min: 0, max: 0, def: 0, step: 1 }, hyst: { min: 0, max: 0, def: 0, step: 1 } },
};

const noEvents = (): EventSet => ({ green_warn: false, green_confirm: false, red_warn: false, red_confirm: false });

function defaultParams(kind: AlertSourceKind): SourceParams {
  const r = PARAM_RANGE[kind];
  return { warn: r.warn.def, confirm: r.confirm.def, hyst: r.hyst.def };
}

export function defaultAlertPrefs(): AlertPrefs {
  return {
    v: 1,
    lang: "de",
    channels: { browser: noEvents(), email: noEvents(), phone: noEvents() },
    quiet: { on: true, from: "22:00", to: "07:00" },
    cooldownMin: COOLDOWN_MIN.def,
    sources: {
      industry: { on: false, markets: [], params: defaultParams("industry") },
      whale: { on: false, markets: ["BTCUSDT"], params: defaultParams("whale") },
      keylevel: { on: false, markets: [], params: defaultParams("keylevel") },
    },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const round = (v: number, step: number): number => Math.round(v / step) * step;

function num(v: unknown, r: { min: number; max: number; def: number; step: number }): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return r.def;
  return Math.min(r.max, Math.max(r.min, Number(round(v, r.step).toFixed(3))));
}

function eventSet(raw: unknown): EventSet {
  const out: Record<AlertEvent, boolean> = { ...noEvents() };
  if (isObj(raw)) for (const e of ALERT_EVENTS) out[e] = raw[e] === true;
  return out;
}

/** Industry codes that exist in the 48-industry file, no duplicates, within the cap. */
export function cleanIndustries(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const c of raw) if (typeof c === "string" && Object.prototype.hasOwnProperty.call(INDUSTRY_NAMES, c) && !out.includes(c)) out.push(c);
  return out.slice(0, MARKETS_MAX.industry);
}

/** Futures symbols in capital letters and digits, no duplicates, within the cap. */
export function cleanSymbols(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const s of raw) {
    const u = typeof s === "string" ? s.trim().toUpperCase() : "";
    if (SYMBOL_RE.test(u) && !out.includes(u)) out.push(u);
  }
  return out.slice(0, MARKETS_MAX.whale);
}

function sourcePrefs(kind: AlertSourceKind, raw: unknown, def: SourcePrefs): SourcePrefs {
  if (!isObj(raw)) return def;
  const r = PARAM_RANGE[kind];
  const p = isObj(raw.params) ? raw.params : {};
  const markets = kind === "industry" ? cleanIndustries(raw.markets) : kind === "whale" ? cleanSymbols(raw.markets) : [];
  return { on: raw.on === true, markets, params: { warn: num(p.warn, r.warn), confirm: num(p.confirm, r.confirm), hyst: num(p.hyst, r.hyst) } };
}

/** The settings a stored or submitted document means. Never throws; anything unreadable falls back to the (all-off) default. */
export function alertPrefsOf(raw: unknown): AlertPrefs {
  const def = defaultAlertPrefs();
  if (!isObj(raw)) return def;
  const ch = isObj(raw.channels) ? raw.channels : {};
  const q = isObj(raw.quiet) ? raw.quiet : {};
  const src = isObj(raw.sources) ? raw.sources : {};
  const sources = {} as Record<AlertSourceKind, SourcePrefs>;
  for (const k of ALERT_SOURCE_KINDS) sources[k] = sourcePrefs(k, src[k], def.sources[k]);
  return {
    v: 1,
    lang: raw.lang === "en" ? "en" : "de",
    channels: { browser: eventSet(ch.browser), email: eventSet(ch.email), phone: eventSet(ch.phone) },
    quiet: {
      on: q.on === undefined ? def.quiet.on : q.on === true,
      from: typeof q.from === "string" && HHMM_RE.test(q.from) ? q.from : def.quiet.from,
      to: typeof q.to === "string" && HHMM_RE.test(q.to) ? q.to : def.quiet.to,
    },
    cooldownMin: typeof raw.cooldownMin === "number" && Number.isFinite(raw.cooldownMin) ? Math.min(COOLDOWN_MIN.max, Math.max(COOLDOWN_MIN.min, Math.round(raw.cooldownMin))) : COOLDOWN_MIN.def,
    sources,
  };
}

/** A channel is on when at least one of its four events is on. */
export const channelOn = (p: AlertPrefs, c: AlertChannel): boolean => ALERT_EVENTS.some((e) => p.channels[c][e]);

/** The channels that are on (what the tariff's `alertChannels` limit counts). */
export const channelsOn = (p: AlertPrefs): AlertChannel[] => ALERT_CHANNELS.filter((c) => channelOn(p, c));

/** The sources that are on. */
export const sourcesOn = (p: AlertPrefs): AlertSourceKind[] => ALERT_SOURCE_KINDS.filter((k) => p.sources[k].on);

export interface PrefsCheck {
  ok: boolean;
  /** `channels` = more channels than the plan allows; `phone` = the plan has no calls */
  problem: "channels" | "phone" | null;
}

/** Checks the settings against the plan's limits (`alertChannels`, `phoneCallsPerMonth`). Used by the server (authoritative) and the browser (to explain). */
export function checkPrefsAgainstLimits(p: AlertPrefs, limits: { alertChannels: number; phoneCallsPerMonth: number }): PrefsCheck {
  if (channelOn(p, "phone") && !(limits.phoneCallsPerMonth > 0)) return { ok: false, problem: "phone" };
  if (channelsOn(p).length > limits.alertChannels) return { ok: false, problem: "channels" };
  return { ok: true, problem: null };
}

/** `true` when settings and plan together mean at least one alert can fire. */
export const alertsActive = (p: AlertPrefs): boolean => sourcesOn(p).length > 0 && channelsOn(p).length > 0;
