/**
 * Status write-backs of the Wachstum page (P08) and their celebrations – each exactly once:
 *   - a goal whose hold streak is complete → `status: "done"` + `doneAt`; a process goal bursts as a record from its
 *     card (`celebrateRecord`) and opens ONE "Ziel erreicht" `FullscreenWipe` listing every goal reached at once
 *     (an outcome goal is marked done quietly – results are never celebrated);
 *   - a challenge that ended → `done` (streak burst + toast) or `failed` (an honest toast with the first violation).
 * All patches of one pass go into ONE settings save; the ids are remembered for the session so a slow sync can never
 * celebrate twice. The burst fires before the save – the card still exists then.
 */
import { useEffect, useRef } from "react";
import { periodUnit, type ChallengeProgress, type GoalProgress } from "@/domain/growth";
import { celebrateRecord, celebrateStreak } from "@/motion/fx";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { FullscreenWipe, WipeItem } from "@/motion/pulse/FullscreenWipe";
import { pushToast } from "@/store/uiStore";
import { patchMany } from "./actions";
import { useGrowthUi } from "./growthStore";
import { WACHSTUM } from "./strings";

const handled = new Set<string>();
/** Tests: forget the session's handled ids. */
export const __resetTransitions = (): void => handled.clear();

export function useGrowthTransitions(goals: readonly GoalProgress[], challenges: readonly ChallengeProgress[]): void {
  const busy = useRef(false);
  useEffect(() => {
    if (busy.current) return;
    const reached = goals.filter((g) => g.achieved && g.goal.status === "active" && !handled.has(`g:${g.goal.id}`));
    const ended = challenges.filter((c) => c.state !== "active" && c.challenge.status === "active" && !handled.has(`c:${c.challenge.id}`));
    if (!reached.length && !ended.length) return;
    const now = new Date().toISOString();
    for (const g of reached) handled.add(`g:${g.goal.id}`);
    for (const c of ended) handled.add(`c:${c.challenge.id}`);

    const party = reached.filter((g) => g.celebrate);
    if (party.length) {
      celebrateRecord(document.querySelector(`[data-goal="${party[0]!.goal.id}"]`));
      useGrowthUi.getState().showWipe({ titles: party.map((g) => g.goal.title), detail: party.length === 1 ? `${party[0]!.hold} ${periodUnit(party[0]!.goal.period, party[0]!.hold)} in Folge gehalten.` : `${party.length} Ziele auf einmal.` });
    }
    for (const c of ended) {
      if (c.state === "done") {
        celebrateStreak(document.querySelector(`[data-testid="challenge-running"][data-template="${c.template.key}"]`), { streak: c.days });
        pushToast({ kind: "success", title: WACHSTUM.challenges.done, detail: c.template.title });
      } else pushToast({ kind: "info", title: WACHSTUM.challenges.failed, detail: c.violations[0] ? `${c.template.title} · ${c.violations[0].text}` : c.template.title });
    }
    busy.current = true;
    void patchMany([
      ...reached.map((g) => ({ key: "goals" as const, id: g.goal.id, patch: { status: "done", doneAt: now } })),
      ...ended.map((c) => ({ key: "challenges" as const, id: c.challenge.id, patch: { status: c.state, endedAt: now } })),
    ]).finally(() => {
      busy.current = false;
    });
  }, [goals, challenges]);
}

/** The one "Ziel erreicht" wipe of the page. */
export function GoalWipe() {
  const wipe = useGrowthUi((s) => s.wipe);
  const close = useGrowthUi((s) => s.closeWipe);
  return (
    <FullscreenWipe open={!!wipe} onClose={close} label={WACHSTUM.goals.reached} autoCloseMs={5200}>
      {wipe && (
        <div className="grid min-h-full place-content-center gap-6 px-6 py-16 text-center" data-testid="goal-wipe">
          <WipeItem index={0} className="justify-self-center">
            <DotMatrixText text="ZIEL" tone="win" size={9} gap={3} decorative />
          </WipeItem>
          <WipeItem index={1}>
            <h2 className="text-[clamp(28px,8vw,44px)] font-semibold tracking-tight">{WACHSTUM.goals.reached}</h2>
          </WipeItem>
          <WipeItem index={2}>
            <ul className="grid gap-1.5">
              {wipe.titles.map((t) => (
                <li key={t} className="text-[17px] text-fg">
                  {t}
                </li>
              ))}
            </ul>
          </WipeItem>
          <WipeItem index={3}>
            <p className="text-[13px] text-mute">{wipe.detail} Prozess schlägt Zufall.</p>
          </WipeItem>
        </div>
      )}
    </FullscreenWipe>
  );
}
