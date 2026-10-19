/**
 * F13 / F45 – playbook export and the strict import: round trip, nothing from the journal in the text, and the refusals –
 * size, no JSON, wrong format / version, forbidden keys (prototype pollution), unknown building blocks (named), limits of the
 * tree, wrong types, rules that cannot run – plus clamps and a changed checksum as warnings.
 */
import { describe, expect, it } from "vitest";
import { defaultParams, sanitizeParams } from "@/domain/lab/rules/blocks";
import { CUSTOM_TEMPLATES } from "@/domain/lab/rules/templates";
import { customKey, defaultCustom, newGroup, newLeaf, nodeText, sanitizeCustom } from "@/domain/lab/rules/tree";
import type { CustomConfig, Leaf, LeafParams } from "@/domain/lab/rules/types";
import { buildPlaybook, MAX_PLAYBOOK_CHARS, MAX_TITLE, playbookFileName, playbookText, readPlaybook } from "@/domain/playbook";

const leaf = (id: string, block: Leaf["block"], params: LeafParams = {}, tf: Leaf["tf"] = "exec"): Leaf => ({ ...newLeaf(id, block, tf), params: sanitizeParams(block, { ...defaultParams(block), ...params }) });
const idea = (over: Partial<CustomConfig> = {}): CustomConfig =>
  sanitizeCustom({ ...defaultCustom(), name: "Rücksetzer", interval: "4h", sides: "long", long: newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level: 30 }), leaf("n2", "maPrice", { type: "ema", len: 200, mode: "above" }, "1d")]), ...over });

const good = (): Record<string, unknown> => JSON.parse(playbookText(idea(), { title: "Mein Playbook", description: "RSI-Rücksetzer im Trend", author: "Mia", symbol: "BTCUSDT" })) as Record<string, unknown>;
const read = (v: unknown) => readPlaybook(typeof v === "string" ? v : JSON.stringify(v));
const errorsOf = (v: unknown): string[] => {
  const r = read(v);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.errors;
};

describe("Export", () => {
  it("is versioned JSON with title, description, author, market, the rule tree and a checksum – and nothing else", () => {
    const pb = good();
    expect(Object.keys(pb).sort()).toEqual(["author", "description", "format", "idea", "key", "symbol", "title", "version"]);
    expect(pb).toMatchObject({ format: "tj-playbook", version: 1, title: "Mein Playbook", author: "Mia", symbol: "BTCUSDT", key: customKey(idea()) });
    // no journal data: the text only holds what the rule tree holds
    const text = playbookText(idea());
    for (const word of ["trade", "journal", "note", "account", "balance"]) expect(text.toLowerCase()).not.toContain(`"${word}`);
  });

  it("optional parts are left out when empty, an invalid market is dropped, control characters are cleaned", () => {
    const pb = buildPlaybook(idea(), { title: "  A\u0000B\n", author: "  ", symbol: "btc/usdt", description: "" });
    expect(pb).not.toHaveProperty("author");
    expect(pb).not.toHaveProperty("symbol");
    expect(pb).not.toHaveProperty("description");
    expect(pb.title).toBe("A B");
  });

  it("file names are plain", () => {
    expect(playbookFileName("Über/Under: 50 %")).toBe("playbook-uber-under-50.json");
    expect(playbookFileName("???")).toBe("playbook-idee.json");
  });
});

describe("Import: der Weg zurück", () => {
  it("round trip gives the same rules, named after the title, with no warning", () => {
    const r = read(good());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.playbook).toMatchObject({ title: "Mein Playbook", description: "RSI-Rücksetzer im Trend", author: "Mia", symbol: "BTCUSDT", key: customKey(idea()) });
    expect(nodeText(r.playbook.config.long)).toBe(nodeText(idea().long));
    expect(r.playbook.config.name).toBe("Mein Playbook");
  });

  it("every template of the lab survives export and import unchanged", () => {
    for (const t of CUSTOM_TEMPLATES) {
      const cfg = t.build();
      const r = readPlaybook(playbookText(cfg, { title: t.title }));
      expect(r.ok, t.id).toBe(true);
      if (r.ok) expect(r.playbook.key).toBe(customKey(cfg));
    }
  });

  it("a BOM and surrounding whitespace are fine", () => {
    expect(readPlaybook(`﻿  ${playbookText(idea())}  `).ok).toBe(true);
  });
});

describe("Import: Ablehnungen mit Grund", () => {
  it("empty, too large, not JSON, not an object", () => {
    expect(errorsOf("")).toEqual(["Da ist kein Text zum Einlesen."]);
    expect(readPlaybook(undefined)).toEqual({ ok: false, errors: ["Da ist kein Text zum Einlesen."] });
    expect(errorsOf("x".repeat(MAX_PLAYBOOK_CHARS + 1))[0]).toMatch(/zu groß/);
    expect(errorsOf("{ nope")[0]).toMatch(/kein gültiges JSON/);
    expect(errorsOf("[1,2]")[0]).toMatch(/JSON-Objekt/);
  });

  it("wrong format, missing or newer version", () => {
    expect(errorsOf({ ...good(), format: "other" })[0]).toMatch(/kein Playbook/);
    const { version: _v, ...noVersion } = good();
    void _v;
    expect(errorsOf(noVersion)[0]).toMatch(/Versionsangabe/);
    expect(errorsOf({ ...good(), version: 2 })[0]).toMatch(/Version 2.*versteht Version 1/);
    expect(errorsOf({ ...good(), version: "1" })[0]).toMatch(/Versionsangabe/);
  });

  it("unknown building blocks are NAMED and block the import", () => {
    const pb = good();
    const idea1 = pb.idea as { long: { children: Record<string, unknown>[] } };
    idea1.long.children.push({ type: "leaf", id: "n9", block: "quantumOscillator", tf: "exec", params: {} });
    idea1.long.children.push({ type: "leaf", id: "n10", block: "<script>alert(1)</script>", tf: "exec", params: {} });
    const e = errorsOf(pb).join("\n");
    expect(e).toContain("„quantumOscillator“");
    expect(e).toContain("Long-Regeln: Unbekannte Bausteine");
    expect(e).toContain("blockiert");
    // foreign text in a message is bounded and has no markup characters
    expect(e).not.toContain("<script>");
  });

  it("unknown timeframes, operators, kinds, types and wrong value types", () => {
    const mut = (f: (i: Record<string, any>) => void): string => {
      const pb = good();
      f(pb.idea as Record<string, any>);
      return errorsOf(pb).join("\n");
    };
    expect(mut((i) => (i.long.children[0].tf = "3d"))).toMatch(/Unbekannte Zeitebene „3d“/);
    expect(mut((i) => (i.long.op = "xor"))).toMatch(/unbekannte Verknüpfung „xor“/);
    expect(mut((i) => (i.interval = "5m"))).toMatch(/Ausführungs-Kerze: „5m“ ist ungültig/);
    expect(mut((i) => (i.sides = "up"))).toMatch(/Richtung/);
    expect(mut((i) => (i.stop.kind = "magic"))).toMatch(/Stop: Die Art „magic“/);
    expect(mut((i) => (i.target.kind = "magic"))).toMatch(/Ziel: Die Art „magic“/);
    expect(mut((i) => (i.long.children[0].params.level = { deep: 1 }))).toMatch(/ungültigen Wert/);
    expect(mut((i) => (i.long.children[0].params = "x"))).toMatch(/kein Objekt/);
    expect(mut((i) => i.long.children.push({ type: "wat" }))).toMatch(/unbekannten Typ „wat“/);
    expect(mut((i) => i.long.children.push(5))).toMatch(/kein Objekt/);
    expect(mut((i) => delete i.exits)).toMatch(/fehlt „exits“/);
    expect(mut((i) => (i.long = null))).toMatch(/Long-Regeln: Es fehlt die Regelgruppe/);
    expect(mut((i) => (i.version = 7))).toMatch(/Version 7/);
  });

  it("wrong types of the text fields", () => {
    expect(errorsOf({ ...good(), title: 5 })[0]).toMatch(/„title“ muss ein Text/);
    expect(errorsOf({ ...good(), title: "   " })[0]).toMatch(/„title“ ist leer/);
    const { title: _t, ...noTitle } = good();
    void _t;
    expect(errorsOf(noTitle)[0]).toMatch(/„title“ fehlt/);
    expect(errorsOf({ ...good(), symbol: "btc usdt" })[0]).toMatch(/„symbol“/);
    expect(errorsOf({ ...good(), idea: [] })[0]).toMatch(/fehlt die Regelidee/);
  });

  it("limits of the tree are errors, nothing is cut silently", () => {
    const wide = good();
    const i = wide.idea as { long: { children: unknown[] } };
    i.long.children = Array.from({ length: 13 }, (_, k) => ({ type: "leaf", id: `n${k + 1}`, block: "volume", tf: "exec", params: {} }));
    expect(errorsOf(wide).join("\n")).toMatch(/mehr als 12 Einträge/);
    const many = good();
    (many.idea as { long: { children: unknown[] } }).long.children = Array.from({ length: 4 }, (_, g) => ({ type: "group", id: `g${g + 3}`, op: "or", children: Array.from({ length: 10 }, (_, k) => ({ type: "leaf", id: `n${g * 10 + k + 1}`, block: "volume", tf: "exec", params: {} })) }));
    expect(errorsOf(many).join("\n")).toMatch(/Mehr als 24 Bedingungen/);
    let deep: Record<string, unknown> = { type: "leaf", id: "n1", block: "volume", tf: "exec", params: {} };
    for (let k = 0; k < 5; k++) deep = { type: "group", id: `g${k + 3}`, op: "and", children: [deep] };
    const d = good();
    (d.idea as { long: unknown }).long = { type: "group", id: "g1", op: "and", children: [deep] };
    expect(errorsOf(d).join("\n")).toMatch(/tiefer als 4 Ebenen/);
  });

  it("rules that cannot run are refused with the lab's own reason", () => {
    const pb = good();
    (pb.idea as { long: { children: unknown[] } }).long.children = [];
    expect(errorsOf(pb).join("\n")).toMatch(/lassen sich so nicht laufen lassen: Long-Regeln: Ohne mindestens eine Bedingung/);
    const lad = good();
    (lad.idea as { long: { children: unknown[] }; interval: string }).interval = "15m";
    (lad.idea as { long: { children: unknown[] } }).long.children = [{ type: "leaf", id: "n1", block: "mcbLadder", tf: "exec", params: {} }];
    expect(errorsOf(lad).join("\n")).toMatch(/MCB-Leiter prüft im Takt 1h oder 4h/);
  });
});

describe("Import: bösartige Eingaben", () => {
  it("prototype pollution keys are refused at any depth and nothing is polluted", () => {
    const evil = [
      '{"__proto__":{"polluted":true},"format":"tj-playbook","version":1}',
      JSON.stringify(good()).replace('"title"', '"constructor":{"prototype":{"polluted":true}},"title"'),
      JSON.stringify(good()).replace('"params":{', '"params":{"__proto__":{"polluted":true},'),
      JSON.stringify(good()).replace('"idea":{', '"idea":{"prototype":1,'),
    ];
    for (const t of evil) {
      const r = readPlaybook(t);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]).toMatch(/unzulässigen Schlüssel „(__proto__|constructor|prototype)“/);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("huge or hostile structures are refused without hanging", () => {
    const t0 = Date.now();
    // large text
    expect(readPlaybook(`{"a":"${"x".repeat(MAX_PLAYBOOK_CHARS)}"}`).ok).toBe(false);
    // very deep nesting, within the size limit
    const deep = `${"[".repeat(5000)}${"]".repeat(5000)}`;
    expect(readPlaybook(deep).ok).toBe(false);
    expect(readPlaybook(`{"format":"tj-playbook","version":1,"x":${"[".repeat(300)}${"]".repeat(300)}}`)).toMatchObject({ ok: false, errors: [expect.stringMatching(/zu tief/)] });
    // many entries
    const bigList = JSON.stringify({ ...good(), extra: Array.from({ length: 1000 }, () => 0) });
    expect(errorsOf(bigList)[0]).toMatch(/zu lange Liste/);
    const wideObj = JSON.stringify({ ...good(), ...Object.fromEntries(Array.from({ length: 9000 }, (_, k) => [`k${k}`, 0])) });
    expect(wideObj.length).toBeLessThan(MAX_PLAYBOOK_CHARS * 2);
    expect(readPlaybook(wideObj).ok).toBe(false);
    // a huge string value, an absurd number
    expect(errorsOf({ ...good(), description: "y".repeat(3000) })[0]).toMatch(/zu langen Text/);
    expect(errorsOf(JSON.stringify(good()).replace('"level":30', '"level":1e999'))[0]).toMatch(/ungültige Zahl/);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("text fields are data, not markup or code: they come back as plain, bounded text", () => {
    const r = read({ ...good(), title: `<img src=x onerror=alert(1)> ${"t".repeat(200)}`, author: "javascript:alert(1) ", description: "{{7*7}} ${process.env} <b>x</b>" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.playbook.title.length).toBeLessThanOrEqual(MAX_TITLE);
    expect(r.playbook.description).toBe("{{7*7}} ${process.env} <b>x</b>");
    expect(r.playbook.author).toBe("javascript:alert(1)");
    expect(r.warnings.some((w) => w.includes("„title“ ist länger"))).toBe(true);
    // no function, no code path: the result is plain data
    expect(JSON.parse(JSON.stringify(r.playbook))).toEqual(r.playbook);
  });
});

describe("Import: Warnungen", () => {
  it("values outside the allowed range are clamped and listed", () => {
    const pb = good();
    (pb.idea as { stop: { atr: number } }).stop.atr = 99;
    (pb.idea as { long: { children: { params: LeafParams }[] } }).long.children[0]!.params.level = 500;
    const r = read(pb);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.join("\n")).toContain("Stop (atr): 99 liegt außerhalb des Zulässigen und wird als 10 verwendet.");
    expect(r.warnings.join("\n")).toContain("Long-Regeln · RSI Niveau (level): 500 liegt außerhalb des Zulässigen und wird als 99 verwendet.");
  });

  it("a checksum that does not match the rules says the file was changed", () => {
    const pb = good();
    (pb.idea as { stop: { atr: number } }).stop.atr = 3;
    const r = read(pb);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(" ")).toMatch(/Prüfsumme passt nicht/);
  });

  it("unknown top-level fields are ignored with a note", () => {
    const r = read({ ...good(), tradeHistory: [1, 2], "<b>": 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.join("\n")).toContain("„tradeHistory“ ist unbekannt");
    expect(r.playbook).not.toHaveProperty("tradeHistory");
  });
});
