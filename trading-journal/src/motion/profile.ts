/**
 * The reader's motion setting (Runde 11, A5): `system` | `reduced` | `full`, stored per device under `tj2-motion` as
 * `{ v: 1, mode }` (versioned: an unknown version or a damaged value reads as `system`, nothing is thrown away or rewritten).
 *
 *   system    follows the device (`prefers-reduced-motion`) – the default
 *   reduced   everything is simply there, whatever the device says
 *   full      the full profile of the plan, also when the device asks for less (GitHub-style "disabled": an explicit choice in the app,
 *             said so in the card); purely decorative effects that only a stylesheet gates (`@media (prefers-reduced-motion)`) keep following the device
 *
 * `useReducedFx` reads it with the device flag; `applyMotionMode` writes `html[data-motion]` so the stylesheets can follow
 * (`base.css`: `reduced` zeroes transitions like the device flag does; `full` lifts the blanket rule). Pure helpers first.
 */
import { create } from "zustand";
import { readJson, storageKey, writeJson } from "@/store/storage";

export const MOTION_MODES = ["system", "reduced", "full"] as const;
export type MotionMode = (typeof MOTION_MODES)[number];
export const MOTION_VERSION = 1;
export const MOTION_KEY: string = storageKey("motion");

export const MOTION_STRINGS = {
  title: "Bewegung",
  lead: "Wie viel sich in der Oberfläche bewegt. Gilt nur für dieses Gerät.",
  modes: { system: "Wie das Gerät", reduced: "Reduziert", full: "Volles Profil" },
  hints: {
    system: "Folgt der Einstellung „Bewegung reduzieren“ deines Geräts.",
    reduced: "Alles ist sofort da, nichts gleitet oder zeichnet sich.",
    full: "Alle Bewegungen deines Tarifs, auch wenn dein Gerät weniger Bewegung wünscht.",
  },
  preview: "Vorschau",
  previewing: "Läuft …",
  logo: "Logo-Animation abspielen",
  radioGroup: "Bewegung",
} as const;

/** Pure: the stored value → a mode (anything unknown is `system`). */
export function parseMotion(raw: unknown): MotionMode {
  if (!raw || typeof raw !== "object") return "system";
  const o = raw as { v?: unknown; mode?: unknown };
  if (o.v !== MOTION_VERSION) return "system";
  return (MOTION_MODES as readonly unknown[]).includes(o.mode) ? (o.mode as MotionMode) : "system";
}

/** Pure: is motion reduced? `reduced` always, `full` never, `system` as the device says. */
export function motionReduced(mode: MotionMode, device: boolean): boolean {
  return mode === "reduced" || (mode === "system" && device);
}

interface MotionPrefState {
  mode: MotionMode;
  setMode(mode: MotionMode): void;
}

export const useMotionPref = create<MotionPrefState>()((set) => ({
  mode: parseMotion(readJson<unknown>(MOTION_KEY, null)),
  setMode: (mode) => {
    if (!(MOTION_MODES as readonly string[]).includes(mode)) return;
    writeJson(MOTION_KEY, { v: MOTION_VERSION, mode });
    set({ mode });
    applyMotionMode(mode);
  },
}));

/** Writes `html[data-motion]` (`reduced` / `full`; `system` removes it) – the stylesheets' side of the setting. */
export function applyMotionMode(mode: MotionMode): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (mode === "system") el.removeAttribute("data-motion");
  else el.setAttribute("data-motion", mode);
}

/** The current mode without a hook (event handlers, timers). */
export const motionMode = (): MotionMode => useMotionPref.getState().mode;

applyMotionMode(useMotionPref.getState().mode);
