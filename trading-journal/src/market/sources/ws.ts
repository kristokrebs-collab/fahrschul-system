/**
 * Binance combined-stream WebSocket client (Plan 4.2 "WS-Regeln").
 * - liveness by message arrival (`markPrice@1s` is the heartbeat): 10 s silence → close + reconnect (`ws_silent`)
 * - full-jitter exponential backoff, `attempt` reset after 60 s stable
 * - proactive rollover at 23 h: open a second socket, wait for its first message, close the old one
 * - `visibilitychange`: no reconnects while hidden; on visible reconnect when silent > 10 s; `online` → reconnect
 * Browsers answer ping frames automatically; nothing is ever sent by this client.
 */
import { WS_MAX_FAILED, WS_ROLLOVER_MS, WS_SILENT_MS, WS_STABLE_MS, wsBackoffMs, type TimerHost, realTimerHost } from "../schedule";

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
  onSilent?(now: number): void;
  onRetry?(attempt: number, nextRetryAt: number, now: number): void;
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
  /** returns true while the tab is hidden (no reconnects then) */
  hidden?: () => boolean;
}

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
  private stopped = true;
  private attempt = 0;
  private failed = 0;
  private openedAt = 0;
  private gotMessage = false;
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
   * `visibilitychange → visible` / `online`: reconnect when the stream went silent meanwhile — including when the
   * silent timer already fired while the tab was hidden (`state === "silent"`, no timer armed any more). An open,
   * healthy socket gets its silent timer re-armed (timers may have been throttled while hidden).
   */
  nudge(): void {
    if (this.stopped) return;
    const now = this.host.now();
    if (this.state === "fallback" || this.state === "closed") {
      this.failed = 0;
      this.attempt = 0;
      this.connect();
      return;
    }
    if (this.state === "silent" || (this.state === "open" && now - this.lastMessageAt > this.silentMs)) {
      this.opts.onSilent?.(now);
      this.reconnect();
      return;
    }
    if (this.state === "open") this.armSilent(Math.max(1, this.lastMessageAt + this.silentMs - now));
  }

  private timers: { silent?: unknown; rollover?: unknown; stable?: unknown; retry?: unknown } = {};

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
    let sock: WsLike;
    try {
      sock = this.factory(this.opts.url());
    } catch {
      this.onFail(1006);
      return;
    }
    this.ws = sock;
    this.bind(sock, false);
  }

  private bind(sock: WsLike, isRollover: boolean): void {
    const now = () => this.host.now();
    sock.onopen = () => {
      if (isRollover) return; // becomes primary on first message
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
      this.onFail(ev.code ?? 1006);
    };
    sock.onerror = () => {
      /* the close event follows; nothing to do */
    };
  }

  private onFail(code: number): void {
    if (this.stopped) return;
    this.clearTimers();
    this.ws = null;
    const now = this.host.now();
    // a connection that never delivered a message counts as a failed attempt
    this.failed = this.gotMessage ? 0 : this.failed + 1;
    this.state = "closed";
    this.opts.onClose?.(code, this.failed, now);
    if (this.failed >= this.maxFailed) {
      this.state = "fallback";
      this.opts.onFallback?.(now);
      // keep trying in the background with capped backoff; the provider polls REST meanwhile
    }
    if (this.hidden()) return; // resumed via nudge()
    const delay = wsBackoffMs(this.attempt, this.random);
    this.attempt += 1;
    this.opts.onRetry?.(this.attempt, now + delay, now);
    this.timers.retry = this.host.setTimeout(() => this.connect(), delay);
  }

  /** Arms the silence check `delayMs` from now (default: the full window; `nudge()` passes the remaining part). */
  private armSilent(delayMs: number = this.silentMs): void {
    if (this.timers.silent != null) this.host.clearTimeout(this.timers.silent);
    this.timers.silent = this.host.setTimeout(() => {
      if (this.stopped || !this.ws) return;
      const now = this.host.now();
      if (now - this.lastMessageAt >= this.silentMs) {
        this.state = "silent";
        this.opts.onSilent?.(now);
        if (this.hidden()) return; // reconnect on visible via nudge()
        this.reconnect();
      } else {
        this.armSilent();
      }
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
