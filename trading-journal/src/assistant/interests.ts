/**
 * What the assistant learned about the trader's interests (the topic counters of `AssistantMemory.interests`), made visible
 * and deletable in the memory panel: one topic at a time or all of them. Kept out of `memory.ts` on purpose – that file is
 * read by the first-load code (Funktionen page), this one only by the assistant's sheet.
 *
 * Only questions the trader asked are counted (`learnInterest`); nothing is inferred from trades. Deleting a counter forgets
 * the topic – asking about it again starts the count anew.
 */
import type { AssistantMemory } from "./memory";

/** Forgets what the trader asked about one topic. */
export function removeInterest(mem: AssistantMemory, key: string): AssistantMemory {
  if (!(key in mem.interests)) return mem;
  const { [key]: _gone, ...rest } = mem.interests;
  void _gone;
  return { ...mem, interests: rest };
}

/** Forgets every topic counter (facts, style and the voice flag stay). */
export const forgetInterests = (mem: AssistantMemory): AssistantMemory => (Object.keys(mem.interests).length ? { ...mem, interests: {} } : mem);

/** Every learned topic, the most asked first (ties by key). */
export const interestsOf = (mem: AssistantMemory): Array<[topic: string, count: number]> => Object.entries(mem.interests).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
