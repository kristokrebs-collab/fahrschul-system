/**
 * Onboarding state (P13). Persisted once the tour ends (`storageKey("onboarding")` = `{ status, at, v }`):
 *   - `done`    the trader went through it (or held "Halten zum Starten"),
 *   - `skipped` closed early – never starts on its own again,
 *   - `seen`    the journal already had trades when the tour would have started: an existing trader, no auto start.
 * It starts by itself only on a genuinely first run (nothing stored, journal loaded and empty, intro finished) and can
 * always be started again (settings, search command, shortcut sheet) with `startOnboarding()`.
 */
import { create } from "zustand";
import { storageKey } from "@/store/storage";

export const ONBOARDING_KEY = storageKey("onboarding");
export const ONBOARDING_VERSION = 1;

export type OnboardingStatus = "done" | "skipped" | "seen";

export interface StoredOnboarding {
  status: OnboardingStatus;
  at: string;
  v: number;
}

export const STEP_IDS = ["start", "konten", "setups", "boerse", "mehr", "ziel"] as const;
export type StepId = (typeof STEP_IDS)[number];
export const STEP_COUNT = STEP_IDS.length;

export function readOnboarding(): StoredOnboarding | null {
  try {
    const raw = JSON.parse(localStorage.getItem(ONBOARDING_KEY) ?? "null") as Partial<StoredOnboarding> | null;
    if (!raw || (raw.status !== "done" && raw.status !== "skipped" && raw.status !== "seen")) return null;
    return { status: raw.status, at: typeof raw.at === "string" ? raw.at : "", v: typeof raw.v === "number" ? raw.v : ONBOARDING_VERSION };
  } catch {
    return null;
  }
}

function writeOnboarding(status: OnboardingStatus): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ status, at: new Date().toISOString(), v: ONBOARDING_VERSION } satisfies StoredOnboarding));
  } catch {
    // storage blocked: the tour may show again next time – harmless
  }
}

interface OnboardingState {
  open: boolean;
  step: number;
  /** `manual` = started from settings / search (no auto-start bookkeeping) */
  source: "auto" | "manual";
  /** the tour stepped aside for another dialog (the setup editor) and comes back when it closes */
  paused: boolean;
  /** the tour chunk was requested once (stays mounted for its close animation) */
  loaded: boolean;
}

export const useOnboarding = create<OnboardingState>(() => ({ open: false, step: 0, source: "manual", paused: false, loaded: false }));

export function startOnboarding(source: "auto" | "manual" = "manual"): void {
  useOnboarding.setState({ open: true, step: 0, source, paused: false, loaded: true });
}

/** Steps aside (the sheet closes, the step is kept) – `resumeOnboarding()` brings it back. */
export function pauseOnboarding(): void {
  if (useOnboarding.getState().open) useOnboarding.setState({ open: false, paused: true });
}

export function resumeOnboarding(): void {
  if (useOnboarding.getState().paused) useOnboarding.setState({ open: true, paused: false });
}

export function goToStep(step: number): void {
  useOnboarding.setState({ step: Math.max(0, Math.min(STEP_COUNT - 1, step)) });
}

export function finishOnboarding(): void {
  writeOnboarding("done");
  useOnboarding.setState({ open: false, paused: false });
}

export function skipOnboarding(): void {
  // a manual re-run that is closed early keeps an earlier `done`
  if (readOnboarding()?.status !== "done") writeOnboarding("skipped");
  useOnboarding.setState({ open: false, paused: false });
}

/** Marks an existing trader (journal had trades) so the tour never interrupts them. */
export function markSeen(): void {
  if (!readOnboarding()) writeOnboarding("seen");
}

export interface AutoStartInput {
  stored: StoredOnboarding | null;
  loaded: boolean;
  tradeCount: number;
  introSettled: boolean;
  /** another dialog is open (editor, detail, command nav) – wait */
  busy: boolean;
}

/** Pure: `start` the tour, mark the trader as `seen`, or `wait`. */
export function autoStartDecision(i: AutoStartInput): "start" | "seen" | "wait" | "never" {
  if (i.stored) return "never";
  if (!i.loaded) return "wait";
  if (i.tradeCount > 0) return "seen";
  if (!i.introSettled || i.busy) return "wait";
  return "start";
}
