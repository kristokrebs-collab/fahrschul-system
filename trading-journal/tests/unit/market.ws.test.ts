import { describe, expect, it } from "vitest";
import { WsClient, type WsLike } from "@/market/sources/ws";
import type { TimerHost } from "@/market/schedule";

/** Deterministic timer host: `advance(ms)` fires due timers in order. */
function fakeHost(start = 1_000_000) {
  let now = start;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const host: TimerHost = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (h) => void timers.delete(h as number),
  };
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
    }
    now = target;
  };
  return { host, advance, pending: () => timers.size };
}

class FakeSocket implements WsLike {
  static all: FakeSocket[] = [];
  readyState = 1;
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  close() {
    this.closed = true;
  }
}

function setup(hidden: () => boolean, random: () => number = () => 0.5) {
  FakeSocket.all = [];
  const h = fakeHost();
  const silent: number[] = [];
  const silentFailed: number[] = [];
  const retries: { attempt: number; delay: number }[] = [];
  const fallbacks: number[] = [];
  const client = new WsClient({
    url: () => "wss://x",
    factory: (u) => new FakeSocket(u),
    host: h.host,
    random,
    silentMs: 10_000,
    hidden,
    onMessage: () => {},
    onSilent: (t, failed) => {
      silent.push(t);
      silentFailed.push(failed);
    },
    onRetry: (attempt, at, t) => retries.push({ attempt, delay: at - t }),
    onFallback: (t) => fallbacks.push(t),
  });
  return { ...h, client, silent, silentFailed, retries, fallbacks };
}

describe("WsClient silence while hidden (finding 6)", () => {
  it("silent timer fired while hidden → state silent, nudge() on visible reconnects", () => {
    let hidden = false;
    const s = setup(() => hidden);
    s.client.start();
    const first = FakeSocket.all[0]!;
    first.onopen?.({});
    first.onmessage?.({ data: "{}" });
    expect(s.client.state).toBe("open");

    hidden = true;
    s.advance(10_000); // silent timer fires while hidden: no immediate reconnect
    expect(s.client.state).toBe("silent");
    expect(s.silent).toHaveLength(1);
    expect(FakeSocket.all).toHaveLength(1);
    s.advance(30_000); // no silent timer armed any more – the old bug left it here forever
    expect(s.client.state).toBe("silent");
    expect(FakeSocket.all).toHaveLength(1);

    expect(first.closed).toBe(true); // a silent socket is closed at once (it counts like a close)

    hidden = false;
    s.client.nudge(); // visibilitychange → visible: the slow hidden retry is replaced by an immediate reconnect
    expect(s.silent).toHaveLength(1); // the silence was reported once, when it happened
    expect(FakeSocket.all).toHaveLength(2);
    expect(s.client.state).toBe("connecting");
    s.client.stop();
  });

  it("a hidden tab keeps its stream: one slow reconnect a minute (the signal check's notifications need it)", () => {
    let hidden = false;
    const s = setup(() => hidden);
    s.client.start();
    const first = FakeSocket.all[0]!;
    first.onopen?.({});
    first.onmessage?.({ data: "{}" });
    hidden = true;
    s.advance(10_000); // silent
    expect(s.client.state).toBe("silent");
    s.advance(59_000);
    expect(FakeSocket.all).toHaveLength(1);
    s.advance(1_000); // WS_HIDDEN_RETRY_MS after the silence
    expect(FakeSocket.all).toHaveLength(2);
    expect(first.closed).toBe(true);
    // the new socket never answers: handshake timeout, then hidden retries ≥ 1 min apart (never a tight loop)
    s.advance(15_000);
    expect(s.client.state).toBe("closed");
    expect(s.client.retryPending).toBe(true);
    s.advance(59_000);
    expect(FakeSocket.all).toHaveLength(2);
    s.advance(1_000);
    expect(FakeSocket.all).toHaveLength(3);
    // visible again: the pending handshake is old → nudge starts over at once
    hidden = false;
    s.advance(6_000);
    s.client.nudge();
    expect(FakeSocket.all).toHaveLength(4);
    s.client.stop();
  });

  it("nudge() on a closed socket with a backoff retry armed opens ONE socket (no duplicate from the old timer)", () => {
    const s = setup(() => false);
    s.client.start();
    FakeSocket.all[0]!.onclose?.({ code: 1006 });
    expect(s.client.retryPending).toBe(true);
    s.client.nudge(); // `online` / visible: reconnect at once
    expect(FakeSocket.all).toHaveLength(2);
    s.advance(1_000); // the cleared backoff retry (due at +500 ms) does not open a second socket
    expect(FakeSocket.all).toHaveLength(2);
    expect(s.client.state).toBe("connecting");
    s.client.stop();
  });

  it("nudge() on an open, healthy socket re-arms the silent timer", () => {
    const s = setup(() => false);
    s.client.start();
    const sock = FakeSocket.all[0]!;
    sock.onopen?.({});
    sock.onmessage?.({ data: "{}" });
    s.advance(5_000);
    s.client.nudge();
    expect(s.client.state).toBe("open");
    expect(FakeSocket.all).toHaveLength(1);
    // the re-armed timer counts from the last message: at 10 s of silence it reconnects
    s.advance(5_000);
    expect(s.client.state).toBe("connecting");
    expect(FakeSocket.all).toHaveLength(2);
    s.client.stop();
  });

  it("nudge() on an open socket that is already stale (timers throttled) reconnects immediately", () => {
    const s = setup(() => false);
    s.client.start();
    const sock = FakeSocket.all[0]!;
    sock.onopen?.({});
    sock.onmessage?.({ data: "{}" });
    // simulate a throttled timer: move time without firing it
    (s.client as unknown as { lastMessageAt: number }).lastMessageAt = s.host.now() - 20_000;
    s.client.nudge();
    expect(s.silent).toHaveLength(1);
    expect(FakeSocket.all).toHaveLength(2);
    s.client.stop();
  });
});

describe("WsClient reconnect ladder (Galaxy Tab: the stream dropped and never came back)", () => {
  it("a socket that went silent after streaming reconnects at once (a blip), then 1, 2, 4 … 30 s for good", () => {
    const s = setup(() => false, () => 0); // no jitter: the exact ladder
    s.client.start();
    const first = FakeSocket.all[0]!;
    first.onopen?.({});
    first.onmessage?.({ data: "{}" });
    s.advance(10_000); // silence: closed here, the next handshake starts synchronously
    expect(first.closed).toBe(true);
    expect(s.silent).toHaveLength(1);
    expect(s.silentFailed).toEqual([0]); // it HAD delivered: not a failed attempt
    expect(FakeSocket.all).toHaveLength(2);
    expect(s.retries[0]).toEqual({ attempt: 0, delay: 0 });

    // every following handshake fails (dead network): the ladder grows to 30 s and never stops
    const delays: number[] = [];
    for (let i = 0; i < 9; i++) {
      FakeSocket.all.at(-1)!.onclose?.({ code: 1006 });
      const r = s.retries.at(-1)!;
      delays.push(r.delay);
      const before = FakeSocket.all.length;
      s.advance(r.delay - 1);
      expect(FakeSocket.all).toHaveLength(before); // not one ms early
      s.advance(1);
      expect(FakeSocket.all).toHaveLength(before + 1);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000, 30_000]);
    expect(s.fallbacks).toHaveLength(1); // the third failed attempt in a row → fallback, reported once
    expect(s.client.state).toBe("connecting"); // … and it still keeps trying
    s.client.stop();
  });

  it("open-but-silent sockets count as failed attempts: the third in a row → fallback (the provider polls REST)", () => {
    const s = setup(() => false, () => 0);
    s.client.start();
    for (let i = 0; i < 3; i++) {
      const sock = FakeSocket.all.at(-1)!;
      sock.onopen?.({}); // the handshake succeeds …
      s.advance(10_000); // … but no frame ever arrives
      expect(sock.closed).toBe(true);
      if (i < 2) s.advance(s.retries.at(-1)!.delay);
    }
    expect(s.silentFailed).toEqual([1, 2, 3]);
    expect(s.fallbacks).toHaveLength(1);
    expect(s.client.state).toBe("fallback");
    expect(s.client.retryPending).toBe(true); // still retrying in the background
    // a later socket that streams again resets the count
    s.advance(s.retries.at(-1)!.delay);
    const sock = FakeSocket.all.at(-1)!;
    sock.onopen?.({});
    sock.onmessage?.({ data: "{}" });
    expect(s.client.state).toBe("open");
    expect(s.client.failedAttempts).toBe(0);
    for (let i = 0; i < 12; i++) {
      s.advance(5_000); // stable for a minute (frames keep arriving): the ladder starts at 1 s again
      sock.onmessage?.({ data: "{}" });
    }
    expect(s.client.attempts).toBe(0);
    s.client.stop();
  });

  it("jitter stays small and never lifts a step above the 30 s cap", () => {
    const s = setup(() => false, () => 0.999);
    s.client.start();
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      FakeSocket.all.at(-1)!.onclose?.({ code: 1006 });
      delays.push(s.retries.at(-1)!.delay);
      s.advance(s.retries.at(-1)!.delay);
    }
    expect(delays.slice(0, 5)).toEqual([1249, 2499, 4999, 8999, 16_999]);
    expect(delays.slice(5)).toEqual([30_000, 30_000]);
    s.client.stop();
  });

  it("nudge() from fallback (visible / online / pageshow / focus) resets the ladder and connects at once", () => {
    const s = setup(() => false, () => 0);
    s.client.start();
    for (let i = 0; i < 4; i++) {
      FakeSocket.all.at(-1)!.onclose?.({ code: 1006 });
      if (i < 3) s.advance(s.retries.at(-1)!.delay);
    }
    expect(s.client.state).toBe("fallback");
    const n = FakeSocket.all.length;
    s.client.nudge();
    expect(FakeSocket.all).toHaveLength(n + 1);
    expect(s.client.state).toBe("connecting");
    // that one fails too: the ladder starts again at 1 s (not at the 8 s it had reached)
    FakeSocket.all.at(-1)!.onclose?.({ code: 1006 });
    expect(s.retries.at(-1)!.delay).toBe(1000);
    s.client.stop();
  });
});
