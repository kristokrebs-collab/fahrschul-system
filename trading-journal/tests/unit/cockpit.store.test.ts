import { afterEach, describe, expect, it } from "vitest";
import {
  addBoard,
  addItem,
  COCKPIT_KEY,
  defaultData,
  DEFAULT_BOARDS,
  deleteBoard,
  MAX_BOARDS,
  parseCockpit,
  removeItem,
  renameBoard,
  reorderItems,
  resetBoard,
  resizeItem,
} from "@/views/cockpit/cockpitStore";
import { getWidget, listWidgets, registerWidget, registerWidgets, snapSpan, SPANS } from "@/views/cockpit/registry";
import { filterWidgets } from "@/views/cockpit/WidgetCatalog";

const Dummy = () => null;

describe("cockpit registry", () => {
  const offs: (() => void)[] = [];
  afterEach(() => offs.splice(0).forEach((off) => off()));

  it("registers, snaps the span to the offered widths and unregisters", () => {
    offs.push(registerWidget({ id: "t-a", title: "A", component: Dummy, defaultSpan: 9 }));
    expect(getWidget("t-a")!.defaultSpan).toBe(8);
    expect(snapSpan(1)).toBe(4);
    expect(snapSpan(11)).toBe(12);
    expect(snapSpan(6)).toBe(6);
    for (const s of SPANS) expect(snapSpan(s)).toBe(s);
    offs.pop()!();
    expect(getWidget("t-a")).toBeUndefined();
  });

  it("a list registers under one catalog group; an older unregister never removes a newer registration", () => {
    offs.push(registerWidgets([{ id: "t-b", title: "B", component: Dummy, defaultSpan: 6 }], "Analyse"));
    expect(getWidget("t-b")!.group).toBe("Analyse");
    const Other = () => null;
    const offOld = registerWidget({ id: "t-c", title: "C", component: Dummy, defaultSpan: 6 });
    offs.push(registerWidget({ id: "t-c", title: "C2", component: Other, defaultSpan: 6 }));
    offOld();
    expect(getWidget("t-c")!.title).toBe("C2");
    expect(() => registerWidget({ id: "", title: "x", component: Dummy, defaultSpan: 6 })).toThrow();
  });

  it("the catalog filter matches title, description and group (accents and case folded)", () => {
    const list = [
      { id: "1", title: "Monte Carlo", component: Dummy, defaultSpan: 6, group: "Analyse", description: "Ruin-Risiko" },
      { id: "2", title: "Win-Rate", component: Dummy, defaultSpan: 4, group: "Übersicht" },
    ];
    expect(filterWidgets(list, "")).toHaveLength(2);
    expect(filterWidgets(list, "ruin").map((w) => w.id)).toEqual(["1"]);
    expect(filterWidgets(list, "uebersicht").map((w) => w.id)).toEqual(["2"]);
    expect(filterWidgets(list, "zzz")).toEqual([]);
    expect(listWidgets().every((w) => typeof w.id === "string")).toBe(true);
  });
});

describe("cockpit layout", () => {
  it("defaults: two starter boards, the first active, copies (not shared references)", () => {
    const d = defaultData();
    expect(d.boards.map((b) => b.id)).toEqual(["main", "risk"]);
    expect(d.active).toBe("main");
    d.boards[0]!.items[0]!.span = 4;
    expect(DEFAULT_BOARDS[0]!.items[0]!.span).toBe(8);
    expect(COCKPIT_KEY).toMatch(/cockpit$/);
  });

  it("parses leniently: junk → defaults, broken items dropped, spans snapped, duplicates removed", () => {
    expect(parseCockpit(null).active).toBe("main");
    expect(parseCockpit("{nope").boards).toHaveLength(2);
    expect(parseCockpit(JSON.stringify({ boards: [] })).boards).toHaveLength(2);
    const d = parseCockpit(
      JSON.stringify({
        v: 1,
        active: "gone",
        boards: [
          { id: "x", name: "  Mein Board mit einem viel zu langen Namen  ", items: [{ id: "a", span: 3 }, { id: "a", span: 6 }, { id: "b" }, null, { span: 4 }] },
          { id: "x", name: "dupe", items: [] },
          { id: "y", name: "", items: "nope" },
        ],
      }),
    );
    expect(d.boards.map((b) => b.id)).toEqual(["x", "y"]);
    expect(d.active).toBe("x");
    expect(d.boards[0]!.name).toHaveLength(24);
    expect(d.boards[0]!.items).toEqual([
      { id: "a", span: 4 },
      { id: "b", span: 6 },
    ]);
    expect(d.boards[1]!.name).toBe("Dashboard");
  });

  it("add / remove / resize / reorder are pure and bounded", () => {
    const d0 = defaultData();
    const d1 = addItem(d0, "main", "new-w", 6);
    expect(d1.boards[0]!.items.at(-1)).toEqual({ id: "new-w", span: 6 });
    expect(d0.boards[0]!.items.some((i) => i.id === "new-w")).toBe(false);
    expect(addItem(d1, "main", "new-w", 4)).toEqual(d1);
    const d2 = removeItem(d1, "main", "ov-equity");
    expect(d2.boards[0]!.items.some((i) => i.id === "ov-equity")).toBe(false);
    // 8 → 12 → 12 (clamped), 4 → 4 (clamped)
    const wide = resizeItem(resizeItem(d0, "main", "ov-equity", 1), "main", "ov-equity", 1);
    expect(wide.boards[0]!.items[0]!.span).toBe(12);
    expect(resizeItem(d0, "main", "ov-winrate", -1).boards[0]!.items[1]!.span).toBe(4);
    const ids = d0.boards[0]!.items.map((i) => i.id);
    const re = reorderItems(d0, "main", ["ov-monthly", "unknown", "ov-equity"]);
    expect(re.boards[0]!.items.map((i) => i.id)).toEqual(["ov-monthly", "ov-equity", ...ids.filter((i) => i !== "ov-monthly" && i !== "ov-equity")]);
  });

  it("boards: add up to the maximum, rename (trimmed, never empty), delete (never the last), reset", () => {
    let d = defaultData();
    d = addBoard(d, "b3");
    expect(d.active).toBe("b3");
    expect(d.boards.at(-1)).toEqual({ id: "b3", name: "Dashboard 3", items: [] });
    d = addBoard(d, "b4", "Scalps");
    expect(d.boards).toHaveLength(MAX_BOARDS);
    expect(addBoard(d, "b5")).toBe(d);
    d = renameBoard(d, "b4", "  Nur Scalps  ");
    expect(d.boards.find((b) => b.id === "b4")!.name).toBe("Nur Scalps");
    expect(renameBoard(d, "b4", "   ")).toBe(d);
    d = deleteBoard(d, "b4");
    expect(d.active).toBe("main");
    let one = { ...d, boards: [d.boards[0]!] };
    expect(deleteBoard(one, "main")).toBe(one);
    one = removeItem(one, "main", "ov-equity");
    expect(resetBoard(one, "main").boards[0]!.items).toEqual(DEFAULT_BOARDS[0]!.items);
    d = addItem(d, "b3", "x", 6);
    expect(resetBoard(d, "b3").boards.find((b) => b.id === "b3")!.items).toEqual([]);
  });
});
