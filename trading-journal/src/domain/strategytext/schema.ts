/**
 * The strict schema of "rules" (the lab's `CustomConfig`) as Zod – the one check both readers pass: the local parser's
 * result (tested against it for every sentence of the parser table) and anything a language model returns for the optional
 * server compile. A rule that does not fit is REJECTED, never repaired: `sanitizeCustom` clamps silently, which is right
 * for a stored draft and wrong for dictated rules, so every number is checked against the block's own range
 * (`strictParamsProblem`) and the stop / target / management objects must survive `sanitize…` unchanged.
 */
import { z } from "zod";
import { BLOCK_ORDER } from "../lab/rules/blocks";
import { MAX_CHILDREN, MAX_DEPTH, MAX_LEAVES_PER_SIDE, MAX_NAME, sanitizeExits, sanitizeStop, sanitizeTarget, validateCustom } from "../lab/rules/tree";
import { CUSTOM_VERSION, EXEC_TFS, TF_IDS, type BlockId, type CustomConfig, type Group, type Node } from "../lab/rules/types";
import { strictParamsProblem } from "./strict";
import { STUDIO_PERIODS } from "./types";

const Id = z.string().regex(/^[ng][0-9]{1,6}$/);
const Tf = z.enum(["exec", ...TF_IDS] as [string, ...string[]]);
const Block = z.enum(BLOCK_ORDER as unknown as [BlockId, ...BlockId[]]);

const LeafSchema = z
  .object({
    type: z.literal("leaf"),
    id: Id,
    block: Block,
    tf: Tf,
    params: z.record(z.string().max(32), z.union([z.number().finite(), z.string().max(40)])),
    not: z.boolean().optional(),
  })
  .strict()
  .superRefine((l, ctx) => {
    const p = strictParamsProblem(l.block, l.params);
    if (p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: p });
  });

const GroupSchema: z.ZodType<Group> = z.lazy(() =>
  z
    .object({
      type: z.literal("group"),
      id: Id,
      op: z.enum(["and", "or"]),
      children: z.array(z.union([LeafSchema, GroupSchema])).max(MAX_CHILDREN),
    })
    .strict(),
) as unknown as z.ZodType<Group>;

/** The same object after `fix` – equal means nothing had to be clamped or repaired. */
const unchanged = <T>(fix: (raw: unknown) => T) => (v: unknown): boolean => JSON.stringify(canon(fix(v))) === JSON.stringify(canon(v));

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  return v;
}

const StopSchema = z.object({ kind: z.enum(["atr", "percent", "swing"]), atr: z.number(), pct: z.number(), swing: z.number().int(), buffer: z.number() }).strict().refine(unchanged(sanitizeStop), "Der Stop liegt außerhalb dessen, was das Labor rechnet.");
const TargetSchema = z.object({ kind: z.enum(["r", "none"]), r: z.number() }).strict().refine(unchanged(sanitizeTarget), "Das Ziel liegt außerhalb dessen, was das Labor rechnet.");
const ExitsSchema = z
  .object({
    breakEven: z.object({ on: z.boolean(), trigger: z.enum(["r", "pct"]), value: z.number(), to: z.enum(["entry", "net"]) }).strict(),
    trail: z.object({ on: z.boolean(), kind: z.enum(["atr", "pct"]), value: z.number(), activateR: z.number() }).strict(),
    partial: z.object({ on: z.boolean(), atR: z.number(), fracPct: z.number(), thenBreakEven: z.boolean() }).strict(),
    maxBars: z.number().int(),
    exitOnOpposite: z.boolean(),
  })
  .strict()
  .refine(unchanged(sanitizeExits), "Eine Positionsverwaltung liegt außerhalb dessen, was das Labor rechnet.");

const depthOf = (n: Node): number => (n.type === "leaf" ? 0 : 1 + Math.max(0, ...n.children.map(depthOf)));
const leavesIn = (n: Node): number => (n.type === "leaf" ? 1 : n.children.reduce((s, c) => s + leavesIn(c), 0));

/** The lab's configuration, strictly. */
export const RulesSchema = z
  .object({
    version: z.literal(CUSTOM_VERSION),
    name: z.string().trim().min(1).max(MAX_NAME),
    interval: z.enum(EXEC_TFS as unknown as [string, ...string[]]),
    sides: z.enum(["long", "short", "both"]),
    long: GroupSchema,
    short: GroupSchema,
    stop: StopSchema,
    target: TargetSchema,
    exits: ExitsSchema,
  })
  .strict()
  .superRefine((c, ctx) => {
    const add = (message: string): void => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (c.long.id !== "g1" || c.short.id !== "g2") add("Die Wurzelgruppen heißen g1 (Long) und g2 (Short).");
    const ids = new Set<string>();
    const walk = (n: Node): void => {
      if (ids.has(n.id)) add(`Die Kennung „${n.id}“ kommt doppelt vor.`);
      ids.add(n.id);
      if (n.type === "group") n.children.forEach(walk);
    };
    walk(c.long);
    walk(c.short);
    for (const [side, g] of [["Long", c.long], ["Short", c.short]] as const) {
      if (depthOf(g) > MAX_DEPTH) add(`${side}: Die Gruppen sind tiefer als ${MAX_DEPTH} Ebenen.`);
      if (leavesIn(g) > MAX_LEAVES_PER_SIDE) add(`${side}: Mehr als ${MAX_LEAVES_PER_SIDE} Bedingungen.`);
    }
    // the lab's own check: an active side needs a rule, a timeframe must exist, a stop must be wide enough …
    for (const issue of validateCustom(c as unknown as CustomConfig)) if (issue.level === "error") add(issue.text);
  });

export const SetupSchema = z
  .object({
    symbol: z.string().regex(/^[A-Z0-9]{2,24}$/).nullable(),
    period: z.enum(STUDIO_PERIODS as unknown as [string, ...string[]]).nullable(),
    riskPct: z.number().min(0.05).max(10).nullable(),
  })
  .strict();

/** What a "ref" of an understood entry may point at besides a leaf / group id of the rules. */
export const REFS = ["side", "interval", "stop", "target", "breakEven", "trailing", "partial", "timeStop", "opposite", "risk", "market", "period"] as const;
export type Ref = (typeof REFS)[number];

/** What the server compile returns (and the client re-checks): rules plus the plain lists. No figure, no result. */
export const AiOutputSchema = z
  .object({
    rules: RulesSchema,
    setup: SetupSchema,
    understood: z
      .array(
        z
          .object({
            /** the trader's own words, copied from the text – must occur in it */
            phrase: z.string().trim().min(1).max(200),
            /** a leaf or group id of `rules`, or one of `REFS` */
            ref: z.string().min(1).max(12),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    unclear: z.array(z.object({ phrase: z.string().trim().max(200), why: z.string().trim().min(1).max(240) }).strict()).max(20),
    questions: z.array(z.string().trim().min(1).max(200)).max(8),
    assumptions: z.array(z.string().trim().min(1).max(240)).max(12),
  })
  .strict();

export type AiOutput = z.infer<typeof AiOutputSchema>;
