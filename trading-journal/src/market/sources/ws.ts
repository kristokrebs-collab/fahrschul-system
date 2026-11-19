/**
 * Binance combined-stream WebSocket client (Plan 4.2 "WS-Regeln").
 * - liveness by message arrival (`markPrice@1s` is the heartbeat): 10 s silence → the socket is closed here and counts
 *   like a close (`ws_silent`) — a browser never learns of a dead TCP connection by itself (NAT timeout, network switch,
 *   Samsung Internet waking up), so an "open" socket without frames IS a failed connection
 * - an attempt that never delivered a message is a failed attempt; `WS_MAX_FAILED` (3) in a row → `fallback` (the provider
 *   polls REST meanwhile); the client keeps retrying for good: at once after a blip on a socket that had been delivering,
 *   otherwise 1 s, 2 s, 4 s … 30 s (`wsBackoffMs`), `attempt` reset after 60 s stable
 * - proactive rollover at 23 h: open a second socket, wait for its first message, close the old one
 * - hidden tab: reconnects at most once a minute (`WS_HIDDEN_RETRY_MS`; the signal check's system notifications
 *   still need the stream); `nudge()` on visible / `online` / resume reconnects at once whatever the state
 * Browsers answer ping frames automatically; nothing is ever sent by this client.
 */
import { WS_CONNECT_TIMEOUT_MS, WS_HIDDEN_RETRY_MS, WS_MAX_FAILED, WS_ROLLOVER_MS, WS_SILENT_MS, WS_STABLE_MS, wsBackoffMs, type TimerHost, realTimerHost } from "../schedule";

export type WsClientState = "idle" | "connecting" | "open" | "silent" | "closed" | "fallback";

export interface WsLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(code?: number, reason?: string): void;
}
export type WsFactory = (url: string) => WsLike;

export interface WsClientEvents {
  onMessage(raw: string, now: number): void;
  onOpen?(now: number): void;
  onClose?(code: number, failedAttempts: number, now: number): void;
  /** the stream went silent (the socket is closed and replaced); `failedAttempts` counts attempts without a message */
  onSilent?(now: number, failedAttempts: number): void;
  onRetry?(attempt: number, nextRetryAt: number, now: number): void;
  /** `WS_MAX_FAILED` attempts in a row without a message (fired once per transition into `fallback`) */
  onFallback?(now: number): void;
}

export interface WsClientOptions extends WsClientEvents {
  url: () => string;
  factory?: WsFactory;
  host?: TimerHost;
  random?: () => number;
  silentMs?: number;
  rolloverMs?: number;
  stableMs?: number;
  maxFailed?: number;
  /** returns true while the tab is hidden (reconnects slowed to `hiddenRetryMs` then) */
  hidden?: () => boolean;
  /** reconnect pace while hidden (default `WS_HIDDEN_RETRY_MS`) */
  hiddenRetryMs?: number;
  /** a socket that neither opens nor closes within this time counts as failed (default `WS_CONNECT_TIMEOUT_MS`) */
  connectTimeoutMs?: number;
}

/** `nudge()` restarts a handshake that has been pending for longer than this. */
const NUDGE_STALE_CONNECT_MS = 5_000;

type FailCause = "closed" | "silent";

export class WsClient {
  private ws: WsLike | null = null;
  private pending: WsLike | null = null; // rollover socket
  private host: TimerHost;
  private factory: WsFactory;
  private random: () => number;
  private silentMs: number;
  private rolloverMs: number;
  private stableMs: number;
  private maxFailed: number;
  private hidden: () => boolean;
  private hiddenRetryMs: number;
  private connectTimeoutMs: number;
  private stopped = true;
  private attempt = 0;
  private failed = 0;
  private openedAt = 0;
  private connectStartedAt = 0;
  private gotMessage = false;
  /** when the last blip reconnect went out without a backoff (at most one per `stableMs`: never a reconnect loop) */
  private lastBlipAt = -Infinity;
  lastMessageAt = 0;
  state: WsClientState = "idle";

  constructor(private opts: WsClientOptions) {
    this.host = opts.host ?? realTimerHost;
    this.factory = opts.factory ?? ((url) => new WebSocket(url) as unknown as WsLike);
    this.random = opts.random ?? Math.random;
    this.silentMs = opts.silentMs ?? WS_SILENT_MS;
    this.rolloverMs = opts.rolloverMs ?? WS_ROLLOVER_MS;
    this.stableMs = opts.stableMs ?? WS_STABLE_MS;
    this.maxFailed = opts.maxFailed ?? WS_MAX_FAILED;
    this.hidden = opts.hidden ?? (() => false);
    this.hiddenRetryMs = opts.hiddenRetryMs ?? WS_HIDDEN_RETRY_MS;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? WS_CONNECT_TIMEOUT_MS;
  }

  /** A reconnect is armed (the backoff after a failure, or the slow hidden-tab retry). */
  get retryPending(): boolean {
    return this.timers.retry != null;
  }

  get attempts(): number {
    return this.attempt;
  }
  get failedAttempts(): number {
    return this.failed;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.failed = 0;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.closeSocket(this.pending);
    this.closeSocket(this.ws);
    this.pending = null;
    this.ws = null;
    this.state = "idle";
  }

  /** Forces a fresh connection (URL change, `online` event, manual). */
  reconnect(): void {
    if (this.stopped) return;
    this.clearTimers();
    this.closeSocket(this.pending);
    this.pending = null;
    this.closeSocket(this.ws);
    this.ws = null;
    this.connect();
  }

  /**
   * `visibilitychange → visible` / `online` / Page Lifecycle `resume`: whatever the state, a live connection is on its
   * way NOW — a stream that went silent (also when the silent timer already fired while the tab was hidden and the slow
   * hidden retry is still pending), a closed or exhausted socket waiting for its backoff, a handshake started before the
   * tab was hidden / the device slept, an "open" socket without frames (throttled timers). An open, healthy socket gets
   * its silent timer re-armed.
   */
  nudge(): void {
    if (this.stopped) return;
    const now = this.host.now();
    if (this.state === "fallback" || this.state === "closed" || this.state === "silent") {
      this.failed = 0;
      this.attempt = 0;
      this.reconnect(); // clears the armed retry first (it would open a second socket)
      return;
    }
    // a handshake started long ago (before the tab was hidden / the device slept) is not worth waiting for
    if (this.state === "connecting" && now - this.connectStartedAt > NUDGE_STALE_CONNECT_MS) {
      this.attempt = 0;
      this.reconnect();
      return;
    }
    if (this.state === "open" && now - this.lastMessageAt > this.silentMs) {
      this.fail(1006, "silent", true);
      return;
    }
    if (this.state === "open") this.armSilent(Math.max(1, this.lastMessageAt + this.silentMs - now));
  }

  private timers: { silent?: unknown; rollover?: unknown; stable?: unknown; retry?: unknown; connect?: unknown } = {};

  private clearTimers(): void {
    for (const k of Object.keys(this.timers) as (keyof typeof this.timers)[]) {
      const h = this.timers[k];
      if (h != null) this.host.clearTimeout(h);
      this.timers[k] = undefined;
    }
  }

  private closeSocket(s: WsLike | null): void {
    if (!s) return;
    s.onopen = s.onmessage = s.onclose = s.onerror = null;
    try {
      s.close(1000, "client");
    } catch {
      /* already closed */
    }
  }

  private connect(): void {
    if (this.stopped) return;
    this.state = "connecting";
    this.gotMessage = false;
    this.connectStartedAt = this.host.now();
    let sock: WsLike;
    try {
      sock = this.factory(this.opts.url());
    } catch {
      this.fail(1006, "closed");
      return;
    }
    this.ws = sock;
    this.bind(sock, false);
    // a handshake that hangs (radio waking up, captive network) never fires open or close: give up and retry
    this.timers.connect = this.host.setTimeout(() => {
      this.timers.connect = undefined;
      if (this.stopped || this.ws !== sock || this.state !== "connecting") return;
      this.closeSocket(sock);
      this.fail(1006, "closed");
    }, this.connectTimeoutMs);
  }

  private bind(sock: WsLike, isRollover: boolean): void {
    const now = () => this.host.now();
    sock.onopen = () => {
      if (isRollover) return; // becomes primary on first message
      if (this.timers.connect != null) this.host.clearTimeout(this.timers.connect);
      this.timers.connect = undefined;
      this.state = "open";
      this.openedAt = now();
      this.lastMessageAt = this.openedAt;
      this.opts.onOpen?.(this.openedAt);
      this.armSilent();
      this.armRollover();
      this.armStable();
    };
    sock.onmessage = (ev) => {
      const t = now();
      if (isRollover) {
        // first message on the new socket: promote it, close the old one
        const old = this.ws;
        this.pending = null;
        this.ws = sock;
        this.closeSocket(old);
        this.state = "open";
        this.openedAt = t;
        this.armRollover();
        this.armStable();
        this.bind(sock, false);
      }
      this.gotMessage = true;
      this.failed = 0; // a frame arrived: no failed attempts in a row any more
      this.lastMessageAt = t;
      this.state = "open";
      this.armSilent();
      this.opts.onMessage(typeof ev.data === "string" ? ev.data : String(ev.data), t);
    };
    sock.onclose = (ev) => {
      if (isRollover) {
        this.pending = null;
        return;
      }
      if (this.ws !== sock) return;
      this.fail(ev.code ?? 1006, "closed");
    };
    sock.onerror = () => {
      /* the close event follows; nothing to do */
    };
  }

  /**
   * The current attempt ended: the handshake failed or timed out, the server closed the socket (`closed`), or the
   * stream went silent (`silent` — the socket is closed here). An attempt that never delivered a message is a failed
   * attempt; `maxFailed` of them in a row → `fallback` (the provider polls REST meanwhile). The next attempt starts at
   * once when this socket had been delivering (a blip — at most once per `stableMs`, so a server that accepts, sends a
   * frame and drops the socket never spins a reconnect loop) or when `immediate` (a nudge), else after the backoff ladder.
   */
  private fail(code: number, cause: FailCause, immediate = false): void {
    if (this.stopped) return;
    this.clearTimers();
    const sock = this.ws;
    this.ws = null;
    if (cause === "silent") this.closeSocket(sock);
    const now = this.host.now();
    const delivered = this.gotMessage;
    this.failed = delivered ? 0 : this.failed + 1;
    this.state = cause === "silent" ? "silent" : "closed";
    if (cause === "silent") this.opts.onSilent?.(now, this.failed);
    else this.opts.onClose?.(code, this.failed, now);
    if (this.failed >= this.maxFailed) {
      this.state = "fallback";
      if (this.failed === this.maxFailed) this.opts.onFallback?.(now); // once per transition, not on every later attempt
      // keep trying for good with the capped backoff; the provider polls REST meanwhile
    }
    const blip = delivered && now - this.lastBlipAt >= this.stableMs;
    if (blip) this.lastBlipAt = now;
    this.armRetry(now, blip || immediate);
  }

  /**
   * Arms the next attempt: synchronously after a blip / nudge (`atOnce`), else after `wsBackoffMs(attempt)` — 1 s, 2 s,
   * 4 s … 30 s. Hidden: at least `hiddenRetryMs` (≥ 1 min), so a background tab keeps its stream without a tight loop;
   * `nudge()` on visible reconnects at once.
   */
  private armRetry(now: number, atOnce: boolean): void {
    let delay = atOnce ? 0 : wsBackoffMs(this.attempt, this.random);
    if (!atOnce) this.attempt += 1;
    if (this.hidden()) delay = Math.max(this.hiddenRetryMs, delay);
    this.opts.onRetry?.(this.attempt, now + delay, now);
    if (delay === 0) {
      this.connect();
      return;
    }
    this.timers.retry = this.host.setTimeout(() => {
      this.timers.retry = undefined;
      this.connect();
    }, delay);
  }

  /** Arms the silence check `delayMs` from now (default: the full window; `nudge()` passes the remaining part). */
  private armSilent(delayMs: number = this.silentMs): void {
    if (this.timers.silent != null) this.host.clearTimeout(this.timers.silent);
    this.timers.silent = this.host.setTimeout(() => {
      this.timers.silent = undefined;
      if (this.stopped || !this.ws) return;
      const now = this.host.now();
      if (now - this.lastMessageAt >= this.silentMs) this.fail(1006, "silent");
      else this.armSilent();
    }, delayMs);
  }

  private armStable(): void {
    if (this.timers.stable != null) this.host.clearTimeout(this.timers.stable);
    this.timers.stable = this.host.setTimeout(() => {
      if (this.state === "open") {
        this.attempt = 0;
        this.failed = 0;
      }
    }, this.stableMs);
  }

  private armRollover(): void {
    if (this.timers.rollover != null) this.host.clearTimeout(this.timers.rollover);
    this.timers.rollover = this.host.setTimeout(() => this.rollover(), this.rolloverMs);
  }

  private rollover(): void {
    if (this.stopped || !this.ws) return;
    let sock: WsLike;
    try {
      sock = this.factory(this.opts.url());
    } catch {
      return;
    }
    this.pending = sock;
    this.bind(sock, true);
  }
}
