/**
 * The assistant's evaluation tools (lazy chunk, loaded by `engine.ts` when a question is routed to one of them): the answers of
 * the finished analyses – Prüfbericht and Belastung of the last lab run, Forward-Test, Trendlinien, Signale, Monatsnutzen,
 * ähnliche Situationen, „Passt zu dir?“, Strategie-Bibliothek. Each tool imports its own source on demand (a second dynamic
 * import per topic), takes every figure from the existing deterministic function and only ever OPENS a place in the app.
 * See `src/assistant/README.md` → „Auswertungen“.
 */
import { normalize } from "@/domain/coach/nlq/lexicon";
import type { InsightToolId } from "../insightRoutes";
import type { ToolEnv, ToolReply } from "../tools";
import { squeeze } from "../understand";

/** Answers `question` with the tool `tool`. Never starts a run, a search or a computation of the trader's: it reads what exists. */
export async function runInsight(tool: InsightToolId, question: string, env: ToolEnv): Promise<ToolReply> {
  const norm = normalize(squeeze(question.toLowerCase()));
  switch (tool) {
    case "audit":
      return (await import("./audit")).auditAnswer(norm, env);
    case "stress":
      return (await import("./audit")).stressAnswer(norm, env);
    case "forward":
      return (await import("./forward")).forwardAnswer(norm, env);
    case "trend":
      return (await import("./trend")).trendAnswer(norm, env);
    case "signals":
      return (await import("./signals")).signalsAnswer(norm, env);
    case "quality":
      return (await import("./signals")).qualityAnswer(norm, env);
    case "benefit":
      return (await import("./benefit")).benefitAnswer(norm, env);
    case "situation":
      return (await import("./situation")).situationAnswer(norm, env);
    case "fit":
      return (await import("./fit")).fitAnswer(norm, env);
    case "demands":
      return (await import("./fit")).demandsAnswer(norm, env);
    case "library":
      return (await import("./library")).libraryAnswer(norm, env);
    case "evolve":
      return (await import("./evolve")).evolveAnswer(norm, env);
  }
}
