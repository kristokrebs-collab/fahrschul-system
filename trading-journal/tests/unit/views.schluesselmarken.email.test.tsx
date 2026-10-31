/**
 * Section „E-Mail-Alarm bei geschlossener App“ (F21) of the Alarme card: every state tells the truth (no cloud · signed
 * out · 2FA code missing · plan · server unreachable · server not set up · address · cloud sync off · off · on), the
 * switch writes `settings.serverAlerts`, the test mail and the daily limit work, and the card says what goes to the
 * server. The server's answers are canned; nothing is sent.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/cloud/api";
import { setCloudEnabledForTests } from "@/cloud/env";
import { setPrivacy } from "@/cloud/privacy";
import { useCloudSession } from "@/cloud/session";
import { patchSyncStatus, resetSyncStatus } from "@/cloud/sync/status";
import { blankKeyLevel, serverAlertsOf, withKeyLevels, withServerAlerts } from "@/domain/keylevels";
import { emailAlertView } from "@/views/schluesselmarken/emailAlertModel";
import type { AlertStatus } from "@/views/schluesselmarken/emailAlertApi";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const NOW = Date.UTC(2026, 9, 26, 12, 0);
const api = vi.hoisted(() => ({
  status: null as unknown,
  test: null as unknown,
  statusCalls: 0,
  testCalls: 0,
  entitled: true,
}));
vi.mock("@/views/schluesselmarken/emailAlertApi", () => ({
  fetchAlertStatus: async () => {
    api.statusCalls += 1;
    if (api.status instanceof Error) throw api.status;
    return api.status;
  },
  sendAlertTestMail: async () => {
    api.testCalls += 1;
    if (api.test instanceof Error) throw api.test;
  },
}));
vi.mock("@/billing/entitlements", () => ({ useEntitlement: () => api.entitled }));

const { EmailAlertSection } = await import("@/views/schluesselmarken/EmailAlertSection");
const { AlertsCard } = await import("@/views/schluesselmarken");
const { MotionRoot } = await import("@/motion/MotionRoot");
const { useJournal } = await import("@/store/journalStore");
const { useUi } = await import("@/store/uiStore");

const MY_ADDRESS = "trader@example.test";
const OK: AlertStatus = { configured: true, entitled: true, hasEmail: true, emailConfirmed: true, lastRun: { at: NOW - 3 * 60_000, ok: true, code: null, accounts: 1, symbols: 1, mails: 0, source: "binance" }, intervalMin: 5 };

function signIn(): void {
  useCloudSession.setState({ phase: "signedIn", needsMfa: false, emailConfirmed: true, user: { id: "u1", email: MY_ADDRESS, aal: "aal1", mfaEnrolled: false } });
}
function settingsPatch(patch: Record<string, unknown>): void {
  const s = useJournal.getState().settings;
  useJournal.setState({ settings: { ...s, ...patch } as typeof s });
}
const level = (id: string, over: Record<string, unknown> = {}) => blankKeyLevel({ id, symbol: "BTCUSDT", price: 80_000, name: id, since: NOW - 86_400_000, alerts: { on: true, prepare: true, confirm: true, retest: true, invalid: true, recurring: false }, ...over }, NOW);
const wrap = (ui: React.ReactElement) => render(<MotionRoot>{ui}</MotionRoot>);
const section = () => screen.getByTestId("email-alert");
const state = () => section().getAttribute("data-state");
const sw = () => within(section()).getByRole("switch", { name: "Per E-Mail benachrichtigen" });
const stored = () => serverAlertsOf(useJournal.getState().settings.serverAlerts);

beforeAll(() => installDomPolyfills());
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  localStorage.clear();
  await bootFixtureJournal();
  api.status = OK;
  api.test = null;
  api.statusCalls = 0;
  api.testCalls = 0;
  api.entitled = true;
  setCloudEnabledForTests(true);
  signIn();
  setPrivacy({ sync: true });
  patchSyncStatus({ phase: "live", pending: 0 });
  useUi.setState({ toasts: [] });
  settingsPatch({ serverAlerts: undefined, keyLevels: withKeyLevels(undefined, { levels: [level("k1", { name: "BTC Ausbruch" })] }) });
});
afterEach(() => {
  vi.useRealTimers();
  setCloudEnabledForTests(null);
  resetSyncStatus();
  useCloudSession.setState({ phase: "off", user: null, needsMfa: false });
});

describe("emailAlertView – the first thing in the way is what the card says", () => {
  const base = { cloud: true, signedIn: true, needsMfa: false, entitled: true, status: { kind: "ok", data: OK } as const, syncOn: true, syncPhase: "live" as const, cfg: { email: false } };
  it("walks the preconditions in order", () => {
    expect(emailAlertView({ ...base, cloud: false }).kind).toBe("nocloud");
    expect(emailAlertView({ ...base, signedIn: false }).kind).toBe("signedout");
    expect(emailAlertView({ ...base, needsMfa: true }).kind).toBe("mfa");
    expect(emailAlertView({ ...base, entitled: false }).kind).toBe("upgrade");
    expect(emailAlertView({ ...base, status: { kind: "ok", data: { ...OK, entitled: false } } }).kind).toBe("upgrade");
    expect(emailAlertView({ ...base, status: { kind: "loading" } }).kind).toBe("loading");
    expect(emailAlertView({ ...base, status: { kind: "error", message: "x" } }).kind).toBe("unavailable");
    expect(emailAlertView({ ...base, status: { kind: "ok", data: { ...OK, configured: false } } }).kind).toBe("setup");
    expect(emailAlertView({ ...base, status: { kind: "ok", data: { ...OK, hasEmail: false } } }).kind).toBe("address");
    expect(emailAlertView({ ...base, status: { kind: "ok", data: { ...OK, emailConfirmed: false } } }).kind).toBe("unconfirmed");
    expect(emailAlertView({ ...base, syncOn: false }).kind).toBe("sync");
    expect(emailAlertView({ ...base, syncPhase: "locked" }).kind).toBe("sync");
    expect(emailAlertView(base).kind).toBe("off");
    expect(emailAlertView({ ...base, cfg: { email: true } }).kind).toBe("on");
  });

  it("only the last two states let the alarm be switched on; the test mail needs the server, the plan and the address – not the sync", () => {
    const flags = (over: Partial<typeof base>) => {
      const v = emailAlertView({ ...base, ...over });
      return [v.canEnable, v.testable];
    };
    expect(flags({})).toEqual([true, true]);
    expect(flags({ syncOn: false })).toEqual([false, true]);
    expect(flags({ status: { kind: "ok", data: { ...OK, configured: false } } as never })).toEqual([false, false]);
    expect(flags({ entitled: false })).toEqual([false, false]);
    expect(flags({ signedIn: false })).toEqual([false, false]);
  });
});

describe("EmailAlertSection – the states", () => {
  it("without a cloud: honest, switch off and disabled", () => {
    setCloudEnabledForTests(false);
    wrap(<EmailAlertSection />);
    expect(state()).toBe("nocloud");
    expect(section()).toHaveTextContent("braucht ein Konto");
    expect(sw()).toBeDisabled();
    expect(api.statusCalls).toBe(0);
  });

  it("signed out: „Nur mit Konto“ and a button that opens the login sheet", async () => {
    useCloudSession.setState({ phase: "signedOut", user: null });
    wrap(<EmailAlertSection />);
    expect(state()).toBe("signedout");
    expect(sw()).toBeDisabled();
    await act(async () => fireEvent.click(within(section()).getByRole("button", { name: "Anmelden" })));
    expect(useCloudSession.getState().sheet.open).toBe(true);
    expect(api.statusCalls).toBe(0);
  });

  it("2FA code missing", () => {
    useCloudSession.setState({ needsMfa: true });
    wrap(<EmailAlertSection />);
    expect(state()).toBe("mfa");
    expect(sw()).toBeDisabled();
  });

  it("a plan without the alarm: named, switch disabled, the server is not even asked", () => {
    api.entitled = false;
    wrap(<EmailAlertSection />);
    expect(state()).toBe("upgrade");
    expect(section()).toHaveTextContent("Tarif Pro");
    expect(sw()).toBeDisabled();
    expect(api.statusCalls).toBe(0);
  });

  it("asks the server, then shows the answer; an unreachable server is named with its reason", async () => {
    api.status = new ApiError(0, "unavailable", "Die Server-Funktionen sind auf dieser Seite nicht eingerichtet.");
    wrap(<EmailAlertSection />);
    expect(state()).toBe("loading");
    await waitFor(() => expect(state()).toBe("unavailable"));
    expect(screen.getByTestId("email-alert-note")).toHaveTextContent("Die Server-Funktionen sind auf dieser Seite nicht eingerichtet.");
    expect(sw()).toBeDisabled();
  });

  it("a server without RESEND_API_KEY / ALERT_FROM: „Einrichtung nötig“, nothing can be switched on", async () => {
    api.status = { ...OK, configured: false };
    wrap(<EmailAlertSection />);
    await waitFor(() => expect(state()).toBe("setup"));
    expect(screen.getByTestId("email-alert-note")).toHaveTextContent("RESEND_API_KEY und ALERT_FROM");
    expect(sw()).toBeDisabled();
    expect(within(section()).queryByRole("button", { name: "Testmail senden" })).toBeNull();
  });

  it("an address that is not confirmed", async () => {
    api.status = { ...OK, emailConfirmed: false };
    wrap(<EmailAlertSection />);
    await waitFor(() => expect(state()).toBe("unconfirmed"));
    expect(sw()).toBeDisabled();
  });

  it("cloud sync off on this device: the server would not see the rules – the switch stays off, the test mail still works", async () => {
    setPrivacy({ sync: false });
    wrap(<EmailAlertSection />);
    await waitFor(() => expect(state()).toBe("sync"));
    expect(section()).toHaveTextContent("Cloud-Sync ist aus");
    expect(sw()).toBeDisabled();
    expect(within(section()).getByRole("button", { name: "Testmail senden" })).toBeEnabled();
    setPrivacy({ sync: true });
  });

  it("switched off: everything is ready, nothing is mailed", async () => {
    wrap(<EmailAlertSection />);
    await waitFor(() => expect(state()).toBe("off"));
    expect(sw()).toBeEnabled();
    expect(sw()).toHaveAttribute("aria-checked", "false");
    expect(within(section()).queryByTestId("email-alert-rows")).toBeNull();
  });
});

describe("EmailAlertSection – the switch, the numbers, the test mail", () => {
  it("switching on writes the flag, the moment and the daily limit default into settings.serverAlerts – and nothing else of the settings changes", async () => {
    const before = useJournal.getState().settings;
    wrap(<EmailAlertSection />);
    await waitFor(() => expect(state()).toBe("off"));
    await act(async () => fireEvent.click(sw()));
    await waitFor(() => expect(stored().email).toBe(true));
    expect(stored().armedAt).toBe(NOW);
    expect(stored().outbox).toEqual([]);
    const after = useJournal.getState().settings;
    expect({ ...after, serverAlerts: undefined }).toEqual({ ...before, serverAlerts: undefined });
    await waitFor(() => expect(state()).toBe("on"));
  });

  it("shows what the server reports: last check, what is watched, mails today, what waits, a failed send, levels it cannot watch", async () => {
    settingsPatch({
      serverAlerts: withServerAlerts(undefined, {
        email: true,
        armedAt: NOW - 3_600_000,
        maxPerDay: 6,
        mails: { day: "2026-10-26", n: 2 },
        lastMailAt: NOW - 25 * 60_000,
        outbox: [{ id: "k1|0|confirm", at: NOW - 60_000, levelId: "k1", name: "BTC Ausbruch", symbol: "BTCUSDT", tf: "4h", stage: "confirm", rule: "4H-Schluss über 80.000", title: "t", detail: "d", basis: "close", price: 80_000, last: 80_500 }],
        fail: { at: NOW - 10 * 60_000, n: 2, code: "resend_auth" },
        problems: [{ id: "k1", code: "symbol" }],
      }),
    });
    wrap(<EmailAlertSection />);
    await waitFor(() => expect(state()).toBe("on"));
    const rows = screen.getByTestId("email-alert-rows");
    expect(within(rows).getByTestId("email-alert-lastrun")).toHaveTextContent("vor 3 Min");
    expect(rows).toHaveTextContent("1 Marke mit Alarm");
    expect(rows).toHaveTextContent("2 von höchstens 6");
    expect(rows).toHaveTextContent("vor 25 Min");
    expect(rows).toHaveTextContent("1 Auslösung");
    expect(rows).toHaveTextContent("Die letzten 2 Versuche sind fehlgeschlagen");
    expect(rows).toHaveTextContent("Schlüssel oder die Absender-Domain abgelehnt");
    expect(rows).toHaveTextContent("BTC Ausbruch: Binance kennt das Symbol nicht");
  });

  it("no check reported yet, a stale schedule and a failed run are each said plainly", async () => {
    settingsPatch({ serverAlerts: withServerAlerts(undefined, { email: true, armedAt: NOW }) });
    api.status = { ...OK, lastRun: null };
    const view = wrap(<EmailAlertSection />);
    await waitFor(() => expect(screen.getByTestId("email-alert-lastrun")).toHaveTextContent("Noch keine Prüfung gemeldet"));
    view.unmount();
    api.status = { ...OK, lastRun: { ...OK.lastRun!, at: NOW - 50 * 60_000 } };
    const stale = wrap(<EmailAlertSection />);
    await waitFor(() => expect(screen.getByTestId("email-alert-lastrun")).toHaveTextContent("hat sich seit 50 Min nicht gemeldet"));
    stale.unmount();
    api.status = { ...OK, lastRun: { ...OK.lastRun!, ok: false, code: "binance_451" } };
    wrap(<EmailAlertSection />);
    await waitFor(() => expect(screen.getByTestId("email-alert-lastrun")).toHaveTextContent("HTTP 451"));
  });

  it("no mark with an alarm: it says there is nothing to watch", async () => {
    settingsPatch({ serverAlerts: withServerAlerts(undefined, { email: true, armedAt: NOW }), keyLevels: withKeyLevels(undefined, { levels: [level("k1", { alerts: { on: false, prepare: true, confirm: true, retest: true, invalid: true, recurring: false } })] }) });
    wrap(<EmailAlertSection />);
    await waitFor(() => expect(state()).toBe("on"));
    expect(screen.getByTestId("email-alert-rows")).toHaveTextContent("keine – schalte bei einer Schlüsselmarke den Alarm ein");
  });

  it("turning it OFF always works, also when the server is unreachable – and writes only the flag", async () => {
    settingsPatch({ serverAlerts: withServerAlerts(undefined, { email: true, armedAt: NOW, mem: { k1: { fp: "x", m: { cycle: 0, reached: 1, fired: {}, ever: {} } } } }) });
    api.status = new ApiError(0, "unavailable", "Der Server ist gerade nicht erreichbar.");
    wrap(<EmailAlertSection />);
    await waitFor(() => expect(state()).toBe("unavailable"));
    expect(sw()).toBeEnabled();
    await act(async () => fireEvent.click(sw()));
    await waitFor(() => expect(stored().email).toBe(false));
    expect(Object.keys(stored().mem)).toEqual(["k1"]);
  });

  it("the daily limit is a switch of 3 / 6 / 12 / 24 and is saved", async () => {
    settingsPatch({ serverAlerts: withServerAlerts(undefined, { email: true, armedAt: NOW }) });
    wrap(<EmailAlertSection />);
    await waitFor(() => expect(state()).toBe("on"));
    await act(async () => fireEvent.click(within(section()).getByRole("radio", { name: "12" })));
    await waitFor(() => expect(stored().maxPerDay).toBe(12));
    expect(screen.getByTestId("email-alert-rows")).toHaveTextContent("0 von höchstens 12");
  });

  it("the test mail goes to the account's own address (named from the session, not hard-coded) and a refusal shows the server's reason", async () => {
    wrap(<EmailAlertSection />);
    await waitFor(() => expect(state()).toBe("off"));
    expect(section()).toHaveTextContent(`Empfänger: ${MY_ADDRESS}`);
    await act(async () => fireEvent.click(screen.getByTestId("email-alert-test")));
    await waitFor(() => expect(api.testCalls).toBe(1));
    expect(useUi.getState().toasts.map((t) => t.title)).toContain(`Testmail an ${MY_ADDRESS} gesendet`);
    api.test = new ApiError(429, "rate_limited", "Zu viele Anfragen – bitte kurz warten.");
    await act(async () => fireEvent.click(screen.getByTestId("email-alert-test")));
    await waitFor(() => expect(useUi.getState().toasts.some((t) => t.title === "Testmail nicht gesendet" && t.detail === "Zu viele Anfragen – bitte kurz warten.")).toBe(true));
  });

  it("says what goes to the server and what the alarm is not", async () => {
    wrap(<EmailAlertSection />);
    await waitFor(() => expect(state()).toBe("off"));
    const p = screen.getByTestId("email-alert-privacy");
    expect(p).toHaveTextContent("Alarmregeln");
    expect(p).toHaveTextContent("E-Mail-Adresse deines Kontos");
    expect(p).toHaveTextContent("nicht deine Trades oder Notizen");
    expect(section()).toHaveTextContent("kein Push");
    expect(section()).toHaveTextContent("Die App sendet nie Orders");
    expect(section()).not.toHaveTextContent(/rund um die Uhr|24\/7|garantiert/i);
  });
});

describe("AlertsCard carries the section", () => {
  it("the old honest line stays and points to the e-mail alarm", () => {
    setCloudEnabledForTests(false);
    wrap(<AlertsCard />);
    expect(screen.getByTestId("alerts-honest")).toHaveTextContent("nur, solange diese App in einem Browser-Tab geöffnet ist");
    expect(within(screen.getByTestId("alerts-card")).getByTestId("email-alert")).toBeInTheDocument();
  });
});
