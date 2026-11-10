/**
 * Text normalisation for the strategy parser: lower case, umlauts and typographic characters folded to plain ASCII
 * ("über" → "ueber", "–" → "-", "≥" → ">="), white space collapsed, a few number words written as digits ("zwei" → "2",
 * "anderthalb" → "1,5"). Every folded character remembers the span of the ORIGINAL text it came from, so a match in the
 * folded text can be shown to the trader as his own words.
 */

export interface Folded {
  /** the folded text */
  s: string;
  /** `s[i]` came from `original.slice(from[i], to[i])` */
  from: number[];
  to: number[];
}

const MAP: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
  é: "e",
  è: "e",
  ê: "e",
  á: "a",
  à: "a",
  â: "a",
  ó: "o",
  ò: "o",
  í: "i",
  ú: "u",
  ç: "c",
  "–": "-",
  "—": "-",
  "‑": "-",
  "−": "-",
  "’": "'",
  "‘": "'",
  "´": "'",
  "`": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "«": '"',
  "»": '"',
  "×": "x",
  "≥": ">=",
  "≤": "<=",
  "≈": "~",
  "→": "->",
  "％": "%",
  "：": ":",
  "，": ",",
  " ": " ",
  "\t": " ",
  "\r": " ",
  "​": "",
  "‌": "",
  "‍": "",
  "﻿": "",
};

/** Lower-cases and folds `text`; runs of blanks become one blank, line breaks stay (they end a sentence). */
export function fold(text: string): Folded {
  let s = "";
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const ch of text) {
    const lower = ch.toLowerCase();
    const rep = MAP[lower] ?? lower;
    const a = i;
    const b = i + ch.length;
    i = b;
    for (const c of rep) {
      if (c === " " && s.endsWith(" ")) {
        to[to.length - 1] = b;
        continue;
      }
      s += c;
      from.push(a);
      to.push(b);
    }
  }
  return { s, from, to };
}

/** Replaces every match of `re` (global) by `fn(match)`; the replacement maps back to the span of the whole match. */
export function replaceFolded(f: Folded, re: RegExp, fn: (m: RegExpExecArray) => string): Folded {
  let s = "";
  const from: number[] = [];
  const to: number[] = [];
  let last = 0;
  const push = (a: number, b: number): void => {
    for (let k = a; k < b; k++) {
      s += f.s[k]!;
      from.push(f.from[k]!);
      to.push(f.to[k]!);
    }
  };
  re.lastIndex = 0;
  for (let m = re.exec(f.s); m; m = re.exec(f.s)) {
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }
    push(last, m.index);
    const rep = fn(m);
    const a = f.from[m.index]!;
    const b = f.to[m.index + m[0].length - 1]!;
    for (const c of rep) {
      s += c;
      from.push(a);
      to.push(b);
    }
    last = m.index + m[0].length;
  }
  push(last, f.s.length);
  return { s, from, to };
}

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  null: "0",
  zwei: "2",
  drei: "3",
  vier: "4",
  fuenf: "5",
  sechs: "6",
  sieben: "7",
  acht: "8",
  neun: "9",
  zehn: "10",
  elf: "11",
  zwoelf: "12",
  fuenfzehn: "15",
  zwanzig: "20",
  dreissig: "30",
  vierzig: "40",
  fuenfzig: "50",
  sechzig: "60",
  siebzig: "70",
  achtzig: "80",
  hundert: "100",
  einhundert: "100",
  zweihundert: "200",
  anderthalb: "1,5",
  eineinhalb: "1,5",
  einenhalb: "1,5",
};
const NUMBER_WORD_RX = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`, "g");
/** "ein / eine" only counts as the number 1 in front of a unit ("ein Prozent", "eine Kerze"), never as an article. */
const ONE_RX = /\b(?:ein|eine|einen)\b(?= (?:r|atr|prozent|kerze|kerzen|stunde|stunden|tag|tage|tagen|jahr|jahre|jahren|monat|monate|monaten|woche|wochen)\b)/g;

/** The folded text with number words written as digits. */
export function foldWithNumbers(text: string): Folded {
  let f = fold(text);
  f = replaceFolded(f, NUMBER_WORD_RX, (m) => NUMBER_WORDS[m[1]!]!);
  f = replaceFolded(f, ONE_RX, () => "1");
  return f;
}

/** Original span of the folded range `[a, b)`. */
export function originalSpan(f: Folded, a: number, b: number): { start: number; end: number } {
  const start = f.from[Math.max(0, Math.min(a, f.s.length - 1))] ?? 0;
  const end = f.to[Math.max(0, Math.min(b - 1, f.s.length - 1))] ?? start;
  return { start, end: Math.max(start, end) };
}

/** A decimal number as typed in German or English: "1,5", "1.5", "30". */
export function parseNum(raw: string): number {
  return Number(raw.replace(",", "."));
}

/** A price: "65.000" and "65.000,5" use the point as the thousands separator, "65000" and "0.5" do not. */
export function parseLevel(raw: string): number {
  if (/^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?$/.test(raw)) return Number(raw.replace(/\./g, "").replace(",", "."));
  return parseNum(raw);
}
