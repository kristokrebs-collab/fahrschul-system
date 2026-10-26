/**
 * Archive configuration (F26): lenient parse of the device-local record, the symbols that are archived, and the size
 * budget → ring capacities. Pure.
 *
 * The record lives in this browser only (`tj2-archive-cfg`, see `@/market/archive/store`), NOT in `settings`: the
 * archive is an IndexedDB of this device, so the switch must not travel with a backup or the cloud sync and turn the
 * collection on another device on by itself. Default: OFF.
 */
import { normalizeWatchSymbol } from "../boxes/config";
import { ARCHIVE_AUTO_SYMBOLS, ARCHIVE_MAX_SYMBOLS, SERIES, seriesDef } from "./series";
import type { ArchiveCfg, SeriesId } from "./types";

export const ARCHIVE_CFG_VERSION = 1 as const;
export const EVERY_MIN_CHOICES = [5, 10, 15] as const;
export const MAX_MB_CHOICES = [10, 25, 50, 100] as const;

export const DEFAULT_ARCHIVE_CFG: ArchiveCfg = { v: ARCHIVE_CFG_VERSION, on: false, everyMin: 10, picked: null, states: true, maxMb: 25 };

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/** Unique, normalised symbols, at most `ARCHIVE_MAX_SYMBOLS`. */
export function sanitizeSymbols(raw: unknown): string[] {
  const out: string[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const s = normalizeWatchSymbol(r);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= ARCHIVE_MAX_SYMBOLS) break;
  }
  return out;
}

/** The stored record → a config. Anything unknown or malformed falls back to the default; `on` only when it is exactly `true`. */
export function parseArchiveCfg(raw: unknown): ArchiveCfg {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_ARCHIVE_CFG;
  return {
    v: ARCHIVE_CFG_VERSION,
    on: r.on === true,
    everyMin: (EVERY_MIN_CHOICES as readonly unknown[]).includes(r.everyMin) ? (r.everyMin as ArchiveCfg["everyMin"]) : d.everyMin,
    picked: Array.isArray(r.picked) ? sanitizeSymbols(r.picked) : null,
    states: typeof r.states === "boolean" ? r.states : d.states,
    maxMb: (MAX_MB_CHOICES as readonly unknown[]).includes(r.maxMb) ? (r.maxMb as ArchiveCfg["maxMb"]) : d.maxMb,
  };
}

/** Same object when nothing changed (store subscribers compare by identity). */
export function withArchiveCfg(cur: ArchiveCfg, patch: Partial<Omit<ArchiveCfg, "v">>): ArchiveCfg {
  const next = parseArchiveCfg({ ...cur, ...patch });
  return JSON.stringify(next) === JSON.stringify(cur) ? cur : next;
}

/**
 * The symbols that are archived: the explicit pick, else the live symbol plus the first of the watchlist (up to
 * `ARCHIVE_AUTO_SYMBOLS`). `observed` = the symbols the user watches, live symbol first.
 */
export function effectiveSymbols(cfg: ArchiveCfg, observed: readonly string[]): string[] {
  if (cfg.picked) return cfg.picked.slice(0, ARCHIVE_MAX_SYMBOLS);
  const out: string[] = [];
  for (const o of observed) {
    const s = normalizeWatchSymbol(o);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= ARCHIVE_AUTO_SYMBOLS) break;
  }
  return out;
}

/** The symbols the user watches, live symbol first (unique, normalised). */
export function observedSymbols(liveSymbol: unknown, watchlist: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const r of [liveSymbol, ...watchlist]) {
    const s = normalizeWatchSymbol(r);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Estimated bytes of `count` points of a series. */
export const estimateBytes = (series: SeriesId, count: number): number => count * seriesDef(series).bytes;

/**
 * Ring capacity of one series of one symbol under the size budget: the series' own cap, but never more than an equal
 * share of the budget over the `keys` series × symbol rows that exist (so a small limit trims every row alike).
 */
export function ringCap(series: SeriesId, keys: number, maxMb: number): number {
  const own = seriesDef(series).cap;
  if (keys <= 0) return own;
  const avg = SERIES.reduce((s, d) => s + d.bytes, 0) / SERIES.length;
  const share = Math.floor((maxMb * 1_000_000) / avg / keys);
  return Math.max(0, Math.min(own, share));
}
