/**
 * Versions of the saved rule drafts (F15, pure): every saved change of a draft is a version (time, optional note), shown as a
 * plain-language diff ("RSI Niveau: 30 → 25"), restorable, comparable side by side. A version is an immutable snapshot of the
 * sanitised rule tree; nothing here is computed by a model.
 */
import { BLOCKS } from "./rules/blocks";
import { customKey, exitsText, leafText, leavesOf, nodeText, parseCustom, sanitizeCustom, sidesOf, stopText } from "./rules/tree";
import { TF_LABEL, type CustomConfig, type Group, type Leaf, type Node } from "./rules/types";

/** Versions kept per draft (the oldest drop out; numbering goes on). */
export const MAX_VERSIONS = 20;
/** Versions kept over all drafts (the browser's storage is small). */
export const MAX_VERSIONS_TOTAL = 240;
export const MAX_NOTE = 140;
export const VERSIONS_FORMAT = 1 as const;

export interface DraftVersion {
  /** 1, 2, 3 … per draft, never reused */
  n: number;
  /** ms */
  at: number;
  note: string;
  /** `customKey` of the rules (the name is not part of it) */
  key: string;
  config: CustomConfig;
}

export type VersionMap = Record<string, DraftVersion[]>;

const de = (v: number): string => String(Math.round(v * 10_000) / 10_000).replace(".", ",");
const SIDE_WORD = { long: "Long", short: "Short" } as const;
const SIDES_WORD = { long: "nur Long", short: "nur Short", both: "Long und Short" } as const;

// ── diff in plain language ──────────────────────────────────────────────────────────────────────────────────────

interface Placed {
  leaf: Leaf;
  parent: string;
}

function leavesWithParent(root: Group): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const walk = (g: Group): void => {
    for (const c of g.children) {
      if (c.type === "leaf") out.set(c.id, { leaf: c, parent: g.id });
      else walk(c);
    }
  };
  walk(root);
  return out;
}

function groupsById(root: Group): Map<string, Group> {
  const out = new Map<string, Group>();
  const walk = (n: Node): void => {
    if (n.type === "group") {
      out.set(n.id, n);
      n.children.forEach(walk);
    }
  };
  walk(root);
  return out;
}

const paramText = (leaf: Leaf, key: string): string => {
  const def = BLOCKS[leaf.block].params.find((p) => p.key === key);
  const v = leaf.params[key];
  if (def?.kind === "select") return def.options?.find((o) => o.v === v)?.label ?? String(v);
  return typeof v === "number" ? de(v) : String(v);
};

/** One line per changed parameter of a leaf whose block stayed the same. */
function leafChanges(a: Leaf, b: Leaf, side: string): string[] {
  const out: string[] = [];
  const def = BLOCKS[b.block];
  for (const p of def.params) {
    if (a.params[p.key] === b.params[p.key]) continue;
    // "RSI Niveau: Niveau 30 → 25" would say the same thing twice
    const redundant = def.label.toLowerCase().endsWith(p.label.toLowerCase());
    out.push(`${side} · ${def.label}: ${redundant ? "" : `${p.label} `}${paramText(a, p.key)} → ${paramText(b, p.key)}`);
  }
  if (a.tf !== b.tf) out.push(`${side} · ${def.label}: Zeitebene ${a.tf === "exec" ? "wie die Ausführung" : TF_LABEL[a.tf]} → ${b.tf === "exec" ? "wie die Ausführung" : TF_LABEL[b.tf]}`);
  if (!!a.not !== !!b.not) out.push(`${side} · ${def.label}: „Nicht“ ${b.not ? "eingeschaltet" : "ausgeschaltet"}`);
  return out;
}

const exitLine = (cfg: CustomConfig, test: (line: string) => boolean): string | null => exitsText(cfg).slice(1).find(test) ?? null;
const EXIT_PARTS: readonly { label: string; test: (line: string) => boolean }[] = [
  { label: "Break-even", test: (l) => l.startsWith("Break-even") },
  { label: "Trailing-Stop", test: (l) => l.startsWith("Trailing-Stop") },
  { label: "Teil-Gewinnmitnahme", test: (l) => l.includes("der Position bei") },
  { label: "Zeit-Stop", test: (l) => l.startsWith("Zeit-Stop") },
  { label: "Gegensignal", test: (l) => l.startsWith("Ausstieg bei neuem") },
];

/** The line without the part's own name at its start ("Break-even nach +1 R" → "nach +1 R"). */
const bare = (line: string, label: string): string => (line.startsWith(label) ? line.slice(label.length).trim() : line);

const targetText = (c: CustomConfig): string => (c.target.kind === "r" ? `${de(c.target.r)} R` : "kein festes Ziel");

/** What changed from `a` to `b`, one sentence each; empty = the rules are the same (the name may still differ). */
export function diffConfigs(a: CustomConfig, b: CustomConfig): string[] {
  const out: string[] = [];
  if (a.name !== b.name) out.push(`Name: „${a.name}“ → „${b.name}“`);
  if (a.interval !== b.interval) out.push(`Ausführungs-Kerze: ${TF_LABEL[a.interval]} → ${TF_LABEL[b.interval]}`);
  if (a.sides !== b.sides) out.push(`Richtung: ${SIDES_WORD[a.sides]} → ${SIDES_WORD[b.sides]}`);
  for (const side of ["long", "short"] as const) {
    const was = sidesOf(a).includes(side);
    const now = sidesOf(b).includes(side);
    // a side that is switched off in both versions is not part of the idea
    if (!was && !now) continue;
    const word = SIDE_WORD[side];
    // a side that was off has no rules of its own to compare with (the stored group is just a leftover)
    if (!was || !now) {
      out.push(now ? `${word}-Seite eingeschaltet: ${leavesOf(b[side]).length ? nodeText(b[side]) : "ohne Bedingung"}` : `${word}-Seite ausgeschaltet (war: ${leavesOf(a[side]).length ? nodeText(a[side]) : "ohne Bedingung"})`);
      continue;
    }
    const la = leavesWithParent(a[side]);
    const lb = leavesWithParent(b[side]);
    for (const [id, p] of la) if (!lb.has(id)) out.push(`${word}: Bedingung entfernt: ${leafText(p.leaf)}`);
    for (const [id, p] of lb) if (!la.has(id)) out.push(`${word}: Bedingung neu: ${leafText(p.leaf)}`);
    for (const [id, pb] of lb) {
      const pa = la.get(id);
      if (!pa) continue;
      if (pa.leaf.block !== pb.leaf.block) out.push(`${word}: ${leafText(pa.leaf)} → ${leafText(pb.leaf)}`);
      else out.push(...leafChanges(pa.leaf, pb.leaf, word));
      if (pa.parent !== pb.parent) out.push(`${word}: Bedingung in eine andere Gruppe verschoben: ${leafText(pb.leaf)}`);
    }
    const ga = groupsById(a[side]);
    for (const [id, g] of groupsById(b[side])) {
      const old = ga.get(id);
      if (old && old.op !== g.op && g.children.length > 1) out.push(`${word}: Gruppe (${nodeText(g, false)}) verknüpft ${old.op === "and" ? "UND" : "ODER"} → ${g.op === "and" ? "UND" : "ODER"}`);
    }
  }
  if (stopText(a.stop) !== stopText(b.stop)) out.push(`Stop: ${stopText(a.stop)} → ${stopText(b.stop)}`);
  if (targetText(a) !== targetText(b)) out.push(`Ziel: ${targetText(a)} → ${targetText(b)}`);
  for (const part of EXIT_PARTS) {
    const x = exitLine(a, part.test);
    const y = exitLine(b, part.test);
    if (x === y) continue;
    out.push(x && y ? `${part.label}: ${bare(x, part.label)} → ${bare(y, part.label)}` : y ? `${part.label} neu: ${bare(y, part.label)}` : `${part.label} entfernt: ${bare(x!, part.label)}`);
  }
  return out;
}

/** The parameters of a version as label / value rows (side-by-side comparison). */
export function configRows(c: CustomConfig): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [
    { label: "Name", value: c.name },
    { label: "Ausführungs-Kerze", value: TF_LABEL[c.interval] },
    { label: "Richtung", value: SIDES_WORD[c.sides] },
  ];
  for (const side of sidesOf(c)) rows.push({ label: `${SIDE_WORD[side]}-Regeln`, value: leavesOf(c[side]).length ? nodeText(c[side]) : "keine" });
  rows.push({ label: "Stop", value: stopText(c.stop) });
  rows.push({ label: "Ziel", value: targetText(c) });
  for (const p of EXIT_PARTS) rows.push({ label: p.label, value: exitLine(c, p.test) ?? "aus" });
  return rows;
}

export interface CompareRow {
  label: string;
  a: string;
  b: string;
  changed: boolean;
}

/** Two versions side by side, row by row; a row is `changed` when the two values differ. */
export function compareRows(a: CustomConfig, b: CustomConfig): CompareRow[] {
  const ra = configRows(a);
  const rb = configRows(b);
  const labels = [...new Set([...ra.map((r) => r.label), ...rb.map((r) => r.label)])];
  return labels.map((label) => {
    const x = ra.find((r) => r.label === label)?.value ?? "–";
    const y = rb.find((r) => r.label === label)?.value ?? "–";
    return { label, a: x, b: y, changed: x !== y };
  });
}

// ── the version list ──────────────────────────────────────────────────────────────────────────────────────────────

const cleanNote = (s: unknown): string => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_NOTE) : "");

/**
 * The list with a new version of `config` appended when the rules or the name differ from the newest one; the SAME list when
 * nothing changed (saving an unchanged draft is not a version). Restoring passes a note ("Wiederhergestellt aus Version 2").
 */
export function addVersion(list: readonly DraftVersion[], config: CustomConfig, at: number, note = ""): DraftVersion[] {
  const cfg = sanitizeCustom(config);
  const last = list[list.length - 1];
  const key = customKey(cfg);
  if (last && last.key === key && last.config.name === cfg.name) return list as DraftVersion[];
  const next: DraftVersion = { n: (last?.n ?? 0) + 1, at, note: cleanNote(note), key, config: cfg };
  return [...list, next].slice(-MAX_VERSIONS);
}

/** Sets the note of one version (the others stay). */
export function setNote(list: readonly DraftVersion[], n: number, note: string): DraftVersion[] {
  return list.map((v) => (v.n === n ? { ...v, note: cleanNote(note) } : v));
}

/** The stored map → clean lists (anything unreadable is dropped, numbers unique and ascending, limits applied). */
export function parseVersions(raw: unknown): VersionMap {
  const out: VersionMap = {};
  if (!raw || typeof raw !== "object" || (raw as { v?: unknown }).v !== VERSIONS_FORMAT) return out;
  const items = (raw as { items?: unknown }).items;
  if (!items || typeof items !== "object" || Array.isArray(items)) return out;
  let total = 0;
  for (const [id, list] of Object.entries(items as Record<string, unknown>)) {
    if (!/^d\d{1,6}$/.test(id) || !Array.isArray(list)) continue;
    const seen = new Set<number>();
    const vs: DraftVersion[] = [];
    for (const it of list) {
      if (!it || typeof it !== "object") continue;
      const v = it as Partial<DraftVersion>;
      if (typeof v.n !== "number" || !Number.isInteger(v.n) || v.n < 1 || seen.has(v.n)) continue;
      const { config } = parseCustom(v.config);
      if (!config) continue;
      seen.add(v.n);
      vs.push({ n: v.n, at: typeof v.at === "number" && Number.isFinite(v.at) ? v.at : 0, note: cleanNote(v.note), key: customKey(config), config });
    }
    vs.sort((x, y) => x.n - y.n);
    const kept = vs.slice(-MAX_VERSIONS);
    if (kept.length && total + kept.length <= MAX_VERSIONS_TOTAL) {
      out[id] = kept;
      total += kept.length;
    }
  }
  return out;
}

/** Drops the oldest versions of the fullest drafts until the total fits. */
export function trimTotal(map: VersionMap): VersionMap {
  let total = Object.values(map).reduce((s, l) => s + l.length, 0);
  if (total <= MAX_VERSIONS_TOTAL) return map;
  const out: VersionMap = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]]));
  while (total > MAX_VERSIONS_TOTAL) {
    const fullest = Object.entries(out).sort((x, y) => y[1].length - x[1].length)[0];
    if (!fullest || fullest[1].length <= 1) break;
    fullest[1].shift();
    total--;
  }
  return out;
}
