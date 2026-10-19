/**
 * Tolerant reading of the model's tool input (F29) – pure, shared by the function and its tests.
 *
 * The model fills `report_trades` freely: an empty string where "unknown" (`null`) was meant, a confidence of 1.2, a
 * 70-character price text, an execution without a price. None of that is a reason to throw the whole reading away – the
 * trader would only see "unvollständig" and nothing of the trades that WERE readable. This pass repairs exactly such
 * formatting slips, drops only the single execution / entry that is unusable (and says so in `notes`), and leaves
 * everything else to the strict schema: a wrong type for `trades`, an unknown `status` or a missing tool call still
 * fail, with the offending field named. It never invents a value.
 */
import { MAX_IMAGES } from "./contract";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** A text field: trimmed, `null` for empty / non-text / over `max` characters (a longer "price" is no price). */
function text(v: unknown, max: number): string | null {
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
}

const conf = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export interface LenientResult {
  input: unknown;
  /** German remarks about what was dropped (shown to the trader with the AI notes). */
  dropped: string[];
}

function executions(v: unknown, dropped: { n: number }): Rec[] | unknown {
  if (!Array.isArray(v)) return v;
  const out: Rec[] = [];
  for (const e of v) {
    const price = isRec(e) ? text(e.price, 60) : null;
    if (!isRec(e) || !price) {
      dropped.n += 1;
      continue;
    }
    out.push({ price, qty: text(e.qty, 60), time: text(e.time, 60), label: text(e.label, 60) });
  }
  return out;
}

/** Repairs formatting slips of the tool input; the result still goes through `Extraction.safeParse`. */
export function normalizeToolInput(input: unknown): LenientResult {
  if (!isRec(input) || !Array.isArray(input.trades)) return { input, dropped: [] };
  const dropped = { n: 0 };
  const trades = input.trades.map((t: unknown) => {
    if (!isRec(t)) return t;
    const c = isRec(t.confidence) ? t.confidence : {};
    const out: Rec = { ...t };
    for (const k of ["market", "plannedEntry", "stop", "leverage", "fees", "funding", "realizedPnl", "pnlCurrency", "exchange"] as const) if (k in t) out[k] = text(t[k], k === "market" ? 60 : k === "pnlCurrency" ? 12 : k === "exchange" ? 40 : 60);
    if ("entries" in t) out.entries = executions(t.entries, dropped);
    if ("exits" in t) out.exits = executions(t.exits, dropped);
    if (Array.isArray(t.targets)) out.targets = t.targets.map((x) => text(x, 60)).filter((x): x is string => x != null);
    if (Array.isArray(t.unreadable)) out.unreadable = t.unreadable.map((x) => text(x, 80)).filter((x): x is string => x != null);
    if (Array.isArray(t.sources)) out.sources = t.sources.filter((x) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < MAX_IMAGES);
    if (isRec(t.confidence)) out.confidence = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, conf(v)]));
    return out;
  });
  const notes = Array.isArray(input.notes) ? input.notes.map((n) => text(n, 200)).filter((n): n is string => n != null) : input.notes === undefined ? [] : input.notes;
  const lost = dropped.n ? [`${dropped.n === 1 ? "Eine Ausführung" : `${dropped.n} Ausführungen`} ohne lesbaren Preis ${dropped.n === 1 ? "wurde" : "wurden"} ausgelassen.`] : [];
  return {
    input: { ...input, trades, ...(Array.isArray(notes) ? { notes: [...notes, ...lost].slice(0, 6) } : {}), ...("timezone" in input ? { timezone: text(input.timezone, 40) } : {}) },
    dropped: lost,
  };
}
