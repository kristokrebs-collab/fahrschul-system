/**
 * From the items the scanners found to the lab's rules and the lists the trader reads: sections per direction, the
 * AND / OR tree (a mix without brackets is asked, never guessed), stop / target / management, the execution interval,
 * the assumptions, the unclear parts and the lab's own check of the result.
 */
import { defaultParams, sanitizeParams } from "../lab/rules/blocks";
import { DEFAULT_EXITS, DEFAULT_STOP, DEFAULT_TARGET, exitsText, mirrorGroup, nodeText, sanitizeCustom, stopText, validateCustom } from "../lab/rules/tree";
import { CUSTOM_VERSION, EXEC_TFS, TF_LABEL, TF_SEC, type ExitsCfg, type Group, type Leaf, type Node, type SidesCfg, type StopCfg, type TargetCfg, type TfId } from "../lab/rules/types";
import { Ctx, de, type AskDraft, type AssumeDraft, type Item, type SpecLeaf, type SpecNode } from "./ctx";
import { strictParamsProblem } from "./strict";
import { PARSE_VERSION, PERIOD_LABEL, type Ask, type AssumptionItem, type StrategyParse, type Understood, type UnderstoodKind, type Unclear } from "./types";

type Side = "long" | "short";
type CondItem = Extract<Item, { kind: "cond" }>;
type SideItem = Extract<Item, { kind: "side" }>;

const DEFAULT_INTERVAL: TfId = "4h";
const CONTENT_FILLER = new Set(
  (
    "ich du wir man der die das den dem des ein eine einen einem einer eines und oder auch noch nur dann denn doch wenn falls sobald dass ist sind war wird werden liegt liegen bleibt bleiben steht stehen hat haben soll sollen sollte sollten will willst moechte moechten kann kannst darf dabei dazu damit mit ohne bei von vom zu zum zur im in an am auf aus fuer durch ueber unter nach vor seit bis bzw sowie aber sondern jedoch so wie als es sich mir mich mein meine meinen meiner meinem dir dich bitte strategie regel regeln idee einstieg einstiege einsteigen einsteig position positionen trade trades handel handeln handle handelt signal signale bedingung bedingungen kerze kerzen chart charts markt gilt gelten immer jeweils jede jeder jedes dieser diese dieses wieder mal gerade wirklich genau etwa ca circa ungefaehr " +
    "kurs preis schlusskurs schluss ziel stop stopp dort hier da dann danach zuerst erst zunaechst dabei nicht kein keine keinen ausserdem zusaetzlich gleichzeitig plus ab bei einem long short kaufen kaufe verkaufen verkaufe setup test backtest teste testen pruefe pruefen nimm nehme nutze nutzen verwende benutze lass lasse laufen laeuft ausserhalb innerhalb waehrend jetzt heute zeit zeitraum letzte letzten naechste danke ok okay also halt eben " +
    "rest folge folgen sich beide beiden beides alle allen ausstieg exit raus schliessen schliesse kauf einstiegen strategie regeln gehe gehen gehst geh sein seine seinem seiner seinen ihr ihre ihren hat sich werde wuerde wuerden koennte koennten muss muessen mal nur ganz sehr recht"
  ).split(" "),
);

const SIDE_NAME: Record<Side, string> = { long: "Long", short: "Short" };

/* -------------------------------------------------------------------------------- spec → lab nodes */

interface Lower {
  n: number;
  /** the execution interval: a leaf that names the same timeframe is simply "exec" */
  interval: TfId | null;
  problems: { a: number; b: number; why: string }[];
}

function lowerLeaf(l: SpecLeaf, side: Side, id: string, low: Lower, at: { a: number; b: number }): Leaf | null {
  // a condition on the execution timeframe needs no timeframe of its own
  const params = { ...l.params };
  if ((l as SpecLeaf & { auto?: boolean }).auto) {
    if (l.block === "breakout") params.mode = side === "short" ? "down" : "up";
    if (l.block === "donchian") params.mode = side === "short" ? "breakDown" : "breakUp";
  }
  const problem = strictParamsProblem(l.block, params);
  if (problem) {
    low.problems.push({ ...at, why: `${problem} Die Bedingung ist nicht übernommen.` });
    return null;
  }
  const leaf: Leaf = { type: "leaf", id, block: l.block, tf: l.tf === low.interval ? "exec" : l.tf, params: sanitizeParams(l.block, { ...defaultParams(l.block), ...params }) };
  if (l.not) leaf.not = true;
  return leaf;
}

function lowerNode(n: SpecNode, side: Side, low: Lower, at: { a: number; b: number }): Node | null {
  if (n.t === "leaf") return lowerLeaf(n, side, `n${low.n++}`, low, at);
  const kids = n.kids.map((k) => lowerNode(k, side, low, at)).filter((k): k is Node => k !== null);
  if (!kids.length) return null;
  return { type: "group", id: `g${low.n++}`, op: n.op, children: kids };
}

/* ------------------------------------------------------------------------------------ the sections */

interface Section {
  side: Side;
  conds: CondItem[];
  filters: CondItem[];
}

function connectorBetween(ctx: Ctx, a: CondItem, b: CondItem): "and" | "or" {
  const gap = ctx.s.slice(a.b, b.a);
  return /\boder\b/.test(gap) ? "or" : "and";
}

function treeOf(ctx: Ctx, conds: CondItem[], side: Side, low: Lower, opId: string): { node: Node | null; mixed: boolean } {
  const nodes: { node: Node; item: CondItem }[] = [];
  for (const c of conds) {
    const n = lowerNode(c.node, side, low, { a: c.a, b: c.b });
    if (n) nodes.push({ node: n, item: c });
  }
  if (!nodes.length) return { node: null, mixed: false };
  if (nodes.length === 1) return { node: nodes[0]!.node, mixed: false };
  const ops = nodes.slice(1).map((x, i) => connectorBetween(ctx, nodes[i]!.item, x.item));
  const allAnd = ops.every((o) => o === "and");
  const allOr = ops.every((o) => o === "or");
  if (allAnd || allOr) return { node: { type: "group", id: `g${low.n++}`, op: allAnd ? "and" : "or", children: nodes.map((x) => x.node) }, mixed: false };
  // a mix of "und" and "oder" without brackets
  const orFirst = ctx.answer(opId, ["and-first", "or-first"]) === "or-first";
  const inner = orFirst ? "or" : "and";
  const outer = orFirst ? "and" : "or";
  const parts: Node[][] = [[nodes[0]!.node]];
  ops.forEach((o, i) => {
    if (o === inner) parts[parts.length - 1]!.push(nodes[i + 1]!.node);
    else parts.push([nodes[i + 1]!.node]);
  });
  const kids: Node[] = parts.map((p) => (p.length === 1 ? p[0]! : { type: "group", id: `g${low.n++}`, op: inner, children: p }));
  return { node: { type: "group", id: `g${low.n++}`, op: outer, children: kids }, mixed: true };
}

function sectionOf(ctx: Ctx, side: Side, conds: CondItem[], filters: CondItem[], low: Lower, asks: AskDraft[]): Group {
  const { node, mixed } = treeOf(ctx, conds, side, low, `op:${side}`);
  if (mixed) {
    const span = { a: conds[0]!.a, b: conds[conds.length - 1]!.b };
    asks.push({
      id: `op:${side}`,
      text: `${SIDE_NAME[side]}: Du verbindest Bedingungen mit „und“ und „oder“. Wie ist das gemeint? (vorläufig: „und“ bindet stärker)`,
      options: [
        { id: "and-first", label: "„und“ zuerst: (A und B) oder C" },
        { id: "or-first", label: "„oder“ zuerst: A und (B oder C)" },
      ],
      blocking: false,
      span,
    });
  }
  const kids: Node[] = [];
  if (node) kids.push(node);
  for (const f of filters) {
    const n = lowerNode(f.node, side, low, { a: f.a, b: f.b });
    if (n) kids.push(n);
  }
  // one AND group with the entry rule and the filters; an AND group of rules is opened up, so the tree stays flat
  const id = side === "long" ? "g1" : "g2";
  if (node && node.type === "group" && node.op === "and") return { type: "group", id, op: "and", children: [...node.children, ...kids.slice(1)] };
  return { type: "group", id, op: "and", children: kids };
}

/* --------------------------------------------------------------------------------------- the build */

function itemKind(it: Item): UnderstoodKind | null {
  switch (it.kind) {
    case "cond":
      return it.filter ? "filter" : "condition";
    case "side":
    case "stop":
    case "target":
    case "breakEven":
    case "trailing":
    case "partial":
    case "timeStop":
    case "opposite":
    case "risk":
    case "market":
    case "period":
      return it.kind;
    case "tf":
      return "interval";
    default:
      return null;
  }
}

export function buildParse(ctx: Ctx, text: string): StrategyParse {
  const asks: AskDraft[] = [...ctx.asks];
  const assumes: AssumeDraft[] = [...ctx.assumes];
  const extraUnclear: { a: number; b: number; why: string }[] = [];

  /* ---- direction ---- */
  const sideItems = ctx.items.filter((i): i is SideItem => i.kind === "side");
  const markers = sideItems.filter((s) => s.side !== "both").sort((x, y) => x.a - y.a);
  const bothWord = sideItems.some((s) => s.side === "both");
  const excluded = new Set(ctx.items.filter((i): i is Extract<Item, { kind: "noSide" }> => i.kind === "noSide").map((i) => i.side));
  const allConds = ctx.items.filter((i): i is CondItem => i.kind === "cond").sort((x, y) => x.a - y.a);
  const main = allConds.filter((c) => !c.filter);
  const filters = allConds.filter((c) => c.filter);

  let sides: Side[];
  let mirrored = false;
  const markerSides = [...new Set(markers.map((m) => m.side as Side))];
  if (markerSides.length) {
    sides = markerSides.filter((s) => !excluded.has(s));
    if (!sides.length) sides = markerSides;
  } else if (bothWord) {
    const a = ctx.answer("mirror", ["mirror", "long", "short"]);
    sides = a === "long" ? ["long"] : a === "short" ? ["short"] : ["long", "short"];
    mirrored = sides.length === 2;
    const w = sideItems.find((s) => s.side === "both")!;
    assumes.push({
      id: "mirror",
      text: "Short ist das Spiegelbild der Long-Regeln (RSI unter 30 wird RSI über 70, „nach oben“ wird „nach unten“ …). Willst du andere Short-Regeln, schreibe sie getrennt auf.",
      options: [{ id: "mirror", label: "Short gespiegelt" }, { id: "long", label: "nur Long" }, { id: "short", label: "nur Short" }],
      def: "mirror",
    });
    void w;
  } else if (excluded.size) {
    sides = (["long", "short"] as Side[]).filter((s) => !excluded.has(s));
  } else {
    const a = ctx.answer("side", ["long", "short", "both"]);
    const first = ctx.items.find((i) => i.kind === "cond");
    asks.push({
      id: "side",
      text: "Soll die Strategie Long, Short oder beides handeln?",
      options: [{ id: "long", label: "Long" }, { id: "short", label: "Short" }, { id: "both", label: "Beides (Short gespiegelt)" }],
      blocking: true,
      span: first ? { a: first.a, b: first.b } : null,
    });
    sides = a === "short" ? ["short"] : a === "both" ? ["long", "short"] : ["long"];
    mirrored = a === "both";
    if (a === "both")
      assumes.push({ id: "mirror", text: "Short ist das Spiegelbild der Long-Regeln.", options: [{ id: "mirror", label: "Short gespiegelt" }, { id: "long", label: "nur Long" }], def: "mirror" });
  }

  /* ---- sections: which conditions belong to which direction ---- */
  const sections: Section[] = sides.map((side) => ({ side, conds: [], filters: [] }));
  const byFirst = (side: Side): Section => sections.find((s) => s.side === side) ?? sections[0]!;
  if (mirrored || markerSides.length <= 1) {
    const target = sections[0]!;
    target.conds.push(...main);
    target.filters.push(...filters);
  } else {
    const firstCond = allConds[0];
    const wenn = /\b(?:wenn|falls|sobald)\b/.test(ctx.s.slice(0, markers[0]!.a));
    const after = firstCond != null && firstCond.a < markers[0]!.a && wenn;
    const owner = (c: CondItem): Section => {
      if (after) {
        const m = markers.find((x) => x.a >= c.b) ?? markers[markers.length - 1]!;
        return byFirst(m.side as Side);
      }
      let m = markers[0]!;
      for (const x of markers) if (x.a <= c.a) m = x;
      return byFirst(m.side as Side);
    };
    for (const c of main) owner(c).conds.push(c);
    const lastCondEnd = main.length ? main[main.length - 1]!.b : -1;
    for (const f of filters) {
      // a filter after the last rule of the last direction ("…, nur in London") counts for every direction
      if (sections.length > 1 && f.a >= lastCondEnd) {
        for (const s of sections) s.filters.push(f);
        assumes.push({ id: "filterAll", text: "Der Zeitfilter am Ende des Textes gilt für Long und Short.", options: [], def: null });
      } else owner(f).filters.push(f);
    }
  }
  // order words between conditions: "dann", "danach" – the lab checks everything on the same candle
  const seq = /\b(?:danach|anschliessend|im\s+anschluss|erst\s+(?:wenn|dann)|zuerst)\b/.exec(ctx.s);
  if (seq && main.length > 1) {
    const sp = { a: seq.index, b: seq.index + seq[0].length };
    extraUnclear.push({ ...sp, why: "Eine zeitliche Reihenfolge („erst …, danach …“) kennt das Labor nicht – es prüft alle Bedingungen an derselben Kerze (Ereignisse dürfen wenige Kerzen zurückliegen: siehe Annahme zum Fenster)." });
  }

  /* ---- exit management ---- */
  const first = <K extends Item["kind"]>(k: K): Extract<Item, { kind: K }> | undefined => ctx.items.find((i): i is Extract<Item, { kind: K }> => i.kind === k);
  const many = <K extends Item["kind"]>(k: K): Extract<Item, { kind: K }>[] => ctx.items.filter((i): i is Extract<Item, { kind: K }> => i.kind === k);

  // interval: the text's own, else the lowest timeframe a condition names, else the lab's default (asked)
  const stratTfs = many("tf");
  const leafTfs: TfId[] = [];
  const collect = (n: SpecNode): void => {
    if (n.t === "leaf") {
      if (n.tf !== "exec") leafTfs.push(n.tf);
    } else n.kids.forEach(collect);
  };
  main.forEach((c) => collect(c.node));
  let interval: TfId = DEFAULT_INTERVAL;
  let intervalFrom: "text" | "leaf" | "default" = "default";
  if (stratTfs.length) {
    interval = stratTfs[0]!.tf;
    intervalFrom = "text";
    const other = stratTfs.find((t) => t.tf !== interval);
    if (other) extraUnclear.push({ a: other.a, b: other.b, why: `Mehrere Zeitrahmen genannt (${TF_LABEL[interval]} und ${TF_LABEL[other.tf]}) – die Strategie läuft auf ${TF_LABEL[interval]}. Eine Bedingung auf einem höheren Zeitrahmen schreibst du an die Bedingung („EMA 200 im Tageschart“).` });
  } else if (leafTfs.length) {
    const lowest = leafTfs.reduce((a, b) => (TF_SEC[a] <= TF_SEC[b] ? a : b));
    const allLeavesNamed = main.length > 0 && main.every((c) => nodeAllTf(c.node));
    if (allLeavesNamed || TF_SEC[lowest] < TF_SEC[DEFAULT_INTERVAL]) {
      interval = lowest;
      intervalFrom = "leaf";
    }
  }
  if (intervalFrom !== "text") {
    const a = ctx.answer("interval", EXEC_TFS as readonly string[]);
    if (a) interval = a as TfId;
    assumes.push({
      id: "interval",
      text: intervalFrom === "leaf" ? `Ausführungs-Kerze ${TF_LABEL[interval]}, weil die Bedingungen diesen Zeitrahmen nennen.` : `Zeitrahmen ${TF_LABEL[DEFAULT_INTERVAL]} (im Text stand keiner).`,
      options: EXEC_TFS.map((t) => ({ id: t, label: TF_LABEL[t] })),
      def: intervalFrom === "leaf" ? interval : DEFAULT_INTERVAL,
    });
  }

  // stop
  let stop: StopCfg = { ...DEFAULT_STOP };
  let stopRejected = false;
  let targetRejected = false;
  const stopItem = many("stop").find((s) => s.stop != null);
  const stopBare = many("stop").find((s) => s.stop == null);
  const stopsGiven = many("stop").filter((s) => s.stop != null);
  if (stopsGiven.length > 1) {
    const second = stopsGiven.find((s) => s !== stopItem && (s.stop!.kind !== stopItem!.stop!.kind || s.stop!.value !== stopItem!.stop!.value));
    if (second) extraUnclear.push({ a: second.a, b: second.b, why: "Zwei verschiedene Stops genannt – das Labor kennt einen Stop; ich nehme den ersten." });
  }
  if (stopItem?.stop) {
    const s = stopItem.stop;
    stop = s.kind === "atr" ? { ...DEFAULT_STOP, kind: "atr", atr: s.value } : s.kind === "percent" ? { ...DEFAULT_STOP, kind: "percent", pct: s.value } : { ...DEFAULT_STOP, kind: "swing", swing: s.value };
    if (s.kind === "swing" && s.fromDefault) assumes.push({ id: "swing", text: "Swing-Stop über die letzten 10 Kerzen (im Text stand keine Zahl).", options: [], def: null });
    const bad = stopProblem(stop);
    if (bad) {
      extraUnclear.push({ a: stopItem.a, b: stopItem.b, why: bad });
      stop = { ...DEFAULT_STOP };
      stopRejected = true;
    }
  } else {
    if (stopBare) extraUnclear.push({ a: stopBare.a, b: stopBare.b, why: "Zum Stop fehlt ein Wert (z. B. „Stop 1,5 ATR“ oder „Stop 2 %“)." });
    const choice = ctx.answer("stop", ["atr1", "atr1.5", "atr2", "atr3", "pct1", "pct2", "swing10"]);
    if (choice) stop = { ...DEFAULT_STOP, ...stopFromChoice(choice) };
    assumes.push({
      id: "stop",
      text: `Stop ${stopText(stop)} (im Text stand keiner; das Labor handelt nie ohne Stop).`,
      options: [{ id: "atr1", label: "1 × ATR" }, { id: "atr1.5", label: "1,5 × ATR" }, { id: "atr2", label: "2 × ATR" }, { id: "atr3", label: "3 × ATR" }, { id: "pct1", label: "1 %" }, { id: "pct2", label: "2 %" }, { id: "swing10", label: "10-Kerzen-Swing" }],
      def: "atr1.5",
    });
  }
  // target
  let target: TargetCfg = { ...DEFAULT_TARGET };
  const tItems = many("target");
  const tGiven = tItems.find((t) => t.none || t.r != null);
  if (tGiven?.none) target = { kind: "none", r: DEFAULT_TARGET.r };
  else if (tGiven?.r != null) {
    if (tGiven.r < 0.25 || tGiven.r > 20) {
      extraUnclear.push({ a: tGiven.a, b: tGiven.b, why: `Ziel ${de(tGiven.r)} R liegt außerhalb dessen, was das Labor rechnet (0,25 bis 20 R); ich nehme den Standard 2 R.` });
      targetRejected = true;
    }
    else target = { kind: "r", r: tGiven.r };
  } else {
    const bare = tItems.find((t) => t.r == null && !t.none);
    if (bare) extraUnclear.push({ a: bare.a, b: bare.b, why: "Zum Ziel fehlt ein Wert (z. B. „Ziel 2R“ – das Doppelte des Risikos)." });
    const choice = ctx.answer("target", ["r1", "r1.5", "r2", "r3", "none"]);
    if (choice === "none") target = { kind: "none", r: DEFAULT_TARGET.r };
    else if (choice) target = { kind: "r", r: Number(choice.slice(1)) };
    assumes.push({
      id: "target",
      text: `Ziel ${target.kind === "r" ? `${de(target.r)} R` : "kein festes Ziel"} (im Text stand keins).`,
      options: [{ id: "r1", label: "1 R" }, { id: "r1.5", label: "1,5 R" }, { id: "r2", label: "2 R" }, { id: "r3", label: "3 R" }, { id: "none", label: "kein Ziel" }],
      def: "r2",
    });
  }
  // management
  const exits: ExitsCfg = JSON.parse(JSON.stringify(DEFAULT_EXITS)) as ExitsCfg;
  const be = first("breakEven");
  if (be) {
    const v = be.fromDefault ? Number(ctx.answer("be", ["0.5", "1", "1.5", "2"]) ?? 1) : be.value;
    exits.breakEven = { on: true, trigger: be.trigger, value: v, to: be.to };
  }
  const tr = first("trailing");
  if (tr) {
    const choice = tr.fromDefault ? ctx.answer("trail", ["atr1.5", "atr2", "atr3"]) : null;
    exits.trail = { on: true, kind: choice ? "atr" : tr.tkind, value: choice ? Number(choice.slice(3)) : tr.value, activateR: tr.activateR };
  }
  const pa = first("partial");
  if (pa) {
    const r = ctx.answer("partial-r", ["0.5", "1", "1.5", "2"]);
    const f = ctx.answer("partial-frac", ["25", "33", "50", "75"]);
    exits.partial = { on: true, atR: r ? Number(r) : pa.atR, fracPct: f ? Number(f) : pa.fracPct, thenBreakEven: true };
  }
  const ts = first("timeStop");
  if (ts) {
    const bars = ts.unit === "bars" ? ts.value : Math.ceil((ts.value * (ts.unit === "hours" ? 3600 : 86_400)) / TF_SEC[interval]);
    exits.maxBars = Math.max(1, Math.round(bars));
    if (ts.unit !== "bars") assumes.push({ id: "timestop", text: `Zeit-Stop: ${de(ts.value)} ${ts.unit === "hours" ? "Stunden" : "Tage"} sind bei ${TF_LABEL[interval]}-Kerzen ${exits.maxBars} Kerzen.`, options: [], def: null });
  }
  if (first("opposite")) exits.exitOnOpposite = true;

  /* ---- the trees ---- */
  const low: Lower = { n: 3, interval, problems: [] };
  const groups: Partial<Record<Side, Group>> = {};
  for (const s of sections) groups[s.side] = sectionOf(ctx, s.side, s.conds, s.filters, low, asks);
  if (mirrored && groups.long) groups.short = mirrorGroup(groups.long, "g2", 100);
  const sidesCfg: SidesCfg = sides.length === 2 ? "both" : sides[0]!;
  const emptyG = (id: string): Group => ({ type: "group", id, op: "and", children: [] });
  const longG = groups.long ?? (groups.short ? mirrorGroup(groups.short, "g1", 100) : emptyG("g1"));
  const shortG = groups.short ?? (groups.long ? mirrorGroup(groups.long, "g2", 100) : emptyG("g2"));
  const rules = sanitizeCustom({ version: CUSTOM_VERSION, name: "Meine Strategie", interval, sides: sidesCfg, long: longG, short: shortG, stop, target, exits });
  const issues = validateCustom(rules);

  /* ---- risk, market, period ---- */
  const risk = first("risk");
  const market = first("market");
  const period = first("period");

  /* ---- no rule at all: say what is missing ---- */
  for (const side of sides) {
    const g = side === "long" ? rules.long : rules.short;
    if (!g.children.length || !hasLeaf(g)) {
      const askId = `needs:${side}`;
      asks.push({
        id: askId,
        text: sides.length === 2 && !mirrored ? `Was soll den ${SIDE_NAME[side]}-Einstieg auslösen?` : "Was soll den Einstieg auslösen?",
        options: [],
        blocking: true,
        span: null,
      });
    }
  }

  /* ---- the lists ---- */
  const understood: Understood[] = [];
  const tfLine = (t: TfId): string => `Zeitrahmen: ${TF_LABEL[t]}`;
  const lines = exitsText(rules);
  const line = (prefix: string): string => lines.find((l) => l.startsWith(prefix)) ?? prefix;
  const items = [...ctx.items].sort((x, y) => x.a - y.a);
  let uid = 0;
  const push = (it: Item, kind: UnderstoodKind, meaning: string): void => {
    const sp = ctx.span(it.a, it.b);
    understood.push({ id: `u${uid++}`, kind, phrase: ctx.src.slice(sp.start, sp.end).trim(), span: sp, meaning });
  };
  for (const it of items) {
    const kind = itemKind(it);
    if (!kind) continue;
    switch (it.kind) {
      case "cond": {
        // meaning from the lab's own text of the tree this condition became
        const probe: Lower = { n: 1, interval, problems: [] };
        const sideOfIt: Side = sections.find((s) => s.conds.includes(it) || s.filters.includes(it))?.side ?? sides[0]!;
        const node = lowerNode(it.node, sideOfIt, probe, { a: it.a, b: it.b });
        if (node) push(it, kind, nodeText(node));
        break;
      }
      case "side":
        push(it, kind, it.side === "both" ? "Richtung: Long und Short" : `Richtung: ${SIDE_NAME[it.side]}`);
        break;
      case "noSide":
        push(it, "side", `Richtung: kein ${SIDE_NAME[it.side]}`);
        break;
      case "stop":
        if (it.stop && it === stopItem && !stopRejected) push(it, kind, `Stop: ${stopText(stop)}`);
        break;
      case "target":
        if (it === tGiven && !targetRejected) push(it, kind, target.kind === "r" ? `Ziel bei ${de(target.r)} R` : "Kein festes Ziel");
        break;
      case "breakEven":
        push(it, kind, line("Break-even"));
        break;
      case "trailing":
        push(it, kind, line("Trailing-Stop"));
        break;
      case "partial":
        push(it, kind, lines.find((l) => l.includes("der Position bei")) ?? "Teilgewinn");
        break;
      case "timeStop":
        push(it, kind, line("Zeit-Stop"));
        break;
      case "opposite":
        push(it, kind, "Ausstieg bei neuem Gegensignal");
        break;
      case "risk":
        push(it, kind, `Risiko pro Trade: ${de(it.pct)} %`);
        break;
      case "market":
        push(it, kind, `Markt: ${it.symbol}`);
        break;
      case "period":
        push(it, kind, `Testzeitraum: ${PERIOD_LABEL[it.period]}`);
        break;
      case "tf":
        push(it, "interval", tfLine(it.tf));
        break;
    }
  }

  const unclearDrafts = [...ctx.unclear, ...extraUnclear, ...low.problems];
  // words nothing read: content words that are left in the working text
  for (const g of leftover(ctx)) unclearDrafts.push({ a: g.a, b: g.b, why: "Diese Stelle konnte ich keiner Regel zuordnen." });
  const unclear: Unclear[] = unclearDrafts
    .sort((x, y) => x.a - y.a)
    .map((u, i) => ({ id: `x${i}`, phrase: ctx.phrase(u.a, u.b).trim(), span: ctx.span(u.a, u.b), why: u.why }));
  // the lab's own errors, when no part of the text explains them
  for (const issue of issues) {
    if (issue.level === "error" && !unclear.some((u) => u.why === issue.text)) unclear.push({ id: `x${unclear.length}`, phrase: "", span: null, why: issue.text });
  }

  const askList: Ask[] = dedupe(asks)
    .sort((x, y) => (x.blocking === y.blocking ? (x.span?.a ?? 1e9) - (y.span?.a ?? 1e9) : x.blocking ? -1 : 1))
    .map((a) => ({
      id: a.id,
      text: a.text,
      options: a.options,
      blocking: a.blocking,
      chosen: ctx.answer(a.id, a.options.map((o) => o.id)),
      span: a.span ? ctx.span(a.span.a, a.span.b) : null,
    }));
  const assumptionItems: AssumptionItem[] = dedupe(assumes).map((a) => ({
    id: a.id,
    text: a.text,
    options: a.options,
    value: ctx.answer(a.id, a.options.map((o) => o.id)) ?? a.def,
  }));

  const blocking = askList.some((a) => a.blocking && a.chosen == null);
  const hasError = issues.some((i) => i.level === "error");
  return {
    v: PARSE_VERSION,
    source: "local",
    text,
    rules,
    setup: { symbol: market?.symbol ?? null, period: period?.period ?? null, riskPct: risk?.pct ?? null },
    understood,
    unclear,
    questions: askList.map((a) => a.text),
    asks: askList,
    assumptions: assumptionItems.map((a) => a.text),
    assumptionItems,
    issues,
    ready: !hasError && !blocking && rules.long.children.length + rules.short.children.length > 0,
  };
}

function dedupe<T extends { id: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

function hasLeaf(n: Node): boolean {
  return n.type === "leaf" || n.children.some(hasLeaf);
}

function nodeAllTf(n: SpecNode): boolean {
  return n.t === "leaf" ? n.tf !== "exec" : n.kids.every(nodeAllTf);
}

function stopFromChoice(c: string): Partial<StopCfg> {
  if (c.startsWith("atr")) return { kind: "atr", atr: Number(c.slice(3)) };
  if (c.startsWith("pct")) return { kind: "percent", pct: Number(c.slice(3)) };
  return { kind: "swing", swing: Number(c.slice(5)) };
}

function stopProblem(s: StopCfg): string | null {
  if (s.kind === "atr" && (s.atr < 0.3 || s.atr > 10)) return `Stop ${de(s.atr)} × ATR liegt außerhalb dessen, was das Labor rechnet (0,3 bis 10 × ATR); ich nehme den Standard 1,5 × ATR.`;
  if (s.kind === "percent" && (s.pct < 0.05 || s.pct > 30)) return `Stop ${de(s.pct)} % liegt außerhalb dessen, was das Labor rechnet (0,05 bis 30 %); ich nehme den Standard 1,5 × ATR.`;
  if (s.kind === "swing" && (s.swing < 2 || s.swing > 200)) return `Swing-Stop über ${s.swing} Kerzen liegt außerhalb dessen, was das Labor rechnet (2 bis 200); ich nehme den Standard 1,5 × ATR.`;
  return null;
}

/** Content words left in the working text, clustered (a gap of one filler word keeps a cluster together). */
function leftover(ctx: Ctx): { a: number; b: number }[] {
  const words: { a: number; b: number; w: string }[] = [];
  const rx = /[a-z0-9%+:<>=.,]+/g;
  for (let m = rx.exec(ctx.w); m; m = rx.exec(ctx.w)) {
    const w = m[0].replace(/^[.,:]+|[.,:]+$/g, "");
    if (!w) continue;
    words.push({ a: m.index, b: m.index + m[0].length, w });
  }
  const content = words.filter((x) => !CONTENT_FILLER.has(x.w) && /[a-z]{3,}|\d/.test(x.w) && !/^(?:z|b|usw|etc|ggf|evtl|u|a)$/.test(x.w));
  const out: { a: number; b: number }[] = [];
  for (const c of content) {
    const prev = out[out.length - 1];
    const between = prev ? words.filter((x) => x.a >= prev.b && x.b <= c.a) : [];
    const untouched = ctx.s.slice(prev?.b ?? 0, c.a) === ctx.w.slice(prev?.b ?? 0, c.a);
    if (prev && untouched && between.length <= 1 && between.every((x) => CONTENT_FILLER.has(x.w)) && !/[.;\n,]/.test(ctx.w.slice(prev.b, c.a))) prev.b = c.b;
    else out.push({ a: c.a, b: c.b });
  }
  return out;
}

