/**
 * Signal schema `signal/1` and the adapters in front of it (Paket B3). Pure: text in, one normalised signal or ONE reason out –
 * no database, no clock (callers pass `nowMs`), nothing is logged.
 *
 * signal/1 (all fields strings unless noted; a field that is not listed is refused – there is NO order size, ever):
 *   { "schema": "signal/1", "source": "tradingview", "signalId": "…", "strategy": "…", "market": "AMEX" (optional),
 *     "symbol": "XLE", "direction": "long" | "flat", "time": "2026-11-06T21:00:00Z", "data": { flat object, optional } }
 * `flat` = no position (cash / exit). Nothing is ever "short": the app does not trade from a signal.
 *
 * Adapters (the sender keeps its own format, the receiver turns it into signal/1):
 *   branchen-trend/1  the alert of the Branchen-Trend Pine script (`src/domain/industryTrend/pine.ts`): signal KAUF → long (state grün),
 *                     VERKAUF → flat (state rot); `datum` is the time; the signal id is derived from strategy, symbol, direction and DAY,
 *                     so a re-delivery on another minute is still the same signal.
 *   legacy-action     the older `{"action":"open"|"close", …}` message of hooks-tradingview (open → long, close → flat; quantity and size
 *                     are dropped, short is refused); signal id derived from action, symbol, side, `id` and the minute.
 *
 * Limits: body ≤ 8 KiB (`MAX_SIGNAL_BYTES`, checked by the caller before parsing), `data` ≤ 2 KiB, flat, ≤ 20 keys, no size-like key.
 * Text that reaches the owner's screen is plain: control characters and `<` `>` never survive (`clean`).
 */
import { createHash } from "node:crypto";

export const MAX_SIGNAL_BYTES = 8 * 1024;
export const MAX_DATA_BYTES = 2 * 1024;
export const MAX_DATA_KEYS = 20;
/** A signal may name a time at most this far ahead (clock drift) and at most this far back (nonsense beyond). */
export const MAX_FUTURE_MS = 10 * 60_000;
export const MAX_PAST_MS = 366 * 86_400_000;

export type Direction = "long" | "flat";
export type SchemaId = "signal/1" | "branchen-trend/1" | "legacy-action";

export interface NormalizedSignal {
  kind: "signal" | "test";
  schemaId: SchemaId | null;
  source: string;
  signalId: string | null;
  strategy: string | null;
  market: string | null;
  symbol: string | null;
  direction: Direction | null;
  /** ISO time the signal names */
  time: string | null;
  data: Record<string, string | number | boolean | null> | null;
  via: "app" | "extern";
}

export type ParseResult = { ok: true; signal: NormalizedSignal } | { ok: false; reason: string; schemaId: SchemaId | null };

/** plain text: control characters and markup characters become spaces, runs collapse, cut to `max` */
export function clean(v: string, max: number): string {
  return [...v].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === "<" || c === ">" ? " " : c)).join("").replace(/\s+/g, " ").trim().slice(0, max);
}

/** a key name shown in a reason: short and plain */
const keyName = (k: string): string => clean(k, 30) || "?";

const SOURCE_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const SIGNAL_ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;
const SYMBOL_RE = /^[A-Za-z0-9._:/!&^-]{1,40}$/;
const MARKET_RE = /^[A-Za-z0-9._ -]{1,20}$/;
const STRATEGY_RE = /^[\p{L}\p{N} ._:/-]{1,60}$/u;
const DATA_KEY_RE = /^[A-Za-z0-9_.-]{1,30}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;
/** order-size-like names: refused at the top level and inside `data` */
const SIZE_KEY_RE = /^(qty|quantity|size|amount|contracts|leverage|lots|notional|volume|order_?size|position_?size|stake|risk)$/i;

const fail = (reason: string, schemaId: SchemaId | null): ParseResult => ({ ok: false, reason, schemaId });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/** The time as ISO, or a reason. A placeholder TradingView did not fill is named as such. */
export function parseTime(v: unknown, nowMs: number): { ok: true; iso: string } | { ok: false; reason: string } {
  if (typeof v !== "string") return { ok: false, reason: "Die Zeit fehlt oder ist kein Text (erwartet: 2026-11-06T21:00:00Z)." };
  if (v.includes("{{")) return { ok: false, reason: "TradingView hat einen Platzhalter nicht ersetzt (in der Zeit steht noch {{…}})." };
  if (!ISO_RE.test(v)) return { ok: false, reason: "Die Zeit ist kein ISO-Zeitpunkt (erwartet: 2026-11-06T21:00:00Z)." };
  const t = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (!Number.isFinite(t)) return { ok: false, reason: "Die Zeit ist kein gültiger Zeitpunkt." };
  if (t > nowMs + MAX_FUTURE_MS) return { ok: false, reason: "Die Zeit liegt in der Zukunft." };
  if (t < nowMs - MAX_PAST_MS) return { ok: false, reason: "Die Zeit liegt mehr als ein Jahr zurück." };
  return { ok: true, iso: new Date(t).toISOString() };
}

function text(v: unknown, label: string, re: RegExp, required: boolean): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (v === undefined || v === null || v === "") return required ? { ok: false, reason: `Das Feld „${label}“ fehlt.` } : { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, reason: `Das Feld „${label}“ muss Text sein.` };
  if (v.includes("{{")) return { ok: false, reason: `TradingView hat einen Platzhalter nicht ersetzt („${label}“ enthält noch {{…}}).` };
  const s = v.trim();
  return re.test(s) ? { ok: true, value: s } : { ok: false, reason: `Das Feld „${label}“ hat ein ungültiges Format.` };
}

/** `data`: a flat object of plain values, within the limits; null when absent */
function parseData(v: unknown, schemaId: SchemaId): { ok: true; data: NormalizedSignal["data"] } | { ok: false; reason: string } {
  if (v === undefined || v === null) return { ok: true, data: null };
  if (!isObj(v)) return { ok: false, reason: "„data“ muss ein Objekt sein." };
  const keys = Object.keys(v);
  if (keys.length > MAX_DATA_KEYS) return { ok: false, reason: `„data“ hat mehr als ${MAX_DATA_KEYS} Felder.` };
  const out: Record<string, string | number | boolean | null> = {};
  for (const k of keys) {
    if (!DATA_KEY_RE.test(k)) return { ok: false, reason: `„data“ enthält einen ungültigen Feldnamen („${keyName(k)}“).` };
    if (SIZE_KEY_RE.test(k)) return { ok: false, reason: `„data“ darf keine Ordergröße enthalten („${keyName(k)}“): ${schemaId} sendet nur Richtung, nie eine Größe.` };
    const x = v[k];
    if (typeof x === "string") out[k] = clean(x, 200);
    else if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
    else if (typeof x === "boolean" || x === null) out[k] = x;
    else return { ok: false, reason: `„data.${keyName(k)}“ muss Text, Zahl, ja/nein oder leer sein (keine Listen oder Objekte).` };
  }
  if (new TextEncoder().encode(JSON.stringify(out)).length > MAX_DATA_BYTES) return { ok: false, reason: `„data“ ist größer als ${MAX_DATA_BYTES / 1024} KiB.` };
  return { ok: true, data: keys.length ? out : null };
}

/** the symbol without an exchange prefix (`AMEX:XLE` → `XLE`) for ids and matching; the stored symbol keeps what was sent */
export const bareSymbol = (s: string): string => (s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : s).toUpperCase();

function parseV1(o: Record<string, unknown>, nowMs: number): ParseResult {
  const ID = "signal/1" as const;
  const allowed = new Set(["schema", "source", "signalId", "strategy", "market", "symbol", "direction", "time", "data"]);
  for (const k of Object.keys(o)) {
    if (allowed.has(k)) continue;
    if (SIZE_KEY_RE.test(k)) return fail(`Das Feld „${keyName(k)}“ ist nicht Teil von signal/1: das Schema kennt keine Ordergröße und die App sendet nie eine Order.`, ID);
    return fail(`Unbekanntes Feld „${keyName(k)}“ (signal/1 erlaubt nur: ${[...allowed].join(", ")}).`, ID);
  }
  const source = text(o.source, "source", SOURCE_RE, true);
  if (!source.ok) return fail(source.reason, ID);
  const signalId = text(o.signalId, "signalId", SIGNAL_ID_RE, true);
  if (!signalId.ok) return fail(signalId.reason, ID);
  const strategy = text(o.strategy, "strategy", STRATEGY_RE, true);
  if (!strategy.ok) return fail(strategy.reason, ID);
  const market = text(o.market, "market", MARKET_RE, false);
  if (!market.ok) return fail(market.reason, ID);
  const symbol = text(o.symbol, "symbol", SYMBOL_RE, true);
  if (!symbol.ok) return fail(symbol.reason, ID);
  if (o.direction !== "long" && o.direction !== "flat") return fail("„direction“ muss „long“ oder „flat“ sein (short gibt es nicht).", ID);
  const t = parseTime(o.time, nowMs);
  if (!t.ok) return fail(t.reason, ID);
  const data = parseData(o.data, ID);
  if (!data.ok) return fail(data.reason, ID);
  return {
    ok: true,
    signal: {
      kind: "signal",
      schemaId: ID,
      source: source.value!,
      signalId: signalId.value!,
      strategy: clean(strategy.value!, 60),
      market: market.value ? clean(market.value, 20) : null,
      symbol: clean(symbol.value!, 40),
      direction: o.direction,
      time: t.iso,
      data: data.data,
      via: "extern",
    },
  };
}

/** The Branchen-Trend alert (`PAYLOAD_JSON_SCHEMA` in `src/domain/industryTrend/pine.ts`, additionalProperties false). */
function parseBranchen(o: Record<string, unknown>, nowMs: number): ParseResult {
  const ID = "branchen-trend/1" as const;
  const allowed = new Set(["schema", "strategie", "signal", "symbol", "datum", "kurs", "modus"]);
  for (const k of Object.keys(o)) if (!allowed.has(k)) return fail(`Unbekanntes Feld „${keyName(k)}“ (branchen-trend/1 erlaubt nur: ${[...allowed].join(", ")}).`, ID);
  const strategie = text(o.strategie, "strategie", /^s-[0-9.-]{1,50}$/, true);
  if (!strategie.ok) return fail(strategie.reason, ID);
  if (o.signal !== "KAUF" && o.signal !== "VERKAUF") return fail("„signal“ muss KAUF oder VERKAUF sein.", ID);
  const symbol = text(o.symbol, "symbol", SYMBOL_RE, true);
  if (!symbol.ok) return fail(symbol.reason, ID);
  const t = parseTime(o.datum, nowMs);
  if (!t.ok) return fail(t.reason.replace("Die Zeit", "„datum“").replace("in der Zeit", "in „datum“"), ID);
  if (o.modus !== undefined && o.modus !== "DEMO/PAPIER") return fail("„modus“ muss DEMO/PAPIER sein: aus diesem Signal wird nie eine echte Order.", ID);
  let kurs: number | null = null;
  if (o.kurs !== undefined && o.kurs !== null) {
    if (typeof o.kurs !== "number" || !Number.isFinite(o.kurs) || !(o.kurs > 0)) return fail("„kurs“ muss eine positive Zahl sein.", ID);
    kurs = o.kurs;
  }
  const direction: Direction = o.signal === "KAUF" ? "long" : "flat";
  const sym = bareSymbol(symbol.value!);
  const day = t.iso.slice(0, 10);
  const data: NormalizedSignal["data"] = { zustand: direction === "long" ? "gruen" : "rot", ...(kurs !== null ? { kurs } : {}), modus: "DEMO/PAPIER" };
  return {
    ok: true,
    signal: {
      kind: "signal",
      schemaId: ID,
      source: "tradingview",
      signalId: `bt_${sha(`tradingview|${strategie.value}|${sym}|${direction}|${day}`).slice(0, 24)}`,
      strategy: strategie.value!,
      market: null,
      symbol: clean(symbol.value!, 40),
      direction,
      time: t.iso,
      data,
      via: "extern",
    },
  };
}

/** The older trade alert (`hooks-tradingview`): `open` → long, `close` → flat. Size fields are not read at all. */
function parseLegacy(o: Record<string, unknown>, nowMs: number): ParseResult {
  const ID = "legacy-action" as const;
  const rawSymbol = typeof o.symbol === "string" ? o.symbol : typeof o.ticker === "string" ? o.ticker : "";
  const symbol = text(rawSymbol.trim() || undefined, "symbol", SYMBOL_RE, true);
  if (!symbol.ok) return fail(symbol.reason, ID);
  const side = typeof o.side === "string" ? o.side.toLowerCase() : "";
  if (o.action === "open" && /^(short|sell)$/.test(side)) return fail("Short-Signale gibt es nicht: signal/1 kennt nur long oder flat.", ID);
  const direction: Direction = o.action === "open" ? "long" : "flat";
  const idPart = typeof o.id === "string" ? clean(o.id, 60) : "";
  const minute = Math.floor(nowMs / 60_000);
  const price = typeof o.price === "number" && Number.isFinite(o.price) && o.price > 0 ? o.price : null;
  const setup = typeof o.setup === "string" ? clean(o.setup, 60) : "";
  return {
    ok: true,
    signal: {
      kind: "signal",
      schemaId: ID,
      source: "tradingview",
      signalId: `lg_${sha(`${o.action}|${bareSymbol(symbol.value!)}|${side}|${idPart}|${minute}`).slice(0, 24)}`,
      strategy: setup && STRATEGY_RE.test(setup) ? setup : "alarm",
      market: null,
      symbol: clean(symbol.value!, 40),
      direction,
      time: new Date(nowMs).toISOString(),
      data: { aktion: o.action as string, ...(price !== null ? { kurs: price } : {}) },
      via: "extern",
    },
  };
}

/** The connection assistant's test signal (`{"action":"test",…}`): no direction, no dedup. */
function parseTest(o: Record<string, unknown>): NormalizedSignal {
  const sym = typeof o.symbol === "string" ? clean(o.symbol, 40) : typeof o.ticker === "string" ? clean(o.ticker, 40) : "";
  return { kind: "test", schemaId: null, source: "tradingview", signalId: null, strategy: null, market: null, symbol: sym || null, direction: null, time: null, data: null, via: o.source === "app" ? "app" : "extern" };
}

/** Which schema a parsed JSON claims (without validating it). */
export function claimedSchema(o: unknown): "signal/1" | "branchen-trend/1" | "legacy-action" | "test" | null {
  if (!isObj(o)) return null;
  if (o.schema === "signal/1") return "signal/1";
  if (o.schema === "branchen-trend/1") return "branchen-trend/1";
  if (o.action === "test") return "test";
  if (o.action === "open" || o.action === "close") return "legacy-action";
  return null;
}

/** Cheap check for the older webhook: does this body belong to the signal receiver (a signal/1 or Branchen-Trend message)? */
export function isSignalSchemaBody(textBody: string): boolean {
  try {
    const c = claimedSchema(JSON.parse(textBody));
    return c === "signal/1" || c === "branchen-trend/1";
  } catch {
    return false;
  }
}

/** Parses a delivery body. Every refusal carries ONE plain German reason (shown to the owner, never the body itself). */
export function parseSignalBody(body: string, nowMs: number): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return fail("Die Nachricht ist kein gültiges JSON. Nutze eine Vorlage aus dem Assistenten.", null);
  }
  if (!isObj(raw)) return fail("Die Nachricht muss ein JSON-Objekt sein.", null);
  switch (claimedSchema(raw)) {
    case "signal/1":
      return parseV1(raw, nowMs);
    case "branchen-trend/1":
      return parseBranchen(raw, nowMs);
    case "legacy-action":
      return parseLegacy(raw, nowMs);
    case "test":
      return { ok: true, signal: parseTest(raw) };
    default:
      return fail(typeof raw.schema === "string" ? `Unbekanntes Schema „${keyName(raw.schema)}“ (bekannt: signal/1, branchen-trend/1).` : "Es fehlt das Feld „schema“ (erwartet: signal/1 oder branchen-trend/1).", null);
  }
}
