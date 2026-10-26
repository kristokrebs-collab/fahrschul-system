/**
 * OCR extraction → the import's candidates (PURE glue over `@/journal/extract/*`): the same `buildCandidates` /
 * `mergeCandidates` that read the model's answer, plus the few things that are specific to a read screenshot –
 * the exchange's own result is the result that counts (`pnlMode: "shot"`: it is net of fees, which the screenshot
 * does not show), and an `id` → source records lookup for the row crops and the field notes.
 */
import { buildCandidates, type BuildContext, type Candidate } from "@/journal/extract/candidate";
import { mergeCandidates } from "@/journal/extract/merge";
import type { ReadRecord } from "./records";
import type { OcrExtraction } from "./toExtraction";

export interface OcrCandidates {
  candidates: Candidate[];
  /** Records a candidate was made of, by candidate id (`c0`, `c1` …; a merged candidate keeps the first id). */
  recordsOf: Map<string, ReadRecord[]>;
}

export function ocrCandidates(res: Pick<OcrExtraction, "extraction" | "sources">, ctx: BuildContext): OcrCandidates {
  const built = buildCandidates(res.extraction, ctx).map((c) => (c.pnl.value != null ? { ...c, pnlMode: "shot" as const } : c));
  const recordsOf = new Map<string, ReadRecord[]>();
  built.forEach((c, i) => recordsOf.set(c.id, res.sources[i] ?? []));
  const merged = mergeCandidates(built);
  // a merged candidate (the same trade in two pictures) also owns the records of the one it swallowed
  for (const m of merged) {
    const swallowed = built.filter((b) => b.id !== m.id && b.sources.some((s) => m.sources.includes(s)) && !merged.some((o) => o.id === b.id));
    if (swallowed.length) recordsOf.set(m.id, [...(recordsOf.get(m.id) ?? []), ...swallowed.flatMap((b) => recordsOf.get(b.id) ?? [])]);
  }
  return { candidates: merged, recordsOf };
}
