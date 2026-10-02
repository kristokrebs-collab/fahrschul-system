import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Rule, Trade } from "@/domain/types";
import { RulesCard, moveRule, ruleUsage } from "@/views/settings/RulesCard";

const RULES: Rule[] = [
  { id: "trigger", text: "Trigger ausgelöst, nicht geraten" },
  { id: "topdown", text: "Top-down geprüft (W → 3D → D → 4H → 1H)" },
  { id: "spx", text: "S&P-500-Kontext geprüft" },
];
const TRADES = [{ id: "a", checks: { "g:trigger": true } }, { id: "b", checks: { "g:trigger": true, "g:spx": false } }] as unknown as Trade[];

function Harness({ onChange }: { onChange: (r: Rule[]) => void }) {
  const [rules, setRules] = useState(RULES);
  return (
    <RulesCard
      rules={rules}
      trades={TRADES}
      onChange={(r) => {
        setRules(r);
        onChange(r);
      }}
    />
  );
}

describe("RulesCard", () => {
  it("ruleUsage / moveRule", () => {
    expect(ruleUsage(TRADES, "trigger")).toBe(2);
    expect(ruleUsage(TRADES, "spx")).toBe(0);
    expect(moveRule(RULES, 2, 1).map((r) => r.id)).toEqual(["trigger", "topdown", "spx"]);
    expect(moveRule(RULES, 2, -1).map((r) => r.id)).toEqual(["trigger", "spx", "topdown"]);
  });

  it("reorders with the keyboard, edits text, adds and removes rules (with the usage hint)", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const list = screen.getByRole("list", { name: "Grundregeln" });
    expect(list.querySelectorAll("li")).toHaveLength(3);

    fireEvent.keyDown(screen.getByRole("button", { name: "Regel 1 verschieben" }), { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith([RULES[1], RULES[0], RULES[2]]);
    expect((screen.getByLabelText("Regel 1") as HTMLInputElement).value).toBe("Top-down geprüft (W → 3D → D → 4H → 1H)");
    fireEvent.keyDown(screen.getByRole("button", { name: "Regel 1 verschieben" }), { key: "ArrowUp" }); // no-op at the top
    expect(onChange).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Regel 3"), { target: { value: "Neu formuliert" } });
    expect(onChange.mock.lastCall?.[0][2]).toEqual({ id: "spx", text: "Neu formuliert" });

    fireEvent.click(screen.getByRole("button", { name: "+ Regel hinzufügen" }));
    const added = onChange.mock.lastCall?.[0] as Rule[];
    expect(added).toHaveLength(4);
    expect(added[3]?.id.startsWith("g")).toBe(true);
    expect(added[3]?.text).toBe("");

    // remove an unused rule immediately, a used one only after the hint
    const removeButtons = screen.getAllByRole("button", { name: "Regel entfernen" });
    fireEvent.click(removeButtons[3] as HTMLElement);
    expect((onChange.mock.lastCall?.[0] as Rule[]).map((r) => r.id)).toEqual(["topdown", "trigger", "spx"]);
    fireEvent.click(screen.getAllByRole("button", { name: "Regel entfernen" })[1] as HTMLElement); // trigger (used twice)
    expect(screen.getByRole("alert")).toHaveTextContent("2 Trades verlieren den Haken");
    fireEvent.click(screen.getByRole("button", { name: "Nein" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull()); // AnimatePresence exit
    fireEvent.click(screen.getAllByRole("button", { name: "Regel entfernen" })[1] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Ja" }));
    expect((onChange.mock.lastCall?.[0] as Rule[]).map((r) => r.id)).toEqual(["topdown", "spx"]);
  });
});
