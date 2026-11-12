/**
 * Ends the user's TradingView-MCP connection: revokes the refresh and the access token at TradingView (best effort – the provider may be
 * down, or have no revocation endpoint) and deletes the tokens here. Shared by the "Trennen" button (`connections-tradingview-mcp.mts`)
 * and the account deletion (`account-delete.mts`, Runde 11, Linse 3 #7: deleting the account left the OAuth tokens alive at TradingView).
 * Never throws; never logs a token. Returns whether TradingView confirmed a revocation.
 */
import { tvMcpConfig } from "./config";
import { discover, revokeToken } from "./oauth";
import { deleteConnection, storedTokens } from "./store";
import { mcpFetch } from "./status";

export async function disconnectTvMcp(userId: string): Promise<{ revoked: boolean; hadConnection: boolean }> {
  let revoked = false;
  const c = tvMcpConfig();
  const tokens = await storedTokens(userId).catch(() => null);
  if (c.ok && tokens) {
    try {
      const f = mcpFetch();
      const meta = await discover(c.config.resourceUrl, f);
      const r = tokens.refresh ? await revokeToken(meta, c.config, tokens.refresh, "refresh_token", f) : false;
      const a = tokens.access ? await revokeToken(meta, c.config, tokens.access, "access_token", f) : false;
      revoked = r || a;
    } catch {
      revoked = false;
    }
  }
  await deleteConnection(userId).catch(() => undefined);
  return { revoked, hadConnection: !!tokens };
}
