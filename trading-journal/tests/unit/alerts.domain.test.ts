/**
 * Vier Alarme (C2) – the rest of the pure layer: settings reader, plan limits, quiet hours in the user's zone, the phone number
 * and the spoken text, delivery planning, retries, Twilio statuses, the phone budget and the three source adapters.
 */
import { describe, expect, it } from "vitest";
import { alertPrefsOf, channelsOn, checkPrefsAgainstLimits, cleanIndustries, cleanSymbols, defaultAlertPrefs, sourcesOn } from "@/domain/alerts/config";
import { backoffSec, deliveryKey, mapCallStatus, mayAdvance, MAX_ATTEMPTS, phoneBudget, planDeliveries, reasonText } from "@/domain/alerts/delivery";
import { alertCallText, buildTwiml, isE164, maskPhone, parsePhone, spokenMarket, testCallText } from "@/domain/alerts/phone";
import { isQuiet, quietEndsAt, safeZone, zoneClock } from "@/domain/alerts/quiet";
import { industryReadings, dayToMs } from "@/domain/alerts/sources/industry";
import { keyLevelReading } from "@/domain/alerts/sources/keylevel";
import { whaleReading, type RatioPoint } from "@/domain/alerts/sources/whale";
import type { IndustryDataset } from "@/domain/industryTrend/ampel";
import { blankKeyLevel } from "@/domain/keylevels/config";
import { unknownEvaluation } from "@/domain/keylevels/watch";

describe("AlertPrefs reader", () => {
  it("default: everything off, quiet hours on, German", () => {
    const p = defaultAlertPrefs();
    expect(channelsOn(p)).toEqual([]);
    expect(sourcesOn(p)).toEqual([]);
    expect(p.quiet).toEqual({ on: true, from: "22:00", to: "07:00" });
    expect(p.lang).toBe("de");
  });

  it("junk falls back to the default, numbers are clamped, unknown keys and markets are dropped", () => {
    expect(alertPrefsOf(null)).toEqual(defaultAlertPrefs());
    expect(alertPrefsOf("x")).toEqual(defaultAlertPrefs());
    const p = alertPrefsOf({
      lang: "fr",
      cooldownMin: 5,
      quiet: { on: true, from: "25:00", to: "06:30" },
      channels: { email: { green_confirm: true, red_confirm: "yes", bogus: true }, fax: { green_warn: true } },
      sources: { industry: { on: true, markets: ["Chips", "Nope", "Chips", "Banks"], params: { warn: 99, hyst: -1 } }, whale: { on: true, markets: ["btcusdt", "bad symbol", "ETHUSDT"], params: { confirm: 2.26 } } },
    });
    expect(p.lang).toBe("de");
    expect(p.cooldownMin).toBe(10);
    expect(p.quiet).toEqual({ on: true, from: "22:00", to: "06:30" });
    expect(p.channels.email).toEqual({ green_warn: false, green_confirm: true, red_warn: false, red_confirm: false });
    expect(channelsOn(p)).toEqual(["email"]);
    expect(p.sources.industry).toEqual({ on: true, markets: ["Chips", "Banks"], params: { warn: 10, confirm: 0, hyst: 0.1 } });
    expect(p.sources.whale.markets).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(p.sources.whale.params.confirm).toBe(2.5);
    expect(sourcesOn(p)).toEqual(["industry", "whale"]);
  });

  it("market lists are capped", () => {
    expect(cleanIndustries(Array.from({ length: 30 }, (_, i) => ["Agric", "Food", "Soda", "Beer", "Smoke", "Toys", "Fun", "Books", "Hshld", "Clths", "Hlth", "MedEq", "Drugs", "Chems"][i % 14]!)).length).toBeLessThanOrEqual(12);
    expect(cleanSymbols(["X", "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT"])).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT"]);
  });

  it("the plan limits: channels count, phone needs calls in the plan", () => {
    const on = (...c: ("browser" | "email" | "phone")[]) => {
      const p = defaultAlertPrefs();
      const ch = { ...p.channels };
      for (const k of c) ch[k] = { ...ch[k], green_confirm: true };
      return { ...p, channels: ch };
    };
    const free = { alertChannels: 1, phoneCallsPerMonth: 0 };
    const pro = { alertChannels: 2, phoneCallsPerMonth: 0 };
    const premium = { alertChannels: 3, phoneCallsPerMonth: 30 };
    expect(checkPrefsAgainstLimits(on("browser"), free)).toEqual({ ok: true, problem: null });
    expect(checkPrefsAgainstLimits(on("browser", "email"), free)).toEqual({ ok: false, problem: "channels" });
    expect(checkPrefsAgainstLimits(on("browser", "email"), pro)).toEqual({ ok: true, problem: null });
    expect(checkPrefsAgainstLimits(on("phone"), pro)).toEqual({ ok: false, problem: "phone" });
    expect(checkPrefsAgainstLimits(on("browser", "email", "phone"), premium)).toEqual({ ok: true, problem: null });
  });
});

describe("quiet hours in the user's zone", () => {
  // 2026-11-02 is Monday; Berlin is UTC+1 then (winter time since 25 Oct)
  const q = { on: true, from: "22:00", to: "07:00" };
  const at = (h: number, m = 0) => Date.UTC(2026, 10, 2, h, m);

  it("the zone clock is the user's, not the server's", () => {
    expect(zoneClock(at(21, 30), "Europe/Berlin")).toEqual({ minutes: 22 * 60 + 30, day: "2026-11-02" });
    expect(zoneClock(at(21, 30), "America/New_York")).toEqual({ minutes: 16 * 60 + 30, day: "2026-11-02" });
    expect(zoneClock(at(23, 30), "Asia/Tokyo")).toEqual({ minutes: 8 * 60 + 30, day: "2026-11-03" });
  });

  it("wraps over midnight, in Berlin", () => {
    expect(isQuiet(q, at(21, 0), "Europe/Berlin")).toBe(true); // 22:00 local
    expect(isQuiet(q, at(20, 59), "Europe/Berlin")).toBe(false); // 21:59
    expect(isQuiet(q, at(5, 59), "Europe/Berlin")).toBe(true); // 06:59
    expect(isQuiet(q, at(6, 0), "Europe/Berlin")).toBe(false); // 07:00
  });

  it("the same instant is quiet in one zone and not in another", () => {
    expect(isQuiet(q, at(21, 0), "Europe/Berlin")).toBe(true);
    expect(isQuiet(q, at(21, 0), "America/New_York")).toBe(false); // 16:00
  });

  it("off, or from = to, is never quiet; a bad zone falls back to Berlin", () => {
    expect(isQuiet({ ...q, on: false }, at(23), "Europe/Berlin")).toBe(false);
    expect(isQuiet({ on: true, from: "10:00", to: "10:00" }, at(10), "Europe/Berlin")).toBe(false);
    expect(safeZone("Mars/Olympus")).toBe("Europe/Berlin");
    expect(safeZone(undefined)).toBe("Europe/Berlin");
  });

  it("finds the end of the quiet hours (on a 5-minute grid)", () => {
    expect(quietEndsAt(q, at(21, 7), "Europe/Berlin")).toBe(Date.UTC(2026, 10, 3, 6, 0)); // 22:07 → 07:00 local next day = 06:00 UTC
    expect(quietEndsAt(q, at(12), "Europe/Berlin")).toBe(at(12));
  });
});

describe("phone number (E.164, worldwide)", () => {
  it.each([
    ["+49 170 1234567", "+491701234567"],
    ["0049 170 1234567", "+491701234567"],
    ["+1 (415) 555-2671", "+14155552671"],
    ["+44 20 7946 0958", "+442079460958"],
    ["+81.3.1234.5678", "+81312345678"],
    ["+55 11 91234-5678", "+5511912345678"],
    ["+354 555 1234", "+3545551234"],
  ])("accepts %s", (input, e164) => {
    expect(parsePhone(input)).toEqual({ ok: true, e164 });
    expect(isE164(e164)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["0170 1234567", "format"], // no country code: we do not guess
    ["170 1234567", "format"],
    ["+0 123 4567", "format"],
    ["+49 170 1", "too_short"],
    ["+49 170 1234567 8901234", "too_long"],
    ["+49 abc 1234567", "format"],
    ["++49 170 1234567", "format"],
    ["+49 170 1234567; rm", "format"],
    ["+800 1234 5678", "blocked"],
    ["+979 1234 5678", "blocked"],
    ["+882 1234 5678", "blocked"],
  ])("refuses %j (%s)", (input, problem) => {
    expect(parsePhone(input)).toEqual({ ok: false, problem });
  });

  it("masks a number so it can be recognised but not dialled", () => {
    expect(maskPhone("+491701234567")).toBe("+49 ••• ••67");
    expect(maskPhone("garbage")).toBe("••••");
  });
});

describe("spoken text and TwiML", () => {
  it("German and English, event and market, no trading instruction, always 'keine Beratung'", () => {
    expect(alertCallText("de", "green_warn", "Software")).toBe("Alarm: Grün-Vorwarnung bei Software. Das ist keine Beratung.");
    expect(alertCallText("en", "red_confirm", "BTCUSDT")).toBe("Alert: Red confirmation for BTCUSDT. This is not advice.");
    for (const e of ["green_warn", "green_confirm", "red_warn", "red_confirm"] as const) {
      const t = alertCallText("de", e, "Banken").toLowerCase();
      expect(t).not.toMatch(/kauf|verkauf|einsteigen|aussteigen|long|short/);
    }
    expect(testCallText("de")).toContain("keine Beratung");
    expect(testCallText("en")).toContain("not advice");
  });

  it("a market name can not break out of the markup or run on", () => {
    expect(spokenMarket('<Dial>+1900</Dial> & "x"')).toBe("Dial +1900 /Dial & x");
    expect(spokenMarket("A".repeat(100)).length).toBe(40);
    expect(spokenMarket("   ")).toBe("Markt");
    const twiml = buildTwiml("de", alertCallText("de", "green_warn", "<Dial>1</Dial>"));
    expect(twiml).not.toContain("<Dial");
    expect(twiml.match(/<Say /g)).toHaveLength(2);
    expect(twiml.startsWith('<?xml version="1.0" encoding="UTF-8"?><Response>')).toBe(true);
    expect(buildTwiml("en", "x")).toContain('language="en-US"');
    expect(buildTwiml("de", "x")).toContain('language="de-DE"');
  });
});

describe("delivery planning", () => {
  const berlin = "Europe/Berlin";
  const noon = Date.UTC(2026, 10, 2, 11, 0); // 12:00 Berlin
  const night = Date.UTC(2026, 10, 2, 22, 30); // 23:30 Berlin
  const prefs = (events: ("green_warn" | "green_confirm" | "red_warn" | "red_confirm")[], channels = ["browser", "email", "phone"] as const) => {
    const p = defaultAlertPrefs();
    const ch = { ...p.channels };
    for (const c of channels) ch[c] = { ...ch[c], ...Object.fromEntries(events.map((e) => [e, true])) } as (typeof ch)[typeof c];
    return { channels: ch, quiet: p.quiet };
  };
  const fire = (event: "green_warn" | "green_confirm" | "red_warn" | "red_confirm", at: number, over = {}) => ({ event, at, quiet: false, suppressed: null, ...over });

  it("one delivery per channel that wants this event, none for the others", () => {
    const plan = planDeliveries(fire("green_confirm", noon), { now: noon, tz: berlin, prefs: prefs(["green_confirm"], ["email", "phone"] as never), phoneReady: true, emailReady: true });
    expect(plan.map((d) => [d.channel, d.status])).toEqual([
      ["email", "queued"],
      ["phone", "queued"],
    ]);
    expect(planDeliveries(fire("red_warn", noon), { now: noon, tz: berlin, prefs: prefs(["green_confirm"]), phoneReady: true, emailReady: true })).toEqual([]);
  });

  it("an event held back by the cooldown has no delivery at all", () => {
    expect(planDeliveries(fire("green_confirm", noon, { suppressed: "cooldown" }), { now: noon, tz: berlin, prefs: prefs(["green_confirm"]), phoneReady: true, emailReady: true })).toEqual([]);
  });

  it("quiet hours: phone is skipped with the reason, e-mail waits for the morning, browser is skipped", () => {
    const plan = planDeliveries(fire("green_confirm", night, { quiet: true }), { now: night, tz: berlin, prefs: prefs(["green_confirm"]), phoneReady: true, emailReady: true });
    const by = Object.fromEntries(plan.map((d) => [d.channel, d]));
    expect(by.phone).toMatchObject({ status: "skipped", reason: "quiet_hours" });
    expect(by.browser).toMatchObject({ status: "skipped", reason: "quiet_hours" });
    expect(by.email).toMatchObject({ status: "queued", reason: null, runAt: Date.UTC(2026, 10, 3, 6, 0) });
  });

  it("a channel that is not set up is logged as skipped with the reason, not left out", () => {
    const plan = planDeliveries(fire("green_confirm", noon), { now: noon, tz: berlin, prefs: prefs(["green_confirm"]), phoneReady: false, emailReady: false });
    const by = Object.fromEntries(plan.map((d) => [d.channel, d]));
    expect(by.phone).toMatchObject({ status: "skipped", reason: "phone_not_ready" });
    expect(by.email).toMatchObject({ status: "skipped", reason: "email_not_ready" });
    expect(by.browser).toMatchObject({ status: "queued" });
  });

  it("the delivery key is the event and the channel – the same pair, the same key", () => {
    expect(deliveryKey("ev1", "phone")).toBe("ev1:phone");
    expect(deliveryKey("ev1", "phone")).toBe(deliveryKey("ev1", "phone"));
    expect(deliveryKey("ev1", "phone")).not.toBe(deliveryKey("ev1", "email"));
  });
});

describe("retries, statuses, budget", () => {
  it("backoff grows and ends in the dead letter", () => {
    expect([1, 2, 3, 4, 5].map(backoffSec)).toEqual([60, 300, 900, 3600, null]);
    expect(MAX_ATTEMPTS).toBe(5);
  });

  it("Twilio statuses map to queued / ringing / answered / failed with a reason", () => {
    expect(mapCallStatus("queued")).toEqual({ status: "queued", reason: null });
    expect(mapCallStatus("ringing")).toEqual({ status: "ringing", reason: null });
    expect(mapCallStatus("in-progress")).toEqual({ status: "answered", reason: null });
    expect(mapCallStatus("completed")).toEqual({ status: "answered", reason: null });
    expect(mapCallStatus("busy")).toEqual({ status: "failed", reason: "busy" });
    expect(mapCallStatus("no-answer")).toEqual({ status: "failed", reason: "no_answer" });
    expect(mapCallStatus("failed")).toEqual({ status: "failed", reason: "call_failed" });
    expect(mapCallStatus("canceled")).toEqual({ status: "failed", reason: "canceled" });
    expect(mapCallStatus("something-new")).toBeNull();
  });

  it("a callback moves a call forward only: a late 'ringing' does not undo 'answered', 'answered' never becomes 'failed'", () => {
    expect(mayAdvance("queued", "ringing")).toBe(true);
    expect(mayAdvance("sending", "ringing")).toBe(true);
    expect(mayAdvance("ringing", "answered")).toBe(true);
    expect(mayAdvance("ringing", "failed")).toBe(true);
    expect(mayAdvance("answered", "ringing")).toBe(false);
    expect(mayAdvance("answered", "failed")).toBe(false);
    expect(mayAdvance("failed", "answered")).toBe(false);
    expect(mayAdvance("ringing", "ringing")).toBe(false);
  });

  it("the phone budget checks the plan, the month, the account's day and the server's day, in this order", () => {
    const base = { monthLimit: 30, monthUsed: 0, userDayMax: 5, userDayUsed: 0, globalDayMax: 100, globalDayUsed: 0 };
    expect(phoneBudget(base)).toEqual({ ok: true });
    expect(phoneBudget({ ...base, monthLimit: 0 })).toEqual({ ok: false, reason: "no_plan" });
    expect(phoneBudget({ ...base, monthUsed: 30 })).toEqual({ ok: false, reason: "month_limit" });
    expect(phoneBudget({ ...base, monthUsed: 29 })).toEqual({ ok: true });
    expect(phoneBudget({ ...base, userDayUsed: 5 })).toEqual({ ok: false, reason: "user_day_limit" });
    expect(phoneBudget({ ...base, globalDayUsed: 100 })).toEqual({ ok: false, reason: "global_day_limit" });
    expect(phoneBudget({ ...base, monthUsed: 30, globalDayUsed: 100 })).toEqual({ ok: false, reason: "month_limit" });
  });

  it("every reason has a German text", () => {
    expect(reasonText("quiet_hours")).toBe("Ruhezeit");
    expect(reasonText("unclear")).toContain("nicht noch einmal angerufen");
    expect(reasonText(null)).toBe("");
  });
});

describe("source: Branchen-Trend", () => {
  // the worked example of the signal test: prices 1,1,2,4,2,1,1 → in on day 3, out on day 5 (up = down = 2, Keltner 1)
  const rets = [0, 0, 1, 1, -0.5, -0.5, 0];
  const bp = (r: number) => Math.round(r * 10_000);
  const data = (n: number): IndustryDataset => ({
    names: ["Chips", "Banks"],
    dates: Int32Array.from({ length: n }, (_, i) => 20260901 + i),
    returns: Int16Array.from([...rets.slice(0, n).map(bp), ...rets.slice(0, n).map(() => 0)]),
  });
  const trend = { up: 2, down: 2, kelt: 1 };

  it("while in: green held, red approach with the distance to the stop in percent of the price", () => {
    const [r] = industryReadings(data(5), ["Chips"], trend);
    expect(r).toMatchObject({ key: "industry:Chips", source: "industry", market: "Elektronik und Chips", held: "green", margin: Infinity });
    // price 2, stop 1.722 → (2 - 1.722) / 2 = 13.9 %
    expect(r!.approach!.side).toBe("red");
    expect(r!.approach!.distance).toBeCloseTo(13.9, 0);
    expect(r!.asOf).toBe(dayToMs(20260905));
    expect(r!.detail).toContain("Datenstand");
  });

  it("while out: red held, green approach with the distance to the entry line", () => {
    const [r] = industryReadings(data(7), ["Chips"], trend);
    expect(r!.held).toBe("red");
    // price 1, upper channel of the last day 1.656 → 65.6 %
    expect(r!.approach!.side).toBe("green");
    expect(r!.approach!.distance).toBeCloseTo(65.6, 0);
  });

  it("an unknown code gives no reading, a missing last return gives none (never 'out')", () => {
    expect(industryReadings(data(7), ["Nope"], trend)).toEqual([]);
    const d = data(7);
    d.returns[6] = -32768; // Chips, last day: no value
    expect(industryReadings(d, ["Chips", "Banks"], trend).map((r) => r.key)).toEqual(["industry:Banks"]);
  });
});

describe("source: Top-Trader-Umschlag", () => {
  const MIN = 60_000;
  const series = (shares: number[]): RatioPoint[] => shares.map((s, i) => ({ time: i * 5 * MIN, longPct: s }));

  it("held follows the 50 % line, margin is the distance to it", () => {
    const r = whaleReading("BTCUSDT", series([55, 55.5]), 2)!;
    expect(r).toMatchObject({ key: "whale:BTCUSDT", source: "whale", held: "green" });
    expect(r.margin).toBeCloseTo(5.5, 9);
    expect(whaleReading("BTCUSDT", series([45, 44]), 2)!.held).toBe("red");
    expect(whaleReading("BTCUSDT", series([50, 50.5]), 2)!.held).toBe("green");
    expect(whaleReading("BTCUSDT", series([50, 50]), 2)!.held).toBeNull();
  });

  it("the approach follows the direction of the last hour, toward the confirming line", () => {
    // 13 points = one hour; the share rose from 46 to 49: toward green, the line is 52 → 3 points to go
    const up = whaleReading("BTCUSDT", series([46, 46.1, 46.2, 46.5, 46.8, 47, 47.4, 47.8, 48, 48.2, 48.5, 48.8, 49]), 2)!;
    expect(up.approach).toEqual({ side: "green", distance: 3 });
    // fell from 54 to 51: toward red, the line is 48 → 3 to go
    const down = whaleReading("BTCUSDT", series([54, 53.8, 53.6, 53.2, 52.9, 52.6, 52.4, 52.2, 52, 51.8, 51.5, 51.2, 51]), 2)!;
    expect(down.approach).toEqual({ side: "red", distance: 3 });
    // a share that barely moves has no direction
    expect(whaleReading("BTCUSDT", series([50, 50.05]), 2)!.approach).toBeNull();
  });

  it("fewer than two usable points give no reading; bad points are ignored", () => {
    expect(whaleReading("BTCUSDT", series([50]), 2)).toBeNull();
    expect(whaleReading("BTCUSDT", [{ time: 0, longPct: 50 }, { time: 1, longPct: Number.NaN }, { time: 2, longPct: 140 }], 2)).toBeNull();
  });

  it("asOf is the newest point – the engine turns an old series into 'stale'", () => {
    expect(whaleReading("BTCUSDT", series([50, 51, 52]), 2)!.asOf).toBe(2 * 5 * MIN);
  });
});

describe("source: Schlüsselmarken", () => {
  const now = Date.UTC(2026, 10, 2);
  const settings = { prepare: { mode: "pct" as const, value: 0.5 } };
  const level = (direction: "above" | "below") => blankKeyLevel({ id: "k1", symbol: "BTCUSDT", price: 100_000, name: "Wochen<b>hoch", direction }, now);
  const ev = (over: Partial<ReturnType<typeof unknownEvaluation>>) => ({ ...unknownEvaluation("x"), ...over });

  it("confirmed above → green confirmed; confirmed below → red confirmed", () => {
    expect(keyLevelReading(level("above"), ev({ status: "confirmed", last: 100_500, trigger: 100_200 }), settings, now)).toMatchObject({ key: "keylevel:k1", held: "green", approach: null });
    expect(keyLevelReading(level("below"), ev({ status: "confirmed", last: 99_000, trigger: 99_800 }), settings, now)).toMatchObject({ held: "red" });
  });

  it("a running break counts as a warning (the close decides)", () => {
    expect(keyLevelReading(level("above"), ev({ status: "provisional" }), settings, now)).toMatchObject({ held: null, approach: { side: "green", distance: 0 } });
  });

  it("waiting within the prepare distance is a warning, waiting far away is nothing", () => {
    const near = keyLevelReading(level("above"), ev({ status: "waiting", last: 99_800, trigger: 100_000 }), settings, now);
    expect(near!.approach).toEqual({ side: "green", distance: 0 });
    const far = keyLevelReading(level("above"), ev({ status: "waiting", last: 90_000, trigger: 100_000 }), settings, now);
    expect(far).toMatchObject({ held: null, approach: null });
  });

  it("no data gives no reading; the name is plain text", () => {
    expect(keyLevelReading(level("above"), unknownEvaluation("Keine Kerzen"), settings, now)).toBeNull();
    expect(keyLevelReading(level("above"), ev({ status: "confirmed" }), settings, now)!.market).toBe("Wochen b hoch");
  });
});
