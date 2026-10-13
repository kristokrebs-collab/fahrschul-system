/**
 * Theme store (P13): Dunkel / Hell / System plus one accent, applied as attributes on `<html>`:
 *   - `data-theme="dark" | "light"`  the resolved scheme (System follows `prefers-color-scheme` live),
 *   - `data-theme-pref`               what the trader picked (`dark` | `light` | `system`),
 *   - `data-accent`                   the one accent (absent = the signal red, the default).
 * Every colour lives in CSS custom properties (`src/styles/tokens.css` = the dark defaults, `src/styles/themes.css` =
 * the light ramp and the accents), so switching never re-renders React – except the few subscribers below (charts via
 * `applyInk`, the ThemeCard).
 *
 * Dark is the default and stays byte-for-byte the existing design: without a stored preference nothing but the
 * attributes is written (no CSS selects `data-theme="dark"`).
 *
 * No flash, no inline script (the CSP forbids one): `applyInitialTheme()` runs in `main.tsx` before the first render,
 * synchronously from localStorage (`storageKey("theme")`). `color-scheme` follows the scheme with `only` (Samsung's
 * forced dark / Chromium Auto Dark leave a page alone that declares its own scheme), and so do the two metas.
 */
import { create } from "zustand";
import { applyInk, resetInk, type InkKey } from "@/chart/ink";
import { storageKey } from "@/store/storage";

export type ThemePref = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";
export type Accent = "signal" | "kobalt" | "violett";

export const THEME_KEY = storageKey("theme");
export const THEME_PREFS: readonly ThemePref[] = ["dark", "light", "system"];
export const ACCENTS: readonly Accent[] = ["signal", "kobalt", "violett"];

export const THEME_STRINGS = {
  title: "Darstellung",
  note: "Gilt nur auf diesem Gerät.",
  mode: "Modus",
  accent: "Akzent",
  prefs: { dark: "Dunkel", light: "Hell", system: "System" } satisfies Record<ThemePref, string>,
  accents: { signal: "Signalrot", kobalt: "Kobalt", violett: "Violett" } satisfies Record<Accent, string>,
  accentHelp: "Eine einzige Akzentfarbe für Signale, Marker und den Start-Button. Gewinn und Verlust bleiben grün und rot.",
  systemHelp: "Folgt der Einstellung deines Geräts.",
  toggle: "Hell / Dunkel umschalten",
  toggleHint: "Taste T schaltet überall zwischen Hell und Dunkel um.",
} as const;

/** `<meta name="theme-color">` per scheme (browser chrome, installed app title bar) = the page colour `ink-900`. */
export const THEME_META_COLOR: Record<ResolvedTheme, string> = { dark: "#0a0a0a", light: "#ebebe9" };

export interface StoredTheme {
  pref: ThemePref;
  accent: Accent;
}

const DEFAULT_THEME: StoredTheme = { pref: "dark", accent: "signal" };

const isPref = (v: unknown): v is ThemePref => typeof v === "string" && (THEME_PREFS as readonly string[]).includes(v);
const isAccent = (v: unknown): v is Accent => typeof v === "string" && (ACCENTS as readonly string[]).includes(v);

/** Parses the stored value: `{pref, accent}` JSON, or a bare pref (`"light"` / `light`); anything else → defaults. */
export function parseStoredTheme(raw: string | null): StoredTheme {
  if (!raw) return { ...DEFAULT_THEME };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    v = raw;
  }
  if (isPref(v)) return { pref: v, accent: DEFAULT_THEME.accent };
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return { pref: isPref(o.pref) ? o.pref : DEFAULT_THEME.pref, accent: isAccent(o.accent) ? o.accent : DEFAULT_THEME.accent };
  }
  return { ...DEFAULT_THEME };
}

export function readStoredTheme(): StoredTheme {
  try {
    return parseStoredTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return { ...DEFAULT_THEME };
  }
}

function writeStoredTheme(t: StoredTheme): void {
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify(t));
  } catch {
    // storage blocked: the choice lasts for this session only
  }
}

/** The OS preference (`prefers-color-scheme: light`); dark when the query is unavailable. */
export function systemTheme(): ResolvedTheme {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function resolveTheme(pref: ThemePref, system: ResolvedTheme = systemTheme()): ResolvedTheme {
  return pref === "system" ? system : pref;
}

/* ----------------------------------------------------------------------------------------------- DOM application */

/**
 * Chart palette of a scheme, read from the CSS mirrors in `themes.css` (`--chart-ink-*`), so the canvas charts
 * (lightweight-charts, `src/chart/ink.ts`) follow the same ramp as the DOM. Dark = the untouched defaults.
 */
const INK_VARS: Record<InkKey, string> = {
  bg: "--chart-ink-bg",
  grid: "--chart-ink-grid",
  ref: "--chart-ink-ref",
  tick: "--chart-ink-tick",
  mute: "--chart-ink-mute",
  fg: "--chart-ink-fg",
  separator: "--chart-ink-separator",
  labelBg: "--chart-ink-label-bg",
  signal: "--chart-ink-signal",
  win: "--chart-ink-win",
  loss: "--chart-ink-loss",
  winSoft: "--chart-ink-win-soft",
  lossSoft: "--chart-ink-loss-soft",
  veil: "--chart-ink-veil",
  onFill: "--chart-ink-on-fill",
};

/** Chart bridge (P02 `applyInk`): dark → `resetInk()` (the exact defaults), light / accents → the CSS mirrors. */
export function syncChartInk(root: HTMLElement = document.documentElement): void {
  if (root.dataset.theme !== "light" && !root.dataset.accent) {
    resetInk();
    return;
  }
  let cs: CSSStyleDeclaration;
  try {
    cs = getComputedStyle(root);
  } catch {
    return;
  }
  const next: Partial<Record<InkKey, string>> = {};
  for (const [k, v] of Object.entries(INK_VARS) as [InkKey, string][]) {
    const value = cs.getPropertyValue(v).trim();
    if (value) next[k] = value;
  }
  resetInk();
  applyInk(next);
}

function setMeta(name: string, content: string): void {
  const el = document.head?.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (el && el.content !== content) el.content = content;
}

/** Writes the attributes, metas and chart palette for `t` (no animation; `transitionTheme` wraps this). */
export function applyThemeToDom(t: StoredTheme, resolved: ResolvedTheme = resolveTheme(t.pref)): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePref = t.pref;
  if (t.accent === "signal") delete root.dataset.accent;
  else root.dataset.accent = t.accent;
  setMeta("theme-color", THEME_META_COLOR[resolved]);
  setMeta("color-scheme", resolved === "light" ? "only light" : "only dark");
  syncChartInk(root);
}

/* -------------------------------------------------------------------------------------------------------- store */

export interface ThemeState extends StoredTheme {
  resolved: ResolvedTheme;
  /** Picks Dunkel / Hell / System; `origin` (viewport px) = where the circular reveal starts (the tapped control). */
  setPref(pref: ThemePref, origin?: ThemeOrigin): void;
  setAccent(accent: Accent, origin?: ThemeOrigin): void;
}

export interface ThemeOrigin {
  x: number;
  y: number;
}

/**
 * Hook for the visual switch (`src/app/themeTransition.ts` registers the circular reveal); without one the DOM is
 * written directly. Kept as an injection point so this store stays free of animation code and testable in jsdom.
 */
type Transition = (apply: () => void, origin: ThemeOrigin | undefined, from: ResolvedTheme, to: ResolvedTheme) => void;
let transition: Transition | null = null;
export function setThemeTransition(fn: Transition | null): void {
  transition = fn;
}

function commit(next: StoredTheme, origin?: ThemeOrigin): void {
  const prev = useTheme.getState();
  const resolved = resolveTheme(next.pref);
  writeStoredTheme(next);
  const apply = () => {
    applyThemeToDom(next, resolved);
    useTheme.setState({ ...next, resolved });
  };
  if (transition && (prev.resolved !== resolved || prev.accent !== next.accent)) transition(apply, origin, prev.resolved, resolved);
  else apply();
}

const initial = readStoredTheme();

export const useTheme = create<ThemeState>(() => ({
  ...initial,
  resolved: resolveTheme(initial.pref),
  setPref: (pref, origin) => commit({ pref, accent: useTheme.getState().accent }, origin),
  setAccent: (accent, origin) => commit({ pref: useTheme.getState().pref, accent }, origin),
}));

/** Hell ↔ Dunkel (from System: to the opposite of what is shown). Shortcut `t`, CommandNav action. */
export function toggleTheme(origin?: ThemeOrigin): void {
  const { resolved } = useTheme.getState();
  useTheme.getState().setPref(resolved === "light" ? "dark" : "light", origin);
}

let mediaBound = false;

/**
 * Applies the stored theme before the first render (`main.tsx`) and starts following the OS while the preference is
 * System. Idempotent.
 */
export function applyInitialTheme(): void {
  const t = readStoredTheme();
  const resolved = resolveTheme(t.pref);
  applyThemeToDom(t, resolved);
  useTheme.setState({ ...t, resolved });
  if (mediaBound || typeof matchMedia !== "function") return;
  mediaBound = true;
  try {
    const mq = matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener?.("change", () => {
      const s = useTheme.getState();
      if (s.pref !== "system") return;
      const next = systemTheme();
      if (next === s.resolved) return;
      const apply = () => {
        applyThemeToDom(s, next);
        useTheme.setState({ resolved: next });
      };
      if (transition) transition(apply, undefined, s.resolved, next);
      else apply();
    });
  } catch {
    // no media query support: System stays on the scheme seen at start
  }
}
