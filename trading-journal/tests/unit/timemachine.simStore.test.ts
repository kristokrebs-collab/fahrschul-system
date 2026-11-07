/**
 * A3: the store of saved simulations on a real IndexedDB (fake-indexeddb): a save, a "reload" (a second store on the same database),
 * the simulation of a trade, the same simulation twice, the limits, the cloud only while allowed (a fake remote and a fake Supabase
 * client – nothing real is called), a failed upload that is retried, the pull of records another device made, and the sign-in gate.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runTimeMachineSync } from "@/domain/timemachine";
import { buildRecord, toRow, type SimulationRecord } from "@/domain/timemachine/record";
import { useSyncGate } from "@/cloud/runtime";
import { setPrivacy } from "@/cloud/privacy";
import { SIGNED_OUT, useCloudSession } from "@/cloud/session";
import { createSimulationStore, idbSimStorage, KEEP_FREE, memorySimStorage, type SimCloud, type SimulationRemote } from "@/views/timemachine/simStore";
import { createSupabaseSimulations } from "@/views/timemachine/simCloud";
import { canSyncSimulations } from "@/views/timemachine/simulations";
import { input, latticePlan } from "./timemachine.helpers";

const make = (over: Parameters<typeof input>[0] = {}, meta: Parameters<typeof buildRecord>[2] = {}): SimulationRecord => {
  const inp = input({ runs: 200, horizon: 40, plan: latticePlan(4, 8), ...over });
  return buildRecord(inp, runTimeMachineSync(inp), { now: 1_760_000_000_000, ...meta });
};

beforeEach(() => {
  // a fresh database per test
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

describe("IndexedDB: dieselbe Simulation nach einem Neustart", () => {
  it("speichert, und ein zweiter Store auf derselben Datenbank (= Reload) liefert dieselbe Simulation zum Trade", async () => {
    const a = createSimulationStore(idbSimStorage("tj2-test-tm")!);
    expect(a.persistent).toBe(true);
    const rec = make({}, { tradeId: "t_42" });
    const saved = await a.save(rec);
    expect(saved).toMatchObject({ ok: true, persistent: true });

    const b = createSimulationStore(idbSimStorage("tj2-test-tm")!); // "nach dem Neustart"
    const back = await b.forTrade("t_42");
    expect(back).not.toBeNull();
    expect(back!.simulationId).toBe(rec.simulationId);
    expect(back!.resultHash).toBe(rec.resultHash);
    expect(back!.dataHash).toBe(rec.dataHash);
    expect(back!.seed).toBe(19);
    expect(back!.metrics).toEqual(rec.metrics);
    expect(back!.result?.sim.target.k).toBe(rec.result!.sim.target.k);
    expect(await b.get(rec.simulationId)).not.toBeNull();
    expect(await b.forTrade("t_other")).toBeNull();
  });

  it("dieselbe Simulation noch einmal: ein Eintrag, die erste Zeit bleibt, der Trade-Bezug bleibt", async () => {
    const s = createSimulationStore(idbSimStorage("tj2-test-tm2")!);
    const first = make({}, { tradeId: "t_1", now: 1_700_000_000_000 });
    await s.save(first);
    const again = make({}, { tradeId: "t_1", now: 1_800_000_000_000 });
    expect(again.simulationId).toBe(first.simulationId);
    await s.save(again);
    const all = await s.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.createdAt).toBe(first.createdAt);
  });

  it("der neueste Eintrag eines Trades gewinnt; eine andere Annahme ist eine andere Simulation", async () => {
    const s = createSimulationStore(idbSimStorage("tj2-test-tm3")!);
    const old = make({ plan: latticePlan(4, 8) }, { tradeId: "t_1", now: 1_700_000_000_000 });
    const neu = make({ plan: latticePlan(4, 12) }, { tradeId: "t_1", now: 1_800_000_000_000 });
    expect(neu.simulationId).not.toBe(old.simulationId);
    await s.save(old);
    await s.save(neu);
    expect((await s.forTrade("t_1"))!.simulationId).toBe(neu.simulationId);
    expect(await s.list()).toHaveLength(2);
  });

  it("freie Simulationen sind begrenzt (die ältesten gehen zuerst), die eines Trades bleiben immer", async () => {
    const s = createSimulationStore(memorySimStorage());
    const base = make({}, { tradeId: "t_keep", now: 1_000 });
    await s.save(base);
    // distinct free simulations: a different seed each (cheap records: reuse the figures, change the id through the seed)
    const inp = input({ runs: 100, horizon: 20, plan: latticePlan(4, 8) });
    const res = runTimeMachineSync(inp);
    for (let i = 0; i < KEEP_FREE + 5; i++) {
      const r = buildRecord({ ...inp, seed: 1000 + i }, res, { now: 2_000 + i });
      await s.save(r);
    }
    const all = await s.list();
    expect(all.filter((r) => !r.tradeId)).toHaveLength(KEEP_FREE);
    expect(all.find((r) => r.tradeId === "t_keep")).toBeDefined();
    // the newest free ones are the ones kept
    expect(all.some((r) => r.createdAt === new Date(2_000).toISOString())).toBe(false);
    expect(all.some((r) => r.createdAt === new Date(2_000 + KEEP_FREE + 4).toISOString())).toBe(true);
  });

  it("ohne IndexedDB lebt alles im Speicher und sagt es (persistent: false)", async () => {
    const s = createSimulationStore(memorySimStorage());
    expect(s.persistent).toBe(false);
    const r = await s.save(make({}, { tradeId: "t_m" }));
    expect(r).toMatchObject({ ok: true, persistent: false });
    expect((await s.forTrade("t_m"))?.tradeId).toBe("t_m");
  });

  it("ein Speicherfehler (Platz voll) wird gemeldet, nicht verschluckt", async () => {
    const storage = memorySimStorage();
    const s = createSimulationStore({ ...storage, put: () => Promise.reject(new Error("QuotaExceededError: quota")) });
    const r = await s.save(make());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Speicher.*voll/);
  });

  it("benachrichtigt Beobachter bei jeder Änderung (das Trade-Detail liest neu)", async () => {
    const s = createSimulationStore(memorySimStorage());
    const fn = vi.fn();
    const off = s.subscribe(fn);
    const r = make({}, { tradeId: "t_n" });
    await s.save(r);
    expect(fn).toHaveBeenCalled();
    fn.mockClear();
    await s.remove(r.simulationId);
    expect(fn).toHaveBeenCalled();
    expect(await s.forTrade("t_n")).toBeNull();
    off();
    fn.mockClear();
    await s.save(make());
    expect(fn).not.toHaveBeenCalled();
  });
});

/** A remote that remembers what it was given (the table of one user). */
function fakeCloud(allowed: { on: boolean }, opts: { failUpsert?: { n: number } } = {}) {
  const rows = new Map<string, SimulationRecord>();
  const calls = { upsert: 0, pull: 0, remove: 0 };
  const remote: SimulationRemote = {
    async upsert(records) {
      calls.upsert++;
      if (opts.failUpsert && opts.failUpsert.n > 0) {
        opts.failUpsert.n--;
        throw new Error("offline");
      }
      for (const r of records) rows.set(r.simulationId, { ...r, result: null });
    },
    async pull() {
      calls.pull++;
      return [...rows.values()];
    },
    async remove(id) {
      calls.remove++;
      rows.delete(id);
    },
  };
  const cloud: SimCloud = { allowed: () => allowed.on, remote: async () => remote };
  return { cloud, rows, calls };
}

describe("Wolke: nur eingeloggt", () => {
  it("nicht erlaubt (ausgeloggt): kein Aufruf, der Datensatz bleibt „local“", async () => {
    const gate = { on: false };
    const f = fakeCloud(gate);
    const s = createSimulationStore(memorySimStorage(), f.cloud);
    const r = await s.save(make());
    expect(r.ok && r.record.sync).toBe("local");
    expect(f.calls).toEqual({ upsert: 0, pull: 0, remove: 0 });
    expect(await s.flush()).toBe(0);
    expect(await s.pull()).toBe(0);
    expect(f.calls.upsert + f.calls.pull).toBe(0);
  });

  it("erlaubt: die Zeile geht hoch (ohne Ergebnis), der Datensatz wird „synced“", async () => {
    const f = fakeCloud({ on: true });
    const s = createSimulationStore(memorySimStorage(), f.cloud);
    const rec = make({}, { tradeId: "t_c" });
    const r = await s.save(rec);
    expect(r.ok && r.record.sync).toBe("synced");
    expect(f.rows.has(rec.simulationId)).toBe(true);
    expect(f.rows.get(rec.simulationId)!.result).toBeNull();
    expect((await s.forTrade("t_c"))!.sync).toBe("synced");
    // the local copy keeps the whole result
    expect((await s.forTrade("t_c"))!.result).not.toBeNull();
  });

  it("ein Fehler beim Hochladen lässt „pending“ stehen; der nächste Abgleich holt es nach", async () => {
    const gate = { on: true };
    const failUpsert = { n: 1 };
    const f = fakeCloud(gate, { failUpsert });
    const s = createSimulationStore(memorySimStorage(), f.cloud);
    const rec = make({}, { tradeId: "t_p" });
    const r = await s.save(rec);
    expect(r.ok && r.record.sync).toBe("pending");
    expect(f.rows.size).toBe(0);
    expect((await s.forTrade("t_p"))!.sync).toBe("pending");
    expect(await s.flush()).toBe(1);
    expect(f.rows.size).toBe(1);
    expect((await s.forTrade("t_p"))!.sync).toBe("synced");
    // nothing left to send
    expect(await s.flush()).toBe(0);
  });

  it("die Anmeldung kommt später: was lokal liegt, geht beim Abgleich hoch", async () => {
    const gate = { on: false };
    const f = fakeCloud(gate);
    const s = createSimulationStore(memorySimStorage(), f.cloud);
    await s.save(make({}, { tradeId: "t_late" }));
    expect(f.rows.size).toBe(0);
    gate.on = true;
    expect(await s.flush()).toBe(1);
    expect(f.rows.size).toBe(1);
  });

  it("pull: Simulationen von einem anderen Gerät kommen als Kennzahlen (ohne Ergebnis), vorhandene bleiben unberührt", async () => {
    const f = fakeCloud({ on: true });
    const other = make({}, { tradeId: "t_other" });
    f.rows.set(other.simulationId, { ...other, result: null, sync: "synced" });
    const s = createSimulationStore(memorySimStorage(), f.cloud);
    const mine = make({ seed: 77 }, { tradeId: "t_mine" });
    await s.save(mine);
    expect(await s.pull()).toBe(1);
    const got = await s.forTrade("t_other");
    expect(got).not.toBeNull();
    expect(got!.result).toBeNull();
    expect(got!.sync).toBe("synced");
    expect((await s.forTrade("t_mine"))!.result).not.toBeNull();
    expect(await s.pull()).toBe(0);
  });

  it("löschen entfernt auch die Zeile in der Wolke (wenn erlaubt)", async () => {
    const f = fakeCloud({ on: true });
    const s = createSimulationStore(memorySimStorage(), f.cloud);
    const rec = make();
    await s.save(rec);
    await s.remove(rec.simulationId);
    expect(f.rows.size).toBe(0);
    expect(f.calls.remove).toBe(1);
    expect(await s.list()).toHaveLength(0);
  });
});

describe("Zugriff auf die Tabelle `simulations` (Supabase-Adapter gegen einen Fake)", () => {
  /** The little part of the PostgREST builder the adapter uses. */
  function fakeClient(stored: unknown[] = []) {
    const log: { op: string; table: string; payload?: unknown; opts?: unknown; filters: [string, unknown][] }[] = [];
    const builder = (table: string) => {
      const entry = { op: "", table, filters: [] as [string, unknown][] } as (typeof log)[number];
      log.push(entry);
      const b = {
        upsert: (payload: unknown, opts: unknown) => {
          entry.op = "upsert";
          entry.payload = payload;
          entry.opts = opts;
          return Promise.resolve({ error: null });
        },
        select: (_cols: string) => {
          entry.op = "select";
          return b;
        },
        delete: () => {
          entry.op = "delete";
          return b;
        },
        eq: (c: string, v: unknown) => {
          entry.filters.push([c, v]);
          return b;
        },
        order: () => b,
        // a delete is awaited after its last `.eq`
        then: (res: (v: { error: null }) => unknown) => (entry.op === "delete" ? Promise.resolve({ error: null }).then(res) : undefined),
        range: (a: number, z: number) => Promise.resolve({ data: stored.slice(a, z + 1), error: null }),
      };
      return b;
    };
    return { log, client: { from: builder } as never };
  }

  it("schreibt Zeilen mit user_id und ohne Ergebnis; der Schlüssel ist (user_id, id)", async () => {
    const { log, client } = fakeClient();
    const remote = createSupabaseSimulations(client, "user-1");
    const rec = make({}, { tradeId: "t_r" });
    await remote.upsert([rec]);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ op: "upsert", table: "simulations", opts: { onConflict: "user_id,id" } });
    const rows = log[0]!.payload as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: "user-1", id: rec.simulationId, trade_id: "t_r", seed: 19 });
    expect(rows[0]).not.toHaveProperty("result");
    expect(JSON.stringify(rows[0])).not.toContain('"bands"');
  });

  it("liest nur die eigenen Zeilen (Filter user_id) und macht aus ihnen Datensätze; Kaputtes wird übersprungen", async () => {
    const rec = make({}, { tradeId: "t_r" });
    const { log, client } = fakeClient([{ ...toRow(rec), created_at: "2026-11-01T10:00:00Z" }, { id: "kaputt" }]);
    const got = await createSupabaseSimulations(client, "user-1").pull();
    expect(log[0]!.filters).toContainEqual(["user_id", "user-1"]);
    expect(got).toHaveLength(1);
    expect(got[0]!.simulationId).toBe(rec.simulationId);
    expect(got[0]!.result).toBeNull();
  });

  it("löscht mit beiden Filtern (Nutzer und ID); ein Fehler der Datenbank wird geworfen, nicht verschluckt", async () => {
    const { log, client } = fakeClient();
    await createSupabaseSimulations(client, "user-1").remove("sim_abc");
    expect(log[0]).toMatchObject({ op: "delete", table: "simulations" });
    expect(log[0]!.filters).toEqual([
      ["user_id", "user-1"],
      ["id", "sim_abc"],
    ]);
    const failing = { from: () => ({ upsert: () => Promise.resolve({ error: { message: "new row violates row-level security policy", code: "42501" } }) }) } as never;
    await expect(createSupabaseSimulations(failing, "user-1").upsert([make()])).rejects.toThrow(/42501/);
  });
});

describe("Wer in die Wolke schreiben darf", () => {
  const signedIn = { phase: "signedIn" as const, user: { id: "u1", email: "a@b.c", aal: "aal1" as const, mfaEnrolled: false }, needsMfa: false };

  beforeEach(() => {
    useCloudSession.setState({ phase: "off", ...SIGNED_OUT });
    setPrivacy({ sync: true });
    useSyncGate.setState({ entitled: true });
  });

  it("ohne Cloud-Einrichtung nie (in diesem Build ist keine eingerichtet)", () => {
    useCloudSession.setState(signedIn);
    expect(canSyncSimulations()).toBe(false);
  });

  it("mit Cloud: nur angemeldet, mit erledigter 2FA, bei eingeschaltetem Abgleich und passendem Tarif", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    const { canSyncSimulations: can } = await import("@/views/timemachine/simulations");
    const { useCloudSession: session, SIGNED_OUT: out } = await import("@/cloud/session");
    const { useSyncGate: gate } = await import("@/cloud/runtime");
    const { setPrivacy: priv } = await import("@/cloud/privacy");
    session.setState({ phase: "signedOut", ...out });
    expect(can()).toBe(false);
    session.setState(signedIn);
    expect(can()).toBe(true);
    session.setState({ ...signedIn, needsMfa: true });
    expect(can()).toBe(false);
    session.setState(signedIn);
    priv({ sync: false });
    expect(can()).toBe(false);
    priv({ sync: true });
    gate.setState({ entitled: false });
    expect(can()).toBe(false);
    gate.setState({ entitled: true });
    expect(can()).toBe(true);
    vi.unstubAllEnvs();
  });
});
