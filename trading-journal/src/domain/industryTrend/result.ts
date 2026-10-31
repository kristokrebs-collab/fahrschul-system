/**
 * The result file of a lab run (`megatest.json`, written by `megatest.py`): read, checked and judged here. The file is picked by
 * the user and never leaves the device. Nothing is trusted – every field is checked for type and size, a file that does not look
 * like a lab result is refused with the first thing that is wrong, and a verdict that contradicts the checks inside the file is
 * said so (the checks win, because they are the numbers; the word is only a summary).
 *
 * Pure.
 */

export const MAX_RESULT_BYTES = 4 * 1024 * 1024;

export interface Kennzahlen {
  sharpe: number;
  cagr: number;
  maxdd: number;
  vol: number;
}
export interface Segmente {
  entw: Kennzahlen;
  valid: Kennzahlen;
  endtest: Kennzahlen;
  devval: Kennzahlen;
  gesamt: Kennzahlen;
}
export interface ResultParams {
  up: number;
  down: number;
  kelt: number;
  ziel_vola: number;
  max_hebel: number;
}
export interface ResultCheck {
  name: string;
  ok: boolean;
  wert: string;
}
export interface MonteCarlo {
  pfade: number;
  horizont_tage: number;
  block: number;
  p_verlust: number;
  median: number;
  p05: number;
  p95: number;
  dd_median: number;
  dd_p95: number;
  anteil_gruen: number;
  /** percentile bands per point in time, keys "5" "25" "50" "75" "95" */
  baender: Record<"5" | "25" | "50" | "75" | "95", number[]>;
  zeige_gruen: number[][];
  zeige_rot: number[][];
}
export interface Kurve {
  kandidatin: number[];
  basis: number[];
  markt: number[];
  datum: string[];
  i1: number;
  i2: number;
}
export interface TopZeile {
  parameter: ResultParams;
  devval: number;
  endtest: number;
}

export interface MegatestResult {
  erstellt: string;
  daten_von: string;
  daten_bis: string;
  branchen: number;
  kosten_bp: number;
  laufzeit_s: number | null;
  n_varianten: number;
  schnitt: { entw_bis: string; valid_bis: string };
  basis: { parameter: ResultParams; kennzahlen: Segmente };
  kandidatin: { id: string; parameter: ResultParams; kennzahlen: Segmente; kosten10bp_endtest: Kennzahlen };
  markt: { endtest: Kennzahlen; gesamt: Kennzahlen };
  checks: ResultCheck[];
  entscheidung: "VERWORFEN" | "UEBERNOMMEN";
  rang_korrelation: number;
  anteil_endtest_besser_als_basis: number;
  top: TopZeile[];
  streu: [number, number][];
  hist_devval: number[];
  hist_endtest: number[];
  kurve: Kurve | null;
  monte_carlo: MonteCarlo;
  hinweis: string;
}

export type ParseOutcome = { ok: true; result: MegatestResult } | { ok: false; reason: string };

class Bad extends Error {}
const bad = (path: string, what: string): never => {
  throw new Bad(`${path}: ${what}`);
};

const obj = (v: unknown, path: string): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : bad(path, "fehlt oder ist kein Objekt"));
const num = (v: unknown, path: string): number => (typeof v === "number" && Number.isFinite(v) ? v : bad(path, "fehlt oder ist keine Zahl"));
const str = (v: unknown, path: string, max = 300): string => (typeof v === "string" && v.length <= max ? v : bad(path, "fehlt oder ist kein (kurzer) Text"));
const day = (v: unknown, path: string): string => {
  const s = str(v, path, 8);
  return /^\d{8}$/.test(s) ? s : bad(path, "ist kein Datum (JJJJMMTT)");
};
const arr = (v: unknown, path: string, max: number): unknown[] => (Array.isArray(v) && v.length <= max ? v : bad(path, `fehlt, ist keine Liste oder hat mehr als ${max} Einträge`));
const nums = (v: unknown, path: string, max: number, min = 1): number[] => {
  const a = arr(v, path, max);
  if (a.length < min) bad(path, `braucht mindestens ${min} Werte`);
  return a.map((x, i) => num(x, `${path}[${i}]`));
};

const kennzahlen = (v: unknown, path: string): Kennzahlen => {
  const o = obj(v, path);
  return { sharpe: num(o.sharpe, `${path}.sharpe`), cagr: num(o.cagr, `${path}.cagr`), maxdd: num(o.maxdd, `${path}.maxdd`), vol: num(o.vol, `${path}.vol`) };
};
const segmente = (v: unknown, path: string): Segmente => {
  const o = obj(v, path);
  return { entw: kennzahlen(o.entw, `${path}.entw`), valid: kennzahlen(o.valid, `${path}.valid`), endtest: kennzahlen(o.endtest, `${path}.endtest`), devval: kennzahlen(o.devval, `${path}.devval`), gesamt: kennzahlen(o.gesamt, `${path}.gesamt`) };
};
const params = (v: unknown, path: string): ResultParams => {
  const o = obj(v, path);
  return { up: num(o.up, `${path}.up`), down: num(o.down, `${path}.down`), kelt: num(o.kelt, `${path}.kelt`), ziel_vola: num(o.ziel_vola, `${path}.ziel_vola`), max_hebel: num(o.max_hebel, `${path}.max_hebel`) };
};

const PATHS_MAX = 400;
const POINTS_MAX = 400;
const BANDS = ["5", "25", "50", "75", "95"] as const;

function monteCarlo(v: unknown): MonteCarlo {
  const o = obj(v, "monte_carlo");
  const b = obj(o.baender, "monte_carlo.baender");
  const bands = {} as MonteCarlo["baender"];
  let n = -1;
  for (const k of BANDS) {
    bands[k] = nums(b[k], `monte_carlo.baender.${k}`, POINTS_MAX, 2);
    if (n < 0) n = bands[k].length;
    else if (bands[k].length !== n) bad(`monte_carlo.baender.${k}`, "hat eine andere Länge als die übrigen Bänder");
  }
  const paths = (x: unknown, path: string): number[][] =>
    arr(x, path, PATHS_MAX).map((p, i) => {
      const row = nums(p, `${path}[${i}]`, POINTS_MAX, 2);
      return row;
    });
  return {
    pfade: num(o.pfade, "monte_carlo.pfade"),
    horizont_tage: num(o.horizont_tage, "monte_carlo.horizont_tage"),
    block: num(o.block, "monte_carlo.block"),
    p_verlust: num(o.p_verlust, "monte_carlo.p_verlust"),
    median: num(o.median, "monte_carlo.median"),
    p05: num(o.p05, "monte_carlo.p05"),
    p95: num(o.p95, "monte_carlo.p95"),
    dd_median: num(o.dd_median, "monte_carlo.dd_median"),
    dd_p95: num(o.dd_p95, "monte_carlo.dd_p95"),
    anteil_gruen: num(o.anteil_gruen, "monte_carlo.anteil_gruen"),
    baender: bands,
    zeige_gruen: paths(o.zeige_gruen, "monte_carlo.zeige_gruen"),
    zeige_rot: paths(o.zeige_rot, "monte_carlo.zeige_rot"),
  };
}

function kurve(v: unknown): Kurve | null {
  if (v === undefined || v === null) return null;
  const o = obj(v, "kurve");
  const k = nums(o.kandidatin, "kurve.kandidatin", 2000, 2);
  const b = nums(o.basis, "kurve.basis", 2000, 2);
  const m = nums(o.markt, "kurve.markt", 2000, 2);
  const d = arr(o.datum, "kurve.datum", 2000).map((x, i) => day(x, `kurve.datum[${i}]`));
  if (k.length !== b.length || k.length !== m.length || k.length !== d.length) bad("kurve", "die Reihen sind verschieden lang");
  return { kandidatin: k, basis: b, markt: m, datum: d, i1: num(o.i1, "kurve.i1"), i2: num(o.i2, "kurve.i2") };
}

/** A parsed lab result from text, or the first reason it is not one. Size is checked on the text, shape field by field. */
export function parseMegatest(text: string, maxBytes: number = MAX_RESULT_BYTES): ParseOutcome {
  if (text.length > maxBytes) return { ok: false, reason: `Die Datei ist größer als ${Math.round(maxBytes / 1024 / 1024)} MB und wird nicht gelesen.` };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "Das ist keine gültige JSON-Datei." };
  }
  try {
    const o = obj(raw, "Datei");
    const ent = str(o.entscheidung, "entscheidung", 20);
    if (ent !== "VERWORFEN" && ent !== "UEBERNOMMEN") bad("entscheidung", "muss VERWORFEN oder UEBERNOMMEN sein");
    const checks = arr(o.checks, "checks", 20).map((c, i) => {
      const co = obj(c, `checks[${i}]`);
      if (typeof co.ok !== "boolean") bad(`checks[${i}].ok`, "fehlt oder ist kein Wahr/Falsch");
      return { name: str(co.name, `checks[${i}].name`), ok: co.ok as boolean, wert: str(co.wert, `checks[${i}].wert`, 200) };
    });
    if (!checks.length) bad("checks", "ist leer – ohne Prüfungen gibt es kein Urteil");
    const schnitt = obj(o.schnitt, "schnitt");
    const basis = obj(o.basis, "basis");
    const kand = obj(o.kandidatin, "kandidatin");
    const markt = obj(o.markt, "markt");
    const streu = arr(o.streu, "streu", 5000).map((p, i) => {
      const a = arr(p, `streu[${i}]`, 2);
      if (a.length !== 2) bad(`streu[${i}]`, "braucht zwei Werte");
      return [num(a[0], `streu[${i}][0]`), num(a[1], `streu[${i}][1]`)] as [number, number];
    });
    const top = arr(o.top, "top", 100).map((t, i) => {
      const to = obj(t, `top[${i}]`);
      return { parameter: params(to.parameter, `top[${i}].parameter`), devval: num(to.devval, `top[${i}].devval`), endtest: num(to.endtest, `top[${i}].endtest`) };
    });
    const result: MegatestResult = {
      erstellt: str(o.erstellt, "erstellt", 40),
      daten_von: day(o.daten_von, "daten_von"),
      daten_bis: day(o.daten_bis, "daten_bis"),
      branchen: num(o.branchen, "branchen"),
      kosten_bp: num(o.kosten_bp, "kosten_bp"),
      laufzeit_s: typeof o.laufzeit_s === "number" && Number.isFinite(o.laufzeit_s) ? o.laufzeit_s : null,
      n_varianten: num(o.n_varianten, "n_varianten"),
      schnitt: { entw_bis: day(schnitt.entw_bis, "schnitt.entw_bis"), valid_bis: day(schnitt.valid_bis, "schnitt.valid_bis") },
      basis: { parameter: params(basis.parameter, "basis.parameter"), kennzahlen: segmente(basis.kennzahlen, "basis.kennzahlen") },
      kandidatin: { id: str(kand.id, "kandidatin.id", 60), parameter: params(kand.parameter, "kandidatin.parameter"), kennzahlen: segmente(kand.kennzahlen, "kandidatin.kennzahlen"), kosten10bp_endtest: kennzahlen(kand.kosten10bp_endtest, "kandidatin.kosten10bp_endtest") },
      markt: { endtest: kennzahlen(markt.endtest, "markt.endtest"), gesamt: kennzahlen(markt.gesamt, "markt.gesamt") },
      checks,
      entscheidung: ent as MegatestResult["entscheidung"],
      rang_korrelation: num(o.rang_korrelation, "rang_korrelation"),
      anteil_endtest_besser_als_basis: num(o.anteil_endtest_besser_als_basis, "anteil_endtest_besser_als_basis"),
      top,
      streu,
      hist_devval: nums(o.hist_devval, "hist_devval", 400, 2),
      hist_endtest: nums(o.hist_endtest, "hist_endtest", 400, 2),
      kurve: kurve(o.kurve),
      monte_carlo: monteCarlo(o.monte_carlo),
      hinweis: typeof o.hinweis === "string" ? o.hinweis.slice(0, 500) : "",
    };
    return { ok: true, result };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, reason: `Das ist kein Ergebnis eines Labor-Laufs (${e.message}).` };
    throw e;
  }
}

export interface Verdict {
  /** what the checks say */
  state: "verworfen" | "uebernommen";
  /** the word in the file agrees with its own checks */
  consistent: boolean;
  failed: ResultCheck[];
  passed: ResultCheck[];
}

/** The verdict from the checks: accepted only when every check passed. A file whose word says otherwise is marked inconsistent. */
export function verdictOf(r: Pick<MegatestResult, "checks" | "entscheidung">): Verdict {
  const failed = r.checks.filter((c) => !c.ok);
  const passed = r.checks.filter((c) => c.ok);
  const state = failed.length === 0 ? "uebernommen" : "verworfen";
  return { state, consistent: state === (r.entscheidung === "UEBERNOMMEN" ? "uebernommen" : "verworfen"), failed, passed };
}
