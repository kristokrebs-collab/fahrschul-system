/**
 * Verbindungen – components against a stubbed `fetch`: the placeholder in its states, the Binance wizard (guide, form,
 * the rights answers refused / ask / ok, no secret in the DOM, first import), the TradingView assistant (create the
 * address, test signal, receipts, rotate, honest "no OAuth"), the partner box (off by default; marked when on) and the
 * hub in Einstellungen. Everything is MOCKED – no real exchange or TradingView is involved.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConnectHost from "@/connect/ConnectHost";
import ConnectionsHub from "@/connect/ConnectionsHub";
import { PartnerBox } from "@/connect/PartnerBox";
import { closeConnectDialog, openConnectDialog, useConnectUi } from "@/connect/open";
import SlotView from "@/connect/SlotView";
import { resetTvStore } from "@/connect/tvStore";
import { setCloudEnabledForTests } from "@/cloud/env";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import { resetExchangeStore, useExchange } from "@/exchanges/store";
import type { ExchangeConnection, ExchangeStatus } from "@/exchanges/types";
import { MotionRoot } from "@/motion/MotionRoot";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "t@example.com", aal: "aal1" as const, mfaEnrolled: false };
const KEY = "bnk9f3a1c2d4e5f60718293a4b5c6d7e";
const SECRET = "bns0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c";

const status = (p: Partial<ExchangeStatus> = {}): ExchangeStatus => ({
  configured: true,
  cron: { enabled: true, everyMin: 30, nextAt: "2026-11-06T12:30:00.000Z" },
  plan: { plan: "pro", entitled: true, limit: 1, gated: false, autoSync: true },
  connections: [],
  runs: [],
  binance: { egressIp: null },
  ...p,
});

const CONN: ExchangeConnection = {
  id: "c0ffee00-0000-4000-8000-000000000002",
  exchange: "binance",
  label: "Futures",
  keyLast4: KEY.slice(-4),
  permissions: ["read"],
  status: "active",
  lastSyncAt: null,
  lastError: null,
  journalAccount: "scalp",
  syncEnabled: true,
  createdAt: "2026-11-05T10:00:00.000Z",
  market: "futures",
};

interface Call {
  method: string;
  path: string;
  body: unknown;
  contentType: string | null;
}
let calls: Call[];
let server: ExchangeStatus;
/** per test: how the connect call answers */
let connectAnswer: (body: Record<string, unknown>) => Response;
let tvToken: string | null;
let tvReceipts: Record<string, unknown>[];
const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, init);

beforeEach(() => {
  localStorage.clear();
  calls = [];
  setCloudEnabledForTests(true);
  resetCloudSession();
  useCloudSession.setState({ phase: "signedIn", user: USER });
  resetExchangeStore();
  resetTvStore();
  closeConnectDialog();
  useConnectUi.setState({ seq: 0 });
  server = status();
  tvToken = null;
  tvReceipts = [];
  connectAnswer = (body) => json({ connection: { ...CONN, label: String(body.label ?? "Futures") }, account: { marginCoin: "USDT", available: 800.5, margin: 0, unrealizedPnl: 0 } }, { status: 201 });
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
      const raw = init.body ? String(init.body) : null;
      const body = raw ? (raw.startsWith("{") ? JSON.parse(raw) : raw) : null;
      calls.push({ method, path: url.pathname + url.search, body, contentType: new Headers(init.headers).get("content-type") });
      if (url.pathname === "/api/v1/exchange/sync" && method === "GET") return json(server);
      if (url.pathname === "/api/v1/exchange/connect" && method === "POST") {
        const res = connectAnswer(body as Record<string, unknown>);
        if (res.status === 201) server = { ...server, connections: [CONN] };
        return res;
      }
      if (url.pathname === "/api/v1/exchange/backfill") return new Response(null, { status: 202 });
      if (url.pathname === "/api/v1/alerts/test") return json({ configured: false, entitled: true, hasEmail: true, emailConfirmed: true, lastRun: null, intervalMin: 5 });
      if (url.pathname === "/api/v1/connections/tradingview") {
        if (method === "GET")
          return json({
            hasToken: !!tvToken,
            token: tvToken ? { id: "t1", prefix: tvToken.slice(0, 8), createdAt: "2026-11-06T10:00:00Z", lastUsedAt: null } : null,
            receipts: tvReceipts,
            receiptsAvailable: true,
            tradeAlerts: { allowed: false, plan: "free" },
            origin: null,
          });
        if (method === "POST") {
          tvToken = `tj_${"A".repeat(43)}`;
          return json({ token: tvToken, path: `/api/v1/hooks/tradingview/${tvToken}`, info: {} }, { status: 201 });
        }
        if (method === "DELETE") {
          tvToken = null;
          return json({ ok: true });
        }
      }
      if (url.pathname.startsWith("/api/v1/hooks/tradingview/")) {
        tvReceipts = [{ id: "r1", kind: "test", via: String(raw).includes('"source":"app"') ? "app" : "extern", symbol: "TEST", detail: null, receivedAt: "2026-11-06T10:01:00Z" }, ...tvReceipts];
        return json({ ok: true, result: "test" });
      }
      return json({ error: { code: "not_found", message: "Unbekannt." } }, { status: 404 });
    }),
  );
});

afterEach(() => {
  setCloudEnabledForTests(null);
  resetCloudSession();
  resetExchangeStore();
  resetTvStore();
  closeConnectDialog();
  vi.unstubAllGlobals();
});

const wrap = (ui: React.ReactNode) => render(<MotionRoot>{ui}</MotionRoot>);
const slot = (id: string) => screen.getByTestId(`connect-slot-${id}`);

describe("ConnectSlot", () => {
  it("not connected: names the service, says 'Nicht verbunden' and offers 'Verbinden'", async () => {
    wrap(<SlotView service="binance-futures" />);
    await waitFor(() => expect(slot("binance-futures").getAttribute("data-state")).toBe("disconnected"));
    expect(within(slot("binance-futures")).getByText("Binance Futures")).toBeTruthy();
    expect(slot("binance-futures").getAttribute("aria-label")).toMatch(/Nicht verbunden\. Verbinden/);
    expect(slot("binance-futures").textContent).toMatch(/Nur Lese-Schlüssel/);
  });

  it("connected / error / upgrade / not set up / sign-in / connecting each show their own word", async () => {
    server = status({ connections: [CONN] });
    const { unmount } = wrap(<SlotView service="binance-futures" />);
    await waitFor(() => expect(slot("binance-futures").getAttribute("data-state")).toBe("connected"));
    expect(slot("binance-futures").textContent).toMatch(/Verbunden/);
    unmount();

    resetExchangeStore();
    server = status({ connections: [{ ...CONN, status: "invalid", lastError: "Binance lehnt den Key ab." }] });
    const e = wrap(<SlotView service="binance-futures" />);
    await waitFor(() => expect(slot("binance-futures").getAttribute("data-state")).toBe("error"));
    expect(slot("binance-futures").textContent).toMatch(/Binance lehnt den Key ab\./);
    e.unmount();

    resetExchangeStore();
    server = status({ plan: { plan: "free", entitled: false, limit: 0, gated: true } });
    const u = wrap(<SlotView service="binance-spot" />);
    await waitFor(() => expect(slot("binance-spot").getAttribute("data-state")).toBe("upgrade"));
    u.unmount();

    resetExchangeStore();
    server = status({ configured: false });
    const n = wrap(<SlotView service="binance-spot" />);
    await waitFor(() => expect(slot("binance-spot").getAttribute("data-state")).toBe("unconfigured"));
    expect(slot("binance-spot").textContent).toMatch(/Betreiber/);
    n.unmount();

    useCloudSession.setState({ phase: "signedOut", user: null });
    resetExchangeStore();
    const s = wrap(<SlotView service="binance-spot" />);
    expect(slot("binance-spot").getAttribute("data-state")).toBe("signin");
    s.unmount();
  });

  it("the telephone alarm placeholder says plainly that it is not set up", () => {
    wrap(<SlotView service="alert-phone" />);
    expect(slot("alert-phone").getAttribute("data-state")).toBe("unconfigured");
    expect(slot("alert-phone").textContent).toMatch(/noch nicht eingerichtet/);
  });

  it("a click opens the dialog for that service, and the host's own hook runs first", async () => {
    const before = vi.fn();
    wrap(<SlotView service="tradingview" onBeforeOpen={before} />);
    await waitFor(() => expect(slot("tradingview").getAttribute("data-state")).toBe("disconnected"));
    fireEvent.click(slot("tradingview"));
    expect(before).toHaveBeenCalledOnce();
    expect(useConnectUi.getState()).toMatchObject({ service: "tradingview", seq: 1 });
  });

  it("the hub lists every service once, grouped, with the same placeholders", async () => {
    wrap(<ConnectionsHub />);
    const hub = await screen.findByTestId("connections-hub");
    await waitFor(() => expect(hub.querySelectorAll("[data-connect-outline]").length).toBe(0));
    for (const id of ["cloud", "binance-spot", "binance-futures", "bitunix", "tradingview", "alert-email", "alert-phone"]) expect(within(hub).getByTestId(`connect-slot-${id}`)).toBeTruthy();
    expect(within(hub).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Konto", "Börsen", "Signale", "Alarme"]);
  });
});

async function openBinance(id: "binance-futures" | "binance-spot" = "binance-futures") {
  wrap(<ConnectHost />);
  act(() => openConnectDialog(id));
  return screen.findByTestId("bn-setup");
}

async function toForm() {
  const setup = await screen.findByTestId("bn-setup");
  fireEvent.click(within(setup).getByTestId("bn-next"));
  return screen.findByTestId("bn-submit");
}

function fill(key = KEY, secret = SECRET) {
  fireEvent.change(screen.getByLabelText("API-Key"), { target: { value: key } });
  fireEvent.change(screen.getByLabelText("Secret"), { target: { value: secret } });
}

describe("Binance wizard", () => {
  it("step 1 explains the key in plain steps; futures says the Futures right is unavoidable; no fixed IP → the key-without-IP route", async () => {
    await openBinance();
    const setup = screen.getByTestId("bn-setup");
    expect(setup.textContent).toMatch(/Enable Reading/);
    expect(setup.textContent).toMatch(/ein reines Lese-Recht gibt es dort nicht/);
    expect(screen.getByTestId("bn-ip-note").textContent).toMatch(/ohne IP-Bindung/);
    expect(screen.queryByTestId("partner-box")).toBeNull(); // partner links are off by default
  });

  it("with the operator's fixed address the whitelist hint names it", async () => {
    server = status({ binance: { egressIp: "203.0.113.9" } });
    useExchange.setState({ status: server, load: "ready" });
    await openBinance();
    expect(screen.getByTestId("bn-ip-note").textContent).toMatch(/203\.0\.113\.9/);
  });

  it("spot has no Futures wording and offers the extra pairs", async () => {
    await openBinance("binance-spot");
    expect(screen.getByTestId("bn-setup").textContent).not.toMatch(/Enable Futures/);
    fireEvent.click(screen.getByTestId("bn-next"));
    expect(await screen.findByLabelText(/Weitere Paare/)).toBeTruthy();
  });

  it("the read-only confirmation is required; the key and secret fields are checked", async () => {
    await openBinance();
    await toForm();
    fireEvent.click(screen.getByTestId("bn-submit"));
    expect((await screen.findByTestId("bn-form-error")).textContent).toMatch(/Key und Secret/);
    fill();
    fireEvent.click(screen.getByTestId("bn-submit"));
    expect((await screen.findByTestId("bn-form-error")).textContent).toMatch(/nur lesen darf/);
    expect(calls.filter((c) => c.path === "/api/v1/exchange/connect")).toHaveLength(0);
  });

  it("a key with withdrawal rights is refused: the findings are listed, the secret is nowhere in the DOM", async () => {
    connectAnswer = () =>
      json({ error: { code: "rights_refused", message: "Der Key darf Geld abheben.", details: { issues: [{ code: "withdraw", level: "block", text: "Der Key darf Geld abheben („Enable Withdrawals“)." }, { code: "ip_open", level: "info", text: "IP offen." }] } } }, { status: 422 });
    await openBinance();
    await toForm();
    fill();
    fireEvent.click(screen.getByTestId("bn-readonly"));
    fireEvent.click(screen.getByTestId("bn-submit"));
    const refused = await screen.findByTestId("bn-refused");
    expect(refused.textContent).toMatch(/wird nicht verbunden/);
    expect(refused.textContent).toMatch(/Enable Withdrawals/);
    expect(refused.textContent).not.toMatch(/IP offen/); // info is not a blocker
    expect(document.body.innerHTML).not.toContain(SECRET);
    const sent = calls.find((c) => c.path === "/api/v1/exchange/connect")!;
    expect(sent.body).toMatchObject({ exchange: "binance", market: "futures", readOnlyConfirmed: true });
  });

  it("a warning (Futures access) must be accepted before the key is sent again with acceptWarnings", async () => {
    let n = 0;
    connectAnswer = (body) => {
      n++;
      if (!body.acceptWarnings) return json({ error: { code: "rights_confirm", message: "Bitte prüfen.", details: { issues: [{ code: "futures_access", level: "warn", text: "Für Futures verlangt Binance das Recht „Futures“." }] } } }, { status: 409 });
      return json({ connection: { ...CONN, permissions: ["read", "futures_enabled"] }, account: { marginCoin: "USDT", available: 800.5, margin: 0, unrealizedPnl: 0 } }, { status: 201 });
    };
    await openBinance();
    await toForm();
    fill();
    fireEvent.click(screen.getByTestId("bn-readonly"));
    fireEvent.click(screen.getByTestId("bn-submit"));
    const confirm = await screen.findByTestId("bn-confirm");
    expect(confirm.textContent).toMatch(/Recht „Futures“/);
    const go = screen.getByTestId("bn-confirm-go") as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("bn-accept"));
    await waitFor(() => expect((screen.getByTestId("bn-confirm-go") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("bn-confirm-go"));
    const done = await screen.findByTestId("bn-done");
    expect(n).toBe(2);
    expect(calls.filter((c) => c.path === "/api/v1/exchange/connect").map((c) => (c.body as Record<string, unknown>).acceptWarnings)).toEqual([undefined, true]);
    expect(done.textContent).toMatch(/Futures-Zugang: an/);
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it("success shows the rights it read, then the first import runs in the background with progress", async () => {
    await openBinance();
    await toForm();
    fill();
    fireEvent.click(screen.getByTestId("bn-readonly"));
    fireEvent.click(screen.getByTestId("bn-submit"));
    const done = await screen.findByTestId("bn-done");
    expect(done.textContent).toMatch(/Lesen: ja/);
    expect(done.textContent).toMatch(/Handel, Auszahlung, Transfer: aus/);
    expect(document.body.innerHTML).not.toContain(SECRET);
    fireEvent.click(screen.getByTestId("bn-import"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/exchange/backfill")).toBe(true));
    const progress = await screen.findByTestId("bn-progress");
    expect(progress.textContent).toMatch(/Import läuft/);
    const bf = calls.find((c) => c.path === "/api/v1/exchange/backfill")!.body as Record<string, unknown>;
    expect(bf.connectionId).toBe(CONN.id);
  });

  it("an unexpected error stays readable and the typed key comes back for a correction", async () => {
    connectAnswer = () => json({ error: { code: "binance_2015", message: "Binance lehnt den Key ab: falscher Key." } }, { status: 422 });
    await openBinance();
    await toForm();
    fill();
    fireEvent.click(screen.getByTestId("bn-readonly"));
    fireEvent.click(screen.getByTestId("bn-submit"));
    expect((await screen.findByTestId("bn-error")).textContent).toMatch(/falscher Key/);
    fireEvent.click(within(screen.getByTestId("bn-footer")).getByRole("button", { name: "Zurück" }));
    await waitFor(() => expect((screen.getByLabelText("API-Key") as HTMLInputElement).value).toBe(KEY));
  });

  it("reopened while connected it shows the manage view: rights, sync, disconnect with a question", async () => {
    server = status({ connections: [CONN] });
    useExchange.setState({ status: server, load: "ready" });
    wrap(<ConnectHost />);
    act(() => openConnectDialog("binance-futures"));
    const manage = await screen.findByTestId("bn-manage");
    expect(manage.textContent).toMatch(/Verbunden · …/);
    expect(manage.textContent).toMatch(/Stop und Ziel stehen bei Binance nicht im Verlauf/);
    fireEvent.click(screen.getByTestId("bn-disconnect"));
    expect(screen.getByText(/Der Key wird hier gelöscht/)).toBeTruthy();
  });
});

describe("TradingView assistant", () => {
  const open = async () => {
    wrap(<ConnectHost />);
    act(() => openConnectDialog("tradingview"));
    return screen.findByTestId("tv-wizard");
  };

  it("says up front that this is no OAuth and no MCP", async () => {
    const w = await open();
    expect(within(w).getByTestId("tv-honest").textContent).toMatch(/keine OAuth-Anbindung und kein TradingView-MCP/);
  });

  it("create the address (shown once) → alarm templates → test signal → the receipt appears", async () => {
    const w = await open();
    expect(within(w).getByTestId("tv-next").hasAttribute("disabled")).toBe(true); // no address yet
    fireEvent.click(await within(w).findByTestId("tv-create"));
    const url = await within(w).findByTestId("tv-url");
    expect(url.textContent).toBe(`${location.origin}/api/v1/hooks/tradingview/tj_${"A".repeat(43)}`);
    expect(w.textContent).toMatch(/nur jetzt komplett zu sehen/);

    fireEvent.click(within(w).getByTestId("tv-next"));
    expect(await within(w).findByTestId("tv-tpl-test")).toBeTruthy();
    expect(within(w).getByTestId("tv-tpl-open").textContent).toMatch(/"action":"open"/);
    expect(within(w).getByTestId("tv-tpl-pine").textContent).toMatch(/alertcondition/);
    expect(within(w).getByTestId("tv-trade-note").textContent).toMatch(/In deinem Tarif \(free\) ist es nicht enthalten/);

    fireEvent.click(within(w).getByTestId("tv-next"));
    expect(await within(w).findByTestId("tv-waiting")).toBeTruthy();
    fireEvent.click(within(w).getByTestId("tv-send-test"));
    const arrived = await within(w).findByTestId("tv-arrived");
    expect(arrived.getAttribute("data-via")).toBe("app");
    expect(arrived.textContent).toMatch(/Die Zieladresse funktioniert/);
    // the test went to the user's own address as text/plain (like TradingView), flagged as coming from the app
    const hook = calls.find((c) => c.path.startsWith("/api/v1/hooks/tradingview/"))!;
    expect(hook.method).toBe("POST");
    expect(hook.body).toMatchObject({ action: "test", source: "app" });
    expect(hook.contentType).toBe("text/plain");
    expect(within(w).getAllByTestId("tv-receipt")).toHaveLength(1);
  });

  it("a signal from outside is reported as TradingView's", async () => {
    tvToken = `tj_${"B".repeat(43)}`;
    tvReceipts = [{ id: "r9", kind: "test", via: "extern", symbol: "BINANCE:BTCUSDT", detail: null, receivedAt: "2026-11-06T10:05:00Z" }];
    const w = await open();
    expect(await within(w).findByTestId("tv-hidden")).toBeTruthy(); // an existing address is never shown again
    fireEvent.click(within(w).getByTestId("tv-next"));
    fireEvent.click(within(w).getByTestId("tv-next"));
    expect((await within(w).findByTestId("tv-arrived")).textContent).toMatch(/TradingView hat ein Signal geschickt/);
  });

  it("replacing the address asks first; disconnecting asks first", async () => {
    tvToken = `tj_${"C".repeat(43)}`;
    const w = await open();
    fireEvent.click(await within(w).findByTestId("tv-rotate"));
    expect(w.textContent).toMatch(/Die alte Adresse stoppt sofort/);
    fireEvent.click(within(w).getByTestId("tv-rotate-yes"));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/v1/connections/tradingview")).toBe(true));
    expect((calls.find((c) => c.method === "POST" && c.path === "/api/v1/connections/tradingview")!.body as Record<string, unknown>).action).toBe("rotate");
    fireEvent.click(within(w).getByTestId("tv-disconnect"));
    fireEvent.click(within(w).getByTestId("tv-disconnect-yes"));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });
});

describe("other dialogs", () => {
  it("telephone alarm: the dialog says why nothing can be connected", async () => {
    wrap(<ConnectHost />);
    act(() => openConnectDialog("alert-phone"));
    const info = await screen.findByTestId("connect-info");
    expect(info.getAttribute("data-state")).toBe("unconfigured");
    expect(info.textContent).toMatch(/Telefon-Alarm ist noch nicht eingerichtet/);
    expect(screen.queryByTestId("connect-info-action")).toBeNull();
  });
});

describe("partner box", () => {
  it("renders nothing without a configured link", () => {
    const { container } = render(<PartnerBox partner="binance" env={{}} />);
    expect(container.innerHTML).toBe("");
  });

  it("with a link: marked as sponsored, opens in a new tab without referrer, the notice is visible, the link is unchanged", () => {
    render(<PartnerBox partner="binance" env={{ VITE_PARTNER_BINANCE_REF: "https://www.binance.com/register?ref=OPERATOR1" }} />);
    const a = screen.getByTestId("partner-link") as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("https://www.binance.com/register?ref=OPERATOR1");
    expect(a.getAttribute("rel")).toBe("sponsored noopener noreferrer");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(screen.getByTestId("partner-notice").textContent).toBe("Partnerlink – wir bekommen eventuell eine Provision, für dich ändert sich nichts.");
    expect(screen.getByText("Noch kein Konto?")).toBeTruthy();
    expect(a.textContent).toMatch(/Konto bei Binance anlegen/);
  });
});
