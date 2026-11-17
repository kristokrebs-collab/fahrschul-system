/**
 * Form model of the key-level editor: strings in, a `KeyLevel` (or the errors) out. Pure – the component only wires it.
 */
import { blankKeyLevel, DEFAULT_DISTANCE, MAX_NAME, type DistanceMode, type KeyLevel, type KeyTf, type LevelDirection, type PlanRole, type TriggerKind } from "@/domain/keylevels";
import { parseNumber, toInputString } from "@/lib/parse";

export interface EditorForm {
  name: string;
  price: string;
  tf: KeyTf;
  direction: LevelDirection;
  kind: TriggerKind;
  closes: string;
  distMode: DistanceMode;
  distValue: string;
  invalidation: string;
  priority: number;
  role: PlanRole;
  note: string;
  alertsOn: boolean;
  prepare: boolean;
  confirm: boolean;
  retest: boolean;
  invalid: boolean;
  recurring: boolean;
}

export function emptyForm(): EditorForm {
  return {
    name: "",
    price: "",
    tf: "4h",
    direction: "above",
    kind: "close",
    closes: "2",
    distMode: DEFAULT_DISTANCE.mode,
    distValue: toInputString(DEFAULT_DISTANCE.value),
    invalidation: "",
    priority: 3,
    role: "auto",
    note: "",
    alertsOn: false,
    prepare: true,
    confirm: true,
    retest: true,
    invalid: true,
    recurring: false,
  };
}

export function formFromLevel(l: KeyLevel): EditorForm {
  return {
    name: l.name,
    price: toInputString(l.price),
    tf: l.tf,
    direction: l.direction,
    kind: l.kind,
    closes: String(l.closes),
    distMode: l.distance.mode,
    distValue: toInputString(l.distance.value),
    invalidation: l.invalidation == null ? "" : toInputString(l.invalidation),
    priority: Math.min(5, l.priority),
    role: l.role,
    note: l.note,
    alertsOn: l.alerts.on,
    prepare: l.alerts.prepare,
    confirm: l.alerts.confirm,
    retest: l.alerts.retest,
    invalid: l.alerts.invalid,
    recurring: l.alerts.recurring,
  };
}

/**
 * A price typed by hand. `parseNumber` reads "85.900" as 85,9 (a dot without a comma is a decimal point); for a price
 * "80.000" nearly always means eighty thousand. When both readings exist the one closer to the live price `ref` wins;
 * without a reference the thousands reading wins for groups of exactly three digits (`1–3 digits` then `.ddd` groups).
 */
export function parsePriceInput(text: string, ref?: number | null): number | null {
  const t = text.trim().replace(/\s/g, "");
  const plain = parseNumber(t);
  if (!/^\d{1,3}(\.\d{3})+$/.test(t)) return plain;
  const thousands = Number(t.replace(/\./g, ""));
  if (plain == null || !(plain > 0)) return thousands;
  if (ref != null && ref > 0) return Math.abs(Math.log(thousands / ref)) <= Math.abs(Math.log(plain / ref)) ? thousands : plain;
  return thousands;
}

export interface EditorErrors {
  price?: string;
  tf?: string;
  invalidation?: string;
  distance?: string;
}

export type EditorResult = { ok: true; level: KeyLevel } | { ok: false; errors: EditorErrors };

/** The fields whose change restarts a level ("zählt ab jetzt"). */
function sameRule(a: KeyLevel, b: KeyLevel): boolean {
  return a.price === b.price && a.tf === b.tf && a.direction === b.direction && a.kind === b.kind && a.closes === b.closes && a.distance.mode === b.distance.mode && a.distance.value === b.distance.value && a.invalidation === b.invalidation;
}

export interface BuildCtx {
  id: string;
  symbol: string;
  now: number;
  /** the level being edited (keeps `since` when the rule did not change) */
  prev?: KeyLevel | null;
  /** live price for the price reading */
  ref?: number | null;
  /** timeframes the feed can serve right now */
  available: ReadonlySet<KeyTf>;
}

export function levelFromForm(f: EditorForm, ctx: BuildCtx): EditorResult {
  const errors: EditorErrors = {};
  const price = parsePriceInput(f.price, ctx.ref);
  if (price == null || !(price > 0)) errors.price = "Bitte einen Preis über 0 eingeben.";
  // an unchanged timeframe of an existing level stays selectable even when the feed is down right now (editing a name)
  if (!ctx.available.has(f.tf) && ctx.prev?.tf !== f.tf) errors.tf = "Diese Zeiteinheit ist gerade nicht verfügbar.";
  const invRaw = f.invalidation.trim();
  const inv = invRaw ? parsePriceInput(invRaw, ctx.ref) : null;
  if (invRaw && (inv == null || !(inv > 0))) errors.invalidation = "Bitte einen Preis über 0 eingeben oder das Feld leeren.";
  else if (inv != null && price != null) {
    const wrong = f.direction === "above" ? inv >= price : inv <= price;
    if (wrong) errors.invalidation = f.direction === "above" ? "Die Invalidierung muss unter dem Level liegen." : "Die Invalidierung muss über dem Level liegen.";
  }
  const dist = parseNumber(f.distValue);
  const needsDist = f.kind === "buffer" || f.kind === "retest";
  if (needsDist && (dist == null || !(dist >= 0) || dist > 1000)) errors.distance = "Bitte einen Abstand ab 0 eingeben.";
  if (Object.keys(errors).length || price == null) return { ok: false, errors };

  const closes = Math.min(10, Math.max(2, Math.round(parseNumber(f.closes) ?? 2)));
  const base = blankKeyLevel({ id: ctx.id, symbol: ctx.symbol, price }, ctx.now);
  const level: KeyLevel = {
    ...base,
    name: f.name.trim().slice(0, MAX_NAME) || defaultName(price, f),
    tf: f.tf,
    direction: f.direction,
    kind: f.kind,
    closes: f.kind === "closes" ? closes : (ctx.prev?.closes ?? 2),
    distance: needsDist ? { mode: f.distMode, value: dist ?? DEFAULT_DISTANCE.value } : (ctx.prev?.distance ?? DEFAULT_DISTANCE),
    invalidation: inv,
    priority: f.priority,
    role: f.role,
    enabled: ctx.prev?.enabled ?? true,
    note: f.note.trim().slice(0, 280),
    alerts: { on: f.alertsOn, prepare: f.prepare, confirm: f.confirm, retest: f.retest, invalid: f.invalid, recurring: f.recurring },
    symbol: ctx.prev?.symbol ?? ctx.symbol,
  };
  level.since = ctx.prev && sameRule(ctx.prev, level) ? ctx.prev.since : ctx.now;
  return { ok: true, level };
}

function defaultName(price: number, f: Pick<EditorForm, "direction" | "tf">): string {
  const p = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(price);
  return `${f.direction === "above" ? "Über" : "Unter"} ${p} (${f.tf})`;
}
