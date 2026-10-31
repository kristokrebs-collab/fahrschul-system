/**
 * F45 – Fassungen eines Playbooks: Kennung und Fassungsnummer, die Änderungsnotiz, die Checkliste; der Leser erkennt dieselbe Idee in
 * einer neueren Fassung (mit dem Unterschied in Klartext), nichts wird von selbst übernommen; die Checkliste wird auf Wunsch die
 * Checkliste einer Entscheidungsgrundlage im Journal.
 */
import { describe, expect, it } from "vitest";
import { defaultParams, sanitizeParams } from "@/domain/lab/rules/blocks";
import { customKey, defaultCustom, newGroup, newLeaf, sanitizeCustom } from "@/domain/lab/rules/tree";
import type { CustomConfig, Leaf, LeafParams } from "@/domain/lab/rules/types";
import { buildPlaybook, cleanChecklist, MAX_CHANGES, MAX_CHECK_ITEM, MAX_CHECKLIST, newPlaybookId, nextRevision, playbookRelation, playbookText, PLAYBOOK_ID_RE, readPlaybook, revisionNote, setupFromPlaybook, type Playbook } from "@/domain/playbook";
import { strategyOf } from "@/domain/strategy";

const leaf = (id: string, block: Leaf["block"], params: LeafParams = {}): Leaf => ({ ...newLeaf(id, block, "exec"), params: sanitizeParams(block, { ...defaultParams(block), ...params }) });
const idea = (level = 30, name = "Rücksetzer"): CustomConfig =>
  sanitizeCustom({ ...defaultCustom(), name, interval: "4h", sides: "long", long: newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level }), leaf("n2", "maPrice", { type: "ema", len: 200, mode: "above" })]) });
const ID = "pb-k3x9q2m7ab";
const text = (level: number, rev: number, extra: Record<string, unknown> = {}): string => playbookText(idea(level), { title: "Mein Playbook", author: "Mia", id: ID, rev, ...extra });
const read = (t: string): Playbook => {
  const r = readPlaybook(t);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.playbook;
};

describe("Export mit Fassung", () => {
  it("trägt Kennung, Fassung, Änderungsnotiz und Checkliste – nur wenn sie gültig sind", () => {
    const pb = buildPlaybook(idea(), { title: "T", id: ID, rev: 2, changes: "  engerer\nStop ", checklist: ["News geprüft", "  ", "News geprüft", "Spread normal"] });
    expect(pb).toMatchObject({ id: ID, rev: 2, changes: "engerer Stop", checklist: ["News geprüft", "Spread normal"] });
    // ohne gültige Kennung oder Fassungsnummer: keine von beiden, keine Notiz
    for (const bad of [{ id: "X", rev: 1 }, { id: ID, rev: 0 }, { id: ID, rev: 1.5 }, { id: ID }, { rev: 3 }]) {
      const b = buildPlaybook(idea(), { title: "T", changes: "x", ...bad });
      expect(b).not.toHaveProperty("id");
      expect(b).not.toHaveProperty("rev");
      expect(b).not.toHaveProperty("changes");
    }
    // ohne Checkliste kein Schlüssel – ein Playbook von früher bleibt byte-gleich
    expect(buildPlaybook(idea(), { title: "T" })).not.toHaveProperty("checklist");
    expect(Object.keys(buildPlaybook(idea(), { title: "T" })).sort()).toEqual(["format", "idea", "key", "title", "version"]);
  });

  it("die Checkliste ist begrenzt: höchstens 12 Punkte zu 100 Zeichen, keine Doppelten, nur Text", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Punkt ${i}`);
    expect(cleanChecklist(many)).toHaveLength(MAX_CHECKLIST);
    expect(cleanChecklist(["x".repeat(300)])[0]).toHaveLength(MAX_CHECK_ITEM);
    expect(cleanChecklist(["a", 3, null, { x: 1 }, "a", "b"])).toEqual(["a", "b"]);
  });

  it("newPlaybookId macht gültige Kennungen und braucht nur die Zufallsquelle, die man ihm gibt", () => {
    let k = 0;
    const seq = () => [0.1, 0.42, 0.99, 0.0, 0.7][k++ % 5]!;
    const a = newPlaybookId(seq);
    expect(a).toMatch(PLAYBOOK_ID_RE);
    expect(a).toHaveLength(13);
    k = 0;
    expect(newPlaybookId(seq)).toBe(a);
    expect(newPlaybookId(Math.random)).toMatch(PLAYBOOK_ID_RE);
  });

  it("nextRevision: erste Fassung 1; gleiche Regeln gleiche Nummer; geänderte Regeln eine mehr", () => {
    const key = customKey(idea());
    expect(nextRevision(null, key)).toBe(1);
    expect(nextRevision({ rev: 3, key }, key)).toBe(3);
    expect(nextRevision({ rev: 3, key }, customKey(idea(25)))).toBe(4);
  });
});

describe("Import mit Fassung", () => {
  it("liest Kennung, Fassung, Notiz und Checkliste; ein Playbook ohne sie bleibt gültig", () => {
    const pb = read(text(30, 2, { changes: "RSI-Niveau 30", checklist: ["News geprüft", "Spread normal"] }));
    expect(pb).toMatchObject({ id: ID, rev: 2, changes: "RSI-Niveau 30", checklist: ["News geprüft", "Spread normal"] });
    const old = read(playbookText(idea(), { title: "Alt" }));
    expect(old).toMatchObject({ id: null, rev: null, changes: "", checklist: [] });
  });

  it("kaputte Angaben werden mit Warnung verworfen, nie eine Ablehnung", () => {
    const r = JSON.parse(text(30, 1)) as Record<string, unknown>;
    for (const patch of [{ rev: "2" }, { rev: 0 }, { id: "nope" }, { rev: undefined }]) {
      const res = readPlaybook(JSON.stringify({ ...r, ...patch }));
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.playbook.id).toBeNull();
        expect(res.playbook.rev).toBeNull();
        expect(res.warnings.join(" ")).toContain("„id“ und „rev“");
      }
    }
    const bad = readPlaybook(JSON.stringify({ ...r, checklist: "kaufen", changes: 5 }));
    expect(bad.ok && bad.warnings.join(" ")).toContain("Checkliste ist keine Liste");
    const long = readPlaybook(JSON.stringify({ ...r, checklist: Array.from({ length: 15 }, (_, i) => `P${i}`).concat([3 as unknown as string]) }));
    expect(long.ok && long.playbook.checklist).toHaveLength(MAX_CHECKLIST);
    expect(long.ok && long.warnings.join(" ")).toContain("Von 15 Checklisten-Punkten werden 12 übernommen");
    const longNote = readPlaybook(JSON.stringify({ ...r, changes: "n".repeat(MAX_CHANGES + 50) }));
    expect(longNote.ok && longNote.playbook.changes).toHaveLength(MAX_CHANGES);
  });

  it("die Checkliste ist Text, kein Code: ein HTML-Schnipsel bleibt Text, Steuerzeichen werden Leerzeichen", () => {
    const r = JSON.parse(text(30, 1)) as Record<string, unknown>;
    const res = readPlaybook(JSON.stringify({ ...r, checklist: ["<img src=x onerror=alert(1)>", "a\u0000b\nc"] }));
    expect(res.ok && res.playbook.checklist).toEqual(["<img src=x onerror=alert(1)>", "a b c"]);
  });
});

describe("Dieselbe Idee in einer anderen Fassung erkennen", () => {
  const link = (rev: number, level = 30) => ({ pid: ID, rev, key: customKey(idea(level)) });

  it("neuere Fassung: sagt von wo nach wo und was sich ändern würde – in Klartext", () => {
    const next = read(text(25, 2, { changes: "tieferes Niveau" }));
    const rel = playbookRelation(link(1), idea(30, "Mein Entwurf"), next);
    expect(rel).toMatchObject({ kind: "newer", from: 1, to: 2, localEdits: false });
    if (rel.kind !== "newer") return;
    expect(rel.diff).toEqual(["Long · RSI Niveau: 30 → 25"]);
    // der Name des Entwurfs gehört dem Leser: der Titel in der Datei erzeugt keinen Unterschied
    expect(rel.diff.join(" ")).not.toContain("Name");
  });

  it("derselbe Stand: „same“; dieselbe Nummer, andere Regeln: „same-rev-changed“; ältere Nummer: „older“", () => {
    expect(playbookRelation(link(2, 25), idea(25), read(text(25, 2)))).toEqual({ kind: "same", rev: 2 });
    const changed = playbookRelation(link(2, 30), idea(30), read(text(25, 2)));
    expect(changed).toMatchObject({ kind: "same-rev-changed", rev: 2 });
    const older = playbookRelation(link(3, 25), idea(25), read(text(30, 2)));
    expect(older).toMatchObject({ kind: "older", from: 3, to: 2 });
  });

  it("hat der Leser den Entwurf selbst geändert, steht das da (sein Stand ≠ was er übernommen hatte)", () => {
    const rel = playbookRelation(link(1, 30), idea(40, "Mein Entwurf"), read(text(25, 2)));
    expect(rel).toMatchObject({ kind: "newer", localEdits: true });
    if (rel.kind === "newer") expect(rel.diff).toEqual(["Long · RSI Niveau: 40 → 25"]);
  });

  it("ein anderes Playbook oder eine Datei ohne Kennung ist keine Fassung davon", () => {
    const other = read(playbookText(idea(), { title: "x", id: "pb-zzzzzzzzzz", rev: 5 }));
    expect(playbookRelation(link(1), idea(), other)).toEqual({ kind: "other" });
    expect(playbookRelation(link(1), idea(), read(playbookText(idea(), { title: "x" })))).toEqual({ kind: "none" });
    expect(playbookRelation(null, idea(), read(text(30, 2)))).toEqual({ kind: "none" });
    expect(playbookRelation({ pid: null, rev: null, key: "k" }, idea(), read(text(30, 2)))).toEqual({ kind: "none" });
  });

  it("revisionNote: Fassung, Autor, Notiz – und höchstens 140 Zeichen", () => {
    expect(revisionNote({ rev: 2, author: "Mia", changes: "tieferes Niveau" })).toBe("Fassung 2 von Mia: tieferes Niveau");
    expect(revisionNote({ rev: 3, author: null, changes: "" })).toBe("Fassung 3");
    expect(revisionNote({ rev: 1, author: "M", changes: "x".repeat(300) })).toHaveLength(140);
  });
});

describe("Checkliste → Entscheidungsgrundlage im Journal", () => {
  const pb = (): Playbook => read(text(30, 2, { description: "RSI-Rücksetzer im Trend", checklist: ["News geprüft", "Spread normal"], symbol: undefined }));
  let n = 0;
  const id = (p: string): string => `${p}${++n}`;

  it("die Checkliste des Autors wird die Checkliste, die Regeln in Worten die Kriterien, der Ursprung steht in der Beschreibung", () => {
    const s = setupFromPlaybook(pb(), [{ name: "Anderes" }], "#6f9dc9", id);
    expect(s).toMatchObject({ name: "Mein Playbook", account: "both", color: "#6f9dc9" });
    expect(s.id.startsWith("s_")).toBe(true);
    expect(s.checklist.map((c) => c.text)).toEqual(["News geprüft", "Spread normal"]);
    expect(new Set(s.checklist.map((c) => c.id)).size).toBe(2);
    expect(s.desc).toContain("RSI-Rücksetzer im Trend");
    expect(s.desc).toContain("Aus einem Playbook von Mia (Fassung 2)");
    expect(s.desc).toContain("fremde Regeln, nicht von dir geprüft");
    const x = strategyOf(s);
    expect(x.entryCriteria.map((k) => k.text)).toEqual([expect.stringMatching(/^Long wenn /)]);
    expect(x.exitCriteria.map((k) => k.text)).toEqual([expect.stringMatching(/^Stop: /)]);
    expect(x.tags).toEqual(["Playbook"]);
  });

  it("ein Name, der schon vergeben ist, bekommt „(Playbook)“; der Markt der Datei wird übernommen", () => {
    const s = setupFromPlaybook({ ...pb(), symbol: "ETHUSDT" }, [{ name: "mein playbook" }, { name: "Mein Playbook (Playbook)" }], "#fff", id);
    expect(s.name).toBe("Mein Playbook (Playbook 2)");
    expect(strategyOf(s).markets).toEqual(["ETHUSDT"]);
  });

  it("ohne Checkliste ist die Checkliste leer – nichts wird erfunden", () => {
    const s = setupFromPlaybook(read(playbookText(idea(), { title: "Ohne" })), [], "#fff", id);
    expect(s.checklist).toEqual([]);
    expect(s.desc).toContain("Aus einem Playbook");
    expect(s.desc).not.toContain("Fassung");
  });
});
