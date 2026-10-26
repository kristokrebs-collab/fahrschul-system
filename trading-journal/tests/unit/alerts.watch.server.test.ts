// @vitest-environment node
/// <reference types="node" />
/**
 * The e-mail alarm on the server (F21): `runAlertWatch` against an in-memory settings table (the two RPCs of migration
 * 0008 with their rev guard), a fake Binance (klines + one price list) and a fake Resend (idempotency key honoured).
 * Nothing real is called and no real mail is sent. The addresses are made-up examples.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ALERT_SETTINGS, serverAlertsOf } from "../../src/domain/keylevels";
import * as fx from "./alerts.watch.fixtures";

vi.mock("../../netlify/functions/_lib/supabase", async () => {
  const f = await import("./alerts.watch.fixtures");
  return { supabaseAdmin: () => f.fakeSupabase };
});
const plan = vi.hoisted(() => ({ payments: false }));
vi.mock("../../netlify/functions/_lib/plan", () => ({
  paymentsConfigured: () => plan.payments,
  effectivePlan: (r: { plan: unknown; plan_status: unknown }) => ({ plan: r.plan, status: r.plan_status, trialEnd: null }),
}));

const { runAlertWatch } = await import("../../netlify/functions/_lib/alertWatch/run");

const { H, MIN } = fx;
/** Monday 2026-10-26 09:05 UTC = 10:05 in Berlin (CET). */
const T0 = Date.UTC(2026, 9, 26, 9, 5);
const U = "user-one";
const MAIL = `${U}@example.test`;

let b: fx.BinanceFake;
let r: fx.ResendFake;
let logs: string[];

async function run(now: number, series?: (b: fx.BinanceFake) => void) {
  vi.setSystemTime(now);
  b.now = now;
  series?.(b);
  return runAlertWatch({ now, fetch: b.fetch, sendFetch: r.fetch });
}
const row = (id = U) => fx.db.rows.get(id)!;
const sa = (id = U) => serverAlertsOf(row(id).data.serverAlerts);
/** BTC 4h closes, oldest first; the last one is the forming candle. */
const btc4h = (...closes: number[]) => (x: fx.BinanceFake) => fx.setSeries(x, "BTCUSDT", "4h", closes);

/** A user with one 4h-close level at 100 above, made long before the switch (`since` old), the alarm on since an hour ago. */
function user(over: { id?: string; levels?: ReturnType<typeof fx.level>[]; armedAt?: number; maxPerDay?: number; alerts?: Record<string, unknown>; tz?: string; plan?: string; confirmed?: boolean } = {}) {
  const levels = over.levels ?? [fx.level({ id: "k1", name: "Ausbruch", alerts: { ...fx.ALERT_ON } }, T0 - 3 * 24 * H)];
  fx.putUser(over.id ?? U, {
    data: fx.settingsData(levels, { armedAt: over.armedAt ?? T0 - H, maxPerDay: over.maxPerDay, alerts: over.alerts }),
    plan: over.plan,
    tz: over.tz,
    confirmed: over.confirmed,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  fx.resetDb();
  plan.payments = false;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.ALERT_FROM = "Trading Journal <alerts@example.test>";
  process.env.SITE_ORIGIN = "https://journal.example.test";
  b = fx.binanceFake(T0);
  r = fx.resendFake();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.RESEND_API_KEY;
  delete process.env.ALERT_FROM;
  delete process.env.SITE_ORIGIN;
});

describe("e-mail alarm: one trigger, one mail", () => {
  it("the first look is silent; a close beyond the level mails ONCE, later runs stay quiet", async () => {
    user();
    const first = await run(T0, btc4h(95, 96, 97, 98, 99));
    expect(first).toMatchObject({ enabled: true, accounts: 1, watched: 1, fires: 0, mails: 0 });
    expect(r.sent).toHaveLength(0);
    // the stage memory was seeded (the only write of a quiet first look)
    expect(Object.keys(sa().mem)).toEqual(["k1"]);
    const writesAfterSeed = fx.db.writes;

    // a quiet run writes nothing at all
    await run(T0 + 5 * MIN, btc4h(95, 96, 97, 98, 99));
    expect(fx.db.writes).toBe(writesAfterSeed);

    // the 08:00 candle closes at 104 → Bestätigung
    const T1 = T0 + 4 * H;
    const res = await run(T1, btc4h(95, 96, 97, 98, 99, 104, 105));
    expect(res).toMatchObject({ fires: 1, mails: 1 });
    expect(r.sent).toHaveLength(1);
    const mail = r.sent[0]!;
    expect(mail.to).toEqual([MAIL]);
    expect(mail.from).toBe("Trading Journal <alerts@example.test>");
    expect(mail.subject).toBe("Schlüsselmarke: Bestätigung · Ausbruch · BTCUSDT 4H");
    expect(mail.text).toContain("Regel: 4H-Schluss über 100");
    expect(mail.text).toContain("Kurs jetzt: 105");
    expect(mail.text).toContain("Keine professionelle Finanzberatung.");
    expect(mail.text).toContain("Zur App: https://journal.example.test/#markt");
    expect(mail.text).toContain("E-Mail-Alarm bei geschlossener App");
    expect(mail.text).toContain("Heute 1 von höchstens 6 Mails.");
    expect(mail.key).toMatch(/^[0-9a-f]{40}$/);
    // the outbox is empty again, the day counted
    expect(sa().outbox).toHaveLength(0);
    expect(sa().mails).toEqual({ day: "2026-10-26", n: 1 });

    const writes = fx.db.writes;
    for (const k of [5, 10, 15]) await run(T1 + k * MIN, btc4h(95, 96, 97, 98, 99, 104, 105));
    expect(r.sent).toHaveLength(1);
    expect(fx.db.writes).toBe(writes);
  });

  it("writes only data.serverAlerts: the rest of the settings and the browser's keys survive", async () => {
    user({ maxPerDay: 3 });
    fx.db.rows.get(U)!.data.serverAlerts = { ...(fx.db.rows.get(U)!.data.serverAlerts as object), futureKey: { keep: 1 } };
    const before = JSON.stringify({ ...row().data, serverAlerts: undefined });
    await run(T0, btc4h(95, 96, 97, 98, 99));
    await run(T0 + 4 * H, btc4h(95, 96, 97, 98, 99, 104, 105));
    expect(JSON.stringify({ ...row().data, serverAlerts: undefined })).toBe(before);
    const stored = row().data.serverAlerts as Record<string, unknown>;
    expect(stored).toMatchObject({ v: 1, email: true, maxPerDay: 3, futureKey: { keep: 1 } });
  });

  it("a level made after the switch is watched from its creation: a touch between creation and first look is announced", async () => {
    const created = T0 - 20 * MIN;
    user({ levels: [fx.level({ id: "k1", name: "Neu", kind: "touch", alerts: { ...fx.ALERT_ON } }, created)], armedAt: T0 - H });
    const res = await run(T0, btc4h(95, 96, 97, 98, 101)); // the forming candle already reached 100
    expect(res.mails).toBe(1);
    expect(r.sent[0]!.subject).toContain("Bestätigung");
    expect(r.sent[0]!.text).toContain("Regel: Berührung von 100");
  });

  it("an old level that is already beyond when the alarm is switched on is NOT announced (what is true is not news)", async () => {
    user();
    const res = await run(T0, btc4h(95, 96, 97, 104, 105));
    expect(res).toMatchObject({ fires: 0, mails: 0 });
    expect(r.sent).toHaveLength(0);
  });

  it("two levels firing in the same run become ONE mail", async () => {
    const old = T0 - 3 * 24 * H;
    user({ levels: [fx.level({ id: "k1", name: "A", alerts: { ...fx.ALERT_ON } }, old), fx.level({ id: "k2", name: "B", price: 98, alerts: { ...fx.ALERT_ON } }, old)] });
    await run(T0, btc4h(90, 91, 92, 93, 94));
    const res = await run(T0 + 4 * H, btc4h(90, 91, 92, 93, 94, 104, 105));
    expect(res).toMatchObject({ fires: 2, mails: 1 });
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.subject).toBe("2 Alarme deiner Schlüsselmarken (BTCUSDT)");
    expect(r.sent[0]!.text).toContain("1) ");
    expect(r.sent[0]!.text).toContain("2) ");
  });
});

describe("e-mail alarm: quiet by construction", () => {
  it("active hours: a trigger at night waits and goes out in the first mail of the morning", async () => {
    const hours = { ...DEFAULT_ALERT_SETTINGS, hours: { on: true, from: "08:00", to: "22:00" } };
    user({ alerts: hours });
    const eve = Date.UTC(2026, 9, 26, 20, 5); // 21:05 Berlin, inside
    await run(eve, btc4h(95, 96, 97, 98, 99));
    const night = Date.UTC(2026, 9, 27, 0, 5); // 01:05 Berlin, outside – the 20:00 candle closed at 104
    const held = await run(night, btc4h(95, 96, 97, 98, 99, 104, 105));
    expect(held).toMatchObject({ fires: 1, mails: 0, waiting: 1 });
    expect(r.sent).toHaveLength(0);
    expect(sa().outbox).toHaveLength(1);
    const morning = Date.UTC(2026, 9, 27, 7, 5); // 08:05 Berlin
    const sent = await run(morning, btc4h(95, 96, 97, 98, 99, 104, 105, 106));
    expect(sent.mails).toBe(1);
    expect(r.sent[0]!.text).toContain("Ausgelöst: 27.10., 01:05");
    expect(sa().outbox).toHaveLength(0);
  });

  it("a trigger older than 24 hours is never mailed and the next mail says so", async () => {
    const hours = { ...DEFAULT_ALERT_SETTINGS, hours: { on: true, from: "10:00", to: "11:00" } };
    user({ alerts: hours });
    await run(T0, btc4h(95, 96, 97, 98, 99)); // 10:05 Berlin, inside
    const t1 = T0 + 4 * H; // 14:05 Berlin, outside: fires, waits
    await run(t1, btc4h(95, 96, 97, 98, 99, 104, 105));
    expect(sa().outbox).toHaveLength(1);
    // two days later at 10:30 Berlin the item is far older than 24 h: dropped, no mail
    const late = Date.UTC(2026, 9, 28, 9, 30);
    const res = await run(late, btc4h(105, 106, 107, 108, 109));
    expect(res.mails).toBe(0);
    expect(sa().outbox).toHaveLength(0);
    expect(sa().notes.dropped).toBe(1);
  });

  it("daily limit and gap: a burst is summarised, the rest waits for the next day", async () => {
    const old = T0 - 3 * 24 * H;
    user({ maxPerDay: 1, levels: [fx.level({ id: "k1", name: "A", alerts: { ...fx.ALERT_ON } }, old), fx.level({ id: "k2", name: "B", symbol: "ETHUSDT", tf: "1h", price: 50, alerts: { ...fx.ALERT_ON } }, old)] });
    const seed = (x: fx.BinanceFake) => {
      fx.setSeries(x, "BTCUSDT", "4h", [95, 96, 97, 98, 99]);
      fx.setSeries(x, "ETHUSDT", "1h", [40, 41, 42, 43, 44]);
    };
    await run(T0, seed);
    // 14:05 Berlin: BTC 4h closes at 104 → mail 1 (limit 1/day reached)
    const t1 = T0 + 4 * H;
    await run(t1, (x) => {
      fx.setSeries(x, "BTCUSDT", "4h", [95, 96, 97, 98, 99, 104, 105]);
      fx.setSeries(x, "ETHUSDT", "1h", [40, 41, 42, 43, 44, 45, 46, 47, 48]);
    });
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.text).toContain("Das war die letzte Mail für heute (Grenze 1 pro Tag)");
    // ETH 1h closes at 55 an hour later: held by the daily limit
    const res = await run(t1 + H, (x) => fx.setSeries(x, "ETHUSDT", "1h", [40, 41, 42, 43, 44, 45, 46, 47, 48, 55, 56]));
    expect(res).toMatchObject({ fires: 1, mails: 0, waiting: 1 });
    expect(sa().outbox).toHaveLength(1);
    expect(r.sent).toHaveLength(1);
    // the next morning the held item goes out
    const next = Date.UTC(2026, 9, 27, 7, 5);
    const out = await run(next, (x) => fx.setSeries(x, "ETHUSDT", "1h", [40, 41, 42, 43, 44, 45, 46, 47, 48, 55, 56, 57]));
    expect(out.mails).toBe(1);
    expect(r.sent).toHaveLength(2);
    expect(r.sent[1]!.subject).toContain("B");
  });

  it("two mails of one account are at least ten minutes apart", async () => {
    const old = T0 - 3 * 24 * H;
    user({ levels: [fx.level({ id: "k1", name: "A", alerts: { ...fx.ALERT_ON } }, old), fx.level({ id: "k2", name: "B", symbol: "ETHUSDT", tf: "1h", price: 50, alerts: { ...fx.ALERT_ON } }, old)] });
    // 10:05: seed. 12:05 Berlin (11:05 UTC): ETH 1h candle of 10:00 closed above → mail 1; 4 min later BTC too → gap
    const eth = [40, 41, 42, 43, 44];
    await run(Date.UTC(2026, 9, 26, 9, 5), (x) => {
      fx.setSeries(x, "BTCUSDT", "4h", [95, 96, 97, 98, 99]);
      fx.setSeries(x, "ETHUSDT", "1h", eth);
    });
    const t = Date.UTC(2026, 9, 26, 12, 1); // BTC 4h: the 08:00 candle closed at 12:00
    await run(t, (x) => {
      fx.setSeries(x, "BTCUSDT", "4h", [95, 96, 97, 98, 99, 99, 99]); // not beyond yet
      fx.setSeries(x, "ETHUSDT", "1h", [...eth, 45, 46, 47, 55, 56]); // the 11:00 candle closed at 55
    });
    expect(r.sent).toHaveLength(1);
    const res = await run(t + 5 * MIN, (x) => fx.setSeries(x, "BTCUSDT", "4h", [95, 96, 97, 98, 99, 104, 105]));
    expect(res).toMatchObject({ fires: 1, mails: 0, waiting: 1 });
    expect(r.sent).toHaveLength(1);
    const later = await run(t + 11 * MIN, (x) => fx.setSeries(x, "BTCUSDT", "4h", [95, 96, 97, 98, 99, 104, 105]));
    expect(later.mails).toBe(1);
    expect(r.sent).toHaveLength(2);
  });

  it("the cooldown of the alert settings folds a quick repeat of the same level and stage into the next mail", async () => {
    const old = T0 - 3 * 24 * H;
    user({
      levels: [fx.level({ id: "k1", name: "A", alerts: { ...fx.ALERT_ON, recurring: true } }, old)],
      alerts: { ...DEFAULT_ALERT_SETTINGS, cooldownMin: 24 * 60 },
    });
    await run(T0, btc4h(95, 96, 97, 98, 99));
    await run(T0 + 4 * H, btc4h(95, 96, 97, 98, 99, 104, 105)); // fires, mailed
    // price goes away (closes back under), then beyond again: a new cycle, same level + stage inside the cooldown
    await run(T0 + 8 * H, btc4h(95, 96, 97, 98, 99, 104, 96, 97));
    await run(T0 + 12 * H, btc4h(95, 96, 97, 98, 99, 104, 96, 97, 98, 99));
    const res = await run(T0 + 16 * H, btc4h(95, 96, 97, 98, 99, 104, 96, 97, 98, 99, 110, 111));
    expect(res.fires).toBe(1);
    expect(res.mails).toBe(0);
    expect(r.sent).toHaveLength(1);
    expect(sa().notes.suppressed).toBe(1);
  });
});

describe("e-mail alarm: exactly once, even when something fails", () => {
  it("a lost write after the mail is re-read once: the mailed item leaves the outbox, the day counts", async () => {
    user();
    await run(T0, btc4h(95, 96, 97, 98, 99));
    const T1 = T0 + 4 * H;
    const base = fx.db.writes;
    fx.db.beforeWrite = (uid, n) => {
      if (n === base + 2) fx.db.rows.get(uid)!.rev += 1; // write 2 (after the mail): somebody else wrote, our rev is stale
    };
    await run(T1, btc4h(95, 96, 97, 98, 99, 104, 105));
    fx.db.beforeWrite = null;
    expect(r.sent).toHaveLength(1);
    expect(sa().outbox).toHaveLength(0);
    expect(sa().mails.n).toBe(1);
    await run(T1 + 5 * MIN, btc4h(95, 96, 97, 98, 99, 104, 105));
    expect(r.sent).toHaveLength(1);
  });

  it("when that write is lost twice, the next run sends the same items under the same key – Resend answers the first result", async () => {
    user();
    await run(T0, btc4h(95, 96, 97, 98, 99));
    const T1 = T0 + 4 * H;
    const base = fx.db.writes;
    fx.db.beforeWrite = (uid, n) => {
      if (n === base + 2 || n === base + 3) fx.db.rows.get(uid)!.rev += 1;
    };
    await run(T1, btc4h(95, 96, 97, 98, 99, 104, 105));
    fx.db.beforeWrite = null;
    expect(r.sent).toHaveLength(1);
    expect(sa().outbox).toHaveLength(1); // still waiting: the mark "mailed" was lost
    const res = await run(T1 + 5 * MIN, btc4h(95, 96, 97, 98, 99, 104, 105));
    expect(res.mails).toBe(1); // the run believes it sent it …
    expect(r.requests).toBe(2); // … but the second request carried the same Idempotency-Key
    expect(r.sent).toHaveLength(1); // so no second mail exists
    expect(r.keys.size).toBe(1);
    expect(sa().outbox).toHaveLength(0);
  });

  it("the mail goes out only after the state was written; a lost first write mails nothing and loses nothing", async () => {
    user();
    await run(T0, btc4h(95, 96, 97, 98, 99));
    const T1 = T0 + 4 * H;
    const base = fx.db.writes;
    // both the first attempt and the retry lose the race → the account is skipped this run
    fx.db.beforeWrite = (uid, n) => {
      if (n === base + 1 || n === base + 2) fx.db.rows.get(uid)!.rev += 1;
    };
    const res = await run(T1, btc4h(95, 96, 97, 98, 99, 104, 105));
    fx.db.beforeWrite = null;
    expect(r.requests).toBe(0);
    expect(res.mails).toBe(0);
    // the next run still sees the same close and announces it (nothing was marked as fired)
    const next = await run(T1 + 5 * MIN, btc4h(95, 96, 97, 98, 99, 104, 105));
    expect(next.mails).toBe(1);
    expect(r.sent).toHaveLength(1);
  });

  it("one lost race is re-read once and then succeeds (same candles)", async () => {
    user();
    await run(T0, btc4h(95, 96, 97, 98, 99));
    const base = fx.db.writes;
    fx.db.beforeWrite = (uid, n) => {
      if (n === base + 1) fx.db.rows.get(uid)!.rev += 1;
    };
    const res = await run(T0 + 4 * H, btc4h(95, 96, 97, 98, 99, 104, 105));
    fx.db.beforeWrite = null;
    expect(res.mails).toBe(1);
    expect(r.sent).toHaveLength(1);
    expect(fx.db.rpcCalls.filter((c) => c.name === "alert_watch_candidates" && c.user === U)).toHaveLength(1);
  });

  it("a failed send keeps the item in the outbox, backs off and retries later", async () => {
    user();
    await run(T0, btc4h(95, 96, 97, 98, 99));
    const T1 = T0 + 4 * H;
    r.failWith = [403];
    const res = await run(T1, btc4h(95, 96, 97, 98, 99, 104, 105));
    expect(res).toMatchObject({ mails: 0, failed: 1 });
    expect(sa().outbox).toHaveLength(1);
    expect(sa().fail).toMatchObject({ n: 1, code: "resend_auth" });
    // inside the 30-minute back-off nothing is tried
    const requests = r.requests;
    await run(T1 + 10 * MIN, btc4h(95, 96, 97, 98, 99, 104, 105));
    expect(r.requests).toBe(requests);
    // after it, the mail goes out and the failure is forgotten
    const ok = await run(T1 + 31 * MIN, btc4h(95, 96, 97, 98, 99, 104, 105));
    expect(ok.mails).toBe(1);
    expect(sa().fail).toBeNull();
    expect(sa().outbox).toHaveLength(0);
  });

  it("an address that is not confirmed is never mailed", async () => {
    user({ confirmed: false });
    await run(T0, btc4h(95, 96, 97, 98, 99));
    const res = await run(T0 + 4 * H, btc4h(95, 96, 97, 98, 99, 104, 105));
    expect(res.mails).toBe(0);
    expect(r.requests).toBe(0);
    expect(sa().fail?.code).toBe("email_unconfirmed");
  });
});

describe("e-mail alarm: gates, caps and honest failures", () => {
  it("does nothing without RESEND_API_KEY / ALERT_FROM (no query, no request)", async () => {
    user();
    delete process.env.RESEND_API_KEY;
    const res = await run(T0, btc4h(95, 96, 97, 98, 99));
    expect(res).toMatchObject({ enabled: false, reason: "not_configured" });
    expect(fx.db.rpcCalls).toHaveLength(0);
    expect(b.calls).toHaveLength(0);
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.ALERT_FROM = "not an address";
    expect((await run(T0)).enabled).toBe(false);
  });

  it("no account with the switch on → one query, nothing else, no heartbeat", async () => {
    fx.putUser(U, { data: { serverAlerts: { v: 1, email: false } } });
    const res = await run(T0);
    expect(res).toMatchObject({ accounts: 0, watched: 0 });
    expect(fx.db.rpcCalls).toHaveLength(1);
    expect(b.calls).toHaveLength(0);
    expect(fx.db.config.size).toBe(0);
  });

  it("the plan gate: with payments on, an account without the feature is left alone", async () => {
    plan.payments = true;
    user({ plan: "free" });
    user({ id: "payer", plan: "pro" });
    await run(T0, btc4h(95, 96, 97, 98, 99));
    const res = await run(T0 + 4 * H, btc4h(95, 96, 97, 98, 99, 104, 105));
    expect(res.gated).toBe(1);
    expect(r.sent.map((m) => m.to[0])).toEqual(["payer@example.test"]);
    expect(Object.keys(sa(U).mem)).toHaveLength(0);
  });

  it("one price request for all symbols, one candle request per symbol and feed – not per level or account", async () => {
    const old = T0 - 3 * 24 * H;
    const lv = (id: string) => fx.level({ id, alerts: { ...fx.ALERT_ON } }, old);
    user({ levels: [lv("a"), lv("b"), lv("c")] });
    user({ id: "second", levels: [lv("d")] });
    await run(T0, btc4h(95, 96, 97, 98, 99));
    expect(b.calls.filter((c) => c.includes("ticker/price"))).toHaveLength(1);
    expect(b.calls.filter((c) => c.includes("klines"))).toHaveLength(1);
    expect(b.calls.find((c) => c.includes("klines"))).toContain("limit=");
  });

  it("caps the symbols per run: an account that does not fit waits for a later run", async () => {
    const old = T0 - 3 * 24 * H;
    for (let i = 0; i < 33; i++) {
      const sym = `COIN${String(i).padStart(2, "0")}USDT`;
      user({ id: `u${String(i).padStart(2, "0")}`, levels: [fx.level({ id: "k", symbol: sym, alerts: { ...fx.ALERT_ON } }, old)] });
      fx.setSeries(b, sym, "4h", [95, 96, 97, 98, 99]);
    }
    const res = await run(T0);
    expect(res.symbols).toBe(30);
    expect(res.watched).toBe(30);
    expect(res.deferred).toBe(3);
  });

  it("a symbol Binance does not know is named, not requested, and never alerts", async () => {
    user({ levels: [fx.level({ id: "k1", symbol: "NOPEUSDT", alerts: { ...fx.ALERT_ON } }, T0 - 3 * 24 * H)] });
    fx.setSeries(b, "BTCUSDT", "4h", [95, 96]);
    const res = await run(T0);
    expect(res.mails).toBe(0);
    expect(b.calls.some((c) => c.includes("symbol=NOPEUSDT"))).toBe(false);
    expect(sa().problems).toEqual([{ id: "k1", code: "symbol" }]);
  });

  it("falls back to the app's own proxy when Binance answers 451 and says so in the mail", async () => {
    user();
    await run(T0, btc4h(95, 96, 97, 98, 99));
    b.block.set("fapi.binance.com", 451);
    const res = await run(T0 + 4 * H, btc4h(95, 96, 97, 98, 99, 104, 105));
    expect(res).toMatchObject({ mails: 1, source: "proxy", code: null });
    expect(b.calls.some((c) => c.startsWith("journal.example.test/api/binance/fapi/v1/klines"))).toBe(true);
    expect(r.sent[0]!.text).toContain("über den Proxy der App");
  });

  it("both doors blocked: nothing is evaluated or changed, the heartbeat says binance_451", async () => {
    user();
    await run(T0, btc4h(95, 96, 97, 98, 99));
    const writes = fx.db.writes;
    b.block.set("fapi.binance.com", 451);
    b.block.set("journal.example.test", 451);
    const res = await run(T0 + 4 * H, btc4h(95, 96, 97, 98, 99, 104, 105));
    expect(res).toMatchObject({ mails: 0, code: "binance_451" });
    expect(fx.db.writes).toBe(writes);
    expect(fx.db.config.get("alert-watch")).toMatchObject({ ok: false, code: "binance_451" });
  });

  it("missing migration 0008 is reported as such (heartbeat), not as a crash", async () => {
    user();
    fx.db.migration = false;
    const res = await run(T0);
    expect(res.code).toBe("migration");
    expect(fx.db.config.get("alert-watch")).toMatchObject({ ok: false, code: "migration" });
  });

  it("the heartbeat carries counts and codes only", async () => {
    user();
    await run(T0, btc4h(95, 96, 97, 98, 99));
    expect(fx.db.config.get("alert-watch")).toEqual({ at: T0, ok: true, code: null, accounts: 1, symbols: 1, mails: 0, source: "binance" });
  });

  it("never writes the address into a log line, an error or the summary", async () => {
    user();
    r.failWith = [422];
    await run(T0, btc4h(95, 96, 97, 98, 99));
    const res = await run(T0 + 4 * H, btc4h(95, 96, 97, 98, 99, 104, 105));
    expect(JSON.stringify(res)).not.toContain(MAIL);
    expect(logs.join("\n")).not.toContain(MAIL);
    expect(logs.join("\n")).not.toContain("re_test_key");
    expect(JSON.stringify([...fx.db.config.values()])).not.toContain(MAIL);
    expect(JSON.stringify(row().data)).not.toContain(MAIL);
  });
});
