/**
 * A trailing unit of a formatted figure – `%`, `R`, `×`, `€`, `$` or a currency / coin code (`USDT`, `EUR`) – with the
 * space before it. Only after a figure (something with a digit): `BTCUSDT`, `KW 17`, `Cloud` or `1:2,0` stay whole.
 */
const TRAILING_UNIT = /\s*(?:%|R|×|€|\$|[A-Z]{3,5})$/;

/** `"−222 USDT"` → `["−222", " USDT"]`, `"+1,47R"` → `["+1,47", "R"]`, `"–"` → `["–", ""]` (text joined = the input). */
export function splitUnit(text: string): [figure: string, unit: string] {
  const m = TRAILING_UNIT.exec(text);
  if (!m || !/\d/.test(text.slice(0, m.index))) return [text, ""];
  return [text.slice(0, m.index), m[0]];
}
