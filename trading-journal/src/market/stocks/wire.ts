/**
 * The answers of the four stock functions (`netlify/functions/stock-*.mts`) as the server writes them and the client
 * validates them. One file for both sides (the functions import it by relative path; only `zod` and `./types`), so a
 * change of the format is a type error on the other side.
 *
 * A symbol the source cannot serve is its own entry (`ok: false` + reason) – one bad ticker never fails the batch.
 * When EVERY symbol of a request fails for the same upstream reason (a block, a rate limit), the function answers with
 * the shared error envelope instead (`{ error: { code, message } }`, status 429 / 502 / 503).
 */
import { z } from "zod";
import { STOCK_INTERVALS } from "./types";

export const WireReason = z.enum(["bad-symbol", "no-data", "blocked", "rate-limited", "upstream", "timeout", "bad-response"]);
export type WireReason = z.infer<typeof WireReason>;

const nullableNum = z.number().nullable();

export const WireFail = z.object({ ok: z.literal(false), reason: WireReason, message: z.string() });
export type WireFail = z.infer<typeof WireFail>;

/** `[time ms, open, high, low, close, volume]` */
export const WireBar = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]);
export type WireBar = z.infer<typeof WireBar>;

export const WireMeta = z.object({
  name: z.string().nullable(),
  currency: z.string().nullable(),
  exchange: z.string().nullable(),
  price: nullableNum,
  prevClose: nullableNum,
  volume: nullableNum,
  marketTime: nullableNum,
});

export const WireBarsOk = z.object({ ok: z.literal(true), bars: z.array(WireBar), meta: WireMeta });
export const BarsResponse = z.object({
  source: z.literal("yahoo"),
  interval: z.enum(STOCK_INTERVALS),
  range: z.string(),
  /** when the server fetched it upstream (ms) */
  fetchedAt: z.number(),
  results: z.record(z.discriminatedUnion("ok", [WireBarsOk, WireFail])),
});
export type BarsResponse = z.infer<typeof BarsResponse>;

export const WireQuoteOk = z.object({
  ok: z.literal(true),
  name: z.string().nullable(),
  currency: z.string().nullable(),
  exchange: z.string().nullable(),
  price: z.number(),
  prevClose: nullableNum,
  change: nullableNum,
  changePct: nullableNum,
  dayHigh: nullableNum,
  dayLow: nullableNum,
  volume: nullableNum,
  fiftyTwoWeekHigh: nullableNum,
  fiftyTwoWeekLow: nullableNum,
  marketTime: nullableNum,
});
export const QuoteResponse = z.object({
  source: z.literal("yahoo"),
  fetchedAt: z.number(),
  results: z.record(z.discriminatedUnion("ok", [WireQuoteOk, WireFail])),
});
export type QuoteResponse = z.infer<typeof QuoteResponse>;

export const WireNewsItem = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  publisher: z.string().nullable(),
  publishedAt: z.number(),
  summary: z.string().nullable(),
});
export const WireNewsOk = z.object({ ok: z.literal(true), items: z.array(WireNewsItem) });
export const NewsResponse = z.object({
  source: z.literal("yahoo-rss"),
  fetchedAt: z.number(),
  results: z.record(z.discriminatedUnion("ok", [WireNewsOk, WireFail])),
});
export type NewsResponse = z.infer<typeof NewsResponse>;

/** `[symbol, name, exchange, financial status | null]` */
export const WireSymbol = z.tuple([z.string(), z.string(), z.string(), z.string().nullable()]);
export const SymbolsResponse = z.object({
  source: z.literal("nasdaqtrader"),
  fileTime: nullableNum,
  fetchedAt: z.number(),
  counts: z.object({ rows: z.number(), kept: z.number(), dropped: z.record(z.number()) }),
  symbols: z.array(WireSymbol),
});
export type SymbolsResponse = z.infer<typeof SymbolsResponse>;
