/**
 * Coach views (P04). The integrator (P14) registers `CoachView` as page `coach`, mounts `<CoachWatcher />` once in
 * App.tsx and `<TradeCoachPanel tradeId={id} />` inside the trade detail. See README.md.
 */
export { CoachView, COACH_LEAD_FILL } from "./CoachView";
export { TradeCoachPanel } from "./TradeCoachPanel";
export { CoachWatcher, useCoachWatch, changedIds, fresh, BULK_SAVE, FRESH_MS } from "./CoachWatcher";
export { useCoachUi, CHAT_MAX, type ChatEntry, type LiveAlert, type AiState } from "./coachStore";
export { eventsOf, useCoach, useCoachBase } from "./hooks";
export { useAiAvailable, aiServerEnabled } from "./ask";
