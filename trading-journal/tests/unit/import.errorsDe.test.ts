/**
 * Runde 13 (Funktionsprüfung): what the trader sees when the picked backup file is wrong. Found with hostile files in the production
 * build: a JSON file whose `settings` is a number said „settings: Expected object, received number“ – English zod text in a German
 * interface; an empty file and a bare `[]` were accepted as a „Backup“ with 0 / 0 / 0 (and „Ersetzen“ with it empties the journal).
 */
import { describe, expect, it } from "vitest";
import { EMPTY_FILE, NOT_A_BACKUP, NOT_JSON, parseBackup } from "@/store/backup";
import { issueDe } from "@/lib/zodDe";
import { JsonBackupSchema } from "@/domain/schemas";

const error = (text: string) => {
  const r = parseBackup(text);
  if (r.ok) throw new Error(`expected a refusal for ${text.slice(0, 40)}`);
  return r;
};

describe("parseBackup refuses a wrong file in German", () => {
  it("an empty (or blank) file is „leer“, not „kein gültiges JSON“", () => {
    expect(error("").error).toBe(EMPTY_FILE);
    expect(error("  \n\t ").error).toBe(EMPTY_FILE);
    expect(EMPTY_FILE).toBe("Die Datei ist leer.");
  });

  it("text that is not JSON says what the file is not", () => {
    expect(error("hello world").error).toBe(NOT_JSON);
    expect(NOT_JSON).toMatch(/^Kein gültiges JSON/);
    expect(NOT_JSON).toContain("keine Backup-Datei");
  });

  it("a bare empty array carries nothing – it is not a backup (but a bare array WITH trades still is one)", () => {
    expect(error("[]").error).toBe(NOT_A_BACKUP);
    expect(parseBackup(JSON.stringify([{ id: "t1", pair: "BTC/USDT", side: "long", entry: 100, exit: 110, size: 1000, date: "2026-10-01T10:00" }])).ok).toBe(true);
  });

  it("zod's English never reaches the screen: wrong envelope fields are named in German with the path kept", () => {
    const cases: [unknown, string, RegExp][] = [
      [{ settings: 5 }, "settings", /^muss ein Objekt sein \(gefunden: eine Zahl\)$/],
      [{ trades: "x" }, "trades", /^muss eine Liste sein \(gefunden: ein Text\)$/],
      [{ trades: [], hyblock: {} }, "hyblock", /^muss eine Liste sein \(gefunden: ein Objekt\)$/],
      [{ trades: [], days: [] }, "days", /^muss ein Objekt sein \(gefunden: eine Liste\)$/],
      [{ trades: [], exportedAt: 5 }, "exportedAt", /^muss ein Text sein \(gefunden: eine Zahl\)$/],
      [{ trades: [], schemaVersion: "1" }, "schemaVersion", /^muss eine Zahl sein \(gefunden: ein Text\)$/],
    ];
    for (const [file, path, wording] of cases) {
      const r = error(JSON.stringify(file));
      expect(r.path, JSON.stringify(file)).toBe(path);
      expect(r.error, JSON.stringify(file)).toMatch(wording);
      expect(r.error).not.toMatch(/Expected|received|Required|Invalid/);
    }
  });

  it("a file whose top level is no object says the file is no backup", () => {
    expect(error('"just a string"')).toMatchObject({ path: "", error: "Die Datei ist kein Backup – sie muss ein Objekt sein (gefunden: ein Text)" });
    expect(error("42")).toMatchObject({ path: "", error: "Die Datei ist kein Backup – sie muss ein Objekt sein (gefunden: eine Zahl)" });
    expect(error("null").error).toMatch(/^Die Datei ist kein Backup – sie /);
  });

  it("an object with neither trades nor settings keeps its own message", () => {
    expect(error("{}")).toMatchObject({ error: NOT_A_BACKUP, path: "trades" });
  });
});

describe("issueDe", () => {
  const first = (value: unknown) => {
    const r = JsonBackupSchema.safeParse(value);
    if (r.success) throw new Error("expected an issue");
    return r.error.issues[0]!;
  };

  it("names the missing, the wrongly typed and the generic case", () => {
    expect(issueDe({ code: "invalid_type", expected: "string", received: "undefined" })).toBe("fehlt");
    expect(issueDe(first({ settings: "nope" }))).toBe("muss ein Objekt sein (gefunden: ein Text)");
    expect(issueDe({ code: "invalid_type", expected: "boolean", received: "null" })).toBe("muss ein Ja/Nein-Wert sein (gefunden: leer)");
    expect(issueDe({ code: "invalid_type", expected: "wibble", received: "wobble" })).toBe("muss ein anderer Typ sein (gefunden: ein anderer Typ)");
    expect(issueDe({ code: "custom" })).toBe("ist ungültig");
  });

  it("covers size and value problems", () => {
    expect(issueDe({ code: "too_small", type: "string" })).toBe("ist zu kurz");
    expect(issueDe({ code: "too_small", type: "number" })).toBe("ist zu klein");
    expect(issueDe({ code: "too_big", type: "array" })).toBe("ist zu lang");
    expect(issueDe({ code: "too_big", type: "number" })).toBe("ist zu groß");
    expect(issueDe({ code: "invalid_enum_value" })).toBe("hat keinen erlaubten Wert");
    expect(issueDe({ code: "unrecognized_keys" })).toBe("enthält unbekannte Felder");
    expect(issueDe({ code: "invalid_string" })).toBe("hat nicht das erwartete Format");
  });
});
