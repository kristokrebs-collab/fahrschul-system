/**
 * `VoiceNote` (F31) as a lazy piece: the dictation button and the browser's speech-recognition hook are loaded when a note field
 * is first drawn, not with the first page – the trade editor is part of the first load and must not carry them. Until the chunk
 * is there the place stays empty (no layout of its own to wait for: it sits under the text field).
 */
import { lazy, Suspense, type ComponentProps } from "react";
import type { VoiceNote as VoiceNoteImpl } from "./VoiceNote";

const Impl = lazy(() => import("./VoiceNote").then((m) => ({ default: m.VoiceNote })));

export function VoiceNote(props: ComponentProps<typeof VoiceNoteImpl>) {
  return (
    <Suspense fallback={null}>
      <Impl {...props} />
    </Suspense>
  );
}
