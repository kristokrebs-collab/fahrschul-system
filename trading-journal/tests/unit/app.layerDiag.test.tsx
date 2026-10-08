import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectLayers,
  createTapCounter,
  DIAG_ATTR,
  diagRequested,
  formatReport,
  isLayerDiagOpen,
  layerEffects,
  layerLine,
  layerName,
  layersAt,
  MULTI_TAP,
  setLayerDiagOpen,
  type LayerInfo,
  type ViewportInfo,
} from "@/app/layerDiag";
import LayerDiagnostics, { DIAG_TITLE, PROBE_H } from "@/app/LayerDiagnostics";
import { isSafeFx, setSafeFx, wantsSafeFx } from "@/app/pwa";

const SAMSUNG = "Mozilla/5.0 (Linux; Android 14; SM-X916B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36";
const CHROME = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

afterEach(() => {
  document.body.innerHTML = "";
  setLayerDiagOpen(false);
  setSafeFx(false);
});

describe("layer diagnostics – activation", () => {
  it("?debug=layers in the search or in the hash query opens it", () => {
    expect(diagRequested("?debug=layers", "")).toBe(true);
    expect(diagRequested("", "#overview?debug=layers")).toBe(true);
    expect(diagRequested("?x=1&debug=perf,layers", "#trades")).toBe(true);
    expect(diagRequested("?debug=perf", "#overview")).toBe(false);
    expect(diagRequested("", "#overview")).toBe(false);
    expect(diagRequested("?layers", "")).toBe(false);
  });

  it("five quick taps (each ≤ 450 ms apart) count to 5 once, slow taps start over", () => {
    const c = createTapCounter();
    expect(MULTI_TAP).toEqual({ count: 5, gapMs: 450 });
    expect([0, 300, 600, 900].map((t) => c.tap(t))).toEqual([1, 2, 3, 4]);
    expect(c.tap(1300)).toBe(5);
    // after reporting 5 the series starts over
    expect(c.tap(1400)).toBe(1);
    // a slow tap resets
    expect(c.tap(1400 + 451)).toBe(1);
  });
});

describe("layer diagnostics – pure helpers", () => {
  it("names a layer by data-layer, aria-label, testid, id, else tag + plain classes", () => {
    const el = (attrs: Record<string, string>, cls = "", tag = "DIV", id = "") => {
      const list = cls.split(" ").filter(Boolean);
      return { tagName: tag, id, getAttribute: (n: string) => attrs[n] ?? null, classList: Object.assign([...list], { length: list.length }) };
    };
    expect(layerName(el({ "data-layer": "Dock", "aria-label": "Navigation" }, "", "NAV"))).toBe("Dock (nav)");
    expect(layerName(el({ "aria-label": "Navigation" }, "", "NAV"))).toBe("Navigation (nav)");
    expect(layerName(el({}, "fixed inset-0", "DIV", "root"))).toBe("div#root");
    expect(layerName(el({}, "fixed bottom-[calc(1px)] inset-0 z-50"))).toBe("div.fixed.inset-0.z-50");
    expect(layerName(el({}))).toBe("div");
  });

  it("reports the effects that matter on fixed layers", () => {
    expect(layerEffects({ clipPath: "inset(0)", filter: "none", transform: "none", willChange: "auto", mixBlendMode: "normal", backdropFilter: "blur(4px)", maskImage: "none" })).toEqual(["clip-path", "backdrop-filter"]);
    expect(layerEffects({ clipPath: "none", filter: "blur(2px)", transform: "matrix(1, 0, 0, 1, 0, 0)", willChange: "transform", mixBlendMode: "screen", webkitMaskImage: "linear-gradient(red, blue)" })).toEqual([
      "mask",
      "filter",
      "will-change:transform",
      "transform",
      "blend:screen",
    ]);
  });

  const layer = (n: number, name: string, box: LayerInfo["box"], z: string, extra: Partial<LayerInfo> = {}): LayerInfo => ({
    n,
    name,
    position: "fixed",
    box,
    z,
    opacity: 1,
    bg: "transparent",
    effects: [],
    visibility: "visible",
    el: null,
    ...extra,
  });

  it("finds the layers under a point, topmost first, skipping hidden ones", () => {
    const ls = [
      layer(1, "Unterer Verlauf", { x: 0, y: 866, w: 1692, h: 112 }, "45"),
      layer(2, "Dock", { x: 0, y: 906, w: 1692, h: 60 }, "50"),
      layer(3, "Header", { x: 0, y: 0, w: 1692, h: 64 }, "40"),
      layer(4, "Ausgeblendet", { x: 0, y: 900, w: 1692, h: 78 }, "90", { visibility: "hidden" }),
    ];
    expect(layersAt(ls, 846, 948).map((l) => l.name)).toEqual(["Dock", "Unterer Verlauf"]);
    expect(layersAt(ls, 846, 970).map((l) => l.name)).toEqual(["Unterer Verlauf"]);
    expect(layersAt(ls, 846, 500)).toEqual([]);
  });

  it("formats a German plain-text report with viewport, safe area, bottom stack and every layer", () => {
    const v: ViewportInfo = {
      ua: SAMSUNG,
      samsung: true,
      safeFx: true,
      display: "Browser-Tab",
      dpr: 1.75,
      screen: "1692×1056",
      inner: { w: 1692, h: 888 },
      client: { w: 1692, h: 888 },
      vv: { w: 1692, h: 888, top: 0, left: 0, scale: 1 },
      safe: { top: 0, right: 0, bottom: 0, left: 0 },
      vvBottom: "0px",
      safeBottom: 0,
      scrollY: 1200,
      docH: 7800,
    };
    const ls = [layer(1, "Dock (nav)", { x: 0, y: 816, w: 1692, h: 60 }, "50", { effects: ["will-change:transform"] }), layer(2, "Toast-Insel (div)", { x: 0, y: 888, w: 0, h: 0 }, "95")];
    const text = formatReport(v, ls, [{ label: "Unterkante", names: ["#1 Dock (nav)"] }, { label: "Ganz unten", names: [] }], new Date(2026, 9, 8, 1, 21, 5), "https://x/?debug=layers");
    expect(text.split("\n")).toEqual([
      "Trade Journal · Ebenen-Diagnose",
      "Zeit: 2026-10-08 01:21:05",
      "URL: https://x/?debug=layers",
      `Browser: ${SAMSUNG}`,
      "Samsung Internet: ja · sichere Effekte: an",
      "Anzeige: Browser-Tab · DPR 1.75 · Bildschirm 1692×1056",
      "Fenster (inner): 1692×888 · Layout (client): 1692×888",
      "Visual Viewport: 1692×888 · Versatz 0/0 · Zoom 1",
      "Safe-Area: oben 0 · rechts 0 · unten 0 · links 0",
      "--vv-bottom 0px · --safe-bottom 0px · scrollY 1200 / 7800",
      "Unterkante: #1 Dock (nav)",
      "Ganz unten: keine Seiten-Ebene",
      "Ebenen (fixed/sticky): 2",
      "1. Dock (nav) · fixed · 1692×60 @ 0,816 · z 50 · transparent · will-change:transform",
      "2. Toast-Insel (div) · fixed · 0×0 @ 0,888 · z 95 · transparent",
    ]);
    expect(layerLine({ ...ls[0]!, opacity: 0.05, visibility: "hidden" })).toContain("Deckkraft 5 % · will-change:transform · ausgeblendet");
  });
});

describe("layer diagnostics – DOM", () => {
  it("collects fixed / sticky layers and named inner parts (with their layer's z), skipping display:none subtrees and itself", () => {
    document.body.innerHTML = `
      <header data-layer="Header" style="position:sticky;z-index:40"></header>
      <nav data-layer="Dock" style="position:fixed;z-index:50"><div data-layer="Dock-Leiste" style="position:relative"></div></nav>
      <div style="display:none"><div style="position:fixed" aria-label="versteckt"></div></div>
      <div ${DIAG_ATTR}><div style="position:fixed" aria-label="Diagnose selbst"></div></div>
      <main><div style="position:fixed;z-index:95" data-testid="island"></div></main>`;
    const ls = collectLayers().filter((l) => !l.pseudo);
    expect(ls.map((l) => [l.name, l.position, l.z])).toEqual([
      ["Header (header)", "sticky", "40"],
      ["Dock (nav)", "fixed", "50"],
      ["Dock-Leiste (div)", "innen", "50"],
      ["island (div)", "fixed", "95"],
    ]);
  });

  it("the overlay lists the layers, hides one on demand and restores everything when it closes", async () => {
    document.body.innerHTML = `<nav data-layer="Dock" style="position:fixed;z-index:50"></nav>`;
    const nav = document.querySelector("nav") as HTMLElement;
    setLayerDiagOpen(true);
    const { unmount } = render(<LayerDiagnostics />);
    expect(screen.getByRole("region", { name: DIAG_TITLE })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kopieren" })).toBeInTheDocument();
    expect(screen.getByText(`PRÜFSTREIFEN · untere ${PROBE_H} px der Seite`)).toBeInTheDocument();
    // the first measurement runs on the next frame
    const hide = await screen.findByRole("button", { name: "Dock (nav) ausblenden" });
    act(() => fireEvent.click(hide));
    expect(nav.style.visibility).toBe("hidden");
    // the safe-effects switch applies live and is restored on close
    act(() => fireEvent.click(screen.getByRole("button", { name: "Sichere Effekte (Samsung) anwenden" })));
    expect(isSafeFx()).toBe(true);
    act(() => fireEvent.click(screen.getByRole("button", { name: "Diagnose schließen" })));
    expect(isLayerDiagOpen()).toBe(false);
    unmount();
    expect(nav.style.visibility).toBe("");
    expect(isSafeFx()).toBe(false);
  });
});

describe("Samsung-Internet-safe effects", () => {
  it("apply in Samsung Internet; ?safefx=1 / ?safefx=0 force them on / off anywhere", () => {
    expect(wantsSafeFx(SAMSUNG, "")).toBe(true);
    expect(wantsSafeFx(CHROME, "")).toBe(false);
    expect(wantsSafeFx(CHROME, "?safefx=1")).toBe(true);
    expect(wantsSafeFx(SAMSUNG, "?debug=layers&safefx=0")).toBe(false);
    setSafeFx(true);
    expect(document.documentElement.hasAttribute("data-safe-fx")).toBe(true);
    setSafeFx(false);
    expect(document.documentElement.hasAttribute("data-safe-fx")).toBe(false);
  });
});
