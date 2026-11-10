/**
 * Screenshots in Supabase Storage (Journal v3, P06 on the P09 cloud): bucket `screenshots` (private), object path
 * `<auth.uid()>/<file>` – the row-level policies of `supabase/migrations/0001_core.sql` (+ the aal2 rule of 0005) let a
 * user read / write only below the own folder, and with 2FA on only after the code step. Display goes through short-lived signed URLs (cached until shortly before they expire).
 *
 * Everything degrades: without a configured cloud or while signed out the helpers report `null` / `false` and the
 * screenshot simply stays local (`store: "idb"`). The Supabase chunk is loaded lazily (`ensureCloud()`).
 */
import { entitledNow } from "@/billing/entitlements";
import { cloudEnabled, ensureCloud, useCloudSession } from "@/cloud";

export const SHOTS_BUCKET = "screenshots";
/** Signed URLs live this long (s); they are renewed a minute before. */
const SIGNED_TTL_S = 3600;

/**
 * A signed-in user id when the cloud is usable right now and the plan stores screenshots there (`screenshotsCloud`,
 * `src/billing/plans.ts` – without payments always), else `null`: the screenshot stays on this device. A 2FA account
 * before its code step (`needsMfa`) counts as signed out – the bucket refuses that session anyway.
 */
export function cloudShotOwner(): string | null {
  if (!cloudEnabled() || !entitledNow("screenshotsCloud")) return null;
  const s = useCloudSession.getState();
  return s.phase === "signedIn" && s.user && !s.needsMfa ? s.user.id : null;
}

/** File extension of a mime type. */
function extOf(mime: string): string {
  if (mime === "image/webp") return "webp";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/gif") return "gif";
  return "png";
}

/**
 * Limits of the bucket (migration 0007, review STOR-01): anything else stays on this device instead of failing. The
 * original is uploaded byte for byte (A2), so a picture over the limit is NOT shrunk to fit – it stays on this device
 * and the editor says why.
 */
export const CLOUD_SHOT_MAX_BYTES = 5 * 1024 * 1024;
export const CLOUD_SHOT_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Why an upload did not happen: no cloud / not signed in / plan (`unavailable`), too big, wrong type, or it failed. */
export type UploadProblem = "unavailable" | "tooLarge" | "type" | "failed";

export type UploadResult = { ok: true; path: string } | { ok: false; problem: UploadProblem };

/** German line per problem that deserves telling the trader (`unavailable` is silent: nothing was promised). */
export const UPLOAD_MESSAGES: Record<Exclude<UploadProblem, "unavailable">, string> = {
  tooLarge: "Größer als das Cloud-Limit von 5 MB: Das Original bleibt unverändert auf diesem Gerät.",
  type: "Dieses Bildformat nimmt die Cloud nicht an: Das Original bleibt unverändert auf diesem Gerät.",
  failed: "Cloud-Upload fehlgeschlagen: Das Original bleibt unverändert auf diesem Gerät.",
};

/** Uploads the bytes of `blob` unchanged for the signed-in user and says what happened. */
export async function uploadShotChecked(blob: Blob, id: string, mime = blob.type || "image/png"): Promise<UploadResult> {
  const uid = cloudShotOwner();
  if (!uid) return { ok: false, problem: "unavailable" };
  if (blob.size > CLOUD_SHOT_MAX_BYTES) return { ok: false, problem: "tooLarge" };
  if (!CLOUD_SHOT_TYPES.includes(mime)) return { ok: false, problem: "type" };
  try {
    const m = await ensureCloud();
    const path = `${uid}/${id}.${extOf(mime)}`;
    const { error } = await m.getClient().storage.from(SHOTS_BUCKET).upload(path, blob, { contentType: mime, upsert: true, cacheControl: "31536000" });
    return error ? { ok: false, problem: "failed" } : { ok: true, path };
  } catch {
    return { ok: false, problem: "failed" };
  }
}

/** Uploads a blob for the signed-in user; resolves the object path, or `null` (no cloud, signed out, refused). */
export async function uploadShot(blob: Blob, id: string, mime = blob.type || "image/png"): Promise<string | null> {
  const r = await uploadShotChecked(blob, id, mime);
  return r.ok ? r.path : null;
}

/** The bytes of a cloud object through a fresh signed link (`null` when signed out, gone or the download failed). */
export async function downloadCloudShot(path: string): Promise<Blob | null> {
  signed.delete(path);
  const url = await cloudShotUrl(path);
  if (!url) return null;
  try {
    const res = await fetch(url);
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

const signed = new Map<string, { url: string; until: number }>();

/** Signed display URL of a cloud object (`null` when signed out / not allowed). */
export async function cloudShotUrl(path: string): Promise<string | null> {
  const hit = signed.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  if (!cloudShotOwner()) return null;
  try {
    const m = await ensureCloud();
    const { data, error } = await m.getClient().storage.from(SHOTS_BUCKET).createSignedUrl(path, SIGNED_TTL_S);
    if (error || !data?.signedUrl) return null;
    signed.set(path, { url: data.signedUrl, until: Date.now() + (SIGNED_TTL_S - 60) * 1000 });
    return data.signedUrl;
  } catch {
    return null;
  }
}

/**
 * The signed-in user (2FA satisfied) whatever the plan: removing one's own pictures must keep working after a
 * downgrade (the bucket policies only check the folder).
 */
function signedInUid(): string | null {
  if (!cloudEnabled()) return null;
  const s = useCloudSession.getState();
  return s.phase === "signedIn" && s.user && !s.needsMfa ? s.user.id : null;
}

/** Removes a cloud object of the signed-in user (best effort; another user's folder is never touched). */
export async function deleteCloudShot(path: string): Promise<boolean> {
  signed.delete(path);
  const uid = signedInUid();
  if (!uid || !path.startsWith(`${uid}/`)) return false;
  try {
    const m = await ensureCloud();
    const { error } = await m.getClient().storage.from(SHOTS_BUCKET).remove([path]);
    return !error;
  } catch {
    return false;
  }
}
