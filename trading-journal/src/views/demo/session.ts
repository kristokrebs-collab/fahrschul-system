/**
 * The demo's own, isolated state (F58): one zustand store IN MEMORY, created for the demo and nothing else. It is never
 * persisted (no `storageKey`, no `localStorage`, no IndexedDB), never synced, never read by another part of the app and
 * emptied (`reset`) whenever the demo opens or closes. The demo imports neither the journal store nor the cloud: a test reads
 * the sources of `src/views/demo` and `src/domain/demo` and fails if one of them does.
 */
import { create } from "zustand";
import type { DemoRun } from "@/domain/demo/backtest";
import { DEMO_IDEAS, DEFAULT_KIT, type Kit } from "@/domain/demo/ideas";
import { DEFAULT_PAPER, type PaperPlan } from "@/domain/demo/paper";
import { defaultAlarm, type AlarmSetup } from "@/domain/demo/alarm";
import type { Answers } from "@/domain/strategytext";

export const STEP_IDS = ["import", "regeln", "test", "konto", "alarm"] as const;
export type StepId = (typeof STEP_IDS)[number];

export interface DemoSession {
  step: StepId;
  // 1 Import
  rawOpen: boolean;
  importStage: "file" | "preview" | "trades";
  // 2 Regelentwurf
  ideaMode: "words" | "kit";
  text: string;
  answers: Answers;
  kit: Kit;
  // 3 Test: the result and the key of the rules it belongs to (a change makes the figures stale)
  testKey: string | null;
  run: DemoRun | null;
  testBusy: boolean;
  // 4 Demokonto
  paper: PaperPlan;
  /** `null` = not opened yet, else the revealed candles after the decision */
  paperShown: number | null;
  // 5 Alarm
  alarm: AlarmSetup;
  alarmAt: number;
}

export const initialSession = (): DemoSession => ({
  step: "import",
  rawOpen: false,
  importStage: "file",
  ideaMode: "words",
  text: DEMO_IDEAS[0]!.text,
  answers: {},
  kit: DEFAULT_KIT,
  testKey: null,
  run: null,
  testBusy: false,
  paper: DEFAULT_PAPER,
  paperShown: null,
  alarm: defaultAlarm(),
  alarmAt: 0,
});

export const useSession = create<DemoSession>()(() => initialSession());

export const patch = (p: Partial<DemoSession>): void => useSession.setState(p);
export const resetSession = (): void => useSession.setState(initialSession(), true);
