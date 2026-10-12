/**
 * Grouped positions in the trades list (Journal v3, P06): Ø prices of a scaled position, result and curve of a group,
 * the card that unfolds its legs.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { groupTrades } from "@/domain/grouping";
import { GroupCard, groupCurve, groupPrices, groupResult, type Group } from "@/journal/grouping/GroupRows";
import { MotionRoot } from "@/motion/MotionRoot";
import { enriched, mkTrade } from "./domain.fixtures";

const NOW = new Date("2026-10-10T12:00").getTime();
const list = enriched([
  mkTrade({ id: "p1", date: "2026-10-01T10:00", exitDate: "2026-10-01T12:00", positionId: "pos", entry: 100, stop: 98, exit: 104, size: 1000 }),
  mkTrade({ id: "p2", date: "2026-10-01T11:00", exitDate: "2026-10-01T13:00", positionId: "pos", entry: 102, stop: 98, exit: 101, size: 2040 }),
  mkTrade({ id: "h1", date: "2026-10-02T10:00", exitDate: "2026-10-02T16:00", pair: "ETH/USDT", side: "long", entry: 100, stop: 99, exit: 98, size: 1000 }),
  mkTrade({ id: "h2", date: "2026-10-02T11:00", exitDate: "2026-10-02T14:00", pair: "ETH/USDT", side: "short", entry: 100, stop: 101, exit: 99, size: 1000 }),
]);
const { groups } = groupTrades(list, { now: NOW });
const byKind = (k: Group["kind"]) => groups.find((g) => g.kind === k)!;

describe("group maths", () => {
  it("a scaled position: quantity-weighted Ø entry / exit, summed result, cumulative curve", () => {
    const pos = byKind("position");
    expect(pos.members.map((m) => m.id)).toEqual(["p1", "p2"]);
    const p = groupPrices(pos);
    expect(p.entry).toBeCloseTo((100 * 10 + 102 * 20) / 30, 9);
    expect(p.exit).toBeCloseTo((104 * 10 + 101 * 20) / 30, 9);
    expect(groupResult(pos)).toBe("win"); // +40 − 20
    expect(groupCurve(pos)).toEqual([0, 40, 20]);
  });

  it("a hedge has no Ø price; an open group is open", () => {
    const hedge = byKind("hedge");
    expect(hedge.auto).toBe(true);
    expect(groupPrices(hedge)).toEqual({ entry: null, exit: null });
    expect(groupResult({ ...hedge, open: true })).toBe("open");
    expect(groupResult({ ...hedge, pnl: 0 })).toBe("be");
  });
});

describe("GroupCard", () => {
  function Harness({ onOpen }: { onOpen: (id: string) => void }) {
    const [open, setOpen] = useState(false);
    return (
      <MotionRoot>
        <GroupCard group={byKind("hedge")} open={open} onToggle={() => setOpen((o) => !o)} onOpenTrade={onOpen} />
      </MotionRoot>
    );
  }

  it("unfolds the legs; a leg opens its own trade", () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle).toHaveTextContent("Hedge");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
    const legs = screen.getByRole("list", { name: "Trades der Hedge-Gruppe" });
    expect(within(legs).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(document.querySelector('[data-group-member="h2"]')!);
    expect(onOpen).toHaveBeenCalledWith("h2");
  });
});
