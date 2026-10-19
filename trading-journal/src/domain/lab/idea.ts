/**
 * "Diese Idee testen" (F12): turns a Box setup, the entry check (Einstiegs-Check verdict) or a journal combination
 * (setup + weekday + session … from the edge finder) into a complete draft of the lab's "Eigene Idee" – market,
 * execution interval, side, rule tree, stop and target. Pure and deterministic: no React, no I/O, no model.
 *
 * Honesty rules of the translation:
 * - Nothing is dropped silently. Every part that is not turned into a rule is listed in `gaps` with its reason;
 *   approximations and defaults the translation had to choose are listed in `notes`.
 * - A rule is only built where the lab can evaluate it on history. Top-trader ratios, the Lage-Ampel, the box quality or
 *   free-text setups have no history in the lab – they become gaps, never a stand-in.
 * - The result is a RULE, not the moment it came from: a setup that exists now says nothing about the past until the lab
 *   has run the rule over history. `testable` is false when no rule at all could be built (the lab is then not changed).
 */
import type { BoxSetup, BoxTf } from "../boxes";
import { MIN_RISK_FRAC } from "../backtest/engine";
import { sanitizeParams } from "./rules/blocks";
import { defaultCustom, exitsText, leafText, leavesOf, mirrorGroup, newGroup, sanitizeCustom, stopText, validateCustom } from "./rules/tree";
import { EXEC_TFS, TF_LABEL, type BlockId, type CustomConfig, type Group, type Leaf, type LeafParams, type SidesCfg, type TfId } from "./rules/types";
import type { Verdict } from "../signals/verdict";

export interface IdeaGap {
  /** what could not be turned into a rule */
  what: string;
  /** why not (German, one sentence) */
  why: string;
}

export interface IdeaDraft {
  source: "box" | "signal" | "combo";
  /** where the idea comes from, one line ("Box-Setup: Ausbruch Long · 4h · Note A") */
  origin: string;
  /** Binance symbol (`BTCUSDT`) or `null` = the lab keeps its current market */
  symbol: string | null;
  /** the complete "Eigene Idee" (already sanitised) */
  config: CustomConfig;
  /** what was taken over, in plain language: market, side, every condition, stop, target */
  mapped: string[];
  /** approximations and defaults the translation chose */
  notes: string[];
  /** what could not be taken over, each with its reason */
  gaps: IdeaGap[];
  /** at least one rule exists and the lab accepts the configuration */
  testable: boolean;
  /** why it is not testable (`null` when it is) */
  blocked: string | null;
}

/** The parts of a Box setup the translation reads. */
export type BoxSetupLike = Pick<BoxSetup, "side" | "kind" | "grade" | "title" | "entry" | "stop" | "rr" | "reasons"> & { targets: readonly { price: number }[] };

/** The parts of an entry-check verdict the translation reads. */
export type VerdictLike = Pick<Verdict, "side" | "valid" | "strength" | "label"> & {
  state?: Verdict["state"];
  parts?: ReadonlyArray<{ id: string; bonus: boolean; ok: boolean; data: boolean }>;
  lage?: { blocked?: boolean } | null;
};

export interface IdeaFactor {
  dim: string;
  key: string;
  label: string;
}

export type IdeaInput =
  | { kind: "box"; symbol: string | null; tf: BoxTf; setup: BoxSetupLike; /** bars the box spans, for the breakout look-back */ boxBars: number | null }
  | { kind: "signal"; symbol: string | null; verdict: VerdictLike; /** the base timeframe of the ladder (`settings.signals.ladder[0]`) */ baseTf: string | null }
  | { kind: "combo"; label: string; factors: readonly IdeaFactor[] };

/* ------------------------------------------------------------------ helpers */

const de = (v: number): string => String(Math.round(v * 100) / 100).replace(".", ",");
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

class Builder {
  private n = 0;
  readonly gaps: IdeaGap[] = [];
  readonly notes: string[] = [];
  readonly leaves: Leaf[] = [];
  gap(what: string, why: string): void {
    this.gaps.push({ what, why });
  }
  note(text: string): void {
    this.notes.push(text);
  }
  leaf(block: BlockId, params: LeafParams, tf: "exec" | TfId = "exec", not = false): Leaf {
    const l: Leaf = { type: "leaf", id: `n${++this.n}`, block, tf, params: sanitizeParams(block, { ...sanitizeParams(block, {}), ...params }) };
    if (not) l.not = true;
    this.leaves.push(l);
    return l;
  }
}

const NO_HISTORY_TRADERS = "Das Labor hat keine Historie der Top-Trader-Positionen (Binance hält sie nur rund 30 Tage).";
const NO_HISTORY_LAGE = "Das Labor hat keine Historie der Lage-Ampel.";

interface Assemble {
  source: IdeaDraft["source"];
  origin: string;
  name: string;
  symbol: string | null;
  interval: TfId;
  side: "long" | "short" | null;
  b: Builder;
  stop?: Partial<CustomConfig["stop"]>;
  target?: CustomConfig["target"];
}

/** Builds the draft from the collected leaves (AND) for one side; the other side stays the mirror image, unused. */
function assemble(a: Assemble): IdeaDraft {
  const side = a.side ?? "long";
  const group: Group = newGroup(side === "long" ? "g1" : "g2", "and", a.b.leaves);
  const base = defaultCustom();
  const own = { ...base, name: a.name, interval: a.interval, sides: side as SidesCfg, stop: { ...base.stop, ...a.stop }, target: a.target ?? base.target };
  const mirrored = a.b.leaves.length ? mirrorGroup(group, side === "long" ? "g2" : "g1", a.b.leaves.length + 1) : newGroup(side === "long" ? "g2" : "g1");
  const config = sanitizeCustom({ ...own, long: side === "long" ? group : mirrored, short: side === "short" ? group : mirrored });
  const errors = validateCustom(config).filter((i) => i.level === "error");
  // a rule that consists only of exclusions („NICHT …“) fires on almost every candle: that is no idea
  const hasRule = leavesOf(config[side]).some((l) => !l.not);
  const blocked = !hasRule
    ? "Aus dieser Quelle ergibt sich keine Regel, die das Labor auf Kerzen prüfen kann. Der Regel-Editor bleibt unverändert."
    : errors.length
      ? errors[0]!.text
      : null;
  const mapped = [
    `Markt${a.symbol ? ` ${a.symbol}` : " (unverändert)"}, Zeiteinheit ${TF_LABEL[config.interval]}, ${side === "long" ? "nur Long" : "nur Short"}`,
    ...leavesOf(config[side]).map(leafText),
    `Stop: ${stopText(config.stop)}`,
    ...exitsText(config),
  ];
  return { source: a.source, origin: a.origin, symbol: a.symbol, config, mapped, notes: a.b.notes, gaps: a.b.gaps, testable: blocked === null, blocked };
}

const sideWord = (s: "long" | "short"): string => (s === "long" ? "Long" : "Short");
const isExec = (tf: string): tf is TfId => (EXEC_TFS as readonly string[]).includes(tf);

/* ------------------------------------------------------------------ Box setup */

const BOX_TF_TEXT: Readonly<Record<BoxTf, string>> = { "4h": "4h", "1d": "1D", "1w": "1W" };

type ReasonClass = "range" | "rsiBreak" | "rsiNoOpposite" | "boxQuality" | "traders" | "htf" | "closeBreak" | "fresh" | "retestHolds" | "rsiPush" | "other";

/** Classifies a reason of `boxSetups` (setups.ts) by its text; anything unknown is `other` and becomes a gap. */
export function classifyBoxReason(text: string): ReasonClass {
  if (/^Preis im (unteren|oberen) Viertel der Box/.test(text)) return "range";
  if (/^RSI-(Abwärts|Aufwärts)linie (nach oben|nach unten) gebrochen$/.test(text) || /^RSI-(Abwärts|Aufwärts)linie gebrochen$/.test(text)) return "rsiBreak";
  if (/^Keine gebrochene RSI-/.test(text)) return "rsiNoOpposite";
  if (/^Box (stark|solide|schwach)/.test(text)) return "boxQuality";
  if (/^Top Trader/.test(text)) return "traders";
  if (/^Höherer Timeframe/.test(text)) return "htf";
  if (/^Schlusskurs (über dem Widerstand|unter dem Support)$/.test(text)) return "closeBreak";
  if (text === "Ausbruch ist frisch") return "fresh";
  if (text === "Retest der Kante hält") return "retestHolds";
  if (/^RSI drückt gegen/.test(text)) return "rsiPush";
  return "other";
}

/** Box setup → idea. The box itself is approximated by its look-back (breakout) or the premium / discount zone (range). */
export function ideaFromBoxSetup(input: Extract<IdeaInput, { kind: "box" }>): IdeaDraft {
  const { setup, tf } = input;
  const b = new Builder();
  const side = setup.side;
  const up = side === "long";
  const interval: TfId = tf === "1w" ? "1d" : tf;
  if (tf === "1w") b.gap("Zeiteinheit 1W", "Das Labor rechnet höchstens auf 1D-Kerzen; der Test läuft auf 1D.");

  // the structural trigger
  const kind = setup.kind;
  if (kind === "breakout" || kind === "retest") {
    const n = input.boxBars != null ? clamp(Math.round(input.boxBars), 2, 400) : 20;
    // "Ausbruch ist frisch" (≤ 6 Kerzen her) lets the break lie a few candles back; a retest happens later still
    const fresh = setup.reasons.some((r) => r.ok && classifyBoxReason(r.text) === "fresh");
    b.leaf("breakout", { mode: up ? "up" : "down", n, within: kind === "retest" ? 12 : fresh ? 6 : 1 });
    b.note(
      `Näherung: Die Box selbst ist kein Baustein. Als Ausbruch gilt ein Schluss ${up ? "über dem Hoch" : "unter dem Tief"} der letzten ${n} Kerzen${input.boxBars == null ? " (Standard, die Boxlänge war unbekannt)" : " (die Länge der Box)"}.`,
    );
    if (kind === "retest") b.gap("Rücktest der Kante", "Das Labor prüft den Ausbruch, aber nicht, ob der Kurs danach zur Kante zurückkehrt und hält (eine Box-Kante ist kein fester Preis in der Historie).");
  } else if (kind === "range") {
    b.leaf("zone", { mode: up ? "discount" : "premium", size: 50 });
    b.note(`Näherung: „${up ? "unteres" : "oberes"} Viertel der Box“ wird als ${up ? "Discount" : "Premium"}-Zone der Swing-Spanne geprüft (nicht als echte Box).`);
  } else if (kind === "fakeout") {
    b.gap("Fehlausbruch", "Docht über der Kante mit Schluss zurück in der Box ist im Labor kein Baustein.");
  } else {
    b.gap("Ausbruch vorbereitet", "Das Setup wartet noch auf den Kerzenschluss über (unter) der Box; ein Vorab-Zustand lässt sich nicht als Regel auf Historie prüfen.");
  }

  // the graded reasons
  const unmet: string[] = [];
  for (const r of setup.reasons) {
    const c = classifyBoxReason(r.text);
    if (c === "closeBreak" || c === "range" || c === "fresh" || c === "retestHolds") {
      if (!r.ok) unmet.push(r.text);
      continue; // already handled by the trigger
    }
    if (!r.ok) {
      unmet.push(r.text);
      continue;
    }
    switch (c) {
      case "rsiBreak":
        b.leaf("rsiLine", { mode: up ? "breakUp" : "breakDown", within: 3 });
        break;
      case "rsiNoOpposite":
        b.leaf("rsiLine", { mode: up ? "breakDown" : "breakUp", within: 3 }, "exec", true);
        break;
      case "boxQuality":
        b.gap(r.text, "Die Qualität der Box (Berührungen, Dauer) ist kein Baustein im Regelbaum.");
        break;
      case "traders":
        b.gap(r.text, NO_HISTORY_TRADERS);
        break;
      case "htf":
        b.gap(r.text, "Die Phase der höheren Box ist kein Baustein; ein Trendfilter auf dem höheren Zeitrahmen wäre etwas anderes.");
        break;
      case "rsiPush":
        b.gap(r.text, "Der Abstand des RSI zu seiner Trendlinie ist kein Baustein; nur der Bruch ist einer.");
        break;
      default:
        b.gap(r.text, "Dafür gibt es keinen passenden Baustein.");
    }
  }
  if (unmet.length) b.note(`Im Setup nicht erfüllt und deshalb nicht Teil der Regeln: ${unmet.join("; ")}.`);

  // stop and target of the plan
  const stop: Partial<CustomConfig["stop"]> = {};
  const minPct = Math.round(MIN_RISK_FRAC * 100 * 100) / 100 + 0.01;
  if (setup.entry > 0 && Number.isFinite(setup.stop) && setup.stop > 0) {
    const raw = (Math.abs(setup.entry - setup.stop) / setup.entry) * 100;
    const pct = clamp(Math.round(raw * 100) / 100, minPct, 30);
    stop.kind = "percent";
    stop.pct = pct;
    b.note(`Stop: ${de(pct)} % Abstand wie im Setup-Plan${pct !== Math.round(raw * 100) / 100 ? ` (der Plan hatte ${de(raw)} %, das Labor erlaubt ${de(minPct)}–30 %)` : ""}; er hängt im Test nicht an der Box-Kante, sondern am Schlusskurs.`);
  } else b.gap("Stop des Plans", "Der Plan hat keinen verwertbaren Stop; das Labor nimmt seinen Standard (1,5 × ATR).");
  let target: CustomConfig["target"] | undefined;
  if (setup.rr != null && setup.rr > 0) {
    const r = clamp(Math.round(setup.rr * 10) / 10, 0.25, 20);
    target = { kind: "r", r };
    b.note(`Ziel: ${de(r)} R, das CRV zum ersten Ziel des Plans.`);
  } else {
    target = { kind: "none", r: 2 };
    b.gap("Ziel des Plans", "Das Setup hat kein Ziel mit CRV; der Test läuft ohne festes Ziel.");
  }
  if (setup.targets.length > 1) b.gap(`Weitere Ziele (${setup.targets.length - 1})`, "Das Labor kennt ein Ziel in R und optional einen Teilverkauf, aber keine Kette von Preiszielen.");
  b.note("Der Einstiegspreis des Plans ist der Kurs von jetzt. Das Labor steigt immer zur Eröffnung der Kerze nach dem Signal ein und nur bei einem NEUEN Signal.");

  return assemble({
    source: "box",
    origin: `Box-Setup: ${setup.title} · ${BOX_TF_TEXT[tf]} · Note ${setup.grade}`,
    name: `Idee: ${setup.title} ${BOX_TF_TEXT[tf]}`,
    symbol: input.symbol,
    interval,
    side,
    b,
    stop,
    target,
  });
}

/* ------------------------------------------------------------------ entry check */

/** Entry-check verdict → idea: the lab's own MCB ladder block IS this check, evaluated candle by candle. */
export function ideaFromSignal(input: Extract<IdeaInput, { kind: "signal" }>): IdeaDraft {
  const v = input.verdict;
  const b = new Builder();
  const side = v.side;
  const base = (input.baseTf ?? "").toLowerCase();
  const interval: TfId = base === "4h" || base === "1d" ? "4h" : "1h";
  const traders = v.parts?.find((p) => p.id === "traders" && p.data);
  // the lab's check has no top-trader part: its bonus point cannot be reproduced
  const ownStrength = v.valid ? v.strength - (traders?.bonus ? 1 : 0) : 1;
  const minStrength = clamp(ownStrength, 1, 5);
  b.leaf("mcbLadder", { mode: side === "long" ? "validLong" : "validShort", minStrength });
  b.note(`Das Labor nutzt deine aktuelle Einstellung der Leiter (Zeitebenen, RSI, WaveTrend, Swing) und prüft sie im Takt ${TF_LABEL[interval]}${base && base !== interval ? ` (dein Check läuft auf ${input.baseTf})` : ""}.`);
  b.note(
    v.valid
      ? `Mindest-Stärke ${minStrength}: so stark ist der aktuelle ${sideWord(side)}-Einstieg${traders?.bonus ? " ohne den Bonuspunkt der Top-Trader" : ""}.`
      : `Aktuell ist kein gültiger ${sideWord(side)}-Einstieg offen; getestet wird die Regel „gültig ab Stärke 1“, nicht der Moment.`,
  );
  if (v.state === "provisional") b.note("Der aktuelle Einstieg ist noch vorläufig (die Basiskerze läuft). Das Labor zählt nur geschlossene Kerzen.");
  b.gap("Top-Trader-Teil", NO_HISTORY_TRADERS);
  b.gap("Lage-Ampel", NO_HISTORY_LAGE);
  b.note("Stop und Ziel sind die Standardwerte des Labors (1,5 × ATR, 2 R); der Einstiegs-Check bestimmt sie nicht.");
  return assemble({
    source: "signal",
    origin: `Einstiegs-Check: ${v.label}`,
    name: `Idee: Einstiegs-Check ${sideWord(side)}`,
    symbol: input.symbol,
    interval,
    side,
    b,
  });
}

/* ------------------------------------------------------------------ journal combination */

const WEEKDAY_BY_INDEX = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Symbol of a journal pair ("BTC/USDT", "BTCUSDT.P") or `null` when it is no plain Binance USDT symbol. */
export function symbolOfPair(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/\.P$/, "").replace(/[/\-_\s]/g, "");
  return /^[A-Z0-9]{2,20}USDT$/.test(s) ? s : null;
}

/** Journal combination (factors of an edge / leak) → idea. Journal-only factors (feeling, size …) become gaps. */
export function ideaFromCombo(input: Extract<IdeaInput, { kind: "combo" }>): IdeaDraft {
  const b = new Builder();
  let side: "long" | "short" | null = null;
  let symbol: string | null = null;
  let interval: TfId | null = null;
  let weekday = "any";
  let session = "any";
  let strength: number | null = null;
  const names: string[] = [];
  for (const f of input.factors) {
    switch (f.dim) {
      case "side":
        side = f.key === "short" ? "short" : "long";
        break;
      case "asset": {
        const s = symbolOfPair(f.key);
        if (s) symbol = s;
        else b.gap(f.label, "Das Labor testet Binance-USDT-Perps; dieses Paar kennt es nicht.");
        break;
      }
      case "timeframe": {
        const tf = f.key.toLowerCase();
        if (isExec(tf)) interval = tf;
        else b.gap(`Timeframe ${f.label}`, "Das Labor rechnet auf 15m bis 1D.");
        break;
      }
      case "weekday": {
        const w = WEEKDAY_BY_INDEX[Number(f.key)];
        if (w) weekday = w;
        else b.gap(f.label, "Der Wochentag ist nicht lesbar.");
        break;
      }
      case "session":
        if (["asia", "london", "ny", "late", "weekend"].includes(f.key)) session = f.key;
        else b.gap(f.label, "Diese Session kennt das Labor nicht.");
        break;
      case "strength": {
        const k = Number(f.key);
        if (Number.isFinite(k) && k >= 1) strength = k;
        else b.gap(f.label, "Ohne Einstiegs-Check gibt es keine Regel.");
        break;
      }
      case "setup":
        names.push(f.label);
        b.gap(`Setup „${f.label}“`, "Ein Journal-Setup ist ein Playbook mit Beschreibung und Checkliste, keine Regel; das Labor kann es nicht auswerten. Ergänze die Regeln selbst.");
        break;
      case "box":
        b.gap(f.label, "Die Box-Note gehört zu einem Setup zum Einstiegszeitpunkt; im Labor ist die Box kein Baustein.");
        break;
      case "regime":
        b.gap(f.label, NO_HISTORY_LAGE);
        break;
      case "volatility":
        b.gap(f.label, "Die Volatilitätsstufe des Journals ist keine Regel; der Baustein „ATR in %“ nutzt ein eigenes Perzentil und müsste von dir gewählt werden.");
        break;
      case "behavior":
      case "emotion":
      case "conviction":
        b.gap(f.label, "Verhalten und Gefühl entstehen beim Handeln; die Kerzen kennen sie nicht.");
        break;
      case "riskPct":
      case "leverage":
        b.gap(f.label, "Positionsgröße und Hebel stellst du im Labor als Risiko pro Trade und Maximalhebel ein; sie sind keine Signalregel.");
        break;
      default:
        b.gap(f.label, "Dieses Merkmal ist kein Marktzustand, den das Labor auf Kerzen prüfen kann.");
    }
  }
  if (strength != null) {
    const exec: TfId = interval === "4h" ? "4h" : "1h";
    if (interval && interval !== "1h" && interval !== "4h") b.gap(`Timeframe ${TF_LABEL[interval]}`, "Der Einstiegs-Check läuft im Labor nur auf 1h oder 4h; der Test nimmt 1h.");
    interval = exec;
    b.leaf("mcbLadder", { mode: side === "short" ? "validShort" : "validLong", minStrength: clamp(strength, 1, 5) });
    b.note(`Signal-Stärke ${strength}: getestet wird „Stärke ≥ ${strength}“ (der Journal-Wert ist genau diese Stärke).`);
  }
  if (weekday !== "any" || session !== "any") {
    b.leaf("timeWindow", { weekday, session });
    b.note("Wochentag und Session rechnet das Labor in UTC; das Journal nimmt beim Wochentag deine Ortszeit. Nahe Mitternacht kann das einen Tag verschieben.");
    if (strength == null) b.note("Die Kombination enthält keinen Einstiegsauslöser. Das Labor steigt deshalb zu Beginn jedes passenden Zeitfensters ein, mit den Standardwerten für Stop und Ziel.");
  }
  if (!side) {
    side = "long";
    b.note("Die Kombination nennt keine Richtung: der Test startet mit Long (im Regel-Editor änderbar).");
  }
  b.note("Stop und Ziel sind die Standardwerte des Labors (1,5 × ATR, 2 R).");
  const name = (names[0] ? `Idee: ${names[0]}` : `Idee: ${input.label}`).slice(0, 60);
  return assemble({ source: "combo", origin: `Journal-Kombination: ${input.label}`, name, symbol, interval: interval ?? "1h", side, b });
}

/** Dispatcher. */
export function translateIdea(input: IdeaInput): IdeaDraft {
  return input.kind === "box" ? ideaFromBoxSetup(input) : input.kind === "signal" ? ideaFromSignal(input) : ideaFromCombo(input);
}
