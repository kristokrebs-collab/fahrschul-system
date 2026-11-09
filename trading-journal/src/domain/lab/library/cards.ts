/**
 * Strategy library (F06 / F15): well-known strategy IDEAS as cards that load into "Eigene Idee" as a draft. Each card names
 * the idea, where it is known from (neutral, general knowledge – no claim about how it performs), which market phase it is
 * meant for, its typical weaknesses, the usual timeframes and TYPICAL VALUES in three settings:
 *
 *   konservativ  slower / stricter – fewer signals
 *   Standard     the setting the idea is usually described with
 *   aggressiv    faster / looser – more signals
 *
 * "Aggressiv" says nothing about profit: more signals also means more false ones and more costs. No card carries a backtest
 * result – any number about an idea comes from a run of the trader on real history, in the lab.
 *
 * The numbers are ONE source of truth: `specs` list them with an explanation for the card, `make(values)` builds the rule
 * tree from the very same values. Loading a card changes nothing else – no run starts.
 */
import { defaultParams, sanitizeParams } from "../rules/blocks";
import { DEFAULT_EXITS, defaultCustom, mirrorGroup, newGroup, sanitizeCustom } from "../rules/tree";
import type { BlockId, CustomConfig, ExitsCfg, Group, Leaf, LeafParams, SidesCfg, StopCfg, TfId } from "../rules/types";

export type StrategyKind = "trend" | "reversion" | "breakout" | "volatility" | "momentum";

export const KIND_LABEL: Readonly<Record<StrategyKind, string>> = {
  trend: "Trend",
  reversion: "Mean-Reversion",
  breakout: "Ausbruch",
  volatility: "Volatilität",
  momentum: "Momentum",
};
export const KIND_ORDER: readonly StrategyKind[] = ["trend", "reversion", "breakout", "volatility", "momentum"];

export type LibLevel = "conservative" | "standard" | "aggressive";
export const LEVELS: readonly LibLevel[] = ["conservative", "standard", "aggressive"];
export const LEVEL_LABEL: Readonly<Record<LibLevel, string>> = { conservative: "Konservativ", standard: "Standard", aggressive: "Aggressiv" };
export const LEVEL_NOTE: Readonly<Record<LibLevel, string>> = {
  conservative: "langsamer oder strenger: weniger Signale, dafür weniger Fehlsignale und Kosten",
  standard: "die Einstellung, mit der die Idee meist beschrieben wird",
  aggressive: "schneller oder lockerer: mehr Signale, aber auch mehr falsche und mehr Kosten",
};

/** One typical value with its three settings. `unit` is shown behind the number. */
export interface LibParam {
  key: string;
  name: string;
  /** what the number does, one sentence */
  what: string;
  unit?: string;
  /** konservativ · Standard · aggressiv */
  v: readonly [number, number, number];
}

export interface StrategyCard {
  id: string;
  title: string;
  kind: StrategyKind;
  /** one sentence: what the idea bets on */
  sub: string;
  /** neutral and general: where the idea is described (author / school), no promise */
  knownFrom: string;
  /** the market phase it is meant for */
  phase: string;
  /** typical weaknesses */
  weaknesses: readonly string[];
  /** usual timeframes; the first is what the draft uses */
  tfs: readonly TfId[];
  params: readonly LibParam[];
  /** extra requirement shown on the card */
  needs?: "volume" | "funding";
  /** an approximation of something the lab only has as its own strategy – said on the card */
  approx?: string;
  make(v: Readonly<Record<string, number>>): CustomConfig;
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

let seq = 0;
function leaf(block: BlockId, params: LeafParams, tf: "exec" | TfId = "exec"): Leaf {
  return { type: "leaf", id: `n${++seq}`, block, tf, params: sanitizeParams(block, { ...defaultParams(block), ...params }) };
}

const exitsOf = (patch: Partial<ExitsCfg>): ExitsCfg => ({ ...(JSON.parse(JSON.stringify(DEFAULT_EXITS)) as ExitsCfg), ...patch });

interface IdeaOpts {
  name: string;
  interval: TfId;
  sides: SidesCfg;
  /** the long conditions (all must hold); the short side is their mirror when `sides` is not "long" */
  long: Leaf[];
  op?: "and" | "or";
  stop: Partial<StopCfg>;
  /** R multiple, or null = no fixed target */
  target: number | null;
  exits?: Partial<ExitsCfg>;
}

function idea(o: IdeaOpts): CustomConfig {
  const long = newGroup("g1", o.op ?? "and", o.long);
  const d = defaultCustom();
  return sanitizeCustom({
    ...d,
    name: o.name,
    interval: o.interval,
    sides: o.sides,
    long,
    short: mirrorGroup(long, "g2", o.long.length + 10),
    stop: { ...d.stop, ...o.stop },
    target: o.target == null ? { kind: "none", r: 2 } : { kind: "r", r: o.target },
    exits: exitsOf(o.exits ?? {}),
  });
}

const atrStop = (k: number): Partial<StopCfg> => ({ kind: "atr", atr: k });
const trail = (atr: number, activateR = 1): Partial<ExitsCfg> => ({ trail: { on: true, kind: "atr", value: atr, activateR } });

/** The stop distance and the target, the same two typical values on most cards. */
const STOP = (v: [number, number, number]): LibParam => ({ key: "stopAtr", name: "Stop-Abstand", what: "Wie weit der Stop vom Einstieg liegt, in Vielfachen der ATR(14). Enger = kleinere Verluste je Trade, aber öfter ausgestoppt.", unit: "× ATR", v });
const TARGET = (v: [number, number, number]): LibParam => ({ key: "targetR", name: "Ziel", what: "Gewinnziel als Vielfaches des Risikos (R). 2 R heißt: doppelt so weit wie der Stop.", unit: "R", v });
const TRAIL = (v: [number, number, number]): LibParam => ({ key: "trailAtr", name: "Trailing-Stop", what: "Abstand des nachziehenden Stops hinter dem besten Kurs, in Vielfachen der ATR(14). Weiter = mehr Luft, gibt aber mehr Gewinn zurück.", unit: "× ATR", v });

// ── the cards ─────────────────────────────────────────────────────────────────────────────────────────────────

export const STRATEGY_CARDS: readonly StrategyCard[] = [
  // ── Trend ──
  {
    id: "ema-cross",
    title: "EMA-Kreuz 9/21",
    kind: "trend",
    sub: "Der schnelle EMA kreuzt den langsamen: der Trend dreht, man folgt ihm bis zum Gegensignal.",
    knownFrom: "Eine der bekanntesten Trendfolge-Regeln mit gleitenden Durchschnitten; in der Lehrbuch-Literatur zur technischen Analyse seit Jahrzehnten beschrieben.",
    phase: "Klare, anhaltende Trends. In Seitwärtsphasen kreuzen sich die Linien ständig.",
    weaknesses: ["Viele Fehlsignale und Kosten in Seitwärtsphasen (Whipsaws).", "Der Einstieg kommt spät: ein Teil der Bewegung ist beim Kreuz schon gelaufen.", "Ohne Trendfilter handelt die Idee jede kleine Welle."],
    tfs: ["1h", "4h", "15m"],
    params: [
      { key: "fast", name: "Schneller EMA", what: "Länge des schnellen gleitenden Durchschnitts in Kerzen. Kürzer = reagiert früher.", unit: "Kerzen", v: [13, 9, 5] },
      { key: "slow", name: "Langsamer EMA", what: "Länge des langsamen Durchschnitts. Der Abstand zum schnellen bestimmt, wie viele Wellen als Trend zählen.", unit: "Kerzen", v: [34, 21, 13] },
      STOP([2.5, 2, 1.5]),
      TRAIL([3, 2.5, 2]),
    ],
    make: (v) =>
      idea({ name: "EMA-Kreuz 9/21", interval: "1h", sides: "both", long: [leaf("maCross", { type: "ema", fast: v.fast!, slow: v.slow!, mode: "up", within: 1 })], stop: atrStop(v.stopAtr!), target: null, exits: { ...trail(v.trailAtr!), exitOnOpposite: true } }),
  },
  {
    id: "golden-cross",
    title: "Golden / Death Cross 50/200",
    kind: "trend",
    sub: "Der SMA 50 kreuzt den SMA 200: sehr langsames Trendsignal (Golden Cross nach oben, Death Cross nach unten).",
    knownFrom: "Ein häufig zitiertes Langfrist-Signal der technischen Analyse (Aktienmärkte, Indizes, Krypto); die Namen „Golden“ und „Death Cross“ sind allgemein bekannt.",
    phase: "Große, mehrmonatige Trendwechsel. Für kurzfristiges Handeln viel zu träge.",
    weaknesses: ["Sehr wenige Signale: ein Lauf von einem Jahr hat oft nur eine Handvoll Trades – kaum belastbar.", "Das Signal kommt meist erst, wenn ein großer Teil der Bewegung vorbei ist.", "In langen Seitwärtsphasen mehrere Fehlsignale hintereinander."],
    tfs: ["1d", "4h"],
    params: [
      { key: "fast", name: "Schneller SMA", what: "Länge des schnellen einfachen Durchschnitts in Kerzen.", unit: "Kerzen", v: [100, 50, 20] },
      { key: "slow", name: "Langsamer SMA", what: "Länge des langsamen Durchschnitts. Der Standard 200 gilt als die Grenze zwischen „langfristig steigend“ und „fallend“.", unit: "Kerzen", v: [200, 200, 100] },
      STOP([3.5, 3, 2.5]),
      TRAIL([4, 3, 3]),
    ],
    make: (v) =>
      idea({ name: "Golden / Death Cross", interval: "1d", sides: "both", long: [leaf("maCross", { type: "sma", fast: v.fast!, slow: v.slow!, mode: "up", within: 1 })], stop: atrStop(v.stopAtr!), target: null, exits: { ...trail(v.trailAtr!, 1.5), exitOnOpposite: true } }),
  },
  {
    id: "ema200-pullback",
    title: "Rücksetzer im Trend (EMA 200)",
    kind: "trend",
    sub: "Der Kurs liegt über dem EMA 200 (Aufwärtstrend); der RSI fällt zurück und dreht wieder nach oben.",
    knownFrom: "Das verbreitete „Trend ist dein Freund“-Muster: Einstieg im Rücksetzer in Trendrichtung. Der EMA 200 ist als Trendgrenze allgemein bekannt.",
    phase: "Etablierter Trend mit gesunden Rücksetzern.",
    weaknesses: ["Ein Rücksetzer kann der Anfang der Trendwende sein – der EMA 200 bricht dann.", "In Seitwärtsphasen um den EMA 200 gibt es widersprüchliche Signale.", "Zeigt der RSI im starken Trend nie niedrige Werte, kommt kein Einstieg."],
    tfs: ["4h", "1h", "1d"],
    params: [
      { key: "emaLen", name: "Trend-EMA", what: "Länge des Durchschnitts, über dem der Kurs liegen muss (Aufwärtstrend).", unit: "Kerzen", v: [200, 200, 100] },
      { key: "rsiLevel", name: "RSI-Niveau", what: "Der RSI muss dieses Niveau von unten nach oben kreuzen (Ende des Rücksetzers). Niedriger = tieferer Rücksetzer nötig.", v: [30, 40, 45] },
      STOP([2, 1.5, 1.2]),
      TARGET([2, 2, 1.5]),
    ],
    make: (v) =>
      idea({ name: "Rücksetzer im Trend", interval: "4h", sides: "both", long: [leaf("maPrice", { type: "ema", len: v.emaLen!, mode: "above" }), leaf("rsi", { len: 14, mode: "crossUp", level: v.rsiLevel!, within: 3 })], stop: atrStop(v.stopAtr!), target: v.targetR!, exits: { breakEven: { on: true, trigger: "r", value: 1, to: "net" } } }),
  },
  {
    id: "supertrend",
    title: "Supertrend (10, 3)",
    kind: "trend",
    sub: "Eine ATR-Linie folgt dem Kurs; wechselt ihre Seite, dreht der Trend – man steigt ein und bleibt bis zum Gegenwechsel.",
    knownFrom: "Ein beliebter Trendindikator auf Chart-Plattformen (Standard: ATR 10, Faktor 3); auch bei TradingView als Funktion ta.supertrend verfügbar.",
    phase: "Trendphasen mit klaren Bewegungen; Volatilität nicht zu hoch.",
    weaknesses: ["Seitwärtsmärkte erzeugen schnell hintereinander Wechsel in beide Richtungen.", "Der Stop sitzt bei der Linie – bei großer ATR ist das Risiko je Trade groß.", "Einstieg erst nach dem Wechsel, also nach einem Teil der Bewegung."],
    tfs: ["4h", "1h", "1d"],
    params: [
      { key: "atrLen", name: "ATR-Länge", what: "Kerzen für die Schwankungsbreite (ATR).", unit: "Kerzen", v: [14, 10, 7] },
      { key: "factor", name: "ATR-Faktor", what: "Abstand der Linie vom Kurs in Vielfachen der ATR. Größer = weniger Wechsel, späterer Einstieg.", unit: "×", v: [4, 3, 2] },
      STOP([2.5, 2, 1.5]),
    ],
    make: (v) =>
      idea({ name: "Supertrend-Wechsel", interval: "4h", sides: "both", long: [leaf("supertrend", { atrLen: v.atrLen!, factor: v.factor!, mode: "flipUp", within: 1 })], stop: atrStop(v.stopAtr!), target: null, exits: { exitOnOpposite: true } }),
  },
  {
    id: "adx-trend",
    title: "ADX-Trendfolge",
    kind: "trend",
    sub: "Nur handeln, wenn der ADX einen starken Trend meldet; Einstieg, wenn +DI den −DI nach oben kreuzt (Short umgekehrt).",
    knownFrom: "ADX und die Directional-Indicator-Linien stammen von J. Welles Wilder (1978, „New Concepts in Technical Trading Systems“); die Schwelle 25 wird häufig genannt.",
    phase: "Beginnende bis laufende Trends. Der ADX misst die Stärke, nicht die Richtung.",
    weaknesses: ["Der ADX läuft dem Kurs hinterher: er steigt oft erst, wenn die Bewegung schon läuft.", "Bei hoher Schwelle kaum Signale, bei niedriger viele Seitwärts-Fehlsignale.", "Ein hoher ADX kann auch das Ende einer Bewegung markieren."],
    tfs: ["4h", "1h", "1d"],
    params: [
      { key: "len", name: "DI-Länge", what: "Kerzen für die Directional-Indicator-Linien (und die ADX-Glättung).", unit: "Kerzen", v: [20, 14, 10] },
      { key: "level", name: "ADX-Schwelle", what: "Ab diesem ADX gilt der Trend als stark genug. Höher = strenger.", v: [30, 25, 20] },
      STOP([2.5, 2, 1.5]),
      TRAIL([3, 2.5, 2]),
    ],
    make: (v) =>
      idea({ name: "ADX-Trendfolge", interval: "4h", sides: "both", long: [leaf("adx", { len: v.len!, smooth: v.len!, mode: "trendUp", level: v.level! }), leaf("adx", { len: v.len!, smooth: v.len!, mode: "diUp", within: 5 })], stop: atrStop(v.stopAtr!), target: null, exits: { ...trail(v.trailAtr!), exitOnOpposite: true } }),
  },
  {
    id: "ichimoku-cloud",
    title: "Ichimoku-Wolkenausbruch",
    kind: "trend",
    sub: "Der Schluss bricht nach oben aus der Wolke (Kumo) aus, und die Wolke steigt (Senkou A über B).",
    knownFrom: "Ichimoku Kinko Hyo, ein in Japan entwickeltes System (Goichi Hosoda, in den 1960er-Jahren veröffentlicht); die Standardwerte 9/26/52 sind für Aktienmärkte mit 6-Tage-Woche entstanden.",
    phase: "Übergang aus einer Seitwärtsphase in einen Trend.",
    weaknesses: ["Viele Linien, viele Stellschrauben – leicht auf die Vergangenheit hin zurechtgebogen.", "Die Standardwerte stammen nicht aus Märkten, die rund um die Uhr laufen.", "Ausbrüche aus einer dünnen Wolke sind wenig aussagekräftig."],
    tfs: ["4h", "1d", "1h"],
    params: [
      { key: "conv", name: "Tenkan", what: "Kerzen der Umkehrlinie (Mittelpunkt von Hoch und Tief).", unit: "Kerzen", v: [20, 9, 7] },
      { key: "base", name: "Kijun", what: "Kerzen der Basislinie; bestimmt auch die Verschiebung der Wolke.", unit: "Kerzen", v: [60, 26, 22] },
      { key: "spanB", name: "Senkou B", what: "Kerzen der langsamen Wolkenkante.", unit: "Kerzen", v: [120, 52, 44] },
      STOP([3, 2.5, 2]),
      TRAIL([3.5, 3, 2.5]),
    ],
    make: (v) =>
      idea({
        name: "Ichimoku-Wolkenausbruch",
        interval: "4h",
        sides: "both",
        long: [leaf("ichimoku", { conv: v.conv!, base: v.base!, spanB: v.spanB!, shift: v.base!, mode: "breakUp", within: 3 }), leaf("ichimoku", { conv: v.conv!, base: v.base!, spanB: v.spanB!, shift: v.base!, mode: "greenCloud" })],
        stop: atrStop(v.stopAtr!),
        target: null,
        exits: { ...trail(v.trailAtr!, 1.5), exitOnOpposite: true },
      }),
  },
  {
    id: "heikin-ashi",
    title: "Heikin-Ashi-Trend",
    kind: "trend",
    sub: "Mehrere grüne Heikin-Ashi-Kerzen ohne unteren Docht in Folge über dem EMA 50 – ein glatter Aufwärtstrend.",
    knownFrom: "Heikin-Ashi („durchschnittliche Balken“) ist eine japanische Glättung der Kerzen und auf allen gängigen Chart-Plattformen verfügbar.",
    phase: "Glatte, anhaltende Trends ohne große Rücksetzer.",
    weaknesses: ["Heikin-Ashi-Preise sind berechnet, nicht echt gehandelt – der Lab-Lauf nutzt aber echte Ausführungspreise.", "Die Glättung verzögert Ein- und Ausstieg.", "Im Seitwärtsmarkt wechselt die Farbe laufend."],
    tfs: ["4h", "1h", "1d"],
    params: [
      { key: "n", name: "Anzahl Kerzen", what: "So viele grüne Kerzen ohne unteren Docht müssen in Folge stehen. Mehr = strenger.", unit: "Kerzen", v: [4, 3, 2] },
      { key: "emaLen", name: "Trendfilter-EMA", what: "Der Schluss muss über diesem EMA liegen.", unit: "Kerzen", v: [100, 50, 20] },
      STOP([2.5, 2, 1.5]),
      TRAIL([3, 2.5, 2]),
    ],
    make: (v) =>
      idea({ name: "Heikin-Ashi-Trend", interval: "4h", sides: "both", long: [leaf("heikin", { mode: "strongBull", n: v.n! }), leaf("maPrice", { type: "ema", len: v.emaLen!, mode: "above" })], stop: atrStop(v.stopAtr!), target: null, exits: { ...trail(v.trailAtr!), exitOnOpposite: true } }),
  },
  {
    id: "chandelier",
    title: "ATR-Trailing (Chandelier)",
    kind: "trend",
    sub: "Der Chandelier-Stopp hängt unter dem 22-Kerzen-Hoch; kreuzt der Schluss die Gegenlinie, wechselt die Richtung.",
    knownFrom: "Der Chandelier Exit stammt von Charles Le Beau und wurde durch Alexander Elder bekannt; Standard: 22 Kerzen, Faktor 3 ATR.",
    phase: "Trendphasen; als Ausstiegshilfe auch in anderen Strategien gebräuchlich.",
    weaknesses: ["In Seitwärtsphasen wechselt die Richtung oft.", "Der weite Abstand (3 ATR) kostet bei Umkehr viel Gewinn.", "Als Einstiegssignal weniger gebräuchlich als als Ausstieg."],
    tfs: ["4h", "1d", "1h"],
    params: [
      { key: "len", name: "Länge", what: "Kerzen für das Hoch und die ATR.", unit: "Kerzen", v: [30, 22, 14] },
      { key: "mult", name: "ATR-Faktor", what: "Abstand des Stopps vom Hoch in Vielfachen der ATR. Größer = mehr Luft.", unit: "×", v: [4, 3, 2.5] },
      STOP([3, 2.5, 2]),
    ],
    make: (v) =>
      idea({ name: "Chandelier-Wechsel", interval: "4h", sides: "both", long: [leaf("chandelier", { len: v.len!, mult: v.mult!, mode: "flipUp", within: 1 })], stop: atrStop(v.stopAtr!), target: null, exits: { exitOnOpposite: true } }),
  },
  // ── Mean-Reversion ──
  {
    id: "rsi-rebound",
    title: "RSI-Rebound (14, unter 30)",
    kind: "reversion",
    sub: "Der RSI war überverkauft und kehrt über das Niveau zurück – man wettet auf eine Gegenbewegung.",
    knownFrom: "Der RSI stammt von J. Welles Wilder (1978); die Marken 30 und 70 für überverkauft und überkauft sind die bekannteste Lesart.",
    phase: "Seitwärtsmärkte und gesunde Rücksetzer. Im starken Abwärtstrend bleibt der RSI lange niedrig.",
    weaknesses: ["Im Trend ist „überverkauft“ kein Umkehrsignal – der Kurs fällt weiter.", "Kleine Gewinne, gelegentlich große Verluste (Fangen des fallenden Messers).", "Ohne Trendfilter oder Stop-Disziplin gefährlich."],
    tfs: ["4h", "1h", "1d"],
    params: [
      { key: "len", name: "RSI-Länge", what: "Kerzen des RSI. Kürzer = nervöser, mehr Extremwerte.", unit: "Kerzen", v: [14, 14, 9] },
      { key: "level", name: "Niveau", what: "Der RSI muss dieses Niveau von unten nach oben kreuzen. Niedriger = nur tiefe Extreme.", v: [25, 30, 35] },
      STOP([2, 1.5, 1.2]),
      TARGET([1.5, 2, 2]),
    ],
    make: (v) => idea({ name: "RSI-Rebound", interval: "4h", sides: "both", long: [leaf("rsi", { len: v.len!, mode: "crossUp", level: v.level!, within: 1 })], stop: atrStop(v.stopAtr!), target: v.targetR!, exits: { maxBars: 30 } }),
  },
  {
    id: "connors-rsi2",
    title: "Connors RSI(2) über SMA 200",
    kind: "reversion",
    sub: "Im Aufwärtstrend (Kurs über SMA 200) fällt der kurzfristige RSI(2) auf ein Extrem – man kauft die kurze Schwäche.",
    knownFrom: "Von Larry Connors in „Short Term Trading Strategies That Work“ (2008) für Aktienindizes beschrieben (RSI(2) unter 10 über dem SMA 200). Ob es auf Krypto trägt, zeigt nur dein Lauf.",
    phase: "Aufwärtstrend mit kurzen, scharfen Rücksetzern; auf Tageskerzen beschrieben.",
    weaknesses: ["Nur Long beschrieben – in Bärenmärkten gibt es kaum Signale.", "Große Verluste, wenn ein Rücksetzer in eine Trendwende übergeht.", "Auf Krypto laufen die Märkte rund um die Uhr; die Regel stammt aus Börsenhandelstagen."],
    tfs: ["1d", "4h"],
    params: [
      { key: "rsiLen", name: "RSI-Länge", what: "Sehr kurzer RSI (2 Kerzen) – misst nur die letzten Kerzen.", unit: "Kerzen", v: [2, 2, 3] },
      { key: "level", name: "RSI-Schwelle", what: "Der RSI muss darunter liegen. Niedriger = seltener, tieferes Extrem.", v: [5, 10, 15] },
      { key: "smaLen", name: "Trend-SMA", what: "Der Schluss muss über diesem Durchschnitt liegen (Aufwärtstrend).", unit: "Kerzen", v: [200, 200, 100] },
      STOP([3, 3, 2]),
      TARGET([1, 1.5, 2]),
    ],
    make: (v) => idea({ name: "Connors RSI(2)", interval: "1d", sides: "long", long: [leaf("rsi", { len: v.rsiLen!, mode: "below", level: v.level! }), leaf("maPrice", { type: "sma", len: v.smaLen!, mode: "above" })], stop: atrStop(v.stopAtr!), target: v.targetR!, exits: { maxBars: 10 } }),
  },
  {
    id: "bollinger-reversion",
    title: "Bollinger-Reversion",
    kind: "reversion",
    sub: "Der Kurs fiel unter das untere Band und schließt wieder darin – die Gegenbewegung zur Mitte; nur im Seitwärtsmarkt (ADX niedrig).",
    knownFrom: "Bollinger-Bänder von John Bollinger (1980er); Standard: SMA 20 ± 2 Standardabweichungen. Die Rückkehr in die Bänder ist eine häufig beschriebene Lesart.",
    phase: "Seitwärts- und Rangemärkte mit niedrigem ADX.",
    weaknesses: ["Im Trend „klebt“ der Kurs am Band – die Reversion bleibt aus.", "Kleine Gewinne gegen gelegentlich große Verluste.", "Nach Ausbrüchen aus einer Range sind die Signale falsch."],
    tfs: ["1h", "15m", "4h"],
    params: [
      { key: "len", name: "Länge", what: "Kerzen des Durchschnitts, um den die Bänder liegen.", unit: "Kerzen", v: [20, 20, 14] },
      { key: "mult", name: "Abweichung", what: "Breite der Bänder in Standardabweichungen. Größer = seltenere, stärkere Extreme.", unit: "σ", v: [2.5, 2, 1.5] },
      { key: "adxMax", name: "ADX höchstens", what: "Nur wenn der ADX darunter liegt (kein starker Trend).", v: [20, 25, 30] },
      STOP([2, 1.5, 1.2]),
      TARGET([1.5, 1.5, 1.2]),
    ],
    make: (v) =>
      idea({ name: "Bollinger-Reversion", interval: "1h", sides: "both", long: [leaf("bollinger", { len: v.len!, mult: v.mult!, mode: "backInLower", within: 1 }), leaf("adx", { len: 14, smooth: 14, mode: "adxBelow", level: v.adxMax! })], stop: atrStop(v.stopAtr!), target: v.targetR!, exits: { maxBars: 24 } }),
  },
  {
    id: "stochastic-reversal",
    title: "Stochastic-Umkehr (14, 3, 3)",
    kind: "momentum",
    sub: "%K kreuzt %D nach oben, nachdem beide im überverkauften Bereich lagen (Short umgekehrt).",
    knownFrom: "Der Stochastic-Oszillator stammt von George Lane (1950er); Standard 14/3/3 mit den Marken 20 und 80.",
    phase: "Seitwärtsmärkte und Rücksetzer. Im starken Trend bleibt er lange im Extrembereich.",
    weaknesses: ["Im Trend bleibt der Oszillator im Extrem – früh gekaufte „Tiefs“ fallen weiter.", "Sehr viele Kreuzungen; ohne Extremfilter kaum Aussagekraft.", "Verzögert, weil %K und %D geglättet sind."],
    tfs: ["1h", "4h", "15m"],
    params: [
      { key: "kLen", name: "Länge %K", what: "Kerzen für die Spanne aus Hoch und Tief.", unit: "Kerzen", v: [21, 14, 9] },
      { key: "level", name: "Extrem-Niveau", what: "%K und %D müssen vorher darunter (Short: über 100 minus Niveau) gelegen haben.", v: [15, 20, 25] },
      STOP([2, 1.5, 1.2]),
      TARGET([2, 2, 1.5]),
    ],
    make: (v) => idea({ name: "Stochastic-Umkehr", interval: "1h", sides: "both", long: [leaf("stoch", { kLen: v.kLen!, kSmooth: 3, dSmooth: 3, mode: "kdUp", level: v.level!, zone: "extreme", within: 1 })], stop: atrStop(v.stopAtr!), target: v.targetR!, exits: { maxBars: 30 } }),
  },
  {
    id: "vwap-reversion",
    title: "VWAP-Reversion",
    kind: "reversion",
    sub: "Der Kurs liegt deutlich unter dem Tages-VWAP und der RSI ist schwach – man wettet auf die Rückkehr zum Durchschnittspreis.",
    knownFrom: "Der VWAP (volumengewichteter Durchschnittspreis) ist ein verbreiteter Tages-Richtwert im Handel; „Rückkehr zum VWAP“ ist eine oft beschriebene Intraday-Idee.",
    phase: "Intraday, ruhiger Markt ohne klare Richtung.",
    weaknesses: ["An Trendtagen entfernt sich der Kurs den ganzen Tag vom VWAP.", "Kurz nach dem Tagesstart (00:00 UTC) ist der VWAP wenig aussagekräftig.", "Braucht Volumen in den Daten."],
    needs: "volume",
    tfs: ["1h", "15m"],
    params: [
      { key: "dist", name: "Abstand zum VWAP", what: "So viele Prozent muss der Schluss unter (Short: über) dem VWAP liegen.", unit: "%", v: [1.5, 1, 0.6] },
      { key: "rsiLevel", name: "RSI unter", what: "Zusätzlich muss der RSI(14) darunter liegen (Short: über 100 minus Wert).", v: [30, 40, 45] },
      STOP([2, 1.5, 1.2]),
      TARGET([1.5, 1.5, 1.2]),
    ],
    make: (v) => idea({ name: "VWAP-Reversion", interval: "1h", sides: "both", long: [leaf("vwap", { anchor: "day", mode: "belowBy", dist: v.dist! }), leaf("rsi", { len: 14, mode: "below", level: v.rsiLevel! })], stop: atrStop(v.stopAtr!), target: v.targetR!, exits: { maxBars: 12 } }),
  },
  {
    id: "golden-pocket",
    title: "Golden-Pocket-Rücksetzer",
    kind: "reversion",
    sub: "Nach einem Aufwärts-Swing läuft der Kurs in die Fibonacci-Zone 0,618–0,65 zurück, der Trend (EMA 200) zeigt nach oben.",
    knownFrom: "Fibonacci-Rücksetzer sind ein Standardwerkzeug der Chartanalyse; die Zone 0,618–0,65 nennen viele Trader „Golden Pocket“. Es gibt keinen belastbaren Beleg, dass der Kurs dort häufiger dreht – das prüft dein Lauf.",
    phase: "Trend mit Rücksetzern zwischen klar erkennbaren Swings.",
    weaknesses: ["Swings sind Auslegungssache: die Pivot-Länge verändert, welche Zone gilt.", "Die Zone ist schmal; der Kurs läuft oft hindurch.", "Man sieht die Zone erst, wenn der Swing bestätigt ist – manchmal ist der Rücksetzer da schon vorbei."],
    tfs: ["4h", "1h", "1d"],
    params: [
      { key: "len", name: "Pivot-Länge", what: "Kerzen links und rechts, die einen Swing-Punkt bestätigen. Größer = weniger, größere Swings.", unit: "Kerzen", v: [12, 8, 5] },
      { key: "from", name: "Zone von", what: "Anteil des Swings, den der Kurs zurückgelaufen ist (0,618 ist die „goldene“ Marke).", v: [0.618, 0.618, 0.5] },
      { key: "to", name: "Zone bis", what: "Obergrenze der Zone (0,65 ist die übliche Golden-Pocket-Kante).", v: [0.65, 0.65, 0.65] },
      STOP([2, 1.5, 1.2]),
      TARGET([2, 2.5, 3]),
    ],
    make: (v) => idea({ name: "Golden-Pocket-Rücksetzer", interval: "4h", sides: "both", long: [leaf("fib", { dir: "long", len: v.len!, from: v.from!, to: v.to!, basis: "close" }), leaf("maPrice", { type: "ema", len: 200, mode: "above" })], stop: atrStop(v.stopAtr!), target: v.targetR!, exits: { breakEven: { on: true, trigger: "r", value: 1, to: "net" }, maxBars: 40 } }),
  },
  {
    id: "funding-contrarian",
    title: "Funding-Contrarian",
    kind: "reversion",
    sub: "Extrem negative Funding-Rate (Shorts zahlen) → Long; extrem positive (Longs zahlen) → Short: gegen die überfüllte Seite.",
    knownFrom: "Bei Perpetual-Futures zahlt eine Seite der anderen alle 8 Stunden Funding; „extremes Funding als Gegenindikator“ wird im Krypto-Handel oft diskutiert.",
    phase: "Überhitzte Märkte mit einseitiger Positionierung.",
    weaknesses: ["Extremes Funding kann Wochen anhalten, während der Trend weiterläuft.", "Braucht die echte Funding-Historie des Laufs (Kosten → Funding: Historie), sonst gesperrt.", "Wenige Signale; das Funding ist schon in den Kosten des Labors enthalten."],
    needs: "funding",
    tfs: ["4h", "1h"],
    params: [
      { key: "level", name: "Funding-Schwelle", what: "Betrag in % je 8 h: Long unter −Schwelle, Short über +Schwelle. Die Grundrate bei Binance ist 0,01 %.", unit: "% je 8 h", v: [0.05, 0.03, 0.02] },
      { key: "avgN", name: "Mittel über", what: "Wie viele Zahlungen gemittelt werden (3 = ein Tag). Mehr glättet Ausreißer.", unit: "Zahlungen", v: [3, 3, 1] },
      STOP([2.5, 2, 1.5]),
      TARGET([2, 2, 1.5]),
    ],
    make: (v) => idea({ name: "Funding-Contrarian", interval: "4h", sides: "both", long: [leaf("funding", { mode: "below", level: -v.level!, avgN: v.avgN! })], stop: atrStop(v.stopAtr!), target: v.targetR!, exits: { maxBars: 18 } }),
  },
  {
    id: "weekend-range",
    title: "Wochenend-Range",
    kind: "reversion",
    sub: "Am Wochenende (Sa–So UTC) ist das Handelsvolumen oft dünner – man wettet auf Rückkehr nach Überdehnung (RSI-Extrem).",
    knownFrom: "Dass Krypto am Wochenende anders läuft (weniger Volumen, andere Teilnehmer), ist weithin bekannt; „Wochenend-Range“ ist ein Trader-Begriff, keine feste Lehrbuchregel.",
    phase: "Ruhiger Wochenendhandel ohne Nachrichten.",
    weaknesses: ["Dünner Markt: Ausschläge und Lücken können groß sein.", "Wenige Wochenenden im Lauf = kleine Stichprobe.", "Nachrichten am Wochenende brechen die Range."],
    tfs: ["1h", "15m", "4h"],
    params: [
      { key: "rsiLevel", name: "RSI-Extrem", what: "RSI(14) unter diesem Wert (Short: über 100 minus Wert) am Wochenende.", v: [25, 30, 35] },
      STOP([2, 1.5, 1.2]),
      TARGET([1.5, 1.5, 1.2]),
    ],
    make: (v) => idea({ name: "Wochenend-Range", interval: "1h", sides: "both", long: [leaf("timeWindow", { weekday: "any", session: "weekend" }), leaf("rsi", { len: 14, mode: "below", level: v.rsiLevel! })], stop: atrStop(v.stopAtr!), target: v.targetR!, exits: { maxBars: 24 } }),
  },
  {
    id: "williams-r",
    title: "Williams %R im Aufwärtstrend",
    kind: "reversion",
    sub: "Im Aufwärtstrend (Kurs über EMA 200) kehrt Williams %R aus dem überverkauften Bereich (unter −80) zurück.",
    knownFrom: "Williams %R stammt von Larry Williams (1970er) und ist ein Gegenstück zum Stochastic mit den Marken −80 und −20.",
    phase: "Aufwärtstrend mit kurzen Rücksetzern.",
    weaknesses: ["Wie alle Oszillatoren: im starken Trend bleibt er lange im Extrem.", "Ohne Trendfilter viele Fehlsignale.", "Sehr ähnlich zum Stochastic – kein unabhängiges zweites Signal."],
    tfs: ["4h", "1h", "1d"],
    params: [
      { key: "len", name: "Länge", what: "Kerzen für Hoch und Tief der Spanne.", unit: "Kerzen", v: [21, 14, 10] },
      { key: "level", name: "Niveau", what: "%R muss dieses Niveau von unten nach oben kreuzen (Short: gespiegelt).", v: [-90, -80, -70] },
      STOP([2, 1.5, 1.2]),
      TARGET([2, 2, 1.5]),
    ],
    make: (v) => idea({ name: "Williams %R im Trend", interval: "4h", sides: "both", long: [leaf("willr", { len: v.len!, mode: "crossUp", level: v.level!, within: 1 }), leaf("maPrice", { type: "ema", len: 200, mode: "above" })], stop: atrStop(v.stopAtr!), target: v.targetR!, exits: { maxBars: 30 } }),
  },
  // ── Momentum ──
  {
    id: "macd-cross",
    title: "MACD-Kreuz (12, 26, 9)",
    kind: "momentum",
    sub: "Die MACD-Linie kreuzt ihre Signallinie nach oben (Short: nach unten) – das Momentum dreht.",
    knownFrom: "MACD wurde von Gerald Appel in den späten 1970er-Jahren entwickelt; 12/26/9 ist die Standardeinstellung.",
    phase: "Trendphasen mit klaren Schwüngen.",
    weaknesses: ["Läuft dem Kurs hinterher, weil er aus Durchschnitten gebaut ist.", "Viele Kreuzungen in Seitwärtsphasen.", "Allein ohne Filter selten verlässlich."],
    tfs: ["4h", "1h", "1d"],
    params: [
      { key: "fast", name: "Schneller EMA", what: "Länge des schnellen Durchschnitts.", unit: "Kerzen", v: [19, 12, 8] },
      { key: "slow", name: "Langsamer EMA", what: "Länge des langsamen Durchschnitts.", unit: "Kerzen", v: [39, 26, 17] },
      { key: "signal", name: "Signallinie", what: "Glättung der MACD-Linie. Kürzer = früheres, nervöseres Kreuz.", unit: "Kerzen", v: [9, 9, 5] },
      STOP([2.5, 2, 1.5]),
      TRAIL([3, 2.5, 2]),
    ],
    make: (v) => idea({ name: "MACD-Kreuz", interval: "4h", sides: "both", long: [leaf("macd", { fast: v.fast!, slow: v.slow!, signal: v.signal!, mode: "crossUp", within: 1 })], stop: atrStop(v.stopAtr!), target: null, exits: { ...trail(v.trailAtr!), exitOnOpposite: true } }),
  },
  {
    id: "cci-reversal",
    title: "CCI-Umkehr (±100)",
    kind: "momentum",
    sub: "Der CCI kreuzt die Marke −100 von unten nach oben (Short: +100 nach unten) – das Ende einer Abwärtsüberdehnung.",
    knownFrom: "Der Commodity Channel Index stammt von Donald Lambert (1980); die Marken ±100 sind die gebräuchlichste Lesart.",
    phase: "Märkte mit regelmäßigen Schwüngen; Seitwärts und mäßige Trends.",
    weaknesses: ["Im Trend bleibt der CCI lange jenseits der Marke.", "Ungebundener Wertebereich: die Marken sind Konvention, keine Grenze.", "Ohne Trendfilter viele Fehlsignale."],
    tfs: ["1h", "4h", "15m"],
    params: [
      { key: "len", name: "Länge", what: "Kerzen des Durchschnitts, an dem der CCI misst.", unit: "Kerzen", v: [30, 20, 14] },
      { key: "level", name: "Niveau", what: "Der CCI muss dieses Niveau von unten nach oben kreuzen. Tiefer = stärkere Überdehnung nötig.", v: [-150, -100, -80] },
      STOP([2, 1.5, 1.2]),
      TARGET([2, 2, 1.5]),
    ],
    make: (v) => idea({ name: "CCI-Umkehr", interval: "1h", sides: "both", long: [leaf("cci", { len: v.len!, mode: "crossUp", level: v.level!, within: 1 })], stop: atrStop(v.stopAtr!), target: v.targetR!, exits: { maxBars: 30 } }),
  },
  {
    id: "mcb-ladder",
    title: "MCB-Leiter gültig",
    kind: "momentum",
    sub: "Dein Einstiegs-Check über alle Zeitebenen (Stärke und gültig) wird zur Regel – Kerze für Kerze wie live.",
    knownFrom: "Das ist kein Lehrbuchsystem, sondern dein eigener Einstiegs-Check mit der MCB-/WaveTrend-Einstellung dieser App.",
    phase: "Wo dein Check ein gültiges Urteil gibt.",
    weaknesses: ["Rechenintensiv (läuft auf jeder Kerze).", "Nur auf 1h und 4h verfügbar.", "Ohne Top-Trader-Bonuspunkt: der Lab-Lauf kann diese Zusatzdaten nicht nachrechnen."],
    tfs: ["1h", "4h"],
    params: [
      { key: "minStrength", name: "Mindest-Stärke", what: "Wie viele Punkte der Check mindestens haben muss. Höher = strenger.", v: [4, 3, 2] },
      STOP([2, 1.5, 1.2]),
      TARGET([2, 2, 1.5]),
    ],
    make: (v) => idea({ name: "MCB-Leiter gültig", interval: "1h", sides: "both", long: [leaf("mcbLadder", { mode: "validLong", minStrength: v.minStrength! })], stop: atrStop(v.stopAtr!), target: v.targetR!, exits: { maxBars: 40 } }),
  },
  {
    id: "mcb-bottom-rsi",
    title: "MCB-Punkt mit RSI-Schwäche",
    kind: "momentum",
    sub: "Ein großer MCB-Punkt (Bottom / Kauf) kurz nach einer RSI-Schwäche – beide zeigen eine Erschöpfung der Abwärtsbewegung.",
    knownFrom: "MCB / WaveTrend (LazyBear, VuManChu Cipher B) ist in der TradingView-Community verbreitet; hier gilt deine MCB-Einstellung.",
    phase: "Ende einer Abwärtsbewegung, Seitwärts.",
    weaknesses: ["Zwei Erschöpfungs-Signale bestätigen sich teilweise nur gegenseitig (beide aus dem Kurs berechnet).", "Im Abwärtstrend gibt es mehrere Bottoms hintereinander.", "Wenige Signale."],
    tfs: ["1h", "4h"],
    params: [
      { key: "within", name: "MCB-Punkt höchstens", what: "So viele Kerzen darf der Punkt zurückliegen.", unit: "Kerzen", v: [2, 3, 5] },
      { key: "rsiLevel", name: "RSI unter", what: "Der RSI(14) muss darunter liegen (Short: über 100 minus Wert).", v: [35, 40, 45] },
      STOP([2, 1.5, 1.2]),
      TARGET([2, 2, 1.5]),
    ],
    make: (v) => idea({ name: "MCB-Punkt mit RSI-Schwäche", interval: "1h", sides: "both", long: [leaf("wtEvent", { kind: "majorLong", within: v.within! }), leaf("rsi", { len: 14, mode: "below", level: v.rsiLevel! })], stop: atrStop(v.stopAtr!), target: v.targetR!, exits: { maxBars: 40 } }),
  },
  // ── Ausbruch ──
  {
    id: "turtle-20",
    title: "Turtle-Ausbruch 20",
    kind: "breakout",
    sub: "Ein neues 20-Kerzen-Hoch (Short: Tief) wird erreicht – Einstieg in Ausbruchsrichtung, Stop bei 2 ATR, Trailing.",
    knownFrom: "Die „Turtle Traders“ (Richard Dennis, 1980er) handelten Donchian-Ausbrüche: System 1 mit 20 Tagen, System 2 mit 55 Tagen, Stop bei 2 N (ATR). Die Regeln sind öffentlich beschrieben.",
    phase: "Beginnende, große Trends nach Ruhephasen.",
    weaknesses: ["Die meisten Ausbrüche scheitern: viele kleine Verluste, wenige große Gewinne – lange Durststrecken.", "Gewinne kommen von Ausreißern: eine kurze Stichprobe sagt wenig.", "Die Originalregeln stammen aus Tageskerzen und Terminmärkten."],
    tfs: ["1d", "4h"],
    params: [
      { key: "len", name: "Ausbruchs-Länge", what: "Kerzen für das Hoch / Tief, das gebrochen werden muss. Länger = seltener, größere Ausbrüche.", unit: "Kerzen", v: [30, 20, 14] },
      STOP([2.5, 2, 1.5]),
      TRAIL([3, 2, 1.5]),
    ],
    make: (v) => idea({ name: "Turtle-Ausbruch 20", interval: "1d", sides: "both", long: [leaf("donchian", { len: v.len!, mode: "breakUp", basis: "wick", within: 1 })], stop: atrStop(v.stopAtr!), target: null, exits: trail(v.trailAtr!, 0) }),
  },
  {
    id: "turtle-55",
    title: "Turtle-Ausbruch 55",
    kind: "breakout",
    sub: "Wie Turtle 20, aber mit dem 55-Kerzen-Hoch (Tief): seltener, dafür größere Trends.",
    knownFrom: "Das „System 2“ der Turtle Traders (Richard Dennis, 1980er): 55-Tage-Ausbruch; öffentlich beschrieben.",
    phase: "Große, anhaltende Trends.",
    weaknesses: ["Sehr wenige Signale – bei einem Jahr Daten kaum auswertbar.", "Lange Verlustphasen zwischen den Trends.", "Das Trailing gibt bei Umkehr einen großen Teil des Gewinns zurück."],
    tfs: ["1d", "4h"],
    params: [
      { key: "len", name: "Ausbruchs-Länge", what: "Kerzen für das Hoch / Tief, das gebrochen werden muss.", unit: "Kerzen", v: [80, 55, 40] },
      STOP([2.5, 2, 1.5]),
      TRAIL([3.5, 3, 2.5]),
    ],
    make: (v) => idea({ name: "Turtle-Ausbruch 55", interval: "1d", sides: "both", long: [leaf("donchian", { len: v.len!, mode: "breakUp", basis: "wick", within: 1 })], stop: atrStop(v.stopAtr!), target: null, exits: trail(v.trailAtr!, 0) }),
  },
  {
    id: "inside-bar",
    title: "Inside-Bar-Ausbruch",
    kind: "breakout",
    sub: "Eine Kerze liegt komplett in der vorigen (Pause); der Schluss bricht danach aus der Mutterkerze aus – in Richtung des Trends (EMA 50).",
    knownFrom: "Die Inside Bar ist ein klassisches Price-Action-Muster (Candlestick-Lehre); Ausbruch aus der Mutterkerze ist die gängige Lesart.",
    phase: "Pausen in einem Trend vor der Fortsetzung.",
    weaknesses: ["Das Muster ist häufig – die meisten Inside Bars führen zu nichts.", "Enge Mutterkerzen geben winzige Stops, die der Markt leicht trifft.", "Lücken am Ausbruch machen den Einstieg schlechter als geplant."],
    tfs: ["4h", "1d", "1h"],
    params: [
      { key: "emaLen", name: "Trendfilter-EMA", what: "Der Schluss muss über (Short: unter) diesem EMA liegen.", unit: "Kerzen", v: [100, 50, 20] },
      STOP([1.5, 1.2, 1]),
      TARGET([2, 2, 1.5]),
    ],
    make: (v) => idea({ name: "Inside-Bar-Ausbruch", interval: "4h", sides: "both", long: [leaf("insideBar", { mode: "breakUp", within: 1 }), leaf("maPrice", { type: "ema", len: v.emaLen!, mode: "above" })], stop: atrStop(v.stopAtr!), target: v.targetR!, exits: { maxBars: 24 } }),
  },
  {
    id: "volume-spike",
    title: "Volumen-Spike-Ausbruch",
    kind: "breakout",
    sub: "Schluss über dem N-Kerzen-Hoch, begleitet von einer grünen Kerze mit einem Vielfachen des üblichen Volumens.",
    knownFrom: "„Ausbruch mit Volumenbestätigung“ ist ein Grundsatz der klassischen Chartanalyse: Bewegungen mit hohem Umsatz gelten als belastbarer.",
    phase: "Ausbrüche aus Ruhephasen mit steigendem Interesse.",
    weaknesses: ["Volumen-Spitzen gibt es auch bei Fehlausbrüchen und Liquidationen.", "Nur Long beschrieben.", "Braucht Volumen in den Daten; Börsen zählen es unterschiedlich."],
    needs: "volume",
    tfs: ["1h", "4h"],
    params: [
      { key: "n", name: "Ausbruchs-Länge", what: "Kerzen des Hochs, das überschritten werden muss.", unit: "Kerzen", v: [30, 20, 14] },
      { key: "mult", name: "Volumen-Faktor", what: "Das Volumen muss so viel mal über dem Durchschnitt der 20 Kerzen davor liegen.", unit: "×", v: [3, 2, 1.5] },
      STOP([2, 1.5, 1.2]),
      TRAIL([3, 2.5, 2]),
    ],
    make: (v) => idea({ name: "Volumen-Spike-Ausbruch", interval: "1h", sides: "long", long: [leaf("breakout", { mode: "up", n: v.n!, within: 1 }), leaf("volume", { len: 20, mult: v.mult!, candle: "bull" })], stop: atrStop(v.stopAtr!), target: null, exits: { ...trail(v.trailAtr!), maxBars: 72 } }),
  },
  {
    id: "obv-breakout",
    title: "Ausbruch mit OBV-Bestätigung",
    kind: "breakout",
    sub: "Ausbruch über das 20-Kerzen-Hoch, während das On-Balance-Volume ein neues Hoch macht – der Umsatz bestätigt die Richtung.",
    knownFrom: "On-Balance-Volume stammt von Joseph Granville (1963); „OBV bestätigt den Ausbruch“ ist eine häufig beschriebene Lesart.",
    phase: "Ausbrüche mit breiter Beteiligung.",
    weaknesses: ["OBV ist ein grobes Maß (nur die Richtung der Kerze entscheidet).", "Beide Signale hängen am selben Kurs – die Bestätigung ist schwächer, als sie klingt.", "Braucht Volumen in den Daten."],
    needs: "volume",
    tfs: ["1h", "4h"],
    params: [
      { key: "len", name: "Ausbruchs-Länge", what: "Kerzen für das Hoch (Short: Tief) und für das OBV-Hoch.", unit: "Kerzen", v: [30, 20, 14] },
      STOP([2, 1.5, 1.2]),
      TRAIL([3, 2.5, 2]),
    ],
    make: (v) => idea({ name: "Ausbruch mit OBV", interval: "1h", sides: "both", long: [leaf("donchian", { len: v.len!, mode: "breakUp", basis: "close", within: 1 }), leaf("obv", { mode: "newHigh", n: v.len!, within: 3 })], stop: atrStop(v.stopAtr!), target: null, exits: { ...trail(v.trailAtr!), maxBars: 72 } }),
  },
  {
    id: "orb-asia",
    title: "Opening-Range-Ausbruch Asien",
    kind: "breakout",
    sub: "Hoch und Tief der ersten Stunde ab 00:00 UTC bilden die Spanne; der erste Schluss außerhalb gibt die Richtung.",
    knownFrom: "Der Opening-Range-Breakout wurde durch Toby Crabel (1990) bekannt; auf 24/7-Märkten legt man die Sitzungsstarts selbst fest (hier: Asien 00:00 UTC).",
    phase: "Sitzungsbeginn mit Volatilität nach ruhiger Nacht.",
    weaknesses: ["Krypto hat keinen echten Börsenstart – die Spanne ist eine Konvention.", "Viele Fehlausbrüche in schmalen Spannen.", "Ein Ausbruch je Sitzung: wenige Trades."],
    tfs: ["15m", "30m"],
    params: [
      { key: "minutes", name: "Spanne", what: "Minuten ab Sitzungsbeginn, die Hoch und Tief der Spanne bilden. Länger = weniger, aber bedeutsamere Ausbrüche.", unit: "Minuten", v: [120, 60, 30] },
      { key: "validHours", name: "Gültig", what: "So viele Stunden nach Ende der Spanne zählt ein Ausbruch.", unit: "Stunden", v: [3, 4, 6] },
      TARGET([2, 2, 1.5]),
    ],
    make: (v) => orbIdea("Opening-Range-Ausbruch Asien", "asia", v),
  },
  {
    id: "orb-london",
    title: "Opening-Range-Ausbruch London",
    kind: "breakout",
    sub: "Spanne der ersten Stunde ab 07:00 UTC; der erste Schluss außerhalb gibt die Richtung.",
    knownFrom: "Opening-Range-Breakout (Toby Crabel, 1990); der Londoner Handelsstart (07:00 UTC) gilt als Zeitpunkt steigender Aktivität.",
    phase: "Sitzungsbeginn London mit steigendem Volumen.",
    weaknesses: ["Die Spanne ist eine Konvention auf einem Markt ohne Börsenstart.", "Fehlausbrüche vor und nach Nachrichten.", "Ein Ausbruch je Sitzung: wenige Trades."],
    tfs: ["15m", "30m"],
    params: [
      { key: "minutes", name: "Spanne", what: "Minuten ab 07:00 UTC, die Hoch und Tief der Spanne bilden.", unit: "Minuten", v: [120, 60, 30] },
      { key: "validHours", name: "Gültig", what: "So viele Stunden nach Ende der Spanne zählt ein Ausbruch.", unit: "Stunden", v: [3, 4, 6] },
      TARGET([2, 2, 1.5]),
    ],
    make: (v) => orbIdea("Opening-Range-Ausbruch London", "london", v),
  },
  {
    id: "orb-ny",
    title: "Opening-Range-Ausbruch New York",
    kind: "breakout",
    sub: "Spanne der ersten Stunde ab 13:00 UTC; der erste Schluss außerhalb gibt die Richtung.",
    knownFrom: "Opening-Range-Breakout (Toby Crabel, 1990); der US-Handelsstart gilt als volatilste Zeit des Tages. Hier 13:00 UTC (die App-Session „New York“).",
    phase: "Sitzungsbeginn New York, oft mit Nachrichten und hohem Volumen.",
    weaknesses: ["Nachrichten (Daten, Zinsen) verursachen Spitzen in beide Richtungen.", "Die Spanne ist eine Konvention auf einem Markt ohne Börsenstart.", "Ein Ausbruch je Sitzung: wenige Trades."],
    tfs: ["15m", "30m"],
    params: [
      { key: "minutes", name: "Spanne", what: "Minuten ab 13:00 UTC, die Hoch und Tief der Spanne bilden.", unit: "Minuten", v: [120, 60, 30] },
      { key: "validHours", name: "Gültig", what: "So viele Stunden nach Ende der Spanne zählt ein Ausbruch.", unit: "Stunden", v: [3, 4, 6] },
      TARGET([2, 2, 1.5]),
    ],
    make: (v) => orbIdea("Opening-Range-Ausbruch New York", "ny", v),
  },
  {
    id: "box-breakout",
    title: "Box-Ausbruch (Näherung)",
    kind: "breakout",
    sub: "Eine enge Phase (Bollinger-Squeeze) wird nach oben (Short: unten) durch ein neues N-Kerzen-Hoch verlassen.",
    knownFrom: "Die Idee „Ausbruch aus der Box“ ist klassische Chartanalyse. Die echte Box-Erkennung des Labors ist die eigene Strategie „Box zu Box“ – diese Karte ist nur eine Regel-Näherung.",
    phase: "Ruhige Spanne, aus der ein Ausbruch folgt.",
    weaknesses: ["Näherung: ohne die Box-Qualität, Retests und Noten der Strategie „Box zu Box“.", "Viele Fehlausbrüche aus engen Phasen.", "Squeeze und Hoch-Ausbruch hängen am selben Kurs."],
    approx: "Eine Näherung der Strategie „Box zu Box“ aus den Regel-Bausteinen. Für die echte Box-Erkennung wähle im Labor die Strategie „Box zu Box“.",
    tfs: ["4h", "1h"],
    params: [
      { key: "len", name: "Box-Länge", what: "Kerzen des Hochs (Tiefs), das gebrochen werden muss.", unit: "Kerzen", v: [30, 20, 12] },
      { key: "pct", name: "Squeeze: unterste", what: "Die Bänder müssen im untersten Anteil ihrer letzten 120 Kerzen eng gewesen sein (Prozent). Kleiner = strenger.", unit: "%", v: [10, 20, 25] },
      STOP([2, 1.5, 1.2]),
      TRAIL([3, 2.5, 2]),
    ],
    make: (v) =>
      idea({ name: "Box-Ausbruch (Näherung)", interval: "4h", sides: "both", long: [leaf("bollinger", { len: 20, mult: 2, mode: "squeeze", pct: v.pct!, lookback: 120, within: 8 }), leaf("breakout", { mode: "up", n: v.len!, within: 3 })], stop: atrStop(v.stopAtr!), target: null, exits: { ...trail(v.trailAtr!), maxBars: 60 } }),
  },
  // ── Volatilität ──
  {
    id: "bollinger-squeeze",
    title: "Bollinger-Squeeze-Ausbruch",
    kind: "volatility",
    sub: "Die Bänder waren ungewöhnlich eng (ruhiger Markt); der Schluss bricht aus dem oberen (unteren) Band aus.",
    knownFrom: "Der „Squeeze“ (Bandbreite am Tief) wird von John Bollinger beschrieben: nach Ruhe folgt oft Bewegung – die Richtung zeigt der Band-Ausbruch.",
    phase: "Wechsel von ruhig zu volatil.",
    weaknesses: ["Die Richtung des Ausbruchs ist nicht vorhersehbar; Fehlausbrüche sind häufig.", "Ein Schluss außerhalb des Bands kann auch das Ende einer Bewegung sein.", "Wenige Signale."],
    tfs: ["1h", "4h", "15m"],
    params: [
      { key: "pct", name: "Squeeze: unterste", what: "Die Bandbreite muss im untersten Anteil ihrer letzten 120 Kerzen gelegen haben (Prozent). Kleiner = strenger.", unit: "%", v: [10, 20, 25] },
      { key: "within", name: "Squeeze höchstens", what: "So viele Kerzen darf der enge Zustand zurückliegen.", unit: "Kerzen", v: [6, 10, 15] },
      STOP([2, 1.5, 1.2]),
      TRAIL([3, 2.5, 2]),
    ],
    make: (v) => idea({ name: "Bollinger-Squeeze-Ausbruch", interval: "1h", sides: "both", long: [leaf("bollinger", { len: 20, mult: 2, mode: "squeeze", pct: v.pct!, lookback: 120, within: v.within! }), leaf("bollinger", { len: 20, mult: 2, mode: "closeAbove", within: 1 })], stop: atrStop(v.stopAtr!), target: null, exits: { ...trail(v.trailAtr!), maxBars: 48 } }),
  },
  {
    id: "keltner-squeeze",
    title: "Keltner-Squeeze",
    kind: "volatility",
    sub: "Die Bollinger-Bänder liegen innerhalb des Keltner-Kanals (starke Verdichtung); danach bricht ein 10-Kerzen-Hoch (Tief).",
    knownFrom: "Der Keltner-Kanal geht auf Chester Keltner (1960) zurück, die heutige Form auf Linda Raschke; die Kombination mit Bollinger-Bändern als „Squeeze“ ist durch John Carter („TTM Squeeze“) bekannt.",
    phase: "Verdichtung vor einer Ausdehnung der Volatilität.",
    weaknesses: ["Zwei Volatilitätsmaße, die beide vom selben Kurs kommen – die Verdichtung ist selten.", "Die Richtung bleibt offen; das Hoch-Kriterium ist nur ein Hilfsmittel.", "Fehlausbrüche."],
    tfs: ["1h", "4h"],
    params: [
      { key: "mult", name: "Kanal-Faktor", what: "Breite des Keltner-Kanals in ATR. Größer = Squeeze öfter erfüllt.", unit: "× ATR", v: [1.25, 1.5, 2] },
      { key: "within", name: "Squeeze höchstens", what: "So viele Kerzen darf die Verdichtung zurückliegen.", unit: "Kerzen", v: [4, 6, 10] },
      { key: "len", name: "Ausbruchs-Länge", what: "Kerzen des Hochs (Tiefs), das gebrochen werden muss.", unit: "Kerzen", v: [14, 10, 6] },
      STOP([2, 1.5, 1.2]),
      TRAIL([3, 2.5, 2]),
    ],
    make: (v) => idea({ name: "Keltner-Squeeze", interval: "1h", sides: "both", long: [leaf("keltner", { len: 20, atrLen: 20, mult: v.mult!, mode: "squeeze", bbMult: 2, within: v.within! }), leaf("donchian", { len: v.len!, mode: "breakUp", basis: "close", within: 1 })], stop: atrStop(v.stopAtr!), target: null, exits: { ...trail(v.trailAtr!), maxBars: 48 } }),
  },
];

function orbIdea(name: string, session: "asia" | "london" | "ny", v: Readonly<Record<string, number>>): CustomConfig {
  const range = { session, minutes: v.minutes!, validHours: v.validHours!, first: "first" };
  const long: Group = newGroup("g1", "and", [leaf("orb", { ...range, mode: "up" })]);
  const d = defaultCustom();
  // the stop sits behind the range: the swing over its bars (the range plus one) with a little ATR buffer
  const swing = Math.round(v.minutes! / 15) + 1;
  return sanitizeCustom({
    ...d,
    name,
    interval: "15m",
    sides: "both",
    long,
    short: newGroup("g2", "and", [leaf("orb", { ...range, mode: "down" })]),
    stop: { ...d.stop, kind: "swing", swing, buffer: 0.1 },
    target: { kind: "r", r: v.targetR! },
    exits: exitsOf({ maxBars: 32 }),
  });
}

// ── access ────────────────────────────────────────────────────────────────────────────────────────────────────

export const cardById = (id: string): StrategyCard | undefined => STRATEGY_CARDS.find((c) => c.id === id);

/** The values of one setting of a card. */
export function valuesOf(card: StrategyCard, level: LibLevel): Record<string, number> {
  const i = LEVELS.indexOf(level);
  return Object.fromEntries(card.params.map((p) => [p.key, p.v[i]!]));
}

/** The draft a card loads for a setting (a fresh, sanitised configuration; ids restart for every call). */
export function buildCard(card: StrategyCard, level: LibLevel = "standard"): CustomConfig {
  seq = 0;
  return card.make(valuesOf(card, level));
}

/** Plain text of a value: 1,5 × ATR · 20 Kerzen. */
export function valueText(p: LibParam, i: number): string {
  const n = String(p.v[i]!).replace(".", ",");
  return p.unit ? `${n} ${p.unit}` : n;
}
