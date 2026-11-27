/**
 * German wording for the first problem zod finds in a file the trader picked (backup import): never the raw English message
 * ("Expected object, received number") in a German interface. Pure; the caller keeps the path.
 */

/** What zod calls a type → how a German sentence names it. */
const TYPE_DE: Record<string, string> = {
  object: "ein Objekt",
  array: "eine Liste",
  string: "ein Text",
  number: "eine Zahl",
  integer: "eine ganze Zahl",
  boolean: "ein Ja/Nein-Wert",
  null: "leer",
  undefined: "nichts",
  bigint: "eine Zahl",
  date: "ein Datum",
  nan: "keine Zahl",
  function: "eine Funktion",
  symbol: "ein Symbol",
  map: "eine Zuordnung",
  set: "eine Menge",
  promise: "ein Versprechen",
  unknown: "ein unbekannter Wert",
};

const typeDe = (t: unknown): string => (typeof t === "string" && TYPE_DE[t]) || "ein anderer Typ";

/** One sentence per issue, e.g. `muss ein Objekt sein (gefunden: eine Zahl)`; unknown kinds fall back to „ist ungültig“. */
export function issueDe(issue: object): string {
  const i = issue as { code?: string; expected?: unknown; received?: unknown; type?: unknown };
  switch (i.code) {
    case "invalid_type":
      return i.received === "undefined" ? "fehlt" : `muss ${typeDe(i.expected)} sein (gefunden: ${typeDe(i.received)})`;
    case "invalid_literal":
    case "invalid_enum_value":
    case "invalid_union_discriminator":
      return "hat keinen erlaubten Wert";
    case "unrecognized_keys":
      return "enthält unbekannte Felder";
    case "too_small":
      return i.type === "string" || i.type === "array" ? "ist zu kurz" : "ist zu klein";
    case "too_big":
      return i.type === "string" || i.type === "array" ? "ist zu lang" : "ist zu groß";
    case "invalid_string":
      return "hat nicht das erwartete Format";
    default:
      return "ist ungültig";
  }
}
