/**
 * State of the screenshot import (F29): the sheet's open flag + the pictures it reads, and the QUEUE of drafts that
 * wait for the editor when one extraction found several trades (the first opens at once, the rest are offered one by
 * one by the host's pill after the trader saved or closed the editor). Nothing is persisted: closing the app drops the
 * queue, and nothing in it is ever saved without the trader pressing „Speichern“ in the editor.
 */
import { create } from "zustand";
import type { ScreenshotRef } from "@/domain/types";
import { localKeyOf, pinShotKeys, unpinShotKeys } from "@/journal/screenshots/store";
import { useUi, type TradeDraft } from "@/store/uiStore";

interface ShotImportState {
  open: boolean;
  /** The pictures of the editor the import was started from (the sheet lets the trader pick up to four). */
  shots: ScreenshotRef[];
  /** Drafts waiting for the editor, in order. */
  queue: TradeDraft[];
}

export const useShotImport = create<ShotImportState>(() => ({ open: false, shots: [], queue: [] }));

export function openShotImport(shots: readonly ScreenshotRef[]): void {
  useShotImport.setState({ open: true, shots: [...shots] });
}

export function closeShotImport(): void {
  useShotImport.setState({ open: false });
}

const keysOf = (drafts: readonly TradeDraft[]): string[] =>
  drafts.flatMap((d) => (d.screenshots ?? []).flatMap((r) => [localKeyOf(r), r.store === "cloud" ? r.key : null].filter((k): k is string => !!k)));

/** Replaces the queue and keeps exactly its pictures pinned (a picture shared by several drafts stays pinned). */
function setQueue(next: TradeDraft[]): void {
  unpinShotKeys(keysOf(useShotImport.getState().queue));
  pinShotKeys(keysOf(next));
  useShotImport.setState({ queue: next });
}

/** The confirmed drafts: the first opens in the editor now, the others wait in the queue (their pictures are pinned). */
export function startDrafts(drafts: readonly TradeDraft[]): void {
  const [first, ...rest] = drafts;
  if (!first) return;
  setQueue(rest);
  useShotImport.setState({ open: false });
  // an editor that is open keeps how it was opened (from the + button it morphs from it) – switching that while the sheet
  // is up would re-run its entrance and leave it half-open
  const ed = useUi.getState().editor;
  useUi.getState().openEditor({ draft: first, fromFab: ed.open && ed.fromFab });
}

/** Opens the next queued draft in the editor. */
export function openNextDraft(): void {
  const [next, ...rest] = useShotImport.getState().queue;
  if (!next) return;
  setQueue(rest);
  useUi.getState().openEditor({ draft: next });
}

/** Drops the waiting drafts (their pictures are released again). */
export function discardQueue(): void {
  setQueue([]);
}
