/**
 * Intake of screenshot files (A2) – the lazy part of `addShots`: header sniffing, SHA-256 and preview in a worker,
 * the byte-for-byte write with a read-back check (also in the worker), and the verdict where the picture ended up. It
 * loads with the first picture, so none of it is part of the first page load.
 */
import type { ScreenshotRef } from "@/domain/types";
import { newId } from "@/lib/ids";
import { openShotSession } from "./derive";
import { IntakeError, INTAKE_MESSAGES, prepareImage } from "./image";
import { STORAGE_MESSAGES } from "./info";
import { deleteShotBlob, putShotBlobChecked, putShotPreview } from "./store";
import type { AddResult, ShotNote } from "./shots";

const MAX_SHOTS = 12;

/** `addShots`: every file goes in unchanged; `room` = how many more fit on the trade. */
export async function takeShots(files: readonly Blob[], room: number, now: Date): Promise<AddResult> {
  const refs: ScreenshotRef[] = [];
  const errors: string[] = [];
  const notes: ShotNote[] = [];
  const session = await openShotSession();
  try {
    for (const file of files) {
      if (refs.length >= room) {
        errors.push(`Höchstens ${MAX_SHOTS} Screenshots pro Trade.`);
        break;
      }
      try {
        const img = await prepareImage(file);
        const derived = await session.derive(img.blob, { w: img.w, h: img.h });
        const id = newId("shot_");
        const put = await putShotBlobChecked(img.blob, id);
        if (put.where === "device") {
          // read it back: a stored file that is not the file we were given is worse than no file
          const back = await session.verify(id);
          if (!back || back.size !== img.blob.size || back.sha256 !== derived.sha256) {
            await deleteShotBlob(id);
            errors.push(STORAGE_MESSAGES.verify);
            continue;
          }
        }
        if (derived.preview) await putShotPreview(id, derived.preview);
        const ref: ScreenshotRef = {
          id,
          store: "idb",
          key: put.key,
          mime: img.mime,
          at: now.toISOString(),
          sha256: derived.sha256,
          bytes: img.blob.size,
          original: true,
          storage: put.where === "device" ? "device" : "ram",
        };
        const w = derived.w ?? img.w;
        const h = derived.h ?? img.h;
        if (w) ref.w = w;
        if (h) ref.h = h;
        const name = (file as Partial<File>).name;
        if (typeof name === "string" && name.trim()) ref.originalName = name.slice(0, 200);
        refs.push(ref);
        if (put.where === "ram") notes.push({ id, kind: put.problem === "quota" ? "quota" : "ram" });
      } catch (e) {
        errors.push(e instanceof IntakeError ? e.message : INTAKE_MESSAGES.decode);
      }
    }
  } finally {
    session.close();
  }
  return { refs, errors, notes };
}
