import { afterEach, describe, expect, it } from "vitest";
import { journalDefaults } from "@/journal/editor/form";
import { defaultForm, filledOf, groupsWithValues, journalProblemTarget, toRecord, validateRecord } from "@/overlays/TradeEditor";
import { DUPLICATE_HINT, carryOver, carrySentence, lastTrade } from "@/overlays/duplicateTrade";
import { keyboardInset } from "@/overlays/keyboardInset";
import {
  FIELDS,
  FIELD_IDS,
  GROUPS,
  GROUP_IDS,
  coreCount,
  defaultLayout,
  fieldsIn,
  filledByZone,
  filledFields,
  groupHint,
  isDefaultLayout,
  layoutKey,
  moveField,
  readLayout,
  sanitizeLayout,
  toStored,
  writeLayout,
} from "@/overlays/tradeFormLayout";
import { A, B, F, SAMPLE, mkTrade, settings } from "./domain.fixtures";

afterEach(() => localStorage.removeItem(layoutKey()));

describe("trade form – field catalog and groups", () => {
  it("every unit appears once; 29 units, 6 groups", () => {
    expect(new Set(FIELD_IDS).size).toBe(FIELD_IDS.length);
    expect(FIELDS.map((d) => d.id)).toEqual([...FIELD_IDS]);
    expect(FIELD_IDS).toHaveLength(29);
    expect(GROUPS.map((g) => g.id)).toEqual([...GROUP_IDS]);
    expect(GROUP_IDS).toHaveLength(6);
  });

  it("the default core is six fields, and they are exactly what a closed trade needs to be saved", () => {
    const layout = defaultLayout();
    expect(fieldsIn(layout, "core").map((d) => d.id)).toEqual(["pair", "side", "date", "entry", "exit", "size"]);
    expect(coreCount(layout)).toBe(6);
    // the code's own validation: date, entry, exit and size – nothing else – on top of pair / side (which always carry a value)
    const base = defaultForm(settings(), "scalp");
    const only = { ...base.d, entry: "80000", exit: "81000", size: "1000" };
    expect(validateRecord(toRecord(only, base.t), "")).toBeNull();
    for (const k of ["entry", "exit", "size", "date"] as const) expect(validateRecord(toRecord({ ...only, [k]: "" }, base.t), "")).not.toBeNull();
  });

  it("every other field has a group home; no group is empty by default", () => {
    const layout = defaultLayout();
    for (const d of FIELDS) expect(["core", ...GROUP_IDS]).toContain(layout[d.id]);
    for (const g of GROUPS) expect(fieldsIn(layout, g.id).length).toBeGreaterThan(0);
    expect(isDefaultLayout(layout)).toBe(true);
  });

  it("fields of a zone keep reading order; the group hint lists labels", () => {
    const layout = defaultLayout();
    expect(groupHint(layout, "targets")).toBe("Stop-Loss, Take-Profit, Hebel, Gebühren …");
    expect(groupHint(layout, "details")).toBe("Konto, Timeframe, Status");
    const moved = moveField(layout, "stop", "core");
    expect(fieldsIn(moved, "core").map((d) => d.id)).toEqual(["pair", "side", "date", "entry", "stop", "exit", "size"]);
    expect(groupHint(moveField(moveField(layout, "account", "core"), "timeframe", "core"), "details")).toBe("Status");
  });
});

describe("trade form – customising the layout", () => {
  it("moves a field, ignores unknown ids / zones and no-op moves", () => {
    const layout = defaultLayout();
    const next = moveField(layout, "notes", "core");
    expect(next.notes).toBe("core");
    expect(layout.notes).toBe("notes");
    expect(coreCount(next)).toBe(7);
    expect(moveField(next, "notes", "core")).toBe(next);
    expect(moveField(layout, "nope" as never, "core")).toBe(layout);
    expect(moveField(layout, "notes", "nope" as never)).toBe(layout);
    expect(isDefaultLayout(next)).toBe(false);
    expect(isDefaultLayout(moveField(next, "notes", "notes"))).toBe(true);
  });

  it("stores only the deviations, versioned", () => {
    expect(toStored(defaultLayout())).toEqual({ v: 1, moved: {} });
    expect(toStored(moveField(moveField(defaultLayout(), "stop", "core"), "size", "targets"))).toEqual({ v: 1, moved: { stop: "core", size: "targets" } });
  });

  it("reads leniently: garbage, wrong version and unknown entries fall back per field", () => {
    expect(isDefaultLayout(sanitizeLayout(null))).toBe(true);
    expect(isDefaultLayout(sanitizeLayout("x"))).toBe(true);
    expect(isDefaultLayout(sanitizeLayout([]))).toBe(true);
    expect(isDefaultLayout(sanitizeLayout({ v: 2, moved: { stop: "core" } }))).toBe(true);
    expect(isDefaultLayout(sanitizeLayout({ v: 1, moved: "core" }))).toBe(true);
    const l = sanitizeLayout({ v: 1, moved: { stop: "core", ghost: "core", target: "nowhere", notes: 3 } });
    expect(l.stop).toBe("core");
    expect(l.target).toBe("targets");
    expect(l.notes).toBe("notes");
    expect(Object.keys(l)).toHaveLength(29);
  });

  it("is kept per device: write → read; the default layout removes the key; a broken value reads as the default", () => {
    writeLayout(moveField(defaultLayout(), "stop", "core"));
    expect(JSON.parse(localStorage.getItem(layoutKey()) ?? "null")).toEqual({ v: 1, moved: { stop: "core" } });
    expect(readLayout().stop).toBe("core");
    writeLayout(defaultLayout());
    expect(localStorage.getItem(layoutKey())).toBeNull();
    localStorage.setItem(layoutKey(), "{not json");
    expect(isDefaultLayout(readLayout())).toBe(true);
  });

  it("a blocked storage never throws", () => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(isDefaultLayout(readLayout())).toBe(true);
      expect(() => writeLayout(moveField(defaultLayout(), "stop", "core"))).not.toThrow();
    } finally {
      Storage.prototype.getItem = get;
      Storage.prototype.setItem = set;
    }
  });
});

describe("trade form – filled badges and the groups a draft opens", () => {
  const s = settings();

  it("a blank new trade has nothing filled (the default leverage is not the trader's value)", () => {
    const f = defaultForm(s, "scalp");
    expect(f.d.leverage).toBe("4");
    expect(filledOf(f.d, f.t, s, true)).toEqual([]);
    // a stored trade's leverage is its own value
    expect(filledOf(f.d, f.t, s, false)).toContain("leverage");
  });

  it("counts optional fields per zone and follows a moved field", () => {
    const f = defaultForm(s, "scalp");
    const d = { ...f.d, leverage: "", stop: "79000", notes: "n", timeframe: "4h" };
    const t = { ...f.t, setups: ["s_bo"], j: { ...f.t.j, tags: ["a"], stress: 3 } };
    const filled = filledFields({ d, t });
    expect(filled).toEqual(expect.arrayContaining(["stop", "notes", "timeframe", "setups", "tags", "psych"]));
    const per = filledByZone(defaultLayout(), filled);
    expect(per).toMatchObject({ core: 0, details: 1, targets: 1, setup: 1, discipline: 1, notes: 2 });
    const stopInCore = filledByZone(moveField(defaultLayout(), "stop", "core"), filled);
    expect(stopInCore).toMatchObject({ core: 1, targets: 0 }); // the badge follows the field out of its group
    expect(filledByZone(moveField(defaultLayout(), "notes", "details"), filled).details).toBe(2);
  });

  it("execution and psyche count only when something differs from a fresh form", () => {
    const f = defaultForm(s, "scalp");
    expect(filledFields({ d: f.d, t: { ...f.t, j: journalDefaults() } })).not.toContain("execution");
    expect(filledFields({ d: f.d, t: { ...f.t, j: { ...journalDefaults(), exchange: "Bitunix" } } })).toContain("execution");
    expect(filledFields({ d: f.d, t: { ...f.t, j: { ...journalDefaults(), postNote: "x" } } })).toContain("psych");
  });

  it("groupsWithValues lists the closed-by-default groups that hold a value (core and non-optional never)", () => {
    const layout = defaultLayout();
    expect(groupsWithValues(layout, ["stop", "notes", "stop"])).toEqual(["targets", "notes"]);
    expect(groupsWithValues(moveField(layout, "stop", "core"), ["stop"])).toEqual([]);
    expect(groupsWithValues(layout, [])).toEqual([]);
  });
});

describe("trade form – where a validation message points", () => {
  it("journal v3 messages open the execution block", async () => {
    const { JOURNAL_MESSAGES, openRemainderMessage } = await import("@/journal/editor/form");
    expect(journalProblemTarget(JOURNAL_MESSAGES.exitBeforeEntry)).toEqual({ field: "execution", dom: "f-exit-date" });
    expect(journalProblemTarget(JOURNAL_MESSAGES.fillIncomplete)).toEqual({ field: "execution", dom: "fb-execution" });
    expect(journalProblemTarget(JOURNAL_MESSAGES.targetsOver)?.field).toBe("execution");
    expect(journalProblemTarget(openRemainderMessage(0.5))?.field).toBe("execution");
    expect(journalProblemTarget("etwas anderes")).toBeNull();
  });
});

describe("keyboard inset", () => {
  const vv = (height: number, offsetTop = 0, scale = 1) => ({ height, offsetTop, scale });
  it("is the gap under the visual viewport once it is keyboard-sized, else 0", () => {
    expect(keyboardInset(844, vv(844))).toBe(0);
    expect(keyboardInset(844, vv(800))).toBe(0); // a browser toolbar (`--vv-bottom`), not a keyboard
    expect(keyboardInset(844, vv(520))).toBe(324);
    expect(keyboardInset(844, vv(520, 40))).toBe(284); // iOS scrolled the visual viewport
    expect(keyboardInset(844, vv(520, 0, 2))).toBe(0); // pinch-zoomed
    expect(keyboardInset(844, null)).toBe(0);
    expect(keyboardInset(Number.NaN, vv(520))).toBe(0);
  });
});

describe("Letzten Trade duplizieren", () => {
  it("the last trade is the newest by date", () => {
    expect(lastTrade(SAMPLE)?.id).toBe("F");
    expect(lastTrade([])).toBeUndefined();
    const a = mkTrade({ id: "x", date: "2026-05-01T10:00", createdAt: "2026-05-01T10:00:00.000Z" });
    const b = mkTrade({ id: "y", date: "2026-05-01T10:00", createdAt: "2026-05-02T10:00:00.000Z" });
    expect(lastTrade([a, b])?.id).toBe("y");
  });

  it("takes the setting over – never prices, result, times, notes, checks or feelings", () => {
    const t = { ...A, leverage: 4, tags: ["Breakout"], notes: "Notiz", exitDate: "2026-01-05T12:00", pnl: 396, r: 3.96, mistakes: ["FOMO"], screenshots: [] } as typeof A;
    const c = carryOver(t, settings().setups, "USDT");
    expect(c.draft).toEqual({ account: "scalp", pair: "BTC/USDT", side: "long", setups: ["s_bo"], size: 8000, leverage: 4, timeframe: "4h", tags: ["Breakout"] });
    for (const k of ["entry", "stop", "target", "exit", "date", "exitDate", "pnl", "r", "notes", "reason", "checks", "conviction", "emotion", "mistakes", "fees", "chart", "followedPlan"]) expect(c.draft).not.toHaveProperty(k);
  });

  it("says in one sentence what was taken – and what was left out", () => {
    const c = carryOver({ ...A, leverage: 4, tags: ["Breakout"] } as typeof A, settings().setups);
    const sentence = carrySentence(c);
    expect(sentence).toMatch(/^Vom letzten Trade übernommen: Symbol BTC\/USDT, Richtung Long, Setup „[^“]+“, Größe 8\.000 USDT, Hebel 4x, Zeitrahmen 4h und Tag Breakout – ohne Preise, Ergebnis, Zeiten und Notizen\.$/);
    expect(sentence.endsWith(".")).toBe(true);
    expect(sentence.slice(0, -1)).not.toMatch(/\.\s/); // one sentence
  });

  it("leaves out what the last trade did not have", () => {
    const bare = carryOver(mkTrade({ id: "z", date: "2026-06-01T10:00", timeframe: "" }), []);
    expect(bare.draft).toEqual({ account: "scalp", pair: "BTC/USDT", side: "long" });
    expect(carrySentence(bare)).toBe("Vom letzten Trade übernommen: Symbol BTC/USDT und Richtung Long – ohne Preise, Ergebnis, Zeiten und Notizen.");
    expect(carryOver(B, settings().setups).taken.join(" ")).toContain("Richtung Short");
    expect(carryOver(F, settings().setups).draft.setups).toEqual(["s_bt"]);
    expect(DUPLICATE_HINT).toContain("ohne Preise, Ergebnis, Zeiten und Notizen");
  });
});
