/**
 * B3 in the browser: the poll rhythm (backoff), the list of the last signals (verarbeitet / doppelt / abgelehnt with the reason, plain text),
 * the live "Empfang bestätigt" in the assistant, the MCP card in its four honest states (Einrichtung nötig · nicht verbunden · verbunden ·
 * abgelaufen), the start of the sign-in (https only), the return from TradingView, and the hand-over of received Branchen-Signale to the paper
 * bridge. Everything runs against a stubbed `fetch` – no TradingView, no server.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConnectHost from "@/connect/ConnectHost";
import ConnectionsHub from "@/connect/ConnectionsHub";
import { closeConnectDialog, openConnectDialog, useConnectUi } from "@/connect/open";
import { nextAttempt, nextDelay, POLL_FIRST_MS, POLL_MAX_MS, setPollScaleForTests } from "@/connect/pollBackoff";
import { TvMcpPanel } from "@/connect/TvMcpPanel";
import { TvSignals } from "@/connect/TvSignals";
import { isHttpsUrl, loadTv, resetTvStore, revokeMcp, startMcp, testMcp, tvList, useTv, type TvMcp, type TvSignal, type TvStatus } from "@/connect/tvStore";
import { setCloudEnabledForTests } from "@/cloud/env";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import { MotionRoot } from "@/motion/MotionRoot";

const runBridge = vi.hoisted(() => vi.fn(async () => []));
vi.mock("@/views/aktien/branchen/signalBridge", () => ({ runBridge }));

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "t@example.com", aal: "aal1" as const, mfaEnrolled: false };
const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, init);

const sig = (over: Partial<TvSignal> = {}): TvSignal => ({
  id: `s${Math.random().toString(36).slice(2, 9)}`,
  kind: "signal",
  status: "processed",
  reason: null,
  schemaId: "signal/1",
  source: "tradingview",
  signalId: "x",
  strategy: "trend",
  market: null,
  symbol: "XLE",
  direction: "long",
  time: "2026-11-06T21:00:00.000Z",
  data: null,
  via: "extern",
  receivedAt: "2026-11-06T21:00:05.000Z",
  ...over,
});
const MCP = (over: Partial<TvMcp> = {}): TvMcp => ({ configured: true, host: "mcp.tradingview.com", connected: false, status: null, scope: null, lastError: null, lastTestAt: null, lastTestOk: null, createdAt: null, ...over });
const STATUS = (over: Partial<TvStatus> = {}): TvStatus => ({
  hasToken: true,
  token: { id: "t1", prefix: "tj_AbCdE", createdAt: "2026-11-06T10:00:00Z", lastUsedAt: null },
  receipts: [],
  receiptsAvailable: true,
  signals: [],
  signalsAvailable: true,
  mcp: MCP(),
  tradeAlerts: { allowed: true, plan: "pro" },
  origin: null,
  ...over,
});

const wrap = (ui: React.ReactElement) => render(<MotionRoot>{ui}</MotionRoot>);

let calls: { method: string; path: string }[];
let server: TvStatus;
let mcpAnswers: { start?: () => Response; test?: () => Response; revoke?: () => Response };

beforeEach(() => {
  localStorage.clear();
  calls = [];
  runBridge.mockClear();
  setCloudEnabledForTests(true);
  resetCloudSession();
  useCloudSession.setState({ phase: "signedIn", user: USER });
  resetTvStore();
  closeConnectDialog();
  useConnectUi.setState({ seq: 0 });
  server = STATUS();
  mcpAnswers = {};
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private readonly cb: (entries: unknown[], obs: unknown) => void) {}
      observe(target: Element) {
        this.cb([{ target, isIntersecting: true, intersectionRatio: 1 }], this);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, "https://journal.test");
      const method = (init.method ?? "GET").toUpperCase();
      calls.push({ method, path: url.pathname });
      if (url.pathname === "/api/v1/connections/tradingview" && method === "GET") return json(server);
      if (url.pathname === "/api/v1/connections/tradingview/mcp/start") return mcpAnswers.start?.() ?? json({ url: "https://www.tradingview.com/mcp/oauth/authorize?x=1" });
      if (url.pathname === "/api/v1/connections/tradingview/mcp/test") return mcpAnswers.test?.() ?? json({ ok: true, tools: 3, watchlists: 2 });
      if (url.pathname === "/api/v1/connections/tradingview/mcp" && method === "DELETE") return mcpAnswers.revoke?.() ?? json({ ok: true, revoked: true });
      return json({ error: { code: "not_found", message: "Unbekannt." } }, { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  closeConnectDialog();
});

describe("poll rhythm", () => {
  it("starts fast, slows down step by step, never beyond 20 s, and an unknown attempt number is the first wait", () => {
    expect(POLL_FIRST_MS).toBe(2000);
    expect([0, 1, 2, 3, 4, 5, 9].map(nextDelay)).toEqual([2000, 3200, 5120, 8192, 13107, 20000, 20000]);
    expect(nextDelay(-3)).toBe(2000);
    expect(nextDelay(50)).toBe(POLL_MAX_MS);
    const d = [0, 1, 2, 3, 4, 5, 6].map(nextDelay);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });

  it("a new entry brings the rhythm back to the first wait, nothing new makes it one step slower", () => {
    expect(nextAttempt(4, true)).toBe(0);
    expect(nextAttempt(4, false)).toBe(5);
    expect(nextAttempt(0, false)).toBe(1);
  });
});

describe("the list of the last signals", () => {
  it("falls back to the older receipts in the same shape; with the signals table the signals win", () => {
    const old = STATUS({
      signalsAvailable: false,
      receipts: [
        { id: "r3", kind: "rejected", via: "extern", symbol: null, detail: "402 Tarif", receivedAt: "2026-11-06T12:03:00Z" },
        { id: "r2", kind: "open", via: "extern", symbol: "BTCUSDT", detail: "created", receivedAt: "2026-11-06T12:02:00Z" },
        { id: "r1", kind: "test", via: "app", symbol: "TEST", detail: null, receivedAt: "2026-11-06T12:01:00Z" },
      ],
    });
    expect(tvList(old).map((s) => [s.kind, s.status, s.direction, s.reason])).toEqual([["signal", "rejected", null, "402 Tarif"], ["signal", "processed", "long", null], ["test", "processed", null, null]]);
    expect(tvList(STATUS({ signals: [sig({ id: "only" })], receipts: old.receipts })).map((s) => s.id)).toEqual(["only"]);
    expect(tvList(null)).toEqual([]);
    expect(tvList(STATUS({ signalsAvailable: undefined, signals: undefined }))).toEqual([]);
  });

  it("shows verarbeitet / doppelt / abgelehnt with the reason, in words; a long list is cut to the limit", () => {
    const list = [
      sig({ id: "a", status: "processed", data: { zustand: "gruen", kurs: 91 }, schemaId: "branchen-trend/1", strategy: "s-20-40-2.8-0.02-2.0" }),
      sig({ id: "b", status: "duplicate", reason: "Dieses Signal ist schon angekommen." }),
      sig({ id: "c", status: "rejected", reason: "„direction“ muss „long“ oder „flat“ sein (short gibt es nicht).", symbol: null, direction: null }),
      sig({ id: "d", kind: "test", via: "app", symbol: "TEST", direction: null, schemaId: null }),
    ];
    wrap(<TvSignals list={list} />);
    const rows = screen.getAllByTestId("tv-signal");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["processed", "duplicate", "rejected", "processed"]);
    expect(rows[0]!.textContent).toMatch(/Long · XLE · grün/);
    expect(rows[0]!.textContent).toMatch(/Branchen-Trend/);
    expect(rows[0]!.textContent).toMatch(/verarbeitet/);
    expect(rows[1]!.textContent).toMatch(/doppelt/);
    expect(rows[1]!.textContent).toMatch(/schon angekommen/);
    expect(rows[2]!.textContent).toMatch(/abgelehnt/);
    expect(rows[2]!.textContent).toMatch(/short gibt es nicht/);
    expect(rows[3]!.textContent).toMatch(/Testsignal · TEST/);
    expect(rows[3]!.textContent).toMatch(/aus der App/);
    cleanup();
    wrap(<TvSignals list={Array.from({ length: 15 }, (_, i) => sig({ id: `n${i}` }))} limit={3} />);
    expect(screen.getAllByTestId("tv-signal")).toHaveLength(3);
  });

  it("an empty list says so; text from a sender is plain text, never markup", () => {
    wrap(<TvSignals list={[]} />);
    expect(screen.getByTestId("tv-signals-empty").textContent).toMatch(/Noch kein Signal angekommen/);
    cleanup();
    const { container } = wrap(<TvSignals list={[sig({ symbol: "<img src=x onerror=alert(1)>", strategy: "<b>fett</b>", status: "rejected", reason: "<script>alert(1)</script>" })]} />);
    expect(container.querySelector("img, script, b")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });
});

describe("the assistant: live confirmation with backoff", () => {
  const openStep3 = async () => {
    wrap(<ConnectHost />);
    act(() => openConnectDialog("tradingview"));
    const w = await screen.findByTestId("tv-wizard");
    await waitFor(() => expect((within(w).getByTestId("tv-next") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(w).getByTestId("tv-next"));
    fireEvent.click(within(w).getByTestId("tv-next"));
    expect(await within(w).findByTestId("tv-step-test")).toBeTruthy();
    return w;
  };
  const gets = () => calls.filter((c) => c.method === "GET" && c.path === "/api/v1/connections/tradingview").length;

  beforeEach(() => setPollScaleForTests(0.03)); // waits of 60 ms, 96 ms, 154 ms … with real timers
  afterEach(() => setPollScaleForTests(1));

  it("waits, then reports 'Empfang bestätigt' as soon as a test signal arrives – by itself, nobody pressed anything", async () => {
    const w = await openStep3();
    expect(within(w).getByTestId("tv-waiting")).toBeTruthy();
    server = STATUS({ signals: [sig({ id: "t1", kind: "test", via: "extern", symbol: "BINANCE:BTCUSDT", direction: null, schemaId: null })] });
    const arrived = await within(w).findByTestId("tv-arrived", undefined, { timeout: 3000 });
    expect(arrived.textContent).toMatch(/Empfang bestätigt/);
    expect(arrived.textContent).toMatch(/TradingView hat ein Signal geschickt/);
    expect(within(w).getAllByTestId("tv-signal")).toHaveLength(1);
  });

  it("the waits between polls GROW (timers never fire early, so the lower bounds hold on any machine); a hidden tab does not fetch", async () => {
    await openStep3();
    const stamps: number[] = [];
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
      if (String(input).endsWith("/connections/tradingview") && (init?.method ?? "GET") === "GET") stamps.push(performance.now());
      return real(input, init);
    });
    await waitFor(() => expect(stamps.length).toBeGreaterThanOrEqual(4), { timeout: 5000 });
    const gaps = stamps.slice(1).map((t, i) => t - stamps[i]!);
    // expected waits 96, 154, 246 ms (attempt 1, 2, 3) – each at least ~85 % of its value, so a slower step never undercuts
    [96, 154, 246].forEach((ms, i) => expect(gaps[i]!, `gap ${i + 1}: ${gaps.map(Math.round)}`).toBeGreaterThanOrEqual(ms * 0.85));
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    await new Promise((r) => setTimeout(r, 120)); // let an in-flight poll finish
    const before = stamps.length;
    await new Promise((r) => setTimeout(r, 900));
    expect(stamps.length).toBe(before);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  it("closing the dialog stops the polling", async () => {
    await openStep3();
    act(() => closeConnectDialog());
    await new Promise((r) => setTimeout(r, 150));
    const n = gets();
    await new Promise((r) => setTimeout(r, 900));
    expect(gets()).toBe(n);
  });

  it("the templates: signal/1 with a token PLACEHOLDER in the address, a Pine example, the plan note marked 'zu prüfen'", async () => {
    wrap(<ConnectHost />);
    act(() => openConnectDialog("tradingview"));
    const w = await screen.findByTestId("tv-wizard");
    await waitFor(() => expect((within(w).getByTestId("tv-next") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(w).getByTestId("tv-next"));
    expect(within(w).getByTestId("tv-tpl-signal").textContent).toContain('"schema":"signal/1"');
    expect(within(w).getByTestId("tv-tpl-signal").textContent).not.toMatch(/qty|size|contracts/);
    expect(within(w).getByTestId("tv-tpl-pine-signal").textContent).toMatch(/alertcondition/);
    expect(within(w).getByTestId("tv-signal-url").textContent).toBe(`${location.origin}/api/v1/signals/DEIN-TOKEN`);
    expect(within(w).getByTestId("tv-signal-url-hint").textContent).toMatch(/nie in den Pine-Code/);
    expect(within(w).getByTestId("tv-plan-note").textContent).toMatch(/laut Hilfe von TradingView zu prüfen/);
    expect(w.textContent).not.toMatch(/bezahltem Tarif/);
  });
});

describe("the MCP card", () => {
  const show = (mcp: TvMcp, extra: Partial<TvStatus> = {}) => {
    server = STATUS({ mcp, ...extra }); // what a reload after a click reads
    useTv.setState({ status: server, load: "ready" });
    return wrap(<TvMcpPanel />);
  };
  const state = () => screen.getByTestId("tvmcp").getAttribute("data-state");

  it("nothing is shown on a server that does not know the MCP connection", () => {
    useTv.setState({ status: STATUS({ mcp: undefined }), load: "ready" });
    const { container } = wrap(<TvMcpPanel />);
    expect(container.querySelector('[data-testid="tvmcp"]')).toBeNull();
  });

  it("not set up by the operator: 'Einrichtung nötig (Betreiber)', no button that would fail", () => {
    show(MCP({ configured: false, host: null }));
    expect(state()).toBe("unconfigured");
    expect(screen.getByTestId("tvmcp").textContent).toMatch(/Einrichtung nötig \(Betreiber\)/);
    expect(screen.getByTestId("tvmcp-unconfigured").textContent).toMatch(/Betreiber/);
    expect(screen.queryByTestId("tvmcp-start")).toBeNull();
    expect(screen.queryByTestId("tvmcp-test")).toBeNull();
  });

  it("set up, not connected: says what it does (read only), the plan hint and 'nur gegen einen Nachbau geprüft'; one button", () => {
    show(MCP());
    expect(state()).toBe("disconnected");
    const t = screen.getByTestId("tvmcp").textContent!;
    expect(t).toMatch(/nur einen Lese-Test/);
    expect(t).toMatch(/nichts an/);
    expect(t).toMatch(/Essential/);
    expect(t).toMatch(/Nachbau des Servers/);
    expect(screen.getByTestId("tvmcp-start")).toBeTruthy();
    expect(screen.queryByTestId("tvmcp-test")).toBeNull();
  });

  it("connected: the last read test in words, the read test button runs it and shows what was read; disconnect asks first", async () => {
    show(MCP({ connected: true, status: "active", createdAt: "2026-11-05T10:00:00Z", lastTestAt: "2026-11-06T09:00:00Z", lastTestOk: true }));
    expect(state()).toBe("connected");
    expect(screen.getByTestId("tvmcp-last").textContent).toMatch(/Letzter Lese-Test: in Ordnung/);
    fireEvent.click(screen.getByTestId("tvmcp-test"));
    expect((await screen.findByTestId("tvmcp-result")).textContent).toMatch(/Gelesen: 2 Merklisten · 3 Werkzeuge/);
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/v1/connections/tradingview/mcp/test")).toBe(true);
    fireEvent.click(screen.getByTestId("tvmcp-revoke"));
    expect(screen.getByText(/widerrufen und hier gelöscht/)).toBeTruthy();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("a failed read test says why (plan) and keeps the card usable", async () => {
    mcpAnswers.test = () => json({ error: { code: "tv_mcp_plan_required", message: "TradingView verweigert den Zugriff. Laut TradingView ist der MCP-Zugang ab dem Tarif Essential enthalten." } }, { status: 403 });
    show(MCP({ connected: true, status: "active" }));
    fireEvent.click(screen.getByTestId("tvmcp-test"));
    expect((await screen.findByTestId("tvmcp-error")).textContent).toMatch(/Essential/);
    expect(screen.getByTestId("tvmcp-test")).toBeTruthy();
  });

  it("disconnect: DELETE, and when TradingView did not confirm the revoke it says so; when it did, no warning", async () => {
    server = STATUS({ mcp: MCP() });
    mcpAnswers.revoke = () => json({ ok: true, revoked: false });
    show(MCP({ connected: true, status: "active" }));
    fireEvent.click(screen.getByTestId("tvmcp-revoke"));
    fireEvent.click(screen.getByTestId("tvmcp-revoke-yes"));
    expect((await screen.findByTestId("tvmcp-revoked-note")).textContent).toMatch(/nicht bestätigt/);
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/v1/connections/tradingview/mcp")).toBe(true);
    cleanup();
    mcpAnswers.revoke = () => json({ ok: true, revoked: true });
    show(MCP({ connected: true, status: "active" }));
    fireEvent.click(screen.getByTestId("tvmcp-revoke"));
    fireEvent.click(screen.getByTestId("tvmcp-revoke-yes"));
    await waitFor(() => expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(2));
    expect(screen.queryByTestId("tvmcp-revoked-note")).toBeNull();
  });

  it("no longer valid: the reason from the server and a 'Neu verbinden' button", () => {
    show(MCP({ connected: false, status: "invalid", lastError: "TradingView hat den Zugang abgelehnt – Verbinde neu." }));
    expect(state()).toBe("invalid");
    expect(screen.getByTestId("tvmcp-invalid").textContent).toMatch(/Verbinde neu/);
    expect(screen.getByTestId("tvmcp-start").textContent).toBe("Neu verbinden");
  });

  it("how the sign-in ended is said: ok / abgebrochen / fehler", () => {
    for (const [back, re] of [["ok", /Lese-Test/], ["abgebrochen", /nichts verbunden/], ["fehler", /noch einmal/]] as const) {
      cleanup();
      useTv.setState({ mcpReturn: back });
      show(MCP());
      expect(screen.getByTestId("tvmcp-return").textContent).toMatch(re);
    }
  });
});

describe("the sign-in at TradingView", () => {
  it("startMcp sends the browser to the https address the server made – and to nothing else", async () => {
    const go = vi.fn();
    expect(await startMcp(go)).toBe(true);
    expect(go).toHaveBeenCalledWith("https://www.tradingview.com/mcp/oauth/authorize?x=1");
    for (const bad of ["javascript:alert(1)", "http://www.tradingview.com/x", "//evil.test", "data:text/html,x", null, 5]) {
      mcpAnswers.start = () => json({ url: bad });
      go.mockClear();
      expect(await startMcp(go), String(bad)).toBe(false);
      expect(go).not.toHaveBeenCalled();
      expect(useTv.getState().mcpError).toMatch(/keine gültige Anmelde-Adresse/);
    }
    expect(isHttpsUrl("https://a.test/x")).toBe(true);
    expect(isHttpsUrl("ftp://a.test")).toBe(false);
  });

  it("an unconfigured server answers 503 'Einrichtung nötig' and the error is shown, not hidden", async () => {
    mcpAnswers.start = () => json({ error: { code: "tv_mcp_unconfigured", message: "Einrichtung nötig (Betreiber): Die Anbindung ist hier noch nicht eingerichtet." } }, { status: 503 });
    expect(await startMcp(vi.fn())).toBe(false);
    expect(useTv.getState().mcpError).toMatch(/Einrichtung nötig \(Betreiber\)/);
  });

  it("testMcp and revokeMcp reload the status; no token is ever in the store", async () => {
    server = STATUS({ mcp: MCP({ connected: true, status: "active" }) });
    await loadTv();
    expect(await testMcp()).toBe(true);
    expect(useTv.getState().mcpTest).toEqual({ tools: 3, watchlists: 2 });
    expect(await revokeMcp()).toEqual({ ok: true, revoked: true });
    expect(JSON.stringify(useTv.getState())).not.toMatch(/access_token|refresh_token|code_verifier/);
  });

  it("coming back from TradingView (?tvmcp=…): the hub opens the TradingView dialog, says how it ended and cleans the address", async () => {
    history.replaceState(null, "", "/?tvmcp=ok#settings");
    wrap(<ConnectionsHub />);
    await waitFor(() => expect(useConnectUi.getState().service).toBe("tradingview"));
    expect(useTv.getState().mcpReturn).toBe("ok");
    expect(location.search).toBe("");
    expect(location.hash).toBe("#settings");
    cleanup();
    closeConnectDialog();
    history.replaceState(null, "", "/?tvmcp=evil#settings");
    useTv.setState({ mcpReturn: null });
    wrap(<ConnectionsHub />);
    await new Promise((r) => setTimeout(r, 30));
    expect(useConnectUi.getState().service).toBeNull(); // an unknown value opens nothing
    expect(useTv.getState().mcpReturn).toBeNull();
    history.replaceState(null, "", "/");
  });
});

describe("hand-over to the paper bridge", () => {
  it("a received Branchen-Signale reaches the bridge once the status is loaded; tests, duplicates and other signals do not wake it", async () => {
    server = STATUS({ signals: [sig({ kind: "test", direction: null, schemaId: null }), sig({ status: "duplicate", schemaId: "branchen-trend/1" }), sig({ schemaId: "signal/1", data: null })] });
    await loadTv();
    await new Promise((r) => setTimeout(r, 20));
    expect(runBridge).not.toHaveBeenCalled();
    const branchen = sig({ id: "bt1", schemaId: "branchen-trend/1", data: { zustand: "gruen", kurs: 91 } });
    server = STATUS({ signals: [branchen] });
    await loadTv();
    await waitFor(() => expect(runBridge).toHaveBeenCalledTimes(1));
    expect((runBridge.mock.calls[0] as unknown as [TvSignal[]])[0]).toEqual([branchen]);
  });

  it("an old server without the signal table (only receipts) never starts the bridge", async () => {
    server = STATUS({ signalsAvailable: false, signals: undefined, receipts: [{ id: "r", kind: "open", via: "extern", symbol: "XLE", detail: null, receivedAt: "2026-11-06T12:00:00Z" }] });
    await loadTv();
    await new Promise((r) => setTimeout(r, 20));
    expect(runBridge).not.toHaveBeenCalled();
  });
});
