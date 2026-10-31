/// <reference types="node" />
/**
 * `scripts/ocrCheck.ts` – runs the COMPLETE screenshot pipeline on an image file in Node and prints what it read:
 *
 *   npm run ocr:check -- path/to/screenshot.png [--words] [--json] [--expect truth.json] [--zone UTC]
 *
 *   --words    the lines / cells of the layout parser (what the engine returned, with confidence and ink colour)
 *   --json     the result as JSON (records, candidates, plausibility)
 *   --expect   a `{ "trades": [TruthTrade…] }` file: the hit rate per field
 *
 * Also the tool to sharpen the reader against a real screenshot: `--words` shows where a number was lost.
 */
import { readFileSync } from "node:fs";
import { buildCandidates, resolveZone, type Candidate } from "@/journal/extract/candidate";
import { checksOf } from "@/journal/extract/checks";
import { attentionRows, rowsOf } from "@/journal/extract/rows";
import { createTesseractEngine } from "../engine";
import { ocrCandidates } from "../candidates";
import { readPictures, type PipelineResult } from "../pipeline";
import { scoreAgainstTruth, scoreText, type TruthTrade } from "../truth";
import { nodeEngineOptions, readImage } from "./io";

const pct = (c: number): string => `${Math.round(c * 100)}%`;

export interface CheckOutput {
  text: string;
  result: PipelineResult;
  candidates: Candidate[];
}

/** Formats the reading of a pipeline run for the terminal. */
export function describe(res: PipelineResult, opts: { words?: boolean; zone?: string } = {}): { text: string; candidates: Candidate[] } {
  const out: string[] = [];
  res.pictures.forEach((p, i) => {
    const pp = res.pages[i]!;
    out.push(`Bild ${i + 1}: ${p.read.page.width}×${p.read.page.height} px, ${p.read.page.words.length} Wörter, ${p.read.ms} ms · Thema ${p.read.prep.info.dark ? "dunkel" : "hell"} · Skalierung ${p.read.prep.info.scale}× · Streifen ${p.read.prep.info.strips.length}`);
    out.push(`  Ansicht: ${pp.viewLabel} (${pp.viewHow}) · Layout: ${pp.layout}${pp.exchange ? ` · Börse: ${pp.exchange.name}` : ""} · Zahlenstil: ${pp.style ?? "unklar"}`);
    out.push(`  Zweite Lesung: ${p.refine.reread} Zellen erneut gelesen, ${p.refine.changed} geändert`);
    if (opts.words)
      for (const l of p.parsed.lines) out.push(`    ${String(l.i).padStart(3)} y${Math.round(l.cy)} ${l.segs.map((s) => `[${s.text} |${Math.round(s.conf)}${s.ink && s.ink !== "light" && s.ink !== "dim" ? ` ${s.ink}` : ""}]`).join(" ")}`);
    for (const r of pp.records) {
      out.push(`  ▸ ${r.symbol.text} ${r.side.value ?? "?"}${r.leverage ? ` ${r.leverage.value}x` : ""}${r.marginMode ? ` ${r.marginMode}` : ""} [${r.kind}${r.status ? `, ${r.status}` : ""}] (${pct(r.symbol.conf)})`);
      const row = (k: string, f: { text: string; conf: number; notes: string[]; derived?: boolean } | undefined): void => {
        if (f) out.push(`      ${k.padEnd(10)} ${f.text.padEnd(22)} ${pct(f.conf).padStart(4)}${f.conf < 0.7 ? "  ⚠ unsicher" : ""}${f.derived ? "  (abgeleitet)" : ""}${f.notes.length ? `  – ${f.notes.join("; ")}` : ""}`);
      };
      for (const k of ["entry", "exit", "qty", "price", "orderPrice", "fee", "funding", "pnl", "roi"] as const) row(k, r.nums[k]);
      for (const k of ["openTime", "closeTime", "time"] as const) row(k, r.times[k]);
      if (r.derivedFees != null) out.push(`      fees       ${String(Number(r.derivedFees.toFixed(8))).padEnd(22)}      (abgeleitet aus Preisen × Menge − Ergebnis)`);
      for (const f of r.plausibility.flags) out.push(`      ⚠ ${f.text}`);
      if (r.plausibility.roiOk === true) out.push(`      ✓ ROI passt zu Ergebnis, Positionswert und Hebel`);
      if (r.missing.length) out.push(`      fehlt: ${r.missing.join(", ")}`);
    }
    for (const c of pp.incomplete) out.push(`  ✂ ${c.text}`);
  });
  for (const s of res.skipped) out.push(`  – ${s.text}`);
  const zone = resolveZone(null, null, opts.zone ?? "UTC");
  const { candidates } = ocrCandidates(res, { now: new Date(), zone, localZone: opts.zone ?? "UTC", fallbackStyle: "point" });
  out.push("", `Ergebnis: ${candidates.length} Trade(s), ${res.incomplete.length} unvollständige Karte(n), ${res.ms} ms`);
  candidates.forEach((c, i) => {
    const rows = rowsOf(c, "USDT");
    out.push(`  ${i + 1}. ${rows.map((r) => `${r.label}: ${r.text}${r.state === "uncertain" ? " ⚠" : r.state === "missing" && !r.optional ? " ✗" : ""}`).join(" · ")}`);
    const need = attentionRows(rows).length;
    if (need) out.push(`     ${need} Feld(er) brauchen den Blick`);
    for (const k of checksOf(c, { trades: [], now: new Date(), currency: "USDT" }).filter((x) => x.level === "warn")) out.push(`     ⚠ ${k.text}`);
  });
  return { text: out.join("\n"), candidates };
}

export async function runCheck(argv: readonly string[], log: (s: string) => void = console.log): Promise<number> {
  const flag = (n: string): boolean => argv.includes(`--${n}`);
  const val = (n: string): string | undefined => {
    const i = argv.indexOf(`--${n}`);
    return i < 0 ? undefined : argv[i + 1];
  };
  const files = argv.filter((a, i) => !a.startsWith("--") && !/^--(expect|zone)$/.test(argv[i - 1] ?? ""));
  if (!files.length) {
    log("Aufruf: npm run ocr:check -- <bild.png|jpg> [weiteres Bild …] [--words] [--json] [--expect wahrheit.json] [--zone Europe/Berlin]");
    return 2;
  }
  const rasters = files.map((f) => readImage(f));
  const engine = await createTesseractEngine(nodeEngineOptions());
  try {
    const res = await readPictures(rasters, engine);
    const d = describe(res, { words: flag("words"), ...(val("zone") ? { zone: val("zone")! } : {}) });
    if (flag("json")) {
      const built = buildCandidates(res.extraction, { now: new Date(), zone: resolveZone(null, null, "UTC"), localZone: "UTC", fallbackStyle: "point" });
      log(JSON.stringify({ extraction: res.extraction, records: res.pages.map((p) => p.records), incomplete: res.incomplete, candidates: built }, null, 2));
    } else log(d.text);
    if (flag("expect") && val("expect")) {
      const truth = JSON.parse(readFileSync(val("expect")!, "utf8")) as { trades: TruthTrade[] };
      log("\nTrefferquote gegen die Erwartung:\n" + scoreText(scoreAgainstTruth(d.candidates, truth.trades)));
    }
    return 0;
  } finally {
    await engine.terminate();
  }
}
