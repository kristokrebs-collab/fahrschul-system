import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useState } from "react";
import { spring, tween } from "@/motion/tokens";
import { Button } from "@/primitives/Button";
import { useUi } from "@/store/uiStore";
import { useOcrImport } from "@/journal/ocr/store";
import { discardQueue, openNextDraft, useShotImport } from "./store";

/** The preview sheet is its own chunk: it (and the maths behind it) only loads when the trader starts the import. */
const ExtractSheet = lazy(() => import("./ExtractSheet"));
/** The screenshot import of the trades page (local text recognition, optional model): its own chunk, like the sheet above. */
const OcrImportSheet = lazy(() => import("@/journal/ocr/ui/OcrImportSheet"));

/**
 * Host of the screenshot import (F29), mounted with the other hosts (`app/DeferredHosts`): the lazy preview sheet and
 * the pill that offers the NEXT draft when one extraction found several trades. The pill is only there while the editor
 * is closed – the trader saved (or dropped) the draft before – and never opens anything by itself.
 */
export function ShotImportHost() {
  const open = useShotImport((s) => s.open);
  const queue = useShotImport((s) => s.queue);
  const editorOpen = useUi((s) => s.editor.open);
  const ocrOpen = useOcrImport((s) => s.open);
  // keep the sheet mounted after its first opening, so it can play its exit
  const [seen, setSeen] = useState(false);
  if (open && !seen) setSeen(true);
  const [ocrSeen, setOcrSeen] = useState(false);
  if (ocrOpen && !ocrSeen) setOcrSeen(true);
  return (
    <>
      {seen && (
        <Suspense fallback={null}>
          <ExtractSheet />
        </Suspense>
      )}
      {ocrSeen && (
        <Suspense fallback={null}>
          <OcrImportSheet />
        </Suspense>
      )}
      <AnimatePresence>
        {queue.length > 0 && !editorOpen && (
          <motion.div
            key="queue"
            role="region"
            aria-label="Weitere Entwürfe aus dem Screenshot"
            data-testid="extract-queue"
            className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom,0px)+5.75rem)] z-[55] mx-auto flex max-w-[460px] flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line-2 bg-ink-800 px-3.5 py-3 shadow-[0_18px_50px_rgb(0_0_0/0.5)]"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0, transition: spring.pop }}
            exit={{ opacity: 0, y: 8, transition: tween.exit }}
          >
            <p className="min-w-0 flex-1 text-[13px] leading-snug">
              <strong className="font-semibold">{queue.length === 1 ? "Noch 1 Entwurf" : `Noch ${queue.length} Entwürfe`}</strong> aus dem Screenshot warten.
            </p>
            <Button variant="primary" size="sm" onClick={openNextDraft} data-testid="extract-next">
              Nächsten öffnen
            </Button>
            <Button size="sm" onClick={discardQueue} data-testid="extract-discard">
              Verwerfen
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
