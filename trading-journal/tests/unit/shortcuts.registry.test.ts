import { describe, expect, it } from "vitest";
import { CHORD_MS, isEditableTarget, isSearchCombo, matchKey, modalOpen, shortcutList, type KeyLike } from "@/app/shortcuts";
import { PAGE_KEYS, PAGES } from "@/store/uiStore";

const key = (k: string, o: Partial<KeyLike> = {}): KeyLike => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o });

describe("shortcut registry", () => {
  it("derives one g-chord per registered page from PAGES / PAGE_KEYS", () => {
    const list = shortcutList();
    for (const p of PAGES) {
      const def = list.find((d) => d.id === `go-${p}`)!;
      expect(def.keys).toEqual(["g", PAGE_KEYS[p]]);
      expect(def.group).toBe("Navigation");
      expect(typeof def.run).toBe("function");
    }
    // ⌘K and Esc are listed for the sheet only (handled by CommandNav / the dialogs)
    expect(list.find((d) => d.id === "nav")!.run).toBeUndefined();
    expect(list.find((d) => d.id === "close")!.run).toBeUndefined();
    expect(new Set(list.map((d) => d.id)).size).toBe(list.length);
  });

  it("matches single keys, g-chords within CHORD_MS, and nothing after the window", () => {
    const n = matchKey(key("n"), { g: null }, 0);
    expect(n.result).toMatchObject({ kind: "run", def: { id: "new-trade" } });
    const g = matchKey(key("g"), { g: null }, 1000);
    expect(g.result.kind).toBe("chord");
    expect(g.chord.g).toBe(1000);
    const gt = matchKey(key("t"), g.chord, 1000 + CHORD_MS - 1);
    expect(gt.result).toMatchObject({ kind: "run", def: { id: "go-trades" } });
    expect(gt.chord.g).toBeNull();
    // too late: `t` is the theme toggle again
    const late = matchKey(key("t"), g.chord, 1000 + CHORD_MS + 1);
    expect(late.result).toMatchObject({ kind: "run", def: { id: "theme" } });
    // an unknown letter after g ends the chord without running anything
    expect(matchKey(key("x"), { g: 5 }, 10).result.kind).toBe("none");
  });

  it("?, /, [ and ] work with Shift and with AltGr (German layout), not with Ctrl / ⌘ / Alt", () => {
    expect(matchKey(key("?", { shiftKey: true }), { g: null }, 0).result).toMatchObject({ kind: "run", def: { id: "help" } });
    expect(matchKey(key("/", { shiftKey: true }), { g: null }, 0).result).toMatchObject({ kind: "run", def: { id: "search" } });
    expect(matchKey(key("[", { ctrlKey: true, altKey: true }), { g: null }, 0).result).toMatchObject({ kind: "run", def: { id: "page-prev" } });
    expect(matchKey(key("]", { altGraph: true }), { g: null }, 0).result).toMatchObject({ kind: "run", def: { id: "page-next" } });
    expect(matchKey(key("n", { ctrlKey: true }), { g: null }, 0).result.kind).toBe("none");
    expect(matchKey(key("k", { metaKey: true }), { g: null }, 0).result.kind).toBe("none");
    expect(matchKey(key("n", { altKey: true }), { g: null }, 0).result.kind).toBe("none");
    expect(matchKey(key("n", { repeat: true }), { g: null }, 0).result.kind).toBe("none");
  });

  it("⌘⇧F / Ctrl+⇧F opens the search; ⌘K is not ours", () => {
    expect(isSearchCombo(key("F", { metaKey: true, shiftKey: true }))).toBe(true);
    expect(isSearchCombo(key("f", { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isSearchCombo(key("f", { ctrlKey: true }))).toBe(false);
    expect(matchKey(key("f", { ctrlKey: true, shiftKey: true }), { g: null }, 0).result).toMatchObject({ kind: "run", def: { id: "search-mod" } });
  });

  it("editable targets and open modals are recognised", () => {
    const input = document.createElement("input");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const area = document.createElement("textarea");
    const div = document.createElement("div");
    const combo = document.createElement("div");
    combo.setAttribute("role", "combobox");
    const inCombo = document.createElement("span");
    combo.appendChild(inCombo);
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(area)).toBe(true);
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(div)).toBe(false);
    expect(isEditableTarget(inCombo)).toBe(true);
    expect(isEditableTarget(null)).toBe(false);
    expect(modalOpen()).toBe(false);
    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    document.body.appendChild(dlg);
    expect(modalOpen()).toBe(true);
    dlg.remove();
  });
});
