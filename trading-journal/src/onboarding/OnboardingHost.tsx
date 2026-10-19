import { lazy, Suspense, useEffect, useRef } from "react";
import { useCommandNavOpen } from "@/app/CommandNav";
import { useIntroSettled } from "@/intro/introStore";
import { useJournal } from "@/store/journalStore";
import { useShareRoute } from "@/store/router";
import { useUi } from "@/store/uiStore";
import { autoStartDecision, markSeen, readOnboarding, resumeOnboarding, startOnboarding, useOnboarding } from "./onboardingStore";

const OnboardingTour = lazy(() => import("./OnboardingTour"));

/**
 * Leaf host of the first-run tour (P13): mount once in `App` after `<SetupEditor/>`, before `<Celebrate/>`.
 *   - Starts the tour by itself once: journal loaded and EMPTY, nothing stored yet, the intro finished, no other
 *     dialog open and no shared link on screen (P14: a `#share/<token>` visitor sees the tour once they open the app). A journal that already has trades marks the trader as `seen` – existing traders are never
 *     interrupted (they find "Einführung starten" in the settings, the search and the shortcut sheet).
 *   - Brings a paused tour back when the setup editor it stepped aside for has closed.
 *   - Loads the tour chunk only when it is needed.
 */
export function OnboardingHost() {
  const loaded = useOnboarding((s) => s.loaded);
  const paused = useOnboarding((s) => s.paused);
  const journalLoaded = useJournal((s) => s.loaded);
  const tradeCount = useJournal((s) => s.trades.length);
  const introSettled = useIntroSettled();
  const navOpen = useCommandNavOpen();
  // a visitor of a share link (`#share/<token>`, P12) came for the shared trade – the tour waits until they open the app
  const sharing = useShareRoute((s) => s.token !== null);
  const busy = useUi((s) => s.editor.open || s.setupEditor.open || s.detail.id !== null) || navOpen || sharing;
  const setupOpen = useUi((s) => s.setupEditor.open);
  const decided = useRef(false);
  const sawEditor = useRef(false);

  useEffect(() => {
    if (decided.current) return;
    const d = autoStartDecision({ stored: readOnboarding(), loaded: journalLoaded, tradeCount, introSettled, busy });
    if (d === "wait") return;
    decided.current = true;
    if (d === "seen") markSeen();
    else if (d === "start") startOnboarding("auto");
  }, [journalLoaded, tradeCount, introSettled, busy]);

  useEffect(() => {
    if (!paused) {
      sawEditor.current = false;
      return;
    }
    if (setupOpen) sawEditor.current = true;
    else if (sawEditor.current) resumeOnboarding();
  }, [paused, setupOpen]);

  if (!loaded) return null;
  return (
    <Suspense fallback={null}>
      <OnboardingTour />
    </Suspense>
  );
}
