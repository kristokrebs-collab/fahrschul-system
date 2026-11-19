/**
 * A4: Alltagssprache und Seiten als Treffer. Jede F-ID hat mindestens drei Alltagssätze (`featureSynonyms.ts`), jede Id dort gibt
 * es im Register, die zwanzig Alltagsfragen führen auf den erwarteten ersten Treffer, "Einstellungen" findet die Seite (nicht nur
 * "Box-Einstellungen"), und eine Seite verdrängt keine Funktion, die ihren Namen trägt.
 */
import { describe, expect, it } from "vitest";
import { searchTargets } from "@/app/featureQuery";
import { FEATURE_REGISTRY } from "@/app/features";
import { EVERYDAY } from "@/app/featureSynonyms";
import { PAGE_WORDS, isPageTargetId, pageOfTargetId, pageTargetId, pageTargets } from "@/app/pageTargets";
import { PAGES } from "@/store/uiStore";
import { EVERYDAY_QUESTIONS } from "../fixtures/everydayQuestions";

describe("Alltagssprache je Funktion", () => {
  it("every key names a function of the register, and every phrase is two words or a long, specific one (no 'Trade', 'Geld')", () => {
    const ids = new Set(FEATURE_REGISTRY.map((f) => f.id));
    for (const [id, phrases] of Object.entries(EVERYDAY)) {
      expect(ids.has(id), `Id ${id} steht nicht im Register`).toBe(true);
      for (const p of phrases) {
        const t = p.trim();
        expect(t.split(/\s+/).length >= 2 || t.length >= 8, `„${p}“ (${id}) ist ein zu allgemeines Einzelwort`).toBe(true);
      }
    }
  });

  it("every F-ID of the register is reachable by at least three everyday phrases", () => {
    const perFid = new Map<string, number>();
    for (const f of FEATURE_REGISTRY) {
      const n = (EVERYDAY[f.id] ?? []).length + (f.intents ?? []).length;
      for (const fid of f.fids) perFid.set(fid, Math.max(perFid.get(fid) ?? 0, n));
    }
    expect(perFid.size).toBeGreaterThan(55);
    for (const [fid, n] of perFid) expect(n, `${fid} hat zu wenige Alltagssätze`).toBeGreaterThanOrEqual(3);
    // and the new sentences are the point: every entry that carries an F-ID has its own everyday phrases
    for (const f of FEATURE_REGISTRY) if (f.fids.length) expect(EVERYDAY[f.id]?.length ?? 0, `${f.id} (${f.fids.join("+")}) ohne Alltagssätze`).toBeGreaterThanOrEqual(2);
  });
});

describe("Seiten als Treffer", () => {
  it("all 19 pages are targets with a label, a plain-word hint and everyday words", () => {
    const t = pageTargets();
    expect(t).toHaveLength(PAGES.length);
    for (const e of t) {
      expect(isPageTargetId(e.id)).toBe(true);
      expect(pageOfTargetId(e.id)).toBe(e.page);
      expect(e.name).toBeTruthy();
      expect(e.task).toBeTruthy();
    }
    for (const p of PAGES) expect(PAGE_WORDS[p].length, `Seite ${p}`).toBeGreaterThanOrEqual(3);
    expect(pageOfTargetId("page:gibt-es-nicht")).toBeNull();
    expect(pageOfTargetId("settings")).toBeNull();
    expect(pageTargetId("konto")).toBe("page:konto");
  });

  it("'Einstellungen' leads to the page first, the cards named Einstellungen come after it", () => {
    const hits = searchTargets("Einstellungen");
    expect(hits[0]!.entry.id).toBe("page:settings");
    expect(hits.map((h) => h.entry.id)).toContain("box-einstellungen");
    expect(hits.findIndex((h) => h.entry.id === "box-einstellungen")).toBeGreaterThan(0);
  });

  it("everyday words find pages: Optionen, Anmelden, Tarife, Startseite", () => {
    expect(searchTargets("Optionen")[0]!.entry.id).toBe("page:settings");
    expect(searchTargets("einloggen")[0]!.entry.id).toBe("page:konto");
    expect(searchTargets("Tarife")[0]!.entry.id).toBe("page:preise");
    expect(searchTargets("Startseite")[0]!.entry.id).toBe("page:overview");
  });

  it("a page does not push a function that carries its name out of first place (Assistent, Backup, Check-in)", () => {
    expect(searchTargets("Assistent")[0]!.entry.id).toBe("assistent");
    expect(searchTargets("Backup")[0]!.entry.id).toBe("backup");
    expect(searchTargets("Wochenbericht")[0]!.entry.id).toBe("berichte");
    expect(searchTargets("Backtest")[0]!.entry.id).toBe("labor");
  });

  it("a page has no group name: 'Hilfe' is not every page of the group 'Konto, Einstellungen & Hilfe'", () => {
    const pageHits = searchTargets("Hilfe").filter((h) => isPageTargetId(h.entry.id) && h.score > 100);
    expect(pageHits.length).toBeLessThanOrEqual(2);
    expect(searchTargets("Hilfe").some((h) => h.entry.id === "page:settings" && h.score > 100)).toBe(false);
  });
});

describe("zwanzig Alltagsfragen", () => {
  it("has twenty questions", () => {
    expect(EVERYDAY_QUESTIONS).toHaveLength(20);
  });

  for (const g of EVERYDAY_QUESTIONS) {
    it(`„${g.q}“ → ${g.first}`, () => {
      const hits = searchTargets(g.q);
      expect(hits.length, "ein Treffer endet nie leer").toBeGreaterThan(0);
      expect(hits[0]!.entry.id).toBe(g.first);
    });
  }
});
