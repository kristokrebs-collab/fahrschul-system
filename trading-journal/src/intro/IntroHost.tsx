import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Director } from "@/intro/director";
import { resetCells } from "@/intro/flight";
import { canAutoplay, canReplay, markIntroSeen, readIntroEnv } from "@/intro/introBoot";
import { getIntroPhase, onIntroCommand, setIntroPhase } from "@/intro/introStore";
import { IntroStage } from "@/intro/IntroStage";
import { navigate, restoreScroll } from "@/store/router";

/** Autoplay decision, made once per page load (StrictMode re-runs effects; the session flag is set on start). */
let autoplay: boolean | null = null;

/** Test hook: forget the once-per-load decision. */
export function resetIntroBootForTests(): void {
  autoplay = null;
}

const NAV_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);
const APP_ROOT_ID = "root";
/** Marks the app root while the intro stage covers it (with `aria-hidden="true"`). */
export const COVERED_ATTR = "data-intro-covered";

/**
 * Mounted once in App. Plays the "journal builds itself" intro: autoplay once per session on the overview (see
 * introBoot.canAutoplay), replay on `replayIntro()` (header logo, Settings), skip on `skipIntro()`, the pill, Esc /
 * Enter / Space or a click on the stage. Phases: "stage" (app hidden from AT, unreachable by pointer / Tab, scrolling
 * held) → "build" (cells fly into place,
 * shell enters) → "done"; "off" when no intro plays. Renders nothing when the intro is off.
 */
export function IntroHost() {
  const [run, setRun] = useState(0);
  const [covering, setCovering] = useState(false);
  const director = useRef<Director | null>(null);
  const focusBack = useRef<Element | null>(null);

  const start = useCallback(() => {
    markIntroSeen();
    resetCells();
    focusBack.current = document.activeElement;
    setIntroPhase("stage");
    setCovering(true);
    setRun((n) => n + 1);
  }, []);

  useLayoutEffect(() => {
    autoplay ??= canAutoplay(readIntroEnv());
    // before the first paint, so the stage covers the very first frame (the phase is shared state, set once per load)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (autoplay && getIntroPhase() === "off") start();
  }, [start]);

  useEffect(
    () =>
      onIntroCommand((c) => {
        if (c === "skip") {
          director.current?.skip();
          return;
        }
        const phase = getIntroPhase();
        if (phase === "stage" || phase === "build") return;
        // header logo and Settings both land on the top of the overview, with or without the replay
        navigate("overview");
        restoreScroll("overview", true);
        if (canReplay(readIntroEnv())) start();
      }),
    [start],
  );

  // While the stage covers the app, the app root is hidden from assistive tech (`aria-hidden`), pointers land on the
  // covering overlay, wheel / touch scrolling and navigation keys are held and Tab stays on the stage (its pill).
  // Deliberately NOT `inert`: toggling `inert` on the app root restyles every element of the app, and the release – at
  // the hand-over to the build, the first frames of the cell flights – was forced right there by the focus return
  // (≈ 40 ms on the overview, more on the tablet). `aria-hidden` changes no style.
  useLayoutEffect(() => {
    if (!covering) return;
    const app = document.getElementById(APP_ROOT_ID);
    const prevHidden = app?.getAttribute("aria-hidden") ?? null;
    app?.setAttribute("aria-hidden", "true");
    app?.setAttribute(COVERED_ATTR, "");
    const hold = (e: Event) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        director.current?.skip();
      } else if (e.key === "Tab") {
        // the pill is the stage's only tab stop; the app behind is not reachable
        e.preventDefault();
        document.querySelector<HTMLElement>("[data-intro-stage] button")?.focus({ preventScroll: true });
      } else if (NAV_KEYS.has(e.key) && !(e.target instanceof HTMLElement && e.target.closest("[data-intro-stage]"))) {
        e.preventDefault();
      }
    };
    // focus that lands in the hidden app anyway (a programmatic focus) goes back to the stage
    const onFocusIn = (e: FocusEvent) => {
      if (app && e.target instanceof Node && app.contains(e.target)) document.querySelector<HTMLElement>("[data-intro-overlay]")?.focus({ preventScroll: true });
    };
    window.addEventListener("wheel", hold, { passive: false });
    window.addEventListener("touchmove", hold, { passive: false });
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      if (prevHidden === null) app?.removeAttribute("aria-hidden");
      else app?.setAttribute("aria-hidden", prevHidden);
      app?.removeAttribute(COVERED_ATTR);
      document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("wheel", hold);
      window.removeEventListener("touchmove", hold);
      window.removeEventListener("keydown", onKey, true);
      const back = focusBack.current;
      focusBack.current = null;
      const active = document.activeElement;
      const inStage = active instanceof HTMLElement && active.closest("[data-intro-stage]");
      if (inStage || !active || active === document.body) {
        if (back instanceof HTMLElement && back !== document.body && back.isConnected) back.focus({ preventScroll: true });
        else if (inStage) (active as HTMLElement).blur();
      }
    };
  }, [covering, run]);

  // during the build only Esc skips (Enter / Space belong to the now interactive app)
  useEffect(() => {
    if (!run || covering) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") director.current?.skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, covering]);

  const onBuild = useCallback(() => {
    setIntroPhase("build");
    setCovering(false);
  }, []);
  const onDone = useCallback(() => {
    setIntroPhase("done");
    setCovering(false);
    setRun(0);
  }, []);
  const onSkip = useCallback(() => director.current?.skip(), []);

  if (!run) return null;
  return <IntroStage key={run} covering={covering} directorRef={director} onBuild={onBuild} onDone={onDone} onSkip={onSkip} />;
}
