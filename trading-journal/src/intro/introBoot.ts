import { INTRO_KEY, INTRO_PREF_KEY } from "@/intro/introStore";
import { prefersReducedMotion } from "@/motion/pulse/engine";

export interface IntroEnv {
  /** sessionStorage `tj2-intro` present (already played this session, or set by the e2e / perf harness). */
  seen: boolean;
  reduced: boolean;
  /** localStorage `tj2-ui-intro`. */
  pref: string | null;
  /** a real browser with rAF and layout (not jsdom / SSR). */
  browser: boolean;
  /** page of the start route (`#trades` → "trades"; empty / unknown → "overview"). */
  page: string;
}

const OTHER_PAGES = new Set(["trades", "setups", "settings"]);

export function pageOfHash(hash: string): string {
  const name = (hash.startsWith("#") ? hash.slice(1) : hash).split("?")[0] ?? "";
  return OTHER_PAGES.has(name) ? name : "overview";
}

/**
 * Autoplay at start: once per session, motion allowed, not switched off, in a real browser, and only when the app
 * opens on the overview – the intro builds the overview; a deep link into another page skips it (and leaves the
 * session flag unset, so the next fresh start on the overview still plays it).
 */
export function canAutoplay(env: IntroEnv): boolean {
  return env.browser && !env.seen && !env.reduced && env.pref !== "off" && env.page === "overview";
}

/** Explicit replay (header logo, Settings button): only needs motion and a real browser. */
export function canReplay(env: Pick<IntroEnv, "browser" | "reduced">): boolean {
  return env.browser && !env.reduced;
}

export function isRealBrowser(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined" || typeof requestAnimationFrame !== "function") return false;
  return !/jsdom/i.test(navigator.userAgent);
}

function read(store: () => Storage, key: string): string | null {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
}

export function readIntroEnv(): IntroEnv {
  const browser = isRealBrowser();
  return {
    // storage blocked → treat as seen (never force an intro we cannot remember)
    seen: browser ? read(() => sessionStorage, INTRO_KEY) !== null || !storageWorks() : true,
    reduced: prefersReducedMotion(),
    pref: browser ? read(() => localStorage, INTRO_PREF_KEY) : null,
    browser,
    page: typeof location === "undefined" ? "overview" : pageOfHash(location.hash),
  };
}

function storageWorks(): boolean {
  try {
    return typeof sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    sessionStorage.setItem(INTRO_KEY, "1");
  } catch {
    /* storage blocked */
  }
}
