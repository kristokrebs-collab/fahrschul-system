/**
 * Optimiser – the worker interface: the message protocol (start / pause / resume / stop / abort / throttle → state, progress, done,
 * error), slices with rests (duty cycle), abort; and the page-side runner without a worker (the same host on the main thread).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvolveHost, EvolveMulti, PROGRESS_MS, restAfter, startEvolve, type EvolveResponse, type HostEnv, type MultiInput, type MultiResult, type MultiSnapshot, type Throttle } from "@/domain/evolve";
import { multiInput, strategy } from "./evolve.helpers";

const TH: Throttle = { duty: 0.5, sliceMs: 40, reason: null };
const SNAP = (p = 0): MultiSnapshot => ({ phase: "running", strategies: [], trialsDone: 0, trialsBudget: 0, progress: p });
const RESULT: MultiResult = { strategies: [], tournament: [], trialsRun: 0, trialsPrior: 0 };

/** A scripted run: needs `steps` slices; each slice "works" 10 ms of the fake clock. */
class FakeMulti {
  steps = 0;
  stopRequested = false;
  fail = false;
  private entry = 0;
  constructor(
    private readonly total: number,
    private readonly clock: { t: number },
  ) {}
  step(): boolean {
    if (this.fail) throw new Error("kaputt");
    this.clock.t += 10;
    this.steps++;
    return this.steps >= this.total || (this.stopRequested && this.steps >= 2);
  }
  requestStop(): void {
    this.stopRequested = true;
  }
  snapshot(): MultiSnapshot {
    return SNAP(this.steps / this.total);
  }
  drainEntries() {
    return [{ sid: "a", seed: 1, i: ++this.entry, at: 0, key: "k", parent: null, via: "mutation" as const, kinds: [], text: "t", score: 1, n: 20, avgR: 0.1 }];
  }
  result(): MultiResult {
    return RESULT;
  }
}

function setup(total = 5) {
  const clock = { t: 0 };
  const posted: EvolveResponse[] = [];
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let id = 0;
  const fake = new FakeMulti(total, clock);
  const env: HostEnv = {
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
    wall: () => 1_700_000_000_000,
    create: () => fake as unknown as EvolveMulti,
  };
  const host = createEvolveHost(env);
  const tick = (): number | null => {
    const t = timers.shift();
    if (!t) return null;
    t.fn();
    return t.ms;
  };
  return { host, posted, timers, clock, fake, tick, kinds: () => posted.map((m) => (m.kind === "state" ? `state:${m.state}` : m.kind)) };
}

const START = { kind: "start", input: {} as MultiInput, throttle: TH } as const;

describe("Nachrichten-Protokoll", () => {
  it("start → state running → Scheiben mit Pausen → progress (höchstens alle 250 ms) → done mit Ergebnis und Zeitstempeln", () => {
    const s = setup(5);
    s.host.handle(START);
    expect(s.kinds()).toEqual(["state:running"]);
    const rests: number[] = [];
    for (let i = 0; i < 20; i++) {
      const ms = s.tick();
      if (ms == null) break;
      rests.push(ms);
    }
    // jede Scheibe arbeitet 10 ms; bei 50 % Last folgt 10 ms Ruhe (der erste Aufruf ist sofort)
    expect(rests[0]).toBe(0);
    for (const r of rests.slice(1)) expect(r).toBe(restAfter(10, 0.5));
    const done = s.posted.at(-1)!;
    expect(done.kind).toBe("done");
    if (done.kind === "done") {
      expect(done.result).toBe(RESULT);
      expect(done.entries[0]!.at).toBe(1_700_000_000_000); // der Host stempelt die Zeit
    }
    // Fortschritt: nicht bei jeder Scheibe (die Uhr läuft nur 10 ms je Scheibe)
    const progress = s.posted.filter((m) => m.kind === "progress").length;
    expect(progress).toBeLessThanOrEqual(Math.ceil((5 * (10 + restAfter(10, 0.5))) / PROGRESS_MS) + 1);
    expect(s.host.idle).toBe(true);
  });

  it("pause hält die Arbeit an (nichts geplant), meldet den Stand einmal, resume macht weiter", () => {
    const s = setup(10);
    s.host.handle(START);
    s.tick();
    s.tick();
    const stepsBefore = s.fake.steps;
    s.host.handle({ kind: "pause" });
    expect(s.kinds().filter((k) => k === "state:paused")).toHaveLength(1);
    expect(s.timers).toHaveLength(0);
    expect(s.tick()).toBeNull();
    expect(s.fake.steps).toBe(stepsBefore); // wirklich nichts gerechnet
    expect(s.posted.at(-1)!.kind).toBe("progress"); // der Stand beim Pausieren
    s.host.handle({ kind: "resume" });
    expect(s.kinds().at(-1)).toBe("state:running");
    s.tick();
    expect(s.fake.steps).toBe(stepsBefore + 1);
  });

  it("resume ohne Pause und pause ohne Lauf tun nichts", () => {
    const s = setup();
    s.host.handle({ kind: "resume" });
    s.host.handle({ kind: "pause" });
    s.host.handle({ kind: "stop" });
    expect(s.posted).toEqual([]);
  });

  it("stop: die Suche wird gebeten aufzuhören, der Lauf wertet aus und liefert trotzdem das Ergebnis", () => {
    const s = setup(50);
    s.host.handle(START);
    s.tick();
    s.host.handle({ kind: "stop" });
    expect(s.fake.stopRequested).toBe(true);
    expect(s.kinds()).toContain("state:stopping");
    for (let i = 0; i < 10 && s.tick() != null; i++);
    expect(s.posted.at(-1)!.kind).toBe("done");
    expect(s.fake.steps).toBeLessThan(50);
  });

  it("stop aus der Pause heraus läuft weiter bis zum Ergebnis", () => {
    const s = setup(50);
    s.host.handle(START);
    s.tick();
    s.host.handle({ kind: "pause" });
    s.host.handle({ kind: "stop" });
    for (let i = 0; i < 10 && s.tick() != null; i++);
    expect(s.posted.at(-1)!.kind).toBe("done");
  });

  it("abort: sofort Schluss, nichts mehr wird gerechnet oder gemeldet, auch nicht von bereits geplanten Scheiben", () => {
    const s = setup(50);
    s.host.handle(START);
    s.tick();
    const stepsBefore = s.fake.steps;
    s.host.handle({ kind: "abort" });
    expect(s.kinds().at(-1)).toBe("state:aborted");
    const n = s.posted.length;
    expect(s.tick()).toBeNull();
    expect(s.fake.steps).toBe(stepsBefore);
    expect(s.posted).toHaveLength(n);
    expect(s.host.idle).toBe(true);
    // danach ist ein neuer Start möglich
    s.host.handle(START);
    expect(s.kinds().at(-1)).toBe("state:running");
  });

  it("throttle ändert die Ruhepausen ab der nächsten Scheibe", () => {
    const s = setup(50);
    s.host.handle(START);
    s.tick(); // sofort
    const a = s.tick();
    s.host.handle({ kind: "throttle", throttle: { duty: 0.1, sliceMs: 20, reason: "Gedrosselt, weil die App im Hintergrund ist" } });
    s.tick(); // diese Scheibe war noch mit der alten Pause geplant und plant ihre Nachfolgerin schon mit der neuen
    const b = s.tick();
    expect(a).toBe(restAfter(10, 0.5));
    expect(b).toBe(restAfter(10, 0.1));
    expect(b!).toBeGreaterThan(a!);
  });

  it("ein Fehler im Lauf wird gemeldet, nichts hängt", () => {
    const s = setup(5);
    s.fake.fail = true;
    s.host.handle(START);
    s.tick();
    const last = s.posted.at(-1)!;
    expect(last).toEqual({ kind: "error", message: "kaputt" });
    expect(s.timers).toHaveLength(0);
    expect(s.host.idle).toBe(true);
  });
});

describe("Lauf ohne Web Worker (gleicher Host im Seitenthread)", { timeout: 60_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("läuft bis zum Ergebnis, meldet den Fortschritt und die Drosselung; es ist derselbe Lauf wie direkt", async () => {
    const input = multiInput({}, [strategy("s1", { maxTrials: 30 })]);
    const progress: MultiSnapshot[] = [];
    const throttles: Throttle[] = [];
    const run = startEvolve(input, { onProgress: (snap) => progress.push(snap), onThrottle: (t) => throttles.push(t) }, { mode: "inline", power: "full" });
    expect(run.via).toBe("inline");
    const out = await run.done;
    expect(out.kind).toBe("done");
    expect(throttles.length).toBeGreaterThan(0);
    // auf der Seite sind es winzige Scheiben und höchstens 35 % Last, auch bei „volle Leistung“
    expect(throttles[0]!.sliceMs).toBeLessThanOrEqual(8);
    expect(throttles[0]!.duty).toBeLessThanOrEqual(0.35);
    expect(progress.at(-1)!.progress).toBe(1);
    const direct = new EvolveMulti(input);
    for (let i = 0; i < 100_000 && !direct.step(performance.now() + 100); i++);
    if (out.kind === "done") expect(out.result.strategies[0]!.proposals.map((p) => p.key)).toEqual(direct.result()!.strategies[0]!.proposals.map((p) => p.key));
  });

  it("Pause hält an, Fortsetzen geht weiter, Stopp liefert das Ergebnis der bisherigen Suche", async () => {
    const input = multiInput({}, [strategy("s1", { maxTrials: 400 })]);
    const states: string[] = [];
    const snaps: MultiSnapshot[] = [];
    const run = startEvolve(input, { onProgress: (s) => snaps.push(s), onState: (s) => states.push(s) }, { mode: "inline" });
    await vi.waitFor(() => expect(snaps.length).toBeGreaterThan(0));
    run.pause();
    await vi.waitFor(() => expect(states).toContain("paused"));
    const frozen = snaps.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(snaps.length).toBeLessThanOrEqual(frozen + 1); // der Stand beim Anhalten
    run.resume();
    await vi.waitFor(() => expect(states.at(-1)).toBe("running"));
    run.stop();
    const out = await run.done;
    expect(out.kind).toBe("done");
    if (out.kind === "done") expect(out.result.strategies[0]!.trials).toBeLessThan(400);
  });

  it("Abbruch beendet den Lauf sofort ohne Ergebnis", async () => {
    const input = multiInput({}, [strategy("s1", { maxTrials: 400 })]);
    const snaps: MultiSnapshot[] = [];
    const run = startEvolve(input, { onProgress: (s) => snaps.push(s) }, { mode: "inline" });
    await vi.waitFor(() => expect(snaps.length).toBeGreaterThan(0));
    run.abort();
    const out = await run.done;
    expect(out).toEqual({ kind: "aborted" });
    const n = snaps.length;
    await new Promise((r) => setTimeout(r, 150));
    expect(snaps.length).toBe(n); // danach kommt nichts mehr
  });

  it("ein Tab im Hintergrund drosselt auf höchstens 10 %", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    try {
      const throttles: Throttle[] = [];
      const run = startEvolve(multiInput({}, [strategy("s1", { maxTrials: 5 })]), { onProgress: () => undefined, onThrottle: (t) => throttles.push(t) }, { mode: "inline", power: "full" });
      await run.done;
      expect(throttles[0]!.duty).toBeLessThanOrEqual(0.1);
      expect(throttles[0]!.reason).toMatch(/Hintergrund/);
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }
  });
});
