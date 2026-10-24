/**
 * Tools of the assistant (F74): everything that is not a plain journal question. Each tool is a pure function of
 * `ToolEnv` (data in, reply out; the few side effects – navigate, open the editor, change the memory – are callbacks of
 * the env, so the tests run without a browser). Numbers always come from the deterministic domain code; a tool never
 * asks a language model for a figure.
 */
import type { Recommendation } from "@/domain/coach";
import { featureQueryOf, whereIs } from "@/app/featureQuery";
import { FEATURE_GROUPS, PLAN_TIER_LABEL, tierOf, type FeatureEntry } from "@/app/features";
import { translateIdea, type IdeaDraft } from "@/domain/lab";
import type { Answer, AnswerData, AnswerFact, Tone } from "@/domain/coach/nlq";
import type { DayNotes, EnrichedTrade } from "@/domain/types";
import { measureNoun, targetText, valueText, type ExperimentOverview } from "@/domain/reports/experiment";
import type { SignalCheckState } from "@/market/signals";
import type { Page } from "@/store/uiStore";
import { addFact, forgetAll, removeFact, setStyle, topInterests, type AnswerStyle, type AssistantMemory } from "./memory";
import type { InsightInputs } from "./insights/types";
import { isInsightTool } from "./insightRoutes";
import { PAGE_LABEL, type ToolId } from "./understand";

export interface ReplyAction {
  label: string;
  run: () => void;
}

export interface ToolReply {
  title: string;
  text: string;
  facts: AnswerFact[];
  followUps: string[];
  actions: ReplyAction[];
  tone: Tone;
  /** the sheet closes after this reply (navigation, editor): the user sees the page, not the chat */
  close?: boolean;
}

/** What the lab knows about its last finished run (filled by the Labor store; `null` = no run yet). */
export interface LabSummary {
  name: string;
  trades: number;
  net: string;
  /** deterministic findings of `diagnoseRun`, strongest first, each with its numbers */
  findings: string[];
  /** headline numbers */
  facts: AnswerFact[];
}

export interface ToolEnv {
  data: AnswerData;
  prev: { question: string; answer: Answer } | null;
  mem: AssistantMemory;
  signal: SignalCheckState;
  /** ranked recommendations of the coach (computed on demand) */
  recs: () => readonly Recommendation[];
  lab: LabSummary | null;
  /** the week experiment as stored + the proposal that could be made (read-only; computed on demand) */
  experiment?: () => ExperimentOverview;
  /** selects the report of a period on the Berichte page (the accept button of a proposal lives there) */
  openReport?: (key: string) => void;
  /** fills the lab's "Eigene Idee" from an idea (F12) – returns false when the lab refused it; saves nothing, starts nothing */
  applyIdea?: (draft: IdeaDraft) => boolean;
  go: (page: Page) => void;
  /** opens a function of the register (`src/app/featureOpen.ts`): its page scrolled to the card, or its sheet – without it the tool only navigates to the page */
  openFeature?: (id: string) => void;
  newTrade: () => void;
  /** opens the training sheet (F38) – it only opens; the user chooses, decides and writes everything there */
  train?: () => void;
  /** opens the Markt page at the card „Ähnliche Situationen“ (F19) – it only opens; the user picks timeframe and horizon there */
  similar?: () => void;
  setMem: (fn: (m: AssistantMemory) => AssistantMemory) => void;
  now: number;
  /** every trade of the account view, open ones included, and the day notes – the month benefit and „Passt zu dir?“ read them; without them the closed trades serve */
  list?: readonly EnrichedTrade[];
  days?: DayNotes;
  /** opens a card of a page by its test id (page, scroll, one sweep) – only opens */
  openSpot?: (page: Page, testid: string) => void;
  /** opens the strategy library sheet of the lab – it only opens; loading a card is the trader's click there (or the assistant's button „In Eigene Idee laden“) */
  openLibrary?: () => void;
  /** the evaluation tools (`insights/`) fetch their figures from the app's stores when asked; a test hands them in here instead */
  insight?: InsightInputs;
}

const fact = (label: string, value: string, tone: Tone = "fg", raw: number | null = null): AnswerFact => ({ label, value, raw, tone });
const reply = (r: Partial<ToolReply> & Pick<ToolReply, "title" | "text">): ToolReply => ({ facts: [], followUps: [], actions: [], tone: "fg", ...r });

/* ------------------------------------------------------------------ memory */

const STYLE_WORD: Readonly<Record<AnswerStyle, string>> = { kurz: "kurz", normal: "normal", detail: "ausführlich" };

/** The text after "merk dir", cleaned. */
export function factOf(text: string): string {
  return text
    .replace(/^\s*(bitte\s+)?(du\s+)?(kannst\s+dir\s+)?merk(e|t)?\s+(dir\s+)?(bitte\s+)?(mal\s+)?(,|:)?\s*/i, "")
    .replace(/^\s*(dass|das)\s+/i, "")
    .trim();
}

function memoryTool(arg: string, env: ToolEnv): ToolReply {
  const t = arg.toLowerCase();
  const { mem } = env;
  if (/\b(merk|merke|merkt)\b/.test(t)) {
    const f = factOf(arg);
    if (!f) return reply({ title: "Was soll ich mir merken?", text: "Sag es mir so: „Merk dir: ich handle nur in der London-Session.“", followUps: ["Was weißt du über mich?"] });
    env.setMem((m) => addFact(m, f, env.now));
    return reply({ title: "Gemerkt", text: `Ich habe mir gemerkt: „${f}“. Du kannst es jederzeit unter „Was ich über dich weiß“ löschen.`, tone: "win", followUps: ["Was weißt du über mich?"] });
  }
  if (/\bvergiss\b|\bvergessen\b/.test(t)) {
    if (/\b(alles|alle|komplett|samt)\b/.test(t)) {
      env.setMem(forgetAll);
      return reply({ title: "Alles vergessen", text: "Ich habe mein Gedächtnis über dich geleert: Notizen, Stil und was dich interessiert.", tone: "win" });
    }
    const word = t.replace(/^.*\bvergiss(e|t)?\b/, "").replace(/\b(bitte|das|dass|mal|dir)\b/g, "").trim();
    const hits = word ? mem.facts.filter((f) => f.text.toLowerCase().includes(word)) : mem.facts.slice(-1);
    if (!hits.length) return reply({ title: "Nichts gefunden", text: word ? `Ich habe nichts zu „${word}“ gespeichert.` : "Es ist nichts gespeichert.", followUps: ["Was weißt du über mich?"] });
    env.setMem((m) => hits.reduce((acc, h) => removeFact(acc, h.id), m));
    return reply({ title: "Vergessen", text: `${hits.length === 1 ? "Eintrag" : `${hits.length} Einträge`} gelöscht: ${hits.map((h) => `„${h.text}“`).join(", ")}.`, tone: "win" });
  }
  const style: AnswerStyle | null = /\bkurz|knapp|kuerzer|kürzer/.test(t) ? "kurz" : /\bausfuehrlich|ausführlich|detail/.test(t) ? "detail" : /\bnormal\b/.test(t) ? "normal" : null;
  if (style) {
    env.setMem((m) => setStyle(m, style));
    return reply({ title: "Stil geändert", text: `Ich antworte ab jetzt ${STYLE_WORD[style]}.`, tone: "win" });
  }
  // "was weißt du über mich"
  const top = topInterests(mem, 3).map(topicLabel);
  const lines = [
    mem.facts.length ? `Gemerkt: ${mem.facts.map((f) => `„${f.text}“`).join("; ")}.` : "Ich habe keine Notizen von dir gespeichert.",
    `Antwortstil: ${STYLE_WORD[mem.style]}.`,
    top.length ? `Du fragst am häufigsten nach: ${top.join(", ")}.` : "Ich weiß noch nicht, was dich am meisten interessiert – das lerne ich aus deinen Fragen.",
  ];
  return reply({ title: "Das weiß ich über dich", text: lines.join(" "), facts: [fact("Fragen", String(mem.asked)), fact("Notizen", String(mem.facts.length))], followUps: ["Fass dich kürzer", "Vergiss alles"] });
}

const TOPIC_LABEL: Readonly<Record<string, string>> = {
  where: "Funktionen finden",
  good: "Stärken",
  bad: "Schwächen",
  status: "Überblick",
  entry: "Einstiegs-Check",
  improve: "Verbesserungen",
  idea: "Ideen testen",
  experiment: "Wochenexperiment",
  lab: "Labor",
  studio: "Strategie-Studio",
  memory: "Gedächtnis",
  compare: "Vergleiche",
  list: "Trade-Listen",
  train: "Üben",
  similar: "Ähnliche Situationen öffnen",
  newTrade: "Trade eintragen",
  // the evaluation tools (`insights/`)
  audit: "Prüfbericht des Backtests",
  stress: "Verlustserien und Belastung",
  forward: "Forward-Test",
  trend: "Trendlinien",
  signals: "Signale und Posteingang",
  quality: "Alarm- und Datenqualität",
  benefit: "Nutzen des Journals im Monat",
  situation: "Ähnliche Situationen auswerten",
  fit: "Passt die Strategie zu mir?",
  library: "Strategie-Bibliothek",
  discovery: "Muster der Gewinner und Verlierer",
  evolve: "Hintergrund-Optimierer",
};

/** German label of a learned topic key. */
export function topicLabel(key: string): string {
  if (TOPIC_LABEL[key]) return TOPIC_LABEL[key]!;
  if (key.startsWith("metric:")) return `Kennzahl ${key.slice(7)}`;
  if (key.startsWith("group:")) return `Auswertung nach ${key.slice(6)}`;
  if (key.startsWith("behavior:")) return `Verhalten (${key.slice(9)})`;
  if (key.startsWith("page:")) return `Seite ${PAGE_LABEL[key.slice(5) as Page] ?? key.slice(5)}`;
  return key;
}

/* ------------------------------------------------------------------ the tools */

function improveTool(env: ToolEnv): ToolReply {
  const recs = env.recs().slice(0, 3);
  if (!env.data.closed.length || !recs.length)
    return reply({ title: "Noch keine belastbare Empfehlung", text: "Für Empfehlungen brauche ich abgeschlossene Trades mit genügend Wiederholungen. Sobald welche da sind, nenne ich dir die drei teuersten Muster mit Belegen.", followUps: ["Was kannst du?"] });
  const cur = env.data.currency;
  return reply({
    title: "Daran würde ich arbeiten",
    text: recs.map((r, i) => `${i + 1}. ${r.title} – ${r.why}`).join(" "),
    facts: recs.map((r) => fact(r.title.slice(0, 40), r.unit === "R" ? `${r.impact.toFixed(1).replace(".", ",")} R` : `${Math.round(r.impact)} ${cur}`, r.impact < 0 ? "loss" : "win", r.impact)),
    followUps: ["Was kostet mich Revenge?", "Wie war letzte Woche?"],
    actions: [{ label: "Im Coach öffnen", run: () => env.go("coach") }],
  });
}

/**
 * „Wochenexperiment“: shows the experiment the trader accepted (week, hypothesis, target, the automatic reading with its
 * sample) and, when none is accepted for the running week, the proposal the Wochenbericht would make. Read-only: accepting,
 * declining and withdrawing stay on the report page – the assistant changes nothing here.
 */
function experimentTool(env: ToolEnv): ToolReply {
  const ov = env.experiment?.();
  const toReport = (key?: string): ReplyAction => ({
    label: "Wochenbericht öffnen",
    run: () => {
      if (key) env.openReport?.(key);
      env.go("berichte");
    },
  });
  if (!ov) return reply({ title: "Wochenexperiment", text: "Das Wochenexperiment steht in dieser Ansicht nicht zur Verfügung. Du findest es im Wochenbericht.", actions: [toReport()] });
  if (!ov.items.length && !ov.proposal)
    return reply({
      title: "Kein Wochenexperiment",
      text: "Du hast kein Experiment angenommen, und der Coach hat gerade keine Hypothese, die sich in einer Woche messen lässt. Dafür braucht es Muster mit genug Belegen (Verhalten, Journal, ein wiederkehrend teures Setup).",
      actions: [toReport()],
      followUps: ["Woran soll ich arbeiten?"],
    });
  const lines: string[] = [];
  const facts: AnswerFact[] = [];
  for (const { experiment: e, phase, week, result } of ov.items) {
    const head = `${week.short} (${phase}): ${e.title}.`;
    const target = `Sollwert: ${measureNoun(e.measure)} ${targetText(e)}, mindestens ${e.minTrades} Trades.`;
    lines.push(result ? `${head} ${target} ${result.text}` : `${head} ${target} Die Woche hat noch nicht begonnen.`);
    if (result) {
      facts.push(fact("Status", result.status, result.status === "erfüllt" ? "win" : result.status === "nicht erfüllt" ? "loss" : "mute"));
      facts.push(fact("Ist", valueText(e.measure, result.actual, result.n), "fg", result.actual));
      facts.push(fact("Trades", `${result.n} (min. ${result.minTrades})`, "fg", result.n));
    }
  }
  if (ov.proposal) lines.push(`Noch nicht angenommen: ${ov.proposal.experiment.title}. ${ov.proposal.target} Annehmen oder ablehnen kannst du es im Wochenbericht ${ov.proposalReport?.short ?? ""} – ich ändere daran nichts.`.replace("  ", " "));
  return reply({
    title: ov.items.length ? "Dein Wochenexperiment" : "Vorschlag für ein Wochenexperiment",
    text: lines.join(" "),
    facts: facts.slice(0, 6),
    tone: "fg",
    actions: [toReport(ov.proposalReport?.key ?? ov.items[0]?.week.key)],
    followUps: ["Woran soll ich arbeiten?", "Wie war letzte Woche?"],
  });
}

function entryTool(env: ToolEnv): ToolReply {
  const { state, snapshot, message } = env.signal;
  if (!snapshot) return reply({ title: "Kein Live-Check", text: message ?? "Der Einstiegs-Check hat noch keine Kerzen geladen. Öffne die Übersicht, dann verbindet er sich.", actions: [{ label: "Zur Übersicht", run: () => env.go("overview") }] });
  const parts = (v: typeof snapshot.long, name: string): string => {
    const missing = v.reasons.filter((r) => !r.ok).map((r) => r.text);
    return `${name}: ${v.valid ? "Einstieg gültig" : "kein gültiger Einstieg"} (${v.label}, Score ${v.score})${missing.length ? `. Es fehlt: ${missing.slice(0, 4).join("; ")}` : ""}.`;
  };
  const stale = state === "stale" || state === "offline" ? " Achtung: die Daten sind nicht mehr ganz frisch." : "";
  const best = snapshot.best;
  return reply({
    title: best.valid ? `${best.side === "long" ? "Long" : "Short"}-Einstieg gültig` : "Aktuell kein gültiger Einstieg",
    text: `${parts(snapshot.long, "Long")} ${parts(snapshot.short, "Short")}${stale}`,
    facts: [fact("Long-Score", String(snapshot.long.score), snapshot.long.valid ? "win" : "mute", snapshot.long.score), fact("Short-Score", String(snapshot.short.score), snapshot.short.valid ? "loss" : "mute", snapshot.short.score), fact("Stand", env.signal.updatedAt ? new Date(env.signal.updatedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–")],
    tone: best.valid ? (best.side === "long" ? "win" : "loss") : "mute",
    followUps: ["Was kostet mich FOMO?", "Öffne den Markt"],
    actions: [{ label: "Einstiegs-Check öffnen", run: () => env.go("overview") }],
  });
}

/**
 * "Teste diese Idee" (F12): the live entry check becomes a draft of "Eigene Idee" in the lab. Only navigates and pre-fills –
 * nothing is saved and no run is started. What could not be turned into a rule is named in the answer.
 */
export function ideaTool(env: ToolEnv): ToolReply {
  const snap = env.signal.snapshot;
  if (!snap) return reply({ title: "Keine Idee zum Testen", text: env.signal.message ?? "Der Einstiegs-Check hat noch keine Kerzen geladen. Öffne die Übersicht, dann kann ich seine Regeln ins Labor übernehmen.", actions: [{ label: "Zur Übersicht", run: () => env.go("overview") }], tone: "mute" });
  const draft = translateIdea({ kind: "signal", symbol: snap.symbol, baseTf: snap.cfg.ladder[0] ?? null, verdict: snap.best });
  if (!draft.testable || !env.applyIdea?.(draft)) return reply({ title: "Das kann ich nicht ins Labor übernehmen", text: draft.blocked ?? "Das Labor hat den Entwurf nicht angenommen. Öffne es und baue die Regel dort selbst.", actions: [{ label: "Labor öffnen", run: () => env.go("labor") }], tone: "mute" });
  env.go("labor");
  const gaps = draft.gaps.map((g) => `${g.what} (${g.why})`).join(" ");
  return reply({
    title: "Idee im Labor vorbereitet",
    text: `Ich habe den Einstiegs-Check ${snap.symbol} als „Eigene Idee“ ins Labor gelegt: Regel: ${draft.rules.join(" UND ")}. Gestartet oder gespeichert habe ich nichts – du prüfst die Regeln und startest den Test. ${gaps ? `Nicht abgebildet: ${gaps}` : ""}`.trim(),
    facts: [fact("Markt", snap.symbol), fact("Zeiteinheit", draft.config.interval === "1d" ? "1D" : draft.config.interval), fact("Nicht abgebildet", String(draft.gaps.length), draft.gaps.length ? "mute" : "fg", draft.gaps.length)],
    close: true,
  });
}

function labTool(env: ToolEnv): ToolReply {
  const lab = env.lab;
  if (!lab) return reply({ title: "Noch kein Labor-Lauf", text: "Ich sehe keinen fertigen Lauf. Starte im Labor einen Test, dann kann ich ihn mit Trichter, Kosten und Ausstiegsgründen auseinandernehmen.", actions: [{ label: "Labor öffnen", run: () => env.go("labor") }], followUps: ["Öffne das Labor"] });
  return reply({
    title: `Labor-Lauf: ${lab.name}`,
    text: lab.findings.length ? `${lab.trades} Trades, Ergebnis ${lab.net}. Das fällt auf: ${lab.findings.slice(0, 4).join(" ")} Das sind Beobachtungen aus den Zahlen, keine bewiesene Ursache.` : `${lab.trades} Trades, Ergebnis ${lab.net}. Die Diagnose findet nichts Auffälliges – prüfe Datenabdeckung und Kosten im Labor.`,
    facts: lab.facts.slice(0, 4),
    actions: [{ label: "Diagnose im Labor", run: () => env.go("labor") }],
    followUps: ["Und ohne Gebühren?"],
  });
}

function explainTool(env: ToolEnv): ToolReply {
  const p = env.prev;
  if (!p) return reply({ title: "Wozu?", text: "Ich habe noch keine Antwort gegeben, die ich begründen könnte. Stell mir erst eine Frage." });
  const a = p.answer;
  const n = a.confidence.n;
  return reply({
    title: "So bin ich darauf gekommen",
    text: `Grundlage: ${n} Trade${n === 1 ? "" : "s"} im gewählten Bereich${a.intent.understood.length ? ` (${a.intent.understood.join(", ")})` : ""}. ${a.confidence.note} Alle Zahlen rechne ich direkt aus deinen Trades, nichts ist geschätzt.${a.trades.length ? " Die Belege stehen unter der Antwort." : ""}`,
    facts: a.facts.slice(0, 3),
    followUps: a.followUps.slice(0, 3),
  });
}

const GREETING_PARTS = ["Moin", "Hallo"];

function helloTool(arg: string, env: ToolEnv): ToolReply {
  if (/danke/i.test(arg)) return reply({ title: "Gern", text: "Gern geschehen. Frag einfach weiter – auch per Mikrofon.", followUps: suggestFor(env) });
  const g = GREETING_PARTS[env.now % GREETING_PARTS.length]!;
  const top = topInterests(env.mem, 1).map(topicLabel)[0];
  return reply({
    title: `${g}!`,
    text: env.mem.asked === 0 ? "Ich bin dein Assistent im Journal. Ich beantworte Fragen zu deinen Trades, prüfe den Einstieg, erkläre Laborläufe und öffne Seiten. Ich rechne alles aus deinen Daten und lerne, was dich interessiert." : `Schön, dich zu sehen.${top ? ` Zuletzt hat dich vor allem „${top}“ interessiert.` : ""} Womit kann ich helfen?`,
    followUps: suggestFor(env),
  });
}

function helpTool(env: ToolEnv): ToolReply {
  return reply({
    title: "Das kann ich",
    text: "Frag in deinen Worten: nach Kennzahlen („Win-Rate am Montag“), Stärken und Schwächen („Was lief gut?“), Verhalten („Was kostet mich Revenge?“), dem Einstieg („Was fehlt für meinen Einstieg?“), dem Labor („Warum ist der Backtest schlecht?“, „Teste diese Idee“), Verbesserungen oder deinem Wochenexperiment. Ich öffne auch Seiten („Öffne das Labor“), das Training („Ich will üben“), zeige dir, wo eine Funktion steht („Wo finde ich den Belastungstest?“), und merke mir, was du mir sagst („Merk dir …“). Du kannst tippen oder das Mikrofon nutzen.",
    followUps: suggestFor(env),
  });
}

/** Where a register entry lives, in a sentence ("auf der Seite Labor …"). */
function placeOf(f: FeatureEntry): string {
  if (f.action) return `als Fenster über der aktuellen Seite${f.path ? ` (${f.path})` : ""}`;
  const page = PAGE_LABEL[f.page] ?? f.page;
  if (f.path) return `auf der Seite ${page} – ${f.path}`;
  return f.anchor ? `auf der Seite ${page}, ich scrolle zur Karte` : `auf der Seite ${page}`;
}

/**
 * "Wo finde ich …?": answered from the function register (`src/app/features.ts`), nothing else. A clear best hit is opened
 * (its page scrolled to the card, or its sheet) and named with its one-sentence benefit, its limits and its plan; with
 * several close hits the best three are offered as buttons and nothing opens. No hit says so and points to the full list.
 */
export function whereTool(arg: string, env: ToolEnv): ToolReply {
  const open = (f: FeatureEntry): void => (env.openFeature ? env.openFeature(f.id) : env.go(f.page));
  if (!featureQueryOf(arg)) {
    // "Welche Funktionen gibt es?" – nothing specific to look for: the whole list is the answer
    env.go("funktionen");
    return reply({ title: "Funktionen geöffnet", text: "Die Übersicht aller Funktionen ist offen – nach Aufgaben geordnet, durchsuchbar, mit ehrlichem Stand.", close: true });
  }
  const { hits, clear } = whereIs(arg);
  const all: ReplyAction = { label: "Alle Funktionen", run: () => env.go("funktionen") };
  if (!hits.length)
    return reply({
      title: "Dazu finde ich keine Funktion",
      text: "Dazu steht nichts in der Funktionsübersicht. Sie ist nach Aufgaben geordnet und durchsuchbar – vielleicht heißt es dort anders. Frag mich auch gern mit dem Namen, zum Beispiel „Wo finde ich den Belastungstest?“.",
      actions: [all],
      followUps: ["Wo finde ich das Labor?", "Wo finde ich den Positionsrechner?"],
      tone: "mute",
    });
  const f = hits[0]!.entry;
  const tier = tierOf(f.gate);
  const group = FEATURE_GROUPS.find((g) => g.id === f.group)?.name ?? "";
  const parts = [
    `${f.name} (${group}): ${f.benefit}`,
    `Zu finden ${placeOf(f)}.`,
    tier !== "frei" ? `Tarif: ab ${PLAN_TIER_LABEL[tier]}.` : "",
    f.status === "teilweise" && f.note ? `Noch nicht vollständig: ${f.note}` : f.note ? `Zu wissen: ${f.note}` : "",
    f.needs ? `Voraussetzung: ${f.needs}` : "",
  ].filter(Boolean);
  const others = hits.slice(1).map((h) => h.entry);
  if (clear) {
    open(f);
    return reply({
      title: `${f.name} geöffnet`,
      text: parts.join(" "),
      facts: [fact("Stand", f.status === "fertig" ? "fertig" : "teilweise", f.status === "fertig" ? "win" : "mute"), fact("Tarif", PLAN_TIER_LABEL[tier])],
      actions: others.map((o) => ({ label: `${o.name} öffnen`, run: () => open(o) })),
      followUps: others.length ? [] : ["Welche Funktionen gibt es?"],
      close: true,
    });
  }
  return reply({
    title: "Das kommt infrage",
    text: `Ich bin nicht sicher, welche du meinst. ${hits.map((h) => `${h.entry.name}: ${h.entry.benefit}`).join(" ")} Tipp auf eine, dann öffne ich sie.`,
    actions: [...hits.map((h) => ({ label: `${h.entry.name} öffnen`, run: () => open(h.entry) })), all],
    tone: "mute",
  });
}

/** One question per evaluation topic: what the chips offer once the trader has asked about the topic more than once. */
export const INTEREST_QUESTION: Readonly<Record<string, string>> = {
  audit: "Hängt mein Backtest an wenigen Trades?",
  stress: "Wie lang war die längste Verlustserie?",
  forward: "Wie läuft mein Forward-Test?",
  trend: "Welche Zeiteinheiten haben eine Trendlinie in Annäherung?",
  signals: "Welche Signale habe ich diese Woche ausgelassen?",
  quality: "Wie lange war die App letzten Monat offen?",
  benefit: "Was hat mir das Journal diesen Monat gebracht?",
  situation: "Wie ging es nach ähnlichen Situationen weiter?",
  fit: "Passt diese Strategie zu mir?",
  library: "Gibt es eine Strategie mit Bollinger?",
  discovery: "Was haben meine Gewinner gemeinsam?",
  evolve: "Was hat der Optimierer gefunden?",
};

/** Chips for the greeting and help: the most asked topics first, then a few safe defaults. */
export function suggestFor(env: Pick<ToolEnv, "mem">): string[] {
  const base = ["Was lief gut?", "Was fehlt für meinen Einstieg?", "Wie war letzte Woche?", "Woran soll ich arbeiten?", "Was ist mein bestes Setup?"];
  const asked = topInterests(env.mem, 3);
  const bias: Record<string, string> = { ...INTEREST_QUESTION, good: "Was lief gut?", bad: "Was lief schlecht?", entry: "Was fehlt für meinen Einstieg?", improve: "Woran soll ich arbeiten?", lab: "Warum ist der Backtest so schlecht?", status: "Wie läuft es?" };
  const first = asked.map((k) => bias[k]).filter((x): x is string => !!x);
  return [...new Set([...first, ...base])].slice(0, 4);
}

/** Runs a tool; never throws – a failing tool answers honestly. */
export function runTool(tool: ToolId, arg: string, env: ToolEnv): ToolReply {
  try {
    // the evaluation tools fetch their figures from the app's stores: the engine runs them asynchronously (`insights/`)
    if (isInsightTool(tool)) return reply({ title: "Ich rechne nach …", text: "Die Auswertung wird geladen.", tone: "mute" });
    switch (tool) {
      case "memory":
        return memoryTool(arg, env);
      case "improve":
        return improveTool(env);
      case "experiment":
        return experimentTool(env);
      case "entry":
        return entryTool(env);
      case "idea":
        return ideaTool(env);
      case "lab":
        return labTool(env);
      case "studio":
        env.go("studio");
        return reply({
          title: "Strategie-Studio geöffnet",
          text: "Dort schreibst du deine Strategie in normalen Worten. Das Studio macht daraus die Regeln des Labors, zeigt Unklares und fragt nach, statt zu raten. Ich öffne nur – gerechnet wird erst, wenn du dort den Backtest startest; ein Backtest zeigt die Vergangenheit, keine Prognose. Keine professionelle Finanzberatung.",
          close: true,
        });
      case "explain":
        return explainTool(env);
      case "hello":
        return helloTool(arg, env);
      case "help":
        return helpTool(env);
      case "navigate": {
        const page = arg as Page;
        env.go(page);
        return reply({ title: `${PAGE_LABEL[page] ?? "Seite"} geöffnet`, text: `Ich habe ${PAGE_LABEL[page] ?? "die Seite"} für dich geöffnet.`, close: true });
      }
      case "where":
        return whereTool(arg, env);
      case "train":
        env.train?.();
        return reply({ title: "Training geöffnet", text: env.train ? "Du wählst dort ein Setup, bekommst Situationen aus deinem Journal ohne den weiteren Verlauf gezeigt und entscheidest selbst. Ich öffne nur – eingetragen wird erst, was du dort festhältst." : "Das Training ist hier gerade nicht verfügbar.", close: !!env.train });
      case "similar":
        env.similar?.();
        return reply({ title: "Ähnliche Situationen geöffnet", text: env.similar ? "Die Karte steht auf der Markt-Seite unter den Trendlinien. Ich öffne sie nur – du wählst Zeiteinheit und Horizont, gesucht und gerechnet wird dort aus den geladenen Kerzen, mit den Gegenbeispielen. Ähnlichkeit ist keine Prognose." : "Die Karte ist hier gerade nicht verfügbar.", close: !!env.similar });
      case "newTrade":
        env.newTrade();
        return reply({ title: "Trade eintragen", text: "Das Formular ist offen.", close: true });
    }
  } catch {
    return reply({ title: "Das hat nicht geklappt", text: "Dabei ist ein Fehler aufgetreten. Versuch es bitte noch einmal oder frag anders.", tone: "mute" });
  }
}
