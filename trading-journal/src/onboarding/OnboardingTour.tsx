import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { addGoalFromDraft } from "@/domain/growth/goals";
import { celebrateRecord } from "@/motion/fx/celebrate";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { HoldButton } from "@/motion/HoldButton";
import { MilestoneRail, type Milestone } from "@/motion/pulse";
import { Sheet } from "@/motion/Sheet";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { PAGES, pushToast, useUi, type Page } from "@/store/uiStore";
import { finishOnboarding, goToStep, pauseOnboarding, skipOnboarding, STEP_COUNT, STEP_IDS, useOnboarding } from "./onboardingStore";
import { GOAL_TEMPLATES, parseAmount, StepBoerse, StepKonten, StepSetups, StepStart, StepZiel, TOUR, type GoalTemplateId, type KontenDraft } from "./steps";

/**
 * The first-run tour (P13): a `Sheet` (bottom sheet on phones, centred dialog from `sm`) with five steps – Start
 * (LaunchGrid, AsciiCascade wordmark, PixelTextFill claim, Typewriter), Konten und Kapital (writes `settings.capital` /
 * `currency`), Setups (shows them; "Eigene Grundlage anlegen" steps aside for the setup editor and comes back), Börse
 * (Konto when the cloud is set up, else an honest hint) and Ziel (a process goal through P08 `addGoalFromDraft`). A
 * horizontal `MilestoneRail` and the dot-matrix counter `1:5` show the progress; "Halten zum Starten" (`HoldButton`)
 * ends it with the record celebration. Skippable at every step (Escape, swipe, close, "Überspringen"); the outcome is
 * remembered (`onboardingStore`).
 */

const RAIL: Milestone[] = STEP_IDS.map((id, i) => ({ id, title: TOUR.steps[id], date: `0${i + 1}` }));
/** the pulse rail lays its steps out 220 px wide for scrolling; here all five share the sheet's width */
const RAIL_FIT = "overflow-visible pb-0 snap-none [&>li]:w-auto [&>li]:min-w-0 [&>li]:flex-1 [&>li]:pr-2 [&>li:last-child]:flex-none";

function initialKonten(): KontenDraft {
  const s = useJournal.getState().settings;
  const cur = s.currency === "EUR" || s.currency === "USD" ? s.currency : "USDT";
  const fmt = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "");
  return { makro: fmt(s.capital?.makro), scalp: fmt(s.capital?.scalp), currency: cur };
}

export function OnboardingTour() {
  const open = useOnboarding((s) => s.open);
  const step = useOnboarding((s) => s.step);
  const setups = useJournal((s) => s.settings.setups);
  const reduced = useReducedFx();
  const [konten, setKonten] = useState<KontenDraft>(initialKonten);
  const [invalid, setInvalid] = useState<"makro" | "scalp" | null>(null);
  const [goal, setGoal] = useState<GoalTemplateId | null>("journal");
  const [dir, setDir] = useState<1 | -1>(1);
  const [play, setPlay] = useState(1);
  const holdRef = useRef<HTMLButtonElement>(null);
  const id = STEP_IDS[step]!;

  const go = (next: number) => {
    setDir(next > step ? 1 : -1);
    if (next === 0) setPlay((p) => p + 1);
    goToStep(next);
  };

  const saveKonten = async (): Promise<boolean> => {
    const makro = parseAmount(konten.makro);
    const scalp = parseAmount(konten.scalp);
    if (makro === null) return setInvalid("makro"), false;
    if (scalp === null) return setInvalid("scalp"), false;
    setInvalid(null);
    const { settings, saveSettings } = useJournal.getState();
    if (settings.capital?.makro === makro && settings.capital?.scalp === scalp && settings.currency === konten.currency) return true;
    try {
      await saveSettings({ ...settings, capital: { ...settings.capital, makro, scalp }, currency: konten.currency });
      return true;
    } catch {
      pushToast({ kind: "error", title: "Speichern fehlgeschlagen", detail: "Kapital und Währung kannst du später unter Einstellungen → Konten setzen." });
      return true;
    }
  };

  const next = async () => {
    if (id === "konten" && !(await saveKonten())) return;
    go(Math.min(STEP_COUNT - 1, step + 1));
  };

  const finish = async () => {
    const tpl = GOAL_TEMPLATES.find((g) => g.id === goal);
    let saved = false;
    if (tpl) saved = (await addGoalFromDraft(tpl.draft)) !== null;
    if (holdRef.current) celebrateRecord(holdRef.current);
    finishOnboarding();
    pushToast({ kind: "success", title: TOUR.done.title, detail: tpl ? (saved ? `${TOUR.ziel.saved}: ${tpl.title}.` : "Das Ziel konnte nicht gespeichert werden – leg es später unter Wachstum an.") : TOUR.done.detail });
  };

  const openAccount = () => {
    finishOnboarding();
    if ((PAGES as readonly string[]).includes("konto")) navigate("konto" as Page);
  };

  const addSetup = () => {
    pauseOnboarding();
    useUi.getState().openSetupEditor();
  };

  const last = step === STEP_COUNT - 1;

  return (
    <Sheet
      open={open}
      onClose={skipOnboarding}
      title={TOUR.title}
      size="lg"
      dismissGuard={false}
      headerExtra={<DotMatrixText text={`${step + 1}:${STEP_COUNT}`} size={3} gap={1.5} tone="mute" label={`Schritt ${step + 1} von ${STEP_COUNT}`} />}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2.5">
          <Button variant="ghost" size="sm" onClick={skipOnboarding} data-testid="tour-skip">
            {TOUR.skip}
          </Button>
          <div className="flex items-center gap-2.5">
            {step > 0 && (
              <Button variant="ghost" onClick={() => go(step - 1)} data-testid="tour-back">
                {TOUR.back}
              </Button>
            )}
            {last ? (
              <HoldButton ref={holdRef} variant="primary" onConfirm={() => void finish()} holdLabel={TOUR.holding} data-testid="tour-finish">
                {TOUR.hold}
              </HoldButton>
            ) : (
              <Button variant="primary" onClick={() => void next()} data-testid="tour-next">
                {TOUR.next}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="grid min-w-0 gap-6" data-testid="onboarding" data-step={id}>
        <div className="min-w-0 px-1">
          <MilestoneRail items={RAIL} orientation="horizontal" active={step} label={TOUR.rail} className={RAIL_FIT} />
        </div>
        <div className="relative min-h-[300px] min-w-0">
          <AnimatePresence mode="wait" initial={false} custom={dir}>
            <motion.div
              key={id}
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 * dir }}
              animate={{ opacity: 1, x: 0, transition: { opacity: tween.fade, x: spring.enter } }}
              exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, x: -16 * dir, transition: tween.exit }}
            >
              {id === "start" && <StepStart play={play} />}
              {id === "konten" && <StepKonten draft={konten} onChange={setKonten} invalid={invalid} />}
              {id === "setups" && <StepSetups setups={setups} onAdd={addSetup} />}
              {id === "boerse" && <StepBoerse onOpenAccount={openAccount} />}
              {id === "ziel" && <StepZiel value={goal} onChange={setGoal} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Sheet>
  );
}

export default OnboardingTour;
