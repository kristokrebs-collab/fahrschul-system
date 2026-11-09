/**
 * Daily check-in at the first open of the day (F61) – a leaf host for the app shell. Once per calendar day of the trader's
 * configured time zone it opens the check-in sheet (`openCheckin(day, true)`: Später / Heute überspringen / Erledigt). The
 * decision is the pure `decidePrompt` (`@/domain/checkin`):
 *
 *  - the outcome of the day (answered / skipped) lives in the synced day entry, so a second device does not ask again once
 *    its journal has synced; until the first sync has landed (cloud login: `connecting` / `syncing`, at most `graceMs`) it
 *    waits instead of asking for what another device already answered;
 *  - after the intro and the onboarding, never over an editor, the trade detail, a replay, another sheet or dialog;
 *  - "Später" is a per-device snooze; after midnight (or a clock change) the new day asks again – the host re-checks every
 *    few seconds, on focus and when the tab becomes visible again.
 *
 * The clock is injectable (`now` prop, default `checkinNow()` which tests replace with `setCheckinClock`). The sheet is
 * mounted here too (`useSheetOwner`: only one instance renders, the page's or this one).
 */
import { useEffect, useMemo, useState } from "react";
import { checkinConfigOf, decidePrompt, deviceTimeZone } from "@/domain/checkin";
import { useSyncStatus } from "@/cloud/sync/status";
import { useIntroSettled } from "@/intro/introStore";
import { useMorphDialog } from "@/motion/MorphDialog";
import { readOnboarding, useOnboarding } from "@/onboarding/onboardingStore";
import { backStackState } from "@/store/backStack";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { useReplay } from "@/views/trades/replay/replayStore";
import { CheckInSheet } from "./CheckInSheet";
import { checkinNow, useDevicePrompt, useSnooze } from "./dailyCheckin";
import { useGrowthUi } from "./growthStore";

/** How often the host re-checks (ms): the next day, a snooze that ended, a dialog that closed. */
export const CHECK_EVERY_MS = 5000;
/** The longest the first prompt waits for the first cloud sync (ms). */
export const SYNC_GRACE_MS = 12_000;

export interface DailyCheckinHostProps {
  /** the clock (ms); default `checkinNow()` */
  now?: () => number;
  /** re-check interval (ms) */
  everyMs?: number;
  /** longest wait for the first sync (ms) */
  graceMs?: number;
}

export function DailyCheckinHost({ now = checkinNow, everyMs = CHECK_EVERY_MS, graceMs = SYNC_GRACE_MS }: DailyCheckinHostProps = {}) {
  const loaded = useJournal((s) => s.loaded);
  const mode = useJournal((s) => s.mode);
  const days = useJournal((s) => s.days);
  const settings = useJournal((s) => s.settings);
  const tradeCount = useJournal((s) => s.trades.length);
  const phase = useSyncStatus((s) => s.phase);
  const introSettled = useIntroSettled();
  const tourOpen = useOnboarding((s) => s.open || s.paused);
  const snooze = useSnooze((s) => s.snooze);
  const checkinOpen = useGrowthUi((s) => s.checkinOpen);
  const open = useGrowthUi((s) => s.openCheckin);
  // the stores that say "something is in front"
  const editor = useUi((s) => s.editor.open);
  const setupEditor = useUi((s) => s.setupEditor.open);
  const detail = useUi((s) => s.detail.id != null);
  const replay = useReplay((s) => s.id != null);
  const goal = useGrowthUi((s) => s.goalOpen);
  const review = useGrowthUi((s) => s.reviewId != null);
  const morph = !!useMorphDialog().open;

  const [tick, setTick] = useState(0);
  const [grace, setGrace] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGrace(true), graceMs);
    return () => clearTimeout(t);
  }, [graceMs]);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const id = setInterval(bump, everyMs);
    const onVisible = () => document.visibilityState === "visible" && bump();
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [everyMs]);

  const deviceOff = useDevicePrompt((s) => s.off);
  const config = useMemo(() => {
    const c = checkinConfigOf(settings);
    return deviceOff ? { ...c, prompt: false } : c;
  }, [settings, deviceOff]);
  // a cloud login that has not synced yet could be holding today's answer from another device
  const syncing = mode === "connecting" || phase === "connecting" || phase === "syncing" || phase === "locked";
  const synced = loaded && (!syncing || grace);
  // intro done AND onboarding done / skipped / not needed: a first run (nothing stored, empty journal) is the tour's
  const firstRun = readOnboardingPending(tradeCount);
  const introDone = introSettled && !tourOpen && !firstRun;
  const blocked = editor || setupEditor || detail || replay || goal || review || morph || checkinOpen || backStackState().want > 0;

  // `tick` re-runs the decision: the clock moved (next day, snooze over), a dialog closed
  const decision = useMemo(
    () => decidePrompt({ now: now(), config, deviceTz: deviceTimeZone(), days, synced, introDone, blocked, snooze }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [now, config, days, synced, introDone, blocked, snooze, tick],
  );
  const day = decision.show ? decision.day : null;
  useEffect(() => {
    if (day) open(day, true);
  }, [day, open]);

  return <CheckInSheet />;
}

/** A genuine first run: no onboarding outcome stored and nothing in the journal – the tour comes first. */
function readOnboardingPending(tradeCount: number): boolean {
  return tradeCount === 0 && readOnboarding() === null;
}
