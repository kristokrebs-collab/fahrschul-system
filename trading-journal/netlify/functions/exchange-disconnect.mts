/**
 * POST /api/v1/exchange/disconnect `{ connectionId }` → `{ ok: true }` (P11). Deletes the stored key (and with it the
 * sync cursor, `on delete cascade`); the sync history stays without the connection. Imported trades stay in the journal
 * – they are the trader's records now. The key itself must also be deleted at the exchange (the UI says so).
 * aal2 when 2FA is on.
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { audit } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { clientIp, handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { deleteConnection, listConnections } from "./_lib/exchanges/store";

const Body = z.object({ connectionId: z.string().uuid() });

export default handler(async (req, ctx) => {
  requireMethod(req, "POST");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  await enforceRateLimit(rateKey("exchange-disconnect", user.id), 20, 600);
  const { connectionId } = await readJson(req, Body, { maxBytes: 512 });
  const own = (await listConnections(user.id)).find((c) => c.id === connectionId);
  if (!own || !(await deleteConnection(user.id, connectionId))) throw new HttpError(404, "connection_not_found", "Diese Verbindung gibt es nicht (mehr).");
  await audit(user.id, "exchange.disconnect", { exchange: own.exchange, last4: own.key_last4 }, clientIp(req, ctx));
  return json({ ok: true });
});

export const config: Config = { path: "/api/v1/exchange/disconnect", method: ["POST"] };
