/**
 * Verbindungen – the state machines and the views that derive from the stores (pure parts): the placeholder's six states
 * (+ sign-in) and their priority, the dialog's step machine (no double submit, the check is entered only by submit, a
 * question can be answered and re-sent), the per-service views (what is honestly said when the operator has not set a
 * thing up), and the partner link switch.
 */
import { describe, expect, it } from "vitest";
import { cloudView, connectionOf, emailView, exchangeView, phoneView, tvView } from "@/connect/facts";
import { cleanPartnerUrl, PARTNER_NOTICE, partnerLink } from "@/connect/partners";
import { PHONE_ALERTS_READY, SERVICE_IDS, SERVICES } from "@/connect/services";
import { canResubmit, OFFLINE_FACTS, SLOT_ACTION, SLOT_LABEL, slotState, wizardReducer, wizardStart, type SlotFacts } from "@/connect/slotState";
import { tvTemplatesAreJson } from "./connect.helpers";
import type { ExchangeConnection, ExchangeStatus } from "@/exchanges/types";
import type { TvStatus } from "@/connect/tvStore";
import { TV_CLOSE_MESSAGE, TV_OPEN_MESSAGE, TV_PINE, TV_TEST_MESSAGE, maskedUrl, webhookUrl } from "@/connect/tvTemplates";
import type { AlertStatus } from "@/views/schluesselmarken/emailAlertApi";

const F = (o: Partial<SlotFacts> = {}): SlotFacts => ({ ...OFFLINE_FACTS, configured: true, ...o });

describe("slotState", () => {
  it("each of the six states (+ sign-in) is reachable", () => {
    expect(slotState(F())).toBe("disconnected");
    expect(slotState(F({ connected: true }))).toBe("connected");
    expect(slotState(F({ busy: true }))).toBe("connecting");
    expect(slotState(F({ error: "Key abgelehnt" }))).toBe("error");
    expect(slotState(F({ entitled: false }))).toBe("upgrade");
    expect(slotState(F({ configured: false }))).toBe("unconfigured");
    expect(slotState(F({ needsSignIn: true }))).toBe("signin");
  });

  it("priority: not set up beats everything, then sign-in, running, error, connected, plan", () => {
    const all = F({ configured: false, needsSignIn: true, busy: true, error: "x", connected: true, entitled: false });
    expect(slotState(all)).toBe("unconfigured");
    expect(slotState({ ...all, configured: true })).toBe("signin");
    expect(slotState({ ...all, configured: true, needsSignIn: false })).toBe("connecting");
    expect(slotState({ ...all, configured: true, needsSignIn: false, busy: false })).toBe("error");
    expect(slotState({ ...all, configured: true, needsSignIn: false, busy: false, error: null })).toBe("connected");
    expect(slotState({ ...all, configured: true, needsSignIn: false, busy: false, error: null, connected: false })).toBe("upgrade");
  });

  it("an unknown configuration (still loading) is NOT 'not set up' and not 'connected'", () => {
    expect(slotState(OFFLINE_FACTS)).toBe("disconnected");
  });

  it("every state has a word, an action and a tone", () => {
    for (const s of ["unconfigured", "signin", "connecting", "error", "connected", "upgrade", "disconnected"] as const) {
      expect(SLOT_LABEL[s].length).toBeGreaterThan(2);
      expect(SLOT_ACTION[s].length).toBeGreaterThan(2);
    }
  });
});

describe("wizardReducer", () => {
  it("steps forward and back; the check step is entered only by submit", () => {
    let s = wizardStart(3);
    s = wizardReducer(s, { type: "next" });
    expect(s).toMatchObject({ step: 1, phase: "step" });
    expect(wizardReducer(s, { type: "next" })).toBe(s); // not into the check step
    s = wizardReducer(s, { type: "back" });
    expect(s.step).toBe(0);
    expect(wizardReducer(s, { type: "back" })).toBe(s);
    expect(wizardReducer(s, { type: "submit" })).toBe(s); // too early
  });

  it("submit → checking (a second submit is ignored) → ok", () => {
    let s = wizardReducer(wizardReducer(wizardStart(3), { type: "next" }), { type: "submit" });
    expect(s).toMatchObject({ step: 2, phase: "checking" });
    expect(wizardReducer(s, { type: "submit" })).toBe(s);
    expect(wizardReducer(s, { type: "back" })).toBe(s); // no leaving while the venue is asked
    s = wizardReducer(s, { type: "ok" });
    expect(s.phase).toBe("done");
    expect(wizardReducer(s, { type: "back" })).toBe(s);
    expect(wizardReducer(s, { type: "fail", message: "x" })).toBe(s);
  });

  it("failure → back to the form with the message cleared on the way; the error is kept while failed", () => {
    let s = wizardReducer(wizardReducer(wizardStart(3), { type: "next" }), { type: "submit" });
    s = wizardReducer(s, { type: "fail", message: "Key falsch" });
    expect(s).toMatchObject({ phase: "failed", error: "Key falsch", step: 2 });
    s = wizardReducer(s, { type: "back" });
    expect(s).toMatchObject({ phase: "step", step: 1, error: "Key falsch" });
    expect(wizardReducer(wizardReducer(s, { type: "back" }), { type: "next" }).error).toBeNull();
  });

  it("a question (rights warning) must be accepted before it can be sent again", () => {
    let s = wizardReducer(wizardReducer(wizardStart(3), { type: "next" }), { type: "submit" });
    s = wizardReducer(s, { type: "ask", warnings: ["Futures-Recht an"] });
    expect(s.phase).toBe("confirm");
    expect(canResubmit(s)).toBe(false);
    expect(wizardReducer(s, { type: "submit" })).toBe(s); // not accepted yet
    s = wizardReducer(s, { type: "accept" });
    expect(canResubmit(s)).toBe(true);
    s = wizardReducer(s, { type: "submit" });
    expect(s.phase).toBe("checking");
  });

  it("a flow without a check (TradingView) walks to the end with next", () => {
    let s = wizardStart(3, false);
    s = wizardReducer(wizardReducer(s, { type: "next" }), { type: "next" });
    expect(s.step).toBe(2);
    expect(wizardReducer(s, { type: "next" })).toBe(s);
    expect(wizardReducer(s, { type: "submit" })).toBe(s);
  });
});

const CONN = (o: Partial<ExchangeConnection> = {}): ExchangeConnection => ({
  id: "c1",
  exchange: "binance",
  label: "Futures",
  keyLast4: "abcd",
  permissions: ["read"],
  status: "active",
  lastSyncAt: null,
  lastError: null,
  journalAccount: "scalp",
  syncEnabled: true,
  createdAt: "2026-11-01T10:00:00.000Z",
  market: "futures",
  ...o,
});
const STATUS = (o: Partial<ExchangeStatus> = {}): ExchangeStatus => ({
  configured: true,
  cron: { enabled: true, everyMin: 30, nextAt: "2026-11-06T12:30:00.000Z" },
  plan: { plan: "pro", entitled: true, limit: 1, gated: true, autoSync: true },
  connections: [],
  runs: [],
  ...o,
});
const OPT = { signedIn: true, enabled: true, connectBusy: false, importing: false, loading: false };

describe("exchange view", () => {
  it("finds the connection of the right market (spot and futures are separate)", () => {
    const st = STATUS({ connections: [CONN(), CONN({ id: "c2", label: "Spot", market: "spot" }), CONN({ id: "c3", exchange: "bitunix", market: null })] });
    expect(connectionOf(st, "binance-futures")?.id).toBe("c1");
    expect(connectionOf(st, "binance-spot")?.id).toBe("c2");
    expect(connectionOf(st, "bitunix")?.id).toBe("c3");
    expect(connectionOf(STATUS({ connections: [CONN({ status: "revoked" })] }), "binance-futures")).toBeNull();
  });

  it("not signed in / not set up by the operator / loading / ready / connected / invalid key / plan / importing", () => {
    expect(exchangeView("binance-spot", null, { ...OPT, enabled: false }).state).toBe("unconfigured");
    expect(exchangeView("binance-spot", STATUS({ configured: false }), OPT).state).toBe("unconfigured");
    expect(exchangeView("binance-spot", null, { ...OPT, signedIn: false }).state).toBe("signin");
    expect(exchangeView("binance-spot", null, { ...OPT, loading: true })).toMatchObject({ state: "disconnected", line: "Status wird geladen …" });
    expect(exchangeView("binance-spot", STATUS(), OPT).state).toBe("disconnected");
    expect(exchangeView("binance-futures", STATUS({ connections: [CONN()] }), OPT)).toMatchObject({ state: "connected" });
    const bad = exchangeView("binance-futures", STATUS({ connections: [CONN({ status: "invalid", lastError: "Binance lehnt den Key ab." })] }), OPT);
    expect(bad).toMatchObject({ state: "error", line: "Binance lehnt den Key ab." });
    expect(exchangeView("binance-futures", STATUS({ plan: { plan: "free", entitled: false, limit: 0, gated: true } }), OPT).state).toBe("upgrade");
    expect(exchangeView("binance-futures", STATUS({ connections: [CONN()] }), { ...OPT, importing: true })).toMatchObject({ state: "connecting", line: "Erstimport läuft …" });
  });

  it("a connected key whose server lost its encryption key still shows as connected (what exists is not hidden)", () => {
    expect(exchangeView("binance-futures", STATUS({ configured: false, connections: [CONN()] }), OPT).state).toBe("connected");
  });
});

describe("TradingView, e-mail, telephone, cloud views", () => {
  const TV = (o: Partial<TvStatus> = {}): TvStatus => ({ hasToken: true, token: { id: "t", prefix: "tj_AbCd", createdAt: "2026-11-01T00:00:00Z", lastUsedAt: null }, receipts: [], receiptsAvailable: true, tradeAlerts: { allowed: true, plan: "premium" }, origin: null, ...o });

  it("TradingView: address without a signal is NOT connected; a received signal is; a refused newest signal is an error", () => {
    const o = { enabled: true, signedIn: true, loading: false };
    expect(tvView(null, o).state).toBe("disconnected");
    expect(tvView(TV(), o)).toMatchObject({ state: "disconnected", line: "Zieladresse steht – noch kein Signal angekommen." });
    const got = TV({ receipts: [{ id: "r1", kind: "test", via: "extern", symbol: "BTCUSDT", detail: null, receivedAt: "2026-11-05T10:00:00Z" }] });
    expect(tvView(got, o).state).toBe("connected");
    const refused = TV({ receipts: [{ id: "r2", kind: "rejected", via: "extern", symbol: null, detail: "402 API & Webhooks ist in deinem Tarif nicht enthalten.", receivedAt: "2026-11-05T11:00:00Z" }, ...got.receipts] });
    expect(tvView(refused, o)).toMatchObject({ state: "error" });
    expect(tvView(refused, o).line).toMatch(/abgelehnt/);
    expect(tvView(null, { ...o, signedIn: false }).state).toBe("signin");
    expect(tvView(null, { ...o, enabled: false }).state).toBe("unconfigured");
  });

  it("e-mail alarm: operator without mail setup → not set up; confirmed address + a run → connected; otherwise what is missing", () => {
    const A = (o: Partial<AlertStatus> = {}): AlertStatus => ({ configured: true, entitled: true, hasEmail: true, emailConfirmed: true, lastRun: { at: 1, ok: true, code: null, accounts: 1, symbols: 1, mails: 0, source: null }, intervalMin: 5, ...o });
    const o = { enabled: true, signedIn: true, loading: false };
    expect(emailView(A({ configured: false }), o).state).toBe("unconfigured");
    expect(emailView(A(), o).state).toBe("connected");
    expect(emailView(A({ emailConfirmed: false }), o).line).toMatch(/Bestätige/);
    expect(emailView(A({ hasEmail: false }), o).line).toMatch(/keine E-Mail/);
    expect(emailView(A({ entitled: false, lastRun: null }), o).state).toBe("upgrade");
    expect(emailView(null, { ...o, signedIn: false }).state).toBe("signin");
  });

  it("telephone alarm is honestly 'not set up' until the service exists", () => {
    expect(PHONE_ALERTS_READY).toBe(false);
    expect(phoneView()).toMatchObject({ state: "unconfigured" });
    expect(phoneView().line).toMatch(/noch nicht eingerichtet/);
  });

  it("cloud: no cloud in the build → not set up; signed in → connected", () => {
    expect(cloudView({ enabled: false, signedIn: false }).state).toBe("unconfigured");
    expect(cloudView({ enabled: true, signedIn: true }).state).toBe("connected");
    expect(cloudView({ enabled: true, signedIn: false }).state).toBe("disconnected");
  });

  it("every service has a definition", () => {
    for (const id of SERVICE_IDS) {
      expect(SERVICES[id].id).toBe(id);
      expect(SERVICES[id].what.length).toBeGreaterThan(20);
    }
  });
});

describe("partner links (off by default)", () => {
  it("nothing set → no link for any partner", () => {
    for (const id of ["tradingview", "binance", "bitunix"] as const) expect(partnerLink(id, {})).toBeNull();
    expect(partnerLink("binance", { VITE_PARTNER_BINANCE_REF: "   " })).toBeNull();
  });

  it("a plain https link is used exactly as given, marked as sponsored, with the visible notice", () => {
    const l = partnerLink("binance", { VITE_PARTNER_BINANCE_REF: "https://www.binance.com/register?ref=OPERATOR1" });
    expect(l).toMatchObject({ id: "binance", name: "Binance", href: "https://www.binance.com/register?ref=OPERATOR1", rel: "sponsored noopener noreferrer" });
    expect(l!.notice).toBe(PARTNER_NOTICE);
    expect(PARTNER_NOTICE).toBe("Partnerlink – wir erhalten ggf. eine Provision, für dich ändert sich nichts.");
  });

  it.each([
    ["http://example.com/x"],
    ["javascript:alert(1)"],
    ["https://user:pw@example.com/x"],
    ["https://exa mple.com"],
    ["//example.com/x"],
    ["ref=ABC"],
    ["https://localhost/x"],
    ["https://" + "a".repeat(600) + ".com"],
  ])("%s is refused", (raw) => {
    expect(cleanPartnerUrl(raw)).toBeNull();
  });

  it("each partner reads only its own variable", () => {
    const env = { VITE_PARTNER_TRADINGVIEW_REF: "https://www.tradingview.com/?aff_id=1" };
    expect(partnerLink("tradingview", env)).not.toBeNull();
    expect(partnerLink("binance", env)).toBeNull();
    expect(partnerLink("bitunix", env)).toBeNull();
  });
});

describe("TradingView templates", () => {
  it("the message templates are JSON once TradingView has filled its placeholders", () => {
    expect(tvTemplatesAreJson([TV_TEST_MESSAGE, TV_OPEN_MESSAGE, TV_CLOSE_MESSAGE])).toEqual([
      { action: "test", symbol: "BTCUSDT" },
      { action: "open", symbol: "BTCUSDT", side: "long", price: 1, qty: 1, timeframe: "1" },
      { action: "close", symbol: "BTCUSDT", side: "long", price: 1 },
    ]);
  });

  it("the Pine example is a v6 indicator with an alert condition that carries the entry message", () => {
    expect(TV_PINE).toMatch(/^\/\/@version=6/);
    expect(TV_PINE).toMatch(/alertcondition\(/);
    expect(TV_PINE).toContain('"action":"open"');
  });

  it("the address uses the operator's origin when the server reports one; the secret part is masked for display", () => {
    expect(webhookUrl("tj_AbCdEfGh", null, "https://app.example/")).toBe("https://app.example/api/v1/hooks/tradingview/tj_AbCdEfGh");
    expect(webhookUrl("tj_AbCdEfGh", "https://journal.example", "https://app.example")).toBe("https://journal.example/api/v1/hooks/tradingview/tj_AbCdEfGh");
    expect(maskedUrl("https://x.test/api/v1/hooks/tradingview/tj_AbCdEfGhIjKlMn")).toBe("https://x.test/api/v1/hooks/tradingview/tj_AbCd••••••••");
  });
});
