// @vitest-environment node
/// <reference types="node" />
/**
 * Backup / restore probe (C4 Betrieb): an account export is played back into a FRESH profile (an empty journal) through
 * the same code path the app uses for "Backup importieren" (`parseBackup` → `applyBackup(…, "replace")`), and every record
 * is compared by content hash – nothing may be lost, changed or invented, and the screenshot hash list must agree with the
 * pictures the trades refer to.
 *
 * Two modes, one test:
 *  - default (CI): the export is produced by the real `collectExport` against an in-memory Supabase fake (MOCK – says so);
 *  - `RESTORE_PROBE_FILE=<export.json>` (via `node scripts/restoreProbe.mjs <export.json>`): the operator feeds a REAL
 *    export file (Konto → Deine Daten → Exportieren) and learns whether it restores completely. That path needs no
 *    Supabase and no network – the file is the only input.
 * It proves the export format restores; it does not prove Supabase's own backups (point-in-time recovery is the
 * operator's setting, docs/BETRIEB.md).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { collectExport } from "../../netlify/functions/_lib/account";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { normalizeSettings } from "@/domain/normalize";
import { hashDoc } from "@/cloud/sync/docs";
import { canonRecord, snapshotDocs } from "@/cloud/sync/reconcile";
import { ALL_PARTS, applyBackup, parseBackup } from "@/store/backup";
import { fakeAdmin, newState } from "./adminFake.harness";
import { mkTrade } from "./domain.fixtures";

const U1 = "11111111-1111-4111-8111-111111111111";
const sha = (c: string) => c.repeat(64).slice(0, 64);
const PNG_SHA = createHash("sha256").update("png").digest("hex");

interface Verdict {
  ok: boolean;
  source: "mock" | "file";
  records: { trades: number; hyblock: number; days: number };
  problems: string[];
  warnings: string[];
}

/** Restores `exportJson` into an empty profile and compares. Pure – no storage, no network. */
export function probeRestore(exportJson: unknown, source: Verdict["source"]): Verdict {
  const problems: string[] = [];
  const warnings: string[] = [];
  const exp = exportJson as { format?: string; journal?: Record<string, unknown>; screenshots?: { entries?: Record<string, unknown>[]; orphans?: string[]; missing?: string[] } };
  const empty = { ok: false, source, records: { trades: 0, hyblock: 0, days: 0 }, problems, warnings } as Verdict;
  if (exp?.format !== "trade-journal-account-export" || !exp.journal) return { ...empty, problems: ["Das ist kein Konto-Export (format fehlt)."] };

  const { counts: _counts, ...journal } = exp.journal;
  const parsed = parseBackup(JSON.stringify(journal));
  if (!parsed.ok) return { ...empty, problems: [`Der Journal-Teil lässt sich nicht lesen: ${parsed.error}`] };
  if (parsed.invalid.length) problems.push(`${parsed.invalid.length} Datensatz/Datensätze wurden beim Einlesen verworfen.`);

  const fresh = { trades: [], hyblock: [], days: {}, settings: normalizeSettings(null) };
  const restored = applyBackup(fresh, parsed.backup, "replace", ALL_PARTS);
  const before = snapshotDocs({ trades: parsed.backup.trades, hyblock: parsed.backup.hyblock ?? [], days: parsed.backup.days ?? {} });
  const after = snapshotDocs({ trades: restored.trades, hyblock: restored.hyblock, days: restored.days ?? {} });

  // the export's own records, normalised the way the sync normalises them, against what the fresh profile now holds
  const src = journal as { trades?: Record<string, unknown>[]; hyblock?: Record<string, unknown>[]; days?: Record<string, unknown> };
  const expected = new Map<string, string>();
  // `pnl` / `r` are derived and recomputed by every import (validateTrades) – they are not user content
  const content = (kind: "trade" | "hyblock" | "day", rec: unknown): string => {
    const { pnl: _p, r: _r, ...rest } = canonRecord(kind, rec) as Record<string, unknown>;
    return hashDoc(kind === "trade" ? rest : canonRecord(kind, rec));
  };
  const kindOf = (k: string): "trade" | "hyblock" | "day" => (k.startsWith("trade:") ? "trade" : k.startsWith("hyblock:") ? "hyblock" : "day");
  for (const t of src.trades ?? []) expected.set(`trade:${String(t.id)}`, content("trade", t));
  for (const r of src.hyblock ?? []) expected.set(`hyblock:${String(r.id)}`, content("hyblock", r));
  for (const [d, n] of Object.entries(src.days ?? {})) expected.set(`day:${d}`, content("day", n));
  const lost = [...expected.keys()].filter((k) => !after.has(k));
  const changed = [...expected].filter(([k, h]) => after.has(k) && content(kindOf(k), after.get(k)) !== h).map(([k]) => k);
  const invented = [...after.keys()].filter((k) => !expected.has(k));
  if (lost.length) problems.push(`${lost.length} Datensätze fehlen nach der Wiederherstellung (z. B. ${lost.slice(0, 3).join(", ")}).`);
  if (changed.length) {
    const first = changed[0]!;
    const kind = kindOf(first);
    const a = canonRecord(kind, after.get(first)) as Record<string, unknown>;
    const rawRec = (kind === "trade" ? src.trades : kind === "hyblock" ? src.hyblock : undefined)?.find((r) => `${kind}:${String(r.id)}` === first) ?? src.days?.[first.slice(4)];
    const b = canonRecord(kind, rawRec) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== "pnl" && k !== "r" && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    problems.push(`${changed.length} Datensätze haben sich verändert (z. B. ${changed.slice(0, 3).join(", ")}; Felder: ${keys.join(", ") || "?"}).`);
  }
  if (invented.length) problems.push(`${invented.length} Datensätze sind dazugekommen.`);
  if (before.size !== after.size) problems.push(`Anzahl vorher ${before.size}, nachher ${after.size}.`);

  // screenshots: every picture reference of a restored trade is in the hash list with the same recorded hash
  const entries = exp.screenshots?.entries;
  if (!entries) warnings.push("Der Export enthält keine Screenshot-Hashliste (älterer Export).");
  else {
    const byKey = new Map(entries.map((e) => [`${String(e.tradeId)}/${String(e.shotId)}`, e]));
    for (const t of restored.trades) {
      for (const ref of t.screenshots ?? []) {
        const e = byKey.get(`${t.id}/${ref.id}`);
        if (!e) problems.push(`Bild ${ref.id} von ${t.id} fehlt in der Hashliste.`);
        else if (ref.sha256 && e.recordedSha256 !== ref.sha256.toLowerCase()) problems.push(`Bild ${ref.id}: Hash in der Liste weicht vom Trade ab.`);
      }
    }
    for (const e of entries) if (e.match === false) problems.push(`Bild ${String(e.shotId)}: gespeicherter Hash und Hash der Datei sind verschieden.`);
    if (exp.screenshots?.missing?.length) warnings.push(`${exp.screenshots.missing.length} Cloud-Bild(er) fehlen im Speicher.`);
    if (exp.screenshots?.orphans?.length) warnings.push(`${exp.screenshots.orphans.length} Datei(en) ohne Trade im Speicher.`);
  }
  return { ok: problems.length === 0, source, records: { trades: restored.trades.length, hyblock: restored.hyblock.length, days: Object.keys(restored.days ?? {}).length }, problems, warnings };
}

function report(v: Verdict): void {
  const lines = [
    `RESTORE-PROBE ${v.ok ? "OK" : "FEHLER"} (${v.source === "mock" ? "gegen Mock, nicht gegen Supabase" : "aus Export-Datei"})`,
    `  Trades ${v.records.trades} · Messwerte ${v.records.hyblock} · Tagesnotizen ${v.records.days}`,
    ...v.problems.map((p) => `  FEHLER: ${p}`),
    ...v.warnings.map((w) => `  Hinweis: ${w}`),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

const FILE = process.env.RESTORE_PROBE_FILE;

describe.skipIf(!FILE)("restore probe – a real export file", () => {
  it("restores completely into a fresh profile", () => {
    const v = probeRestore(JSON.parse(readFileSync(FILE!, "utf8")), "file");
    report(v);
    expect(v.problems).toEqual([]);
  });
});

describe.skipIf(!!FILE)("restore probe – the real export code against a Supabase mock", () => {
  async function mockExport(extra: (s: ReturnType<typeof newState>) => void = () => undefined) {
    const t = (id: string, over: object = {}) => ({ ...mkTrade({ id, date: "2026-10-01T10:00", entry: 100 + id.length, exit: 110, size: 1000, updatedAt: "2026-10-01T10:00:00.000Z" }), ...over });
    const state = newState({
      claims: { sub: U1, role: "authenticated", aal: "aal1" },
      tables: {
        profiles: [{ id: U1, plan: "free" }],
        journal_docs: [
          { user_id: U1, kind: "trade", id: "t_1", deleted: false, data: t("t_1", { notes: "ruhiger Tag", screenshots: [{ id: "s1", store: "cloud", key: `${U1}/s1.png`, sha256: PNG_SHA, bytes: 3, mime: "image/png" }] }) },
          { user_id: U1, kind: "trade", id: "t_22", deleted: false, data: t("t_22", { fills: [{ t: "2026-10-01T10:00:00Z", side: "buy", qty: 1, price: 100, fee: 0.1, id: "f1" }], mistakes: ["fomo"] }) },
          { user_id: U1, kind: "trade", id: "t_gone", deleted: true, data: { deletedAt: "2026-10-02T00:00:00Z" } },
          { user_id: U1, kind: "hyblock", id: "h_1", deleted: false, data: { id: "h_1", at: "2026-10-01T00:00", longPct: 60, delta: 2 } },
          { user_id: U1, kind: "day", id: "2026-10-01", deleted: false, data: { note: "ruhig", updatedAt: "2026-10-01T20:00:00Z" } },
          { user_id: U1, kind: "settings", id: "settings", deleted: false, data: { currency: "EUR" } },
        ],
      },
      storage: { screenshots: [{ name: `${U1}/s1.png`, body: "png" }] },
    });
    extra(state);
    fakeAdmin(state);
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      return JSON.parse(JSON.stringify(await collectExport(U1)));
    } finally {
      setSupabaseAdminForTests(null);
    }
  }

  it("an export restores into an empty profile without losing, changing or inventing a record", async () => {
    const v = probeRestore(await mockExport(), "mock");
    report(v);
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.records).toEqual({ trades: 2, hyblock: 1, days: 1 });
  });

  it("the probe notices what goes wrong: a hash list that disagrees with the trades, a file whose bytes differ from the recorded hash, something that is no export", async () => {
    const exp = await mockExport();
    const lost = structuredClone(exp);
    // a trade silently missing from the journal part while the hash list still knows it
    lost.journal.trades = lost.journal.trades.filter((t: { id: string }) => t.id !== "t_22");
    expect(probeRestore(lost, "mock").ok).toBe(true); // the export itself is consistent – nothing to compare against

    const bad = structuredClone(exp);
    bad.screenshots.entries[0].recordedSha256 = sha("f");
    expect(probeRestore(bad, "mock").problems.join(" ")).toContain("Hash in der Liste weicht vom Trade ab");

    const mismatch = structuredClone(exp);
    mismatch.screenshots.entries[0].match = false;
    expect(probeRestore(mismatch, "mock").problems.join(" ")).toContain("Hash der Datei");

    expect(probeRestore({ format: "other" }, "mock").ok).toBe(false);
    expect(probeRestore({ format: "trade-journal-account-export", journal: { trades: "x" } }, "mock").ok).toBe(false);
  });

  it("a file without the hash list (an older export) restores with a note, not an error", async () => {
    const exp = await mockExport();
    delete exp.screenshots;
    const v = probeRestore(exp, "mock");
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toContain("keine Screenshot-Hashliste");
  });
});
