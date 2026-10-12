import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INK_DEFAULTS, ink, resetInk } from "@/chart/ink";
import {
  applyInitialTheme,
  applyThemeToDom,
  parseStoredTheme,
  resolveTheme,
  setThemeTransition,
  syncChartInk,
  THEME_KEY,
  THEME_META_COLOR,
  toggleTheme,
  useTheme,
} from "@/store/themeStore";

function meta(name: string, content: string) {
  const el = document.createElement("meta");
  el.name = name;
  el.content = content;
  document.head.appendChild(el);
  return el;
}

describe("themeStore", () => {
  let themeColor: HTMLMetaElement;
  let scheme: HTMLMetaElement;

  beforeEach(() => {
    localStorage.clear();
    themeColor = meta("theme-color", "#0a0a0a");
    scheme = meta("color-scheme", "only dark");
    const root = document.documentElement;
    delete root.dataset.theme;
    delete root.dataset.themePref;
    delete root.dataset.accent;
    setThemeTransition(null);
  });
  afterEach(() => {
    themeColor.remove();
    scheme.remove();
    setThemeTransition(null);
    resetInk();
    vi.restoreAllMocks();
  });

  it("parses stored values leniently (object, bare pref, JSON string, junk → defaults)", () => {
    expect(parseStoredTheme(null)).toEqual({ pref: "dark", accent: "signal" });
    expect(parseStoredTheme('{"pref":"light","accent":"kobalt"}')).toEqual({ pref: "light", accent: "kobalt" });
    expect(parseStoredTheme('"system"')).toEqual({ pref: "system", accent: "signal" });
    expect(parseStoredTheme("light")).toEqual({ pref: "light", accent: "signal" });
    expect(parseStoredTheme('{"pref":"neon","accent":"gold"}')).toEqual({ pref: "dark", accent: "signal" });
    expect(parseStoredTheme("{broken")).toEqual({ pref: "dark", accent: "signal" });
    expect(parseStoredTheme("42")).toEqual({ pref: "dark", accent: "signal" });
  });

  it("resolves System from the OS scheme", () => {
    expect(resolveTheme("system", "light")).toBe("light");
    expect(resolveTheme("system", "dark")).toBe("dark");
    expect(resolveTheme("light", "dark")).toBe("light");
    expect(resolveTheme("dark", "light")).toBe("dark");
  });

  it("dark default writes only the attributes (no accent attribute, metas unchanged)", () => {
    applyInitialTheme();
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.themePref).toBe("dark");
    expect(root.hasAttribute("data-accent")).toBe(false);
    expect(themeColor.content).toBe("#0a0a0a");
    expect(scheme.content).toBe("only dark");
    expect(ink).toEqual(INK_DEFAULTS);
  });

  it("light writes the scheme, the accent and both metas", () => {
    applyThemeToDom({ pref: "light", accent: "violett" }, "light");
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.accent).toBe("violett");
    expect(themeColor.content).toBe(THEME_META_COLOR.light);
    expect(scheme.content).toBe("only light");
  });

  it("applies the stored preference before the first render", () => {
    localStorage.setItem(THEME_KEY, JSON.stringify({ pref: "light", accent: "kobalt" }));
    applyInitialTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(useTheme.getState()).toMatchObject({ pref: "light", accent: "kobalt", resolved: "light" });
  });

  it("setPref persists, runs the registered transition once with origin and schemes, and applies inside it", () => {
    applyInitialTheme();
    const calls: unknown[] = [];
    setThemeTransition((apply, origin, from, to) => {
      calls.push({ origin, from, to });
      expect(document.documentElement.dataset.theme).toBe("dark");
      apply();
    });
    useTheme.getState().setPref("light", { x: 10, y: 20 });
    expect(calls).toEqual([{ origin: { x: 10, y: 20 }, from: "dark", to: "light" }]);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(JSON.parse(localStorage.getItem(THEME_KEY)!)).toEqual({ pref: "light", accent: "signal" });
    // same scheme again: no transition
    useTheme.getState().setPref("light");
    expect(calls).toHaveLength(1);
  });

  it("toggleTheme flips the shown scheme (from System to the opposite)", () => {
    applyInitialTheme();
    toggleTheme();
    expect(useTheme.getState().resolved).toBe("light");
    toggleTheme();
    expect(useTheme.getState()).toMatchObject({ pref: "dark", resolved: "dark" });
  });

  it("the chart bridge reads the CSS mirrors in light mode and resets to the exact defaults in dark", () => {
    const root = document.documentElement;
    root.dataset.theme = "light";
    const vars: Record<string, string> = { "--chart-ink-bg": " #fdfdfc", "--chart-ink-fg": "#121212", "--chart-ink-win": "#0c8441" };
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ getPropertyValue: (k: string) => vars[k] ?? "" } as unknown as CSSStyleDeclaration);
    syncChartInk(root);
    expect(ink.bg).toBe("#fdfdfc");
    expect(ink.fg).toBe("#121212");
    expect(ink.win).toBe("#0c8441");
    expect(ink.grid).toBe(INK_DEFAULTS.grid);
    root.dataset.theme = "dark";
    syncChartInk(root);
    expect(ink).toEqual(INK_DEFAULTS);
  });
});
