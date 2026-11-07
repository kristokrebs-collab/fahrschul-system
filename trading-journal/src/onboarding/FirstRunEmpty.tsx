import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { EmptyState } from "@/primitives/EmptyState";
import { useJournal } from "@/store/journalStore";
import { useShareRoute } from "@/store/router";
import { useUi } from "@/store/uiStore";
import { markSeen, readOnboarding } from "./onboardingStore";

export const FIRST_RUN = {
  title: "Dein Journal ist noch leer",
  text: "Trag deinen ersten Trade ein – das dauert etwa eine Minute. Danach füllen sich Übersicht, Analyse und Berichte von selbst.",
  action: "Ersten Trade eintragen",
  /** one quiet line of text, no second button: where the rest lives */
  hint: "Die Einführung und eine Demo mit Beispieldaten findest du später unter Einstellungen und Funktionen.",
} as const;

/** The pages the first-run state belongs to: the start page and the list of trades. */
const FIRST_RUN_PAGES: readonly string[] = ["overview", "trades"];

/** Pure: show the first-run state? An empty, loaded journal, on a first visit (nothing stored by the former tour), on the start page or the trades. */
export function firstRunVisible(i: { loaded: boolean; tradeCount: number; stored: boolean; page: string; sharing: boolean; dismissed: boolean }): boolean {
  return i.loaded && i.tradeCount === 0 && !i.stored && !i.sharing && !i.dismissed && FIRST_RUN_PAGES.includes(i.page);
}

/**
 * The empty state with ONE action that replaces the first-run tour's modal (Etappe 1a): a quiet dashed box above the page – what is
 * empty, one button „Ersten Trade eintragen“, one line where the rest lives. It shows only on a genuine first visit: the journal is
 * empty AND nothing is stored under `onboarding` (a visitor who saw the former modal has `done` / `skipped`, a trader with trades
 * `seen` – neither sees this). The button remembers the visit (`seen`) and opens the editor. The tour itself stays under
 * Einstellungen → Einführung & Hilfe, in the search and in the shortcut sheet.
 */
export function FirstRunEmpty() {
  const loaded = useJournal((s) => s.loaded);
  const tradeCount = useJournal((s) => s.trades.length);
  const page = useUi((s) => s.page);
  const openEditor = useUi((s) => s.openEditor);
  const sharing = useShareRoute((s) => s.token !== null);
  const reduced = useReducedFx();
  // the stored outcome of the former tour, read on every render (cheap): someone who has one never sees the first-run state
  const stored = readOnboarding() !== null;
  const [dismissed, setDismissed] = useState(false);
  const show = firstRunVisible({ loaded, tradeCount, stored, page, sharing, dismissed });
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.section
          key="first-run"
          aria-label={FIRST_RUN.title}
          data-testid="first-run-empty"
          className="mb-5"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: tween.exit }}
          transition={tween.fade}
        >
          <EmptyState
            title={FIRST_RUN.title}
            text={FIRST_RUN.text}
            line={false}
            className="min-h-0"
            action={
              <Button
                variant="primary"
                className="touch-hit"
                onClick={() => {
                  markSeen();
                  setDismissed(true);
                  openEditor();
                }}
              >
                {FIRST_RUN.action}
              </Button>
            }
          />
          <p className="mt-2 text-center text-[12px] text-faint">{FIRST_RUN.hint}</p>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
