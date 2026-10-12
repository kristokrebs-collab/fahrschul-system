/**
 * POST  /api/v1/exchange/connect `{ exchange, apiKey, secret, passphrase?, label?, journalAccount, readOnlyConfirmed }`
 *       → `{ connection, account }` (P11). Validates the key with one read-only call (Bitunix: GET /api/v1/futures/account),
 *       then stores key + secret AES-256-GCM encrypted (AAD `<user>:<connection>:<field>`, `_lib/crypto.ts`). Only the
 *       last 4 characters of the key ever leave the server again.
 * PATCH /api/v1/exchange/connect `{ connectionId, journalAccount?, syncEnabled?, label? }` → `{ connection }`.
 *
 * aal2 when 2FA is on; 10 attempts per 10 min (fail-closed); plan: `exchangeSync` + `exchangeConnections` limit. Request
 * bodies are never logged.
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { audit } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { clientIp, handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { requireFeature, requireLimit } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { exchangeHttpError, requireExchangeSetup } from "./_lib/exchanges/api";
import { adapterFor } from "./_lib/exchanges/registry";
import { connectionInfo, insertConnection, listConnections, updateConnection } from "./_lib/exchanges/store";
import { EXCHANGE_IDS, type ExchangeCredentials } from "./_lib/exchanges/types";

const KEY = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9_\-.=+/]+$/);

const ConnectBody = z.object({
  exchange: z.enum(EXCHANGE_IDS as unknown as [string, ...string[]]),
  apiKey: KEY,
  secret: KEY,
  passphrase: z.string().trim().max(200).optional(),
  label: z.string().trim().max(40).optional(),
  journalAccount: z.enum(["makro", "scalp"]).default("scalp"),
  readOnlyConfirmed: z.literal(true),
});

const PatchBody = z
  .object({
    connectionId: z.string().uuid(),
    journalAccount: z.enum(["makro", "scalp"]).optional(),
    syncEnabled: z.boolean().optional(),
    label: z.string().trim().max(40).optional(),
  })
  .refine((b) => b.journalAccount !== undefined || b.syncEnabled !== undefined || b.label !== undefined);

export default handler(async (req, ctx) => {
  requireMethod(req, "POST", "PATCH");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  await enforceRateLimit(rateKey("exchange-connect", user.id), 10, 600, { failClosed: true });

  if (req.method.toUpperCase() === "PATCH") {
    const body = await readJson(req, PatchBody, { maxBytes: 1024 });
    const own = (await listConnections(user.id)).find((c) => c.id === body.connectionId);
    if (!own) throw new HttpError(404, "connection_not_found", "Diese Verbindung gibt es nicht (mehr).");
    const patch: Parameters<typeof updateConnection>[2] = {};
    if (body.journalAccount) patch.journal_account = body.journalAccount;
    if (body.syncEnabled !== undefined) patch.sync_enabled = body.syncEnabled;
    if (body.label !== undefined) patch.label = body.label;
    await updateConnection(user.id, own.id, patch);
    return json({ connection: connectionInfo({ ...own, ...patch }) });
  }

  requireExchangeSetup();
  const body = await readJson(req, ConnectBody, { maxBytes: 2048 });
  const exchange = body.exchange as (typeof EXCHANGE_IDS)[number];
  await requireFeature(user.id, "exchangeSync");
  const existing = await listConnections(user.id);
  await requireLimit(user.id, "exchangeConnections", existing.length);
  const label = body.label ?? "";
  if (existing.some((c) => c.exchange === exchange && (c.label ?? "") === label)) {
    throw new HttpError(409, "connection_exists", "Diese Börse ist schon verbunden. Trenne die alte Verbindung zuerst oder gib einen anderen Namen.");
  }

  const creds: ExchangeCredentials = { apiKey: body.apiKey, secret: body.secret };
  if (body.passphrase) creds.passphrase = body.passphrase;
  let account;
  try {
    account = await adapterFor(exchange, creds).validate();
  } catch (e) {
    throw exchangeHttpError(e);
  }

  const row = await insertConnection({ userId: user.id, exchange, label, creds, journalAccount: body.journalAccount, permissions: ["read"] });
  await audit(user.id, "exchange.connect", { exchange, last4: row.key_last4 }, clientIp(req, ctx));
  return json(
    {
      connection: connectionInfo(row),
      account: { marginCoin: account.marginCoin, available: account.available, margin: account.margin, unrealizedPnl: account.unrealizedPnl },
    },
    { status: 201 },
  );
});

export const config: Config = { path: "/api/v1/exchange/connect", method: ["POST", "PATCH"] };
