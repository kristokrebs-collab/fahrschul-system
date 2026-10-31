// @vitest-environment node
/// <reference types="node" />
/**
 * The industry-data client: cache first (fresh for 12 h), a failed refresh with a copy on the device is a labelled copy (`stale`), a failure
 * without one is `unavailable` with its reason in German – and the unpacking refuses anything that does not add up.
 */
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { packIndustries, type ParsedIndustries } from "../../netlify/functions/_lib/industry/load";
import { ApiError, FUNCTIONS_MISSING } from "@/cloud/api";
import { memoryKV } from "@/market/cache";
import { DecodeError, INDUSTRY_AGES, INDUSTRY_CACHE_KEY, createIndustryData, decodeIndustry, industryFailFrom, industryPayloadOk, INDUSTRY_ENCODING, INDUSTRY_REASON_TEXT, type IndustryDailyPayload } from "@/market/industry";

const gunzip = async (b: Uint8Array): Promise<Uint8Array> => new Uint8Array(gunzipSync(b));
const T = 5200;
const names = Array.from({ length: 48 }, (_, i) => `N${i}`);

function parsed(): ParsedIndustries {
  const dates = Int32Array.from({ length: T }, (_, t) => 19900101 + t);
  const returns = Int16Array.from({ length: names.length * T }, (_, k) => ((k * 31) % 401) - 200);
  returns[0] = -32768;
  return { names, dates, returns, database: "202609" };
}
function payload(over: Partial<IndustryDailyPayload> = {}): IndustryDailyPayload {
  const p = parsed();
  const packed = packIndustries(p);
  return { source: "ken-french", fetchedAt: 1_000, fileTime: 500, cached: false, database: "202609", names, days: T, firstDay: 19900101, lastDay: 19900101 + T - 1, encoding: INDUSTRY_ENCODING, bytes: packed.bytes, data: packed.data, ...over };
}

describe("Auspacken", () => {
  it("Tage und Renditen kommen genau so heraus, wie sie hineingingen (auch der fehlende Wert)", async () => {
    const d = await decodeIndustry(payload(), gunzip);
    const p = parsed();
    expect(d.names).toEqual(names);
    expect(Array.from(d.dates.slice(0, 3))).toEqual([19900101, 19900102, 19900103]);
    expect(d.returns[0]).toBe(-32768);
    expect(Array.from(d.returns.slice(1, 10))).toEqual(Array.from(p.returns.slice(1, 10)));
    expect(d.returns).toHaveLength(48 * T);
    expect(d.returns[48 * T - 1]).toBe(p.returns[48 * T - 1]);
  });

  it("verweigert falsche Größen, falsche Randtage und kaputte Kodierung – nichts wird halb benutzt", async () => {
    await expect(decodeIndustry(payload({ bytes: 10 }), gunzip)).rejects.toThrow(/Größe/);
    await expect(decodeIndustry(payload({ firstDay: 19800101 }), gunzip)).rejects.toThrow(/Erster und letzter Tag/);
    await expect(decodeIndustry(payload({ data: "***" }), gunzip)).rejects.toThrow(DecodeError);
    await expect(decodeIndustry(payload({ data: "AAAA" }), gunzip)).rejects.toThrow(/entpacken/);
    await expect(decodeIndustry(payload(), async () => { throw new Error("x"); })).rejects.toThrow(/entpacken/);
  });
});

describe("Prüfung der Antwort", () => {
  it("nimmt die gute, lehnt fehlende Felder, falsche Längen und fremde Quellen ab", () => {
    const ok = payload();
    expect(industryPayloadOk(ok)).toBe(true);
    for (const bad of [{ ...ok, source: "other" }, { ...ok, days: 10 }, { ...ok, bytes: ok.bytes + 1 }, { ...ok, names: ["a b"] }, { ...ok, data: "" }, { ...ok, encoding: "zip" }, null, "text", [], { ...ok, lastDay: ok.firstDay }]) expect(industryPayloadOk(bad)).toBe(false);
  });
});

describe("Laden und Zwischenspeicher", () => {
  const mk = (api: ReturnType<typeof vi.fn>, clock: { t: number }, kv = memoryKV()) => ({ client: createIndustryData({ api: api as never, now: () => clock.t, kv, gunzip, online: () => true }), kv });

  it("holt die Daten einmal, danach kommen sie 12 Stunden aus dem Speicher des Geräts", async () => {
    const api = vi.fn(async () => payload());
    const clock = { t: 10_000 };
    const { client, kv } = mk(api, clock);
    const a = await client.load();
    expect(a.status).toBe("ok");
    if (a.status !== "ok") return;
    expect(a).toMatchObject({ source: "ken-french", asOf: 19900101 + T - 1, database: "202609", fetchedAt: 1_000, fileTime: 500, receivedAt: 10_000 });
    expect(api).toHaveBeenCalledWith("/industry/daily", {});
    expect(await kv.get(INDUSTRY_CACHE_KEY)).toBeTruthy();
    clock.t += INDUSTRY_AGES.ttl - 1;
    expect((await client.load()).status).toBe("ok");
    expect(api).toHaveBeenCalledTimes(1);
    clock.t += 2;
    await client.load();
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("„neu laden“ fragt trotz frischer Kopie nach", async () => {
    const api = vi.fn(async () => payload());
    const { client } = mk(api, { t: 0 });
    await client.load();
    await client.load({ fresh: true });
    expect(api).toHaveBeenCalledTimes(2);
    expect((api.mock.calls[1] as unknown as [string, object])[1]).toMatchObject({ cache: "no-cache" });
  });

  it("zwei gleichzeitige Aufrufe teilen eine Anfrage", async () => {
    const api = vi.fn(async () => payload());
    const { client } = mk(api, { t: 0 });
    await Promise.all([client.load(), client.load()]);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("Ausfall mit Kopie auf dem Gerät: die Kopie, ausdrücklich als solche, mit Grund und eigenem Stand", async () => {
    const api = vi.fn(async () => payload());
    const clock = { t: 0 };
    const { client } = mk(api, clock);
    await client.load();
    api.mockImplementation(async () => {
      throw new ApiError(502, "industry_upstream", "Die Ken-French-Datenbibliothek ist gerade nicht erreichbar.");
    });
    clock.t += INDUSTRY_AGES.ttl + 5;
    const r = await client.load();
    expect(r.status).toBe("stale");
    if (r.status !== "stale") return;
    expect(r.reason).toBe("upstream");
    expect(r.message).toContain("nicht erreichbar");
    expect(r.asOf).toBe(19900101 + T - 1);
    expect(r.failedAt).toBe(clock.t);
    expect(r.data.dates).toHaveLength(T);
  });

  it("eine Kopie, die älter als 400 Tage ist, wird nicht mehr als Ersatz gezeigt", async () => {
    const api = vi.fn(async () => payload());
    const clock = { t: 0 };
    const { client } = mk(api, clock);
    await client.load();
    api.mockImplementation(async () => {
      throw new ApiError(0, "unavailable", "weg");
    });
    clock.t += INDUSTRY_AGES.maxStale + 1;
    expect((await client.load()).status).toBe("unavailable");
  });

  it("der Server selbst schickt seine ältere Kopie (stale:true): als Kopie gezeigt und nicht als frisch gespeichert", async () => {
    const api = vi.fn(async () => payload({ stale: true, cached: true }));
    const { client, kv } = mk(api, { t: 0 });
    const r = await client.load();
    expect(r.status).toBe("stale");
    expect(await kv.get(INDUSTRY_CACHE_KEY)).toBeUndefined();
  });

  it("ohne Kopie und ohne Server: unavailable mit dem Grund in Worten", async () => {
    const api = vi.fn(async () => {
      throw new ApiError(0, "unavailable", FUNCTIONS_MISSING);
    });
    const r = await mk(api, { t: 0 }).client.load();
    expect(r).toMatchObject({ status: "unavailable", reason: "no-server" });
    expect(r.status === "unavailable" && r.message).toBe(INDUSTRY_REASON_TEXT["no-server"]);
  });

  it("eine unbrauchbare Antwort: bad-response, nicht halbe Daten", async () => {
    const api = vi.fn(async () => ({ source: "ken-french", names: [] }));
    expect(await mk(api, { t: 0 }).client.load()).toMatchObject({ status: "unavailable", reason: "bad-response" });
    const api2 = vi.fn(async () => payload({ firstDay: 19800101 }));
    expect(await mk(api2, { t: 0 }).client.load()).toMatchObject({ status: "unavailable", reason: "bad-response" });
  });

  it("ein Abbruch ist kein Fehler und kein Ersatz durch die Kopie", async () => {
    const api = vi.fn(async () => payload());
    const clock = { t: 0 };
    const { client } = mk(api, clock);
    await client.load();
    api.mockImplementation(async () => {
      throw Object.assign(new Error("a"), { name: "AbortError" });
    });
    clock.t += INDUSTRY_AGES.ttl + 1;
    expect(await client.load({ fresh: true })).toMatchObject({ status: "unavailable", reason: "aborted" });
  });

  it("clear() räumt Speicher und Gerät", async () => {
    const api = vi.fn(async () => payload());
    const { client, kv } = mk(api, { t: 0 });
    await client.load();
    await client.clear();
    expect(await kv.get(INDUSTRY_CACHE_KEY)).toBeUndefined();
  });
});

describe("Gründe in Worten", () => {
  const f = (e: unknown, online = true) => industryFailFrom(e, () => online);
  it("ordnet die Fehler des Servers zu", () => {
    expect(f(new ApiError(401, "unauthenticated", "Bitte anmelden."))).toMatchObject({ reason: "login" });
    expect(f(new ApiError(402, "plan_required", "Tarif."))).toMatchObject({ reason: "plan" });
    expect(f(new ApiError(502, "industry_format", "Aufbau."))).toMatchObject({ reason: "format" });
    expect(f(new ApiError(504, "industry_timeout", "Zeit."))).toMatchObject({ reason: "timeout" });
    expect(f(new ApiError(429, "rate_limited", "Zu viele."))).toMatchObject({ reason: "rate-limited" });
    expect(f(new ApiError(404, "not_found", "x"))).toMatchObject({ reason: "no-server" });
    expect(f(new ApiError(0, "unavailable", "Netz"), true)).toMatchObject({ reason: "network" });
    expect(f(new ApiError(0, "unavailable", "Netz"), false)).toMatchObject({ reason: "offline" });
    expect(f(new ApiError(0, "unavailable", "In der Offline-Datei gibt es keine Server-Funktionen."))).toMatchObject({ reason: "no-server" });
  });
});
