import type { ScreenshotRef } from "@/domain/types";
import { openScreenshotFill } from "@/journal/ocr/store";
import { Button } from "@/primitives/Button";
import { useUi } from "@/store/uiStore";
import { useShotExtractState } from "./availability";
import { openShotImport } from "./store";

export const EXTRACT_BUTTON_COPY = {
  label: "Aus Screenshot übernehmen",
  ai: "Die KI liest Einstieg, Stop, Menge und Ergebnis – du prüfst nur, was markiert ist.",
  local: "Liest auf diesem Gerät, ohne KI: Einstieg, Ausstieg, Menge, Hebel, Zeiten und Ergebnis – du prüfst nur, was markiert ist.",
} as const;

/**
 * „Aus Screenshot übernehmen“ under the screenshots of the trade form (F29), as soon as a picture is attached. Two readers
 * behind the SAME button, and the line beside it says which one runs:
 *   - the model (`availability.ts`: cloud build, signed in, plan, server key) for a NEW trade – its preview sheet re-seeds
 *     the editor with the confirmed draft(s), as before;
 *   - otherwise the local reader (`src/journal/ocr/`, text recognition on this device, no account, no key): it reads the
 *     form's pictures and fills THIS form (several trades on the picture → a short choice list). Also while the model's
 *     state is still being checked, and when a saved trade is edited.
 * Nothing is saved by either before the trader presses „Speichern“.
 */
export function ExtractButton({ shots }: { shots: readonly ScreenshotRef[] }) {
  const state = useShotExtractState();
  const editingSaved = useUi((s) => !!s.editor.tradeId);
  if (!shots.length) return null;
  const ai = state === "ready" && !editingSaved;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="extract-action" data-reader={ai ? "ai" : "local"}>
      <Button onClick={() => (ai ? openShotImport(shots) : openScreenshotFill(shots))} data-testid="extract-open">
        {EXTRACT_BUTTON_COPY.label}
      </Button>
      <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-mute" data-testid="extract-reader">
        {ai ? EXTRACT_BUTTON_COPY.ai : EXTRACT_BUTTON_COPY.local}
      </p>
    </div>
  );
}
