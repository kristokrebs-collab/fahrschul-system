/**
 * Theme switch effect (P13). Registered once in `main.tsx` through `setThemeTransition`, so `themeStore` itself stays
 * free of DOM animation code.
 *
 * // motion-exception: theme-reveal – the whole page changes colour at once, which no transform can express. With the
 * View Transitions API (Chromium 111+) the NEW page is revealed by a growing `clip-path` circle from the tapped switch
 * over the frozen old snapshot (WAAPI on `::view-transition-new(root)`, `tween.reveal`; CSS in `themes.css`, scoped to
 * `html[data-theme-switching]`). Without it a fixed paper/ink disc grows from the switch (clip-path), the theme flips
 * underneath while it covers the page, and the disc fades out (`tween.fade`) – the overlay crossfade. Under
 * `data-safe-fx` (no clip-path on fixed layers) the disc is a plain fade; under reduced motion the theme flips at once.
 * Every path is finite and leaves nothing behind (the overlay is removed, the attribute dropped).
 */
import { ease, tween } from "@/motion/tokens";
import { prefersReducedMotion } from "@/motion/pulse/engine";
import { isSafeFx } from "@/motion/safeFx";
import { setThemeTransition, THEME_META_COLOR, type ResolvedTheme, type ThemeOrigin } from "@/store/themeStore";

export const THEME_SWITCHING_ATTR = "data-theme-switching";
/** z above the toast island / intro (95): the disc covers the whole page while the colours swap underneath. */
export const THEME_WIPE_Z = 96;

const bezier = (e: readonly number[]) => `cubic-bezier(${e.join(",")})`;

/** Radius that covers the viewport from `(x, y)`. */
export function coverRadius(x: number, y: number, w: number, h: number): number {
  return Math.ceil(Math.hypot(Math.max(x, w - x), Math.max(y, h - y)));
}

/** Default origin (no pointer): the top right corner, where the header sits. */
export function defaultOrigin(w: number): ThemeOrigin {
  return { x: Math.max(0, w - 48), y: 36 };
}

type VT = { ready: Promise<void>; finished: Promise<void> };
type DocVT = Document & { startViewTransition?: (cb: () => void) => VT };

let busy = false;

/** The switch itself (see the module comment); `apply` writes the DOM + store and must run exactly once. */
export function runThemeTransition(apply: () => void, origin: ThemeOrigin | undefined, _from: ResolvedTheme, to: ResolvedTheme): void {
  if (typeof document === "undefined" || typeof window === "undefined" || busy || prefersReducedMotion()) {
    apply();
    return;
  }
  const root = document.documentElement;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const o = origin ?? defaultOrigin(w);
  const r = coverRadius(o.x, o.y, w, h);
  const clip = [`circle(0px at ${o.x}px ${o.y}px)`, `circle(${r}px at ${o.x}px ${o.y}px)`];
  const duration = tween.reveal.duration * 1000;
  const easing = bezier(ease.out);
  const safe = isSafeFx();
  const doc = document as DocVT;

  if (!safe && typeof doc.startViewTransition === "function" && typeof root.animate === "function") {
    busy = true;
    root.setAttribute(THEME_SWITCHING_ATTR, "");
    let vt: VT;
    try {
      vt = doc.startViewTransition(apply);
    } catch {
      busy = false;
      root.removeAttribute(THEME_SWITCHING_ATTR);
      apply();
      return;
    }
    vt.ready
      .then(() => {
        root.animate({ clipPath: clip }, { duration, easing, pseudoElement: "::view-transition-new(root)" });
      })
      .catch(() => undefined);
    vt.finished
      .catch(() => undefined)
      .finally(() => {
        busy = false;
        root.removeAttribute(THEME_SWITCHING_ATTR);
      });
    return;
  }

  // overlay crossfade: a disc in the target page colour covers the page, the theme flips underneath, the disc fades
  const disc = document.createElement("div");
  disc.setAttribute("aria-hidden", "true");
  disc.setAttribute("data-layer", "Theme-Wechsel");
  Object.assign(disc.style, {
    position: "fixed",
    inset: "0",
    zIndex: String(THEME_WIPE_Z),
    pointerEvents: "none",
    background: THEME_META_COLOR[to],
  } satisfies Partial<CSSStyleDeclaration>);
  if (typeof disc.animate !== "function") {
    apply();
    return;
  }
  busy = true;
  document.body.appendChild(disc);
  const enter = safe
    ? disc.animate({ opacity: [0, 1] }, { duration: tween.fade.duration * 1000, easing: "ease-out", fill: "forwards" })
    : disc.animate({ clipPath: clip }, { duration, easing, fill: "forwards" });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    apply();
    const leave = disc.animate({ opacity: [1, 0] }, { duration: tween.fade.duration * 1000, easing: "ease-out", fill: "forwards" });
    const cleanup = () => {
      disc.remove();
      busy = false;
    };
    leave.onfinish = cleanup;
    leave.oncancel = cleanup;
  };
  enter.onfinish = finish;
  enter.oncancel = finish;
}

/** Registers the effect for the store; returns the uninstaller. */
export function installThemeTransition(): () => void {
  setThemeTransition(runThemeTransition);
  return () => setThemeTransition(null);
}
