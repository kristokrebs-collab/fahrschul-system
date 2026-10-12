/**
 * P11 Börse UI (components against a stubbed `fetch`): the card's honest states (no cloud, signed out, server not set
 * up, plan without sync, hero, connected – masked key, never a secret), the connect sheet (read-only confirmation,
 * German error of a wrong secret, the secret leaves the DOM after success), the sync inbox ("trade the best": the
 * biggest first, one question per card, "Passt so" remembered), the CSV size cap and the live positions contract with a
 * connection.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCloudEnabledForTests } from "@/cloud/env";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import type { Trade } from "@/domain/types";
import { CSV_MAX_BYTES, CsvImportSheet } from "@/exchanges/csv/CsvImportSheet";
import { readDismissed } from "@/exchanges/inbox";
import { refreshPositions, useExchangePositions, useHasExchangeConnection, usePositionsStore, type ExchangePosition } from "@/exchanges/positions";
import { openConnect, openCsvImport, resetExchangeStore, useExchange } from "@/exchanges/store";
import type { ExchangeConnection, ExchangeStatus } from "@/exchanges/types";
import { ConnectSheet } from "@/exchanges/ui/ConnectSheet";
import { ExchangeConnectionsCard } from "@/exchanges/ui/ExchangeConnectionsCard";
import { SyncInbox } from "@/exchanges/ui/SyncInbox";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { mkTrade, settings } from "./domain.fixtures";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "t@example.com", aal: "aal1" as const, mfaEnrolled: false };
const KEY = "9a25209b66004da4f1e2d3c47e2d";
const SECRET = "s3cr3t-0123456789abcdef";

const CONN: ExchangeConnection = {
  id: "c0ffee00-0000-4000-8000-000000000001",
  exchange: "bitunix",
  label: "Hauptkonto",
  keyLast4: "7e2d",
  permissions: ["read"],
  status: "active",
  lastSyncAt: null,
  lastError: null,
  journalAccount: "scalp",
  syncEnabled: true,
  createdAt: "2026-10-12T08:00:00.000Z",
};

const status = (p: Partial<ExchangeStatus> = {}): ExchangeStatus => ({
  configured: true,
  cron: { enabled: true, everyMin: 30, nextAt: "2026-10-12T09:30:00.000Z" },
  plan: { plan: "pro", entitled: true, limit: 1, gated: false },
  connections: [],
  runs: [],
  ...p,
});

const POSITION: ExchangePosition = {
  id: "p1",
  exchange: "bitunix",
  symbol: "BTCUSDT",
  side: "long",
  qty: 0.1,
  entry: 62000,
  mark: 62500,
  notional: 6250,
  leverage: 10,
  marginMode: "isolated",
  margin: 620,
  liqPrice: 56000,
  unrealizedPnl: 50,
  fundingFees: 0.4,
  openedAt: 1_760_000_000_000,
  updatedAt: 1_760_000_100_000,
};

let server: ExchangeStatus;
const calls: { method: string; path: string; body: unknown }[] = [];
const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, init);

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  setCloudEnabledForTests(true);
  resetCloudSession();
  useCloudSession.setState({ phase: "signedIn", user: USER });
  resetExchangeStore();
  usePositionsStore.setState({ positions: Object.freeze([]), at: null, error: null });
  server = status();
  // motion's whileInView / the dot-matrix gates: everything is "in view" in jsdom
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
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method, path: url.pathname + url.search, body });
      if (url.pathname === "/api/v1/exchange/sync" && method === "GET") return json(server);
      if (url.pathname === "/api/v1/exchange/connect" && method === "POST") {
        if (body.secret !== SECRET) {
          return json({ error: { code: "exchange_auth", message: "Bitunix lehnt die Signatur ab – prüfe den Secret-Key." } }, { status: 422 });
        }
        const connection = { ...CONN, label: body.label ?? "", journalAccount: body.journalAccount };
        server = { ...server, connections: [connection] };
        return json({ connection, account: { marginCoin: "USDT", available: 1234.5, margin: 0, unrealizedPnl: 0 } });
      }
      if (url.pathname === "/api/v1/exchange/positions") return json({ positions: [POSITION], errors: [], at: "2026-10-12T09:00:00.000Z" });
      return json({ error: { code: "not_found", message: "Unbekannt." } }, { status: 404 });
    }),
  );
});

afterEach(() => {
  setCloudEnabledForTests(null);
  resetCloudSession();
  resetExchangeStore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const wrap = (ui: React.ReactNode) => render(<MotionRoot>{ui}</MotionRoot>);

describe("ExchangeConnectionsCard", () => {
  it("renders nothing without cloud", () => {
    setCloudEnabledForTests(false);
    const { container } = wrap(<ExchangeConnectionsCard />);
    expect(container.querySelector("[data-testid='exchange-card']")).toBeNull();
  });

  it("signed out: honest line, sign-in and CSV", () => {
    useCloudSession.setState({ phase: "signedOut", user: null });
    wrap(<ExchangeConnectionsCard />);
    const card = screen.getByTestId("exchange-card");
    expect(within(card).getByRole("button", { name: "CSV importieren" })).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("server without encryption key: says so, CSV still offered", async () => {
    server = status({ configured: false });
    wrap(<ExchangeConnectionsCard />);
    expect(await screen.findByText(/noch nicht eingerichtet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "CSV importieren" })).toBeTruthy();
  });

  it("plan without sync: upgrade instead of connect", async () => {
    server = status({ plan: { plan: "free", entitled: false, limit: 0, gated: true } });
    wrap(<ExchangeConnectionsCard />);
    expect(await screen.findByRole("button", { name: "Pro freischalten" })).toBeTruthy();
    expect(screen.queryByTestId("exchange-connect")).toBeNull();
  });

  it("hero → connect opens the sheet", async () => {
    wrap(<ExchangeConnectionsCard />);
    const cta = await screen.findByTestId("exchange-connect");
    expect(cta.textContent).toContain("Börse verbinden");
    fireEvent.click(cta);
    expect(useExchange.getState().connectOpen).toBe(true);
  });

  it("connected: masked key (last 4), read-only, sync actions – no secret anywhere", async () => {
    server = status({ connections: [{ ...CONN, lastSyncAt: "2026-10-12T08:59:00.000Z" }] });
    wrap(<ExchangeConnectionsCard />);
    const box = await screen.findByTestId("exchange-connected");
    expect(box.textContent).toContain("7e2d");
    expect(box.textContent).toContain("nur Lesen");
    expect(within(box).getByTestId("exchange-sync")).toBeTruthy();
    expect(within(box).getByTestId("exchange-dry")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });
});

describe("ConnectSheet", () => {
  async function fill(secret: string, confirm = true) {
    fireEvent.click(screen.getByTestId("connect-next"));
    fireEvent.change(await screen.findByLabelText(/API-Key/), { target: { value: KEY } });
    fireEvent.change(screen.getByLabelText("Secret-Key"), { target: { value: secret } });
    if (confirm) fireEvent.click(screen.getByTestId("connect-readonly"));
    fireEvent.click(screen.getByTestId("connect-submit"));
  }

  it("asks for the read-only confirmation before anything is sent", async () => {
    wrap(<ConnectSheet />);
    act(() => openConnect());
    expect(await screen.findByText("So legst du einen Read-only-Key an")).toBeTruthy();
    await fill(SECRET, false);
    expect((await screen.findByTestId("connect-error")).textContent).toContain("nur Leserechte");
    expect(calls.filter((c) => c.path.startsWith("/api/v1/exchange/connect"))).toHaveLength(0);
  });

  it("wrong secret → German error, back on the form; right one → verified, secret gone from the DOM", async () => {
    wrap(<ConnectSheet />);
    act(() => openConnect());
    await screen.findByText("So legst du einen Read-only-Key an");
    await fill("falsches-secret-123");
    expect((await screen.findByTestId("connect-error")).textContent).toContain("Signatur");

    fireEvent.change(screen.getByLabelText("Secret-Key"), { target: { value: SECRET } });
    fireEvent.click(screen.getByTestId("connect-submit"));
    expect(await screen.findByTestId("connect-ok", undefined, { timeout: 4_000 })).toBeTruthy();
    const sent = calls.filter((c) => c.method === "POST" && c.path === "/api/v1/exchange/connect");
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body).toMatchObject({ exchange: "bitunix", apiKey: KEY, secret: SECRET, readOnlyConfirmed: true, journalAccount: "scalp" });
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(useExchange.getState().status?.connections[0]?.keyLast4).toBe("7e2d");
  });
});

describe("SyncInbox", () => {
  const imported = (id: string, pnl: number, p: Partial<Trade> = {}) =>
    mkTrade({ id, date: "2026-10-05T10:00", pnlManual: pnl, origin: { kind: "api" }, syncSource: "bitunix-api", externalId: id, ...p });

  beforeEach(() => {
    const s = settings();
    useJournal.setState({
      trades: [imported("t_bx_small", 5), imported("t_bx_big", -280, { pair: "XRP/USDT" }), imported("t_bx_mid", 60, { setups: [s.setups[0]!.id] }), mkTrade({ id: "hand", date: "2026-10-05T10:00", pnlManual: 999 })],
      settings: s,
      loaded: true,
      mode: "local",
    });
  });

  it("deals the biggest results first and asks one question per card", () => {
    wrap(<SyncInbox />);
    const cards = screen.getAllByTestId("inbox-card");
    expect(cards.map((c) => c.textContent?.match(/[A-Z]{3}\/USDT/)?.[0])).toEqual(["XRP/USDT", "BTC/USDT", "BTC/USDT"]);
    expect(screen.getByTestId("inbox-count").textContent).toBe("3");
    expect(screen.getAllByText("Welches Setup?")).toHaveLength(2);
    expect(screen.getAllByText("Wo lag dein Stop?")).toHaveLength(1);
    expect(screen.queryByText(/999/)).toBeNull();
  });

  it("one tap on a setup saves it; 'Passt so' is remembered on this device", async () => {
    const save = vi.fn(async (t: Trade) => {
      useJournal.setState((s) => ({ trades: s.trades.map((x) => (x.id === t.id ? t : x)) }));
      return true;
    });
    useJournal.setState({ saveTrade: save as unknown as ReturnType<typeof useJournal.getState>["saveTrade"] });
    wrap(<SyncInbox />);
    const first = screen.getAllByTestId("inbox-card")[0]!.closest("article")!;
    const chips = within(first)
      .getAllByRole("button")
      .filter((b) => !["Öffnen", "Passt so"].includes(b.textContent ?? ""));
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThanOrEqual(3);
    const chosen = settings().setups.find((s) => s.name === chips[0]!.textContent)!;
    fireEvent.click(chips[0]!);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toMatchObject({ id: "t_bx_big", setups: [chosen.id] });
    // the card moves on to the next question
    expect(await within(first).findByText("Wo lag dein Stop?")).toBeTruthy();

    fireEvent.click(within(screen.getAllByTestId("inbox-card")[2]!.closest("article")!).getByTestId("inbox-done"));
    await waitFor(() => expect(readDismissed().size).toBe(1), { timeout: 4_000 });
    await waitFor(() => expect(screen.getByTestId("inbox-count").textContent).toBe("2"));
  });
});

describe("CsvImportSheet", () => {
  beforeEach(() => useJournal.setState({ trades: [], settings: settings(), loaded: true, mode: "local" }));

  const BITUNIX_CSV = [
    "Futures,Side,Open Time,Close Time,Avg. Open Price,Avg. Close Price,Closed Qty,Realized PNL,Fee,Funding Fee,Leverage",
    "BTCUSDT,Long,2026-10-01 09:00:00,2026-10-01 12:00:00,62000,62600,0.1,60,3.1,-0.4,10",
  ].join("\n");

  it("refuses files over the size cap without reading them", async () => {
    const read = vi.fn(async () => BITUNIX_CSV);
    wrap(<CsvImportSheet readFile={read} />);
    act(() => openCsvImport());
    const input = await screen.findByTestId("csv-file");
    const big = new File(["x"], "riesig.csv", { type: "text/csv" });
    Object.defineProperty(big, "size", { value: CSV_MAX_BYTES + 1 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText(/größer als 20 MB/)).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("live positions (P05 contract)", () => {
  it("with a connection: polled, stable array between equal polls, empty again without connection", async () => {
    useExchange.setState({ status: status({ connections: [CONN] }), load: "ready" });
    const { result, unmount } = renderHook(() => useExchangePositions());
    await waitFor(() => expect(result.current).toHaveLength(1));
    const first = result.current;
    expect(first[0]).toMatchObject({ symbol: "BTCUSDT", side: "long", liqPrice: 56000 });
    await act(() => refreshPositions());
    expect(result.current).toBe(first);
    expect(renderHook(() => useHasExchangeConnection()).result.current).toBe(true);

    useExchange.setState({ status: status({ connections: [] }) });
    await act(() => refreshPositions());
    expect(result.current).toEqual([]);
    unmount();
  });
});
