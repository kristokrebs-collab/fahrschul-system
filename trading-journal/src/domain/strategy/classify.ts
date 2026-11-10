/**
 * Automatic classification of trades into Entscheidungsgrundlagen (P07, pure). For a trade it weighs, per setup:
 *
 * - the setup's own recognition rules (`auto`): Box-zu-Box setup kind and grade at entry (`trade.boxSnap`), strength
 *   of the stored entry check (`trade.signal`), session, side;
 * - without rules: what the setup's texts say (name, rules, criteria, tags – "Ausbruch", "Range", "Sweep", "MCB", "Long" …);
 * - its markets / timeframes and account;
 * - the trader's own history: how often trades with this pair, side, session and timeframe were tagged with the setup
 *   (Laplace-smoothed likelihood ratio – the classifier learns from every tag);
 *
 * → a log score per setup, a softmax over all setups and a confidence = probability × evidence coverage (a guess on
 * one weak hint never reads "hoch"). Hard rules exclude a setup instead of weighing against it: a setup of the other
 * account, or an explicit side rule the trade breaks. The multi-TF setup (`s_mtf`) recognises a valid stored entry
 * check by itself.
 * Every suggestion carries its reasons. Bulk: `classifyUntagged` for trades without any setup.
 */
import { boxGradeOf, boxSnapOf, type Grade, type SetupKind } from "../boxes";
import { MTF_SETUP_ID } from "../defaults";
import { snapOf } from "../insights/signal";
import { sessionOf, type SessionKey } from "../insights/time";
import { tradeTime } from "@/lib/dates";
import type { Setup, Side, Trade } from "../types";
import { marketKey, strategyOf, type SetupX } from "./types";

export type ConfidenceLevel = "hoch" | "mittel" | "niedrig";
export const LEVEL_MIN: Readonly<Record<Exclude<ConfidenceLevel, "niedrig">, number>> = { hoch: 0.7, mittel: 0.45 };
export const levelOf = (c: number): ConfidenceLevel => (c >= LEVEL_MIN.hoch ? "hoch" : c >= LEVEL_MIN.mittel ? "mittel" : "niedrig");

export interface Reason {
  text: string;
  ok: boolean;
}

export interface Suggestion {
  setupId: string;
  name: string;
  color: string;
  /** 0…1 */
  confidence: number;
  level: ConfidenceLevel;
  /** the softmax probability before the coverage factor */
  probability: number;
  reasons: Reason[];
}

type Ctx = Pick<Trade, "side" | "pair" | "timeframe" | "account" | "date" | "createdAt" | "boxSnap" | "signal">;

const GRADE_RANK: Readonly<Record<Grade, number>> = { "A+": 4, A: 3, B: 2, C: 1 };
const KIND_WORDS: Readonly<Record<SetupKind, readonly string[]>> = {
  breakout: ["ausbruch", "breakout", "bruch über", "bruch unter", "bos"],
  retest: ["retest"],
  range: ["range", "support", "unterkante", "oberkante", "box"],
  fakeout: ["fakeout", "fehlausbruch", "sweep", "liquidität", "liquidity"],
  pre: [],
};
const SIGNAL_WORDS = ["mcb", "multi-tf", "multi tf", "einstiegs-check", "signal", "wavetrend"];
const LONG_WORDS = ["long", "kauf", "bull"];
const SHORT_WORDS = ["short", "verkauf", "bear"];

export const KIND_TEXT: Readonly<Record<SetupKind, string>> = { range: "Range-Trade", breakout: "Ausbruch", retest: "Retest", fakeout: "Fehlausbruch", pre: "vorbereiteter Ausbruch" };
export const SESSION_TEXT: Readonly<Record<SessionKey, string>> = { asia: "Asien", london: "London", ny: "New York", late: "Spät", weekend: "Wochenende" };

function textOf(x: SetupX): string {
  return [x.name, x.desc, ...x.checklist.map((c) => c.text), ...x.entryCriteria.map((c) => c.text), ...x.tags].join(" ").toLowerCase();
}

const has = (text: string, words: readonly string[]) => words.some((w) => text.includes(w));

interface Facts {
  side: Side;
  pair: string;
  tf: string;
  session: SessionKey;
  account: "makro" | "scalp";
  boxKind: SetupKind | null;
  boxGrade: Grade | null;
  signal: { strength: number; valid: boolean } | null;
}

function factsOf(t: Ctx): Facts {
  // only a snapshot of the trade's own pair (MM-6)
  const box = boxSnapOf(t);
  const snap = snapOf(t as Parameters<typeof snapOf>[0]);
  return {
    side: t.side,
    pair: t.pair ? marketKey(t.pair) : "",
    tf: t.timeframe ?? "",
    session: sessionOf(tradeTime(t)),
    account: t.account ?? "scalp",
    boxKind: box?.setup?.side === t.side ? box.setup.kind : null,
    boxGrade: box?.setup?.side === t.side ? boxGradeOf(t) : null,
    signal: snap && snap.side === t.side ? { strength: snap.strength, valid: snap.valid } : null,
  };
}

/** History model: per setup, counts of feature values among the trades tagged with it. */
export interface HistoryModel {
  total: number;
  perSetup: Map<string, { n: number; pair: Map<string, number>; side: Map<string, number>; session: Map<string, number>; tf: Map<string, number> }>;
  values: { pair: Set<string>; side: Set<string>; session: Set<string>; tf: Set<string> };
}

const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

/** Learns from tagged trades (each tag counts; trades without setups are ignored). */
export function historyModel(trades: readonly (Ctx & Pick<Trade, "setups">)[]): HistoryModel {
  const model: HistoryModel = { total: 0, perSetup: new Map(), values: { pair: new Set(), side: new Set(), session: new Set(), tf: new Set() } };
  for (const t of trades) {
    if (!t.setups?.length) continue;
    const f = factsOf(t);
    for (const id of t.setups) {
      let s = model.perSetup.get(id);
      if (!s) model.perSetup.set(id, (s = { n: 0, pair: new Map(), side: new Map(), session: new Map(), tf: new Map() }));
      s.n++;
      model.total++;
      if (f.pair) inc(s.pair, f.pair);
      inc(s.side, f.side);
      inc(s.session, f.session);
      if (f.tf) inc(s.tf, f.tf);
    }
    if (f.pair) model.values.pair.add(f.pair);
    model.values.side.add(f.side);
    model.values.session.add(f.session);
    if (f.tf) model.values.tf.add(f.tf);
  }
  return model;
}

export interface ClassifyOptions {
  /** learned history (`historyModel`), omitted = rules and texts only */
  history?: HistoryModel | null;
  /** setups to leave out (e.g. the backtest marker) */
  exclude?: readonly string[];
}

/** Suggestions for one trade, best first (empty without setups). */
export function classifyTrade(t: Ctx & { id?: string }, setups: readonly Setup[], o: ClassifyOptions = {}): Suggestion[] {
  const f = factsOf(t);
  const xs = setups.filter((s) => !o.exclude?.includes(s.id)).map(strategyOf);
  if (!xs.length) return [];
  // hard rules (the setup's account, an explicit side rule) exclude a setup instead of weighing against it
  const scored = xs.map((x) => scoreSetup(x, f, o.history ?? null)).filter((s) => !s.excluded);
  if (!scored.length) return [];
  const max = Math.max(...scored.map((s) => s.score));
  const exps = scored.map((s) => Math.exp(s.score - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return scored
    .map((s, i) => {
      const probability = exps[i]! / sum;
      // coverage: how much independent evidence there was (3 strong hints = full)
      const coverage = Math.min(1, s.evidence / 3);
      const confidence = Math.round(probability * coverage * 100) / 100;
      return { setupId: s.x.id, name: s.x.name, color: s.x.color, confidence, level: levelOf(confidence), probability, reasons: s.reasons };
    })
    .sort((a, b) => b.confidence - a.confidence || b.probability - a.probability);
}

function scoreSetup(x: SetupX, f: Facts, h: HistoryModel | null): { x: SetupX; score: number; evidence: number; reasons: Reason[]; excluded: boolean } {
  let excluded = false;
  let score = 0;
  let evidence = 0;
  const reasons: Reason[] = [];
  const add = (w: number, ev: number, text: string, ok: boolean) => {
    score += w;
    evidence += ev;
    reasons.push({ text, ok });
  };
  const text = textOf(x);
  // account
  if (x.account !== "both") {
    if (x.account === f.account) add(0.4, 0.3, `Konto ${f.account === "makro" ? "Makro" : "Scalp"} passt`, true);
    else excluded = true;
  }
  // side
  const sides = x.auto.sides.length ? x.auto.sides : has(text, LONG_WORDS) && !has(text, SHORT_WORDS) ? ["long"] : has(text, SHORT_WORDS) && !has(text, LONG_WORDS) ? ["short"] : [];
  if (sides.length) {
    const ok = sides.includes(f.side);
    // an explicit rule never takes the other side; a side read from the text weighs against it
    if (!ok && x.auto.sides.length) excluded = true;
    else add(ok ? 0.6 : -2.2, 0.4, ok ? `${f.side === "long" ? "Long" : "Short"} wie geplant` : `Nur ${sides[0] === "long" ? "Long" : "Short"}`, ok);
  }
  // Box-zu-Box at entry
  const kinds = x.auto.boxKinds.length ? x.auto.boxKinds : (Object.keys(KIND_WORDS) as SetupKind[]).filter((k) => has(text, KIND_WORDS[k]));
  const explicitKinds = x.auto.boxKinds.length > 0;
  if (kinds.length && f.boxKind) {
    const ok = kinds.includes(f.boxKind);
    add(ok ? (explicitKinds ? 2.6 : 1.6) : explicitKinds ? -1.6 : -0.5, ok ? 1 : 0.5, ok ? `Box-Setup beim Einstieg: ${KIND_TEXT[f.boxKind]}` : `Box-Setup war ${KIND_TEXT[f.boxKind]}`, ok);
  }
  if (x.auto.minGrade && f.boxGrade) {
    const ok = GRADE_RANK[f.boxGrade] >= GRADE_RANK[x.auto.minGrade];
    add(ok ? 1 : -1.2, 0.5, `Box-Note ${f.boxGrade}${ok ? "" : ` unter ${x.auto.minGrade}`}`, ok);
  }
  // stored entry check
  const isMtf = x.id === MTF_SETUP_ID;
  const minStrength = x.auto.minStrength ?? (isMtf || has(text, SIGNAL_WORDS) ? 2 : null);
  if (minStrength != null && f.signal) {
    const ok = f.signal.valid && f.signal.strength >= minStrength;
    add(ok ? (isMtf || x.auto.minStrength != null ? 2.6 : 1.4) : -1, ok ? 1 : 0.5, ok ? `Einstiegs-Check gültig, Stärke ${f.signal.strength}` : `Einstiegs-Check nur Stärke ${f.signal.strength}`, ok);
  }
  // session
  if (x.auto.sessions.length) {
    const ok = x.auto.sessions.includes(f.session);
    add(ok ? 0.8 : -1, 0.4, `Session ${SESSION_TEXT[f.session]}`, ok);
  }
  // markets / timeframes
  if (x.markets.length && f.pair) {
    const ok = x.markets.includes(f.pair);
    add(ok ? 1 : -2, 0.5, ok ? `Markt ${f.pair} gehört dazu` : `Markt ${f.pair} nicht vorgesehen`, ok);
  }
  if (x.tf.length && f.tf) {
    const ok = x.tf.includes(f.tf);
    add(ok ? 0.8 : -1, 0.4, ok ? `Timeframe ${f.tf} passt` : `Timeframe ${f.tf} nicht vorgesehen`, ok);
  }
  // learned history: log likelihood ratio of this setup's tags vs. all tags
  if (h && h.total > 0) {
    const s = h.perSetup.get(x.id);
    const prior = Math.log(((s?.n ?? 0) + 1) / (h.total + h.perSetup.size + 1));
    score += 0.35 * prior;
    if (s && s.n >= 3) {
      const ll = (m: Map<string, number>, v: string, card: number) => Math.log(((m.get(v) ?? 0) + 1) / (s.n + Math.max(2, card)));
      const base = (key: "pair" | "side" | "session" | "tf", v: string, card: number) => {
        let tot = 0;
        for (const o of h.perSetup.values()) tot += o[key].get(v) ?? 0;
        return Math.log((tot + 1) / (h.total + Math.max(2, card)));
      };
      let lr = 0;
      let used = 0;
      const parts: [("pair" | "side" | "session" | "tf"), string][] = [
        ["pair", f.pair],
        ["side", f.side],
        ["session", f.session],
        ["tf", f.tf],
      ];
      for (const [k, v] of parts) {
        if (!v) continue;
        const card = h.values[k].size;
        lr += ll(s[k], v, card) - base(k, v, card);
        used++;
      }
      if (used) {
        score += 0.6 * lr;
        evidence += Math.min(1.2, s.n / 10);
        const share = (s.pair.get(f.pair) ?? 0) / s.n;
        if (f.pair && share >= 0.5) reasons.push({ text: `${Math.round(share * 100)} % deiner ${x.name}-Trades waren ${f.pair}`, ok: true });
        else if (lr > 0.5) reasons.push({ text: "Ähnelt deinen bisherigen Trades dieser Grundlage", ok: true });
      }
    }
  }
  return { x, score, evidence, reasons: reasons.sort((a, b) => Number(b.ok) - Number(a.ok)), excluded };
}

export interface BulkSuggestion {
  tradeId: string;
  best: Suggestion;
  alternatives: Suggestion[];
}

/**
 * Suggestions for every trade WITHOUT a setup (the history of the tagged trades is learned first). Only suggestions
 * at or above `minConfidence` are returned, best confidence first.
 */
export function classifyUntagged(trades: readonly (Ctx & Pick<Trade, "setups" | "id">)[], setups: readonly Setup[], o: { minConfidence?: number; exclude?: readonly string[] } = {}): BulkSuggestion[] {
  const history = historyModel(trades);
  const min = o.minConfidence ?? LEVEL_MIN.mittel;
  const out: BulkSuggestion[] = [];
  for (const t of trades) {
    if (t.setups?.length) continue;
    const s = classifyTrade(t, setups, { history, exclude: o.exclude });
    const best = s[0];
    if (best && best.confidence >= min) out.push({ tradeId: t.id, best, alternatives: s.slice(1, 3).filter((x) => x.confidence >= min / 2) });
  }
  return out.sort((a, b) => b.best.confidence - a.best.confidence);
}
