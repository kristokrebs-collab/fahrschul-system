/**
 * Relations in German strategy text ("unter", "über", "kreuzt nach oben", "fällt unter", "<", ">"): small, testable
 * helpers on the FOLDED text (see `normalize.ts`). A relation is a state (above / below) or an event (the line
 * crosses up / down); `levelPairs` reads every "relation + number" of a window ("über 30 und unter 70").
 */
import { parseNum } from "./normalize";

export type Rel = "above" | "below" | "crossUp" | "crossDown";

const X_RX = /\b(?:kreuz\w*|schneid\w*|durchbr\w*|ueberquer\w*|crossover|crosses|crossing|cross)\b/;
const FALL_RX = /\b(?:faellt|fallen|sinkt|sinken|rutscht|rutschen|sackt|stuerzt|taucht|unterschreit\w*|unterbiet\w*)\b/;
const RISE_RX = /\b(?:steigt|steigen|springt|klettert|schiesst|ueberschreit\w*|ueberwind\w*|ueberspring\w*|ueberbiet\w*)\b/;
const UP_RX = /nach oben|von unten|aufwaerts|bullish|bullisch|golden/;
const DOWN_RX = /nach unten|von oben|abwaerts|bearish|baerisch|todes|death/;
const ABOVE_RX = /(?:\b(?:ueber|oberhalb|darueber|drueber|groesser|hoeher|mehr als)\b|>=?)/;
const BELOW_RX = /(?:\b(?:unter|unterhalb|darunter|drunter|kleiner|niedriger|tiefer|weniger als)\b|<=?)/;
/** A verb right after the number that turns "unter 30" into an event: "unter 30 fällt". */
const TAIL_FALL_RX = /^\s*(?:wieder\s+)?(?:faellt|sinkt|rutscht|sackt|stuerzt|taucht|geht)\b/;
const TAIL_RISE_RX = /^\s*(?:wieder\s+)?(?:steigt|springt|klettert|schiesst)\b/;

/** "x" = a crossing whose direction the text does not give. */
export type RelRead = Rel | "x" | null;

/**
 * The relation `lead` (the words before the thing it relates to) expresses; `tail` is the text right after it, used for
 * the direction of a crossing and for a trailing verb ("unter 30 fällt"). `null` = no relation word at all.
 */
export function classifyRel(lead: string, tail = ""): RelRead {
  const hasX = X_RX.test(lead);
  const fall = FALL_RX.test(lead);
  const rise = RISE_RX.test(lead);
  const above = ABOVE_RX.test(lead);
  const below = BELOW_RX.test(lead);
  const near = tail.slice(0, 24);
  if (hasX) {
    const up = UP_RX.test(lead) || UP_RX.test(near);
    const down = DOWN_RX.test(lead) || DOWN_RX.test(near);
    if (up && !down) return "crossUp";
    if (down && !up) return "crossDown";
    if (above && !below) return "crossUp";
    if (below && !above) return "crossDown";
    return "x";
  }
  if (fall && !rise) return "crossDown";
  if (rise && !fall) return "crossUp";
  // "über EMA 200 kreuzt": a crossing verb right behind the thing makes the state an event in the direction named before it
  const tailX = /^\s*(?:wieder\s+)?(?:kreuzt|kreuzen|schneidet|durchbricht)\b/.test(tail);
  if (above && !below) return TAIL_FALL_RX.test(tail) ? "crossDown" : TAIL_RISE_RX.test(tail) || tailX ? "crossUp" : "above";
  if (below && !above) return TAIL_FALL_RX.test(tail) || tailX ? "crossDown" : TAIL_RISE_RX.test(tail) ? "crossUp" : "below";
  return null;
}

/** Does the text contain any relation word? */
export const hasRel = (t: string): boolean => X_RX.test(t) || FALL_RX.test(t) || RISE_RX.test(t) || ABOVE_RX.test(t) || BELOW_RX.test(t);

const NEG_RX = /\b(?:nicht|kein|keine|keinen|keiner|ohne|nie|niemals|weder)\b/;
/** Is the thing starting at `pos` negated by a "nicht / kein / ohne" within the last three words before it? */
export function negatedAt(text: string, pos: number): boolean {
  const head = text.slice(Math.max(0, pos - 28), pos);
  const words = head.split(/[\s,]+/).filter(Boolean).slice(-3);
  return words.some((w) => NEG_RX.test(w));
}

export interface LevelPair {
  rel: Rel;
  level: number;
  /** span inside the text given to `levelPairs` */
  a: number;
  b: number;
  /** how it joins the pair before it ("und" unless the words between say "oder") */
  or: boolean;
  neg: boolean;
}

const NUM = String.raw`-?\d+(?:[.,]\d+)?`;
const REL_WORD_RX = /(?:\b(?:ueber|oberhalb|darueber|drueber|groesser|hoeher|mehr als|unter|unterhalb|darunter|drunter|kleiner|niedriger|tiefer|weniger als|kreuz\w*|schneid\w*|durchbr\w*|faellt|fallen|sinkt|sinken|rutscht|steigt|steigen|springt|klettert|unterschreit\w*|ueberschreit\w*)\b|[<>])/;

/**
 * Every "relation + number" in `text`: "unter 30", "kreuzt 50 nach oben", "fällt unter 30", "über 30 und unter 70".
 * "zwischen 30 und 70" is two pairs (above 30, below 70). A number without a relation is not a pair.
 */
export function levelPairs(text: string, parse: (raw: string) => number = parseNum, thousands = false): LevelPair[] {
  const out: LevelPair[] = [];
  const between = new RegExp(String.raw`zwischen\s+(${NUM})\s*(?:und|bis|-)\s*(${NUM})`).exec(text);
  const numRx = new RegExp(thousands ? String.raw`-?(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)` : NUM, "g");
  const nums: { v: number; a: number; b: number }[] = [];
  for (let m = numRx.exec(text); m; m = numRx.exec(text)) {
    // a minus sign glued to the previous word ("EMA-200") is a hyphen, not a sign
    let a = m.index;
    let s = m[0];
    if (s.startsWith("-") && a > 0 && /[a-z0-9)]/.test(text[a - 1]!)) {
      a++;
      s = s.slice(1);
    }
    nums.push({ v: parse(s), a, b: m.index + m[0].length });
  }
  if (between) {
    const lo = parseNum(between[1]!);
    const hi = parseNum(between[2]!);
    const a = between.index;
    const b = between.index + between[0].length;
    const neg = negatedAt(text, a);
    out.push({ rel: "above", level: Math.min(lo, hi), a, b, or: false, neg });
    out.push({ rel: "below", level: Math.max(lo, hi), a, b, or: false, neg });
    return out;
  }
  let prevEnd = 0;
  for (const n of nums) {
    const lead = text.slice(prevEnd, n.a);
    // only the words right before the number belong to it (after an "und" / "," a new relation starts)
    const cut = Math.max(lead.lastIndexOf(" und "), lead.lastIndexOf(" oder "), lead.lastIndexOf(","), lead.lastIndexOf(";"));
    const own = cut >= 0 ? lead.slice(cut + 1) : lead;
    const ownStart = prevEnd + (cut >= 0 ? cut + 1 : 0);
    const tail = text.slice(n.b);
    const rel = classifyRel(own, tail);
    prevEnd = n.b;
    if (rel === null || rel === "x") continue;
    const verb = /^\s*(?:wieder\s+)?(?:faellt|sinkt|rutscht|sackt|stuerzt|taucht|geht|steigt|springt|klettert|schiesst)\b/.exec(tail);
    const first = own.search(REL_WORD_RX);
    const relStart = ownStart + (first >= 0 ? first : own.search(/\S|$/));
    const gap = out.length ? text.slice(out[out.length - 1]!.b, relStart) : "";
    out.push({ rel, level: n.v, a: relStart, b: n.b + (verb ? verb[0].length : 0), or: /\boder\b/.test(gap) || /\boder\b/.test(lead), neg: negatedAt(text, relStart) });
  }
  return out;
}

/** "innerhalb der letzten 3 Kerzen", "in den letzten 5 Kerzen", "vor höchstens 2 Kerzen": the window in candles, or null. */
export function withinOf(text: string): { n: number; a: number; b: number } | null {
  const m = /\b(?:innerhalb|binnen|in|seit|vor)\s+(?:den\s+|der\s+|dem\s+)?(?:letzten\s+|vergangenen\s+|hoechstens\s+|maximal\s+|max\.?\s*)*(\d+)\s*(?:kerzen|bars|candles|kerze)\b/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 ? { n, a: m.index, b: m.index + m[0].length } : null;
}
