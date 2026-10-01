import { createContext, useContext, useSyncExternalStore } from "react";

/**
 * Intro phases:
 * - "off":   no intro this session (already seen, skipped, reduced motion, disabled) — render everything at once
 * - "stage": full-screen overlay sequence runs above the app; the app is mounted but covered
 * - "build": the journal assembles itself (cards fly from the deck into their slots, header/dock enter)
 * - "done":  settled after a played intro
 */
export type IntroPhase = "off" | "stage" | "build" | "done";

type Listener = () => void;
const listeners = new Set<Listener>();
let phase: IntroPhase = "off";

export function getIntroPhase(): IntroPhase {
  return phase;
}

export function setIntroPhase(next: IntroPhase): void {
  if (next === phase) return;
  phase = next;
  for (const l of listeners) l();
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export function useIntroPhase(): IntroPhase {
  return useSyncExternalStore(subscribe, getIntroPhase, getIntroPhase);
}

/** true once nothing intro-related holds the UI back ("off" or "done"). */
export function useIntroSettled(): boolean {
  const p = useIntroPhase();
  return p === "off" || p === "done";
}

type Command = "replay" | "skip";
const commandListeners = new Set<(c: Command) => void>();

/** Header logo click etc.: plays the intro again (IntroHost decides whether it may, e.g. not under reduced motion). */
export function replayIntro(): void {
  for (const l of commandListeners) l("replay");
}

export function skipIntro(): void {
  for (const l of commandListeners) l("skip");
}

export function onIntroCommand(l: (c: Command) => void): () => void {
  commandListeners.add(l);
  return () => void commandListeners.delete(l);
}

/** false while the surrounding intro cell has not landed yet; first-view effects inside it wait for true. */
export const IntroLandContext = createContext(true);

export function useIntroLanded(): boolean {
  return useContext(IntroLandContext);
}
