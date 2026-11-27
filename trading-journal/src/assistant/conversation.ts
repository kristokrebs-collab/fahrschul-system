/**
 * The assistant's conversation and memory in memory (per tab). The conversation survives page changes and closing the
 * sheet (it lives in this module, not in the sheet), a reload starts a fresh one. The memory (`AssistantMemory`) is the
 * persistent part: it mirrors `settings.assistant`, changes are written back debounced (one settings save per burst).
 */
import { create } from "zustand";
import type { Reply } from "./engine";
import { EMPTY_MEMORY, memoryOf, withMemory, type AssistantMemory } from "./memory";
import { useJournal } from "@/store/journalStore";

export interface Entry {
  id: number;
  question: string;
  at: number;
  /** how the question was read (chips) */
  via: string[];
  replies: Reply[];
  /** only the newest entry types itself out */
  fresh: boolean;
  /** waiting for the optional server router */
  routing: boolean;
  /** question text of the last JOURNAL answer of this entry (follow-ups) */
  topic: string | null;
}

interface ConversationState {
  entries: Entry[];
  mem: AssistantMemory;
  hydrated: boolean;
  push(e: Omit<Entry, "id" | "fresh" | "at">): number;
  update(id: number, patch: Partial<Pick<Entry, "replies" | "via" | "routing">>): void;
  settle(id: number): void;
  clear(): void;
  hydrate(settings: object): void;
  setMem(fn: (m: AssistantMemory) => AssistantMemory): void;
}

export const ENTRIES_MAX = 20;
export const PERSIST_MS = 1500;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function persist(mem: AssistantMemory): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const s = useJournal.getState();
    void Promise.resolve(s.saveSettings(withMemory(s.settings, mem))).catch(() => undefined);
  }, PERSIST_MS);
}

export const useConversation = create<ConversationState>()((set, get) => ({
  entries: [],
  mem: EMPTY_MEMORY,
  hydrated: false,
  push: (e) => {
    const id = ++seq;
    const entries = [...get().entries.map((x) => (x.fresh ? { ...x, fresh: false } : x)), { ...e, id, at: Date.now(), fresh: true }].slice(-ENTRIES_MAX);
    set({ entries });
    return id;
  },
  update: (id, patch) => set({ entries: get().entries.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
  settle: (id) => set({ entries: get().entries.map((x) => (x.id === id && x.fresh ? { ...x, fresh: false } : x)) }),
  clear: () => set({ entries: [] }),
  hydrate: (settings) => {
    if (get().hydrated) return;
    set({ mem: memoryOf(settings), hydrated: true });
  },
  setMem: (fn) => {
    const next = fn(get().mem);
    if (next === get().mem) return;
    set({ mem: next });
    persist(next);
  },
}));

/** Tests: forget everything. */
export function resetConversationForTests(): void {
  clearTimeout(timer);
  useConversation.setState({ entries: [], mem: EMPTY_MEMORY, hydrated: false });
}
