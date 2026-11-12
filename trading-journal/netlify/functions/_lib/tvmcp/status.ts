/**
 * What the card shows about the TradingView MCP connection (Paket B3) and the network seam the tests replace.
 * `configured: false` = the operator has not set it up ("Einrichtung nötig (Betreiber)"); the missing variable's name is NOT sent to users.
 */
import type { FetchLike } from "./oauth";
import { tvMcpConfig } from "./config";
import { connectionInfo, NO_CONNECTION, type McpConnectionInfo } from "./store";

let fetchImpl: FetchLike | null = null;
/** The `fetch` used for every call towards TradingView (tests inject a mock server; `null` restores the real one). */
export function setTvMcpFetchForTests(f: FetchLike | null): void {
  fetchImpl = f;
}
export const mcpFetch = (): FetchLike => fetchImpl ?? ((url, init) => fetch(url, init));

export interface McpStatus extends McpConnectionInfo {
  configured: boolean;
  /** host of the server the connection talks to, for the card ("mcp.tradingview.com") */
  host: string | null;
}

export async function mcpStatus(userId: string): Promise<McpStatus> {
  const c = tvMcpConfig();
  if (!c.ok) return { ...NO_CONNECTION, configured: false, host: null };
  return { ...(await connectionInfo(userId)), configured: true, host: new URL(c.config.resourceUrl).host };
}
