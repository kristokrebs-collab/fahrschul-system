/**
 * F58 Demo – the calculation side: the example candles are computed (the same numbers on every call and every device, no
 * random, no clock), the import is the REAL CSV parser, the rule draft is the REAL translator and lab rule tree, the test is the
 * REAL engine, the paper trade replays the engine candle by candle, the alarm replays the REAL key-level functions – and
 * the isolation: the demo's sources import neither the journal nor storage nor the cloud.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { customStrategy, runBacktest, runStats } from "@/domain/backtest/index";
import { ALARM_BARS, ALARM_RULES, ALARM_START, alarmRange, defaultAlarm, replayAlarm } from "@/domain/demo/alarm";
import { DEMO_ASSUMPTIONS, DEMO_ENGINE, meaningLines, runDemoBacktest, sampleWord } from "@/domain/demo/backtest";
import { DEMO_BARS, DEMO_TAG, demoBars, demoHourly } from "@/domain/demo/candles";
import { DEMO_CSV, previewDemoCsv, summarizeDemoCsv } from "@/domain/demo/csv";
import { DEFAULT_KIT, DEMO_IDEAS, KIT_OPTIONS, kitConfig, plainText, readIdea, type Kit } from "@/domain/demo/ideas";
import { PAPER_MAX_AFTER, PAPER_SCENE, paperVerdict, playPaper } from "@/domain/demo/paper";
import { CUSTOM_TEMPLATES, validateCustom } from "@/domain/lab";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals/config";

describe("Beispiel-Kerzen", () => {
  it("sind berechnet: 6 000 Stunden-Kerzen, 2h / 4h / 1D aus vollständigen Fenstern, dieselben Objekte bei jedem Aufruf", () => {
    const b = demoBars();
    expect(b["1h"]).toHaveLength(DEMO_BARS);
    expect(b["2h"]).toHaveLength(3000);
    expect(b["4h"]).toHaveLength(1500);
    expect(b["1d"]).toHaveLength(250);
    expect(demoBars()).toBe(b);
    expect(demoHourly()).toBe(b["1h"]);
  });

  it("brauchen weder Zufall noch Uhr: eine frisch gebaute Reihe ruft Math.random und Date nicht auf – und gleicht der ersten Bit für Bit", async () => {
    const first = JSON.stringify(demoBars());
    vi.resetModules();
    const rnd = vi.spyOn(Math, "random");
    const now = vi.spyOn(Date, "now");
    const again = await import("@/domain/demo/candles");
    expect(JSON.stringify(again.demoBars())).toBe(first);
    expect(rnd).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    rnd.mockRestore();
    now.mockRestore();
  });

  it("sind in sich stimmig: Hoch ≥ Eröffnung / Schluss ≥ Tief, jede Eröffnung ist der vorige Schluss, Zeiten steigen im Takt", () => {
    const h = demoHourly();
    for (let i = 0; i < h.length; i++) {
      const c = h[i]!;
      expect(c.h).toBeGreaterThanOrEqual(Math.max(c.o, c.c));
      expect(c.l).toBeLessThanOrEqual(Math.min(c.o, c.c));
      expect(c.v).toBeGreaterThan(0);
      if (i) {
        expect(c.o).toBe(h[i - 1]!.c);
        expect(c.t - h[i - 1]!.t).toBe(3600);
      }
    }
  });

  it("die 4h-Kerzen sind exakt die vier Stunden-Kerzen darin", () => {
    const h = demoHourly();
    const k = demoBars()["4h"]![37]!;
    const part = h.slice(37 * 4, 37 * 4 + 4);
    expect(k.o).toBe(part[0]!.o);
    expect(k.c).toBe(part[3]!.c);
    expect(k.h).toBe(Math.max(...part.map((x) => x.h)));
    expect(k.l).toBe(Math.min(...part.map((x) => x.l)));
  });

  it("halten ihre ersten und letzten Werte fest (eine Änderung der Formel fällt sofort auf)", () => {
    const h = demoHourly();
    expect(h[0]).toMatchObject({ o: expect.closeTo(104.309, 3), c: expect.closeTo(105.809, 3) });
    expect(h[h.length - 1]!.c).toBeCloseTo(101.601, 3);
  });

  it("tragen eine Kennzeichnung, die nichts vortäuscht", () => {
    expect(DEMO_TAG).toBe("Beispiel – nicht deine Daten");
  });
});

describe("Import: der echte Parser auf der erfundenen Datei", () => {
  const p = previewDemoCsv();
  it("erkennt das Format an der Kopfzeile und liest alle acht Zeilen", () => {
    expect(p.format?.id).toBe("bitunix");
    expect(p.score).toBeGreaterThan(0.9);
    expect(p.rows).toBe(8);
    expect(p.trades).toHaveLength(8);
    expect(p.skipped).toBe(0);
    expect(p.warnings).toEqual([]);
    expect(DEMO_CSV.split("\n").filter(Boolean)).toHaveLength(9);
  });

  it("macht aus den Zeilen Journal-Datensätze mit stabilen Ids – dieselbe Datei noch einmal ergibt dieselben", () => {
    const again = previewDemoCsv();
    expect(p.records.map((r) => r.id)).toEqual(again.records.map((r) => r.id));
    expect(new Set(p.records.map((r) => r.id)).size).toBe(8);
    expect(p.records[0]).toMatchObject({ pair: "DEMO/USDT", side: "long", origin: { kind: "csv" }, exchange: "bitunix", stop: null });
  });

  it("rechnet das Ergebnis aus dem Inhalt: Netto = Gewinn − Gebühr + Funding je Zeile", () => {
    const s = summarizeDemoCsv(p.trades);
    expect(s).toMatchObject({ n: 8, wins: 5, losses: 3, withStop: 0 });
    // Zeile 1: 112,00 − 3,99 + (−0,20)
    expect(p.trades[0]!.pnl).toBeCloseTo(107.81, 2);
    expect(s.net).toBeCloseTo(p.trades.reduce((a, t) => a + (t.pnl ?? 0), 0), 9);
    expect(s.winRate).toBeCloseTo(5 / 8, 12);
    expect(s.winCI!.lo).toBeLessThan(s.winRate!);
    expect(s.winCI!.hi).toBeGreaterThan(s.winRate!);
  });

  it("eine Datei mit fremder Kopfzeile wird nicht erkannt – und nichts wird erfunden", () => {
    const q = previewDemoCsv("a,b,c\n1,2,3\n");
    expect(q.format).toBeNull();
    expect(q.trades).toEqual([]);
  });
});

describe("Regelentwurf", () => {
  it("jedes Beispiel in Worten ist fertig lesbar, ohne Unklares und ohne offene Rückfrage", () => {
    for (const i of DEMO_IDEAS) {
      const p = readIdea(i.text);
      expect(p.ready, i.id).toBe(true);
      expect(p.unclear, i.id).toEqual([]);
      expect(p.questions, i.id).toEqual([]);
      expect(p.understood.length, i.id).toBeGreaterThanOrEqual(3);
      expect(plainText(p.rules)[0], i.id).toMatch(/^Long wenn /);
    }
  });

  it("sagt, was es nicht versteht, statt zu raten", () => {
    const p = readIdea("Kaufe, wenn der Mond voll ist.");
    expect(p.ready).toBe(false);
    expect(p.unclear.length + p.questions.length).toBeGreaterThan(0);
  });

  it("jede Kombination des Baukastens ist eine gültige Idee des Labors – mit Klartext", () => {
    let n = 0;
    for (const side of KIT_OPTIONS.side) for (const entry of KIT_OPTIONS.entry) for (const filter of KIT_OPTIONS.filter) for (const stop of KIT_OPTIONS.stop) for (const target of KIT_OPTIONS.target) for (const interval of KIT_OPTIONS.interval) {
      const kit = { side: side.v, entry: entry.v, filter: filter.v, stop: stop.v, target: Number(target.v), interval: interval.v } as Kit;
      const cfg = kitConfig(kit);
      expect(validateCustom(cfg, { funding: false }).filter((x) => x.level === "error"), JSON.stringify(kit)).toEqual([]);
      expect(plainText(cfg)[0]).toMatch(side.v === "long" ? /^Long wenn / : /^Short wenn /);
      n++;
    }
    expect(n).toBe(2 * 3 * 2 * 3 * 3 * 2);
  });

  it("der Baukasten-Klartext nennt Einstieg, Filter, Stop und Ziel der Wahl", () => {
    const text = plainText(kitConfig({ ...DEFAULT_KIT, entry: "rsi", filter: "trend", stop: "atr2", target: 3, interval: "1h" })).join(" ");
    expect(text).toContain("RSI(14)");
    expect(text).toContain("EMA 100");
    expect(text).toContain("2 × ATR");
    expect(text).toContain("Ziel bei 3 R");
    expect(text).toContain("1h");
  });
});

describe("Test auf Beispiel-Kerzen: die echte Engine", () => {
  const rules = readIdea(DEMO_IDEAS[0]!.text).rules;
  const run = runDemoBacktest(rules);

  it("liefert Trades und Kennzahlen, die zusammenpassen", () => {
    expect(run.status).toBe("ok");
    expect(run.stats!.n).toBe(run.trades.length);
    expect(run.trades.length).toBeGreaterThan(10);
    expect(run.stats!.winRateCI).not.toBeNull();
    expect(run.stats!.rCI).not.toBeNull();
    expect(run.curve.length).toBeGreaterThan(1);
    expect(run.curve.length).toBeLessThanOrEqual(120);
    expect(run.funnel!.edges).toBeGreaterThanOrEqual(run.trades.length);
    expect(run.warmupBars + run.tradableBars).toBe(run.bars);
  });

  it("ist derselbe Rechenweg wie im Labor: von Hand durch Strategie, Engine und Statistik gelegt, kommt dasselbe heraus", () => {
    const data = demoBars();
    const cfg = run.cfg;
    const startMs = run.bars ? data[cfg.interval]![run.warmupBars]!.t * 1000 : 0;
    const prep = customStrategy.prepare(data, { config: cfg, signal: DEFAULT_SIGNAL_CFG }, startMs).result();
    const res = runBacktest(prep.bars, customStrategy.build(prep, {}), DEMO_ENGINE, { from: prep.start, to: prep.bars.length - 1, atr: prep.atr, secLen: run.secLen });
    const stats = runStats(res);
    expect(run.trades.map((t) => [t.entryIndex, t.exitIndex, t.reason, t.r])).toEqual(res.trades.map((t) => [t.entryIndex, t.exitIndex, t.reason, t.r]));
    expect(run.stats).toEqual(stats);
  });

  it("ist deterministisch: zweimal gerechnet, dasselbe Ergebnis", () => {
    expect(JSON.stringify(runDemoBacktest(rules))).toBe(JSON.stringify(run));
  });

  it("jeder Einstieg liegt nach der Aufwärmzeit und jeder Trade endet nach seinem Beginn (kein Blick zurück in die Zukunft)", () => {
    for (const t of run.trades) {
      expect(t.entryIndex).toBeGreaterThan(run.start);
      expect(t.exitIndex).toBeGreaterThanOrEqual(t.entryIndex);
      expect(t.stop).not.toBe(t.entry);
    }
  });

  it("eine Idee ohne Bedingung wird abgelehnt – mit dem Grund des Labors", () => {
    const cfg = kitConfig(DEFAULT_KIT);
    const empty = { ...cfg, long: { ...cfg.long, children: [] } };
    const r = runDemoBacktest(empty);
    expect(r.status).toBe("invalid");
    expect(r.reason).toMatch(/Bedingung/);
    expect(r.stats).toBeNull();
  });

  it("braucht eine Regel mehr Aufwärmzeit, als die Kerzen hergeben, steht das da – kein stilles Ergebnis ohne Trades", () => {
    const tpl = CUSTOM_TEMPLATES.find((x) => x.id === "oversold-trend")!;
    const r = runDemoBacktest(tpl.build());
    expect(r.status).toBe("nodata");
    expect(r.reason).toMatch(/Aufwärmen der Regeln braucht \d+ Tage/);
  });

  it("eine Idee auf einer Zeiteinheit, die die Beispiele nicht haben, läuft auf 1h – und sagt es", () => {
    const cfg = { ...kitConfig(DEFAULT_KIT), interval: "15m" as const };
    const r = runDemoBacktest(cfg);
    expect(r.note).toContain("1h");
    expect(r.cfg.interval).toBe("1h");
  });

  it("die Sätze zu den Zahlen nennen die Zahlen dieses Laufs und versprechen nichts", () => {
    const text = meaningLines(run).join(" ");
    expect(text).toContain(`${run.stats!.n} Trades`);
    expect(text).toMatch(/Trefferquote \d+ %/);
    expect(text).toContain("80 %-Spanne");
    expect(text).toContain("Ein Test beweist keinen Gewinn");
    expect(text).not.toMatch(/garantiert|verspricht|sicherer Gewinn|Gewinn ist sicher/i);
    expect(DEMO_ASSUMPTIONS.join(" ")).toContain("gilt der Stop");
    expect(sampleWord(0)).toBe("keine Trades");
    expect(sampleWord(9)).toBe("viel zu wenig");
    expect(sampleWord(29)).toBe("wenig");
    expect(sampleWord(99)).toBe("mäßig");
    expect(sampleWord(100)).toBe("solide");
  });

  it("kein Trade ist ein Ergebnis: der Satz sagt es und verweist auf den Trichter", () => {
    const r = runDemoBacktest(readIdea("Long, wenn der RSI unter 1 fällt. Stop 2 ATR, Ziel 2R, auf 1h.").rules);
    if (r.status === "ok" && r.stats!.n === 0) expect(meaningLines(r).join(" ")).toContain("keinen einzigen Trade");
    else expect(["ok", "invalid"]).toContain(r.status);
  });
});

describe("Demokonto: die Engine, Kerze für Kerze", () => {
  const plan = { side: "long" as const, stopAtr: 1.5 as const, targetR: 2 as const };

  it("wartet auf die Eröffnung der nächsten Kerze, läuft, endet – und bleibt dann so", () => {
    const k0 = playPaper(plan, 0);
    expect(k0.state).toBe("waiting");
    expect(k0.lastIndex).toBe(PAPER_SCENE);
    expect(paperVerdict(k0)).toContain("wartet");
    let ended: ReturnType<typeof playPaper> | null = null;
    let prev = "waiting";
    for (let k = 0; k <= PAPER_MAX_AFTER; k++) {
      const v = playPaper(plan, k);
      if (ended) {
        expect(v.state).toBe("closed");
        expect(v.trade).toEqual(ended.trade);
      } else if (v.state === "closed") ended = v;
      if (prev === "closed") expect(v.state).toBe("closed");
      prev = v.state;
    }
    expect(ended).not.toBeNull();
    const t = ended!.trade!;
    expect(t.reason).toBe("stop");
    expect(t.r).toBeLessThan(0);
    expect(t.r).toBeGreaterThan(-1.3);
    expect(paperVerdict(ended!)).toContain("Der Stop wurde erreicht");
  });

  it("Stop und Ziel liegen auf den richtigen Seiten; Short spiegelt Long", () => {
    const l = playPaper(plan, 0).levels;
    const s = playPaper({ ...plan, side: "short" }, 0).levels;
    expect(l.stop).toBeLessThan(l.close);
    expect(l.target).toBeGreaterThan(l.close);
    expect(s.stop).toBeGreaterThan(s.close);
    expect(s.target).toBeLessThan(s.close);
    expect(l.target - l.close).toBeCloseTo((l.close - l.stop) * 2, 9);
  });

  it("das Ziel gibt Plus, der Stop Minus – und eine Kerze, die beides berührt, zählt als Stop", () => {
    const tight = playPaper({ side: "long", stopAtr: 1, targetR: 1 }, PAPER_MAX_AFTER);
    expect(tight.trade!.reason).toBe("target");
    expect(tight.trade!.r).toBeGreaterThan(0);
    for (const side of ["long", "short"] as const)
      for (const stopAtr of [1, 1.5, 2] as const)
        for (const targetR of [1, 2, 3] as const) {
          const v = playPaper({ side, stopAtr, targetR }, PAPER_MAX_AFTER);
          const t = v.trade;
          if (!t) continue;
          if (t.reason === "target") expect(t.r).toBeGreaterThan(0);
          if (t.reason === "stop") expect(t.r).toBeLessThan(0);
          if (t.ambiguous) expect(t.reason).toBe("stop");
        }
  });

  it("zeigt die offene Position mit ihrem Stand, solange sie läuft", () => {
    const long = { side: "long" as const, stopAtr: 2 as const, targetR: 3 as const };
    const v = playPaper(long, 3);
    expect(v.state).toBe("open");
    expect(v.open!.qty).toBeGreaterThan(0);
    expect(v.open!.price).toBe(demoHourly()[PAPER_SCENE + 3]!.c);
    expect(paperVerdict(v)).toContain("läuft noch");
  });
});

describe("Alarm: die echten Funktionen der Schlüsselmarken", () => {
  it("spielt die Standardmarke ab: Vorbereitung, Bestätigung, Retest, Ungültigkeit – je einmal, in dieser Reihenfolge", () => {
    const r = replayAlarm(defaultAlarm(), ALARM_BARS - 1);
    expect(r.events.map((e) => [e.at, e.stage])).toEqual([
      [163, "prepare"],
      [164, "confirm"],
      [211, "retest"],
      [212, "invalid"],
    ]);
    expect(r.confirmedAt).toBe(164);
    // nach der Ungültigkeit schließt der Kurs wieder jenseits: die Marke steht erneut auf „bestätigt“, gemeldet wird jede Stufe nur einmal
    expect(r.status).toBe("confirmed");
    expect(r.events[1]!.title).toContain("Beispiel-Marke");
  });

  it("sieht zu jeder Kerze nur die Kerzen bis dahin: die Meldungen bis Kerze k sind ein Anfang der Meldungen bis Kerze k + m", () => {
    const full = replayAlarm(defaultAlarm(), ALARM_BARS - 1).events;
    for (const k of [0, 100, 163, 164, 200, 211, 212, 239]) {
      const part = replayAlarm(defaultAlarm(), k).events;
      expect(part).toEqual(full.slice(0, part.length));
      expect(part.every((e) => e.at <= k)).toBe(true);
    }
    expect(replayAlarm(defaultAlarm(), 100).events).toEqual([]);
  });

  it("die Regeln unterscheiden sich: eine Berührung meldet früher oder gleichzeitig mit dem Schluss, zwei Schlüsse später", () => {
    const base = defaultAlarm();
    const at = (rule: (typeof ALARM_RULES)[number]["v"]) => replayAlarm({ ...base, rule }, ALARM_BARS - 1).events.find((e) => e.stage === "confirm")?.at ?? null;
    expect(at("touch")).not.toBeNull();
    expect(at("touch")!).toBeLessThanOrEqual(at("close")!);
    expect(at("closes")!).toBeGreaterThan(at("close")!);
  });

  it("eine Marke außerhalb des Preisbereichs meldet nichts – und das steht als Stand „wartet“", () => {
    const r = replayAlarm({ price: alarmRange().hi + 20, direction: "above", rule: "close" }, ALARM_BARS - 1);
    expect(r.events).toEqual([]);
    expect(r.status).toBe("waiting");
    expect(ALARM_START).toBeGreaterThan(0);
  });

  it("legt nichts an: das Marken-Modell lebt nur in der Rückgabe", () => {
    const r = replayAlarm(defaultAlarm(), 10);
    expect(r.level.id).toBe("demo");
    expect(r.level.name).toBe("Beispiel-Marke");
  });
});

describe("Isolation: die Demo importiert weder Journal noch Speicher noch Cloud", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n)) files.push(p);
    }
  };
  walk(join(ROOT, "src/domain/demo"));
  walk(join(ROOT, "src/views/demo"));

  const FORBIDDEN: [RegExp, string][] = [
    [/from "@\/store\/(journalStore|storage|backup|adapters|uiStore|viewsStore)/, "Journal / Speicher / UI-Speicher"],
    [/from "@\/cloud/, "Cloud"],
    [/from "@\/exchanges\/csv"/, "csv/index (bindet den Speicher ein)"],
    [/from "@\/exchanges\/csv\/index"/, "csv/index (bindet den Speicher ein)"],
    [/from "@\/exchanges\/(store|api)/, "Börsen-Speicher"],
    [/from "@\/market\/signalArchive"/, "Signalarchiv"],
    [/from "@\/store\/aiLog"/, "KI-Protokoll"],
    [/localStorage|sessionStorage|indexedDB|idb-keyval|storageKey\(/, "Browser-Speicher"],
    [/\bfetch\s*\(|apiFetch|sendBeacon|XMLHttpRequest|WebSocket/, "Netz"],
    [/saveTrade|saveSettings|saveDay|replaceAll|applySnapshot/, "Schreib-Aufrufe des Journals"],
  ];

  it("liest die Quellen der Demo (mindestens zehn Dateien)", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it("keine Datei der Demo greift auf Verbotenes zu", () => {
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1");
      for (const [re, why] of FORBIDDEN) if (re.test(text)) bad.push(`${relative(ROOT, f)}: ${why}`);
    }
    expect(bad).toEqual([]);
  });

  it("die Rechenseite ist rein: weder Zufall noch Uhr", () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => x.includes("/domain/demo/"))) {
      const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1");
      if (/Math\.random|Date\.now|new Date\(\)|performance\.now/.test(text)) bad.push(relative(ROOT, f));
    }
    expect(bad).toEqual([]);
  });
});
