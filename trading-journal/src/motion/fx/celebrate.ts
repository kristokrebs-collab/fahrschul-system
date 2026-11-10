import { celebrateFrom } from "@/motion/Celebrate";
import { prefersReducedMotion } from "@/motion/pulse/engine";
import { stagger } from "@/motion/tokens";

/**
 * Celebrate presets for the two burst kinds the journal had not used yet (`Celebrate` / `celebrateFrom`, mounted once
 * in the app shell): `streak` (36 dots, a wider cone) and `record` (40 dots + ONE red signal dot shooting straight
 * up). Every preset is finite – at most 2 bursts (the overlay keeps at most 3) – and under reduced motion the overlay
 * itself shows only its fading ring, so the presets skip their follow-up burst there.
 */
export type CelebrateTarget = Element | readonly (Element | null | undefined)[] | null | undefined;

/** Bursts a streak needs before it earns the second, white echo burst. */
export const STREAK_ECHO_FROM = 5;

/**
 * A discipline / win streak: one `streak` burst (win-green heavy) with the squash of the trigger; a streak of
 * `STREAK_ECHO_FROM`+ adds a white echo burst one `stagger.lead` later.
 */
export function celebrateStreak(target: CelebrateTarget, { streak = 0 }: { streak?: number } = {}): void {
  celebrateFrom(target, { kind: "streak", tone: "win" });
  if (streak < STREAK_ECHO_FROM || prefersReducedMotion()) return;
  setTimeout(() => celebrateFrom(target, { kind: "streak", tone: "fg", squash: false }), stagger.lead * 1000);
}

/**
 * A new record (best month, all-time high, goal reached, "als Referenz übernommen"): the `record` burst with its red
 * signal dot, then a white `win` echo `stagger.insert` later.
 */
export function celebrateRecord(target: CelebrateTarget): void {
  celebrateFrom(target, { kind: "record", tone: "win" });
  if (prefersReducedMotion()) return;
  setTimeout(() => celebrateFrom(target, { kind: "win", tone: "fg", squash: false }), stagger.insert * 1000);
}
