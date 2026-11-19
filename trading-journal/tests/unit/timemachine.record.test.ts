/**
 * A3: the record of a saved simulation – SHA-256, the hash of the candles, the simulation id, the hash of the figures, reading what
 * was stored, the cloud row (figures and hashes only) and the paths the job hands over. Pure, no storage.
 */
import { describe, expect, it } from "vitest";
import { createTmJob, createTmHost, type TmPaths, type TmResponse, runTimeMachineSync } from "@/domain/timemachine";
import { canon, dataHashOf, Sha256, sha256Hex } from "@/domain/timemachine/hash";
import { buildRecord, fromRow, MODEL_SCOPE, MODEL_VERSION, parseRecord, resultHashOf, sameFigures, simulationIdOf, toRow } from "@/domain/timemachine/record";
import { input, latticeBars, latticePlan } from "./timemachine.helpers";

const small = (over: Parameters<typeof input>[0] = {}) => input({ runs: 300, horizon: 60, plan: latticePlan(4, 8), ...over });

describe("SHA-256", () => {
  it("bekannte Werte (FIPS 180-4)", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("eine Million „a“ in Stücken gibt dasselbe wie am Stück (Pufferränder)", () => {
    const one = new Sha256();
    const chunk = new Uint8Array(1000).fill(0x61);
    for (let i = 0; i < 1000; i++) one.update(chunk);
    expect(one.hex()).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    const odd = new Sha256();
    const all = new Uint8Array(1000 * 1000).fill(0x61);
    for (let i = 0; i < all.length; ) {
      const n = Math.min(all.length - i, 1 + ((i * 7) % 130));
      odd.update(all.subarray(i, i + n));
      i += n;
    }
    expect(odd.hex()).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("canon: gleiche Werte, gleicher Text – egal in welcher Schlüsselreihenfolge", () => {
    expect(canon({ b: 1, a: [2, { d: 4, c: 3 }], u: undefined })).toBe('{"a":[2,{"c":3,"d":4}],"b":1}');
    expect(canon({ a: 1, b: 2 })).toBe(canon({ b: 2, a: 1 }));
  });
});

describe("Daten-Hash", () => {
  it("dieselben Kerzen geben denselben Hash; eine Kerze, eine Zeit oder die Reihenfolge ändern ihn", () => {
    const bars = latticeBars(500, 0.5);
    const h = dataHashOf(bars);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(dataHashOf(bars.map((b) => ({ ...b })))).toBe(h);
    expect(dataHashOf(bars.slice(1))).not.toBe(h);
    expect(dataHashOf([{ ...bars[0]!, c: bars[0]!.c + 1e-9 }, ...bars.slice(1)])).not.toBe(h);
    expect(dataHashOf([{ ...bars[0]!, t: bars[0]!.t + 1 }, ...bars.slice(1)])).not.toBe(h);
    expect(dataHashOf([...bars].reverse())).not.toBe(h);
    // the volume is not part of the hash (the simulation never reads it)
    expect(dataHashOf(bars.map((b) => ({ ...b, v: 5 })))).toBe(h);
  });

  it("über die Blockgrenze von 256 Kerzen hinweg stimmt der Hash mit dem am Stück", () => {
    const bars = latticeBars(1000, 0.5);
    const bytes = new Uint8Array(bars.length * 40);
    const dv = new DataView(bytes.buffer);
    bars.forEach((b, i) => [b.t, b.o, b.h, b.l, b.c].forEach((v, j) => dv.setFloat64(i * 40 + j * 8, v)));
    expect(dataHashOf(bars)).toBe(sha256Hex(bytes));
  });
});

describe("Simulation-ID und Ergebnis-Hash", () => {
  const run = (over: Parameters<typeof input>[0] = {}) => {
    const inp = small(over);
    return { inp, res: runTimeMachineSync(inp) };
  };

  it("gleiche Eingaben → gleiche ID und gleicher Ergebnis-Hash (auch mit neu gebauten Objekten)", () => {
    const a = run();
    const b = run();
    const ra = buildRecord(a.inp, a.res, { now: 1_760_000_000_000 });
    const rb = buildRecord(b.inp, b.res, { now: 1_770_000_000_000 });
    expect(ra.simulationId).toMatch(/^sim_[0-9a-f]{32}$/);
    expect(rb.simulationId).toBe(ra.simulationId);
    expect(rb.resultHash).toBe(ra.resultHash);
    expect(rb.dataHash).toBe(ra.dataHash);
    expect(sameFigures(ra, b.res)).toBe(true);
  });

  it("Seed, Plan, Kosten, Kerzen, Größe, Zeitstopp, Start und Trade ergeben je eine andere ID", () => {
    const base = run();
    const baseId = buildRecord(base.inp, base.res).simulationId;
    const ids = new Set<string>([baseId]);
    const variants: Parameters<typeof input>[0][] = [{ seed: 20 }, { plan: latticePlan(3, 8) }, { runs: 301 }, { horizon: 61 }, { bars: latticeBars(600, 0.52) }, { method: "block" }, { startMs: 1_700_000_000_000 }, { costs: { ...base.inp.costs, slippage: { kind: "fixed", bps: 3 } as never } }];
    for (const v of variants) {
      const r = run(v);
      ids.add(buildRecord(r.inp, r.res).simulationId);
    }
    expect(ids.size).toBe(variants.length + 1);
    // the trade is part of the id: the same inputs for two trades are two simulations
    expect(buildRecord(base.inp, base.res, { tradeId: "t_1" }).simulationId).not.toBe(baseId);
    expect(buildRecord(base.inp, base.res, { tradeId: "t_1" }).simulationId).toBe(buildRecord(base.inp, base.res, { tradeId: "t_1" }).simulationId);
    expect(simulationIdOf(base.inp, dataHashOf(base.inp.bars), null)).toBe(baseId);
  });

  it("der Ergebnis-Hash fängt jede Abweichung der Zahlen (anderer Seed, anderer Plan)", () => {
    const a = run();
    expect(resultHashOf(run({ seed: 21 }).res)).not.toBe(resultHashOf(a.res));
    expect(resultHashOf(run({ plan: latticePlan(2, 8) }).res)).not.toBe(resultHashOf(a.res));
    expect(sameFigures({ resultHash: resultHashOf(a.res) }, run({ seed: 22 }).res)).toBe(false);
  });

  it("Golden: das Modell rechnet für feste Eingaben dieselben Zahlen – ändert sich der Hash, muss MODEL_VERSION steigen", () => {
    const g = run({ seed: 19, runs: 500, horizon: 40, plan: latticePlan(4, 8), bars: latticeBars(600, 0.5) });
    expect(MODEL_VERSION).toBe("zeitmaschine/1");
    // pinned figures of this fixed run (counts are exact integers)
    expect([g.res.sim.target.k, g.res.sim.stop.k, g.res.sim.neither.k]).toEqual(GOLDEN.k);
    expect(resultHashOf(g.res)).toBe(GOLDEN.hash);
  });
});

// Golden values: computed once with MODEL_VERSION "zeitmaschine/1" on the lattice market (seed 19, 500 runs, time stop 40).
const GOLDEN = { k: [107, 280, 113], hash: "618e1fc621d137ef41250e98eecb9336f24f6b75feb3c1971c62e4ab19a03173" };

describe("Ablage lesen und schreiben", () => {
  const rec = () => {
    const inp = small();
    return buildRecord(inp, runTimeMachineSync(inp), { tradeId: "t_x", source: "Testquelle", fetchedAt: 1_760_000_000_000, now: 1_760_000_001_000 });
  };

  it("überlebt JSON (IndexedDB speichert strukturiert, die Wolke JSON) und ist danach gleich", () => {
    const r = rec();
    const back = parseRecord(JSON.parse(JSON.stringify(r)));
    expect(back).toEqual(r);
    expect(back?.result?.seed).toBe(19);
  });

  it("lehnt Unlesbares ab, statt es zu reparieren", () => {
    const r = rec();
    const bad = (patch: Record<string, unknown>) => parseRecord({ ...JSON.parse(JSON.stringify(r)), ...patch });
    expect(parseRecord(null)).toBeNull();
    expect(parseRecord("x")).toBeNull();
    expect(bad({ v: 2 })).toBeNull();
    expect(bad({ simulationId: "sim_zz" })).toBeNull();
    expect(bad({ dataHash: "abc" })).toBeNull();
    expect(bad({ resultHash: 5 })).toBeNull();
    expect(bad({ interval: "3h" })).toBeNull();
    expect(bad({ plan: { side: "up" } })).toBeNull();
    expect(bad({ metrics: { runs: 1 } })).toBeNull();
    expect(bad({ createdAt: "gestern" })).toBeNull();
    expect(bad({ tradeId: "" })).toBeNull();
    // a result that is no result is dropped, the figures stay
    expect(bad({ result: { v: 1 } })?.result).toBeNull();
  });

  it("die Zeile für die Wolke: Zahlen und Hashes, nie die Pfade und nie die Liste der Vorfälle – und innerhalb der Grenzen der Tabelle", () => {
    const r = rec();
    const row = toRow(r);
    const text = JSON.stringify(row);
    expect(row.id).toMatch(/^sim_[0-9a-f]{20,64}$/);
    expect(row.data_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.result_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.trade_id).toBe("t_x");
    expect(row.runs).toBe(300);
    expect(row.horizon).toBe(60);
    expect(row.seed).toBe(19);
    expect(row).not.toHaveProperty("result");
    expect(text).not.toContain('"events"');
    expect(text).not.toContain('"paths"');
    expect(text).not.toContain('"bands"');
    expect(JSON.stringify(row.metrics).length).toBeLessThan(16_000);
    expect(JSON.stringify(row.plan).length).toBeLessThan(2_000);
    expect(JSON.stringify(row.costs).length).toBeLessThan(4_000);
    expect(row.data_to).toBe(new Date(r.dataToMs!).toISOString());
  });

  it("Zeile → Datensatz: ohne Ergebnis, mit denselben Zahlen, als synchronisiert; Unlesbares → null", () => {
    const r = rec();
    const back = fromRow({ ...toRow(r), created_at: "2026-11-01T10:00:00Z" });
    expect(back).not.toBeNull();
    expect(back!.result).toBeNull();
    expect(back!.sync).toBe("synced");
    expect(back!.simulationId).toBe(r.simulationId);
    expect(back!.metrics).toEqual(r.metrics);
    expect(back!.options).toEqual(r.options);
    expect(back!.resultHash).toBe(r.resultHash);
    expect(back!.dataHash).toBe(r.dataHash);
    expect(back!.tradeId).toBe("t_x");
    expect(fromRow({ id: "kaputt" })).toBeNull();
    expect(fromRow(null)).toBeNull();
  });
});

describe("Modellumfang", () => {
  it("nennt ehrlich, was fehlt: Spread, Liquidität, Regime", () => {
    const missing = MODEL_SCOPE.missing.join(" ");
    expect(missing).toMatch(/Spread/);
    expect(missing).toMatch(/Liquidität/);
    expect(missing).toMatch(/regime/i);
    expect(MODEL_SCOPE.note).toMatch(/keine Prognose/);
  });
});

describe("alle Pfade vom Job", () => {
  it("liefert jeden Lauf als Pfad in R: Länge, Ausgang, Ausstiegskerze und Anzahl passen zum Ergebnis", () => {
    const inp = small({ runs: 400, horizon: 50 });
    const job = createTmJob(inp);
    expect(job.paths?.()).toBeNull();
    while (!job.step(performance.now() + 1000)) {
      /* keep stepping */
    }
    const res = job.result()!;
    const p = job.paths!()!;
    expect(p.runs).toBe(400);
    expect(p.computed).toBe(400);
    expect(p.stride).toBe(51);
    expect(p.data.length).toBe(400 * 51);
    expect(p.kind.length).toBe(400);
    expect(p.exit.length).toBe(400);
    let t = 0;
    let s = 0;
    for (let k = 0; k < p.runs; k++) {
      expect(p.data[k * p.stride]).toBe(0);
      if (p.kind[k] === 0) {
        t++;
        expect(p.exit[k]).toBeGreaterThan(0);
        expect(p.exit[k]).toBeLessThanOrEqual(50);
      } else if (p.kind[k] === 1) {
        s++;
        expect(p.exit[k]).toBeGreaterThan(0);
      } else if (p.kind[k] === 2) expect(p.exit[k]).toBe(0);
    }
    expect(t).toBe(res.sim.target.k);
    expect(s).toBe(res.sim.stop.k);
    // the sample paths of the result are the first runs: same numbers (rounded to a thousandth)
    const first = res.sim.fan.paths[0]!;
    for (let i = 0; i <= 50; i++) expect(p.data[i]).toBeCloseTo(first.r[i]!, 2);
  });

  it("der Host reicht die Pfade nur auf Wunsch heraus – als übertragene Puffer", () => {
    const run = (withPaths: boolean) => {
      const out: { m: TmResponse; transfer?: Transferable[] }[] = [];
      let queue: (() => void)[] = [];
      const host = createTmHost({ post: (m, transfer) => out.push({ m, ...(transfer ? { transfer } : {}) }), setTimer: (fn) => queue.push(fn), clearTimer: () => undefined, now: () => performance.now() });
      host.handle({ kind: "run", input: small({ runs: 100, horizon: 30 }), slice: { workMs: 1000, restMs: 0 }, ...(withPaths ? { withPaths: true } : {}) });
      while (queue.length) {
        const q = queue;
        queue = [];
        q.forEach((f) => f());
      }
      return out.find((x) => x.m.kind === "done")!;
    };
    const plain = run(false);
    expect((plain.m as { paths?: TmPaths }).paths).toBeUndefined();
    expect(plain.transfer).toBeUndefined();
    const full = run(true);
    const paths = (full.m as { paths?: TmPaths }).paths;
    expect(paths?.runs).toBe(100);
    expect(full.transfer).toHaveLength(3);
    expect(full.transfer).toContain(paths!.data.buffer);
  });
});
