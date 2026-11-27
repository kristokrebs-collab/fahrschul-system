/**
 * Minimal MCP client (streamable HTTP, JSON-RPC 2.0) for the read test of the TradingView connection (Paket B3).
 * It can do exactly three things – `initialize`, `tools/list` and `tools/call` of a READ-ONLY tool – and refuses every other tool name:
 * the app never creates, changes or deletes anything in the user's TradingView account (alerts and watchlists can be written by other
 * tools of that server; they are not on `READ_ONLY_TOOLS`, so `callTool` throws before a request is made).
 * Tool names are from https://www.tradingview.com/mcp/docs ("Read-only" / "Write" are marked there; we use the read-only ones only).
 * Responses may be JSON or a short event stream (`text/event-stream`); both are read, the body is capped. The token is only ever sent in
 * the Authorization header of requests to the configured server URL.
 */
import { TvMcpError, type FetchLike } from "./oauth";

/** The read-only tools of the server this app may call. Write tools (create_alert, update_alert, delete_alert, …) are NOT in this list. */
export const READ_ONLY_TOOLS: readonly string[] = ["list_watchlists", "get_watchlist", "get_active_watchlist", "search_symbols", "get_ohlcv", "get_symbol_data", "get_technicals_rating", "list_alerts", "get_alerts"];

const PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 256 * 1024;

interface Rpc {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

/** First JSON-RPC message with `id` out of a body that is JSON or a `data:` event stream. */
export function parseRpc(contentType: string, text: string, id: number): Rpc | null {
  if (/text\/event-stream/i.test(contentType)) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        const m = JSON.parse(data) as Rpc;
        if (m && m.id === id) return m;
      } catch {
        /* not a message */
      }
    }
    return null;
  }
  try {
    const m = JSON.parse(text) as Rpc | Rpc[];
    return (Array.isArray(m) ? m.find((x) => x.id === id) : m) ?? null;
  } catch {
    return null;
  }
}

/** The one German sentence for an HTTP status of the MCP server. */
function statusError(status: number): TvMcpError {
  if (status === 401) return new TvMcpError("token_rejected", "TradingView hat den Zugang abgelehnt – er ist abgelaufen oder du hast ihn widerrufen. Verbinde neu.");
  if (status === 403) return new TvMcpError("plan_required", "TradingView verweigert den Zugriff. Laut TradingView ist der MCP-Zugang ab dem Tarif Essential enthalten, Testzeiträume nicht – prüfe deinen Tarif bei TradingView.");
  if (status === 429) return new TvMcpError("rate_limited", "TradingView begrenzt die Abrufe (laut TradingView etwa 100 pro Minute). Versuche es gleich noch einmal.");
  return new TvMcpError("mcp_failed", `Der TradingView-MCP-Server hat mit Status ${status} geantwortet.`);
}

export class McpSession {
  private nextId = 1;
  private sessionId: string | null = null;

  constructor(
    private readonly url: string,
    private readonly accessToken: string,
    private readonly f: FetchLike,
  ) {}

  private async post(body: unknown, expectReply: number | null): Promise<Rpc | null> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    const res = await this.f(this.url, { method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => {
      throw new TvMcpError("mcp_failed", "Der TradingView-MCP-Server ist gerade nicht erreichbar.");
    });
    if (!res.ok) throw statusError(res.status);
    const sid = res.headers.get("mcp-session-id");
    if (sid && /^[\x21-\x7e]{1,200}$/.test(sid)) this.sessionId = sid;
    if (expectReply === null) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new TvMcpError("mcp_failed", "Die Antwort des TradingView-MCP-Servers war zu groß.");
    const msg = parseRpc(res.headers.get("content-type") ?? "", text, expectReply);
    if (!msg) throw new TvMcpError("mcp_failed", "Die Antwort des TradingView-MCP-Servers war nicht lesbar.");
    if (msg.error) throw new TvMcpError("mcp_failed", "Der TradingView-MCP-Server hat die Anfrage abgelehnt.");
    return msg;
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const msg = await this.post({ jsonrpc: "2.0", id, method, params }, id);
    return msg?.result;
  }

  async initialize(): Promise<void> {
    await this.request("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "trading-journal", version: "1" } });
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, null);
  }

  /** Names of the tools the server offers (a count and a check, nothing is called). */
  async listTools(): Promise<string[]> {
    const r = (await this.request("tools/list", {})) as { tools?: { name?: unknown }[] } | undefined;
    return (r?.tools ?? []).map((t) => (typeof t.name === "string" ? t.name : "")).filter(Boolean);
  }

  /** Calls a READ-ONLY tool. Any other name throws before a request is made. */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; json: unknown }> {
    if (!READ_ONLY_TOOLS.includes(name)) throw new TvMcpError("tool_not_allowed", "Dieser Aufruf ist in der App nicht erlaubt: sie liest nur.");
    const r = (await this.request("tools/call", { name, arguments: args })) as { isError?: boolean; content?: { type?: string; text?: unknown }[]; structuredContent?: unknown } | undefined;
    if (!r || r.isError) throw new TvMcpError("mcp_failed", "TradingView hat den Lese-Aufruf nicht beantwortet.");
    const text = (r.content ?? []).map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : "")).join("\n");
    let json: unknown = r.structuredContent ?? null;
    if (json === null) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { text, json };
  }

  /** Ends the MCP session (best effort, a 405 is fine). */
  async close(): Promise<void> {
    if (!this.sessionId) return;
    await this.f(this.url, { method: "DELETE", headers: { authorization: `Bearer ${this.accessToken}`, "mcp-session-id": this.sessionId }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => undefined);
  }
}

export interface ReadTestResult {
  /** how many tools the server offers */
  tools: number;
  /** how many watchlists the read returned; null when the answer was not a list we can count */
  watchlists: number | null;
}

/** The "Lese-Test": initialize → tools/list → list_watchlists (read-only). Nothing is written. */
export async function readTest(url: string, accessToken: string, f: FetchLike): Promise<ReadTestResult> {
  const s = new McpSession(url, accessToken, f);
  try {
    await s.initialize();
    const names = await s.listTools();
    const out = await s.callTool("list_watchlists", {});
    const j = out.json as unknown;
    const list = Array.isArray(j) ? j : j && typeof j === "object" && Array.isArray((j as { watchlists?: unknown }).watchlists) ? (j as { watchlists: unknown[] }).watchlists : null;
    return { tools: names.length, watchlists: list ? list.length : null };
  } finally {
    await s.close();
  }
}
