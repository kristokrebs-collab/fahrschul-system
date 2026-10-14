/**
 * Cockpit widgets of the Wachstum page (P08 → P13): components without props that read the same hooks as the page.
 * Shape like `RISIKO_WIDGETS` / `ANALYSE_WIDGETS`: `{ id, title, component, defaultSpan }`. A widget that opens a
 * sheet (check-in, review) needs the sheet mounted once – `PostTradeReviewHost` (App) covers the review; the check-in
 * widget mounts its own `CheckInSheet` (rendered only when no other instance is mounted).
 */
import type { ComponentType } from "react";
import { CheckInCard } from "./CheckInCard";
import { CheckInSheet } from "./CheckInSheet";
import { useGrowthBase, useStreaks, useToday } from "./hooks";
import { PreTradeCheck } from "./PreTradeCheck";
import { StreakBoard } from "./StreakBadge";

function CheckInWidget() {
  const b = useGrowthBase();
  const today = useToday(b);
  return (
    <>
      <CheckInCard today={today} />
      <CheckInSheet />
    </>
  );
}

function ReadyWidget() {
  const b = useGrowthBase();
  const today = useToday(b);
  return <PreTradeCheck checkin={today.checkin} mood={today.mood} events={b.events} todayKey={today.key} />;
}

function StreaksWidget() {
  const b = useGrowthBase();
  return <StreakBoard streaks={useStreaks(b)} />;
}

export interface GrowthWidget {
  id: string;
  title: string;
  component: ComponentType;
  /** columns of 12 on large screens */
  defaultSpan: number;
}

export const WACHSTUM_WIDGETS: readonly GrowthWidget[] = [
  { id: "growth-checkin", title: "Check-in", component: CheckInWidget, defaultSpan: 5 },
  { id: "growth-ready", title: "Bereit für den nächsten Trade?", component: ReadyWidget, defaultSpan: 7 },
  { id: "growth-streaks", title: "Serien", component: StreaksWidget, defaultSpan: 12 },
];
