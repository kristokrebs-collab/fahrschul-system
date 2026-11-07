/**
 * A3: the path painter ("alle 10 000 Pfade"): the sample, the transparency, the bundling of draw calls (a stroke per batch, not per
 * path), the time slices (the clock is fake: no slice runs longer than its budget plus one batch, the batch shrinks on a slow
 * device), where a path ends (on the target / stop line it hit, at the exit candle, to the end when it ended neither) and which
 * device counts as weak. A fake 2D context records the calls – nothing real is drawn.
 */
import { describe, expect, it } from "vitest";
import { alphaFor, BATCH, PathPainter, runPaint, sampleOf, SAMPLE_WEAK, weakDevice, type PaintContext, type PaintGeometry } from "@/views/timemachine/pathPaint";

class FakeCtx implements PaintContext {
  calls: string[] = [];
  moves = 0;
  lines = 0;
  strokes = 0;
  begins = 0;
  last: [number, number][] = [];
  paths: [number, number][][] = [];
  lineWidth = 0;
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  lineJoin: CanvasLineJoin = "miter";
  lineCap: CanvasLineCap = "butt";
  alphaAtStroke: number[] = [];
  setTransform = (): void => void this.calls.push("setTransform");
  clearRect = (): void => void this.calls.push("clearRect");
  save = (): void => void this.calls.push("save");
  restore = (): void => void this.calls.push("restore");
  rect = (): void => void this.calls.push("rect");
  clip = (): void => void this.calls.push("clip");
  beginPath = (): void => {
    this.begins++;
  };
  moveTo = (x: number, y: number): void => {
    this.moves++;
    this.paths.push([[x, y]]);
  };
  lineTo = (x: number, y: number): void => {
    this.lines++;
    this.paths[this.paths.length - 1]!.push([x, y]);
  };
  stroke = (): void => {
    this.strokes++;
    this.alphaAtStroke.push(this.globalAlpha);
  };
}

const geo: PaintGeometry = { w: 400, h: 260, box: { l: 40, r: 10, t: 10, b: 42 }, steps: 10, lo: -2, hi: 4, targetR: 2 };
const style = { ink: "#f2f2f2", lineWidth: 1 };

/** `runs` paths over 10 steps; run k rises by k/100 per step. */
function data(runs: number, kinds: (k: number) => number = () => 2, exits: (k: number) => number = () => 0) {
  const stride = 11;
  const d = new Float32Array(runs * stride);
  for (let k = 0; k < runs; k++) for (let s = 0; s <= 10; s++) d[k * stride + s] = (k / 100) * s;
  return { runs, stride, data: d, kind: Uint8Array.from({ length: runs }, (_, k) => kinds(k)), exit: Uint16Array.from({ length: runs }, (_, k) => exits(k)) };
}

describe("Stichprobe", () => {
  it("zeichnet alle, wenn es reicht; sonst jeden k-ten, regelmäßig, mit ehrlicher Zahl", () => {
    expect(sampleOf(10_000, 10_000)).toEqual({ every: 1, drawn: 10_000, of: 10_000 });
    expect(sampleOf(10_000, SAMPLE_WEAK)).toEqual({ every: 5, drawn: 2_000, of: 10_000 });
    expect(sampleOf(9_975, SAMPLE_WEAK)).toEqual({ every: 5, drawn: 1_995, of: 9_975 });
    expect(sampleOf(1_500, SAMPLE_WEAK)).toEqual({ every: 1, drawn: 1_500, of: 1_500 });
    expect(sampleOf(0, 100)).toEqual({ every: 1, drawn: 0, of: 0 });
    // never more than asked for by more than one step
    for (const total of [101, 999, 4_321, 10_000, 20_000]) {
      const p = sampleOf(total, 2_000);
      expect(p.drawn).toBeLessThanOrEqual(2_000);
      expect(p.drawn * p.every).toBeGreaterThanOrEqual(total);
    }
  });

  it("die Durchsichtigkeit steigt mit weniger Linien und bleibt in Grenzen", () => {
    expect(alphaFor(10_000)).toBeGreaterThanOrEqual(0.008);
    expect(alphaFor(100)).toBeLessThanOrEqual(0.4);
    expect(alphaFor(2_000)).toBeGreaterThan(alphaFor(10_000));
    for (const n of [1, 50, 500, 2_000, 10_000]) {
      const a = alphaFor(n);
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThan(1);
    }
  });
});

describe("gebündelte Zeichenaufrufe", () => {
  it("10 000 Pfade sind ein paar hundert Striche, nicht 10 000 – und jeder Pfad wird genau einmal gezeichnet", () => {
    const ctx = new FakeCtx();
    const paths = data(10_000);
    const p = new PathPainter(ctx, paths, geo, style, sampleOf(10_000, 10_000), 1);
    expect(p.step(Infinity)).toBe(true);
    expect(ctx.moves).toBe(10_000);
    expect(ctx.lines).toBe(10_000 * 10);
    expect(ctx.strokes).toBe(Math.ceil(10_000 / BATCH));
    expect(ctx.begins).toBe(ctx.strokes + 1); // + the clip rectangle
    expect(ctx.strokes).toBeLessThan(700);
    expect(p.progress).toBe(1);
  });

  it("eine Stichprobe zeichnet jeden k-ten Lauf", () => {
    const ctx = new FakeCtx();
    const paths = data(1_000);
    const plan = sampleOf(1_000, 100);
    const p = new PathPainter(ctx, paths, geo, style, plan, 1);
    p.step(Infinity);
    expect(plan.every).toBe(10);
    expect(ctx.moves).toBe(100);
    // run 10 rises by 0.1 per step: its last y is above run 0's
    const y = (k: number) => ctx.paths[k / 10]![10]![1];
    expect(y(10)).toBeLessThan(y(0)); // up = smaller y
    expect(p.runOf(3)).toBe(30);
  });

  it("nicht gespielte Läufe (255) werden übersprungen; der Ausgangszustand wird zurückgegeben (Clip, Alpha)", () => {
    const ctx = new FakeCtx();
    const paths = data(40, (k) => (k % 4 === 0 ? 255 : 2));
    const p = new PathPainter(ctx, paths, geo, style, sampleOf(40, 40), 1);
    p.step(Infinity);
    expect(ctx.moves).toBe(30);
    expect(ctx.calls.filter((c) => c === "save")).toHaveLength(1);
    expect(ctx.calls.filter((c) => c === "restore")).toHaveLength(1);
    expect(ctx.globalAlpha).toBe(1);
    expect(ctx.strokeStyle).toBe("#f2f2f2");
    // full batches use the picture's transparency, a short last batch less of it (so fewer paths do not pile up)
    expect(ctx.alphaAtStroke[0]).toBe(alphaFor(40));
    expect(ctx.alphaAtStroke.every((a) => a <= alphaFor(40) && a >= 0.008)).toBe(true);
  });

  it("auf dunklem Grund addieren sich die Striche („lighter“), auf Papier überlagern sie sich; am Ende ist beides zurückgesetzt", () => {
    const dark = new FakeCtx();
    const pd = new PathPainter(dark, data(20), geo, { ...style, additive: true }, sampleOf(20, 20), 1);
    expect(dark.globalCompositeOperation).toBe("lighter");
    pd.step(Infinity);
    expect(dark.globalCompositeOperation).toBe("source-over");
    const paper = new FakeCtx();
    const pp = new PathPainter(paper, data(20), geo, style, sampleOf(20, 20), 1);
    expect(paper.globalCompositeOperation).toBe("source-over");
    pp.step(Infinity);
  });

  it("zeichnet in CSS-Pixeln mit dem Gerätefaktor als Transformation", () => {
    const ctx = new FakeCtx();
    new PathPainter(ctx, data(3), geo, style, sampleOf(3, 3), 2);
    expect(ctx.calls.slice(0, 2)).toEqual(["setTransform", "clearRect"]);
  });
});

describe("wo ein Pfad endet", () => {
  const stride = 11;
  const one = (kind: number, exit: number, close: number) => {
    const d = new Float32Array(stride).fill(0.5);
    d[exit > 0 ? exit : 10] = close;
    return { runs: 1, stride, data: d, kind: Uint8Array.of(kind), exit: Uint16Array.of(exit) };
  };
  // y of R: the plot spans lo -2 … hi 4 over (260 - 10 - 42) px starting at y = 10
  const yOf = (r: number) => 10 + (1 - (r - -2) / 6) * 208;

  it("Ziel: bis zur Ausstiegskerze, dort genau auf der Ziel-Linie (auch wenn der Schluss darüber lag)", () => {
    const ctx = new FakeCtx();
    new PathPainter(ctx, one(0, 6, 3.7), geo, style, sampleOf(1, 1), 1).step(Infinity);
    const pts = ctx.paths[0]!;
    expect(pts).toHaveLength(7); // candle 0 … 6
    expect(pts[6]![1]).toBeCloseTo(yOf(2), 5);
  });

  it("Stop: endet auf −1 R", () => {
    const ctx = new FakeCtx();
    new PathPainter(ctx, one(1, 4, -1.8), geo, style, sampleOf(1, 1), 1).step(Infinity);
    const pts = ctx.paths[0]!;
    expect(pts).toHaveLength(5);
    expect(pts[4]![1]).toBeCloseTo(yOf(-1), 5);
  });

  it("weder noch: läuft bis zum Ende der Sitzung; nachgezogener Stop: endet bei seinem Schluss", () => {
    const a = new FakeCtx();
    new PathPainter(a, one(2, 0, 1.25), geo, style, sampleOf(1, 1), 1).step(Infinity);
    expect(a.paths[0]).toHaveLength(11);
    expect(a.paths[0]![10]![1]).toBeCloseTo(yOf(1.25), 5);
    const m = new FakeCtx();
    new PathPainter(m, one(3, 5, 0.25), geo, style, sampleOf(1, 1), 1).step(Infinity);
    expect(m.paths[0]).toHaveLength(6);
    expect(m.paths[0]![5]![1]).toBeCloseTo(yOf(0.25), 5);
  });

  it("x läuft von der linken zur rechten Kante des Bildes", () => {
    const ctx = new FakeCtx();
    new PathPainter(ctx, one(2, 0, 0), geo, style, sampleOf(1, 1), 1).step(Infinity);
    expect(ctx.paths[0]![0]![0]).toBeCloseTo(40, 5);
    expect(ctx.paths[0]![10]![0]).toBeCloseTo(400 - 10, 5);
  });
});

describe("Zeitscheiben", () => {
  /** A clock the painter and the driver share: every path costs `perPath` ms (a stroke costs what its paths cost), nothing else costs anything. */
  function clock(perPath: number) {
    let t = 0;
    const ctx = new FakeCtx();
    const stroke = ctx.stroke;
    let seen = 0;
    ctx.stroke = () => {
      stroke();
      t += (ctx.moves - seen) * perPath;
      seen = ctx.moves;
    };
    return { ctx, now: () => t };
  }

  it("kein Stück läuft länger als sein Budget plus ein Pfad – 10 000 Pfade in vielen kurzen Scheiben", async () => {
    const c = clock(0.025);
    const p = new PathPainter(c.ctx, data(10_000), geo, style, sampleOf(10_000, 10_000), 1, c.now);
    const stats = await runPaint(p, { sliceMs: 8, now: c.now, yieldNow: async () => undefined });
    expect(stats.drawn).toBe(10_000);
    expect(stats.maxSliceMs).toBeLessThanOrEqual(8 + 0.4 + 1e-9);
    expect(stats.slices).toBeGreaterThan(25);
    expect(stats.totalMs).toBeCloseTo(0.025 * 10_000, 3);
    expect(c.ctx.moves).toBe(10_000);
  });

  it("auf einem langsamen Gerät (CPU ×4) passt der Stapel in die Scheibe: nach dem ersten Stück bleibt jedes kurz", async () => {
    // 4× throttled: one path costs 1.25 ms, a batch of 16 would take 20 ms – the first batch has no measurement yet
    const c = clock(1.25);
    const p = new PathPainter(c.ctx, data(2_000), geo, style, sampleOf(2_000, 2_000), 1, c.now);
    const slices: number[] = [];
    const origStep = p.step.bind(p);
    p.step = (d) => {
      const t0 = c.now();
      const r = origStep(d);
      slices.push(c.now() - t0);
      return r;
    };
    const stats = await runPaint(p, { sliceMs: 8, now: c.now, yieldNow: async () => undefined });
    expect(stats.drawn).toBe(2_000);
    expect(c.ctx.moves).toBe(2_000);
    // the batch shrank to what fits (8 ms ÷ 1.25 ms = 6 paths), never below one
    expect(stats.batch).toBeLessThanOrEqual(6);
    expect(stats.batch).toBeGreaterThanOrEqual(1);
    expect(slices[0]).toBeLessThanOrEqual(20 + 1e-9);
    for (const s of slices.slice(1, -1)) expect(s).toBeLessThanOrEqual(8 + 1.25 + 1e-9);
    expect(stats.maxSliceMs).toBeLessThan(50);
    // more strokes than at full speed (10 000 paths in batches of 16 would be 625): the bundling gives way to the time limit
    expect(stats.batches).toBeGreaterThan(Math.ceil(2_000 / BATCH));
  });

  it("ein Abbruch hält mitten im Zeichnen an und gibt Clip und Alpha zurück", async () => {
    const c = clock(1);
    const p = new PathPainter(c.ctx, data(5_000), geo, style, sampleOf(5_000, 5_000), 1, c.now);
    const stop = { aborted: false };
    let slices = 0;
    const stats = await runPaint(p, {
      sliceMs: 5,
      now: c.now,
      signal: stop,
      yieldNow: async () => {
        if (++slices === 3) stop.aborted = true;
      },
    });
    expect(stats.drawn).toBeLessThan(5_000);
    expect(stats.drawn).toBeGreaterThan(0);
    expect(c.ctx.calls.filter((x) => x === "restore")).toHaveLength(1);
    expect(c.ctx.globalAlpha).toBe(1);
  });

  it("meldet den Fortschritt", async () => {
    const c = clock(1);
    const p = new PathPainter(c.ctx, data(320), geo, style, sampleOf(320, 320), 1, c.now);
    const seen: number[] = [];
    await runPaint(p, { sliceMs: 5, now: c.now, yieldNow: async () => undefined, onProgress: (d, t) => seen.push(d / t) });
    expect(seen[seen.length - 1]).toBe(1);
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1]!)).toBe(true);
  });
});

describe("schwaches Gerät", () => {
  it("Telefon (grober Zeiger), wenig Kerne oder wenig Speicher → Stichprobe als Voreinstellung", () => {
    expect(weakDevice({ hardwareConcurrency: 8, deviceMemory: 8 }, false)).toBe(false);
    expect(weakDevice({ hardwareConcurrency: 8, deviceMemory: 8 }, true)).toBe(true);
    expect(weakDevice({ hardwareConcurrency: 4 }, false)).toBe(true);
    expect(weakDevice({ hardwareConcurrency: 12, deviceMemory: 4 }, false)).toBe(true);
    expect(weakDevice({}, false)).toBe(false);
    expect(weakDevice(undefined, true)).toBe(true);
    expect(weakDevice(undefined, false)).toBe(false);
  });
});
