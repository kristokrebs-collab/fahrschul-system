import type { ScreenshotRef } from "@/domain/types";
import { Button } from "@/primitives/Button";
import { useUi } from "@/store/uiStore";
import { useShotExtractAvailable } from "./availability";
import { openShotImport } from "./store";

/**
 * „Aus Screenshot übernehmen“ under the screenshots of a NEW trade (F29). Not rendered at all unless the import is
 * available (cloud build, signed in, plan, server key – `availability.ts`), there is a picture, and the editor is not
 * editing a saved trade (a draft only pre-fills a new one). The settings card „Screenshot-Import“ explains the rest.
 */
export function ExtractButton({ shots }: { shots: readonly ScreenshotRef[] }) {
  const ready = useShotExtractAvailable();
  const editingSaved = useUi((s) => !!s.editor.tradeId);
  if (!ready || editingSaved || !shots.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="extract-action">
      <Button onClick={() => openShotImport(shots)} data-testid="extract-open">
        Aus Screenshot übernehmen
      </Button>
      <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-mute">Die KI liest Einstieg, Stop, Menge und Ergebnis – du prüfst nur, was markiert ist.</p>
    </div>
  );
}
