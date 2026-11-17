/**
 * Setup wizard state (Paket B, Launch-Auftrag Abschnitt 2): at most FOUR short steps – Konto → Demo oder eigene Daten → optional
 * Verbindung → erster Trade / erste Analyse. Progress is stored (`storageKey("setup-wizard")`), every step except the first
 * decision can be skipped, the whole thing runs ONCE and never again on its own.
 *
 * Statuses of the stored record:
 *   `pending`  armed by a fresh REGISTRATION (never by a plain login): waiting for the first quiet moment – the host opens it once
 *   `active`   it was opened and left half-way (closed, "Später"): it stays closed on every reload; "Einrichtung fortsetzen"
 *              in the settings card resumes at the stored step
 *   `done` / `skipped`  finished or declined: never starts again on its own (the settings card can start it by hand)
 *
 * Nothing is stored for a visitor who never registered and never opened it; an existing trader (a journal with trades) is marked
 * `skipped` the moment the decision looks at them. Pure state + decision; the sheet is `SetupWizard.tsx`, the trigger `WizardHost.tsx`.
 */
import { create } from "zustand";
import { storageKey } from "@/store/storage";

export const WIZARD_KEY = storageKey("setup-wizard");
export const WIZARD_VERSION = 1;
export const WIZARD_STEPS = ["konto", "daten", "verbindung", "start"] as const;
export type WizardStepId = (typeof WIZARD_STEPS)[number];
export const WIZARD_COUNT = WIZARD_STEPS.length;

export type WizardStatus = "pending" | "active" | "done" | "skipped";
export type WizardData = "demo" | "own" | null;

export interface StoredWizard {
  v: number;
  status: WizardStatus;
  /** 0-based index into `WIZARD_STEPS` – where "fortsetzen" lands. */
  step: number;
  /** The decision of step 2 (`null` until made). */
  data: WizardData;
  at: string;
}

const clampStep = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(WIZARD_COUNT - 1, Math.round(n))) : 0);

export function readWizard(): StoredWizard | null {
  try {
    const raw = JSON.parse(localStorage.getItem(WIZARD_KEY) ?? "null") as Partial<StoredWizard> | null;
    if (!raw || (raw.status !== "pending" && raw.status !== "active" && raw.status !== "done" && raw.status !== "skipped")) return null;
    return { v: WIZARD_VERSION, status: raw.status, step: clampStep(raw.step), data: raw.data === "demo" || raw.data === "own" ? raw.data : null, at: typeof raw.at === "string" ? raw.at : "" };
  } catch {
    return null;
  }
}

function write(patch: Partial<Pick<StoredWizard, "status" | "step" | "data">>): StoredWizard {
  const cur = readWizard() ?? { v: WIZARD_VERSION, status: "pending" as WizardStatus, step: 0, data: null as WizardData, at: "" };
  const next: StoredWizard = { ...cur, ...patch, v: WIZARD_VERSION, at: new Date().toISOString() };
  try {
    localStorage.setItem(WIZARD_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: the wizard then may come up again – harmless, it is skippable
  }
  return next;
}

interface WizardState {
  open: boolean;
  step: number;
  data: WizardData;
  /** the sheet's chunk was requested once (it stays mounted for its close animation) */
  loaded: boolean;
}

export const useWizard = create<WizardState>(() => ({ open: false, step: 0, data: null, loaded: false }));

/** A fresh registration arms the wizard – only when nothing is stored yet (a person who finished or declined it is not asked again). */
export function armWizard(): void {
  if (!readWizard()) write({ status: "pending", step: 0, data: null });
}

/** Opens the wizard: at the stored step when it was left half-way (`resume`), else at the first. */
export function openWizard(resume = true): void {
  const s = readWizard();
  const step = resume && s && s.status === "active" ? s.step : 0;
  write({ status: "active", step, data: s?.data ?? null });
  useWizard.setState({ open: true, step, data: s?.data ?? null, loaded: true });
}

export function goToWizardStep(step: number): void {
  const n = clampStep(step);
  write({ status: "active", step: n });
  useWizard.setState({ step: n });
}

export function chooseWizardData(data: Exclude<WizardData, null>): void {
  write({ data });
  useWizard.setState({ data });
}

/** Closes it and keeps the progress ("Später fortsetzen"): it never reopens by itself. */
export function pauseWizard(): void {
  write({ status: "active", step: useWizard.getState().step });
  useWizard.setState({ open: false });
}

export function finishWizard(): void {
  write({ status: "done" });
  useWizard.setState({ open: false });
}

export function skipWizard(): void {
  // a run that was already finished keeps `done`
  if (readWizard()?.status !== "done") write({ status: "skipped" });
  useWizard.setState({ open: false });
}

export interface WizardDecisionInput {
  stored: StoredWizard | null;
  signedIn: boolean;
  journalLoaded: boolean;
  tradeCount: number;
  introSettled: boolean;
  /** Another dialog or flow owns the screen (login sheet, takeover question, order, editor, share link …) – wait. */
  busy: boolean;
}

/** Pure: open the wizard now, wait for a quieter moment, or never (nothing armed / already handled / an existing trader). */
export function wizardDecision(i: WizardDecisionInput): "open" | "wait" | "never" | "existing" {
  if (!i.stored || i.stored.status !== "pending") return "never";
  if (!i.signedIn || !i.journalLoaded) return "wait";
  if (i.tradeCount > 0) return "existing"; // a journal with trades does not need a first-trade wizard
  if (!i.introSettled || i.busy) return "wait";
  return "open";
}

/** Marks an existing trader so the wizard never interrupts them. */
export function markWizardExisting(): void {
  if (readWizard()?.status === "pending") write({ status: "skipped" });
}

/**
 * Real progress (Paket P, docs/PSYCHOLOGIE.md): how many of the four steps the person has been through – counted from where the
 * stored step stands, never padded ("3 von 4" means three steps are behind them). A finished wizard is all four; a declined or not
 * yet started one is none. Pure.
 */
export function wizardProgress(s: StoredWizard | null): { done: number; total: number } {
  if (!s) return { done: 0, total: WIZARD_COUNT };
  if (s.status === "done") return { done: WIZARD_COUNT, total: WIZARD_COUNT };
  if (s.status === "active") return { done: Math.max(0, Math.min(WIZARD_COUNT - 1, s.step)), total: WIZARD_COUNT };
  return { done: 0, total: WIZARD_COUNT };
}

/** The line of the settings card: where the wizard stands. */
export function wizardStatusText(s: StoredWizard | null): string {
  if (!s) return "Noch nicht gestartet.";
  if (s.status === "done") return `Alle ${WIZARD_COUNT} Schritte erledigt.`;
  if (s.status === "skipped") return "Übersprungen – du kannst sie jederzeit öffnen.";
  if (s.status === "active") {
    const { done } = wizardProgress(s);
    return `Begonnen – ${done} von ${WIZARD_COUNT} Schritten durchgegangen, als Nächstes: ${WIZARD_STEP_LABELS[s.step] ?? ""}.`;
  }
  return "Bereit – startet nach der Registrierung.";
}

/** Short names of the four steps (the rail of the sheet and the status line of the settings card). */
export const WIZARD_STEP_LABELS = ["Konto", "Daten", "Verbindung", "Start"] as const;
