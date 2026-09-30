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

function setup(hidden: () => boolean) {
  FakeSocket.all = [];
  const h = fakeHost();
  const silent: number[] = [];
  const client = new WsClient({
    url: () => "wss://x",
    factory: (u) => new FakeSocket(u),
    host: h.host,
    random: () => 0.5,
    silentMs: 10_000,
    hidden,
    onMessage: () => {},
    onSilent: (t) => silent.push(t),
  });
  return { ...h, client, silent };
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
    s.advance(10_000); // silent timer fires while hidden: no reconnect allowed
    expect(s.client.state).toBe("silent");
    expect(s.silent).toHaveLength(1);
    expect(FakeSocket.all).toHaveLength(1);
    s.advance(60_000); // no silent timer armed any more – the old bug left it here forever
    expect(s.client.state).toBe("silent");
    expect(FakeSocket.all).toHaveLength(1);

    hidden = false;
    s.client.nudge(); // visibilitychange → visible
    expect(s.silent).toHaveLength(2);
    expect(FakeSocket.all).toHaveLength(2);
    expect(first.closed).toBe(true);
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
