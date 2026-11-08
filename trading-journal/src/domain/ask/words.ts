/**
 * The known words of the question bar (Paket F2): everything the NLQ lexicon, the audit questions and the period parser understand,
 * plus the small filler words of a German question ("wie", "habe", "ich", "meine" …). A word of four or more letters that is in none
 * of these is NOT understood – and then the question is not answered at all: guessing the rest ("Win-Rate bei Bitcoinn" → the win rate of
 * everything) would be a wrong number that looks right. Pure.
 */
import {
  ACCOUNT_VALUES,
  ASSET_ALIASES,
  BEHAVIOR_SYNONYMS,
  COMMON_ASSETS,
  COMPARE_WORDS,
  DIM_NOUNS,
  EMOTION_VALUES,
  GROUP_TRIGGERS,
  LIST_WORDS,
  METRIC_SYNONYMS,
  MONTHS,
  MONTH_SHORT,
  RESULT_VALUES,
  SESSION_VALUES,
  SIDE_VALUES,
  SORT_BEST,
  SORT_WORST,
  SUMMARY_WORDS,
  WEEKDAY_VALUES,
  normalize,
} from "../coach/nlq/lexicon";
import { AUDIT_WORDS } from "../coach/nlq/audit";

/** Filler words of a question and the period words (written plain; umlauts are folded by `normalize`). */
const FILLER = [
  "wie, was, wer, wann, wo, warum, wieso, weshalb, welche, welcher, welches, welchen, welchem, wieviel, wieviele, viel, viele, wenig, wenige",
  "ist, sind, war, waren, bin, bist, habe, haben, hatte, hatten, hast, wird, werden, wurde, wurden, kann, koennen, konnte, will, soll, sollte, mache, machen, gemacht, mein, meine, meiner, meinem, meinen, meines, dein, deine, deiner, deinen",
  "ich, mir, mich, wir, uns, sie, ihr, man, dies, diese, dieser, dieses, diesem, diesen, der, die, den, dem, des, ein, eine, einen, einem, einer, eines",
  "und, oder, aber, auch, nur, noch, schon, sehr, mehr, weniger, meisten, wenigsten, meiste, kein, keine, keinen, keiner, nicht, nichts, alle, alles, allen, aller, jeder, jede, jedes, jeden, eigentlich, bitte, eher, etwa, ungefaehr, genau, insgesamt, gesamt, ueberhaupt, bisher, jemals, immer, oft, selten, manchmal, ganz, ganze, ganzen",
  "auf, aus, bei, beim, mit, ohne, von, vom, vor, nach, seit, bis, zum, zur, fuer, ueber, unter, gegen, als, wenn, dass, dann, damit, dabei, davon, dafuer, hier, dort",
  "heute, gestern, morgen, woche, wochen, tag, tage, tagen, monat, monate, monaten, monats, jahr, jahre, jahren, jahres, quartal, quartale, zeit, zeitraum, zuletzt",
  "letzte, letzten, letzter, letztem, letztes, vergangene, vergangenen, vergangener, vergangenes, vorige, vorigen, voriger, vorigem, vorherige, vorherigen, aktuelle, aktuellen, aktueller, aktuellem, laufende, laufenden, laufender, laufendem, naechste, naechsten, erste, ersten, zweite, zweiten, dritte, dritten, vierte, vierten, vormonat, vorwoche, vorjahr",
  "trade, trades, trading, handel, handeln, handle, gehandelt, getradet, eintrag, eintraege, journal, daten, zahlen, ergebnis, ergebnisse, anzeigen, zeigen, zeig, zeige, nenne, nenn, sage, gib, gibt, geben, suche, suchen, finde, finden, liste, hatte, gab, lief, laeuft, steht, stehe, geht, gehe, lohnt, besser, schlechter, staerker, schwaecher, groesser, kleiner, hoeher, niedriger, hoechste, hoechster, hoechsten, niedrigste, niedrigsten",
  "prozent, euro, usdt, dollar, geld, handelstag, handelstage, handelstagen, position, positionen, einstieg, einstiege, ausstieg, ausstiege, einstiegen, kauf, kaeufe, verkauf, verkaeufe, offen, offene, offenen, abgeschlossen, abgeschlossene, abgeschlossenen, geschlossen, geschlossene",
  "stop, stopp, stops, stopps, stoploss, loss, verschoben, verschieben, verschiebe, checkliste, checklisten, review, reviews, notiz, notizen, plan, regel, regeln, regelverstoss, regelverstoesse",
  "gewonnen, gewinn, gewinne, verloren, verlust, verluste, verlieren, verliere, verdient, verdiene, verdienen, verdienst, laufen, lassen, halte, halten, gehalten, bester, beste, bestes, besten, schlechteste, schlechtester, schlechtestes, schlechtesten, groessten, groesster, groesste, groesstes, kleinsten, kleinster, kleinste",
  "durchschnitt, durchschnittlich, durchschnittliche, durchschnittlicher, durchschnittlichen, durchschnittliches, schnitt, summe, gesamtsumme, mittel, mittlere, mittlerer, mittleres, median, typisch, typische, typischer, typischen",
  "gesetzt, gesetzte, gesetzten, eingetragen, eingetragene, eingetragenen, profitabler, erfolgreicher, teurer, lohnender, haeufiger, seltener, laenger, kuerzer",
  "frage, fragen, antwort, antworten, kurz, kurze, einfach, einfache, wirklich, richtig, falsch, gut, gute, guter, guten, gutes, schlecht, schlechte, schlechten, schlechter, schlechtes, normal, normale, normalen",
].join(", ");

const split = (p: string): string[] => p.split(" ");
const valueWords = (vs: readonly { syn: readonly string[] }[]): string[] => vs.flatMap((v) => v.syn.flatMap(split));

/** The closed set of words the bar understands (normalised, lower case). */
export const KNOWN: ReadonlySet<string> = new Set([
  ...FILLER.split(",").flatMap((x) => normalize(x).trim().split(" ")),
  ...Object.values(METRIC_SYNONYMS).flatMap((l) => l.flatMap(split)),
  ...Object.values(DIM_NOUNS).flatMap((l) => l.flatMap(split)),
  ...Object.values(BEHAVIOR_SYNONYMS).flatMap((l) => l.flatMap(split)),
  ...GROUP_TRIGGERS.flatMap(split),
  ...SORT_BEST.flatMap(split),
  ...SORT_WORST.flatMap(split),
  ...COMPARE_WORDS.flatMap(split),
  ...LIST_WORDS.flatMap(split),
  ...SUMMARY_WORDS.flatMap(split),
  ...valueWords(SIDE_VALUES),
  ...valueWords(ACCOUNT_VALUES),
  ...valueWords(WEEKDAY_VALUES),
  ...valueWords(SESSION_VALUES),
  ...valueWords(RESULT_VALUES),
  ...valueWords(EMOTION_VALUES),
  ...MONTHS,
  ...MONTH_SHORT,
  ...AUDIT_WORDS,
]);

/** Names of assets: known exactly, never "inflected" ("Bitcoinn" is a typo, not a plural). */
const EXACT: ReadonlySet<string> = new Set([...Object.keys(ASSET_ALIASES), ...COMMON_ASSETS.map((a) => a.toLowerCase())]);

/** Suffixes German adds to a word it knows ("Verlusten", "Setups", "bestes"). Not a bare "n": "Bitcoinn" must not pass for "Bitcoin". */
const SUFFIXES = ["e", "s", "en", "er", "es", "em", "st", "te", "ten"] as const;

const isKnownWord = (w: string): boolean => EXACT.has(w) || KNOWN.has(w) || SUFFIXES.some((s) => w.length > s.length + 2 && w.endsWith(s) && KNOWN.has(w.slice(0, -s.length)));

export interface UnknownContext {
  /** names of the journal's setups */
  setups: readonly { name: string }[];
  /** asset bases the journal trades ("BTC") */
  assets: readonly string[];
  tags?: readonly string[];
}

/**
 * The words of a normalised question that the bar does not know: letters only, four or more of them, not part of a setup name, an
 * asset, a tag, a number ("30 Tage", "4x", "15m", "q3") or a hashtag. Empty = every word is accounted for.
 */
export function unknownWords(norm: string, ctx: UnknownContext): string[] {
  const own = new Set<string>([
    ...ctx.setups.flatMap((s) => normalize(s.name).trim().split(" ")),
    ...ctx.assets.flatMap((a) => [a.toLowerCase(), `${a.toLowerCase()}usdt`, `${a.toLowerCase()}usd`]),
    ...(ctx.tags ?? []).flatMap((t) => normalize(t).trim().split(" ")),
  ]);
  const out: string[] = [];
  for (const raw of norm.trim().split(" ")) {
    const w = raw.replace(/^[^a-z]+|[^a-z]+$/g, "");
    if (w.length < 4 || /\d/.test(raw) || raw.startsWith("#")) continue;
    if (isKnownWord(w) || own.has(w)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}
