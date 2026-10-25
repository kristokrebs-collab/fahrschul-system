/**
 * E-Mail-Alarm bei geschlossener App (F21): one run of the scheduled watch (`alert-watch-cron.mts`, every 5 minutes).
 *
 *   accounts with the switch on (`alert_watch_candidates`, ≤ 200, order rotated per run)
 *     → plan gate (feature `boxScanner`, like the Box-Scanner's alarms; open while payments are not set up)
 *     → ONE price request for all symbols, one candle request per symbol and source feed (≤ 30 symbols, ≤ 60 requests)
 *     → per account: the SAME pure watch core as the browser (`stepWatch`: evaluation on the level's own candles, stage
 *       memory, first look silent) → the fires wait in the outbox (`queueFires`) → `planMail` (active hours, daily limit,
 *       gap, back-off) → ONE summary mail for everything that waits.
 *
 * Exactly once: the state (stage memory + outbox) is written BEFORE the mail goes out, guarded by the settings row's
 * `rev`; a lost race re-reads the account once and starts over with the same candles, a second loss skips the account
 * until the next run (nothing was mailed, nothing was marked). The mail goes out with an idempotency key derived from the
 * outbox; only after it succeeded the mailed items leave the outbox. If that write is lost, the next run sends the same
 * items again under the same key – Resend answers the first result instead of mailing twice.
 *
 * Quiet by construction: a run in which nothing changes writes nothing (the only write is the one-row heartbeat the app
 * shows as "zuletzt geprüft"); no account with the switch on → one query and nothing else; without `RESEND_API_KEY` and
 * `ALERT_FROM` the run does nothing. Logs carry counts and codes only – never an address, a level or a price.
 */
import { createHash } from "node:crypto";
import { planIncludes } from "../../../../src/billing/plans";
import { KEY_TF_SOURCE, type TfFeed } from "../../../../src/domain/keylevels/timeframes";
import {
  afterMail,
  liveSince,
  planMail,
  PROBLEMS_CAP,
  queueFires,
  sameServerState,
  serverAlertsOf,
  serverWatchSet,
  withServerAlerts,
  type ServerAlertsCfg,
  type WatchProblem,
} from "../../../../src/domain/keylevels/serverAlerts";
import { evaluateWatch, stepWatch, unknownEvaluation, watchEntry, type WatchEntry } from "../../../../src/domain/keylevels/watch";
import { barsOfTf } from "../../../../src/market/keylevels/bars";
import { RestError } from "../../../../src/market/sources/http";
import type { Candle } from "../../../../src/market/types";
import { effectivePlan, paymentsConfigured } from "../plan";
import { supabaseAdmin } from "../supabase";
import { localClock, safeTz } from "./clock";
import { appOrigin, buildAlertMail, mailConfig, sendMail, type MailConfig } from "./mail";
import { barsNeeded, createMarket, marketErrorCode, type Market } from "./market";
import { recipientOf } from "./recipient";
import { listWatchRows, MigrationMissing, saveHeartbeat, writeServerAlerts, type WatchRow } from "./store";

/** Scheduled functions stop at 30 s. */
export const RUN_BUDGET_MS = 24_000;
export const RUN_INTERVAL_MS = 5 * 60_000;
export const ACCOUNTS_MAX = 200;
export const SYMBOLS_MAX = 30;
export const REQUESTS_MAX = 60;
const POOL = 4;
const SYMBOL_RE = /^[A-Z0-9]{2,24}$/;

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface RunDeps {
  /** the run's clock (default `Date.now()`) */
  now?: number;
  /** Binance requests (tests) */
  fetch?: FetchFn;
  /** Resend requests (tests) */
  sendFetch?: FetchFn;
}

export interface RunSummary {
  /** `false`: nothing was done (`reason`) */
  enabled: boolean;
  reason?: "not_configured";
  /** accounts with the switch on that the run read */
  accounts: number;
  /** accounts looked at (something to watch or to mail, plan allows it, within the caps) */
  watched: number;
  /** left for the next run (caps, time) */
  deferred: number;
  /** left out by the plan gate */
  gated: number;
  symbols: number;
  requests: number;
  fires: number;
  mails: number;
  /** accounts with a mail waiting (hours, limit, gap, back-off) */
  waiting: number;
  failed: number;
  /** what went wrong globally: `migration`, `db`, `binance_451`, `binance_down` */
  code: string | null;
  source: string | null;
}

type BarsEntry = Candle[] | "unknown_symbol" | "failed";

interface Ctx {
  now: number;
  deadline: number;
  prices: Map<string, number>;
  bars: Map<string, BarsEntry>;
  mail: MailConfig;
  sendFetch?: FetchFn;
  appUrl: string | null;
  sourceLabel: string;
  tally: RunSummary;
}

const barsKey = (symbol: string, feed: TfFeed): string => `${symbol}|${feed}`;

/** The server-owned keys of a state (what a write patches). */
function serverKeys(c: ServerAlertsCfg): Partial<Omit<ServerAlertsCfg, "v">> {
  return { mem: c.mem, outbox: c.outbox, recent: c.recent, mails: c.mails, lastMailAt: c.lastMailAt, fail: c.fail, notes: c.notes, problems: c.problems };
}

/** Accounts whose plan includes the alarm (all of them while payments are not set up). A plan that cannot be read is not allowed this run. */
async function allowed(ids: string[]): Promise<Set<string>> {
  if (!paymentsConfigured()) return new Set(ids);
  const ok = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await supabaseAdmin().from("profiles").select("id, plan, plan_status, trial_end").in("id", chunk);
    if (error) {
      console.error("[fn] alert-watch plans failed", error.code ?? "");
      continue;
    }
    for (const r of (data ?? []) as { id: string; plan: unknown; plan_status: unknown; trial_end: unknown }[]) if (planIncludes(effectivePlan(r).plan, "boxScanner")) ok.add(r.id);
  }
  return ok;
}

/** Runs `fn` for every item, `size` at a time. */
async function pool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

/** One account: look, queue, write, mail, write. `retry`: the row was re-read once after a lost race. */
async function processAccount(row: WatchRow, ctx: Ctx, retry = true): Promise<void> {
  const { now } = ctx;
  const cfg = serverAlertsOf(row.serverAlerts);
  const set = serverWatchSet(row.keyLevels);
  const tz = safeTz(row.tz);
  const local = localClock(now, tz);

  const memoBars = new Map<string, Candle[]>();
  const problems: WatchProblem[] = set.over.map((l) => ({ id: l.id, code: "limit" as const }));
  const entries: WatchEntry[] = set.levels.map((l) => {
    const src = ctx.bars.get(barsKey(l.symbol, KEY_TF_SOURCE[l.tf].feed));
    if (src === "unknown_symbol") {
      problems.push({ id: l.id, code: "symbol" });
      return watchEntry(l, unknownEvaluation("Binance kennt das Symbol nicht – nicht bewertet."), false, set.alerts);
    }
    if (!src || src === "failed") return watchEntry(l, unknownEvaluation("Keine Kerzen – nicht bewertet."), false, set.alerts);
    const k = `${l.symbol}|${l.tf}`;
    let bars = memoBars.get(k);
    if (!bars) memoBars.set(k, (bars = barsOfTf(l.tf, src)));
    return evaluateWatch(l, bars, now, set.alerts);
  });

  const step = stepWatch(cfg.mem, entries, now, { live: liveSince(cfg.armedAt, now) });
  ctx.tally.fires += step.fires.length;
  const q = queueFires(cfg, step.fires, now, set.alerts.cooldownMin);
  let next: ServerAlertsCfg = { ...cfg, mem: step.mems, outbox: q.outbox, recent: q.recent, notes: q.notes, problems: problems.slice(0, PROBLEMS_CAP) };
  const plan = planMail(next, now, local, set.alerts.hours);
  if (plan.expired > 0) next = { ...next, outbox: plan.fresh, notes: { ...next.notes, dropped: next.notes.dropped + plan.expired } };

  // 1) the state first: what fired is remembered BEFORE anything is mailed
  let rev = row.rev;
  let base: unknown = row.serverAlerts;
  if (!sameServerState(cfg, next)) {
    const value = withServerAlerts(row.serverAlerts, serverKeys(next));
    const written = await writeServerAlerts(row.userId, rev, value);
    if (written == null) {
      if (!retry) {
        ctx.tally.deferred += 1;
        return;
      }
      const fresh = (await listWatchRows({ limit: 1, salt: "", userId: row.userId }))[0];
      if (fresh) await processAccount(fresh, ctx, false);
      return;
    }
    rev = written;
    base = value;
  }

  if (!plan.send) {
    if (plan.hold && plan.hold !== "empty") ctx.tally.waiting += 1;
    return;
  }
  if (Date.now() >= ctx.deadline) {
    ctx.tally.waiting += 1;
    return;
  }

  // 2) the mail
  const rcpt = await recipientOf(row.userId);
  let outcome: { ok: true } | { ok: false; code: string };
  if (!rcpt) outcome = { ok: false, code: "no_recipient" };
  else if (!rcpt.confirmed) outcome = { ok: false, code: "email_unconfirmed" };
  else {
    const sentToday = (cfg.mails.day === local.day ? cfg.mails.n : 0) + 1;
    const content = buildAlertMail({ items: plan.send, notes: next.notes, expired: 0, tz, now, prices: ctx.prices, sourceLabel: ctx.sourceLabel, appUrl: ctx.appUrl, maxPerDay: cfg.maxPerDay, sentToday });
    const key = createHash("sha256")
      .update([row.userId, ...plan.send.map((i) => i.id).sort()].join("\n"))
      .digest("hex")
      .slice(0, 40);
    const sent = await sendMail(ctx.mail, { to: rcpt.email, subject: content.subject, text: content.text, idempotencyKey: key }, ctx.sendFetch);
    outcome = sent.ok ? { ok: true } : { ok: false, code: sent.code };
    if (!sent.ok) console.error("[fn] alert-watch send failed", sent.code);
  }
  if (outcome.ok) ctx.tally.mails += 1;
  else ctx.tally.failed += 1;

  // 3) what the mail changed: the mailed items leave the outbox, the day counts – or a failure starts the back-off
  const after = afterMail(next, plan.send, now, local, outcome);
  const written = await writeServerAlerts(row.userId, rev, withServerAlerts(base, after));
  if (written == null) {
    const fresh = (await listWatchRows({ limit: 1, salt: "", userId: row.userId }))[0];
    if (fresh) {
      const again = afterMail(serverAlertsOf(fresh.serverAlerts), plan.send, now, local, outcome);
      await writeServerAlerts(row.userId, fresh.rev, withServerAlerts(fresh.serverAlerts, again));
    }
  }
}

export async function runAlertWatch(deps: RunDeps = {}): Promise<RunSummary> {
  const started = Date.now();
  const now = deps.now ?? started;
  const tally: RunSummary = { enabled: true, accounts: 0, watched: 0, deferred: 0, gated: 0, symbols: 0, requests: 0, fires: 0, mails: 0, waiting: 0, failed: 0, code: null, source: null };
  const mail = mailConfig();
  if (!mail) return { ...tally, enabled: false, reason: "not_configured" };
  const deadline = started + RUN_BUDGET_MS;

  let rows: WatchRow[];
  try {
    rows = await listWatchRows({ limit: ACCOUNTS_MAX, salt: String(Math.floor(now / RUN_INTERVAL_MS)) });
  } catch (e) {
    tally.code = e instanceof MigrationMissing ? "migration" : "db";
    console.error("[fn] alert-watch candidates failed", tally.code);
    await saveHeartbeat({ at: now, ok: false, code: tally.code, accounts: 0, symbols: 0, mails: 0, source: null });
    return tally;
  }
  tally.accounts = rows.length;
  if (!rows.length) return tally;

  // who has something to do, and may
  const busy = rows.filter((r) => {
    const c = serverAlertsOf(r.serverAlerts);
    return serverWatchSet(r.keyLevels).levels.length > 0 || c.outbox.length > 0 || Object.keys(c.mem).length > 0 || c.problems.length > 0;
  });
  const okIds = await allowed(busy.map((r) => r.userId));
  tally.gated = busy.filter((r) => !okIds.has(r.userId)).length;
  const candidates = busy.filter((r) => okIds.has(r.userId));

  // what to fetch – within the caps; an account that does not fit waits for a later run (the order rotates)
  const needs = new Map<string, { symbol: string; feed: TfFeed; limit: number }>();
  const symbols = new Set<string>();
  const included: WatchRow[] = [];
  for (const r of candidates) {
    const add = new Map<string, { symbol: string; feed: TfFeed; limit: number }>();
    for (const l of serverWatchSet(r.keyLevels).levels) {
      const feed = KEY_TF_SOURCE[l.tf].feed;
      const k = barsKey(l.symbol, feed);
      const limit = Math.max(barsNeeded(l.tf, l.since, now), add.get(k)?.limit ?? 0, needs.get(k)?.limit ?? 0);
      add.set(k, { symbol: l.symbol, feed, limit });
    }
    const nextSymbols = new Set([...symbols, ...[...add.values()].map((n) => n.symbol)]);
    const nextRequests = new Set([...needs.keys(), ...add.keys()]).size;
    if (nextSymbols.size > SYMBOLS_MAX || nextRequests > REQUESTS_MAX) {
      tally.deferred += 1;
      continue;
    }
    for (const [k, v] of add) needs.set(k, v);
    for (const s of nextSymbols) symbols.add(s);
    included.push(r);
  }
  tally.watched = included.length;
  tally.symbols = symbols.size;
  if (!included.length) {
    await saveHeartbeat({ at: now, ok: tally.code == null, code: tally.code, accounts: rows.length, symbols: 0, mails: 0, source: null });
    return tally;
  }

  // market data
  const appUrl = appOrigin();
  const market: Market = createMarket({ fetch: deps.fetch, now: () => now, proxyBase: appUrl ? `${appUrl}/api/binance` : null });
  let prices = new Map<string, number>();
  try {
    prices = await market.prices();
  } catch (e) {
    tally.code = marketErrorCode(e);
    console.error("[fn] alert-watch prices failed", tally.code);
  }
  const bars = new Map<string, BarsEntry>();
  const toFetch: [string, { symbol: string; feed: TfFeed; limit: number }][] = [];
  for (const [k, n] of needs) {
    if (!SYMBOL_RE.test(n.symbol) || (tally.code == null && !prices.has(n.symbol))) bars.set(k, "unknown_symbol");
    else if (tally.code == null) toFetch.push([k, n]);
    else bars.set(k, "failed");
  }
  await pool(toFetch, POOL, async ([k, n]) => {
    if (Date.now() >= deadline - 4_000) {
      bars.set(k, "failed");
      return;
    }
    try {
      bars.set(k, await market.sourceBars(n.symbol, n.feed, n.limit));
    } catch (e) {
      if (e instanceof RestError && e.kind === "bad_symbol") bars.set(k, "unknown_symbol");
      else {
        bars.set(k, "failed");
        tally.code ??= marketErrorCode(e);
      }
    }
  });
  tally.requests = market.requests();
  tally.source = market.source();

  const ctx: Ctx = {
    now,
    deadline,
    prices,
    bars,
    mail,
    sendFetch: deps.sendFetch,
    appUrl,
    sourceLabel: market.source() === "proxy" ? "Binance USDⓈ-M Futures über den Proxy der App" : "Binance USDⓈ-M Futures",
    tally,
  };
  for (const r of included) {
    if (Date.now() >= deadline) {
      tally.deferred += 1;
      continue;
    }
    try {
      await processAccount(r, ctx);
    } catch (e) {
      tally.failed += 1;
      console.error("[fn] alert-watch account failed", e instanceof MigrationMissing ? "migration" : e instanceof Error ? e.name : typeof e);
      if (e instanceof MigrationMissing) tally.code ??= "migration";
    }
  }
  await saveHeartbeat({ at: deps.now ?? Date.now(), ok: tally.code == null, code: tally.code, accounts: rows.length, symbols: symbols.size, mails: tally.mails, source: tally.source });
  return tally;
}
