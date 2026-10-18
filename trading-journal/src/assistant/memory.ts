/**
 * What the assistant learns about its user (F74), kept in the passthrough key `settings.assistant` – like
 * `settings.coach` it survives `normalizeSettings`, the backup and the cloud `merge3`, and every writer returns a NEW
 * settings object with all other keys untouched.
 *
 *   style       how long the answers should be: `kurz` (the sentence and two numbers), `normal`, `detail` (everything)
 *   interests   how often each topic was asked ("setup", "weekday", "behavior:revenge", "lab", …) – orders the
 *               suggestion chips and the "für dich" line; counts only, never the questions themselves
 *   facts       what the trader told the assistant to remember ("merk dir: …") – visible, editable, deletable
 *   voice       read answers aloud (`speak`) – off by default
 *
 * Nothing here is inferred from trades or psychology: the assistant only learns what the user does with IT (what they
 * ask, how long they want answers, what they ask it to remember).
 */
import type { Settings } from "@/domain/types";

export type AnswerStyle = "kurz" | "normal" | "detail";

export interface MemoryFact {
  id: string;
  text: string;
  /** ms */
  at: number;
}

export interface AssistantMemory {
  v: 1;
  style: AnswerStyle;
  interests: Record<string, number>;
  facts: MemoryFact[];
  voice: { speak: boolean };
  /** questions asked in total (greeting differs for a first-time user) */
  asked: number;
}

export const FACT_MAX = 30;
export const FACT_LEN = 200;
export const INTEREST_MAX = 40;

export const EMPTY_MEMORY: AssistantMemory = { v: 1, style: "normal", interests: {}, facts: [], voice: { speak: false }, asked: 0 };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The stored memory of `settings` (sanitised; a broken key reads as the defaults). */
export function memoryOf(settings: object): AssistantMemory {
  const a = obj((settings as { assistant?: unknown }).assistant);
  const style: AnswerStyle = a.style === "kurz" || a.style === "detail" ? a.style : "normal";
  const interests: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(a.interests)).slice(0, 200)) if (k.length <= 40 && typeof v === "number" && Number.isFinite(v) && v > 0) interests[k] = Math.min(100_000, Math.floor(v));
  const facts = (Array.isArray(a.facts) ? a.facts : [])
    .map((f): MemoryFact | null => {
      const o = obj(f);
      return typeof o.id === "string" && typeof o.text === "string" && o.text.trim() ? { id: o.id.slice(0, 40), text: o.text.trim().slice(0, FACT_LEN), at: typeof o.at === "number" ? o.at : 0 } : null;
    })
    .filter((f): f is MemoryFact => f !== null)
    .slice(0, FACT_MAX);
  const asked = typeof a.asked === "number" && Number.isFinite(a.asked) && a.asked > 0 ? Math.floor(a.asked) : 0;
  return { v: 1, style, interests, facts, voice: { speak: obj(a.voice).speak === true }, asked };
}

/** `settings` with `mem` stored under `assistant` (all other keys untouched). */
export function withMemory(settings: Settings, mem: AssistantMemory): Settings {
  return { ...(settings as Settings & { assistant?: unknown }), assistant: mem } as Settings;
}

/** Counts one question of `topic` (the least asked topics fall out beyond `INTEREST_MAX`). */
export function learnInterest(mem: AssistantMemory, topic: string): AssistantMemory {
  const interests = { ...mem.interests, [topic]: (mem.interests[topic] ?? 0) + 1 };
  const keys = Object.keys(interests);
  if (keys.length > INTEREST_MAX) {
    const drop = keys.sort((a, b) => interests[a]! - interests[b]!)[0]!;
    if (drop !== topic) delete interests[drop];
  }
  return { ...mem, interests, asked: mem.asked + 1 };
}

/** Adds a remembered fact (duplicates by text are ignored; the oldest falls out beyond `FACT_MAX`). */
export function addFact(mem: AssistantMemory, text: string, now: number): AssistantMemory {
  const t = text.trim().replace(/\s+/g, " ").slice(0, FACT_LEN);
  if (!t || mem.facts.some((f) => f.text.toLowerCase() === t.toLowerCase())) return mem;
  return { ...mem, facts: [...mem.facts, { id: `f${now.toString(36)}${mem.facts.length}`, text: t, at: now }].slice(-FACT_MAX) };
}

export const removeFact = (mem: AssistantMemory, id: string): AssistantMemory => ({ ...mem, facts: mem.facts.filter((f) => f.id !== id) });
export const setStyle = (mem: AssistantMemory, style: AnswerStyle): AssistantMemory => (mem.style === style ? mem : { ...mem, style });
export const setSpeak = (mem: AssistantMemory, speak: boolean): AssistantMemory => (mem.voice.speak === speak ? mem : { ...mem, voice: { speak } });
export const forgetAll = (): AssistantMemory => ({ ...EMPTY_MEMORY });

/** The topics asked most, most often first (ties by name). */
export function topInterests(mem: AssistantMemory, k = 3): string[] {
  return Object.entries(mem.interests)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, k)
    .map(([key]) => key);
}

/** Reorders `items` so that those of the most asked topics come first (stable; `topicOf` maps an item to its topic). */
export function byInterest<T>(mem: AssistantMemory, items: readonly T[], topicOf: (item: T) => string | null): T[] {
  const score = (x: T): number => {
    const t = topicOf(x);
    return t ? (mem.interests[t] ?? 0) : 0;
  };
  return items.map((x, i) => ({ x, i, s: score(x) })).sort((a, b) => b.s - a.s || a.i - b.i).map((e) => e.x);
}
