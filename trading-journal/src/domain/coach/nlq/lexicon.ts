/**
 * German lexicon of the question parser (P04 NLQ): normalisation (lower case, ß → ss, umlauts → ae/oe/ue, punctuation
 * to spaces) and the synonym tables for metrics, dimensions, filter values, periods and behaviours. Every phrase is
 * normalised once at module load, so the tables can be written in plain German.
 */
import type { BehaviorKey } from "../events";
import type { DimensionKey } from "../../analytics/dimensions";

/** Lower case, ß → ss, ä/ö/ü → ae/oe/ue, Ø kept, `#` kept for tags, everything else that is not a word → space. */
export function normalize(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/([a-zø])-(?=[a-zø])/g, "$1 ")
    .replace(/[“”„"«»]/g, " ")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^a-z0-9ø#%.+\-&/ ]+/g, " ")
    .replace(/(?<![0-9])[.](?![0-9])/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/** Normalised phrase list, longest first (so "profit factor" wins over "profit"). */
const phrases = (xs: readonly string[]): string[] => [...new Set(xs.map((x) => normalize(x).trim()))].sort((a, b) => b.length - a.length);

/** Position of a phrase as whole words in a normalised text (−1 when absent). */
export function findPhrase(norm: string, phrase: string): number {
  return norm.indexOf(` ${phrase} `);
}

/** First matching phrase of a list (longest first) with its position. */
export function firstOf(norm: string, list: readonly string[]): { phrase: string; at: number } | null {
  let best: { phrase: string; at: number } | null = null;
  for (const p of list) {
    const at = findPhrase(norm, p);
    if (at >= 0 && (!best || p.length > best.phrase.length)) best = { phrase: p, at };
  }
  return best;
}

export type MetricKey = "net" | "winRate" | "pf" | "avgR" | "expectancy" | "count" | "fees" | "maxDD" | "avgWin" | "avgLoss" | "best" | "worst" | "hold" | "streak" | "payoff" | "sumR";

export const METRIC_LABEL: Readonly<Record<MetricKey, string>> = {
  net: "Netto-P&L",
  winRate: "Win-Rate",
  pf: "Profit-Faktor",
  avgR: "Ø R",
  expectancy: "Erwartung pro Trade",
  count: "Anzahl Trades",
  fees: "Gebühren",
  maxDD: "Max. Drawdown",
  avgWin: "Ø Gewinner",
  avgLoss: "Ø Verlierer",
  best: "Bester Trade",
  worst: "Schlechtester Trade",
  hold: "Haltedauer",
  streak: "Serie",
  payoff: "Payoff",
  sumR: "Summe R",
};

/** Metric synonyms (checked longest phrase first over all metrics). */
export const METRIC_SYNONYMS: Readonly<Record<MetricKey, string[]>> = {
  pf: phrases(["profit factor", "profitfaktor", "profit-faktor", "pf"]),
  winRate: phrases(["win rate", "winrate", "win-rate", "trefferquote", "gewinnquote", "trefferrate", "quote", "wie oft gewinne", "wie oft gewonnen", "wie oft gewinn", "wr", "hit rate", "hitrate"]),
  avgR: phrases(["durchschnittliches r", "durchschnittlich r", "durchschnitts r", "schnitt r", "ø r", "avg r", "r multiple", "r-multiple", "r multiples", "mittleres r", "r pro trade", "r im schnitt", "durchschnittliche r"]),
  expectancy: phrases(["erwartung", "erwartungswert", "expectancy", "pro trade im schnitt", "durchschnitt pro trade", "ø pro trade", "verdiene ich pro trade"]),
  net: phrases(["gewinn", "gewinne", "verdient", "verdiene", "verdienst", "pnl", "p&l", "p l", "netto", "ergebnis", "profit", "verlust", "verluste", "verloren", "verliere", "plus", "minus", "performance", "bilanz", "geld", "gemacht"]),
  count: phrases(["wie viele", "wieviele", "wie viel trades", "anzahl", "how many", "wie oft"]),
  fees: phrases(["gebuehren", "gebuehr", "fees", "kommission", "kommissionen", "trading kosten", "funding"]),
  maxDD: phrases(["drawdown", "max dd", "maximaler drawdown", "dd", "einbruch", "rueckgang"]),
  avgWin: phrases(["durchschnittlicher gewinn", "durchschnittsgewinn", "ø gewinner", "ø gewinn", "avg win", "durchschnittlicher gewinner"]),
  avgLoss: phrases(["durchschnittlicher verlust", "durchschnittsverlust", "ø verlierer", "ø verlust", "avg loss", "durchschnittlicher verlierer"]),
  best: phrases(["groesster gewinn", "groessten gewinn", "bester trade", "besten trade", "hoechster gewinn", "hoechsten gewinn", "top trade", "bestes ergebnis"]),
  worst: phrases(["groesster verlust", "groessten verlust", "schlechtester trade", "schlechtesten trade", "hoechster verlust", "hoechsten verlust", "schlimmster trade", "schlimmsten trade", "schlechtestes ergebnis"]),
  hold: phrases(["haltedauer", "haltezeit", "wie lange halte", "wie lange", "halte ich", "halten"]),
  streak: phrases(["serie", "serien", "streak", "in folge", "am stueck", "gewinnserie", "verlustserie"]),
  payoff: phrases(["payoff", "crv", "chance risiko", "gewinn verlust verhaeltnis"]),
  sumR: phrases(["summe r", "r gesamt", "gesamt r", "wie viele r", "wieviel r", "wie viel r"]),
};

export type GroupDim = Extract<DimensionKey, "setup" | "session" | "weekday" | "hour" | "asset" | "month" | "leverage" | "timeframe" | "emotion" | "side" | "account" | "conviction" | "regime" | "strength" | "tag" | "exchange" | "hold">;

export const DIM_NOUNS: Readonly<Record<GroupDim, string[]>> = {
  setup: phrases(["setup", "setups", "strategie", "strategien", "grundlage", "grundlagen", "playbook", "playbooks"]),
  session: phrases(["session", "sessions", "handelssession", "handelszeit"]),
  weekday: phrases(["wochentag", "wochentage", "wochentagen", "tag der woche"]),
  hour: phrases(["uhrzeit", "uhrzeiten", "stunde", "stunden", "tageszeit"]),
  asset: phrases(["coin", "coins", "paar", "paare", "asset", "assets", "symbol", "symbole", "markt", "maerkte", "token", "kryptowaehrung"]),
  month: phrases(["monat", "monate", "monaten"]),
  leverage: phrases(["hebel", "hebelstufe"]),
  timeframe: phrases(["timeframe", "timeframes", "zeiteinheit", "zeiteinheiten", "zeitrahmen"]),
  emotion: phrases(["emotion", "emotionen", "gefuehl", "gefuehle", "stimmung"]),
  side: phrases(["richtung", "seite", "long oder short", "long short"]),
  account: phrases(["konto", "konten", "account"]),
  conviction: phrases(["ueberzeugung", "conviction"]),
  regime: phrases(["lage", "regime", "marktlage"]),
  strength: phrases(["signal staerke", "signalstaerke", "signal-staerke", "staerke"]),
  tag: phrases(["tags", "hashtags"]),
  exchange: phrases(["boerse", "boersen", "exchange", "exchanges"]),
  hold: phrases(["haltedauer", "haltezeit"]),
};

/** Words that turn a dimension noun into a group-by ("pro Setup", "welche Session", "bestes Setup"). */
export const GROUP_TRIGGERS = phrases(["pro", "je", "nach", "welche", "welcher", "welches", "welchen", "welchem", "beste", "bester", "bestes", "besten", "schlechteste", "schlechtester", "schlechtestes", "schlechtesten", "an welchem", "in welcher", "zu welcher", "um welche", "aufgeschluesselt nach", "aufgeteilt nach", "staerkste", "staerkstes", "schwaechste", "schwaechstes", "profitabelste", "profitabelstes", "top"]);

export const SORT_BEST = phrases(["am besten", "beste", "bester", "bestes", "besten", "profitabelste", "profitabelsten", "profitabelstes", "am profitabelsten", "am meisten verdient", "verdiene am meisten", "staerkste", "staerkstes", "top", "lohnt sich", "lohnt sich am meisten"]);
export const SORT_WORST = phrases(["am schlechtesten", "schlechteste", "schlechtester", "schlechtestes", "schlechtesten", "schwaechste", "schwaechstes", "verliere am meisten", "verliere ich am meisten", "verliere ich", "am meisten verloren", "meisten verluste", "die meisten verluste", "am meisten verlust", "teuerste", "teuersten", "teuerstes", "am teuersten", "kostet am meisten", "kosten am meisten", "flop", "vermeiden"]);
export const COMPARE_WORDS = phrases(["vergleich", "vergleiche", "vergleichen", "vs", "versus", "gegen", "gegenueber", "im vergleich", "unterschied", "oder", "vs."]);
export const LIST_WORDS = phrases(["zeig", "zeige", "zeig mir", "zeige mir", "liste", "auflisten", "welche trades", "alle trades", "meine trades", "trades anzeigen"]);
export const SUMMARY_WORDS = phrases(["wie war", "wie lief", "wie laeuft", "wie lief es", "zusammenfassung", "ueberblick", "wie stehe ich", "bilanz", "rueckblick", "fazit", "status", "wie geht es"]);

export interface FilterValue {
  value: string;
  label: string;
  syn: string[];
}

const fv = (value: string, label: string, syn: string[]): FilterValue => ({ value, label, syn: phrases(syn) });

export const SIDE_VALUES: readonly FilterValue[] = [fv("long", "Long", ["long", "longs", "long trades", "long-trades", "kauf", "kaeufe"]), fv("short", "Short", ["short", "shorts", "short trades", "short-trades", "leerverkauf", "leerverkaeufe"])];
export const ACCOUNT_VALUES: readonly FilterValue[] = [fv("makro", "Makro", ["makro", "macro", "makro konto", "makrokonto"]), fv("scalp", "Scalp", ["scalp", "scalps", "scalping", "scalp konto", "scalpkonto"])];
export const WEEKDAY_VALUES: readonly FilterValue[] = [
  fv("0", "Montag", ["montag", "montags", "montagen"]),
  fv("1", "Dienstag", ["dienstag", "dienstags"]),
  fv("2", "Mittwoch", ["mittwoch", "mittwochs"]),
  fv("3", "Donnerstag", ["donnerstag", "donnerstags"]),
  fv("4", "Freitag", ["freitag", "freitags"]),
  fv("5", "Samstag", ["samstag", "samstags", "sonnabend"]),
  fv("6", "Sonntag", ["sonntag", "sonntags"]),
];
export const SESSION_VALUES: readonly FilterValue[] = [
  fv("asia", "Asien", ["asien", "asia", "asien session", "asiatische session", "asiatischen session", "tokio", "tokyo"]),
  fv("london", "London", ["london", "london session", "europa", "europaeische session"]),
  fv("ny", "New York", ["new york", "newyork", "ny", "us session", "amerikanische session", "wall street"]),
  fv("late", "Spät", ["spaet", "spaete session", "spaeten session", "nachts", "abends spaet"]),
  fv("weekend", "Wochenende", ["wochenende", "wochenenden", "weekend", "am wochenende"]),
];
export const RESULT_VALUES: readonly FilterValue[] = [
  fv("win", "Gewinner", ["gewinner", "gewinntrades", "gewinn trades", "winner", "gewonnenen trades", "gewinnende trades"]),
  fv("loss", "Verlierer", ["verlierer", "verlusttrades", "verlust trades", "loser", "verlorenen trades", "verlierende trades"]),
  fv("be", "Break-even", ["break even", "break-even", "breakeven"]),
];
export const EMOTION_VALUES: readonly FilterValue[] = [fv("Ruhig", "Ruhig", ["ruhig", "gelassen"]), fv("Fokussiert", "Fokussiert", ["fokussiert", "konzentriert"]), fv("Unsicher", "Unsicher", ["unsicher"]), fv("Gierig", "Gierig", ["gierig", "gier"])];
export const ASSET_ALIASES: Readonly<Record<string, string>> = { bitcoin: "BTC", ethereum: "ETH", ether: "ETH", solana: "SOL", ripple: "XRP", dogecoin: "DOGE", cardano: "ADA", binance: "BNB" };
export const QUOTE_SUFFIX = /(USDT|USDC|BUSD|FDUSD|USD|EUR|PERP)$/;
/** Tickers the parser knows even when the journal has no trade in them (a question about them gets an honest "keine Trades"). */
export const COMMON_ASSETS: readonly string[] = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "AVAX", "LINK", "DOT", "LTC", "TON", "SUI", "PEPE", "TRX", "NEAR", "APT", "ARB", "OP", "INJ", "WIF", "SEI", "TIA", "AAVE", "UNI", "ATOM", "FIL", "ETC", "BCH", "HBAR", "ENA", "TAO", "HYPE"];

export const BEHAVIOR_SYNONYMS: Readonly<Record<BehaviorKey, string[]>> = {
  revenge: phrases(["revenge", "revenge trade", "revenge trades", "revenge-trades", "rache", "rachetrades", "rache trades", "racheakt"]),
  tilt: phrases(["tilt", "tilten", "auf tilt", "tilt trades"]),
  overtrading: phrases(["overtrading", "uebertraden", "zu viele trades", "zu viel getradet", "ueberhandeln"]),
  fomo: phrases(["fomo", "fomo trades", "fomo-trades", "fomo einstiege", "fomo-einstiege", "hinterhergelaufen", "hinterherlaufen"]),
  stopMoved: phrases(["stop verschoben", "stopp verschoben", "stop verschiebe", "stop verschieben", "stops verschoben", "stop moved"]),
  earlyProfit: phrases(["zu frueh raus", "zu frueh ausgestiegen", "gewinne zu frueh", "frueh gewinne mitnehmen", "fruehe gewinnmitnahme", "gewinnmitnahme zu frueh"]),
  lossAversion: phrases(["verlustangst", "verluste aussitzen", "verlierer halten", "verluste laufen lassen", "loss aversion"]),
  overconfidence: phrases(["selbstueberschaetzung", "overconfidence", "uebermut", "ueberheblich", "zu selbstsicher"]),
  impulsive: phrases(["impulsiv", "impulsive", "impulsive trades", "impulsiver einstieg", "spontan"]),
  boredom: phrases(["langeweile", "aus langeweile", "langeweile trades", "gelangweilt"]),
  ruleViolation: phrases(["regelverstoss", "regelverstoesse", "regelbruch", "regelbrueche", "regeln gebrochen", "regeln verletzt", "gegen meine regeln", "regelverletzung"]),
};

export const MONTHS = ["januar", "februar", "maerz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"] as const;
export const MONTH_SHORT = ["jan", "feb", "maer", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"] as const;
export const MONTH_LABEL = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"] as const;
