/**
 * Branchen-Trend – the paper protocol: the same record as `vault/protokoll.jsonl` of the lab script (the first lines of a REAL file are the
 * fixture), once per day / industry / direction / strategy, never sent anywhere.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROTOKOLL_HINWEIS, entriesFromEvents, entriesOfStored, erfasstText, mergeEntries, parseJsonl, toJsonl, lineOf, type AmpelEvent, type ProtokollEintrag } from "@/domain/industryTrend";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = readFileSync(join(here, "../fixtures/industryTrend/protokoll-sample.jsonl"), "utf8");

const ev = (datum: string, branche: string, signal: "KAUF" | "VERKAUF"): AmpelEvent => ({ datum, branche, signal, punkt: signal === "KAUF" ? "gruen" : "rot" });
const NOW = new Date(2026, 9, 30, 23, 38, 56);

describe("Format wie vault/protokoll.jsonl", () => {
  it("liest die echte Datei und schreibt jede Zeile Zeichen für Zeichen wieder so", () => {
    const { entries, skipped } = parseJsonl(SAMPLE);
    expect(skipped).toBe(0);
    expect(entries).toHaveLength(12);
    expect(toJsonl(entries)).toBe(SAMPLE);
    expect(entries[0]).toEqual({
      erfasst: "2026-10-30T23:38:56",
      datum: "20260713",
      branche: "Books",
      signal: "KAUF",
      strategie: "s-65-20-1.0-0.01-2.0",
      modus: "DEMO/PAPIER",
      gesendet: false,
      hinweis: "Nur Protokoll, keine Order gesendet.",
    });
  });

  it("Zeit wie Pythons isoformat(timespec=\"seconds\") in Ortszeit", () => {
    expect(erfasstText(NOW)).toBe("2026-10-30T23:38:56");
    expect(erfasstText(new Date(2027, 0, 2, 3, 4, 5))).toBe("2027-01-02T03:04:05");
  });

  it("neue Einträge tragen immer DEMO/PAPIER und gesendet:false", () => {
    const [e] = entriesFromEvents([ev("20260928", "Oil", "KAUF")], "s-20-40-2.8-0.02-2.0", NOW);
    expect(lineOf(e!)).toBe('{"erfasst": "2026-10-30T23:38:56", "datum": "20260928", "branche": "Oil", "signal": "KAUF", "strategie": "s-20-40-2.8-0.02-2.0", "modus": "DEMO/PAPIER", "gesendet": false, "hinweis": "Nur Protokoll, keine Order gesendet."}');
    expect(e!.hinweis).toBe(PROTOKOLL_HINWEIS);
  });

  it("leeres Protokoll = leere Datei", () => {
    expect(toJsonl([])).toBe("");
  });
});

describe("Zusammenführen", () => {
  const S = "s-20-40-2.8-0.02-2.0";
  it("ein Wechsel steht nur einmal drin, auch wenn die Ampel ihn wieder meldet", () => {
    const first = mergeEntries([], entriesFromEvents([ev("20260928", "Oil", "KAUF"), ev("20260929", "Coal", "VERKAUF")], S, NOW));
    expect(first.added).toHaveLength(2);
    const again = mergeEntries(first.list, entriesFromEvents([ev("20260928", "Oil", "KAUF"), ev("20260930", "Gold", "KAUF")], S, new Date(2026, 9, 31, 8, 0, 0)));
    expect(again.added.map((e) => e.branche)).toEqual(["Gold"]);
    expect(again.list).toHaveLength(3);
    // der alte Eintrag behält seine Erfassungszeit
    expect(again.list.find((e) => e.branche === "Oil")!.erfasst).toBe("2026-10-30T23:38:56");
  });

  it("dieselbe Branche und derselbe Tag mit anderer Strategie ist ein anderer Eintrag", () => {
    const a = entriesFromEvents([ev("20260928", "Oil", "KAUF")], S, NOW);
    const b = entriesFromEvents([ev("20260928", "Oil", "KAUF")], "s-65-20-1.0-0.01-2.0", NOW);
    expect(mergeEntries(a, b).list).toHaveLength(2);
  });

  it("sortiert nach Tag und Branche und behält bei Überlauf die neuesten", () => {
    const list = entriesFromEvents([ev("20260930", "Oil", "KAUF"), ev("20260101", "Gold", "KAUF"), ev("20260101", "Coal", "KAUF"), ev("20260202", "Aero", "KAUF")], S, NOW);
    const m = mergeEntries([], list, 3);
    expect(m.list.map((e) => `${e.datum}${e.branche}`)).toEqual(["20260101Gold", "20260202Aero", "20260930Oil"]);
  });
});

describe("Lesen von Dateien und Speicher (nichts Fremdes wird übernommen)", () => {
  const good = lineOf(entriesFromEvents([ev("20260928", "Oil", "KAUF")], "s-20-40-2.8-0.02-2.0", NOW)[0]!);

  it("überspringt kaputte Zeilen, zählt sie und übernimmt die guten", () => {
    const text = `${good}\nkein json\n\n{"datum": "heute"}\n${good}\n`;
    const r = parseJsonl(text);
    expect(r.entries).toHaveLength(2);
    expect(r.skipped).toBe(2);
  });

  it("verweigert gesendet:true, unbekannte Richtungen und fremde Kennungen", () => {
    const base = JSON.parse(good) as Record<string, unknown>;
    for (const patch of [{ gesendet: true }, { signal: "SHORT" }, { strategie: "x-1" }, { datum: "2026-09-28" }, { branche: "<img src=x onerror=alert(1)>" }]) {
      expect(parseJsonl(JSON.stringify({ ...base, ...patch })).entries, JSON.stringify(patch)).toEqual([]);
    }
  });

  it("eine überlange Zeile wird nicht gelesen", () => {
    expect(parseJsonl(`${good.slice(0, -1)}, "x": "${"a".repeat(3000)}"}`).skipped).toBe(1);
  });

  it("aus dem Speicher: nur Listen, nur gültige Einträge", () => {
    expect(entriesOfStored(null)).toEqual([]);
    expect(entriesOfStored({ a: 1 })).toEqual([]);
    const e = JSON.parse(good) as ProtokollEintrag;
    expect(entriesOfStored([e, { ...e, gesendet: true }, 5])).toEqual([e]);
  });
});
