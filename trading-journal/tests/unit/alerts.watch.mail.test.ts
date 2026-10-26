// @vitest-environment node
/// <reference types="node" />
/**
 * The mail of the e-mail alarm: text (German, short, honest), the Resend request (key, idempotency key, no secret in a
 * failure), the market client (one price list, the proxy fallback, the candle budget) and the clock of the time zone.
 */
import { afterEach, describe, expect, it } from "vitest";
import { MAIL_ITEMS_MAX, type OutboxItem } from "../../src/domain/keylevels/serverAlerts";
import { localClock, formatLocal, safeTz } from "../../netlify/functions/_lib/alertWatch/clock";
import { appOrigin, buildAlertMail, buildTestMail, mailConfig, sendCodeOf, sendMail } from "../../netlify/functions/_lib/alertWatch/mail";
import { barsNeeded, createMarket, FEED_BAR_CAP, FEED_BAR_MIN, marketErrorCode } from "../../netlify/functions/_lib/alertWatch/market";
import { binanceFake, setSeries } from "./alerts.watch.fixtures";

const NOW = Date.UTC(2026, 9, 26, 9, 5); // 10:05 in Berlin
const H = 3_600_000;

const item = (i: number, over: Partial<OutboxItem> = {}): OutboxItem => ({
  id: `l${i}|0|confirm`,
  at: NOW - (20 - i) * 60_000,
  levelId: `l${i}`,
  name: `Marke ${i}`,
  symbol: "BTCUSDT",
  tf: "4h",
  stage: "confirm",
  rule: "4H-Schluss über 85.900",
  title: "Bestätigt",
  detail: "4h-Schluss über 85.900.",
  basis: "close",
  price: 85_900,
  last: 86_120,
  ...over,
});
const base = { notes: { suppressed: 0, dropped: 0 }, expired: 0, tz: "Europe/Berlin", now: NOW, prices: new Map([["BTCUSDT", 86_200]]), sourceLabel: "Binance USDⓈ-M Futures", appUrl: "https://journal.example.test", maxPerDay: 6, sentToday: 1 };

describe("alert mail text", () => {
  it("one trigger: symbol, rule, price and time when it fired, price now, source and stand, the disclaimer, the link, how to switch off", () => {
    const m = buildAlertMail({ ...base, items: [item(1)] });
    expect(m.subject).toBe("Schlüsselmarke: Bestätigung · Marke 1 · BTCUSDT 4H");
    expect(m.text).toContain("Regel: 4H-Schluss über 85.900");
    expect(m.text).toContain("Ausgelöst: 26.10., 09:46 bei 86.120 · Kurs jetzt: 86.200");
    expect(m.text).toContain("Stand: Binance USDⓈ-M Futures, 26.10., 10:05 (Europe/Berlin).");
    expect(m.text).toContain("Keine professionelle Finanzberatung.");
    expect(m.text).toContain("Zur App: https://journal.example.test/#markt");
    expect(m.text).toContain("Abmelden: in der App unter Markt › Alarme & Zustellprotokoll › „E-Mail-Alarm bei geschlossener App“ ausschalten.");
    expect(m.text).toContain("Heute 1 von höchstens 6 Mails.");
    expect(m.text).not.toMatch(/kaufen|verkaufen|empfehle/i);
  });

  it("a missing number reads „keine Daten“, never a guess", () => {
    const m = buildAlertMail({ ...base, prices: new Map(), items: [item(1, { last: null })] });
    expect(m.text).toContain("bei keine Daten · Kurs jetzt: keine Daten");
  });

  it("a burst is one summary: oldest first, at most eight listed, the rest counted, notes in one line each", () => {
    const items = Array.from({ length: 11 }, (_, i) => item(i));
    const m = buildAlertMail({ ...base, items, notes: { suppressed: 2, dropped: 1 }, expired: 1, sentToday: 6 });
    expect(m.subject).toBe("11 Alarme deiner Schlüsselmarken (BTCUSDT)");
    expect(m.text).toContain(`${MAIL_ITEMS_MAX}) `);
    expect(m.text).not.toContain(`${MAIL_ITEMS_MAX + 1}) `);
    expect(m.text).toContain("… und 3 weitere Auslösungen davor.");
    expect(m.text).toContain("2 Auslösungen wurden wegen der Wiederholungssperre nicht einzeln gemailt.");
    expect(m.text).toContain("2 ältere Auslösungen werden nicht mehr gemailt");
    expect(m.text).toContain("Das war die letzte Mail für heute (Grenze 6 pro Tag)");
    expect(m.text.indexOf("Marke 3")).toBeLessThan(m.text.indexOf("Marke 10"));
  });

  it("a provisional (intrabar) trigger says so; a name cannot break the subject line", () => {
    const m = buildAlertMail({ ...base, items: [item(1, { basis: "intrabar", stage: "prepare", name: "Zeile\nzwei" })] });
    expect(m.text).toContain("Vorläufig: die laufende Kerze zählt noch nicht als Schluss.");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toContain("Vorbereitung · Zeile zwei");
  });

  it("the test mail names what it is and carries the same footer", () => {
    const m = buildTestMail({ now: NOW, tz: "Europe/Berlin", appUrl: null });
    expect(m.subject).toBe("Testmail – E-Mail-Alarm");
    expect(m.text).toContain("Das ist eine Testmail");
    expect(m.text).toContain("Keine professionelle Finanzberatung.");
    expect(m.text).not.toContain("Zur App:");
  });
});

describe("Resend", () => {
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.ALERT_FROM;
    delete process.env.SITE_ORIGIN;
  });

  it("needs both env values and a sender that looks like an address", () => {
    expect(mailConfig()).toBeNull();
    process.env.RESEND_API_KEY = "re_x";
    expect(mailConfig()).toBeNull();
    process.env.ALERT_FROM = "kein absender";
    expect(mailConfig()).toBeNull();
    for (const ok of ["alerts@example.test", "Trading Journal <alerts@example.test>"]) {
      process.env.ALERT_FROM = ok;
      expect(mailConfig()).toEqual({ apiKey: "re_x", from: ok });
    }
    process.env.ALERT_FROM = "a@b.c\nbcc: x@y.z";
    expect(mailConfig()).toBeNull();
  });

  it("the site origin is cleaned or absent", () => {
    expect(appOrigin()).toBeNull();
    process.env.SITE_ORIGIN = "https://journal.example.test/";
    expect(appOrigin()).toBe("https://journal.example.test");
    process.env.SITE_ORIGIN = "javascript:alert(1)";
    expect(appOrigin()).toBeNull();
  });

  it("posts one JSON mail with the key as bearer and the idempotency key; the id comes back", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const res = await sendMail(
      { apiKey: "re_secret", from: "alerts@example.test" },
      { to: "me@example.test", subject: "S", text: "T", idempotencyKey: "abc" },
      async (url, init) => ((seen = { url, init: init! }), new Response(JSON.stringify({ id: "m1" }), { status: 200 })),
    );
    expect(res).toEqual({ ok: true, id: "m1" });
    expect(seen!.url).toBe("https://api.resend.com/emails");
    const h = new Headers(seen!.init.headers);
    expect(h.get("authorization")).toBe("Bearer re_secret");
    expect(h.get("idempotency-key")).toBe("abc");
    expect(JSON.parse(String(seen!.init.body))).toEqual({ from: "alerts@example.test", to: ["me@example.test"], subject: "S", text: "T" });
  });

  it("failures are codes – and no code carries the key or the address", async () => {
    const cfg = { apiKey: "re_secret", from: "alerts@example.test" };
    const msg = { to: "me@example.test", subject: "S", text: "T", idempotencyKey: "k" };
    const status = (s: number, body: unknown = {}) => async () => new Response(JSON.stringify(body), { status: s });
    expect(await sendMail(cfg, msg, status(401))).toEqual({ ok: false, code: "resend_auth", status: 401 });
    expect(await sendMail(cfg, msg, status(403))).toMatchObject({ code: "resend_auth" });
    expect(await sendMail(cfg, msg, status(422))).toMatchObject({ code: "resend_invalid" });
    expect(await sendMail(cfg, msg, status(429))).toMatchObject({ code: "resend_rate" });
    expect(await sendMail(cfg, msg, status(503))).toMatchObject({ code: "resend_5xx" });
    expect(await sendMail(cfg, msg, async () => Promise.reject(new Error("socket hang up me@example.test")))).toEqual({ ok: false, code: "resend_network", status: null });
    // the same key with another payload = the first request went through; a request still running = try later
    expect(await sendMail(cfg, msg, status(409, { name: "invalid_idempotent_request" }))).toEqual({ ok: true, id: null, duplicate: true });
    expect(await sendMail(cfg, msg, status(409, { name: "concurrent_idempotent_requests" }))).toMatchObject({ ok: false, code: "resend_busy" });
    expect(sendCodeOf(400)).toBe("resend_invalid");
  });
});

describe("clock of the account's time zone", () => {
  it("local minutes, day and display follow the zone (summer and winter time)", () => {
    expect(localClock(Date.UTC(2026, 9, 26, 9, 5), "Europe/Berlin")).toEqual({ minutes: 10 * 60 + 5, day: "2026-10-26" });
    expect(localClock(Date.UTC(2026, 6, 1, 22, 30), "Europe/Berlin")).toEqual({ minutes: 30, day: "2026-07-02" });
    expect(localClock(Date.UTC(2026, 9, 26, 23, 59), "America/New_York")).toEqual({ minutes: 19 * 60 + 59, day: "2026-10-26" });
    expect(formatLocal(Date.UTC(2026, 9, 27, 0, 5), "Europe/Berlin")).toBe("27.10., 01:05");
    expect(safeTz("Mars/Olympus")).toBe("Europe/Berlin");
    expect(safeTz(undefined)).toBe("Europe/Berlin");
    expect(localClock(Date.UTC(2026, 9, 26, 0, 0), "UTC").minutes).toBe(0);
  });
});

describe("market access", () => {
  it("how many candles a level needs: since its start, never below 60, never above the feed's ring", () => {
    expect(barsNeeded("4h", NOW - 3 * 24 * H, NOW)).toBe(FEED_BAR_MIN);
    expect(barsNeeded("4h", NOW - 200 * 24 * H, NOW)).toBe(FEED_BAR_CAP.kline_4h);
    expect(barsNeeded("1h", NOW - 10 * 24 * H, NOW)).toBeGreaterThan(240);
    expect(barsNeeded("30m", NOW - 2 * 24 * H, NOW)).toBeGreaterThanOrEqual(2 * 24 * 4); // 15m source: 4 per hour
    expect(barsNeeded("1W", null, NOW)).toBe(80); // 50 bars of a stateless retest + the ATR run-up
  });

  it("ONE request lists every price; candles come per symbol and feed", async () => {
    const b = binanceFake(NOW);
    setSeries(b, "BTCUSDT", "4h", [1, 2, 3]);
    setSeries(b, "ETHUSDT", "1h", [4, 5]);
    const m = createMarket({ fetch: b.fetch, now: () => NOW });
    const prices = await m.prices();
    expect([...prices]).toEqual([["BTCUSDT", 3], ["ETHUSDT", 5]]);
    expect((await m.sourceBars("BTCUSDT", "kline_4h", 100)).map((c) => c.close)).toEqual([1, 2, 3]);
    expect(m.requests()).toBe(2);
    expect(m.source()).toBe("binance");
  });

  it("falls back to the proxy on 451 and stays there; both blocked → binance_451", async () => {
    const b = binanceFake(NOW);
    setSeries(b, "BTCUSDT", "4h", [1, 2, 3]);
    b.block.set("fapi.binance.com", 451);
    const m = createMarket({ fetch: b.fetch, now: () => NOW, proxyBase: "https://journal.example.test/api/binance/" });
    await m.prices();
    await m.sourceBars("BTCUSDT", "kline_4h", 10);
    expect(m.source()).toBe("proxy");
    expect(b.calls.filter((c) => c.startsWith("fapi.binance.com"))).toHaveLength(1); // only the first probe
    b.block.set("journal.example.test", 451);
    const dead = createMarket({ fetch: b.fetch, now: () => NOW, proxyBase: "https://journal.example.test/api/binance" });
    await expect(dead.prices()).rejects.toSatisfy((e) => marketErrorCode(e) === "binance_451");
    const noProxy = createMarket({ fetch: b.fetch, now: () => NOW });
    await expect(noProxy.prices()).rejects.toSatisfy((e) => marketErrorCode(e) === "binance_451");
  });

  it("a 403 or a rate limit of this address also moves on to the proxy", async () => {
    for (const status of [403, 429]) {
      const b = binanceFake(NOW);
      setSeries(b, "BTCUSDT", "4h", [1, 2, 3]);
      b.block.set("fapi.binance.com", status);
      const m = createMarket({ fetch: b.fetch, now: () => NOW, proxyBase: "https://journal.example.test/api/binance" });
      expect((await m.prices()).get("BTCUSDT")).toBe(3);
      expect(m.source()).toBe("proxy");
    }
  });

  it("an unknown symbol is no reason to try another door", async () => {
    const b = binanceFake(NOW);
    const m = createMarket({ fetch: b.fetch, now: () => NOW, proxyBase: "https://journal.example.test/api/binance" });
    await expect(m.sourceBars("NOPEUSDT", "kline_4h", 10)).rejects.toMatchObject({ kind: "bad_symbol" });
    expect(b.calls).toHaveLength(1);
  });
});
