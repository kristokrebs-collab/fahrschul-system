/**
 * A removed screenshot goes to the Papierkorb (`@/motion/trash`), not into oblivion: for six seconds "Rückgängig" puts the
 * very same reference back – and it only does so when the ORIGINAL BYTES are still there and still hash to what was stored.
 *
 * While the entry waits, the blob (device and cloud key) is PINNED (`pinShotKeys`), so the editor's garbage sweep and the
 * cloud release leave it alone; `commit` (timer, owner gone) lets go of the pin – only then a sweep may collect the blob.
 * An undo never deletes anything; a failed undo (bytes gone, hash differs) throws, the entry stays and says so.
 */
import type { ScreenshotRef } from "@/domain/types";
import { putTrash } from "@/motion/trash/trashStore";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { loadOriginal } from "./original";
import { collectShotGarbage, localKeyOf, pinShotKeys, referencedShotKeys, unpinShotKeys } from "./store";

/** Local blob key and cloud path a reference holds (the keys to pin). */
export function shotKeysOf(ref: ScreenshotRef): string[] {
  const out: string[] = [];
  const local = localKeyOf(ref);
  if (local) out.push(local);
  if (ref.store === "cloud" && ref.key) out.push(ref.key);
  return out;
}

/** Puts `ref` back into `list` at `index` (clamped); a list that already holds it is returned as is. Pure. */
export function insertShot(list: readonly ScreenshotRef[], ref: ScreenshotRef, index: number): ScreenshotRef[] {
  if (list.some((r) => r.id === ref.id)) return [...list];
  const at = Math.max(0, Math.min(list.length, index));
  return [...list.slice(0, at), ref, ...list.slice(at)];
}

/** Why an undo can fail (thrown as `Error.message`, shown by nobody – the host says "konnte nicht wiederhergestellt werden"). */
export const SHOT_GONE = "Das Original ist nicht mehr vorhanden.";
export const SHOT_CHANGED = "Das Original weicht vom gespeicherten Hash ab.";

/** Checks that the bytes behind `ref` are there and match their hash; throws otherwise. A link (`store: "url"`) has no bytes. */
export async function assertOriginalIntact(ref: ScreenshotRef): Promise<void> {
  if (ref.store === "url") return;
  const loaded = await loadOriginal(ref, true);
  if (!loaded) throw new Error(SHOT_GONE);
  if (loaded.hashOk === false) throw new Error(SHOT_CHANGED);
}

export interface TrashShotOptions {
  ref: ScreenshotRef;
  /** Position it had in the list (1-based in the sentence). */
  index: number;
  /** The field that removed it; its unmount settles the entry. */
  owner: string;
  /** Puts the reference back into the field's list (the caller inserts it at `index`). */
  put: (ref: ScreenshotRef, index: number) => void;
}

/**
 * Sends a removed screenshot to the trash. The caller has ALREADY taken it out of its list (the thumbnail plays its shrink
 * exit). Returns the entry id.
 */
export function trashShot({ ref, index, owner, put }: TrashShotOptions): number {
  const keys = shotKeysOf(ref);
  pinShotKeys(keys);
  return putTrash({
    subject: `Screenshot ${index + 1}`,
    kind: "shot",
    owner,
    restore: async () => {
      await assertOriginalIntact(ref);
      put(ref, index);
      // back in the list: the editor's own sweep rules apply again (it is referenced by what the editor holds)
      unpinShotKeys(keys);
    },
    commit: () => {
      unpinShotKeys(keys);
      // the editor is gone (or never held it): collect the bytes now instead of at the next editor close. While an editor
      // is open it sweeps by itself at its close – a sweep here would take the pictures it holds but did not save yet.
      const s = useJournal.getState();
      if (s.loaded && !useUi.getState().editor.open) void collectShotGarbage(referencedShotKeys(s.trades));
    },
  });
}
