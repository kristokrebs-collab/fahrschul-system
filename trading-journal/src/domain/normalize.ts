/**
 * Read-path normalisers. `normalizeSettings` is the bundle's `qM` with identical semantics:
 * unknown keys survive, an empty `setups` array stays empty, per-setup `name`/`color`/`id` are NOT defaulted.
 * Additive on top (both idempotent, lossless):
 * - `mistakes` defaults to `DEFAULT_MISTAKES`; `signals` is passed through untouched (parsed by the signal module).
 * - Settings from before the multi-TF era (no `mistakes`, no `signals` key) get the `s_mtf` setup appended once –
 *   the same guard the other journal version uses (an empty `setups` array stays empty, bundle semantics); after the first save `mistakes` is persisted, so a user who
 *   deletes `s_mtf` later does not get it back.
 * - `market.symbol` of another venue (`BITSTAMP:BTCUSD`, the other version's default) is mapped to the Binance
 *   USDⓈ-M symbol the live market can serve (`BINANCE:BTCUSDT`); the original is kept in `market.sourceSymbol`.
 */
import type {
  Annotation,
  AnnotationKind,
  DayNote,
  DayNotes,
  Fill,
  FillKind,
  FillSide,
  HyblockReading,
  MarginMode,
  Rule,
  ScreenshotRef,
  Settings,
  Setup,
  StopChange,
  Trade,
  TradeOrigin,
  TradeOriginKind,
  TradePsych,
  TradeRating,
  TradeTarget,
} from "./types";
import { DEFAULT_BACKTEST, DEFAULT_HYBLOCK, DEFAULT_MARKET, DEFAULT_MISTAKES, defaultSettings, MTF_SETUP, MTF_SETUP_ID } from "./defaults";
import { parseNumber, sanitizeUrl } from "@/lib/parse";

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/** Non-empty strings of `v` (trimmed), first occurrence wins; anything that is not an array → `null`. */
function stringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const s = x.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Stablecoin quotes that also end in "USD" (`BTCFDUSD` is not `BTCFD` + USD). TUSD is deliberately absent:
 * `XBTUSD` / `DOTUSD` are USD pairs.
 */
const USD_STABLES = /(?:BUSD|FDUSD|USDUSD|PYUSD|USDPUSD)$/;

/**
 * TradingView symbol → the Binance USDⓈ-M symbol the live market can serve, in TradingView notation.
 * `BITSTAMP:BTCUSD` / `COINBASE:BTCUSD` / `KRAKEN:XBTUSD` / bare `BTCUSD` → `BINANCE:BTCUSDT`. Everything else
 * (`BINANCE:BTCUSDT`, `BYBIT:ETHUSDT`, …) is returned unchanged. `changed` tells whether a mapping happened.
 */
export function mapToBinanceSymbol(raw: string): { symbol: string; changed: boolean } {
  const s = raw.trim();
  const idx = s.lastIndexOf(":");
  const prefix = idx > 0 ? s.slice(0, idx).toUpperCase() : null;
  const bare = (idx >= 0 ? s.slice(idx + 1) : s).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!bare || prefix === "BINANCE" || !/^[A-Z0-9]{2,12}USD$/.test(bare) || USD_STABLES.test(bare)) return { symbol: raw, changed: false };
  const base = bare.slice(0, -3).replace(/^XBT$/, "BTC");
  return { symbol: `BINANCE:${base}USDT`, changed: true };
}

/** Bundle `qM(raw)`. Accepts anything (null, partial, stringified numbers) and returns full Settings. */
export function normalizeSettings(raw: unknown): Settings {
  const t = defaultSettings();
  const r: Raw = isObj(raw) ? raw : {};
  const capital = isObj(r.capital) ? r.capital : {};
  let setups = Array.isArray(r.setups)
    ? (r.setups as Raw[]).map((s) => ({ checklist: [], account: "both", desc: "", ...s }) as unknown as Setup)
    : t.setups;
  // Additive, once: settings written before `s_mtf` existed (neither `mistakes` nor `signals` persisted yet).
  if (Array.isArray(r.setups) && r.setups.length > 0 && !("mistakes" in r) && !("signals" in r) && !setups.some((s) => s?.id === MTF_SETUP_ID)) {
    setups = [...setups, { ...MTF_SETUP, checklist: MTF_SETUP.checklist.map((c) => ({ ...c })) }];
  }
  const rules = Array.isArray(r.rules) ? (r.rules as Rule[]) : t.rules;
  const market = { ...DEFAULT_MARKET, ...(isObj(r.market) ? r.market : {}) };
  if (typeof market.symbol === "string") {
    const mapped = mapToBinanceSymbol(market.symbol);
    if (mapped.changed) {
      const m = market as typeof market & { sourceSymbol?: unknown };
      if (typeof m.sourceSymbol !== "string") m.sourceSymbol = market.symbol;
      market.symbol = mapped.symbol;
    }
  }
  return {
    ...r,
    currency: (r.currency as string) || t.currency,
    pair: (r.pair as string) || t.pair,
    startDate: (r.startDate as string) || "",
    capital: {
      makro: parseNumber(capital.makro) ?? t.capital.makro,
      scalp: parseNumber(capital.scalp) ?? t.capital.scalp,
    },
    setups,
    rules,
    backtest: { ...DEFAULT_BACKTEST, ...(isObj(r.backtest) ? r.backtest : {}) },
    market,
    hyblock: { ...DEFAULT_HYBLOCK, ...(isObj(r.hyblock) ? r.hyblock : {}) },
    mistakes: stringList(r.mistakes) ?? [...DEFAULT_MISTAKES],
  } as Settings;
}

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  return parseNumber(v);
};
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : v == null ? fallback : String(v));

/**
 * Normalises a persisted trade record into the `Trade` shape (legacy records may miss fields).
 * `account` stays absent when missing (read path treats it as "scalp"); `pnl`/`r` are kept as stored —
 * `enrichTrade` recomputes them. `chart` goes through `sanitizeUrl` (only `http(s)://` links survive).
 */
export function normalizeTrade(raw: unknown): Trade {
  const r: Raw = isObj(raw) ? raw : {};
  const checksRaw = isObj(r.checks) ? r.checks : {};
  const checks: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(checksRaw)) if (v) checks[k] = true;
  const conv = numOrNull(r.conviction);
  const status = r.status === "open" ? "open" : "closed";
  const out: Trade = {
    ...r,
    id: str(r.id),
    side: r.side === "short" ? "short" : "long",
    status,
    date: str(r.date),
    pair: str(r.pair),
    timeframe: str(r.timeframe),
    entry: numOrNull(r.entry),
    stop: numOrNull(r.stop),
    target: numOrNull(r.target),
    exit: status === "open" ? null : numOrNull(r.exit),
    size: numOrNull(r.size),
    leverage: numOrNull(r.leverage),
    fees: numOrNull(r.fees),
    pnlManual: numOrNull(r.pnlManual),
    setups: Array.isArray(r.setups) ? (r.setups as unknown[]).filter((s): s is string => typeof s === "string") : [],
    checks,
    conviction: conv != null && conv >= 1 && conv <= 5 && Number.isInteger(conv) ? (conv as Trade["conviction"]) : null,
    followedPlan: typeof r.followedPlan === "boolean" ? r.followedPlan : null,
    emotion: str(r.emotion),
    reason: str(r.reason),
    notes: str(r.notes),
    chart: sanitizeUrl(r.chart),
    pnl: numOrNull(r.pnl),
    r: numOrNull(r.r),
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt),
    mistakes: stringList(r.mistakes) ?? [],
  };
  if (r.account === "makro" || r.account === "scalp") out.account = r.account;
  else delete (out as Partial<Trade>).account;
  normalizeJournalV3(r, out as unknown as Raw);
  return out;
}

// ── Journal v3 fields (Wave-0 contract, owner P06) ──────────────────────────────────────────────────────────────
// Every key is coerced only when it is PRESENT in the stored record; an absent key is never added, so a legacy record
// normalises exactly as before. A malformed value is dropped (key removed) – or set to `null` for numbers / rating,
// mirroring the legacy number fields. Unknown keys inside fills / screenshots / … survive (passthrough).

const V3_TIME = ["exitDate", "syncedAt"] as const;
const V3_TEXT = ["exchange", "exchangeAccount", "externalId", "syncSource", "positionId", "groupId", "hedgeOf"] as const;
const V3_NUM = ["qty", "fundingFees", "slippage", "plannedEntry", "margin", "liqPrice", "mae", "mfe", "maeR", "mfeR", "atrPct"] as const;
const FILL_KINDS: readonly FillKind[] = ["entry", "add", "partial", "exit"];
const ANNOTATION_KINDS: readonly AnnotationKind[] = ["hline", "trend", "box", "text", "arrow"];
const ORIGIN_KINDS: readonly TradeOriginKind[] = ["manual", "api", "csv", "bot", "webhook"];
const SHOT_STORES: readonly ScreenshotRef["store"][] = ["idb", "cloud", "url"];

const has = (r: Raw, k: string): boolean => Object.prototype.hasOwnProperty.call(r, k);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined => (list as readonly unknown[]).includes(v) ? (v as T) : undefined;

/** Id / label text: non-empty strings verbatim, finite numbers as string (venue ids often arrive as numbers), else dropped. */
function idText(v: unknown): string | undefined {
  if (typeof v === "string") return v === "" ? undefined : v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

/** Integer 1–5 (rating, stress, confidence) or `null`. */
function scale5(v: unknown): TradeRating | null {
  const n = numOrNull(v);
  return n != null && Number.isInteger(n) && n >= 1 && n <= 5 ? (n as TradeRating) : null;
}

function fillsOf(v: unknown): Fill[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Fill[] = [];
  v.forEach((x: unknown, i) => {
    if (!isObj(x)) return;
    const price = numOrNull(x.price);
    const qty = numOrNull(x.qty);
    if (price == null || price <= 0 || qty == null || qty <= 0) return;
    const side: FillSide = x.side === "close" ? "close" : "open";
    const f: Fill = { ...x, id: idText(x.id) ?? `f${i}`, at: str(x.at), side, price, qty, kind: oneOf(FILL_KINDS, x.kind) ?? (side === "close" ? "exit" : "entry") };
    if (has(x, "fee")) f.fee = numOrNull(x.fee);
    out.push(f);
  });
  return out;
}

function screenshotsOf(v: unknown): ScreenshotRef[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ScreenshotRef[] = [];
  for (const x of v) {
    if (!isObj(x)) continue;
    const id = idText(x.id);
    const store = oneOf(SHOT_STORES, x.store);
    if (!id || !store) continue;
    const s: ScreenshotRef = { ...x, id, store };
    if (has(x, "url")) {
      const url = sanitizeUrl(x.url);
      if (url) s.url = url;
      else delete s.url;
    }
    if (has(x, "key") && typeof x.key !== "string") delete s.key;
    if (store === "url" && !s.url) continue;
    out.push(s);
  }
  return out;
}

function annotationsOf(v: unknown): Annotation[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Annotation[] = [];
  for (const x of v) {
    if (!isObj(x)) continue;
    const id = idText(x.id);
    const kind = oneOf(ANNOTATION_KINDS, x.kind);
    if (!id || !kind) continue;
    const points: Annotation["points"] = [];
    for (const p of Array.isArray(x.points) ? (x.points as unknown[]) : []) {
      if (!isObj(p)) continue;
      const time = numOrNull(p.time);
      const price = numOrNull(p.price);
      if (time != null && price != null) points.push({ time, price });
    }
    if (points.length) out.push({ ...x, id, kind, points });
  }
  return out;
}

function stopHistoryOf(v: unknown): StopChange[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: StopChange[] = [];
  for (const x of v) {
    if (!isObj(x)) continue;
    const price = numOrNull(x.price);
    if (price != null) out.push({ ...x, at: str(x.at), price });
  }
  return out;
}

function targetsOf(v: unknown): TradeTarget[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: TradeTarget[] = [];
  for (const x of v) {
    if (!isObj(x)) continue;
    const price = numOrNull(x.price);
    if (price == null) continue;
    const t: TradeTarget = { ...x, price };
    if (has(x, "pct")) t.pct = numOrNull(x.pct);
    if (has(x, "qty")) t.qty = numOrNull(x.qty);
    if (has(x, "hit")) t.hit = x.hit === true;
    out.push(t);
  }
  return out;
}

function psychOf(v: unknown): TradePsych | undefined {
  if (!isObj(v)) return undefined;
  const p: TradePsych = { ...v };
  if (has(v, "stress")) p.stress = scale5(v.stress);
  if (has(v, "confidence")) p.confidence = scale5(v.confidence);
  if (has(v, "flags")) p.flags = stringList(v.flags) ?? [];
  for (const k of ["exitReason", "preNote", "postNote"] as const) if (has(v, k)) p[k] = str(v[k]);
  return p;
}

function originOf(v: unknown): TradeOrigin | undefined {
  if (!isObj(v)) return undefined;
  const kind = oneOf(ORIGIN_KINDS, v.kind);
  if (!kind) return undefined;
  const o: TradeOrigin = { ...v, kind };
  if (has(v, "botId")) {
    const botId = idText(v.botId);
    if (botId) o.botId = botId;
    else delete o.botId;
  }
  return o;
}

function marginModeOf(v: unknown): MarginMode | undefined {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s === "isolated" || s === "isolation" ? "isolated" : s === "cross" || s === "crossed" ? "cross" : undefined;
}

/** Coerces the journal-v3 keys present in `r` onto `out` (which already carries them verbatim via the spread). */
function normalizeJournalV3(r: Raw, out: Raw): void {
  const put = (k: string, v: unknown): void => {
    if (v === undefined) delete out[k];
    else out[k] = v;
  };
  for (const k of V3_TIME) if (has(r, k)) put(k, typeof r[k] === "string" && r[k] !== "" ? r[k] : undefined);
  for (const k of V3_TEXT) if (has(r, k)) put(k, idText(r[k]));
  for (const k of V3_NUM) if (has(r, k)) put(k, numOrNull(r[k]));
  if (has(r, "market")) put("market", r.market === "spot" || r.market === "perp" ? r.market : undefined);
  if (has(r, "marginMode")) put("marginMode", marginModeOf(r.marginMode));
  if (has(r, "tags")) put("tags", stringList(r.tags) ?? undefined);
  if (has(r, "rating")) put("rating", scale5(r.rating));
  if (has(r, "fills")) put("fills", fillsOf(r.fills));
  if (has(r, "screenshots")) put("screenshots", screenshotsOf(r.screenshots));
  if (has(r, "annotations")) put("annotations", annotationsOf(r.annotations));
  if (has(r, "stopHistory")) put("stopHistory", stopHistoryOf(r.stopHistory));
  if (has(r, "targets")) put("targets", targetsOf(r.targets));
  if (has(r, "psych")) put("psych", psychOf(r.psych));
  if (has(r, "origin")) put("origin", originOf(r.origin));
  // boxSnap: opaque (P02 parses it) – kept verbatim by the spread.
}

/** Normalises a persisted Hyblock reading ("Ablesung"). */
export function normalizeReading(raw: unknown): HyblockReading {
  const r: Raw = isObj(raw) ? raw : {};
  return {
    ...r,
    id: str(r.id),
    at: str(r.at),
    longPct: parseNumber(r.longPct) ?? 0,
    delta: parseNumber(r.delta) ?? 0,
    deltaCandles: Math.max(0, Math.round(parseNumber(r.deltaCandles) ?? 0)),
    structure: !!r.structure,
    rsi: !!r.rsi,
    note: str(r.note),
  };
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** True for a `tj2-days` key (`YYYY-MM-DD`). */
export function isDayKey(key: string): boolean {
  return DAY_KEY.test(key);
}

/** One `tj2-days` entry: `note` always a string, `plan`/`review` only when strings, `mood` 1–5 or `null`; unknown keys survive. */
export function normalizeDayNote(raw: unknown): DayNote {
  const r: Raw = isObj(raw) ? raw : {};
  const out: DayNote = { ...r, note: str(r.note), updatedAt: str(r.updatedAt) };
  if (typeof r.plan !== "string") delete out.plan;
  if (typeof r.review !== "string") delete out.review;
  if ("mood" in r) {
    const m = numOrNull(r.mood);
    out.mood = m != null && Number.isInteger(m) && m >= 1 && m <= 5 ? (m as DayNote["mood"]) : null;
  }
  return out;
}

/** `tj2-days` read path: object of `YYYY-MM-DD` → entry; other keys / non-object values are skipped (left in storage). */
export function normalizeDayNotes(raw: unknown): DayNotes {
  const out: DayNotes = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (isDayKey(k) && isObj(v)) out[k] = normalizeDayNote(v);
  return out;
}

/** True when a day entry carries nothing worth keeping (no text, no mood, no extra keys). */
export function isEmptyDayNote(d: DayNote): boolean {
  const known = new Set(["note", "plan", "review", "mood", "updatedAt"]);
  if (Object.keys(d).some((k) => !known.has(k))) return false;
  return !d.note.trim() && !(d.plan ?? "").trim() && !(d.review ?? "").trim() && d.mood == null;
}

/** Bundle read order for `tj2-hyblock`: `a.at.localeCompare(b.at)`. */
export function sortReadings(list: readonly HyblockReading[]): HyblockReading[] {
  return [...list].sort((a, b) => a.at.localeCompare(b.at));
}

export const qM = normalizeSettings;
