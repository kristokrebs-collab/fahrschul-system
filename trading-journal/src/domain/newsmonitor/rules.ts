/**
 * How important a headline LOOKS – from keywords in its title, nothing else. The result is a hint to read it first, never
 * a trading signal and never a statement about what the news means for the price. Every rating shows the words that
 * caused it (`matched`), so it can be checked and disagreed with.
 *
 * Tags follow the trader-news skill: earnings, analyst, legal, deal, capital, people, risk, halt, regulatory, macro.
 * Weights: 3 = the kinds of news that can gap a stock (bankruptcy, takeover, lawsuit, halt, restatement), 2 = scheduled or
 * company events (results, guidance, offerings, management changes, approvals), 1 = commentary (analyst opinions,
 * market-wide talk). Headlines are English (Yahoo); German words are listed too for sources that write German.
 * The wording of a rule is deliberately narrow: "settles lower" is not a lawsuit, "CEO says …" is not a management change.
 */
export type NewsTag = "earnings" | "analyst" | "legal" | "deal" | "capital" | "people" | "risk" | "halt" | "regulatory" | "macro";

export const TAG_LABEL: Readonly<Record<NewsTag, string>> = {
  earnings: "Zahlen",
  analyst: "Analysten",
  legal: "Recht",
  deal: "Übernahme",
  capital: "Kapital",
  people: "Personal",
  risk: "Risiko",
  halt: "Handelsstopp",
  regulatory: "Aufsicht",
  macro: "Markt",
};

export interface NewsRule {
  tag: NewsTag;
  weight: 1 | 2 | 3;
  re: RegExp;
}

export const NEWS_RULES: readonly NewsRule[] = [
  // 3 – can move a stock overnight
  { tag: "risk", weight: 3, re: /\b(bankruptcy|bankrupt|chapter 11|chapter 7|insolvency|insolvenz|going concern|delisting|delisted|fraud|restate(?:s|d|ment)?|accounting irregularities|short[- ]seller report|short report|cyber ?attack|data breach)\b/i },
  { tag: "halt", weight: 3, re: /\b(trading (?:was )?halt(?:ed)?|halted|handelsaussetzung|volatility halt)\b/i },
  { tag: "legal", weight: 3, re: /\b(lawsuit|sues|sued|class[- ]action|klage|subpoena|indict(?:ed|ment)?|criminal charges|investigation|probe[ds]? (?:into|of|over)|(?:sec|doj|ftc|federal|regulators?|criminal) probe)\b/i },
  { tag: "deal", weight: 3, re: /\b(acquire[sd]?|acquisition|takeover|buyout|merger|merge[sd]?|fusion|bid for)\b/i },
  // `\b` knows no umlauts: a word that starts with one needs its own boundary
  { tag: "deal", weight: 3, re: /(?<![\p{L}\p{N}])übernahme/iu },
  // 2 – company events
  { tag: "earnings", weight: 2, re: /\b(earnings|quarterly results|quarterly report|q[1-4] (?:results|earnings|revenue)|revenue|profit|eps|beats? (?:estimates|expectations|forecasts|views)|misses (?:estimates|expectations|forecasts|views)|quartalszahlen|guidance|outlook|forecast|prognose)\b/i },
  { tag: "capital", weight: 2, re: /\b(offering|dilution|share sale|stock split|reverse split|buyback|repurchase|dividend|kapitalerhöhung|dividende)\b/i },
  { tag: "people", weight: 2, re: /\b(?:ceo|cfo|coo|chairman|chief [a-z]+ officer)\b.{0,32}\b(?:resign\w*|steps? down|replac\w*|appoint\w*|named|fired|ousted|departure|exits?|retire\w*)\b|\b(?:resign\w*|steps? down|appoints?|names|rücktritt)\b.{0,24}\b(?:ceo|cfo|coo|chairman|chief [a-z]+ officer)\b/i },
  { tag: "regulatory", weight: 2, re: /\b(fda|approval|approves?|approved|recall|antitrust|ftc|doj|sec (?:charges|probe|filing|settles)|tariffs?|sanctions?)\b/i },
  // 1 – commentary
  { tag: "analyst", weight: 1, re: /\b(upgrade[sd]?|downgrade[sd]?|price target|kursziel|initiates coverage|analyst(?:s)?)\b/i },
  { tag: "macro", weight: 1, re: /\b(fed|fomc|cpi|inflation|jobs report|rate (?:cut|hike)|futures|pre-?market|s&p 500|dow jones|nasdaq composite|wall street)\b/i },
];
