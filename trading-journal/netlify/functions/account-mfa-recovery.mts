/**
 * /api/v1/account/mfa-recovery – recovery codes for the TOTP second factor (B1). See `_lib/mfaRecovery.ts` for the design.
 *
 * - GET → `{ total, remaining, createdAt }` (no codes): signed in, aal2 if 2FA is on; 60 / 10 min.
 * - POST `{ action: "generate" }` → `{ codes: [8 × "ABCDE-FGHJK"], createdAt }` shown ONCE: needs an aal2 session AND a
 *   verified factor (409 `mfa_not_enabled` otherwise); replaces the old set; audited; 5 / h (fail closed).
 * - POST `{ action: "redeem", code }` → `{ factorsRemoved }`: the lost-device path. Needs only the password session (aal1);
 *   a valid unused code ends the TOTP factors of the account (the account then works with the password until 2FA is set up
 *   again) and is audited; wrong codes: 5 / 15 min per user (fail closed) + 20 / h per address pseudonym; one generic
 *   answer for every kind of miss (422 `invalid_code`).
 * Body ≤ 512 bytes, JSON only, zod-validated; no code or hash is ever logged or audited – only counts.
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { audit, ipRateId } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { clientIp, handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { consumeRecovery, generateRecovery, hasVerifiedFactor, INVALID_CODE, recoveryStatus, removeAllFactors, removeRecovery, restoreRecovery } from "./_lib/mfaRecovery";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";

const Body = z.discriminatedUnion("action", [z.object({ action: z.literal("generate") }), z.object({ action: z.literal("redeem"), code: z.string().min(1).max(40) })]);

export default handler(async (req, ctx) => {
  requireMethod(req, "GET", "POST");
  const ip = clientIp(req, ctx);

  if (req.method.toUpperCase() === "GET") {
    const user = await requireUser(req, { aal2: "ifEnrolled" });
    await enforceRateLimit(rateKey("mfa-recovery-status", user.id), 60, 600);
    return json(await recoveryStatus(user.id));
  }

  const body = await readJson(req, Body, { maxBytes: 512 });
  if (body.action === "generate") {
    const user = await requireUser(req, { aal2: true });
    await enforceRateLimit(rateKey("mfa-recovery-gen", user.id), 5, 3600, { failClosed: true });
    if (!(await hasVerifiedFactor(user.id))) throw new HttpError(409, "mfa_not_enabled", "Richte zuerst den Zwei-Faktor-Schutz ein, dann kannst du Wiederherstellungscodes erzeugen.");
    const out = await generateRecovery(user.id);
    await audit(user.id, "auth.mfa.recovery.generate", { count: out.codes.length }, ip);
    return json(out);
  }

  // redeem: the lost-device path – the password session is all the user has
  const user = await requireUser(req);
  await enforceRateLimit(rateKey("mfa-recovery-redeem", user.id), 5, 900, { failClosed: true });
  await enforceRateLimit(rateKey("mfa-recovery-redeem-ip", ipRateId(ip) ?? "anon"), 20, 3600, { failClosed: true });
  if (!(await hasVerifiedFactor(user.id))) throw new HttpError(409, "mfa_not_enabled", "Bei diesem Konto ist der Zwei-Faktor-Schutz nicht aktiv.");
  if (!(await consumeRecovery(user.id, body.code))) {
    await audit(user.id, "auth.mfa.recovery.failed", {}, ip);
    throw new HttpError(422, "invalid_code", INVALID_CODE);
  }
  let removed: number;
  try {
    removed = await removeAllFactors(user.id);
  } catch (e) {
    await restoreRecovery(user.id, body.code);
    throw e;
  }
  await removeRecovery(user.id);
  await audit(user.id, "auth.mfa.recovery.used", { factorsRemoved: removed }, ip);
  return json({ factorsRemoved: removed });
});

export const config: Config = { path: "/api/v1/account/mfa-recovery", method: ["GET", "POST"] };
