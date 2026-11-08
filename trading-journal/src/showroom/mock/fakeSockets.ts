/**
 * The Showroom's WebSocket replacement (Paket S): `window.WebSocket` is swapped for `ShowroomSocketFactory`, which hands out
 *   - a Supabase Realtime connection (answered by the mock project's Phoenix handler, `supabaseCore.realtime`),
 *   - a Binance combined-stream connection (generated frames, `marketCore.wsFrame`: mark price once a second, trades, the book top, candles),
 *   - and, for any other address, a socket that never opens and closes at once (no connection to a foreign host exists in the Showroom).
 * Only the part of the WebSocket interface the app and supabase-js use is implemented.
 */
import type { Backend } from "./backend";
import { wsFrame } from "./marketCore";

type Handler = ((ev: Event) => void) | null;

class BaseSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  readonly url: string;
  readonly protocol = "";
  readonly extensions = "";
  bufferedAmount = 0;
  binaryType: BinaryType = "blob";
  onopen: Handler = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: Handler = null;
  protected timers: number[] = [];

  constructor(url: string) {
    super();
    this.url = url;
  }

  protected later(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }
  protected every(ms: number, fn: () => void): void {
    this.timers.push(window.setInterval(fn, ms));
  }
  protected emitOpen(): void {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    const ev = new Event("open");
    this.onopen?.(ev);
    this.dispatchEvent(ev);
  }
  protected emitMessage(data: string): void {
    if (this.readyState !== 1) return;
    const ev = new MessageEvent("message", { data });
    this.onmessage?.(ev);
    this.dispatchEvent(ev);
  }
  protected emitClose(code = 1000): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    for (const t of this.timers) {
      window.clearTimeout(t);
      window.clearInterval(t);
    }
    this.timers = [];
    const ev = new CloseEvent("close", { code, wasClean: code === 1000 });
    this.onclose?.(ev);
    this.dispatchEvent(ev);
  }
  send(_data: unknown): void {
    /* the base socket swallows what it is sent */
  }
  close(code = 1000): void {
    this.emitClose(code);
  }
}

/** Supabase Realtime: Phoenix frames to the mock project. */
function supabaseSocket(backend: Backend) {
  return class SupabaseSocket extends BaseSocket {
    private conn: ReturnType<Backend["sb"]["realtime"]["open"]>;
    constructor(url: string) {
      super(url);
      this.conn = backend.sb.realtime.open({ send: (frame) => this.later(0, () => this.emitMessage(frame)) });
      this.later(5, () => this.emitOpen());
    }
    override send(data: unknown): void {
      if (this.readyState === 1) this.conn.message(String(data));
    }
    override close(code = 1000): void {
      this.conn.close();
      super.close(code);
    }
  };
}

/** Binance combined stream (`wss://fstream.binance.com/stream?streams=a/b/c`). */
function marketSocket(backend: Backend) {
  return class MarketSocket extends BaseSocket {
    private n = 0;
    constructor(url: string) {
      super(url);
      const streams = (new URL(url).searchParams.get("streams") ?? "").split("/").filter(Boolean);
      const send = (match: (s: string) => boolean) => {
        for (const s of streams) {
          if (!match(s)) continue;
          const f = wsFrame(s, backend.market, ++this.n);
          if (f) this.emitMessage(JSON.stringify(f));
        }
      };
      this.later(30, () => {
        this.emitOpen();
        send((s) => s.includes("@markPrice") || s.includes("@kline_") || s.includes("@bookTicker") || s.includes("@aggTrade"));
      });
      this.every(1000, () => send((s) => s.includes("@markPrice")));
      this.every(650, () => send((s) => s.endsWith("@aggTrade")));
      this.every(900, () => send((s) => s.endsWith("@bookTicker")));
      this.every(4000, () => send((s) => s.includes("@kline_")));
    }
  };
}

/** A socket to a host that does not exist here: it never opens. */
class DeadSocket extends BaseSocket {
  constructor(url: string) {
    super(url);
    this.later(20, () => {
      const ev = new Event("error");
      this.onerror?.(ev);
      this.dispatchEvent(ev);
      this.emitClose(1006);
    });
  }
}

export function installSockets(backend: Backend): () => void {
  const Supabase = supabaseSocket(backend);
  const Market = marketSocket(backend);
  const Factory = function (this: unknown, url: string | URL) {
    const u = new URL(String(url));
    if (backend.isSupabaseHost(u.hostname) || u.pathname.includes("/realtime/")) return new Supabase(String(url));
    if (u.hostname === "fstream.binance.com") return new Market(String(url));
    return new DeadSocket(String(url));
  } as unknown as typeof WebSocket;
  Object.assign(Factory, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  const original = window.WebSocket;
  Object.defineProperty(window, "WebSocket", { value: Factory, configurable: true, writable: true });
  return () => Object.defineProperty(window, "WebSocket", { value: original, configurable: true, writable: true });
}
