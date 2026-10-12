/**
 * In-process fake of the P11 exchange functions for e2e (additive to `mocks/supabase.ts`; register it AFTER
 * `mockSupabase` – Playwright runs the newest route first, other `/api/v1/*` paths fall back to the Supabase mock).
 *
 * The trades it "imports" are produced by the REAL server mapping (`netlify/functions/_lib/exchanges/mapping.ts`) from
 * the documented Bitunix payloads in `tests/fixtures/bitunix-*.json`, and they land in the Supabase mock's
 * `journal_docs` through `emit()` – so the cloud sync (Realtime) and the pull path see exactly what production would.
 *
 * Routes: POST/PATCH `/exchange/connect`, POST `/exchange/disconnect`, GET/POST `/exchange/sync` (status, pull,
 * `?dryRun=1`), POST `/exchange/backfill` (202, the run finishes after `backfillPolls` status reads), GET
 * `/exchange/positions`, GET/POST/DELETE `/trades/tokens`.
 */
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { parseClosedPosition, parseFill, parseOpenPosition, parseTpSl } from "../../../netlify/functions/_lib/exchanges/bitunix";
import { detectPnlConvention, mapClosedPosition, mapOpenPosition } from "../../../netlify/functions/_lib/exchanges/mapping";
import type { VenueClosedPosition } from "../../../netlify/functions/_lib/exchanges/types";
import type { MockSupabase } from "./supabase";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8")) as { data: unknown };

/** The secret that the fake Bitunix rejects with 10007 (wrong key / secret). */
export const WRONG_SECRET = "falsches-secret-123";

export interface MockExchangeOptions {
  /** Server has no `EXCHANGE_ENC_KEY_V1` (configured: false). */
  unconfigured?: boolean;
  /** Plan without the exchange sync (402 on connect / sync). */
  notEntitled?: boolean;
  /** A connection exists up front. */
  connected?: boolean;
  /** Status reads until a started first import reports `ok` (default 2). */
  backfillPolls?: number;
}

export interface MockExchange {
  calls: string[];
  /** Bodies of the connect calls (to assert what the browser sent). */
  connects: Record<string, unknown>[];
  state: { connections: Record<string, unknown>[]; runs: Record<string, unknown>[]; tokens: Record<string, unknown>[] };
}

const positions = () =>
  (fixture("bitunix-history-positions.json").data as { positionList: Record<string, unknown>[] }).positionList.map(
    (r) => parseClosedPosition(r)!,
  ) as VenueClosedPosition[];
const tpsl = () => (fixture("bitunix-tpsl-history.json").data as { orderList: Record<string, unknown>[] }).orderList.map((r) => parseTpSl(r)!);
const fills = () => (fixture("bitunix-history-trades.json").data as { tradeList: Record<string, unknown>[] }).tradeList.map((r) => parseFill(r)!);

export async function mockExchange(page: Page, sb: MockSupabase, opts: MockExchangeOptions = {}): Promise<MockExchange> {
  const calls: string[] = [];
  const connects: Record<string, unknown>[] = [];
  const connections: Record<string, unknown>[] = [];
  const runs: Record<string, unknown>[] = [];
  const tokens: Record<string, unknown>[] = [];
  let pendingBackfill: { id: string; reads: number } | null = null;
  const now = () => new Date().toISOString();
  const conn = (over: Record<string, unknown> = {}) => ({
    id: "c0ffee00-0000-4000-8000-000000000001",
    exchange: "bitunix",
    label: "",
    keyLast4: "7e2d",
    permissions: ["read"],
    status: "active",
    lastSyncAt: null,
    lastError: null,
    journalAccount: "scalp",
    syncEnabled: true,
    createdAt: "2026-10-12T07:00:00.000Z",
    ...over,
  });
  if (opts.connected) connections.push(conn({ lastSyncAt: new Date(Date.now() - 12 * 60_000).toISOString() }));

  const mapAll = (account: "makro" | "scalp") => {
    const list = positions();
    const conv = detectPnlConvention(list);
    return list.map((p) =>
      mapClosedPosition(p, {
        exchange: "bitunix",
        tz: "Europe/Berlin",
        journalAccount: account,
        nowIso: now(),
        feesIncluded: conv.feesIncluded,
        tpsl: tpsl(),
        fills: p.positionId === "1846203915577018372" ? fills() : null,
      }),
    );
  };
  const inJournal = (id: string) => sb.live(`trade:${id}`) !== undefined;
  const status = () => ({
    configured: !opts.unconfigured,
    cron: { enabled: true, everyMin: 30, nextAt: new Date(Math.floor(Date.now() / 1_800_000) * 1_800_000 + 1_800_000).toISOString() },
    plan: { plan: opts.notEntitled ? "free" : "pro", entitled: !opts.notEntitled, limit: opts.notEntitled ? 0 : 1, gated: true },
    connections,
    runs: [...runs].reverse().slice(0, 12),
  });
  const run = (kind: string, counts: Record<string, number>, over: Record<string, unknown> = {}) => {
    const r = {
      id: crypto.randomUUID(),
      connectionId: (connections[0]?.id as string) ?? null,
      exchange: "bitunix",
      kind,
      status: "ok",
      startedAt: now(),
      finishedAt: now(),
      fetched: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      error: null,
      more: false,
      dryRun: kind === "dry_run",
      ...counts,
      ...over,
    };
    runs.push(r);
    return r;
  };
  const importAll = async () => {
    const account = (connections[0]?.journalAccount as "makro" | "scalp") ?? "scalp";
    let inserted = 0;
    let unchanged = 0;
    for (const m of mapAll(account)) {
      if (inJournal(m.trade.id)) {
        unchanged++;
        continue;
      }
      await sb.emit("trade", m.trade.id, m.trade);
      inserted++;
    }
    return { fetched: inserted + unchanged, inserted, updated: 0, unchanged, skipped: 0 };
  };

  await page.route(/\/api\/v1\/(exchange|trades)(\/|$|\?)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    calls.push(`${method} ${url.pathname}${url.search}`);
    const send = (s: number, body?: unknown) =>
      route.fulfill({ status: s, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
    const fail = (s: number, code: string, message: string) => send(s, { error: { code, message } });
    if (!req.headers()["authorization"]) return fail(401, "unauthenticated", "Bitte melde dich an.");
    const body = (() => {
      try {
        return (req.postDataJSON() ?? {}) as Record<string, unknown>;
      } catch {
        return {};
      }
    })();

    switch (url.pathname) {
      case "/api/v1/exchange/connect": {
        if (method === "PATCH") {
          const c = connections.find((x) => x.id === body.connectionId);
          if (!c) return fail(404, "connection_not_found", "Diese Verbindung gibt es nicht (mehr).");
          if (body.journalAccount) c.journalAccount = body.journalAccount;
          if (typeof body.syncEnabled === "boolean") c.syncEnabled = body.syncEnabled;
          return send(200, { connection: c });
        }
        connects.push(body);
        if (opts.unconfigured)
          return fail(503, "exchange_unavailable", "Der Börsen-Sync ist auf diesem Server noch nicht eingerichtet (Verschlüsselungsschlüssel fehlt).");
        if (opts.notEntitled) return fail(402, "plan_required", "Börsen-Sync ist in deinem Tarif nicht enthalten.");
        if (body.readOnlyConfirmed !== true) return fail(422, "invalid_body", "Eingaben unvollständig oder ungültig.");
        if (body.secret === WRONG_SECRET)
          return fail(422, "bitunix_10007", "Signatur ungültig: API-Key oder Secret stimmt nicht. Bitte prüfen und neu verbinden.");
        const c = conn({ keyLast4: String(body.apiKey).slice(-4), journalAccount: body.journalAccount ?? "scalp", label: body.label ?? "" });
        connections.splice(0, connections.length, c);
        const acc = (fixture("bitunix-account.json").data as Record<string, string>[])[0]!;
        return send(201, {
          connection: c,
          account: { marginCoin: "USDT", available: Number(acc.available), margin: Number(acc.margin), unrealizedPnl: -12.4 },
        });
      }
      case "/api/v1/exchange/disconnect": {
        const i = connections.findIndex((x) => x.id === body.connectionId);
        if (i < 0) return fail(404, "connection_not_found", "Diese Verbindung gibt es nicht (mehr).");
        connections.splice(i, 1);
        return send(200, { ok: true });
      }
      case "/api/v1/exchange/sync": {
        if (method === "GET") {
          if (url.searchParams.has("since") || url.searchParams.get("pull") === "1") {
            const since = url.searchParams.get("since");
            const trades = [...sb.rows.values()]
              .filter(
                (r) => r.kind === "trade" && !r.deleted && ["api", "webhook", "bot"].includes(String((r.data as { origin?: { kind?: string } }).origin?.kind)),
              )
              .filter((r) => !since || r.updated_at > since)
              .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
              .map((r) => ({ id: r.id, data: r.data, updatedAt: r.updated_at }));
            return send(200, { trades, more: false, serverAt: now() });
          }
          if (pendingBackfill && ++pendingBackfill.reads >= (opts.backfillPolls ?? 2)) {
            const r = runs.find((x) => x.id === pendingBackfill!.id)!;
            Object.assign(r, { status: "ok", finishedAt: now(), ...(await importAll()) });
            if (connections[0]) connections[0].lastSyncAt = now();
            pendingBackfill = null;
          }
          return send(200, status());
        }
        if (opts.notEntitled) return fail(402, "plan_required", "Börsen-Sync ist in deinem Tarif nicht enthalten.");
        if (!connections.length) return fail(404, "connection_not_found", "Keine Börse verbunden.");
        if (url.searchParams.get("dryRun") === "1") {
          const mapped = mapAll((connections[0]!.journalAccount as "makro" | "scalp") ?? "scalp");
          const conv = detectPnlConvention(positions());
          const r = run("dry_run", { fetched: mapped.length });
          return send(200, {
            runId: r.id,
            status: "ok",
            counts: { fetched: mapped.length, inserted: 0, updated: 0, unchanged: 0, skipped: 0 },
            more: false,
            window: { from: Date.parse("2026-09-12T00:00:00Z"), to: Date.now() },
            dryRun: true,
            trades: mapped.map((m) => m.trade),
            checks: mapped.map((m) => ({ ...m.check, state: inJournal(m.trade.id) ? "exists" : "new" })),
            convention: { ...conv, used: conv.feesIncluded !== null },
            fillsSkipped: 0,
            requests: 9,
          });
        }
        const counts = await importAll();
        const r = run("manual", counts);
        connections[0]!.lastSyncAt = now();
        return send(200, {
          runId: r.id,
          status: "ok",
          counts,
          more: false,
          window: { from: 0, to: Date.now() },
          dryRun: false,
          trades: [],
          checks: [],
          convention: { feesIncluded: false, samples: 4, votesExcluded: 4, votesIncluded: 0, used: true },
          fillsSkipped: 0,
          requests: 7,
        });
      }
      case "/api/v1/exchange/backfill": {
        const r = run("backfill", {}, { id: body.runId, status: "running", finishedAt: null });
        pendingBackfill = { id: String(r.id), reads: 0 };
        return send(202);
      }
      case "/api/v1/exchange/positions": {
        const open = (fixture("bitunix-pending-positions.json").data as Record<string, unknown>[]).map((r) => parseOpenPosition(r)!);
        const out = connections.length
          ? open.map((p) =>
              mapOpenPosition(p, "bitunix", p.symbol === "BTCUSDT" ? { symbol: "BTCUSDT", markPrice: 63920.5, lastPrice: 63921 } : undefined, Date.now()),
            )
          : [];
        return send(200, { positions: out, errors: [], at: now() });
      }
      case "/api/v1/trades/tokens": {
        if (method === "POST") {
          const info = {
            id: crypto.randomUUID(),
            name: body.name ?? "Token",
            prefix: "tj_e2eAb",
            scopes: body.scopes ?? ["trades:read"],
            lastUsedAt: null,
            createdAt: now(),
          };
          tokens.unshift(info);
          return send(201, { token: `tj_e2eAbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcde`, info });
        }
        return send(200, { tokens });
      }
      default: {
        const m = /^\/api\/v1\/trades\/tokens\/(.+)$/.exec(url.pathname);
        if (m && method === "DELETE") {
          const i = tokens.findIndex((t) => t.id === m[1]);
          if (i >= 0) tokens.splice(i, 1);
          return send(i >= 0 ? 200 : 404, i >= 0 ? { ok: true } : { error: { code: "token_not_found", message: "Diesen Token gibt es nicht." } });
        }
        return route.fallback();
      }
    }
  });

  return { calls, connects, state: { connections, runs, tokens } };
}
