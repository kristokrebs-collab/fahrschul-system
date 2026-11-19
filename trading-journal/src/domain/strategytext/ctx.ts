/**
 * The working state of one parse: the folded text, the part of it not yet read, what was found (items), what was not
 * understood, the open questions and the assumptions. The scanners (`globals.ts`, `conditions.ts`) fill it, `build.ts`
 * turns it into the lab's rules and the lists the trader reads.
 */
import type { BlockId, LeafParams, StopCfg, TfId } from "../lab/rules/types";
import { originalSpan, type Folded } from "./normalize";
import type { Answers, AskOption, StudioPeriod, TextSpan } from "./types";

/** A span of the FOLDED text. */
export interface Span {
  a: number;
  b: number;
}

export interface SpecLeaf {
  t: "leaf";
  block: BlockId;
  params: LeafParams;
  tf: "exec" | TfId;
  not?: boolean;
  /** an event (crossing …) whose window the text did not give: the "within" assumption applies */
  ev?: boolean;
}
export interface SpecGroup {
  t: "group";
  op: "and" | "or";
  kids: SpecNode[];
}
export type SpecNode = SpecLeaf | SpecGroup;

export interface StopSpec {
  kind: StopCfg["kind"];
  value: number;
  /** explicit swing buffer is never given by text */
  fromDefault?: boolean;
}

export type Item = Span &
  (
    | { kind: "cond"; node: SpecNode; filter?: boolean; /** conditions of a side: set by the sectioning */ side?: "long" | "short" | "both" }
    | { kind: "side"; side: "long" | "short" | "both"; only?: boolean }
    | { kind: "noSide"; side: "long" | "short" }
    | { kind: "stop"; stop: StopSpec | null }
    | { kind: "target"; r: number | null; none?: boolean }
    | { kind: "breakEven"; trigger: "r" | "pct"; value: number; to: "entry" | "net"; fromDefault?: boolean }
    | { kind: "trailing"; tkind: "atr" | "pct"; value: number; activateR: number; fromDefault?: boolean }
    | { kind: "partial"; atR: number; fracPct: number; fromDefault?: boolean }
    | { kind: "timeStop"; value: number; unit: "bars" | "hours" | "days" }
    | { kind: "opposite" }
    | { kind: "risk"; pct: number }
    | { kind: "market"; symbol: string }
    | { kind: "period"; period: StudioPeriod }
    | { kind: "tf"; tf: TfId }
  );

export interface UnclearDraft {
  a: number;
  b: number;
  why: string;
}

export interface AskDraft {
  id: string;
  text: string;
  options: AskOption[];
  blocking: boolean;
  span: Span | null;
}

export interface AssumeDraft {
  id: string;
  text: string;
  options: AskOption[];
  /** the option in force when the trader has not picked one */
  def: string | null;
}

export class Ctx {
  /** the working text: spans that were read are blanked */
  w: string;
  readonly items: Item[] = [];
  readonly unclear: UnclearDraft[] = [];
  readonly asks: AskDraft[] = [];
  readonly assumes: AssumeDraft[] = [];
  /** the text was longer than the limit and cut */
  truncated = false;

  constructor(
    readonly f: Folded,
    readonly src: string,
    readonly answers: Answers,
  ) {
    this.w = f.s;
  }

  get s(): string {
    return this.f.s;
  }

  /** Marks `[a, b)` as read. */
  consume(a: number, b: number): void {
    if (b <= a) return;
    this.w = this.w.slice(0, a) + this.w.slice(a, b).replace(/[^\n]/g, " ") + this.w.slice(b);
  }

  add(item: Item, consume = true): void {
    this.items.push(item);
    if (consume) this.consume(item.a, item.b);
  }

  /** Original span of a folded span. */
  span(a: number, b: number): TextSpan {
    return originalSpan(this.f, a, b);
  }

  phrase(a: number, b: number): string {
    const sp = this.span(a, b);
    return this.src.slice(sp.start, sp.end);
  }

  noteUnclear(a: number, b: number, why: string): void {
    if (this.unclear.some((u) => u.a === a && u.b === b && u.why === why)) return;
    this.unclear.push({ a, b, why });
    this.consume(a, b);
  }

  /** The option the trader picked for `id`, or `null`. */
  answer(id: string, allowed?: readonly string[]): string | null {
    const v = this.answers[id];
    if (typeof v !== "string") return null;
    return !allowed || allowed.includes(v) ? v : null;
  }

  ask(d: AskDraft): void {
    if (!this.asks.some((x) => x.id === d.id)) this.asks.push(d);
  }

  assume(d: AssumeDraft): void {
    if (!this.assumes.some((x) => x.id === d.id)) this.assumes.push(d);
  }
}

export const de = (v: number): string => String(Math.round(v * 10_000) / 10_000).replace(".", ",");
