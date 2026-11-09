/**
 * /api/v1/audit – the signed-in user's security trail (`audit_log`).
 * - GET `?limit=1..100&before=<id>` → `{ items: [{ id, action, at, meta }], next: id | null }` (newest first).
 * - POST `{ action }` – records a security event that happened in the browser against Supabase Auth directly
 *   (sign-in, 2FA on/off, other devices signed out, password changed …). Only the actions in `CLIENT_ACTIONS`;
 *   30 per 10 minutes per user.
 * Once the user has 2FA, reading the trail and recording anything but sign-in / sign-out / password reset needs an
 * aal2 session (review SEC-01; the table itself is guarded by the same rule, 0005).
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { audit } from "./_lib/audit";
import { assertAal2, requireUser } from "./_lib/auth";
import { clientIp, handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { supabaseAdmin } from "./_lib/supabase";

/** Events the browser may record (server-side actions are written by their own functions). */
const CLIENT_ACTIONS = [
  "auth.signin",
  "auth.signout",
  "auth.signout.all",
  "auth.mfa.enroll",
  "auth.mfa.unenroll",
  "auth.mfa.verify",
  "auth.sessions.revoke",
  "auth.password.change",
  "auth.password.reset",
  "privacy.update",
  "sync.first",
] as const;

/**
 * Events that legitimately happen while a 2FA account is still at aal1 (password step done, code not yet entered):
 * recording them must not need the code. Everything else – and reading the trail – needs aal2 once 2FA is on.
 */
const PRE_STEP_UP: ReadonlySet<string> = new Set(["auth.signin", "auth.signout", "auth.password.reset"]);

const Body = z.object({ action: z.enum(CLIENT_ACTIONS), meta: z.record(z.union([z.string().max(80), z.boolean()])).optional() });

export default handler(async (req, ctx) => {
  requireMethod(req, "GET", "POST");
  if (req.method.toUpperCase() === "POST") {
    const user = await requireUser(req);
    await enforceRateLimit(rateKey("audit", user.id), 30, 600);
    const body = await readJson(req, Body, { maxBytes: 2048 });
    if (!PRE_STEP_UP.has(body.action)) await assertAal2(user);
    await audit(user.id, body.action, body.meta ?? {}, clientIp(req, ctx));
    return json({ ok: true }, { status: 201 });
  }
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const before = Number(url.searchParams.get("before") ?? "");
  let q = supabaseAdmin().from("audit_log").select("id,action,meta,at").eq("user_id", user.id).order("id", { ascending: false }).limit(limit + 1);
  if (Number.isInteger(before) && before > 0) q = q.lt("id", before);
  const { data, error } = await q;
  if (error) {
    console.error("[fn] audit read failed", error.code);
    throw new HttpError(502, "db_unavailable", "Die Datenbank antwortet gerade nicht.");
  }
  const rows = (data ?? []) as { id: number; action: string; meta: unknown; at: string }[];
  const items = rows.slice(0, limit);
  return json({ items, next: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null });
});

export const config: Config = { path: "/api/v1/audit", method: ["GET", "POST"] };
