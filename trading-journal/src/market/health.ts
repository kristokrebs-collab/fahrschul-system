/**
 * Health state machine (Plan 4.4): a pure reducer per feed plus the aggregate.
 *
 *   connecting --rest_ok | ws_message------------------------------> live
 *   live       --tick: now − lastDataAt > staleAfterMs--------------> stale
 *   live|stale --rest_fail×3 | ws_close + 3 failed reconnects
 *              | rest_fail(kind ∈ {blocked_451, cors})--------------> fallback   (next source in spec.sources)
 *   stale      --rest_ok | ws_message------------------------------> live
 *   fallback   --probe(binance ok)---------------------------------> connecting (primary re-adopted, data kept)
 *   fallback   --all sources failed ×3----------------------------> offline    (cache)
 *   any        --online:false--------------------------------------> offline
 *   offline    --online:true---------------------------------------> connecting
 *   overall = worst(feeds), rank live < connecting < stale < fallback < offline
 */
import type { FailureReason, FeedHealth, FeedId, FeedSpec, HealthEvent, HealthState, ProviderHealth, Source } from "./types";
import { FEED_IDS, WS_FEEDS, effectiveSpec } from "./feeds";
import { WS_MAX_FAILED } from "./schedule";

export const RANK: Record<HealthState, number> = { live: 0, connecting: 1, stale: 2, fallback: 3, offline: 4 };
export const FAILURES_BEFORE_FALLBACK = 3;

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

function nextSource(spec: FeedSpec, current: Source): Source | undefined {
  const idx = spec.sources.indexOf(current);
  const next = spec.sources[idx + 1];
  return next && next !== "cache" ? next : undefined;
}

/** Moves a feed to the next source in its chain, or offline (cache) when exhausted. */
function advance(f: FeedHealth, spec: FeedSpec, reason: FailureReason | undefined, detail?: string): FeedHealth {
  const next = nextSource(spec, f.source);
  if (!next) return { ...f, state: "offline", source: "cache", consecutiveFailures: f.consecutiveFailures, reason, detail };
  return { ...f, state: "fallback", source: next, consecutiveFailures: 0, reason, detail };
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
        primary: ev.type === "start" ? h.primary : { ...h.primary, blocked: false, reachable: "unknown" },
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

    case "ws_silent":
      return finish({
        ...mapFeeds(h, (f) => (f.source === "binance" && f.state === "live" ? { ...f, state: "stale", reason: "ws_silent" } : f), specs, WS_FEEDS),
        ws: { ...h.ws, state: "stale" },
      });

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
            // WS feed polled over REST while the socket is down: stays `fallback` (reason ws_closed) until a WS message arrives
            const wsDown = spec.transport === "ws" && ev.source === "binance" && h.ws.state === "fallback";
            return {
              ...f,
              state: wsDown ? "fallback" : ev.source === (spec.sources[0] ?? "binance") ? "live" : "fallback",
              source: ev.source,
              lastDataAt: ev.asOf,
              consecutiveFailures: 0,
              nextRefreshAt: ev.nextRefreshAt ?? f.nextRefreshAt,
              reason: f.reason === "bad_period" ? f.reason : wsDown ? "ws_closed" : undefined,
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
            const failures = f.consecutiveFailures + 1;
            if (ev.kind === "bad_symbol" || ev.kind === "bad_period" || ev.kind === "beyond_retention") {
              return { ...f, consecutiveFailures: failures, reason: ev.kind, detail: ev.detail };
            }
            if (ev.kind === "unsupported") {
              return { ...f, state: "fallback", reason: "unsupported", detail: ev.detail };
            }
            const hard = ev.kind === "blocked_451" || ev.kind === "cors";
            if (hard || failures >= FAILURES_BEFORE_FALLBACK) return advance({ ...f, consecutiveFailures: failures }, spec, ev.kind, ev.detail);
            return { ...f, consecutiveFailures: failures, reason: ev.kind, detail: ev.detail };
          },
          specs,
          [ev.feed],
        ),
      );

    case "schedule":
      return mapFeeds(h, (f) => (f.nextRefreshAt === ev.nextRefreshAt ? f : { ...f, nextRefreshAt: ev.nextRefreshAt }), specs, [ev.feed]);

    case "unsupported":
      return finish(mapFeeds(h, (f) => ({ ...f, state: "fallback", source: ev.source, reason: "unsupported", detail: ev.detail }), specs, [ev.feed]));

    case "bad_period":
      return mapFeeds(h, (f) => ({ ...f, reason: "bad_period", detail: ev.detail }), specs, ev.feeds);

    case "bad_symbol":
      return finish({
        ...mapFeeds(h, (f) => ({ ...f, reason: "bad_symbol", state: "offline" }), specs),
        primary: { ...h.primary, reachable: true, lastProbeAt: ev.now },
      });

    case "probe": {
      if (ev.source === "proxy") return { ...h, proxy: { usable: ev.ok, blocked: ev.blocked ?? false } };
      if (ev.source !== "binance") return h;
      if (ev.ok) {
        return finish({
          ...mapFeeds(
            h,
            (f, spec) => {
              const primary = spec.sources[0] ?? "binance";
              if (primary !== "binance" || f.source === "binance") return f;
              return { ...f, state: "connecting", source: "binance", consecutiveFailures: 0, reason: undefined, detail: undefined };
            },
            specs,
          ),
          primary: { source: "binance", reachable: true, blocked: false, lastProbeAt: ev.now },
          ws: h.ws.state === "live" ? h.ws : { ...h.ws, state: "connecting", attempt: 0 },
        });
      }
      const blocked = ev.blocked ?? h.primary.blocked;
      const base: ProviderHealth = { ...h, primary: { source: "binance", reachable: false, blocked, lastProbeAt: ev.now } };
      if (!blocked) return finish(base);
      return finish({
        ...mapFeeds(base, (f, spec) => (f.source === "binance" ? advance(f, spec, "blocked_451") : f), specs),
        ws: h.ws.state === "live" ? h.ws : { ...h.ws, state: "fallback" },
      });
    }
  }
}

/** Convenience: which feeds are currently served by `source`. */
export function feedsBySource(h: ProviderHealth, source: Source): FeedId[] {
  return FEED_IDS.filter((f) => h.feeds[f].source === source);
}
