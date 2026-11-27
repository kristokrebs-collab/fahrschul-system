/**
 * Operator configuration of the TradingView MCP connection (Paket B3). Without `TV_MCP_CLIENT_ID` (+ `SITE_ORIGIN` for the redirect address)
 * the connection is "Einrichtung nötig (Betreiber)": the hub says so, nothing is started. Names and meaning: docs/ENV.md.
 *
 *   TV_MCP_CLIENT_ID      OAuth client id the operator got when registering the app with TradingView (required)
 *   TV_MCP_CLIENT_SECRET  only for a confidential client; a public client (PKCE) leaves it empty
 *   TV_MCP_URL            server URL, default https://mcp.tradingview.com/mcp (the address in TradingView's own docs)
 *   TV_MCP_SCOPES         default "mcp:read mcp:tools" (the two scopes the server lists)
 *   SITE_ORIGIN           https origin of this site; the redirect address is SITE_ORIGIN + /api/v1/connections/tradingview/mcp/callback
 */
import { envOptional } from "../env";
import { DEFAULT_RESOURCE_URL, DEFAULT_SCOPE, type OAuthConfig } from "./oauth";

export const CALLBACK_PATH = "/api/v1/connections/tradingview/mcp/callback";

export interface TvMcpConfig extends OAuthConfig {
  siteOrigin: string;
}

const httpsOrigin = (v: string | undefined): string | null => {
  const t = v?.trim().replace(/\/+$/, "");
  return t && /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(t) ? t : null;
};

/** The configuration, or the reason in words (for the operator) why there is none. */
export function tvMcpConfig(): { ok: true; config: TvMcpConfig } | { ok: false; missing: string } {
  const clientId = envOptional("TV_MCP_CLIENT_ID")?.trim();
  if (!clientId || clientId.length > 200) return { ok: false, missing: "TV_MCP_CLIENT_ID" };
  const siteOrigin = httpsOrigin(envOptional("SITE_ORIGIN"));
  if (!siteOrigin) return { ok: false, missing: "SITE_ORIGIN" };
  const url = envOptional("TV_MCP_URL")?.trim() || DEFAULT_RESOURCE_URL;
  let resourceUrl: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.search || u.hash) throw new Error("not https");
    resourceUrl = url.replace(/\/+$/, "");
  } catch {
    return { ok: false, missing: "TV_MCP_URL" };
  }
  const scope = (envOptional("TV_MCP_SCOPES")?.trim() || DEFAULT_SCOPE).replace(/\s+/g, " ");
  if (!/^[\x21-\x7e]+( [\x21-\x7e]+)*$/.test(scope) || scope.length > 200) return { ok: false, missing: "TV_MCP_SCOPES" };
  return { ok: true, config: { clientId, clientSecret: envOptional("TV_MCP_CLIENT_SECRET")?.trim() || null, resourceUrl, scope, redirectUri: `${siteOrigin}${CALLBACK_PATH}`, siteOrigin } };
}
