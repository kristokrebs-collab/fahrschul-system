/**
 * "Diese Idee testen" (F12), the part that needs the lab: translate (pure, `@/domain/lab`) and fill the lab's set-up.
 * Imported lazily by `TestIdeaButton`, so the pages with a button do not carry the lab store.
 */
import { translateIdea, type IdeaDraft, type IdeaInput } from "@/domain/lab";
import { useLabor } from "./laborStore";

/** Translates `input` and, when it is testable, fills the lab (strategy "Eigene Idee", market, rules). Nothing is saved or started. */
export function openIdea(input: IdeaInput): IdeaDraft {
  const draft = translateIdea(input);
  useLabor.getState().applyIdea(draft);
  return draft;
}
