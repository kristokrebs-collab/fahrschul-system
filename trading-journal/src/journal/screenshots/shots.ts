/**
 * Screenshot references (Journal v3, P06; A2 originals): intake → local original → (signed in) cloud copy, and the
 * display URL of any reference. See `store.ts` (IndexedDB) and `cloud.ts` (Supabase Storage).
 *
 * The bytes the trader chooses are stored UNCHANGED (`original: true`, with their SHA-256, size, name and type); the
 * picture the app shows in lists is a separate derived preview (`derive.ts`, in a worker). Nothing is ever shrunk
 * to make it fit: a full store or a cloud limit ends in a plain message and an alternative, not in a smaller file.
 */
import { useEffect, useState } from "react";
import type { ScreenshotRef } from "@/domain/types";
import { cloudShotOwner, cloudShotUrl, uploadShotChecked, type UploadProblem } from "./cloud";
import { shotStorageOf, STORAGE_MESSAGES } from "./info";
import { getShotBlob, localKeyOf, localPreviewUrl, localShotUrl, putShotPreview } from "./store";

/** At most this many screenshots per trade. */
export const MAX_SHOTS = 12;

/** Something the trader should know about a picture that WAS taken in: it is not saved durably. */
export interface ShotNote {
  /** `ref.id` */
  id: string;
  kind: "ram" | "quota";
}

export interface AddResult {
  refs: ScreenshotRef[];
  /** German messages of the files that were refused (one per file). */
  errors: string[];
  /** Pictures that went in but only live in memory of this session (no IndexedDB, or the device storage is full). */
  notes: ShotNote[];
}

export { STORAGE_MESSAGES };

/**
 * Takes image files into the local store, byte for byte; `room` = how many more fit on the trade. The work (header
 * sniffing, hashing, preview, read-back check) lives in `intake.ts`, a lazy chunk that loads with the first picture.
 */
export async function addShots(files: readonly Blob[], room = MAX_SHOTS, now: Date = new Date()): Promise<AddResult> {
  return (await import("./intake")).takeShots(files, room, now);
}

/** Result of copying one local original to the cloud. */
export type PromoteResult = { ok: true; ref: ScreenshotRef } | { ok: false; problem: UploadProblem };

/**
 * Uploads the local ORIGINAL of `ref` unchanged. On success the reference becomes `store: "cloud"` (the local blob stays
 * as `cacheKey`, so this device keeps showing it offline); otherwise it says why and stays as it is.
 */
export async function promoteShot(ref: ScreenshotRef): Promise<PromoteResult> {
  if (ref.store !== "idb" || !ref.key || !cloudShotOwner()) return { ok: false, problem: "unavailable" };
  const blob = await getShotBlob(ref.key);
  if (!blob) return { ok: false, problem: "unavailable" };
  const r = await uploadShotChecked(blob, ref.id, ref.mime ?? blob.type);
  if (!r.ok) return r;
  return { ok: true, ref: { ...ref, store: "cloud", key: r.path, cacheKey: ref.key, storage: "cloud" } };
}

/**
 * Uploads a local screenshot for the signed-in user. Resolves the cloud reference, or `null` when there is no cloud / no
 * login / the upload failed – the reference then simply stays local (`promoteShot` says which).
 */
export async function promoteToCloud(ref: ScreenshotRef): Promise<ScreenshotRef | null> {
  const r = await promoteShot(ref);
  return r.ok ? r.ref : null;
}

export type ShotVariant = "preview" | "original";

const previewing = new Map<string, Promise<string | null>>();
/** Originals up to this size are shown as they are – decoding them is cheap. */
const SHOW_AS_IS_BYTES = 400 * 1024;

/** The preview URL of a local original; makes (and keeps) the preview first when there is none and the file is big. */
async function previewUrlOf(local: string): Promise<string | null> {
  const have = await localPreviewUrl(local);
  if (have) return have;
  const running = previewing.get(local);
  if (running) return running;
  const job = (async () => {
    const blob = await getShotBlob(local);
    if (!blob || blob.size <= SHOW_AS_IS_BYTES) return null;
    const d = await (await import("./derive")).deriveShot(blob);
    if (!d.preview) return null;
    await putShotPreview(local, d.preview);
    return localPreviewUrl(local);
  })().finally(() => previewing.delete(local));
  previewing.set(local, job);
  return job;
}

/** Displayable URL of a reference (`null` when the picture is not reachable from here). `original` = the exact stored file. */
export async function shotUrl(ref: ScreenshotRef, variant: ShotVariant = "original"): Promise<string | null> {
  if (ref.store === "url") return ref.url ?? null;
  const local = localKeyOf(ref);
  if (local) {
    if (variant === "preview") {
      try {
        const p = await previewUrlOf(local);
        if (p) return p;
      } catch {
        /* the original is shown instead */
      }
    }
    const url = await localShotUrl(local);
    if (url) return url;
  }
  if (ref.store === "cloud" && ref.key) return cloudShotUrl(ref.key);
  return null;
}

export type ShotUrlState = { status: "loading" } | { status: "ok"; url: string } | { status: "missing" };

/** Resolves `ref` to a URL for an `<img>` (re-resolves when the reference or the variant changes). Default: the fast preview. */
export function useShotUrl(ref: ScreenshotRef | null | undefined, variant: ShotVariant = "preview"): ShotUrlState {
  const id = ref ? `${variant}:${ref.store}:${ref.key ?? ref.url ?? ""}:${localKeyOf(ref) ?? ""}` : "";
  const [state, setState] = useState<{ id: string; s: ShotUrlState }>({ id: "", s: { status: "loading" } });
  useEffect(() => {
    if (!ref) return;
    let alive = true;
    void shotUrl(ref, variant).then(
      (url) => alive && setState({ id, s: url ? { status: "ok", url } : { status: "missing" } }),
      () => alive && setState({ id, s: { status: "missing" } }),
    );
    return () => {
      alive = false;
    };
    // `id` captures everything of `ref` and `variant` that changes the URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!ref) return { status: "missing" };
  return state.id === id ? state.s : { status: "loading" };
}

/** "Lokal" / "Cloud" / "Link" / "Nur Sitzung" badge text. */
export function shotPlace(ref: ScreenshotRef): string {
  if (ref.store === "url") return "Link";
  const s = shotStorageOf(ref);
  return s === "cloud" ? "Cloud" : s === "ram" ? "Nur Sitzung" : "Lokal";
}
