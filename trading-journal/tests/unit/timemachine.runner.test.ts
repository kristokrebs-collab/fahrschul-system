/**
 * Zeitmaschine · the job, the worker protocol and the runners: phases and progress, the host's messages (run / abort → progress,
 * done, error, aborted) with slices and rests, the worker file itself (a fake `self`), the main-thread runner (same result as the
 * synchronous run, abort), and the fallback when a worker cannot be started.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTmHost,
  createTmJob,
  PROGRESS_MS,
  runTimeMachine,
  runTimeMachineIdle,
  runTimeMachineSync,
  isTmAbort,
  SLICE_DESKTOP,
  SLICE_MOBILE,
  __resetTmRunner,
  type TmInput,
  type TmJob,
  type TmPhase,
  type TmResponse,
  type TmResult,
} from "@/domain/timemachine";
import { input } from "./timemachine.helpers";

const small = (over: Partial<TmInput> = {}): TmInput => input({ runs: 600, horizon: 80, ...over });

describe("Job", () => {
  it("läuft durch die Phasen in fester Reihenfolge, Fortschritt nur aufwärts, am Ende 1", () => {
    const job = createTmJob(small());
    const phases: TmPhase[] = [];
    let last = -1;
    expect(job.phase()).toBe("pool");
    for (let guard = 0; guard < 200_000; guard++) {
      const done = job.step(performance.now() - 1);
      const p = job.progress();
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
      if (phases.at(-1) !== job.phase()) phases.push(job.phase());
      if (done) break;
    }
    expect(phases[0]).toBe("sim");
    expect(phases.slice(-1)).toEqual(["done"]);
    expect(phases.every((p, i) => i === 0 || ["sim", "fan", "history", "summary", "done"].indexOf(p) > ["sim", "fan", "history", "summary", "done"].indexOf(phases[i - 1]!))).toBe(true);
    expect(job.progress()).toBe(1);
    expect(job.result()!.v).toBe(1);
  });

  it("ein ungültiger Plan oder zu wenige Kerzen: der Fehler nennt den Grund, es wird nichts gerechnet", () => {
    expect(() => createTmJob(small({ plan: { side: "long", entry: 100, stop: 101, target: 105 } }))).toThrow(/Stop unter dem Einstieg/);
    expect(() => createTmJob(small({ runs: 5 }))).toThrow(/Sitzungen/);
  });

  it("das Ergebnis ist JSON-sicher (geht durch postMessage) und trägt Seed, Plan, Kerzenzahl und Optionen", () => {
    const r = runTimeMachineSync(small({ seed: 77 }));
    const copy = JSON.parse(JSON.stringify(r)) as TmResult;
    expect(JSON.stringify(copy)).toBe(JSON.stringify(r));
    expect(r.seed).toBe(77);
    expect(r.options.runs).toBe(600);
    expect(r.pool.bars).toBe(600);
    expect(r.plan).toEqual(small().plan);
    expect(r.sim.fan.steps.length).toBe(81);
    expect(r.sim.fan.bands.p50.length).toBe(81);
    for (let k = 0; k <= 80; k++) {
      const b = r.sim.fan.bands;
      expect(b.p5[k]!).toBeLessThanOrEqual(b.p25[k]!);
      expect(b.p25[k]!).toBeLessThanOrEqual(b.p50[k]!);
      expect(b.p50[k]!).toBeLessThanOrEqual(b.p75[k]!);
      expect(b.p75[k]!).toBeLessThanOrEqual(b.p95[k]!);
    }
    expect(r.sim.fan.bands.p5[0]).toBe(0);
    expect(r.sim.fan.bands.p95[0]).toBe(0);
    // die Anteile ergeben 1 und die Histogramm-Zählung alle Läufe
    const s = r.sim;
    expect(s.target.k + s.stop.k + s.neither.k + s.moved.k).toBe(s.runs);
    expect(s.hist.bins.reduce((a, b) => a + b.n, 0)).toBe(s.runs);
    expect(s.fan.paths.length).toBeLessThanOrEqual(36);
    expect(s.cases.worst).toBeLessThanOrEqual(s.cases.p5);
    expect(s.cases.p5).toBeLessThanOrEqual(s.cases.median);
    expect(s.cases.median).toBeLessThanOrEqual(s.cases.p95);
    expect(s.cases.p95).toBeLessThanOrEqual(s.cases.best);
  });
});

/** A scripted job: needs `steps` slices; each slice "works" 10 ms of the fake clock. */
function fakeJob(clock: { t: number }, steps: number, fail = false): TmJob {
  let n = 0;
  return {
    step: () => {
      if (fail) throw new Error("kaputt");
      clock.t += 10;
      n++;
      return n >= steps;
    },
    progress: () => n / steps,
    phase: () => "sim",
    result: () => ({ v: 1, fake: true }) as unknown as TmResult,
  };
}

function setup(steps = 6, fail = false) {
  const clock = { t: 0 };
  const posted: TmResponse[] = [];
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let id = 0;
  const seen: number[] = [];
  const host = createTmHost({
    post: (m) => posted.push(m),
    setTimer: (fn, ms) => {
      const t = { fn, ms, id: ++id };
      timers.push(t);
      return t.id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    now: () => clock.t,
    create: () => {
      const j = fakeJob(clock, steps, fail);
      const step = j.step.bind(j);
      j.step = (deadline: number) => {
        seen.push(deadline - clock.t);
        return step(deadline);
      };
      return j;
    },
  });
  const tick = (): number | null => {
    const t = timers.shift();
    if (!t) return null;
    t.fn();
    return t.ms;
  };
  return { host, posted, timers, clock, tick, seen };
}

describe("Worker-Protokoll (Host)", () => {
  it("run → Scheiben mit Ruhe → Fortschritt (höchstens alle 120 ms) → done mit dem Ergebnis", () => {
    const s = setup(6);
    s.host.handle({ kind: "run", input: small(), slice: SLICE_MOBILE });
    expect(s.host.idle).toBe(false);
    const rests: number[] = [];
    for (let i = 0; i < 20; i++) {
      const ms = s.tick();
      if (ms == null) break;
      rests.push(ms);
    }
    // erster Aufruf sofort, danach die Ruhe der Scheibe
    expect(rests[0]).toBe(0);
    expect(rests.slice(1, 5).every((r) => r === SLICE_MOBILE.restMs)).toBe(true);
    // jede Scheibe bekommt genau ihre Arbeitszeit als Frist
    expect(s.seen.every((d) => d === SLICE_MOBILE.workMs)).toBe(true);
    const kinds = s.posted.map((m) => m.kind);
    expect(kinds.at(-1)).toBe("done");
    expect(kinds.filter((k) => k === "progress").length).toBeGreaterThan(0);
    const progressTimes = s.posted.filter((m) => m.kind === "progress").length;
    // 6 Scheiben à 10 ms = 60 ms < PROGRESS_MS: nur die erste Meldung kommt durch
    expect(60).toBeLessThan(PROGRESS_MS);
    expect(progressTimes).toBe(1);
    expect(s.host.idle).toBe(true);
    expect(s.timers.length).toBe(0);
  });

  it("abort hält an: aborted, nichts mehr eingeplant, spätere Ticks tun nichts", () => {
    const s = setup(50);
    s.host.handle({ kind: "run", input: small(), slice: SLICE_DESKTOP });
    s.tick();
    s.tick();
    s.host.handle({ kind: "abort" });
    expect(s.posted.at(-1)).toEqual({ kind: "aborted" });
    expect(s.timers.length).toBe(0);
    expect(s.host.idle).toBe(true);
    const before = s.posted.length;
    s.host.handle({ kind: "abort" });
    expect(s.posted.length).toBe(before);
  });

  it("ein Fehler im Job wird als error gemeldet; ein ungültiger Start ebenso (mit dem Grund), ohne Job", () => {
    const s = setup(3, true);
    s.host.handle({ kind: "run", input: small(), slice: SLICE_DESKTOP });
    s.tick();
    expect(s.posted.at(-1)).toEqual({ kind: "error", message: "kaputt" });
    const real: TmResponse[] = [];
    const host = createTmHost({ post: (m) => real.push(m), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>), now: () => performance.now() });
    host.handle({ kind: "run", input: small({ horizon: 1 }), slice: SLICE_DESKTOP });
    expect(real).toHaveLength(1);
    expect(real[0]).toMatchObject({ kind: "error" });
    expect((real[0] as { message: string }).message).toMatch(/Zeitstopp/);
  });

  it("Scheiben sind mindestens 4 ms lang, die Ruhe nie negativ", () => {
    const s = setup(2);
    s.host.handle({ kind: "run", input: small(), slice: { workMs: 0, restMs: -5 } });
    s.tick();
    expect(s.seen[0]).toBe(4);
    expect(s.tick()).toBe(0);
  });
});

describe("Worker-Datei (mit gespieltem `self`)", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("antwortet auf run mit progress … done und auf abort mit aborted; das Ergebnis gleicht dem synchronen", async () => {
    const posted: TmResponse[] = [];
    const scope = self as unknown as { postMessage: (m: TmResponse) => void; onmessage: ((e: { data: unknown }) => void) | null };
    const realPost = scope.postMessage;
    scope.postMessage = (m) => posted.push(m);
    try {
      await import("@/domain/timemachine/tm.worker");
      expect(typeof scope.onmessage).toBe("function");
      const inp = small();
      scope.onmessage!({ data: { kind: "run", input: inp, slice: SLICE_DESKTOP } });
      await vi.waitFor(() => expect(posted.some((m) => m.kind === "done")).toBe(true), { timeout: 20_000 });
      const done = posted.find((m) => m.kind === "done") as Extract<TmResponse, { kind: "done" }>;
      expect(JSON.stringify(done.result)).toBe(JSON.stringify(runTimeMachineSync(inp)));
      // und ein zweiter Lauf, der abgebrochen wird
      posted.length = 0;
      scope.onmessage!({ data: { kind: "run", input: small({ runs: 20_000, horizon: 200 }), slice: SLICE_MOBILE } });
      scope.onmessage!({ data: { kind: "abort" } });
      expect(posted.at(-1)).toEqual({ kind: "aborted" });
      await new Promise((r) => setTimeout(r, 60));
      expect(posted.some((m) => m.kind === "done")).toBe(false);
    } finally {
      scope.postMessage = realPost;
    }
  }, 60_000);
});

describe("Runner ohne Worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetTmRunner();
  });

  it("im Hauptthread in Scheiben: dasselbe Ergebnis wie der synchrone Lauf, Fortschritt von 0 bis 1 aufsteigend", async () => {
    const inp = small({ runs: 1500, horizon: 100 });
    const seen: number[] = [];
    const phases = new Set<TmPhase>();
    const res = await runTimeMachineIdle(inp, {
      slice: SLICE_MOBILE,
      onProgress: (p, phase) => {
        seen.push(p);
        phases.add(phase);
      },
    });
    expect(JSON.stringify(res)).toBe(JSON.stringify(runTimeMachineSync(inp)));
    expect(seen.every((p, i) => i === 0 || p >= seen[i - 1]!)).toBe(true);
    expect(seen.every((p) => p >= 0 && p <= 1)).toBe(true);
  }, 60_000);

  it("runTimeMachine nimmt ohne Worker (jsdom) denselben Weg", async () => {
    const inp = small();
    const res = await runTimeMachine(inp, { mode: "auto" });
    expect(JSON.stringify(res)).toBe(JSON.stringify(runTimeMachineSync(inp)));
  }, 60_000);

  it("Abbruch: das Versprechen wird mit AbortError abgelehnt, ein schon abgebrochenes Signal startet nichts", async () => {
    const ctl = new AbortController();
    const p = runTimeMachineIdle(small({ runs: 20_000, horizon: 300 }), { signal: ctl.signal, slice: SLICE_MOBILE });
    setTimeout(() => ctl.abort(), 20);
    await expect(p).rejects.toSatisfy((e) => isTmAbort(e));
    const already = new AbortController();
    already.abort();
    await expect(runTimeMachine(small(), { signal: already.signal })).rejects.toSatisfy((e) => isTmAbort(e));
  }, 60_000);

  it("ein Fehler im Lauf kommt mit seinem Grund an (nicht als Netzwerkfehler getarnt)", async () => {
    await expect(runTimeMachineIdle(small({ horizon: 1 }))).rejects.toThrow(/Zeitstopp/);
  });

  it("ein Worker, der nicht startet, fällt auf den Hauptthread zurück – mit demselben Ergebnis", async () => {
    class BrokenWorker {
      constructor() {
        throw new Error("kein Worker");
      }
    }
    vi.stubGlobal("Worker", BrokenWorker);
    const inp = small();
    const res = await runTimeMachine(inp);
    expect(JSON.stringify(res)).toBe(JSON.stringify(runTimeMachineSync(inp)));
  }, 60_000);
});
