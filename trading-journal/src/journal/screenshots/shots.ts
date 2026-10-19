/**
 * Screenshot references (Journal v3, P06): intake → local blob → (signed in) cloud copy, and the display URL of any
 * reference. See `store.ts` (IndexedDB) and `cloud.ts` (Supabase Storage).
 */
import { useEffect, useState } from "react";
import type { ScreenshotRef } from "@/domain/types";
import { newId } from "@/lib/ids";
import { cloudShotOwner, cloudShotUrl, uploadShot } from "./cloud";
import { IntakeError, INTAKE_MESSAGES, prepareImage } from "./image";
import { getShotBlob, localKeyOf, localShotUrl, putShotBlob } from "./store";

/** At most this many screenshots per trade. */
export const MAX_SHOTS = 12;

export interface AddResult {
  refs: ScreenshotRef[];
  /** German messages of the files that were refused (one per file). */
  errors: string[];
}

/** Takes image files into the local store; `room` = how many more fit on the trade. */
export async function addShots(files: readonly Blob[], room = MAX_SHOTS, now: Date = new Date()): Promise<AddResult> {
  const refs: ScreenshotRef[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (refs.length >= room) {
      errors.push(`Höchstens ${MAX_SHOTS} Screenshots pro Trade.`);
      break;
    }
    try {
      const img = await prepareImage(file);
      const id = newId("shot_");
      const key = await putShotBlob(img.blob, id);
      const ref: ScreenshotRef = { id, store: "idb", key, mime: img.mime, at: now.toISOString() };
      if (img.w) ref.w = img.w;
      if (img.h) ref.h = img.h;
      refs.push(ref);
    } catch (e) {
      errors.push(e instanceof IntakeError ? e.message : INTAKE_MESSAGES.decode);
    }
  }
  return { refs, errors };
}

/**
 * Uploads a local screenshot for the signed-in user. Resolves the cloud reference (the local blob stays as
 * `cacheKey`, so this device keeps showing it offline), or `null` when there is no cloud / no login / the upload
 * failed – the reference then simply stays local.
 */
export async function promoteToCloud(ref: ScreenshotRef): Promise<ScreenshotRef | null> {
  if (ref.store !== "idb" || !ref.key || !cloudShotOwner()) return null;
  const blob = await getShotBlob(ref.key);
  if (!blob) return null;
  const path = await uploadShot(blob, ref.id, ref.mime ?? blob.type);
  if (!path) return null;
  return { ...ref, store: "cloud", key: path, cacheKey: ref.key } as ScreenshotRef;
}

/** Displayable URL of a reference (`null` when the picture is not reachable from here). */
export async function shotUrl(ref: ScreenshotRef): Promise<string | null> {
  if (ref.store === "url") return ref.url ?? null;
  const local = localKeyOf(ref);
  if (local) {
    const url = await localShotUrl(local);
    if (url) return url;
  }
  if (ref.store === "cloud" && ref.key) return cloudShotUrl(ref.key);
  return null;
}

export type ShotUrlState = { status: "loading" } | { status: "ok"; url: string } | { status: "missing" };

/** Resolves `ref` to a URL for an `<img>` (re-resolves when the reference changes). */
export function useShotUrl(ref: ScreenshotRef | null | undefined): ShotUrlState {
  const id = ref ? `${ref.store}:${ref.key ?? ref.url ?? ""}:${localKeyOf(ref) ?? ""}` : "";
  const [state, setState] = useState<{ id: string; s: ShotUrlState }>({ id: "", s: { status: "loading" } });
  useEffect(() => {
    if (!ref) return;
    let alive = true;
    void shotUrl(ref).then(
      (url) => alive && setState({ id, s: url ? { status: "ok", url } : { status: "missing" } }),
      () => alive && setState({ id, s: { status: "missing" } }),
    );
    return () => {
      alive = false;
    };
    // `id` captures everything of `ref` that changes the URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!ref) return { status: "missing" };
  return state.id === id ? state.s : { status: "loading" };
}

/** "Lokal" / "Cloud" / "Link" badge text. */
export function shotPlace(ref: ScreenshotRef): string {
  return ref.store === "cloud" ? "Cloud" : ref.store === "url" ? "Link" : "Lokal";
}
