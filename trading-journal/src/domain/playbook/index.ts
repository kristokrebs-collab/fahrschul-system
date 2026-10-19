/**
 * Strategy / playbook exchange (F13 / F45, pure): a rule draft as a small, versioned JSON text ("Playbook") that can be saved
 * as a file or pasted, and read back with STRICT validation. No server, no marketplace, no code: the text is parsed as data
 * (`JSON.parse`), checked against a schema, rebuilt field by field from a whitelist and only then handed on.
 *
 * What a playbook holds: title, description, optional author and market, the rule tree (stop, target, management) – nothing
 * from the journal (no trades, notes, accounts, amounts). What an import refuses (each reason named): too large, not JSON,
 * a wrong format or a newer version, forbidden keys (`__proto__` …), building blocks this version does not know, a tree
 * beyond the app's limits, values of the wrong type, rules that cannot run. Values outside the allowed range are clamped and
 * listed as warnings; a checksum that does not match (edited after the export) is a warning.
 */
import { BLOCKS, isBlockId } from "../lab/rules/blocks";
import { customKey, MAX_CHILDREN, MAX_DEPTH, MAX_LEAVES_PER_SIDE, sanitizeCustom, validateCustom } from "../lab/rules/tree";
import { CUSTOM_VERSION, EXEC_TFS, TF_IDS, type CustomConfig } from "../lab/rules/types";

export const PLAYBOOK_FORMAT = "tj-playbook" as const;
export const PLAYBOOK_VERSION = 1 as const;
/** Largest text the import reads (characters). A real playbook is a few kilobytes. */
export const MAX_PLAYBOOK_CHARS = 60_000;
/** Largest file the import accepts (bytes), checked before the file is read. */
export const MAX_PLAYBOOK_BYTES = 80_000;
export const MAX_TITLE = 80;
export const MAX_DESCRIPTION = 1000;
export const MAX_AUTHOR = 40;

const MAX_NODES = 8_000;
const MAX_JSON_DEPTH = 18;
const MAX_STRING = 2_000;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const ROOT_KEYS = new Set(["format", "version", "title", "description", "author", "symbol", "idea", "key"]);

export interface Playbook {
  title: string;
  description: string;
  author: string | null;
  /** Binance symbol the author tested it on, or null */
  symbol: string | null;
  /** the sanitised rule tree, named after the title */
  config: CustomConfig;
  /** `customKey(config)` */
  key: string;
}

export type PlaybookRead = { ok: true; playbook: Playbook; warnings: string[] } | { ok: false; errors: string[] };

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const clean = (s: string, max: number): string => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/** A name taken from foreign input, made safe for a message (no markup, bounded). */
const safeName = (v: unknown): string => clean(typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : typeof v, 40).replace(/[^\p{L}\p{N} ._:/-]/gu, "?");

// ── export ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PlaybookMeta {
  title?: string;
  description?: string;
  author?: string;
  symbol?: string;
}

/** The playbook of a draft. Only the rules and the text fields given here go in. */
export function buildPlaybook(config: CustomConfig, meta: PlaybookMeta = {}): Raw {
  const cfg = sanitizeCustom(config);
  const title = clean(meta.title ?? cfg.name, MAX_TITLE) || cfg.name;
  const out: Raw = { format: PLAYBOOK_FORMAT, version: PLAYBOOK_VERSION, title };
  const description = clean(meta.description ?? "", MAX_DESCRIPTION);
  if (description) out.description = description;
  const author = clean(meta.author ?? "", MAX_AUTHOR);
  if (author) out.author = author;
  if (meta.symbol && /^[A-Z0-9]{2,24}$/.test(meta.symbol)) out.symbol = meta.symbol;
  out.idea = { ...cfg, name: title.slice(0, 60) };
  out.key = customKey(cfg);
  return out;
}

/** The text of a playbook (pretty printed JSON), ready for a file or the clipboard. */
export const playbookText = (config: CustomConfig, meta: PlaybookMeta = {}): string => `${JSON.stringify(buildPlaybook(config, meta), null, 2)}\n`;

/** A file name for the playbook ("playbook-meine-idee.json"). */
export function playbookFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `playbook-${slug || "idee"}.json`;
}

// ── import ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Walks the parsed value with hard limits; returns the first problem or null. Iterative: a deep input cannot overflow the stack. */
function scan(root: unknown): string | null {
  const stack: { v: unknown; d: number }[] = [{ v: root, d: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { v, d } = stack.pop()!;
    if (++nodes > MAX_NODES) return "Das Playbook enthält zu viele Einträge.";
    if (d > MAX_JSON_DEPTH) return "Das Playbook ist zu tief verschachtelt.";
    if (typeof v === "string") {
      if (v.length > MAX_STRING) return "Das Playbook enthält einen zu langen Text.";
    } else if (Array.isArray(v)) {
      if (v.length > 400) return "Das Playbook enthält eine zu lange Liste.";
      for (const x of v) stack.push({ v: x, d: d + 1 });
    } else if (v !== null && typeof v === "object") {
      for (const k of Object.keys(v)) {
        if (FORBIDDEN_KEYS.has(k)) return `Das Playbook enthält den unzulässigen Schlüssel „${k}“.`;
        if (k.length > 60) return "Das Playbook enthält einen zu langen Feldnamen.";
        stack.push({ v: (v as Raw)[k], d: d + 1 });
      }
    } else if (typeof v === "number" && !Number.isFinite(v)) return "Das Playbook enthält eine ungültige Zahl.";
    else if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") return "Das Playbook enthält einen nicht erlaubten Wert.";
  }
  return null;
}

const SIDE_WORD = { long: "Long-Regeln", short: "Short-Regeln" } as const;

/** Structure of one side's tree: unknown blocks / timeframes by name, limits, node shapes. Nothing is dropped silently. */
function checkTree(raw: unknown, side: "long" | "short", errors: string[]): void {
  const where = SIDE_WORD[side];
  if (!isObj(raw) || raw.type !== "group") {
    errors.push(`${where}: Es fehlt die Regelgruppe.`);
    return;
  }
  const unknown = new Set<string>();
  let leaves = 0;
  let tooDeep = false;
  let tooWide = false;
  const walk = (n: unknown, depth: number): void => {
    if (!isObj(n)) {
      errors.push(`${where}: Ein Eintrag der Regeln ist kein Objekt.`);
      return;
    }
    if (n.type === "leaf") {
      leaves++;
      if (!isBlockId(n.block)) unknown.add(safeName(n.block));
      else {
        if (n.tf !== undefined && n.tf !== "exec" && !(TF_IDS as readonly unknown[]).includes(n.tf)) errors.push(`${where}: Unbekannte Zeitebene „${safeName(n.tf)}“ bei „${BLOCKS[n.block].label}“.`);
        if (n.params !== undefined && !isObj(n.params)) errors.push(`${where}: Die Parameter von „${BLOCKS[n.block].label}“ sind kein Objekt.`);
        else if (isObj(n.params)) {
          for (const [k, v] of Object.entries(n.params)) {
            if (typeof v !== "number" && typeof v !== "string") errors.push(`${where}: Parameter „${safeName(k)}“ von „${BLOCKS[n.block].label}“ hat einen ungültigen Wert.`);
          }
        }
      }
      return;
    }
    if (n.type === "group") {
      if (n.op !== "and" && n.op !== "or") errors.push(`${where}: Eine Gruppe hat eine unbekannte Verknüpfung „${safeName(n.op)}“ (erlaubt: and, or).`);
      if (!Array.isArray(n.children)) {
        errors.push(`${where}: Eine Gruppe hat keine Liste von Bedingungen.`);
        return;
      }
      if (depth >= MAX_DEPTH) tooDeep = true;
      if (n.children.length > MAX_CHILDREN) tooWide = true;
      for (const c of n.children.slice(0, MAX_CHILDREN + 1)) walk(c, depth + 1);
      return;
    }
    errors.push(`${where}: Ein Eintrag hat den unbekannten Typ „${safeName(n.type)}“ (erlaubt: leaf, group).`);
  };
  walk(raw, 0);
  if (unknown.size) {
    errors.push(`${where}: Unbekannte${unknown.size === 1 ? "r Baustein" : " Bausteine"}: ${[...unknown].map((u) => `„${u}“`).join(", ")}. Diese App-Version kennt ${unknown.size === 1 ? "ihn" : "sie"} nicht; der Import ist blockiert, damit nichts stillschweigend wegfällt.`);
  }
  if (tooDeep) errors.push(`${where}: Die Gruppen sind tiefer als ${MAX_DEPTH} Ebenen verschachtelt.`);
  if (tooWide) errors.push(`${where}: Eine Gruppe hat mehr als ${MAX_CHILDREN} Einträge.`);
  if (leaves > MAX_LEAVES_PER_SIDE) errors.push(`${where}: Mehr als ${MAX_LEAVES_PER_SIDE} Bedingungen.`);
}

const ENUMS: readonly { path: string; label: string; ok: readonly string[] }[] = [
  { path: "interval", label: "Ausführungs-Kerze", ok: EXEC_TFS },
  { path: "sides", label: "Richtung", ok: ["long", "short", "both"] },
];

/** Numeric fields the clamp changed, as warnings: the author's value and what the app uses. */
function clampWarnings(raw: Raw, cfg: CustomConfig, out: string[]): void {
  const cmp = (label: string, a: unknown, b: unknown): void => {
    if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) > 1e-9) out.push(`${label}: ${a} liegt außerhalb des Zulässigen und wird als ${b} verwendet.`);
  };
  for (const [section, mine] of [["stop", cfg.stop], ["target", cfg.target]] as const) {
    const r = raw[section];
    if (isObj(r)) for (const k of Object.keys(mine)) cmp(`${section === "stop" ? "Stop" : "Ziel"} (${k})`, r[k], (mine as unknown as Raw)[k]);
  }
  const ex = raw.exits;
  if (isObj(ex)) {
    cmp("Zeit-Stop", ex.maxBars, cfg.exits.maxBars);
    for (const part of ["breakEven", "trail", "partial"] as const) {
      const r = ex[part];
      if (isObj(r)) for (const k of Object.keys(cfg.exits[part])) cmp(`${part === "breakEven" ? "Break-even" : part === "trail" ? "Trailing" : "Teilziel"} (${k})`, r[k], (cfg.exits[part] as unknown as Raw)[k]);
    }
  }
  for (const side of ["long", "short"] as const) {
    const walk = (r: unknown, m: unknown): void => {
      if (!isObj(r) || !isObj(m)) return;
      if (r.type === "leaf" && m.type === "leaf" && isObj(r.params) && isObj(m.params) && isBlockId(m.block)) {
        for (const k of Object.keys(m.params)) cmp(`${SIDE_WORD[side]} · ${BLOCKS[m.block].label} (${k})`, r.params[k], m.params[k]);
        return;
      }
      if (Array.isArray(r.children) && Array.isArray(m.children)) r.children.forEach((c, i) => walk(c, (m.children as unknown[])[i]));
    };
    walk(raw[side], cfg[side]);
  }
}

/** Reads and validates a playbook text. Never throws; every refusal names its reason. */
export function readPlaybook(text: unknown): PlaybookRead {
  if (typeof text !== "string" || !text.trim()) return { ok: false, errors: ["Da ist kein Text zum Einlesen."] };
  if (text.length > MAX_PLAYBOOK_CHARS) return { ok: false, errors: [`Der Text ist zu groß (mehr als ${MAX_PLAYBOOK_CHARS.toLocaleString("de-DE")} Zeichen). Ein Playbook ist nur ein paar Kilobyte lang.`] };
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { ok: false, errors: ["Das ist kein gültiges JSON. Ein Playbook ist die Datei, die der Export erzeugt."] };
  }
  const bad = scan(raw);
  if (bad) return { ok: false, errors: [bad] };
  if (!isObj(raw)) return { ok: false, errors: ["Ein Playbook ist ein JSON-Objekt."] };
  if (raw.format !== PLAYBOOK_FORMAT) return { ok: false, errors: [`Das ist kein Playbook (das Feld „format“ ist nicht „${PLAYBOOK_FORMAT}“).`] };
  if (typeof raw.version !== "number" || !Number.isInteger(raw.version)) return { ok: false, errors: ["Dem Playbook fehlt die Versionsangabe."] };
  if (raw.version > PLAYBOOK_VERSION) return { ok: false, errors: [`Das Playbook hat die Version ${raw.version}; diese App versteht Version ${PLAYBOOK_VERSION}. Aktualisiere die App oder bitte um einen Export im alten Format.`] };
  if (raw.version < PLAYBOOK_VERSION) return { ok: false, errors: [`Das Playbook hat die Version ${raw.version}, die es nicht gibt.`] };

  const errors: string[] = [];
  const warnings: string[] = [];
  for (const k of Object.keys(raw)) if (!ROOT_KEYS.has(k)) warnings.push(`Das Feld „${safeName(k)}“ ist unbekannt und wird ignoriert.`);

  const str = (key: string, max: number, required: boolean): string | null => {
    const v = raw[key];
    if (v === undefined || v === null) {
      if (required) errors.push(`Das Feld „${key}“ fehlt.`);
      return null;
    }
    if (typeof v !== "string") {
      errors.push(`Das Feld „${key}“ muss ein Text sein.`);
      return null;
    }
    const full = clean(v, MAX_STRING);
    if (required && !full) errors.push(`Das Feld „${key}“ ist leer.`);
    if (full.length > max) warnings.push(`Das Feld „${key}“ ist länger als ${max} Zeichen und wird gekürzt.`);
    return full.slice(0, max);
  };
  const title = str("title", MAX_TITLE, true);
  const description = str("description", MAX_DESCRIPTION, false);
  const author = str("author", MAX_AUTHOR, false);
  const symbolRaw = raw.symbol;
  let symbol: string | null = null;
  if (symbolRaw !== undefined && symbolRaw !== null) {
    if (typeof symbolRaw === "string" && /^[A-Z0-9]{2,24}$/.test(symbolRaw)) symbol = symbolRaw;
    else errors.push("Das Feld „symbol“ muss ein Markt wie BTCUSDT sein.");
  }

  const idea = raw.idea;
  let config: CustomConfig | null = null;
  if (!isObj(idea)) errors.push("Dem Playbook fehlt die Regelidee („idea“).");
  else {
    if (idea.version !== CUSTOM_VERSION) errors.push(idea.version === undefined ? "Der Regelidee fehlt die Versionsangabe." : `Die Regelidee hat die Version ${safeName(idea.version)}; diese App versteht Version ${CUSTOM_VERSION}.`);
    for (const e of ENUMS) {
      const v = idea[e.path];
      if (typeof v !== "string" || !e.ok.includes(v)) errors.push(`${e.label}: ${v === undefined ? "fehlt" : `„${safeName(v)}“ ist ungültig (erlaubt: ${e.ok.join(", ")})`}.`);
    }
    for (const part of ["stop", "target", "exits"] as const) if (!isObj(idea[part])) errors.push(`In der Regelidee fehlt „${part}“.`);
    if (isObj(idea.stop) && !["atr", "percent", "swing"].includes(String(idea.stop.kind))) errors.push(`Stop: Die Art „${safeName(idea.stop.kind)}“ ist unbekannt (erlaubt: atr, percent, swing).`);
    if (isObj(idea.target) && !["r", "none"].includes(String(idea.target.kind))) errors.push(`Ziel: Die Art „${safeName(idea.target.kind)}“ ist unbekannt (erlaubt: r, none).`);
    checkTree(idea.long, "long", errors);
    checkTree(idea.short, "short", errors);
    if (!errors.length) {
      config = sanitizeCustom({ ...idea, name: title ?? "Playbook" });
      clampWarnings(idea, config, warnings);
    }
  }
  if (errors.length || !config || title == null) return { ok: false, errors: errors.length ? errors : ["Das Playbook ist unvollständig."] };

  const key = customKey(config);
  if (typeof raw.key === "string" && raw.key !== key) warnings.push("Die Prüfsumme passt nicht zu den Regeln: Das Playbook wurde nach dem Export verändert (oder stammt aus einer anderen Version). Prüfe die Regeln in der Vorschau.");
  const issues = validateCustom(config);
  const blocking = issues.filter((i) => i.level === "error");
  if (blocking.length) return { ok: false, errors: blocking.map((i) => `Die Regeln lassen sich so nicht laufen lassen: ${i.text}`) };
  for (const i of issues) if (i.level === "warn") warnings.push(i.text);
  return { ok: true, playbook: { title, description: description ?? "", author: author || null, symbol, config, key }, warnings: warnings.slice(0, 12) };
}
