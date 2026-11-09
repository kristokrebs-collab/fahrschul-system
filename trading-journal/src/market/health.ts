/**
 * Health state machine (Plan 4.4): a pure reducer per feed plus the aggregate.
 *
 *   connecting --rest_ok | ws_message------------------------------> live
 *   live       --tick: now − lastDataAt > staleAfterMs--------------> stale
 *   live|stale --rest_fail×3 | ws_close + 3 failed reconnects
 *              | rest_fail(kind ∈ {blocked_451, cors})--------------> fallback   (next USABLE source in spec.sources;
 *              the usable proxy first for ratio feeds, CORS and rate limits — Binance's own data from another IP)
 *   Binance-family ratio feeds (BINANCE_FAMILY_FEEDS): soft failures never leave Binance's cohort — next source is
 *              the proxy when `proxy.usable === true`, otherwise the feed STAYS on its source (provider retries
 *              with a capped backoff); only blocked_451 hands `globalAccountRatio` to Bybit.
 *   stale      --rest_ok | ws_message------------------------------> live
 *   fallback   --probe(binance ok)---------------------------------> connecting (primary re-adopted, data kept)
 *   fallback   --all sources failed ×3----------------------------> offline    (cache)
 *   any        --online:false--------------------------------------> offline
 *   offline    --online:true---------------------------------------> connecting
 *   overall = worst(feeds), rank live < connecting < stale < fallback < offline
 */
import type { FailureReason, FeedHealth, FeedId, FeedSpec, HealthEvent, HealthState, ProviderHealth, Source } from "./types";
import { ALL_FUTURES_DATA_FEEDS, FEED_IDS, WS_FEEDS, effectiveSpec, isFamilyFeed } from "./feeds";
import { WS_MAX_FAILED } from "./schedule";

export const RANK: Record<HealthState, number> = { live: 0, connecting: 1, stale: 2, fallback: 3, offline: 4 };
export const FAILURES_BEFORE_FALLBACK = 3;
const BLOCKED_NO_PROXY = "Binance blockiert, kein EU-Proxy: nur mit Binance";

export type Specs = Record<FeedId, FeedSpec>;

export function worst(states: readonly HealthState[]): HealthState {
  let w: HealthState = "live";
  for (const s of states) if (RANK[s] > RANK[w]) w = s;
  return w;
}

export function initialHealth(specs: Specs): ProviderHealth {
  const feeds = {} as Record<FeedId, FeedHealth>;
  for (const id of FEED_IDS) {
    feeds[id] = { feed: id, state: "connecting", source: specs[id].sources[0] ?? "binance", consecutiveFailures: 0 };
  }
  return {
    overall: "connecting",
    online: true,
    primary: { source: "binance", reachable: "unknown", blocked: false },
    proxy: { usable: "unknown" },
    ws: { state: "connecting", attempt: 0 },
    feeds,
  };
}

function isPristine(f: FeedHealth): boolean {
  return f.state === "connecting" && f.lastDataAt === undefined && f.consecutiveFailures === 0 && f.reason === undefined;
}

/**
 * The socket is not delivering: it went silent (`stale`), is exhausted (`fallback`), offline, or is (re)connecting after
 * it had ever delivered / after a failed attempt. The initial handshake (never delivered, no retry yet) is NOT "down" —
 * the REST bootstrap that races it must keep reading as live, not as a stand-in. While down, the provider REST-polls
 * the last price every `PRICE_REST_FALLBACK_MS` and the market card says `Kurs per Abfrage` instead of `Live`.
 */
export function wsDown(h: ProviderHealth): boolean {
  const ws = h.ws;
  if (ws.state === "stale" || ws.state === "fallback" || ws.state === "offline") return true;
  return ws.state === "connecting" && (ws.lastMessageAt !== undefined || ws.attempt > 0);
}

export function aggregate(h: ProviderHealth): HealthState {
  if (!h.online) return "offline";
  const active = Object.values(h.feeds).filter((f) => !isPristine(f));
  if (active.length === 0) return "connecting";
  return worst(active.map((f) => f.state));
}

function finish(h: ProviderHealth): ProviderHealth {
  const overall = aggregate(h);
  return overall === h.overall ? h : { ...h, overall };
}

/** Whether `source` may take over `feed` now. `exchange`: moving to another exchange (Bybit/OKX) is allowed. */
function canTake(h: ProviderHealth, feed: FeedId, source: Source, exchange: boolean): boolean {
  const family = isFamilyFeed(feed);
  if (source === "proxy") return family ? h.proxy.usable === true : h.proxy.usable !== false;
  if (family && (source === "bybit" || source === "okx")) return exchange;
  return true;
}

function nextSource(h: ProviderHealth, spec: FeedSpec, current: Source, exchange: boolean, proxyFirst: boolean): Source | undefined {
  // Binance's own data through the proxy beats another exchange's cohort (ratio feeds; any feed the browser
  // cannot read directly because of CORS)
  if (proxyFirst && current !== "proxy" && spec.sources.includes("proxy") && h.proxy.usable === true) return "proxy";
  const idx = spec.sources.indexOf(current);
  for (let i = idx + 1; i < spec.sources.length; i++) {
    const s = spec.sources[i]!;
    if (s === "cache") return undefined;
    if (canTake(h, spec.id, s, exchange)) return s;
  }
  return undefined;
}

/**
 * Moves a feed to the next usable source in its chain, or offline (cache) when exhausted. A Binance-family feed
 * whose next usable source is none stays where it is after a soft failure (the provider keeps retrying it there).
 */
function advance(h: ProviderHealth, f: FeedHealth, spec: FeedSpec, reason: FailureReason | undefined, detail?: string): FeedHealth {
  const family = isFamilyFeed(f.feed);
  const exchange = !family || reason === "blocked_451";
  // Binance's own data through the proxy first: ratio feeds (cohort), unreadable responses (CORS), and a rate limit /
  // IP ban on the direct route (the proxy asks Binance from another IP)
  const next = nextSource(h, spec, f.source, exchange, family || reason === "cors" || reason === "rate_limited");
  if (next) return { ...f, state: "fallback", source: next, consecutiveFailures: 0, reason, detail };
  if (family && reason !== "blocked_451") return { ...f, reason, detail };
  // blocked and nobody else has this Binance-only series: parked like the top traders on Bybit (`Nur mit Binance`)
  if (family) return { ...f, state: "fallback", source: "cache", consecutiveFailures: 0, reason: "unsupported", detail: BLOCKED_NO_PROXY };
  return { ...f, state: "offline", source: "cache", consecutiveFailures: f.consecutiveFailures, reason, detail };
}

/** A family feed that should switch to a (newly) usable proxy: parked on Bybit/cache, failing on Binance, or blocked. */
function wantsProxy(f: FeedHealth, blocked: boolean): boolean {
  if (f.source === "proxy") return false;
  return f.source === "cache" || f.reason === "unsupported" || blocked || (f.source === "binance" && f.consecutiveFailures >= 2);
}

function mapFeeds(h: ProviderHealth, fn: (f: FeedHealth, spec: FeedSpec) => FeedHealth, specs: Specs, only?: readonly FeedId[]): ProviderHealth {
  let changed = false;
  const feeds = { ...h.feeds };
  for (const id of only ?? FEED_IDS) {
    const cur = h.feeds[id];
    const next = fn(cur, specs[id]);
    if (next !== cur) {
      feeds[id] = next;
      changed = true;
    }
  }
  return changed ? { ...h, feeds } : h;
}

export function reduceHealth(h: ProviderHealth, ev: HealthEvent, specs: Specs): ProviderHealth {
  switch (ev.type) {
    case "start":
    case "stop":
      return finish({
        ...mapFeeds(h, (f) => ({ ...f, state: "connecting", consecutiveFailures: 0, reason: undefined, detail: undefined, nextRefreshAt: undefined, source: specs[f.feed].sources[0] ?? "binance" }), specs),
        ws: { state: "connecting", attempt: 0 },
        primary: ev.type === "start" ? h.primary : { ...h.primary, blocked: false, reachable: "unknown", nextProbeAt: undefined },
      });

    case "online": {
      if (!ev.online) {
        return finish({
          ...mapFeeds(h, (f) => (f.state === "offline" && f.reason === "offline" ? f : { ...f, state: "offline", reason: "offline" }), specs),
          online: false,
          ws: { ...h.ws, state: "offline" },
        });
      }
      const wasOffline = !h.online;
      return finish({
        ...mapFeeds(h, (f) => (f.state === "offline" && (f.reason === "offline" || wasOffline) ? { ...f, state: "connecting", reason: undefined, consecutiveFailures: 0, source: specs[f.feed].sources[0] ?? f.source } : f), specs),
        online: true,
        ws: h.ws.state === "offline" ? { ...h.ws, state: "connecting" } : h.ws,
      });
    }

    case "tick":
      return finish(
        mapFeeds(
          h,
          (f, spec) => {
            if ((f.state !== "live" && f.state !== "fallback") || f.lastDataAt === undefined) return f;
            const { staleAfterMs } = effectiveSpec(spec, f.source, f.state);
            return ev.now - f.lastDataAt > staleAfterMs ? { ...f, state: "stale" } : f;
          },
          specs,
        ),
      );

    case "ws_open":
      return { ...h, ws: { ...h.ws, connectedAt: ev.now, nextRetryAt: undefined } };

    case "ws_message": {
      const asOf = ev.asOf ?? ev.now;
      const ws = { ...h.ws, state: "live" as HealthState, lastMessageAt: ev.now };
      return finish({
        ...mapFeeds(
          h,
          (f) => ({
            ...f,
            state: "live",
            source: "binance",
            lastDataAt: asOf,
            consecutiveFailures: 0,
            reason: f.reason === "bad_period" ? f.reason : undefined,
            detail: f.reason === "bad_period" ? f.detail : undefined,
          }),
          specs,
          ev.feeds,
        ),
        ws,
      });
    }

    case "ws_silent": {
      // the third attempt in a row without a message (open-but-silent sockets included) exhausts the socket like a close
      const exhausted = (ev.failedAttempts ?? 0) >= WS_MAX_FAILED;
      return finish({
        ...mapFeeds(
          h,
          (f) => {
            if (f.source !== "binance") return f;
            if (exhausted) return f.state === "offline" ? f : { ...f, state: "fallback", reason: "ws_silent" };
            return f.state === "live" ? { ...f, state: "stale", reason: "ws_silent" } : f;
          },
          specs,
          WS_FEEDS,
        ),
        ws: { ...h.ws, state: exhausted ? "fallback" : "stale" },
      });
    }

    case "ws_retry":
      return { ...h, ws: { ...h.ws, attempt: ev.attempt, nextRetryAt: ev.nextRetryAt } };

    case "ws_close": {
      const exhausted = ev.failedAttempts >= WS_MAX_FAILED;
      const ws = { ...h.ws, state: (exhausted ? "fallback" : "connecting") as HealthState, connectedAt: undefined };
      if (!exhausted) return finish({ ...h, ws });
      // WS-fed feeds stay on Binance but fall back to REST polling; REST failures ×3 then advance the source
      return finish({
        ...mapFeeds(h, (f) => (f.source === "binance" && f.state !== "offline" ? { ...f, state: "fallback", reason: "ws_closed" } : f), specs, WS_FEEDS),
        ws,
      });
    }

    case "rest_ok":
      return finish(
        mapFeeds(
          h,
          (f, spec) => {
            // WS feed polled over REST while the socket is not delivering (silent, exhausted, reconnecting): the REST
            // stand-in reads `fallback` (reason ws_silent / ws_closed) until a WS message arrives — never "Live · 1 s"
            const standIn = spec.transport === "ws" && ev.source === "binance" && wsDown(h);
            return {
              ...f,
              state: standIn ? "fallback" : ev.source === (spec.sources[0] ?? "binance") ? "live" : "fallback",
              source: ev.source,
              lastDataAt: ev.asOf,
              consecutiveFailures: 0,
              nextRefreshAt: ev.nextRefreshAt ?? f.nextRefreshAt,
              reason: f.reason === "bad_period" ? f.reason : standIn ? (f.reason === "ws_silent" ? "ws_silent" : "ws_closed") : undefined,
              detail: f.reason === "bad_period" ? f.detail : undefined,
            };
          },
          specs,
          [ev.feed],
        ),
      );

    case "rest_fail":
      return finish(
        mapFeeds(
          h,
          (f, spec) => {
            // a late failure from a source the feed already left (e.g. moved by a blocked probe meanwhile)
            if (ev.source !== f.source) return f;
            const failures = f.consecutiveFailures + 1;
            if (ev.kind === "bad_symbol" || ev.kind === "bad_period" || ev.kind === "beyond_retention") {
              return { ...f, consecutiveFailures: failures, reason: ev.kind, detail: ev.detail };
            }
            if (ev.kind === "unsupported") {
              return { ...f, state: "fallback", reason: "unsupported", detail: ev.detail };
            }
            const hard = ev.kind === "blocked_451" || ev.kind === "cors";
            if (hard || failures >= FAILURES_BEFORE_FALLBACK) return advance(h, { ...f, consecutiveFailures: failures }, spec, ev.kind, ev.detail);
            return { ...f, consecutiveFailures: failures, reason: ev.kind, detail: ev.detail };
          },
          specs,
          [ev.feed],
        ),
      );

    case "schedule":
      return mapFeeds(h, (f) => (f.nextRefreshAt === ev.nextRefreshAt ? f : { ...f, nextRefreshAt: ev.nextRefreshAt }), specs, [ev.feed]);

    case "unsupported":
      return finish(
        mapFeeds(
          h,
          (f, spec) => {
            // a Binance-only ratio parked on Bybit goes on to the proxy when that serves Binance's data
            if (isFamilyFeed(f.feed) && h.proxy.usable === true && spec.sources.includes("proxy")) {
              return { ...f, state: "fallback", source: "proxy", consecutiveFailures: 0, reason: undefined, detail: undefined };
            }
            return { ...f, state: "fallback", source: ev.source, reason: "unsupported", detail: ev.detail };
          },
          specs,
          [ev.feed],
        ),
      );

    case "move":
      return finish(
        mapFeeds(
          h,
          (f, spec) =>
            f.source === ev.source
              ? f
              : { ...f, source: ev.source, state: ev.source === (spec.sources[0] ?? "binance") ? "connecting" : "fallback", consecutiveFailures: 0, reason: ev.reason, detail: ev.detail },
          specs,
          [ev.feed],
        ),
      );

    case "probe_scheduled":
      return h.primary.nextProbeAt === ev.at ? h : { ...h, primary: { ...h.primary, nextProbeAt: ev.at } };

    case "clock":
      return (h.clockSkewMs ?? 0) === ev.skewMs ? h : { ...h, clockSkewMs: ev.skewMs };

    case "bad_period":
      return mapFeeds(h, (f) => ({ ...f, reason: "bad_period", detail: ev.detail }), specs, ev.feeds);

    case "bad_symbol":
      return finish({
        ...mapFeeds(h, (f) => ({ ...f, reason: "bad_symbol", state: "offline" }), specs),
        primary: { ...h.primary, reachable: true, lastProbeAt: ev.now },
      });

    case "probe": {
      if (ev.source === "proxy") {
        const usable = ev.ok;
        const base: ProviderHealth = { ...h, proxy: { usable, blocked: ev.blocked ?? false } };
        return finish(
          mapFeeds(
            base,
            (f, spec) => {
              if (!isFamilyFeed(f.feed) || !spec.sources.includes("proxy")) return f;
              if (usable && wantsProxy(f, h.primary.blocked)) return { ...f, state: "fallback", source: "proxy", consecutiveFailures: 0, reason: undefined, detail: undefined };
              if (!usable && f.source === "proxy") return { ...f, state: "connecting", source: spec.sources[0] ?? "binance", consecutiveFailures: 0, reason: undefined, detail: undefined };
              return f;
            },
            specs,
          ),
        );
      }
      if (ev.source !== "binance") return h;
      if (ev.ok) {
        return finish({
          ...mapFeeds(
            h,
            (f, spec) => {
              const primary = spec.sources[0] ?? "binance";
              if (primary !== "binance" || f.source === "binance") return f;
              // the proxy serves Binance's own data: futures-data feeds routed there stay (CORS / user preference)
              if (f.source === "proxy" && ALL_FUTURES_DATA_FEEDS.includes(f.feed)) return f;
              return { ...f, state: "connecting", source: "binance", consecutiveFailures: 0, reason: undefined, detail: undefined };
            },
            specs,
          ),
          primary: { source: "binance", reachable: true, blocked: false, lastProbeAt: ev.now, nextProbeAt: h.primary.nextProbeAt },
          ws: h.ws.state === "live" ? h.ws : { ...h.ws, state: "connecting", attempt: 0 },
        });
      }
      const blocked = ev.blocked ?? h.primary.blocked;
      const base: ProviderHealth = { ...h, primary: { source: "binance", reachable: false, blocked, lastProbeAt: ev.now, nextProbeAt: h.primary.nextProbeAt } };
      if (!blocked) return finish(base);
      return finish({
        ...mapFeeds(base, (f, spec) => (f.source === "binance" ? advance(base, f, spec, "blocked_451") : f), specs),
        ws: h.ws.state === "live" ? h.ws : { ...h.ws, state: "fallback" },
      });
    }
  }
}

/** Convenience: which feeds are currently served by `source`. */
export function feedsBySource(h: ProviderHealth, source: Source): FeedId[] {
  return FEED_IDS.filter((f) => h.feeds[f].source === source);
}
