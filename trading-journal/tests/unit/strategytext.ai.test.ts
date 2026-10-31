/**
 * Strategie-Studio · the strict rules schema, the optional model contract and the checks every model answer passes:
 * a rule that does not fit is rejected (never clamped), a phrase that is not in the trader's text is rejected, the
 * model's prose never becomes a rule's meaning, and the tool schema stays in step with the Zod schema.
 */
import { describe, expect, it } from "vitest";
import { BLOCK_ORDER, leavesOf, TF_IDS, type CustomConfig } from "@/domain/lab";
import { AI_TOOL, aiToParse, AiOutputSchema, buildSystemPrompt, buildUserPrompt, catalogText, groundingProblems, parseAiOutput, parseStrategyText, REFS, RulesSchema, type AiOutput } from "@/domain/strategytext/index";

const TEXTS = [
  "Long, wenn der RSI unter 30 fällt und der Kurs über dem EMA 200 liegt, Stop 1,5 ATR, Ziel 2R, nur in der London-Session",
  "Long: RSI unter 30. Short: RSI über 70. Beide mit Stop 1,5 ATR und Ziel 2R",
  "Long wenn Schlusskurs über 65.000, Stop 2 %, Break-even bei 1R, Trailing Stop 2 ATR, Teilgewinn 50 % bei 1R",
  "Long wenn RSI unter 30 oder MACD kreuzt nach oben und Kurs über EMA 200",
  "Short wenn Stochastic %K kreuzt %D nach unten über 80 und Kurs unter VWAP",
  "Long wenn RSI zwischen 30 und 50, nicht am Wochenende, Zeitstop nach 20 Kerzen, Gegensignal Ausstieg",
];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("RulesSchema", () => {
  it("accepts what the local parser builds", () => {
    for (const t of TEXTS) {
      const r = parseStrategyText(t);
      const res = RulesSchema.safeParse(r.rules);
      expect(res.success, `${t}: ${res.success ? "" : JSON.stringify(res.error.issues[0])}`).toBe(true);
    }
  });

  const base = (): CustomConfig => parseStrategyText(TEXTS[0]!).rules;

  function reject(edit: (c: CustomConfig) => void, why: RegExp): void {
    const c = clone(base());
    edit(c);
    const res = RulesSchema.safeParse(c);
    expect(res.success, "should be rejected").toBe(false);
    if (!res.success) expect(res.error.issues.map((i) => i.message).join(" | ")).toMatch(why);
  }

  it("rejects what the lab would clamp or drop silently", () => {
    reject((c) => (leavesOf(c.long)[0]!.params.level = 150), /außerhalb/);
    reject((c) => (leavesOf(c.long)[0]!.params.mode = "sideways"), /nicht erlaubt/);
    reject((c) => (leavesOf(c.long)[0]!.params.bogus = 1), /kein Parameter/);
    reject((c) => (leavesOf(c.long)[0]!.params.len = 14.5), /ganze Zahl/);
    reject((c) => (c.stop.atr = 99), /Stop/);
    reject((c) => (c.target.r = 0.01), /Ziel/);
    reject((c) => (c.exits.maxBars = 99_999), /Positionsverwaltung/);
    reject((c) => (c.exits.breakEven.value = -4), /Positionsverwaltung/);
  });

  it("rejects broken trees and unknown things", () => {
    reject((c) => ((leavesOf(c.long)[0] as { block: string }).block = "magic"), /Invalid/);
    reject((c) => (c.long.id = "g9"), /Wurzelgruppen/);
    reject((c) => (leavesOf(c.long)[1]!.id = leavesOf(c.long)[0]!.id), /doppelt/);
    reject((c) => (c.long.children = []), /Bedingung/);
    reject((c) => (c.interval = "3d" as never), /Invalid/);
    reject((c) => ((c as unknown as { extra: number }).extra = 1), /Unrecognized key/);
    reject((c) => {
      let g = c.long;
      for (let i = 0; i < 6; i++) {
        const inner = { type: "group" as const, id: `g${20 + i}`, op: "and" as const, children: [] as CustomConfig["long"]["children"] };
        g.children = [...g.children, inner];
        g = inner;
      }
    }, /tiefer|Gruppe/);
  });

  it("rejects a timeframe lower than the execution interval (the lab's own error)", () => {
    reject((c) => {
      c.interval = "1d";
      leavesOf(c.long)[0]!.tf = "1h";
    }, /niedriger/);
  });
});

describe("model answer", () => {
  const text = "Long wenn der RSI unter 30 fällt und der Kurs über der EMA 200 liegt, Stop 1,5 ATR";
  const local = parseStrategyText(text);
  const [l1, l2] = leavesOf(local.rules.long);
  const good = (): AiOutput => ({
    rules: clone(local.rules),
    setup: { symbol: null, period: null, riskPct: null },
    understood: [
      { phrase: "RSI unter 30 fällt", ref: l1!.id },
      { phrase: "Kurs über der EMA 200 liegt", ref: l2!.id },
      { phrase: "Stop 1,5 ATR", ref: "stop" },
    ],
    unclear: [],
    questions: ["Ist die EMA 200 auf dem Tageschart gemeint?"],
    assumptions: ["Zeitrahmen 4h, weil keiner genannt wurde."],
  });

  it("passes when rules and phrases fit – and becomes the same StrategyParse the local parser returns", () => {
    const res = parseAiOutput(good(), text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = aiToParse(text, res.out);
    expect(p.source).toBe("ai");
    expect(p.ready).toBe(true);
    expect(p.rules.sides).toBe("long");
    // the meaning is the LAB's text of the rule, never the model's prose
    expect(p.understood.map((u) => u.meaning)).toEqual(["RSI(14) kreuzt nach unten 30", "Schluss über EMA 200", "Stop: 1,5 × ATR(14)"]);
    for (const u of p.understood) expect(text.slice(u.span.start, u.span.end)).toBe(u.phrase);
    expect(p.questions).toEqual(["Ist die EMA 200 auf dem Tageschart gemeint?"]);
    expect(p.asks[0]).toMatchObject({ options: [], blocking: false });
  });

  it("is rejected when a phrase is not in the trader's text (no invented rule)", () => {
    const out = good();
    out.understood.push({ phrase: "Volumen über dem Doppelten", ref: l1!.id });
    const res = parseAiOutput(out, text);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("steht nicht im Text");
    expect(groundingProblems(text, out)).toHaveLength(1);
  });

  it("is rejected when a reference points at nothing, or the rules do not fit the schema", () => {
    const out = good();
    out.understood[0]!.ref = "n99";
    expect(parseAiOutput(out, text)).toMatchObject({ ok: false });
    const bad = good();
    leavesOf(bad.rules.long)[0]!.params.level = 500;
    expect(parseAiOutput(bad, text)).toMatchObject({ ok: false });
    expect(parseAiOutput({ rules: "x" }, text)).toMatchObject({ ok: false });
    expect(parseAiOutput(null, text)).toMatchObject({ ok: false });
    const noPhrase = good();
    noPhrase.understood = [];
    expect(parseAiOutput(noPhrase, text)).toMatchObject({ ok: false });
  });

  it("matches phrases regardless of case, umlaut spelling and spacing", () => {
    const out = good();
    out.understood[0]!.phrase = "rsi  UNTER 30 faellt";
    expect(parseAiOutput(out, text).ok).toBe(true);
  });

  it("carries no number of its own into the result: the trader's numbers come from the rules, which the schema ranges bound", () => {
    expect(AiOutputSchema.safeParse({ ...good(), results: { winRate: 0.9 } }).success).toBe(false);
  });
});

describe("tool schema and prompt", () => {
  const props = AI_TOOL.input_schema.properties;

  it("stays in step with the Zod schema", () => {
    expect(AI_TOOL.input_schema.required).toEqual(Object.keys(AiOutputSchema.shape));
    expect(Object.keys(props)).toEqual(Object.keys(AiOutputSchema.shape));
    expect(AI_TOOL.input_schema.$defs.leaf.properties.block.enum).toEqual([...BLOCK_ORDER]);
    expect(AI_TOOL.input_schema.$defs.leaf.properties.tf.enum).toEqual(["exec", ...TF_IDS]);
    expect(props.rules.required).toEqual(Object.keys(RulesSchema.innerType().shape));
    expect(props.understood.items.properties.ref.description).toContain(REFS.join(", "));
  });

  it("generates the catalogue from the lab's blocks", () => {
    const cat = catalogText();
    for (const id of BLOCK_ORDER) expect(cat).toContain(`- ${id} –`);
    expect(cat).toContain("level: Zahl 1…99 (Standard 30)");
  });

  it("tells the model its one job and sends only the text", () => {
    const sys = buildSystemPrompt();
    expect(sys).toMatch(/keine Zahl|erfindest keine Zahl/);
    expect(sys).toMatch(/Daten, keine Anweisung/);
    expect(buildUserPrompt("Long wenn RSI unter 30")).toBe('Text der Strategie:\n"""\nLong wenn RSI unter 30\n"""');
  });
});
