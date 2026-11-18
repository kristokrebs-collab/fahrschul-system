/**
 * Security round 11, package C – client side input and output:
 * - `__proto__` & co. in an imported backup never reach a prototype setter (merge mode, `fillMissing`, `mergeDays`);
 * - the CSV writers of the archive export and the plan ticket neutralise spreadsheet formulas (but keep negative numbers);
 * - the Pine export puts a name with a line break on ONE line (no injected code);
 * - index.html opens no connection to a third party before the app runs (DSGVO).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pointsToCsv, type ArchivePoint } from "@/domain/archive";
import { toPine, DEFAULT_PINE_ENGINE } from "@/domain/lab/pine";
import { defaultCustom, sanitizeCustom } from "@/domain/lab/rules/tree";
import { buildTicket, type TicketPlan } from "@/domain/plan";
import { neutralizeFormula } from "@/lib/csvSafe";
import { isUnsafeKey, parseJsonSafe } from "@/lib/unsafeKeys";
import { applyBackup, fillMissing, parseBackup } from "@/store/backup";
import type { StorageSnapshot } from "@/store/adapters/StoreApi";
import { normalizeSettings } from "@/domain/normalize";
import type { JsonBackup } from "@/domain/types";

const protoOf = (o: object) => Object.getPrototypeOf(o);

describe("__proto__ in an imported backup", () => {
  const evil = '{"__proto__":{"polluted":"yes","dayHack":1}}';

  it("parseJsonSafe drops the keys at any depth and leaves ordinary text on the plain path", () => {
    const v = parseJsonSafe(`{"a":{"b":${evil},"constructor":{"x":1}},"prototype":2,"ok":"constructor"}`) as Record<string, unknown>;
    expect(Object.keys(v)).toEqual(["a", "ok"]);
    expect(Object.keys(v.a as object)).toEqual(["b"]);
    expect(Object.keys((v.a as { b: object }).b)).toEqual([]);
    expect(v.ok).toBe("constructor"); // a VALUE is not a key
    expect(parseJsonSafe('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseJsonSafe("{nope")).toThrow();
    expect(["__proto__", "constructor", "prototype"].every(isUnsafeKey)).toBe(true);
    expect(isUnsafeKey("settings")).toBe(false);
  });

  it("fillMissing never calls the __proto__ setter (own `__proto__` key made by JSON.parse)", () => {
    const incoming = JSON.parse(evil) as unknown;
    const out = fillMissing({ keep: 1 } as Record<string, unknown>, incoming);
    expect(protoOf(out)).toBe(Object.prototype);
    expect((out as { polluted?: unknown }).polluted).toBeUndefined();
    // nested
    const nested = fillMissing({ a: { b: 1 } } as Record<string, unknown>, JSON.parse(`{"a":${evil}}`));
    expect(protoOf(nested.a as object)).toBe(Object.prototype);
    expect(((nested.a as { polluted?: unknown }).polluted)).toBeUndefined();
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("a backup file with __proto__ in settings, days and a trade is merged without any inherited value", () => {
    const text = `{"exportedAt":"2026-03-02","settings":{"__proto__":{"polluted":"yes"},"market":{"__proto__":{"polluted":"yes"}},"keepMe":1},"days":{"__proto__":{"note":"x"},"2026-03-02":{"note":"hi","__proto__":{"polluted":"yes"}}},"trades":[{"id":"t1","date":"2026-03-01T10:00","pair":"BTCUSDT","side":"long","entry":1,"exit":2,"size":1,"__proto__":{"polluted":"yes"}}]}`;
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const cur: StorageSnapshot = { settings: normalizeSettings(null), days: {}, trades: [], hyblock: [] };
    for (const mode of ["merge", "replace"] as const) {
      const next = applyBackup(cur, parsed.backup, mode, parsed.parts);
      const days = next.days!;
      for (const o of [next.settings, next.settings.market, days, days["2026-03-02"]!, next.trades[0]!]) {
        expect(protoOf(o as object), mode).toBe(Object.prototype);
        expect((o as { polluted?: unknown }).polluted, mode).toBeUndefined();
        expect(Object.keys(o as object)).not.toContain("__proto__");
      }
    }
  });

  it("the merge itself is safe even for a backup object that was built without parseBackup", () => {
    const cur: StorageSnapshot = { settings: normalizeSettings(null), days: { "2026-03-02": { note: "mine", updatedAt: "2026-03-01" } }, trades: [], hyblock: [] };
    const backup = {
      exportedAt: "",
      settings: normalizeSettings(JSON.parse('{"__proto__":{"polluted":"yes"},"extra":{"__proto__":{"polluted":"yes"}}}')),
      trades: [],
      days: JSON.parse('{"__proto__":{"note":"x"},"2026-03-02":{"note":"theirs","updatedAt":"2026-03-05","__proto__":{"polluted":"yes"}}}'),
    } as unknown as JsonBackup;
    const next = applyBackup(cur, backup, "merge", { settings: true, trades: false, hyblock: false, days: true });
    const days = next.days!;
    expect(protoOf(next.settings)).toBe(Object.prototype);
    expect((next.settings as { polluted?: unknown }).polluted).toBeUndefined();
    expect(protoOf(days)).toBe(Object.prototype);
    expect(Object.keys(days)).toEqual(["2026-03-02"]);
    expect(days["2026-03-02"]!.note).toBe("theirs");
    expect((days["2026-03-02"] as { polluted?: unknown }).polluted).toBeUndefined();
    expect(protoOf(days["2026-03-02"]!)).toBe(Object.prototype);
  });
});

describe("CSV formula injection", () => {
  const pt = (symbol: string, d: ArchivePoint["d"]): ArchivePoint => ({ series: "lsAcc", symbol, t: Date.UTC(2026, 9, 26, 2), d });

  it("neutralizeFormula prefixes = + - @ tab CR and nothing else", () => {
    for (const lead of ["=", "+", "-", "@", "\t", "\r"]) expect(neutralizeFormula(`${lead}1+1`)).toBe(`'${lead}1+1`);
    for (const v of ["BTCUSDT", "1=1", "a-b", " =x", ""]) expect(neutralizeFormula(v)).toBe(v);
  });

  it("the archive CSV writes a formula-looking symbol and word as text, numbers keep their minus sign", () => {
    const csv = pointsToCsv("lsAcc", [pt('=HYPERLINK("http://evil.example","x")', { long: -0.5, short: 1.25, ratio: -2 }), pt("+SUM(A1)", { long: 2, short: -3, ratio: 0.5 })]);
    const rows = csv.split("\n");
    // sorted by symbol: "+SUM(A1)" < "=HYPERLINK…"
    expect(rows[1]).toContain(",'+SUM(A1),");
    expect(rows[2]).toContain(`,"'=HYPERLINK(""http://evil.example"",""x"")",`);
    expect(rows[1]!.endsWith(",2,-3,0.5")).toBe(true);
    expect(rows[2]!.endsWith(",-0.5,1.25,-2")).toBe(true);
    const word = pointsToCsv("box4h", [{ series: "box4h", symbol: "BTCUSDT", t: Date.UTC(2026, 9, 26, 2), d: { phase: "-1+1", dir: -1, top: 2, bottom: 1, grade: "@A", pos: 0.5, price: 1.5 } }]);
    expect(word.split("\n")[1]).toContain(",BTCUSDT,'-1+1,-1,,2,1,'@A,0.5,1.5");
  });

  const plan = (over: Partial<TicketPlan> = {}): TicketPlan => ({
    symbol: "BTCUSDT", side: "long", entry: 100, stop: 99, target: 102, qty: 1, notional: 100, maxLoss: 1, maxLossPct: 0.01, rr: 2, leverage: 1, flatByMs: null, light: "green", tick: 0.1, lot: 0.001, currency: "USDT", tz: "UTC",
    sessionLabel: "x", entrySource: "manual", signalAt: null, stopLabel: "s", targetLabel: "t", sourceLabel: "Binance", intervalLabel: "5 Minuten", candlesUntil: null, fetchedAt: null, ...over,
  });

  it("the plan ticket CSV writes symbol, source and management text as text when they start like a formula", () => {
    const t = buildTicket(plan({ symbol: "=cmd|' /C calc'!A0", sourceLabel: "@SUM(1+1)", manage: [{ label: "Stop", text: "-2+3" } as never] }));
    const [, row] = t.csv.split("\n");
    expect(row!.startsWith("'=cmd|' /C calc'!A0,long,")).toBe(true);
    expect(row).toContain(",'@SUM(1+1),");
    expect(row!.endsWith(",Stop: -2+3")).toBe(true); // the joined cell starts with the label, no formula character
    const t2 = buildTicket(plan({ manage: [{ label: "-Stop", text: "x" } as never] }));
    expect(t2.csv.split("\n")[1]!.endsWith(",'-Stop: x")).toBe(true);
    // numbers are untouched
    expect(buildTicket(plan()).csv.split("\n")[1]).toBe("BTCUSDT,long,100,99,102,1,100,1,1,2,,Grün,Binance,,");
  });
});

describe("Pine export: no code from a name", () => {
  const cfg = (name: string) => sanitizeCustom({ ...defaultCustom(), name });
  const opts = { symbol: "BTCUSDT", engine: DEFAULT_PINE_ENGINE };

  /** Every line that is not a `//` comment and starts with the payload = code that came from the name. */
  const injected = (code: string, payload: string): boolean => code.split(/\r\n|\r|\n|\u2028|\u2029/).some((l) => l.trim().startsWith(payload));

  it("a line break in the idea's name cannot end the comment or the string and start a new line of code", () => {
    for (const nl of ["\n", "\r\n", "\r", "\u2028", "\u0085"]) {
      const name = `Idee${nl}evil_close()//`;
      const { code, fileName } = toPine(cfg(name), opts);
      expect(injected(code, "evil_close"), JSON.stringify(nl)).toBe(false);
      expect(code).toContain("// Idee: Idee evil_close()//");
      expect(fileName).not.toMatch(/[\r\n]/);
    }
  });

  it("the same holds for the strategy title, the order comment, the stamp and the symbol", () => {
    const { code } = toPine(cfg('A"\nevil_exit("x")//B\\'), { ...opts, stamp: "t\nevil_cancel()", symbol: "BTC\nevil_close()" });
    for (const payload of ["evil_exit", "evil_cancel", "evil_close"]) expect(injected(code, payload), payload).toBe(false);
    // no raw control character is left in a string literal: the whole script has only the line breaks the generator wrote
    expect(code).not.toMatch(/[\r\u2028\u2029\u0085]/);
    const strategyLine = code.split("\n").find((l) => l.startsWith("strategy("))!;
    expect(strategyLine.startsWith('strategy("A\' evil_exit(\'x\')//B/"')).toBe(true);
  });
});

describe("index.html", () => {
  const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");

  it("opens no connection to a third party before the app runs (no preconnect / dns-prefetch / prefetch to an exchange)", () => {
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const hints = links.filter((l) => /rel=["'](?:preconnect|dns-prefetch|prefetch|preload|prerender)["']/i.test(l));
    for (const l of hints) expect(l, "a resource hint to another origin").not.toMatch(/href=["']https?:\/\//i);
    expect(/(?:fapi|fstream|stream)\.binance\.com|bybit\.com|okx\.com/i.test(html)).toBe(false);
  });

  it("hides the deploy preview's collaboration bar (an empty white strip over the bottom navigation under this site's CSP)", () => {
    expect(html).toMatch(/body > div\[data-netlify-deploy-id\]\s*\{\s*display: none !important;\s*\}/);
  });

  it("keeps iOS Safari from zooming into a focused field: 16 px there, and only there (the rule is fenced by an iOS-only @supports)", () => {
    const rule = /@supports \(-webkit-touch-callout: none\)\s*\{\s*input,\s*select,\s*textarea\s*\{\s*font-size: 16px !important;\s*\}\s*\}/;
    expect(html).toMatch(rule);
    // outside the fence no field size is forced (Android, tablets and desktop keep the designed 13.5–14 px)
    expect(html.replace(rule, "")).not.toMatch(/font-size:\s*16px/);
    // pinch zoom stays allowed everywhere (no `maximum-scale` / `user-scalable=no` as the shortcut)
    expect(html).not.toMatch(/maximum-scale|user-scalable/);
  });
});
