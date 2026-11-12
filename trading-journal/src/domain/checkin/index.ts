/**
 * `@/domain/checkin` (F61) – the daily check-in's rules: the days in the trader's time zone (`day.ts`), the config in
 * `settings.checkin` (`config.ts`), when the prompt asks (`prompt.ts`) and the join with the day's trades (`evaluate.ts`).
 * The answers themselves are the `checkin` key of the day entry (`@/domain/psych/checkin`). Pure; see README.md.
 */
export * from "./day";
export * from "./config";
export * from "./prompt";
export * from "./evaluate";
