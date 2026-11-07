/**
 * POST  /api/v1/exchange/connect `{ exchange, apiKey, secret, passphrase?, label?, journalAccount, readOnlyConfirmed }`
 *       → `{ connection, account }` (P11). Validates the key with one read-only call (Bitunix: GET /api/v1/futures/account),
 *       which proves it can read – Bitunix cannot report whether a key may also trade or withdraw, so `permissions` stays
 *       `[]` and the read-only promise rests on the user's confirmation (`readOnlyConfirmed`). Then stores key + secret
 *       AES-256-GCM encrypted (AAD `<user>:<connection>:<field>`, `_lib/crypto.ts`). Only the
 *       last 4 characters of the key ever leave the server again.
 * PATCH /api/v1/exchange/connect `{ connectionId, journalAccount?, syncEnabled?, label? }` → `{ connection }`.
 *
 * Binance (API-key route, read only): the body also carries `market` (`spot` | `futures`, one connection each), optional
 * `symbols` (spot: extra pairs) and `acceptWarnings`. The key's rights are READ from Binance first
 * (`/sapi/v1/account/apiRestrictions`): withdrawal / transfer / trading rights → 422 `rights_refused` (key not stored);
 * Futures access (Binance has no read-only futures flag) → 409 `rights_confirm` until `acceptWarnings: true`.
 * `details.issues` lists the findings in German.
 *
 * aal2 when 2FA is on; 10 attempts per 10 min (fail-closed); plan: a connection limit above 0 (`exchangeConnections`,
 * Free: one manual connection) or the `exchangeSync` feature. Request bodies are never logged.
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { audit } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { clientIp, handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { requireLimit } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { exchangeHttpError, requireExchangeAccess, requireExchangeSetup } from "./_lib/exchanges/api";
import { cleanSymbols } from "./_lib/exchanges/binance";
import { adapterFor, keyRights } from "./_lib/exchanges/registry";
import { connectionInfo, insertConnection, listConnections, updateConnection } from "./_lib/exchanges/store";
import { EXCHANGE_IDS, EXCHANGE_MARKETS, type ExchangeCredentials, type ExchangeMarket } from "./_lib/exchanges/types";

const KEY = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9_\-.=+/]+$/);

const ConnectBody = z.object({
  exchange: z.enum(EXCHANGE_IDS as unknown as [string, ...string[]]),
  apiKey: KEY,
  secret: KEY,
  passphrase: z.string().trim().max(200).optional(),
  label: z.string().trim().max(40).optional(),
  journalAccount: z.enum(["makro", "scalp"]).default("scalp"),
  readOnlyConfirmed: z.literal(true),
  market: z.enum(EXCHANGE_MARKETS as unknown as [string, ...string[]]).optional(),
  symbols: z.array(z.string().trim().min(5).max(20)).max(30).optional(),
  acceptWarnings: z.boolean().optional(),
});

const PatchBody = z
  .object({
    connectionId: z.string().uuid(),
    journalAccount: z.enum(["makro", "scalp"]).optional(),
    syncEnabled: z.boolean().optional(),
    label: z.string().trim().max(40).optional(),
    symbols: z.array(z.string().trim().min(5).max(20)).max(30).optional(),
  })
  .refine((b) => b.journalAccount !== undefined || b.syncEnabled !== undefined || b.label !== undefined || b.symbols !== undefined);

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
    if (body.symbols !== undefined && own.exchange === "binance" && (own.meta as { market?: unknown } | null)?.market === "spot") {
      patch.meta = { ...(own.meta ?? {}), symbols: cleanSymbols(body.symbols) };
    }
    await updateConnection(user.id, own.id, patch);
    return json({ connection: connectionInfo({ ...own, ...patch }) });
  }

  requireExchangeSetup();
  const body = await readJson(req, ConnectBody, { maxBytes: 2048 });
  const exchange = body.exchange as (typeof EXCHANGE_IDS)[number];
  await requireExchangeAccess(user.id);
  const existing = await listConnections(user.id);
  await requireLimit(user.id, "exchangeConnections", existing.length);
  const market = (exchange === "binance" ? (body.market ?? null) : null) as ExchangeMarket | null;
  if (exchange === "binance" && !market) throw new HttpError(422, "market_required", "Bitte wähle Spot oder Futures – das sind bei Binance zwei getrennte Verbindungen.");
  // Binance: spot and futures are two connections side by side – the default name keeps them apart
  const label = body.label ?? (exchange === "binance" ? (market === "spot" ? "Spot" : "Futures") : "");
  if (existing.some((c) => c.exchange === exchange && (c.label ?? "") === label)) {
    throw new HttpError(409, "connection_exists", "Diese Börse ist schon verbunden. Trenne die alte Verbindung zuerst oder gib einen anderen Namen.");
  }

  const creds: ExchangeCredentials = { apiKey: body.apiKey, secret: body.secret };
  if (body.passphrase) creds.passphrase = body.passphrase;
  let account;
  let permissions: string[] = [];
  try {
    // 1. the key's rights (Binance reports them): a key that could withdraw, transfer or trade is refused BEFORE it is stored
    const verdict = await keyRights(exchange, creds, market);
    if (verdict) {
      if (!verdict.ok) {
        throw new HttpError(422, "rights_refused", verdict.issues.find((i) => i.level === "block")?.text ?? "Dieser Key hat zu viele Rechte.", { issues: verdict.issues });
      }
      if (verdict.needsConfirm && !body.acceptWarnings) {
        throw new HttpError(409, "rights_confirm", verdict.issues.find((i) => i.level === "warn")?.text ?? "Bitte bestätige die Key-Rechte.", { issues: verdict.issues });
      }
      permissions = verdict.permissions;
    }
    // 2. one cheap private read proves the key works for this market
    account = await adapterFor(exchange, creds, { market }).validate();
  } catch (e) {
    throw exchangeHttpError(e);
  }

  // Bitunix offers no way to read a key's rights (review EX-01): the validation call only proves it can READ – trade /
  // withdraw rights stay unknown, so nothing is claimed (the user confirmed "read-only", the UI says exactly that)
  const meta: Record<string, unknown> = {};
  if (market) meta.market = market;
  if (market === "spot") {
    const symbols = cleanSymbols(body.symbols);
    if (symbols.length) meta.symbols = symbols;
  }
  const row = await insertConnection({ userId: user.id, exchange, label, creds, journalAccount: body.journalAccount, permissions, ...(Object.keys(meta).length ? { meta } : {}) });
  await audit(user.id, "exchange.connect", { exchange, market, last4: row.key_last4 }, clientIp(req, ctx));
  return json(
    {
      connection: connectionInfo(row),
      account: { marginCoin: account.marginCoin, available: account.available, margin: account.margin, unrealizedPnl: account.unrealizedPnl },
    },
    { status: 201 },
  );
});

export const config: Config = { path: "/api/v1/exchange/connect", method: ["POST", "PATCH"] };
