/**
 * Audit questions of the NLQ (Paket F2, "Frag dein Journal"): the questions about HOW a trade was taken, not only how it ended –
 *
 *   noStop      "Trades ohne Stopp"                     closed trades without a stop (`stop` empty or ≤ 0, the rule of `brokenRules`)
 *   checklist   "Wie oft habe ich die Checkliste ausgelassen?"   trades whose checklist (`complete`) is not fully ticked
 *   noReview    "Trades ohne Review"                    trades without a review (`reviewed`: note, post-note, psych, tags or rating)
 *   outcomes    "Verluste im Setup X letzten Monat"     the losing trades of a selection (plural „Verluste“ – „Verlust“ stays a sum)
 *
 * Same engine as the rest of the NLQ: `parse.ts` recognises the kind (`detectAudit`), `answer.ts` calls `auditAnswer`, which selects
 * with the same filters and periods (`selectTrades`), aggregates with `aggregate` and returns the usual `Answer` – so the Coach chat and
 * the question bar of the reports understand them alike. Nothing is estimated, nothing is guessed: an empty selection says so, and a
 * share is always "k von n" with its sample.
 */
import type { EnrichedTrade } from "../../types";
import { aggregate } from "../../agg";
import { tradeTime } from "@/lib/dates";
import { pct0, r as fmtR, signed } from "@/lib/format";
import { reviewed } from "../recommendations";
import { fin } from "../shared";
import { findPhrase, normalize } from "./lexicon";
import type { Answer, AnswerData, AnswerFact, Tone } from "./answer";
import { sampleConfidence, selectTrades } from "./answer";
import type { Intent } from "./parse";

export type AuditKind = "noStop" | "checklist" | "noReview" | "outcomes";

const phrases = (xs: readonly string[]): string[] => [...new Set(xs.map((x) => normalize(x).trim()))];

const NO_STOP = phrases([
  "ohne stop",
  "ohne stopp",
  "ohne stops",
  "ohne stopps",
  "ohne stoploss",
  "ohne stop loss",
  "ohne sl",
  "kein stop",
  "kein stopp",
  "keinen stop",
  "keinen stopp",
  "kein stop loss",
  "keinen stop loss",
  "keine stops",
  "keine stopps",
  "stop vergessen",
  "stopp vergessen",
  "stops vergessen",
  "stopps vergessen",
  "stop fehlt",
  "stopp fehlt",
  "fehlender stop",
  "fehlenden stop",
  "fehlendem stop",
  "fehlender stopp",
  "fehlenden stopp",
  "fehlendem stopp",
]);

const CHECKLIST_WORD = phrases(["checkliste", "checklisten", "check liste", "checklist"]);
const CHECKLIST_SKIPPED = phrases([
  "ausgelassen",
  "ausgelassene",
  "uebersprungen",
  "vergessen",
  "nicht abgehakt",
  "nicht vollstaendig",
  "unvollstaendig",
  "nicht genutzt",
  "nicht benutzt",
  "nicht ausgefuellt",
  "ignoriert",
  "weggelassen",
  "nicht beachtet",
  "nicht eingehalten",
  "nicht gemacht",
  "ohne checkliste",
  "keine checkliste",
  "ohne checklisten",
  "nicht erledigt",
]);

const NO_REVIEW = phrases([
  "ohne review",
  "ohne reviews",
  "kein review",
  "keinen review",
  "kein rueckblick",
  "ohne rueckblick",
  "ohne notiz",
  "ohne notizen",
  "ohne nachbereitung",
  "nicht reviewt",
  "nicht nachbereitet",
  "review fehlt",
  "reviews fehlen",
  "review vergessen",
  "reviews vergessen",
  "nicht ausgewertet",
]);

/** „Verluste“ (plural): the losing trades. „Verlust“ / „verloren“ / „verliere“ stay a net sum (`METRIC_SYNONYMS.net`). */
const LOSSES = phrases(["verluste"]);

const any = (norm: string, list: readonly string[]): boolean => list.some((p) => findPhrase(norm, p) >= 0);

/** Which audit question the normalised text asks (`null` = none). Pure word matching – the caller decides conflicts (group, compare …). */
export function detectAudit(norm: string): AuditKind | null {
  if (any(norm, NO_STOP)) return "noStop";
  if (any(norm, CHECKLIST_WORD) && any(norm, CHECKLIST_SKIPPED)) return "checklist";
  if (any(norm, CHECKLIST_SKIPPED.filter((p) => p.includes("checkliste")))) return "checklist";
  if (any(norm, NO_REVIEW)) return "noReview";
  if (any(norm, LOSSES)) return "outcomes";
  return null;
}

/** Human label of a kind (chips, titles). */
export const AUDIT_LABEL: Readonly<Record<AuditKind, string>> = {
  noStop: "Trades ohne Stopp",
  checklist: "Checkliste nicht vollständig",
  noReview: "Trades ohne Review",
  outcomes: "Verluste",
};

/** Every phrase of the audit questions, as words – the question bar counts them as known (`@/domain/ask`). */
export const AUDIT_WORDS: readonly string[] = [...NO_STOP, ...CHECKLIST_WORD, ...CHECKLIST_SKIPPED, ...NO_REVIEW, ...LOSSES].flatMap((p) => p.split(" "));

/* ------------------------------------------------------------------ answers */

const toneOf = (v: number | null | undefined): Tone => (v == null || !Number.isFinite(v) || v === 0 ? "mute" : v > 0 ? "win" : "loss");
const money = (v: number | null | undefined, cur: string): string => `${signed(v, 0)} ${cur}`;
const newest = (ts: readonly EnrichedTrade[]): EnrichedTrade[] => [...ts].sort((a, b) => +tradeTime(b) - +tradeTime(a));
const scopeOf = (intent: Intent): string => {
  const parts = [...intent.filters.map((f) => f.label), ...(intent.period ? [intent.period.label] : [])];
  return parts.length ? parts.join(" · ") : "Alle Trades";
};
const dateOf = (t: EnrichedTrade): string => tradeTime(t).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const share = (k: number, n: number): string => `${k} von ${n}${n ? ` (${pct0(k / n)})` : ""}`;

function base(intent: Intent, matched: readonly EnrichedTrade[]): Pick<Answer, "intent" | "kind" | "trades" | "matched" | "chart"> {
  const ordered = newest(matched);
  return { intent, kind: "audit", trades: ordered.slice(0, 6).map((t) => t.id), matched: ordered.map((t) => t.id), chart: null };
}

function emptySelection(intent: Intent): Answer {
  const scope = scopeOf(intent);
  return {
    intent,
    kind: "empty",
    title: scope,
    text: intent.filters.length || intent.period ? `Für ${scope} gibt es keine abgeschlossenen Trades.` : "Es gibt noch keine abgeschlossenen Trades.",
    facts: [],
    trades: [],
    chart: null,
    confidence: { score: 0, label: "zu wenig Daten", n: 0, note: "Keine Trades in dieser Auswahl." },
    followUps: ["Wie war letzte Woche?", "Was ist mein bestes Setup?"],
  };
}

function noStopAnswer(intent: Intent, ts: readonly EnrichedTrade[], data: AnswerData): Answer {
  const cur = data.currency;
  const without = ts.filter((t) => !(fin(t.stop) && t.stop > 0));
  const withStop = ts.filter((t) => fin(t.stop) && t.stop > 0);
  const gw = aggregate(without);
  const gs = aggregate(withStop);
  const scope = scopeOf(intent);
  const text = without.length
    ? `${scope}: Bei ${share(without.length, ts.length)} abgeschlossenen Trades fehlt der Stopp. Ihr Ergebnis zusammen: ${money(gw.net, cur)}. Ohne Stopp gibt es kein R – die Trades stehen nur in Geld.`
    : `${scope}: alle ${ts.length} abgeschlossenen Trades haben einen Stopp eingetragen.`;
  const facts: AnswerFact[] = [
    { label: "Ohne Stopp", value: share(without.length, ts.length), raw: without.length, tone: "fg" },
    { label: "Ergebnis dieser Trades", value: without.length ? money(gw.net, cur) : "–", raw: without.length ? gw.net : null, tone: without.length ? toneOf(gw.net) : "mute" },
    { label: "Ø pro Trade", value: without.length && withStop.length ? `ohne ${money(gw.exp, cur)} · mit ${money(gs.exp, cur)}` : "–", raw: without.length ? gw.exp : null, tone: "fg" },
  ];
  return {
    ...base(intent, without),
    title: `Trades ohne Stopp · ${scope}`,
    text,
    facts,
    confidence: sampleConfidence(ts.length, `Geprüft: ${ts.length} abgeschlossene Trades (offene Trades zählen hier nicht). Ein Stopp gilt als eingetragen, wenn er größer als 0 ist.`),
    followUps: ["Trades ohne Review", "Wie oft habe ich Regeln gebrochen?"],
  };
}

function checklistAnswer(intent: Intent, ts: readonly EnrichedTrade[]): Answer {
  const withList = ts.filter((t) => t.complete !== null);
  const incomplete = withList.filter((t) => t.complete === false);
  const blank = incomplete.filter((t) => t.checked === 0);
  const complete = withList.filter((t) => t.complete === true);
  const scope = scopeOf(intent);
  const rOf = (xs: readonly EnrichedTrade[]): number | null => {
    const rs = xs.map((t) => t.r).filter(fin);
    return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  };
  const rc = rOf(complete);
  const ri = rOf(incomplete);
  const noList = ts.length - withList.length;
  const text = !withList.length
    ? `${scope}: keiner der ${ts.length} Trades hat eine Checkliste (weder im Setup noch bei den Regeln) – so lässt sich nichts auslassen.`
    : `${scope}: bei ${share(incomplete.length, withList.length)} Trades mit Checkliste war sie nicht vollständig abgehakt, bei ${blank.length} davon wurde gar nichts abgehakt.${noList ? ` ${noList} Trades haben keine Checkliste und zählen nicht mit.` : ""}`;
  const facts: AnswerFact[] = [
    { label: "Nicht vollständig", value: withList.length ? share(incomplete.length, withList.length) : "–", raw: withList.length ? incomplete.length : null, tone: "fg" },
    { label: "Davon gar nichts abgehakt", value: withList.length ? `${blank.length}` : "–", raw: withList.length ? blank.length : null, tone: "fg" },
    { label: "Ø R", value: rc != null && ri != null ? `vollständig ${fmtR(rc)} · sonst ${fmtR(ri)}` : "–", raw: ri, tone: "fg" },
  ];
  return {
    ...base(intent, incomplete),
    title: `Checkliste · ${scope}`,
    text,
    facts,
    confidence: sampleConfidence(withList.length, `Geprüft: ${withList.length} Trades mit Checkliste. Das ist ein Vergleich, kein Beweis, dass die Checkliste die Ursache ist.`),
    followUps: ["Trades ohne Stopp", "Wie oft habe ich Regeln gebrochen?"],
  };
}

function noReviewAnswer(intent: Intent, ts: readonly EnrichedTrade[], data: AnswerData): Answer {
  const cur = data.currency;
  const open = ts.filter((t) => !reviewed(t));
  const g = aggregate(open);
  const scope = scopeOf(intent);
  const last = newest(open)[0];
  const text = open.length
    ? `${scope}: ${share(open.length, ts.length)} abgeschlossene Trades haben noch kein Review (keine Notiz, kein Psych-Eintrag, keine Tags, keine Bewertung).`
    : `${scope}: alle ${ts.length} abgeschlossenen Trades haben ein Review.`;
  const facts: AnswerFact[] = [
    { label: "Ohne Review", value: share(open.length, ts.length), raw: open.length, tone: open.length ? "fg" : "fg" },
    { label: "Neuester ohne Review", value: last ? `${dateOf(last)}${last.pair ? ` · ${last.pair}` : ""}` : "–", raw: null, tone: "mute" },
    { label: "Ergebnis dieser Trades", value: open.length ? money(g.net, cur) : "–", raw: open.length ? g.net : null, tone: open.length ? toneOf(g.net) : "mute" },
  ];
  return {
    ...base(intent, open),
    title: `Trades ohne Review · ${scope}`,
    text,
    facts,
    confidence: sampleConfidence(ts.length, `Geprüft: ${ts.length} abgeschlossene Trades.`),
    followUps: ["Trades ohne Stopp", "Wie war letzte Woche?"],
  };
}

function outcomesAnswer(intent: Intent, ts: readonly EnrichedTrade[], data: AnswerData): Answer {
  const cur = data.currency;
  const losers = ts.filter((t) => t.result === "loss");
  const g = aggregate(losers);
  const worst = [...losers].sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0))[0];
  const scope = scopeOf(intent);
  const rs = losers.map((t) => t.r).filter(fin);
  const sumR = rs.length ? rs.reduce((a, b) => a + b, 0) : null;
  const text = losers.length
    ? `${scope}: ${share(losers.length, ts.length)} Trades endeten im Verlust, zusammen ${money(g.net, cur)}${sumR != null ? ` (${fmtR(sumR)})` : ""}.${worst ? ` Der größte: ${money(worst.pnl, cur)} am ${dateOf(worst)}${worst.pair ? ` · ${worst.pair}` : ""}.` : ""}`
    : `${scope}: keiner der ${ts.length} Trades endete im Verlust.`;
  const facts: AnswerFact[] = [
    { label: "Verluste", value: share(losers.length, ts.length), raw: losers.length, tone: "fg" },
    { label: "Summe der Verluste", value: losers.length ? `${money(g.net, cur)}${sumR != null ? ` · ${fmtR(sumR)}` : ""}` : "–", raw: losers.length ? g.net : null, tone: losers.length ? "loss" : "mute" },
    { label: "Größter Verlust", value: worst ? `${money(worst.pnl, cur)}${fin(worst.r) ? ` · ${fmtR(worst.r)}` : ""}` : "–", raw: worst?.pnl ?? null, tone: worst ? "loss" : "mute" },
  ];
  return {
    ...base(intent, losers),
    title: `Verluste · ${scope}`,
    text,
    facts,
    confidence: sampleConfidence(ts.length, `Geprüft: ${ts.length} abgeschlossene Trades der Auswahl.`),
    followUps: ["Mein größter Verlust", "Trades ohne Stopp"],
  };
}

/** Answers an audit intent over the journal (selection by the intent's filters and period). */
export function auditAnswer(intent: Intent, data: AnswerData): Answer {
  const ts = selectTrades(data.closed, intent.filters, intent.period);
  if (!ts.length) return emptySelection(intent);
  switch (intent.audit) {
    case "noStop":
      return noStopAnswer(intent, ts, data);
    case "checklist":
      return checklistAnswer(intent, ts);
    case "noReview":
      return noReviewAnswer(intent, ts, data);
    case "outcomes":
      return outcomesAnswer(intent, ts, data);
    default:
      return emptySelection(intent);
  }
}
