/**
 * Settings card, Einstiegs-Check v2 groups: `Bestätigung (Kerzenschluss)` (closes until "stark bestätigt"),
 * `Top-Trader-Kombi` (switch, % threshold, retail period, parts for +1 strength, weight), `Divergenzen` (switch,
 * oscillator / filter chips, pivot lookbacks, weight) and `Support / Widerstand` (switch, ATR nearness, R room, weight).
 * Every control writes its `sg*` draft key; the values shown are the engine's.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useJournal } from "@/store/journalStore";
import { MotionRoot } from "@/motion/MotionRoot";
import { SignalCheckCard } from "@/views/settings/SignalCheckCard";
import { settingsToDraft, type DraftKey, type SettingsDraft } from "@/views/settings/draft";

vi.mock("@/market", async (orig) => ({ ...(await orig<typeof import("@/market")>()), signalNotifyPermission: () => "default" }));

function setup(draftPatch: Partial<SettingsDraft> = {}, signals?: unknown, changed: DraftKey[] = []) {
  const base = useJournal.getState().settings;
  const draft = { ...settingsToDraft({ ...base, signals }), ...draftPatch } as SettingsDraft;
  const onChange = vi.fn();
  render(
    <MotionRoot>
      <SignalCheckCard draft={draft} onChange={onChange} onPatch={vi.fn()} changed={new Set(changed)} invalid={null} />
    </MotionRoot>,
  );
  return { onChange };
}

describe("SignalCheckCard · v2 thresholds", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the defaults: 2 closes, Top-Trader 64 % · 5m · 3 of 4 · 10, divergences and S/R on", () => {
    setup();
    const confirm = screen.getByTestId("settings-confirm");
    expect(within(within(confirm).getByRole("radiogroup", { name: "Stark bestätigt nach" })).getByRole("radio", { name: "2", checked: true })).toBeInTheDocument();
    expect(within(confirm).getByText(/2 Schlüssen \(inkl\. der Signalkerze\)/)).toBeInTheDocument();
    const tt = screen.getByTestId("settings-whale");
    expect(within(tt).getByRole("switch")).toBeChecked();
    expect(within(tt).getByText("Check „Top-Trader long · Retail rot“")).toBeInTheDocument();
    expect(within(tt).getByLabelText(/Top-Trader-Schwelle/)).toHaveValue("64");
    expect(within(tt).getByText("Long: über 64 % Long · Short: über 64 % Short (Long unter 36 %)")).toBeInTheDocument();
    expect(within(within(tt).getByRole("radiogroup", { name: "Retail-Vergleich" })).getByRole("radio", { name: "5m", checked: true })).toBeInTheDocument();
    expect(within(within(tt).getByRole("radiogroup", { name: "+1 Stärke ab" })).getByRole("radio", { name: "3", checked: true })).toBeInTheDocument();
    expect(within(tt).getByText("bis +10 Score, anteilig (je erfüllter Teil ¼)")).toBeInTheDocument();
    // the legacy run-rule controls are gone (their stored values stay untouched)
    expect(within(tt).queryByRole("button", { name: /^Periode / })).toBeNull();
    const div = screen.getByTestId("settings-div");
    expect(within(div).getByRole("switch")).toBeChecked();
    expect(within(div).getByRole("button", { name: "RSI" })).toHaveAttribute("aria-pressed", "true");
    expect(within(div).getByLabelText(/Pivot links/)).toHaveValue("2");
    expect(within(div).getByLabelText(/Abstand max/)).toHaveValue("60");
    const sr = screen.getByTestId("settings-sr");
    expect(within(sr).getByLabelText(/Level-Nähe/)).toHaveValue("1");
    expect(within(sr).getByLabelText(/Mindest-Platz/)).toHaveValue("2");
  });

  it("every control writes its draft key", () => {
    const { onChange } = setup();
    // the default signal window (3 candles, the running one included) shows at most 2 closes
    expect(within(screen.getByRole("radiogroup", { name: "Stark bestätigt nach" })).queryByRole("radio", { name: "3" })).toBeNull();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Stark bestätigt nach" })).getByRole("radio", { name: "1" }));
    expect(onChange).toHaveBeenLastCalledWith("sgStrong", "1");
    const tt = screen.getByTestId("settings-whale");
    fireEvent.click(within(tt).getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith("sgWhale", "");
    fireEvent.change(within(tt).getByLabelText(/Top-Trader-Schwelle/), { target: { value: "70" } });
    expect(onChange).toHaveBeenLastCalledWith("sgWhaleTop", "70");
    fireEvent.click(within(within(tt).getByRole("radiogroup", { name: "Retail-Vergleich" })).getByRole("radio", { name: "1h" }));
    expect(onChange).toHaveBeenLastCalledWith("sgWhaleRetail", "1h");
    fireEvent.click(within(within(tt).getByRole("radiogroup", { name: "+1 Stärke ab" })).getByRole("radio", { name: "4" }));
    expect(onChange).toHaveBeenLastCalledWith("sgWhaleBonus", "4");
    fireEvent.click(within(within(tt).getByRole("radiogroup", { name: "Gewicht (Score)" })).getByRole("radio", { name: "0" }));
    expect(onChange).toHaveBeenLastCalledWith("sgWhaleWeight", "0");
    const div = screen.getByTestId("settings-div");
    fireEvent.click(within(div).getByRole("button", { name: "versteckte" }));
    expect(onChange).toHaveBeenLastCalledWith("sgDivHidden", "");
    fireEvent.change(within(div).getByLabelText(/Gilt \(Kerzen\)/), { target: { value: "8" } });
    expect(onChange).toHaveBeenLastCalledWith("sgDivAge", "8");
    fireEvent.click(within(within(div).getByRole("radiogroup", { name: "Gewicht (Score)" })).getByRole("radio", { name: "20" }));
    expect(onChange).toHaveBeenLastCalledWith("sgDivWeight", "20");
    const sr = screen.getByTestId("settings-sr");
    fireEvent.change(within(sr).getByLabelText(/Level-Nähe/), { target: { value: "0,5" } });
    expect(onChange).toHaveBeenLastCalledWith("sgSrNear", "0,5");
    fireEvent.click(within(sr).getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith("sgSr", "");
  });

  it("the last oscillator cannot be switched off; stored values show; changed keys mark their group", () => {
    const { onChange } = setup({ sgDivWt: "" }, { whale: { topPct: 70, weight: 7 }, strongCloses: 4, signalLookback: 6 }, ["sgDivAge"]);
    const div = screen.getByTestId("settings-div");
    const rsi = within(div).getByRole("button", { name: "RSI" });
    expect(rsi).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(rsi);
    expect(onChange).not.toHaveBeenCalled();
    const tt = screen.getByTestId("settings-whale");
    expect(within(tt).getByLabelText(/Top-Trader-Schwelle/)).toHaveValue("70");
    expect(within(within(tt).getByRole("radiogroup", { name: "Gewicht (Score)" })).getByRole("radio", { name: "7", checked: true })).toBeInTheDocument();
    expect(within(within(screen.getByTestId("settings-confirm")).getByRole("radiogroup", { name: "Stark bestätigt nach" })).getByRole("radio", { name: "4", checked: true })).toBeInTheDocument();
  });

  it("stark bestätigt: never more closes than the signal window holds; a larger stored value shows as the cap", () => {
    setup({}, { strongCloses: 5, signalLookback: 3 });
    const group = within(screen.getByTestId("settings-confirm"));
    const radios = within(group.getByRole("radiogroup", { name: "Stark bestätigt nach" })).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["1", "2"]);
    expect(within(group.getByRole("radiogroup", { name: "Stark bestätigt nach" })).getByRole("radio", { name: "2", checked: true })).toBeInTheDocument();
    expect(group.getByText(/höchstens 2 bei diesem Signal-Fenster/)).toBeInTheDocument();
  });
});
