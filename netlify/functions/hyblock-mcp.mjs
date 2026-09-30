// Hyblock-Connector für claude.ai: ein schlanker MCP-Server (Streamable HTTP, zustandslos, JSON-Antworten).
// Der Hyblock-API-Key bleibt serverseitig (Netlify-Umgebungsvariable HYBLOCK_API_KEY).
// Die Adresse ist durch einen geheimen Pfad-Token geschützt: /hyblock-mcp/<HYBLOCK_MCP_TOKEN>
//
// Einrichten (Netlify → Site configuration → Environment variables):
//   HYBLOCK_API_KEY     = dein Hyblock-API-Key (x-api-key)
//   HYBLOCK_MCP_TOKEN   = eine lange Zufallszeichenkette (z. B. 40 Zeichen)
// In claude.ai → Einstellungen → Connectors → Eigenen Connector hinzufügen:
//   URL: https://<deine-netlify-domain>/hyblock-mcp/<HYBLOCK_MCP_TOKEN>

const BASE = 'https://api.hyblockcapital.com/v2';
const PROTOCOL = '2025-06-18';

const TOOLS = [
  {
    name: 'hyblock_get',
    title: 'Hyblock-Daten abrufen',
    description:
      'Ruft einen GET-Endpunkt der Hyblock Capital API v2 ab, z. B. Top-Trader-Long/Short-Verhältnis oder Whale-vs-Retail-Delta. ' +
      '`endpoint` ist der Pfad ohne /v2 (z. B. "topTraderAccountsLongShort"), `params` sind die Query-Parameter aus der Hyblock-Doku ' +
      '(z. B. coin, exchange, timeframe, limit). Gibt die JSON-Antwort unverändert zurück.',
    inputSchema: {
      type: 'object',
      properties: {
        endpoint: { type: 'string', description: 'API-Pfad ohne /v2, nur Buchstaben, Ziffern, _, - und /' },
        params: { type: 'object', description: 'Query-Parameter', additionalProperties: { type: ['string', 'number', 'boolean'] } },
      },
      required: ['endpoint'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'hyblock_status',
    title: 'Verbindung prüfen',
    description: 'Prüft, ob der Connector eingerichtet ist (API-Key gesetzt). Ruft die Hyblock-API nicht auf.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
];

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const toolText = (obj, isError = false) => ({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
  ...(typeof obj === 'object' && obj !== null && !Array.isArray(obj) ? { structuredContent: obj } : {}),
  ...(isError ? { isError: true } : {}),
});

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function callHyblock(args, env = process.env, fetchImpl = fetch) {
  const key = env.HYBLOCK_API_KEY;
  if (!key) return toolText({ error: 'not_configured', message: 'HYBLOCK_API_KEY ist auf Netlify nicht gesetzt.' }, true);
  const endpoint = String(args?.endpoint || '').replace(/^\/+/, '').replace(/^v2\//, '');
  if (!/^[A-Za-z0-9_\-/]{1,80}$/.test(endpoint) || endpoint.includes('..')) return toolText({ error: 'bad_endpoint', message: 'Ungültiger Endpunkt.' }, true);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(args?.params || {})) {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(k) || !['string', 'number', 'boolean'].includes(typeof v)) return toolText({ error: 'bad_params', message: `Ungültiger Parameter: ${k}` }, true);
    qs.set(k, String(v));
  }
  const url = `${BASE}/${endpoint}${qs.size ? '?' + qs : ''}`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'x-api-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    return toolText({ error: 'network', message: 'Hyblock nicht erreichbar.' }, true);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 2000) }; }
  if (!res.ok) return toolText({ error: 'http_' + res.status, status: res.status, endpoint, body: data }, true);
  return toolText(Array.isArray(data) ? { data } : data);
}

async function handleRpc(msg, env, fetchImpl) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid Request');
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case 'initialize':
      return rpcResult(msg.id, {
        protocolVersion: msg.params?.protocolVersion || PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'hyblock', title: 'Hyblock Capital', version: '1.0.0' },
        instructions: 'Hyblock-Capital-Daten (Top Trader, Whale vs Retail, Liquidationen). Nur lesend.',
      });
    case 'ping':
      return isNotification ? null : rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: TOOLS });
    case 'tools/call': {
      const name = msg.params?.name;
      if (name === 'hyblock_status') return rpcResult(msg.id, toolText({ configured: !!env.HYBLOCK_API_KEY, base: BASE }));
      if (name === 'hyblock_get') return rpcResult(msg.id, await callHyblock(msg.params?.arguments, env, fetchImpl));
      return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
    }
    default:
      if (isNotification) return null; // z. B. notifications/initialized
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handle(req, token, env = process.env, fetchImpl = fetch) {
  if (!env.HYBLOCK_MCP_TOKEN || !safeEqual(token || '', env.HYBLOCK_MCP_TOKEN)) return new Response('Not found', { status: 404 });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  let body;
  try { body = await req.json(); } catch { return json(rpcError(null, -32700, 'Parse error'), 400); }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleRpc(m, env, fetchImpl)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const out = await handleRpc(body, env, fetchImpl);
  return out ? json(out) : new Response(null, { status: 202 });
}

export default async (req, context) => handle(req, context.params?.token);

export const config = { path: '/hyblock-mcp/:token' };
