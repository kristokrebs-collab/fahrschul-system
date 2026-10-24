/**
 * Conditions of a strategy text: the lab's indicator blocks found by their NAME (RSI, EMA / SMA, MACD, Bollinger, ATR,
 * volume, breakout, Stochastic, ADX, Supertrend, VWAP …), each read together with the words around it – the relation
 * ("unter", "kreuzt nach oben", "fällt unter"), the numbers, the window ("innerhalb der letzten 3 Kerzen"), a negation.
 *
 * A name is an ANCHOR; the text from the anchor to the next anchor is its window. The price ("Kurs") is an anchor of its
 * own, because "Kurs über EMA 200" relates the price to a moving average while "EMA 21 kreuzt EMA 55" relates two
 * averages. What a window does not hold is never guessed: it becomes an unclear part, a question or a visible assumption.
 */
import { Ctx, de, type Item, type SpecGroup, type SpecLeaf, type SpecNode } from "./ctx";
import { parseLevel, parseNum } from "./normalize";
import { classifyRel, hasRel, levelPairs, negatedAt, withinOf, type LevelPair, type Rel } from "./rel";
import type { TfId } from "../lab/rules/types";

type Kind = "price" | "rsi" | "ma" | "macd" | "boll" | "atr" | "vol" | "stoch" | "adx" | "supertrend" | "vwap" | "cci" | "willr" | "donchian" | "breakout" | "inside" | "heikin" | "golden" | "volatility";

interface Anchor {
  kind: Kind;
  a: number;
  b: number;
  m: RegExpExecArray;
  /** the moving average / indicator length, when the name carries it ("EMA 200", "RSI(14)") */
  len?: number;
  type?: "ema" | "sma" | "ma";
  /** a daily average ("200-Tage-Linie") */
  daily?: boolean;
}

const DEFS: readonly { kind: Kind; rx: RegExp; read?: (m: RegExpExecArray, an: Anchor) => void }[] = [
  {
    kind: "golden",
    rx: /\b(?:golden\w*\s+(?:kreuz\w*|cross)|todes\s*kreuz\w*|death\s+cross|golden\s*cross)\b/,
  },
  {
    kind: "rsi",
    rx: /\b(?:(\d+)er[- ]?)?rsi\b(?:\s*\(\s*(\d+)\s*\)|[- ](\d+)(?=\s*(?:ueber|unter|oberhalb|unterhalb|kreuz\w*|faellt|steigt|<|>|=|ist|liegt)))?|\brelative\s+(?:strength|staerke)(?:\s+index)?\b/,
    read: (m, an) => {
      const n = m[1] ?? m[2] ?? m[3];
      if (n) an.len = Number(n);
    },
  },
  {
    kind: "ma",
    rx: /\b(?:(\d+)[- ]?er[- ]?|(\d+)[- ]?)(ema|sma|ma)\b|\b(ema|sma|wma|ma)\s*[-(]?\s*(\d+)\s*\)?(?![\d,.]*\s*(?:%|prozent|atr))|\b(ema|sma|wma)\b|\b(\d+)er[- ]?(?:durchschnitt\w*|linie)\b|\b(\d+)[- ]?tage[- ]?(?:linie|durchschnitt\w*)\b|\bgleitende[rnms]?\s+durchschnitt\w*(?:\s+(\d+))?|\bmoving\s+average(?:\s+(\d+))?\b/,
    read: (m, an) => {
      const type = (m[3] ?? m[4] ?? m[6] ?? "ma").toLowerCase();
      an.type = type === "ema" ? "ema" : type === "sma" || type === "wma" ? "sma" : "ma";
      const n = m[1] ?? m[2] ?? m[5] ?? m[7] ?? m[8] ?? m[9] ?? m[10];
      if (n) an.len = Number(n);
      if (m[8]) an.daily = true;
    },
  },
  {
    kind: "macd",
    rx: /\bmacd\b(?:\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\))?/,
  },
  { kind: "boll", rx: /\bbollinger\w*(?:[- ]?(?:baender|bands?|band))?(?:\s*\(\s*(\d+)\s*,\s*(\d+(?:[.,]\d+)?)\s*\))?|\bbb\b/ },
  { kind: "atr", rx: /\batr\b(?:\s*\(\s*(\d+)\s*\))?/ },
  { kind: "volatility", rx: /\bvolatilitaet\w*|\bschwankung\w*/ },
  { kind: "vol", rx: /\b(?:volumen\w*|volume\b|handelsvolumen)/ },
  { kind: "stoch", rx: /\bstochastic\w*|\bstochastik\b|\bstoch\b/ },
  { kind: "adx", rx: /\badx\b|\bdmi\b|\btrendstaerke\b/ },
  { kind: "supertrend", rx: /\bsupertrend\b/ },
  { kind: "vwap", rx: /\bvwap\b/ },
  { kind: "cci", rx: /\bcci\b/ },
  { kind: "willr", rx: /\bwilliams\s*-?\s*%?\s*r\b|\bwpr\b/ },
  { kind: "donchian", rx: /\bdonchian\w*(?:\s*(?:\(\s*(\d+)\s*\)|[- ](\d+)\b))?/ },
  {
    kind: "breakout",
    rx: /\b(?:ausbruch|ausbrueche\w*|breakout|ausbrechen|bricht\s+aus|ausbrechend\w*)\b|\b(?:neues?\s+)?(\d+)[- ]?(?:kerzen|tage|tages|bars|wochen)[- ]?(hoch|tief)\b|\b(hoch|tief)\s+der\s+(?:letzten|vorherigen)\s+(\d+)\s*(?:kerzen|tage\w*|bars)/,
  },
  { kind: "inside", rx: /\binside[- ]?bar\w*|\binnenkerze\w*|\binnenstab\w*/ },
  { kind: "heikin", rx: /\bheikin[- ]?ashi\w*/ },
  { kind: "price", rx: /\b(?:schlusskurs\w*|kerzenschluss\w*|kurs(?:e|es)?|preis(?:e|es)?|close|schluss|kerzen?\s+schliess\w*)\b/ },
];

function findAnchors(w: string): Anchor[] {
  const all: Anchor[] = [];
  for (const d of DEFS) {
    const rx = new RegExp(d.rx.source, "g");
    for (let m = rx.exec(w); m; m = rx.exec(w)) {
      if (m[0] === "") {
        rx.lastIndex++;
        continue;
      }
      const an: Anchor = { kind: d.kind, a: m.index, b: m.index + m[0].length, m };
      d.read?.(m, an);
      all.push(an);
    }
  }
  // overlaps: the longer anchor wins ("EMA 200" over "MA"), a price word inside another anchor is dropped
  all.sort((x, y) => x.a - y.a || y.b - y.a - (x.b - x.a));
  const out: Anchor[] = [];
  for (const an of all) {
    const prev = out[out.length - 1];
    if (prev && an.a < prev.b) continue;
    // "Ausbruch über das 20-Kerzen-Hoch" is ONE breakout
    if (prev && prev.kind === "breakout" && an.kind === "breakout" && /^\s*(?:ueber|unter|nach\s+(?:oben|unten)|aus|auf)?\s*(?:das|den|dem|die|der|ein|eine|einem)?\s*(?:neue[ns]?)?\s*$/.test(w.slice(prev.b, an.a))) {
      out[out.length - 1] = { ...an, a: prev.a };
      continue;
    }
    // "Donchian 20 Ausbruch": the breakout word belongs to the channel
    if (prev && prev.kind === "donchian" && an.kind === "breakout" && /^[\s,]*(?:nach\s+(?:oben|unten))?[\s,]*$/.test(w.slice(prev.b, an.a))) {
      prev.b = an.b;
      continue;
    }
    out.push(an);
  }
  return out;
}

const SENT_RX = /[;\n]|\.(?!\d)/;
/** the part of the text a timeframe may belong to: from the price lead (if any) to the end of the window */
const winOf = (slot: { price: Anchor | null; an: Anchor; winEnd: number }): { a: number; b: number } => ({ a: slot.price ? slot.price.b : slot.an.b, b: slot.winEnd });
const CONNECTOR_RX = /^[\s,]*(?:(?:und|oder|sowie|plus|aber|auch|bzw\.?|ausserdem|zusaetzlich|gleichzeitig|noch|dann|\+|&)\s*)*(?:(?:der|die|das|dem|den|des|ein|eine|einen|einem)\s+)?[\s,]*$/;
const OBJECT_KINDS: ReadonlySet<Kind> = new Set<Kind>(["ma", "boll", "vwap", "supertrend", "donchian", "breakout"]);
/** a state verb right after a condition ("… liegt", "… ist") belongs to it */
const STATE_VERB_RX = /^\s*(?:liegt|liegen|ist|sind|bleibt|bleiben|steht|stehen|notiert|handelt|schliesst|schliessen|befindet\s+sich|hat|wird)\b/;
const NEG_LEAD_RX = /\b(?:nicht|kein\w*|ohne|nie|niemals)\s*(?:der|die|das|den|dem|ein|eine|einen|mehr)?\s*$/;

interface Slot {
  ctx: Ctx;
  an: Anchor;
  i: number;
  anchors: Anchor[];
  /** the unread text before the anchor (since the last read part) */
  before: string;
  beforeStart: number;
  /** the window: text from the anchor to the next anchor or the end of the sentence */
  after: string;
  winEnd: number;
  /** the window ends of all anchors (index = anchor index) */
  winEnds: number[];
  /** the price anchor right before this one (the thing "Kurs über …" relates) */
  price: Anchor | null;
  last: Last | null;
}

interface Last {
  kind: "maPrice" | "level";
  rel: Rel;
  type?: "ema" | "sma";
  end: number;
  block?: string;
}

interface Done {
  /** end of the read text */
  end: number;
  /** following anchors that were read as part of this one */
  skip?: number;
  last?: Last | null;
}

/* ----------------------------------------------------------------------------------------------- helpers */

const leaf = (block: SpecLeaf["block"], params: SpecLeaf["params"], not = false): SpecLeaf => ({ t: "leaf", block, params, tf: "exec", ...(not ? { not: true } : {}) });
const group = (op: "and" | "or", kids: SpecNode[]): SpecNode => (kids.length === 1 ? kids[0]! : ({ t: "group", op, kids } satisfies SpecGroup));

/** Window of an event (a crossing): the text says it, else the trader's answer, else the lab's default (one candle). */
function evWithin(ctx: Ctx, explicit: number | null): number | undefined {
  if (explicit != null) return explicit;
  ctx.assume({
    id: "within",
    text: "Ein Ereignis wie „kreuzt“ oder „fällt unter“ zählt nur an der Kerze, an der es passiert (nicht auch noch danach).",
    options: [1, 3, 5].map((n) => ({ id: String(n), label: n === 1 ? "nur diese Kerze" : `bis ${n} Kerzen zurück` })),
    def: "1",
  });
  const a = ctx.answer("within", ["1", "3", "5"]);
  return a ? Number(a) : undefined;
}

function connectNodes(nodes: SpecNode[], pairs: LevelPair[]): SpecNode {
  if (nodes.length === 1) return nodes[0]!;
  // all joined by "oder" → OR; else AND (a mix "A und B oder C" inside one indicator is read as OR of the last)
  const anyOr = pairs.slice(1).some((p) => p.or);
  const allOr = pairs.slice(1).every((p) => p.or);
  if (anyOr && !allOr) return group("or", nodes);
  return group(allOr ? "or" : "and", nodes);
}

/** A verb right after a finished condition belongs to it ("… nach oben kreuzt", "… Band berührt"). */
const TRAIL_VERB_RX = /^\s*(?:wieder\s+)?(?:kreuzt|kreuzen|schneidet|steigt|faellt|sinkt|liegt|liegen|ist|sind|bleibt|beruehrt|beruehren|erreicht|erreichen|unterschreitet|ueberschreitet|schliesst|schliessen|wird|dreht|wechselt|bricht|steht)\b/;
/** "wie der Durchschnitt", "über dem Durchschnitt" after a volume phrase */
const AVG_TAIL_RX = /^\s*(?:so\s+(?:hoch|gross|viel)\s+)?(?:wie|als|ueber|von)?\s*(?:der|die|das|dem|den)?\s*(?:durchschnitt\w*|schnitt|normal\w*)\b/;
/** the little words that may stand between a condition and "auf dem 4h-Chart" */
const TF_GAP_RX = /^\s*(?:auf|im|in|am|bei|mit|fuer|dem|der|den|des)?(?:\s+(?:dem|der|den|des))*\s*$/;

/** Pushes a finished condition and attaches a timeframe named inside its window. */
function emit(ctx: Ctx, node: SpecNode, a: number, b: number, win: { a: number; b: number }): void {
  const rest = TRAIL_VERB_RX.exec(ctx.w.slice(b, win.b));
  if (rest) b += rest[0].length;
  const idx = ctx.items.findIndex((it) => it.kind === "tf" && it.a >= win.a && it.b <= win.b && (it.a < b || TF_GAP_RX.test(ctx.s.slice(b, it.a))));
  if (idx >= 0) {
    const tfItem = ctx.items[idx] as Extract<Item, { kind: "tf" }>;
    const setTf = (n: SpecNode): void => {
      if (n.t === "leaf") n.tf = tfItem.tf as TfId;
      else n.kids.forEach(setTf);
    };
    setTf(node);
    ctx.items.splice(idx, 1);
    b = Math.max(b, tfItem.b);
  }
  ctx.add({ kind: "cond", node, a, b });
}

function dangling(ctx: Ctx, an: Anchor, what: string, ask?: { id: string; text: string; options: { id: string; label: string }[] }, upTo = an.b): Done {
  ctx.noteUnclear(an.a, upTo, what);
  if (ask) ctx.ask({ id: ask.id, text: ask.text, options: ask.options, blocking: false, span: { a: an.a, b: upTo } });
  return { end: upTo };
}

/** End of the LAST match of `rx` in `text` (0 when none). */
function lastEnd(rx: RegExp, text: string): number {
  const g = new RegExp(rx.source, "g");
  let end = 0;
  for (let m = g.exec(text); m; m = g.exec(text)) {
    end = m.index + m[0].length;
    if (m[0] === "") g.lastIndex++;
  }
  return end;
}

const RSI_LEVELS = [25, 30, 35].map((v) => ({ id: String(v), label: `unter ${v}` }));

/* ---------------------------------------------------------------------------------------------- RSI & oscillators */

interface OscSpec {
  name: string;
  make(rel: Rel, level: number, within: number | undefined): SpecLeaf;
  /** words that set a default level (überverkauft …) */
  words?: { oversold?: number; overbought?: number };
  range: [number, number];
}

function oscillator(slot: Slot, spec: OscSpec): Done {
  const { ctx, an } = slot;
  const text = slot.after;
  const win = withinOf(text);
  const pairs = levelPairs(text).filter((p) => p.level >= spec.range[0] && p.level <= spec.range[1]);
  const outOfRange = levelPairs(text).filter((p) => p.level < spec.range[0] || p.level > spec.range[1]);
  if (outOfRange.length) {
    ctx.noteUnclear(an.a, an.b + outOfRange[0]!.b, `${spec.name}: ${de(outOfRange[0]!.level)} liegt außerhalb des Bereichs ${spec.range[0]} bis ${spec.range[1]}.`);
    if (!pairs.length) return { end: an.b + outOfRange[0]!.b };
  }
  const negBefore = NEG_LEAD_RX.test(slot.before.trimEnd());
  if (pairs.length) {
    const nodes: SpecNode[] = pairs.map((p) => {
      const isCross = p.rel === "crossUp" || p.rel === "crossDown";
      const l = spec.make(p.rel, p.level, isCross ? evWithin(ctx, win?.n ?? null) : undefined);
      if (p.neg || negBefore) l.not = true;
      return l;
    });
    const last = Math.max(...pairs.map((p) => p.b), win?.b ?? 0);
    const verb = STATE_VERB_RX.exec(text.slice(last));
    const end = an.b + last + (verb ? verb[0].length : 0);
    emit(ctx, connectNodes(nodes, pairs), negBefore ? Math.max(0, an.a - 6) : an.a, end, { a: an.b, b: slot.winEnd });
    return { end, last: { kind: "level", rel: pairs[pairs.length - 1]!.rel, end, block: spec.name } };
  }
  const given = relAnswer(ctx, an);
  if (given) {
    const isCross = given.rel === "crossUp" || given.rel === "crossDown";
    const l = spec.make(given.rel, given.level, isCross ? evWithin(ctx, win?.n ?? null) : undefined);
    const numAt = /-?\d+(?:[.,]\d+)?/.exec(text);
    const end = an.b + (numAt ? numAt.index + numAt[0].length : 0);
    emit(ctx, l, an.a, end, { a: an.b, b: slot.winEnd });
    return { end };
  }
  const os = /\b(ueberverkauft\w*|oversold)\b/.exec(text);
  const ob = /\b(ueberkauft\w*|overbought)\b/.exec(text);
  const word = os ?? ob;
  if (word && spec.words) {
    const isOs = word === os;
    const def = isOs ? spec.words.oversold : spec.words.overbought;
    if (def != null) {
      const level = lvlAnswer(ctx, isOs ? "oversold" : "overbought", def, isOs);
      const l = spec.make(isOs ? "below" : "above", level, undefined);
      if (negBefore || negatedAt(text, word.index)) l.not = true;
      ctx.assume({
        id: isOs ? "oversold" : "overbought",
        text: `„${isOs ? "überverkauft" : "überkauft"}“ gelesen als ${spec.name} ${isOs ? "unter" : "über"} ${de(def)}. Schreib eine Zahl in den Text, wenn du etwas anderes meinst.`,
        options: (isOs ? [20, 25, 30] : [70, 75, 80]).map((v) => ({ id: String(v), label: `${isOs ? "unter" : "über"} ${v}` })),
        def: String(def),
      });
      const end = an.b + word.index + word[0].length;
      emit(ctx, l, an.a, end, { a: an.b, b: slot.winEnd });
      return { end };
    }
  }
  // an indicator without a relation or a level: the lab cannot guess which one
  const bare = /(-?\d+(?:[.,]\d+)?)/.exec(text);
  if (bare) {
    const v = parseNum(bare[1]!);
    return dangling(
      ctx,
      an,
      `${spec.name} ${de(v)}: es fehlt, ob der Wert darunter, darüber liegen oder das Niveau kreuzen soll.`,
      {
        id: `rel:${an.a}`,
        text: `Wie soll ${spec.name} zum Niveau ${de(v)} stehen?`,
        options: [
          { id: `below:${v}`, label: `unter ${de(v)}` },
          { id: `above:${v}`, label: `über ${de(v)}` },
          { id: `crossUp:${v}`, label: `kreuzt ${de(v)} nach oben` },
          { id: `crossDown:${v}`, label: `kreuzt ${de(v)} nach unten` },
        ],
      },
      an.b + bare.index + bare[0].length,
    );
  }
  return dangling(ctx, an, `Zu „${ctx.phrase(an.a, an.b)}“ fehlt die Bedingung (unter / über / kreuzt) und eine Zahl.`, {
    id: `rel:${an.a}`,
    text: `Was soll ${spec.name} tun?`,
    options: RSI_LEVELS.map((o) => ({ id: `below:${o.id}`, label: `${spec.name} ${o.label}` })).slice(0, 3),
  });
}

function lvlAnswer(ctx: Ctx, id: string, def: number, os: boolean): number {
  const a = ctx.answer(id, os ? ["20", "25", "30"] : ["70", "75", "80"]);
  return a ? Number(a) : def;
}

/** An answer to a "rel:<pos>" question ("below:30") becomes the pair it stands for. */
function relAnswer(ctx: Ctx, an: Anchor): { rel: Rel; level: number } | null {
  const a = ctx.answers[`rel:${an.a}`];
  if (typeof a !== "string") return null;
  const m = /^(above|below|crossUp|crossDown):(-?\d+(?:\.\d+)?)$/.exec(a);
  return m ? { rel: m[1] as Rel, level: Number(m[2]) } : null;
}

function interpRsi(slot: Slot): Done {
  const { ctx, an } = slot;
  const text = slot.after;
  // RSI against its own average / trendline
  if (/\b(?:seinem|seiner|dessen|rsi-?ma|ma-?linie|durchschnitt\w*|signallinie)\b/.test(text) && !/\d/.test(text.replace(/\(.*?\)/g, ""))) {
    const rel = classifyRel(text, "");
    if (rel && rel !== "x") {
      const len = rsiLen(ctx, an);
      const isCross = rel === "crossUp" || rel === "crossDown";
      const l = leaf("rsiMa", { len, mode: rel, ...(isCross ? withinPart(evWithin(ctx, withinOf(text)?.n ?? null)) : {}) });
      const end = an.b + (/\b(?:durchschnitt\w*|signallinie|ma-?linie)\b/.exec(text)?.index ?? 0) + (/\b(?:durchschnitt\w*|signallinie|ma-?linie)\b/.exec(text)?.[0].length ?? 0) + stateVerbLen(text, /\b(?:durchschnitt\w*|signallinie|ma-?linie)\b/);
      emit(ctx, l, an.a, Math.max(end, an.b), { a: an.b, b: slot.winEnd });
      return { end };
    }
  }
  if (/\btrendlini\w*|\babwaertslini\w*|\baufwaertslini\w*/.test(text)) {
    const down = /\b(?:abwaerts\w*|fallend\w*)\b/.test(text);
    const up = /\b(?:aufwaerts\w*|steigend\w*)\b/.test(text);
    const rel = classifyRel(text, "");
    const mode = down || (!up && (rel === "crossUp" || /nach oben|ueber/.test(text))) ? "breakUp" : "breakDown";
    const idx = text.search(/\btrendlini\w*|\babwaertslini\w*|\baufwaertslini\w*/);
    const afterWord = idx + (/\w+/.exec(text.slice(idx))?.[0].length ?? 0);
    const end = an.b + afterWord + (/^\s*(?:nach\s+(?:oben|unten)\s+)?(?:gebrochen|bricht|durchbrochen|durchbricht|ausgebrochen)(?:\s+wird)?/.exec(text.slice(afterWord))?.[0].length ?? 0);
    emit(ctx, leaf("rsiLine", { mode }), an.a, end, { a: an.b, b: slot.winEnd });
    ctx.assume({ id: "rsiline", text: `RSI-Trendlinie: der RSI bricht seine ${mode === "breakUp" ? "Abwärts" : "Aufwärts"}linie ${mode === "breakUp" ? "nach oben" : "nach unten"}, höchstens 3 Kerzen her (Standard des Labors).`, options: [], def: null });
    return { end };
  }
  return oscillator(slot, {
    name: "RSI",
    range: [1, 99],
    words: { oversold: 30, overbought: 70 },
    make: (rel, level, within) => leaf("rsi", { len: rsiLen(ctx, an), mode: rel, level, ...withinPart(within) }),
  });
}

const withinPart = (w: number | undefined): Record<string, number> => (w == null ? {} : { within: w });
const stateVerbLen = (text: string, upTo: RegExp): number => {
  const m = upTo.exec(text);
  if (!m) return 0;
  return STATE_VERB_RX.exec(text.slice(m.index + m[0].length))?.[0].length ?? 0;
};

function rsiLen(ctx: Ctx, an: Anchor): number {
  if (an.len) return an.len;
  const a = ctx.answer("rsilen", ["7", "14", "21"]);
  ctx.assume({ id: "rsilen", text: "RSI-Länge 14 (Standard, im Text stand keine)", options: [7, 14, 21].map((v) => ({ id: String(v), label: `Länge ${v}` })), def: "14" });
  return a ? Number(a) : 14;
}

function interpStoch(slot: Slot): Done {
  const { ctx, an } = slot;
  const text = slot.after;
  const stochLead = slot.before.split(/,|\sund\s|\soder\s/).pop() ?? "";
  if (/%d\b|\bsignal\w*|\bd-?linie\b/.test(text) && (classifyRel(text, "") ?? classifyRel(stochLead.slice(-20), text))) {
    const rel = classifyRel(text, "") ?? classifyRel(stochLead.slice(-20), text);
    if (rel === "crossUp" || rel === "crossDown") {
      const l = leaf("stoch", { mode: rel === "crossUp" ? "kdUp" : "kdDown", ...withinPart(evWithin(ctx, withinOf(text)?.n ?? null)) });
      const m = /%d\b|\bsignal\w*|\bd-?linie\b/.exec(text)!;
      let end = an.b + m.index + m[0].length;
      // "… kreuzt %D nach unten über 80": only in the extreme zone (both lines beyond the level before the crossing)
      const rest = text.slice(m.index + m[0].length);
      const zone = levelPairs(rest).find((p) => p.level >= 50 && p.level <= 99 && p.rel === "above") ?? levelPairs(rest).find((p) => p.level >= 1 && p.level <= 50 && p.rel === "below");
      if (zone) {
        l.params.zone = "extreme";
        l.params.level = rel === "crossDown" ? 100 - zone.level : zone.level;
        end += zone.b;
      }
      emit(ctx, l, an.a, end, { a: an.b, b: slot.winEnd });
      ctx.assume({ id: "stoch", text: "Stochastic mit den Standardwerten (14, 3, 3).", options: [], def: null });
      return { end };
    }
  }
  ctx.assume({ id: "stoch", text: "Stochastic mit den Standardwerten (14, 3, 3).", options: [], def: null });
  return oscillator(slot, { name: "Stochastic", range: [1, 99], words: { oversold: 20, overbought: 80 }, make: (rel, level, within) => leaf("stoch", { mode: rel, level, ...withinPart(within) }) });
}

function interpCci(slot: Slot): Done {
  return oscillator(slot, { name: "CCI", range: [-300, 300], make: (rel, level, within) => leaf("cci", { mode: rel, level, ...withinPart(within) }) });
}

function interpWillr(slot: Slot): Done {
  return oscillator(slot, { name: "Williams %R", range: [-99, -1], words: { oversold: -80, overbought: -20 }, make: (rel, level, within) => leaf("willr", { mode: rel, level, ...withinPart(within) }) });
}

function interpAdx(slot: Slot): Done {
  const { ctx, an } = slot;
  const text = slot.after;
  const rel = classifyRel(text, "");
  if (/\bdi\b|\+di|-di/.test(text) && (rel === "crossUp" || rel === "crossDown")) {
    emit(ctx, leaf("adx", { mode: rel === "crossUp" ? "diUp" : "diDown", ...withinPart(evWithin(ctx, withinOf(text)?.n ?? null)) }), an.a, slot.winEnd, { a: an.b, b: slot.winEnd });
    return { end: slot.winEnd };
  }
  const pairs = levelPairs(text).filter((p) => p.level >= 5 && p.level <= 60);
  if (pairs.length) {
    const p = pairs[0]!;
    const strong = /\bstark\w*|\btrend\w*\s+(?:ist\s+)?(?:da|vorhanden)/.test(text);
    const mode = p.rel === "below" ? "adxBelow" : "adxAbove";
    void strong;
    emit(ctx, leaf("adx", { mode, level: p.level }, p.neg), an.a, an.b + p.b, { a: an.b, b: slot.winEnd });
    return { end: an.b + p.b };
  }
  return dangling(ctx, an, "ADX: es fehlt die Schwelle (z. B. „ADX über 25“).");
}

function interpSupertrend(slot: Slot): Done {
  const { ctx, an } = slot;
  const text = slot.after;
  const flip = /\b(?:dreht|wechselt|flip\w*|umkehr\w*|springt|kippt)\b/.test(text);
  const upW = /nach oben|\bgruen\b|\bbullish\b|\blong\b|aufwaerts|\bsteigend\b|unter dem kurs|\bpositiv\b/.test(text);
  const downW = /nach unten|\brot\b|\bbearish\b|\bshort\b|abwaerts|\bfallend\b|ueber dem kurs|\bnegativ\b/.test(text);
  if (upW === downW) return dangling(ctx, an, "Supertrend: es fehlt die Richtung (nach oben / nach unten, grün / rot).");
  const mode = flip ? (upW ? "flipUp" : "flipDown") : upW ? "up" : "down";
  ctx.assume({ id: "supertrend", text: "Supertrend mit den Standardwerten (ATR 10, Faktor 3).", options: [], def: null });
  const l = leaf("supertrend", { mode, ...(flip ? withinPart(evWithin(ctx, withinOf(text)?.n ?? null)) : {}) });
  emit(ctx, l, an.a, slot.winEnd, { a: an.b, b: slot.winEnd });
  return { end: slot.winEnd };
}

function interpVwap(slot: Slot): Done {
  const { ctx, an } = slot;
  const lead = slot.price ? slot.ctx.w.slice(slot.price.b, an.a) : slot.before.slice(-24);
  const rel = classifyRel(lead, slot.after);
  if (!rel || rel === "x") return dangling(ctx, an, "VWAP: es fehlt, ob der Kurs darüber, darunter liegt oder ihn kreuzt.");
  const isCross = rel === "crossUp" || rel === "crossDown";
  ctx.assume({ id: "vwap", text: "VWAP seit Tagesbeginn (00:00 UTC) – im Text stand kein Neustart.", options: [], def: null });
  const l = leaf("vwap", { anchor: "day", mode: rel, ...(isCross ? withinPart(evWithin(ctx, withinOf(slot.after)?.n ?? null)) : {}) }, negatedAt(lead, lead.length));
  const start = slot.price?.a ?? an.a;
  emit(ctx, l, start, an.b, winOf(slot));
  return { end: an.b };
}

/* ------------------------------------------------------------------------------- price vs. levels / averages */

function interpPrice(slot: Slot): Done {
  const { ctx, an, anchors, i } = slot;
  const next = anchors[i + 1];
  // the price belongs to the thing it is related to ("Kurs über EMA 200"): that anchor reads it
  if (next && OBJECT_KINDS.has(next.kind) && next.a < slot.winEnd + 1 && !SENT_RX.test(ctx.w.slice(an.b, next.a))) return { end: an.b - 0, skip: 0 };
  if (next && next.kind === "boll" && !SENT_RX.test(ctx.w.slice(an.b, next.a))) return { end: an.b };
  const text = slot.after;
  const pairs = levelPairs(text, parseLevel, true).filter((p) => p.level > 0);
  if (pairs.length) {
    const win = withinOf(text);
    const nodes: SpecNode[] = pairs.map((p) => {
      const mode = p.rel === "above" ? "closeAbove" : p.rel === "below" ? "closeBelow" : p.rel === "crossUp" ? "crossAbove" : "crossBelow";
      const isCross = p.rel === "crossUp" || p.rel === "crossDown";
      return leaf("keyLevel", { level: p.level, mode, ...(isCross ? withinPart(evWithin(ctx, win?.n ?? null)) : {}) }, p.neg);
    });
    const last = Math.max(...pairs.map((p) => p.b));
    const end = an.b + last + (STATE_VERB_RX.exec(text.slice(last))?.[0].length ?? 0);
    emit(ctx, connectNodes(nodes, pairs), an.a, end, { a: an.b, b: slot.winEnd });
    return { end };
  }
  return { end: an.b };
}

function interpMa(slot: Slot): Done {
  const { ctx, an, anchors, i } = slot;
  const next = anchors[i + 1];
  const between = next ? ctx.w.slice(an.b, next.a) : "";
  const tail = slot.after;
  let type: "ema" | "sma" | "ma" = an.type ?? "ma";
  // two averages: "EMA 21 kreuzt EMA 55 nach oben"
  const crossAfter = next != null && next.kind === "ma" && CONNECTOR_RX.test(between) && /\bkreuz\w*/.test(ctx.w.slice(next.b, Math.min(slot.winEnds[i + 1]!, next.b + 40)));
  if (next && next.kind === "ma" && !SENT_RX.test(between) && (hasRel(between) || crossAfter)) {
    const end2 = next.b;
    const tail2 = ctx.w.slice(end2, Math.min(ctx.w.length, end2 + 36)).split(/[;\n]|\.(?!\d)/)[0]!;
    const rel = hasRel(between) ? classifyRel(between, tail2) : classifyRel(tail2, "");
    const t1 = an.type ?? "ma";
    const t2 = next.type ?? "ma";
    if (!an.len || !next.len) return dangling(ctx, an, "Zu den beiden Durchschnitten fehlt eine Länge (z. B. „EMA 21 kreuzt EMA 55“).");
    const mixed = t1 !== "ma" && t2 !== "ma" && t1 !== t2;
    if (mixed) {
      const endMixed = next.b + (/^\s*(?:sich\s+)?(?:(?:nach|von)\s+(?:oben|unten)\s*)?(?:kreuz\w*)?/.exec(tail2)?.[0].length ?? 0);
      ctx.noteUnclear(an.a, endMixed, "Ein Durchschnitt aus EMA und SMA gemischt kennt das Labor nicht – beide müssen dieselbe Art sein.");
      return { end: endMixed, skip: 1 };
    }
    const kind = maTypeOf(ctx, t1 !== "ma" ? t1 : t2, an);
    const fastFirst = an.len < next.len;
    if (rel === "crossUp" || rel === "crossDown") {
      const up = (rel === "crossUp") === fastFirst;
      const fast = Math.min(an.len, next.len);
      const slow = Math.max(an.len, next.len);
      const endAll = end2 + (/^\s*(?:sich\s+)?(?:(?:nach|von)\s+(?:oben|unten)\s*)?(?:kreuz\w*)?(?:\s*(?:nach|von)\s+(?:oben|unten))?/.exec(tail2)?.[0].length ?? 0);
      emit(ctx, leaf("maCross", { type: kind, fast, slow, mode: up ? "up" : "down", ...withinPart(evWithin(ctx, withinOf(tail2)?.n ?? null)) }), an.a, endAll, { a: an.b, b: slot.winEnds[i + 1]! });
      return { end: endAll, skip: 1 };
    }
    if (rel === "x") {
      ctx.noteUnclear(an.a, next.b, "Es steht „kreuzt“, aber nicht in welche Richtung.");
      ctx.ask({ id: `dir:${an.a}`, text: "In welche Richtung soll die Kreuzung gehen?", options: [{ id: "up", label: "kurz kreuzt lang nach oben" }, { id: "down", label: "kurz kreuzt lang nach unten" }], blocking: false, span: { a: an.a, b: next.b } });
      const a = ctx.answer(`dir:${an.a}`, ["up", "down"]);
      if (!a) return { end: next.b, skip: 1 };
      const fast = Math.min(an.len, next.len);
      const slow = Math.max(an.len, next.len);
      emit(ctx, leaf("maCross", { type: kind, fast, slow, mode: a, ...withinPart(evWithin(ctx, null)) }), an.a, next.b, { a: an.b, b: slot.winEnds[i + 1]! });
      return { end: next.b, skip: 1 };
    }
    // a state of two averages ("EMA 50 über EMA 200") is no block of the lab
    const fastLen = Math.min(an.len, next.len);
    const slowLen = Math.max(an.len, next.len);
    const key = `mastate:${an.a}`;
    const above = rel === "above" ? fastFirst : !fastFirst;
    ctx.noteUnclear(an.a, next.b, `„${ctx.phrase(an.a, next.b)}“ ist ein Zustand zweier Durchschnitte – das Labor kennt von ihnen nur die Kreuzung, nicht das Darüber- oder Darunterliegen.`);
    ctx.ask({
      id: key,
      text: `Wie soll „EMA/SMA ${fastLen} ${above ? "über" : "unter"} ${slowLen}“ geprüft werden?`,
      options: [
        { id: "cross", label: `${fastLen} kreuzt ${slowLen} ${above ? "nach oben" : "nach unten"} (bis 5 Kerzen zurück)` },
        { id: "price", label: `Kurs ${above ? "über" : "unter"} dem ${slowLen}er` },
        { id: "none", label: "weglassen" },
      ],
      blocking: false,
      span: { a: an.a, b: next.b },
    });
    const a = ctx.answer(key, ["cross", "price", "none"]);
    if (a === "cross") emit(ctx, leaf("maCross", { type: kind, fast: fastLen, slow: slowLen, mode: above ? "up" : "down", within: 5 }), an.a, next.b, { a: an.b, b: slot.winEnds[i + 1]! });
    if (a === "price") emit(ctx, leaf("maPrice", { type: kind, len: slowLen, mode: above ? "above" : "below" }), an.a, next.b, { a: an.b, b: slot.winEnds[i + 1]! });
    return { end: next.b, skip: 1 };
  }

  // an average and the price
  const price = slot.price;
  const lead = price ? ctx.w.slice(price.b, an.a) : slot.before.slice(-26).split(/,|\sund\s|\soder\s/).pop()!;
  const relLead = classifyRel(lead, tail);
  const tailHead = tail.slice(0, 44);
  const rel = relLead ?? classifyRel(tailHead, "");
  const relFromTail = relLead == null && rel != null;
  const lenFromWindow = an.len ?? (/^\s*(\d+)\b/.exec(tail) && !hasRel(tail.slice(0, 3)) ? Number(/^\s*(\d+)\b/.exec(tail)![1]) : undefined);
  // an average after a price-vs-average condition inherits the relation: "Kurs über EMA 50 und EMA 200"
  const inherit = !rel && slot.last?.kind === "maPrice" && CONNECTOR_RX.test(slot.before) ? slot.last : null;
  const useRel: Rel | "x" | null = rel ?? inherit?.rel ?? null;
  if (useRel === null) return dangling(ctx, an, `Zu „${ctx.phrase(an.a, an.b)}“ fehlt, wie der Kurs dazu stehen soll (darüber, darunter, kreuzt).`);
  if (useRel === "x") return dangling(ctx, an, "Es steht „kreuzt“, aber nicht in welche Richtung.", { id: `dir:${an.a}`, text: "In welche Richtung soll der Kurs den Durchschnitt kreuzen?", options: [{ id: "crossUp", label: "nach oben" }, { id: "crossDown", label: "nach unten" }] });
  if (!lenFromWindow) {
    const a = ctx.answer("malen", ["20", "50", "100", "200"]);
    if (!a) return dangling(ctx, an, `Dem Durchschnitt „${ctx.phrase(an.a, an.b)}“ fehlt die Länge.`, { id: "malen", text: "Welche Länge soll der Durchschnitt haben?", options: [20, 50, 100, 200].map((v) => ({ id: String(v), label: `${v}` })) });
    an.len = Number(a);
  }
  const len = an.len ?? lenFromWindow!;
  if (inherit && type === "ma") type = inherit.type ?? "ma";
  const kind = maTypeOf(ctx, type, an);
  const isCross = useRel === "crossUp" || useRel === "crossDown";
  const neg = negatedAt(lead, lead.length) || (price ? negatedAt(ctx.w.slice(0, price.a), price.a) : NEG_LEAD_RX.test(slot.before.trimEnd()));
  const l = leaf("maPrice", { type: kind, len, mode: useRel, ...(isCross ? withinPart(evWithin(ctx, withinOf(tail)?.n ?? null)) : {}) }, neg);
  if (an.daily) l.tf = "1d";
  const start = price?.a ?? (rel ? an.a - (lead.length - lead.trimStart().length >= 0 ? lead.trimStart().length : 0) : an.a);
  const verb = STATE_VERB_RX.exec(tail.slice(an.len && !an.m[0].match(/\d/) ? 0 : 0));
  const lenEnd = lenFromWindow && !an.len ? /^\s*\d+/.exec(tail)![0].length : 0;
  const tailEnd = relFromTail ? Math.max(lenEnd, lastEnd(/\b(?:durchbr\w*|kreuz\w*|schneid\w*|(?:nach|von)\s+(?:oben|unten)|ueberschreit\w*|unterschreit\w*|steigt|faellt)\b/, tailHead)) : lenEnd;
  const end = an.b + tailEnd + (verb && !relFromTail ? verb[0].length : 0);
  emit(ctx, l, Math.min(start, an.a), end, winOf(slot));
  return { end, last: { kind: "maPrice", rel: useRel, type: kind, end } };
}

function maTypeOf(ctx: Ctx, t: "ema" | "sma" | "ma", an: Anchor): "ema" | "sma" {
  if (t !== "ma") return t;
  const chosen = ctx.answer("matype", ["ema", "sma"]);
  ctx.ask({ id: "matype", text: `Ist „${ctx.phrase(an.a, an.b)}“ ein EMA oder ein SMA? (vorläufig gerechnet: ${chosen === "ema" ? "EMA" : "SMA"})`, options: [{ id: "ema", label: "EMA" }, { id: "sma", label: "SMA" }], blocking: false, span: { a: an.a, b: an.b } });
  return chosen === "ema" ? "ema" : "sma";
}

function interpGolden(slot: Slot): Done {
  const { ctx, an } = slot;
  const death = /tod|death/.test(an.m[0]);
  ctx.assume({ id: "golden", text: `„${death ? "Todeskreuz" : "Goldenes Kreuz"}“ gelesen als SMA 50 kreuzt SMA 200 nach ${death ? "unten" : "oben"}.`, options: [], def: null });
  emit(ctx, leaf("maCross", { type: "sma", fast: 50, slow: 200, mode: death ? "down" : "up", ...withinPart(evWithin(ctx, null)) }), an.a, an.b, { a: an.b, b: slot.winEnd });
  return { end: an.b };
}

/* ------------------------------------------------------------------------------------- MACD / Bollinger etc. */

function interpMacd(slot: Slot): Done {
  const { ctx, an } = slot;
  const text = slot.after;
  const m = an.m;
  const base: Record<string, number> = m[1] ? { fast: Number(m[1]), slow: Number(m[2]), signal: Number(m[3]) } : {};
  if (!m[1]) ctx.assume({ id: "macd", text: "MACD mit den Standardwerten (12, 26, 9).", options: [], def: null });
  const win = withinOf(text);
  const neg = NEG_LEAD_RX.test(slot.before.trimEnd()) || /\bnicht\b/.test(text.slice(0, 20));
  const finish = (mode: string, endIdx: number, ev: boolean, from = an.a): Done => {
    const l = leaf("macd", { ...base, mode, ...(ev ? withinPart(evWithin(ctx, win?.n ?? null)) : {}) }, neg);
    const end = an.b + endIdx + stateVerbLen(text.slice(endIdx), /^/);
    emit(ctx, l, from, end, { a: an.b, b: slot.winEnd });
    return { end };
  };
  const hist = /\bhistogramm\w*/.exec(text);
  if (hist) {
    const after = text.slice(hist.index + hist[0].length);
    const base0 = hist.index + hist[0].length;
    const rise = /\b(?:steigt|waechst|wachsend|zunimmt|nimmt\s+zu|steigend)\b/.exec(after);
    const fall = /\b(?:faellt|schrumpft|fallend|abnimmt|nimmt\s+ab|laesst\s+nach)\b/.exec(after);
    const neg2 = /\b(?:negativ\w*|unter\s+(?:0|null))\b/.exec(after);
    const pos2 = /\b(?:positiv\w*|ueber\s+(?:0|null)|gruen)\b/.exec(after);
    const state = neg2 ?? pos2;
    const trend = rise ?? fall;
    if (state || trend) {
      const nodes: SpecNode[] = [];
      if (state) nodes.push(leaf("macd", { ...base, mode: neg2 ? "histNeg" : "histPos" }, neg));
      if (trend) nodes.push(leaf("macd", { ...base, mode: rise ? "histRising" : "histFalling" }, neg));
      const upTo = Math.max(state ? state.index + state[0].length : 0, trend ? trend.index + trend[0].length : 0);
      const end = an.b + base0 + upTo;
      emit(ctx, nodes.length === 1 ? nodes[0]! : group("and", nodes), an.a, end, { a: an.b, b: slot.winEnd });
      return { end };
    }
  }
  const leadWords = slot.before.split(/,|\sund\s|\soder\s/).pop() ?? "";
  const relOwn = classifyRel(text, "");
  const rel = relOwn ?? classifyRel(leadWords.slice(-20), text);
  const verbAt = relOwn ? -1 : leadWords.search(/(?:kreuz\w*|schneid\w*|durchbr\w*)\s*$/);
  const fromLead = verbAt >= 0 ? an.a - leadWords.length + verbAt : an.a;
  const zero = /\b(?:nulllinie|null\w*|0)\b/.exec(text);
  const sig = /\bsignal\w*/.exec(text);
  if (rel === "crossUp" || rel === "crossDown") {
    const upto = Math.max(zero ? zero.index + zero[0].length : 0, sig ? sig.index + sig[0].length : 0, (/\bnach\s+(?:oben|unten)\b/.exec(text)?.index ?? 0) + (/\bnach\s+(?:oben|unten)\b/.exec(text)?.[0].length ?? 0));
    if (zero && !sig) return finish(rel === "crossUp" ? "zeroUp" : "zeroDown", upto, true, fromLead);
    if (!sig) ctx.assume({ id: "macdcross", text: "MACD-Kreuzung gelesen als MACD-Linie kreuzt die Signallinie.", options: [], def: null });
    return finish(rel === "crossUp" ? "crossUp" : "crossDown", upto, true, fromLead);
  }
  if (rel === "x") return dangling(ctx, an, "MACD: es steht „kreuzt“, aber nicht in welche Richtung.");
  if ((rel === "above" || rel === "below") && zero) return finish(rel === "above" ? "aboveZero" : "belowZero", zero.index + zero[0].length, false);
  const word = /\b(bullish|bullisch|positiv\w*|negativ\w*|bearish|baerisch)\b/.exec(text);
  if (word) {
    const up = /^(?:bullish|bullisch|positiv)/.test(word[1]!);
    ctx.assume({ id: "macdword", text: `MACD „${word[1]}“ gelesen als MACD ${up ? "über" : "unter"} der Nulllinie.`, options: [], def: null });
    return finish(up ? "aboveZero" : "belowZero", word.index + word[0].length, false);
  }
  return dangling(ctx, an, "MACD: es fehlt, was er tun soll (Signallinie kreuzen, über Null liegen, Histogramm …).");
}

function interpBoll(slot: Slot): Done {
  const { ctx, an } = slot;
  const price = slot.price;
  const lead = price ? ctx.w.slice(price.b, an.a) : "";
  const text = `${lead} ${slot.after}`;
  const m = an.m;
  if (!m[1]) ctx.assume({ id: "boll", text: "Bollinger-Bänder mit den Standardwerten (20, 2σ).", options: [], def: null });
  const base: Record<string, number> = m[1] ? { len: Number(m[1]), mult: parseNum(m[2]!) } : {};
  const lower = /\b(?:untere[nrms]?|unterband|lower)\b|(?<!nach |von )\bunten\b/.test(text);
  const upper = /\b(?:obere[nrms]?|oberband|upper)\b|(?<!nach |von )\boben\b/.test(text);
  const mid = /\b(?:mittellinie|mittelband|mitte|mittleren?\s+band|middle)\b/.test(text);
  const squeeze = /\b(?:squeeze|eng(?:e|er|en)?|verengt\w*|zusammengezogen|schmal\w*|kontrahier\w*)\b/.test(text);
  const touch = /\b(?:beruehr\w*|beruehren|erreicht|erreichen|tippt|touch\w*|streift|tangiert|beruehrung)\b/.test(text);
  const back = /\b(?:zurueck\w*|wieder\s+(?:im|in|ins)|kehrt|rueckkehr|taucht\s+wieder)\b/.test(text);
  const rel = classifyRel(lead, slot.after);
  const neg = NEG_LEAD_RX.test(slot.before.trimEnd()) || (price != null && negatedAt(ctx.w.slice(0, price.a), price.a)) || /\b(?:nicht|kein\w*)\b/.test(lead);
  const start = price?.a ?? an.a;
  let mode: string | null = null;
  let ev = false;
  if (squeeze) mode = "squeeze";
  else if (mid && (rel === "crossUp" || rel === "crossDown")) (mode = rel === "crossUp" ? "midUp" : "midDown"), (ev = true);
  else if (back && (lower || upper)) (mode = lower ? "backInLower" : "backInUpper"), (ev = true);
  else if (touch && (lower || upper)) (mode = lower ? "touchLower" : "touchUpper"), (ev = true);
  else if ((rel === "below" || rel === "crossDown") && lower) (mode = "closeBelow"), (ev = true);
  else if ((rel === "above" || rel === "crossUp") && upper) (mode = "closeAbove"), (ev = true);
  else if (lower !== upper) {
    ctx.assume({ id: "bollMode", text: `Bollinger „${lower ? "unteres" : "oberes"} Band“ ohne Verb gelesen als: der Kurs berührt das ${lower ? "untere" : "obere"} Band.`, options: [], def: null });
    mode = lower ? "touchLower" : "touchUpper";
    ev = true;
  }
  if (!mode) return dangling(ctx, an, "Bollinger-Bänder: es fehlt, ob der Kurs das untere oder obere Band berührt, außerhalb schließt oder ob die Bänder eng sind.");
  const l = leaf("bollinger", { ...base, mode, ...(ev ? withinPart(evWithin(ctx, withinOf(text)?.n ?? null)) : {}) }, neg);
  const cues = [/\b(?:unter\w*|ober\w*)?\s*(?:band|baender|bb)\b/, /\b(?:squeeze|eng(?:e|er|en)?|verengt\w*|zusammengezogen|schmal\w*|kontrahier\w*)\b/, /\b(?:mittellinie|mittelband|mitte)\b/];
  const cueEnd = Math.max(0, ...cues.map((r) => lastEnd(r, slot.after)));
  const end = an.b + cueEnd;
  emit(ctx, l, start, Math.max(end, an.b), winOf(slot));
  return { end: Math.max(end, an.b) };
}

function interpAtr(slot: Slot): Done {
  const { ctx, an } = slot;
  const text = slot.after;
  const hi = /\b(?:hoch\w*|erhoeht\w*|steigend\w*|ueberdurchschnittlich\w*|aktiv\w*|volatil\w*|gross\w*|stark\w*|ueber\s+(?:dem\s+)?(?:durchschnitt|normal)\w*)\b/.exec(text);
  const lo = /\b(?:niedrig\w*|ruhig\w*|gering\w*|klein\w*|fallend\w*|unterdurchschnittlich\w*|schwach\w*|unter\s+(?:dem\s+)?(?:durchschnitt|normal)\w*)\b/.exec(text);
  const word = hi && lo ? (hi.index < lo.index ? hi : lo) : (hi ?? lo);
  if (/\d/.test(text) && /%|prozent|punkte|usd/.test(text)) return dangling(ctx, an, "Eine feste ATR-Größe (in Prozent oder Punkten) kennt das Labor als Filter nicht – nur „ATR hoch / niedrig“ im Vergleich zu den letzten Kerzen.");
  if (!word) return dangling(ctx, an, `Zu „${ctx.phrase(an.a, an.b)}“ fehlt, was gelten soll (z. B. „ATR hoch“ oder „ATR niedrig“). Als Stop schreibst du „Stop 1,5 ATR“.`);
  const above = word === hi;
  ctx.assume({ id: "atrpct", text: `„Volatilität ${above ? "hoch" : "niedrig"}“ gelesen als: die ATR(14) liegt ${above ? "mindestens im" : "höchstens im"} 50. Perzentil der letzten 100 Kerzen.`, options: [], def: null });
  const neg = NEG_LEAD_RX.test(slot.before.trimEnd()) || /\bnicht\b/.test(text.slice(0, word.index));
  emit(ctx, leaf("atrPct", { mode: above ? "above" : "below", pct: 50 }, neg), an.a, an.b + word.index + word[0].length, { a: an.b, b: slot.winEnd });
  return { end: an.b + word.index + word[0].length };
}

function interpVolume(slot: Slot): Done {
  const { ctx, an } = slot;
  const text = slot.after;
  const mult = /(\d+(?:[.,]\d+)?)\s*(?:x|mal|-?fach\w*)\b/.exec(text) ?? /\b(doppelt\w*|dreifach\w*|vierfach\w*|fuenffach\w*)\b/.exec(text);
  const spike = /\b(?:bestaetig\w*|steigend\w*|spitze|spike|anstieg|hoch\w*|erhoeht\w*|stark\w*|steigt|ueber\s+(?:dem\s+)?durchschnitt\w*|ueberdurchschnittlich\w*|ausreisser|explosion|zunahme|mehr\s+als)\b/.exec(text);
  const low = /\b(?:niedrig\w*|gering\w*|schwach\w*|sinkt|fallend\w*|abnehmend\w*|duenn)\b/.exec(text);
  if (low && !spike && !mult) return dangling(ctx, an, "Das Labor kennt beim Volumen nur die Spitze (ein Vielfaches des Durchschnitts), nicht „niedriges Volumen“.", undefined, an.b + low.index + low[0].length);
  const selfSpike = /bestaetig/.test(an.m[0]);
  if (!mult && !spike && !selfSpike) return dangling(ctx, an, "Zum Volumen fehlt, was gelten soll (z. B. „Volumen doppelt so hoch wie der Durchschnitt“).");
  let factor = 2;
  let end = an.b;
  if (mult) {
    const w = mult[1]!;
    factor = /^doppelt/.test(w) ? 2 : /^dreifach/.test(w) ? 3 : /^vierfach/.test(w) ? 4 : /^fuenffach/.test(w) ? 5 : parseNum(w);
    end = an.b + mult.index + mult[0].length;
    const tail = AVG_TAIL_RX.exec(ctx.w.slice(end, slot.winEnd));
    if (tail) end += tail[0].length;
  } else {
    end = spike ? an.b + spike.index + spike[0].length : an.b;
    const tail = AVG_TAIL_RX.exec(ctx.w.slice(end, slot.winEnd));
    if (tail) end += tail[0].length;
    ctx.assume({ id: "volmult", text: "Volumenspitze gelesen als: mindestens das Doppelte des Durchschnitts der letzten 20 Kerzen (im Text stand kein Faktor).", options: [1.5, 2, 3].map((v) => ({ id: String(v), label: `${String(v).replace(".", ",")}×` })), def: "2" });
    const a = ctx.answer("volmult", ["1.5", "2", "3"]);
    if (a) factor = Number(a);
  }
  const candle = /\b(?:gruen\w*|bullisch\w*|bullish)\b/.test(text) ? "bull" : /\b(?:rot\w*|baerisch\w*|bearish)\b/.test(text) ? "bear" : "any";
  const win = withinOf(text);
  const neg = NEG_LEAD_RX.test(slot.before.trimEnd());
  emit(ctx, leaf("volume", { mult: factor, candle, ...(win ? { within: win.n } : {}) }, neg), an.a, Math.max(end, win ? an.b + win.b : 0), { a: an.b, b: slot.winEnd });
  return { end: Math.max(end, win ? an.b + win.b : 0) };
}

function interpBreakout(slot: Slot): Done {
  const { ctx, an } = slot;
  const price = slot.price;
  const lead = price ? ctx.w.slice(price.b, an.a) : "";
  const text = `${slot.after}`;
  const m = an.m;
  const nWord = m[1] ?? m[4];
  const dirWord = m[2] ?? m[3];
  const nInText = /(?:letzten?|vorherigen?)\s+(\d+)\s*(?:kerzen|tage\w*|bars)|(\d+)[- ]?(?:kerzen|tage|bars)/.exec(text);
  const n = nWord ? Number(nWord) : nInText ? Number(nInText[1] ?? nInText[2]) : null;
  const unitDays = /tage|tages/.test(m[0]) || (nInText != null && /tage/.test(nInText[0]));
  const down = dirWord ? dirWord === "tief" : /\b(?:nach\s+unten|unter|abwaerts|short|tief)\b/.test(`${lead} ${text}`) && !/\bnach\s+oben\b/.test(`${lead} ${text}`);
  const up = dirWord ? dirWord === "hoch" : /\b(?:nach\s+oben|ueber|aufwaerts|long|hoch)\b/.test(`${lead} ${text}`);
  // without a direction the side of the section decides (resolved in build)
  const dir: "up" | "down" | "auto" = down && !up ? "down" : up && !down ? "up" : "auto";
  const len = n ?? 20;
  if (n == null) ctx.assume({ id: "breakoutN", text: "Ausbruch gelesen als: der Schluss liegt über dem Hoch (unter dem Tief) der letzten 20 Kerzen (im Text stand keine Zahl).", options: [10, 20, 50].map((v) => ({ id: String(v), label: `${v} Kerzen` })), def: "20" });
  const chosen = n == null ? ctx.answer("breakoutN", ["10", "20", "50"]) : null;
  const l = leaf("breakout", { mode: dir === "auto" ? "up" : dir, n: chosen ? Number(chosen) : len, ...withinPart(withinOf(text)?.n) });
  if (/\bdonchian\b/.test(m[0])) {
    l.block = "donchian";
    l.params = { len: m[1] ? Number(m[1]) : len, mode: dir === "down" ? "breakDown" : "breakUp", basis: "close" };
  }
  if (dir === "auto") (l as SpecLeaf & { auto?: boolean }).auto = true;
  if (unitDays) l.tf = "1d";
  const neg = NEG_LEAD_RX.test(slot.before.trimEnd());
  if (neg) l.not = true;
  const objEnd = an.b + (nInText ? nInText.index + nInText[0].length : /^\s*(?:ueber|unter|nach\s+(?:oben|unten))\s*(?:das|den|dem)?\s*(?:hoch|tief)?\w*/.exec(text)?.[0].length ?? 0);
  const start = price?.a ?? an.a;
  emit(ctx, l, start, Math.max(objEnd, an.b), winOf(slot));
  return { end: Math.max(objEnd, an.b) };
}

function interpDonchian(slot: Slot): Done {
  const { ctx, an } = slot;
  const text = slot.after;
  const len = an.m[1] ?? an.m[2] ? Number(an.m[1] ?? an.m[2]) : 20;
  const down = /\b(?:nach\s+unten|unter|abwaerts|short|tief)\b/.test(`${an.m[0]} ${text}`);
  const up = /\b(?:nach\s+oben|ueber|aufwaerts|long|hoch|ausbruch)\b/.test(text);
  const l = leaf("donchian", { len, mode: down && !up ? "breakDown" : "breakUp", basis: "close" });
  if (!(an.m[1] ?? an.m[2])) ctx.assume({ id: "donchianN", text: "Donchian-Kanal über 20 Kerzen (im Text stand keine Länge).", options: [], def: null });
  if (!down && !up) (l as SpecLeaf & { auto?: boolean }).auto = true;
  emit(ctx, l, slot.price?.a ?? an.a, an.b, winOf(slot));
  return { end: an.b };
}

function interpInside(slot: Slot): Done {
  const { ctx, an } = slot;
  const text = slot.after;
  const up = /\b(?:ausbruch|bricht)\b.*\b(?:nach\s+oben|ueber|hoch)\b|\bnach\s+oben\b|\bueber\b/.test(text);
  const down = /\bnach\s+unten\b|\bunter\b/.test(text);
  const breakOut = /\b(?:ausbruch|ausbrechen|bricht|ausbruechen|breakout)\b/.test(text) || up || down;
  const l = leaf("insideBar", { mode: breakOut ? (down && !up ? "breakDown" : "breakUp") : "inside", ...withinPart(withinOf(text)?.n) });
  const tailW = /^\s*(?:nach\s+(?:oben|unten)\s+)?(?:ausbruch|ausbricht|ausbrechen|bricht\s+aus|ausbruechen|breakout)?/.exec(text);
  const end = an.b + (tailW ? tailW[0].length : 0);
  emit(ctx, l, an.a, end, { a: an.b, b: slot.winEnd });
  return { end };
}

function interpHeikin(slot: Slot): Done {
  const { ctx, an } = slot;
  const text = slot.after;
  const n = /(\d+)\s*(?:gruene|rote|kerzen)/.exec(text);
  const red = /\b(?:rot\w*|bearish|baerisch\w*)\b/.test(text);
  const green = /\b(?:gruen\w*|bullish|bullisch\w*)\b/.test(text);
  const flip = /\b(?:wechsel\w*|dreht|flip\w*|umkehr\w*)\b/.test(text);
  if (red === green) return dangling(ctx, an, "Heikin-Ashi: es fehlt die Farbe (grün / rot) oder der Wechsel.");
  const l = leaf("heikin", flip ? { mode: green ? "flipUp" : "flipDown", ...withinPart(evWithin(ctx, withinOf(text)?.n ?? null)) } : { mode: green ? "bull" : "bear", n: n ? Number(n[1]) : 3 });
  const upTo = Math.max(...[/\b(?:gruen\w*|rot\w*|bullish|bullisch\w*|bearish|baerisch\w*)\b/, /\bkerzen?\b/, /\bin\s+folge\b/, /\b(?:wechsel\w*|dreht|flip\w*|umkehr\w*)\b/].map((r) => { const m = r.exec(text); return m ? m.index + m[0].length : 0; }));
  const lead3 = n ? n.index : 0;
  void lead3;
  emit(ctx, l, an.a, an.b + upTo, { a: an.b, b: slot.winEnd });
  return { end: an.b + upTo };
}

const INTERP: Record<Kind, (s: Slot) => Done> = {
  price: interpPrice,
  rsi: interpRsi,
  ma: interpMa,
  macd: interpMacd,
  boll: interpBoll,
  atr: interpAtr,
  volatility: interpAtr,
  vol: interpVolume,
  stoch: interpStoch,
  adx: interpAdx,
  supertrend: interpSupertrend,
  vwap: interpVwap,
  cci: interpCci,
  willr: interpWillr,
  donchian: interpDonchian,
  breakout: interpBreakout,
  inside: interpInside,
  heikin: interpHeikin,
  golden: interpGolden,
};

/* ----------------------------------------------------------------------------------------------- the pass */

export function extractConditions(ctx: Ctx): void {
  const anchors = findAnchors(ctx.w);
  const winEnds = anchors.map((an, j) => {
    const sentEnd = ctx.w.slice(an.b).search(SENT_RX);
    return Math.min(anchors[j + 1] ? anchors[j + 1]!.a : ctx.w.length, sentEnd >= 0 ? an.b + sentEnd : ctx.w.length);
  });
  let cursor = 0;
  let last: Last | null = null;
  for (let i = 0; i < anchors.length; i++) {
    const an = anchors[i]!;
    const winEnd = winEnds[i]!;
    // text already read is blank, so the window only holds what is left
    const beforeStart = Math.max(cursor, i > 0 ? anchors[i - 1]!.b : 0);
    const prev = anchors[i - 1];
    const price = prev && prev.kind === "price" && prev.b >= cursor && !SENT_RX.test(ctx.w.slice(prev.b, an.a)) && an.kind !== "price" ? prev : null;
    const slot: Slot = { ctx, an, i, anchors, before: ctx.w.slice(beforeStart, an.a), beforeStart, after: ctx.w.slice(an.b, winEnd), winEnd, winEnds, price, last };
    const r = INTERP[an.kind](slot);
    // a price anchor that was only the lead of the next anchor stays unread until that one has used it
    if (r.last !== undefined) last = r.last;
    cursor = Math.max(cursor, r.end);
    if (r.skip) i += r.skip;
    if (an.kind === "price" && r.end > an.b) cursor = r.end;
  }
  loosePatterns(ctx);
}

/** Runs `fn` for every match of `rx` in the working text. */
function each2(ctx: Ctx, rx: RegExp, fn: (m: RegExpExecArray) => void): void {
  const g = new RegExp(rx.source, "g");
  for (let guard = 0, m = g.exec(ctx.w); m && guard < 50; guard++, g.lastIndex = Math.max(g.lastIndex, m.index + 1), m = g.exec(ctx.w)) fn(m);
}

/* ----------------------------------------------------------------------------- words without an indicator name */

interface Loose {
  rx: RegExp;
  why: string;
  ask?: { id: string; text: string; options: { id: string; label: string }[] };
}

const UNSUPPORTED: readonly Loose[] = [
  { rx: /\b(?:hammer|doji|engulfing\w*|pin[- ]?bar|morning[- ]?star|evening[- ]?star|shooting[- ]?star|kerzenmuster\w*|candlestick\w*|dreifach\w*\s+boden|tweezer|marubozu)\b/, why: "Kerzenmuster (Hammer, Doji, Engulfing …) sind im Labor kein Baustein – es kennt Inside Bar und Heikin-Ashi." },
  { rx: /\b(?:order[- ]?block\w*|fair[- ]?value[- ]?gap\w*|fvg|liquiditaet\w*|liquidity|smart[- ]?money|imbalance\w*|break[- ]?of[- ]?structure|bos|choch|market[- ]?structure|marktstruktur)\b/, why: "Dafür (Order Block, Fair Value Gap, Liquidität, Marktstruktur …) gibt es im Labor keinen Baustein." },
  { rx: /\b(?:divergenz\w*|divergence)\b/, why: "Divergenzen kennt das Labor nur im Einstiegs-Check der Übersicht, nicht als Baustein." },
  { rx: /\b(?:open[- ]?interest|long[- ]?short[- ]?ratio|sentiment\w*|news|nachrichten|walbewegung\w*|whales?|orderflow|order[- ]?flow|cvd|heatmap\w*|liquidations?|funding[- ]?rate\w*)\b/, why: "Dazu hat das Labor keine Historie, die es auf jeder Kerze prüfen könnte (nur das Funding als eigener Baustein)." },
  { rx: /\b(?:ichimoku|kumo|wolke|keltner\w*|fibonacci|fib\b|golden[- ]?pocket|pivot\w*)\b/, why: "Diesen Baustein gibt es im Labor, aber seine Einstellungen lassen sich nicht sicher aus einem Satz lesen – baue ihn unter „Eigene Idee“ im Labor." },
  {
    rx: /\b(?:support\w*|resistance|widerstand\w*|unterstuetzung\w*|supply|demand|nachfragezone\w*)\b/,
    why: "Support und Widerstand brauchen einen konkreten Preis – ohne Zahl kann das Labor sie nicht auf jeder Kerze prüfen (z. B. „Kurs über 65.000“).",
  },
  { rx: /\b(?:pullback\w*|ruecksetzer\w*|korrektur\w*|retest\w*|dip\w*)\b/, why: "„Pullback“ ist als Regel nicht eindeutig: zurück wohin? Nenne eine Bedingung (z. B. „Kurs berührt das untere Bollinger-Band“ oder „RSI unter 40“)." },
  { rx: /\b(?:momentum|dynamik|kraft)\b/, why: "„Momentum“ ist als Regel nicht eindeutig – nenne einen Indikator (RSI, MACD, Stochastic)." },
  { rx: /\b(?:bestaetig\w*|bestaetigung)\b/, why: "„Bestätigung“ kennt das Labor nur als Bedingung auf der Kerze selbst (z. B. Schluss über einem Niveau), nicht als Warten auf die nächste Kerze." },
  { rx: /\b(?:aufwaertstrend\w*|abwaertstrend\w*|uptrend|downtrend|trendrichtung|im\s+trend|trendfolge\w*|trendfilter)\b/, why: "„Trend“ ist als Regel nicht eindeutig – das Labor braucht eine Bedingung dafür.", ask: { id: "trend", text: "Woran soll der Trend gemessen werden?", options: [{ id: "ema200", label: "Kurs über EMA 200 (Tageschart)" }, { id: "ema50", label: "Kurs über EMA 50" }, { id: "supertrend", label: "Supertrend aufwärts" }, { id: "none", label: "weglassen" }] } },
];

function loosePatterns(ctx: Ctx): void {
  // "Widerstand bei 70000 bricht": a named level with a price and a breaking verb is a crossing of that price
  each2(ctx, /\b(widerstand|resistance|resistanz|support|unterstuetzung)\w*\s+(?:bei|von|auf|ab|um)?\s*(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(?:\w+\s+){0,2}?(bricht|durchbricht|ueberwindet|ueberschreitet|unterschreitet|durchstoesst)\b/, (m) => {
    const up = /^(widerstand|resistance|resistanz)/.test(m[1]!) ? !/unterschreit/.test(m[3]!) : /ueberschreit|ueberwind/.test(m[3]!);
    const level = parseLevel(m[2]!);
    ctx.add({ kind: "cond", node: leaf("keyLevel", { level, mode: up ? "crossAbove" : "crossBelow", ...withinPart(evWithin(ctx, null)) }), a: m.index, b: m.index + m[0].length });
  });
  // "überverkauft / überkauft" without an indicator name: read as RSI(14), visibly
  for (const [word, os] of [[/\b(ueberverkauft\w*|oversold)\b/, true], [/\b(ueberkauft\w*|overbought)\b/, false]] as const) {
    const m = word.exec(ctx.w);
    if (!m) continue;
    const def = os ? 30 : 70;
    const level = lvlAnswer(ctx, os ? "oversold" : "overbought", def, os);
    const neg = negatedAt(ctx.w, m.index);
    const l = leaf("rsi", { len: 14, mode: os ? "below" : "above", level }, neg);
    ctx.assume({ id: os ? "oversold" : "overbought", text: `„${os ? "überverkauft" : "überkauft"}“ ohne Indikator gelesen als RSI(14) ${os ? "unter" : "über"} ${de(def)}. Schreib eine Zahl oder einen anderen Indikator in den Text, wenn du etwas anderes meinst.`, options: (os ? [20, 25, 30] : [70, 75, 80]).map((v) => ({ id: String(v), label: `${os ? "unter" : "über"} ${v}` })), def: String(def) });
    ctx.add({ kind: "cond", node: l, a: m.index, b: m.index + m[0].length });
  }
  for (const u of UNSUPPORTED) {
    const g = new RegExp(u.rx.source, "g");
    for (let m = g.exec(ctx.w); m; m = g.exec(ctx.w)) {
      if (u.ask?.id === "trend") {
        const a = ctx.answer("trend", ["ema200", "ema50", "supertrend", "none"]);
        const bearish = /abwaerts|down/.test(m[0]);
        if (a === "ema200") ctx.add({ kind: "cond", node: { ...leaf("maPrice", { type: "ema", len: 200, mode: bearish ? "below" : "above" }), tf: "1d" }, a: m.index, b: m.index + m[0].length });
        else if (a === "ema50") ctx.add({ kind: "cond", node: leaf("maPrice", { type: "ema", len: 50, mode: bearish ? "below" : "above" }), a: m.index, b: m.index + m[0].length });
        else if (a === "supertrend") ctx.add({ kind: "cond", node: leaf("supertrend", { mode: bearish ? "down" : "up" }), a: m.index, b: m.index + m[0].length });
        else ctx.noteUnclear(m.index, m.index + m[0].length, u.why);
        ctx.ask({ id: u.ask.id, text: u.ask.text, options: u.ask.options, blocking: false, span: { a: m.index, b: m.index + m[0].length } });
        ctx.consume(m.index, m.index + m[0].length);
        continue;
      }
      ctx.noteUnclear(m.index, m.index + m[0].length, u.why);
    }
  }
}
