/** Settings card group "Top-Trader · Retail": switch, periods, consecutive periods, weight (draft keys `sgWhale*`). */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useJournal } from "@/store/journalStore";
import { MotionRoot } from "@/motion/MotionRoot";
import { SignalCheckCard } from "@/views/settings/SignalCheckCard";
import { settingsToDraft, type SettingsDraft } from "@/views/settings/draft";

vi.mock("@/market", async (orig) => ({ ...(await orig<typeof import("@/market")>()), signalNotifyPermission: () => "default" }));

function setup(draftPatch: Record<string, string> = {}, signals?: unknown) {
  const base = useJournal.getState().settings;
  useJournal.setState({ settings: { ...base, signals } });
  const draft = { ...settingsToDraft({ ...base, signals }), ...draftPatch } as SettingsDraft;
  const onChange = vi.fn();
  render(
    <MotionRoot>
      <SignalCheckCard draft={draft} onChange={onChange} onPatch={vi.fn()} changed={new Set()} invalid={null} />
    </MotionRoot>,
  );
  return { onChange, group: screen.getByTestId("settings-whale") };
}

describe("SignalCheckCard · Top-Trader / Retail", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the defaults: on, 30m + 1h, 2 in a row, weight 10 (with the grading line)", () => {
    const { group } = setup();
    expect(within(group).getByRole("switch")).toBeChecked();
    expect(within(group).getByRole("button", { name: "Periode 30m" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Periode 1h" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Periode 4h" })).toHaveAttribute("aria-pressed", "false");
    expect(within(group).getByRole("radiogroup", { name: "In Folge (mind.)" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "2" , checked: true })).toBeInTheDocument();
    expect(within(group).getByText("+10 Score, ein gültiger Einstieg wird eine Stärke höher (bis Maximal)")).toBeInTheDocument();
  });

  it("every control writes its draft key", () => {
    const { onChange, group } = setup();
    fireEvent.click(within(group).getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith("sgWhale", "");
    fireEvent.click(within(group).getByRole("button", { name: "Periode 4h" }));
    expect(onChange).toHaveBeenLastCalledWith("sgWhalePeriods", "30m,1h,4h");
    fireEvent.click(within(group).getByRole("button", { name: "Periode 30m" }));
    expect(onChange).toHaveBeenLastCalledWith("sgWhalePeriods", "1h");
    const min = within(group).getByRole("radiogroup", { name: "In Folge (mind.)" });
    fireEvent.click(within(min).getByRole("radio", { name: "3" }));
    expect(onChange).toHaveBeenLastCalledWith("sgWhaleMin", "3");
    const weight = within(group).getByRole("radiogroup", { name: "Gewicht (Score)" });
    fireEvent.click(within(weight).getByRole("radio", { name: "0" }));
    expect(onChange).toHaveBeenLastCalledWith("sgWhaleWeight", "0");
  });

  it("the last active period cannot be switched off", () => {
    const { onChange, group } = setup({ sgWhalePeriods: "1h" });
    const last = within(group).getByRole("button", { name: "Periode 1h" });
    expect(last).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(last);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reads the stored settings when the draft carries no whale strings, the draft strings when it does", () => {
    const stored = { whale: { on: false, periods: ["4h"], minRun: 4, weight: 7 } };
    const a = setup({}, stored);
    expect(within(a.group).getByRole("switch")).not.toBeChecked();
    expect(within(a.group).getByRole("button", { name: "Periode 4h" })).toHaveAttribute("aria-pressed", "true");
    expect(within(within(a.group).getByRole("radiogroup", { name: "Gewicht (Score)" })).getByRole("radio", { name: "7", checked: true })).toBeInTheDocument();
    document.body.innerHTML = "";
    const b = setup({ sgWhale: "on", sgWhalePeriods: "15m", sgWhaleMin: "1", sgWhaleWeight: "20" }, stored);
    expect(within(b.group).getByRole("switch")).toBeChecked();
    expect(within(b.group).getByRole("button", { name: "Periode 15m" })).toHaveAttribute("aria-pressed", "true");
    expect(within(b.group).getByRole("button", { name: "Periode 4h" })).toHaveAttribute("aria-pressed", "false");
    expect(within(b.group).getByText("1 abgeschlossene Periode hintereinander")).toBeInTheDocument();
  });
});
