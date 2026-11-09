/**
 * Share links (P12): create / list / revoke for the owner (`social-share.mts`). The public read is
 * `social-shared.mts` → `shared_payload()`.
 */
import { randomBytes } from "node:crypto";
import type { ShareInfo, SharePayload } from "../../../../src/social/contract";
import { shareTitle } from "../../../../src/social/format";
import { HttpError } from "../http";
import { dbFail, sb } from "./store";

const COLUMNS = "id,token,kind,payload,created_at,expires_at,revoked_at,views";
/** Links an account may hold (revoked ones included); the oldest revoked / expired make room. */
export const MAX_SHARES = 200;

interface ShareRow {
  id: string;
  token: string;
  kind: SharePayload["kind"];
  payload: SharePayload;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  views: number;
}

export function shareInfo(r: ShareRow): ShareInfo {
  let title = "Geteilt";
  try {
    title = shareTitle(r.payload);
  } catch {
    /* an old payload shape keeps the generic title */
  }
  return { id: r.id, token: r.token, kind: r.kind, title, createdAt: r.created_at, expiresAt: r.expires_at, revoked: !!r.revoked_at, views: r.views };
}

/** 16 random bytes, base64url → 22 characters (`shares.token` check). */
export const newShareToken = (): string => randomBytes(16).toString("base64url");

export async function listShares(userId: string): Promise<ShareInfo[]> {
  const { data, error } = await sb().from("shares").select(COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
  if (error) dbFail("shares read", error);
  return ((data ?? []) as ShareRow[]).map(shareInfo);
}

export async function createShare(userId: string, payload: SharePayload, expiresInDays: number, now = Date.now()): Promise<ShareInfo> {
  const { count, error: cErr } = await sb().from("shares").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (cErr) dbFail("shares count", cErr);
  if ((count ?? 0) >= MAX_SHARES) throw new HttpError(409, "too_many_shares", "Du hast sehr viele Links – zieh alte zurück, dann geht es weiter.");
  const row = {
    token: newShareToken(),
    user_id: userId,
    kind: payload.kind,
    payload,
    expires_at: expiresInDays > 0 ? new Date(now + expiresInDays * 86_400_000).toISOString() : null,
  };
  const { data, error } = await sb().from("shares").insert(row).select(COLUMNS).single();
  if (error || !data) dbFail("shares insert", error);
  return shareInfo(data as ShareRow);
}

export async function revokeShare(userId: string, id: string, now = Date.now()): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "share_not_found", "Diesen Link gibt es nicht.");
  const { data, error } = await sb().from("shares").update({ revoked_at: new Date(now).toISOString() }).eq("id", id).eq("user_id", userId).is("revoked_at", null).select("id");
  if (error) dbFail("shares revoke", error);
  if (!((data ?? []) as unknown[]).length) throw new HttpError(404, "share_not_found", "Diesen Link gibt es nicht (mehr).");
}
