/**
 * Einstellungen › Alarme (C2): the view model – the server's answers are checked, the channel gates say what to do next, the plan's channel count is
 * respected, the Zustellprotokoll turns feed rows into German lines (a dead letter says how many tries, a reason is spelled out).
 */
import { describe, expect, it } from "vitest";
import { defaultAlertPrefs } from "@/domain/alerts/config";
import { channelGate, channelLimitHit, channelLimitText, deadLetters, deliveryLine, parseFeed, parsePrefsView, protocolRows, withEvent, type PrefsView } from "@/views/settings/alerts/model";

const view = (over: Partial<PrefsView> = {}): PrefsView => ({
  prefs: defaultAlertPrefs(),
  plan: "premium",
  limits: { alertChannels: 3, phoneCallsPerMonth: 30 },
  tz: "Europe/Berlin",
  email: { configured: true, hasEmail: true, confirmed: true },
  phone: { configured: true, verifyConfigured: true, status: "verified", masked: "+49 ••• ••67" },
  lastRun: null,
  ...over,
});

describe("answers are checked", () => {
  it("a prefs answer is read through the settings reader; a wrong shape is refused", () => {
    expect(parsePrefsView(null)).toBeNull();
    expect(parsePrefsView({ prefs: {} })).toBeNull();
    const v = parsePrefsView({ prefs: { cooldownMin: 1 }, plan: "pro", limits: { alertChannels: 2, phoneCallsPerMonth: 0 }, email: { configured: true }, phone: { status: "weird" } });
    expect(v?.prefs.cooldownMin).toBe(10);
    expect(v?.phone.status).toBe("none");
    expect(v?.limits).toEqual({ alertChannels: 2, phoneCallsPerMonth: 0 });
  });

  it("feed rows that do not fit are left out, never guessed", () => {
    const f = parseFeed({
      events: [
        { id: "e1", source: "industry", market: "Software", event: "green_warn", at: "2026-11-02T10:00:00Z", deliveries: [{ id: "d1", channel: "email", status: "sent" }, { id: "d2", channel: "fax", status: "sent" }, { id: "d3", channel: "phone", status: "bogus" }] },
        { id: "e2", source: "nope", event: "green_warn", at: "x" },
        { id: "e3", source: "whale", event: "blue_warn", at: "x" },
      ],
    });
    expect(f?.events).toHaveLength(1);
    expect(f?.events[0]!.deliveries.map((d) => d.id)).toEqual(["d1"]);
    expect(parseFeed({})).toBeNull();
  });
});

describe("channel gates", () => {
  it("browser is open; e-mail needs a configured server and a confirmed address", () => {
    expect(channelGate("browser", view()).state).toBe("ok");
    expect(channelGate("email", view()).state).toBe("ok");
    expect(channelGate("email", view({ email: { configured: false, hasEmail: true, confirmed: true } }))).toMatchObject({ state: "setup" });
    expect(channelGate("email", view({ email: { configured: true, hasEmail: true, confirmed: false } }))).toMatchObject({ state: "connect" });
  });

  it("phone: the plan first (with the next step), then the server, then the confirmed number", () => {
    expect(channelGate("phone", view({ limits: { alertChannels: 2, phoneCallsPerMonth: 0 } }))).toEqual({ state: "locked", message: "Anrufe gibt es ab Premium.", next: { label: "Tarife ansehen", page: "preise" } });
    expect(channelGate("phone", view({ phone: { configured: false, verifyConfigured: false, status: "none", masked: null } }))).toMatchObject({ state: "setup" });
    expect(channelGate("phone", view({ phone: { configured: true, verifyConfigured: false, status: "none", masked: null } })).state).toBe("setup");
    expect(channelGate("phone", view({ phone: { configured: true, verifyConfigured: true, status: "pending", masked: null } })).state).toBe("connect");
    expect(channelGate("phone", view({ phone: { configured: true, verifyConfigured: true, status: "revoked", masked: null } })).state).toBe("connect");
    expect(channelGate("phone", view()).state).toBe("ok");
  });

  it("the plan's channel count: a channel that is off cannot be switched on beyond the limit; a second event of a channel that is on can", () => {
    const p = withEvent(defaultAlertPrefs(), "browser", "green_warn", true);
    expect(channelLimitHit(p, "email", 1)).toBe(true);
    expect(channelLimitHit(p, "browser", 1)).toBe(false);
    expect(channelLimitHit(p, "email", 2)).toBe(false);
    expect(channelLimitText(1)).toContain("1 Kanal gleichzeitig");
    expect(channelLimitText(2)).toContain("2 Kanäle gleichzeitig");
  });
});

describe("protocol", () => {
  const feed = parseFeed({
    events: [
      { id: "e1", source: "industry", market: "Software", event: "green_confirm", detail: "Datenstand", at: "2026-11-02T10:00:00Z", deliveries: [{ id: "d1", channel: "phone", status: "failed", reason: "busy", attempts: 1 }, { id: "d2", channel: "email", status: "dead", reason: "resend_5xx", attempts: 5 }] },
      { id: "e2", source: "whale", market: "BTCUSDT", event: "red_warn", suppressed: "cooldown", at: "2026-11-02T09:00:00Z", deliveries: [] },
    ],
    other: [{ id: "t1", kind: "test", channel: "phone", status: "answered", at: "2026-11-02T11:00:00Z" }],
  })!;

  it("lines name the channel, the outcome and the reason; a dead letter says how many tries", () => {
    expect(deliveryLine({ channel: "phone", status: "failed", reason: "busy", attempts: 1 })).toBe("Telefon: fehlgeschlagen – Besetzt");
    expect(deliveryLine({ channel: "email", status: "dead", reason: "resend_5xx", attempts: 5 })).toBe("E-Mail: verworfen nach 5 Versuchen – Der Versanddienst antwortet nicht");
    expect(deliveryLine({ channel: "browser", status: "skipped", reason: "quiet_hours", attempts: 0 })).toBe("Browser: übersprungen – Ruhezeit");
    expect(deliveryLine({ channel: "email", status: "sent", reason: null, attempts: 1 })).toBe("E-Mail: gesendet");
  });

  it("rows: newest first, tests among them, a held-back event explained, dead letters counted", () => {
    const rows = protocolRows(feed);
    expect(rows.map((r) => r.id)).toEqual(["t1", "e1", "e2"]);
    expect(rows[1]!.title).toBe("Grün-Bestätigung · Software");
    expect(rows[2]!.note).toContain("Wiederholungssperre");
    expect(rows[0]!.title).toBe("Test · Telefon");
    expect(deadLetters(feed)).toBe(1);
  });
});
