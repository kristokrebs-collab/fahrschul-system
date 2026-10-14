import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ChartLayers, divergencesKey, LAYER_FLAGS, structureKey } from "@/views/overview/ChartCard";
import type { DivergenceLine, StructureOverlay } from "@/chart/primitives/SignalOverlay";

const line = (p: Partial<DivergenceLine> = {}): DivergenceLine => ({ osc: "rsi", kind: "regular", dir: 1, from: { time: 1, price: 10 }, to: { time: 2, price: 9 }, state: "confirmed", active: true, ...p });
const level = { price: 100, top: 100, btm: 98, kind: "ob", dir: 1 as const, time: 5, label: "Demand-OB" };
const st = (p: Partial<StructureOverlay> = {}): StructureOverlay => ({ swings: [], breaks: [], eqs: [], supports: [level], resistances: [], support: level, resistance: null, ...p });

describe("chart overlay content keys", () => {
  it("divergences: state and activity change the key, nothing else does", () => {
    expect(divergencesKey([line()])).toBe(divergencesKey([line()]));
    expect(divergencesKey([line()])).not.toBe(divergencesKey([line({ state: "strong" })]));
    expect(divergencesKey([line()])).not.toBe(divergencesKey([line({ active: false })]));
  });

  it("structure: drawn levels / breaks change the key, the live distance does not", () => {
    const a = st();
    const b = st({ supports: [{ ...level, dist: 12 } as typeof level], support: { ...level, distAtr: 0.3 } as typeof level });
    expect(structureKey(a)).toBe(structureKey(b));
    expect(structureKey(a)).not.toBe(structureKey(st({ breaks: [{ time: 9, level: 99, pivotTime: 3, kind: "BOS", dir: 1, internal: false }] })));
    expect(structureKey(null)).toBe("");
  });
});

describe("ChartLayers (legend toggles under the chart)", () => {
  it("toggle buttons with aria-pressed and the state key; a tap reports the layer", () => {
    const onToggle = vi.fn();
    render(<ChartLayers layers={{ mcb: true, div: true, sr: false, struct: false }} onToggle={onToggle} />);
    const group = screen.getByRole("group", { name: "Ebenen im Chart" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["MCB", "Divergenzen", "S/R", "Struktur"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "true", "false", "false"]);
    fireEvent.click(screen.getByRole("button", { name: "Support und Widerstand im Chart" }));
    expect(onToggle).toHaveBeenCalledWith("sr");
    const key = screen.getByTestId("chart-state-key");
    expect(key).toHaveTextContent("vorläufig");
    expect(key).toHaveTextContent("stark bestätigt");
    expect(key).toHaveTextContent("versteckt");
  });

  it("the state key follows the shown layers; flags are namespaced in tj2-ui.flags", () => {
    render(<ChartLayers layers={{ mcb: false, div: false, sr: true, struct: true }} onToggle={() => undefined} />);
    expect(screen.getByTestId("chart-state-key")).toBeEmptyDOMElement();
    expect(LAYER_FLAGS).toEqual({ mcb: "chartMcbOff", div: "chartDivOff", sr: "chartSrOff", struct: "chartStructOn" });
  });
});
