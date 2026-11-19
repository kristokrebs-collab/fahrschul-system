/**
 * Layout of the trade form (Etappe 1b): which of the form's fields sit in the always-visible core and which in an
 * accordion group. Pure logic plus the per-device storage; the view is `TradeFormParts.tsx`, the wiring `TradeEditor.tsx`.
 *
 * Nothing about the DATA changes here: a field that sits in a closed group is still mounted, still validated and still
 * saved – the layout only decides where it is shown. Stored per device (`storageKey("trade-form-layout")`, localStorage
 * with try/catch), NOT in `settings`: a phone and a desktop want different layouts, and the layout must not travel through
 * the backup / cloud merge. Only the DEVIATIONS from the default are stored (`{ v: 1, moved: { stop: "core" } }`), so a
 * field a later version adds simply takes its default place.
 */
import { journalDefaults, type JournalForm } from "@/journal/editor/form";
import { jsonEqual } from "@/store/merge3";
import { storageKey } from "@/store/storage";

import { FIELD_IDS, type FieldId } from "./tradeFormFields";

export { FIELD_IDS, type FieldId };

/** The accordion groups, in display order. */
export const GROUP_IDS = ["details", "targets", "execution", "setup", "discipline", "notes"] as const;
export type GroupId = (typeof GROUP_IDS)[number];
/** Where a field is shown: the core or one accordion group. */
export type ZoneId = "core" | GroupId;

export const CORE_ZONE: ZoneId = "core";
export const CORE_TITLE = "Kernfelder";
export const CORE_SUB = "Reichen zum Speichern";

export interface GroupDef {
  id: GroupId;
  title: string;
}
export const GROUPS: readonly GroupDef[] = [
  { id: "details", title: "Details" },
  { id: "targets", title: "Ziele und Ausstieg" },
  { id: "execution", title: "Ausführung" },
  { id: "setup", title: "Setup und Einstiegs-Check" },
  { id: "discipline", title: "Disziplin und Psyche" },
  { id: "notes", title: "Notizen und Bewertung" },
];

export interface FieldDef {
  id: FieldId;
  /** The label of the customise list (the form's own label stays as it was). */
  label: string;
  /** Where it sits by default. */
  home: ZoneId;
  /** Grid cell on the form's 2 / 4 column grid. `full` = a whole row (a block with its own inner layout). */
  span: "one" | "two" | "full";
  /** The DOM id of the control a validation message jumps to (`f-…`), where the field has one. */
  domId?: string;
  /** Counts for the `n ausgefüllt` badge of a group (fields that always carry a value – side, status – do not). */
  optional: boolean;
}

const f = (id: FieldId, label: string, home: ZoneId, span: FieldDef["span"], optional: boolean, domId?: string): FieldDef => ({ id, label, home, span, optional, domId });

/** The catalog. The core default is exactly what `validateRecord` asks of a closed trade: date, entry, exit, size – plus pair and side. */
export const FIELDS: readonly FieldDef[] = [
  f("pair", "Paar", "core", "one", false, "f-pair"),
  f("side", "Richtung", "core", "one", false),
  f("date", "Datum & Uhrzeit", "core", "two", false, "f-date"),
  f("account", "Konto", "details", "one", false),
  f("timeframe", "Timeframe", "details", "one", true, "f-tf"),
  f("status", "Status", "details", "two", false),
  f("entry", "Einstieg", "core", "one", false, "f-entry"),
  f("stop", "Stop-Loss", "targets", "one", true, "f-stop"),
  f("target", "Take-Profit", "targets", "one", true, "f-target"),
  f("exit", "Ausstieg", "core", "one", false, "f-exit"),
  f("size", "Größe", "core", "one", false, "f-size"),
  f("leverage", "Hebel", "targets", "one", true, "f-lev"),
  f("fees", "Gebühren", "targets", "one", true, "f-fees"),
  f("pnlManual", "P&L manuell", "targets", "one", true, "f-pnl"),
  f("signal", "Einstiegs-Check", "setup", "full", false),
  f("execution", "Ausführung (Fills, Margin, Börse …)", "execution", "full", true),
  f("setups", "Entscheidungsgrundlage", "setup", "full", true),
  f("reason", "Begründung", "setup", "full", true, "f-reason"),
  f("checklist", "Checkliste", "setup", "full", true),
  f("conviction", "Überzeugung", "discipline", "full", true),
  f("followedPlan", "Plan befolgt?", "discipline", "two", true),
  f("emotion", "Gefühl beim Einstieg", "discipline", "two", true),
  f("tags", "Tags", "notes", "two", true),
  f("rating", "Bewertung", "notes", "two", true),
  f("psych", "Psyche", "discipline", "full", true),
  f("mistakes", "Fehler", "discipline", "full", true),
  f("notes", "Learnings & Notizen", "notes", "full", true, "f-notes"),
  f("chart", "Chart-Link (TradingView)", "notes", "full", true, "f-chart"),
  f("shots", "Screenshots", "notes", "full", true),
];

const BY_ID: ReadonlyMap<FieldId, FieldDef> = new Map(FIELDS.map((d) => [d.id, d]));
export const fieldDef = (id: FieldId): FieldDef => BY_ID.get(id) as FieldDef;
export const isFieldId = (v: unknown): v is FieldId => typeof v === "string" && BY_ID.has(v as FieldId);
export const isZoneId = (v: unknown): v is ZoneId => v === "core" || (GROUP_IDS as readonly unknown[]).includes(v);
export const groupDef = (id: GroupId): GroupDef => GROUPS.find((g) => g.id === id) as GroupDef;
export const zoneTitle = (z: ZoneId): string => (z === "core" ? CORE_TITLE : groupDef(z).title);

/** field → zone, for every field. */
export type FormLayout = Readonly<Record<FieldId, ZoneId>>;

export function defaultLayout(): FormLayout {
  return Object.fromEntries(FIELDS.map((d) => [d.id, d.home])) as Record<FieldId, ZoneId>;
}

export function isDefaultLayout(layout: FormLayout): boolean {
  return FIELDS.every((d) => layout[d.id] === d.home);
}

/** Moves one field; moving it to the zone it is in returns the same layout object. */
export function moveField(layout: FormLayout, id: FieldId, zone: ZoneId): FormLayout {
  if (!isFieldId(id) || !isZoneId(zone) || layout[id] === zone) return layout;
  return { ...layout, [id]: zone };
}

/** The fields of a zone in catalog order. */
export function fieldsIn(layout: FormLayout, zone: ZoneId): FieldDef[] {
  return FIELDS.filter((d) => layout[d.id] === zone);
}

/** The core's size – the number the customise list shows. */
export const coreCount = (layout: FormLayout): number => fieldsIn(layout, "core").length;

/** The stored shape: only the fields that are NOT in their default zone. */
export interface StoredLayout {
  v: 1;
  moved: Partial<Record<FieldId, ZoneId>>;
}
export const LAYOUT_VERSION = 1 as const;
export const layoutKey = (): string => storageKey("trade-form-layout");

export function toStored(layout: FormLayout): StoredLayout {
  const moved: Partial<Record<FieldId, ZoneId>> = {};
  for (const d of FIELDS) if (layout[d.id] !== d.home) moved[d.id] = layout[d.id];
  return { v: LAYOUT_VERSION, moved };
}

/**
 * Lenient read: anything that is not a `{ v: 1, moved }` object with known ids and zones falls back to the default
 * (per field – one unknown entry does not spoil the others). A newer version's layout (`v` > 1) is not guessed at.
 */
export function sanitizeLayout(raw: unknown): FormLayout {
  const out = { ...defaultLayout() } as Record<FieldId, ZoneId>;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  const r = raw as { v?: unknown; moved?: unknown };
  if (r.v !== LAYOUT_VERSION) return out;
  if (typeof r.moved !== "object" || r.moved === null || Array.isArray(r.moved)) return out;
  for (const [k, z] of Object.entries(r.moved as Record<string, unknown>)) if (isFieldId(k) && isZoneId(z)) out[k] = z;
  return out;
}

export function readLayout(): FormLayout {
  try {
    const raw = globalThis.localStorage?.getItem(layoutKey());
    return sanitizeLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultLayout();
  }
}

/** Writes the layout (the default layout removes the key). A blocked storage just means the layout is forgotten on reload. */
export function writeLayout(layout: FormLayout): void {
  try {
    if (isDefaultLayout(layout)) globalThis.localStorage?.removeItem(layoutKey());
    else globalThis.localStorage?.setItem(layoutKey(), JSON.stringify(toStored(layout)));
  } catch {
    /* private mode / quota: works for this session */
  }
}

/* ------------------------------------------------------------------------------------------------ "n ausgefüllt" */

/** What `filledFields` needs to see of the form. */
export interface FilledInput {
  d: { timeframe: string; stop: string; target: string; leverage: string; fees: string; pnlManual: string; reason: string; notes: string; chart: string };
  t: {
    setups: readonly string[];
    checks: Readonly<Record<string, boolean>>;
    conviction: unknown;
    followedPlan: boolean | null;
    emotion: string;
    mistakes: readonly string[];
    j: JournalForm;
  };
}

/** The keys of `JournalForm` the `Ausführung` block edits, and the ones the `Psyche` block edits. */
const EXECUTION_KEYS = ["exitDate", "qty", "fundingFees", "slippage", "plannedEntry", "margin", "liqPrice", "market", "marginMode", "exchange", "exchangeAccount", "fills", "targets", "stops", "botOn", "bot", "decision"] as const;
const PSYCH_KEYS = ["stress", "confidence", "flags", "exitReason", "preNote", "postNote"] as const;

/** True when any of `keys` of the journal part differs from a fresh form. */
function touched(j: JournalForm, keys: readonly (keyof JournalForm)[]): boolean {
  const base = journalDefaults();
  return keys.some((k) => !jsonEqual(j[k], base[k]));
}

const has = (s: string): boolean => s.trim() !== "";

/** The optional fields that carry a value. Fields that always carry one (side, status, account, date …) are never listed. */
export function filledFields(x: FilledInput): FieldId[] {
  const out: FieldId[] = [];
  const add = (cond: boolean, id: FieldId) => {
    if (cond) out.push(id);
  };
  add(has(x.d.timeframe), "timeframe");
  add(has(x.d.stop), "stop");
  add(has(x.d.target), "target");
  add(has(x.d.leverage), "leverage");
  add(has(x.d.fees), "fees");
  add(has(x.d.pnlManual), "pnlManual");
  add(touched(x.t.j, EXECUTION_KEYS), "execution");
  add(x.t.setups.length > 0, "setups");
  add(has(x.d.reason), "reason");
  add(Object.values(x.t.checks).some(Boolean), "checklist");
  add(x.t.conviction != null, "conviction");
  add(x.t.followedPlan != null, "followedPlan");
  add(has(x.t.emotion), "emotion");
  add(x.t.j.tags.length > 0, "tags");
  add(x.t.j.rating != null, "rating");
  add(touched(x.t.j, PSYCH_KEYS), "psych");
  add(x.t.mistakes.length > 0, "mistakes");
  add(has(x.d.notes), "notes");
  add(has(x.d.chart), "chart");
  add(x.t.j.screenshots.length > 0, "shots");
  return out;
}

/** Number of filled optional fields per zone. */
export function filledByZone(layout: FormLayout, filled: readonly FieldId[]): Record<ZoneId, number> {
  const out: Record<string, number> = { core: 0 };
  for (const g of GROUP_IDS) out[g] = 0;
  for (const id of filled) if (fieldDef(id).optional) out[layout[id]] = (out[layout[id]] ?? 0) + 1;
  return out as Record<ZoneId, number>;
}

/** The group a field sits in (`null` = the core, always visible). */
export function groupOf(layout: FormLayout, id: FieldId): GroupId | null {
  const z = layout[id];
  return z === "core" ? null : z;
}

/** Short list of the group's field labels for its header ("Stop-Loss, Take-Profit, Hebel …"). */
export function groupHint(layout: FormLayout, group: GroupId, max = 4): string {
  const labels = fieldsIn(layout, group).map((d) => d.label.replace(/ \(.*\)$/, ""));
  if (labels.length === 0) return "leer";
  return labels.length > max ? `${labels.slice(0, max).join(", ")} …` : labels.join(", ");
}
