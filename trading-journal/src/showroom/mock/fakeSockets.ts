/**
 * The Showroom's WebSocket replacement (Paket S): `window.WebSocket` is swapped for a factory that hands out
 *   - a Supabase Realtime connection (answered by the mock project's Phoenix handler, `supabaseCore.realtime`) – only the part of the
 *     WebSocket interface supabase-js uses is implemented,
 *   - and, for every other address (the Binance stream `fstream.binance.com` …), the browser's real WebSocket: market data is live, as in
 *     the normal build.
 */
import type { Backend } from "./backend";

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

export function installSockets(backend: Backend): () => void {
  const Supabase = supabaseSocket(backend);
  const original = window.WebSocket;
  const Factory = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const u = new URL(String(url));
    if (backend.isSupabaseHost(u.hostname)) return new Supabase(String(url));
    // market streams: the real socket
    return protocols === undefined ? new original(url) : new original(url, protocols);
  } as unknown as typeof WebSocket;
  Object.assign(Factory, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  Object.defineProperty(window, "WebSocket", { value: Factory, configurable: true, writable: true });
  return () => Object.defineProperty(window, "WebSocket", { value: original, configurable: true, writable: true });
}
