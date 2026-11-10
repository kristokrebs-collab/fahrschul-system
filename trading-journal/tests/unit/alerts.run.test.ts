// @vitest-environment node
/// <reference types="node" />
/**
 * Vier Alarme (C2) – one look of the cron (`netlify/functions/_lib/alerts/run.ts`) from the sources to the queued deliveries, and the whole way
 * through the worker. Fake loaders (no network), the in-memory store, fake Twilio / Resend.
 *
 *   - first look silent; a flip makes ONE event with one delivery per channel that asked for it
 *   - crash between "events written" and "memory saved": the repeated run decides the same events, the database refuses them, nothing is
 *     delivered twice – end to end through the worker: one mail, one call
 *   - plan limits, quiet hours, cooldown, cadence of the sources, source switched off, missing migration
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAlertPrefs, type AlertPrefs } from "@/domain/alerts/config";
import type { RatioPoint } from "@/domain/alerts/sources/whale";
import { dayToMs } from "@/domain/alerts/sources/industry";
import type { AlertReading } from "@/domain/alerts/types";
import type { IndustryDataset } from "@/domain/industryTrend/ampel";
import { runWorker, type DeliverDeps } from "../../netlify/functions/_lib/alerts/deliver";
import { decodeIndustryPayload } from "../../netlify/functions/_lib/alerts/loaders";
import { runAlerts, type RunDeps } from "../../netlify/functions/_lib/alerts/run";
import type { RunLoaders } from "../../netlify/functions/_lib/alerts/sources";
import { AlertsMigrationMissing } from "../../netlify/functions/_lib/alerts/store";
import { setTwilioFetchForTests } from "../../netlify/functions/_lib/alerts/twilio";
import { gzipSync } from "node:zlib";
import * as fx from "./alerts.watch.fixtures";
import { H, memoryStore, MIN, twilioFake, type MemoryStore, type TwilioFake } from "./alerts.fakes";

const U = "u-1";
const NOON = Date.UTC(2026, 10, 2, 11, 0, 0); // 12:00 Berlin, Monday

let store: MemoryStore;
let tw: TwilioFake;
let resend: fx.ResendFake;
let industryTail: number[];
let ratio: RatioPoint[];
let levelReadings: AlertReading[];
let reads: { industry: number; ratio: number };

/** 150 flat days (alternating ±0.2 %), then `tail`, ending on 31 October 2026. */
function dataset(tail: number[]): IndustryDataset {
  const T = 150 + tail.length;
  const end = Date.UTC(2026, 9, 31);
  const dates = Int32Array.from({ length: T }, (_, i) => {
    const d = new Date(end - (T - 1 - i) * 86_400_000);
    return d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  });
  const bp = (r: number) => Math.round(r * 10_000);
  const rets = [...Array.from({ length: 150 }, (_, i) => bp(i % 2 === 0 ? 0.002 : -0.002)), ...tail.map(bp)];
  return { names: ["Chips", "Banks"], dates, returns: Int16Array.from([...rets, ...rets.map(() => 0)]) };
}

function loaders(): RunLoaders {
  return {
    industry: async () => {
      reads.industry += 1;
      return dataset(industryTail);
    },
    ratio: async () => {
      reads.ratio += 1;
      return ratio;
    },
    keyLevels: async () => levelReadings,
  };
}

function on(): AlertPrefs["channels"]["email"] {
  return { green_warn: true, green_confirm: true, red_warn: true, red_confirm: true };
}

function prefs(over: Partial<AlertPrefs> = {}): AlertPrefs {
  const p = defaultAlertPrefs();
  return {
    ...p,
    channels: { browser: p.channels.browser, email: on(), phone: on() },
    sources: { ...p.sources, industry: { on: true, markets: ["Chips"], params: { warn: 2, confirm: 0, hyst: 0.5 } } },
    ...over,
  };
}

function setup(p: AlertPrefs = prefs()): void {
  store.users.set(U, { prefs: p, tz: "Europe/Berlin" });
  store.secrets.set(U, { numberEnc: "enc:+491701234567", verified: true });
}

const run = (over: Partial<RunDeps> = {}) =>
  runAlerts({ store, loaders: loaders(), now: store.clock.now, plans: async (ids) => new Map(ids.map((i) => [i, "premium" as const])), twilioReady: true, mailReady: true, recipient: async () => ({ email: "t@example.test", confirmed: true }), ...over });

const deliverDeps = (): DeliverDeps => ({
  store,
  now: () => store.clock.now,
  mail: { apiKey: "k", from: "A <a@example.test>" },
  twilio: { sid: `AC${"0".repeat(32)}`, token: "t", from: "+4930123456", verifySid: null },
  recipient: async () => ({ email: "t@example.test", confirmed: true }),
  plan: async () => "premium",
  decryptNumber: (_u, b) => b.replace("enc:", ""),
  appUrl: "https://j.test",
  brakes: { userDayMax: 5, globalDayMax: 50 },
  sendFetch: resend.fetch,
});

/** a later look: the clock moves by `ms` */
const later = (ms: number) => {
  store.clock.now += ms;
};

beforeEach(() => {
  store = memoryStore(NOON);
  tw = twilioFake();
  resend = fx.resendFake();
  setTwilioFetchForTests(tw.fetch);
  industryTail = [];
  ratio = [];
  levelReadings = [];
  reads = { industry: 0, ratio: 0 };
  delete process.env.STRIPE_SECRET_KEY;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  setTwilioFetchForTests(null);
  vi.restoreAllMocks();
  for (const k of ["STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO_MONTHLY"]) delete process.env[k];
});

describe("the look", () => {
  it("does nothing without an account that has a source on – one query, no reading", async () => {
    store.users.set(U, { prefs: defaultAlertPrefs(), tz: "Europe/Berlin" });
    const s = await run();
    expect(s).toMatchObject({ users: 0, fires: 0 });
    expect(reads).toEqual({ industry: 0, ratio: 0 });
    expect(store.state).toBeNull();
  });

  it("the first look is silent (the baseline), the flip after it fires ONE event with a delivery per channel that asked", async () => {
    setup();
    const first = await run();
    expect(first).toMatchObject({ users: 1, watched: 1, fires: 0, queued: 0 });
    expect(store.events).toHaveLength(0);
    expect(Object.keys(store.memory.get(U) as object)).toEqual(["industry:Chips"]);

    industryTail = [0.1]; // a 10 % day: through the upper channel → in
    later(6 * H + 5 * MIN);
    const second = await run();
    expect(second).toMatchObject({ fires: 1, queued: 2, skipped: 0, duplicates: 0 });
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({ event: "green_confirm", market: "Elektronik und Chips", source: "industry", suppressed: null });
    expect(store.events[0]!.dedupKey).toMatch(/^u-1\|industry:Chips\|c2\|green_confirm\|n1$/);
    expect(store.deliveriesOf(U).map((d) => [d.channel, d.status]).sort()).toEqual([["email", "queued"], ["phone", "queued"]]);
    expect([...store.jobs.values()]).toHaveLength(2);

    // the whole way: the worker mails and dials
    const w = await runWorker(deliverDeps());
    expect(w).toMatchObject({ claimed: 2, sent: 1, dialed: 1 });
    expect(resend.sent).toHaveLength(1);
    expect(tw.calls).toHaveLength(1);
    expect(tw.calls[0]!.twiml).toContain("Alarm: Grün-Bestätigung bei Elektronik und Chips. Das ist keine Beratung.");
  });

  it("a state that does not change makes no new event: the same data twice is one event", async () => {
    setup();
    await run();
    industryTail = [0.1];
    later(6 * H + 5 * MIN);
    await run();
    later(6 * H + 5 * MIN);
    const third = await run();
    expect(third.fires).toBe(0);
    expect(store.events).toHaveLength(1);
  });

  it("CRASH between 'events written' and 'memory saved': the repeated run decides the same event, the database refuses it – one mail, one call", async () => {
    setup();
    await run();
    industryTail = [0.1];
    later(6 * H + 5 * MIN);
    store.crashAt = { op: "saveMemory", times: 1 };
    const crashed = await run();
    expect(crashed.errors).toBe(1);
    expect(store.events).toHaveLength(1); // written …
    const before = JSON.stringify(store.memory.get(U));
    // … but the memory still says what it said before (the flat series sits near the entry line: a warning, not the confirmation)
    expect(before).toContain('"phase":"green_warn"');
    later(5 * MIN);
    const repeated = await run();
    // the industry source is read every 6 hours; the repeated run is 5 minutes later, so it is NOT read again – move the clock past the period
    expect(repeated.fires).toBe(0);
    later(6 * H);
    const again = await run();
    expect(again).toMatchObject({ fires: 1, duplicates: 1, queued: 0 });
    expect(store.events).toHaveLength(1);
    expect(store.deliveriesOf(U)).toHaveLength(2);
    expect([...store.jobs.values()]).toHaveLength(2);
    store.clock.now = Date.UTC(2026, 10, 3, 9, 0); // the next morning: out of the quiet hours (a call that waited into them would be skipped)
    await runWorker(deliverDeps());
    await runWorker(deliverDeps());
    expect(resend.sent).toHaveLength(1);
    expect(tw.calls).toHaveLength(1);
  });

  it("the sources are read at their own pace: the industry file every 6 hours, Binance every 5 minutes", async () => {
    setup(prefs({ sources: { ...defaultAlertPrefs().sources, industry: { on: true, markets: ["Chips"], params: { warn: 2, confirm: 0, hyst: 0.5 } }, whale: { on: true, markets: ["BTCUSDT"], params: { warn: 3, confirm: 2, hyst: 1 } } } }));
    const series = (t: number): RatioPoint[] => [
      { time: t - 5 * MIN, longPct: 49 },
      { time: t, longPct: 49.5 },
    ];
    ratio = series(store.clock.now);
    await run();
    expect(reads).toEqual({ industry: 1, ratio: 1 });
    later(5 * MIN);
    ratio = series(store.clock.now);
    await run();
    expect(reads).toEqual({ industry: 1, ratio: 2 });
    later(6 * H);
    ratio = series(store.clock.now);
    await run();
    expect(reads.industry).toBe(2);
  });

  it("a stale reading (a Binance point older than 15 minutes) changes nothing and is counted", async () => {
    setup(prefs({ sources: { ...defaultAlertPrefs().sources, whale: { on: true, markets: ["BTCUSDT"], params: { warn: 3, confirm: 2, hyst: 1 } } } }));
    ratio = [
      { time: store.clock.now - 40 * MIN, longPct: 49 },
      { time: store.clock.now - 35 * MIN, longPct: 49.5 },
    ];
    const s = await run();
    expect(s.stale).toBe(1);
    expect(store.memory.get(U)).toBeUndefined();
  });

  it("the top-trader reversal: warning, then confirmation, from the series", async () => {
    setup(prefs({ sources: { ...defaultAlertPrefs().sources, whale: { on: true, markets: ["BTCUSDT"], params: { warn: 3, confirm: 2, hyst: 1 } } }, cooldownMin: 10 }));
    const at = (shares: number[]): RatioPoint[] => shares.map((p, i) => ({ time: store.clock.now - (shares.length - 1 - i) * 5 * MIN, longPct: p }));
    ratio = at([46, 46.5, 47, 47.2, 47.4]); // baseline: below 50, rising slowly – but far from the line (distance 4.6 > 3)
    await run();
    later(5 * MIN);
    ratio = at([46.5, 47, 47.4, 48, 49.5]); // rising, 2.5 points from the confirming line (52) → warning
    const w = await run();
    expect(w.fires).toBe(1);
    expect(store.events[0]).toMatchObject({ event: "green_warn", market: "BTCUSDT" });
    later(5 * MIN);
    ratio = at([49, 49.5, 50.5, 51.5, 52.5]); // over the line by 0.5 … margin 2.5 ≥ confirm 2 → confirmation
    const c = await run();
    expect(c.fires).toBe(1);
    expect(store.events[1]).toMatchObject({ event: "green_confirm" });
  });

  it("the key levels' own readings go through the same engine", async () => {
    const reading = (over: Partial<AlertReading>): AlertReading => ({ key: "keylevel:k1", source: "keylevel", market: "Wochenhoch", held: null, margin: Infinity, approach: null, asOf: store.clock.now, ...over });
    setup(prefs({ sources: { ...defaultAlertPrefs().sources, keylevel: { on: true, markets: [], params: { warn: 0, confirm: 0, hyst: 0 } } } }));
    levelReadings = [reading({})];
    await run();
    later(5 * MIN);
    levelReadings = [reading({ held: null, approach: { side: "green", distance: 0 } })];
    expect((await run()).fires).toBe(1);
    expect(store.events[0]).toMatchObject({ event: "green_warn", source: "keylevel" });
    later(5 * MIN);
    levelReadings = [reading({ held: "green" })];
    await run();
    expect(store.events.map((e) => e.event)).toEqual(["green_warn", "green_confirm"]);
  });
});

describe("plan limits", () => {
  it("a plan without calls: the phone channel is dropped at planning time (Pro, payments on)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_x";
    setup();
    await run({ plans: async () => new Map([[U, "pro" as const]]) });
    industryTail = [0.1];
    later(6 * H + 5 * MIN);
    const s = await run({ plans: async () => new Map([[U, "pro" as const]]) });
    expect(s.queued).toBe(1);
    expect(store.deliveriesOf(U).map((d) => d.channel)).toEqual(["email"]);
  });

  it("Free has ONE channel: of e-mail and phone only the first in order stays (Free, payments on)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_x";
    setup();
    const free = { plans: async () => new Map([[U, "free" as const]]) };
    await run(free);
    industryTail = [0.1];
    later(6 * H + 5 * MIN);
    await run(free);
    expect(store.deliveriesOf(U).map((d) => d.channel)).toEqual(["email"]);
  });
});

describe("quiet hours, cooldown, readiness", () => {
  it("inside the quiet hours the phone is skipped with the reason (logged), the mail waits for the morning, no call, no mail now", async () => {
    setup();
    store.clock.now = Date.UTC(2026, 10, 2, 21, 0); // 22:00 Berlin: quiet from now
    await run();
    industryTail = [0.1];
    later(6 * H + 5 * MIN); // 04:05 Berlin
    const s = await run();
    expect(s).toMatchObject({ fires: 1, queued: 1, skipped: 1 });
    const by = Object.fromEntries(store.deliveriesOf(U).map((d) => [d.channel, d]));
    expect(by.phone).toMatchObject({ status: "skipped", reason: "quiet_hours" });
    expect(by.email).toMatchObject({ status: "queued" });
    const j = [...store.jobs.values()][0]!;
    expect(j.runAt).toBe(Date.UTC(2026, 10, 3, 6, 0)); // 07:00 Berlin
    expect((await runWorker(deliverDeps())).claimed).toBe(0);
    expect(resend.sent).toHaveLength(0);
    store.clock.now = Date.UTC(2026, 10, 3, 6, 0);
    await runWorker(deliverDeps());
    expect(resend.sent).toHaveLength(1);
    expect(tw.calls).toHaveLength(0);
  });

  it("the same event within the cooldown is kept as an event without deliveries", async () => {
    setup(prefs({ cooldownMin: 24 * 60 }));
    industryTail = [0.1];
    await run(); // baseline: in
    industryTail = [0.1, -0.3]; // a crash day: out → red_confirm
    later(6 * H + 5 * MIN);
    await run();
    industryTail = [0.1, -0.3, 0.2]; // a big rebound day: in again? only if it breaks the channel – the memory decides
    later(6 * H + 5 * MIN);
    await run();
    const suppressed = store.events.filter((e) => e.suppressed === "cooldown");
    for (const e of suppressed) expect(store.deliveriesOf(U).filter((d) => d.eventId === e.id)).toHaveLength(0);
  });

  it("a channel that is not set up is logged skipped with the reason (no verified number, no confirmed address)", async () => {
    setup();
    store.secrets.clear();
    await run({ recipient: async () => ({ email: "t@example.test", confirmed: false }) });
    industryTail = [0.1];
    later(6 * H + 5 * MIN);
    const s = await run({ recipient: async () => ({ email: "t@example.test", confirmed: false }) });
    expect(s).toMatchObject({ queued: 0, skipped: 2 });
    expect(store.deliveriesOf(U).map((d) => `${d.channel}:${d.reason}`).sort()).toEqual(["email:email_not_ready", "phone:phone_not_ready"]);
  });
});

describe("housekeeping", () => {
  it("a source that is switched off loses its memory (switching it on again starts silently)", async () => {
    setup();
    await run();
    expect(store.memory.get(U)).toBeDefined();
    store.users.set(U, { prefs: prefs({ sources: { ...defaultAlertPrefs().sources, whale: { on: true, markets: ["BTCUSDT"], params: { warn: 3, confirm: 2, hyst: 1 } } } }), tz: "Europe/Berlin" });
    later(6 * H + 5 * MIN);
    ratio = [
      { time: store.clock.now - 5 * MIN, longPct: 47 },
      { time: store.clock.now, longPct: 47.1 },
    ];
    await run();
    expect(Object.keys(store.memory.get(U) as object)).toEqual(["whale:BTCUSDT"]);
  });

  it("a missing migration is named, nothing is done", async () => {
    setup();
    store.candidates = async () => {
      throw new AlertsMigrationMissing();
    };
    const s = await run();
    expect(s.code).toBe("migration");
    expect(store.state).toMatchObject({ ok: false, code: "migration" });
  });

  it("an account that throws does not stop the others (the error is counted)", async () => {
    setup();
    store.users.set("u-2", { prefs: prefs(), tz: "Europe/Berlin" });
    const real = store.loadMemory;
    store.loadMemory = async (u) => {
      if (u === U) throw new Error("db");
      return real(u);
    };
    const s = await run();
    expect(s.errors).toBe(1);
    expect(store.memory.get("u-2")).toBeDefined();
  });

  it("the run's own bookkeeping says when each source was last read", async () => {
    setup();
    await run();
    expect(store.state).toMatchObject({ ok: true, read: { industry: store.clock.now } });
  });
});

describe("industry payload decoding (server)", () => {
  it("round trip of the wire block; a block that does not add up is refused", () => {
    const d = dataset([0.1]);
    const T = d.dates.length;
    const buf = Buffer.alloc(T * 4 + d.returns.length * 2);
    for (let t = 0; t < T; t++) buf.writeInt32LE(d.dates[t]!, t * 4);
    for (let k = 0; k < d.returns.length; k++) buf.writeInt16LE(d.returns[k]!, T * 4 + k * 2);
    const payload = { source: "ken-french", fetchedAt: 0, fileTime: null, cached: false, database: null, names: d.names, days: T, firstDay: d.dates[0]!, lastDay: d.dates[T - 1]!, encoding: "int32le-dates+int16le-industry-major;gzip;base64", bytes: buf.length, data: gzipSync(buf).toString("base64") } as const;
    const back = decodeIndustryPayload(payload);
    expect(back).not.toBeNull();
    expect(Array.from(back!.dates)).toEqual(Array.from(d.dates));
    expect(Array.from(back!.returns)).toEqual(Array.from(d.returns));
    expect(decodeIndustryPayload({ ...payload, bytes: buf.length + 1 })).toBeNull();
    expect(decodeIndustryPayload({ ...payload, lastDay: 20991231 })).toBeNull();
    expect(decodeIndustryPayload({ ...payload, data: "not-gzip" })).toBeNull();
    expect(dayToMs(20261031)).toBe(Date.UTC(2026, 9, 31));
  });
});
