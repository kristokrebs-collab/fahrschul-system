/**
 * Local understanding of the assistant (F74) – works offline and without any AI key. Turns what the trader typed or
 * said ("was lief guuut", "und im Long?", "öffne das Labor", "merk dir …") into a `Plan`:
 *
 *   1. the journal parser (`parseQuestion`, P04) on the text as it is;
 *   2. typo repair: unknown words are matched against the parser's own vocabulary (Damerau-Levenshtein ≤ 1 for short,
 *      ≤ 2 for long words, only when exactly one word fits) and the parser runs again;
 *   3. colloquial phrases ("was lief gut", "wie läuft's") expand into up to three questions the parser knows;
 *   4. tools: navigate, improve, week experiment, entry check, lab diagnosis, memory commands, "warum?", greetings;
 *   5. follow-ups: a short question without its own subject inherits metric / filters / period of the last one.
 *
 * Anything it cannot place becomes a `clarify` plan with the closest known questions ("Meintest du …?") instead of a
 * dead end. The optional server router (`netlify/functions/assistant-route.mts`) only runs when this layer gives up.
 */
import {
  BEHAVIOR_SYNONYMS,
  COMPARE_WORDS,
  DIM_NOUNS,
  GROUP_TRIGGERS,
  LIST_WORDS,
  METRIC_SYNONYMS,
  MONTHS,
  MONTH_SHORT,
  SORT_BEST,
  SORT_WORST,
  SUMMARY_WORDS,
  normalize,
  type FilterValue,
} from "@/domain/coach/nlq/lexicon";
import { ACCOUNT_VALUES, EMOTION_VALUES, RESULT_VALUES, SESSION_VALUES, SIDE_VALUES, WEEKDAY_VALUES } from "@/domain/coach/nlq/lexicon";
import { parseQuestion, type Filter, type FilterDim, type Intent, type ParseContext } from "@/domain/coach/nlq/parse";
import type { Page } from "@/store/uiStore";
import { editDistance } from "./fuzzy";
import { INSIGHT_RULES, followsInsight, type InsightToolId } from "./insightRoutes";

export type ToolId = "improve" | "experiment" | "entry" | "idea" | "lab" | "memory" | "navigate" | "explain" | "hello" | "newTrade" | "help" | "train" | "where" | "similar" | "studio" | "plan" | "stocks" | InsightToolId;

export type Plan =
  | { kind: "journal"; intents: Intent[]; via: string[]; topic: string }
  | { kind: "tool"; tool: ToolId; arg: string; via: string[]; topic: string }
  | { kind: "clarify"; text: string; suggestions: string[] };

export interface UnderstandCtx {
  parse: ParseContext;
  /** the intent of the last journal answer (follow-ups) */
  prev?: Intent | null;
  /** number of closed trades (decides how "was lief gut" is phrased) */
  closed: number;
  /** the evaluation tool the LAST answer came from (a short „und letzte Woche?“ continues it) */
  prevTool?: { tool: InsightToolId; question: string } | null;
}

/* ------------------------------------------------------------------ typo repair */

const STOP = "ich du er sie es wir ihr mein meine meinen meinem meiner meines mir mich dir dich uns und oder aber auch noch nur dann denn doch mal bitte kannst kann koennte soll sollte will wuerde der die das den dem des ein eine einen einem einer eines ist sind war waren bin bist hat habe haben hatte wird werden wurde wie was wer wo wann warum wieso weshalb wofuer welche welcher welches welchen welchem im in am an auf aus bei mit nach von vor zu zum zur ueber unter fuer gegen ohne bis seit als so sehr viel viele wenig mehr weniger sind gut schlecht besser schlechter lief laeuft laufen lauft gelaufen klappt geklappt ja nein dass gibt gab sich zeig zeige sag sage erzaehl erzaehle gib geh gehe oeffne oeffnen heute gestern morgen jetzt gerade aktuell letzte letzten letzter letztes diese diesen dieser dieses vorletzte woche wochen monat monate monaten jahr jahre jahres tag tage tagen quartal prozent trades trade trading journal coach labor markt analyse risiko berichte wachstum community cockpit konto preise einstellungen setups uebersicht dashboard backtest strategie hallo hi hey moin danke merk merke vergiss kurz kuerzer ausfuehrlich ausfuehrlicher stark staerken schwaeche schwaechen fehler tipp tipps verbessern warum wegen darum".split(" ");

let vocabCache: Set<string> | null = null;

function addWords(into: Set<string>, text: string): void {
  for (const w of normalize(text).trim().split(" ")) if (w.length >= 3 && !/[0-9]/.test(w)) into.add(w);
}

/** Every word the journal parser knows (lexicon tables, month names, stop words). */
export function vocabulary(): ReadonlySet<string> {
  if (vocabCache) return vocabCache;
  const v = new Set<string>();
  for (const w of STOP) addWords(v, w);
  const lists: Array<readonly string[]> = [
    ...Object.values(METRIC_SYNONYMS),
    ...Object.values(DIM_NOUNS),
    ...Object.values(BEHAVIOR_SYNONYMS),
    GROUP_TRIGGERS,
    SORT_BEST,
    SORT_WORST,
    COMPARE_WORDS,
    LIST_WORDS,
    SUMMARY_WORDS,
    MONTHS,
    MONTH_SHORT,
  ];
  for (const list of lists) for (const p of list) addWords(v, p);
  const values: ReadonlyArray<readonly FilterValue[]> = [SIDE_VALUES, ACCOUNT_VALUES, WEEKDAY_VALUES, SESSION_VALUES, RESULT_VALUES, EMOTION_VALUES];
  for (const vs of values) for (const f of vs) for (const s of f.syn) addWords(v, s);
  vocabCache = v;
  return v;
}

export { editDistance };

/** Collapses stretched letters ("guuut" → "gut") – three or more of the same letter become one. */
export const squeeze = (s: string): string => s.replace(/([a-z])\1{2,}/g, "$1");

export interface Repair {
  text: string;
  fixes: Array<[from: string, to: string]>;
}

/** Replaces unknown words by the one known word they most plausibly are (a unique match only). */
export function repairTypos(text: string, extra: readonly string[] = []): Repair {
  const known = new Set(vocabulary());
  for (const e of extra) addWords(known, e);
  const fixes: Repair["fixes"] = [];
  const words = normalize(squeeze(text.toLowerCase())).trim().split(" ");
  const out = words.map((w) => {
    if (w.length < 4 || /[0-9#%.&/+]/.test(w) || known.has(w)) return w;
    const max = w.length >= 7 ? 2 : 1;
    let best: string | null = null;
    let bestD = max + 1;
    let tie = false;
    for (const k of known) {
      const d = editDistance(w, k, max);
      if (d < bestD) {
        best = k;
        bestD = d;
        tie = false;
      } else if (d === bestD && d <= max && k !== best) tie = true;
    }
    if (best && !tie && bestD <= max) {
      fixes.push([w, best]);
      return best;
    }
    return w;
  });
  return { text: out.join(" "), fixes };
}

/* ------------------------------------------------------------------ colloquial phrases */

interface PhraseRule {
  id: string;
  test: RegExp;
  /** canonical questions the journal parser understands (≤ 3) */
  questions: readonly string[];
  topic: string;
  /** shown as "so habe ich dich verstanden" */
  label: string;
}

const PHRASES: readonly PhraseRule[] = [
  {
    id: "bad",
    test: /\b(was|wo|wie)\b.*\b(lief|laeuft|klappt|klappte|funktioniert|ging)\b.*\b(schlecht|schlechter|nicht|schief|falsch|mies|daneben)\b|\b(schwaechen|negativ\w*|probleme|problem|schwachstellen|fehlerquellen)\b|was mache ich (falsch|schlecht)/,
    questions: ["Was ist mein schlechtestes Setup?", "An welchem Wochentag verliere ich am meisten?", "Mein größter Verlust"],
    topic: "bad",
    label: "Was lief schlecht",
  },
  {
    id: "good",
    test: /\b(was|wo|wie)\b.*\b(lief|laeuft|klappt|klappte|funktioniert|funktionierte|bewaehrt)\b.*\b(gut|richtig|stark|besser|prima|super)\b|\b(staerken|positiv\w*|erfolge|highlights|lichtblicke)\b|worauf .*stolz|was mache ich (gut|richtig)|wo bin ich (stark|gut|erfolgreich|besonders gut)|was (kann|beherrsche) ich (gut|am besten)/,
    questions: ["Was ist mein bestes Setup?", "Welcher Wochentag ist am profitabelsten?", "Mein größter Gewinn"],
    topic: "good",
    label: "Was lief gut",
  },
  {
    id: "status",
    test: /\b(wie (laeufts|laeuft es|laeuft s|geht s|geht es|stehe ich|steht es)|bin ich im (plus|minus)|wie sieht es aus|ueberblick|lagebericht|kurzfassung)\b/,
    questions: ["Wie war diese Woche?", "Win-Rate diesen Monat", "Wie viel habe ich diesen Monat verdient?"],
    topic: "status",
    label: "Wie läuft es",
  },
  {
    id: "money",
    test: /\b(wieviel|wie viel)\b.*\b(verdient|gewonnen|verloren|plus|minus|gemacht)\b|\bverdient\b.*\b(insgesamt|gesamt|bisher)\b/,
    questions: ["Wie viel habe ich insgesamt verdient?", "Win-Rate insgesamt"],
    topic: "metric:net",
    label: "Wie viel Geld",
  },
];

/* ------------------------------------------------------------------ tools */

const PAGE_WORDS: ReadonlyArray<[RegExp, Page]> = [
  [/\bhandels-?plan\b/, "plan"],
  [/\bstrategie-?studio\b|\bstudio\b/, "studio"],
  [/\baktien\b|\baktienseite\b/, "aktien"],
  [/\blabor\b|\bbacktest(s|er)?\b|\bstrategielabor\b/, "labor"],
  [/\bcoach\b/, "coach"],
  [/\bmarkt\b|\bmaerkte\b|\bchart\b|\blage\b/, "markt"],
  [/\banalyse\b|\bauswertung\b/, "analyse"],
  [/\brisiko\b|\bpositionsgroesse\b/, "risiko"],
  [/\bberichte?\b|\bwochenbericht\b|\bmonatsbericht\b/, "berichte"],
  [/\bwachstum\b|\bziele\b/, "wachstum"],
  [/\bcommunity\b|\branglisten?\b/, "community"],
  [/\bcockpit\b/, "cockpit"],
  [/\bkonto\b|\bprofil\b|\babo\b/, "konto"],
  [/\bpreise?\b|\btarife?\b/, "preise"],
  [/\bfunktionsuebersicht\b|\bfunktionen\b(?!.*\bwo\b)/, "funktionen"],
  [/\beinstellungen?\b|\bsettings\b/, "settings"],
  [/\btrades\b|\bjournal\b|\bhandelsliste\b/, "trades"],
  [/\bsetups?\b|\bgrundlagen\b/, "setups"],
  [/\buebersicht\b|\bdashboard\b|\bstartseite\b|\bhome\b/, "overview"],
];

export const PAGE_LABEL: Readonly<Record<Page, string>> = {
  overview: "Übersicht",
  trades: "Trades",
  setups: "Entscheidungsgrundlagen",
  settings: "Einstellungen",
  markt: "Markt",
  analyse: "Analyse",
  risiko: "Risiko",
  coach: "Coach",
  berichte: "Berichte",
  labor: "Labor",
  wachstum: "Wachstum",
  community: "Community",
  cockpit: "Cockpit",
  konto: "Konto",
  preise: "Preise",
  funktionen: "Funktionen",
  studio: "Strategie-Studio",
  plan: "Handelsplan",
  aktien: "Aktien",
};

/** The page named by an "open …" request, or null. */
export function pageOf(norm: string): Page | null {
  if (!/\b(oeffne\w*|zeig\w*|geh\w*|gehe\w*|wechsel\w*|bring\w*|starte\w*|navigiere|spring\w*|zu|zum|zur)\b/.test(norm)) return null;
  for (const [re, page] of PAGE_WORDS) if (re.test(norm)) return page;
  return null;
}

const TOOL_RULES: ReadonlyArray<{ tool: ToolId; test: { test(norm: string): boolean }; topic: string; label: string; soft?: true }> = [
  // "Wo finde ich …?" (the function register): first, because the thing asked for is named in the question ("Wo finde ich den Einstiegs-Check?"
  // must not run the entry tool). The unmistakable phrasings win outright; the loose ones ("wo ist …") only when the journal parser found no subject
  { tool: "where", test: /\bwo (finde|find|sehe|seh|komme|geht|kann ich|kann man)\b|\bwie komme ich (zu|zum|zur|an|auf|in|dahin|dorthin)\b|\bwelche funktionen\b|\bwas (gibt es|gibts) (alles |noch )?(an )?funktionen\b/, topic: "where", label: "Wo finde ich …?" },
  { tool: "where", test: /\bwo (ist|sind|steht|stehen|gibt es|gibts)\b/, topic: "where", label: "Wo finde ich …?", soft: true },
  { tool: "memory", test: /\b(merk|merke|merkt)\b.*\b(dir|mal)\b|\bvergiss\b|\bvergessen\b|was weisst du (alles )?(ueber|von) mich|was hast du dir gemerkt|\b(fass dich|antworte|antworten|sei) (kurz|kuerzer|ausfuehrlicher|knapper)|\bkuerzer bitte\b|\bausfuehrlicher bitte\b|\bin kurzform\b|\bnur kurz\b/, topic: "memory", label: "Gedächtnis" },
  // the evaluation tools (`insightRoutes.ts`): after the place questions and the memory commands, before every tool whose words they may contain
  ...INSIGHT_RULES,
  { tool: "lab", test: /\bbacktest\b.*\b(schlecht|mies|negativ|verlust|schwach|warum|wieso|kacke|mist|mau|miserabel|bescheiden|katastroph\w*|scheiss\w*)\b|\b(warum|wieso|weshalb)\b.*\b(backtest|labor|testlauf|strategie)\b|\bdiagnose\b.*\b(lauf|backtest|labor)\b|\bwas stimmt .* nicht .*(backtest|strategie)/, topic: "lab", label: "Labor-Diagnose" },
  { tool: "idea", test: /\b(teste?|testen|pruef\w*|probier\w*)\b.{0,24}\b(idee|ideen)\b|\bidee\b.{0,24}\b(testen|pruefen|ausprobieren)\b|\b(diesen|den|meinen) einstieg (testen|pruefen|backtesten|im labor)\b|\bdiese idee\b/, topic: "idea", label: "Idee testen" },
  // „Handelsplan“ / „Wie groß soll die Position sein?“: opens the plan page (Einstieg → Ausstieg → Größe → Risiko → Ticket); it only opens
  { tool: "plan", test: /\bhandels-?plan\b|\bwie (gross|viel) soll(te)? (die|meine|denn die|denn meine) (position|positionsgroesse)( denn)? (sein|werden)\b|\bwie (gross|viel) (soll|sollte|darf|kann) ich (kaufen|handeln|einsetzen|riskieren|einsteigen)\b|\bpositionsgroesse (berechnen|bestimmen|planen|festlegen)\b|\b(stop|stopp) und ziel (planen|setzen|festlegen)\b|\bplan fuer (diesen|den|meinen) (trade|einstieg)\b|\btrade (planen|durchplanen)\b|\bticket (bauen|erstellen)\b/, topic: "plan", label: "Handelsplan" },
  // „Strategie als Text“ / „Neue Strategie“: opens the studio (the page does the reading, the questions and the backtest)
  { tool: "studio", test: /\bstrategie als text\b|\bneue strategie\b|\bstrategie (schreiben|aufschreiben|eingeben|formulieren|beschreiben|in worten)\b|\bstrategie-? ?studio\b|\bregeln aus (einem |meinem )?text\b|\bstrategien? (vergleichen|nebeneinander)\b/, topic: "studio", label: "Strategie-Studio" },
  // „Aktien scannen“ / „News zu meiner Watchlist“: opens the Aktien page at the scanner or the news (the page does the reading and the scan)
  { tool: "stocks", test: /\baktien\b.{0,24}\b(scannen|scan|durchsuchen|screenen|screener|finden|suchen)\b|\b(scanne|scannen|scan|durchsuche|screene)\b.{0,24}\baktien\b|\baktien ?scanner\b|\bopening range\b|\beroeffnungsspanne\b|\bbull ?flag\b|\b(news|nachrichten|schlagzeilen|meldungen)\b.{0,32}\bwatchlist\b|\bwatchlist\b.{0,32}\b(news|nachrichten|schlagzeilen|meldungen)\b/, topic: "stocks", label: "Aktien" },
  { tool: "train", test: /\b(ueben|uebe|uebung|uebungen|trainier\w*|trainingsmodus|lernmodus|replay training)\b|\btraining\b.*\b(starten|oeffnen|beginnen|machen)\b|\b(starte|oeffne|mach)\b.*\btraining\b/, topic: "train", label: "Training" },
  { tool: "similar", test: /\b(aehnlich\w*|vergleichbar\w*)\b.{0,30}\b(situation\w*|marktlage|lage|muster|kerze\w*|faelle|fall)\b|\b(situation\w*|muster|kerze\w*)\b.{0,30}\b(aehnlich\w*|vergleichbar\w*)\b|\bhistorisch\w*\b.{0,20}\b(aehnlich\w*|vergleich\w*)\b|\bwann (war|gab) (es|das) (schon )?(mal )?(so|aehnlich)\b/, topic: "similar", label: "Ähnliche Situationen" },
  { tool: "entry", test: /\b(was fehlt|fehlt (mir|noch|da))\b|\beinstiegs ?check\b|\beinstiegssignal\b|\bkann ich (jetzt |gerade )?(einsteigen|long|short|kaufen|verkaufen)\b|\bsoll ich (jetzt |gerade )?(einsteigen|long|short|kaufen|verkaufen)\b|\bist (jetzt |gerade )?(ein|kein) (einstieg|signal)\b|\bwie ist (der|die|das) (markt|lage)\b|\bmarktlage\b/, topic: "entry", label: "Einstiegs-Check" },
  { tool: "experiment", test: /experiment\w*|\bhypothese\w*/, topic: "experiment", label: "Wochenexperiment" },
  { tool: "improve", test: /\bverbesser\w*|\bbesser werden\b|\bworan (soll|muss|kann|sollte) ich (arbeiten|feilen)\b|\bwas (soll|sollte|kann) ich (aendern|tun|machen|anders)\b|\bnaechster schritt\b|\bempfehl\w*|\btipps?\b|\bratschlag\b/, topic: "improve", label: "Verbesserungen" },
  { tool: "newTrade", test: /\b(neuen? trade|trade eintragen|trade erfassen|trade hinzufuegen|trade anlegen)\b/, topic: "newTrade", label: "Trade eintragen" },
  { tool: "explain", test: /^ ?(und )?(warum|wieso|weshalb|woran liegt das|wie kommt das|beweis|belege|woher weisst du das|woher hast du das)( das| denn| genau)? ?$/, topic: "explain", label: "Begründung" },
  { tool: "hello", test: /^ ?(hallo|hi|hey|moin|servus|guten (morgen|tag|abend)|danke|dankeschoen|super danke|ok danke|cool danke)( \w+)? ?$/, topic: "hello", label: "Gruß" },
  { tool: "help", test: /\bwas kannst du\b|\bhilfe\b|\bwie funktionierst du\b|\bwas (soll|kann) ich dich fragen\b|\bbeispiele\b/, topic: "help", label: "Hilfe" },
];

/* ------------------------------------------------------------------ follow-ups */

const FOLLOW_START = /^ ?(und|auch|nur|dann|ausserdem|oder|jetzt|wie (ist|war|sieht) (es|das)|was ist mit|was ist mit dem|im vergleich|dasselbe|das gleiche|genauso)\b/;

/** Did the journal parser find a real subject (metric, behaviour, group-by or period)? A bare side / account filter is not one. */
function ownSubject(i: Intent): boolean {
  return i.metricExplicit || !!i.behavior || !!i.groupBy || i.period !== null;
}

/** Does `norm` read like a continuation of the last question (short, starts with "und …", no own subject)? */
export function looksLikeFollowUp(norm: string, next: Intent): boolean {
  const words = norm.trim().split(" ").length;
  if (FOLLOW_START.test(norm) && next.type !== "unknown") return true;
  return words <= 4 && !next.metricExplicit && !next.groupBy && !next.behavior && (next.filters.length > 0 || next.period !== null);
}

/** `next` laid over `prev`: its filters replace those of the same dimension, an explicit metric / period / group wins. */
export function mergeFollowUp(prev: Intent, next: Intent): Intent {
  const dims = new Set<FilterDim>(next.filters.map((f) => f.dim));
  const kept: Filter[] = prev.filters.filter((f) => !dims.has(f.dim));
  const filters = [...kept, ...next.filters].map((f, i) => ({ ...f, at: i }));
  const groupBy = next.groupBy ?? (prev.groupBy && !dims.has(prev.groupBy as FilterDim) ? prev.groupBy : null);
  const behavior = next.behavior ?? prev.behavior;
  const metricExplicit = next.metricExplicit || prev.metricExplicit;
  const metric = next.metricExplicit ? next.metric : prev.metric;
  const compare = next.compare;
  let type: Intent["type"];
  if (compare || next.period2) type = "compare";
  else if (behavior && !groupBy) type = "behavior";
  else if (groupBy) type = "group";
  else if (prev.type === "list" && !next.metricExplicit) type = "list";
  else if (metricExplicit) type = "metric";
  else type = "summary";
  const understood = [...new Set([...prev.understood, ...next.understood])];
  return {
    ...prev,
    raw: `${prev.raw} → ${next.raw}`,
    norm: `${prev.norm}${next.norm}`,
    type,
    metric,
    metricExplicit,
    filters: compare ? filters.filter((f) => f !== compare[0] && f !== compare[1]) : filters,
    period: next.period ?? prev.period,
    period2: next.period2,
    groupBy,
    sort: next.sort ?? prev.sort,
    compare,
    behavior,
    understood,
  };
}

/* ------------------------------------------------------------------ the plan */

/** Topic key of an intent (learned interests): "setup", "weekday", "behavior:revenge", "metric:winRate", … */
export function topicOfIntent(i: Intent): string {
  if (i.type === "behavior" && i.behavior) return `behavior:${i.behavior}`;
  if (i.groupBy) return `group:${i.groupBy}`;
  if (i.type === "compare") return "compare";
  if (i.type === "list") return "list";
  if (i.type === "summary") return "status";
  return `metric:${i.metric}`;
}

const KNOWN_QUESTIONS: readonly string[] = [
  "Was ist mein bestes Setup?",
  "Wie war letzte Woche?",
  "Vergleiche Long und Short",
  "Welche Session ist am profitabelsten?",
  "An welchem Wochentag verliere ich am meisten?",
  "Mein größter Verlust",
  "Win-Rate diesen Monat",
  "Was kosten mich Revenge-Trades?",
  "Wie viel habe ich insgesamt verdient?",
];

/** The known questions closest to `text` (by shared words), for "Meintest du …?". */
export function closestQuestions(text: string, k = 3): string[] {
  const words = new Set(normalize(text).trim().split(" ").filter((w) => w.length >= 3));
  const scored = KNOWN_QUESTIONS.map((q, i) => {
    const qw = normalize(q).trim().split(" ");
    let s = 0;
    for (const w of qw) if (words.has(w) || [...words].some((x) => x.length >= 5 && w.length >= 5 && editDistance(x, w, 1) <= 1)) s++;
    return { q, s, i };
  });
  return scored.sort((a, b) => b.s - a.s || a.i - b.i).slice(0, k).map((e) => e.q);
}

export const CLARIFY_TEXT = "Das habe ich noch nicht sicher verstanden. Ich beantworte Fragen zu deinen Trades (Kennzahlen, Zeiträume, Setups, Sessions, Wochentage), zu Verhalten wie Revenge oder FOMO, zu deinem Einstiegs-Check und zum Labor – ich zeige dir, wo eine Funktion steht („Wo finde ich den Handelsplan?“), oder öffne eine Seite für dich.";

/** "Öffne den Belastungstest", "Starte die Demo", "Zeig mir den Kongress-Tracker": a verb of opening at the start – the function register finds the place. */
const OPEN_VERB = /^\s*(?:öffne\w*|oeffne\w*|zeig\w*|starte\w*|geh\w*|bring\w*|spring\w*|navigiere)(?:\s+(?:mich|mir|uns))?(?:\s+(?:zu|zum|zur|nach|auf))?\s+/i;

/**
 * What to do with `text`. Order: tools whose phrasing is unmistakable → journal parser (exact) → typo repair →
 * colloquial phrases → follow-up → clarify.
 */
export function understand(text: string, ctx: UnderstandCtx): Plan {
  const raw = text.trim();
  if (!raw) return { kind: "clarify", text: CLARIFY_TEXT, suggestions: closestQuestions("") };
  const norm0 = normalize(squeeze(raw.toLowerCase()));

  const parse = (t: string): Intent => parseQuestion(t, ctx.parse);
  let intent = parse(raw);

  // 1) tool phrasing: memory, lab, explain, hello, help and "new trade" are unmistakable; "entry" and "improve" use
  //    common words ("verbessert", "Einstieg") and only win when the journal parser found nothing of its own
  for (const r of TOOL_RULES) {
    const soft = r.soft === true || r.tool === "entry" || r.tool === "improve";
    // the loose "wo ist / wo sind …" is a place question only when it is no colloquial journal phrase ("wo sind meine Schwächen")
    const phrase = r.soft === true && PHRASES.some((p) => p.test.test(norm0));
    if (r.test.test(norm0) && !phrase && (!soft || ownSubject(intent) === false)) return { kind: "tool", tool: r.tool, arg: raw, via: [r.label], topic: r.topic };
  }
  let via: string[] = [];

  // 3) navigation ("öffne das Labor") – only when the journal parser found no subject of its own ("markt" alone reads
  //    as an asset group-by, so short requests ignore that)
  {
    const page = pageOf(norm0);
    const short = norm0.trim().split(" ").length <= 5;
    if (page && !intent.metricExplicit && !intent.behavior && !intent.period && !intent.filters.length && (!intent.groupBy || short)) return { kind: "tool", tool: "navigate", arg: page, via: [`Seite: ${PAGE_LABEL[page]}`], topic: `page:${page}` };
  }

  // 3b) "Öffne den Belastungstest", "Starte die Demo": an opening verb and something the journal does not ask about – the function
  //     register finds the place (`whereTool`: a clear hit opens, close ones are offered, no hit says so)
  if (!ownSubject(intent) && !intent.filters.length && OPEN_VERB.test(raw)) {
    const thing = raw.replace(OPEN_VERB, "").trim();
    if (thing && thing.split(/\s+/).length <= 5) return { kind: "tool", tool: "where", arg: thing, via: ["Funktion öffnen"], topic: "where" };
  }

  // 4) typo repair
  if (intent.type === "unknown") {
    const extra = [...ctx.parse.setups.map((s) => s.name), ...ctx.parse.assets, ...(ctx.parse.tags ?? [])];
    const rep = repairTypos(raw, extra);
    if (rep.fixes.length) {
      const again = parse(rep.text);
      if (again.type !== "unknown") {
        intent = again;
        via = rep.fixes.map(([a, b]) => `${a} → ${b}`);
      } else {
        // the repaired text may hit a tool / phrase rule
        const n2 = normalize(rep.text);
        for (const r of TOOL_RULES) if (r.test.test(n2)) return { kind: "tool", tool: r.tool, arg: raw, via: [r.label, ...rep.fixes.map(([a, b]) => `${a} → ${b}`)], topic: r.topic };
        const pg = pageOf(n2);
        if (pg) return { kind: "tool", tool: "navigate", arg: pg, via: [`Seite: ${PAGE_LABEL[pg]}`], topic: `page:${pg}` };
        for (const p of PHRASES) if (p.test.test(n2)) return phrasePlan(p, ctx, rep.fixes.map(([a, b]) => `${a} → ${b}`));
      }
    }
  }

  // 5) colloquial phrases
  if (intent.type === "unknown") for (const p of PHRASES) if (p.test.test(norm0)) return phrasePlan(p, ctx, []);

  // 5b) a short continuation of the last evaluation: "und letzte Woche?", "und auf 1h?" – the old question with the new period / timeframe behind it
  if (ctx.prevTool && FOLLOW_START.test(norm0) && followsInsight(norm0, ctx.prevTool.tool)) {
    const prev = ctx.prevTool;
    const topic = INSIGHT_RULES.find((r) => r.tool === prev.tool)?.topic ?? prev.tool;
    return { kind: "tool", tool: prev.tool, arg: `${prev.question} ${raw}`, via: ["Folgefrage zu: " + prev.question.slice(0, 40)], topic };
  }

  // 6) a continuation of the last question
  if (ctx.prev && intent.type !== "unknown" && looksLikeFollowUp(norm0, intent)) {
    const merged = mergeFollowUp(ctx.prev, intent);
    return { kind: "journal", intents: [merged], via: ["Folgefrage zu: " + ctx.prev.raw.split(" → ")[0]!.slice(0, 40), ...via], topic: topicOfIntent(merged) };
  }
  if (ctx.prev && intent.type === "unknown" && FOLLOW_START.test(norm0)) {
    const next = parse(norm0.replace(FOLLOW_START, " ").trim() || raw);
    if (next.type !== "unknown") {
      const merged = mergeFollowUp(ctx.prev, next);
      return { kind: "journal", intents: [merged], via: ["Folgefrage"], topic: topicOfIntent(merged) };
    }
  }

  if (intent.type === "unknown") return { kind: "clarify", text: CLARIFY_TEXT, suggestions: closestQuestions(raw) };
  return { kind: "journal", intents: [intent], via, topic: topicOfIntent(intent) };
}

function phrasePlan(p: PhraseRule, ctx: UnderstandCtx, via: string[]): Plan {
  // without trades one honest answer is enough – three empty ones say nothing more
  const qs = ctx.closed < 3 ? p.questions.slice(0, 1) : p.questions;
  return { kind: "journal", intents: qs.map((q) => parseQuestion(q, ctx.parse)), via: [p.label, ...via], topic: p.topic };
}
