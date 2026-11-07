/**
 * Coach UI state (P04, per tab, in memory): the chat (question + the computed answer, optional AI wording), the last
 * live alert of the watcher (the Heute card fires a red BorderBeam lap for a severe one) and the timeline filter.
 * Nothing here is journal data – the journal stays the single source; a reload simply starts a fresh chat.
 */
import { create } from "zustand";
import type { CoachAlert } from "@/domain/coach";
import type { Answer } from "@/domain/coach/nlq";

export type AiState = { status: "idle" } | { status: "loading" } | { status: "done"; text: string; model: string } | { status: "kept"; reason: string } | { status: "error"; message: string };

export interface ChatEntry {
  id: number;
  question: string;
  answer: Answer;
  at: number;
  /** answers from earlier in the session render at once, only the newest one types itself out */
  fresh: boolean;
  ai: AiState;
}

export interface LiveAlert extends CoachAlert {
  at: number;
  /** bumps the BorderBeam lap */
  seq: number;
}

interface CoachUiState {
  chat: ChatEntry[];
  alert: LiveAlert | null;
  timelineKey: string;
  ask(question: string, answer: Answer): number;
  setAi(id: number, ai: AiState): void;
  settle(id: number): void;
  clearChat(): void;
  pushAlert(a: CoachAlert, at: number): void;
  dismissAlert(): void;
  setTimelineKey(k: string): void;
}

/** Answers kept in the chat (oldest dropped). */
export const CHAT_MAX = 12;
let seq = 0;

export const useCoachUi = create<CoachUiState>()((set, get) => ({
  chat: [],
  alert: null,
  timelineKey: "all",
  ask: (question, answer) => {
    const id = ++seq;
    const chat = [...get().chat.map((c) => (c.fresh ? { ...c, fresh: false } : c)), { id, question, answer, at: Date.now(), fresh: true, ai: { status: "idle" } as AiState }].slice(-CHAT_MAX);
    set({ chat });
    return id;
  },
  setAi: (id, ai) => set({ chat: get().chat.map((c) => (c.id === id ? { ...c, ai } : c)) }),
  settle: (id) => set({ chat: get().chat.map((c) => (c.id === id && c.fresh ? { ...c, fresh: false } : c)) }),
  clearChat: () => set({ chat: [] }),
  pushAlert: (a, at) => set({ alert: { ...a, at, seq: (get().alert?.seq ?? 0) + 1 } }),
  dismissAlert: () => set({ alert: null }),
  setTimelineKey: (timelineKey) => set({ timelineKey }),
}));
