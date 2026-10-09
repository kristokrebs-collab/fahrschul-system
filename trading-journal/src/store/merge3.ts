/**
 * Three-way merge for JSON values (two-tab safety, `localAdapter.saveSettings`).
 *
 * `base` is what this tab last knew, `mine` what it wants to write, `theirs` what storage holds right now (another
 * tab – or the other journal version – may have written in between). Rules, applied recursively:
 * - unchanged on one side → the other side wins (`mine ≡ base` → theirs, `theirs ≡ base` → mine);
 * - both changed, both plain objects → per key; a key only one side has is kept (the app never deletes settings
 *   keys on purpose, the other journal version drops keys it does not know);
 * - both changed, both arrays of objects with a string `id` (setups, rules, checklists) → per id: changed items are
 *   merged, added items from both sides kept (theirs appended in their order), an item deleted on one side is
 *   dropped only when the other side did not change it (an edit beats a delete – lossless);
 * - anything else (scalars, plain arrays) both changed → mine (this tab's explicit save wins).
 * Pure; never mutates its inputs.
 */
type Obj = Record<string, unknown>;

export function isPlainObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Structural equality of JSON values (key order ignored). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false;
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!(k in b) || !jsonEqual(a[k], b[k])) return false;
    return true;
  }
  return Number.isNaN(a) && Number.isNaN(b);
}

type IdItem = Obj & { id: string };
const isIdList = (v: unknown): v is IdItem[] => Array.isArray(v) && v.every((x) => isPlainObject(x) && typeof x.id === "string");

function mergeIdLists(base: IdItem[] | undefined, mine: IdItem[], theirs: IdItem[]): IdItem[] {
  const b = new Map((base ?? []).map((x) => [x.id, x] as const));
  const t = new Map(theirs.map((x) => [x.id, x] as const));
  const m = new Set(mine.map((x) => x.id));
  const out: IdItem[] = [];
  for (const item of mine) {
    const was = b.get(item.id);
    const other = t.get(item.id);
    if (other) out.push(merge3(was, item, other) as IdItem);
    else if (!was || !jsonEqual(was, item)) out.push(item); // added by me, or edited by me while they deleted it
    // else: they deleted it and I did not touch it → dropped
  }
  for (const item of theirs) {
    if (m.has(item.id)) continue;
    const was = b.get(item.id);
    if (!was || !jsonEqual(was, item)) out.push(item); // added by them, or edited by them while I deleted it
    // else: I deleted it and they did not touch it → dropped
  }
  return out;
}

export function merge3(base: unknown, mine: unknown, theirs: unknown): unknown {
  if (jsonEqual(mine, theirs)) return mine;
  if (jsonEqual(mine, base)) return theirs;
  if (jsonEqual(theirs, base)) return mine;
  if (isPlainObject(mine) && isPlainObject(theirs)) {
    const b = isPlainObject(base) ? base : {};
    const out: Obj = {};
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      // A key one side lacks is kept from the other side: the app never deletes settings keys on purpose, while the
      // other journal version drops keys it does not know (lossless beats "respect the delete" here).
      const v = mine[k] === undefined ? theirs[k] : theirs[k] === undefined ? mine[k] : merge3(b[k], mine[k], theirs[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (isIdList(mine) && isIdList(theirs)) return mergeIdLists(isIdList(base) ? base : undefined, mine, theirs);
  return mine;
}
