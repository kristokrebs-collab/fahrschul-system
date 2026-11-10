/**
 * App-like display (grey-bar fix, tablet audit §1c): install prompt, standalone / fullscreen detection, the Fullscreen
 * API toggle and the visual-viewport bottom inset. The grey strip above the One UI taskbar is host UI (the browser's
 * bottom toolbar / sheet, drawn outside web content); the page cannot paint over it, so it offers the two ways out:
 * run installed (`display: standalone`, public/manifest.webmanifest) or fullscreen (`requestFullscreen` with
 * `navigationUI: "hide"`). Everything here is event driven – no polling, no per-frame work.
 *
 * Listeners are installed on import (`beforeinstallprompt` fires early, before React mounts); every access is guarded
 * for jsdom, file:// and browsers without the APIs.
 */
import { useSyncExternalStore } from "react";
import { SAFE_FX_ATTR } from "@/motion/safeFx";

type Listener = () => void;

/* ------------------------------------------------------------------ tiny external store */

function signal() {
  const listeners = new Set<Listener>();
  return {
    subscribe(cb: Listener) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    emit() {
      for (const l of listeners) l();
    },
  };
}

const hasWindow = typeof window !== "undefined" && typeof document !== "undefined";

/* ------------------------------------------------------------------ install prompt */

/** Chromium's deferred install prompt (not in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const installSignal = signal();

/** True while the browser offers an install prompt we can trigger (Chrome / Edge / Samsung Internet, not iOS). */
export function canInstall(): boolean {
  return deferred !== null && !installed;
}

/**
 * Shows the browser's install dialog (must run inside a click). Resolves with the user's choice, or `"unavailable"`
 * when there is no prompt (already installed, iOS, Firefox, file://).
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const e = deferred;
  if (!e) return "unavailable";
  // a prompt can be used once; Chrome fires a fresh beforeinstallprompt if the user dismisses it
  deferred = null;
  installSignal.emit();
  try {
    await e.prompt();
    const choice = await e.userChoice;
    return choice.outcome;
  } catch {
    return "unavailable";
  }
}

export function useCanInstall(): boolean {
  return useSyncExternalStore(installSignal.subscribe, canInstall, () => false);
}

/* ------------------------------------------------------------------ display mode */

const STANDALONE_QUERY = "(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)";

/** Running as an installed app (home-screen / WebAPK / iOS "Zum Home-Bildschirm"), not in a browser tab. */
export function isStandalone(): boolean {
  if (!hasWindow) return false;
  try {
    if (typeof window.matchMedia === "function" && window.matchMedia(STANDALONE_QUERY).matches) return true;
  } catch {
    /* old engines */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function subscribeStandalone(cb: Listener): () => void {
  if (!hasWindow || typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(STANDALONE_QUERY);
  mql.addEventListener?.("change", cb);
  return () => mql.removeEventListener?.("change", cb);
}

export function useStandalone(): boolean {
  return useSyncExternalStore(subscribeStandalone, isStandalone, () => false);
}

/** Samsung Internet (the Galaxy Tab default browser): its own dark-mode filter needs a user setting, see `SAMSUNG_DARK_HINT`. */
export function isSamsungInternet(ua: string = hasWindow ? navigator.userAgent : ""): boolean {
  return /SamsungBrowser\//.test(ua);
}

/* ------------------------------------------------------------------ Samsung-Internet-safe effects */

/**
 * `data-safe-fx` on `<html>` (decision 7): in Samsung Internet the fixed / sticky layers (dock, its label plates,
 * bottom fade, toast island, header CTA, noise film) drop `clip-path`, `backdrop-filter`, `mask-image`, blur filters
 * and composited `will-change` layers and fall back to opacity / transform only (base.css `html[data-safe-fx]`).
 * `?safefx=1` / `?safefx=0` in the URL forces it on / off on any browser (comparison on the device and in tests);
 * the layer diagnostics can toggle it live.
 */
export { SAFE_FX_ATTR, isSafeFx } from "@/motion/safeFx";

/** Pure: whether the safe effects apply – the URL switch wins, else Samsung Internet. */
export function wantsSafeFx(ua: string, search: string): boolean {
  const m = /[?&]safefx=([01])\b/.exec(search);
  if (m) return m[1] === "1";
  return isSamsungInternet(ua);
}

export function setSafeFx(on: boolean): void {
  if (!hasWindow) return;
  document.documentElement.toggleAttribute(SAFE_FX_ATTR, on);
}

/** iOS / iPadOS Safari: no install prompt API, installation goes through the share sheet. */
export function isIosSafari(ua: string = hasWindow ? navigator.userAgent : "", touchPoints: number = hasWindow ? navigator.maxTouchPoints : 0): boolean {
  const ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  return ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/* ------------------------------------------------------------------ fullscreen */

type FsDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: (opts?: FullscreenOptions) => Promise<void> | void };

const fsSignal = signal();

/** The Fullscreen API is usable here (false on iPhone Safari, in sandboxed iframes without allowfullscreen, in jsdom). */
export function fullscreenSupported(): boolean {
  if (!hasWindow) return false;
  const d = document as FsDocument;
  const el = document.documentElement as FsElement;
  return (d.fullscreenEnabled === true && typeof el.requestFullscreen === "function") || (d.webkitFullscreenEnabled === true && typeof el.webkitRequestFullscreen === "function");
}

export function isFullscreen(): boolean {
  if (!hasWindow) return false;
  const d = document as FsDocument;
  return Boolean(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/**
 * Enters (hiding the browser UI and the system bars – `navigationUI: "hide"`) or leaves fullscreen. Must run inside a
 * user gesture. Resolves to the new state; never rejects (a refused request leaves the page as it was).
 */
export async function toggleFullscreen(): Promise<boolean> {
  if (!fullscreenSupported()) return false;
  const d = document as FsDocument;
  try {
    if (isFullscreen()) {
      if (typeof d.exitFullscreen === "function") await d.exitFullscreen();
      else await d.webkitExitFullscreen?.();
    } else {
      const el = document.documentElement as FsElement;
      if (typeof el.requestFullscreen === "function") await el.requestFullscreen({ navigationUI: "hide" });
      else await el.webkitRequestFullscreen?.({ navigationUI: "hide" });
    }
  } catch {
    /* refused (no user activation, permissions policy) */
  }
  return isFullscreen();
}

export function useFullscreen(): boolean {
  return useSyncExternalStore(fsSignal.subscribe, isFullscreen, () => false);
}

export function useFullscreenSupported(): boolean {
  // capability, not state: read once per render (cheap), constant for the page's lifetime
  return useSyncExternalStore(noopSubscribe, fullscreenSupported, () => false);
}

function noopSubscribe(): () => void {
  return () => {};
}

/* ------------------------------------------------------------------ visual viewport bottom inset */

/** Larger bottom gaps are the on-screen keyboard (the dock stays behind it, as on iOS), not host UI. */
export const VV_KEYBOARD_MIN = 120;

/**
 * Pure: the part of the layout viewport's bottom that is covered by host UI (a browser toolbar or sheet laid over the
 * page) – `innerHeight − (visualViewport.offsetTop + visualViewport.height)`, rounded. 0 while pinch-zoomed (the
 * visual viewport then pans inside the page) and for keyboard-sized gaps (≥ `VV_KEYBOARD_MIN`).
 */
export function bottomInset(innerHeight: number, vv: { offsetTop: number; height: number; scale: number } | null | undefined): number {
  if (!vv || !Number.isFinite(innerHeight) || !Number.isFinite(vv.height)) return 0;
  if (vv.scale > 1.01) return 0;
  const raw = Math.round(innerHeight - (vv.offsetTop + vv.height));
  return raw > 0 && raw < VV_KEYBOARD_MIN ? raw : 0;
}

let vvInstalled = 0;
let vvCleanup: (() => void) | null = null;

/**
 * Keeps `--vv-bottom` on `<html>` in sync with the visual viewport (`resize` / `scroll` of `visualViewport` and the
 * window, coalesced into one rAF; the property is written only when the rounded value changes). Ref-counted; returns
 * the uninstall function. Pinned-to-bottom chrome reads `var(--safe-bottom)` (base.css).
 */
export function installViewportInset(): () => void {
  if (!hasWindow) return () => {};
  vvInstalled++;
  if (vvInstalled === 1) {
    const vv = window.visualViewport ?? null;
    const root = document.documentElement;
    let raf = 0;
    let last = -1;
    const apply = () => {
      raf = 0;
      const px = bottomInset(window.innerHeight, vv);
      if (px === last) return;
      last = px;
      root.style.setProperty("--vv-bottom", `${px}px`);
    };
    const schedule = () => {
      if (!raf) raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame(apply) : (apply(), 0);
    };
    const opts: AddEventListenerOptions = { passive: true };
    vv?.addEventListener("resize", schedule, opts);
    vv?.addEventListener("scroll", schedule, opts);
    window.addEventListener("resize", schedule, opts);
    window.addEventListener("orientationchange", schedule, opts);
    schedule();
    vvCleanup = () => {
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
      root.style.removeProperty("--vv-bottom");
    };
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    vvInstalled--;
    if (vvInstalled === 0) {
      vvCleanup?.();
      vvCleanup = null;
    }
  };
}

/* ------------------------------------------------------------------ copy */

export const DISPLAY_STRINGS = {
  section: "Anzeige",
  fullscreen: "Vollbild",
  fullscreenExit: "Vollbild beenden",
  install: "App installieren",
  installed: "Als App geöffnet",
  /** Shown where no install prompt exists (iOS, Firefox, Samsung before the prompt fires). */
  installHint: "Ohne Browserleiste: im Browser-Menü „Zum Startbildschirm hinzufügen“ wählen und die App vom Startbildschirm öffnen.",
  installHintIos: "Ohne Browserleiste: Teilen → „Zum Home-Bildschirm“ und die App vom Home-Bildschirm öffnen.",
  /** Samsung Internet re-colours pages in its dark mode unless the user lets sites keep their own dark theme. */
  samsungDark: "Samsung Internet färbt die Seite um? Einstellungen → Labs → „Use website dark theme“ (Dunkles Design der Website verwenden) einschalten.",
} as const;

/* ------------------------------------------------------------------ install on import */

if (hasWindow) {
  // before React's first paint (this module is imported by the shell): the fallbacks never flash in
  if (wantsSafeFx(navigator.userAgent, location.search)) setSafeFx(true);
  window.addEventListener("beforeinstallprompt", (e) => {
    // keep the browser's mini-infobar from covering the dock; the app offers "App installieren" itself
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    installed = false;
    installSignal.emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    installSignal.emit();
  });
  const onFs = () => fsSignal.emit();
  document.addEventListener("fullscreenchange", onFs);
  document.addEventListener("webkitfullscreenchange", onFs);
}
