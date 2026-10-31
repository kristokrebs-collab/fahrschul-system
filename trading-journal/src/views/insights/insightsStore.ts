import { create } from "zustand";
import type { CalendarUnit } from "@/domain/insights";

/**
 * View state shared by the Auswertung cards (not persisted, never journal data): a day another card asks the
 * calendar to open (Disziplin heat map, Rückblick "bester Tag"), and the calendar unit.
 */
export interface InsightsUiState {
  /** request: open this day (`YYYY-MM-DD`) in the calendar; `seq` makes repeated requests for the same day fire */
  focus: { key: string; seq: number } | null;
  unit: CalendarUnit;
  focusDay(key: string): void;
  setUnit(unit: CalendarUnit): void;
}

export const useInsightsUi = create<InsightsUiState>()((set, get) => ({
  focus: null,
  unit: "money",
  focusDay: (key) => set({ focus: { key, seq: (get().focus?.seq ?? 0) + 1 } }),
  setUnit: (unit) => set({ unit }),
}));
