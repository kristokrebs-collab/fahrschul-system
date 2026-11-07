// @vitest-environment node
/**
 * A fake Binance for the Verbindungen tests. The payload SHAPES follow the official docs (developers.binance.com: numbers
 * as strings, `buyer` / `isBuyer`, `positionSide`, `realizedPnl`, income rows …) – they are NOT recordings of the live
 * exchange (the sandbox cannot reach it, HTTP 451). The fake VERIFIES every signed request: header `X-MBX-APIKEY`, a
 * `timestamp`, and `signature = HMAC_SHA256(secret, query without signature)`, and it rejects every non-GET call.
 */
import { createHmac } from "node:crypto";
import type { AdapterRuntime } from "../../../netlify/functions/_lib/exchanges/types";

export type Raw = Record<string, unknown>;

export interface BinanceVenue {
  key: string;
  secret: string;
  restrictions: Raw;
  /** raw futures fills (docs shape) */
  futuresTrades: Raw[];
  /** raw spot fills */
  spotTrades: Raw[];
  income: Raw[];
  balances: Raw[];
  prices: Raw[];
  /** every request: method + path + query (no signature) */
  calls: { method: string; path: string; host: string; query: Record<string, string> }[];
  /** force a status for every call (451 …) */
  force?: { status: number; body?: unknown };
  /** force a business error `{ code, msg }` on private calls */
  error?: { code: number; msg: string };
  now: number;
}

export const restrictions = (over: Raw = {}): Raw => ({
  ipRestrict: false,
  createTime: 1_700_000_000_000,
  enableReading: true,
  enableWithdrawals: false,
  enableInternalTransfer: false,
  enableMargin: false,
  enableFutures: false,
  permitsUniversalTransfer: false,
  enableVanillaOptions: false,
  enableFixApiTrade: false,
  enableFixReadOnly: false,
  enableSpotAndMarginTrading: false,
  enablePortfolioMarginTrading: false,
  ...over,
});

let seq = 1;
export const resetSeq = (): void => {
  seq = 1;
};

export function fut(o: { id?: number; symbol?: string; side: "BUY" | "SELL"; price: number; qty: number; pnl?: number; fee?: number; asset?: string; at: number; ps?: "BOTH" | "LONG" | "SHORT" }): Raw {
  return {
    symbol: o.symbol ?? "BTCUSDT",
    id: o.id ?? seq++,
    orderId: 9000 + (o.id ?? seq),
    side: o.side,
    price: String(o.price),
    qty: String(o.qty),
    realizedPnl: String(o.pnl ?? 0),
    quoteQty: String(o.price * o.qty),
    commission: String(o.fee ?? 0),
    commissionAsset: o.asset ?? "USDT",
    time: o.at,
    positionSide: o.ps ?? "BOTH",
    buyer: o.side === "BUY",
    maker: false,
    marginAsset: "USDT",
  };
}

export function spot(o: { id?: number; symbol?: string; buy: boolean; price: number; qty: number; fee?: number; asset?: string; at: number }): Raw {
  return {
    symbol: o.symbol ?? "BTCUSDT",
    id: o.id ?? seq++,
    orderId: 7000 + (o.id ?? seq),
    price: String(o.price),
    qty: String(o.qty),
    quoteQty: String(o.price * o.qty),
    commission: String(o.fee ?? 0),
    commissionAsset: o.asset ?? "USDT",
    time: o.at,
    isBuyer: o.buy,
    isMaker: false,
    isBestMatch: true,
  };
}

export const income = (symbol: string, type: string, amount: number, at: number, asset = "USDT"): Raw => ({ symbol, incomeType: type, income: String(amount), asset, info: "", time: at, tranId: seq++, tradeId: "" });

export function newVenue(over: Partial<BinanceVenue> = {}): BinanceVenue {
  return {
    key: "bnk9f3a1c2d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e",
    secret: "bns0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9",
    restrictions: restrictions(),
    futuresTrades: [],
    spotTrades: [],
    income: [],
    balances: [
      { asset: "USDT", free: "1500.25", locked: "0" },
      { asset: "BTC", free: "0.5", locked: "0" },
    ],
    prices: [{ symbol: "BTCUSDT", price: "64000" }, { symbol: "ETHUSDT", price: "3100" }, { symbol: "SOLUSDT", price: "150" }],
    calls: [],
    now: Date.now(),
    ...over,
  };
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Runtime whose fetch plays the venue; `sleep` is instant (the spacing is checked through the recorded call times). */
export function venueRuntime(v: BinanceVenue, sleeps: number[] = []): AdapterRuntime {
  return {
    now: () => v.now,
    // the clock does not run during a sleep: the recorded waits are asserted, the venue's "now" stays where the test put it
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method ?? "GET").toUpperCase();
      const q = Object.fromEntries(url.searchParams.entries());
      const signature = q.signature;
      delete q.signature;
      v.calls.push({ method, path: url.pathname, host: url.host, query: q });
      if (method !== "GET") return json(405, { code: -1, msg: "only GET" });
      if (v.force) return json(v.force.status, v.force.body ?? { msg: "forced" });
      const isPublic = url.pathname === "/api/v3/ticker/price" || url.pathname === "/fapi/v1/ticker/price";
      if (!isPublic) {
        const h = Object.fromEntries(new Headers(init?.headers).entries());
        if (h["x-mbx-apikey"] !== v.key) return json(401, { code: -2015, msg: "Invalid API-key, IP, or permissions for action." });
        const qs = [...url.searchParams.entries()].filter(([k]) => k !== "signature").map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`).join("&");
        if (!q.timestamp || signature !== createHmac("sha256", v.secret).update(qs).digest("hex")) return json(400, { code: -1022, msg: "Signature for this request is not valid." });
        if (v.error) return json(400, v.error);
      }
      const num = (k: string): number | undefined => (q[k] !== undefined ? Number(q[k]) : undefined);
      switch (url.pathname) {
        case "/sapi/v1/account/apiRestrictions":
          return json(200, v.restrictions);
        case "/api/v3/account":
          return json(200, { balances: v.balances, canTrade: false });
        case "/api/v3/ticker/price":
        case "/fapi/v1/ticker/price":
          return json(200, v.prices);
        case "/fapi/v3/balance":
          return json(200, [{ asset: "USDT", balance: "1000", availableBalance: "800.5", crossUnPnl: "12.25", crossWalletBalance: "1000" }]);
        case "/fapi/v3/positionRisk":
          return json(200, [{ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "0.05", entryPrice: "63000", markPrice: "64000", unRealizedProfit: "50", liquidationPrice: "40000", isolatedWallet: "0", updateTime: v.now }]);
        case "/fapi/v1/income": {
          const type = q.incomeType;
          const s = num("startTime") ?? 0;
          const e = num("endTime") ?? Infinity;
          const lim = num("limit") ?? 100;
          return json(200, v.income.filter((r) => (!type || r.incomeType === type) && Number(r.time) >= s && Number(r.time) <= e).sort((a, b) => Number(a.time) - Number(b.time)).slice(0, lim));
        }
        case "/fapi/v1/userTrades": {
          const s = num("startTime") ?? 0;
          const e = num("endTime") ?? Infinity;
          if (e - s > 7 * 86_400_000) return json(400, { code: -4002, msg: "span > 7 days" });
          const lim = num("limit") ?? 500;
          return json(200, v.futuresTrades.filter((r) => r.symbol === q.symbol && Number(r.time) >= s && Number(r.time) <= e).sort((a, b) => Number(a.time) - Number(b.time) || Number(a.id) - Number(b.id)).slice(0, lim));
        }
        case "/api/v3/myTrades": {
          if (!v.prices.some((p) => p.symbol === q.symbol)) return json(400, { code: -1121, msg: "Invalid symbol." });
          const from = q.fromId !== undefined ? Number(q.fromId) : undefined;
          const s = num("startTime") ?? 0;
          const lim = num("limit") ?? 500;
          const rows = v.spotTrades.filter((r) => r.symbol === q.symbol && (from !== undefined ? Number(r.id) >= from : Number(r.time) >= s)).sort((a, b) => Number(a.id) - Number(b.id));
          return json(200, rows.slice(0, lim));
        }
        default:
          return json(404, { code: -1, msg: "unknown path" });
      }
    }) as typeof fetch,
  };
}
