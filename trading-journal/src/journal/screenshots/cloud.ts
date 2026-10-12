/**
 * Screenshots in Supabase Storage (Journal v3, P06 on the P09 cloud): bucket `screenshots` (private), object path
 * `<auth.uid()>/<file>` – the row-level policies of `supabase/migrations/0001_core.sql` let a user read / write only
 * below the own folder. Display goes through short-lived signed URLs (cached until shortly before they expire).
 *
 * Everything degrades: without a configured cloud or while signed out the helpers report `null` / `false` and the
 * screenshot simply stays local (`store: "idb"`). The Supabase chunk is loaded lazily (`ensureCloud()`).
 */
import { cloudEnabled, ensureCloud, useCloudSession } from "@/cloud";

export const SHOTS_BUCKET = "screenshots";
/** Signed URLs live this long (s); they are renewed a minute before. */
const SIGNED_TTL_S = 3600;

/** A signed-in user id when the cloud is usable right now, else `null`. */
export function cloudShotOwner(): string | null {
  if (!cloudEnabled()) return null;
  const s = useCloudSession.getState();
  return s.phase === "signedIn" && s.user ? s.user.id : null;
}

/** File extension of a mime type. */
function extOf(mime: string): string {
  if (mime === "image/webp") return "webp";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/gif") return "gif";
  return "png";
}

/** Uploads a blob for the signed-in user; resolves the object path, or `null` (no cloud, signed out, refused). */
export async function uploadShot(blob: Blob, id: string, mime = blob.type || "image/png"): Promise<string | null> {
  const uid = cloudShotOwner();
  if (!uid) return null;
  try {
    const m = await ensureCloud();
    const path = `${uid}/${id}.${extOf(mime)}`;
    const { error } = await m.getClient().storage.from(SHOTS_BUCKET).upload(path, blob, { contentType: mime, upsert: true, cacheControl: "31536000" });
    return error ? null : path;
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

/** Removes a cloud object (best effort). */
export async function deleteCloudShot(path: string): Promise<boolean> {
  signed.delete(path);
  if (!cloudShotOwner()) return false;
  try {
    const m = await ensureCloud();
    const { error } = await m.getClient().storage.from(SHOTS_BUCKET).remove([path]);
    return !error;
  } catch {
    return false;
  }
}
