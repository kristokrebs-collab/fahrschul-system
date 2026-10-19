/**
 * Reader for the TradingView strategy tester export "List of trades" (F14) – CSV as TradingView writes it, in English or
 * German, with comma or semicolon (or tab) as separator and comma or point as decimal mark. Pure and tolerant:
 *
 * - Columns are found by their HEADER (any order, English / German names, with or without the currency in the name);
 *   unknown columns are ignored.
 * - TradingView writes two rows per trade (entry and exit, same trade number). They are paired; an exit row marked "Open"
 *   (or a trade without an exit row) is an OPEN trade and is left out of any comparison.
 * - A row that cannot be read is skipped and reported with its line number in the file (`errors`); the other rows are kept.
 * - Times carry no zone in the file: the caller says how far the chart's zone is from UTC (`utcOffsetMinutes`), UTC by default.
 *
 * Everything runs in the browser on the text the trader picked; nothing here touches a network.
 */

export interface TvTrade {
  /** trade number in the export */
  no: number;
  side: "long" | "short";
  /** ms UTC (after the offset), `null` when the cell was empty */
  entryTime: number | null;
  exitTime: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  /** contracts / quantity */
  qty: number | null;
  /** net profit of the trade in the strategy's currency */
  pnl: number | null;
  /** net profit in percent (as written, 1.5 = 1,5 %) */
  pnlPct: number | null;
  entrySignal: string;
  exitSignal: string;
  /** still open (exit row says "Open" or there is none): not comparable */
  open: boolean;
  /** line of the entry row in the file (1-based) */
  line: number;
}

export interface TvParseError {
  /** 1-based line in the file where the record starts */
  line: number;
  message: string;
}

export interface TvParseResult {
  trades: TvTrade[];
  errors: TvParseError[];
  /** more errors than listed */
  errorsCut: boolean;
  warnings: string[];
  /** currency named in the P&L column ("USDT"), if any */
  currency: string | null;
  delimiter: "," | ";" | "\t" | null;
  /** header language guess */
  language: "de" | "en" | "unknown";
  /** data records read (not counting the header) */
  rows: number;
}

export interface TvParseOptions {
  /** hours / minutes the chart's time zone is AHEAD of UTC (UTC+2 = 120); 0 = the file is in UTC */
  utcOffsetMinutes?: number;
}

const MAX_ERRORS = 40;

/* ------------------------------------------------------------------ csv */

/** Splits text into records (cells), honouring quotes and quoted line breaks; each record carries its start line. */
export function splitCsv(text: string, delimiter: string): Array<{ line: number; cells: string[] }> {
  const out: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  const endCell = () => {
    cells.push(cell);
    cell = "";
  };
  const endRecord = () => {
    endCell();
    if (cells.some((c) => c.trim() !== "")) out.push({ line: start, cells });
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      start = line;
    } else cell += ch;
  }
  endRecord(); // an unterminated quote simply ends with the text
  return out;
}

/** Picks the delimiter with the most occurrences in the first non-empty line (outside quotes). */
export function detectDelimiter(text: string): "," | ";" | "\t" | null {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== "");
  if (!first) return null;
  const count = (d: string): number => {
    let n = 0;
    let q = false;
    for (const ch of first) {
      if (ch === '"') q = !q;
      else if (!q && ch === d) n++;
    }
    return n;
  };
  const cands: Array<"," | ";" | "\t"> = [";", "\t", ","];
  let best: "," | ";" | "\t" | null = null;
  let bestN = 0;
  for (const d of cands) {
    const n = count(d);
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ cells */

const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\u00df/g, "ss")
    .replace(/[^a-z0-9%&]/g, "");

/**
 * A number as TradingView writes it in either locale. `decimal` says which mark a lone separator means when the text itself
 * cannot tell ("1,234": German 1,234 or English 1234). Returns `null` for empty / dash cells and `NaN` for unreadable text.
 */
export function parseNumber(raw: string, decimal: "comma" | "point"): number | null {
  let s = raw.replace(/[\s\u00a0\u202f]/g, "").replace(/[−–—]/g, "-").replace(/^\+/, "");
  if (s === "" || /^[-]+$/.test(s) || /^n\/?a$/i.test(s)) return null;
  s = s.replace(/%$/, "").replace(/^[A-Z$€£]{1,6}(?=[-+0-9(])/, "").replace(/(?<=[0-9)])[A-Z$€£]{1,6}$/, "");
  const neg = s.startsWith("-") || (s.startsWith("(") && s.endsWith(")"));
  s = s.replace(/^[-(]+/, "").replace(/\)$/, "");
  if (!/^[0-9.,]+$/.test(s)) return NaN;
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  let canon: string;
  if (dots && commas) {
    // the mark that comes last is the decimal one
    const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const grp = dec === "," ? "." : ",";
    canon = s.split(grp).join("").replace(dec, ".");
  } else if (commas || dots) {
    const mark = commas ? "," : ".";
    const n = commas || dots;
    const tail = s.length - s.lastIndexOf(mark) - 1;
    if (n > 1) canon = s.split(mark).join(""); // 1,234,567 – thousands
    else if (mark === "," && decimal === "comma") canon = s.replace(",", ".");
    else if (mark === "." && decimal === "point") canon = s;
    else canon = tail === 3 && !s.startsWith("0") ? s.replace(mark, "") : s.replace(",", "."); // lone mark against the file's habit: 3 digits after it = thousands
  } else canon = s;
  const v = Number(canon);
  return Number.isFinite(v) ? (neg ? -v : v) : NaN;
}

/** ms UTC of the wall-clock fields, `null` when the date does not exist. */
function utcOf(y: number, mo: number, d: number, h: number, mi: number, s: number): number | null {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h < 24 && mi >= 0 && mi < 60 && s >= 0 && s < 60)) return null;
  const t = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(t);
  return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null;
}

export interface TimeParse {
  ms: number | null;
  /** the text was a slash date with day and month both ≤ 12 */
  ambiguous?: boolean;
}

/** A date / time cell → ms UTC. Wall-clock fields are in the chart's zone (`offsetMin` ahead of UTC) unless the text names an offset. */
export function parseTvTime(raw: string, offsetMin: number): TimeParse {
  const s = raw.trim();
  if (!s) return { ms: null };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  if (m) {
    const wall = utcOf(+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
    if (wall == null) return { ms: NaN };
    const z = m[7];
    if (!z) return { ms: wall - offsetMin * 60_000 };
    if (/^z$/i.test(z)) return { ms: wall };
    const sign = z.startsWith("-") ? -1 : 1;
    const digits = z.replace(/[^0-9]/g, "");
    return { ms: wall - sign * (+digits.slice(0, 2) * 60 + +digits.slice(2, 4)) * 60_000 };
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) {
    const wall = utcOf(+m[3]!, +m[2]!, +m[1]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
    return { ms: wall == null ? NaN : wall - offsetMin * 60_000 };
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) {
    const a = +m[1]!;
    const b = +m[2]!;
    const dayFirst = a > 12;
    const ambiguous = a <= 12 && b <= 12 && a !== b;
    const wall = dayFirst ? utcOf(+m[3]!, b, a, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) : utcOf(+m[3]!, a, b, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
    return { ms: wall == null ? NaN : wall - offsetMin * 60_000, ambiguous };
  }
  return { ms: NaN };
}

/* ------------------------------------------------------------------ header */

type Field = "no" | "type" | "time" | "signal" | "price" | "qty" | "pnl" | "pnlPct";

interface Cols {
  idx: Partial<Record<Field, number>>;
  currency: string | null;
}

const CURRENCY = /(?:p&l|pnl|profit|gewinn|g&v)\s*([A-Za-z]{2,10})\s*$/i;

/** Finds the columns by header text. */
export function mapColumns(header: readonly string[]): Cols {
  const idx: Partial<Record<Field, number>> = {};
  let currency: string | null = null;
  const take = (f: Field, i: number) => {
    if (idx[f] === undefined) idx[f] = i;
  };
  let pnlNet: number | undefined;
  header.forEach((h, i) => {
    const n = norm(h);
    if (!n) return;
    const cum = n.includes("cum") || n.includes("kumul");
    const side = n.includes("excursion") || n.includes("runup") || n.includes("drawdown") || n.includes("favorable") || n.includes("adverse") || n.includes("abweichung") || n.includes("gunstig") || n.includes("ungunstig");
    if (n === "trade" || n.startsWith("tradenr") || n.startsWith("tradeno") || n === "nr" || n === "handel" || n.startsWith("handelnr") || n === "tradenumber") take("no", i);
    else if (n === "type" || n === "typ" || n === "art") take("type", i);
    else if (n === "signal") take("signal", i);
    else if ((n.includes("datetime") || n.includes("dateandtime") || n.startsWith("datum") || n.startsWith("date") || n.includes("uhrzeit")) && !n.includes("signal")) take("time", i);
    else if ((n.startsWith("price") || n.startsWith("preis")) && !n.includes("%")) take("price", i);
    else if ((n.includes("qty") || n.startsWith("contracts") || n.startsWith("kontrakte") || n.startsWith("quantity") || n.includes("menge") || n.startsWith("anzahl")) && !n.includes("value") && !n.includes("wert")) take("qty", i);
    else if ((n.includes("p&l") || n.includes("pnl") || n.startsWith("profit") || n.startsWith("gewinn") || n.includes("g&v") || n.includes("nettogewinn")) && !cum && !side) {
      if (n.includes("%")) take("pnlPct", i);
      else {
        take("pnl", i);
        if ((n.includes("net") || n.includes("netto")) && pnlNet === undefined) pnlNet = i;
        const c = CURRENCY.exec(h.trim());
        if (c && !currency) currency = c[1]!.toUpperCase();
      }
    }
  });
  if (pnlNet !== undefined) idx.pnl = pnlNet;
  return { idx, currency };
}

const FIELD_NAME: Record<Field, string> = { no: "Trade-Nummer", type: "Typ", time: "Datum/Uhrzeit", signal: "Signal", price: "Preis", qty: "Menge", pnl: "Gewinn", pnlPct: "Gewinn %" };

interface RowKind {
  entry: boolean;
  side: "long" | "short";
}

function kindOf(type: string): RowKind | null {
  const n = norm(type);
  const entry = /^(entry|einstieg|eintritt|open)/.test(n);
  const exit = /^(exit|ausstieg|austritt|close|schliess|ausgang)/.test(n);
  const side = n.includes("long") ? "long" : n.includes("short") ? "short" : null;
  if ((!entry && !exit) || !side) return null;
  return { entry, side };
}

/* ------------------------------------------------------------------ main */

export function parseTvTrades(text: string, opts: TvParseOptions = {}): TvParseResult {
  const offset = opts.utcOffsetMinutes ?? 0;
  const out: TvParseResult = { trades: [], errors: [], errorsCut: false, warnings: [], currency: null, delimiter: null, language: "unknown", rows: 0 };
  const body = text.replace(/^﻿/, "");
  const err = (line: number, message: string) => {
    if (out.errors.length < MAX_ERRORS) out.errors.push({ line, message });
    else out.errorsCut = true;
  };
  const delimiter = detectDelimiter(body);
  if (!body.trim() || !delimiter) {
    err(1, "Die Datei ist leer oder hat keine Spalten. Erwartet wird die CSV „List of trades“ aus dem TradingView-Strategietester.");
    return out;
  }
  out.delimiter = delimiter;
  const recs = splitCsv(body, delimiter);
  const head = recs[0]!;
  const cols = mapColumns(head.cells);
  out.currency = cols.currency;
  const nh = head.cells.map(norm);
  out.language = nh.some((h) => h === "typ" || h.startsWith("datum") || h.startsWith("kontrakte") || h.startsWith("preis") || h.startsWith("gewinn")) ? "de" : nh.some((h) => h === "type" || h.startsWith("date") || h.startsWith("price") || h.includes("p&l") || h.startsWith("profit") || h.startsWith("contracts")) ? "en" : "unknown";
  const missing = (["no", "type", "time", "price"] as const).filter((f) => cols.idx[f] === undefined);
  if (missing.length) {
    err(head.line, `In der Kopfzeile fehlt: ${missing.map((f) => FIELD_NAME[f]).join(", ")}. Gelesene Spalten: ${head.cells.map((c) => c.trim()).filter(Boolean).join(", ") || "keine"}.`);
    return out;
  }
  if (cols.idx.pnl === undefined) out.warnings.push("Keine Gewinn-Spalte gefunden: der Vergleich des Nettoergebnisses entfällt, die Trades selbst werden verglichen.");
  const decimal: "comma" | "point" = delimiter === ";" || out.language === "de" ? "comma" : "point";
  const cell = (r: { cells: string[] }, f: Field): string => (cols.idx[f] === undefined ? "" : (r.cells[cols.idx[f]!] ?? "").trim());

  interface Half {
    line: number;
    time: number | null;
    price: number | null;
    signal: string;
    qty: number | null;
    pnl: number | null;
    pnlPct: number | null;
    side: "long" | "short";
  }
  const groups = new Map<number, { entry?: Half; exit?: Half; order: number }>();
  let ambiguousDates = 0;
  const num = (r: { line: number; cells: string[] }, f: Field, errors: string[]): number | null => {
    const raw = cell(r, f);
    const v = parseNumber(raw, decimal);
    if (v !== null && Number.isNaN(v)) {
      errors.push(`${FIELD_NAME[f]} „${raw}“ ist keine Zahl.`);
      return null;
    }
    return v;
  };

  for (const r of recs.slice(1)) {
    out.rows++;
    const problems: string[] = [];
    const noRaw = cell(r, "no");
    const no = parseNumber(noRaw, "point");
    if (no === null || Number.isNaN(no) || !Number.isInteger(no) || no < 0) problems.push(`Trade-Nummer „${noRaw}“ ist keine ganze Zahl.`);
    const kind = kindOf(cell(r, "type"));
    if (!kind) problems.push(`Typ „${cell(r, "type")}“ nicht erkannt (erwartet: Entry/Exit oder Einstieg/Ausstieg, dazu Long/Short).`);
    const t = parseTvTime(cell(r, "time"), offset);
    if (t.ms !== null && Number.isNaN(t.ms)) problems.push(`Datum „${cell(r, "time")}“ nicht lesbar (erwartet z. B. 2025-03-04 14:00 oder 04.03.2025 14:00).`);
    if (t.ambiguous) ambiguousDates++;
    const price = num(r, "price", problems);
    const qty = num(r, "qty", problems);
    const pnl = num(r, "pnl", problems);
    const pnlPct = num(r, "pnlPct", problems);
    if (problems.length || !kind || no === null || Number.isNaN(no)) {
      err(r.line, problems.join(" "));
      continue;
    }
    const half: Half = { line: r.line, time: t.ms !== null && !Number.isNaN(t.ms) ? t.ms : null, price, signal: cell(r, "signal"), qty, pnl, pnlPct, side: kind.side };
    if (kind.entry && (t.ms === null || price === null)) {
      err(r.line, "Einstiegszeile ohne Datum oder Preis.");
      continue;
    }
    const g = groups.get(no) ?? { order: groups.size };
    const slot = kind.entry ? "entry" : "exit";
    if (g[slot]) {
      err(r.line, `Trade ${no} hat zwei ${kind.entry ? "Einstiegs" : "Ausstiegs"}zeilen (die erste steht in Zeile ${g[slot]!.line}).`);
      continue;
    }
    g[slot] = half;
    groups.set(no, g);
  }
  if (ambiguousDates) out.warnings.push(`${ambiguousDates} Datum${ambiguousDates === 1 ? "" : "s"}angaben mit „/“ sind mehrdeutig; gelesen wurde Monat/Tag/Jahr.`);

  for (const [no, g] of [...groups.entries()].sort((a, b) => a[1].order - b[1].order)) {
    const { entry, exit } = g;
    if (!entry) {
      err(exit!.line, `Trade ${no}: Ausstiegszeile ohne Einstiegszeile.`);
      continue;
    }
    if (exit && exit.side !== entry.side) {
      err(exit.line, `Trade ${no}: Einstieg ist ${entry.side === "long" ? "Long" : "Short"}, Ausstieg ${exit.side === "long" ? "Long" : "Short"}.`);
      continue;
    }
    const open = !exit || /^(open|offen)$/i.test(exit.signal.trim());
    out.trades.push({
      no,
      side: entry.side,
      entryTime: entry.time,
      exitTime: exit?.time ?? null,
      entryPrice: entry.price,
      exitPrice: exit?.price ?? null,
      qty: entry.qty ?? exit?.qty ?? null,
      pnl: exit?.pnl ?? entry.pnl,
      pnlPct: exit?.pnlPct ?? entry.pnlPct,
      entrySignal: entry.signal,
      exitSignal: exit?.signal ?? "",
      open,
      line: entry.line,
    });
    if (!exit) out.warnings.push(`Trade ${no} hat keine Ausstiegszeile und gilt als offen.`);
  }
  out.trades.sort((a, b) => (a.entryTime ?? 0) - (b.entryTime ?? 0) || a.no - b.no);
  if (!out.trades.length && !out.errors.length) out.errors.push({ line: head.line, message: "Die Datei enthält keine Trades." });
  return out;
}
