import { describe, expect, it } from "vitest";
import { defaultSettings } from "@/domain/defaults";
import { enrichTrades } from "@/domain/enrich";
import type { Settings, Trade } from "@/domain/types";
import { flatHits, searchIndex, suggestions } from "@/search/rank";
import { buildSearchIndex, COMMANDS, SETTING_SECTIONS, setupStats, type IndexInput } from "@/search/sources";
import { mkTrade } from "./domain.fixtures";

const NOW = new Date("2026-10-12T12:00").getTime();

function settings(): Settings {
  return {
    ...defaultSettings(),
    currency: "USDT",
    setups: [
      { id: "s_bo", name: "Breakout Retest", account: "both", color: "#6f9dc9", desc: "Ausbruch mit Retest der Range", checklist: [{ id: "c1", text: "Volumen steigt" }] },
      { id: "s_sw", name: "Liquidity Sweep", account: "scalp", color: "#46a6a0", desc: "Stopps abgeholt, Reclaim", checklist: [] },
      { id: "s_fd", name: "Fade the Pump", account: "scalp", color: "#c7768f", desc: "Gegen die Bewegung", checklist: [] },
    ],
  };
}

function trades(): Trade[] {
  const out: Trade[] = [];
  // the breakout earns (3 wins), the fade loses (3 losses), one sweep win with a note
  for (let i = 0; i < 3; i++) out.push(mkTrade({ id: `bo${i}`, date: `2026-09-0${i + 1}T10:00`, entry: 100, stop: 99, exit: 103, size: 1000, setups: ["s_bo"] }));
  for (let i = 0; i < 3; i++) out.push(mkTrade({ id: `fd${i}`, date: `2026-09-1${i + 1}T10:00`, side: "short", entry: 100, stop: 101, exit: 101, size: 1000, setups: ["s_fd"] }));
  out.push(mkTrade({ id: "sw0", date: "2026-10-10T09:30", entry: 100, stop: 99, exit: 105, size: 2000, setups: ["s_sw"], notes: "Perfekter Reclaim nach dem Wick", emotion: "Ruhig" }));
  out.push(mkTrade({ id: "op0", date: "2026-10-11T09:30", status: "open", entry: 100, stop: 99, size: 1000, setups: ["s_bo"] }));
  return out;
}

function input(over: Partial<IndexInput> = {}): IndexInput {
  const s = settings();
  return {
    trades: enrichTrades(trades(), s),
    settings: s,
    days: { "2026-10-10": { note: "Disziplin gehalten, nur zwei Trades", plan: "Nur A+ Setups", updatedAt: "" } },
    pages: ["overview", "trades", "setups", "settings"],
    labels: { overview: "Übersicht", trades: "Trades", setups: "Entscheidungsgrundlagen", settings: "Einstellungen" },
    pageKeys: { overview: "o", trades: "t", setups: "s", settings: "e" },
    now: NOW,
    ...over,
  };
}

describe("search index", () => {
  it("indexes trades, setups, day notes, pages, settings sections and commands", () => {
    const items = buildSearchIndex(input());
    const kinds = new Set(items.map((i) => i.kind));
    expect([...kinds].sort()).toEqual(["command", "day", "page", "setting", "setup", "trade"]);
    expect(items.filter((i) => i.kind === "trade")).toHaveLength(8);
    expect(items.filter((i) => i.kind === "setting")).toHaveLength(SETTING_SECTIONS.length);
    expect(items.filter((i) => i.kind === "command")).toHaveLength(COMMANDS.length);
    expect(items.find((i) => i.id === "page:trades")).toMatchObject({ title: "Trades", keys: "g t", action: { type: "page", page: "trades" } });
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("reports only once the berichte page exists; unavailable commands drop out", () => {
    expect(buildSearchIndex(input()).some((i) => i.kind === "report")).toBe(false);
    const withReports = buildSearchIndex(input({ pages: ["overview", "berichte"] }));
    const reports = withReports.filter((i) => i.kind === "report");
    expect(reports.length).toBeGreaterThan(0);
    expect(reports[0]!.action.type).toBe("report");
    const noFs = buildSearchIndex(input({ commandAvailable: (id) => id !== "fullscreen" }));
    expect(noFs.some((i) => i.id === "command:fullscreen")).toBe(false);
  });

  it("finds a trade by its note, a setup by a typo-ish query, a day note by its text", () => {
    const items = buildSearchIndex(input());
    const note = flatHits(searchIndex(items, "reclaim wick"));
    expect(note[0]!.item.id).toBe("trade:sw0");
    const setup = searchIndex(items, "liquidty sweep");
    expect(setup[0]!.kind).toBe("setup");
    expect(setup[0]!.hits[0]!.item.title).toBe("Liquidity Sweep");
    const day = flatHits(searchIndex(items, "disziplin gehalten"));
    expect(day.some((h) => h.item.id === "day:2026-10-10")).toBe(true);
  });

  it("navigation targets win ties and the title is highlighted", () => {
    const items = buildSearchIndex(input());
    const g = searchIndex(items, "trades");
    expect(g[0]!.kind).toBe("page");
    expect(g[0]!.hits[0]!.ranges).toEqual([{ start: 0, end: 6 }]);
    expect(searchIndex(items, "")).toEqual([]);
    expect(searchIndex(items, "qqqqzzzz")).toEqual([]);
  });

  it("settings sections are found by what they hold", () => {
    const items = buildSearchIndex(input());
    const hit = flatHits(searchIndex(items, "startkapital"))[0]!;
    expect(hit.item).toMatchObject({ kind: "setting", action: { type: "setting", title: "Konten" } });
    expect(flatHits(searchIndex(items, "light mode")).some((h) => h.item.id === "command:theme-light")).toBe(true);
  });

  it("setup stats: strongest expectancy first", () => {
    const s = settings();
    const st = setupStats(enrichTrades(trades(), s), s);
    expect(st[0]!.id).toBe("s_sw");
    expect(st[st.length - 1]!.id).toBe("s_fd");
  });

  it("suggestions (empty query): the strongest first, never a losing setup or trade", () => {
    const inp = input();
    const items = buildSearchIndex(inp);
    const groups = suggestions({ items, trades: inp.trades, settings: inp.settings, recent: ["trade:fd0", "page:settings"] });
    expect(groups[0]!.kind).toBe("best");
    const best = groups[0]!.hits.map((h) => h.item.id);
    // the breakout has ≥ 3 closed trades and earns money; the sweep has one trade (too few for "best setup")
    expect(best[0]).toBe("setup:s_bo");
    expect(best).toContain("trade:sw0");
    expect(best.some((id) => id.includes("fd"))).toBe(false);
    expect(groups.find((g) => g.kind === "recent")!.hits.map((h) => h.item.id)).toEqual(["trade:fd0", "page:settings"]);
    expect(groups.find((g) => g.kind === "page")!.hits.some((h) => h.item.id === "page:settings")).toBe(false);
    expect(groups.find((g) => g.kind === "command")!.hits[0]!.item.id).toBe("command:new-trade");
  });

  it("an empty journal still suggests pages and commands", () => {
    const s = settings();
    const items = buildSearchIndex(input({ trades: [], days: {} }));
    const groups = suggestions({ items, trades: [], settings: s, recent: [] });
    expect(groups.map((g) => g.kind)).toEqual(["page", "command"]);
  });
});
