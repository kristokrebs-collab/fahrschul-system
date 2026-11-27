/**
 * Glas-Look (Runde 14): ONE switch for every glass surface of the app – the unfolding windows (`.glass-panel`, shell-motion.css) and the
 * lenses, light edges and beads of Runde 13 (`.glass`, `.gl-float`, `.lg` …).
 *
 * Contract: `html[data-glass="on" | "off"]`, set before the first paint (`@/app/pwa` on import) and whenever the setting changes.
 * Every glass rule is written under `html[data-glass="on"]`; "off" is the flat look the app had before (opaque planes).
 *
 * The choice is `settings.glass` ("on" | "off", absent = "on") – part of the settings blob, so it travels with the cloud sync, the
 * backup and the import like every other setting. A small mirror in localStorage (`storageKey("glass")`) lets the boot read it without
 * parsing the settings. The EFFECTIVE state is "off" without anyone's doing where glass cannot be shown well or was declined by the
 * system: the safe effects (`data-safe-fx`, Samsung Internet), `prefers-reduced-transparency`, `prefers-contrast: more`,
 * `forced-colors`, or a browser without `backdrop-filter`.
 */
import { useSyncExternalStore } from "react";
import type { Settings } from "@/domain/types";
import { SAFE_FX_ATTR } from "@/motion/safeFx";
import { storageKey } from "@/store/storage";

export const GLASS_ATTR = "data-glass";
export const GLASS_KEY = storageKey("glass");
export type GlassPref = "on" | "off";
export const GLASS_PREFS: readonly GlassPref[] = ["on", "off"];
/** The system conditions under which glass is switched off without the reader's doing. */
export const GLASS_BLOCK_QUERIES = ["(prefers-reduced-transparency: reduce)", "(prefers-contrast: more)", "(forced-colors: active)"] as const;

export const GLASS_STRINGS = {
  title: "Glas-Look",
  group: "Glas-Look wählen",
  modes: { on: "Glas", off: "Flach" } as Record<GlassPref, string>,
  hint: "Glas: Fenster, Menü und Knöpfe aus Milchglas. Flach: deckende Flächen wie bisher.",
  auto: "Samsung Internet und die Systemeinstellungen „Transparenz reduzieren“ oder „Kontrast erhöhen“ schalten das Glas automatisch aus.",
  blocked: "Auf diesem Gerät ist das Glas gerade automatisch aus (Browser oder Systemeinstellung).",
} as const;

/** Pure: the stored choice – only an explicit "off" switches the glass off (absent, damaged or unknown values read as "on"). */
export function parseGlass(v: unknown): GlassPref {
  return v === "off" ? "off" : "on";
}

/** Pure: the choice in the settings blob (`settings.glass`). */
export function glassOfSettings(s: Pick<Settings, "glass"> | null | undefined): GlassPref {
  return parseGlass(s?.glass);
}

/** Pure: the settings with the choice written (the default "on" is stored explicitly too, so another device follows it). */
export function withGlass<T extends object>(settings: T, pref: GlassPref): T & { glass: GlassPref } {
  return { ...settings, glass: pref };
}

/** Pure: what is shown – "off" wins whenever glass is blocked. */
export function effectiveGlass(pref: GlassPref, blocked: boolean): GlassPref {
  return blocked ? "off" : pref;
}

const hasDom = typeof document !== "undefined";

/** Whether this browser / system setting rules glass out right now. */
export function glassBlocked(): boolean {
  if (!hasDom) return false;
  if (document.documentElement.hasAttribute(SAFE_FX_ATTR)) return true;
  if (typeof window.matchMedia === "function" && GLASS_BLOCK_QUERIES.some((q) => window.matchMedia(q).matches)) return true;
  const sup = typeof CSS !== "undefined" && typeof CSS.supports === "function" ? CSS.supports.bind(CSS) : null;
  return sup ? !(sup("backdrop-filter", "blur(1px)") || sup("-webkit-backdrop-filter", "blur(1px)")) : false;
}

/** The mirrored choice of this device (blocked or damaged storage reads as "on"). */
export function readGlassPref(): GlassPref {
  try {
    return parseGlass(localStorage.getItem(GLASS_KEY));
  } catch {
    return "on";
  }
}

const listeners = new Set<() => void>();
let current: GlassPref = "on";

/**
 * Applies a choice: remembers it for the next boot and writes `data-glass` with the effective state. Returns the effective state.
 * `persist: false` only re-evaluates (a system setting changed, the safe effects were toggled).
 */
export function applyGlass(pref: GlassPref = current, persist = true): GlassPref {
  current = pref;
  const shown = effectiveGlass(pref, glassBlocked());
  if (!hasDom) return shown;
  if (persist) {
    try {
      localStorage.setItem(GLASS_KEY, pref);
    } catch {
      /* private mode: the attribute still follows the settings in this session */
    }
  }
  if (document.documentElement.getAttribute(GLASS_ATTR) !== shown) {
    document.documentElement.setAttribute(GLASS_ATTR, shown);
    listeners.forEach((l) => l());
  }
  return shown;
}

/** Boot: the mirrored choice, and the system conditions watched from now on. Idempotent. */
let watching = false;
export function bootGlass(): GlassPref {
  const shown = applyGlass(readGlassPref(), false);
  if (hasDom && !watching && typeof window.matchMedia === "function") {
    watching = true;
    for (const q of GLASS_BLOCK_QUERIES) window.matchMedia(q).addEventListener?.("change", () => applyGlass(current, false));
  }
  return shown;
}

/** Whether glass is shown right now (read at render / animation start; false outside a browser). */
export function isGlass(): boolean {
  return hasDom && document.documentElement.getAttribute(GLASS_ATTR) === "on";
}

/** Called whenever the shown state changes (the lenses follow it, `@/app/pwa`). */
export function onGlassChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Live: whether glass is shown (components whose STRUCTURE differs between the two looks). */
export function useGlass(): boolean {
  return useSyncExternalStore(onGlassChange, isGlass, () => false);
}
