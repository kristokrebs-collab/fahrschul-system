/**
 * Scoring of a reading against what the screenshot really shows (PURE): the OCR tests and `scripts/ocrCheck.ts
 * --expect` report the hit rate PER FIELD – no averaging away of the fields that fail.
 */
import { averagePrice, firstAt, lastAt, normalizePair, totalQty, type Candidate } from "@/journal/extract/candidate";

export interface TruthTrade {
  pair: string;
  side: "long" | "short";
  qty: number;
  entry: number;
  exit: number;
  pnl: number;
  leverage?: number | null;
  /** `YYYY-MM-DD HH:mm:ss` as the screenshot shows it. */
  openTime?: string | null;
  closeTime?: string | null;
  fees?: number | null;
}

export const SCORED_FIELDS = ["pair", "side", "qty", "entry", "exit", "pnl", "leverage", "openTime", "closeTime"] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];

export interface FieldScore {
  hit: number;
  total: number;
  misses: string[];
}

export interface Score {
  fields: Record<ScoredField, FieldScore>;
  /** Truth trades that were found at all / that exist. */
  found: number;
  expected: number;
  /** Candidates that match no truth trade (a phantom trade). */
  extra: number;
  hit: number;
  total: number;
}

const same = (a: number | null | undefined, b: number | null | undefined): boolean => a != null && b != null && Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-9);
const wall = (t: string | null | undefined): string | null => (t ? t.replace(" ", "T").slice(0, 19) : null);

/** A candidate's fields in the units of `TruthTrade`. */
export function readOf(c: Candidate): Record<ScoredField, string | number | null> {
  return {
    pair: c.pair.value,
    side: c.side.value,
    qty: totalQty(c.entries) ?? totalQty(c.exits),
    entry: averagePrice(c.entries),
    exit: averagePrice(c.exits),
    pnl: c.pnl.value,
    leverage: c.leverage.value,
    openTime: firstAt(c.entries),
    closeTime: lastAt(c.exits),
  };
}

export function scoreAgainstTruth(cands: readonly Candidate[], truth: readonly TruthTrade[]): Score {
  const fields = Object.fromEntries(SCORED_FIELDS.map((f) => [f, { hit: 0, total: 0, misses: [] as string[] }])) as Record<ScoredField, FieldScore>;
  const used = new Set<number>();
  let found = 0;
  const reads = cands.map(readOf);
  truth.forEach((t, ti) => {
    // the reading that agrees with this trade in most fields (a single misread number must not make the whole trade "missing")
    let bi = -1;
    let bn = 0;
    reads.forEach((r, i) => {
      if (used.has(i)) return;
      const n =
        Number(r.pair === normalizePair(t.pair)) +
        Number(r.side === t.side) +
        Number(same(r.qty as number | null, t.qty)) +
        Number(same(r.entry as number | null, t.entry)) +
        Number(same(r.exit as number | null, t.exit)) +
        Number(same(r.pnl as number | null, t.pnl)) +
        Number(r.openTime === wall(t.openTime)) +
        Number(r.closeTime === wall(t.closeTime));
      if (n > bn) {
        bn = n;
        bi = i;
      }
    });
    const ok = bi >= 0 && bn >= 3;
    if (ok) {
      used.add(bi);
      found += 1;
    }
    const r = ok ? reads[bi]! : null;
    const check = (f: ScoredField, hit: boolean, want: unknown): void => {
      if (want == null) return;
      fields[f].total += 1;
      if (hit) fields[f].hit += 1;
      else fields[f].misses.push(`#${ti + 1}: erwartet ${String(want)}, gelesen ${r ? String(r[f]) : "–"}`);
    };
    check("pair", !!r && r.pair === normalizePair(t.pair), t.pair);
    check("side", !!r && r.side === t.side, t.side);
    check("qty", !!r && same(r.qty as number | null, t.qty), t.qty);
    check("entry", !!r && same(r.entry as number | null, t.entry), t.entry);
    check("exit", !!r && same(r.exit as number | null, t.exit), t.exit);
    check("pnl", !!r && same(r.pnl as number | null, t.pnl), t.pnl);
    check("leverage", !!r && same(r.leverage as number | null, t.leverage ?? null), t.leverage);
    check("openTime", !!r && r.openTime === wall(t.openTime), t.openTime);
    check("closeTime", !!r && r.closeTime === wall(t.closeTime), t.closeTime);
  });
  const hit = SCORED_FIELDS.reduce((n, f) => n + fields[f].hit, 0);
  const total = SCORED_FIELDS.reduce((n, f) => n + fields[f].total, 0);
  return { fields, found, expected: truth.length, extra: cands.length - used.size, hit, total };
}

export function scoreText(s: Score): string {
  const lines = SCORED_FIELDS.filter((f) => s.fields[f].total).map((f) => `  ${f.padEnd(10)} ${s.fields[f].hit}/${s.fields[f].total}${s.fields[f].misses.length ? `   ✗ ${s.fields[f].misses.join(" | ")}` : ""}`);
  return [`Trades gefunden ${s.found}/${s.expected}, zusätzliche (Phantom) ${s.extra}`, ...lines, `Felder gesamt ${s.hit}/${s.total} (${s.total ? Math.round((s.hit / s.total) * 1000) / 10 : 0} %)`].join("\n");
}
