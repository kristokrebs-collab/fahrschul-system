/**
 * State machine of the connection placeholder and of the guided dialog (Paket Verbindungen). PURE.
 *
 * Placeholder (`ConnectSlot`): one state from the facts we know. Order matters – what the operator has not set up wins
 * over everything (nothing the user does can fix it), then "sign in first", then a running connect, an error, the
 * connected state, and only then the plan.
 *
 * Dialog (`wizardReducer`): the steps of a guided connection with a check at the end. A check can end in success, a
 * plain failure (go back and fix) or a question (`confirm`: the rights check found something the user may accept).
 */

export type SlotState = "unconfigured" | "signin" | "connecting" | "error" | "connected" | "upgrade" | "disconnected";

export interface SlotFacts {
  /** The operator set the service up (`false`), or it is known to work (`true`); `null` = not known yet (loading). */
  configured: boolean | null;
  /** The service needs a signed-in account (cloud) and there is none. */
  needsSignIn: boolean;
  /** A connect / first import is running right now. */
  busy: boolean;
  /** Plain-language problem with an existing connection (`invalid` key, failed delivery …). */
  error: string | null;
  connected: boolean;
  /** The plan allows the connection (always true while nothing is gated). */
  entitled: boolean;
}

export const OFFLINE_FACTS: SlotFacts = { configured: null, needsSignIn: false, busy: false, error: null, connected: false, entitled: true };

export function slotState(f: SlotFacts): SlotState {
  if (f.configured === false) return "unconfigured";
  if (f.needsSignIn) return "signin";
  if (f.busy) return "connecting";
  if (f.error) return "error";
  if (f.connected) return "connected";
  if (!f.entitled) return "upgrade";
  return "disconnected";
}

/** Status word on the placeholder. */
export const SLOT_LABEL: Readonly<Record<SlotState, string>> = {
  unconfigured: "Nicht eingerichtet",
  signin: "Anmeldung nötig",
  connecting: "Verbindet …",
  error: "Fehler",
  connected: "Verbunden",
  upgrade: "Im höheren Tarif",
  disconnected: "Nicht verbunden",
};

/** Verb of the click target, per state. */
export const SLOT_ACTION: Readonly<Record<SlotState, string>> = {
  unconfigured: "Mehr erfahren",
  signin: "Anmelden",
  connecting: "Ansehen",
  error: "Beheben",
  connected: "Verwalten",
  upgrade: "Tarif ansehen",
  disconnected: "Verbinden",
};

/** Tone for the dot: green = works, red = needs you, amber = waiting / plan, grey = idle. */
export type SlotTone = "win" | "loss" | "warn" | "mute";
export const SLOT_TONE: Readonly<Record<SlotState, SlotTone>> = {
  unconfigured: "mute",
  signin: "warn",
  connecting: "warn",
  error: "loss",
  connected: "win",
  upgrade: "warn",
  disconnected: "mute",
};

/* ------------------------------------------------------------------ dialog */

export type WizardPhase = "step" | "checking" | "confirm" | "failed" | "done";

export interface WizardState {
  /** Index of the current step (0-based). */
  step: number;
  /** Number of steps; the LAST one is the check/result step. */
  steps: number;
  phase: WizardPhase;
  /** Plain-language problem, with the next step in the text. */
  error: string | null;
  /** Findings the user may accept (rights check warnings). */
  warnings: string[];
  /** The user accepted the warnings. */
  accepted: boolean;
  /** The last step is a CHECK that only `submit` enters (connect flows); `false`: plain steps, `next` walks to the end. */
  check: boolean;
}

export type WizardEvent =
  | { type: "next" }
  | { type: "back" }
  | { type: "submit" }
  | { type: "ok" }
  | { type: "fail"; message: string }
  | { type: "ask"; warnings: string[] }
  | { type: "accept" }
  | { type: "reset" };

export const wizardStart = (steps: number, check = true): WizardState => ({ step: 0, steps, phase: "step", error: null, warnings: [], accepted: false, check });

export function wizardReducer(s: WizardState, e: WizardEvent): WizardState {
  const last = s.steps - 1;
  switch (e.type) {
    case "next":
      // with a check step, that step is entered only by `submit`
      return s.phase === "step" && s.step < (s.check ? last - 1 : last) ? { ...s, step: s.step + 1, error: null } : s;
    case "back":
      if (s.phase === "checking") return s;
      if (s.phase === "done") return s;
      if (s.phase === "failed" || s.phase === "confirm") return { ...s, step: Math.max(0, last - 1), phase: "step", warnings: [], accepted: false };
      return s.step > 0 ? { ...s, step: s.step - 1, error: null } : s;
    case "submit":
      // only from the step before the check; a second click while checking is ignored (no double connect)
      if (canResubmit(s)) return { ...s, phase: "checking", error: null };
      return s.check && s.phase === "step" && s.step === last - 1 ? { ...s, step: last, phase: "checking", error: null } : s;
    case "ok":
      return s.phase === "checking" ? { ...s, phase: "done", error: null, warnings: [], accepted: false } : s;
    case "fail":
      return s.phase === "checking" ? { ...s, phase: "failed", error: e.message } : s;
    case "ask":
      return s.phase === "checking" ? { ...s, phase: "confirm", warnings: e.warnings, error: null } : s;
    case "accept":
      return s.phase === "confirm" ? { ...s, accepted: true } : s;
    case "reset":
      return wizardStart(s.steps, s.check);
  }
}

/** The confirm phase may be sent again only after the user accepted. */
export const canResubmit = (s: WizardState): boolean => s.phase === "confirm" && s.accepted;
